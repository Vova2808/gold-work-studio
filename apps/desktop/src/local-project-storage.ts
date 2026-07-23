import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Project, Scene } from "@gold-work/shared";

function safeSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) || "untitled";
}

async function writeAtomic(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, data);
  await rename(temporaryPath, path);
}

function createBmp(width: number, height: number, seed: number): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelSize = rowSize * height;
  const output = Buffer.alloc(54 + pixelSize);
  output.write("BM", 0, "ascii");
  output.writeUInt32LE(output.length, 2);
  output.writeUInt32LE(54, 10);
  output.writeUInt32LE(40, 14);
  output.writeInt32LE(width, 18);
  output.writeInt32LE(height, 22);
  output.writeUInt16LE(1, 26);
  output.writeUInt16LE(24, 28);
  output.writeUInt32LE(pixelSize, 34);

  const baseR = 45 + (seed % 90);
  const baseG = 30 + ((seed >> 3) % 70);
  const baseB = 65 + ((seed >> 7) % 100);
  for (let y = 0; y < height; y += 1) {
    const row = 54 + y * rowSize;
    for (let x = 0; x < width; x += 1) {
      const offset = row + x * 3;
      const light = Math.round(80 * (x / width) + 45 * (y / height));
      output[offset] = Math.min(255, baseB + light);
      output[offset + 1] = Math.min(255, baseG + Math.round(light * 0.75));
      output[offset + 2] = Math.min(255, baseR + Math.round(light * 0.55));
    }
  }
  return output;
}

function createSilentWav(durationSeconds: number): Buffer {
  const sampleRate = 16_000;
  const channels = 1;
  const bitsPerSample = 16;
  const sampleCount = Math.max(1, Math.ceil(durationSeconds * sampleRate));
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const output = Buffer.alloc(44 + dataSize);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(36 + dataSize, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(channels, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  output.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  output.writeUInt16LE(bitsPerSample, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(dataSize, 40);
  return output;
}

export class LocalProjectStorage {
  constructor(readonly rootPath: string) {}

  projectDirectory(projectId: string): string {
    return join(this.rootPath, safeSegment(projectId));
  }

  sceneDirectory(project: Project, scene: Scene): string {
    const order = String(scene.order + 1).padStart(3, "0");
    return join(this.projectDirectory(project.id), "scenes", `${order}-${safeSegment(scene.id)}`);
  }

  finalPath(projectId: string): string {
    return join(this.projectDirectory(projectId), "Final.mp4");
  }

  sceneVideoPath(project: Project, scene: Scene): string {
    return join(this.sceneDirectory(project, scene), "scene.mp4");
  }

  async ensureProject(project: Project): Promise<string> {
    const directory = this.projectDirectory(project.id);
    await mkdir(join(directory, "scenes"), { recursive: true });
    await writeAtomic(join(directory, "project.json"), JSON.stringify(project, null, 2));
    await writeAtomic(
      join(directory, "scenario.json"),
      JSON.stringify(
        project.scenes.map(({ id, order, title, narration, imagePrompt, animationPrompt, durationSeconds }) => ({
          id,
          order,
          title,
          narration,
          imagePrompt,
          animationPrompt,
          durationSeconds
        })),
        null,
        2
      )
    );
    return directory;
  }

  async createPlaceholderImage(project: Project, scene: Scene): Promise<string> {
    await this.ensureProject(project);
    const directory = this.sceneDirectory(project, scene);
    await mkdir(directory, { recursive: true });
    const path = join(directory, "image.bmp");
    const dimensions = project.aspectRatio === "9:16"
      ? [360, 640]
      : project.aspectRatio === "1:1"
        ? [512, 512]
        : [640, 360];
    const seed = [...`${project.id}:${scene.id}`].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    await writeAtomic(path, createBmp(dimensions[0] ?? 640, dimensions[1] ?? 360, seed));
    await writeAtomic(join(directory, "image-prompt.txt"), scene.imagePrompt);
    await this.writeSceneManifest(project, scene);
    return path;
  }

  async createPlaceholderAudio(project: Project, scene: Scene): Promise<string> {
    await this.ensureProject(project);
    const directory = this.sceneDirectory(project, scene);
    await mkdir(directory, { recursive: true });
    const path = join(directory, "voice.wav");
    await writeAtomic(path, createSilentWav(scene.durationSeconds));
    await writeAtomic(join(directory, "narration.txt"), scene.narration);
    await this.writeSceneManifest(project, scene);
    return path;
  }

  async writeSceneManifest(project: Project, scene: Scene): Promise<void> {
    await writeAtomic(join(this.sceneDirectory(project, scene), "scene.json"), JSON.stringify(scene, null, 2));
  }
}
