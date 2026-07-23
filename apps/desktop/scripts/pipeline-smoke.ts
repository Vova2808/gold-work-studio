import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
    imagePrompt: "Холодный кинематографичный кадр"
  };
  await projectService.update(project.id, { scenes: [scene, secondScene] });

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
  for (let index = 0; index < 50; index += 1) await pipeline.tick();

  const completed = await projectService.get(project.id);
  assert.equal(completed?.status, "complete");
  assert.ok(completed?.outputPath);
  assert.ok((await stat(completed.outputPath)).size > 1000);
  assert.ok((await readFile(join(storage.sceneDirectory(completed, completed.scenes[0] as Scene), "image-prompt.txt"), "utf8")).includes("кинематографичный"));

  await pipeline.regenerateScene(project.id, secondScene.id);
  for (let index = 0; index < 50; index += 1) await pipeline.tick();
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
