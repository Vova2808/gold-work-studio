import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { StockAsset, StockProvider } from "@gold-work/shared";
import { normalizeStockSearchInput, StockApiRateLimitError, StockClient, type StockKeyStore } from "./stock-client.js";
import { StockStore, type StockSecretCodec } from "./stock-store.js";

class StubKeys implements StockKeyStore {
  constructor(private readonly keys: Partial<Record<StockProvider, string>>) {}
  async apiKey(provider: StockProvider): Promise<string | undefined> { return this.keys[provider]; }
}

test("documentary stock download streams to disk without a whole-response buffer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gws-stock-stream-"));
  let sent = 0;
  const client = new StockClient(new StubKeys({}), async () => {
    const response = new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      if (sent === 12) { controller.close(); return; }
      controller.enqueue(new Uint8Array(64 * 1024).fill(sent++));
    } }), { headers: { "content-type": "video/mp4" } });
    response.arrayBuffer = async () => { throw new Error("Whole-file buffering is forbidden"); };
    return response;
  });
  const output = join(directory, "source.mp4");
  const result = await client.downloadToFile(downloadableAsset(), output, 1024 * 1024);
  const bytes = await readFile(output);
  assert.equal(result.bytes, 12 * 64 * 1024);
  assert.equal(bytes.length, result.bytes);
  assert.equal(bytes[11 * 64 * 1024], 11);
  assert.match(result.extension, /mp4/);
});

test("streamed stock bounds an undeclared body and cancels it on overflow", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gws-stock-overflow-"));
  let cancelled = false;
  const client = new StockClient(new StubKeys({}), async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024)); },
    cancel() { cancelled = true; },
  })));
  const output = join(directory, "partial.mp4");
  await assert.rejects(client.downloadToFile(downloadableAsset(), output, 2500), /превысил/);
  assert.equal(cancelled, true);
  assert.ok((await readFile(output)).length <= 2500);
});

test("streamed stock rejects insufficient declared space and preserves an existing destination", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gws-stock-preserve-"));
  const output = join(directory, "keep.mp4");
  await writeFile(output, "original");
  let cancelled = false;
  const large = new StockClient(new StubKeys({}), async () => new Response(new ReadableStream({
    cancel() { cancelled = true; },
  }), { headers: { "content-length": "5000" } }));
  await assert.rejects(large.downloadToFile(downloadableAsset(), output, 1000), /Недостаточно места/);
  assert.equal(cancelled, true);
  const small = new StockClient(new StubKeys({}), async () => new Response("new"));
  await assert.rejects(small.downloadToFile(downloadableAsset(), output, 1000), /EEXIST/);
  assert.equal(await readFile(output, "utf8"), "original");
});

const testCodec: StockSecretCodec = {
  available: () => true,
  encrypt: (value) => `cipher:${Buffer.from(value, "utf8").toString("base64")}`,
  decrypt: (value) => Buffer.from(value.slice("cipher:".length), "base64").toString("utf8")
};

function downloadableAsset(provider: StockProvider = "pexels", mediaType: "image" | "video" = "video"): StockAsset {
  const extension = mediaType === "video" ? "mp4" : "jpg";
  return {
    provider,
    id: "asset-1",
    mediaType,
    query: "police car",
    width: 1280,
    height: 720,
    previewUrl: `https://images.${provider}.com/asset-1.jpg`,
    downloadUrl: `https://videos.${provider}.com/asset-1.${extension}`,
    pageUrl: `https://www.${provider}.com/video/asset-1/`,
    author: "Author",
    attribution: "Test asset"
  };
}

test("stock settings distinguish saved, working and error independently for both providers", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-stock-status-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const path = join(directory, "stock.json");
  const store = new StockStore(path, testCodec);

  let settings = await store.publicSettings();
  assert.equal(settings.providers.pexels.state, "not_configured");
  assert.equal(settings.providers.pixabay.state, "not_configured");

  settings = await store.save({ pexelsApiKey: "pexels-secret" });
  assert.equal(settings.pexelsConfigured, true);
  assert.equal(settings.providers.pexels.state, "saved", "наличие ключа ещё не означает рабочее соединение");
  settings = await store.recordTest("pexels", { ok: true, message: "Pexels подключён" }, "2026-09-01T10:00:00.000Z");
  assert.equal(settings.providers.pexels.state, "working");
  assert.equal(settings.providers.pexels.checkedAt, "2026-09-01T10:00:00.000Z");

  settings = await store.save({ pixabayApiKey: "pixabay-secret" });
  assert.equal(settings.providers.pexels.state, "working", "добавление второго ключа не сбрасывает проверку первого");
  assert.equal(settings.providers.pixabay.state, "saved");
  settings = await store.recordTest(
    "pixabay",
    { ok: false, message: "Pixabay rejected key=pixabay-secret Authorization: pixabay-secret" },
    "2026-09-01T10:05:00.000Z"
  );
  assert.equal(settings.providers.pexels.state, "working");
  assert.equal(settings.providers.pixabay.state, "error");
  assert.ok(!settings.providers.pixabay.message?.includes("pixabay-secret"));

  settings = await store.save({ pexelsApiKey: "pexels-replacement" });
  assert.equal(settings.providers.pexels.state, "saved", "замена ключа требует новой проверки");
  assert.equal(settings.providers.pixabay.state, "error", "статусы провайдеров независимы");
  settings = await store.clearKey("pixabay");
  assert.equal(settings.providers.pixabay.state, "not_configured");
  assert.equal(settings.pixabayConfigured, false);

  await store.save({ pexelsApiKey: "pexels-concurrent", pixabayApiKey: "pixabay-concurrent" });
  await Promise.all([
    store.recordTest("pexels", { ok: true, message: "Pexels подключён" }, "2026-09-01T10:10:00.000Z"),
    store.recordTest("pixabay", { ok: true, message: "Pixabay подключён" }, "2026-09-01T10:10:01.000Z"),
  ]);
  settings = await store.publicSettings();
  assert.equal(settings.providers.pexels.state, "working", "параллельные проверки не затирают Pexels");
  assert.equal(settings.providers.pixabay.state, "working", "параллельные проверки не затирают Pixabay");

  settings = await store.save({
    pexelsProxyUrl: "socks5://pexels-proxy-user:pexels-proxy-pass@127.0.0.1:3101",
    pixabayProxyUrl: "http://pixabay-proxy-user:pixabay-proxy-pass@127.0.0.1:4101",
  });
  assert.equal(settings.providers.pexels.proxyConfigured, true);
  assert.equal(settings.providers.pexels.proxyDisplayName, "socks5://127.0.0.1:3101");
  assert.equal(settings.providers.pixabay.proxyConfigured, true);
  assert.equal(settings.providers.pixabay.proxyDisplayName, "http://127.0.0.1:4101");
  assert.equal(await store.proxyUrl("pexels"), "socks5://pexels-proxy-user:pexels-proxy-pass@127.0.0.1:3101");
  settings = await store.save({ clearPexelsProxy: true });
  assert.equal(settings.providers.pexels.proxyConfigured, false);
  assert.equal(settings.providers.pixabay.proxyConfigured, true, "proxy другого стока не удаляется");

  const storedFile = await readFile(path, "utf8");
  assert.ok(!storedFile.includes("pexels-secret"));
  assert.ok(!storedFile.includes("pixabay-secret"));
  assert.ok(!storedFile.includes("pexels-replacement"));
  assert.ok(!storedFile.includes("pexels-concurrent"));
  assert.ok(!storedFile.includes("pixabay-concurrent"));
  assert.ok(!storedFile.includes("pixabay-proxy-user"));
  assert.ok(!storedFile.includes("pixabay-proxy-pass"));
});

test("stock search normalizes query, pagination and orientation", () => {
  assert.deepEqual(normalizeStockSearchInput({
    provider: "pexels",
    mediaType: "image",
    query: "  red   cat  ",
    page: -4,
    perPage: 999,
    orientation: "portrait"
  }), {
    provider: "pexels",
    mediaType: "image",
    query: "red cat",
    page: 1,
    perPage: 80,
    orientation: "portrait"
  });
  assert.throws(() => normalizeStockSearchInput({ provider: "pixabay", mediaType: "video", query: " " }), /двух символов/);
  assert.throws(
    () => normalizeStockSearchInput({ provider: "pixabay", mediaType: "image", query: "x".repeat(101) }),
    /максимум 100/
  );
});

test("Pexels photo search authenticates with Authorization header and normalizes results", async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: new URL(String(input)), init });
    return new Response(JSON.stringify({
      page: 1,
      per_page: 3,
      total_results: 4,
      photos: [{
        id: 42,
        width: 4000,
        height: 3000,
        url: "https://www.pexels.com/photo/red-cat-42/",
        alt: "Red cat sitting on a sofa",
        photographer: "Alice",
        photographer_url: "https://www.pexels.com/@alice/",
        src: {
          medium: "https://images.pexels.com/photos/42/medium.jpeg",
          original: "https://images.pexels.com/photos/42/original.jpeg"
        }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new StockClient(new StubKeys({ pexels: "pexels-secret" }), fetcher);
  const input = { provider: "pexels" as const, mediaType: "image" as const, query: "red cat", page: 1, perPage: 3 };
  const first = await client.search(input);
  const second = await client.search(input);

  assert.equal(calls.length, 1, "одинаковый поиск берётся из 24-часового кэша");
  assert.equal(new Headers(calls[0]?.init?.headers).get("Authorization"), "pexels-secret");
  assert.equal(calls[0]?.url.searchParams.has("key"), false, "ключ Pexels не попадает в URL");
  assert.equal(calls[0]?.url.pathname, "/v1/search");
  assert.equal(first.items[0]?.downloadUrl, "https://images.pexels.com/photos/42/original.jpeg");
  assert.equal(first.items[0]?.attribution, "Photo by Alice on Pexels");
  assert.equal(first.items[0]?.description, "Red cat sitting on a sofa");
  assert.equal(first.hasMore, true);
  assert.deepEqual(second, first);
});

test("Pixabay video search authenticates by key query and picks the best available file", async () => {
  let requestUrl: URL | undefined;
  const fetcher = async (input: string | URL | Request): Promise<Response> => {
    requestUrl = new URL(String(input));
    return new Response(JSON.stringify({
      total: 1,
      totalHits: 1,
      hits: [{
        id: 91,
        pageURL: "https://pixabay.com/videos/id-91/",
        user: "Bob",
        user_id: 7,
        picture_id: "123456789",
        tags: "forest, trees, nature",
        duration: 12,
        videos: {
          large: { url: "https://cdn.pixabay.com/video/large.mp4", width: 3840, height: 2160 },
          medium: { url: "https://cdn.pixabay.com/video/medium.mp4", width: 1920, height: 1080 },
          small: { url: "https://cdn.pixabay.com/video/small.mp4", width: 1280, height: 720 }
        }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new StockClient(new StubKeys({ pixabay: "pixabay-secret" }), fetcher);
  const result = await client.search({ provider: "pixabay", mediaType: "video", query: "forest", orientation: "portrait", perPage: 3 });

  assert.equal(requestUrl?.pathname, "/api/videos/");
  assert.equal(requestUrl?.searchParams.get("key"), "pixabay-secret");
  assert.equal(requestUrl?.searchParams.get("orientation"), "vertical");
  assert.equal(requestUrl?.searchParams.get("safesearch"), "true");
  assert.equal(result.items[0]?.downloadUrl, "https://cdn.pixabay.com/video/small.mp4", "4K не скачивается, когда доступен лёгкий HD");
  assert.equal(result.items[0]?.previewUrl, "https://i.vimeocdn.com/video/123456789_640x360.jpg");
  assert.equal(result.items[0]?.durationSeconds, 12);
  assert.equal(result.items[0]?.attribution, "Video by Bob on Pixabay");
  assert.deepEqual(result.items[0]?.tags, ["forest", "trees", "nature"]);
});

test("Pexels video prefers the smallest suitable HD MP4 instead of the first 4K file", async () => {
  const client = new StockClient(new StubKeys({ pexels: "pexels-secret" }), async () => new Response(JSON.stringify({
    page: 1,
    per_page: 3,
    total_results: 1,
    videos: [{
      id: 77,
      width: 3840,
      height: 2160,
      duration: 8,
      url: "https://www.pexels.com/video/example-77/",
      image: "https://images.pexels.com/videos/77/poster.jpeg",
      user: { name: "Chris", url: "https://www.pexels.com/@chris/" },
      video_files: [
        { link: "https://videos.pexels.com/video-files/77/4k.mp4", file_type: "video/mp4", width: 3840, height: 2160 },
        { link: "https://videos.pexels.com/video-files/77/full-hd.mp4", file_type: "video/mp4", width: 1920, height: 1080 },
        { link: "https://videos.pexels.com/video-files/77/hd.mp4", file_type: "video/mp4", width: 1280, height: 720 },
        { link: "https://videos.pexels.com/video-files/77/sd.mp4", file_type: "video/mp4", width: 640, height: 360 }
      ]
    }]
  }), { status: 200, headers: { "content-type": "application/json" } }));

  const result = await client.search({ provider: "pexels", mediaType: "video", query: "city", perPage: 3 });
  assert.equal(result.items[0]?.downloadUrl, "https://videos.pexels.com/video-files/77/hd.mp4");
});

test("selected Pixabay video can download its poster without API credentials", async () => {
  let requested = "";
  const client = new StockClient(new StubKeys({}), async (input) => {
    requested = String(input);
    return new Response(Uint8Array.from([0xff, 0xd8, 0xff]), { status: 200, headers: { "content-type": "image/jpeg" } });
  });
  const poster = await client.downloadPreview({
    provider: "pixabay",
    id: "91",
    mediaType: "video",
    query: "forest",
    width: 1280,
    height: 720,
    durationSeconds: 12,
    previewUrl: "https://i.vimeocdn.com/video/123456789_640x360.jpg",
    downloadUrl: "https://cdn.pixabay.com/video/small.mp4",
    pageUrl: "https://pixabay.com/videos/id-91/",
    author: "Bob",
    attribution: "Video by Bob on Pixabay"
  });
  assert.equal(requested, "https://i.vimeocdn.com/video/123456789_640x360.jpg");
  assert.equal(poster?.extension, "jpg");
  assert.equal(poster?.data.length, 3);
});

test("stock errors do not expose API keys and explain rate limits", async () => {
  let calls = 0;
  const client = new StockClient(
    new StubKeys({ pexels: "do-not-leak" }),
    async () => {
      calls += 1;
      return new Response("rate limited", { status: 429, headers: { "retry-after": "60" } });
    },
    undefined,
    Date.now,
    async () => undefined
  );
  await assert.rejects(
    client.search({ provider: "pexels", mediaType: "image", query: "nature" }),
    (error: Error) => error instanceof StockApiRateLimitError && error.retryAfterMs === 60_000
      && /лимит запросов.*60/.test(error.message) && !error.message.includes("do-not-leak")
  );
  assert.equal(calls, 1, "429 sets one shared cooldown rather than retrying every query");
  await assert.rejects(client.search({ provider: "pexels", mediaType: "video", query: "canal" }), /лимит запросов/);
  assert.equal(calls, 1, "Different scene queries respect the same provider cooldown");
});

test("stock search retries transient fetch errors and succeeds without exposing a URL key", async () => {
  let calls = 0;
  const client = new StockClient(
    new StubKeys({ pixabay: "hidden-key" }),
    async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("fetch failed for hidden-key"), { cause: { code: "ECONNRESET" } });
      return new Response(JSON.stringify({ total: 0, totalHits: 0, hits: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    undefined,
    Date.now,
    async () => undefined
  );

  const result = await client.search({ provider: "pixabay", mediaType: "image", query: "city street" });
  assert.equal(calls, 3);
  assert.deepEqual(result.items, []);
});

test("stock download retries 5xx and returns the file on the next candidate attempt", async () => {
  let calls = 0;
  const client = new StockClient(
    new StubKeys({}),
    async () => {
      calls += 1;
      if (calls < 3) return new Response("temporary", { status: 503 });
      return new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
    },
    undefined,
    Date.now,
    async () => undefined
  );

  const downloaded = await client.download(downloadableAsset());
  assert.equal(calls, 3);
  assert.equal(downloaded.extension, "mp4");
  assert.deepEqual([...downloaded.data], [1, 2, 3]);
});

test("CDN authorization errors are not mislabeled as an invalid API key", async () => {
  const client = new StockClient(new StubKeys({}), async () => new Response("forbidden", { status: 403 }));
  await assert.rejects(
    client.download(downloadableAsset("pexels")),
    (error: Error) => /CDN отказал/.test(error.message)
      && /host=videos\.pexels\.com, status=403/.test(error.message)
      && !/ключ недействителен/i.test(error.message)
  );
});

test("API authorization errors still explain the key problem with safe diagnostics", async () => {
  const client = new StockClient(new StubKeys({ pexels: "never-print-me" }), async () => new Response("forbidden", { status: 403 }));
  await assert.rejects(
    client.search({ provider: "pexels", mediaType: "image", query: "night city" }),
    (error: Error) => /API-ключ недействителен/.test(error.message)
      && /host=api\.pexels\.com, status=403/.test(error.message)
      && !error.message.includes("never-print-me")
  );
});

test("final fetch failure keeps only safe host and cause code", async () => {
  const client = new StockClient(
    new StubKeys({}),
    async () => { throw Object.assign(new Error("secret signed URL failed"), { cause: { code: "ETIMEDOUT" } }); },
    undefined,
    Date.now,
    async () => undefined
  );
  await assert.rejects(
    client.download(downloadableAsset("pixabay")),
    (error: Error) => /host=videos\.pixabay\.com, code=ETIMEDOUT/.test(error.message)
      && !error.message.includes("secret signed URL")
  );
});
