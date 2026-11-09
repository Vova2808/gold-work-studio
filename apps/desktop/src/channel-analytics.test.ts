import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ChannelAnalyticsStore, normalizeTrackedChannelUrl } from "./channel-analytics-store.js";
import { YouTubeClient } from "./youtube-client.js";
import type { YouTubeStore } from "./youtube-store.js";

const channelId = "UCabcdefghijklmnopqrstuv";
const stats = { channelId, title: "Public title", views: 1200, subscribers: 300, videos: 4 };
const day = 86_400_000;

test("tracking accepts channel URLs, strips suffixes, rejects videos/credentials/foreign origins", () => {
  assert.equal(normalizeTrackedChannelUrl("@Example"), "https://www.youtube.com/@Example");
  assert.equal(normalizeTrackedChannelUrl("youtube.com/@Example/videos?view=0"), "https://www.youtube.com/@Example");
  assert.equal(normalizeTrackedChannelUrl(channelId), `https://www.youtube.com/channel/${channelId}`);
  for (const url of ["https://evil.test/@Example", "https://youtube.com/watch?v=abc", "https://youtube.com/c/old", "https://secret@youtube.com/@abc", "ftp://youtube.com/@abc"]) {
    assert.throws(() => normalizeTrackedChannelUrl(url));
  }
});

test("local tracking persists names/groups, throttles requests, records real deltas and expires old snapshots", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "gws-analytics-test-")), "stats.json");
  let clock = Date.UTC(2026, 8, 11), calls = 0;
  const store = new ChannelAnalyticsStore(path, async () => ({ ...stats, views: 1200 + calls++ * 40 }), () => clock);
  const [c] = await store.save({ url: "@Example", name: "Мой канал", group: "Истории" });
  assert.equal(c!.snapshots.length, 0);
  assert.equal((await store.refresh())[0]!.snapshots[0]!.views, 1200);
  await store.refresh(); assert.equal(calls, 1);
  clock += 6 * 3_600_000;
  assert.equal((await store.refresh({ automatic: true }))[0]!.snapshots[1]!.views, 1240);
  const reopened = new ChannelAnalyticsStore(path, async () => stats, () => clock);
  assert.equal((await reopened.list())[0]!.group, "Истории");
  await reopened.save({ id: c!.id, url: "@Example", name: "Новое имя", group: "EN" });
  assert.equal((await reopened.list())[0]!.snapshots.length, 2);
  assert.throws(() => reopened.save({ id: c!.id, url: "@Example", name: "" }));
  await assert.rejects(reopened.save({ id: c!.id, url: "@Other", name: "Другой" }), /отдельный канал/);
  await assert.rejects(reopened.save({ url: "https://youtube.com/@Example/videos", name: "Дубль" }), /уже добавлен/);
  clock += 31 * day;
  assert.equal((await reopened.list())[0]!.snapshots.length, 0);
  assert.equal(JSON.parse(await readFile(path, "utf8")).channels[0].snapshots.length, 0);
});

test("provider failure preserves samples; hidden/missing counters are null and negative net growth is retained", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "gws-analytics-failure-")), "stats.json");
  let clock = Date.UTC(2026, 8, 11), fail = false;
  let result = { ...stats, subscribers: null as number | null };
  const store = new ChannelAnalyticsStore(path, async () => { if (fail) throw new Error("YouTube API: quotaExceeded"); return result; }, () => clock);
  await store.save({ url: "@example", name: "A" });
  await store.refresh(); clock += day; fail = true;
  let rows = await store.refresh();
  assert.equal(rows[0]!.snapshots.length, 1); assert.match(rows[0]!.lastError!, /quotaExceeded/);
  assert.equal(rows[0]!.snapshots[0]!.subscribers, null);
  clock += day; fail = false; result = { ...result, views: 1000 };
  rows = await store.refresh();
  assert.equal(rows[0]!.lastError, undefined);
  assert.equal(rows[0]!.snapshots[1]!.views! - rows[0]!.snapshots[0]!.views!, -200);
});

test("overlapping refresh shares requests; deletion during network request does not resurrect channel", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "gws-analytics-race-")), "stats.json");
  let resolve!: (value: typeof stats) => void, started!: () => void, calls = 0;
  const waitStarted = new Promise<void>(r => { started = r; });
  const store = new ChannelAnalyticsStore(path, () => { calls++; started(); return new Promise(r => { resolve = r; }); });
  const [c] = await store.save({ url: "@example", name: "A" });
  const first = store.refresh();
  const second = store.refresh();
  assert.equal(first, second);
  await waitStarted;
  await store.remove(c!.id);
  resolve(stats);
  assert.deepEqual(await first, []); assert.equal(calls, 1);
  assert.deepEqual(await store.list(), []);
});

test("corrupt storage is never replaced with an empty database; resolved aliases do not double-count", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "gws-analytics-format-")), "stats.json");
  const store = new ChannelAnalyticsStore(path, async () => stats);
  await store.save({ url: "@first", name: "First" });
  await store.save({ url: `https://youtube.com/channel/${channelId}`, name: "Duplicate" });
  const rows = await store.refresh();
  assert.equal(rows.filter(c => c.snapshots.length).length, 1);
  assert.match(rows.find(c => c.lastError)!.lastError!, /другой ссылкой/);
  await writeFile(path, "{corrupted");
  await assert.rejects(store.save({ url: "@third", name: "Third" }));
  assert.equal(await readFile(path, "utf8"), "{corrupted");
});

test("public YouTube collector requests only counters, keeps hidden subscribers unknown and exposes API errors", async () => {
  const oldFetch = globalThis.fetch;
  const requests: URL[] = [];
  const client = new YouTubeClient({ apiKey: async () => "test-only-key" } as YouTubeStore, async () => { throw new Error("AI must not run"); });
  try {
    globalThis.fetch = async input => {
      requests.push(new URL(String(input)));
      return Response.json({ items: [{ id: channelId, snippet: { title: "Example" }, statistics: { hiddenSubscriberCount: true, subscriberCount: "100", viewCount: "1500", videoCount: "2" } }] });
    };
    const result = await client.publicChannelStats({ kind: "handle", value: "@example" });
    assert.equal(result.views, 1500); assert.equal(result.subscribers, null);
    assert.equal(requests.length, 1); assert.equal(requests[0]!.searchParams.get("part"), "snippet,statistics");
    assert.equal(requests[0]!.searchParams.get("forHandle"), "@example");
    globalThis.fetch = async () => Response.json({ error: { message: "Quota exhausted", errors: [{ reason: "quotaExceeded" }] } }, { status: 403 });
    await assert.rejects(client.publicChannelStats({ kind: "id", value: channelId }), /quotaExceeded/);
  } finally { globalThis.fetch = oldFetch; }
});
