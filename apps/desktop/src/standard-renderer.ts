import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import type { Project, Scene } from "@gold-work/shared";
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

  async renderScene(project: Project, scene: Scene): Promise<string> {
    const imagePath = scene.imagePath;
    if (!imagePath) throw new Error(`У сцены ${scene.order + 1} нет изображения`);
    const audioPath = scene.audioPath ?? await this.storage.createPlaceholderAudio(project, scene);
    const outputPath = this.storage.sceneVideoPath(project, scene);
    await mkdir(dirname(outputPath), { recursive: true });
    const { width, height } = videoSize(project);
    const duration = Math.max(1, scene.durationSeconds);
    const base = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    const motion = project.settings.assembly.kenBurns
      ? `,zoompan=z='min(zoom+0.0006,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=30`
      : "";
    const fadeDuration = Math.min(0.35, duration / 4);
    const fades = project.settings.assembly.fadeTransitions
      ? `,fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${Math.max(0, duration - fadeDuration)}:d=${fadeDuration}`
      : "";
    const crf = project.settings.assembly.quality === "high" ? "18" : project.settings.assembly.quality === "preview" ? "28" : "22";
    const preset = project.settings.assembly.quality === "high" ? "medium" : "veryfast";
    await runFfmpeg([
      "-y",
      "-loop", "1",
      "-framerate", "30",
      "-i", imagePath,
      "-i", audioPath,
      "-vf", `${base}${motion}${fades},format=yuv420p`,
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
    const clips: string[] = [];
    for (const scene of [...project.scenes].sort((a, b) => a.order - b.order)) {
      clips.push(await this.renderScene(project, scene));
    }
    const finalPath = this.storage.finalPath(project.id);
    if (clips.length === 1) {
      await copyFile(clips[0] as string, finalPath);
      return finalPath;
    }
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
      finalPath
    ]);
    return finalPath;
  }
}
