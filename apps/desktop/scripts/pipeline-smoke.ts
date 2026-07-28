import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MemoryProjectRepository,
  MemoryTaskRepository,
  MockDirectorProvider,
  ProjectService
} from "@gold-work/core";
import type { Scene } from "@gold-work/shared";
import { LocalProjectStorage } from "../src/local-project-storage.js";
import { DEFAULT_QUEUE_POLICY, MockGenerationPipeline } from "../src/mock-generation-pipeline.js";
import { StandardRenderer } from "../src/standard-renderer.js";
import { TextFileLogger } from "../src/text-file-logger.js";

const root = await mkdtemp(join(tmpdir(), "gold-work-pipeline-"));

try {
  const projectRepository = new MemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  const project = await projectService.create({
    title: "Pipeline smoke",
    topic: "Локальная сборка",
    aspectRatio: "16:9",
    language: "Русский",
    mode: "standard"
  });
  const scene: Scene = {
    id: "scene_smoke",
    order: 0,
    title: "Тестовая сцена",
    imagePrompt: "Тёплый кинематографичный кадр",
    animationPrompt: "Плавный наезд камеры",
    narration: "Проверка локального конвейера.",
    durationSeconds: 1,
    status: "draft"
  };
  const secondScene: Scene = {
    ...scene,
    id: "scene_smoke_2",
    order: 1,
    title: "Вторая тестовая сцена",
    imagePrompt: "Холодный кинематографичный кадр",
    transition: "fade",
    kenBurnsDirection: "out"
  };
  const excludedScene: Scene = {
    ...scene,
    id: "scene_smoke_3",
    order: 2,
    title: "Сцена вне сборки",
    includeInAssembly: false
  };
  const musicPath = join(root, "bgm.wav");
  await writeFile(musicPath, silentWav(2));
  await projectService.update(project.id, {
    scenes: [scene, secondScene, excludedScene],
    settings: {
      ...project.settings,
      subtitles: { ...project.settings.subtitles, enabled: true },
      music: { path: musicPath, volume: 20 }
    }
  });

  const storage = new LocalProjectStorage(join(root, "projects"));
  const renderer = new StandardRenderer(storage);
  const logger = new TextFileLogger(join(root, "logs", "gold-work-studio-log.txt"));
  await logger.initialize();
  assert.equal(renderer.isAvailable(), true, "FFmpeg должен быть доступен");
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    projectService,
    storage,
    renderer,
    DEFAULT_QUEUE_POLICY,
    (event) => void logger.write(event.level, event.message, event.details)
  );
  await pipeline.initialize();
  await pipeline.start(project.id);
  await pipeline.drain();

  const completed = await projectService.get(project.id);
  assert.equal(completed?.status, "complete");
  assert.ok(completed?.outputPath);
  assert.ok((await stat(completed.outputPath)).size > 1000);
  assert.ok((await readFile(join(storage.sceneDirectory(completed, completed.scenes[0] as Scene), "image-prompt.txt"), "utf8")).includes("кинематографичный"));
  const assContent = await readFile(join(storage.sceneDirectory(completed, completed.scenes[0] as Scene), "subtitles.ass"), "utf8");
  // popWords включён по умолчанию: караоке-теги {\k..} разбивают фразу, проверяем по словам.
  assert.ok(assContent.includes("Dialogue:") && assContent.includes("локального") && assContent.includes("\\k"), "субтитры сцены должны содержать текст озвучки с караоке-разметкой");

  await pipeline.regenerateScene(project.id, secondScene.id);
  await pipeline.drain();
  const regenerated = await projectService.get(project.id);
  assert.equal(regenerated?.status, "complete");
  assert.ok(regenerated?.outputPath && (await stat(regenerated.outputPath)).size > 1000);
  await logger.write("info", "redaction.check", { apiKey: "must-not-leak" });
  await logger.write("error", "token=raw-secret");
  await logger.flush();
  const log = await readFile(logger.path, "utf8");
  assert.ok(log.includes("queue.task.completed"));
  assert.ok(log.includes("[REDACTED]"));
  assert.ok(!log.includes("must-not-leak"));
  assert.ok(!log.includes("raw-secret"));

  console.log(`[pipeline-smoke] OK ${regenerated.outputPath}`);
} finally {
  await rm(root, { recursive: true, force: true });
}

/** Минимальный тишина-WAV (16 кГц, моно, 16 бит) для проверки подмешивания фоновой музыки. */
function silentWav(durationSeconds: number): Buffer {
  const sampleRate = 16_000;
  const samples = Math.ceil(durationSeconds * sampleRate);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
