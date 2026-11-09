import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createNetServer } from "node:net";
import test from "node:test";
import { projectEditorReady } from '@gold-work/shared';
import ffmpegPath from "ffmpeg-static";
import { MemoryProjectRepository, MemoryTaskRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { AI_STORY_HARD_MAX_SCENE_SECONDS, allocateAiStorySceneDurations, allocateSceneDurations, createDefaultProjectSettings, createNarrationTimingBudget, parseYouTubeChannelRef, scenarioQualityFingerprint, tryParseYouTubeVideoId, IMAGE_STYLES, TTS_VOICES, type Project, type QueueTask, type ReferenceAnalysis, type Scene, type VoiceCalibration } from "@gold-work/shared";
import { assColor, assTime, atempoFactors, karaokeText, mediaDurationSeconds, narrationCues, resolveKenBurnsDirection, resolveKenBurnsZoom, resolveSceneTransition, resolveTimelineTiming, resolveTransitionDuration, resolveVolumePercent, shouldUseAiVideo, StandardRenderer } from "./standard-renderer.js";
import { AnyModelClient, buildChannelChatContext, extractJson, findSceneIssues, inspectScenarioReadiness, isTemporaryModelUnavailable, parseProviderRetryAfterMs, parseSceneArray, resumableScenarioDraft, scenarioFingerprint, scenarioRepairRequestProfile, toStringList, ttsModelId, withDirectorSystemPrompt } from "./anymodel-client.js";
import { ChatTopicRepository } from "./chat-topic-repository.js";
import { createSocks5BrowserProxyBridge, parseProxyUrl, type ProxyResponse } from "./proxy-utils.js";
import { cleanErrorMessage, describeNetworkError, googleError, isPermanentFailure } from "./google-errors.js";
import { frameSize } from "./media-utils.js";
import { TextFileLogger } from "./text-file-logger.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { MockGenerationPipeline } from "./mock-generation-pipeline.js";
import { createMediaFileResponse, parseMediaByteRange } from "./media-range.js";
import { flowCookieHeader, flowCookieSetDetails, parseFlowCookies } from "./flow-cookie-import.js";
import { FlowClient, type FlowRemoteVideoJob } from "./flow-client.js";
import { ChannelProfileStore } from "./channel-profile-store.js";
import { VoicerAbortError, VoicerClient, VoicerClientError, type VoicerClientOptions } from "./voicer-client.js";
import { inspectNarration } from "./standard-renderer.js";
import { applyMeasuredStoryTiming, measuredStoryTimingExpansion } from "./measured-story-timing.js";
import { plannedStoryTimingPatch } from "./planned-story-timing.js";
import {
  FLOW_HOME,
  FLOW_TOOL_URL,
  buildFlowImagePayload,
  buildFlowVideoPayload,
  findFlowMedia,
  flowAccountTier,
  flowAspectRatio,
  flowBrowserUserAgent,
  flowImageAspectRatio,
  flowImagePlans,
  flowMediaDownloadUrl,
  flowMediaStatus,
  flowPaygateTier,
  flowTrpcInput,
  flowTrpcQueryUrl,
  flowVideoPlans,
  isBenignFlowNavigationAbort,
  shouldReturnToFlowAfterLogin,
} from "./flow-protocol.js";

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

function makeScenarioQuality(
  scenes: Scene[],
  patch: Partial<NonNullable<ReferenceAnalysis["scenarioQuality"]>> = {}
): NonNullable<ReferenceAnalysis["scenarioQuality"]> {
  return {
    version: 1,
    checkedAt: new Date().toISOString(),
    targetSeconds: scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0),
    totalDurationSeconds: scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0),
    wordCount: scenes.reduce((sum, scene) => sum + scene.narration.split(/\s+/u).filter(Boolean).length, 0),
    sceneCount: scenes.length,
    fingerprint: scenarioFingerprint(scenes),
    complete: true,
    endingResolved: true,
    repaired: false,
    requiredBeats: [],
    ...patch
  };
}

function makeStockSource(mediaType: "image" | "video" = "image"): NonNullable<Scene["stockSource"]> {
  return {
    provider: "pexels",
    assetId: "stock-1",
    mediaType,
    query: "cat",
    pageUrl: "https://www.pexels.com/photo/stock-1/",
    author: "Test Author",
    attribution: "Test Author / Pexels",
    licenseUrl: "https://www.pexels.com/license/",
    downloadedAt: new Date(0).toISOString(),
  };
}

function makeTinyBmp(): Buffer {
  const width = 2;
  const height = 2;
  const rowSize = 8;
  const pixelBytes = rowSize * height;
  const bytes = Buffer.alloc(54 + pixelBytes);
  bytes.write("BM", 0, "ascii");
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(pixelBytes, 34);
  bytes.fill(0x7f, 54);
  return bytes;
}

function makeSolidBmp(red: number, green: number, blue: number): Buffer {
  const width = 2;
  const height = 2;
  const rowSize = 8;
  const pixelBytes = rowSize * height;
  const bytes = Buffer.alloc(54 + pixelBytes);
  bytes.write("BM", 0, "ascii");
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(pixelBytes, 34);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = 54 + y * rowSize + x * 3;
      bytes[offset] = blue;
      bytes[offset + 1] = green;
      bytes[offset + 2] = red;
    }
  }
  return bytes;
}

function runTestFfmpeg(args: string[]): Promise<void> {
  const executable = ffmpegPath?.replace("app.asar", "app.asar.unpacked");
  if (!executable) return Promise.reject(new Error("FFmpeg недоступен"));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_000);
    });
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolve()
      : reject(new Error(`Test FFmpeg завершился с кодом ${code}: ${stderr}`)));
  });
}

function sampleVideoRgb(path: string, seconds: number): Promise<[number, number, number]> {
  const executable = ffmpegPath?.replace("app.asar", "app.asar.unpacked");
  if (!executable) return Promise.reject(new Error("FFmpeg недоступен"));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [
      "-hide_banner",
      "-loglevel", "error",
      "-i", path,
      "-ss", seconds.toFixed(3),
      "-frames:v", "1",
      "-vf", "scale=1:1",
      "-pix_fmt", "rgb24",
      "-f", "rawvideo",
      "pipe:1"
    ], { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2_000); });
    child.once("error", reject);
    child.once("close", (code) => {
      const output = Buffer.concat(chunks);
      if (code !== 0 || output.length < 3) return reject(new Error(`Не удалось прочитать кадр: ${stderr}`));
      resolve([output[0] as number, output[1] as number, output[2] as number]);
    });
  });
}

async function createTinyAvClip(path: string, durationSeconds: number): Promise<void> {
  await runTestFfmpeg([
    "-y",
    "-f", "lavfi",
    "-i", "color=c=black:s=64x36:r=30",
    "-f", "lavfi",
    "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-t", String(durationSeconds),
    "-shortest",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "35",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "32k",
    "-ar", "48000",
    "-movflags", "+faststart",
    path
  ]);
}

async function createQuietVoiceWithTrailingSilence(
  path: string,
  speechSeconds: number,
  silenceSeconds: number,
  volume = 0.01
): Promise<void> {
  await runTestFfmpeg([
    "-y",
    "-f", "lavfi",
    "-i", `sine=frequency=440:sample_rate=48000:duration=${speechSeconds}`,
    "-f", "lavfi",
    "-i", `anullsrc=channel_layout=mono:sample_rate=48000:duration=${silenceSeconds}`,
    "-filter_complex", `[0:a]volume=${volume}[speech];[speech][1:a]concat=n=2:v=0:a=1[aout]`,
    "-map", "[aout]",
    "-c:a", "pcm_s16le",
    path
  ]);
}

async function createVoiceWithLeadingAndInternalSilence(path: string): Promise<void> {
  await runTestFfmpeg([
    "-y",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=48000:duration=0.6",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=0.5",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=48000:duration=0.3",
    "-f", "lavfi", "-i", "sine=frequency=520:sample_rate=48000:duration=0.5",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=48000:duration=0.8",
    "-filter_complex", "[1:a]volume=0.1[first];[3:a]volume=0.1[second];[0:a][first][2:a][second][4:a]concat=n=5:v=0:a=1[aout]",
    "-map", "[aout]",
    "-c:a", "pcm_s16le",
    path
  ]);
}

function audioIntegratedLufs(path: string): Promise<number> {
  const executable = ffmpegPath?.replace("app.asar", "app.asar.unpacked");
  if (!executable) return Promise.resolve(Number.NaN);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-hide_banner", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_000); });
    child.once("error", reject);
    child.once("close", () => {
      const matches = [...stderr.matchAll(/I:\s*(-?[\d.]+)\s*LUFS/g)];
      const match = matches.at(-1);
      if (!match) return reject(new Error(`FFmpeg не вернул integrated loudness: ${stderr}`));
      resolve(Number(match[1]));
    });
  });
}

test("AnyModel: длительный retry_after распознаётся без обрезания до 20 секунд", () => {
  const body = JSON.stringify({
    error: {
      message: "The selected model is temporarily unavailable. Retry in 10008s.",
      retry_after_seconds: 10008
    }
  });
  assert.equal(parseProviderRetryAfterMs(null, body, 0), 10_008_000);
  assert.equal(isTemporaryModelUnavailable(body), true);
});

test("AnyModel: Retry-After поддерживает секунды и абсолютную дату", () => {
  assert.equal(parseProviderRetryAfterMs("12", "", 1_000), 12_000);
  assert.equal(parseProviderRetryAfterMs("Thu, 01 Jan 1970 00:01:01 GMT", "", 1_000), 60_000);
});

test("AnyModel: перегруженный provider pool распознаётся как временная ошибка", () => {
  const body = JSON.stringify({
    error: {
      message: "The service is temporarily unavailable. Try again later. Retry in 60s.",
      type: "rate_limit_error",
      code: "provider_pool_retry_suppressed",
      retry_after_seconds: 60
    }
  });
  assert.equal(isTemporaryModelUnavailable(body), true);
  assert.equal(parseProviderRetryAfterMs(null, body, 0), 60_000);
});

test("AnyModel: сохранённая транскрипция объединяется с главным system-промптом", () => {
  const messages = withDirectorSystemPrompt([
    { role: "system", content: "Сохранённая транскрипция: полный текст ролика" },
    { role: "user", content: "Разбери её" },
  ]);
  assert.equal(messages.filter((message) => message.role === "system").length, 1);
  assert.match(messages[0]!.content, /AI-режиссёр Gold Work Studio/);
  assert.match(messages[0]!.content, /Сохранённая транскрипция: полный текст ролика/);
  assert.deepEqual(messages[1], { role: "user", content: "Разбери её" });
});

test("AnyModel: живой чат получает Master Prompt и материалы привязанного ролика", () => {
  const context = buildChannelChatContext(
    { masterPrompt: "Пиши спокойно и без кликбейта" },
    {
      videoBrief: {
        prompt: "Ролик о первых железных дорогах",
        competitorTranscripts: [{ id: "t1", name: "reference.txt", text: "Начало конкурентного ролика" }]
      }
    }
  );
  assert.match(context, /MASTER PROMPT КАНАЛА:\nПиши спокойно/);
  assert.match(context, /ЗАДАЧА ТЕКУЩЕГО РОЛИКА:\nРолик о первых железных дорогах/);
  assert.match(context, /ТОЛЬКО СПРАВОЧНЫЙ МАТЕРИАЛ/);
  assert.match(context, /reference\.txt/);
});

test("AnyModel: референс героя соблюдает ручное описание и единый стиль ролика", async () => {
  const project = makeProject({
    topic: "История Максима",
    scenes: [makeScene({ narration: "Максим проверяет свою первую идею.", imagePrompt: "Maxim at work" })],
  });
  project.settings.image.style = "hand-drawn editorial comic, soft pastel palette";
  const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "test-model" }) } as never);
  let userMessage = "";
  let imagePrompt = "";
  (client as unknown as {
    chat(model: string, messages: Array<{ role: string; content: string }>): Promise<string>;
  }).chat = async (_model, messages) => {
    userMessage = messages.find((message) => message.role === "user")?.content ?? "";
    return JSON.stringify({
      name: "Максим",
      prompt: "37-year-old man, round face, short dark hair, grey-blue shirt, brown belt",
    });
  };

  const result = await client.characterReference(
    project,
    undefined,
    async (prompt) => {
      imagePrompt = prompt;
      return Buffer.from("portrait");
    },
    "37 лет, круглое лицо, короткие тёмные волосы и серо-голубая рубашка",
  );

  assert.match(userMessage, /Обязательные пожелания пользователя/);
  assert.match(userMessage, /серо-голубая рубашка/);
  assert.match(imagePrompt, /37-year-old man/);
  assert.match(imagePrompt, /Style: hand-drawn editorial comic, soft pastel palette/);
  assert.equal(result.name, "Максим");
  assert.deepEqual(result.image, Buffer.from("portrait"));
});

test("Flow cookies: JSON и chunked NextAuth cookie сохраняются по порядку", () => {
  const cookies = parseFlowCookies(JSON.stringify([
    { name: "__Secure-next-auth.session-token.0", value: "part-a", domain: ".labs.google", expirationDate: 2_000_000_000 },
    { name: "__Secure-next-auth.session-token.1", value: "part-b", domain: ".labs.google", expirationDate: 2_000_000_000 },
  ]));
  assert.equal(cookies.length, 2);
  assert.equal(
    flowCookieHeader(cookies),
    "__Secure-next-auth.session-token.0=part-a; __Secure-next-auth.session-token.1=part-b"
  );
});

test("Flow cookies: Netscape и голое значение session token поддерживаются", () => {
  const netscape = ".labs.google\tTRUE\t/\tTRUE\t2000000000\t__Secure-next-auth.session-token\tsecret";
  assert.equal(parseFlowCookies(netscape)[0]?.value, "secret");
  assert.equal(parseFlowCookies("raw-token")[0]?.name, "__Secure-next-auth.session-token");
  assert.throws(() => parseFlowCookies("foo=bar"), /session-token/);
});

test("Flow cookies: Chromium-префиксы получают обязательные безопасные атрибуты", () => {
  const host = flowCookieSetDetails({
    name: "__Host-test",
    value: "host-value",
    domain: ".labs.google",
    path: "/wrong",
    secure: false,
    httpOnly: false,
  });
  assert.equal(host.domain, undefined);
  assert.equal(host.path, "/");
  assert.equal(host.secure, true);

  const secure = flowCookieSetDetails({
    name: "__Secure-next-auth.session-token",
    value: "session-value",
    domain: ".labs.google",
    path: "/",
    secure: false,
    httpOnly: true,
  });
  assert.equal(secure.domain, ".labs.google");
  assert.equal(secure.secure, true);
  assert.equal(
    flowCookieHeader([
      { name: "__Host-test", value: "host-value" },
      { name: "__Secure-next-auth.session-token", value: "session-value" },
    ]),
    "__Secure-next-auth.session-token=session-value"
  );
});

test("Flow protocol: тарифы и aspect ratio совпадают с enum API", () => {
  assert.equal(FLOW_HOME, "https://labs.google/fx/tools/flow");
  assert.equal(FLOW_TOOL_URL, FLOW_HOME);
  assert.equal(flowPaygateTier("FREE"), "PAYGATE_TIER_NOT_PAID");
  assert.equal(flowPaygateTier("PRO"), "PAYGATE_TIER_ONE");
  assert.equal(flowPaygateTier("ULTRA"), "PAYGATE_TIER_TWO");
  assert.equal(flowAccountTier("PAYGATE_TIER_TIER1P5"), "ULTRA1P5");
  assert.equal(flowAspectRatio("9:16"), "VIDEO_ASPECT_RATIO_PORTRAIT");
  assert.equal(flowAspectRatio("16:9"), "VIDEO_ASPECT_RATIO_LANDSCAPE");
});

test("Flow navigation: безопасный Google redirect ERR_ABORTED не ломает проверку аккаунта", () => {
  assert.equal(
    isBenignFlowNavigationAbort(
      new Error("ERR_ABORTED (-3) loading 'https://labs.google/'"),
      "https://labs.google/fx/flow"
    ),
    true
  );
  assert.equal(
    isBenignFlowNavigationAbort(
      { code: "ERR_ABORTED", errno: -3 },
      "https://accounts.google.com/signin"
    ),
    true
  );
  assert.equal(
    isBenignFlowNavigationAbort(
      new Error("ERR_NAME_NOT_RESOLVED (-105) loading 'https://labs.google/fx/flow'"),
      "https://labs.google/fx/flow"
    ),
    false
  );
  assert.equal(
    isBenignFlowNavigationAbort(
      new Error("ERR_ABORTED (-3) loading 'https://example.invalid/'")
    ),
    false
  );
});

test("Flow auth: Google получает Chrome User-Agent без маркера Electron", () => {
  const electronUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.7103.177 Electron/36.9.5 Safari/537.36";
  const userAgent = flowBrowserUserAgent(electronUserAgent);
  assert.doesNotMatch(userAgent, /Electron\//i);
  assert.match(userAgent, /Chrome\/136\.0\.7103\.177/);
  assert.match(userAgent, /Safari\/537\.36$/);
});

test("Flow auth: после Google One вход один раз возвращается в Flow", () => {
  assert.equal(
    shouldReturnToFlowAfterLogin("https://one.google.com/explore-plan", true, false),
    true
  );
  assert.equal(
    shouldReturnToFlowAfterLogin("https://accounts.google.com/signin", true, false),
    false
  );
  assert.equal(
    shouldReturnToFlowAfterLogin("https://labs.google/fx/tools/flow", true, false),
    false
  );
  assert.equal(
    shouldReturnToFlowAfterLogin("https://one.google.com/explore-plan", true, true),
    false
  );
});

test("Flow tRPC: input и query используют envelope текущего web-клиента", () => {
  assert.deepEqual(
    flowTrpcInput({ projectTitle: "Gold Work Studio", toolName: "PINHOLE" }),
    { json: { projectTitle: "Gold Work Studio", toolName: "PINHOLE" } }
  );
  const url = new URL(flowTrpcQueryUrl(
    "https://labs.google/fx/api/trpc/media.getMediaUrlRedirect",
    { name: "projects/p/media/1" }
  ));
  assert.deepEqual(
    JSON.parse(url.searchParams.get("input") ?? ""),
    { json: { name: "projects/p/media/1" } }
  );
  const mediaUrl = new URL(flowMediaDownloadUrl("projects/p/media/a b"));
  assert.equal(mediaUrl.searchParams.get("name"), "projects/p/media/a b");
  assert.equal(mediaUrl.searchParams.has("input"), false);
});

test("Flow protocol: image-to-video payload содержит подтверждённые поля web-клиента", () => {
  const payload = buildFlowVideoPayload({
    prompt: "Камера медленно приближается",
    aspectRatio: "9:16",
    projectId: "project-1",
    paygateTier: "PRO",
    sessionId: "session-1",
    recaptchaToken: "captcha-token",
    modelKey: "VEO_3_1_I2V_12STEP",
    startImageId: "media-1",
    batchId: "batch-1",
    seed: 42,
  });
  assert.deepEqual(payload, {
    mediaGenerationContext: {
      batchId: "batch-1",
      audioFailurePreference: "BLOCK_SILENCED_VIDEOS",
    },
    clientContext: {
      projectId: "project-1",
      tool: "PINHOLE",
      userPaygateTier: "PAYGATE_TIER_ONE",
      sessionId: "session-1",
      recaptchaContext: {
        token: "captcha-token",
        applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
      },
    },
    requests: [{
      aspectRatio: "VIDEO_ASPECT_RATIO_PORTRAIT",
      textInput: { prompt: "Камера медленно приближается" },
      videoModelKey: "VEO_3_1_I2V_12STEP",
      seed: 42,
      startImage: { mediaId: "media-1" },
    }],
    useV2ModelConfig: true,
  });
});

test("Flow protocol: payload изображения совпадает с batchGenerateImages web-клиента", () => {
  const payload = buildFlowImagePayload({
    prompt: "Кинематографичный ночной город",
    aspectRatio: "16:9",
    projectId: "project-1",
    sessionId: "session-1",
    recaptchaToken: "captcha-token",
    modelKey: "GEM_PIX_2",
    referenceImageIds: ["reference-1"],
    batchId: "batch-1",
    seed: 42,
  });
  assert.equal(flowImageAspectRatio("9:16"), "IMAGE_ASPECT_RATIO_PORTRAIT");
  assert.equal(flowImageAspectRatio("1:1"), "IMAGE_ASPECT_RATIO_SQUARE");
  assert.equal(flowImagePlans()[0]?.modelKey, "GEM_PIX_2");
  assert.deepEqual(payload, {
    clientContext: {
      projectId: "project-1",
      tool: "PINHOLE",
      sessionId: "session-1",
      recaptchaContext: {
        token: "captcha-token",
        applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
      },
    },
    mediaGenerationContext: {
      batchId: "batch-1",
    },
    useNewMedia: true,
    requests: [{
      clientContext: {
        projectId: "project-1",
        tool: "PINHOLE",
        sessionId: "session-1",
        recaptchaContext: {
          token: "captcha-token",
          applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
        },
      },
      imageModelName: "GEM_PIX_2",
      imageAspectRatio: "IMAGE_ASPECT_RATIO_LANDSCAPE",
      structuredPrompt: {
        parts: [{
          text: "Кинематографичный ночной город",
        }],
      },
      seed: 42,
      imageInputs: [{
        imageInputType: "IMAGE_INPUT_TYPE_REFERENCE",
        name: "reference-1",
      }],
    }],
  });
});

test("Flow protocol: режим и модель выбираются для text/start/start+end", () => {
  assert.equal(flowVideoPlans(undefined, false, false)[0]?.apiPath, "batchAsyncGenerateVideoText");
  assert.equal(flowVideoPlans(undefined, true, false)[0]?.modelKey, "veo_3_1_i2v_s_fast");
  assert.equal(flowVideoPlans("veo_3_1_t2v_lite", true, false)[0]?.modelKey, "veo_3_1_t2v_lite");
  assert.deepEqual(flowVideoPlans("VEO_2_1_I2V", true, false)[0], {
    apiPath: "batchAsyncGenerateVideoStartImage",
    modelKey: "VEO_2_1_I2V",
  });
  assert.equal(
    flowVideoPlans(undefined, true, true)[0]?.apiPath,
    "batchAsyncGenerateVideoStartAndEndImage"
  );
  assert.equal(flowVideoPlans("veo_3_1_i2v_s_fast", true, false).length, 1);
  assert.equal(
    flowVideoPlans("VEO_3_1_I2V_12STEP", true, false)[0]?.modelKey,
    "VEO_3_1_I2V_12STEP"
  );
});

test("Flow protocol: media и статус находятся внутри result", () => {
  const response = {
    result: {
      media: [{
        name: "projects/p/media/123",
        workflowId: "projects/p/workflows/456",
        mediaMetadata: {
          mediaStatus: {
            mediaGenerationStatus: "MEDIA_GENERATION_STATUS_SUCCESSFUL",
          },
        },
      }],
    },
  };
  const media = findFlowMedia(response);
  assert.equal(media?.name, "projects/p/media/123");
  assert.equal(flowMediaStatus(media), "MEDIA_GENERATION_STATUS_SUCCESSFUL");
});

test("Flow client: project → upload → generate → poll → MP4 проходит целиком", async () => {
  const account = {
    id: "flow-1",
    email: "flow@example.com",
    enabled: true,
    videoEnabled: true,
    status: "ready",
    tier: "FREE",
    tokenExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  } as const;
  const calls: Array<{ url: string; body?: unknown; init?: RequestInit }> = [];
  const mp4 = Buffer.alloc(2_048);
  mp4.write("ftyp", 4, "ascii");
  const fakeSession = {
    fetch: async (input: string, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
      calls.push({ url, body, init });
      if (url.includes("project.createProject")) {
        return new Response(JSON.stringify({
          result: {
            data: {
              json: {
                result: { projectId: "project-1" },
              },
            },
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/v1/flow/uploadImage")) {
        return new Response(JSON.stringify({
          result: {
            media: { name: "image-1", workflowId: "image-workflow", image: {} },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("batchAsyncGenerateVideoStartImage")) {
        return new Response(JSON.stringify({
          result: {
            media: [{
              name: "video-1",
              workflowId: "video-workflow",
              mediaMetadata: {
                mediaStatus: { mediaGenerationStatus: "MEDIA_GENERATION_STATUS_SCHEDULED" },
              },
            }],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("batchCheckAsyncVideoGenerationStatus")) {
        return new Response(JSON.stringify({
          result: {
            media: [{
              name: "video-1",
              workflowId: "video-workflow",
              video: { generatedVideo: {} },
              mediaMetadata: {
                mediaStatus: { mediaGenerationStatus: "MEDIA_GENERATION_STATUS_SUCCESSFUL" },
              },
            }],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("media.getMediaUrlRedirect")) {
        throw new Error("Redirect was cancelled");
      }
      if (url.startsWith("https://storage.example.test/")) {
        return new Response(mp4, { status: 200, headers: { "content-type": "video/mp4" } });
      }
      return new Response("not found", { status: 404 });
    },
  };
  const directFetch = async (input: string | URL | globalThis.Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    calls.push({ url, body, init });
    if (url.includes("media.getMediaUrlRedirect")) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://storage.example.test/video-1.mp4?signed=yes" },
      });
    }
    return new Response("not found", { status: 404 });
  };
  const store = {
    list: async () => [account],
    secret: async () => ({ accessToken: "access-token" }),
    updateSession: async () => account,
  };
  const auth = {
    refresh: async () => account,
    refreshAll: async () => [account],
    prepareRuntime: async () => undefined,
    sessionFor: async () => fakeSession,
    recaptchaToken: async () => "recaptcha-token-long-enough",
  };
  const client = new FlowClient(store as never, auth as never, directFetch as typeof globalThis.fetch);
  (client as unknown as { delay: () => Promise<void> }).delay = async () => undefined;
  const progress: number[] = [];
  const stages: string[] = [];
  const result = await client.generateVideo({
    prompt: "animate",
    aspectRatio: "16:9",
    durationSeconds: 5,
    startFrame: makeTinyBmp(),
    onProgress: (update) => {
      progress.push(update.percent);
      stages.push(update.stage);
    },
  });
  assert.equal(result.length, mp4.length);
  assert.equal(progress.at(-1), 99);
  assert.equal(progress.every((value, index) => index === 0 || value >= (progress[index - 1] ?? 0)), true);
  assert.equal(stages.some((stage) => stage.includes("осталось примерно")), true);
  const projectCall = calls.find((call) => call.url.includes("project.createProject"));
  assert.equal(
    (projectCall?.body as { json?: { toolName?: string } }).json?.toolName,
    "PINHOLE"
  );
  assert.match(
    (projectCall?.body as { json?: { projectTitle?: string } }).json?.projectTitle ?? "",
    /^Gold Work Studio /
  );
  const submit = calls.find((call) => call.url.includes("batchAsyncGenerateVideoStartImage"));
  const upload = calls.find((call) => call.url.endsWith("/v1/flow/uploadImage"));
  const uploadBody = upload?.body as { mimeType?: string; imageBytes?: string; clientContext?: { tool?: string } };
  assert.equal(uploadBody.mimeType, "image/png");
  assert.equal(uploadBody.clientContext?.tool, "PINHOLE");
  const uploadedPng = Buffer.from(uploadBody.imageBytes ?? "", "base64");
  assert.deepEqual(
    uploadedPng.subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  );
  const reusedId = await (
    client as unknown as {
      uploadImage(
        browserSession: unknown,
        accessToken: string,
        projectId: string,
        image: Buffer,
        tool: "PINHOLE"
      ): Promise<string>;
    }
  ).uploadImage(fakeSession, "access-token", "project-1", uploadedPng, "PINHOLE");
  assert.equal(reusedId, "image-1");
  assert.equal(calls.filter((call) => call.url.endsWith("/v1/flow/uploadImage")).length, 1);
  assert.equal(
    (submit?.body as { requests?: Array<{ startImage?: { mediaId?: string } }> }).requests?.[0]?.startImage?.mediaId,
    "image-1"
  );
  assert.equal(
    (submit?.body as { requests?: Array<{ videoModelKey?: string }> }).requests?.[0]?.videoModelKey,
    "veo_3_1_i2v_s_fast"
  );
  assert.deepEqual(
    calls.map((call) =>
      call.url.includes("project.createProject") ? "project"
        : call.url.endsWith("/v1/flow/uploadImage") ? "upload"
          : call.url.includes("batchAsyncGenerateVideoStartImage") ? "generate"
            : call.url.includes("batchCheckAsyncVideoGenerationStatus") ? "poll"
              : call.url.includes("media.getMediaUrlRedirect") ? "download"
                : call.url.startsWith("https://storage.example.test/") ? "signed-download"
                : "other"
    ),
    ["project", "upload", "generate", "poll", "download", "signed-download"]
  );
  const download = calls.find((call) => call.url.includes("media.getMediaUrlRedirect"));
  const downloadUrl = new URL(download?.url ?? "https://invalid.local");
  assert.equal(downloadUrl.searchParams.get("name"), "video-1");
  assert.equal(downloadUrl.searchParams.has("input"), false);
  assert.equal(download?.init?.redirect, "manual");
  const signedDownload = calls.find((call) => call.url.startsWith("https://storage.example.test/"));
  assert.equal(signedDownload?.init?.redirect, "follow");
  const signedHeaders = new Headers(signedDownload?.init?.headers);
  assert.equal(signedHeaders.has("authorization"), false);
  assert.equal(signedHeaders.has("origin"), false);
  assert.equal(signedHeaders.has("referer"), false);
});

test("Flow client: ошибка скачивания продолжает прежнее media-задание без повторной генерации", async () => {
  const account = {
    id: "flow-resume-1",
    email: "flow-resume@example.com",
    enabled: true,
    videoEnabled: true,
    status: "ready",
    tier: "PRO",
    tokenExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  } as const;
  const mp4 = Buffer.alloc(2_048);
  mp4.write("ftyp", 4, "ascii");
  let generateCalls = 0;
  let downloadCalls = 0;
  const fakeSession = {
    fetch: async (input: string) => {
      const url = String(input);
      if (url.includes("project.createProject")) {
        return new Response(JSON.stringify({
          result: { data: { json: { result: { projectId: "project-resume-1" } } } },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("batchAsyncGenerateVideoText")) {
        generateCalls += 1;
        return new Response(JSON.stringify({
          result: {
            media: [{
              name: "video-resume-1",
              workflowId: "workflow-resume-1",
              mediaMetadata: {
                mediaStatus: { mediaGenerationStatus: "MEDIA_GENERATION_STATUS_SCHEDULED" },
              },
            }],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("batchCheckAsyncVideoGenerationStatus")) {
        return new Response(JSON.stringify({
          result: {
            media: [{
              name: "video-resume-1",
              workflowId: "workflow-resume-1",
              video: { generatedVideo: {} },
              mediaMetadata: {
                mediaStatus: { mediaGenerationStatus: "MEDIA_GENERATION_STATUS_SUCCESSFUL" },
              },
            }],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("media.getMediaUrlRedirect")) {
        downloadCalls += 1;
        return downloadCalls === 1
          ? new Response("temporary download failure", { status: 400 })
          : new Response(mp4, { status: 200, headers: { "content-type": "video/mp4" } });
      }
      return new Response("not found", { status: 404 });
    },
  };
  const store = {
    list: async () => [account],
    secret: async () => ({ accessToken: "access-token" }),
    updateSession: async () => account,
  };
  const auth = {
    refresh: async () => account,
    refreshAll: async () => [account],
    prepareRuntime: async () => undefined,
    sessionFor: async () => fakeSession,
    recaptchaToken: async () => "recaptcha-token-long-enough",
  };
  const client = new FlowClient(store as never, auth as never, fakeSession.fetch as typeof globalThis.fetch);
  (client as unknown as { delay: () => Promise<void> }).delay = async () => undefined;
  let remoteJob: FlowRemoteVideoJob | undefined;
  const input = {
    prompt: "animate",
    aspectRatio: "16:9",
    durationSeconds: 5,
    onRemoteJob: (job: FlowRemoteVideoJob | undefined) => {
      remoteJob = job;
    },
  };
  await assert.rejects(client.generateVideo(input), /HTTP 400/);
  assert.ok(remoteJob, "media-задание должно сохраняться сразу после отправки");
  const result = await client.generateVideo({ ...input, resumeJob: remoteJob });
  assert.equal(result.length, mp4.length);
  assert.equal(generateCalls, 1, "повтор скачивания не должен запускать вторую генерацию Veo");
  assert.equal(downloadCalls, 2);
});

test("Flow client: AnyModel fallback может создать и скачать изображение через Flow", async () => {
  const account = {
    id: "flow-image-1",
    email: "flow-image@example.com",
    enabled: true,
    videoEnabled: true,
    status: "ready",
    tier: "PRO",
    tokenExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  } as const;
  const calls: Array<{ url: string; body?: unknown }> = [];
  const recaptchaActions: string[] = [];
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4SIAAAAASUVORK5CYII=",
    "base64"
  );
  const fakeSession = {
    fetch: async (input: string, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
      calls.push({ url, body });
      if (url.includes("project.createProject")) {
        return new Response(JSON.stringify({
          result: { data: { json: { result: { projectId: "project-image-1" } } } },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/v1/flow/uploadImage")) {
        return new Response(JSON.stringify({
          result: { media: { name: "reference-1", workflowId: "reference-workflow", image: {} } },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/flowMedia:batchGenerateImages")) {
        return new Response(JSON.stringify({
          result: {
            generatedImages: [{
              name: "generated-image-1",
              workflowId: "generated-workflow-1",
              image: { dimensions: { width: 1920, height: 1080 } },
            }],
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("media.getMediaUrlRedirect")) {
        return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
      }
      return new Response("not found", { status: 404 });
    },
  };
  const store = {
    list: async () => [account],
    secret: async () => ({ accessToken: "access-token" }),
    updateSession: async () => account,
  };
  const auth = {
    refresh: async () => account,
    refreshAll: async () => [account],
    prepareRuntime: async () => undefined,
    sessionFor: async () => fakeSession,
    recaptchaToken: async (_accountId: string, action: string) => {
      recaptchaActions.push(action);
      return "recaptcha-token-long-enough";
    },
  };
  const client = new FlowClient(store as never, auth as never, fakeSession.fetch as typeof globalThis.fetch);
  const result = await client.generateImage({
    prompt: "cinematic portrait",
    aspectRatio: "16:9",
    references: [Buffer.from([0xff, 0xd8, 0xff, 0x00])],
  });
  assert.deepEqual(result, png);
  assert.deepEqual(recaptchaActions, ["IMAGE_GENERATION"]);
  const generation = calls.find((call) => call.url.includes("/flowMedia:batchGenerateImages"));
  assert.match(generation?.url ?? "", /\/v1\/projects\/project-image-1\/flowMedia:batchGenerateImages$/);
  assert.equal(
    (generation?.body as { requests?: Array<{ imageModelName?: string }> }).requests?.[0]?.imageModelName,
    "GEM_PIX_2"
  );
  assert.deepEqual(
    (generation?.body as { requests?: Array<{ imageInputs?: unknown[] }> }).requests?.[0]?.imageInputs,
    [{ imageInputType: "IMAGE_INPUT_TYPE_REFERENCE", name: "reference-1" }]
  );
});

test("очередь: ошибка изображения AnyModel автоматически переключает сцену на Flow", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-flow-image-fallback-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  const scene = makeScene({ imagePrompt: "Ночной город после дождя" });
  const settings = createDefaultProjectSettings();
  settings.image.provider = "anymodel-image";
  await projectRepository.save(makeProject({ scenes: [scene], settings }));
  const storage = new LocalProjectStorage(directory);
  const events: Array<{ message: string; details?: Record<string, unknown> }> = [];
  const anyModel = {
    configured: async () => true,
    generateImage: async () => { throw new Error("AnyModel image provider unavailable"); },
  };
  let flowCalls = 0;
  const flowPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4SIAAAAASUVORK5CYII=",
    "base64"
  );
  const flow = {
    configured: async () => true,
    generateImage: async (input: { prompt: string; aspectRatio: string }) => {
      flowCalls += 1;
      assert.match(input.prompt, /Ночной город после дождя/);
      assert.equal(input.aspectRatio, "16:9");
      return flowPng;
    },
  };
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    projectService,
    storage,
    new StandardRenderer(storage),
    undefined,
    (event) => events.push(event),
    anyModel as never,
    undefined,
    undefined,
    flow as never
  );
  const now = new Date().toISOString();
  const task: QueueTask = {
    id: "image-task-1",
    runId: "run-1",
    projectId: "p1",
    sceneId: "s1",
    kind: "image",
    label: "Кадр 1",
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    progress: 10,
    dependsOn: [],
    createdAt: now,
    updatedAt: now,
  };
  const resultPath = await (
    pipeline as unknown as { executeTask(task: QueueTask): Promise<string> }
  ).executeTask(task);
  assert.equal(flowCalls, 1);
  assert.ok((await readFile(resultPath)).length > 32);
  assert.ok(events.some((event) =>
    event.message === "queue.task.image_fallback"
    && event.details?.from === "AnyModel"
    && event.details?.to === "Google Flow"
  ));
});

test("очередь: соседние кадры одновременно распределяются между AnyModel и Flow", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-dual-image-pool-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  const settings = createDefaultProjectSettings();
  settings.image.provider = "anymodel-image";
  const scenes = [
    makeScene({ id: "s1", order: 0, imagePrompt: "Первый кадр" }),
    makeScene({ id: "s2", order: 1, imagePrompt: "Второй кадр" }),
  ];
  await projectRepository.save(makeProject({ scenes, settings }));
  const storage = new LocalProjectStorage(directory);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4SIAAAAASUVORK5CYII=",
    "base64"
  );
  const anyModelPrompts: string[] = [];
  const flowPrompts: string[] = [];
  const anyModel = {
    configured: async () => true,
    generateImage: async (prompt: string) => {
      anyModelPrompts.push(prompt);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return png;
    },
  };
  const flow = {
    configured: async () => true,
    generateImage: async (input: { prompt: string }) => {
      flowPrompts.push(input.prompt);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return png;
    },
  };
  const events: Array<{ message: string; details?: Record<string, unknown> }> = [];
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    projectService,
    storage,
    new StandardRenderer(storage),
    undefined,
    (event) => events.push(event),
    anyModel as never,
    undefined,
    undefined,
    flow as never
  );
  const now = new Date().toISOString();
  const makeImageTask = (sceneId: string, id: string): QueueTask => ({
    id,
    runId: "run-dual",
    projectId: "p1",
    sceneId,
    kind: "image",
    label: id,
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    progress: 10,
    dependsOn: [],
    createdAt: now,
    updatedAt: now,
  });
  const executeTask = (
    pipeline as unknown as { executeTask(task: QueueTask): Promise<string> }
  ).executeTask.bind(pipeline);
  const paths = await Promise.all([
    executeTask(makeImageTask("s1", "image-api")),
    executeTask(makeImageTask("s2", "image-flow")),
  ]);

  assert.equal(paths.length, 2);
  assert.equal(anyModelPrompts.length, 1);
  assert.equal(flowPrompts.length, 1);
  assert.match(anyModelPrompts[0]!, /Первый кадр/);
  assert.match(flowPrompts[0]!, /Второй кадр/);
  assert.equal(events.filter((event) => event.message === "queue.task.image_provider_completed").length, 2);
});

test("очередь: Flow-видео получает готовый кадр сцены и видеопромпт", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-flow-video-frame-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  const settings = createDefaultProjectSettings();
  settings.video.enabled = true;
  settings.video.provider = "flow";
  settings.video.startFrame = true;
  settings.image.provider = "anymodel-image";
  const imagePath = join(directory, "generated-by-any-provider.png");
  const frame = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]);
  await writeFile(imagePath, frame);
  const scene = makeScene({
    imagePrompt: "Статичный кадр",
    animationPrompt: "Камера медленно приближается к герою",
    imagePath,
  });
  await projectRepository.save(makeProject({ scenes: [scene], settings }));
  const storage = new LocalProjectStorage(directory);
  let received: { prompt: string; startFrame?: Buffer } | undefined;
  const flow = {
    configured: async () => true,
    generateVideo: async (input: { prompt: string; startFrame?: Buffer }) => {
      received = input;
      return Buffer.from("fake-mp4");
    },
  };
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    projectService,
    storage,
    new StandardRenderer(storage),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    flow as never
  );
  const now = new Date().toISOString();
  const task: QueueTask = {
    id: "video-flow",
    runId: "run-video",
    projectId: "p1",
    sceneId: "s1",
    kind: "video",
    label: "Flow video",
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    progress: 10,
    dependsOn: [],
    createdAt: now,
    updatedAt: now,
  };
  await (
    pipeline as unknown as { executeTask(task: QueueTask): Promise<string> }
  ).executeTask(task);

  assert.equal(received?.prompt, "Камера медленно приближается к герою");
  assert.deepEqual(received?.startFrame, frame);
});

test("очередь: новый Flow-запуск не отправляет Mock Image как первый кадр", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-flow-mock-guard-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  const settings = createDefaultProjectSettings();
  settings.video.enabled = true;
  settings.video.provider = "flow";
  settings.video.startFrame = true;
  settings.image.provider = "mock-image";
  await projectRepository.save(makeProject({
    scenes: [makeScene({ imagePrompt: "Тестовый кадр", animationPrompt: "Движение камеры" })],
    settings,
  }));
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    projectService,
    storage,
    new StandardRenderer(storage)
  );
  await assert.rejects(
    () => pipeline.start("p1"),
    /нельзя использовать Mock Image/
  );
  const now = new Date().toISOString();
  await assert.rejects(
    () => (
      pipeline as unknown as { executeTask(task: QueueTask): Promise<string> }
    ).executeTask({
      id: "old-flow-video",
      runId: "old-run",
      projectId: "p1",
      sceneId: "s1",
      kind: "video",
      label: "Старая Flow-задача",
      status: "running",
      attempts: 1,
      maxAttempts: 3,
      progress: 0,
      dependsOn: [],
      createdAt: now,
      updatedAt: now,
    }),
    /Flow-видео остановлено/
  );
});

test("очередь: stock-режим не стартует без выбранного и скачанного медиа", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-stock-required-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  const settings = createDefaultProjectSettings();
  settings.voice.enabled = false;
  await projectRepository.save(makeProject({
    mediaMode: "stock",
    settings,
    scenes: [
      makeScene({ stockSource: makeStockSource(), imagePath: join(directory, "missing.jpg") }),
      makeScene({ id: "excluded", order: 1, includeInAssembly: false }),
    ],
  }));
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    projectService,
    storage,
    new StandardRenderer(storage)
  );

  await assert.rejects(() => pipeline.start("p1"), /Стоковый.*сцены 1/i);
  assert.deepEqual(await pipeline.list(), []);
});

test("очередь: stock-режим создаёт только озвучку и сборку, не стирая stock", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-stock-only-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const stockPath = join(directory, "selected-stock.jpg");
  await writeFile(stockPath, Buffer.from("selected stock"));
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  const settings = createDefaultProjectSettings();
  settings.voice.enabled = true;
  settings.video.enabled = true;
  settings.video.provider = "flow";
  settings.image.provider = "mock-image";
  const stockSource = makeStockSource();
  await projectRepository.save(makeProject({
    mediaMode: "stock",
    settings,
    scenes: [makeScene({ imagePath: stockPath, videoPath: undefined, stockSource })],
  }));
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    projectService,
    storage,
    new StandardRenderer(storage)
  );

  const queued = await pipeline.start("p1");
  assert.deepEqual(queued.map((task) => task.kind).sort(), ["assemble", "speech"]);
  assert.equal(queued.some((task) => task.kind === "image" || task.kind === "video"), false);
  const updated = await projectService.get("p1");
  assert.equal(updated?.scenes[0]?.imagePath, stockPath);
  assert.equal(updated?.scenes[0]?.videoPath, undefined);
  assert.deepEqual(updated?.scenes[0]?.stockSource, stockSource);
});

test("очередь: mixed сохраняет stock-сцену, а AI-задачи ставит только остальным", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-stock-mixed-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const stockPath = join(directory, "mixed-stock.jpg");
  await writeFile(stockPath, Buffer.from("selected stock"));
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  const settings = createDefaultProjectSettings();
  settings.voice.enabled = false;
  settings.video.enabled = true;
  const stockSource = makeStockSource();
  await projectRepository.save(makeProject({
    mediaMode: "mixed",
    settings,
    scenes: [
      makeScene({ id: "stock", order: 0, imagePath: stockPath, stockSource }),
      makeScene({ id: "ai", order: 1, imagePath: "old-ai.jpg", videoPath: "old-ai.mp4", imagePrompt: "AI scene" }),
    ],
  }));
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    projectService,
    storage,
    new StandardRenderer(storage)
  );

  const queued = await pipeline.start("p1");
  assert.deepEqual(queued.filter((task) => task.kind === "image").map((task) => task.sceneId), ["ai"]);
  assert.deepEqual(queued.filter((task) => task.kind === "video").map((task) => task.sceneId), ["ai"]);
  const updated = await projectService.get("p1");
  assert.equal(updated?.scenes[0]?.imagePath, stockPath);
  assert.deepEqual(updated?.scenes[0]?.stockSource, stockSource);
  assert.equal(updated?.scenes[1]?.imagePath, undefined);
  assert.equal(updated?.scenes[1]?.videoPath, undefined);
  assert.equal(updated?.scenes[1]?.stockSource, undefined);
});

test("очередь: mixed требует локальный файл именно типа stockSource", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-stock-mixed-file-kind-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const imagePath = join(directory, "poster-exists.jpg");
  await writeFile(imagePath, Buffer.from("poster only"));
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  const settings = createDefaultProjectSettings();
  settings.voice.enabled = false;
  await projectRepository.save(makeProject({
    mediaMode: "mixed",
    settings,
    scenes: [makeScene({
      imagePath,
      videoPath: undefined,
      stockSource: makeStockSource("video"),
    })],
  }));
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    projectService,
    storage,
    new StandardRenderer(storage)
  );

  await assert.rejects(() => pipeline.start("p1"), /Пере-выберите stock для сцены 1/);
  assert.deepEqual(await pipeline.list(), []);
});

test("очередь: mixed без озвучки открывает редактор без Final, а stock-сцена остаётся ready", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-stock-mixed-terminal-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const stockPath = join(directory, "mixed-terminal-stock.jpg");
  const finalPath = join(directory, "Final.mp4");
  await writeFile(stockPath, Buffer.from("selected stock"));
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  const settings = createDefaultProjectSettings();
  settings.voice.enabled = false;
  settings.video.enabled = false;
  const stockSource = makeStockSource();
  await projectRepository.save(makeProject({
    mediaMode: "mixed",
    settings,
    scenes: [
      makeScene({ id: "stock", order: 0, imagePath: stockPath, stockSource }),
      makeScene({ id: "ai", order: 1, imagePrompt: "AI scene" }),
    ],
  }));
  const storage = new LocalProjectStorage(directory);
  const renderer = { render: async () => finalPath } as unknown as StandardRenderer;
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    projectService,
    storage,
    renderer
  );

  await pipeline.start("p1");
  await pipeline.drain();

  const tasks = await pipeline.list();
  assert.ok(tasks.every((task) => task.status === "done"));
  const updated = await projectService.get("p1");
  assert.equal(updated?.status, "ready");
  assert.equal(updated?.outputPath, undefined);
  assert.equal(updated?.scenes[0]?.status, "ready");
  assert.equal(updated?.scenes[0]?.imagePath, stockPath);
  assert.deepEqual(updated?.scenes[0]?.stockSource, stockSource);
  assert.equal(updated?.scenes[1]?.status, "ready");
  assert.ok(updated?.scenes[1]?.imagePath);
});

test("очередь: stock без озвучки готовит редактор и рендерит только после явного экспорта", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-stock-terminal-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const stockPath = join(directory, "selected-stock.mp4");
  const finalPath = join(directory, "Final.mp4");
  await writeFile(stockPath, Buffer.from("selected stock video"));
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  const settings = createDefaultProjectSettings();
  settings.voice.enabled = false;
  settings.video.enabled = false;
  const stockSource = makeStockSource("video");
  await projectRepository.save(makeProject({
    mediaMode: "stock",
    settings,
    scenes: [makeScene({ videoPath: stockPath, stockSource })],
  }));
  const storage = new LocalProjectStorage(directory);
  let renders = 0;
  const renderer = { render: async () => { renders++; return finalPath; } } as unknown as StandardRenderer;
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    projectService,
    storage,
    renderer
  );

  const queued = await pipeline.start("p1");
  assert.deepEqual(queued.map((task) => task.kind), ["assemble"]);
  assert.equal(queued[0]?.prepareOnly, true);
  await pipeline.drain();

  const updated = await projectService.get("p1");
  assert.equal(updated?.status, "ready");
  assert.equal(updated?.outputPath, undefined);
  assert.equal(renders, 0);
  assert.equal(updated?.scenes[0]?.status, "ready");
  assert.equal(updated?.scenes[0]?.videoPath, stockPath);
  assert.deepEqual(updated?.scenes[0]?.stockSource, stockSource);
  await pipeline.assembleOnly("p1");
  await pipeline.drain();
  assert.equal(renders, 1);
  assert.equal((await projectService.get("p1"))?.outputPath, finalPath);
});

test("очередь: AI-запуск и перегенерация кадра очищают stale stockSource", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-stock-ai-clear-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  const settings = createDefaultProjectSettings();
  settings.voice.enabled = false;
  const stockSource = makeStockSource();
  await projectRepository.save(makeProject({
    mediaMode: "ai",
    settings,
    scenes: [makeScene({ imagePath: "old-stock.jpg", stockSource })],
  }));
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    projectService,
    storage,
    new StandardRenderer(storage)
  );

  await pipeline.start("p1");
  let updated = await projectService.get("p1");
  assert.equal(updated?.scenes[0]?.stockSource, undefined);
  await pipeline.stop("p1");

  await projectService.update("p1", {
    status: "ready",
    scenes: [makeScene({ imagePath: "selected-again.jpg", videoPath: "keep-video.mp4", stockSource })],
  });
  await pipeline.regenerateScene("p1", "s1", "image");
  updated = await projectService.get("p1");
  assert.equal(updated?.scenes[0]?.stockSource, undefined);
  assert.equal(updated?.scenes[0]?.imagePath, undefined);
  assert.equal(updated?.scenes[0]?.videoPath, "keep-video.mp4");
});

test("сборка: реальный прогресс не растёт по таймеру, одинаковые кадры не пишут журнал и ENOSPC не повторяется", async context => {
  const directory = await mkdtemp(join(tmpdir(), "gws-render-progress-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "stock.jpg"); await writeFile(source, "local fixture");
  const projectRepository = new MemoryProjectRepository();
  const service = new ProjectService(projectRepository, new MockDirectorProvider());
  const settings = createDefaultProjectSettings(); settings.voice.enabled = false; settings.video.enabled = false; settings.assembly.documentary = undefined;
  await projectRepository.save(makeProject({ mediaMode: "stock", settings, scenes: [makeScene({ imagePath: source, stockSource: makeStockSource() })] }));
  let started!: () => void, finish!: () => void;
  const running = new Promise<void>(resolve => { started = resolve; }), done = new Promise<void>(resolve => { finish = resolve; });
  let writes = 0;
  const repository = new MemoryTaskRepository(); const replace = repository.replace.bind(repository);
  repository.replace = async tasks => { writes++; await replace(tasks); };
  const renderer = { render: async (_project: Project, progress: (stage: string, percent: number) => void) => {
    for (let i = 0; i < 100; i++) progress("Реальный рендер", 12);
    started(); await done; throw new Error("ENOSPC: no space left on device");
  } } as unknown as StandardRenderer;
  const previous = new MockGenerationPipeline(repository, service, new LocalProjectStorage(directory), renderer);
  await previous.assembleOnly("p1"); await previous.pause("p1");
  await repository.replace((await previous.list()).map(task=>({...task,progress:90})));
  const pipeline = new MockGenerationPipeline(repository, service, new LocalProjectStorage(directory), renderer);
  await pipeline.resume("p1"); await pipeline.tick(); await running;
  assert.equal((await pipeline.list()).find(task => task.kind === "assemble")?.progress, 12);
  const before = writes;
  for (let i = 0; i < 20; i++) await pipeline.tick();
  assert.equal((await pipeline.list()).find(task => task.kind === "assemble")?.progress, 12);
  assert.equal(writes, before, "Idle ticks must not rewrite queue or inflate the percentage");
  assert.ok(before < 10, "One hundred identical render events should not create one hundred writes");
  finish(); await pipeline.drain();
  const failed = (await pipeline.list()).find(task => task.kind === "assemble")!;
  assert.equal(failed.status, "failed"); assert.equal(failed.attempts, 1); assert.equal(failed.nextAttemptAt, undefined);
});

test("очередь: полная очистка останавливает активную сборку и не удаляет проект или готовые файлы", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-queue-clear-all-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const stockPath = join(directory, "selected-stock.jpg");
  const previousFinalPath = join(directory, "Final.mp4");
  const lateFinalPath = join(directory, "late-Final.mp4");
  await writeFile(stockPath, Buffer.from("selected stock"));
  await writeFile(previousFinalPath, Buffer.from("previous final"));

  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  const settings = createDefaultProjectSettings();
  settings.voice.enabled = false;
  settings.video.enabled = false;
  const stockSource = makeStockSource();
  await projectRepository.save(makeProject({
    title: "Проект остаётся",
    mediaMode: "stock",
    outputPath: previousFinalPath,
    settings,
    scenes: [makeScene({ imagePath: stockPath, stockSource })],
  }));

  let notifyRenderStarted!: () => void;
  let finishRender!: () => void;
  const renderStarted = new Promise<void>((resolve) => { notifyRenderStarted = resolve; });
  const renderMayFinish = new Promise<void>((resolve) => { finishRender = resolve; });
  const renderer = {
    render: async () => {
      notifyRenderStarted();
      await renderMayFinish;
      return lateFinalPath;
    },
  } as unknown as StandardRenderer;
  const repository = new MemoryTaskRepository();
  const pipeline = new MockGenerationPipeline(
    repository,
    projectService,
    new LocalProjectStorage(directory),
    renderer
  );

  await pipeline.assembleOnly("p1");
  await pipeline.tick();
  await renderStarted;
  assert.equal((await pipeline.list()).some((task) => task.status === "running"), true);

  assert.deepEqual(await pipeline.clearAll(), []);
  assert.deepEqual(await pipeline.list(), []);
  assert.deepEqual(await repository.list(), [], "пустая очередь сохранена в repository");

  let project = await projectService.get("p1");
  assert.equal(project?.title, "Проект остаётся");
  assert.equal(project?.status, "failed", "остановленный проект не остаётся generating");
  assert.equal(project?.scenes.length, 1);
  assert.equal(project?.scenes[0]?.imagePath, stockPath);
  assert.deepEqual(project?.scenes[0]?.stockSource, stockSource);
  assert.equal((await readFile(stockPath, "utf8")), "selected stock");
  assert.equal((await readFile(previousFinalPath, "utf8")), "previous final");

  // Поздний ответ уже начатого renderer не должен воскресить очередь или
  // пометить остановленный проект завершённым.
  finishRender();
  await pipeline.drain();
  assert.deepEqual(await pipeline.list(), []);
  project = await projectService.get("p1");
  assert.equal(project?.status, "failed");
  assert.notEqual(project?.outputPath, lateFinalPath);
});

test("очередь: полная очистка удаляет завершённые, ошибочные и отменённые записи", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-queue-clear-terminal-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  await projectRepository.save(makeProject({ status: "failed" }));
  const repository = new MemoryTaskRepository();
  const now = new Date().toISOString();
  const terminalTask = (status: QueueTask["status"], id: string): QueueTask => ({
    id,
    runId: `run-${id}`,
    projectId: "p1",
    kind: "director",
    label: id,
    status,
    attempts: 1,
    maxAttempts: 3,
    progress: status === "done" ? 100 : 0,
    dependsOn: [],
    createdAt: now,
    updatedAt: now,
  });
  await repository.replace([
    terminalTask("done", "done"),
    terminalTask("failed", "failed"),
    terminalTask("cancelled", "cancelled"),
    terminalTask("blocked", "blocked"),
  ]);
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(
    repository,
    projectService,
    storage,
    new StandardRenderer(storage)
  );

  assert.equal((await pipeline.list()).length, 4);
  assert.deepEqual(await pipeline.clearAll(), []);
  assert.deepEqual(await pipeline.list(), []);
  assert.deepEqual(await repository.list(), []);
});

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

test("Ken Burns фото-сцен: все глобальные режимы и переопределение сцены", () => {
  const project = makeProject();

  project.settings.assembly.kenBurnsDirection = "in";
  assert.equal(resolveKenBurnsDirection(project, makeScene({ order: 0 })), "in");
  assert.equal(resolveKenBurnsDirection(project, makeScene({ order: 1 })), "in");

  project.settings.assembly.kenBurnsDirection = "out";
  assert.equal(resolveKenBurnsDirection(project, makeScene({ order: 0 })), "out");
  assert.equal(resolveKenBurnsDirection(project, makeScene({ order: 1 })), "out");

  project.settings.assembly.kenBurnsDirection = "alternate";
  assert.equal(resolveKenBurnsDirection(project, makeScene({ order: 0 })), "in");
  assert.equal(resolveKenBurnsDirection(project, makeScene({ order: 1 })), "out");

  project.settings.assembly.kenBurnsDirection = "smart";
  assert.equal(resolveKenBurnsDirection(project, makeScene({ order: 0, autoKenBurnsDirection: "out" })), "out");
  assert.equal(resolveKenBurnsDirection(project, makeScene({ order: 1, autoKenBurnsDirection: "in" })), "in");
  project.settings.assembly.kenBurnsDirection = "alternate";
  assert.equal(resolveKenBurnsDirection(project, makeScene({ order: 0, autoKenBurnsDirection: "out" })), "in", "глобальный режим важнее авторазметки");
  assert.equal(resolveKenBurnsDirection(project, makeScene({ order: 1, kenBurnsDirection: "in" })), "in");
  assert.equal(resolveKenBurnsDirection(project, makeScene({ kenBurnsDirection: "off" })), "off");

  const noMotion = makeProject();
  noMotion.settings.assembly.kenBurns = false;
  assert.equal(resolveKenBurnsDirection(noMotion, makeScene()), "off");
  assert.equal(resolveKenBurnsDirection(noMotion, makeScene({ kenBurnsDirection: "out" })), "out", "сцена может переопределить глобальное отключение");
});

test("фото-режим не использует старый AI-video файл", () => {
  const project = makeProject();
  const scene = makeScene({ videoPath: "C:/project/scene.mp4" });
  const exists = () => true;

  project.settings.video.enabled = false;
  assert.equal(shouldUseAiVideo(project, scene, exists), false);

  project.settings.video.enabled = true;
  assert.equal(shouldUseAiVideo(project, scene, exists), true);
  assert.equal(shouldUseAiVideo(project, scene, () => false), false);

  project.settings.video.enabled = false;
  const stockVideo = makeScene({
    videoPath: "C:/project/stock.mp4",
    stockSource: {
      provider: "pexels",
      assetId: "42",
      mediaType: "video",
      query: "cat",
      pageUrl: "https://www.pexels.com/video/42/",
      author: "Author",
      attribution: "Video by Author on Pexels",
      licenseUrl: "https://www.pexels.com/license/",
      downloadedAt: new Date().toISOString()
    }
  });
  assert.equal(shouldUseAiVideo(project, stockVideo, exists), true);
});

test("выключение голоса исключает сохранённую озвучку из фото/видео и не портит исходный WAV", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-muted-narration-"));
  context.after(() => rm(directory, {recursive:true, force:true}));
  const storage = new LocalProjectStorage(directory);
  const renderer = new StandardRenderer(storage);
  if (!renderer.isAvailable()) return context.skip("FFmpeg недоступен");
  const project = makeProject({id:"muted-narration", mediaMode:"ai"});
  project.settings.assembly.kenBurns = false;
  project.settings.assembly.fadeTransitions = false;
  project.settings.assembly.audioNormalize = false;
  project.settings.assembly.quality = "preview";
  project.settings.music.enabled = false;
  project.settings.subtitles.enabled = false;
  project.settings.video.muteSource = true;
  const scene = makeScene({id:"saved-voice", durationSeconds:1});
  scene.imagePath = await storage.createPlaceholderImage(project, scene);
  scene.audioPath = join(storage.sceneDirectory(project,scene), "voice.wav");
  await createQuietVoiceWithTrailingSilence(scene.audioPath, 2, 0.2, 0.5);
  const original = await readFile(scene.audioPath);
  const clip = join(directory, "source.mp4");
  await createTinyAvClip(clip, 1);
  project.scenes = [scene];
  for (const kind of ["photo", "video"] as const) {
    scene.videoPath = kind === "video" ? clip : undefined;
    project.settings.video.enabled = kind === "video";
    project.settings.voice.enabled = false;
    const muted = await renderer.render(project);
    assert.ok(Math.abs(await mediaDurationSeconds(muted) - 1) < 0.1, `${kind}: disabled voice must not extend the frame`);
    assert.ok(await audioIntegratedLufs(muted) <= -60, `${kind}: saved narration must be silent`);
    assert.deepEqual(await readFile(scene.audioPath), original, "silence must never overwrite the saved voice.wav");
    project.settings.voice.enabled = true;
    const voiced = await renderer.render(project);
    assert.ok(await mediaDurationSeconds(voiced) >= 2, `${kind}: re-enabled narration must remain whole`);
    assert.ok(await audioIntegratedLufs(voiced) > -50, `${kind}: saved narration must play again without another TTS request`);
  }
});

test("фрагменты одной озвучки сохраняют речь на стыке фото/видео без повторного TTS", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-narration-slices-"));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const storage = new LocalProjectStorage(directory);
  const renderer = new StandardRenderer(storage);
  if (!renderer.isAvailable()) return context.skip("FFmpeg недоступен");
  const project = makeProject({id: "narration-slices", mediaMode: "ai"});
  Object.assign(project.settings.assembly, {kenBurns: false, quality: "preview", audioNormalize: false, fadeTransitions: true, transitionType: "mix", transitionDurationSeconds: 0.35});
  project.settings.music.enabled = false;
  project.settings.subtitles.enabled = false;
  project.settings.voice.enabled = true;
  project.settings.video.muteSource = true;
  const audioPath = join(directory, "original.wav");
  await createQuietVoiceWithTrailingSilence(audioPath, 6, 1, 0.5);
  const original = await readFile(audioPath);
  const clip = join(directory, "source.mp4");
  await createTinyAvClip(clip, 1);
  for (const order of [0, 1]) {
    const part = makeScene({id: `part-${order}`, order, durationSeconds: 3,
      narration: order === 0 ? "Первая часть. " : "Вторая часть.", audioPath,
      narrationSlice: {sourceSceneId: "original", startSeconds: order * 3, endSeconds: (order + 1) * 3, last: order === 1}});
    part.imagePath = await storage.createPlaceholderImage(project, part);
    project.scenes.push(part);
  }
  for (const kind of ["photo", "video"] as const) {
    project.settings.video.enabled = kind === "video";
    for (const part of project.scenes) part.videoPath = kind === "video" ? clip : undefined;
    const output = await renderer.render(project);
    assert.ok(Math.abs(await mediaDurationSeconds(output) - 6.2) < 0.12, `${kind}: no repeated whole track or intermediate pause`);
    const info = await inspectNarration(output);
    assert.ok(info.speechEndSeconds >= 5.95, `${kind}: the end of narration is intact`);
    const middlePauses = (info.silences ?? []).filter(silence => silence.startSeconds < 5.9 && silence.endSeconds > 0.1);
    assert.deepEqual(middlePauses, [], `${kind}: no >=150ms gap at the audio boundary`);
    assert.deepEqual(await readFile(audioPath), original);
  }
});

test("полная AI Story очередь делит длинный TTS, генерирует только дополнительные картинки и сохраняет общую дорожку", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-measured-queue-"));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const storage = new LocalProjectStorage(directory);
  const renderer = new StandardRenderer(storage);
  if (!renderer.isAvailable()) return context.skip("FFmpeg недоступен");
  const draft = makeProject({id: "measured-queue", mediaMode: "ai"});
  Object.assign(draft.settings.assembly, {kenBurns: false, quality: "preview", audioNormalize: false, fadeTransitions: true, transitionType: "mix", transitionDurationSeconds: 0.35});
  draft.settings.music.enabled = false;
  draft.settings.subtitles.enabled = false;
  draft.settings.video.enabled = false;
  draft.settings.image.provider = "mock-image";
  draft.settings.voice.enabled = true;
  draft.settings.voice.provider = "elevenlabs";
  const narration = "  Максим приехал к клиенту.\r\nОн закончил уборку и получил оплату.  ";
  draft.scenes = [makeScene({id: "source", durationSeconds: 8, narration, imagePrompt:'A traveller arrives at the house'}), makeScene({id:"excluded", order:1, includeInAssembly:false, narration:"Не включено", audioPath:"keep-excluded.wav"})];
  const source = join(directory, "tts-fixture.wav");
  await createQuietVoiceWithTrailingSilence(source, 10.44, 0.6, 0.5);
  const audio = await readFile(source);
  let ttsCalls = 0;
  const voicer = {configured: async () => true, tts: async () => {ttsCalls++; return audio;}} as unknown as VoicerClient;
  const repository = new MemoryProjectRepository();
  await repository.save(draft);
  const service = new ProjectService(repository, new MockDirectorProvider());
  const tasks = new MemoryTaskRepository();
  const imageBytes = await readFile(await storage.createPlaceholderImage(draft, draft.scenes[0]!));
  const flow = {configured:async()=>true,generateImage:async()=>imageBytes} as unknown as FlowClient;
  const pipeline = new MockGenerationPipeline(tasks, service, storage, renderer, undefined, undefined, undefined, voicer, undefined, flow);
  await pipeline.start(draft.id);
  await pipeline.drain();
  const complete = (await service.get(draft.id))!;
  assert.equal(complete.status, "ready", JSON.stringify(await pipeline.list()));
  assert.equal(complete.outputPath, undefined, "Подготовка измеряет TTS без рендера Final");
  assert.equal(ttsCalls, 1, "splitting must not resubmit TTS");
  const included = complete.scenes.filter(scene => scene.includeInAssembly !== false);
  assert.equal(included.length, 2);
  assert.equal(included.map(scene => scene.narration).join(""), narration);
  assert.equal(complete.scenes.at(-1)!.audioPath, "keep-excluded.wav");
  assert.equal(new Set(included.map(scene => scene.audioPath)).size, 1);
  assert.equal(new Set(included.map(scene => scene.imagePath)).size, 2);
  assert.equal(included[0]!.id, "source");
  for (const part of included) {
    assert.deepEqual(await readFile(part.audioPath!), audio);
  }
  const before = (await pipeline.list()).map(task => task.id);
  const restored = new MockGenerationPipeline(tasks, service, storage, renderer, undefined, undefined, undefined, voicer, undefined, flow);
  await restored.initialize();
  assert.deepEqual((await restored.list()).map(task => task.id), before, "completed split must not add tasks on restart");
  await restored.assembleOnly(draft.id);
  await restored.drain();
  const exported = (await service.get(draft.id))!;
  assert.ok(Math.abs(await mediaDurationSeconds(exported.outputPath!) - 10.64) < 0.15);
  for (const part of included) assert.ok(await mediaDurationSeconds(storage.sceneVideoPath(exported, part)) <= 9.05);
  assert.equal((await restored.list()).length, 1, "assemble-only must not submit image/TTS jobs");
  assert.equal(ttsCalls, 1);
  await restored.regenerateScene(draft.id, "source", "audio");
  await restored.drain();
  const regenerated = (await service.get(draft.id))!;
  assert.equal(ttsCalls, 2);
  assert.equal(regenerated.scenes[0]!.narrationSlice, undefined);
  assert.deepEqual(await readFile(regenerated.scenes[1]!.audioPath!), audio, "regenerating the first part must not overwrite the shared source");
  assert.ok(regenerated.scenes[1]!.narrationSlice);
});

test("восстановление между сохранением измеренных сцен и очереди не повторяет TTS/удалённые job ID", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-measured-recovery-"));
  context.after(() => rm(directory, {recursive:true, force:true}));
  const storage = new LocalProjectStorage(directory);
  const renderer = new StandardRenderer(storage);
  if (!renderer.isAvailable()) return context.skip("FFmpeg недоступен");
  const draft = makeProject({id:"measured-recovery", mediaMode:"ai"});
  draft.settings.voice.enabled = true;
  draft.settings.image.provider = "mock-image";
  draft.settings.video.enabled = false;
  draft.settings.assembly.kenBurns = false;
  draft.settings.assembly.quality = "preview";
  draft.settings.assembly.audioNormalize = false;
  draft.settings.music.enabled = false;
  draft.settings.subtitles.enabled = false;
  const original = makeScene({id:"original", narration:"Максим привёз инструменты. Он выполнил работу и получил оплату.", durationSeconds:8, imagePrompt:'A worker with tools'});
  original.imagePath = await storage.createPlaceholderImage(draft, original);
  original.audioPath = join(directory, "voice.wav");
  await createQuietVoiceWithTrailingSilence(original.audioPath, 10, 0.6, 0.5);
  draft.scenes = [original];
  const expansion = (await measuredStoryTimingExpansion(draft, storage))!;
  assert.ok(expansion);
  assert.throws(() => applyMeasuredStoryTiming({...draft, scenes:[{...original, narration:"Правка пользователя"}]}, expansion), /Сцены изменились/);
  const repository = new MemoryProjectRepository();
  await repository.save({...draft, ...applyMeasuredStoryTiming(draft, expansion), status:"generating"});
  const service = new ProjectService(repository, new MockDirectorProvider());
  const tasks = new MemoryTaskRepository();
  const base = {runId:"run", projectId:draft.id, attempts:1, maxAttempts:3, progress:100, createdAt:"", updatedAt:"", dependsOn:[]};
  const remoteJob: NonNullable<QueueTask["remoteJob"]> = {provider:"flow", kind:"image", accountId:"account", projectId:"remote-project", mediaName:"already-paid-image", modelKey:"model", submittedAt:"2026-09-08"};
  await tasks.replace([
    {...base, id:"speech", sceneId:original.id, kind:"speech", label:"speech", status:"done", resultPath:original.audioPath},
    {...base, id:"image", sceneId:original.id, kind:"image", label:"image", status:"done", resultPath:original.imagePath, remoteJob},
    {...base, id:"assembly", kind:"assemble", label:"Подготовка редактора", status:"running", progress:1, dependsOn:["speech","image"], allowTimingExpansion:true, prepareOnly:true},
  ]);
  const imageBytes = await readFile(original.imagePath!);
  const flow = {configured:async()=>true,generateImage:async()=>imageBytes} as unknown as FlowClient;
  const recovered = new MockGenerationPipeline(tasks, service, storage, renderer, undefined, undefined, undefined, undefined, undefined, flow);
  await recovered.initialize();
  const resumedTasks = await recovered.list();
  const newImage = resumedTasks.find(task => task.kind === "image" && task.id !== "image")!;
  assert.equal(newImage.status, "paused");
  assert.equal(resumedTasks.filter(task => task.kind === "speech").length, 1);
  assert.deepEqual(resumedTasks.find(task => task.id === "image")!.remoteJob, remoteJob);
  assert.notEqual(resumedTasks.find(task => task.id === "speech")!.resultPath, original.audioPath);
  assert.ok(resumedTasks.find(task => task.id === "assembly")!.dependsOn.includes(newImage.id));
  await recovered.resume(draft.id);
  await recovered.drain();
  assert.equal((await service.get(draft.id))!.status, "ready");
  assert.equal((await service.get(draft.id))!.outputPath, undefined);
  assert.equal((await recovered.list()).filter(task => task.kind === "speech").length, 1);
});

test("таймлайн: готовая озвучка задаёт длительность без плановых пустот и не обрезается", () => {
  assert.equal(resolveTimelineTiming(makeScene({ durationSeconds: 12 }), 8, "photo").durationSeconds, 8.2);
  assert.equal(resolveTimelineTiming(makeScene({ durationSeconds: 5 }), 12, "video").durationSeconds, 5, "без озвучки сохраняется заданная длительность");
  assert.ok(Math.abs(resolveTimelineTiming(makeScene({ durationSeconds: 12 }), 12, "video", 7.78).durationSeconds - 7.98) < 0.001);
  assert.ok(Math.abs(resolveTimelineTiming(makeScene({ durationOverrideSeconds: 3 }), 12, "video", 7.78).durationSeconds - 7.98) < 0.001, "короткий override не режет голос");
  assert.equal(resolveTimelineTiming(makeScene({ durationOverrideSeconds: 10 }), 12, "video", 7.78).durationSeconds, 10, "явный длинный override сохраняется");
  assert.ok(Math.abs(resolveTimelineTiming(makeScene({ durationSeconds: 5 }), 3, "video", 7.78, 1.2).durationSeconds - 8.03) < 0.001, "естественный хвост ограничен 0.25 с");
  assert.equal(resolveTimelineTiming(makeScene({ durationSeconds: 5 }), 3, "video", 0, 0.5, 0.5).durationSeconds, 5.5, "xfade получает технический запас сверх плановых пяти секунд");
});

test("таймлайн: trim и speed определяют длительность и безопасно ограничиваются", () => {
  const timing = resolveTimelineTiming(makeScene({ trimStartSeconds: 2, trimEndSeconds: 10, playbackRate: 2 }), 12, "video");
  assert.deepEqual(timing, { trimStartSeconds: 2, trimEndSeconds: 10, playbackRate: 2, durationSeconds: 4 });

  const clamped = resolveTimelineTiming(makeScene({ trimStartSeconds: -5, trimEndSeconds: 99, playbackRate: 20 }), 10, "video");
  assert.equal(clamped.trimStartSeconds, 0);
  assert.equal(clamped.trimEndSeconds, 10);
  assert.equal(clamped.playbackRate, 4);
  assert.equal(clamped.durationSeconds, 2.5);

  const protectedNarration = resolveTimelineTiming(
    makeScene({ trimStartSeconds: 2, trimEndSeconds: 10, playbackRate: 2 }),
    12,
    "video",
    7
  );
  assert.equal(protectedNarration.durationSeconds, 7.2, "trim исходного видео не применяется к озвучке");
});

test("рендер: готовый TTS обрезает только техническую тишину, оставляет естественный хвост и нормализует голос", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-render-natural-pacing-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const storage = new LocalProjectStorage(directory);
  const renderer = new StandardRenderer(storage);
  if (!renderer.isAvailable()) return context.skip("FFmpeg недоступен");

  const project = makeProject({ id: "natural-pacing" });
  project.settings.assembly.audioNormalize = true;
  project.settings.assembly.kenBurns = false;
  project.settings.assembly.quality = "preview";
  project.settings.subtitles.enabled = false;
  const scene = makeScene({ id: "voice", durationSeconds: 8 });
  scene.imagePath = await storage.createPlaceholderImage(project, scene);
  scene.audioPath = join(directory, "quiet-voice-with-2s-tail.wav");
  await createQuietVoiceWithTrailingSilence(scene.audioPath, 0.8, 2.2, 0.1);
  project.scenes = [scene];

  const finalPath = await renderer.render(project);
  const finalDuration = await mediaDurationSeconds(finalPath);
  assert.ok(finalDuration >= 0.95, `конец реплики и короткий естественный хвост должны сохраниться, получено ${finalDuration}`);
  assert.ok(finalDuration < 1.15, `плановые 8 с и технические 2.2 с тишины не должны попасть в Final, получено ${finalDuration}`);
  const integratedLufs = await audioIntegratedLufs(finalPath);
  assert.ok(integratedLufs > -19 && integratedLufs < -13, `голос должен быть нормализован около -16 LUFS, I=${integratedLufs} LUFS`);
});

test("рендер: убирает leading/trailing тишину TTS, но сохраняет паузу внутри фразы", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-render-leading-silence-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const storage = new LocalProjectStorage(directory);
  const renderer = new StandardRenderer(storage);
  if (!renderer.isAvailable()) return context.skip("FFmpeg недоступен");

  const project = makeProject({ id: "leading-silence" });
  project.settings.assembly.kenBurns = false;
  project.settings.assembly.quality = "preview";
  project.settings.assembly.audioNormalize = false;
  project.settings.subtitles.enabled = false;
  const scene = makeScene({ id: "voice-with-pauses", durationSeconds: 20 });
  scene.imagePath = await storage.createPlaceholderImage(project, scene);
  scene.audioPath = join(directory, "voice-with-pauses.wav");
  await createVoiceWithLeadingAndInternalSilence(scene.audioPath);
  project.scenes = [scene];

  const finalPath = await renderer.render(project);
  const finalDuration = await mediaDurationSeconds(finalPath);
  // 0.5 с речи + 0.3 с внутренней паузы + 0.5 с речи + 0.2 с естественного хвоста.
  assert.ok(finalDuration >= 1.42, `внутренняя пауза не должна исчезнуть, получено ${finalDuration}`);
  assert.ok(finalDuration < 1.62, `leading/trailing тишина и плановые 20 с не должны попасть в Final, получено ${finalDuration}`);
});

test("рендер: audioNormalize=false не применяет loudnorm", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-render-no-normalize-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const storage = new LocalProjectStorage(directory);
  const renderer = new StandardRenderer(storage);
  if (!renderer.isAvailable()) return context.skip("FFmpeg недоступен");

  const project = makeProject({ id: "no-normalize" });
  project.settings.assembly.kenBurns = false;
  project.settings.assembly.quality = "preview";
  project.settings.assembly.audioNormalize = false;
  project.settings.subtitles.enabled = false;
  const scene = makeScene({ id: "quiet-original", durationSeconds: 8 });
  scene.imagePath = await storage.createPlaceholderImage(project, scene);
  scene.audioPath = join(directory, "quiet-original.wav");
  await createQuietVoiceWithTrailingSilence(scene.audioPath, 0.8, 0.8, 0.01);
  project.scenes = [scene];

  const finalPath = await renderer.render(project);
  const integratedLufs = await audioIntegratedLufs(finalPath);
  assert.ok(integratedLufs < -30, `при выключенной нормализации тихая озвучка должна остаться тихой, I=${integratedLufs} LUFS`);
});

test("рендер: три короткие реплики и xfade сохраняют сумму плановых длительностей", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-render-timing-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const storage = new LocalProjectStorage(directory);
  const renderer = new StandardRenderer(storage);
  if (!renderer.isAvailable()) return context.skip("FFmpeg недоступен");

  const sourceProject = makeProject({ id: "source-video" });
  sourceProject.settings.assembly.kenBurns = false;
  sourceProject.settings.assembly.quality = "preview";
  sourceProject.settings.subtitles.enabled = false;
  const sourceScene = makeScene({ id: "source", durationSeconds: 0.3 });
  sourceScene.imagePath = await storage.createPlaceholderImage(sourceProject, sourceScene);
  sourceScene.audioPath = await storage.createPlaceholderAudio(sourceProject, sourceScene);
  const shortVideoPath = await renderer.renderScene(sourceProject, sourceScene);

  const targetProject = makeProject({ id: "target-video" });
  targetProject.settings.assembly.kenBurns = false;
  targetProject.settings.assembly.quality = "preview";
  targetProject.settings.subtitles.enabled = false;
  const stockScene = makeScene({
    id: "stock",
    order: 0,
    durationSeconds: 1,
    transitionDurationSeconds: 5,
    videoPath: shortVideoPath,
    stockSource: makeStockSource("video")
  });
  stockScene.audioPath = await storage.createPlaceholderAudio(targetProject, { ...stockScene, durationSeconds: 0.3 });
  const photoScene = makeScene({ id: "photo", order: 1, durationSeconds: 1 });
  photoScene.imagePath = await storage.createPlaceholderImage(targetProject, photoScene);
  photoScene.audioPath = await storage.createPlaceholderAudio(targetProject, { ...photoScene, durationSeconds: 0.3 });
  const finalScene = makeScene({ id: "final", order: 2, durationSeconds: 1 });
  finalScene.imagePath = await storage.createPlaceholderImage(targetProject, finalScene);
  finalScene.audioPath = await storage.createPlaceholderAudio(targetProject, { ...finalScene, durationSeconds: 0.3 });
  targetProject.scenes = [stockScene, photoScene, finalScene];

  const finalPath = await renderer.render(targetProject);
  assert.ok((await readFile(finalPath)).byteLength > 1_000, "Final.mp4 создан после freeze короткого видео и склейки аудио");
  const finalDuration = await mediaDurationSeconds(finalPath);
  assert.ok(Math.abs(finalDuration - 3) < 0.12, `даже переход 5 с не должен растянуть три сцены по 1 с: получено ${finalDuration}`);
});

test("рендер AI-слайд-шоу: глобальный dissolve попадает в Final.mp4, а не превращается в hard cut", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-render-slideshow-transition-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const storage = new LocalProjectStorage(directory);
  const renderer = new StandardRenderer(storage);
  if (!renderer.isAvailable()) return context.skip("FFmpeg недоступен");

  const project = makeProject({ id: "ai-slideshow-transition", mediaMode: "ai" });
  // This fixture tests colors/transitions only; there is intentionally no TTS file.
  project.settings.voice.enabled = false;
  project.settings.music.enabled = false;
  project.settings.subtitles.enabled = false;
  project.settings.assembly.quality = "preview";
  project.settings.assembly.kenBurns = false;
  project.settings.assembly.fadeTransitions = true;
  project.settings.assembly.transitionType = "mix";
  project.settings.assembly.transitionDurationSeconds = 0.4;
  if (project.settings.assembly.montage) project.settings.assembly.montage.enabled = false;

  const first = makeScene({ id: "red", order: 0, durationSeconds: 1, fadeEdges: false });
  const second = makeScene({ id: "blue", order: 1, durationSeconds: 1, fadeEdges: false });
  first.imagePath = join(directory, "red.bmp");
  second.imagePath = join(directory, "blue.bmp");
  await writeFile(first.imagePath, makeSolidBmp(255, 0, 0));
  await writeFile(second.imagePath, makeSolidBmp(0, 0, 255));
  project.scenes = [first, second];

  const finalPath = await renderer.render(project);
  const [red, green, blue] = await sampleVideoRgb(finalPath, 1.2);
  assert.ok(red > 55 && blue > 55, `в середине dissolve должны одновременно быть красный и синий каналы, RGB=${red},${green},${blue}`);
  assert.ok(green < Math.max(red, blue) / 2, `переход не должен давать посторонний зелёный оттенок, RGB=${red},${green},${blue}`);

  project.id = "ai-slideshow-fade";
  project.settings.assembly.transitionType = "fade";
  const fadePath = await renderer.render(project);
  const fadeRgb = await sampleVideoRgb(fadePath, 1.2);
  assert.ok(Math.max(...fadeRgb) < 90, `fade должен проходить через почти чёрный кадр, RGB=${fadeRgb.join(",")}`);
});

test("рендер: длинная озвучка не обрезается коротким stock-видео", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-render-long-voice-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const storage = new LocalProjectStorage(directory);
  const renderer = new StandardRenderer(storage);
  if (!renderer.isAvailable()) return context.skip("FFmpeg недоступен");

  const sourceProject = makeProject({ id: "short-stock-source" });
  sourceProject.settings.assembly.kenBurns = false;
  sourceProject.settings.assembly.quality = "preview";
  sourceProject.settings.subtitles.enabled = false;
  const sourceScene = makeScene({ id: "source", durationSeconds: 1 });
  sourceScene.imagePath = await storage.createPlaceholderImage(sourceProject, sourceScene);
  sourceScene.audioPath = await storage.createPlaceholderAudio(sourceProject, sourceScene);
  const shortVideoPath = await renderer.renderScene(sourceProject, sourceScene);

  const targetProject = makeProject({ id: "long-voice-target" });
  targetProject.settings.assembly.quality = "preview";
  targetProject.settings.subtitles.enabled = false;
  const scene = makeScene({
    id: "stock-with-long-voice",
    order: 0,
    durationSeconds: 1,
    videoPath: shortVideoPath,
    stockSource: makeStockSource("video")
  });
  scene.audioPath = join(directory, "long-voice.wav");
  await createQuietVoiceWithTrailingSilence(scene.audioPath, 2.2, 0.3, 0.1);
  targetProject.scenes = [scene];

  const finalPath = await renderer.render(targetProject);
  const duration = await mediaDurationSeconds(finalPath);
  assert.ok(duration >= 2.35, `озвучка 2.2 с и короткий естественный хвост должны сохраниться полностью, получено ${duration}`);
  assert.ok(duration < 2.6, `короткое stock-видео не должно добавлять лишнюю паузу, получено ${duration}`);
});

test("рендер: trim и ускорение stock-видео не создают хвост после mix-перехода", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-render-trimmed-stock-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const storage = new LocalProjectStorage(directory);
  const renderer = new StandardRenderer(storage);
  if (!renderer.isAvailable()) return context.skip("FFmpeg недоступен");

  const sourcePath = join(directory, "tiny-stock.mp4");
  await createTinyAvClip(sourcePath, 1);
  const project = makeProject({ id: "trimmed-stock" });
  project.settings.assembly.kenBurns = false;
  project.settings.assembly.quality = "preview";
  project.settings.subtitles.enabled = false;
  const stockScene = makeScene({
    id: "stock-trimmed",
    order: 0,
    durationSeconds: 5,
    videoPath: sourcePath,
    stockSource: makeStockSource("video"),
    trimStartSeconds: 0.2,
    trimEndSeconds: 0.6,
    playbackRate: 2,
    transition: "mix"
  });
  stockScene.audioPath = await storage.createPlaceholderAudio(project, { ...stockScene, durationSeconds: 0.1 });
  const photoScene = makeScene({ id: "photo-after-trim", order: 1, durationSeconds: 1 });
  photoScene.imagePath = await storage.createPlaceholderImage(project, photoScene);
  photoScene.audioPath = await storage.createPlaceholderAudio(project, { ...photoScene, durationSeconds: 0.1 });
  project.scenes = [stockScene, photoScene];

  const finalPath = await renderer.render(project);
  const finalDuration = await mediaDurationSeconds(finalPath);
  const expectedDuration = (0.6 - 0.2) / 2 + 1;
  assert.ok(
    Math.abs(finalDuration - expectedDuration) < 0.12,
    `ожидалось около ${expectedDuration.toFixed(2)} с, получено ${finalDuration.toFixed(2)} с`
  );
});

test("рендер: chunk-граница после 32 сцен сохраняет точную длительность timeline", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-render-chunk-boundary-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const storage = new LocalProjectStorage(directory);
  const renderer = new StandardRenderer(storage);
  if (!renderer.isAvailable()) return context.skip("FFmpeg недоступен");

  const outgoingClip = join(directory, "outgoing-0.5.mp4");
  const finalClip = join(directory, "final-0.4.mp4");
  await createTinyAvClip(outgoingClip, 0.5);
  await createTinyAvClip(finalClip, 0.4);
  const scenes = Array.from({ length: 33 }, (_, order) => makeScene({
    id: `chunk-${order}`,
    order,
    durationSeconds: 0.4,
    transition: "mix",
    transitionDurationSeconds: 0.1
  }));
  const project = makeProject({ id: "chunk-boundary", scenes });
  project.settings.assembly.quality = "preview";
  await storage.ensureProject(project);
  const outputPath = join(storage.projectDirectory(project.id), "chunk-final.mp4");
  const internals = renderer as unknown as {
    assembleWithChunkedCrossfade(
      project: Project,
      scenes: Scene[],
      clips: string[],
      transitionOf: (scene: Scene) => "none" | "fade" | "mix",
      overlapOf: (scene: Scene) => number,
      outputPath: string
    ): Promise<void>;
  };
  const clips = scenes.map((_, index) => index < scenes.length - 1 ? outgoingClip : finalClip);
  await internals.assembleWithChunkedCrossfade(project, scenes, clips, () => "mix", () => 0.1, outputPath);

  const finalDuration = await mediaDurationSeconds(outputPath);
  const expectedDuration = scenes.length * 0.4;
  assert.ok(
    Math.abs(finalDuration - expectedDuration) < 0.15,
    `ожидалось около ${expectedDuration.toFixed(2)} с, получено ${finalDuration.toFixed(2)} с`
  );
});

test("таймлайн: скорость раскладывается в допустимые FFmpeg atempo-факторы", () => {
  assert.deepEqual(atempoFactors(1), [1]);
  assert.deepEqual(atempoFactors(4), [2, 2]);
  assert.deepEqual(atempoFactors(0.25), [0.5, 0.5]);
});

test("таймлайн: переход, zoom и громкости используют совместимые defaults и limits", () => {
  assert.equal(resolveTransitionDuration(makeScene()), 0.5);
  assert.equal(resolveTransitionDuration(makeScene({ autoTransitionDurationSeconds: 0.22 })), 0.22);
  assert.equal(resolveTransitionDuration(makeScene({ autoTransitionDurationSeconds: 0.22, transitionDurationSeconds: 0.7 })), 0.7);
  assert.equal(resolveTransitionDuration(makeScene({ transitionDurationSeconds: 99 })), 5);
  assert.equal(resolveKenBurnsZoom(makeScene()), 1.1);
  assert.equal(resolveKenBurnsZoom(makeScene({ autoKenBurnsZoom: 1.06 })), 1.06);
  assert.equal(resolveKenBurnsZoom(makeScene({ autoKenBurnsZoom: 1.06, kenBurnsZoom: 1.15 })), 1.15);
  assert.equal(resolveKenBurnsZoom(makeScene({ kenBurnsZoom: 2 })), 1.5);
  assert.equal(resolveVolumePercent(undefined, 73), 73);
  assert.equal(resolveVolumePercent(250, 73), 200);
});

test("слайд-шоу: настройка всего проекта управляет стыком, а ручная сцена имеет приоритет", () => {
  const project = makeProject({ mediaMode: "ai" });
  project.settings.assembly.montage = {
    enabled: false,
    planner: "local",
    density: "calm",
    graphicBeatPercent: 0,
    hardCutPercent: 78,
  };
  project.settings.assembly.fadeTransitions = true;
  project.settings.assembly.transitionType = "mix";
  project.settings.assembly.transitionDurationSeconds = 0.4;

  const automatic = makeScene({ autoTransition: "fade", autoTransitionDurationSeconds: 1.2 });
  assert.equal(resolveSceneTransition(project, automatic), "mix", "старый автомонтаж не перекрывает настройку слайд-шоу");
  assert.equal(resolveTransitionDuration(automatic, project), 0.4);

  const manual = makeScene({ transition: "fade", transitionDurationSeconds: 0.75 });
  assert.equal(resolveSceneTransition(project, manual), "fade");
  assert.equal(resolveTransitionDuration(manual, project), 0.75);

  const cut = makeScene({ transition: "none", transitionDurationSeconds: 0 });
  assert.equal(resolveSceneTransition(project, cut), "none");

  project.settings.assembly.montage.enabled = true;
  assert.equal(resolveSceneTransition(project, automatic), "fade", "stock/Remotion-автомонтаж остаётся отдельным");
  assert.equal(resolveTransitionDuration(automatic, project), 1.2);
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
  assert.equal(queued.some((task) => task.kind === "assemble"), false, "Перегенерация не запускает Final");

  const internals = pipeline as unknown as { tasks: QueueTask[]; syncProjects(): Promise<void> };
  for (const task of internals.tasks) {
    task.status = "done";
    task.progress = 100;
    task.resultPath = task.kind === "assemble" ? join(directory, "Final.mp4") : join(directory, `${task.sceneId}.png`);
  }
  await internals.syncProjects();
  const updated = await projectService.get("p1");
  assert.equal(updated?.status, "ready");
  assert.equal(updated?.outputPath, undefined);
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
    makeScene({ id: "s1", order: 0, status: "ready", imagePath: "image-1.png", videoPath: "video-1.mp4", audioPath: "voice-old.mp3",
      trimStartSeconds: 1.2, trimEndSeconds: 4.6, narrationVolume: 42, transition: 'fade', transitionDurationSeconds: 0.4 }),
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
  for (const field of ['trimStartSeconds', 'trimEndSeconds', 'narrationVolume', 'transition', 'transitionDurationSeconds'] as const) {
    assert.equal(updated?.scenes[0]?.[field], scenes[0]?.[field], `Ручная настройка ${field} сохранена`);
  }
});

test('редактор: готовность не зависит от Final и учитывает включённые сцены и озвучку', () => {
  const project = makeProject({scenes: [makeScene({imagePath: 'image.png', audioPath: 'voice.wav'}),
    makeScene({id:'excluded', includeInAssembly:false})]});
  assert.equal(projectEditorReady(project), true);
  project.outputPath = 'old-Final.mp4';
  project.scenes[0]!.audioPath = undefined;
  assert.equal(projectEditorReady(project), false, 'старый Final не заменяет недостающую озвучку');
  project.settings.voice.enabled = false;
  assert.equal(projectEditorReady(project), true);
  project.scenes[0]!.imagePath = undefined;
  assert.equal(projectEditorReady(project), false);
  assert.equal(projectEditorReady({...project, scenes:[]}), false);
});

test('редактор: старый автоматический checkpoint не рендерит Final и сохраняет remote ID', async context => {
  const directory=await mkdtemp(join(tmpdir(),'gws-editor-checkpoint-'));
  context.after(()=>rm(directory,{recursive:true,force:true}));
  const repository=new MemoryProjectRepository(), tasks=new MemoryTaskRepository();
  const projects=new ProjectService(repository,new MockDirectorProvider());
  const settings=createDefaultProjectSettings();settings.voice.enabled=false;
  const scene=makeScene({imagePath:'saved.png',status:'ready'});
  await repository.save(makeProject({settings,scenes:[scene]}));
  await repository.save(makeProject({id:'explicit',settings,scenes:[scene]}));
  const base={runId:'run',attempts:1,maxAttempts:3,progress:0,dependsOn:[],createdAt:'2026-10-25',updatedAt:'2026-10-25'};
  const remoteJob:NonNullable<QueueTask['remoteJob']>={provider:'flow',kind:'image',accountId:'account',projectId:'remote',mediaName:'paid-image',modelKey:'model',submittedAt:'2026-10-25'};
  await tasks.replace([
    {...base,id:'image',projectId:'p1',sceneId:scene.id,kind:'image',label:'image',status:'done',resultPath:scene.imagePath,remoteJob},
    {...base,id:'automatic',projectId:'p1',kind:'assemble',label:'Сборка Final.mp4',status:'running',dependsOn:['image'],allowTimingExpansion:true},
    {...base,id:'export',projectId:'explicit',runId:'export-run',kind:'assemble',label:'Пересборка Final.mp4',status:'paused'},
  ]);
  let renders=0;
  const renderer={render:async()=>{renders++;return 'Final.mp4';}} as unknown as StandardRenderer;
  const pipeline=new MockGenerationPipeline(tasks,projects,new LocalProjectStorage(directory),renderer);
  await pipeline.initialize();
  const restored=await pipeline.list();
  assert.equal(restored.find(task=>task.id==='automatic')?.prepareOnly,true);
  assert.equal(restored.find(task=>task.id==='export')?.prepareOnly,undefined,'явный экспорт сохраняет намерение');
  assert.deepEqual(restored.find(task=>task.id==='image')?.remoteJob,remoteJob);
  await pipeline.resume('p1');await pipeline.drain();
  assert.equal(renders,0);assert.equal((await projects.get('p1'))?.status,'ready');
  assert.equal((await projects.get('p1'))?.outputPath,undefined);
});

test("AI Story: один новый кадр не запускает сборку с отсутствующими материалами", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-partial-image-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = new MemoryProjectRepository();
  const projects = new ProjectService(repository, new MockDirectorProvider());
  const settings = createDefaultProjectSettings();
  settings.voice.enabled = false;
  await repository.save(makeProject({ mediaMode: "ai", settings, scenes: [makeScene(), makeScene({ id: "s2", order: 1 })] }));
  const taskRepository = new MemoryTaskRepository();
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(taskRepository, projects, storage, new StandardRenderer(storage));
  const queued = await pipeline.regenerateScene("p1", "s1", "image");
  assert.deepEqual(queued.map(task => task.kind), ["image"]);
  assert.equal(queued[0]?.scope, "scenes");
  // Simulate a restart after a successful remote/local image save; no paid provider is involved.
  await taskRepository.replace(queued.map(task => ({ ...task, status: "done", progress: 100, resultPath: "new-image.png" })));
  const restored = new MockGenerationPipeline(taskRepository, projects, storage, new StandardRenderer(storage));
  await restored.initialize();
  const updated = await projects.get("p1");
  assert.equal(updated?.status, "ready", "material-only work is not a failed or fully rendered project");
  assert.equal(updated?.scenes[0]?.imagePath, "new-image.png");
  assert.equal(updated?.scenes[1]?.status, "draft");
  assert.equal(updated?.outputPath, undefined);
  await assert.rejects(() => restored.assembleOnly("p1"), /сцена 2: изображение или видео/);
  assert.equal((await restored.list()).some(task => task.kind === "assemble"), false);
});

test("AI Story: недостающая озвучка не запускает заведомо неготовую сборку", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-partial-speech-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = new MemoryProjectRepository();
  const projects = new ProjectService(repository, new MockDirectorProvider());
  await repository.save(makeProject({ scenes: [makeScene({ imagePath: "image.png" })] }));
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(new MemoryTaskRepository(), projects, storage, new StandardRenderer(storage));
  const tasks = await pipeline.regenerateScene("p1", "s1", "image");
  assert.deepEqual(tasks.map(task => task.kind), ["image"]);
});

test("AI Story: пересборка проверяет материалы до изменения результата и очереди", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-assembly-preflight-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = new MemoryProjectRepository();
  const projects = new ProjectService(repository, new MockDirectorProvider());
  const settings = createDefaultProjectSettings();
  settings.voice.enabled = false;
  settings.video.enabled = false;
  await repository.save(makeProject({ settings, outputPath: "previous-Final.mp4", scenes: [makeScene({ videoPath: "disabled-video.mp4" })] }));
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(new MemoryTaskRepository(), projects, storage, new StandardRenderer(storage));
  await assert.rejects(() => pipeline.assembleOnly("p1"), /Для сборки ещё нужны материалы/);
  assert.equal((await projects.get("p1"))?.outputPath, "previous-Final.mp4");
  assert.deepEqual(await pipeline.list(), []);
  await projects.update("p1", { scenes: [makeScene({ imagePath: "ready.png" }), makeScene({ id: "s2", order: 1, includeInAssembly: false })] });
  assert.deepEqual((await pipeline.assembleOnly("p1")).map(task => task.kind), ["assemble"], "excluded scenes do not prevent assembly");
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
  assert.equal(allocateSceneDurations(180).length, 23);
  assert.ok(allocateSceneDurations(180).every((duration) => duration >= 7 && duration <= 8));
});

test("AI Story распределяет кадры около пяти секунд и не превышает жёсткий лимит", () => {
  const durations = allocateAiStorySceneDurations(13 * 60);
  assert.equal(durations.reduce((sum, duration) => sum + duration, 0), 13 * 60);
  assert.ok(durations.every((duration) => duration >= 4 && duration <= AI_STORY_HARD_MAX_SCENE_SECONDS));
  assert.ok(Math.abs(durations.reduce((sum, duration) => sum + duration, 0) / durations.length - 5) <= 0.5);
});

test("AI Story rebuild пересчитывает актуальный scenarioQuality для нового пятисекундного плана", async () => {
  const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "test-model" }) } as never);
  const plan = {
    title: "Старый дом",
    promise: "Раскрыть семейную тайну",
    tone: "Спокойный",
    visualBible: "Один герой и один стиль",
    continuityRules: ["Одежда героя не меняется"],
    requiredBeats: ["найти письмо", "вернуть дом семье"],
    endingResolution: "Дом возвращён семье",
    sections: [{ title: "История", goal: "Раскрыть тайну", keyPoints: ["письмо", "дом"], transition: "к финалу" }],
  };
  const narration = [
    "Максим замечает запертую дверь старого семейного дома.",
    "Под ступенью он находит ключ с выцветшей синей лентой.",
    "В кабинете герой обнаруживает письмо своего деда.",
    "Письмо объясняет, почему дом много лет оставался пустым.",
    "Максим собирает документы и встречается со своей семьёй.",
    "В итоге дом законно возвращён семье, а тайна полностью раскрыта.",
  ];
  const internals = client as unknown as {
    createScenarioPlan(): Promise<typeof plan>;
    buildScenes(scenarioPlan: typeof plan, durations: number[]): Promise<Scene[]>;
    reviewScenes(scenarioPlan: typeof plan, scenes: Scene[]): Promise<Scene[]>;
    auditScenarioCompleteness(): Promise<{
      complete: boolean; endingResolved: boolean; missingRequiredBeats: string[];
      unresolvedSetups: string[]; rewriteFromScene: number; reason: string;
    }>;
  };
  internals.createScenarioPlan = async () => plan;
  internals.buildScenes = async (_plan, durations) => durations.map((durationSeconds, order) => makeScene({
    id: `ai-rebuild-${order + 1}`,
    order,
    durationSeconds,
    title: `Кадр ${order + 1}`,
    narration: narration[order] ?? `Герой завершает шаг ${order + 1} и получает ясный результат.`,
    imagePrompt: `consistent story frame ${order + 1}`,
    stockQuery: `old family house ${order + 1}`,
    animationPrompt: `camera movement ${order + 1}`,
  }));
  internals.reviewScenes = async (_plan, scenes) => scenes;
  internals.auditScenarioCompleteness = async () => ({
    complete: true,
    endingResolved: true,
    missingRequiredBeats: [],
    unresolvedSetups: [],
    rewriteFromScene: 6,
    reason: "готово",
  });
  const oldQuality = {
    version: 1 as const,
    checkedAt: new Date(0).toISOString(),
    targetSeconds: 30,
    totalDurationSeconds: 30,
    wordCount: 1,
    sceneCount: 4,
    fingerprint: "old-fingerprint",
    complete: true,
    endingResolved: true,
    repaired: false,
    requiredBeats: [],
  };
  const result = await client.regenerateScenes({
    sourceUrl: "chat://ai-rebuild",
    sourceTitle: "Старый дом",
    niche: "История",
    targetAudience: "Зрители",
    hook: "Запертая дверь",
    structure: [],
    strengths: [],
    improvements: [],
    suggestedAngle: "Семейная тайна",
    suggestedTitle: "Старый дом",
    recommendedDurationSeconds: 30,
    language: "Русский",
    scenes: [],
    provider: "anymodel:test",
    scenarioQuality: oldQuality,
  }, 30, undefined, undefined, undefined, "local", undefined, undefined, undefined, "ai-story");

  assert.equal(result.scenes.length, 6);
  assert.ok(result.scenes.every((scene) => scene.durationSeconds === 5));
  assert.equal(result.scenarioQuality?.fingerprint, scenarioFingerprint(result.scenes));
  assert.notEqual(result.scenarioQuality?.fingerprint, oldQuality.fingerprint);
  assert.equal(result.scenarioQuality?.sceneCount, result.scenes.length);
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

test("локальный редактор не допускает сценарий вдвое длиннее выбранного хронометража", () => {
  const overloaded = makeScene({
    durationSeconds: 8,
    narration: "Горничная открывает номер, проверяет ванную, меняет полотенца, снимает бельё, застилает кровать, протирает зеркала, пылесосит ковёр и затем зовёт супервайзера для подробной финальной проверки качества.",
    imagePrompt: "Hotel housekeeper cleaning one guest room with a prepared trolley beside the door",
    animationPrompt: "The housekeeper moves toward the bed while the camera makes a short push in"
  });
  const issues = findSceneIssues([overloaded]);
  assert.ok(issues.some((issue) => issue.kind === "length" && /Слишком много текста/.test(issue.reason)));
});

function scenarioSectionHarness(sectionCount: number) {
  const sections = Array.from({ length: sectionCount }, (_unused, index) => ({
    title: index === 0 ? "Hook" : index === sectionCount - 1 ? "Payoff" : `Section ${index + 1}`,
    goal: `Goal ${index + 1}`,
    keyPoints: [`Required beat ${index + 1}`],
    transition: `Transition ${index + 1}`,
  }));
  const plan = {
    title: "Why older cars are simpler", promise: "Explain the tradeoff", tone: "Clear and practical",
    visualBible: "Workshop", continuityRules: [], requiredBeats: sections.flatMap((section) => section.keyPoints),
    endingResolution: "Explain when the tradeoff makes sense", sections,
  };
  const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "test-model" }) } as never);
  const batches: Array<Array<typeof sections[number] & { sceneStart: number; sceneEnd: number }>> = [];
  let planRequest = "";
  let generated = 0;
  const internals = client as unknown as {
    chat(model: string, messages: Array<{ role: string; content: string }>): Promise<string>;
    createScenarioPlan(source: Record<string, unknown>, durations: number[], language: string, model: string): Promise<typeof plan>;
    buildScenes(scenarioPlan: typeof plan, durations: number[], language: string, model: string): Promise<Scene[]>;
  };
  internals.chat = async (_model, messages) => {
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    const request = messages.find((message) => message.role === "user")?.content ?? "";
    if (system.includes("главный редактор YouTube-сценария")) {
      planRequest = request;
      return JSON.stringify(plan);
    }
    const assigned = request.match(/# Секции, назначенные именно этому диапазону сцен\n([^\n]+)/)?.[1];
    assert.ok(assigned, "writer must receive explicit section assignments");
    batches.push(JSON.parse(assigned));
    const durations = JSON.parse(request.match(/Длительности этих сцен: (\[[^\n]+?\]) секунд/)?.[1] ?? "[]") as number[];
    return JSON.stringify(durations.map(() => ({
      title: `Scene ${++generated}`, narration: `A practical detail about the vehicle number ${generated}.`,
      imagePrompt: "Mechanic inspecting car dashboard", stockQuery: "car dashboard", animationPrompt: "Slow push in",
    })));
  };
  return { internals, plan, batches, planRequest: () => planRequest };
}

test("план подробного AI Story не запрашивается с тесным лимитом и high reasoning", async () => {
  const setup = scenarioSectionHarness(7);
  const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "test-model" }) } as never);
  const internal = client as unknown as {
    request(path: string, init: RequestInit): Promise<Response>;
    createScenarioPlan(source: Record<string, unknown>, durations: number[], language: string, model: string): Promise<typeof setup.plan>;
  };
  const brief = "Три услуги, по каждой: клиент, предложение, условный заказ, расчёт, расходы, риск и проверка. Финал: план на семь дней. Во всех кадрах с героем повторять длинный visual anchor.";
  let requests = 0;
  internal.request = async (_path, init) => {
    requests += 1;
    const payload = JSON.parse(String(init.body));
    assert.ok(payload.max_tokens >= 8_000, "Planning needs room for the complete brief and JSON, not the former 3500-token ceiling");
    assert.equal(payload.reasoning_effort, "low", "Do not spend the compact-plan output allowance on high reasoning");
    const prompt = payload.messages.map((message: { content: string }) => message.content).join("\n");
    assert.ok(prompt.includes(brief), "Do not solve output length by discarding the user's requirements");
    assert.match(prompt, /не создавай.*imagePrompt/iu);
    assert.match(prompt, /visual anchor.*один раз/iu);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(setup.plan) } }] }), {
      headers: { "content-type": "application/json" },
    });
  };
  for (const count of [36, 156]) {
    const result = await internal.createScenarioPlan({ projectBrief: brief }, Array(count).fill(5), "Русский", "test-model");
    assert.deepEqual(result.sections, setup.plan.sections);
    assert.deepEqual(result.requiredBeats, setup.plan.requiredBeats);
    assert.equal(result.endingResolution, setup.plan.endingResolution);
  }
  assert.equal(requests, 2, "One completion per plan, no speculative paid repeats");
});

test("Shorts: план ограничивает секции числом сцен и объединяет лишние без потери хука и развязки", async () => {
  const setup = scenarioSectionHarness(5);
  const result = await setup.internals.createScenarioPlan({}, [8, 8, 7, 7], "English", "test-model");
  assert.match(setup.planRequest(), /Секций должно быть 4; не больше числа сцен/);
  assert.equal(result.sections.length, 4);
  assert.deepEqual(result.sections.flatMap((section) => section.keyPoints), setup.plan.requiredBeats);
  assert.match(result.sections[0]!.title, /Hook/);
  assert.match(result.sections.at(-1)!.title, /Payoff/);
  assert.equal(result.sections.at(-1)!.transition, setup.plan.sections.at(-1)!.transition);
  assert.equal(result.endingResolution, setup.plan.endingResolution);
});

test("Shorts: writer сохраняет все секции из избыточного плана даже при одной сцене", async () => {
  for (const sceneCount of [1, 2, 4]) {
    const setup = scenarioSectionHarness(5);
    const scenes = await setup.internals.buildScenes(setup.plan, Array(sceneCount).fill(8), "English", "test-model");
    assert.equal(scenes.length, sceneCount);
    assert.equal(setup.batches.length, 1);
    const assigned = setup.batches[0]!;
    assert.equal(assigned.length, sceneCount);
    assert.deepEqual(assigned.flatMap((section) => section.keyPoints), setup.plan.requiredBeats);
    assert.equal(assigned[0]!.sceneStart, 1);
    assert.match(assigned[0]!.title, /Hook/);
    assert.equal(assigned.at(-1)!.sceneEnd, sceneCount);
    assert.match(assigned.at(-1)!.title, /Payoff/);
    assert.ok(assigned.every((section) => section.sceneStart >= 1 && section.sceneStart <= section.sceneEnd && section.sceneEnd <= sceneCount));
    assert.equal(setup.plan.sections.length, 5, "assignment must not mutate the original plan");
  }
});

test("длинный сценарий сохраняет прежние секции и диапазоны на границе writer-батчей", async () => {
  const setup = scenarioSectionHarness(6);
  const durations = Array(20).fill(8);
  const plan = await setup.internals.createScenarioPlan({}, durations, "English", "test-model");
  assert.match(setup.planRequest(), /Секций должно быть 5–12/);
  assert.deepEqual(plan.sections, setup.plan.sections);
  const scenes = await setup.internals.buildScenes(plan, durations, "English", "test-model");
  assert.equal(scenes.length, 20);
  assert.equal(setup.batches.length, 2);
  assert.deepEqual(setup.batches[0]!.map((section) => [section.sceneStart, section.sceneEnd]), [[1, 3], [4, 6], [7, 10], [11, 13], [14, 16]]);
  assert.deepEqual(setup.batches[1]!.map((section) => [section.sceneStart, section.sceneEnd]), [[14, 16], [17, 20]]);
  const assigned = [...new Map(setup.batches.flat().map((section) => [section.title, section])).values()];
  assert.deepEqual(assigned.flatMap((section) => section.keyPoints), setup.plan.requiredBeats);
});

test("редактор сценария не принимает частичный ответ без всех обязательных исправлений", async () => {
  const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "test-model" }) } as never);
  (client as unknown as { chat(model: string, messages: Array<{ role: string; content: string }>): Promise<string> }).chat = async (_model, messages) => {
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    if (/строгий редактор сценария/.test(system)) return '{"issues":[]}';
    return JSON.stringify({
      scenes: [{
        sceneNumber: 2,
        title: "Исправлено",
        narration: "Теперь вторая сцена сообщает новую важную улику и естественно продолжает расследование.",
        imagePrompt: "detective finds a new clue",
        stockQuery: "detective new clue",
        animationPrompt: "camera moves toward evidence"
      }]
    });
  };
  const repeated = "Следователь внимательно изучает важную улику и последовательно восстанавливает события этого дела.";
  const scenes = [
    makeScene({ order: 0, durationSeconds: 8, narration: repeated, imagePrompt: "detective evidence", animationPrompt: "camera pans" }),
    makeScene({ id: "s2", order: 1, durationSeconds: 8, narration: repeated, imagePrompt: "detective evidence", animationPrompt: "camera pushes" }),
    makeScene({ id: "s3", order: 2, durationSeconds: 8, narration: "Добрый вечер, продолжаем расследование и изучаем следующую улику этого дела.", imagePrompt: "motel evidence", animationPrompt: "camera tilts" })
  ];
  const plan = {
    title: "Дело",
    promise: "Раскрыть тайну",
    tone: "Живой",
    visualBible: "Ночной мотель",
    continuityRules: [],
    requiredBeats: ["найти улику"],
    endingResolution: "Раскрыть дело",
    sections: [{ title: "Расследование", goal: "Найти ответ", keyPoints: ["улика"], transition: "к финалу" }]
  };
  await assert.rejects(
    () => (client as unknown as { reviewScenes(plan: unknown, scenes: Scene[], model: string): Promise<Scene[]> }).reviewScenes(plan, scenes, "test-model"),
    /не исправил обязательные сцены: 3/
  );
});

test("невалидная необязательная AI-рецензия не уничтожает локально валидный черновик", async () => {
  const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "test-model" }) } as never);
  const durations = allocateSceneDurations(30);
  const draft = durations.map((durationSeconds, order) => makeScene({
    id: `safe-${order + 1}`,
    order,
    durationSeconds,
    title: `Сцена ${order + 1}`,
    narration: [
      "Тележка горничной заранее собрана по порядку работы, поэтому сотрудник не теряет время в коридоре.",
      "Ключ-карта открывает только назначенные номера и одновременно оставляет запись для контроля безопасности.",
      "После уборки супервайзер проверяет ванную, постель и расходники по единому короткому списку.",
      "Так подготовка, доступ и финальная проверка превращают быструю уборку в управляемый процесс.",
    ][order]!,
    imagePrompt: `hotel housekeeping step ${order + 1}`,
    stockQuery: `hotel housekeeping ${order + 1}`,
    animationPrompt: "camera slowly moves through hotel corridor",
  }));
  const plan = {
    title: "Уборка отеля",
    promise: "Показать управляемый процесс",
    tone: "Практичный",
    visualBible: "Современный отель",
    continuityRules: [],
    requiredBeats: ["тележка", "ключ-карта", "проверка"],
    endingResolution: "Объяснить систему",
    sections: [{ title: "Процесс", goal: "Показать этапы", keyPoints: ["тележка", "доступ", "проверка"], transition: "к итогу" }],
  };
  const internals = client as unknown as {
    createScenarioPlan(): Promise<typeof plan>;
    buildScenes(): Promise<Scene[]>;
    reviewScenes(): Promise<Scene[]>;
    auditScenarioCompleteness(): Promise<{
      complete: boolean; endingResolved: boolean; missingRequiredBeats: string[];
      unresolvedSetups: string[]; rewriteFromScene: number; reason: string;
    }>;
  };
  internals.createScenarioPlan = async () => plan;
  internals.buildScenes = async () => draft;
  internals.reviewScenes = async () => {
    const error = new Error("Модель вернула оборванный JSON при исправлении сценария");
    error.name = "AnyModelOutputFormatError";
    throw error;
  };
  internals.auditScenarioCompleteness = async () => ({
    complete: true,
    endingResolved: true,
    missingRequiredBeats: [],
    unresolvedSetups: [],
    rewriteFromScene: 4,
    reason: "готово",
  });
  const stages: string[] = [];
  const result = await client.regenerateScenes({
    sourceUrl: "chat://review-fallback",
    sourceTitle: "Уборка отеля",
    niche: "Гостиницы",
    targetAudience: "Менеджеры",
    hook: "Почему скорость не должна портить качество",
    structure: [],
    strengths: [],
    improvements: [],
    suggestedAngle: "Практический процесс",
    suggestedTitle: "Уборка отеля",
    recommendedDurationSeconds: 30,
    language: "Русский",
    instructions: "Показать тележку, ключ-карту и проверку качества.",
    scenes: [],
    provider: "anymodel:test",
  }, 30, (_done, _total, stage) => { if (stage) stages.push(stage); }, undefined, undefined, "local");

  assert.equal(result.scenes.length, 4);
  assert.equal(result.scenarioQuality?.complete, true);
  assert.ok(stages.some((stage) => stage.includes("AI-рецензия не применена") && stage.includes("AnyModelOutputFormatError")));
});

test("полный черновик попадает в checkpoint до сбоя рецензии и автопочинки", async () => {
  const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "test-model" }) } as never);
  const durations = allocateSceneDurations(30);
  const draft = durations.map((durationSeconds, order) => makeScene({
    id: `checkpoint-${order + 1}`,
    order,
    durationSeconds,
    title: `Scene ${order + 1}`,
    narration: [
      "Night patrol receives a call beside the closed warehouse.",
      "Camera records a van leaving through the eastern gate.",
      "Detectives compare the route with a witness statement.",
      "Officers arrest the driver and formally close the case.",
    ][order]!,
    imagePrompt: `police investigation step ${order + 1}`,
    stockQuery: `police investigation ${order + 1}`,
    animationPrompt: `camera follows investigation step ${order + 1}`,
  }));
  const plan = {
    title: "Warehouse", promise: "Close the case", tone: "Clear", visualBible: "Night city",
    continuityRules: [], requiredBeats: ["recover documents"], endingResolution: "Recover documents and close the case",
    sections: [{ title: "Case", goal: "Investigate", keyPoints: ["documents"], transition: "ending" }],
  };
  const internals = client as unknown as {
    createScenarioPlan(): Promise<typeof plan>;
    buildScenes(): Promise<Scene[]>;
    reviewScenes(): Promise<Scene[]>;
    auditScenarioCompleteness(): Promise<{
      complete: boolean; endingResolved: boolean; missingRequiredBeats: string[];
      unresolvedSetups: string[]; rewriteFromScene: number; reason: string;
    }>;
    repairIncompleteScenario(): Promise<Scene[]>;
  };
  internals.createScenarioPlan = async () => plan;
  internals.buildScenes = async () => draft;
  internals.reviewScenes = async () => {
    const error = new Error("broken review JSON");
    error.name = "AnyModelOutputFormatError";
    throw error;
  };
  internals.auditScenarioCompleteness = async () => ({
    complete: false,
    endingResolved: true,
    missingRequiredBeats: ["recover documents"],
    unresolvedSetups: [],
    rewriteFromScene: 3,
    reason: "documents missing",
  });
  internals.repairIncompleteScenario = async () => { throw new Error("repair failed after checkpoint"); };
  const checkpoints: Scene[][] = [];

  await assert.rejects(
    () => client.regenerateScenes({
      sourceUrl: "chat://checkpoint",
      sourceTitle: "Warehouse",
      niche: "Police",
      targetAudience: "Viewers",
      hook: "Night call",
      structure: [],
      strengths: [],
      improvements: [],
      suggestedAngle: "Investigation",
      suggestedTitle: "Warehouse",
      recommendedDurationSeconds: 30,
      language: "English",
      instructions: "Recover the documents.",
      scenes: [],
      provider: "anymodel:test",
    }, 30, undefined, undefined, undefined, "local", (value) => {
      checkpoints.push(structuredClone(value));
    }),
    /repair failed after checkpoint/
  );
  assert.equal(checkpoints.length, 1);
  assert.deepEqual(checkpoints[0], draft);
});

test("проверка готовности не принимает историю, оборванную перед развязкой", () => {
  const durations = allocateSceneDurations(180);
  const scenes = durations.map((durationSeconds, order) => makeScene({
    id: `s${order + 1}`,
    order,
    durationSeconds,
    narration: order === durations.length - 1
      ? "Но полиция едет открывать ячейку."
      : "Следователь внимательно изучает новую улику, сопоставляет детали и шаг за шагом приближается к ответу.",
    imagePrompt: "detective examines evidence",
    animationPrompt: "camera slowly pushes in"
  }));
  const report = inspectScenarioReadiness(scenes, 180);
  assert.equal(report.endingLooksOpen, true);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => /финал обрывается/.test(error)));
});

test("проверка готовности принимает полный сценарий нужного объёма и замечает правку", () => {
  const durations = allocateSceneDurations(180);
  const scenes = durations.map((durationSeconds, order) => makeScene({
    id: `s${order + 1}`,
    order,
    durationSeconds,
    narration: order === durations.length - 1
      ? "Женщину нашли живой, администратора задержали, а каждая странная улика наконец получила простое объяснение."
      : "Следователь проверяет факты, разговаривает со свидетелями и связывает найденную деталь с предыдущими событиями этого дела.",
    imagePrompt: "detective examines evidence",
    animationPrompt: "camera slowly pushes in"
  }));
  const report = inspectScenarioReadiness(scenes, 180);
  assert.equal(report.ok, true);
  const before = scenarioFingerprint(scenes);
  assert.equal(scenarioQualityFingerprint(scenes), before);
  const edited = scenes.map((scene, index) => index === 0 ? { ...scene, narration: `${scene.narration} Новая деталь.` } : scene);
  assert.notEqual(scenarioFingerprint(edited), before);
});

test("проверка готовности: target duration и плотность текста только предупреждают", () => {
  const scenes = [
    makeScene({
      id: "short-1",
      order: 0,
      durationSeconds: 4,
      narration: "Диспетчер принял звонок, и патруль приехал к мотелю.",
      imagePrompt: "police car near motel",
      animationPrompt: "camera follows police car"
    }),
    makeScene({
      id: "short-2",
      order: 1,
      durationSeconds: 4,
      narration: "Женщину нашли живой, подозреваемого задержали, и дело было раскрыто.",
      imagePrompt: "police arrest outside motel",
      animationPrompt: "camera slowly pulls back"
    })
  ];
  const report = inspectScenarioReadiness(scenes, 180);
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.ok(report.warnings.some((warning) => /отличается от ориентира/.test(warning)));
  assert.ok(report.warnings.some((warning) => /текст короче ориентира/.test(warning)));
});

test("очередь запускает завершённый короткий сценарий при длинном ориентире", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-advisory-duration-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const scene = makeScene({
    id: "short-complete",
    durationSeconds: 5,
    narration: "Полиция нашла пропавшую женщину живой, задержала подозреваемого, и расследование завершилось.",
    imagePrompt: "police arrest outside motel",
    animationPrompt: "camera pulls back"
  });
  const settings = createDefaultProjectSettings();
  settings.durationMinutes = 3;
  settings.voice.enabled = false;
  const repository = new MemoryProjectRepository();
  const projects = new ProjectService(repository, new MockDirectorProvider());
  await repository.save(makeProject({
    scenes: [scene],
    settings,
    mediaMode: "ai",
    referenceAnalysis: {
      sourceUrl: "chat://short-complete",
      sourceTitle: "Тест",
      niche: "История",
      targetAudience: "Зрители",
      hook: "Звонок",
      structure: [],
      strengths: [],
      improvements: [],
      suggestedAngle: "Расследование",
      suggestedTitle: "Короткое дело",
      recommendedDurationSeconds: 180,
      language: "Русский",
      scenes: [scene],
      provider: "anymodel:test",
      scenarioQuality: makeScenarioQuality([scene])
    }
  }));
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(new MemoryTaskRepository(), projects, storage, new StandardRenderer(storage));
  const tasks = await pipeline.start("p1");
  assert.ok(tasks.length > 0, "разница с target duration не блокирует производство");
});

test("очередь не растягивает ролик вдвое из-за переполненной озвучки сцены", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-overlong-narration-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const scene = makeScene({
    id: "overlong-complete",
    durationSeconds: 5,
    narration: "Полиция нашла пропавшую женщину живой, задержала подозреваемого, подробно восстановила весь маршрут, проверила каждое показание и окончательно закрыла расследование без единого вопроса.",
    imagePrompt: "police arrest outside motel",
    animationPrompt: "camera pulls back"
  });
  const settings = createDefaultProjectSettings();
  settings.durationMinutes = 1;
  settings.voice.enabled = false;
  const repository = new MemoryProjectRepository();
  const projects = new ProjectService(repository, new MockDirectorProvider());
  await repository.save(makeProject({
    scenes: [scene],
    settings,
    mediaMode: "ai",
    referenceAnalysis: {
      sourceUrl: "chat://overlong-complete",
      sourceTitle: "Тест",
      niche: "История",
      targetAudience: "Зрители",
      hook: "Звонок",
      structure: [],
      strengths: [],
      improvements: [],
      suggestedAngle: "Расследование",
      suggestedTitle: "Переполненная реплика",
      recommendedDurationSeconds: 60,
      language: "Русский",
      scenes: [scene],
      provider: "anymodel:test",
      scenarioQuality: makeScenarioQuality([scene])
    }
  }));
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(new MemoryTaskRepository(), projects, storage, new StandardRenderer(storage));
  await assert.rejects(
    () => pipeline.start("p1"),
    /Сценарий не готов к производству.*текст не помещается в хронометраж сцены 1/
  );
  assert.equal((await pipeline.list()).length, 0);
});

test("сцена 78: калиброванный тайминг исправляет 91 знак при лимите 90 без переписывания сценария", () => {
  const narration = "Первую чистку сделайте по низкой цене, но обязательно платно. Платёж — это и есть проверка.";
  const scenes = [makeScene({ narration, imagePrompt: "Maksim cleans a coffee machine", animationPrompt: "slow pull out" }),
    makeScene({ id: "long", order: 1, narration: `${narration} ${narration}`, imagePrompt: "Maksim explains the result", animationPrompt: "slow push in" })];
  const project = makeProject({ mediaMode: "ai", scenes });
  project.settings.voice.calibration = { charactersPerSecond: 12.789 } as VoiceCalibration;
  project.referenceAnalysis = { scenes, scenarioQuality: makeScenarioQuality(scenes) } as ReferenceAnalysis;
  const fixed = plannedStoryTimingPatch(project)!;
  assert.equal(fixed.scenes![0]!.durationSeconds, 7.115);
  assert.equal(fixed.scenes!.map(scene => scene.narration).join(""), scenes.map(scene => scene.narration).join(""));
  assert.ok(fixed.scenes!.every(scene => scene.durationSeconds <= 9));
  assert.equal(fixed.referenceAnalysis!.scenarioQuality!.fingerprint, scenarioQualityFingerprint(fixed.scenes!));
  assert.equal(scenes[0]!.durationSeconds, 5, "Исходный проект не мутирует при проверке");
});

test("production preflight использует сохранённую калибровку вместо ложного общего лимита слов", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-calibrated-preflight-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const narration = "Максим взял ключ и вошёл в дом, нашёл там брата, отдал ему все бумаги, спас кота, поймал вора и навсегда закрыл это дело.";
  const scene = makeScene({
    id: "calibrated-scene",
    durationSeconds: 8,
    narration,
    imagePrompt: "Maxim returns the documents to the family",
    animationPrompt: "camera slowly pulls back",
  });
  const calibration: VoiceCalibration = {
    version: 1,
    provider: "edge-tts",
    voice: "ru-RU-DmitryNeural",
    languageCode: "ru",
    sampleText: "Этот голос будет рассказывать историю спокойно, ясно и с естественными паузами.",
    sampleCharacterCount: 80,
    sampleWordCount: 11,
    audioDurationSeconds: 6.255,
    charactersPerSecond: 12.789,
    wordsPerMinute: 105.516,
    calibratedAt: "2026-09-07T00:00:00.000Z",
  };
  assert.ok(findSceneIssues([scene]).some((issue) => issue.kind === "length"), "старый общий лимит воспроизводит ложную ошибку");
  assert.equal(
    findSceneIssues([scene], 1, createNarrationTimingBudget(calibration, 60)).some((issue) => issue.kind === "length"),
    false,
    "измеренная скорость подтверждает, что реплика помещается"
  );

  // The previous fixture asked for 60 s with only 9.5 s of text. Keep this a
  // per-frame calibration regression, not permission to ignore the ±5% contract.
  const fullScenes = Array.from({ length: 4 }, (_, order) => ({ ...scene, id: `calibrated-${order}`, order }));
  const settings = createDefaultProjectSettings();
  settings.durationMinutes = fullScenes.map(item => item.narration).join(" ").length / calibration.charactersPerSecond / 60;
  settings.voice = { ...settings.voice, enabled: true, calibration };
  settings.image.provider = "mock-image";
  const repository = new MemoryProjectRepository();
  const projects = new ProjectService(repository, new MockDirectorProvider());
  await repository.save(makeProject({
    scenes: fullScenes,
    settings,
    mediaMode: "ai",
    referenceAnalysis: {
      sourceUrl: "chat://calibrated-preflight",
      sourceTitle: "Тест",
      niche: "История",
      targetAudience: "Зрители",
      hook: "Ключ найден",
      structure: [],
      strengths: [],
      improvements: [],
      suggestedAngle: "Развязка",
      suggestedTitle: "Ключ",
      recommendedDurationSeconds: 60,
      language: "Русский",
      scenes: fullScenes,
      provider: "anymodel:test",
      scenarioQuality: makeScenarioQuality(fullScenes),
    },
  }));
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(new MemoryTaskRepository(), projects, storage, new StandardRenderer(storage));
  const tasks = await pipeline.start("p1");
  assert.ok(tasks.length > 0, "калиброванная реплика допущена в очередь");
  await pipeline.stop("p1");
});

test("очередь не запускает производство очевидно незавершённого AnyModel-сценария", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-incomplete-script-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const durations = allocateSceneDurations(180);
  const scenes = durations.map((durationSeconds, order) => makeScene({
    id: `s${order + 1}`,
    order,
    durationSeconds,
    narration: order === durations.length - 1
      ? "И полиция едет открывать ячейку."
      : "Полицейские продолжают расследование, внимательно сверяют показания и находят очередную важную деталь в этом деле.",
    imagePrompt: "police investigation at night",
    animationPrompt: "camera moves through the room"
  }));
  const settings = createDefaultProjectSettings();
  settings.durationMinutes = 3;
  settings.voice.enabled = false;
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  await projectRepository.save(makeProject({
    scenes,
    settings,
    referenceAnalysis: {
      sourceUrl: "chat://test",
      sourceTitle: "Тест",
      niche: "История",
      targetAudience: "Зрители",
      hook: "Загадочный звонок",
      structure: [],
      strengths: [],
      improvements: [],
      suggestedAngle: "Расследование",
      suggestedTitle: "Номер 17",
      recommendedDurationSeconds: 180,
      language: "Русский",
      scenes,
      provider: "anymodel:test",
      scenarioQuality: makeScenarioQuality(scenes, { complete: false, endingResolved: false })
    }
  }));
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    projectService,
    storage,
    new StandardRenderer(storage)
  );
  await assert.rejects(() => pipeline.start("p1"), /Сценарий не готов к производству.*автопроверка не подтвердила/);
  assert.equal((await pipeline.list()).length, 0);
});

test("готовый вставленный сценарий требует текущий audit marker, но не AI-оценку развязки", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-ready-script-audit-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const scene = makeScene({
    id: "ready-script-scene",
    narration: "Исходный текст пользователя остаётся без редакционного переписывания.",
    imagePrompt: "documentary scene",
    animationPrompt: "camera slowly moves closer"
  });
  const settings = createDefaultProjectSettings();
  settings.voice.enabled = false;
  const videoBrief = {
    prompt: "",
    competitorTranscripts: [],
    creationMode: "script" as const,
    readyScript: scene.narration
  };
  const baseAnalysis: ReferenceAnalysis = {
    sourceUrl: "chat://ready-script",
    sourceTitle: "Тест",
    niche: "История",
    targetAudience: "Зрители",
    hook: scene.narration,
    structure: [],
    strengths: [],
    improvements: [],
    suggestedAngle: "Готовый текст",
    suggestedTitle: "Готовый сценарий",
    recommendedDurationSeconds: 5,
    language: "Русский",
    scenes: [scene],
    provider: "anymodel:test+ready-script"
  };
  const missingRepository = new MemoryProjectRepository();
  const missingProjects = new ProjectService(missingRepository, new MockDirectorProvider());
  await missingRepository.save(makeProject({ scenes: [scene], settings, mediaMode: "ai", videoBrief, referenceAnalysis: baseAnalysis }));
  const missingPipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    missingProjects,
    new LocalProjectStorage(directory),
    new StandardRenderer(new LocalProjectStorage(directory))
  );
  await assert.rejects(
    () => missingPipeline.start("p1"),
    /Сценарий не готов к производству.*отсутствует актуальная финальная проверка/
  );

  const auditedRepository = new MemoryProjectRepository();
  const auditedProjects = new ProjectService(auditedRepository, new MockDirectorProvider());
  await auditedRepository.save(makeProject({
    id: "ready-script",
    scenes: [scene],
    settings,
    mediaMode: "ai",
    videoBrief,
    referenceAnalysis: {
      ...baseAnalysis,
      scenarioQuality: makeScenarioQuality([scene], { complete: false, endingResolved: false })
    }
  }));
  const auditedStorage = new LocalProjectStorage(directory);
  const auditedPipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    auditedProjects,
    auditedStorage,
    new StandardRenderer(auditedStorage)
  );
  const tasks = await auditedPipeline.start("ready-script");
  assert.ok(tasks.length > 0);
  await auditedPipeline.stop("ready-script");
});

test("очередь требует повторной проверки после ручного изменения проверенного сценария", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-stale-script-audit-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const durations = allocateSceneDurations(60);
  const originalScenes = durations.map((durationSeconds, order) => makeScene({
    id: `s${order + 1}`,
    order,
    durationSeconds,
    narration: order === durations.length - 1
      ? "Героя находят живым, подозреваемого задерживают, и расследование получает ясную завершённую развязку."
      : "Следователь проверяет новую улику, разговаривает со свидетелями и последовательно восстанавливает события этого дела.",
    imagePrompt: "detective examines evidence",
    animationPrompt: "camera slowly moves closer"
  }));
  const changedScenes = originalScenes.map((scene, index) => index === 2
    ? { ...scene, narration: "Эта ключевая часть была вручную удалена." }
    : scene);
  const settings = createDefaultProjectSettings();
  settings.durationMinutes = 1;
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  await projectRepository.save(makeProject({
    scenes: changedScenes,
    settings,
    referenceAnalysis: {
      sourceUrl: "chat://stale",
      sourceTitle: "Тест",
      niche: "История",
      targetAudience: "Зрители",
      hook: "Улика",
      structure: [],
      strengths: [],
      improvements: [],
      suggestedAngle: "Расследование",
      suggestedTitle: "Проверенный сценарий",
      recommendedDurationSeconds: 60,
      language: "Русский",
      scenes: changedScenes,
      provider: "anymodel:test",
      scenarioQuality: {
        version: 1,
        checkedAt: new Date().toISOString(),
        targetSeconds: 60,
        totalDurationSeconds: 60,
        wordCount: 120,
        sceneCount: originalScenes.length,
        fingerprint: scenarioFingerprint(originalScenes),
        complete: true,
        endingResolved: true,
        repaired: false,
        requiredBeats: ["найти героя", "задержать подозреваемого"]
      }
    }
  }));
  const storage = new LocalProjectStorage(directory);
  const pipeline = new MockGenerationPipeline(new MemoryTaskRepository(), projectService, storage, new StandardRenderer(storage));
  await assert.rejects(() => pipeline.start("p1"), /текст менялся после последней проверки полноты/);
});

test("AnyModel автоматически дописывает потерянную развязку и повторно сверяет её с исходным brief", async () => {
  const client = new AnyModelClient({
    publicSettings: async () => ({ textModel: "test-model" })
  } as never);
  let auditCalls = 0;
  let repairCalls = 0;
  const auditPrompts: string[] = [];
  (client as unknown as {
    chat(model: string, messages: Array<{ role: string; content: string }>): Promise<string>;
  }).chat = async (_model, messages) => {
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    const user = messages.find((message) => message.role === "user")?.content ?? "";
    if (/главный редактор YouTube-сценария/.test(system)) {
      return JSON.stringify({
        title: "Номер 17",
        promise: "Объяснить звонок",
        tone: "Напряжённый",
        visualBible: "Ночной мотель",
        continuityRules: [],
        requiredBeats: ["женщину находят живой", "администратора задерживают"],
        endingResolution: "Спасти женщину, задержать администратора и объяснить улики",
        sections: [
          { title: "Завязка", goal: "Звонок", keyPoints: ["пустой номер"], transition: "к расследованию" },
          { title: "Финал", goal: "Спасение", keyPoints: ["женщина жива", "арест"], transition: "итог" }
        ]
      });
    }
    if (/строгий редактор сценария/.test(system)) return '{"issues":[]}';
    if (/выпускающий редактор/.test(system)) {
      auditCalls += 1;
      auditPrompts.push(user);
      if (auditCalls === 1) {
        return '{"complete":false,"endingResolved":false,"missingRequiredBeats":["женщину находят живой","администратора задерживают"],"unresolvedSetups":["что было в технической комнате"],"rewriteFromScene":3,"reason":"история оборвалась до развязки"}';
      }
      if (auditCalls === 2) {
        return '{"complete":false,"endingResolved":true,"missingRequiredBeats":[],"unresolvedSetups":["не объяснено, зачем администратор подготовил пустой номер"],"rewriteFromScene":4,"reason":"развязка есть, но одна причинная связь осталась неясной"}';
      }
      return '{"complete":true,"endingResolved":true,"missingRequiredBeats":[],"unresolvedSetups":[],"rewriteFromScene":4,"reason":"все события и развязка на месте"}';
    }
    if (/исправляешь незавершённый сценарий/.test(system)) {
      repairCalls += 1;
      return JSON.stringify([
        { title: "Звонок", narration: "Диспетчер принимает ночной звонок, а патруль сразу выезжает к придорожному мотелю.", imagePrompt: "police dispatcher at night", animationPrompt: "camera moves closer" },
        { title: "Улика", narration: "За пустым номером полицейские находят техническую комнату и старую телефонную линию.", imagePrompt: "motel utility room", animationPrompt: "camera pans across wires" },
        { title: "Спасение", narration: "В запертой комнате они находят женщину живой и выводят её в безопасное место.", imagePrompt: "police rescue woman", animationPrompt: "officers open the door" },
        { title: "Развязка", narration: "Администратора задерживают, а душ, следы, кофе и ключ оказываются частью его отвлекающего плана.", imagePrompt: "motel manager arrested", animationPrompt: "police lead suspect away" }
      ]);
    }
    if (/сценарист вирусных YouTube-роликов/.test(system)) {
      return JSON.stringify([
        { title: "Звонок", narration: "Ночной диспетчер принимает странный звонок из семнадцатого номера придорожного мотеля.", imagePrompt: "police dispatcher at night", animationPrompt: "camera moves closer" },
        { title: "Комната", narration: "Патруль входит внутрь и замечает горячий кофе, мокрый пол и открытый душ.", imagePrompt: "empty motel room", animationPrompt: "camera pans across room" },
        { title: "Ключ", narration: "Под столом детектив находит ключ от ячейки и связывает его со старым делом.", imagePrompt: "metal locker key", animationPrompt: "camera focuses on key" },
        { title: "Обрыв", narration: "Теперь полиция едет открывать ячейку и искать ответ на загадочный звонок.", imagePrompt: "police car at night", animationPrompt: "police car drives away" }
      ]);
    }
    throw new Error(`Неожиданный тестовый запрос: ${system.slice(0, 80)}`);
  };

  const brief = "Обязательно найди женщину живой в технической комнате, задержи администратора и объясни все улики.";
  const result = await client.regenerateScenes({
    sourceUrl: "chat://script",
    sourceTitle: "Номер 17",
    niche: "Полицейские истории",
    targetAudience: "Зрители",
    hook: "Звонок из пустого номера",
    structure: [],
    strengths: [],
    improvements: [],
    suggestedAngle: "Расследование в мотеле",
    suggestedTitle: "Номер 17",
    recommendedDurationSeconds: 30,
    language: "Русский",
    instructions: brief,
    scenes: [],
    provider: "anymodel:test"
  }, 30);
  assert.equal(auditCalls, 3);
  assert.equal(repairCalls, 2);
  assert.ok(auditPrompts.every((prompt) => prompt.includes(brief)));
  assert.equal(result.scenarioQuality?.complete, true);
  assert.equal(result.scenarioQuality?.repaired, true);
  assert.match(result.scenes.at(-2)?.narration ?? "", /женщину живой/);
  assert.match(result.scenes.at(-1)?.narration ?? "", /задерживают/);
});

test("автопочинка переписывает весь связанный хвост одним атомарным запросом, не меняя готовое начало", async () => {
  const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "test-model" }) } as never);
  const durations = Array(40).fill(8);
  const scenes = durations.map((durationSeconds, order) => makeScene({
    id: `original-${order + 1}`,
    order,
    durationSeconds,
    title: `Original ${order + 1}`,
    narration: `Witness${order + 1} records alpha${order + 1} bravo${order + 1} charlie${order + 1} delta${order + 1} echo${order + 1} clearly.`,
    imagePrompt: `original evidence ${order + 1}`,
    stockQuery: `evidence ${order + 1}`,
    animationPrompt: `camera tracks artifact ${order + 1}`,
  }));
  const originalSnapshot = structuredClone(scenes);
  const requestedRanges: Array<{ from: number; to: number }> = [];
  const repairTimeouts: Array<number | undefined> = [];
  const repairReasoning: Array<string | undefined> = [];
  const maxTokenBudgets: Array<number | undefined> = [];
  const checkpoints: Scene[][] = [];
  const internals = client as unknown as {
    chat(
      model: string,
      messages: Array<{ role: string; content: string }>,
      maxTokens?: number,
      reasoning?: string,
      signal?: AbortSignal,
      timeoutMs?: number
    ): Promise<string>;
    repairIncompleteScenario(
      plan: unknown,
      scenes: Scene[],
      durations: number[],
      language: string,
      projectBrief: string | undefined,
      audit: unknown,
      readiness: ReturnType<typeof inspectScenarioReadiness>,
      model: string,
      signal?: AbortSignal,
      onCheckpoint?: (value: Scene[]) => void | Promise<void>
    ): Promise<Scene[]>;
  };
  internals.chat = async (_model, messages, maxTokens, reasoning, _signal, timeoutMs) => {
    maxTokenBudgets.push(maxTokens);
    repairTimeouts.push(timeoutMs);
    repairReasoning.push(reasoning);
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    const request = messages.find((message) => message.role === "user")?.content ?? "";
    assert.match(system, /весь связанный проблемный хвост ОДНИМ согласованным блоком/);
    assert.match(system, /единую хронологию, инвентарь, список договорённостей/);
    assert.match(request, /# ВЕСЬ ХВОСТ ДЛЯ СОГЛАСОВАННОЙ ПЕРЕПИСИ/);
    const range = /Перепиши одним ответом все сцены (\d+)–(\d+)/.exec(request);
    assert.ok(range, "repair request must name its exact range");
    const from = Number(range[1]);
    const to = Number(range[2]);
    requestedRanges.push({ from, to });
    const count = to - from + 1;
    return JSON.stringify(Array.from({ length: count }, (_unused, offset) => {
      const sceneNumber = from + offset;
      return {
        title: `Rewritten ${sceneNumber}`,
        narration: sceneNumber === scenes.length
          ? `Officers${sceneNumber} arrest suspect${sceneNumber}, recover evidence${sceneNumber}, explain motive${sceneNumber}, and formally close case${sceneNumber}.`
          : `Detective${sceneNumber} verifies foxtrot${sceneNumber} golf${sceneNumber} hotel${sceneNumber} india${sceneNumber} juliet${sceneNumber} carefully.`,
        imagePrompt: `rewritten evidence ${sceneNumber}`,
        stockQuery: `detective evidence ${sceneNumber}`,
        animationPrompt: `camera approaches clue ${sceneNumber}`,
      };
    }));
  };

  const plan = {
    title: "Case", promise: "Resolve it", tone: "Clear", visualBible: "Police archive",
    continuityRules: [], requiredBeats: ["arrest suspect"], endingResolution: "Close the case",
    sections: [{ title: "Investigation", goal: "Resolve it", keyPoints: ["arrest"], transition: "ending" }],
  };
  const result = await internals.repairIncompleteScenario(
    plan,
    scenes,
    durations,
    "English",
    "The suspect must be arrested and the case closed.",
    {
      complete: false,
      endingResolved: false,
      missingRequiredBeats: ["arrest suspect"],
      unresolvedSetups: [],
      rewriteFromScene: 16,
      reason: "ending missing",
    },
    inspectScenarioReadiness(scenes, 320),
    "test-model",
    undefined,
    (value) => { checkpoints.push(value); }
  );

  assert.deepEqual(requestedRanges, [{ from: 16, to: 40 }]);
  assert.deepEqual(repairTimeouts, requestedRanges.map(({ from, to }) => scenarioRepairRequestProfile("test-model", to - from + 1).timeoutMs));
  assert.deepEqual(repairReasoning, requestedRanges.map(({ from, to }) => scenarioRepairRequestProfile("test-model", to - from + 1).reasoningEffort));
  assert.deepEqual(maxTokenBudgets, [11_700]);
  assert.equal(checkpoints.length, 1, "the coherent tail is checkpointed atomically");
  for (let index = 0; index < 15; index += 1) assert.strictEqual(result[index], scenes[index]);
  assert.deepEqual(result.map((scene) => scene.id), scenes.map((scene) => scene.id));
  assert.deepEqual(result.map((scene) => scene.order), scenes.map((scene) => scene.order));
  assert.match(result[15]!.narration, /Detective16/);
  assert.match(result.at(-1)!.narration, /formally close case40/);
  assert.deepEqual(scenes, originalSnapshot, "repair must not mutate the source scenes while replacing tail blocks");
});

test("автопочинка сообщает точный диапазон и причину обрезанного ответа вместо ошибки про 0 сцен", async () => {
  const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "test-model" }) } as never);
  const durations = Array(8).fill(8);
  const scenes = durations.map((durationSeconds, order) => makeScene({
    id: `safe-${order + 1}`,
    order,
    durationSeconds,
    narration: `Reporter${order + 1} checks unique${order + 1} records${order + 1} facts${order + 1} safely${order + 1}.`,
    imagePrompt: `safe record ${order + 1}`,
    animationPrompt: `camera observes record ${order + 1}`,
  }));
  const sourceSnapshot = structuredClone(scenes);
  const internals = client as unknown as {
    chat(): Promise<string>;
    repairIncompleteScenario(
      plan: unknown, scenes: Scene[], durations: number[], language: string, projectBrief: string | undefined,
      audit: unknown, readiness: ReturnType<typeof inspectScenarioReadiness>, model: string
    ): Promise<Scene[]>;
  };
  let completionCalls = 0;
  internals.chat = async () => {
    completionCalls += 1;
    const error = new Error("AnyModel обрезал ответ из-за лимита токенов (finish_reason: length)");
    error.name = "AnyModelOutputFormatError";
    throw error;
  };

  await assert.rejects(
    () => internals.repairIncompleteScenario(
      {
        title: "Case", promise: "Finish", tone: "Clear", visualBible: "Archive", continuityRules: [],
        requiredBeats: ["close case"], endingResolution: "Case closed",
        sections: [{ title: "End", goal: "Close", keyPoints: ["close"], transition: "result" }],
      },
      scenes,
      durations,
      "English",
      "Close the case.",
      {
        complete: false, endingResolved: false, missingRequiredBeats: ["close case"], unresolvedSetups: [],
        rewriteFromScene: 5, reason: "missing ending",
      },
      inspectScenarioReadiness(scenes, 64),
      "test-model"
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /сценах 5–8/);
      assert.match(error.message, /обрезал ответ из-за лимита токенов.*finish_reason: length/);
      assert.doesNotMatch(error.message, /0 сцен/);
      return true;
    }
  );
  assert.equal(completionCalls, 1, "a failed coherent repair must not be blindly resubmitted or split");
  assert.deepEqual(scenes, sourceSnapshot);
});

test("таймаут автопочинки учитывает медленную модель и не отправляет второй completion", async () => {
  const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "cc/claude-opus-5" }) } as never);
  const durations = Array(40).fill(8);
  const scenes = durations.map((durationSeconds, order) => makeScene({
    id: `timeout-${order + 1}`,
    order,
    durationSeconds,
    narration: `Narrator${order + 1} explains unique point${order + 1} with enough concrete context for this scene.`,
    imagePrompt: `concrete scene ${order + 1}`,
    animationPrompt: `camera moves through scene ${order + 1}`,
  }));
  let completionCalls = 0;
  let usedTimeout: number | undefined;
  let usedReasoning: string | undefined;
  const internals = client as unknown as {
    chat(
      model: string, messages: Array<{ role: string; content: string }>, maxTokens?: number,
      reasoning?: string, signal?: AbortSignal, timeoutMs?: number
    ): Promise<string>;
    repairIncompleteScenario(
      plan: unknown, scenes: Scene[], durations: number[], language: string, projectBrief: string | undefined,
      audit: unknown, readiness: ReturnType<typeof inspectScenarioReadiness>, model: string,
      signal?: AbortSignal, onCheckpoint?: (value: Scene[]) => void | Promise<void>
    ): Promise<Scene[]>;
  };
  internals.chat = async (_model, _messages, _maxTokens, reasoning, _signal, timeoutMs) => {
    completionCalls += 1;
    usedTimeout = timeoutMs;
    usedReasoning = reasoning;
    const error = new Error(`AnyModel не ответил за ${Math.ceil((timeoutMs ?? 0) / 1_000)} секунд`);
    error.name = "AnyModelResponseTimeoutError";
    throw error;
  };
  let checkpoints = 0;

  await assert.rejects(
    () => internals.repairIncompleteScenario(
      {
        title: "Case", promise: "Finish", tone: "Clear", visualBible: "Archive", continuityRules: [],
        requiredBeats: ["close case"], endingResolution: "Case closed",
        sections: [{ title: "End", goal: "Close", keyPoints: ["close"], transition: "result" }],
      },
      scenes,
      durations,
      "English",
      "Close the case.",
      {
        complete: false, endingResolved: false, missingRequiredBeats: ["close case"], unresolvedSetups: [],
        rewriteFromScene: 16, reason: "missing ending",
      },
      inspectScenarioReadiness(scenes, 320),
      "cc/claude-opus-5",
      undefined,
      () => { checkpoints += 1; }
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /сценах 16–40/);
      assert.match(error.message, /300 секунд/);
      assert.match(error.message, /Автоматический повтор не отправлен/);
      assert.match(error.message, /продолжит с этого черновика, не станет заново писать все сцены/);
      return true;
    }
  );
  assert.equal(completionCalls, 1);
  assert.equal(checkpoints, 0);
  assert.equal(usedTimeout, 300_000);
  assert.equal(usedReasoning, "medium");
});

test("маленький repair-блок получает low reasoning и реалистичное окно медленной модели", () => {
  assert.deepEqual(scenarioRepairRequestProfile("cc/claude-opus-5", 1), {
    timeoutMs: 180_000,
    reasoningEffort: "low",
  });
  assert.deepEqual(scenarioRepairRequestProfile("gpt-6-astra", 4), {
    timeoutMs: 240_000,
    reasoningEffort: "medium",
  });
  assert.deepEqual(scenarioRepairRequestProfile("fast-model", 1), {
    timeoutMs: 90_000,
    reasoningEffort: "low",
  });
});

test("resume принимает непрерывный prefix той же темы и хронометража без производственных артефактов", () => {
  const durations = allocateSceneDurations(30);
  const scenes = durations.map((durationSeconds, order) => makeScene({
    id: `resume-${order + 1}`,
    order,
    durationSeconds,
    status: "draft",
    narration: `Уникальная законченная мысль номер ${order + 1} с достаточным количеством конкретных слов.`,
    imagePrompt: `specific visual ${order + 1}`,
    animationPrompt: `camera moves naturally ${order + 1}`,
  }));
  const analysis: ReferenceAnalysis = {
    sourceUrl: "chat://topic-resume",
    sourceTitle: "Resume",
    niche: "Explainer",
    targetAudience: "Viewers",
    hook: "Hook",
    structure: [],
    strengths: [],
    improvements: [],
    suggestedAngle: "Angle",
    suggestedTitle: "Resume",
    recommendedDurationSeconds: 30,
    language: "Русский",
    scenes: structuredClone(scenes),
    provider: "anymodel:test",
  };
  const project = makeProject({
    status: "draft",
    chatTopicId: "topic-resume",
    scenes,
    referenceAnalysis: analysis,
  });

  assert.equal(resumableScenarioDraft(project, "topic-resume", 30)?.length, durations.length);
  const prefixProject = {
    ...project,
    scenes: project.scenes.slice(0, 2),
    referenceAnalysis: { ...analysis, scenes: analysis.scenes.slice(0, 2) },
  };
  assert.deepEqual(
    resumableScenarioDraft(prefixProject, "topic-resume", 30)?.map((scene) => scene.id),
    scenes.slice(0, 2).map((scene) => scene.id)
  );
  assert.equal(resumableScenarioDraft({ ...project, status: "failed" }, "topic-resume", 30), undefined);
  assert.equal(resumableScenarioDraft(project, "another-topic", 30), undefined);
  assert.equal(resumableScenarioDraft(project, "topic-resume", 60), undefined);
  assert.equal(resumableScenarioDraft({
    ...prefixProject,
    referenceAnalysis: { ...prefixProject.referenceAnalysis, recommendedDurationSeconds: 31 },
  }, "topic-resume", 30), undefined);
  assert.equal(resumableScenarioDraft({
    ...project,
    scenes: project.scenes.map((scene, index) => index === 0 ? { ...scene, audioPath: "voice.mp3" } : scene),
  }, "topic-resume", 30), undefined);
  assert.equal(resumableScenarioDraft({
    ...project,
    referenceAnalysis: {
      ...analysis,
      scenarioQuality: {
        version: 1, checkedAt: new Date(0).toISOString(), targetSeconds: 30,
        totalDurationSeconds: 30, wordCount: 100, sceneCount: scenes.length,
        fingerprint: "done", complete: true, endingResolved: true, repaired: false, requiredBeats: [],
      },
    },
  }, "topic-resume", 30), undefined);
});

test("regenerateScenes продолжает сохранённый draft без повторной записи и общей AI-рецензии", async () => {
  const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "test-model" }) } as never);
  const durations = allocateSceneDurations(30);
  const draft = durations.map((durationSeconds, order) => makeScene({
    id: `continued-${order + 1}`,
    order,
    durationSeconds,
    narration: order === durations.length - 1
      ? "В финале все варианты сравнили по одинаковым критериям и выбрали проверяемый следующий шаг."
      : `Автор объясняет уникальный практический критерий номер ${order + 1} и показывает понятный пример его применения.`,
    imagePrompt: `practical example ${order + 1}`,
    stockQuery: `practical example ${order + 1}`,
    animationPrompt: `camera moves closer ${order + 1}`,
  }));
  const plan = {
    title: "Three services", promise: "Compare services", tone: "Clear", visualBible: "Everyday work",
    continuityRules: [], requiredBeats: [], endingResolution: "Choose a test",
    sections: [{ title: "Comparison", goal: "Compare", keyPoints: [], transition: "result" }],
  };
  let buildCalls = 0;
  let reviewCalls = 0;
  const internals = client as unknown as {
    createScenarioPlan(): Promise<typeof plan>;
    buildScenes(): Promise<Scene[]>;
    reviewScenes(): Promise<Scene[]>;
    auditScenarioCompleteness(): Promise<{
      complete: boolean; endingResolved: boolean; missingRequiredBeats: string[];
      unresolvedSetups: string[]; rewriteFromScene: number; reason: string;
    }>;
  };
  internals.createScenarioPlan = async () => plan;
  internals.buildScenes = async () => { buildCalls += 1; throw new Error("must not rebuild"); };
  internals.reviewScenes = async () => { reviewCalls += 1; throw new Error("must not review all scenes again"); };
  internals.auditScenarioCompleteness = async () => ({
    complete: true, endingResolved: true, missingRequiredBeats: [], unresolvedSetups: [],
    rewriteFromScene: draft.length, reason: "complete",
  });
  const stages: string[] = [];
  const result = await client.regenerateScenes({
    sourceUrl: "chat://topic-resume",
    sourceTitle: "Three services",
    niche: "Business explainer",
    targetAudience: "Viewers",
    hook: "Three services",
    structure: [],
    strengths: [],
    improvements: [],
    suggestedAngle: "Compare",
    suggestedTitle: "Three services",
    recommendedDurationSeconds: 30,
    language: "Русский",
    instructions: "Compare three services.",
    scenes: [],
    provider: "anymodel:test",
  }, 30, (_done, _total, stage) => { if (stage) stages.push(stage); }, undefined, undefined, "local", undefined, undefined, draft);

  assert.equal(buildCalls, 0);
  assert.equal(reviewCalls, 0);
  assert.deepEqual(result.scenes.map((scene) => scene.id), draft.map((scene) => scene.id));
  assert.ok(stages.some((stage) => /не нужно/.test(stage)));
});

test("AnyModel сохраняет каждый принятый batch и продолжает suffix с контекстом без повтора uncertain completion", async () => {
  const durations = Array(20).fill(8);
  const plan = {
    title: "Reliable batches", promise: "Finish", tone: "Clear", visualBible: "Workshop",
    continuityRules: [], requiredBeats: [], endingResolution: "Finished",
    sections: [{ title: "Story", goal: "Continue", keyPoints: [], transition: "ending" }],
  };
  const payload = (from: number, count: number) => Array.from({ length: count }, (_unused, index) => ({
    title: `Scene ${from + index + 1}`,
    narration: `Accepted narration ${from + index + 1}.`,
    imagePrompt: `accepted visual ${from + index + 1}`,
    stockQuery: `visual ${from + index + 1}`,
    animationPrompt: `camera movement ${from + index + 1}`,
  }));

  const firstClient = new AnyModelClient({ publicSettings: async () => ({ textModel: "test-model" }) } as never);
  const first = firstClient as unknown as {
    chat(model: string, messages: Array<{ role: string; content: string }>): Promise<string>;
    buildScenes(plan: unknown, durations: number[], language: string, model: string, onProgress?: unknown,
      brief?: string, signal?: AbortSignal, timing?: unknown, checkpoint?: (scenes: Scene[]) => void,
      initialScenes?: Scene[]): Promise<Scene[]>;
  };
  let completionCalls = 0;
  first.chat = async () => {
    completionCalls += 1;
    if (completionCalls === 1) return JSON.stringify(payload(0, 15));
    const error = new Error("connection reset");
    error.name = "AnyModelCompletionUncertainError";
    throw error;
  };
  const checkpointSizes: number[] = [];
  let prefix: Scene[] = [];
  await assert.rejects(
    () => first.buildScenes(plan, durations, "English", "test-model", undefined, undefined, undefined, undefined, (scenes) => {
      prefix = structuredClone(scenes);
      checkpointSizes.push(scenes.length);
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "AnyModelCompletionUncertainError");
      assert.match(error.message, /Не завершён блок сцен 16–20/);
      assert.match(error.message, /Сохранено 15 из 20 сцен/);
      return true;
    }
  );
  assert.equal(completionCalls, 2, "uncertain second batch must not be replayed");
  assert.deepEqual(checkpointSizes, [15]);

  const secondClient = new AnyModelClient({ publicSettings: async () => ({ textModel: "test-model" }) } as never);
  const second = secondClient as unknown as typeof first;
  let resumeRequest = "";
  second.chat = async (_model, messages) => {
    resumeRequest = messages.find((message) => message.role === "user")?.content ?? "";
    return JSON.stringify(payload(15, 5));
  };
  const resumed = await second.buildScenes(
    plan, durations, "English", "test-model", undefined, undefined, undefined, undefined, undefined, prefix
  );
  assert.match(resumeRequest, /Accepted narration 14/);
  assert.match(resumeRequest, /Accepted narration 15/);
  assert.deepEqual(resumed.slice(0, prefix.length), prefix, "accepted prefix IDs and content stay unchanged");
  assert.equal(resumed.length, durations.length);
});

test("AnyModel повторяет пустой финальный аудит с меньшим reasoning и сохраняет готовые сцены", async () => {
  const client = new AnyModelClient({
    publicSettings: async () => ({ textModel: "cc/claude-opus-5" })
  } as never);
  const auditProfiles: Array<{ maxTokens?: number; reasoning?: string }> = [];
  (client as unknown as {
    chat(
      model: string,
      messages: Array<{ role: string; content: string }>,
      maxTokens?: number,
      reasoning?: string
    ): Promise<string>;
  }).chat = async (_model, messages, maxTokens, reasoning) => {
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    if (/главный редактор YouTube-сценария/.test(system)) {
      return JSON.stringify({
        title: "Эксперт",
        promise: "Раскрыть личность преступника",
        tone: "Напряжённый",
        visualBible: "Полицейское расследование",
        continuityRules: [],
        requiredBeats: ["полиция находит склад", "подозреваемого задерживают"],
        endingResolution: "Показать улики и задержание",
        sections: [
          { title: "Нападение", goal: "Начать расследование", keyPoints: ["ночной вызов"], transition: "к уликам" },
          { title: "Развязка", goal: "Найти склад и задержать подозреваемого", keyPoints: ["обыск", "арест"], transition: "итог" }
        ]
      });
    }
    if (/строгий редактор сценария/.test(system)) return '{"issues":[]}';
    if (/выпускающий редактор/.test(system)) {
      auditProfiles.push({ maxTokens, reasoning });
      return auditProfiles.length === 1
        ? "   \n  "
        : '{"complete":true,"endingResolved":true,"missingRequiredBeats":[],"unresolvedSetups":[],"rewriteFromScene":4,"reason":"сценарий завершён"}';
    }
    if (/сценарист вирусных YouTube-роликов/.test(system)) {
      return JSON.stringify([
        { title: "Вызов", narration: "Ночной взрыв возле дома начальника полиции заставляет детективов искать неизвестного преступника.", imagePrompt: "police house at night", stockQuery: "police house night", animationPrompt: "camera moves toward the house" },
        { title: "Эксперт", narration: "Пожилой технический эксперт сам предлагает следствию помощь и уверенно разбирает найденные улики.", imagePrompt: "retired police expert", stockQuery: "retired police expert", animationPrompt: "camera slowly moves closer" },
        { title: "Склад", narration: "Наблюдение приводит полицейских к складу, где они находят записи и материалы подозреваемого.", imagePrompt: "police searching storage unit", stockQuery: "storage unit search", animationPrompt: "officers enter the storage unit" },
        { title: "Арест", narration: "Подозреваемого задерживают, а найденные документы окончательно объясняют его мотив и прежние нападения.", imagePrompt: "police arrest suspect", stockQuery: "police arrest suspect", animationPrompt: "police lead the suspect away" }
      ]);
    }
    throw new Error(`Неожиданный тестовый запрос: ${system.slice(0, 80)}`);
  };

  const result = await client.regenerateScenes({
    sourceUrl: "chat://audit-retry",
    sourceTitle: "Эксперт",
    niche: "Полицейские истории",
    targetAudience: "Зрители",
    hook: "Эксперт знает слишком много",
    structure: [],
    strengths: [],
    improvements: [],
    suggestedAngle: "Расследование",
    suggestedTitle: "Эксперт",
    recommendedDurationSeconds: 30,
    language: "Русский",
    instructions: "Полиция должна найти склад и задержать подозреваемого.",
    scenes: [],
    provider: "anymodel:test"
  }, 30);

  assert.deepEqual(auditProfiles, [
    { maxTokens: 4_000, reasoning: "medium" },
    { maxTokens: 4_000, reasoning: "low" }
  ]);
  assert.equal(result.scenarioQuality?.complete, true);
  assert.equal(result.scenarioQuality?.repaired, false);
  assert.equal(result.scenes.length, 4);
});

test("AnyModel принимает полный сценарий локально после двух невалидных JSON-аудитов", async () => {
  const client = new AnyModelClient({
    publicSettings: async () => ({ textModel: "cc/claude-opus-5" })
  } as never);
  let auditCalls = 0;
  (client as unknown as {
    chat(model: string, messages: Array<{ role: string; content: string }>): Promise<string>;
  }).chat = async (_model, messages) => {
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    if (/главный редактор YouTube-сценария/.test(system)) {
      return JSON.stringify({
        title: "Эксперт",
        promise: "Раскрыть преступника",
        tone: "Напряжённый",
        visualBible: "Расследование",
        continuityRules: [],
        requiredBeats: ["полиция находит склад", "подозреваемого задерживают"],
        endingResolution: "Показать задержание",
        sections: [
          { title: "Начало", goal: "Начать расследование", keyPoints: ["нападение"], transition: "к поиску" },
          { title: "Финал", goal: "Раскрыть дело", keyPoints: ["склад", "задержание"], transition: "итог" }
        ]
      });
    }
    if (/строгий редактор сценария/.test(system)) return '{"issues":[]}';
    if (/выпускающий редактор/.test(system)) {
      auditCalls += 1;
      return "{}";
    }
    if (/сценарист вирусных YouTube-роликов/.test(system)) {
      return JSON.stringify([
        { title: "Нападение", narration: "Ночью возле дома полицейского происходит нападение, и следователи начинают искать неизвестного преступника.", imagePrompt: "police house investigation", stockQuery: "police house investigation", animationPrompt: "camera approaches the house" },
        { title: "Эксперт", narration: "Опытный эксперт предлагает помощь и неожиданно точно объясняет происхождение каждой найденной детали.", imagePrompt: "investigator evidence table", stockQuery: "investigator evidence table", animationPrompt: "camera pans across evidence" },
        { title: "Склад", narration: "Полицейские обнаружили склад подозреваемого, а внутри нашли документы, связывающие его с нападениями.", imagePrompt: "police storage search", stockQuery: "police storage search", animationPrompt: "officers search storage unit" },
        { title: "Финал", narration: "Подозреваемого задерживают, улики получают объяснение, и расследование официально считается завершённым.", imagePrompt: "suspect arrested by police", stockQuery: "police arrest suspect", animationPrompt: "police escort suspect away" }
      ]);
    }
    throw new Error(`Неожиданный тестовый запрос: ${system.slice(0, 80)}`);
  };

  const result = await client.regenerateScenes({
    sourceUrl: "chat://audit-local-fallback",
    sourceTitle: "Эксперт",
    niche: "Полицейские истории",
    targetAudience: "Зрители",
    hook: "Эксперт знает слишком много",
    structure: [],
    strengths: [],
    improvements: [],
    suggestedAngle: "Расследование",
    suggestedTitle: "Эксперт",
    recommendedDurationSeconds: 30,
    language: "Русский",
    instructions: "Полиция находит склад, после чего подозреваемого задерживают.",
    scenes: [],
    provider: "anymodel:test"
  }, 30);

  assert.equal(auditCalls, 2);
  assert.equal(result.scenarioQuality?.complete, true);
  assert.equal(result.scenarioQuality?.repaired, false);
});

test("локальный fallback не принимает закрытую концовку без обязательного события", async () => {
  const client = new AnyModelClient({
    publicSettings: async () => ({ textModel: "cc/claude-opus-5" })
  } as never);
  let auditCalls = 0;
  let repairCalls = 0;
  (client as unknown as {
    chat(model: string, messages: Array<{ role: string; content: string }>): Promise<string>;
  }).chat = async (_model, messages) => {
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    if (/главный редактор YouTube-сценария/.test(system)) {
      return JSON.stringify({
        title: "Эксперт",
        promise: "Раскрыть преступника",
        tone: "Напряжённый",
        visualBible: "Расследование",
        continuityRules: [],
        // Намеренно потерян склад: fallback обязан восстановить это требование
        // из исходного brief, а не доверять уже усечённому плану.
        requiredBeats: ["подозреваемого задерживают"],
        endingResolution: "Показать задержание",
        sections: [
          { title: "Начало", goal: "Расследовать нападение", keyPoints: ["улики"], transition: "к финалу" },
          { title: "Финал", goal: "Завершить дело", keyPoints: ["арест"], transition: "итог" }
        ]
      });
    }
    if (/строгий редактор сценария/.test(system)) return '{"issues":[]}';
    if (/выпускающий редактор/.test(system)) {
      auditCalls += 1;
      return " \n ";
    }
    if (/исправляешь незавершённый сценарий/.test(system)) {
      repairCalls += 1;
      throw new Error("repair invoked for missing beat");
    }
    if (/сценарист вирусных YouTube-роликов/.test(system)) {
      return JSON.stringify([
        { title: "Нападение", narration: "Ночью возле дома полицейского происходит нападение, после чего начинается большое городское расследование.", imagePrompt: "police house at night", stockQuery: "police house night", animationPrompt: "camera approaches the house" },
        { title: "Эксперт", narration: "Технический эксперт предлагает помощь и подробно изучает повреждённые предметы вместе с детективами.", imagePrompt: "expert examines evidence", stockQuery: "expert examines evidence", animationPrompt: "camera circles evidence table" },
        { title: "Подозрение", narration: "Его необычные знания вызывают подозрение, а полиция закрывает старый склад и устанавливает за экспертом наблюдение.", imagePrompt: "detective surveillance car", stockQuery: "detective surveillance car", animationPrompt: "car waits across street" },
        { title: "Арест", narration: "Подозреваемого задерживают возле дома, и детектив объявляет расследование полностью завершённым.", imagePrompt: "police arrest suspect", stockQuery: "police arrest suspect", animationPrompt: "police escort suspect away" }
      ]);
    }
    throw new Error(`Неожиданный тестовый запрос: ${system.slice(0, 80)}`);
  };

  await assert.rejects(() => client.regenerateScenes({
    sourceUrl: "chat://audit-missing-beat",
    sourceTitle: "Эксперт",
    niche: "Полицейские истории",
    targetAudience: "Зрители",
    hook: "Эксперт знает слишком много",
    structure: [],
    strengths: [],
    improvements: [],
    suggestedAngle: "Расследование",
    suggestedTitle: "Эксперт",
    recommendedDurationSeconds: 30,
    language: "Русский",
    instructions: "Полиция обязана найти тайный склад, а затем задержать подозреваемого.",
    scenes: [],
    provider: "anymodel:test"
  }, 30), /repair invoked for missing beat/);
  assert.equal(auditCalls, 2);
  assert.equal(repairCalls, 1, "failed repair completion is not sent twice");
});

async function runMalformedAuditFallbackCase(input: {
  brief: string;
  requiredBeats: string[];
  endingResolution: string;
  scenes: Array<{ title: string; narration: string; imagePrompt?: string; stockQuery?: string; animationPrompt?: string }>;
}): Promise<ReferenceAnalysis> {
  const client = new AnyModelClient({
    publicSettings: async () => ({ textModel: "cc/claude-opus-5" })
  } as never);
  (client as unknown as {
    chat(model: string, messages: Array<{ role: string; content: string }>): Promise<string>;
  }).chat = async (_model, messages) => {
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    if (/главный редактор YouTube-сценария/.test(system)) {
      return JSON.stringify({
        title: "Проверка fallback",
        promise: "Закрыть расследование",
        tone: "Напряжённый",
        visualBible: "Полицейское расследование",
        continuityRules: [],
        requiredBeats: input.requiredBeats,
        endingResolution: input.endingResolution,
        sections: [
          { title: "Начало", goal: "Начать дело", keyPoints: ["вызов"], transition: "к уликам" },
          { title: "Финал", goal: "Закрыть дело", keyPoints: ["результат"], transition: "итог" }
        ]
      });
    }
    if (/строгий редактор сценария/.test(system)) return '{"issues":[]}';
    if (/выпускающий редактор/.test(system)) return "{}";
    if (/исправляешь незавершённый сценарий/.test(system)) {
      throw new Error("fallback запросил смысловую правку");
    }
    if (/сценарист вирусных YouTube-роликов/.test(system)) {
      return JSON.stringify(input.scenes.map((scene) => ({
        ...scene,
        imagePrompt: scene.imagePrompt ?? "police investigation scene",
        stockQuery: scene.stockQuery ?? "police investigation",
        animationPrompt: scene.animationPrompt ?? "camera slowly moves closer"
      })));
    }
    throw new Error(`Неожиданный тестовый запрос: ${system.slice(0, 80)}`);
  };
  return client.regenerateScenes({
    sourceUrl: "chat://strict-local-fallback",
    sourceTitle: "Проверка fallback",
    niche: "Полицейские истории",
    targetAudience: "Зрители",
    hook: "Ночной вызов",
    structure: [],
    strengths: [],
    improvements: [],
    suggestedAngle: "Расследование",
    suggestedTitle: "Проверка fallback",
    recommendedDurationSeconds: input.scenes.length * 8,
    language: "Русский",
    instructions: input.brief,
    scenes: [],
    provider: "anymodel:test"
  }, input.scenes.length * 8);
}

test("локальный fallback не смешивает Video Prompt с транскрипцией, стилем, вопросами и запретами", async () => {
  const result = await runMalformedAuditFallbackCase({
    brief: [
      "MASTER PROMPT КАНАЛА:\nПиши естественно.",
      "ЗАДАЧА ЭТОГО РОЛИКА:\nПолиция должна найти склад и задержать подозреваемого.",
      "В первые 10 секунд должен быть сильный хук.",
      "В финале должен быть короткий эмоциональный вывод.",
      "The story must sound natural and the ending should feel warm.",
      "Нужно ли в финале объяснять ключ?",
      "В финале не объясняй происхождение ключа.",
      "ТРАНСКРИПЦИИ КОНКУРЕНТОВ ДЛЯ АНАЛИЗА СТИЛЯ:\nПолиция должна найти дракона и спасти короля."
    ].join("\n\n"),
    requiredBeats: ["полиция находит склад", "подозреваемого задерживают"],
    endingResolution: "Завершить обещание и дать ясный итог",
    scenes: [
      { title: "Вызов", narration: "Ночной патруль получает сообщение о подозрительной машине и начинает проверку промышленного района." },
      { title: "След", narration: "Запись с камеры приводит детективов к заброшенному зданию на окраине города." },
      { title: "Склад", narration: "Полицейские находят тайный склад, где лежат документы и похищенные вещи." },
      { title: "Финал", narration: "Подозреваемого задерживают возле выхода, а найденные документы окончательно закрывают дело." }
    ]
  });
  assert.equal(result.scenarioQuality?.complete, true);
});

test("локальный fallback требует точное число и событие финала именно в конце", async () => {
  await assert.rejects(() => runMalformedAuditFallbackCase({
    brief: "Полиция должна найти ячейку 314.",
    requiredBeats: ["полиция находит ячейку 314"],
    endingResolution: "Завершить обещание и дать ясный итог",
    scenes: [
      { title: "Вызов", narration: "Полицейский патруль начинает расследование после ночного звонка из пустого здания." },
      { title: "Поиск", narration: "Детективы проверяют записи камер и получают адрес старого складского комплекса." },
      { title: "Ячейка", narration: "Полицейские находят ячейку 315 и внимательно осматривают лежащие внутри документы." },
      { title: "Финал", narration: "Следователь передаёт материалы прокурору, после чего это дело официально закрывают." }
    ]
  }), /fallback запросил смысловую правку/);

  await assert.rejects(() => runMalformedAuditFallbackCase({
    brief: "В финале подозреваемого обязательно задерживают.",
    requiredBeats: [],
    endingResolution: "В финале подозреваемого задерживают",
    scenes: [
      { title: "Вызов", narration: "Ночной диспетчер отправляет патруль к закрытому магазину после тревожного сигнала." },
      { title: "Ранний арест", narration: "Подозреваемого задерживают у чёрного входа, однако расследование на этом не заканчивается." },
      { title: "Камера", narration: "Запись наблюдения показывает другую машину, которая покинула двор за минуту до приезда полиции." },
      { title: "Документы", narration: "Следователи изучают накладные и устанавливают происхождение всех пропавших товаров." },
      { title: "Проверка", narration: "Владелец магазина подтверждает список вещей и получает их обратно после оформления протокола." },
      { title: "Финал", narration: "Собранные документы передают прокурору, и расследование официально объявляют завершённым." }
    ]
  }), /fallback запросил смысловую правку/);
});

test("локальный fallback понимает английские синонимы событий", async () => {
  const result = await runMalformedAuditFallbackCase({
    brief: "Police officers must discover the warehouse and detain the suspect.",
    requiredBeats: ["police officers discover the warehouse", "police detain the suspect"],
    endingResolution: "Give the story a clear conclusion",
    scenes: [
      { title: "Call", narration: "Detectives respond to a late-night call and collect the first pieces of evidence." },
      { title: "Trail", narration: "A security recording sends the investigators toward the industrial district." },
      { title: "Warehouse", narration: "The officers found the warehouse and recovered the missing documents inside." },
      { title: "Arrest", narration: "The suspect was apprehended outside, and the recovered evidence closed the case." }
    ]
  });
  assert.equal(result.scenarioQuality?.complete, true);
});

test("служебный запрос AnyModel завершается понятным timeout вместо вечного ожидания", { concurrency: false }, async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    const rejectOnAbort = () => reject(signal.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" }));
    if (signal.aborted) rejectOnAbort();
    else signal.addEventListener("abort", rejectOnAbort, { once: true });
  })) as typeof globalThis.fetch;

  const client = new AnyModelClient({
    publicSettings: async () => ({ baseUrl: "https://anymodel.invalid", textModel: "test-model" }),
    apiKey: async () => "test-key"
  } as never);
  const chat = (client as unknown as {
    chat(
      model: string,
      messages: Array<{ role: string; content: string }>,
      maxTokens?: number,
      reasoning?: string,
      signal?: AbortSignal,
      timeoutMs?: number
    ): Promise<string>;
  }).chat.bind(client);

  await assert.rejects(
    () => chat("test-model", [{ role: "user", content: "Верни JSON" }], 100, "low", undefined, 15),
    /AnyModel не ответил за 1 секунд/
  );

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal;
    return {
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        if (!signal) return;
        const rejectOnAbort = () => reject(signal.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (signal.aborted) rejectOnAbort();
        else signal.addEventListener("abort", rejectOnAbort, { once: true });
      })
    } as Response;
  }) as typeof globalThis.fetch;
  await assert.rejects(
    () => chat("test-model", [{ role: "user", content: "Верни JSON" }], 100, "low", undefined, 15),
    /AnyModel не ответил за 1 секунд/
  );

  const bodyAbortController = new AbortController();
  const bodyRequest = chat(
    "test-model",
    [{ role: "user", content: "Верни JSON" }],
    100,
    "low",
    bodyAbortController.signal,
    1_000
  );
  setTimeout(() => bodyAbortController.abort(), 5);
  await assert.rejects(
    () => bodyRequest,
    (error: unknown) => error instanceof Error && error.name === "AbortError"
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => chat("test-model", [{ role: "user", content: "Верни JSON" }], 100, "low", controller.signal, 1_000),
    (error: unknown) => error instanceof Error && error.name === "AbortError"
  );
});

test("AnyModel не повторяет неоднозначный chat completion после сетевого обрыва или 503", { concurrency: false }, async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const client = new AnyModelClient({
    publicSettings: async () => ({ baseUrl: "https://anymodel.invalid", textModel: "test-model" }),
    apiKey: async () => "test-key"
  } as never);
  const chat = (client as unknown as {
    chat(
      model: string,
      messages: Array<{ role: string; content: string }>,
      maxTokens?: number,
      reasoning?: "low" | "medium" | "high"
    ): Promise<string>;
  }).chat.bind(client);

  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw Object.assign(new TypeError("fetch failed"), { code: "ECONNRESET<script>" });
  }) as typeof globalThis.fetch;
  await assert.rejects(
    () => chat("test-model", [{ role: "user", content: "Верни JSON" }], 100, "low"),
    /\(ECONNRESET_script\).*автоматический повтор completion отключён/
  );
  assert.equal(fetchCalls, 1);

  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response("provider busy", { status: 503 });
  }) as typeof globalThis.fetch;
  await assert.rejects(
    () => chat("test-model", [{ role: "user", content: "Верни JSON" }], 100, "low"),
    /автоматический повтор completion отключён/
  );
  assert.equal(fetchCalls, 1);
});

test("AnyModel отклоняет непустой ответ, обрезанный по лимиту токенов, без утечки его содержимого", async () => {
  const client = new AnyModelClient({} as never);
  const internalClient = client as unknown as {
    request(path: string, init?: RequestInit): Promise<Response>;
    chat(
      model: string,
      messages: Array<{ role: string; content: string }>,
      maxTokens?: number,
      reasoning?: "low" | "medium" | "high"
    ): Promise<string>;
  };
  let finishReason = "length";
  internalClient.request = async () => new Response(JSON.stringify({
    choices: [{
      finish_reason: finishReason,
      message: { content: "PARTIAL_SECRET_RESPONSE" }
    }]
  }), { status: 200, headers: { "content-type": "application/json" } });

  for (const reason of ["length", "max_tokens", " MAX-TOKENS "]) {
    finishReason = reason;
    await assert.rejects(
      () => internalClient.chat("test-model", [{ role: "user", content: "Верни JSON" }], 100, "low"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "AnyModelOutputFormatError");
        assert.match(error.message, /обрезал ответ из-за лимита токенов/);
        assert.doesNotMatch(error.message, /PARTIAL_SECRET_RESPONSE/);
        return true;
      }
    );
  }

  finishReason = "stop";
  assert.equal(
    await internalClient.chat("test-model", [{ role: "user", content: "Верни JSON" }], 100, "low"),
    "PARTIAL_SECRET_RESPONSE"
  );
});

test("тема чата сохраняет историю, модель и принадлежность каналу", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-chat-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const path = join(directory, "chat.sqlite");
  const repository = new ChatTopicRepository(path);
  await repository.initialize();
  const created = repository.create("История Рима", "ag/claude-sonnet-4-6", "channel-rome");
  repository.append(created.id, { role: "user", content: "Сделай сильный хук" });
  repository.append(created.id, { role: "assistant", content: "Предлагаю начать с падения империи" });
  repository.setModel(created.id, "cc/claude-opus-5");
  repository.close();

  const reopened = new ChatTopicRepository(path);
  await reopened.initialize();
  const topic = reopened.get(created.id);
  assert.equal(topic?.modelId, "cc/claude-opus-5");
  assert.equal(topic?.channelProfileId, "channel-rome");
  assert.equal(reopened.list("channel-rome").length, 1);
  assert.equal(reopened.list("another-channel").length, 0);
  assert.deepEqual(topic?.messages.map(({ role, content }) => ({ role, content })), [
    { role: "user", content: "Сделай сильный хук" },
    { role: "assistant", content: "Предлагаю начать с падения империи" }
  ]);
  reopened.close();
});

test("профиль канала сохраняет Master Prompt и производственные настройки локально", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "gold-work-channels-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const path = join(directory, "channels.json");
  const store = new ChannelProfileStore(path);
  const created = await store.create({
    name: "Истории изобретений",
    countryCode: "ie",
    languageCode: "en",
    languageLabel: "Английский",
    masterPrompt: "Пиши документальные сценарии по главам.",
    lumeanTemplateUuid: "voice-1",
    lumeanTemplateName: "Narrator",
    defaultDurationMinutes: 20,
    direction: "ai-story",
    defaultMediaMode: "ai",
    motionTemplate: "Документальный"
  });

  const reopened = new ChannelProfileStore(path);
  const stored = (await reopened.list())[0];
  assert.equal(stored?.id, created.id);
  assert.equal(stored?.countryCode, "IE");
  assert.equal(stored?.masterPrompt, "Пиши документальные сценарии по главам.");
  assert.equal(stored?.lumeanTemplateUuid, "voice-1");
  assert.equal(stored?.defaultDurationMinutes, 20);
  assert.equal(stored?.direction, "ai-story");
  assert.equal(stored?.defaultMediaMode, "ai");
});

test("пересоздание плана учитывает выбранные density и процент графики", async () => {
  const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "test-model" }) } as never);
  const scenes = Array.from({ length: 4 }, (_, order) => makeScene({
    id: `replan-${order}`,
    order,
    durationSeconds: 12,
    title: order === 0 ? "Хук: 15 минут" : `Этап ${order + 1}`,
    narration: order === 0
      ? "Пятнадцать минут меняют весь процесс: сейчас покажем как."
      : "Показываем предмет, действие и результат одного законченного шага."
  }));
  const calm = await client.replanMontage(scenes, "local", undefined, undefined, {
    density: "calm",
    graphicBeatPercent: 0,
    hardCutPercent: 70,
  });
  const dynamic = await client.replanMontage(scenes, "local", undefined, undefined, {
    density: "dynamic",
    graphicBeatPercent: 35,
    hardCutPercent: 85,
  });
  const graphicTemplates = new Set([
    "focus-text", "fact-card", "evidence-card", "compare-split", "timeline-links",
    "stat-callout", "editorial-panel", "chapter-card", "quote-card", "checklist-grid"
  ]);
  const countGraphics = (planned: typeof calm) => planned.scenes.reduce(
    (sum, scene) => sum + (scene.visualBeats ?? []).filter((beat) => graphicTemplates.has(beat.template)).length,
    0
  );
  assert.ok(dynamic.summary.visualBeatCount > calm.summary.visualBeatCount);
  assert.ok(countGraphics(dynamic) > countGraphics(calm));
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

test("прокси: разбор SOCKS5/HTTP(S) и понятные ошибки", () => {
  assert.deepEqual(parseProxyUrl("socks5://user:pass@1.2.3.4:8000"), { host: "1.2.3.4", port: 8000, user: "user", password: "pass" });
  assert.deepEqual(parseProxyUrl("socks5://1.2.3.4:1080"), { host: "1.2.3.4", port: 1080, user: undefined, password: undefined });
  assert.deepEqual(parseProxyUrl("http://user:pass@1.2.3.4:8080"), {
    host: "1.2.3.4", port: 8080, user: "user", password: "pass", protocol: "http"
  });
  assert.deepEqual(parseProxyUrl("https://1.2.3.4"), {
    host: "1.2.3.4", port: 443, user: undefined, password: undefined, protocol: "https"
  });
  assert.equal(parseProxyUrl(""), undefined);
  assert.equal(parseProxyUrl(undefined), undefined);
  assert.deepEqual(parseProxyUrl("http://1.2.3.4:80"), {
    host: "1.2.3.4", port: 80, user: undefined, password: undefined, protocol: "http"
  });
  assert.throws(() => parseProxyUrl("ftp://1.2.3.4:21"), /SOCKS5, HTTP/);
  assert.throws(() => parseProxyUrl("абракадабра"), /Некорректный адрес/);
});

test("прокси Flow: локальный browser-мост авторизуется во внешнем SOCKS5", async (context) => {
  const authentications: Array<{ user: string; password: string }> = [];
  const targets: string[] = [];
  const proxyServer = createNetServer((socket) => {
    let stage: "greeting" | "auth" | "connect" | "done" = "greeting";
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (true) {
        if (stage === "greeting") {
          if (buffered.length < 2 + (buffered[1] ?? 0)) return;
          buffered = buffered.subarray(2 + (buffered[1] ?? 0));
          stage = "auth";
          socket.write(Buffer.from([0x05, 0x02]));
          continue;
        }
        if (stage === "auth") {
          const userLength = buffered[1] ?? 0;
          if (buffered.length < 3 + userLength) return;
          const passwordLength = buffered[2 + userLength] ?? 0;
          const packetLength = 3 + userLength + passwordLength;
          if (buffered.length < packetLength) return;
          authentications.push({
            user: buffered.subarray(2, 2 + userLength).toString("utf8"),
            password: buffered.subarray(3 + userLength, packetLength).toString("utf8"),
          });
          buffered = buffered.subarray(packetLength);
          stage = "connect";
          socket.write(Buffer.from([0x01, 0x00]));
          continue;
        }
        if (stage === "connect") {
          const hostLength = buffered[4] ?? 0;
          const packetLength = 7 + hostLength;
          if (buffered.length < packetLength) return;
          targets.push(buffered.subarray(5, 5 + hostLength).toString("utf8"));
          buffered = buffered.subarray(packetLength);
          stage = "done";
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]));
          continue;
        }
        return;
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    proxyServer.once("error", reject);
    proxyServer.listen(0, "127.0.0.1", resolve);
  });
  context.after(() => new Promise<void>((resolve) => proxyServer.close(() => resolve())));
  const address = proxyServer.address();
  assert.ok(address && typeof address !== "string");

  const bridge = await createSocks5BrowserProxyBridge(
    `socks5://flow-user:flow-pass@127.0.0.1:${address.port}`
  );
  context.after(() => bridge.close());
  assert.match(bridge.proxyUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.deepEqual(authentications, [{ user: "flow-user", password: "flow-pass" }]);
  assert.deepEqual(targets, ["labs.google"]);
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
    proxyUrl: "socks5://private-user:private-pass@127.0.0.1:1080",
    networkError: new Error("Connect https://hidden-user:hidden-pass@127.0.0.1 failed"),
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
  assert.ok(!file.includes("private-user"));
  assert.ok(!file.includes("private-pass"));
  assert.ok(!file.includes("hidden-user"));
  assert.ok(!file.includes("hidden-pass"));
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

function voicerForTest(fetchImpl: typeof fetch, options: VoicerClientOptions = {}): VoicerClient {
  const store = {
    publicSettings: async () => ({
      baseUrl: "https://api.lumean.test/api/public",
      configured: true,
    }),
    apiKey: async () => "lumean-test-key",
  } as unknown as ConstructorParameters<typeof VoicerClient>[0];
  return new VoicerClient(store, {
    requestTimeoutMs: 25,
    responseBodyTimeoutMs: 25,
    downloadTimeoutMs: 25,
    pollIntervalMs: 0,
    pollTimeoutMs: 1_000,
    sleep: async () => undefined,
    ...options,
    fetchImpl,
  });
}

async function caughtVoicerError(action: Promise<unknown>): Promise<VoicerClientError> {
  let caught: unknown;
  try {
    await action;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof VoicerClientError, "ожидалась типизированная ошибка Lumean");
  return caught;
}

function lumeanResponse(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("Lumean creation request timeout is uncertain and suppresses a blind second POST", async () => {
  let orderPosts = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (init?.method === "POST") orderPosts += 1;
    return new Promise<Response>(() => undefined);
  };
  const client = voicerForTest(fetchImpl);

  const error = await caughtVoicerError(client.tts("Тестовая озвучка", "template-1"));

  assert.equal(error.code, "request_timeout");
  assert.equal(error.retryable, false);
  assert.equal(error.creationUncertain, true);
  assert.equal(isPermanentFailure(error.message), true, "текущая очередь не должна повторять неоднозначный POST");
  assert.equal(orderPosts, 1);
});

test("Lumean creation response body timeout is uncertain and suppresses a blind second POST", async () => {
  let orderPosts = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (init?.method === "POST") orderPosts += 1;
    return {
      ok: true,
      status: 200,
      text: () => new Promise<string>(() => undefined),
    } as Response;
  };
  const client = voicerForTest(fetchImpl);

  const error = await caughtVoicerError(client.tts("Тестовая озвучка", "template-1"));

  assert.equal(error.code, "response_body_timeout");
  assert.equal(error.retryable, false);
  assert.equal(error.creationUncertain, true);
  assert.equal(isPermanentFailure(error.message), true);
  assert.equal(orderPosts, 1);
});

test("Lumean safe GET timeout remains retryable and is not marked as uncertain creation", async () => {
  const fetchImpl: typeof fetch = async () => new Promise<Response>(() => undefined);
  const client = voicerForTest(fetchImpl);

  const error = await caughtVoicerError(client.templates());

  assert.equal(error.code, "request_timeout");
  assert.equal(error.retryable, true);
  assert.equal(error.creationUncertain, false);
  assert.equal(isPermanentFailure(error.message), false);
});

test("Lumean download body timeout terminates a known order without creating another one", async () => {
  let orderPosts = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/orders") && init?.method === "POST") {
      orderPosts += 1;
      return lumeanResponse({ id: "order-1", status: "pending" });
    }
    if (url.endsWith("/orders/order-1")) {
      return lumeanResponse({
        id: "order-1",
        status: "completed",
        result: { files: ["orders/order-1/result.mp3"] },
      });
    }
    if (url.endsWith("/storage/url")) {
      return lumeanResponse({ url: "https://cdn.lumean.test/order-1.mp3" });
    }
    if (url === "https://cdn.lumean.test/order-1.mp3") {
      return {
        ok: true,
        status: 200,
        arrayBuffer: () => new Promise<ArrayBuffer>(() => undefined),
      } as Response;
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const client = voicerForTest(fetchImpl);

  const error = await caughtVoicerError(client.tts("Тестовая озвучка", "template-1"));

  assert.equal(error.code, "download_timeout");
  assert.equal(error.retryable, false);
  assert.equal(error.creationUncertain, false);
  assert.equal(error.orderKnown, true);
  assert.equal(isPermanentFailure(error.message), true);
  assert.equal(orderPosts, 1);
});

test("Lumean storage failure keeps the known-order marker even with a generic HTTP code", async () => {
  let orderPosts = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/orders") && init?.method === "POST") {
      orderPosts += 1;
      return lumeanResponse({ id: "order-storage", status: "pending" });
    }
    if (url.endsWith("/orders/order-storage")) {
      return lumeanResponse({ id: "order-storage", status: "completed", result: { files: ["voice.mp3"] } });
    }
    if (url.endsWith("/storage/url")) {
      return new Response(JSON.stringify({ success: false, message: "temporary storage outage" }), { status: 503 });
    }
    throw new Error(`unexpected request ${url}`);
  };
  const client = voicerForTest(fetchImpl);

  const error = await caughtVoicerError(client.tts("Тестовая озвучка", "template-1"));

  assert.equal(error.code, "http");
  assert.equal(error.retryable, false);
  assert.equal(error.orderKnown, true);
  assert.equal(orderPosts, 1);
});

test("Lumean abort interrupts an in-flight order POST and preserves creation uncertainty", async () => {
  const controller = new AbortController();
  let orderPosts = 0;
  let notifyPostStarted: (() => void) | undefined;
  const postStarted = new Promise<void>((resolve) => { notifyPostStarted = resolve; });
  const fetchImpl: typeof fetch = async (_input, init) => {
    orderPosts += 1;
    notifyPostStarted?.();
    return new Promise<Response>((_resolve, reject) => {
      const onAbort = () => reject(init?.signal?.reason ?? new Error("aborted"));
      if (init?.signal?.aborted) onAbort();
      else init?.signal?.addEventListener("abort", onAbort, { once: true });
    });
  };
  const client = voicerForTest(fetchImpl, { requestTimeoutMs: 10_000 });
  const pending = client.tts("Тестовая озвучка", "template-1", controller.signal);
  await postStarted;

  controller.abort(new Error("stop requested"));
  const error = await caughtVoicerError(pending);

  assert.ok(error instanceof VoicerAbortError);
  assert.equal(error.name, "AbortError");
  assert.equal(error.code, "aborted");
  assert.equal(error.retryable, false);
  assert.equal(error.creationUncertain, true);
  assert.equal(orderPosts, 1);
});

test("Lumean abort interrupts the polling sleep before another network request", async () => {
  const controller = new AbortController();
  let pollGets = 0;
  let notifySleepStarted: (() => void) | undefined;
  const sleepStarted = new Promise<void>((resolve) => { notifySleepStarted = resolve; });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/orders") && init?.method === "POST") {
      return lumeanResponse({ id: "order-abort-sleep", status: "pending" });
    }
    if (url.endsWith("/orders/order-abort-sleep")) pollGets += 1;
    throw new Error(`unexpected URL ${url}`);
  };
  const client = voicerForTest(fetchImpl, {
    pollIntervalMs: 10_000,
    sleep: async () => {
      notifySleepStarted?.();
      return new Promise<void>(() => undefined);
    },
  });
  const pending = client.tts("Тестовая озвучка", "template-1", controller.signal);
  await sleepStarted;

  controller.abort();
  const error = await caughtVoicerError(pending);

  assert.ok(error instanceof VoicerAbortError);
  assert.equal(error.name, "AbortError");
  assert.equal(error.creationUncertain, false);
  assert.equal(pollGets, 0);
});

test("Lumean abort propagates to an in-flight result download", async () => {
  const controller = new AbortController();
  let orderPosts = 0;
  let notifyDownloadStarted: (() => void) | undefined;
  const downloadStarted = new Promise<void>((resolve) => { notifyDownloadStarted = resolve; });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/orders") && init?.method === "POST") {
      orderPosts += 1;
      return lumeanResponse({ id: "order-abort-download", status: "pending" });
    }
    if (url.endsWith("/orders/order-abort-download")) {
      return lumeanResponse({
        id: "order-abort-download",
        status: "completed",
        result: { files: ["orders/order-abort-download/result.mp3"] },
      });
    }
    if (url.endsWith("/storage/url")) {
      return lumeanResponse({ url: "https://cdn.lumean.test/order-abort-download.mp3" });
    }
    if (url === "https://cdn.lumean.test/order-abort-download.mp3") {
      notifyDownloadStarted?.();
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () => reject(init?.signal?.reason ?? new Error("aborted"));
        if (init?.signal?.aborted) onAbort();
        else init?.signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const client = voicerForTest(fetchImpl, { requestTimeoutMs: 10_000 });
  const pending = client.tts("Тестовая озвучка", "template-1", controller.signal);
  await downloadStarted;

  controller.abort();
  const error = await caughtVoicerError(pending);

  assert.ok(error instanceof VoicerAbortError);
  assert.equal(error.name, "AbortError");
  assert.equal(error.creationUncertain, false);
  assert.equal(orderPosts, 1);
});
