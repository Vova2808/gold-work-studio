import assert from "node:assert/strict";
import test from "node:test";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "./index.js";
import { parseYouTubeVideoId, scenarioQualityFingerprint } from "@gold-work/shared";

test("Stock v2 is opt-in on new explicit stock projects; reads preserve AI Story and legacy plans", async () => {
  const repository = new MemoryProjectRepository();
  const service = new ProjectService(repository, new MockDirectorProvider());
  const input = { title: "Version boundary", topic: "Test", language: "English", aspectRatio: "16:9" as const, mode: "standard" as const };
  const legacy = await service.create(input);
  const ai = await service.create({ ...input, mediaMode: "ai" });
  const before = JSON.stringify([legacy, ai]);
  const next = await service.create({ ...input, mediaMode: "stock" });
  assert.equal(next.settings.assembly.documentary?.version, 2);
  assert.equal(next.settings.assembly.montage?.graphicBeatPercent, 0);
  assert.equal(next.settings.video.enabled, false);
  assert.equal(next.settings.video.sourceVolume, 0);
  assert.equal(legacy.settings.assembly.documentary, undefined);
  assert.equal(ai.settings.assembly.documentary, undefined);
  assert.equal(JSON.stringify([await service.get(legacy.id), await service.get(ai.id)]), before);
});

test("mock director creates a ready project with three scenes", async () => {
  const repository = new MemoryProjectRepository();
  const service = new ProjectService(repository, new MockDirectorProvider());
  const project = await service.create(
    {
      title: "Demo",
      topic: "Test topic",
      aspectRatio: "9:16",
      language: "Русский",
      mode: "standard"
    },
    true
  );

  assert.equal(project.status, "ready");
  assert.equal(project.scenes.length, 3);
  assert.equal(project.settings.voice.enabled, true);
  assert.equal(project.settings.video.enabled, false);
  assert.equal(project.settings.stockVideoPercent, 35);
  assert.equal(project.settings.assembly.kenBurns, true);
  assert.equal(project.settings.assembly.fadeTransitions, true);
  assert.deepEqual(await service.list(), [project]);
});

test("pro projects enable the video stage", async () => {
  const service = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const project = await service.create({
    title: "Pro",
    topic: "Animated scenes",
    aspectRatio: "16:9",
    language: "English",
    mode: "pro",
    mediaMode: "mixed",
    motionTemplate: "Документальный"
  });

  assert.equal(project.settings.video.enabled, true);
  assert.equal(project.settings.assembly.kenBurns, false);
  assert.equal(project.settings.assembly.fadeTransitions, false);
  assert.equal(project.mediaMode, "mixed");
  assert.equal(project.motionTemplate, "Документальный");
});

test("new AI projects default to a simple alternating slideshow without changing stock montage defaults", async () => {
  const service = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const ai = await service.create({
    title: "AI story",
    topic: "Character story",
    aspectRatio: "16:9",
    language: "Русский",
    mode: "pro",
    mediaMode: "ai"
  });
  assert.equal(ai.settings.assembly.kenBurns, true);
  assert.equal(ai.settings.assembly.kenBurnsDirection, "alternate");
  assert.equal(ai.settings.assembly.fadeTransitions, true);
  assert.equal(ai.settings.assembly.transitionType, "mix");
  assert.equal(ai.settings.assembly.transitionDurationSeconds, 0.4);
  assert.equal(ai.settings.assembly.montage?.enabled, false);
  assert.equal(ai.settings.image.provider, "flow");
  assert.equal(ai.settings.video.provider, "flow");
  assert.equal(ai.settings.video.model, "veo_3_1_i2v_s_fast");
  assert.equal(ai.settings.video.animationPercent, 15);
  assert.equal(ai.settings.video.selectionMode, "auto");

  const stock = await service.create({
    title: "Stock story",
    topic: "Documentary",
    aspectRatio: "16:9",
    language: "Русский",
    mode: "standard",
    mediaMode: "stock"
  });
  assert.equal(stock.settings.assembly.kenBurnsDirection, "smart");
  assert.equal(stock.settings.assembly.transitionDurationSeconds, 0.5);
  assert.equal(stock.settings.assembly.montage?.enabled, true);
  assert.equal(stock.settings.image.provider, "mock-image");
  assert.equal(stock.settings.video.provider, "mock-video");
});

test("reference analysis can be refined and converted into a ready project", async () => {
  const service = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const analysis = await service.analyzeReference({
    url: "https://www.youtube.com/watch?v=demo",
    instructions: "Сделай самостоятельный ролик с более сильным удержанием",
    language: "Русский"
  });

  assert.equal(analysis.sourceUrl, "https://www.youtube.com/watch?v=demo");
  assert.equal(analysis.scenes.length, 6);
  assert.match(analysis.hook, /детал/i);

  const refined = await service.refineReference(analysis, "Сделай хук жёстче");
  assert.notEqual(refined.hook, analysis.hook);
  assert.match(refined.suggestedAngle, /хук жёстче/i);

  const project = await service.createFromReference({
    analysis: refined,
    aspectRatio: "16:9",
    mode: "standard"
  });
  assert.equal(project.status, "ready");
  assert.equal(project.scenes.length, 6);
  assert.equal(project.referenceAnalysis?.sourceUrl, analysis.sourceUrl);
  assert.equal(project.settings.video.enabled, false);
});

test("AnyModel projects become ready only with a current final scenario audit", async () => {
  const service = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const base = await service.analyzeReference({ url: "https://youtu.be/demo", language: "Русский" });
  const anyModelAnalysis = { ...base, provider: "anymodel:test" };

  const unaudited = await service.createFromReference({
    analysis: anyModelAnalysis,
    aspectRatio: "16:9",
    mode: "standard"
  });
  assert.equal(unaudited.status, "draft");

  const auditedAnalysis = {
    ...anyModelAnalysis,
    scenarioQuality: {
      version: 1 as const,
      checkedAt: new Date().toISOString(),
      targetSeconds: 60,
      totalDurationSeconds: 60,
      wordCount: 120,
      sceneCount: anyModelAnalysis.scenes.length,
      fingerprint: scenarioQualityFingerprint(anyModelAnalysis.scenes),
      complete: true,
      endingResolved: true,
      repaired: false,
      requiredBeats: []
    }
  };
  const audited = await service.createFromReference({
    analysis: auditedAnalysis,
    aspectRatio: "16:9",
    mode: "standard"
  });
  assert.equal(audited.status, "ready");

  const edited = await service.update(audited.id, {
    scenes: audited.scenes.map((scene, index) => index === 0
      ? { ...scene, narration: `${scene.narration} Ручная правка.` }
      : scene)
  });
  assert.equal(edited.status, "draft");

  const readyScript = await service.createFromReference({
    analysis: {
      ...auditedAnalysis,
      scenarioQuality: { ...auditedAnalysis.scenarioQuality, complete: false, endingResolved: false }
    },
    aspectRatio: "16:9",
    mode: "standard",
    videoBrief: { prompt: "", competitorTranscripts: [], creationMode: "script", readyScript: "Готовый текст пользователя" }
  });
  assert.equal(readyScript.status, "ready");
});

test("project service updates order, duplicates and deletes projects", async () => {
  const repository = new MemoryProjectRepository();
  const service = new ProjectService(repository, new MockDirectorProvider());
  const source = await service.create(
    {
      title: "Проект",
      topic: "Тема",
      aspectRatio: "16:9",
      language: "Русский",
      mode: "standard"
    },
    true
  );
  const [first, second, third] = source.scenes;
  assert.ok(first && second && third);

  const updated = await service.update(source.id, {
    topic: "Новая тема",
    mediaMode: "mixed",
    motionTemplate: "Энергичный",
    scenes: [
      { ...first, order: 2 },
      { ...second, order: 0 },
      { ...third, order: 1 }
    ]
  });
  assert.equal(updated.topic, "Новая тема");
  assert.equal(updated.mediaMode, "mixed");
  assert.equal(updated.motionTemplate, "Энергичный");
  assert.deepEqual(updated.scenes.map((scene) => scene.title), [second.title, third.title, first.title]);
  assert.deepEqual(updated.scenes.map((scene) => scene.order), [0, 1, 2]);

  const duplicate = await service.duplicate(source.id);
  assert.notEqual(duplicate.id, source.id);
  assert.equal(duplicate.title, "Проект — копия");
  assert.equal(duplicate.status, "draft");
  assert.equal(duplicate.mediaMode, "mixed");
  assert.equal(duplicate.motionTemplate, "Энергичный");
  assert.notDeepEqual(duplicate.scenes.map((scene) => scene.id), updated.scenes.map((scene) => scene.id));

  await service.delete(source.id);
  assert.equal(await service.get(source.id), undefined);
  assert.equal((await service.list()).length, 1);
});

test("concurrent patches are merged and active generation locks scene structure", async () => {
  const service = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const project = await service.create(
    { title: "Параллельный проект", topic: "Старая тема", aspectRatio: "16:9", language: "Русский", mode: "standard" },
    true
  );

  await Promise.all([
    service.update(project.id, { topic: "Новая тема" }),
    service.update(project.id, { language: "English" })
  ]);
  const merged = await service.get(project.id);
  assert.equal(merged?.topic, "Новая тема");
  assert.equal(merged?.language, "English");

  await service.update(project.id, { status: "generating" });
  await assert.rejects(
    service.update(project.id, { scenes: project.scenes.slice(0, 1) }),
    /Нельзя менять состав сцен/
  );
});

test("timeline can keep the existing Final.mp4 while saving montage settings", async () => {
  const service = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const project = await service.create(
    { title: "Монтаж", topic: "Тема", aspectRatio: "16:9", language: "Русский", mode: "standard" },
    true
  );
  await service.update(project.id, { outputPath: "C:/project/Final.mp4", status: "complete" });
  const preserved = await service.update(project.id, {
    scenes: project.scenes.map((scene) => ({ ...scene, transition: "fade" as const })),
    outputPath: "C:/project/Final.mp4"
  });
  assert.equal(preserved.outputPath, "C:/project/Final.mp4");

  const invalidated = await service.update(project.id, { topic: "Полностью новая тема" });
  assert.equal(invalidated.outputPath, undefined);
});

test("project keeps the saved director chat topic link", async () => {
  const service = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const project = await service.create(
    { title: "Из чата", topic: "Черновик", aspectRatio: "16:9", language: "Русский", mode: "standard" },
    true
  );

  const updated = await service.update(project.id, {
    chatTopicId: "topic-42",
    topic: "Сценарий из сохранённого разговора",
    scenes: project.scenes
  });

  assert.equal(updated.chatTopicId, "topic-42");
  assert.equal((await service.get(project.id))?.chatTopicId, "topic-42");
  assert.equal(updated.status, "ready");
});

test("YouTube links are normalized without accepting unrelated hosts", () => {
  assert.equal(parseYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=10"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeVideoId("https://youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.throws(() => parseYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), /корректный ID/);
});
