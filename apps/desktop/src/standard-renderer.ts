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

function videoSize(project: Project): { width: number; height: number } {
  if (project.aspectRatio === "9:16") return { width: 720, height: 1280 };
  if (project.aspectRatio === "1:1") return { width: 900, height: 900 };
  return { width: 1280, height: 720 };
}

export class StandardRenderer {
  constructor(private readonly storage: LocalProjectStorage) {}

  isAvailable(): boolean {
    return Boolean(executablePath());
  }

  async renderScene(project: Project, scene: Scene, fadeInSeconds = 0): Promise<string> {
    const imagePath = scene.imagePath;
    if (!imagePath) throw new Error(`У сцены ${scene.order + 1} нет изображения`);
    const audioPath = scene.audioPath ?? await this.storage.createPlaceholderAudio(project, scene);
    const outputPath = this.storage.sceneVideoPath(project, scene);
    await mkdir(dirname(outputPath), { recursive: true });
    const { width, height } = videoSize(project);
    const duration = Math.max(1, scene.durationSeconds);
    const base = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    // Направление сцены важнее настройки проекта: off выключает движение, in/out задают его явно.
    const direction = scene.kenBurnsDirection ?? "auto";
    const kenBurnsActive = direction === "off" ? false : direction === "auto" ? project.settings.assembly.kenBurns : true;
    const zoomExpression = direction === "out"
      ? "if(lte(on,1),1.08,max(zoom-0.0006,1.001))"
      : "min(zoom+0.0006,1.08)";
    const motion = kenBurnsActive
      ? `,zoompan=z='${zoomExpression}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=30`
      : "";
    // Затухания: общие плавные переходы проекта + личный переход сцены (fade к следующей) + вход после перехода.
    const globalFade = project.settings.assembly.fadeTransitions ? Math.min(0.35, duration / 4) : 0;
    const fadeInDuration = Math.max(globalFade, Math.min(fadeInSeconds, duration / 3));
    const fadeOutDuration = Math.max(globalFade, scene.transition === "fade" ? Math.min(0.5, duration / 3) : 0);
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
    const clips: string[] = [];
    let fadeInSeconds = 0;
    for (const scene of included) {
      clips.push(await this.renderScene(project, scene, fadeInSeconds));
      fadeInSeconds = scene.transition === "fade" ? 0.5 : 0;
    }
    const finalPath = this.storage.finalPath(project.id);
    const musicPath = project.settings.music.path?.trim();
    const withMusic = project.settings.music.enabled !== false && Boolean(musicPath && existsSync(musicPath));
    const assembledPath = withMusic ? join(this.storage.projectDirectory(project.id), "Final.tmp.mp4") : finalPath;

    if (clips.length === 1) {
      await copyFile(clips[0] as string, assembledPath);
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
        "-filter_complex", `[1:a]volume=${volume}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
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
function assColor(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return "&H00FFFFFF";
  const value = match[1]!;
  return `&H00${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2)}`.toUpperCase();
}

function assTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const centis = Math.min(99, Math.round((total - Math.floor(total)) * 100));
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

/** Делит озвучку сцены на реплики ~по 90 символов с таймингом, пропорциональным длине текста. */
function narrationCues(narration: string, duration: number): Array<{ start: number; end: number; text: string }> {
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

/** Строит ASS-файл субтитров сцены по настройкам проекта (шрифт, цвета, обводка, отступ снизу). */
function buildAssSubtitles(narration: string, duration: number, settings: SubtitleSettings, width: number, height: number): string {
  // fontSize в настройках задан из расчёта высоты 1080 — масштабируем под реальный кадр.
  const fontSize = Math.max(16, Math.round(settings.fontSize * (height / 1080)));
  const marginV = Math.max(10, Math.round((settings.bottomMargin / 100) * height));
  const events = narrationCues(narration, duration)
    .map((cue) => {
      const text = cue.text.replace(/[{}]/g, "").replace(/\r?\n+/g, "\\N");
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
    `Style: Default,${settings.fontFamily},${fontSize},${assColor(settings.textColor)},${assColor(settings.accentColor)},${assColor(settings.outlineColor)},&H78000000,-1,0,0,0,100,100,0,0,1,${Math.max(0, settings.outlineWidth)},${settings.shadow ? 2 : 0},2,60,60,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    events
  ].join("\n");
}
