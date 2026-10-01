import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_STORY_HARD_MAX_SCENE_SECONDS,
  AI_STORY_TARGET_SCENE_SECONDS,
  allocateAiStorySceneDurations,
  createVoiceCalibration,
  estimateNarrationDurationSeconds
} from "@gold-work/shared";
import { AnyModelClient } from "./anymodel-client.js";
import { countNarrationCharacters, type NarrationDraftCheckpoint, type ReferenceAnalysis, type Scene } from "@gold-work/shared";
import { normalizeReadyScriptText, splitReadyScriptNarration } from "./ready-script.js";

const calibration = createVoiceCalibration({
  provider: "edge-tts",
  voice: "edge-tts/ru-RU-DmitryNeural",
  language: "ru",
  sampleText: "Этот голос будет рассказывать историю спокойно, ясно и с естественными паузами.",
  audioDurationSeconds: 5,
  calibratedAt: "2026-09-06T00:00:00.000Z"
});

describe("splitReadyScriptNarration", () => {
  it("исправление split-screen меняет только ошибочный imagePrompt, не текст и тайминг", async () => {
    const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "test" }) } as never);
    let calls = 0;
    (client as unknown as { chat: (...args: unknown[]) => Promise<string> }).chat = async () => {
      calls++; return JSON.stringify([{ imagePrompt: "Maksim and another craftsman talk in the same workshop" }]);
    };
    const scenes = [{ id: "one", order: 0, title: "Сравнение", narration: "Оба сравнивают результат.", durationSeconds: 5,
      imagePrompt: "Split view of two craftsmen", animationPrompt: "slow push in", status: "draft" as const },
      { id: "two", order: 1, title: "Итог", narration: "Они поняли разницу.", durationSeconds: 4,
        imagePrompt: "Two craftsmen in a workshop. No collage or split-screen.", animationPrompt: "slow pull out", status: "draft" as const }];
    const fixed = await client.repairVisualCompositions(scenes, "Same recurring hero; one real location.");
    assert.equal(calls, 1);
    assert.deepEqual(fixed.map(({imagePrompt, ...scene})=>scene),scenes.map(({imagePrompt, ...scene})=>scene));
    assert.deepEqual(fixed[1], scenes[1]);
    assert.match(fixed[0]!.imagePrompt, /same workshop/);
    assert.match(scenes[0]!.imagePrompt, /Split view/);
  });
  it("narration-first сохраняет разделы после обрыва, редактирует один раз и не переписывает текст в визуальных промптах", async () => {
    const paragraphs = [
      "Ключ лежал на столе, но дверь мастерской оставалась закрыта. Анна решила найти хозяина, прежде чем входить внутрь.",
      "Сосед узнал брелок и отвёл Анну к старому часовщику. Тот забыл ключ после прогулки и уже собирался искать его во дворе.",
      "Анна вернула находку. Часовщик открыл мастерскую и показал ей часы, которые ремонтировал для её матери. Тайна закрытой двери оказалась простой случайностью."
    ];
    const fullText = paragraphs.join("\n\n");
    const timing = { targetSeconds: 60, targetCharacterCount: countNarrationCharacters(fullText), targetWordCount: 65,
      charactersPerSecond: countNarrationCharacters(fullText) / 60, wordsPerMinute: 65 };
    const seed = { suggestedTitle: "Ключ", suggestedAngle: "История Анны", language: "Русский", instructions: "Без лишних повторов", scenes: [], provider: "anymodel:test" } as unknown as ReferenceAnalysis;
    let saved: NarrationDraftCheckpoint | undefined;
    let failOnce = true, editorCalls = 0;
    const written: number[] = [];
    const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "test" }) } as never);
    (client as unknown as { chat: (model: string, messages: Array<{role: string; content: string}>) => Promise<string> }).chat = async (_model, messages) => {
      const system = messages[0]!.content, user = messages.at(-1)!.content;
      if (system.includes("шеф-редактор")) return JSON.stringify({ title: "Ключ", promise: "Найти хозяина", tone: "Спокойный", narrator: "От третьего лица",
        writingBrief: "Хронологичная история с законченной развязкой", visualBible: "Анна в красном пальто", continuityRules: [], requiredBeats: ["Вернуть ключ"], endingResolution: "Ключ возвращён",
        sections: paragraphs.map((_, i) => ({ title: `Раздел ${i+1}`, goal: "Новое событие", keyPoints: [], transition: "Далее" })), sectionWeights: [1,1,1] });
      if (system.includes("опытный автор")) {
        const request = JSON.parse(user);
        if (request.format?.includes('"sections"')) {
          written.push(1,2,3);
          return JSON.stringify({ sections: paragraphs });
        }
        if (request.currentSection === 2 && failOnce) { failOnce = false; throw new TypeError("fetch failed"); }
        written.push(request.currentSection);
        assert.equal(request.previousSections.length, request.currentSection - 1);
        assert.equal(request.targetCharacters > 0, true);
        return JSON.stringify({ narration: paragraphs[request.currentSection - 1] });
      }
      if (system.includes("выпускающий редактор")) {
        if (failOnce) { failOnce = false; throw new TypeError("fetch failed"); }
        editorCalls++; return JSON.stringify({ accepted: true, notes: [], replacements: [] });
      }
      const count = Number(/Верни ровно (\d+) объектов/u.exec(user)?.[1] ?? 0);
      assert.ok(count > 0, "Only visual batches may follow the single editorial pass");
      return JSON.stringify(Array.from({ length: count }, () => ({ title: "Кадр", narration: "Нельзя принять этот чужой текст", imagePrompt: "Anna holds a key near the workshop", stockQuery: "workshop key", animationPrompt: "slow pull out" })));
    };
    const run = () => client.regenerateScenes(seed,60,undefined,undefined,undefined,"local",undefined,timing,undefined,"ai-story",{
      narrationState: saved, onNarrationCheckpoint: async state => { saved = structuredClone(state); }
    });
    await assert.rejects(run(), /fetch failed/);
    assert.equal(saved?.sections.length, 3);
    const result = await run();
    assert.deepEqual(written, [1,2,3]);
    assert.equal(editorCalls,1);
    assert.equal(result.scenes.map(scene=>scene.narration).join(""), fullText);
    assert.ok(result.scenes.every(scene=>scene.durationSeconds<=9));
    assert.equal(result.scenarioQuality?.complete, true);
    assert.equal(result.narrationDraft, undefined);
  });
  it("сохраняет весь готовый текст и делит его по смысловым границам", () => {
    const script = [
      "Первое предложение сразу задаёт сильный вопрос.",
      "Второе спокойно объясняет исходную проблему и добавляет важную деталь.",
      "Третье завершает мысль. Четвёрто открывает следующую часть истории.",
      "Последнее предложение даёт ясный итог без обрыва."
    ].join(" ");
    const chunks = splitReadyScriptNarration(script, calibration, 4);

    assert.ok(chunks.length > 1);
    assert.equal(chunks.map((chunk) => chunk.narration).join(""), script);
    assert.ok(chunks.every((chunk) => chunk.durationSeconds >= 1.5));
    assert.ok(Math.abs(chunks.reduce((sum, chunk) => sum + chunk.durationSeconds, 0) - estimateNarrationDurationSeconds(script, calibration)) <= 0.11);
  });

  it("не теряет очень длинное предложение и ограничивает число кадров", () => {
    const script = `${Array.from({ length: 140 }, (_, index) => `слово${index}`).join(" ")}.`;
    const chunks = splitReadyScriptNarration(script, calibration, 4, 12);

    assert.ok(chunks.length <= 12);
    assert.equal(chunks.map((chunk) => chunk.narration).join(""), script);
    assert.ok(chunks.every((chunk) => chunk.durationSeconds <= AI_STORY_HARD_MAX_SCENE_SECONDS));
  });

  it("отклоняет пустой сценарий", () => {
    assert.throws(() => splitReadyScriptNarration("  \n ", calibration), /Вставьте готовый сценарий/u);
  });

  it("строго соблюдает лимит на кадры даже для множества коротких предложений", () => {
    const script = Array.from({ length: 45 }, (_, index) => `Факт номер ${index + 1}.`).join(" ");
    const chunks = splitReadyScriptNarration(script, calibration, 4, 7);

    assert.ok(chunks.length <= 7);
    assert.equal(chunks.map((chunk) => chunk.narration).join(""), script);
    assert.ok(chunks.every((chunk) => chunk.durationSeconds <= AI_STORY_HARD_MAX_SCENE_SECONDS));
  });

  it("по умолчанию держит AI Story около пяти секунд и никогда не превышает девять", () => {
    const script = Array.from(
      { length: 30 },
      (_, index) => `Эпизод ${index + 1} добавляет к истории новый конкретный факт и естественно продолжает предыдущую мысль.`
    ).join(" ");
    const chunks = splitReadyScriptNarration(script, calibration);
    const average = chunks.reduce((sum, chunk) => sum + chunk.durationSeconds, 0) / chunks.length;

    assert.equal(chunks.map((chunk) => chunk.narration).join(""), script);
    assert.ok(Math.abs(average - AI_STORY_TARGET_SCENE_SECONDS) <= 2);
    assert.ok(chunks.every((chunk) => chunk.durationSeconds <= AI_STORY_HARD_MAX_SCENE_SECONDS));
  });

  it("отказывается нарушать девятисекундный предел ради слишком малого числа кадров", () => {
    const script = `${Array.from({ length: 320 }, (_, index) => `слово${index}`).join(" ")}.`;
    assert.throws(
      () => splitReadyScriptNarration(script, calibration, AI_STORY_TARGET_SCENE_SECONDS, 12),
      /больше 12 кадров|не более 9 с/u
    );
  });

  it("дословно сохраняет переносы, повторные пробелы, NBSP и исходную Unicode-форму", () => {
    const script = "\u00a0  Первая  строка хранит e\u0301 без NFKC.\r\n\r\nВторая\tстрока содержит NBSP\u00a0между словами;  затем идёт финал.\nПоследняя строка.  ";
    const chunks = splitReadyScriptNarration(script, calibration, 3);

    assert.equal(normalizeReadyScriptText(script), script);
    assert.equal(chunks.map((chunk) => chunk.narration).join(""), script);
    assert.ok(chunks.every((chunk) => chunk.narration.trim().length > 0));
    assert.ok(chunks.every((chunk) => chunk.durationSeconds <= AI_STORY_HARD_MAX_SCENE_SECONDS));
  });

  it("AnyModel заполняет только визуальные поля и не может изменить готовую озвучку", async () => {
    const script = `\u00a0${[
      "Сначала герой замечает закрытую дверь и останавливается.",
      "Затем он находит ключ под старым цветочным горшком.",
      "За дверью оказывается мастерская, которую семья считала пустой много лет.",
      "В финале герой понимает, зачем дед сохранил это место."
    ].join("\r\n  ")}  `;
    const client = new AnyModelClient({
      publicSettings: async () => ({ textModel: "test-model" })
    } as never);
    let calls = 0;
    const checkpoints: string[] = [];
    (client as unknown as {
      chat: (model: string, messages: Array<{ role: string; content: string }>) => Promise<string>;
    }).chat = async (_model, messages) => {
      calls += 1;
      const count = Number(/Верни ровно (\d+) объектов/u.exec(messages.at(-1)?.content ?? "")?.[1] ?? 0);
      assert.ok(count > 0, "Готовому тексту не нужен платный JSON-план: первый и последующие запросы — только визуальные промпты");
      return JSON.stringify(Array.from({ length: count }, (_, index) => ({
        title: `Кадр ${index + 1}`,
        narration: "Модель попыталась заменить слова пользователя",
        imagePrompt: `A concrete story frame ${index + 1}`,
        stockQuery: "locked workshop door",
        animationPrompt: "Slow camera push in"
      })));
    };

    const result = await client.prepareReadyScript(
      {
        sourceUrl: "chat://ready-script-test",
        sourceTitle: "Тест",
        niche: "История",
        targetAudience: "Зрители",
        hook: script.slice(0, 80),
        structure: [],
        strengths: [],
        improvements: [],
        suggestedAngle: "Семейная тайна",
        suggestedTitle: "Старая мастерская",
        recommendedDurationSeconds: 30,
        language: "Русский",
        scenes: [],
        provider: "test"
      },
      script,
      calibration,
      undefined,
      "test-model",
      undefined,
      "local",
      (scenes) => {
        checkpoints.push(scenes.map((scene) => scene.narration).join(""));
      }
    );

    assert.equal(result.scenes.map((scene) => scene.narration).join(""), script);
    assert.ok(result.scenes.every((scene) => scene.narration !== "Модель попыталась заменить слова пользователя"));
    assert.deepEqual(result.structure, [`Кадры 1–${result.scenes.length}`]);
    assert.equal(calls, 1, "Разметка короткого готового текста требует только одного запроса визуальных промптов");
    assert.equal(checkpoints.at(-1), script);
  });
});

describe("allocateAiStorySceneDurations", () => {
  it("длинный готовый сценарий продолжает визуальные пачки без нового плана и без потери префикса", async () => {
    const script = "Анна осматривает мастерскую и аккуратно раскладывает инструменты на деревянном столе. ".repeat(320);
    const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "test-model" }) } as never);
    const controller = new AbortController();
    let calls = 0;
    let saved: Scene[] = [];
    (client as unknown as { chat: (_model: string, messages: Array<{ content: string }>) => Promise<string> }).chat = async (_model, messages) => {
      calls++;
      const count = Number(/Верни ровно (\d+) объектов/u.exec(messages.at(-1)!.content)?.[1] ?? 0);
      assert.ok(count > 0, "No independent JSON planning call");
      if (calls === 2) { controller.abort(); throw new DOMException("Connection interrupted", "AbortError"); }
      return JSON.stringify(Array.from({ length: count }, () => ({ title: "Мастерская", imagePrompt: "Anna arranges tools on a wooden table", stockQuery: "workshop tools", animationPrompt: "slow push in" })));
    };
    const seed: ReferenceAnalysis = { sourceUrl: "chat://long-ready", sourceTitle: "Long", niche: "История", targetAudience: "QA", hook: "Начало",
      structure: [], strengths: [], improvements: [], suggestedAngle: "Мастерская", suggestedTitle: "Мастерская", language: "Русский", recommendedDurationSeconds: 1200, scenes: [], provider: "test" };
    await assert.rejects(() => client.prepareReadyScript(seed, script, calibration, undefined, undefined, controller.signal, "local", scenes => { saved = structuredClone(scenes); }), /interrupted/);
    assert.equal(saved.length, 12);
    const ids = saved.map(scene => scene.id);
    const result = await client.prepareReadyScript(seed, script, calibration, undefined, undefined, undefined, "local", undefined, 5, { resumeScenes: saved });
    assert.ok(result.scenes.length > 100);
    assert.deepEqual(result.scenes.slice(0, 12).map(scene => scene.id), ids);
    assert.equal(result.scenes.map(scene => scene.narration).join(""), script);
    assert.equal(calls, Math.ceil(result.scenes.length / 12) + 1);
  });
  it("распределяет целевую длину примерно по пять секунд без кадров длиннее девяти", () => {
    for (const seconds of [30, 61, 780, 1_800, 7_200]) {
      const durations = allocateAiStorySceneDurations(seconds);
      assert.equal(durations.reduce((sum, duration) => sum + duration, 0), seconds);
      assert.ok(durations.every((duration) => duration <= AI_STORY_HARD_MAX_SCENE_SECONDS));
      assert.ok(Math.abs(seconds / durations.length - AI_STORY_TARGET_SCENE_SECONDS) <= 0.5);
    }
  });
});
