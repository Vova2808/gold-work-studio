import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import {
  countNarrationCharacters,
  createNarrationTimingBudget,
  createVoiceCalibration,
  estimateNarrationDurationSeconds,
  voiceCalibrationMatches,
  voiceCalibrationSampleText,
  type NarrationTimingBudget,
  type Scene
} from "@gold-work/shared";
import { AnyModelClient, findSceneIssues, inspectGeneratedScenarioReadiness, inspectScenarioReadiness, narrationTimingInstruction } from "./anymodel-client.js";
import { VoicerAbortError, VoicerClient, VoicerClientError, type VoicerClientOptions } from "./voicer-client.js";
import { VoiceCalibrationService } from "./voice-calibration-service.js";

function lumeanOk(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function voicerForReliabilityTest(
  fetchImpl: typeof fetch,
  options: VoicerClientOptions = {},
  connection: { baseUrl?: string; apiKey?: string } = {}
): VoicerClient {
  const store = {
    publicSettings: async () => ({
      configured: true,
      baseUrl: connection.baseUrl ?? "https://api.lumean.test/api/public"
    }),
    apiKey: async () => connection.apiKey ?? "test-api-key"
  } as unknown as ConstructorParameters<typeof VoicerClient>[0];
  return new VoicerClient(store, {
    requestTimeoutMs: 1_000,
    responseBodyTimeoutMs: 1_000,
    downloadTimeoutMs: 1_000,
    pollIntervalMs: 0,
    pollTimeoutMs: 1_000,
    safeRetryAttempts: 3,
    safeRetryBaseDelayMs: 0,
    sleep: async () => undefined,
    ...options,
    fetchImpl
  });
}

function fetchFailure(code: string): Error {
  return Object.assign(new Error("fetch failed"), { cause: { code } });
}

test("калибровка считает Unicode-символы, скорость, WPM и длительность готового текста", () => {
  const sampleText = voiceCalibrationSampleText("Русский");
  const calibration = createVoiceCalibration({
    provider: "edge-tts",
    voice: "edge-tts/ru-RU-DmitryNeural",
    language: "Русский",
    sampleText,
    audioDurationSeconds: 5,
    calibratedAt: "2026-09-06T12:00:00.000Z"
  });
  assert.equal(calibration.sampleCharacterCount, countNarrationCharacters(sampleText));
  assert.equal(calibration.charactersPerSecond, Math.round(calibration.sampleCharacterCount / 5 * 1_000) / 1_000);
  assert.ok(calibration.wordsPerMinute > 0);

  const budget = createNarrationTimingBudget(calibration, 780);
  assert.equal(budget.targetSeconds, 780);
  assert.equal(budget.targetCharacterCount, Math.round(calibration.charactersPerSecond * 780));
  assert.equal(budget.targetWordCount, Math.round(calibration.wordsPerMinute * 13));
  assert.equal(
    estimateNarrationDurationSeconds(sampleText.repeat(2), calibration),
    Math.round(countNarrationCharacters(sampleText.repeat(2)) / calibration.charactersPerSecond * 1_000) / 1_000
  );
});

test("калибровка привязана к провайдеру, точному голосу, языку и версии тестовой фразы", () => {
  const calibration = createVoiceCalibration({
    provider: "elevenlabs",
    voice: "template-42",
    language: "ru",
    sampleText: voiceCalibrationSampleText("ru"),
    audioDurationSeconds: 4
  });
  assert.equal(voiceCalibrationMatches(calibration, "elevenlabs", "template-42", "Русский"), true);
  assert.equal(voiceCalibrationMatches(calibration, "elevenlabs", "template-other", "Русский"), false);
  assert.equal(voiceCalibrationMatches(calibration, "edge-tts", "template-42", "Русский"), false);
  assert.equal(voiceCalibrationMatches(calibration, "elevenlabs", "template-42", "English"), false);
});

test("сервис озвучивает фиксированную фразу выбранным провайдером и измеряет сохранённый файл", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-voice-calibration-"));
  const audio = Buffer.alloc(96, 7);
  const calls: string[] = [];
  try {
    const service = new VoiceCalibrationService(
      {
        async ttsSample(voice, languageCode) {
          calls.push(`anymodel:${voice}:${languageCode}`);
          return audio.toString("base64");
        }
      },
      {
        async ttsSample(voice, languageCode) {
          calls.push(`voicer:${voice}:${languageCode}`);
          return audio.toString("base64");
        }
      },
      directory,
      {
        measureDuration: async (path) => {
          assert.deepEqual(await readFile(path), audio);
          return 4.25;
        },
        now: () => new Date("2026-09-06T13:00:00.000Z")
      }
    );
    const result = await service.calibrate({ provider: "elevenlabs", voice: "template-7", language: "Русский" });
    assert.deepEqual(calls, ["voicer:template-7:ru"]);
    assert.equal(result.sampleAudioBase64, audio.toString("base64"));
    assert.equal(result.calibration.audioDurationSeconds, 4.25);
    assert.equal(result.calibration.calibratedAt, "2026-09-06T13:00:00.000Z");
    assert.equal(result.calibration.sampleText, voiceCalibrationSampleText("ru"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("некорректная или неизмеримая тестовая озвучка не создаёт фиктивную скорость", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-voice-invalid-"));
  try {
    const audio = Buffer.alloc(64, 1).toString("base64");
    const service = new VoiceCalibrationService(
      { ttsSample: async () => audio },
      { ttsSample: async () => audio },
      directory,
      { measureDuration: async () => 0 }
    );
    await assert.rejects(
      service.calibrate({ provider: "edge-tts", voice: "edge-tts/ru-RU-DmitryNeural", language: "ru" }),
      /измерить длительность/
    );
    await assert.rejects(
      service.calibrate({ provider: "edge-tts", voice: "", language: "ru" }),
      /выберите конкретный голос/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("смена голоса или языка удаляет сохранённую калибровку при нормализации проекта", async () => {
  const service = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const project = await service.create({
    title: "Калибровка",
    topic: "Тема",
    aspectRatio: "16:9",
    language: "Русский",
    mode: "standard"
  });
  const calibration = createVoiceCalibration({
    provider: project.settings.voice.provider,
    voice: project.settings.voice.voice,
    language: project.language,
    sampleText: voiceCalibrationSampleText(project.language),
    audioDurationSeconds: 4
  });
  const calibrated = await service.update(project.id, {
    settings: {
      ...project.settings,
      voice: { ...project.settings.voice, calibration }
    }
  });
  assert.equal(calibrated.settings.voice.calibration?.voice, project.settings.voice.voice);

  const changedVoice = await service.update(project.id, {
    settings: {
      ...calibrated.settings,
      voice: { ...calibrated.settings.voice, voice: "edge-tts/ru-RU-SvetlanaNeural" }
    }
  });
  assert.equal(changedVoice.settings.voice.calibration, undefined);

  const recalibrated = await service.update(project.id, {
    language: "Русский",
    settings: {
      ...changedVoice.settings,
      voice: { ...changedVoice.settings.voice, voice: calibration.voice, calibration }
    }
  });
  assert.ok(recalibrated.settings.voice.calibration);
  const changedLanguage = await service.update(project.id, { language: "English" });
  assert.equal(changedLanguage.settings.voice.calibration, undefined);
});

test("сценарист получает бюджет символов выбранного голоса, а локальная проверка использует его скорость", () => {
  const timing: NarrationTimingBudget = {
    targetSeconds: 60,
    targetCharacterCount: 600,
    targetWordCount: 120,
    charactersPerSecond: 10,
    wordsPerMinute: 120
  };
  assert.match(narrationTimingInstruction(timing, 30), /300 знаков/);
  assert.match(narrationTimingInstruction(timing, 30), /60 слов/);

  const scene: Scene = {
    id: "scene-1",
    order: 0,
    title: "Сцена",
    narration: "Очень длинная реплика ".repeat(12),
    imagePrompt: "single coherent shot",
    animationPrompt: "slow camera push-in",
    durationSeconds: 5,
    status: "draft"
  };
  const issue = findSceneIssues([scene], 1, { ...timing, charactersPerSecond: 4 });
  assert.equal(issue.some((item) => item.kind === "length" && /выбранного голоса/.test(item.reason)), true);
});

test("generated AI narration checks the calibrated total, not nominal frame slots; production remains non-rewriting", () => {
  const timing = {targetSeconds:30, targetCharacterCount:300, targetWordCount:60, charactersPerSecond:10, wordsPerMinute:120};
  const make = (count:number): Scene => ({id:"timing", order:0, title:"Итог", narration:"А".repeat(count),
    imagePrompt:"quiet home", animationPrompt:"slow zoom", durationSeconds:30, status:"draft"});
  assert.equal(inspectGeneratedScenarioReadiness([make(270)],30,timing).ok,false);
  assert.equal(inspectGeneratedScenarioReadiness([make(330)],30,timing).ok,false);
  for (const count of [285,300,315]) assert.equal(inspectGeneratedScenarioReadiness([make(count)],30,timing).ok,true);
  assert.equal(inspectGeneratedScenarioReadiness([make(300),{...make(300),includeInAssembly:false}],30,timing).ok,true);
  assert.equal(inspectScenarioReadiness([make(270)],30,timing).ok,true,"existing production/ready text must not acquire a rewriting gate");
  assert.equal(inspectGeneratedScenarioReadiness([make(270)],30).ok,true,"no fabricated calibration");
});

test("legacy saved AI frame draft repairs timing once and re-audits before ready", async () => {
  const client = new AnyModelClient({publicSettings:async()=>({textModel:"test-model"})} as never);
  const makeScenes = (characters:number): Scene[] => Array.from({length:6},(_,order)=>({id:`timing-${order}`,order,title:`Кадр ${order+1}`,
    narration:String.fromCharCode(1040+order).repeat(characters),imagePrompt:`unique shot ${order}`,animationPrompt:"slow push",durationSeconds:5,status:"draft"}));
  let auditCalls=0, repairCalls=0;
  const internal = client as unknown as {
    createScenarioPlan():Promise<unknown>; buildScenes():Promise<Scene[]>; reviewScenes(plan:unknown,scenes:Scene[]):Promise<Scene[]>;
    auditScenarioCompleteness():Promise<unknown>; repairIncompleteScenario(...args:unknown[]):Promise<Scene[]>;
  };
  internal.createScenarioPlan=async()=>({sections:[{title:"История"}],requiredBeats:[]});
  internal.buildScenes=async()=>makeScenes(45);
  internal.reviewScenes=async(_plan,scenes)=>scenes;
  internal.auditScenarioCompleteness=async()=>{auditCalls++;return {complete:true,endingResolved:true,missingRequiredBeats:[],unresolvedSetups:[],rewriteFromScene:6,reason:"Сюжет завершён"};};
  internal.repairIncompleteScenario=async(...args)=>{
    repairCalls++;
    assert.match((args[6] as {errors:string[]}).errors.join(" "),/общая оценка озвучки/);
    assert.equal(args[12],true,"global timing budget enabled only for generated AI Story");
    return makeScenes(50);
  };
  const result=await client.regenerateScenes({sourceUrl:"qa://timing",sourceTitle:"История",niche:"AI Story",targetAudience:"Зрители",hook:"Начало",
    structure:[],strengths:[],improvements:[],suggestedAngle:"История",suggestedTitle:"История",recommendedDurationSeconds:30,language:"Русский",scenes:[],provider:"test"},
    // This regression exercises the preserved scene-first repair path. New
    // projects use narration-first; provide the actual saved legacy prefix.
    30,undefined,undefined,undefined,"local",undefined,{targetSeconds:30,targetCharacterCount:300,targetWordCount:60,charactersPerSecond:10,wordsPerMinute:120},makeScenes(45),"ai-story");
  assert.equal(repairCalls,1);
  assert.equal(auditCalls,2);
  assert.equal(result.scenarioQuality?.complete,true);
  assert.equal(result.scenarioQuality?.repaired,true);
  assert.equal(result.scenes.reduce((sum,scene)=>sum+countNarrationCharacters(scene.narration),0),300);
});

test("Lumean повторяет только безопасные GET/storage/CDN этапы и создаёт один заказ", async () => {
  const audio = Buffer.from("valid-mp3-bytes");
  let templateGets = 0;
  let orderPosts = 0;
  let storagePosts = 0;
  let downloads = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/templates")) {
      templateGets += 1;
      if (templateGets < 3) throw fetchFailure("UND_ERR_CONNECT_TIMEOUT");
      return lumeanOk([{ id: "template-1", name: "Narrator", service_key: "elevenlabs" }]);
    }
    if (url.endsWith("/orders") && init?.method === "POST") {
      orderPosts += 1;
      return lumeanOk({ id: "order-safe", status: "pending" });
    }
    if (url.endsWith("/orders/order-safe")) {
      return lumeanOk({
        id: "order-safe",
        status: "completed",
        result: { service_files: ["orders/order-safe/result.mp3"] }
      });
    }
    if (url.endsWith("/storage/url")) {
      storagePosts += 1;
      if (storagePosts === 1) throw fetchFailure("ECONNRESET");
      return lumeanOk({ url: `https://cdn.lumean.test/result.mp3?signature=secret-${storagePosts}` });
    }
    if (url.startsWith("https://cdn.lumean.test/result.mp3")) {
      downloads += 1;
      if (downloads === 1) throw fetchFailure("UND_ERR_CONNECT_TIMEOUT");
      return new Response(audio, { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const client = voicerForReliabilityTest(fetchImpl);

  assert.equal((await client.templates())[0]?.uuid, "template-1");
  assert.deepEqual(await client.tts("Тестовая озвучка", "template-1"), audio);
  assert.equal(templateGets, 3);
  assert.equal(orderPosts, 1, "POST /orders нельзя повторять");
  assert.equal(storagePosts, 3, "после CDN-сбоя должна запрашиваться свежая signed URL");
  assert.equal(downloads, 2);
});

test("Lumean показывает безопасный nested network code без signed URL", async () => {
  let orderPosts = 0;
  let downloads = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/orders") && init?.method === "POST") {
      orderPosts += 1;
      return lumeanOk({
        id: "order-network-code",
        status: "completed",
        result: { files: ["voice.mp3"] }
      });
    }
    if (url.endsWith("/storage/url")) {
      return lumeanOk({ url: "https://cdn.lumean.test/voice.mp3?signature=must-not-leak" });
    }
    if (url.startsWith("https://cdn.lumean.test/voice.mp3")) {
      downloads += 1;
      throw fetchFailure("UND_ERR_CONNECT_TIMEOUT");
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const client = voicerForReliabilityTest(fetchImpl, { safeRetryAttempts: 2 });

  let caught: unknown;
  try {
    await client.tts("Тестовая озвучка", "template-1");
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof VoicerClientError);
  assert.match(caught.userMessage, /UND_ERR_CONNECT_TIMEOUT/);
  assert.doesNotMatch(caught.userMessage, /must-not-leak/);
  assert.equal(caught.retryable, false, "всю генерацию повторять нельзя — заказ уже создан");
  assert.equal(caught.orderKnown, true);
  assert.equal(orderPosts, 1);
  assert.equal(downloads, 2);
});

test("калибровка Lumean после сбоя восстанавливает известный заказ из checkpoint без новой квоты", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-lumean-resume-"));
  const audio = Buffer.from("recovered-mp3");
  let firstInvocation = true;
  let orderPosts = 0;
  let orderGets = 0;
  let storagePosts = 0;
  try {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/orders") && init?.method === "POST") {
        orderPosts += 1;
        return lumeanOk({
          id: "order-resumable",
          status: "completed",
          result: { files: ["orders/order-resumable/result.mp3"] }
        });
      }
      if (url.endsWith("/orders/order-resumable")) {
        orderGets += 1;
        return lumeanOk({
          id: "order-resumable",
          status: "completed",
          result: { files: ["orders/order-resumable/result.mp3"] }
        });
      }
      if (url.endsWith("/storage/url")) {
        storagePosts += 1;
        return lumeanOk({ url: "https://cdn.lumean.test/resumable.mp3?signature=private" });
      }
      if (url.startsWith("https://cdn.lumean.test/resumable.mp3")) {
        if (firstInvocation) throw fetchFailure("UND_ERR_CONNECT_TIMEOUT");
        return new Response(audio, { status: 200 });
      }
      throw new Error(`unexpected URL ${url}`);
    };

    const firstClient = voicerForReliabilityTest(fetchImpl, { safeRetryAttempts: 2 });
    await assert.rejects(firstClient.ttsSample("template-recovery", "ru", directory), /UND_ERR_CONNECT_TIMEOUT/);
    assert.equal(orderPosts, 1);
    const afterFailure = await readdir(directory);
    const checkpointName = afterFailure.find((name) => name.endsWith(".order.json"));
    assert.ok(checkpointName, "orderId должен пережить сетевой сбой");
    const checkpointText = await readFile(join(directory, checkpointName), "utf8");
    assert.match(checkpointText, /order-resumable/);
    assert.match(checkpointText, /https:\/\/api\.lumean\.test\/api\/public/);
    assert.match(checkpointText, /apiKeyFingerprint/);
    assert.doesNotMatch(checkpointText, /test-api-key|signature=private|Этот голос будет/);

    firstInvocation = false;
    const restartedClient = voicerForReliabilityTest(fetchImpl, { safeRetryAttempts: 2 });
    const result = await restartedClient.ttsSample("template-recovery", "ru", directory);
    assert.deepEqual(Buffer.from(result, "base64"), audio);
    assert.equal(orderPosts, 1, "после перезапуска нельзя создавать второй заказ");
    assert.ok(orderGets >= 1, "из checkpoint должен проверяться уже известный заказ");
    assert.ok(storagePosts >= 3, "готовый заказ должен получить новую signed URL");
    assert.equal((await readdir(directory)).some((name) => name.endsWith(".order.json")), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("checkpoint калибровки Lumean не переносится на другой API-ключ", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-lumean-account-scope-"));
  let orderPosts = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/orders") && init?.method === "POST") {
      orderPosts += 1;
      const key = new Headers(init.headers).get("X-API-KEY");
      const id = key === "account-a-key" ? "order-account-a" : "order-account-b";
      return lumeanOk({ id, status: "completed", result: { files: [`${id}.mp3`] } });
    }
    if (url.endsWith("/storage/url")) return lumeanOk({ url: "https://cdn.lumean.test/account.mp3" });
    if (url === "https://cdn.lumean.test/account.mp3") throw fetchFailure("UND_ERR_CONNECT_TIMEOUT");
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    const accountA = voicerForReliabilityTest(fetchImpl, { safeRetryAttempts: 1 }, { apiKey: "account-a-key" });
    await assert.rejects(accountA.ttsSample("template-same", "ru", directory));
    const accountB = voicerForReliabilityTest(fetchImpl, { safeRetryAttempts: 1 }, { apiKey: "account-b-key" });
    await assert.rejects(accountB.ttsSample("template-same", "ru", directory));

    assert.equal(orderPosts, 2, "другой аккаунт должен иметь независимый заказ");
    assert.equal((await readdir(directory)).filter((name) => name.endsWith(".order.json")).length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("abort во время скачивания известного заказа не запускает retry или новый POST /orders", async () => {
  const controller = new AbortController();
  let orderPosts = 0;
  let downloads = 0;
  let notifyDownload: (() => void) | undefined;
  const downloadStarted = new Promise<void>((resolve) => { notifyDownload = resolve; });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/orders") && init?.method === "POST") {
      orderPosts += 1;
      return lumeanOk({
        id: "order-abort",
        status: "completed",
        result: { files: ["voice.mp3"] }
      });
    }
    if (url.endsWith("/storage/url")) return lumeanOk({ url: "https://cdn.lumean.test/abort.mp3" });
    if (url === "https://cdn.lumean.test/abort.mp3") {
      downloads += 1;
      notifyDownload?.();
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(init?.signal?.reason ?? new Error("aborted"));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const client = voicerForReliabilityTest(fetchImpl);
  const pending = client.tts("Тестовая озвучка", "template-1", controller.signal);
  await downloadStarted;
  controller.abort(new Error("user stopped"));

  let caught: unknown;
  try {
    await pending;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof VoicerAbortError);
  assert.equal(caught.name, "AbortError");
  assert.equal(orderPosts, 1);
  assert.equal(downloads, 1);
});
