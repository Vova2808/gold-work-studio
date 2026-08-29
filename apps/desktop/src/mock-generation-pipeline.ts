import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createId, type ProjectService, type TaskRepository } from "@gold-work/core";
import { ttsLanguageCode, type LogLevel, type Project, type QueuePolicy, type QueueTask, type Scene, type TaskKind } from "@gold-work/shared";
import { LocalProjectStorage } from "./local-project-storage.js";
import { StandardRenderer } from "./standard-renderer.js";
import { AnyModelClient } from "./anymodel-client.js";
import { normalizeImageAspect } from "./media-utils.js";
import { VoicerClient } from "./voicer-client.js";
import { VeoClient } from "./veo-client.js";
import { cleanErrorMessage, isPermanentFailure } from "./google-errors.js";

/**
 * Финальный промпт кадра = сюжет сцены + единый стиль + формат + технические запреты.
 * Модель видит только эту строку, поэтому всё, что должно повторяться от сцены к сцене, живёт здесь.
 */
function buildImagePrompt(project: Project, scene: Scene): string {
  const framing = project.aspectRatio === "9:16"
    ? "Vertical 9:16 full-frame composition, subject centered, safe margins top and bottom"
    : project.aspectRatio === "1:1"
      ? "Square 1:1 composition, subject centered"
      : "Wide cinematic 16:9 composition, full widescreen framing, horizon respected";
  const style = project.settings.image.style.trim();
  const references = project.settings.image.references.filter((item) => item.trim().length > 0);
  return [
    scene.imagePrompt.trim(),
    style ? `Style: ${style}` : "",
    framing,
    references.length > 0 ? "Keep the character from the reference image identical: same face, hair, body type and clothing." : "",
    "High detail, natural lighting, professional photography or illustration quality.",
    "Strictly no text, no captions, no watermarks, no logos, no UI elements, no borders, no collage, no split frames."
  ].filter(Boolean).join("\n");
}

export const DEFAULT_QUEUE_POLICY: QueuePolicy = {
  concurrency: 4,
  maxAttempts: 3,
  retryDelaysMs: [1000, 3000]
};

const taskStep: Record<TaskKind, number> = {
  director: 18,
  speech: 14,
  image: 10,
  video: 6,
  assemble: 8
};

export interface PipelineLogEvent {
  level: LogLevel;
  message: string;
  details?: Record<string, unknown>;
}

export type PipelineEventSink = (event: PipelineLogEvent) => void;

export class MockGenerationPipeline {
  private tasks: QueueTask[] = [];
  private initialization?: Promise<void>;
  private mutation: Promise<void> = Promise.resolve();
  /** Реально выполняющиеся задачи (API-вызовы, FFmpeg) — работают вне мьютекса состояния. */
  private readonly executing = new Map<string, Promise<void>>();
  private readonly reportedTerminalRuns = new Set<string>();

  constructor(
    private readonly repository: TaskRepository,
    private readonly projects: ProjectService,
    private readonly storage: LocalProjectStorage,
    private readonly renderer: StandardRenderer,
    readonly policy: QueuePolicy = DEFAULT_QUEUE_POLICY,
    private readonly eventSink: PipelineEventSink = () => undefined,
    private readonly anyModel?: AnyModelClient,
    private readonly voicer?: VoicerClient,
    private readonly veo?: VeoClient
  ) {}

  async initialize(): Promise<void> {
    if (!this.initialization) {
      // При ошибке загрузки не кэшируем отказ навсегда — следующий вызов попробует снова.
      this.initialization = this.load().catch((error) => {
        this.initialization = undefined;
        throw error;
      });
    }
    await this.initialization;
  }

  async list(): Promise<QueueTask[]> {
    await this.initialize();
    return structuredClone(this.tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async start(projectId: string): Promise<QueueTask[]> {
    await this.initialize();
    return this.mutate(async () => {
      const project = await this.requireProject(projectId);
      await this.storage.ensureProject(project);
      if (project.scenes.length === 0) throw new Error("Сначала добавьте хотя бы одну сцену");

      const active = this.tasks.filter((task) =>
        task.projectId === projectId && ["pending", "running", "retry_wait", "paused"].includes(task.status)
      );
      if (active.length > 0) return structuredClone(active);

      this.tasks = this.tasks.filter((task) => task.projectId !== projectId);
      const now = new Date().toISOString();
      const runId = createId("run");
      const created: QueueTask[] = [];
      const images: QueueTask[] = [];

      for (const [index, scene] of project.scenes.entries()) {
        const imageDependencies: string[] = [];
        if (project.settings.voice.enabled) {
          const speech = this.makeTask(runId, project, scene, "speech", `Озвучка · сцена ${index + 1}`, [], now);
          created.push(speech);
          imageDependencies.push(speech.id); // сначала озвучка сцены, потом её картинка
        }

        const previousImage = images[index - 1];
        if (project.settings.image.sequential && previousImage) imageDependencies.push(previousImage.id);
        const image = this.makeTask(runId, project, scene, "image", `Изображение · сцена ${index + 1}`, imageDependencies, now);
        images.push(image);
        created.push(image);
      }

      if (project.settings.video.enabled) {
        // Процент анимации: видео делаем не для всех сцен, а равномерно по ролику (экономия квоты и денег).
        const percent = Math.min(100, Math.max(1, project.settings.video.animationPercent || 100));
        const step = 100 / percent;
        const animated = new Set<number>();
        for (let position = 0; position < project.scenes.length; position += step) animated.add(Math.floor(position));
        for (const [index, scene] of project.scenes.entries()) {
          if (!animated.has(index)) continue;
          const currentImage = images[index];
          if (!currentImage) continue;
          const nextImage = images[index + 1];
          const videoDependencies = [currentImage.id];
          if (project.settings.video.pairedFrames && nextImage) videoDependencies.push(nextImage.id);
          created.push(this.makeTask(runId, project, scene, "video", `AI-видео · сцена ${index + 1}`, videoDependencies, now));
        }
      }

      created.push(this.makeTask(runId, project, undefined, "assemble", "Сборка Final.mp4", created.map((task) => task.id), now));
      this.tasks.push(...created);
      await this.projects.mutate(projectId, (current) => ({
        status: "generating",
        outputPath: undefined,
        scenes: current.scenes.map((scene) => ({
          ...scene,
          status: "queued",
          imagePath: undefined,
          videoPath: undefined,
          audioPath: undefined
        }))
      }));
      await this.persist();
      this.emit("info", "queue.project.started", {
        projectId,
        runId,
        title: project.title,
        scenes: project.scenes.length,
        tasks: created.length,
        voiceProvider: project.settings.voice.enabled ? project.settings.voice.provider : "off",
        imageProvider: project.settings.image.provider,
        videoProvider: project.settings.video.enabled ? project.settings.video.provider : "off"
      });
      return this.forProject(projectId);
    });
  }

  /** Только пересборка Final.mp4 из готовых материалов — без перегенерации картинок и озвучки. */
  async assembleOnly(projectId: string): Promise<QueueTask[]> {
    await this.initialize();
    return this.mutate(async () => {
      const project = await this.requireProject(projectId);
      if (project.scenes.length === 0) throw new Error("В проекте нет сцен");
      const active = this.tasks.some((task) =>
        task.projectId === projectId && ["pending", "running", "retry_wait", "paused"].includes(task.status)
      );
      if (active) throw new Error("Сначала дождитесь завершения или остановите текущую очередь");
      const now = new Date().toISOString();
      const runId = createId("run");
      this.tasks = this.tasks.filter((task) => task.projectId !== projectId);
      const assemble = this.makeTask(runId, project, undefined, "assemble", "Пересборка Final.mp4", [], now);
      this.tasks.push(assemble);
      await this.projects.update(projectId, { status: "generating", outputPath: undefined });
      await this.persist();
      this.emit("info", "queue.project.reassemble", { projectId, runId });
      return this.forProject(projectId);
    });
  }

  async regenerateScene(projectId: string, sceneId: string | string[], target: "image" | "video" | "audio" | "all" = "all"): Promise<QueueTask[]> {
    await this.initialize();
    return this.mutate(async () => {
      if (!(["image", "video", "audio", "all"] as const).includes(target)) throw new Error("Неизвестный режим перегенерации");
      const project = await this.requireProject(projectId);
      const requestedIds = [...new Set(Array.isArray(sceneId) ? sceneId : [sceneId])];
      const selectedIds = new Set(requestedIds);
      const selectedScenes = project.scenes
        .filter((candidate) => selectedIds.has(candidate.id))
        .sort((left, right) => left.order - right.order);
      if (selectedScenes.length === 0 || selectedScenes.length !== requestedIds.length) throw new Error("Одна или несколько сцен не найдены");
      if (target === "video" && !project.settings.video.enabled) throw new Error("AI-видео отключено в настройках проекта");
      if (target === "audio" && !project.settings.voice.enabled) throw new Error("Озвучка отключена в настройках проекта");
      const projectTasks = this.tasks.filter((task) => task.projectId === projectId);
      if (projectTasks.some((task) => ["pending", "running", "retry_wait", "paused"].includes(task.status))) {
        throw new Error("Сначала дождитесь завершения или остановите текущую очередь");
      }

      const runId = createId("run");
      this.reportedTerminalRuns.delete(runId);
      const now = new Date().toISOString();
      // Запоминаем старые задачи сцены по типам: зависимости других сцен нужно перевязать на новые id.
      const oldSceneTaskIds = new Map<string, string>();
      for (const task of this.tasks) {
        if (task.projectId === projectId && task.sceneId && selectedIds.has(task.sceneId)) {
          oldSceneTaskIds.set(`${task.sceneId}:${task.kind}`, task.id);
        }
      }
      const replacedKinds = new Set<TaskKind>(target === "all"
        ? ["speech", "image", "video"]
        : target === "image" ? ["image"] : target === "video" ? ["video"] : ["speech"]);
      this.tasks = this.tasks.filter((task) =>
        task.projectId !== projectId || (task.kind !== "assemble" && (!task.sceneId || !selectedIds.has(task.sceneId) || !replacedKinds.has(task.kind)))
      );
      const remainingProjectTasks = this.tasks.filter((task) => task.projectId === projectId);
      const created: QueueTask[] = [];
      const findTask = (candidateId: string, kind: TaskKind) =>
        created.find((task) => task.sceneId === candidateId && task.kind === kind)
        ?? remainingProjectTasks.find((task) => task.sceneId === candidateId && task.kind === kind);

      // Сначала создаём озвучку и изображения всех выбранных сцен, чтобы последовательные зависимости были полными.
      for (const scene of selectedScenes) {
        const imageDependencies: string[] = [];
        if ((target === "all" || target === "audio") && project.settings.voice.enabled) {
          const speech = this.makeTask(runId, project, scene, "speech", `Озвучка · сцена ${scene.order + 1}`, [], now);
          created.push(speech);
          imageDependencies.push(speech.id);
        }
        if (target === "all" || target === "image") {
          const previousScene = project.scenes.find((candidate) => candidate.order === scene.order - 1);
          const previousImage = project.settings.image.sequential && previousScene ? findTask(previousScene.id, "image") : undefined;
          if (previousImage) imageDependencies.push(previousImage.id);
          created.push(this.makeTask(runId, project, scene, "image", `Изображение · сцена ${scene.order + 1}`, imageDependencies, now));
        }
      }
      for (const scene of selectedScenes) {
        if (!((target === "all" || target === "video") && project.settings.video.enabled)) continue;
        const nextScene = project.scenes.find((candidate) => candidate.order === scene.order + 1);
        const nextImage = project.settings.video.pairedFrames && nextScene
          ? findTask(nextScene.id, "image")
          : undefined;
        const currentImage = findTask(scene.id, "image");
        created.push(
          this.makeTask(
            runId,
            project,
            scene,
            "video",
            `AI-видео · сцена ${scene.order + 1}`,
            [...(currentImage ? [currentImage.id] : []), ...(nextImage ? [nextImage.id] : [])],
            now
          )
        );
      }
      this.tasks.push(...created);
      // Перевязываем зависимости остальных задач со старых id сцены на новые (sequential-картинки, парные кадры)
      // и возвращаем «заблокированные» задачи в очередь — их блокировала удалённая упавшая задача.
      const replacedIds = new Map<string, string>();
      for (const task of created) {
        const oldId = task.sceneId ? oldSceneTaskIds.get(`${task.sceneId}:${task.kind}`) : undefined;
        if (oldId) replacedIds.set(oldId, task.id);
      }
      for (const task of this.tasks) {
        if (task.projectId !== projectId) continue;
        const hadReplacedDependency = task.dependsOn.some((id) => replacedIds.has(id));
        task.dependsOn = task.dependsOn.map((id) => replacedIds.get(id) ?? id);
        if (hadReplacedDependency && task.status === "blocked") {
          task.status = "pending";
          task.error = undefined;
          task.updatedAt = now;
        }
      }
      if (target !== "audio") {
        const assembleDependencies = this.tasks
          .filter((task) => task.projectId === projectId && task.runId === runId && task.kind !== "assemble")
          .map((task) => task.id);
        this.tasks.push(
          this.makeTask(runId, project, undefined, "assemble", `Пересборка Final.mp4 после ${selectedScenes.length === 1 ? "сцены" : `${selectedScenes.length} сцен`}`, assembleDependencies, now)
        );
      }
      await this.projects.mutate(projectId, (current) => ({
        status: "generating",
        // Любое изменение исходников делает прежний Final.mp4 устаревшим. Живой таймлайн
        // показывает новый звук сразу, а экспорт появится только после явной пересборки.
        outputPath: undefined,
        scenes: current.scenes.map((candidate) =>
          selectedIds.has(candidate.id)
            ? {
                ...candidate,
                status: "queued",
                imagePath: target === "all" || target === "image" ? undefined : candidate.imagePath,
                videoPath: target === "all" || target === "video" ? undefined : candidate.videoPath,
                audioPath: target === "all" || target === "audio" ? undefined : candidate.audioPath
              }
            : candidate
        )
      }));
      await this.storage.ensureProject(await this.requireProject(projectId));
      await this.persist();
      this.emit("info", "queue.scene.regeneration.started", { projectId, sceneIds: requestedIds, scenes: requestedIds.length, runId, target });
      return this.forProject(projectId);
    });
  }

  async pause(projectId: string): Promise<QueueTask[]> {
    await this.initialize();
    return this.mutate(async () => {
      const now = new Date().toISOString();
      let changed = false;
      for (const task of this.tasks) {
        if (task.projectId === projectId && (task.status === "pending" || task.status === "running" || task.status === "retry_wait")) {
          task.pausedFrom = task.status;
          task.status = "paused";
          task.updatedAt = now;
          changed = true;
        }
      }
      if (!changed) {
        await this.syncProjects();
        return this.forProject(projectId);
      }
      await this.projects.update(projectId, { status: "paused" });
      await this.persist();
      this.emit("info", "queue.project.paused", { projectId });
      return this.forProject(projectId);
    });
  }

  async resume(projectId: string): Promise<QueueTask[]> {
    await this.initialize();
    return this.mutate(async () => {
      const now = new Date().toISOString();
      let changed = false;
      for (const task of this.tasks) {
        if (task.projectId === projectId && task.status === "paused") {
          // Если реальное выполнение всё ещё идёт (пауза не прерывает начатый API-вызов) — возвращаем в running.
          const inFlight = this.executing.has(task.id);
          task.status = task.pausedFrom === "retry_wait" ? "retry_wait" : inFlight ? "running" : "pending";
          if (task.pausedFrom !== "running" || inFlight) task.pausedFrom = undefined;
          task.updatedAt = now;
          changed = true;
        }
      }
      if (!changed) {
        await this.syncProjects();
        return this.forProject(projectId);
      }
      await this.projects.update(projectId, { status: "generating" });
      await this.persist();
      this.emit("info", "queue.project.resumed", { projectId });
      return this.forProject(projectId);
    });
  }

  async stop(projectId: string): Promise<QueueTask[]> {
    await this.initialize();
    return this.mutate(async () => {
      const now = new Date().toISOString();
      let changed = false;
      for (const task of this.tasks) {
        if (task.projectId === projectId && ["pending", "running", "retry_wait", "paused", "blocked"].includes(task.status)) {
          task.status = "cancelled";
          task.pausedFrom = undefined;
          task.nextAttemptAt = undefined;
          task.updatedAt = now;
          changed = true;
        }
      }
      if (!changed) {
        await this.syncProjects();
        return this.forProject(projectId);
      }
      await this.projects.mutate(projectId, (project) => ({
        status: "failed",
        scenes: project.scenes.map((scene) =>
          scene.status === "ready" ? scene : { ...scene, status: "failed" }
        )
      }));
      await this.persist();
      this.emit("warn", "queue.project.stopped", { projectId });
      await this.syncProjects();
      return this.forProject(projectId);
    });
  }

  async retry(taskId: string): Promise<QueueTask> {
    await this.initialize();
    return this.mutate(async () => {
      const task = this.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw new Error(`Задача ${taskId} не найдена`);
      if (task.status === "cancelled") throw new Error("Остановленный проект нужно запустить заново");
      if (task.status !== "failed") return structuredClone(task);
      const project = await this.requireProject(task.projectId);
      const runSceneIds = new Set(this.tasks.filter((candidate) => candidate.runId === task.runId && candidate.sceneId).map((candidate) => candidate.sceneId as string));
      if (runSceneIds.size !== project.scenes.length || project.scenes.some((scene) => !runSceneIds.has(scene.id))) {
        throw new Error("Состав сцен изменился. Запустите генерацию проекта заново.");
      }
      this.reportedTerminalRuns.delete(task.runId);
      task.status = "pending";
      task.progress = 0;
      task.attempts = 0;
      task.error = undefined;
      task.nextAttemptAt = undefined;
      task.pausedFrom = undefined;
      task.updatedAt = new Date().toISOString();
      let unblocked = true;
      while (unblocked) {
        unblocked = false;
        for (const dependent of this.tasks) {
          if (dependent.runId !== task.runId || dependent.status !== "blocked") continue;
          const dependencies = dependent.dependsOn.map((id) => this.tasks.find((candidate) => candidate.id === id));
          if (dependencies.some((dependency) => dependency && ["failed", "cancelled", "blocked"].includes(dependency.status))) continue;
          dependent.status = "pending";
          dependent.error = undefined;
          dependent.updatedAt = task.updatedAt;
          unblocked = true;
        }
      }
      await this.projects.update(task.projectId, { status: "generating" });
      await this.persist();
      this.emit("info", "queue.task.manual_retry", {
        projectId: task.projectId,
        taskId: task.id,
        kind: task.kind
      });
      return structuredClone(task);
    });
  }

  async clearFinished(): Promise<QueueTask[]> {
    await this.initialize();
    return this.mutate(async () => {
      const runIds = [...new Set(this.tasks.map((task) => task.runId))];
      const removableRuns = new Set(runIds.filter((runId) => {
        const runTasks = this.tasks.filter((task) => task.runId === runId);
        return runTasks.length > 0 && runTasks.every((task) => task.status === "done" || task.status === "cancelled");
      }));
      this.tasks = this.tasks.filter((task) => !removableRuns.has(task.runId));
      await this.persist();
      this.emit("info", "queue.finished_runs.cleared", { runs: removableRuns.size });
      return structuredClone(this.tasks);
    });
  }

  async removeProject(projectId: string): Promise<void> {
    await this.initialize();
    await this.mutate(async () => {
      this.tasks = this.tasks.filter((task) => task.projectId !== projectId);
      await this.persist();
    });
  }

  async tick(): Promise<void> {
    await this.initialize();
    await this.mutate(async () => {
      const now = new Date().toISOString();
      const nowTime = Date.now();
      let changed = false;

      for (const task of this.tasks) {
        if (task.status === "retry_wait" && (!task.nextAttemptAt || Date.parse(task.nextAttemptAt) <= nowTime)) {
          task.status = "pending";
          task.nextAttemptAt = undefined;
          task.updatedAt = now;
          changed = true;
          this.emit("info", "queue.task.retry_ready", this.taskDetails(task));
        }
      }

      // Реальная работа идёт в beginExecution вне мьютекса; здесь только «сердцебиение» прогресса до 90%,
      // остальные 10% задача получает в момент фактического завершения.
      for (const task of this.tasks.filter((candidate) => candidate.status === "running")) {
        if (task.progress < 90) {
          task.progress = Math.min(90, task.progress + taskStep[task.kind]);
          task.updatedAt = now;
          changed = true;
        }
      }

      let running = this.tasks.filter((task) => task.status === "running").length;
      // Видео — дорогой long-running запрос с низкой RPM-квотой. Пускаем по одной сцене,
      // а картинки и озвучку по-прежнему обрабатываем параллельно.
      let videoRunning = this.tasks.some((task) => task.status === "running" && task.kind === "video");
      for (const task of this.tasks) {
        if (running >= this.policy.concurrency) break;
        if (task.status !== "pending") continue;
        if (task.kind === "video" && videoRunning) continue;
        const dependencies = task.dependsOn.map((id) => this.tasks.find((candidate) => candidate.id === id));
        if (dependencies.some((dependency) => dependency?.status === "failed" || dependency?.status === "cancelled" || dependency?.status === "blocked")) {
          task.status = "blocked";
          task.error = "Не выполнена предыдущая задача";
          task.updatedAt = now;
          changed = true;
          this.emit("warn", "queue.task.blocked", {
            ...this.taskDetails(task),
            blockedByTaskIds: dependencies.filter((dependency) => dependency && ["failed", "cancelled", "blocked"].includes(dependency.status)).map((dependency) => dependency!.id)
          });
          continue;
        }
        if (!dependencies.every((dependency) => dependency?.status === "done")) continue;
        task.status = "running";
        if (task.pausedFrom !== "running") task.attempts += 1;
        task.pausedFrom = undefined;
        task.updatedAt = now;
        running += 1;
        if (task.kind === "video") videoRunning = true;
        changed = true;
        this.emit("info", "queue.task.started", this.taskDetails(task));
        this.beginExecution(task);
      }

      if (changed) {
        await this.persist();
        await this.syncProjects();
      }
    });
  }

  /** Запускает реальное выполнение задачи вне мьютекса: очередь остаётся отзывчивой, задачи идут параллельно. */
  private beginExecution(task: QueueTask): void {
    if (this.executing.has(task.id)) return;
    const snapshot = structuredClone(task);
    const work = (async () => {
      let resultPath: string | undefined;
      let failure: unknown;
      try {
        if (await this.shouldSimulateFailure(snapshot)) throw new Error("Тестовая ошибка провайдера ([FAIL])");
        resultPath = await this.executeTask(snapshot);
      } catch (error) {
        failure = error;
      }
      await this.mutate(async () => {
        const current = this.tasks.find((candidate) => candidate.id === snapshot.id);
        if (!current || current.status === "cancelled") return;
        const nowTime = Date.now();
        current.updatedAt = new Date(nowTime).toISOString();
        if (failure === undefined) {
          current.resultPath = resultPath;
          current.status = "done";
          current.progress = 100;
          current.error = undefined;
          current.nextAttemptAt = undefined;
          current.pausedFrom = undefined;
          this.emit("info", "queue.task.completed", this.taskDetails(current));
        } else if (current.status === "paused") {
          // Пауза важнее ретрая: сбой запомним, но продолжение — только по кнопке пользователя.
          current.progress = 0;
          current.error = failure instanceof Error ? failure.message : String(failure);
          current.pausedFrom = "pending";
          current.nextAttemptAt = undefined;
          this.emit("warn", "queue.task.failed_while_paused", this.taskDetails(current));
        } else {
          this.scheduleFailure(current, failure, nowTime);
        }
        await this.persist();
        await this.syncProjects();
      });
    })();
    this.executing.set(task.id, work.catch(() => undefined).finally(() => {
      this.executing.delete(task.id);
    }));
  }

  /** Для тестов и отладки: доводит очередь до состояния без активных задач. */
  async drain(maxIterations = 1000): Promise<void> {
    await this.initialize();
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      await this.tick();
      const inFlight = [...this.executing.values()];
      if (inFlight.length > 0) {
        await Promise.all(inFlight);
        continue;
      }
      const active = this.tasks.some((task) => ["pending", "running", "retry_wait"].includes(task.status));
      if (!active) return;
      await new Promise((resolve) => setTimeout(resolve, 50)); // ждём retry_wait
    }
    throw new Error("drain: очередь не завершилась за отведённые итерации");
  }

  private async load(): Promise<void> {
    const loaded = await this.repository.list();
    const now = new Date().toISOString();
    const legacyRuns = new Map<string, string>();
    this.tasks = loaded.map((task) => ({
      ...task,
      runId: task.runId || legacyRuns.get(task.projectId) || (() => {
        const runId = createId("run");
        legacyRuns.set(task.projectId, runId);
        return runId;
      })(),
      label: task.label || task.kind,
      // При перезапуске незавершённые задачи ставим на ПАУЗУ — прогресс сохранён,
      // но генерация не возобновляется сама, только по кнопке пользователя.
      status: task.status === "pending" || task.status === "running" || task.status === "retry_wait" ? "paused" : task.status,
      pausedFrom: task.status === "running" ? "running"
        : task.status === "pending" ? "pending"
        : task.status === "retry_wait" ? "retry_wait"
        : task.pausedFrom,
      dependsOn: task.dependsOn ?? [],
      createdAt: task.createdAt ?? now,
      updatedAt: task.updatedAt ?? now,
      maxAttempts: task.maxAttempts || this.policy.maxAttempts
    }));
    for (const runId of new Set(this.tasks.map((task) => task.runId))) {
      const runTasks = this.tasks.filter((task) => task.runId === runId);
      if (runTasks.length > 0 && runTasks.every((task) => ["done", "failed", "blocked", "cancelled"].includes(task.status))) {
        this.reportedTerminalRuns.add(runId);
      }
    }
    await this.persist();
    await this.syncProjects();
    const restoredPaused = this.tasks.filter((task) => task.status === "paused");
    if (restoredPaused.length > 0) {
      this.emit("warn", "queue.restored_paused", {
        tasks: restoredPaused.length,
        projects: new Set(restoredPaused.map((task) => task.projectId)).size
      });
    }
  }

  private makeTask(
    runId: string,
    project: Project,
    scene: Scene | undefined,
    kind: TaskKind,
    label: string,
    dependsOn: string[],
    now: string
  ): QueueTask {
    return {
      id: createId("task"),
      runId,
      projectId: project.id,
      sceneId: scene?.id,
      kind,
      label,
      status: "pending",
      attempts: 0,
      maxAttempts: this.policy.maxAttempts,
      progress: 0,
      dependsOn,
      createdAt: now,
      updatedAt: now
    };
  }

  private async shouldSimulateFailure(task: QueueTask): Promise<boolean> {
    if (!task.sceneId || task.kind === "speech" || task.kind === "assemble") return false;
    const project = await this.projects.get(task.projectId);
    const scene = project?.scenes.find((candidate) => candidate.id === task.sceneId);
    return Boolean(scene && `${scene.imagePrompt}\n${scene.animationPrompt}`.includes("[FAIL]"));
  }

  private async executeTask(task: QueueTask): Promise<string> {
    const project = await this.requireProject(task.projectId);
    await this.storage.ensureProject(project);
    if (task.kind === "assemble") {
      this.emit("info", "queue.task.stage", { ...this.taskDetails(task), stage: "FFmpeg: собираю и кодирую Final.mp4" });
      return this.renderer.render(project);
    }
    if (task.kind === "director") return `local://${project.id}/scenario.json`;
    const scene = project.scenes.find((candidate) => candidate.id === task.sceneId);
    if (!scene) throw new Error("Сцена для задачи не найдена");
    if (task.kind === "image") {
      if (this.anyModel && (await this.anyModel.configured()) && scene.imagePrompt.trim().length > 0) {
        this.emit("debug", "queue.task.stage", { ...this.taskDetails(task), stage: "Отправляю изображение провайдеру" });
        // Размеры, которые принимает шлюз AnyModel (Gemini сам приводит к родным 16:9/9:16/1:1).
        const size = project.aspectRatio === "9:16" ? "1080x1920" : project.aspectRatio === "1:1" ? "1024x1024" : "1920x1080";
        const prompt = buildImagePrompt(project, scene);
        // С референсами клиент сам переключится на модель с поддержкой опорных изображений (gpt-image).
        const references = project.settings.image.references.filter((ref) => ref.trim().length > 0);
        const raw = await this.anyModel.generateImage(prompt, size, references);
        // Кадр всегда приводим к формату проекта: у GPT Image нет 16:9, он отдаёт 3:2 и кадр выглядит квадратным.
        const framed = await normalizeImageAspect(raw, project.aspectRatio);
        return this.storage.saveGeneratedImage(project, scene, framed);
      }
      this.emit("warn", "queue.task.placeholder_used", {
        ...this.taskDetails(task),
        reason: scene.imagePrompt.trim().length === 0 ? "пустой промпт изображения" : "AnyModel не настроен"
      });
      return this.storage.createPlaceholderImage(project, scene);
    }
    if (task.kind === "speech") {
      // Провайдер "elevenlabs" = Voicer API: голос задаётся шаблоном (uuid в settings.voice.voice).
      if (project.settings.voice.provider === "elevenlabs" && scene.narration.trim().length > 0) {
        this.emit("debug", "queue.task.stage", { ...this.taskDetails(task), stage: "Генерирую озвучку через Lumean" });
        if (!this.voicer || !(await this.voicer.configured())) {
          throw new Error("В проекте выбран движок Lumean, но он не настроен. Добавьте ключ в Настройки → AI и сценарии или переключите движок озвучки.");
        }
        const templateUuid = project.settings.voice.voice?.trim() || undefined;
        const audio = await this.voicer.tts(scene.narration, templateUuid);
        return this.storage.saveGeneratedAudio(project, scene, audio);
      }
      if (this.anyModel && (await this.anyModel.configured()) && scene.narration.trim().length > 0) {
        this.emit("debug", "queue.task.stage", { ...this.taskDetails(task), stage: "Генерирую озвучку через AnyModel" });
        // Голос из настроек проекта важнее глобального; "custom" и пустое значение = глобальная настройка.
        const projectVoice = project.settings.voice.voice?.trim();
        const voiceOverride = projectVoice && projectVoice !== "custom" ? projectVoice : undefined;
        const audio = await this.anyModel.textToSpeech(scene.narration, ttsLanguageCode(project.language), voiceOverride);
        return this.storage.saveGeneratedAudio(project, scene, audio);
      }
      this.emit("warn", "queue.task.placeholder_used", {
        ...this.taskDetails(task),
        reason: scene.narration.trim().length === 0 ? "пустой текст озвучки" : "AnyModel не настроен"
      });
      return this.storage.createPlaceholderAudio(project, scene);
    }
    if (task.kind === "video" && project.settings.video.provider === "veo") {
      if (!this.veo || !(await this.veo.configured())) {
        throw new Error("Движок Veo не настроен — добавьте ключ Google AI Studio в Настройки → AI и сценарии");
      }
      // Переключатель «Анимация от первого кадра» действует одинаково для обоих движков.
      const startFrame = project.settings.video.startFrame && scene.imagePath
        ? await readFile(scene.imagePath).catch(() => undefined)
        : undefined;
      const prompt = scene.animationPrompt?.trim() || scene.imagePrompt;
      try {
        this.emit("info", "queue.task.stage", { ...this.taskDetails(task), stage: "Veo: запрос отправлен, ожидаю готовое видео" });
        return this.storage.saveGeneratedVideo(project, scene, await this.veo.generateVideo(prompt, project.aspectRatio, startFrame));
      } catch (error) {
        // Модель видео недоступна (нет биллинга) — не роняем весь ролик: сцена собирается из кадра
        // с движением камеры. Пользователь получает готовый Final.mp4 и предупреждение в журнале.
        const message = error instanceof Error ? error.message : String(error);
        if (!isPermanentFailure(message)) throw error;
        this.emit("warn", "queue.task.video_fallback", {
          ...this.taskDetails(task),
          reason: cleanErrorMessage(message)
        });
        return this.renderer.renderScene(project, scene);
      }
    }
    if (task.kind === "video" && project.settings.video.provider === "anymodel-video") {
      if (!this.anyModel || !(await this.anyModel.configured())) throw new Error("AnyModel не настроен");
      this.emit("info", "queue.task.stage", { ...this.taskDetails(task), stage: "AnyModel: генерирую AI-видео" });
      const startFrame = project.settings.video.startFrame && scene.imagePath
        ? await readFile(scene.imagePath).catch(() => undefined)
        : undefined;
      return this.storage.saveGeneratedVideo(project, scene, await this.anyModel.generateVideo(scene.animationPrompt, scene.durationSeconds, project.aspectRatio, startFrame));
    }
    if (task.kind === "video") return this.renderer.renderScene(project, scene);
    throw new Error(`Неизвестный тип задачи: ${task.kind}`);
  }

  private scheduleFailure(task: QueueTask, error: unknown, nowTime: number): void {
    const raw = error instanceof Error ? error.message : String(error);
    task.progress = 0;
    task.error = cleanErrorMessage(raw);
    // Нет доступа к модели — повтор даст ту же ошибку. 12 сцен × 3 попытки = 36 бессмысленных запросов.
    if (isPermanentFailure(raw)) {
      task.attempts = task.maxAttempts;
      task.status = "failed";
      task.nextAttemptAt = undefined;
      this.emit("error", "queue.task.failed_permanently", this.taskDetails(task));
      return;
    }
    if (task.attempts < task.maxAttempts) {
      const policyDelay = this.policy.retryDelaysMs[
        Math.min(task.attempts - 1, this.policy.retryDelaysMs.length - 1)
      ] ?? 1000;
      // Google пишет точное время в 429: "Please retry in 38.7s". Ранний повтор только
      // снова расходует попытку, поэтому ждём указанное время (+1 секунда запаса).
      const retrySeconds = /retry in\s+([\d.]+)s/i.exec(raw)?.[1];
      const providerDelay = retrySeconds ? (Math.ceil(Number(retrySeconds)) + 1) * 1000 : 0;
      const delay = Math.max(policyDelay, Number.isFinite(providerDelay) ? providerDelay : 0);
      task.status = "retry_wait";
      task.nextAttemptAt = new Date(nowTime + delay).toISOString();
      this.emit("warn", "queue.task.retry_scheduled", this.taskDetails(task));
    } else {
      task.status = "failed";
      task.nextAttemptAt = undefined;
      this.emit("error", "queue.task.failed", this.taskDetails(task));
    }
  }

  private taskDetails(task: QueueTask): Record<string, unknown> {
    return {
      runId: task.runId,
      projectId: task.projectId,
      sceneId: task.sceneId,
      taskId: task.id,
      label: task.label,
      kind: task.kind,
      status: task.status,
      attempts: task.attempts,
      maxAttempts: task.maxAttempts,
      nextAttemptAt: task.nextAttemptAt,
      error: task.error ? cleanErrorMessage(task.error).slice(0, 500) : undefined,
      resultFile: task.resultPath ? basename(task.resultPath) : undefined
    };
  }

  private emit(level: LogLevel, message: string, details?: Record<string, unknown>): void {
    this.eventSink({ level, message, details });
  }

  private async syncProjects(): Promise<void> {
    const projectIds = [...new Set(this.tasks.map((task) => task.projectId))];
    for (const projectId of projectIds) {
      const tasks = this.tasks.filter((task) => task.projectId === projectId);
      if (tasks.length === 0) continue;
      try {
        await this.projects.mutate(projectId, (project) => {
          const trackedSceneIds = new Set(tasks.filter((task) => task.sceneId).map((task) => task.sceneId as string));
          // Ран без сценных задач (пересборка Final.mp4): статус считаем только по assemble, сцены не трогаем.
          if (trackedSceneIds.size === 0) {
            const assembleTask = tasks.find((task) => task.kind === "assemble");
            const assembleStatus = assembleTask?.status === "done"
              ? "complete" as const
              : assembleTask && ["failed", "blocked", "cancelled"].includes(assembleTask.status)
                ? "failed" as const
                : "generating" as const;
            return {
              status: assembleStatus,
              outputPath: assembleStatus === "complete" ? assembleTask?.resultPath : project.outputPath
            };
          }
          const hasSceneGraphMismatch = trackedSceneIds.size !== project.scenes.length || project.scenes.some((scene) => !trackedSceneIds.has(scene.id));
          const audioOnly = tasks.every((task) => task.kind === "speech");
          const isPartialRegeneration = tasks.some((task) => task.kind === "assemble" && task.label.startsWith("Пересборка Final.mp4 после"))
            || audioOnly;
          const projectStatus = hasSceneGraphMismatch && !isPartialRegeneration
            ? "failed"
            : tasks.every((task) => task.status === "done")
              ? audioOnly ? "ready" : "complete"
              : tasks.some((task) => task.status === "failed" || task.status === "blocked" || task.status === "cancelled")
                ? "failed"
                : tasks.every((task) => task.status === "paused" || task.status === "done")
                  ? "paused"
                  : "generating";
          const scenes = project.scenes.map((scene) => {
            const sceneTasks = tasks.filter((task) => task.sceneId === scene.id);
            if (sceneTasks.length === 0) return isPartialRegeneration ? scene : { ...scene, status: "failed" as const };
            const imageTask = sceneTasks.find((task) => task.kind === "image" && task.status === "done");
            const videoTask = sceneTasks.find((task) => task.kind === "video" && task.status === "done");
            const speechTask = sceneTasks.find((task) => task.kind === "speech" && task.status === "done");
            const status = sceneTasks.some((task) => task.status === "failed" || task.status === "blocked" || task.status === "cancelled")
              ? "failed"
              : sceneTasks.every((task) => task.status === "done")
                ? "ready"
                : sceneTasks.some((task) => task.status === "running")
                  ? "generating"
                  : "queued";
            return {
              ...scene,
              status,
              imagePath: imageTask?.resultPath ?? scene.imagePath,
              videoPath: videoTask?.resultPath ?? scene.videoPath,
              audioPath: speechTask?.resultPath ?? scene.audioPath
            } satisfies Scene;
          });
          const finalTask = tasks.find((task) => task.kind === "assemble" && task.status === "done");
          return {
            status: projectStatus,
            scenes,
            outputPath: projectStatus === "complete" ? finalTask?.resultPath ?? project.outputPath : undefined
          };
        });
        for (const runId of new Set(tasks.map((task) => task.runId))) {
          const runTasks = tasks.filter((task) => task.runId === runId);
          const terminal = runTasks.every((task) => ["done", "failed", "blocked", "cancelled"].includes(task.status));
          if (!terminal || this.reportedTerminalRuns.has(runId)) continue;
          this.reportedTerminalRuns.add(runId);
          const failed = runTasks.filter((task) => ["failed", "blocked"].includes(task.status)).length;
          const cancelled = runTasks.filter((task) => task.status === "cancelled").length;
          const message = failed > 0 ? "queue.run.failed" : cancelled > 0 ? "queue.run.cancelled" : "queue.run.completed";
          this.emit(failed > 0 ? "error" : cancelled > 0 ? "warn" : "info", message, {
            projectId,
            runId,
            tasks: runTasks.length,
            completed: runTasks.filter((task) => task.status === "done").length,
            failed,
            cancelled
          });
        }
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("не найден")) throw error;
      }
    }
  }

  private async requireProject(projectId: string): Promise<Project> {
    const project = await this.projects.get(projectId);
    if (!project) throw new Error(`Проект ${projectId} не найден`);
    return project;
  }

  private forProject(projectId: string): QueueTask[] {
    return structuredClone(this.tasks.filter((task) => task.projectId === projectId));
  }

  private async persist(): Promise<void> {
    await this.repository.replace(this.tasks);
  }

  private async mutate<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.mutation;
    let release: () => void = () => undefined;
    this.mutation = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }
}
