import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { AspectRatio } from "@gold-work/shared";

function executablePath(): string | undefined {
  return ffmpegPath?.replace("app.asar", "app.asar.unpacked");
}

/** Целевой размер кадра проекта: генераторы часто отдают своё соотношение (у GPT Image нет 16:9). */
export function frameSize(aspectRatio: AspectRatio): { width: number; height: number } {
  if (aspectRatio === "9:16") return { width: 1080, height: 1920 };
  if (aspectRatio === "1:1") return { width: 1152, height: 1152 };
  return { width: 1920, height: 1080 };
}

/**
 * Приводит картинку к формату проекта: вписывает по большей стороне и обрезает по центру.
 * Без этого кадры 3:2 от GPT Image выглядят «квадратными» рядом с 16:9.
 */
export async function normalizeImageAspect(data: Buffer, aspectRatio: AspectRatio): Promise<Buffer> {
  const executable = executablePath();
  if (!executable) return data;
  const { width, height } = frameSize(aspectRatio);
  const directory = await mkdtemp(join(tmpdir(), "gw-frame-"));
  const inputPath = join(directory, "in.png");
  const outputPath = join(directory, "out.png");
  try {
    await writeFile(inputPath, data);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, [
        "-y",
        "-i", inputPath,
        "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
        outputPath
      ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-2000); });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `ffmpeg ${code}`)));
    });
    return await readFile(outputPath);
  } catch {
    return data; // не смогли привести — лучше отдать исходник, чем провалить задачу
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
