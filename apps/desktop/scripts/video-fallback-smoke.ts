/**
 * Проверка запасного пути AI-видео: Google отказывает по нулевой квоте (limit: 0),
 * софт не должен ронять проект — сцена рендерится локально, Final.mp4 собирается.
 * Запуск: npx tsx scripts/video-fallback-smoke.ts
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryProjectRepository, MemoryTaskRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import type { Scene } from "@gold-work/shared";
import { LocalProjectStorage } from "../src/local-project-storage.js";
import { DEFAULT_QUEUE_POLICY, MockGenerationPipeline } from "../src/mock-generation-pipeline.js";
import { StandardRenderer } from "../src/standard-renderer.js";
import { googleError } from "../src/google-errors.js";
import type { VeoClient } from "../src/veo-client.js";

const QUOTA_BODY = {
  error: {
    message: "You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-omni-flash"
  }
};

/** Клиент, который ведёт себя как Google без биллинга. */
function makeRefusingVeo(): { client: VeoClient; calls: () => number } {
  let calls = 0;
  const body = Buffer.from(JSON.stringify(QUOTA_BODY), "utf8");
  const message = googleError({
    ok: false, status: 429, headers: {}, body,
    text: () => body.toString("utf8"),
    json: <T,>() => JSON.parse(body.toString("utf8")) as T
  });
  const client = {
    async configured() { return true; },
    async generateVideo() { calls += 1; throw new Error(message); }
  } as unknown as VeoClient;
  return { client, calls: () => calls };
}

const root = await mkdtemp(join(tmpdir(), "gold-work-fallback-"));
try {
  const projectService = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const project = await projectService.create({
    title: "Fallback smoke", topic: "Отказ Google", aspectRatio: "16:9", language: "Русский", mode: "standard"
  });
  const scenes: Scene[] = [0, 1].map((order) => ({
    id: `scene_fb_${order}`, order,
    title: `Сцена ${order + 1}`,
    imagePrompt: "Кинематографичный кадр",
    animationPrompt: "Плавный наезд камеры",
    narration: "Проверка запасного пути.",
    durationSeconds: 1,
    status: "draft"
  }));
  await projectService.update(project.id, {
    scenes,
    settings: {
      ...project.settings,
      video: { ...project.settings.video, enabled: true, provider: "veo", animationPercent: 100 }
    }
  });

  const storage = new LocalProjectStorage(join(root, "projects"));
  const renderer = new StandardRenderer(storage);
  const veo = makeRefusingVeo();
  const events: string[] = [];
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(), projectService, storage, renderer,
    DEFAULT_QUEUE_POLICY,
    (event) => events.push(event.message),
    undefined, undefined, veo.client
  );
  await pipeline.initialize();
  await pipeline.start(project.id);
  await pipeline.drain();

  const done = await projectService.get(project.id);
  assert.equal(done?.status, "complete", "проект должен дойти до конца, несмотря на отказ Google");
  assert.ok(done?.outputPath && (await stat(done.outputPath)).size > 1000, "Final.mp4 собран");
  assert.ok(events.includes("queue.task.video_fallback"), "в журнале есть предупреждение о запасном пути");
  assert.equal(veo.calls(), scenes.length, `нет лишних попыток: ${veo.calls()} вызовов на ${scenes.length} сцен`);
  console.log(`[video-fallback-smoke] OK ${done.outputPath} · вызовов Google: ${veo.calls()}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
