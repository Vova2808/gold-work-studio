import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { createDefaultProjectSettings, type Project, type Scene, type StockAsset, type StockProvider, type StockSearchInput, type StockSettings } from "@gold-work/shared";
import { LocalProjectStorage } from "./local-project-storage.js";
import {
  autoStockAssetRelevance,
  autoStockMotionScore,
  buildAutoStockQueries,
  buildAutoStockIntent,
  desiredAutoStockVideoCount,
  planAutoStockMediaTypes,
  preferredAutoStockMediaType,
  StockProjectService
} from "./stock-project-service.js";

function scene(order: number, overrides: Partial<Scene> = {}): Scene {
  return {
    id: `scene-${order}`,
    order,
    title: `Evidence room ${order + 1}`,
    narration: `Detectives inspect evidence in room number ${order + 1}.`,
    imagePrompt: `Police detectives inspect evidence in a dark city office, moment ${order + 1}. Cinematic light, no text.`,
    animationPrompt: "Slow camera movement",
    durationSeconds: 7,
    status: "draft",
    ...overrides
  };
}

function project(scenes: Scene[], stockVideoPercent = 35): Project {
  const settings = createDefaultProjectSettings();
  settings.stockVideoPercent = stockVideoPercent;
  return {
    id: "project-stock-auto",
    title: "Night investigation",
    topic: "Police investigate a mysterious crime in the city",
    aspectRatio: "16:9",
    language: "English",
    mode: "standard",
    status: "ready",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    mediaMode: "stock",
    scenes,
    settings
  };
}

function asset(provider: StockProvider, mediaType: "image" | "video", id: string, query: string): StockAsset {
  const extension = mediaType === "image" ? "jpg" : "mp4";
  return {
    provider,
    mediaType,
    id,
    query,
    width: 1920,
    height: 1080,
    durationSeconds: mediaType === "video" ? 12 : undefined,
    previewUrl: `https://images.${provider}.com/${id}.jpg`,
    downloadUrl: `https://cdn.${provider}.com/${id}.${extension}`,
    pageUrl: `https://www.${provider}.com/${mediaType}/${id}/`,
    description: query,
    author: "Test author",
    attribution: `Test asset ${id}`
  };
}

const connectedSettings = {
  async publicSettings() {
    return {
      pexelsConfigured: true,
      pixabayConfigured: true,
      providers: {
        pexels: { provider: "pexels" as const, configured: true, state: "working" as const },
        pixabay: { provider: "pixabay" as const, configured: true, state: "working" as const }
      }
    };
  }
};

async function harness(scenes: Scene[], stock: {
  search(input: StockSearchInput, bypassCache?: boolean): Promise<{ items: StockAsset[]; total: number; page: number; perPage: number; hasMore: boolean }>;
  download(asset: StockAsset): Promise<{ data: Buffer; extension: string; contentType: string }>;
  downloadPreview(asset: StockAsset): Promise<{ data: Buffer; extension: string; contentType: string } | undefined>;
}, settings: { publicSettings(): Promise<StockSettings> } = connectedSettings, stockVideoPercent = 35, montageEnabled = true) {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-auto-stock-"));
  const repository = new MemoryProjectRepository();
  const savedProject = project(scenes, stockVideoPercent);
  savedProject.settings.assembly.montage = {
    ...(savedProject.settings.assembly.montage ?? {
      planner: "local",
      density: "balanced",
      graphicBeatPercent: 28,
      hardCutPercent: 78
    }),
    enabled: montageEnabled
  };
  await repository.save(savedProject);
  const projects = new ProjectService(repository, new MockDirectorProvider());
  const storage = new LocalProjectStorage(directory);
  const progress: Array<{ phase: string; completed: number; total: number }> = [];
  const service = new StockProjectService(projects, storage, stock, settings, (event) => progress.push(event));
  return { directory, projects, service, progress };
}

test("legacy scenes remain valid and alternate storage never overwrites primary files", async (context) => {
  const legacyScene = JSON.parse(JSON.stringify(scene(0))) as Scene;
  assert.equal(legacyScene.stockAlternates, undefined);
  const directory = await mkdtemp(join(tmpdir(), "gold-work-stock-slots-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storage = new LocalProjectStorage(directory);
  const targetProject = project([legacyScene]);
  const source = {
    provider: "pexels" as const,
    assetId: "primary",
    mediaType: "image" as const,
    query: "police evidence",
    pageUrl: "https://www.pexels.com/photo/primary/",
    author: "Test author",
    attribution: "Primary",
    licenseUrl: "https://www.pexels.com/license/",
    downloadedAt: "2026-01-01T00:00:00.000Z"
  };
  const primaryPath = await storage.saveStockAsset(targetProject, legacyScene, "image", Buffer.from("primary"), "jpg", source);
  const alternateSource = { ...source, assetId: "alternate", attribution: "Alternate" };
  const alternatePath = await storage.saveStockAsset(
    targetProject,
    legacyScene,
    "image",
    Buffer.from("alternate"),
    "jpg",
    alternateSource,
    { alternateIndex: 0 }
  );
  assert.notEqual(primaryPath, alternatePath);
  assert.match(primaryPath, /stock-image\.jpg$/);
  assert.match(alternatePath, /stock-alt-01-image\.jpg$/);
  assert.equal((await readFile(primaryPath)).toString(), "primary");
  assert.equal((await readFile(alternatePath)).toString(), "alternate");
  const sidecar = JSON.parse(await readFile(join(storage.sceneDirectory(targetProject, legacyScene), "stock-alt-01-source.json"), "utf8")) as { assetId?: string };
  assert.equal(sidecar.assetId, "alternate");
});

test("quality montage stores exactly one distinct alternate from the same search result", async (context) => {
  const run = async (montageEnabled: boolean) => {
    let searches = 0;
    const downloads: string[] = [];
    const stock = {
      async search(input: StockSearchInput) {
        searches += 1;
        const items = ["primary", "alternate", "unused-third"].map((id) => ({
          ...asset(input.provider, input.mediaType, id, input.query),
          description: "Police detectives inspecting evidence in an office"
        }));
        return { items, total: items.length, page: 1, perPage: input.perPage ?? 0, hasMore: false };
      },
      async download(candidate: StockAsset) {
        downloads.push(candidate.id);
        return { data: Buffer.from(candidate.id), extension: "mp4", contentType: "video/mp4" };
      },
      async downloadPreview() { return undefined; }
    };
    const target = scene(0, {
      stockQuery: "police evidence inspection",
      imagePrompt: "Police detectives inspecting evidence in an office",
      animationPrompt: "Detectives keep inspecting the evidence"
    });
    const setup = await harness([target], stock, connectedSettings, 100, montageEnabled);
    context.after(() => rm(setup.directory, { recursive: true, force: true }));
    const result = await setup.service.autoSelect("project-stock-auto");
    return { result, searches, downloads };
  };

  const montage = await run(true);
  assert.equal(montage.result.failed, 0);
  assert.equal(montage.searches, 1, "alternate must not trigger another provider search");
  assert.deepEqual(montage.downloads, ["primary", "alternate"]);
  assert.equal(montage.result.project.scenes[0]?.stockAlternates?.length, 1);
  assert.equal(montage.result.project.scenes[0]?.stockAlternates?.[0]?.stockSource.assetId, "alternate");
  assert.notEqual(
    montage.result.project.scenes[0]?.stockSource?.assetId,
    montage.result.project.scenes[0]?.stockAlternates?.[0]?.stockSource.assetId
  );

  const slideshow = await run(false);
  assert.equal(slideshow.result.failed, 0);
  assert.equal(slideshow.searches, 1);
  assert.deepEqual(slideshow.downloads, ["primary"]);
  assert.equal(slideshow.result.project.scenes[0]?.stockAlternates, undefined);
});

test("alternate download failure is nonfatal and manual apply clears old alternates", async (context) => {
  const logs: string[] = [];
  const stock = {
    async search(input: StockSearchInput) {
      const items = ["primary", "broken-alternate"].map((id) => ({
        ...asset(input.provider, input.mediaType, id, input.query),
        description: "Police detectives inspecting evidence in an office"
      }));
      return { items, total: items.length, page: 1, perPage: input.perPage ?? 0, hasMore: false };
    },
    async download(candidate: StockAsset) {
      if (candidate.id === "broken-alternate") throw new Error("alternate CDN failed");
      return { data: Buffer.from(candidate.id), extension: "mp4", contentType: "video/mp4" };
    },
    async downloadPreview() { return undefined; }
  };
  const target = scene(0, {
    stockQuery: "police evidence inspection",
    imagePrompt: "Police detectives inspecting evidence in an office",
    animationPrompt: "Detectives keep inspecting the evidence"
  });
  const setup = await harness([target], stock, connectedSettings, 100, true);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));
  const service = new StockProjectService(
    setup.projects,
    new LocalProjectStorage(setup.directory),
    stock,
    connectedSettings,
    () => undefined,
    (_level, event) => logs.push(event)
  );
  const result = await service.autoSelect("project-stock-auto");
  assert.equal(result.selected, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.project.scenes[0]?.stockSource?.assetId, "primary");
  assert.equal(result.project.scenes[0]?.stockAlternates, undefined);
  assert.ok(logs.includes("stock.auto.alternate_failed"));

  await setup.projects.update("project-stock-auto", {
    scenes: result.project.scenes.map((item) => ({
      ...item,
      stockAlternates: [{
        videoPath: "C:\\stale-alt.mp4",
        stockSource: { ...item.stockSource!, assetId: "stale-alternate" }
      }]
    }))
  });
  const manual = asset("pexels", "video", "manual-primary", "police evidence inspection");
  manual.description = "Police detectives inspecting evidence in an office";
  const manuallyUpdated = await service.applyAsset("project-stock-auto", target.id, manual);
  assert.equal(manuallyUpdated.scenes[0]?.stockSource?.assetId, "manual-primary");
  assert.equal(manuallyUpdated.scenes[0]?.stockAlternates, undefined);
});

test("auto stock keeps usable manual material, repairs broken stock and excludes duplicate assets", async (context) => {
  const manualPath = join(await mkdtemp(join(tmpdir(), "gold-work-manual-stock-")), "manual.jpg");
  context.after(() => rm(join(manualPath, ".."), { recursive: true, force: true }));
  await writeFile(manualPath, Buffer.from("manual"));
  const manualSource = {
    provider: "pexels" as const,
    assetId: "manual",
    mediaType: "image" as const,
    query: "manual",
    pageUrl: "https://www.pexels.com/photo/manual/",
    author: "Manual author",
    attribution: "Manual",
    licenseUrl: "https://www.pexels.com/license/",
    downloadedAt: "2026-01-01T00:00:00.000Z"
  };
  const brokenSource = { ...manualSource, provider: "pixabay" as const, assetId: "broken", pageUrl: "https://pixabay.com/photos/broken/" };
  const searches: StockSearchInput[] = [];
  const stock = {
    async search(input: StockSearchInput) {
      searches.push(input);
      const uniqueId = `${input.mediaType}-${searches.length}`;
      return {
        items: [asset(input.provider, input.mediaType, "shared", input.query), asset(input.provider, input.mediaType, uniqueId, input.query)],
        total: 2,
        page: 1,
        perPage: 18,
        hasMore: false
      };
    },
    async download(candidate: StockAsset) {
      return { data: Buffer.from(candidate.id), extension: candidate.mediaType === "image" ? "jpg" : "mp4", contentType: candidate.mediaType === "image" ? "image/jpeg" : "video/mp4" };
    },
    async downloadPreview() { return undefined; }
  };
  const setup = await harness([
    scene(0, { imagePath: manualPath, stockSource: manualSource }),
    scene(1),
    scene(2, { imagePath: join(manualPath, "missing.jpg"), stockSource: brokenSource }),
    scene(3, { includeInAssembly: false })
  ], stock);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));

  const result = await setup.service.autoSelect("project-stock-auto");
  assert.equal(result.total, 3);
  assert.equal(result.skipped, 1);
  assert.equal(result.selected, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.project.scenes[0]?.stockSource?.assetId, "manual");
  assert.equal(result.project.scenes[0]?.imagePath, manualPath);
  assert.notEqual(result.project.scenes[2]?.stockSource?.assetId, "broken");
  assert.equal(result.project.scenes[3]?.stockSource, undefined);
  const selectedIds = result.project.scenes.slice(1, 3).map((item) => `${item.stockSource?.provider}:${item.stockSource?.assetId}`);
  assert.equal(new Set(selectedIds).size, selectedIds.length);
  assert.deepEqual(
    result.project.scenes.slice(1, 3).map((item) => item.stockSource?.mediaType).sort(),
    ["image", "video"]
  );
  assert.equal(setup.progress.at(-1)?.phase, "complete");
  assert.equal(setup.progress.at(-1)?.completed, 3);
});

test("auto stock preserves successful scenes after a partial error and safely resumes", async (context) => {
  let failSearches = false;
  let successfulDownloads = 0;
  const stock = {
    async search(input: StockSearchInput) {
      if (failSearches) throw new Error("provider temporarily unavailable");
      return { items: [asset(input.provider, input.mediaType, `asset-${successfulDownloads + 1}`, input.query)], total: 1, page: 1, perPage: 18, hasMore: false };
    },
    async download(candidate: StockAsset) {
      successfulDownloads += 1;
      if (successfulDownloads === 1) failSearches = true;
      return { data: Buffer.from(candidate.id), extension: candidate.mediaType === "image" ? "jpg" : "mp4", contentType: candidate.mediaType === "image" ? "image/jpeg" : "video/mp4" };
    },
    async downloadPreview() { return undefined; }
  };
  const setup = await harness([scene(0), scene(1)], stock);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));

  const first = await setup.service.autoSelect("project-stock-auto");
  assert.equal(first.selected, 1);
  assert.equal(first.failed, 1);
  assert.ok(first.project.scenes[0]?.stockSource);
  assert.equal(first.project.scenes[1]?.stockSource, undefined);

  failSearches = false;
  const second = await setup.service.autoSelect("project-stock-auto");
  assert.equal(second.skipped, 1);
  assert.equal(second.selected, 1);
  assert.equal(second.failed, 0);
  assert.ok(second.project.scenes[0]?.stockSource);
  assert.ok(second.project.scenes[1]?.stockSource);
});

test("auto stock may fall back from unavailable video to a relevant photo at an intermediate percentage", async (context) => {
  const searches: StockSearchInput[] = [];
  const stock = {
    async search(input: StockSearchInput) {
      searches.push(input);
      if (input.provider === "pexels") throw new Error("Pexels is down");
      if (input.mediaType === "video") return { items: [], total: 0, page: 1, perPage: 18, hasMore: false };
      return { items: [asset("pixabay", "image", "fallback-image", input.query)], total: 1, page: 1, perPage: 18, hasMore: false };
    },
    async download(candidate: StockAsset) { return { data: Buffer.from(candidate.id), extension: "jpg", contentType: "image/jpeg" }; },
    async downloadPreview() { return undefined; }
  };
  const setup = await harness([scene(0, {
    title: "Police arrive",
    narration: "A police car arrives at the motel.",
    imagePrompt: "Police car arriving at roadside motel at night.",
    animationPrompt: "Police car driving with flashing lights"
  })], stock, connectedSettings, 75);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));

  const result = await setup.service.autoSelect("project-stock-auto");
  assert.equal(result.failed, 0);
  assert.equal(result.project.scenes[0]?.stockSource?.provider, "pixabay");
  assert.equal(result.project.scenes[0]?.stockSource?.mediaType, "image");
  assert.ok(searches.some((item) => item.provider === "pexels"));
  assert.ok(searches.some((item) => item.mediaType === "video"));
  assert.ok(searches.some((item) => item.mediaType === "image"));
});

test("one hundred percent video is strict and never counts a photo fallback as success", async (context) => {
  const searches: StockSearchInput[] = [];
  let downloads = 0;
  const stock = {
    async search(input: StockSearchInput) {
      searches.push(input);
      return input.mediaType === "video"
        ? { items: [], total: 0, page: 1, perPage: 18, hasMore: false }
        : { items: [asset(input.provider, "image", "should-not-be-used", input.query)], total: 1, page: 1, perPage: 18, hasMore: false };
    },
    async download(candidate: StockAsset) {
      downloads += 1;
      return { data: Buffer.from(candidate.id), extension: "jpg", contentType: "image/jpeg" };
    },
    async downloadPreview() { return undefined; }
  };
  const setup = await harness([scene(0, {
    stockQuery: "police car driving",
    imagePrompt: "Police car driving through city street",
    animationPrompt: "Police car keeps driving"
  })], stock, connectedSettings, 100);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));

  const result = await setup.service.autoSelect("project-stock-auto");
  assert.equal(result.failed, 1);
  assert.equal(result.selected, 0);
  assert.equal(downloads, 0);
  assert.ok(searches.length > 0);
  assert.ok(searches.every((search) => search.mediaType === "video"));
  assert.equal(result.project.scenes[0]?.stockSource, undefined);
});

test("strict video mode replaces an existing ready photo instead of skipping it", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-wrong-stock-type-"));
  const photoPath = join(directory, "old-photo.jpg");
  await writeFile(photoPath, Buffer.from("photo"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const photoSource = {
    provider: "pexels" as const,
    assetId: "old-photo",
    mediaType: "image" as const,
    query: "police car",
    pageUrl: "https://www.pexels.com/photo/old-photo/",
    author: "Test author",
    attribution: "Old photo",
    licenseUrl: "https://www.pexels.com/license/",
    downloadedAt: "2026-01-01T00:00:00.000Z"
  };
  const stock = {
    async search(input: StockSearchInput) {
      return {
        items: input.mediaType === "video" ? [asset(input.provider, "video", "new-video", input.query)] : [],
        total: 1,
        page: 1,
        perPage: 18,
        hasMore: false
      };
    },
    async download(candidate: StockAsset) { return { data: Buffer.from(candidate.id), extension: "mp4", contentType: "video/mp4" }; },
    async downloadPreview() { return undefined; }
  };
  const setup = await harness([scene(0, {
    imagePath: photoPath,
    stockSource: photoSource,
    stockQuery: "police car driving",
    imagePrompt: "Police car driving through city",
    animationPrompt: "Police car keeps moving"
  })], stock, connectedSettings, 100);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));

  const result = await setup.service.autoSelect("project-stock-auto");
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.selected, 1);
  assert.equal(result.project.scenes[0]?.stockSource?.mediaType, "video");
  assert.ok(result.project.scenes[0]?.videoPath);
});

test("auto stock builds short concrete queries instead of sending a generation prompt", () => {
  const targetScene = scene(0, {
    title: "Мокрые следы в номере",
    narration: "Мокрые следы пересекали номер мотеля и заканчивались у закрытого окна.",
    imagePrompt: "Cinematic photorealistic close-up shot of wet footprints across a motel room floor leading toward a locked window, dramatic lighting, no text or watermark."
  });
  const target = project([targetScene]);
  const queries = buildAutoStockQueries(target, targetScene);
  assert.ok(queries.length >= 3);
  assert.equal(queries[0], "wet footprints motel room floor locked");
  assert.ok(queries.every((query) => query.length >= 2 && query.length <= 72));
  assert.ok(queries.every((query) => query.split(/\s+/).length <= 6));
  assert.ok(queries.every((query) => !/cinematic|photorealistic|lighting|watermark|documentary people/i.test(query)));
  assert.equal(new Set(queries.map((query) => query.toLowerCase())).size, queries.length);
});

test("auto stock uses a dedicated stockQuery before imagePrompt", () => {
  const targetScene = scene(0, {
    stockQuery: "wet footprints motel room",
    imagePrompt: "Highly cinematic close-up with complex composition and dramatic lighting"
  });
  const queries = buildAutoStockQueries(project([targetScene]), targetScene);
  assert.deepEqual(queries.slice(0, 5), ["wet footprints motel room", "wet footprints", "footprints", "inspect footprints", "motel room"]);
});

test("auto stock splits an overloaded object query into a visible video-search cascade", () => {
  const targetScene = scene(0, {
    stockQuery: "cleaning cart key card",
    title: "Тележка в коридоре",
    narration: "A worker pushed the cleaning cart along the hotel corridor.",
    imagePrompt: "A cleaning cart beside a hotel key card in a hotel corridor",
    animationPrompt: "Worker pushing the cart through the corridor"
  });
  const queries = buildAutoStockQueries(project([targetScene]), targetScene);
  assert.deepEqual(queries.slice(0, 5), ["cleaning cart key card", "cleaning cart", "cart", "pushing cart", "hotel corridor"]);
  assert.ok(queries.includes("cleaning cart key card"));
});

test("auto stock tries provider-friendly hotel inspection phrases before broad B-roll", () => {
  const targetScene = scene(0, {
    stockQuery: "hotel bed inspection",
    title: "Проверка номера",
    narration: "A supervisor checks the bed and room with a tablet.",
    imagePrompt: "Supervisor checking a freshly made hotel bed in a clean room",
    animationPrompt: "Slow pan following the inspection"
  });
  const queries = buildAutoStockQueries(project([targetScene]), targetScene);
  assert.deepEqual(queries.slice(0, 5), [
    "hotel bed inspection",
    "hotel housekeeping bed inspection",
    "hotel supervisor checking bed",
    "bed inspection",
    "inspection",
  ]);
  assert.ok(queries.includes("hotel room"));
  assert.ok(queries.includes("hotel room cleaning"));
});

test("hotel housekeeping queries get precise contributor-vocabulary variants", () => {
  const cases: Array<{ stockQuery: string; expected: string[] }> = [
    {
      stockQuery: "housekeeping cart hotel",
      expected: ["hotel housekeeping cart", "hotel cleaning trolley"]
    },
    {
      stockQuery: "hotel cleaning supplies",
      expected: ["hotel housekeeping supplies", "hotel cleaning equipment"]
    },
    {
      stockQuery: "hotel keycard door",
      expected: ["hotel key card door", "hotel access card door"]
    }
  ];
  for (const candidate of cases) {
    const target = scene(0, { stockQuery: candidate.stockQuery });
    const queries = buildAutoStockQueries(project([target]), target);
    assert.equal(queries[0], candidate.stockQuery);
    assert.deepEqual(queries.slice(1, 3), candidate.expected);
  }
});

test("scene intent survives broad queries and preserves compound subject synonyms", () => {
  const target = scene(0, { stockQuery: "cleaning cart key card" });
  const intent = buildAutoStockIntent(target);
  const trolley = asset("pexels", "video", "trolley", "cart");
  trolley.description = "Housekeeping trolley beside a hotel corridor";
  assert.equal(autoStockAssetRelevance(trolley, intent).confident, true, "incidental key card is not required alongside the main cart");
  for (const [query, description] of [
    ["cart", "Shopping cart moving through grocery supermarket aisles"],
    ["hotel corridor", "Empty hotel corridor with carpet and room doors"],
  ]) {
    const unrelated = asset("pexels", "video", "unrelated", query!);
    unrelated.description = description;
    assert.equal(autoStockAssetRelevance(unrelated).confident, true, "retrieval query alone is too permissive");
    assert.equal(autoStockAssetRelevance(unrelated, intent).confident, false);
    assert.match(autoStockAssetRelevance(unrelated, intent).reason ?? "", /исходной сцены/);
  }
  const locationFirst = buildAutoStockIntent(scene(0, { stockQuery: "hotel room cleaning cart" }));
  assert.equal(autoStockAssetRelevance(trolley, locationFirst).confident, true);
});

test("frozen intent rejects the four unrelated clips selected in the hotel project", () => {
  const cases = [
    {
      stockQuery: "housekeeping cart hotel",
      rejected: "People relaxing in a hotel swimming pool at sunset",
      accepted: "Hotel housekeeper pushing an organized housekeeping trolley through a corridor"
    },
    {
      stockQuery: "hotel cleaning supplies",
      rejected: "Person checking canned food supplies in a cardboard box",
      accepted: "Hotel housekeeper arranging cleaning equipment and detergents"
    },
    {
      stockQuery: "hotel keycard door",
      rejected: "Person hanging a please do not disturb sign on a hotel room door",
      accepted: "Guest opening a hotel room door with an electronic key card"
    },
    {
      stockQuery: "hotel bed inspection",
      rejected: "Wide view of an empty modern hotel room interior",
      accepted: "Hotel supervisor checking and inspecting a freshly made bed"
    }
  ];
  for (const [index, candidate] of cases.entries()) {
    const intent = buildAutoStockIntent(scene(index, { stockQuery: candidate.stockQuery }));
    const rejected = { ...asset("pexels", "video", `bad-hotel-${index}`, candidate.stockQuery), description: candidate.rejected };
    const accepted = { ...asset("pexels", "video", `good-hotel-${index}`, candidate.stockQuery), description: candidate.accepted };
    assert.equal(autoStockAssetRelevance(rejected, intent).confident, false, candidate.stockQuery);
    assert.equal(autoStockAssetRelevance(accepted, intent).confident, true, candidate.stockQuery);
  }
});

test("auto stock ranks scene-detail coverage above an earlier generic match", async (context) => {
  const searches: StockSearchInput[] = [];
  const stock = {
    async search(input: StockSearchInput) {
      searches.push(input);
      const items = input.query === "housekeeping cart hotel" ? [
        { ...asset(input.provider, input.mediaType, "generic-cart", input.query), description: "Housekeeping trolley isolated in a studio" },
        { ...asset(input.provider, input.mediaType, "hotel-cart", input.query), description: "Hotel housekeeper pushing a housekeeping trolley with fresh linens through a hotel corridor" }
      ] : [];
      return { items, total: items.length, page: 1, perPage: input.perPage ?? 0, hasMore: false };
    },
    async download(candidate: StockAsset) {
      return { data: Buffer.from(candidate.id), extension: "mp4", contentType: "video/mp4" };
    },
    async downloadPreview() { return undefined; }
  };
  const target = scene(0, {
    title: "Housekeeping cart in corridor",
    stockQuery: "housekeeping cart hotel",
    imagePrompt: "Housekeeping cart filled with fresh linens and cleaning supplies in a hotel corridor",
    animationPrompt: "Slow camera move along the cart"
  });
  const setup = await harness([target], stock, connectedSettings, 100);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));

  const result = await setup.service.autoSelect("project-stock-auto");
  assert.equal(result.failed, 0);
  assert.equal(result.project.scenes[0]?.stockSource?.assetId, "hotel-cart");
  assert.equal(searches[0]?.perPage, 30, "rank a wider first-page pool without another API request");
});

test("object and action concepts stay separate and original video action survives fallback", () => {
  const intent = buildAutoStockIntent(scene(0, { stockQuery: "arriving police" }));
  const still = asset("pexels", "image", "still", "police");
  still.description = "Police officers standing outside a building";
  assert.equal(autoStockAssetRelevance({ ...still, query: "arriving police" }).confident, true, "photos need the object, not motion");
  assert.equal(autoStockAssetRelevance({ ...still, mediaType: "video" }, intent).confident, false);
  const moving = { ...still, mediaType: "video" as const, description: "Officer approaching a building" };
  const relevance = autoStockAssetRelevance(moving, intent);
  assert.equal(relevance.confident, true);
  assert.equal(relevance.matches, 1, "action matches cannot count as object matches");
  assert.equal(autoStockAssetRelevance({ ...moving, query: "walking", description: "Walking outdoors" }).confident, false);
});

test("electrical cables are allowed while cable-car footage remains a different category", () => {
  const wires = asset("pixabay", "video", "wires", "electrical cables");
  wires.description = "Electrical wiring connected to a recorder on a shelf";
  assert.equal(autoStockAssetRelevance(wires).confident, true);
  const transport = { ...wires, description: "Cable car gondola travelling above mountain cables" };
  assert.equal(autoStockAssetRelevance(transport).confident, false);
  assert.match(autoStockAssetRelevance(transport).reason ?? "", /канатная дорога/);
  assert.equal(autoStockAssetRelevance({ ...transport, query: "cable car" }).confident, true);
});

test("auto stock searches the original query then accepts a relevant broader-query synonym", async (context) => {
  const searched: string[] = [];
  const downloaded: string[] = [];
  const stock = {
    async search(input: StockSearchInput) {
      searched.push(input.query);
      const items = input.query === "cart" ? [
        { ...asset(input.provider, input.mediaType, "supermarket", input.query), description: "Shopping cart in grocery supermarket aisles" },
        { ...asset(input.provider, input.mediaType, "housekeeping", input.query), description: "Housekeeping trolley in a hotel corridor" },
      ] : [];
      return { items, total: items.length, page: 1, perPage: 18, hasMore: false };
    },
    async download(candidate: StockAsset) {
      downloaded.push(candidate.id);
      return { data: Buffer.from(candidate.id), extension: "mp4", contentType: "video/mp4" };
    },
    async downloadPreview() { return undefined; }
  };
  const target = scene(0, {
    stockQuery: "cleaning cart key card", title: "Housekeeping cart",
    imagePrompt: "A cleaning cart and key card in a hotel corridor", animationPrompt: "Worker pushing the cart",
  });
  const setup = await harness([target], stock, connectedSettings, 100);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));
  const result = await setup.service.autoSelect("project-stock-auto");
  assert.equal(result.selected, 1);
  assert.equal(result.failed, 0);
  assert.equal(searched[0], target.stockQuery);
  assert.ok(new Set(searched.slice(0, searched.indexOf("cart"))).has("cleaning cart"));
  assert.deepEqual(downloaded, ["housekeeping"]);
  assert.equal(result.project.scenes[0]?.stockSource?.query, "cart", "retain actual search provenance");
});

test("auto stock rejects generic object and location fallbacks for the original scene", async (context) => {
  const searched: string[] = [];
  let downloads = 0;
  const stock = {
    async search(input: StockSearchInput) {
      searched.push(input.query);
      const description = input.query === "cart" ? "Shopping cart moving through a grocery supermarket"
        : input.query === "hotel corridor" ? "Empty hotel corridor with room doors" : undefined;
      const items = description ? [{ ...asset(input.provider, input.mediaType, `generic-${input.query}`, input.query), description }] : [];
      return { items, total: items.length, page: 1, perPage: 18, hasMore: false };
    },
    async download() { downloads++; return { data: Buffer.from("unrelated"), extension: "mp4", contentType: "video/mp4" }; },
    async downloadPreview() { return undefined; }
  };
  const target = scene(0, {
    stockQuery: "cleaning cart key card", title: "Housekeeping cart",
    imagePrompt: "A cleaning cart and key card in a hotel corridor", animationPrompt: "Worker pushing the cart",
  });
  const setup = await harness([target], stock, connectedSettings, 100);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));
  const result = await setup.service.autoSelect("project-stock-auto");
  assert.ok(searched.includes("cart"));
  assert.ok(searched.includes("hotel corridor"), "broader retrieval remains available");
  assert.equal(result.selected, 0);
  assert.equal(result.failed, 1);
  assert.equal(downloads, 0);
  assert.equal(result.project.scenes[0]?.stockSource, undefined);
});

test("auto stock query keeps the pictured object instead of prompt framing", () => {
  const targetScene = scene(0, {
    title: "Старая фотография",
    narration: "Под кроватью нашли старую фотографию инкассаторской машины.",
    imagePrompt: "Gloved hands holding an old faded photograph of an armored money transport van with its rear door open, tight overhead close-up, cinematic cold light"
  });
  const queries = buildAutoStockQueries(project([targetScene]), targetScene);
  assert.equal(queries[0], "photograph armored money transport van rear");
  assert.doesNotMatch(queries[0] ?? "", /gloved|hands|holding|cinematic/i);
});

test("auto stock does not fall back to generic people when a scene has no searchable subject", () => {
  const empty = scene(0, { title: "Scene", narration: "Documentary story", imagePrompt: "Cinematic scene, no text" });
  assert.deepEqual(buildAutoStockQueries(project([empty]), empty), []);
});

test("auto stock never sends Cyrillic narration or title and uses deterministic visible-term translation", () => {
  const targetScene = scene(0, {
    title: "Мокрые следы в номере мотеля",
    narration: "Полицейские вошли в комнату ночью и увидели следы возле окна.",
    imagePrompt: "Мокрые следы на полу комнаты мотеля возле закрытого окна",
    stockQuery: undefined
  });
  const queries = buildAutoStockQueries(project([targetScene]), targetScene);
  assert.ok(queries.length > 0);
  assert.equal(queries[0], "wet footprints police motel room window");
  assert.ok(queries.every((query) => !/[А-Яа-яЁё]/.test(query)));
});

test("auto stock chooses video by subject motion and keeps its share near one third", () => {
  const scenes = [
    scene(0, {
      title: "Police arrive",
      narration: "A patrol car races toward the roadside motel.",
      imagePrompt: "Police car arriving at a roadside motel at night",
      animationPrompt: "Patrol car driving while emergency lights flash"
    }),
    scene(1, {
      title: "Old key",
      narration: "An old brass key rests on the table.",
      imagePrompt: "Close-up of an old brass key on a wooden table",
      animationPrompt: "Slow camera zoom"
    }),
    scene(2, {
      title: "Motel corridor",
      narration: "A detective walks through the dark motel corridor.",
      imagePrompt: "Detective walking through an empty motel corridor",
      animationPrompt: "Detective keeps walking, tracking camera"
    }),
    scene(3, {
      title: "Documents",
      narration: "The documents reveal the old robbery.",
      imagePrompt: "Old documents and a printed photograph on a desk",
      animationPrompt: "Static overhead view"
    }),
    scene(4, {
      title: "Running shower",
      narration: "Water is still flowing in the empty bathroom.",
      imagePrompt: "Running shower with flowing water in an empty motel bathroom",
      animationPrompt: "Water continues pouring"
    }),
    scene(5, {
      title: "Empty room",
      narration: "The motel room is empty.",
      imagePrompt: "Empty roadside motel room at night",
      animationPrompt: "Slow camera push in"
    })
  ];
  const types = planAutoStockMediaTypes(scenes);
  assert.equal(types.filter((type) => type === "video").length, 2);
  assert.equal(types[0], "video");
  assert.equal(types[1], "image");
  assert.equal(types[3], "image");
  assert.ok(autoStockMotionScore(scenes[4]!) > autoStockMotionScore(scenes[1]!));
  assert.equal(preferredAutoStockMediaType(scenes[4]!), "video");
  assert.equal(preferredAutoStockMediaType(scenes[1]!), "image");

  const repeated = Array.from({ length: 12 }, (_value, order) => scene(order, {
    title: `Neutral room ${order}`,
    narration: "An empty office after dark.",
    imagePrompt: "Empty office interior at night",
    animationPrompt: "Slow camera zoom"
  }));
  assert.deepEqual(planAutoStockMediaTypes(repeated), Array.from({ length: 12 }, () => "image"));

  const paced = repeated.map((item, order) => [0, 2, 7, 11].includes(order) ? {
    ...item,
    narration: "A patrol car drives through the city.",
    imagePrompt: "Police car driving through a city street at night",
    animationPrompt: "Car keeps moving with lights flashing"
  } : item);
  const fallbackTypes = planAutoStockMediaTypes(paced);
  assert.equal(fallbackTypes.filter((type) => type === "video").length, 4);
  assert.notDeepEqual(fallbackTypes, Array.from({ length: 12 }, (_value, order) => Math.abs(order) % 3 === 1 ? "video" : "image"));
});

test("stock video percentage supports literal 0 and 100 preferences", () => {
  const moving = Array.from({ length: 10 }, (_value, order) => scene(order, {
    title: `Moving patrol ${order}`,
    narration: "A police car drives toward the building.",
    imagePrompt: "Police car driving toward building",
    stockQuery: "police car driving",
    animationPrompt: "Police car keeps driving"
  }));
  assert.equal(desiredAutoStockVideoCount(moving, 0), 0);
  assert.equal(desiredAutoStockVideoCount(moving, 35), 4);
  assert.equal(desiredAutoStockVideoCount(moving, 100), 10);
  assert.deepEqual(planAutoStockMediaTypes(moving, desiredAutoStockVideoCount(moving, 0)), Array(10).fill("image"));
  assert.deepEqual(planAutoStockMediaTypes(moving, desiredAutoStockVideoCount(moving, 100)), Array(10).fill("video"));

  const staticEvidence = moving.map((item, order) => order === 4 ? {
    ...item,
    title: "Old key",
    narration: "An old key lies on the table.",
    imagePrompt: "Old brass key on wooden table",
    stockQuery: "old brass key",
    animationPrompt: "Static still image"
  } : item);
  const semanticPlan = planAutoStockMediaTypes(staticEvidence, desiredAutoStockVideoCount(staticEvidence, 100));
  assert.deepEqual(semanticPlan, Array(10).fill("video"));
});

test("auto stock service honors zero percent and never falls back from a photo to video", async (context) => {
  const searches: StockSearchInput[] = [];
  const stock = {
    async search(input: StockSearchInput) {
      searches.push(input);
      return input.mediaType === "video"
        ? { items: [asset(input.provider, "video", "unexpected-video", input.query)], total: 1, page: 1, perPage: 18, hasMore: false }
        : { items: [asset(input.provider, "image", "chosen-photo", input.query)], total: 1, page: 1, perPage: 18, hasMore: false };
    },
    async download(candidate: StockAsset) { return { data: Buffer.from(candidate.id), extension: "jpg", contentType: "image/jpeg" }; },
    async downloadPreview() { return undefined; }
  };
  const moving = scene(0, {
    narration: "A police car drives through the street.",
    imagePrompt: "Police car driving through street",
    stockQuery: "police car driving",
    animationPrompt: "Police car keeps driving"
  });
  const setup = await harness([moving], stock, connectedSettings, 0);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));
  const result = await setup.service.autoSelect("project-stock-auto");
  assert.equal(result.failed, 0);
  assert.equal(result.project.scenes[0]?.stockSource?.mediaType, "image");
  assert.ok(searches.length > 0);
  assert.ok(searches.every((search) => search.mediaType === "image"));
});

test("auto stock service searches motion scenes as video and object scenes as images", async (context) => {
  const searches: StockSearchInput[] = [];
  const stock = {
    async search(input: StockSearchInput) {
      searches.push(input);
      return {
        items: [asset(input.provider, input.mediaType, `${input.mediaType}-${searches.length}`, input.query)],
        total: 1,
        page: 1,
        perPage: 18,
        hasMore: false
      };
    },
    async download(candidate: StockAsset) {
      return { data: Buffer.from(candidate.id), extension: candidate.mediaType === "video" ? "mp4" : "jpg", contentType: candidate.mediaType === "video" ? "video/mp4" : "image/jpeg" };
    },
    async downloadPreview() { return undefined; }
  };
  const motion = scene(0, {
    title: "Police arrive",
    narration: "The police car arrives at the motel.",
    imagePrompt: "Police car arriving at roadside motel at night",
    animationPrompt: "Police car driving with flashing lights"
  });
  const staticObject = scene(1, {
    title: "Old key",
    narration: "A brass key lies on the table.",
    imagePrompt: "Old brass key on a wooden motel desk",
    animationPrompt: "Slow camera zoom"
  });
  const neutral = scene(2, {
    title: "Empty motel room",
    narration: "The room is empty.",
    imagePrompt: "Empty roadside motel room at night",
    animationPrompt: "Slow camera pan"
  });
  const setup = await harness([motion, staticObject, neutral], stock);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));

  const result = await setup.service.autoSelect("project-stock-auto");
  assert.equal(result.failed, 0);
  assert.equal(result.project.scenes[0]?.stockSource?.mediaType, "video");
  assert.equal(result.project.scenes[1]?.stockSource?.mediaType, "image");
  assert.equal(result.project.scenes[2]?.stockSource?.mediaType, "image");
  assert.match(result.project.scenes[0]?.stockSource?.query ?? "", /police car arriv/i);
  assert.match(result.project.scenes[1]?.stockSource?.query ?? "", /brass key/i);
});

test("auto stock rejects a semantically unrelated result when provider metadata is available", async (context) => {
  const stock = {
    async search(input: StockSearchInput) {
      const unrelated = asset(input.provider, input.mediaType, "gamer", input.query);
      unrelated.description = "Young gamer playing computer game with RGB headphones";
      const relevant = asset(input.provider, input.mediaType, "dispatcher", input.query);
      relevant.description = "Police emergency call center operator wearing a headset at night";
      return { items: [unrelated, relevant], total: 2, page: 1, perPage: 18, hasMore: false };
    },
    async download(candidate: StockAsset) {
      return { data: Buffer.from(candidate.id), extension: candidate.mediaType === "video" ? "mp4" : "jpg", contentType: candidate.mediaType === "video" ? "video/mp4" : "image/jpeg" };
    },
    async downloadPreview() { return undefined; }
  };
  const dispatcher = scene(0, {
    title: "Night dispatcher",
    narration: "A police dispatcher answers an emergency call at night.",
    imagePrompt: "Police dispatcher in an emergency call center at night",
    stockQuery: "police dispatcher night",
    animationPrompt: "Operator answers the call"
  });
  const setup = await harness([dispatcher], stock);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));

  const result = await setup.service.autoSelect("project-stock-auto");
  assert.equal(result.failed, 0);
  assert.equal(result.project.scenes[0]?.stockSource?.assetId, "dispatcher");
});

test("strict stock relevance rejects the real dragon, flowers, cable car and toy-police failure classes", () => {
  const cases: Array<{ query: string; description: string; reason: RegExp }> = [
    {
      query: "metal door utility room",
      description: "Chinese dragon statue beside a metal door during a colorful festival",
      reason: /дракон|фестиваль/
    },
    {
      query: "gap under utility room door",
      description: "Purple flowers growing through a floor gap beside an old door in a garden",
      reason: /цветы|сад/
    },
    {
      query: "missing recorder cables shelf",
      description: "Cable car travelling above mountain cables with a scenic gondola lift",
      reason: /канатная дорога/
    },
    {
      query: "police car arriving",
      description: "Miniature toy police car model on a child's table",
      reason: /игрушка|миниатюра/
    }
  ];
  for (const [index, candidate] of cases.entries()) {
    const item = asset("pexels", "image", `junk-${index}`, candidate.query);
    item.description = candidate.description;
    const relevance = autoStockAssetRelevance(item);
    assert.equal(relevance.confident, false, `${candidate.query}: ${candidate.description}`);
    assert.match(relevance.reason ?? "", candidate.reason);
  }

  const correct = asset("pexels", "video", "correct", "police car arriving");
  correct.description = "Police patrol car arriving outside a building with officers";
  assert.equal(autoStockAssetRelevance(correct).confident, true);
  const unknown = asset("pexels", "image", "unknown", "old brass key");
  unknown.description = undefined;
  assert.deepEqual(autoStockAssetRelevance(unknown).known, false);
  assert.equal(autoStockAssetRelevance(unknown).confident, false);
});

test("auto stock reports a clear failure instead of downloading visually unrelated search results", async (context) => {
  let downloads = 0;
  const stock = {
    async search(input: StockSearchInput) {
      const descriptions = [
        "Chinese dragon statue beside a metal door at a festival",
        "Bouquet of flowers on the floor beside an old doorway",
        "Cable car gondola travelling over mountain cables",
        "Miniature toy police car model on a table"
      ];
      const items = descriptions.map((description, index) => {
        const item = asset(input.provider, input.mediaType, `unrelated-${index}`, input.query);
        item.description = description;
        return item;
      });
      return { items, total: items.length, page: 1, perPage: 18, hasMore: false };
    },
    async download(candidate: StockAsset) {
      downloads += 1;
      return { data: Buffer.from(candidate.id), extension: "jpg", contentType: "image/jpeg" };
    },
    async downloadPreview() { return undefined; }
  };
  const target = scene(0, {
    title: "Technical room door",
    narration: "Officers approach the locked technical room.",
    imagePrompt: "Locked metal door to a utility room",
    stockQuery: "utility room door",
    animationPrompt: "Static view"
  });
  const setup = await harness([target], stock, connectedSettings, 0);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));
  const result = await setup.service.autoSelect("project-stock-auto");
  assert.equal(result.failed, 1);
  assert.equal(downloads, 0);
  assert.match(result.failures[0]?.message ?? "", /Не найден уверенно подходящий stock/);
  assert.match(result.failures[0]?.message ?? "", /stockQuery/);
  assert.equal(result.project.scenes[0]?.stockSource, undefined);
});

test("auto stock media preference is based on scene meaning rather than scene number", () => {
  const moving = scene(1, {
    narration: "A police car arrives at night.",
    imagePrompt: "Police car arriving at a motel at night",
    animationPrompt: "Car driving with flashing lights"
  });
  const movedToAnotherOrder = { ...moving, order: 29 };
  assert.equal(preferredAutoStockMediaType(moving), "video");
  assert.equal(preferredAutoStockMediaType(movedToAnotherOrder), "video");
  const types = planAutoStockMediaTypes(Array.from({ length: 12 }, (_value, order) => ({ ...moving, id: `moving-${order}`, order })));
  assert.equal(types.filter((type) => type === "video").length, 4);
});

test("auto stock restores a zero-byte local file even when search returns the same asset", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-empty-stock-"));
  const emptyPath = join(directory, "empty.jpg");
  await writeFile(emptyPath, Buffer.alloc(0));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const source = {
    provider: "pexels" as const,
    assetId: "restore-me",
    mediaType: "image" as const,
    query: "evidence",
    pageUrl: "https://www.pexels.com/image/restore-me/",
    author: "Test author",
    attribution: "Restore me",
    licenseUrl: "https://www.pexels.com/license/",
    downloadedAt: "2026-01-01T00:00:00.000Z"
  };
  const candidate = asset("pexels", "image", "restore-me", "evidence");
  candidate.description = "Police detectives inspect evidence in a city office";
  candidate.pageUrl = source.pageUrl;
  const stock = {
    async search(input: StockSearchInput) {
      return { items: input.provider === "pexels" && input.mediaType === "image" ? [candidate] : [], total: 1, page: 1, perPage: 18, hasMore: false };
    },
    async download(item: StockAsset) { return { data: Buffer.from(item.id), extension: "jpg", contentType: "image/jpeg" }; },
    async downloadPreview() { return undefined; }
  };
  const setup = await harness([scene(0, { imagePath: emptyPath, stockSource: source })], stock);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));

  const result = await setup.service.autoSelect("project-stock-auto");
  assert.equal(result.selected, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.project.scenes[0]?.stockSource?.assetId, "restore-me");
  assert.notEqual(result.project.scenes[0]?.imagePath, emptyPath);
});

test("auto stock bypasses a cached broken CDN URL and accepts a refreshed URL for the same asset id", async (context) => {
  const searchModes: boolean[] = [];
  const stale = asset("pexels", "image", "same-id", "evidence room");
  stale.downloadUrl = "https://images.pexels.com/photos/same-id/stale.jpg";
  const fresh = { ...stale, downloadUrl: "https://images.pexels.com/photos/same-id/fresh.jpg" };
  const stock = {
    async search(_input: StockSearchInput, bypassCache = false) {
      searchModes.push(bypassCache);
      return { items: [bypassCache ? fresh : stale], total: 1, page: 1, perPage: 18, hasMore: false };
    },
    async download(candidate: StockAsset) {
      if (candidate.downloadUrl.endsWith("/stale.jpg")) throw new Error("CDN stale URL");
      return { data: Buffer.from("fresh"), extension: "jpg", contentType: "image/jpeg" };
    },
    async downloadPreview() { return undefined; }
  };
  const target = scene(0, { stockQuery: "evidence room", imagePrompt: "Detective in evidence room", animationPrompt: "Static view" });
  const setup = await harness([target], stock, connectedSettings, 0);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));

  const result = await setup.service.autoSelect("project-stock-auto");
  assert.equal(result.failed, 0);
  assert.equal(result.selected, 1);
  assert.equal(result.project.scenes[0]?.stockSource?.assetId, "same-id");
  assert.deepEqual(searchModes.slice(0, 2), [false, true]);
});

test("auto stock does not redownload a rejected CDN asset for every fallback query", async (context) => {
  let downloads = 0;
  const repeated = asset("pexels", "image", "broken-cdn", "evidence");
  repeated.description = "Police detectives inspect evidence in a city office";
  const stock = {
    async search(input: StockSearchInput) {
      if (input.provider === "pixabay") throw new Error("Pixabay unavailable");
      return { items: [repeated], total: 1, page: 1, perPage: 18, hasMore: false };
    },
    async download() { downloads += 1; throw new Error("CDN download failed"); },
    async downloadPreview() { return undefined; }
  };
  const setup = await harness([scene(0)], stock);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));

  const result = await setup.service.autoSelect("project-stock-auto");
  assert.equal(result.failed, 1);
  assert.equal(downloads, 1);
});

test("auto stock can validate a fully ready project after API keys were removed", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-ready-stock-"));
  const readyPath = join(directory, "ready.jpg");
  await writeFile(readyPath, Buffer.from("ready"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const source = {
    provider: "pexels" as const,
    assetId: "ready",
    mediaType: "image" as const,
    query: "ready",
    pageUrl: "https://www.pexels.com/image/ready/",
    author: "Test author",
    attribution: "Ready",
    licenseUrl: "https://www.pexels.com/license/",
    downloadedAt: "2026-01-01T00:00:00.000Z"
  };
  const stock = {
    async search(_input: StockSearchInput) { throw new Error("search must not run"); },
    async download(_asset: StockAsset) { throw new Error("download must not run"); },
    async downloadPreview(_asset: StockAsset) { return undefined; }
  };
  const noKeys = {
    async publicSettings(): Promise<StockSettings> {
      return {
        pexelsConfigured: false,
        pixabayConfigured: false,
        providers: {
          pexels: { provider: "pexels", configured: false, state: "not_configured" },
          pixabay: { provider: "pixabay", configured: false, state: "not_configured" }
        }
      };
    }
  };
  const setup = await harness([scene(0, { imagePath: readyPath, stockSource: source })], stock, noKeys);
  context.after(() => rm(setup.directory, { recursive: true, force: true }));

  const result = await setup.service.autoSelect("project-stock-auto");
  assert.equal(result.skipped, 1);
  assert.equal(result.selected, 0);
  assert.equal(result.failed, 0);
});
