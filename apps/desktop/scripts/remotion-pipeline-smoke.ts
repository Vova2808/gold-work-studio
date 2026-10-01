import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { MemoryProjectRepository, MemoryTaskRepository, MockDirectorProvider, ProjectService } from "@gold-work/core";
import type { Scene } from "@gold-work/shared";
import { LocalProjectStorage } from "../src/local-project-storage.js";
import { DEFAULT_QUEUE_POLICY, MockGenerationPipeline } from "../src/mock-generation-pipeline.js";
import { RemotionMontageRenderer } from "../src/remotion-montage-renderer.js";
import { StandardRenderer, mediaDurationSeconds, runFfmpeg } from "../src/standard-renderer.js";
import { TextFileLogger } from "../src/text-file-logger.js";

const temporaryRoot = await mkdtemp(join(tmpdir(), "gold-work-remotion-pipeline-"));
const captureDirectory = resolve(process.cwd(), "..", "..", "captures", "remotion-pipeline-smoke");

try {
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  const created = await projects.create({
    title: "Universal Remotion smoke",
    topic: "Проверка универсального монтажа",
    aspectRatio: "16:9",
    language: "Русский",
    mode: "standard",
    mediaMode: "ai"
  });
  const narrations = [
    "В 2:17 пришёл короткий звонок, после которого всё изменилось.",
    "Эксперт сказал: «Одна деталь меняет весь вывод».",
    "Сначала команда осмотрела комнату. Затем сверила запись камеры.",
    "Первая версия казалась логичной, однако найденный маршрут показал другой путь.",
    "Свидетель прямо сказал: «Я видел машину у бокового входа».",
    "Все ранние детали сложились в один ответ. Загадка получила ясный финал."
  ];
  const scenes: Scene[] = narrations.map((narration, order) => ({
    id: `remotion-smoke-${order + 1}`,
    order,
    title: ["Звонок", "Ключевая цитата", "Два шага", "Другой маршрут", "Свидетель", "Ответ"][order]!,
    imagePrompt: `cinematic neutral scene ${order + 1}`,
    stockQuery: ["night phone", "expert interview", "room inspection", "alternate route", "witness interview", "case solved"][order],
    animationPrompt: order % 2 === 0 ? "slow camera push in" : "slow camera pull out",
    narration,
    // Достаточно длинная сцена обязательна для проверки именно multi-beat,
    // а не только факта запуска Remotion с одним fallback-beat на сцену.
    durationSeconds: 3.5,
    status: "draft"
  }));
  const storage = new LocalProjectStorage(join(temporaryRoot, "projects"));
  const placeholderProject = { ...created, scenes };
  const scenesWithAlternates = await Promise.all(scenes.map(async (scene) => {
    const alternateImagePath = await storage.createPlaceholderImage(placeholderProject, {
      ...scene,
      id: `${scene.id}-alternate`,
      order: scene.order + 100
    });
    const usesVideoAlternate = scene.order % 2 === 0;
    const alternateVideoPath = join(dirname(alternateImagePath), "alternate-source.mp4");
    if (usesVideoAlternate) {
      await runFfmpeg([
        "-y", "-loop", "1", "-i", alternateImagePath,
        "-t", "4", "-vf", "fps=30", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        alternateVideoPath
      ]);
    }
    return {
      ...scene,
      stockAlternates: [{
        imagePath: usesVideoAlternate ? undefined : alternateImagePath,
        videoPath: usesVideoAlternate ? alternateVideoPath : undefined,
        stockSource: {
          provider: "pexels" as const,
          assetId: `smoke-alternate-${scene.order + 1}`,
          mediaType: usesVideoAlternate ? "video" as const : "image" as const,
          query: scene.stockQuery ?? "documentary detail",
          pageUrl: "https://www.pexels.com/",
          author: "Remotion smoke",
          attribution: "Remotion multi-source smoke fixture",
          licenseUrl: "https://www.pexels.com/license/",
          downloadedAt: new Date(0).toISOString()
        }
      }]
    };
  }));
  await projects.update(created.id, {
    scenes: scenesWithAlternates,
    settings: {
      ...created.settings,
      music: { enabled: false, volume: 0 },
      assembly: {
        ...created.settings.assembly,
        montage: {
          enabled: true,
          planner: "local",
          density: "dynamic",
          graphicBeatPercent: 35,
          hardCutPercent: 78
        }
      }
    }
  });

  const logger = new TextFileLogger(join(temporaryRoot, "logs", "gold-work-studio-log.txt"));
  await logger.initialize();
  const renderLog = (level: "info" | "warn" | "error", message: string, details?: Record<string, unknown>) =>
    void logger.write(level, message, details);
  const renderer = new StandardRenderer(
    storage,
    new RemotionMontageRenderer((projectId) => storage.projectDirectory(projectId), { eventSink: renderLog }),
    renderLog
  );
  const pipeline = new MockGenerationPipeline(
    new MemoryTaskRepository(),
    projects,
    storage,
    renderer,
    DEFAULT_QUEUE_POLICY,
    (event) => void logger.write(event.level, event.message, event.details)
  );
  await pipeline.initialize();
  await pipeline.start(created.id);
  await pipeline.drain();
  await logger.flush();

  const completed = await projects.get(created.id);
  assert.equal(completed?.status, "complete");
  assert.ok(completed?.outputPath);
  assert.equal(completed?.lastRender?.engine, "remotion");
  assert.ok((completed?.lastRender?.visualBeatCount ?? 0) > scenes.length);
  assert.ok((completed?.lastRender?.templates.length ?? 0) >= 2);
  assert.ok(completed?.lastRender?.templates.includes("chapter-card"));
  assert.ok(completed?.lastRender?.templates.includes("quote-card"));
  assert.ok(completed?.lastRender?.templates.includes("checklist-grid"));
  assert.equal(completed?.lastRender?.stockVideoCount, 3, "all normalized alternate stock videos are reported");
  assert.equal(completed?.lastRender?.stockImageCount, 3, "all normalized alternate stock images are reported");
  assert.ok((await stat(completed.outputPath)).size > 10_000);
  assert.ok(await mediaDurationSeconds(completed.outputPath) > 5);
  const log = await readFile(logger.path, "utf8");
  assert.match(log, /render\.remotion\.completed/);
  assert.doesNotMatch(log, /render\.remotion\.fallback/);

  await mkdir(captureDirectory, { recursive: true });
  const captured = join(captureDirectory, "Final.mp4");
  await copyFile(completed.outputPath, captured);
  console.log(`[remotion-pipeline-smoke] OK ${captured}`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
