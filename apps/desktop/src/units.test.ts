import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemoryProjectRepository, MemoryTaskRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { allocateSceneDurations, createDefaultProjectSettings, parseYouTubeChannelRef, tryParseYouTubeVideoId, IMAGE_STYLES, TTS_VOICES, type Project, type QueueTask, type Scene } from "@gold-work/shared";
import { assColor, assTime, atempoFactors, karaokeText, narrationCues, resolveKenBurnsDirection, resolveKenBurnsZoom, resolveTimelineTiming, resolveTransitionDuration, resolveVolumePercent, StandardRenderer } from "./standard-renderer.js";
import { extractJson, findSceneIssues, parseSceneArray, toStringList, ttsModelId } from "./anymodel-client.js";
import { ChatTopicRepository } from "./chat-topic-repository.js";
import { parseProxyUrl, type ProxyResponse } from "./proxy-utils.js";
import { cleanErrorMessage, describeNetworkError, googleError, isPermanentFailure } from "./google-errors.js";
import { frameSize } from "./media-utils.js";
import { TextFileLogger } from "./text-file-logger.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { MockGenerationPipeline } from "./mock-generation-pipeline.js";
import { createMediaFileResponse, parseMediaByteRange } from "./media-range.js";

function makeProject(patch: Partial<Project> = {}): Project {
  const settings = createDefaultProjectSettings();
  return {
    id: "p1", title: "Тест", topic: "Тема", aspectRatio: "16:9", language: "Русский", mode: "standard",
    status: "ready", createdAt: "", updatedAt: "", scenes: [], settings, ...patch
  } as Project;
}

function makeScene(patch: Partial<Scene> = {}): Scene {
  return {
    id: "s1", order: 0, title: "Сцена", narration: "Текст", imagePrompt: "", animationPrompt: "",
    durationSeconds: 5, status: "draft", ...patch
  };
}

test("субтитры: реплики покрывают всю длительность сцены и не пустые", () => {
  const cues = narrationCues("Первое предложение. Второе предложение! Третье?", 9);
  assert.ok(cues.length > 0);
  assert.equal(cues[0]!.start, 0);
  assert.ok(Math.abs(cues.at(-1)!.end - 9) < 0.01, "последняя реплика заканчивается вместе со сценой");
  assert.ok(cues.every((cue) => cue.text.trim().length > 0));
  assert.ok(cues.every((cue) => cue.end > cue.start), "нет реплик нулевой длины");
});

test("субтитры: пустой текст не даёт реплик", () => {
  assert.deepEqual(narrationCues("   ", 5), []);
});

test("караоке: сумма длительностей слов равна длине реплики", () => {
  const marked = karaokeText("одно два три четыре", 4);
  const totals = [...marked.matchAll(/\\k(\d+)/g)].map((match) => Number(match[1]));
  assert.equal(totals.length, 4, "разметка на каждое слово");
  assert.equal(totals.reduce((sum, value) => sum + value, 0), 400, "4 секунды = 400 сотых");
  assert.ok(totals.every((value) => value >= 1), "нет слов с нулевой длительностью");
});

test("цвет ASS: hex переводится в BGR", () => {
  assert.equal(assColor("#ffffff"), "&H00FFFFFF");
  assert.equal(assColor("#ff0000"), "&H000000FF", "красный уходит в младший байт");
  assert.equal(assColor("мусор"), "&H00FFFFFF", "некорректный цвет не роняет рендер");
});

test("время ASS: часы, минуты и сотые", () => {
  assert.equal(assTime(0), "0:00:00.00");
  assert.equal(assTime(3725.5), "1:02:05.50");
  assert.equal(assTime(-5), "0:00:00.00", "отрицательное время не ломает формат");
});

test("Ken Burns: сцена важнее проекта, чередование зависит от порядка", () => {
  const project = makeProject();
  project.settings.assembly.kenBurnsDirection = "alternate";
  assert.equal(resolveKenBurnsDirection(project, makeScene({ order: 0 })), "in");
  assert.equal(resolveKenBurnsDirection(project, makeScene({ order: 1 })), "out");
  assert.equal(resolveKenBurnsDirection(project, makeScene({ order: 1, kenBurnsDirection: "in" })), "in");
  assert.equal(resolveKenBurnsDirection(project, makeScene({ kenBurnsDirection: "off" })), "off");
  const noMotion = makeProject();
  noMotion.settings.assembly.kenBurns = false;
  assert.equal(resolveKenBurnsDirection(noMotion, makeScene()), "off");
});

test("таймлайн: старые сцены сохраняют прежнюю длительность, override имеет приоритет", () => {
  assert.equal(resolveTimelineTiming(makeScene({ durationSeconds: 5 }), 8, "photo").durationSeconds, 8.5);
  assert.equal(resolveTimelineTiming(makeScene({ durationSeconds: 5 }), 12, "video").durationSeconds, 5);
  assert.equal(resolveTimelineTiming(makeScene({ durationOverrideSeconds: 3 }), 12, "video").durationSeconds, 3);
});

test("таймлайн: trim и speed определяют длительность и безопасно ограничиваются", () => {
  const timing = resolveTimelineTiming(makeScene({ trimStartSeconds: 2, trimEndSeconds: 10, playbackRate: 2 }), 12, "video");
  assert.deepEqual(timing, { trimStartSeconds: 2, trimEndSeconds: 10, playbackRate: 2, durationSeconds: 4 });

  const clamped = resolveTimelineTiming(makeScene({ trimStartSeconds: -5, trimEndSeconds: 99, playbackRate: 20 }), 10, "video");
  assert.equal(clamped.trimStartSeconds, 0);
  assert.equal(clamped.trimEndSeconds, 10);
  assert.equal(clamped.playbackRate, 4);
  assert.equal(clamped.durationSeconds, 2.5);
});

test("таймлайн: скорость раскладывается в допустимые FFmpeg atempo-факторы", () => {
  assert.deepEqual(atempoFactors(1), [1]);
  assert.deepEqual(atempoFactors(4), [2, 2]);
  assert.deepEqual(atempoFactors(0.25), [0.5, 0.5]);
});

test("таймлайн: переход, zoom и громкости используют совместимые defaults и limits", () => {
  assert.equal(resolveTransitionDuration(makeScene()), 0.5);
  assert.equal(resolveTransitionDuration(makeScene({ transitionDurationSeconds: 99 })), 5);
  assert.equal(resolveKenBurnsZoom(makeScene()), 1.1);
  assert.equal(resolveKenBurnsZoom(makeScene({ kenBurnsZoom: 2 })), 1.5);
  assert.equal(resolveVolumePercent(undefined, 73), 73);
  assert.equal(resolveVolumePercent(250, 73), 200);
});

test("таймлайн: пакетная перегенерация работает после очистки старой очереди", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-timeline-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  const settings = createDefaultProjectSettings();
  settings.video.enabled = true;
  const scenes = [
    makeScene({ id: "s1", order: 0, status: "ready", imagePath: "old-1.png", videoPath: "video-1.mp4", audioPath: "voice-1.mp3" }),
    makeScene({ id: "s2", order: 1, status: "ready", imagePath: "old-2.png", videoPath: "video-2.mp4", audioPath: "voice-2.mp3" }),
    makeScene({ id: "s3", order: 2, status: "ready", imagePath: "old-3.png", videoPath: "video-3.mp4", audioPath: "voice-3.mp3" })
  ];
  await projectRepository.save(makeProject({ scenes, settings }));
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    projectService,
    storage,
    new StandardRenderer(storage)
  );

  const queued = await pipeline.regenerateScene("p1", ["s1", "s2"], "image");
  assert.equal(queued.filter((task) => task.kind === "image").length, 2);
  assert.equal(queued.filter((task) => task.kind === "speech" || task.kind === "video").length, 0);
  assert.match(queued.find((task) => task.kind === "assemble")?.label ?? "", /2 сцен/);

  const internals = pipeline as unknown as { tasks: QueueTask[]; syncProjects(): Promise<void> };
  for (const task of internals.tasks) {
    task.status = "done";
    task.progress = 100;
    task.resultPath = task.kind === "assemble" ? join(directory, "Final.mp4") : join(directory, `${task.sceneId}.png`);
  }
  await internals.syncProjects();
  const updated = await projectService.get("p1");
  assert.equal(updated?.status, "complete");
  assert.equal(updated?.outputPath, join(directory, "Final.mp4"));
  assert.equal(updated?.scenes[2]?.status, "ready", "невыбранная сцена не помечается ошибочной");
  assert.equal(updated?.scenes[0]?.videoPath, "video-1.mp4", "перегенерация фото не удаляет готовое видео");
  await assert.rejects(() => pipeline.regenerateScene("p1", "s1", "wrong" as "all"), /Неизвестный режим/);
});

test("таймлайн: озвучка сцены перегенерируется отдельно без сборки Final.mp4", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-audio-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  const scenes = [
    makeScene({ id: "s1", order: 0, status: "ready", imagePath: "image-1.png", videoPath: "video-1.mp4", audioPath: "voice-old.mp3" }),
    makeScene({ id: "s2", order: 1, status: "ready", imagePath: "image-2.png", audioPath: "voice-2.mp3" })
  ];
  const finalPath = join(directory, "Final.mp4");
  await projectRepository.save(makeProject({ scenes, outputPath: finalPath }));
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    projectService,
    storage,
    new StandardRenderer(storage)
  );

  const queued = await pipeline.regenerateScene("p1", "s1", "audio");
  assert.equal(queued.filter((task) => task.kind === "speech").length, 1);
  assert.equal(queued.some((task) => task.kind === "assemble"), false, "Final.mp4 не собирается ради одной озвучки");
  let updated = await projectService.get("p1");
  assert.equal(updated?.outputPath, undefined, "старый Final.mp4 помечается неактуальным");
  assert.equal(updated?.scenes[0]?.audioPath, undefined);
  assert.equal(updated?.scenes[0]?.imagePath, "image-1.png");
  assert.equal(updated?.scenes[0]?.videoPath, "video-1.mp4");

  const internals = pipeline as unknown as { tasks: QueueTask[]; syncProjects(): Promise<void> };
  const generatedAudio = join(directory, "voice-new.mp3");
  for (const task of internals.tasks) {
    task.status = "done";
    task.progress = 100;
    task.resultPath = generatedAudio;
  }
  await internals.syncProjects();
  updated = await projectService.get("p1");
  assert.equal(updated?.status, "ready");
  assert.equal(updated?.outputPath, undefined);
  assert.equal(updated?.scenes[0]?.audioPath, generatedAudio);
  assert.equal(updated?.scenes[1]?.audioPath, "voice-2.mp3", "остальные сцены не меняются");
});

test("медиа-плеер: Range-запросы Chromium отдаются до конца файла", () => {
  assert.equal(parseMediaByteRange(null, 100), undefined);
  assert.deepEqual(parseMediaByteRange("bytes=0-", 100), { start: 0, end: 99 });
  assert.deepEqual(parseMediaByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseMediaByteRange("bytes=-16", 100), { start: 84, end: 99 });
  assert.equal(parseMediaByteRange("bytes=100-", 100), null);
  assert.equal(parseMediaByteRange("bytes=20-10", 100), null);
  assert.equal(parseMediaByteRange("bytes=0-1,4-5", 100), null);
});

test("медиа-плеер: файл отдаётся потоком с корректными 206-заголовками", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-media-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const path = join(directory, "Final.mp4");
  await writeFile(path, Buffer.from(Array.from({ length: 100 }, (_, index) => index)));

  const openEnded = await createMediaFileResponse(path, "bytes=0-");
  assert.equal(openEnded.status, 206);
  assert.equal(openEnded.headers.get("content-range"), "bytes 0-99/100");
  assert.equal((await openEnded.arrayBuffer()).byteLength, 100);

  const slice = await createMediaFileResponse(path, "bytes=10-19");
  assert.equal(slice.headers.get("content-length"), "10");
  assert.deepEqual([...new Uint8Array(await slice.arrayBuffer())], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

  const invalid = await createMediaFileResponse(path, "bytes=100-");
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("content-range"), "bytes */100");
});

test("разбор JSON модели: фенсы, мусор вокруг и объект-обёртка", () => {
  assert.deepEqual(extractJson<{ a: number }>('```json\n{"a":1}\n```', "тест"), { a: 1 });
  assert.deepEqual(extractJson<{ a: number }>('Вот ответ: {"a":2} — готово', "тест"), { a: 2 });
  assert.deepEqual(extractJson<number[]>("```\n[1,2,3]\n```", "тест"), [1, 2, 3]);
  assert.throws(() => extractJson("совсем не json", "тест"), /не-JSON/);
});

test("разбор массива сцен: голый массив и объект со scenes", () => {
  assert.equal(parseSceneArray('[{"narration":"a"}]').length, 1);
  assert.equal(parseSceneArray('{"scenes":[{"narration":"a"},{"narration":"b"}]}').length, 2);
  assert.equal(parseSceneArray('[{"title":"Хук","animationPrompt":"camera pushes in"}]')[0]?.animationPrompt, "camera pushes in");
  assert.deepEqual(parseSceneArray("мусор"), []);
});

test("длина сценария распределяется точно и не превышает 200 сцен", () => {
  for (const seconds of [30, 1000, 1800, 3600]) {
    const durations = allocateSceneDurations(seconds);
    assert.equal(durations.reduce((sum, duration) => sum + duration, 0), seconds);
    assert.ok(durations.length <= 200);
    assert.ok(durations.every((duration) => duration >= 5));
  }
  assert.equal(allocateSceneDurations(3600).length, 200);
  assert.ok(allocateSceneDurations(3600).every((duration) => duration === 18));
});

test("локальный редактор находит пустые сцены, повторы и приветствие в середине", () => {
  const repeated = "Это достаточно длинная реплика о важном историческом событии и его последствиях для людей";
  const scenes = [
    makeScene({ order: 0, narration: repeated, imagePrompt: "historic city", animationPrompt: "camera pans left" }),
    makeScene({ id: "s2", order: 1, narration: repeated.toUpperCase() + "!", imagePrompt: "historic city", animationPrompt: "camera moves closer" }),
    makeScene({ id: "s3", order: 2, narration: "Добрый вечер, продолжаем рассказ о событиях", imagePrompt: "", animationPrompt: "camera tilts up" })
  ];
  const issues = findSceneIssues(scenes);
  assert.ok(issues.some((issue) => issue.sceneNumber === 2 && issue.kind === "duplicate"));
  assert.ok(issues.some((issue) => issue.sceneNumber === 3 && issue.kind === "greeting"));
  assert.ok(issues.some((issue) => issue.sceneNumber === 3 && issue.kind === "empty"));
});

test("тема чата сохраняет всю историю и выбранную модель", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-chat-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const path = join(directory, "chat.sqlite");
  const repository = new ChatTopicRepository(path);
  await repository.initialize();
  const created = repository.create("История Рима", "ag/claude-sonnet-4-6");
  repository.append(created.id, { role: "user", content: "Сделай сильный хук" });
  repository.append(created.id, { role: "assistant", content: "Предлагаю начать с падения империи" });
  repository.setModel(created.id, "cc/claude-opus-5");
  repository.close();

  const reopened = new ChatTopicRepository(path);
  await reopened.initialize();
  const topic = reopened.get(created.id);
  assert.equal(topic?.modelId, "cc/claude-opus-5");
  assert.deepEqual(topic?.messages.map(({ role, content }) => ({ role, content })), [
    { role: "user", content: "Сделай сильный хук" },
    { role: "assistant", content: "Предлагаю начать с падения империи" }
  ]);
  reopened.close();
});

test("список строк: объекты превращаются в строки, пустые отбрасываются", () => {
  assert.deepEqual(toStringList(["a", "", "  b  "]), ["a", "b"]);
  assert.deepEqual(toStringList([{ title: "Хук", detail: "сильный" }]), ["Хук — сильный"]);
  assert.deepEqual(toStringList("не массив"), []);
});

test("модель озвучки: провайдер, язык и полные id", () => {
  assert.equal(ttsModelId("google-tts", "ru"), "google-tts/ru");
  assert.equal(ttsModelId("edge-tts", "ru"), "edge-tts/ru-RU-DmitryNeural");
  assert.equal(ttsModelId("edge-tts", "xx"), "google-tts/xx", "неизвестный язык уходит на google-tts");
  assert.equal(ttsModelId("edge-tts/ru-RU-SvetlanaNeural", "ru"), "edge-tts/ru-RU-SvetlanaNeural");
  assert.equal(ttsModelId("ru-RU-DmitryNeural", "ru"), "edge-tts/ru-RU-DmitryNeural", "старые голые имена");
  assert.equal(ttsModelId("", "ru"), "google-tts/ru");
});

test("ссылки на канал YouTube: handle, id, c и user", () => {
  assert.deepEqual(parseYouTubeChannelRef("https://youtube.com/@goldwork"), { kind: "handle", value: "@goldwork" });
  assert.deepEqual(parseYouTubeChannelRef("https://www.youtube.com/channel/UC1234567890abc"), { kind: "id", value: "UC1234567890abc" });
  assert.deepEqual(parseYouTubeChannelRef("https://youtube.com/c/SomeName"), { kind: "custom", value: "SomeName" });
  assert.deepEqual(parseYouTubeChannelRef("https://youtube.com/user/SomeUser"), { kind: "user", value: "SomeUser" });
  assert.equal(parseYouTubeChannelRef("https://youtu.be/abc12345678"), undefined, "ссылка на видео каналом не считается");
  assert.equal(parseYouTubeChannelRef("не ссылка"), undefined);
});

test("ссылка на видео: разные форматы и мягкий отказ", () => {
  assert.equal(tryParseYouTubeVideoId("https://youtu.be/rYT-NUcC0oE"), "rYT-NUcC0oE");
  assert.equal(tryParseYouTubeVideoId("https://www.youtube.com/watch?v=rYT-NUcC0oE&t=5"), "rYT-NUcC0oE");
  assert.equal(tryParseYouTubeVideoId("https://youtube.com/shorts/rYT-NUcC0oE"), "rYT-NUcC0oE");
  assert.equal(tryParseYouTubeVideoId("https://youtube.com/@channel"), undefined);
});

test("прокси: разбор socks5 и понятные ошибки", () => {
  assert.deepEqual(parseProxyUrl("socks5://user:pass@1.2.3.4:8000"), { host: "1.2.3.4", port: 8000, user: "user", password: "pass" });
  assert.deepEqual(parseProxyUrl("socks5://1.2.3.4:1080"), { host: "1.2.3.4", port: 1080, user: undefined, password: undefined });
  assert.equal(parseProxyUrl(""), undefined);
  assert.equal(parseProxyUrl(undefined), undefined);
  assert.throws(() => parseProxyUrl("http://1.2.3.4:8080"), /SOCKS5/);
  assert.throws(() => parseProxyUrl("абракадабра"), /Некорректный адрес/);
});

function makeResponse(status: number, payload: unknown): ProxyResponse {
  const body = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload), "utf8");
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {},
    body,
    text: () => body.toString("utf8"),
    json: <T,>() => JSON.parse(body.toString("utf8")) as T
  };
}

test("ошибки Google: квота биллинга не повторяется, временный лимит повторяется", () => {
  const zeroQuota = googleError(makeResponse(429, {
    error: { message: "You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-omni-flash" }
  }));
  assert.ok(isPermanentFailure(zeroQuota), "нулевая квота — повторять бессмысленно");
  assert.match(cleanErrorMessage(zeroQuota), /платной квоты Veo/);
  assert.ok(!cleanErrorMessage(zeroQuota).includes("[no-retry]"), "служебная метка не попадает пользователю");

  const billingQuota = googleError(makeResponse(429, {
    error: { message: "You exceeded your current quota, please check your plan and billing details." }
  }));
  assert.ok(isPermanentFailure(billingQuota), "429 без retry-in — проблема тарифа, а не временный лимит");
  assert.match(cleanErrorMessage(billingQuota), /Set up billing/);

  const rateLimit = googleError(makeResponse(429, {
    error: { message: "Too many requests. Please retry in 38.7s." }
  }));
  assert.ok(!isPermanentFailure(rateLimit), "429 с retry-in стоит повторить");

  assert.ok(isPermanentFailure(googleError(makeResponse(404, { error: { message: "models/veo-9 is not found" } }))));
  assert.ok(isPermanentFailure(googleError(makeResponse(403, { error: { message: "no access" } }))));
  assert.ok(!isPermanentFailure(googleError(makeResponse(500, "internal"))), "сбой сервера — повторяем");
});

test("сетевые ошибки: обрыв соединения объясняется прокси", () => {
  assert.match(describeNetworkError(new Error("socket hang up")), /прокси/);
  assert.match(describeNetworkError(new Error("read ECONNRESET")), /прокси/);
  assert.match(describeNetworkError(Object.assign(new Error("x"), { name: "TimeoutError" })), /не ответил за отведённое время/);
  assert.equal(describeNetworkError(new Error("Добавьте ключ")), "Добавьте ключ", "прочие ошибки не подменяются");
});

test("кадр: размеры соответствуют формату проекта", () => {
  assert.deepEqual(frameSize("16:9"), { width: 1920, height: 1080 });
  assert.deepEqual(frameSize("9:16"), { width: 1080, height: 1920 });
  assert.equal(frameSize("1:1").width, frameSize("1:1").height, "квадрат");
});

test("каталоги: голоса и стили без пустых и дублей", () => {
  assert.ok(TTS_VOICES.length >= 10);
  assert.equal(new Set(TTS_VOICES.map((voice) => voice.id)).size, TTS_VOICES.length, "нет дублей голосов");
  assert.ok(TTS_VOICES.every((voice) => voice.label.trim() && voice.language.trim()));
  assert.ok(IMAGE_STYLES.length >= 5);
  assert.equal(new Set(IMAGE_STYLES.map((style) => style.id)).size, IMAGE_STYLES.length, "нет дублей стилей");
  assert.ok(IMAGE_STYLES.every((style) => style.promptSuffix.trim().length > 10));
});

test("logger keeps sanitized history and broadcasts the same entry", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-logs-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const path = join(directory, "gold-work-studio.log");
  const liveEntries: Array<{ id: string; message: string; details?: Record<string, unknown> }> = [];
  const logger = new TextFileLogger(path, (entry) => liveEntries.push(entry));

  await logger.initialize();
  await logger.write("info", "queue.task.started", {
    label: "Image 1",
    apiKey: "secret-key",
    prompt: "private prompt",
    attempt: 1
  });

  const history = await logger.readRecent(10);
  const file = await readFile(path, "utf8");
  const last = history.at(-1);
  assert.equal(last?.message, "queue.task.started");
  assert.equal(last?.details?.apiKey, "[REDACTED]");
  assert.equal(last?.details?.prompt, "[REDACTED]");
  assert.equal(liveEntries.at(-1)?.message, last?.message);
  assert.equal(liveEntries.at(-1)?.id, last?.id);
  assert.ok(!file.includes("secret-key"));
  assert.ok(!file.includes("private prompt"));
});

test("logger sanitizes legacy and malformed history before returning it", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-legacy-logs-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const path = join(directory, "gold-work-studio.log");
  const logger = new TextFileLogger(path);
  await logger.initialize();
  await appendFile(path, [
    '2026-01-01T00:00:00.000Z [INFO] [legacy] legacy.event {"prompt":"private legacy prompt","ok":true}',
    '2026-01-01T00:00:01.000Z [ERROR] [legacy] legacy.broken {"token":"raw-secret"',
    ""
  ].join("\n"), "utf8");

  const history = await logger.readRecent(10);
  const legacy = history.find((entry) => entry.message === "legacy.event");
  const broken = history.find((entry) => entry.message === "legacy.broken");
  assert.equal(legacy?.details?.prompt, "[REDACTED]");
  assert.equal(legacy?.details?.ok, true);
  assert.ok(!JSON.stringify(broken).includes("raw-secret"));
});
