import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import type { Project, Scene, SubtitleSettings } from "@gold-work/shared";
import { LocalProjectStorage } from "./local-project-storage.js";

function executablePath(): string | undefined {
  return ffmpegPath?.replace("app.asar", "app.asar.unpacked");
}

function runFfmpeg(args: string[]): Promise<void> {
  const executable = executablePath();
  if (!executable) return Promise.reject(new Error("FFmpeg не найден"));
  return new Promise((resolve, reject) => {
    const process = spawn(executable, args, { windowsHide: true });
    let errorOutput = "";
    process.stderr.on("data", (chunk: Buffer) => {
      errorOutput = `${errorOutput}${chunk.toString("utf8")}`.slice(-8000);
    });
    process.once("error", reject);
    process.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg завершился с кодом ${code}: ${errorOutput.trim()}`));
    });
  });
}

/** Длительность медиафайла в секундах: парсим Duration из stderr ffmpeg -i (ffprobe в сборке нет). */
function mediaDurationSeconds(path: string): Promise<number> {
  const executable = executablePath();
  if (!executable) return Promise.resolve(0);
  return new Promise((resolve) => {
    const child = spawn(executable, ["-i", path], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.once("error", () => resolve(0));
    child.once("close", () => {
      const match = /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/.exec(stderr);
      if (!match) return resolve(0);
      resolve(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 100);
    });
  });
}

function videoSize(project: Project): { width: number; height: number } {
  if (project.aspectRatio === "9:16") return { width: 720, height: 1280 };
  if (project.aspectRatio === "1:1") return { width: 900, height: 900 };
  return { width: 1280, height: 720 };
}

/** Направление камеры сцены: личная настройка сцены → настройка проекта (в т.ч. чередование) → приближение. */
export function resolveKenBurnsDirection(project: Project, scene: Scene): "in" | "out" | "off" {
  const sceneDirection = scene.kenBurnsDirection ?? "auto";
  if (sceneDirection === "off") return "off";
  if (sceneDirection === "in" || sceneDirection === "out") return sceneDirection;
  if (!project.settings.assembly.kenBurns) return "off";
  const projectDirection = project.settings.assembly.kenBurnsDirection ?? "in";
  if (projectDirection === "alternate") return scene.order % 2 === 0 ? "in" : "out";
  return projectDirection;
}

export class StandardRenderer {
  constructor(private readonly storage: LocalProjectStorage) {}

  isAvailable(): boolean {
    return Boolean(executablePath());
  }

  async renderScene(project: Project, scene: Scene, fadeInSeconds = 0, fadeOutSeconds = 0): Promise<string> {
    const imagePath = scene.imagePath;
    if (!imagePath) throw new Error(`У сцены ${scene.order + 1} нет изображения`);
    const audioPath = scene.audioPath ?? await this.storage.createPlaceholderAudio(project, scene);
    const outputPath = this.storage.sceneVideoPath(project, scene);
    await mkdir(dirname(outputPath), { recursive: true });
    const { width, height } = videoSize(project);
    // Кадр живёт ровно столько, сколько звучит его озвучка (+0.5с воздуха на переход):
    // у каждого голоса своя скорость чтения, фиксированная длительность резала или тянула сцену.
    const audioSeconds = await mediaDurationSeconds(audioPath);
    const duration = audioSeconds > 0.2 ? audioSeconds + 0.5 : Math.max(1, scene.durationSeconds);
    const direction = resolveKenBurnsDirection(project, scene);
    // Дрожание при зуме лечится двумя вещами: работой на удвоенном разрешении (субпиксельное движение
    // округляется мягче) и линейной формулой от номера кадра вместо накопления pzoom.
    const superScale = direction === "off" ? 1 : 2;
    const base = `scale=${width * superScale}:${height * superScale}:force_original_aspect_ratio=increase,crop=${width * superScale}:${height * superScale}`;
    const totalFrames = Math.max(2, Math.round(duration * 30));
    const zoomExpression = direction === "out"
      ? `1.10-0.10*on/${totalFrames}`
      : `1+0.10*on/${totalFrames}`;
    const motion = direction !== "off"
      ? `,zoompan=z='${zoomExpression}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=30`
      : "";
    // Затухания краёв решает сборка (первый/последний кадр, явный fade-переход) — между сценами теперь crossfade.
    const fadeInDuration = Math.min(fadeInSeconds, duration / 3);
    const fadeOutDuration = Math.max(Math.min(fadeOutSeconds, duration / 3), scene.transition === "fade" ? Math.min(0.5, duration / 3) : 0);
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
      "-i", audioPath,
      "-vf", `${base}${motion}${fades}${subtitles},format=yuv420p`,
      "-af", `apad=pad_dur=${duration},atrim=0:${duration}`,
      "-t", String(duration),
      "-r", "30",
      "-c:v", "libx264",
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

  /** Склейка через xfade/acrossfade: кадры плавно перетекают друг в друга (mix), без ухода в чёрный. */
  private async assembleWithCrossfade(
    project: Project,
    scenes: Scene[],
    clips: string[],
    transitionOf: (scene: Scene) => "none" | "fade" | "mix",
    outputPath: string
  ): Promise<void> {
    const durations: number[] = [];
    for (const clip of clips) {
      const seconds = await mediaDurationSeconds(clip);
      durations.push(seconds > 0 ? seconds : 1);
    }
    const inputs = clips.flatMap((clip) => ["-i", clip]);
    const filters: string[] = [];
    let videoLabel = "[0:v]";
    let audioLabel = "[0:a]";
    let offset = 0;
    for (let index = 1; index < clips.length; index += 1) {
      const junctionScene = scenes[index - 1]!;
      // mix — заметное смешивание 0.5с; fade/none — почти мгновенный стык (fade уже вшит в сам клип).
      const wanted = transitionOf(junctionScene) === "mix" ? 0.5 : 0.05;
      const junction = Math.max(0.02, Math.min(wanted, durations[index - 1]! - 0.1, durations[index]! - 0.1));
      offset += durations[index - 1]! - junction;
      const videoOut = `[vx${index}]`;
      const audioOut = `[ax${index}]`;
      filters.push(`${videoLabel}[${index}:v]xfade=transition=fade:duration=${junction.toFixed(2)}:offset=${offset.toFixed(2)}${videoOut}`);
      filters.push(`${audioLabel}[${index}:a]acrossfade=d=${junction.toFixed(2)}${audioOut}`);
      videoLabel = videoOut;
      audioLabel = audioOut;
    }
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
      "-preset", preset,
      "-crf", crf,
      "-c:a", "aac",
      "-b:a", "128k",
      "-ar", "48000",
      "-movflags", "+faststart",
      outputPath
    ]);
  }

  /** Приводит готовое AI-видео сцены к формату сборки, НЕ перезаписывая исходный scene.mp4. */
  private async normalizeVideoClip(project: Project, scene: Scene, fadeInSeconds: number, fadeOutSeconds = 0): Promise<string> {
    const sourcePath = scene.videoPath as string;
    const outputPath = join(dirname(this.storage.sceneVideoPath(project, scene)), "scene-clip.mp4");
    const { width, height } = videoSize(project);
    const duration = Math.max(1, scene.durationSeconds);
    const fadeInDuration = Math.min(fadeInSeconds, duration / 3);
    const fadeOutDuration = Math.max(Math.min(fadeOutSeconds, duration / 3), scene.transition === "fade" ? Math.min(0.5, duration / 3) : 0);
    const fades = `${fadeInDuration > 0 ? `,fade=t=in:st=0:d=${fadeInDuration}` : ""}${fadeOutDuration > 0 ? `,fade=t=out:st=${Math.max(0, duration - fadeOutDuration)}:d=${fadeOutDuration}` : ""}`;
    const sourceVolume = project.settings.video.muteSource ? 0 : Math.min(100, Math.max(0, project.settings.video.sourceVolume)) / 100;
    await runFfmpeg([
      "-y",
      "-i", sourcePath,
      "-t", String(duration),
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=30,tpad=stop_mode=clone:stop=-1${fades},format=yuv420p`,
      "-af", `volume=${sourceVolume},apad=pad_dur=${duration},atrim=0:${duration},aresample=48000`,
      "-r", "30",
      "-c:v", "libx264",
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

  async render(project: Project): Promise<string> {
    await this.storage.ensureProject(project);
    if (project.scenes.length === 0) throw new Error("В проекте нет сцен");
    const included = [...project.scenes]
      .sort((a, b) => a.order - b.order)
      .filter((scene) => scene.includeInAssembly !== false);
    if (included.length === 0) throw new Error("Все сцены исключены из сборки — включите хотя бы одну в редакторе сценария");

    // Переход по умолчанию — плавное смешивание (mix); сцена может явно выбрать fade/none.
    const defaultTransition = project.settings.assembly.fadeTransitions ? "mix" : "none";
    const transitionOf = (scene: Scene): "none" | "fade" | "mix" => scene.transition ?? defaultTransition;
    const edgeFade = project.settings.assembly.fadeTransitions ? 0.35 : 0;

    const clips: string[] = [];
    for (let index = 0; index < included.length; index += 1) {
      const scene = included[index]!;
      const previous = index > 0 ? included[index - 1]! : undefined;
      // Вход: мягкое появление первого кадра; после fade-перехода — выход из чёрного.
      const fadeIn = index === 0 ? edgeFade : previous && transitionOf(previous) === "fade" ? 0.5 : 0;
      // Выход: только у последнего кадра (fade-переход сцена добавляет сама).
      const fadeOut = index === included.length - 1 ? edgeFade : 0;
      // Готовое AI-видео сцены используется как есть (нормализация в общий формат), не затираясь Ken Burns-рендером.
      const hasAiVideo = Boolean(scene.videoPath && existsSync(scene.videoPath));
      clips.push(hasAiVideo
        ? await this.normalizeVideoClip(project, scene, fadeIn, fadeOut)
        : await this.renderScene(project, scene, fadeIn, fadeOut));
    }

    const finalPath = this.storage.finalPath(project.id);
    const musicPath = project.settings.music.path?.trim();
    const withMusic = project.settings.music.enabled !== false && Boolean(musicPath && existsSync(musicPath));
    const assembledPath = withMusic ? join(this.storage.projectDirectory(project.id), "Final.tmp.mp4") : finalPath;

    const useCrossfade = included.length > 1 && included.length <= 60
      && included.some((scene, index) => index < included.length - 1 && transitionOf(scene) === "mix");

    if (clips.length === 1) {
      await copyFile(clips[0] as string, assembledPath);
    } else if (useCrossfade) {
      await this.assembleWithCrossfade(project, included, clips, transitionOf, assembledPath);
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
        finalPath
      ]);
      await rm(assembledPath, { force: true }).catch(() => undefined);
    }
    return finalPath;
  }
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
