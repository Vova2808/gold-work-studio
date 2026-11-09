import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import {
  resolveImageMotionDirection,
  resolveImageMotionPlan,
  resolveImageMotionZoom,
  resolveProjectSceneTransition,
  resolveProjectSceneTransitionDuration,
  type MontagePlannerOutcome,
  type Project,
  type ProjectRenderReport,
  type Scene,
  type SubtitleSettings,
  type VisualBeatTemplate
} from "@gold-work/shared";
import { LocalProjectStorage } from "./local-project-storage.js";
import { APP_BUILD_ID } from "./generated-build-identity.js";
import { missingAssemblyInputs } from "./assembly-readiness.js";
import { applyNarrationSlice, narrationSliceTail, type NarrationTiming } from "./narration-timing.js";

function executablePath(): string | undefined {
  return ffmpegPath?.replace("app.asar", "app.asar.unpacked");
}

export function runFfmpeg(args: string[], onSeconds?: (seconds: number) => void, signal?:AbortSignal): Promise<void> {
  if(signal?.aborted)return Promise.reject(signal.reason);
  const executable = executablePath();
  if (!executable) return Promise.reject(new Error("FFmpeg не найден"));
  return new Promise((resolve, reject) => {
    const process = spawn(executable, onSeconds ? ["-progress", "pipe:1", "-nostats", ...args] : args, { windowsHide: true });
    const abort=()=>{process.kill();};
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    let errorOutput = "";
    let progressBuffer = "";
    if (onSeconds) process.stdout.on("data", (chunk: Buffer) => {
      const lines = (progressBuffer + chunk.toString("utf8")).split(/\r?\n/u);
      progressBuffer = (lines.pop() ?? "").slice(-4096);
      for (const line of lines) {
        if (!line.startsWith("out_time_us=")) continue;
        const seconds = Number(line.slice("out_time_us=".length)) / 1_000_000;
        if (Number.isFinite(seconds) && seconds >= 0) onSeconds(seconds);
      }
    });
    process.stderr.on("data", (chunk: Buffer) => {
      errorOutput = `${errorOutput}${chunk.toString("utf8")}`.slice(-8000);
    });
    process.once("error", reject);
    process.once("close", (code) => {
      signal?.removeEventListener('abort',abort);
      if(signal?.aborted)reject(signal.reason);
      else if (code === 0) resolve();
      else reject(new Error(`FFmpeg завершился с кодом ${code}: ${errorOutput.trim()}`));
    });
  });
}

interface MediaInfo {
  durationSeconds: number;
  hasAudio: boolean;
}

interface NarrationInfo extends NarrationTiming {
  /** Длительность файла с учётом технической тишины кодека. */
  durationSeconds: number;
  /** Начало первого слышимого фрагмента; leading silence сюда не входит. */
  speechStartSeconds: number;
  /** Конец последнего слышимого фрагмента; trailing silence сюда не входит. */
  speechEndSeconds: number;
  loudness?: {
    inputI: number;
    inputTp: number;
    inputLra: number;
    inputThresh: number;
    targetOffset: number;
  };
}

export interface MontageSourceClip {
  scene: Scene;
  /** Уже нормализованный FFmpeg-клип с точной длиной и размером проекта. */
  path: string;
  /** Время клипа на итоговом timeline без технического хвоста для xfade. */
  durationSeconds: number;
}

export interface MontageRenderInput {
  project: Project;
  clips: MontageSourceClip[];
  /** Надёжная FFmpeg-сборка: из неё Remotion-версии берётся непрерывный звук. */
  audioMasterPath: string;
  outputPath: string;
  onProgress?: (stage: string, progress: number) => void;
  signal?:AbortSignal;
}

export interface MontageRenderResult {
  outputPath: string;
  requestedPlanner?: "local" | "ai-bounded";
  plannerUsed?: MontagePlannerOutcome;
  visualBeatCount: number;
  templates: VisualBeatTemplate[];
  /** Фактически подготовленные и доступные Remotion stock-источники. */
  stockVideoCount?: number;
  stockImageCount?: number;
  warnings?: string[];
}

/**
 * Изолированный визуальный проход. StandardRenderer не зависит от конкретного
 * Remotion API, поэтому в тестах и при проблеме браузера остаётся рабочий
 * FFmpeg fallback с той же озвучкой.
 */
export interface MontageRenderer {
  render(input: MontageRenderInput): Promise<string | MontageRenderResult>;
}

export type StandardRendererEventSink = (
  level: "info" | "warn" | "error",
  message: string,
  details?: Record<string, unknown>
) => void;

/** Метаданные медиа: парсим stderr ffmpeg -i, потому что ffprobe в сборке нет. */
function inspectMedia(path: string): Promise<MediaInfo> {
  const executable = executablePath();
  if (!executable) return Promise.resolve({ durationSeconds: 0, hasAudio: false });
  return new Promise((resolve) => {
    const child = spawn(executable, ["-i", path], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-12_000);
    });
    child.once("error", () => resolve({ durationSeconds: 0, hasAudio: false }));
    child.once("close", () => {
      const match = /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/.exec(stderr);
      const durationSeconds = match
        ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 100
        : 0;
      resolve({ durationSeconds, hasAudio: /Stream\s+#[^\r\n]+Audio:/i.test(stderr) });
    });
  });
}

export async function mediaDurationSeconds(path: string): Promise<number> {
  return (await inspectMedia(path)).durationSeconds;
}

/**
 * TTS-провайдеры обычно добавляют в конец файла 0.2–2+ секунды тишины. Если
 * считать её частью реплики, эти хвосты суммируются между всеми сценами.
 * Декодируем только звуковую дорожку и учитываем исключительно тишину,
 * которая действительно продолжается до EOF; паузы внутри фразы не трогаем.
 */
export function inspectNarration(path: string, measureLoudness = false): Promise<NarrationInfo> {
  const executable = executablePath();
  if (!executable) return Promise.resolve({ durationSeconds: 0, speechStartSeconds: 0, speechEndSeconds: 0 });
  return new Promise((resolve) => {
    const analysisFilter = measureLoudness
      ? "silencedetect=noise=-42dB:d=0.15,loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json"
      : "silencedetect=noise=-42dB:d=0.15";
    const child = spawn(executable, [
      "-hide_banner",
      "-i", path,
      "-af", analysisFilter,
      "-f", "null",
      "-"
    ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-24_000);
    });
    child.once("error", () => resolve({ durationSeconds: 0, speechStartSeconds: 0, speechEndSeconds: 0 }));
    child.once("close", () => {
      const durationMatch = /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/.exec(stderr);
      const durationSeconds = durationMatch
        ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60
          + Number(durationMatch[3]) + Number(durationMatch[4]) / 100
        : 0;
      const silenceStarts = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)];
      const silenceEnds = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)];
      const firstStart = Number(silenceStarts[0]?.[1]);
      const firstEnd = Number(silenceEnds[0]?.[1]);
      const lastStart = Number(silenceStarts.at(-1)?.[1]);
      const lastEnd = Number(silenceEnds.at(-1)?.[1]);
      const reachesEnd = Number.isFinite(lastEnd) && lastEnd >= durationSeconds - 0.12;
      const isEntirelySilent = Number.isFinite(lastStart) && lastStart <= 0.05 && reachesEnd;
      const hasLeadingSilence = Number.isFinite(firstStart)
        && Number.isFinite(firstEnd)
        && firstStart <= 0.05
        && firstEnd > 0.05
        && !isEntirelySilent;
      const hasTrailingSilence = Number.isFinite(lastStart)
        && Number.isFinite(lastEnd)
        && lastStart > 0.05
        && reachesEnd;
      const loudnessMatch = /\{\s*"input_i"\s*:\s*"([^"]+)"[\s\S]*?"input_tp"\s*:\s*"([^"]+)"[\s\S]*?"input_lra"\s*:\s*"([^"]+)"[\s\S]*?"input_thresh"\s*:\s*"([^"]+)"[\s\S]*?"target_offset"\s*:\s*"([^"]+)"\s*\}/.exec(stderr);
      const loudnessValues = loudnessMatch?.slice(1).map(Number) ?? [];
      const loudness = loudnessValues.length === 5 && loudnessValues.every(Number.isFinite)
        ? {
            inputI: loudnessValues[0] as number,
            inputTp: loudnessValues[1] as number,
            inputLra: loudnessValues[2] as number,
            inputThresh: loudnessValues[3] as number,
            targetOffset: loudnessValues[4] as number
          }
        : undefined;
      resolve({
        durationSeconds,
        speechStartSeconds: isEntirelySilent ? 0 : hasLeadingSilence ? Math.min(durationSeconds, firstEnd) : 0,
        speechEndSeconds: isEntirelySilent
          ? 0
          : hasTrailingSilence ? Math.min(durationSeconds, lastStart) : durationSeconds,
        loudness,
        silences: silenceStarts.flatMap((match, index) => {
          const startSeconds = Number(match[1]);
          const endSeconds = Number(silenceEnds[index]?.[1]);
          return Number.isFinite(startSeconds) && Number.isFinite(endSeconds) && endSeconds > startSeconds
            ? [{startSeconds, endSeconds}] : [];
        })
      });
    });
  });
}

function videoSize(project: Project): { width: number; height: number } {
  if (project.aspectRatio === "9:16") return { width: 720, height: 1280 };
  if (project.aspectRatio === "1:1") return { width: 900, height: 900 };
  return { width: 1280, height: 720 };
}

export interface TimelineTiming {
  trimStartSeconds: number;
  trimEndSeconds?: number;
  playbackRate: number;
  durationSeconds: number;
}

const finiteNumber = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));
// Короткая естественная пауза после фразы. Не используется для подгонки под
// target duration: итог может быть короче или длиннее ориентира сценария.
const DEFAULT_NARRATION_TAIL_SECONDS = 0.2;

function narrationContentDuration(info: NarrationInfo): number {
  return Math.max(0, info.speechEndSeconds - info.speechStartSeconds);
}

/**
 * Фактическая длина слышимой речи без добавленной кодеком тишины. Используется
 * при калибровке голоса до написания сценария.
 */
export async function narrationSpeechDurationSeconds(path: string): Promise<number> {
  const info = await inspectNarration(path);
  const speechDuration = narrationContentDuration(info);
  return speechDuration > 0 ? speechDuration : info.durationSeconds;
}

/**
 * Нормализует монтажный диапазон. После TTS озвучка задаёт автоматическую
 * длительность сцены; визуал можно обрезать или замедлить, но реплика остаётся целой.
 */
export function resolveTimelineTiming(
  scene: Scene,
  sourceDurationSeconds: number,
  kind: "photo" | "video",
  narrationDurationSeconds = kind === "photo" ? sourceDurationSeconds : 0,
  narrationTailSeconds = DEFAULT_NARRATION_TAIL_SECONDS,
  outgoingOverlapSeconds = 0
): TimelineTiming {
  const sourceDuration = finiteNumber(sourceDurationSeconds) && sourceDurationSeconds > 0 ? sourceDurationSeconds : 0;
  const narrationDuration = finiteNumber(narrationDurationSeconds) && narrationDurationSeconds > 0.2
    ? narrationDurationSeconds
    : 0;
  const safeNarrationTail = narrationDuration > 0
    ? clamp(finiteNumber(narrationTailSeconds) ? narrationTailSeconds : DEFAULT_NARRATION_TAIL_SECONDS, 0, 0.25)
    : 0;
  const outgoingOverlap = clamp(finiteNumber(outgoingOverlapSeconds) ? outgoingOverlapSeconds : 0, 0, 5);
  const playbackRate = clamp(finiteNumber(scene.playbackRate) ? scene.playbackRate : 1, 0.25, 4);
  const trimStartSeconds = sourceDuration > 0
    ? clamp(finiteNumber(scene.trimStartSeconds) ? scene.trimStartSeconds : 0, 0, Math.max(0, sourceDuration - 0.01))
    : Math.max(0, finiteNumber(scene.trimStartSeconds) ? scene.trimStartSeconds : 0);
  const requestedEnd = finiteNumber(scene.trimEndSeconds) && scene.trimEndSeconds > trimStartSeconds
    ? scene.trimEndSeconds
    : undefined;
  const trimEndSeconds = sourceDuration > 0
    ? clamp(requestedEnd ?? sourceDuration, trimStartSeconds + 0.01, sourceDuration)
    : requestedEnd;
  const rangeDuration = trimEndSeconds !== undefined
    ? Math.max(0.01, trimEndSeconds - trimStartSeconds)
    : Math.max(0.01, scene.durationSeconds);
  const hasEffectiveTimingEdit = trimStartSeconds > 0
    || playbackRate !== 1
    || (requestedEnd !== undefined && (sourceDuration <= 0 || Math.abs(requestedEnd - sourceDuration) > 0.01));
  const legacyDuration = Math.max(1, scene.durationSeconds);
  const durationOverride = finiteNumber(scene.durationOverrideSeconds) && scene.durationOverrideSeconds > 0
    ? clamp(scene.durationOverrideSeconds, 0.1, 86_400)
    : undefined;
  const visualDuration = durationOverride ?? (hasEffectiveTimingEdit ? rangeDuration / playbackRate : legacyDuration);
  const narrationSafeDuration = narrationDuration > 0 ? narrationDuration + safeNarrationTail : 0;
  // После готового TTS именно реплика определяет автоматическую длительность.
  // Плановые 7–8 секунд нужны сценам без голоса; явный ручной override уважаем,
  // но он всё равно не имеет права обрезать реплику.
  const timelineDuration = narrationDuration > 0
    ? Math.max(durationOverride ?? 0, narrationSafeDuration)
    : visualDuration;
  return {
    trimStartSeconds,
    trimEndSeconds,
    playbackRate,
    // xfade вычитает overlap из готового ролика, поэтому клип заранее длиннее на ту же величину.
    // Так scene.durationSeconds остаётся длительностью сцены именно в итоговом timeline.
    durationSeconds: timelineDuration + outgoingOverlap
  };
}

/** FFmpeg atempo принимает только 0.5..2.0, поэтому крайние скорости раскладываются в цепочку. */
export function atempoFactors(rate: number): number[] {
  let remaining = clamp(finiteNumber(rate) ? rate : 1, 0.25, 4);
  const factors: number[] = [];
  while (remaining > 2) {
    factors.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 0.0001 || factors.length === 0) factors.push(remaining);
  return factors;
}

export function resolveSceneTransition(project: Project, scene: Scene): "none" | "fade" | "mix" {
  return resolveProjectSceneTransition(project, scene);
}

export function resolveTransitionDuration(scene: Scene, project?: Project): number {
  if (project) return resolveProjectSceneTransitionDuration(project, scene);
  const duration = finiteNumber(scene.transitionDurationSeconds)
    ? scene.transitionDurationSeconds
    : finiteNumber(scene.autoTransitionDurationSeconds) ? scene.autoTransitionDurationSeconds : 0.5;
  return clamp(duration, 0.05, 5);
}

export function resolveKenBurnsZoom(scene: Scene): number {
  return resolveImageMotionZoom(scene);
}

export function resolveVolumePercent(value: number | undefined, fallback: number): number {
  return clamp(finiteNumber(value) ? value : fallback, 0, 200);
}

function trimSuffix(timing: TimelineTiming): string {
  return `start=${timing.trimStartSeconds.toFixed(3)}${timing.trimEndSeconds !== undefined ? `:end=${timing.trimEndSeconds.toFixed(3)}` : ""}`;
}

function audioTimelineFilters(timing: TimelineTiming, volumePercent: number): string {
  const tempo = atempoFactors(timing.playbackRate).map((factor) => `atempo=${factor.toFixed(5)}`).join(",");
  return `atrim=${trimSuffix(timing)},asetpts=PTS-STARTPTS,${tempo},volume=${(volumePercent / 100).toFixed(4)}`;
}

/**
 * Озвучка не наследует trim/speed визуального клипа. Однопроходный loudnorm
 * выравнивает разные ответы TTS примерно к -16 LUFS; персональная громкость
 * сцены сдвигает эту цель в децибелах, поэтому регулятор остаётся рабочим.
 */
function narrationAudioFilters(volumePercent: number, narrationInfo?: NarrationInfo, normalize = false): string {
  const scale = clamp(volumePercent / 100, 0, 2);
  const audibleRange = narrationInfo && narrationInfo.speechEndSeconds > narrationInfo.speechStartSeconds
    ? `atrim=start=${narrationInfo.speechStartSeconds.toFixed(3)}:end=${narrationInfo.speechEndSeconds.toFixed(3)},`
    : "";
  const base = `${audibleRange}asetpts=PTS-STARTPTS`;
  if (scale <= 0.0001) return `${base},volume=0,aresample=48000`;
  // loudnorm на полностью тихом placeholder возвращает NaN; такой файл просто
  // оставляем тихим и используем плановую длительность сцены.
  if (!normalize || !narrationInfo || narrationContentDuration(narrationInfo) <= 0.2 || !narrationInfo.loudness) {
    return `${base},volume=${scale.toFixed(4)},aresample=48000`;
  }
  const measured = narrationInfo.loudness;
  // Второй проход с измеренными параметрами гораздо стабильнее однопроходного
  // loudnorm на коротких сценах. После нормализации сохраняем регулятор сцены.
  return `${base},`
    + `loudnorm=I=-16:TP=-1.5:LRA=7:measured_I=${measured.inputI}:measured_TP=${measured.inputTp}`
    + `:measured_LRA=${measured.inputLra}:measured_thresh=${measured.inputThresh}:offset=${measured.targetOffset}:linear=true,`
    + `volume=${scale.toFixed(4)},alimiter=limit=0.95,aresample=48000`;
}

/** Направление камеры сцены: личная настройка сцены → настройка проекта (в т.ч. чередование) → приближение. */
export function resolveKenBurnsDirection(project: Project, scene: Scene): ReturnType<typeof resolveImageMotionDirection> {
  return resolveImageMotionDirection(project, scene);
}

/** Stock-видео используется независимо от AI-video; старый AI videoPath при выключенной генерации игнорируется. */
export function shouldUseAiVideo(
  project: Project,
  scene: Scene,
  fileExists: (path: string) => boolean = existsSync
): boolean {
  const selectedStockVideo = scene.stockSource?.mediaType === "video";
  return (selectedStockVideo || project.settings.video.enabled === true)
    && (selectedStockVideo || !scene.videoFallback)
    && Boolean(scene.videoPath && fileExists(scene.videoPath));
}

export class StandardRenderer {
  private readonly renderReports = new Map<string, ProjectRenderReport>();

  constructor(
    private readonly storage: LocalProjectStorage,
    private readonly montageRenderer?: MontageRenderer,
    private readonly eventSink: StandardRendererEventSink = () => undefined
  ) {}

  lastRenderReport(projectId: string): ProjectRenderReport | undefined {
    const report = this.renderReports.get(projectId);
    return report ? structuredClone(report) : undefined;
  }

  isAvailable(): boolean {
    return Boolean(executablePath());
  }

  /**
   * Вычисляет реальную длительность сцены до технического хвоста xfade.
   * Плановые секунды недостаточны: trim и playbackRate могут заметно укоротить
   * stock-видео, а длинная озвучка, наоборот, обязана растянуть сцену.
   */
  private async baseTimelineDuration(
    project: Project,
    scene: Scene,
    narrationTailSeconds = DEFAULT_NARRATION_TAIL_SECONDS
  ): Promise<number> {
    if (shouldUseAiVideo(project, scene)) {
      const sourceInfo = await inspectMedia(scene.videoPath as string);
      const narrationPath = project.settings.voice.enabled && scene.audioPath && existsSync(scene.audioPath) ? scene.audioPath : undefined;
      const narrationDuration = narrationPath ? narrationContentDuration(applyNarrationSlice(scene, await inspectNarration(narrationPath))) : 0;
      return resolveTimelineTiming(
        scene,
        sourceInfo.durationSeconds,
        "video",
        narrationDuration,
        narrationSliceTail(scene, narrationTailSeconds),
        0
      ).durationSeconds;
    }

    const audioPath = project.settings.voice.enabled ? scene.audioPath : undefined;
    const narrationInfo = audioPath ? applyNarrationSlice(scene, await inspectNarration(audioPath))
      : {durationSeconds: scene.durationSeconds, speechStartSeconds: 0, speechEndSeconds: 0};
    return resolveTimelineTiming(
      scene,
      narrationInfo.durationSeconds,
      "photo",
      narrationContentDuration(narrationInfo),
      narrationSliceTail(scene, narrationTailSeconds),
      0
    ).durationSeconds;
  }

  async renderScene(
    project: Project,
    scene: Scene,
    fadeInSeconds = 0,
    fadeOutSeconds = 0,
    narrationTailSeconds = DEFAULT_NARRATION_TAIL_SECONDS,
    outgoingOverlapSeconds = 0
  ): Promise<string> {
    const imagePath = scene.imagePath;
    if (!imagePath) throw new Error(`У сцены ${scene.order + 1} нет изображения`);
    const audioPath = project.settings.voice.enabled ? scene.audioPath : undefined;
    const audioInput = audioPath ? ["-i", audioPath]
      : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"];
    const outputPath = this.storage.sceneVideoPath(project, scene);
    await mkdir(dirname(outputPath), { recursive: true });
    const { width, height } = videoSize(project);
    const narrationInfo = audioPath ? applyNarrationSlice(scene, await inspectNarration(audioPath, project.settings.assembly.audioNormalize))
      : {durationSeconds: scene.durationSeconds, speechStartSeconds: 0, speechEndSeconds: 0};
    const timing = resolveTimelineTiming(
      scene,
      narrationInfo.durationSeconds,
      "photo",
      narrationContentDuration(narrationInfo),
      narrationSliceTail(scene, narrationTailSeconds),
      outgoingOverlapSeconds
    );
    const duration = timing.durationSeconds;
    const motionPlan = resolveImageMotionPlan(project, scene);
    const direction = motionPlan.direction;
    // Дрожание при зуме лечится двумя вещами: работой на четырёхкратном разрешении (субпиксельное движение
    // округляется мягче) и линейной формулой от номера кадра вместо накопления pzoom.
    const superScale = direction === "off" ? 1 : 4;
    const base = `scale=${width * superScale}:${height * superScale}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width * superScale}:${height * superScale}`;
    const totalFrames = Math.max(2, Math.round(duration * 30));
    const panning = direction.startsWith("pan-");
    // Для панорамы держим минимальный overscan: x всегда лежит между
    // 0 и iw-iw/zoom. Поэтому ни на первом, ни на последнем кадре не возникают чёрные углы.
    const maximumZoom = motionPlan.maximumZoom;
    const zoomDelta = maximumZoom - 1;
    const zoomExpression = panning
      ? maximumZoom.toFixed(4)
      : direction === "out"
      ? `${maximumZoom.toFixed(4)}-${zoomDelta.toFixed(4)}*on/${totalFrames}`
      : `1+${zoomDelta.toFixed(4)}*on/${totalFrames}`;
    const xExpression = direction === "pan-left"
      ? `(iw-iw/zoom)*(1-on/${totalFrames})`
      : direction === "pan-right"
        ? `(iw-iw/zoom)*on/${totalFrames}`
        : "iw/2-(iw/zoom/2)";
    const yExpression = direction === "pan-up" ? `(ih-ih/zoom)*on/${totalFrames}`
      : direction === "pan-down" ? `(ih-ih/zoom)*(1-on/${totalFrames})` : `(ih-ih/zoom)*${motionPlan.anchorY}`;
    const motion = direction !== "off"
      ? `,zoompan=z='${zoomExpression}':x='${xExpression}':y='${yExpression}':d=1:s=${width}x${height}:fps=30`
      : "";
    // Затухания краёв решает сборка (первый/последний кадр, явный fade-переход) — между сценами теперь crossfade.
    const fadeInDuration = Math.min(fadeInSeconds, duration / 3);
    const fadeOutDuration = Math.min(fadeOutSeconds, duration / 3);
    const fades = `${fadeInDuration > 0 ? `,fade=t=in:st=0:d=${fadeInDuration}` : ""}${fadeOutDuration > 0 ? `,fade=t=out:st=${Math.max(0, duration - fadeOutDuration)}:d=${fadeOutDuration}` : ""}`;
    let subtitles = "";
    if (project.settings.subtitles.enabled && scene.narration.trim().length > 0) {
      const assPath = join(dirname(outputPath), "subtitles.ass");
      await writeFile(assPath, buildAssSubtitles(scene.narration, duration, project.settings.subtitles, width, height), "utf8");
      subtitles = `,subtitles=filename='${filterPath(assPath)}'`;
    }
    const crf = project.settings.assembly.quality === "high" ? "18" : project.settings.assembly.quality === "preview" ? "28" : "22";
    const preset = project.settings.assembly.quality === "high" ? "medium" : "veryfast";
    await runFfmpeg([
      "-y",
      "-loop", "1",
      "-framerate", "30",
      "-i", imagePath,
      ...audioInput,
      "-vf", `${base}${motion}${fades}${subtitles},format=yuv420p`,
      "-af", `${narrationAudioFilters(resolveVolumePercent(scene.narrationVolume, 100), narrationInfo, project.settings.assembly.audioNormalize)},apad=pad_dur=${duration},atrim=0:${duration}`,
      "-t", String(duration),
      "-r", "30",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-preset", preset,
      "-crf", crf,
      "-c:a", "aac",
      "-b:a", "128k",
      "-ar", "48000",
      "-movflags", "+faststart",
      outputPath
    ]);
    return outputPath;
  }

  /** Склейка через xfade: dissolve, fade-through-black и ручные hard cut могут соседствовать в одном timeline. */
  private async assembleWithCrossfade(
    project: Project,
    scenes: Scene[],
    clips: string[],
    transitionOf: (scene: Scene) => "none" | "fade" | "mix",
    overlapOf: (scene: Scene) => number,
    outputPath: string,
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    const durations: number[] = [];
    for (const clip of clips) {
      const seconds = await mediaDurationSeconds(clip);
      durations.push(seconds > 0 ? seconds : 1);
    }
    const inputs = clips.flatMap((clip) => ["-i", clip]);
    const filters: string[] = [];
    let videoLabel = "[0:v]";
    let offset = 0;
    const junctions: number[] = [];
    for (let index = 1; index < clips.length; index += 1) {
      const junctionScene = scenes[index - 1]!;
      const transition = transitionOf(junctionScene);
      // mix — обычный dissolve, fade — настоящий переход через чёрный. Если в
      // одном графе встречается ручной hard cut, оставляем почти мгновенный
      // переход меньше одного кадра, не меняющий визуальное восприятие склейки.
      // Рендер уже зарезервировал ровно этот overlap. Повторный расчёт по длине
      // нормализованных клипов мог принять технический запас следующей сцены за
      // доступное время и растянуть короткий переход.
      const wanted = overlapOf(junctionScene);
      const junction = Math.max(0.02, Math.min(wanted, durations[index - 1]! - 0.1, durations[index]! - 0.1));
      junctions.push(junction);
      offset += durations[index - 1]! - junction;
      const videoOut = `[vx${index}]`;
      const ffmpegTransition = transition === "fade" ? "fadeblack" : "fade";
      filters.push(`${videoLabel}[${index}:v]xfade=transition=${ffmpegTransition}:duration=${junction.toFixed(2)}:offset=${offset.toFixed(2)}${videoOut}`);
      videoLabel = videoOut;
    }

    // Видеоряд перекрывается на junction секунд. У каждого клипа перед сборкой есть не меньший
    // хвост тишины, поэтому удаляем именно этот хвост и склеиваем звук без acrossfade. Acrossfade
    // приглушал последние/первые слова и создавал впечатление обрезанной озвучки.
    const audioLabels = clips.map((_, index) => {
      const outgoingJunction = junctions[index] ?? 0;
      const keepDuration = Math.max(0.02, durations[index]! - outgoingJunction);
      const label = `[ac${index}]`;
      filters.push(
        `[${index}:a]apad=pad_dur=${keepDuration.toFixed(3)},atrim=start=0:end=${keepDuration.toFixed(3)},`
        + `asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo${label}`
      );
      return label;
    });
    const audioLabel = "[aout]";
    filters.push(`${audioLabels.join("")}concat=n=${audioLabels.length}:v=0:a=1${audioLabel}`);
    const crf = project.settings.assembly.quality === "high" ? "18" : project.settings.assembly.quality === "preview" ? "28" : "22";
    const preset = project.settings.assembly.quality === "high" ? "medium" : "veryfast";
    await runFfmpeg([
      "-y",
      ...inputs,
      "-filter_complex", filters.join(";"),
      "-map", videoLabel,
      "-map", audioLabel,
      "-r", "30",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-preset", preset,
      "-crf", crf,
      "-c:a", "aac",
      "-b:a", "128k",
      "-ar", "48000",
      "-movflags", "+faststart",
      outputPath
    ], onProgress ? seconds => onProgress(Math.min(1, seconds / Math.max(0.1, durations.reduce((a, b) => a + b, 0) - junctions.reduce((a, b) => a + b, 0)))) : undefined);
  }

  /** Ограничивает размер одного filter graph, но сохраняет переходы и на границах блоков. */
  private async assembleWithChunkedCrossfade(
    project: Project,
    scenes: Scene[],
    clips: string[],
    transitionOf: (scene: Scene) => "none" | "fade" | "mix",
    overlapOf: (scene: Scene) => number,
    outputPath: string,
    level = 0,
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    const maximumInputs = 32;
    if (clips.length <= maximumInputs) {
      await this.assembleWithCrossfade(project, scenes, clips, transitionOf, overlapOf, outputPath, onProgress);
      return;
    }

    const chunkPaths: string[] = [];
    const boundaryScenes: Scene[] = [];
    try {
      for (let start = 0; start < clips.length; start += maximumInputs) {
        const chunkClips = clips.slice(start, start + maximumInputs);
        const chunkScenes = scenes.slice(start, start + maximumInputs);
        const chunkPath = join(this.storage.projectDirectory(project.id), `timeline-chunk-${level}-${chunkPaths.length}.mp4`);
        if (chunkClips.length === 1) await copyFile(chunkClips[0] as string, chunkPath);
        else await this.assembleWithCrossfade(project, chunkScenes, chunkClips, transitionOf, overlapOf, chunkPath,
          fraction => onProgress?.(0.8 * (start + fraction * chunkClips.length) / clips.length));
        chunkPaths.push(chunkPath);
        boundaryScenes.push(chunkScenes.at(-1) as Scene);
        onProgress?.(0.8 * Math.min(clips.length, start + chunkClips.length) / clips.length);
      }
      await this.assembleWithChunkedCrossfade(project, boundaryScenes, chunkPaths, transitionOf, overlapOf, outputPath, level + 1,
        fraction => onProgress?.(0.8 + 0.2 * fraction));
    } finally {
      await Promise.all(chunkPaths.map((path) => rm(path, { force: true }).catch(() => undefined)));
    }
  }

  /** Приводит готовое AI-видео сцены к формату сборки, НЕ перезаписывая исходный scene.mp4. */
  private async normalizeVideoClip(
    project: Project,
    scene: Scene,
    fadeInSeconds: number,
    fadeOutSeconds = 0,
    narrationTailSeconds = DEFAULT_NARRATION_TAIL_SECONDS,
    outgoingOverlapSeconds = 0
  ): Promise<string> {
    const sourcePath = scene.videoPath as string;
    const outputPath = join(dirname(this.storage.sceneVideoPath(project, scene)), "scene-clip.mp4");
    await mkdir(dirname(outputPath), { recursive: true });
    const { width, height } = videoSize(project);
    const sourceInfo = await inspectMedia(sourcePath);
    const narrationPath = project.settings.voice.enabled && scene.audioPath && existsSync(scene.audioPath) ? scene.audioPath : undefined;
    const narrationInfo = narrationPath ? applyNarrationSlice(scene, await inspectNarration(narrationPath, project.settings.assembly.audioNormalize)) : undefined;
    const narrationDuration = narrationInfo ? narrationContentDuration(narrationInfo) : 0;
    const timing = resolveTimelineTiming(
      scene,
      sourceInfo.durationSeconds,
      "video",
      narrationDuration,
      narrationSliceTail(scene, narrationTailSeconds),
      outgoingOverlapSeconds
    );
    const duration = timing.durationSeconds;
    const fadeInDuration = Math.min(fadeInSeconds, duration / 3);
    const fadeOutDuration = Math.min(fadeOutSeconds, duration / 3);
    const fades = `${fadeInDuration > 0 ? `,fade=t=in:st=0:d=${fadeInDuration}` : ""}${fadeOutDuration > 0 ? `,fade=t=out:st=${Math.max(0, duration - fadeOutDuration)}:d=${fadeOutDuration}` : ""}`;
    const projectSourceVolume = project.settings.video.muteSource ? 0 : project.settings.video.sourceVolume;
    const sourceVolume = resolveVolumePercent(scene.sourceVolume, projectSourceVolume);
    const inputs = ["-i", sourcePath];
    if (narrationPath) inputs.push("-i", narrationPath);

    const filters = [
      `[0:v]trim=${trimSuffix(timing)},setpts=(PTS-STARTPTS)/${timing.playbackRate.toFixed(5)},scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=30,tpad=stop_mode=clone:stop=-1,trim=duration=${duration}${fades},format=yuv420p[vout]`
    ];
    const audioLabels: string[] = [];
    if (sourceInfo.hasAudio) {
      filters.push(`[0:a]${audioTimelineFilters(timing, sourceVolume)}[sourcea]`);
      audioLabels.push("[sourcea]");
    }
    if (narrationPath) {
      filters.push(`[1:a]${narrationAudioFilters(resolveVolumePercent(scene.narrationVolume, 100), narrationInfo, project.settings.assembly.audioNormalize)}[narrationa]`);
      audioLabels.push("[narrationa]");
    }
    if (audioLabels.length === 0) {
      const silentInput = inputs.length / 2;
      inputs.push("-f", "lavfi", "-t", String(duration), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
      filters.push(`[${silentInput}:a]atrim=0:${duration},asetpts=PTS-STARTPTS[aout]`);
    } else if (audioLabels.length === 1) {
      filters.push(`${audioLabels[0]}apad=pad_dur=${duration},atrim=0:${duration},aresample=48000[aout]`);
    } else {
      filters.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0,apad=pad_dur=${duration},atrim=0:${duration},aresample=48000[aout]`);
    }
    await runFfmpeg([
      "-y",
      ...inputs,
      "-filter_complex", filters.join(";"),
      "-map", "[vout]",
      "-map", "[aout]",
      "-t", String(duration),
      "-r", "30",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-preset", "veryfast",
      "-crf", "22",
      "-c:a", "aac",
      "-b:a", "128k",
      "-ar", "48000",
      "-movflags", "+faststart",
      outputPath
    ]);
    return outputPath;
  }

  async render(project: Project, onProgress?: (stage: string, progress: number) => void, signal?:AbortSignal): Promise<string> {
    const missing = missingAssemblyInputs(project, [], path => {
      try { const file = statSync(path); return file.isFile() && file.size > 0; }
      catch { return false; }
    });
    if (missing.length) {
      throw new Error(`[no-retry] Сборка не начата: отсутствуют локальные материалы (${missing.slice(0, 8).join("; ")}). Восстановите их на этапе «Материалы».`);
    }
    this.renderReports.delete(project.id);
    if (project.mediaMode === "stock" && project.settings.assembly.documentary?.version === 2) {
      if (!this.montageRenderer) throw new Error("Движок Stock Documentary недоступен");
      // V2 has one shared visual/audio composition. A legacy fallback would silently drop effects.
      signal?.throwIfAborted();
      const rendered = await this.montageRenderer.render({ project, clips: [], audioMasterPath: "", outputPath: this.storage.finalPath(project.id), onProgress, signal });
      const outputPath = typeof rendered === "string" ? rendered : rendered.outputPath;
      this.renderReports.set(project.id, { ...renderReportBase(project), completedAt: new Date().toISOString(), buildId: APP_BUILD_ID,
        engine: "remotion", requestedPlanner: "local", plannerUsed: "local", visualBeatCount: project.scenes.filter(scene => scene.includeInAssembly !== false).length, templates: ["full-media"],warnings:typeof rendered==='string'?undefined:rendered.warnings });
      return outputPath;
    }
    onProgress?.("FFmpeg: проверяю сцены и длительность озвучки", 2);
    await this.storage.ensureProject(project);
    if (project.scenes.length === 0) throw new Error("В проекте нет сцен");
    const included = [...project.scenes]
      .sort((a, b) => a.order - b.order)
      .filter((scene) => scene.includeInAssembly !== false);
    if (included.length === 0) throw new Error("Все сцены исключены из сборки — включите хотя бы одну в редакторе сценария");

    // Ручной переход важнее автомонтажа. Глобальное отключение скрывает
    // автопереходы, но не затирает явную ручную настройку сцены.
    const transitionOf = (scene: Scene): "none" | "fade" | "mix" => resolveSceneTransition(project, scene);
    const edgeFade = project.settings.assembly.fadeTransitions
      && project.settings.assembly.transitionType !== "none"
      ? Math.min(0.35, project.settings.assembly.transitionDurationSeconds ?? 0.35)
      : 0;
    const useTransitionGraph = included.length > 1
      && included.some((scene, index) => index < included.length - 1 && transitionOf(scene) !== "none");

    // Один и тот же фактический overlap должен использоваться при создании клипа,
    // xfade и обрезке его звукового хвоста. Особенно важно для trim/speed stock-видео.
    const baseDurations = new Map<string, number>();
    if (useTransitionGraph) {
      for (const scene of included) {
        baseDurations.set(scene.id, await this.baseTimelineDuration(project, scene));
      }
    }

    const clips: string[] = [];
    const outgoingOverlapByScene = new Map<string, number>();
    for (let index = 0; index < included.length; index += 1) {
      const scene = included[index]!;
      const personalEdgeFade = scene.fadeEdges === true ? resolveTransitionDuration(scene, project) : 0;
      // Явный fadeEdges добавляет края любой сцене; false отключает только автоматические края ролика.
      const fadeIn = Math.max(
        personalEdgeFade,
        index === 0 && scene.fadeEdges !== false ? edgeFade : 0,
        0
      );
      const fadeOut = Math.max(
        personalEdgeFade,
        index === included.length - 1 && scene.fadeEdges !== false ? edgeFade : 0
      );
      // Внутри xfade каждый стык сокращает результат на overlap. Удлиняем исходящий клип
      // на ту же величину: плановые durationSeconds остаются временем итогового timeline.
      const nextScene = included[index + 1];
      const sceneTransition = transitionOf(scene);
      const requestedOverlap = sceneTransition === "mix" || sceneTransition === "fade"
        ? resolveTransitionDuration(scene, project)
        : 0.02;
      const currentBaseDuration = baseDurations.get(scene.id) ?? scene.durationSeconds;
      const nextBaseDuration = nextScene ? baseDurations.get(nextScene.id) ?? nextScene.durationSeconds : 0;
      const outgoingOverlap = index < included.length - 1 && useTransitionGraph && nextScene
        ? Math.max(0.02, Math.min(requestedOverlap, currentBaseDuration - 0.1, nextBaseDuration - 0.1))
        : 0;
      outgoingOverlapByScene.set(scene.id, outgoingOverlap);
      // Готовое AI- или stock-видео используется как есть и не затирается Ken Burns-рендером.
      const hasAiVideo = shouldUseAiVideo(project, scene);
      clips.push(hasAiVideo
        ? await this.normalizeVideoClip(project, scene, fadeIn, fadeOut, DEFAULT_NARRATION_TAIL_SECONDS, outgoingOverlap)
        : await this.renderScene(project, scene, fadeIn, fadeOut, DEFAULT_NARRATION_TAIL_SECONDS, outgoingOverlap));
      onProgress?.(`FFmpeg: подготовлено сцен ${index + 1} из ${included.length}`, 5 + Math.round(((index + 1) / included.length) * 30));
    }

    const finalPath = this.storage.finalPath(project.id);
    // AI Story всегда остаётся чистым слайд-шоу: без автоматических карточек,
    // заголовков и инфографики. Remotion-монтаж — только для Stock Documentary.
    const montageEnabled = Boolean(
      this.montageRenderer
      && project.mediaMode === "stock"
      && project.settings.assembly.montage?.enabled !== false
    );
    // Сначала всегда получаем проверенную FFmpeg-версию. Remotion меняет только
    // видеоряд, а звук затем берётся именно отсюда — слова не режутся эффектами.
    const audioMasterPath = montageEnabled
      ? join(this.storage.projectDirectory(project.id), "Final.ffmpeg.mp4")
      : finalPath;
    const musicPath = project.settings.music.path?.trim();
    const withMusic = project.settings.music.enabled !== false && Boolean(musicPath && existsSync(musicPath));
    const assembledPath = withMusic ? join(this.storage.projectDirectory(project.id), "Final.tmp.mp4") : audioMasterPath;

    if (clips.length === 1) {
      await copyFile(clips[0] as string, assembledPath);
    } else if (useTransitionGraph) {
      await this.assembleWithChunkedCrossfade(
        project,
        included,
        clips,
        transitionOf,
        (scene) => outgoingOverlapByScene.get(scene.id) ?? 0.02,
        assembledPath,
        0,
        fraction => onProgress?.("FFmpeg: склеиваю кадры и переходы", 35 + Math.floor(fraction * (montageEnabled ? 7 : 60)))
      );
    } else {
      const listPath = join(this.storage.projectDirectory(project.id), "concat.txt");
      const content = clips
        .map((path) => `file '${path.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`)
        .join("\n");
      await writeFile(listPath, content, "utf8");
      await runFfmpeg([
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listPath,
        "-c", "copy",
        "-movflags", "+faststart",
        assembledPath
      ]);
    }

    if (withMusic) {
      // Подмешиваем фоновую музыку под озвучку: музыка зациклена на всю длину, громкость из настроек проекта.
      const volume = Math.min(100, Math.max(0, project.settings.music.volume)) / 100;
      await runFfmpeg([
        "-y",
        "-i", assembledPath,
        "-stream_loop", "-1",
        "-i", musicPath as string,
        "-filter_complex", `[1:a]volume=${volume}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`,
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "160k",
        "-movflags", "+faststart",
        audioMasterPath
      ]);
      await rm(assembledPath, { force: true }).catch(() => undefined);
    }
    if (montageEnabled) onProgress?.("FFmpeg-аудиосборка готова · запускаю визуальный монтаж Remotion", 42);

    if (this.montageRenderer && montageEnabled) {
      try {
        const montageClips: MontageSourceClip[] = [];
        for (let index = 0; index < clips.length; index += 1) {
          const scene = included[index]!;
          const clipPath = clips[index]!;
          const measured = await mediaDurationSeconds(clipPath);
          const overlap = useTransitionGraph ? outgoingOverlapByScene.get(scene.id) ?? 0 : 0;
          montageClips.push({
            scene,
            path: clipPath,
            durationSeconds: Math.max(0.1, measured - overlap)
          });
        }
        const rendered = await this.montageRenderer.render({
          project,
          clips: montageClips,
          audioMasterPath,
          outputPath: finalPath,
          onProgress
        });
        const outputPath = typeof rendered === "string" ? rendered : rendered.outputPath;
        const base = renderReportBase(project);
        const report: ProjectRenderReport = {
          ...base,
          completedAt: new Date().toISOString(),
          buildId: APP_BUILD_ID,
          engine: "remotion",
          requestedPlanner: typeof rendered === "string" ? project.settings.assembly.montage?.planner : rendered.requestedPlanner,
          plannerUsed: typeof rendered === "string" ? project.montagePlan?.usedPlanner : rendered.plannerUsed,
          visualBeatCount: typeof rendered === "string" ? base.visualBeatCount : rendered.visualBeatCount,
          templates: typeof rendered === "string" ? base.templates : rendered.templates,
          stockVideoCount: typeof rendered === "string" ? base.stockVideoCount : rendered.stockVideoCount ?? base.stockVideoCount,
          stockImageCount: typeof rendered === "string" ? base.stockImageCount : rendered.stockImageCount ?? base.stockImageCount
        };
        this.renderReports.set(project.id, report);
        this.eventSink("info", "render.remotion.completed", {
          projectId: project.id,
          scenes: included.length,
          outputPath,
          buildId: APP_BUILD_ID,
          plannerUsed: report.plannerUsed,
          beats: report.visualBeatCount,
          templates: report.templates
        });
        return outputPath;
      } catch (error) {
        // Для двух пользователей важнее получить Final.mp4, чем уронить всю
        // очередь из-за Chrome/Remotion. Fallback остаётся полностью пригодным.
        await copyFile(audioMasterPath, finalPath);
        const fallbackReason = error instanceof Error ? error.message : String(error);
        const report: ProjectRenderReport = {
          ...renderReportBase(project),
          completedAt: new Date().toISOString(),
          buildId: APP_BUILD_ID,
          engine: "ffmpeg-fallback",
          visualBeatCount: 0,
          templates: [],
          requestedPlanner: project.settings.assembly.montage?.planner,
          plannerUsed: project.montagePlan?.usedPlanner,
          fallbackReason: fallbackReason.slice(0, 1000)
        };
        this.renderReports.set(project.id, report);
        this.eventSink("warn", "render.remotion.fallback", {
          projectId: project.id,
          buildId: APP_BUILD_ID,
          error: fallbackReason
        });
        onProgress?.("Remotion недоступен · сохраняю надёжную FFmpeg-версию", 99);
      }
    } else {
      this.renderReports.set(project.id, {
        ...renderReportBase(project),
        completedAt: new Date().toISOString(),
        buildId: APP_BUILD_ID,
        engine: "ffmpeg",
        visualBeatCount: 0,
        templates: []
      });
      this.eventSink("info", "render.ffmpeg.completed", {
        projectId: project.id,
        outputPath: finalPath,
        buildId: APP_BUILD_ID,
        montageEnabled
      });
    }
    onProgress?.("FFmpeg: проверяю готовый файл", 98);
    // A successfully created filename is not sufficient: reject damaged output before enabling export.
    const finalDuration = await mediaDurationSeconds(finalPath);
    if (!(finalDuration > 0)) throw new Error("FFmpeg: итоговый файл пуст или его длительность не читается");
    await runFfmpeg(["-v", "error", "-xerror", "-i", finalPath, "-f", "null", "-"],
      seconds => onProgress?.("FFmpeg: проверяю готовый файл", 98 + Math.min(1, seconds / finalDuration)));
    onProgress?.("Ролик собран и проверен", 100);
    return finalPath;
  }
}

function renderReportBase(project: Project): Pick<ProjectRenderReport, "visualBeatCount" | "templates" | "stockVideoCount" | "stockImageCount"> {
  const included = project.scenes.filter((scene) => scene.includeInAssembly !== false);
  return {
    visualBeatCount: included.reduce((sum, scene) => sum + (scene.visualBeats?.length ?? 0), 0),
    templates: [...new Set(included.flatMap((scene) => scene.visualBeats?.map((beat) => beat.template) ?? []))],
    stockVideoCount: included.filter((scene) => scene.stockSource?.mediaType === "video" && Boolean(scene.videoPath)).length,
    stockImageCount: included.filter((scene) => scene.stockSource?.mediaType === "image" && Boolean(scene.imagePath)).length
  };
}

/** Путь для ffmpeg-фильтра subtitles: прямые слэши, экранированные двоеточие и кавычка. */
function filterPath(path: string): string {
  return path.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'");
}

/** "#rrggbb" → цвет ASS "&H00BBGGRR" (непрозрачный). */
export function assColor(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return "&H00FFFFFF";
  const value = match[1]!;
  return `&H00${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2)}`.toUpperCase();
}

export function assTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const centis = Math.min(99, Math.round((total - Math.floor(total)) * 100));
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

/** Делит озвучку сцены на реплики ~по 90 символов с таймингом, пропорциональным длине текста. */
export function narrationCues(narration: string, duration: number): Array<{ start: number; end: number; text: string }> {
  const clean = narration.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…]+[.!?…]*\s*/g)?.map((part) => part.trim()).filter(Boolean) ?? [clean];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > 90) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  const totalCharacters = chunks.reduce((sum, chunk) => sum + chunk.length, 0) || 1;
  const cues: Array<{ start: number; end: number; text: string }> = [];
  let cursor = 0;
  for (const chunk of chunks) {
    const share = (chunk.length / totalCharacters) * duration;
    cues.push({ start: cursor, end: Math.min(duration, cursor + share), text: chunk });
    cursor += share;
  }
  return cues;
}

/** Караоке-разметка ASS: каждое слово получает {\k<сотые секунды>} пропорционально своей длине. */
export function karaokeText(text: string, durationSeconds: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return text;
  const totalCharacters = words.reduce((sum, word) => sum + word.length, 0) || 1;
  let remaining = Math.max(words.length, Math.round(durationSeconds * 100));
  return words
    .map((word, index) => {
      const share = index === words.length - 1
        ? Math.max(1, remaining)
        : Math.max(1, Math.round((word.length / totalCharacters) * durationSeconds * 100));
      remaining -= share;
      return `{\\k${share}}${word}`;
    })
    .join(" ");
}

/** Строит ASS-файл субтитров сцены по настройкам проекта (шрифт, цвета, обводка, отступ, караоке-подсветка). */
function buildAssSubtitles(narration: string, duration: number, settings: SubtitleSettings, width: number, height: number): string {
  // fontSize в настройках задан из расчёта высоты 1080 — масштабируем под реальный кадр.
  const fontSize = Math.max(16, Math.round(settings.fontSize * (height / 1080)));
  const marginV = Math.max(10, Math.round((settings.bottomMargin / 100) * height));
  // popWords: произнесённые слова окрашиваются в акцентный цвет (караоке \k: Secondary → Primary).
  const primary = settings.popWords ? assColor(settings.accentColor) : assColor(settings.textColor);
  const secondary = settings.popWords ? assColor(settings.textColor) : assColor(settings.accentColor);
  const events = narrationCues(narration, duration)
    .map((cue) => {
      const clean = cue.text.replace(/[{}]/g, "").replace(/\r?\n+/g, "\\N");
      const text = settings.popWords ? karaokeText(clean, cue.end - cue.start) : clean;
      return `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${text}`;
    })
    .join("\n");
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${settings.fontFamily},${fontSize},${primary},${secondary},${assColor(settings.outlineColor)},&H78000000,-1,0,0,0,100,100,0,0,1,${Math.max(0, settings.outlineWidth)},${settings.shadow ? 2 : 0},2,60,60,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    events
  ].join("\n");
}
