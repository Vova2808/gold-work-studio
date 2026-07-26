import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultProjectSettings, parseYouTubeChannelRef, tryParseYouTubeVideoId, IMAGE_STYLES, TTS_VOICES, type Project, type Scene } from "@gold-work/shared";
import { assColor, assTime, karaokeText, narrationCues, resolveKenBurnsDirection } from "./standard-renderer.js";
import { extractJson, parseSceneArray, toStringList, ttsModelId } from "./anymodel-client.js";
import { parseProxyUrl } from "./proxy-utils.js";
import { frameSize } from "./media-utils.js";

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

test("разбор JSON модели: фенсы, мусор вокруг и объект-обёртка", () => {
  assert.deepEqual(extractJson<{ a: number }>('```json\n{"a":1}\n```', "тест"), { a: 1 });
  assert.deepEqual(extractJson<{ a: number }>('Вот ответ: {"a":2} — готово', "тест"), { a: 2 });
  assert.deepEqual(extractJson<number[]>("```\n[1,2,3]\n```", "тест"), [1, 2, 3]);
  assert.throws(() => extractJson("совсем не json", "тест"), /не-JSON/);
});

test("разбор массива сцен: голый массив и объект со scenes", () => {
  assert.equal(parseSceneArray('[{"narration":"a"}]').length, 1);
  assert.equal(parseSceneArray('{"scenes":[{"narration":"a"},{"narration":"b"}]}').length, 2);
  assert.deepEqual(parseSceneArray("мусор"), []);
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
