import {
  createDefaultProjectSettings,
  type CreateProjectInput,
  type DesktopApi,
  type Project,
  type QueueTask,
  type ReferenceAnalysis,
  type Scene,
  type TaskKind,
  type UpdateProjectInput
} from "@gold-work/shared";

const createId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const clone = <T,>(value: T): T => structuredClone(value);
let projects: Project[] = [];
let tasks: QueueTask[] = [];
let anyModelSettings = { configured: false, baseUrl: "https://anymodel.org/v1", textModel: "cc/claude-sonnet-4-6", imageModel: "gpt-image-2", videoModel: "xai/grok-imagine-video" };

function demoScenes(topic: string): Scene[] {
  return ["Завязка", "Главная мысль", "Финал"].map((title, order) => ({
    id: createId("scene"),
    order,
    title,
    narration: `${title}. Демонстрационный текст для темы «${topic}».`,
    imagePrompt: `${topic}. ${title}. Семейная 3D-анимация, кинематографичный свет`,
    animationPrompt: "Плавное движение камеры и естественная анимация персонажей",
    durationSeconds: 8,
    status: "draft"
  }));
}

function analyzeReference(url: string, instructions = ""): ReferenceAnalysis {
  const parsed = new URL(url);
  const hook = "Ты уверен, что делаешь всё правильно? Одна деталь полностью меняет результат.";
  const titles = ["Хук", "Обещание", "Контекст", "Неожиданный поворот", "Практическое решение", "Финал"];
  const scenes = titles.map((title, order) => ({
    id: createId("scene"),
    order,
    title,
    narration: order === 0 ? hook : `${title}. Самостоятельная улучшенная часть ролика по мотивам структуры референса.`,
    imagePrompt: `${title}. Выразительный кадр для YouTube, единый визуальный стиль, без копирования брендинга референса`,
    animationPrompt: "Динамичное движение камеры и визуальный акцент на главной мысли",
    durationSeconds: 10,
    status: "draft" as const
  }));
  return {
    sourceUrl: parsed.toString(),
    sourceTitle: `Референс с ${parsed.hostname.replace(/^www\./, "")}`,
    niche: "Развлекательный или образовательный YouTube-контент",
    targetAudience: "Зрители 18–44 лет, которым нужен быстрый понятный результат",
    hook,
    structure: ["0–5 сек: хук", "5–15 сек: обещание", "Проблема → поворот → решение", "Вывод и следующий шаг"],
    strengths: ["Понятная тема", "Хорошая основа для серии"],
    improvements: ["Усилить первый кадр", "Убрать длинное вступление", "Менять визуальный акцент каждые 5–8 секунд"],
    suggestedAngle: instructions || "Сделать самостоятельный ролик в той же нише с более сильным удержанием",
    suggestedTitle: "Главная ошибка, которая мешает получить результат",
    recommendedDurationSeconds: 60,
    language: "Русский",
    instructions,
    scenes,
    provider: "mock-director"
  };
}

function makeProject(input: CreateProjectInput, withScenes: boolean): Project {
  const now = new Date().toISOString();
  const scenes = withScenes ? demoScenes(input.topic) : [];
  const settings = createDefaultProjectSettings();
  settings.video.enabled = input.mode === "pro";
  settings.assembly.kenBurns = input.mode === "standard";
  settings.assembly.fadeTransitions = input.mode === "standard";
  return {
    id: createId("project"),
    ...input,
    status: scenes.length ? "ready" : "draft",
    createdAt: now,
    updatedAt: now,
    scenes,
    settings
  };
}

function makeTask(runId: string, projectId: string, sceneId: string | undefined, kind: TaskKind, label: string, dependsOn: string[]): QueueTask {
  const now = new Date().toISOString();
  return {
    id: createId("task"),
    runId,
    projectId,
    sceneId,
    kind,
    label,
    status: "pending",
    attempts: 0,
    maxAttempts: 3,
    progress: 0,
    dependsOn,
    createdAt: now,
    updatedAt: now
  };
}

function advanceQueue(): void {
  const now = new Date().toISOString();
  for (const task of tasks.filter((candidate) => candidate.status === "running")) {
    task.progress = Math.min(100, task.progress + (task.kind === "video" ? 9 : 18));
    task.updatedAt = now;
    if (task.progress === 100) {
      task.status = "done";
      task.resultPath = `mock://${task.projectId}/${task.sceneId ?? "final"}/${task.kind}`;
    }
  }
  let running = tasks.filter((task) => task.status === "running").length;
  for (const task of tasks) {
    if (running >= 4) break;
    if (task.status !== "pending") continue;
    const dependenciesReady = task.dependsOn.every((id) => tasks.find((candidate) => candidate.id === id)?.status === "done");
    if (!dependenciesReady) continue;
    task.status = "running";
    task.attempts += 1;
    task.updatedAt = now;
    running += 1;
  }

  for (const project of projects) {
    const projectTasks = tasks.filter((task) => task.projectId === project.id);
    if (projectTasks.length === 0) continue;
    project.scenes = project.scenes.map((scene) => {
      const sceneTasks = projectTasks.filter((task) => task.sceneId === scene.id);
      const image = sceneTasks.find((task) => task.kind === "image" && task.status === "done")?.resultPath;
      const video = sceneTasks.find((task) => task.kind === "video" && task.status === "done")?.resultPath;
      const audio = sceneTasks.find((task) => task.kind === "speech" && task.status === "done")?.resultPath;
      const status = sceneTasks.length > 0 && sceneTasks.every((task) => task.status === "done")
        ? "ready"
        : sceneTasks.some((task) => task.status === "running") ? "generating" : scene.status;
      return { ...scene, status, imagePath: image ?? scene.imagePath, videoPath: video ?? scene.videoPath, audioPath: audio ?? scene.audioPath };
    });
    if (projectTasks.every((task) => task.status === "done")) {
      project.status = "complete";
      project.outputPath = `mock://${project.id}/Final.mp4`;
    } else if (projectTasks.some((task) => task.status === "running")) {
      project.status = "generating";
    }
  }
}

function requireProject(id: string): Project {
  const project = projects.find((candidate) => candidate.id === id);
  if (!project) throw new Error("Проект не найден");
  return project;
}

export const fallbackApi: DesktopApi = {
  async listProjects() {
    return clone(projects).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async getProject(id) {
    const project = projects.find((candidate) => candidate.id === id);
    return project ? clone(project) : undefined;
  },
  async createProject(input) {
    const project = makeProject(input, false);
    projects.unshift(project);
    return clone(project);
  },
  async createDemoProject() {
    const project = makeProject({
      title: "Барсик — космический кот",
      topic: "Семейный мультфильм о приключении ленивого кота в космосе",
      aspectRatio: "16:9",
      language: "Русский",
      mode: "standard"
    }, true);
    projects.unshift(project);
    return clone(project);
  },
  async analyzeReference(input) {
    try {
      return clone(analyzeReference(input.url, input.instructions));
    } catch {
      throw new Error("Укажите полную ссылку на ролик");
    }
  },
  async refineReferenceAnalysis(analysis, instructions) {
    const hook = instructions.toLowerCase().includes("хук")
      ? "Ты уверен, что делаешь всё правильно? За минуту покажу ошибку, которая меняет весь результат."
      : analysis.hook;
    return clone({
      ...analysis,
      hook,
      instructions: [analysis.instructions, instructions].filter(Boolean).join("\n"),
      suggestedAngle: `${analysis.suggestedAngle}. Пожелание: ${instructions}`,
      improvements: [...analysis.improvements, `Учесть пожелание: ${instructions}`],
      scenes: analysis.scenes.map((scene, index) => index === 0 ? { ...scene, narration: hook } : scene)
    });
  },
  async createReferenceProject(input) {
    const project = makeProject({
      title: input.analysis.suggestedTitle,
      topic: input.analysis.suggestedAngle,
      aspectRatio: input.aspectRatio,
      language: input.analysis.language,
      mode: input.mode
    }, false);
    project.scenes = clone(input.analysis.scenes);
    project.referenceAnalysis = clone(input.analysis);
    project.status = "ready";
    projects.unshift(project);
    return clone(project);
  },
  async getAnyModelSettings() { return clone(anyModelSettings); },
  async saveAnyModelSettings(input) {
    anyModelSettings = { ...input, configured: Boolean(input.apiKey) || anyModelSettings.configured };
    return clone(anyModelSettings);
  },
  async clearAnyModelKey() {
    anyModelSettings.configured = false;
    return clone(anyModelSettings);
  },
  async testAnyModelConnection() {
    return { ok: false, message: "Проверка API доступна только в приложении Electron" };
  },
  async chatWithAnyModel() {
    return "Браузерный mock-ответ. Настоящий AnyModel-чат работает в Electron.";
  },
  async streamChatWithAnyModel(_messages, onChunk) {
    const chunks = ["Браузерный ", "потоковый ", "mock-ответ."];
    let answer = "";
    for (const chunk of chunks) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      answer += chunk;
      onChunk(chunk);
    }
    return answer;
  },
  async updateProject(id: string, input: UpdateProjectInput) {
    const project = requireProject(id);
    if (input.scenes && (project.status === "generating" || project.status === "paused")) {
      throw new Error("Нельзя менять состав сцен во время активной генерации. Сначала остановите очередь.");
    }
    const contentChanged = input.topic !== undefined || input.aspectRatio !== undefined || input.language !== undefined || input.mode !== undefined || input.scenes !== undefined || input.settings !== undefined;
    const active = project.status === "generating" || project.status === "paused";
    Object.assign(project, input, {
      id: project.id,
      createdAt: project.createdAt,
      updatedAt: new Date().toISOString(),
      status: input.status ?? (contentChanged && !active ? (input.scenes ?? project.scenes).length ? "ready" : "draft" : project.status),
      outputPath: contentChanged ? undefined : input.outputPath ?? project.outputPath
    });
    project.scenes = project.scenes
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((scene, order) => ({ ...scene, order }));
    return clone(project);
  },
  async duplicateProject(id) {
    const source = requireProject(id);
    const now = new Date().toISOString();
    const project: Project = {
      ...clone(source),
      id: createId("project"),
      title: `${source.title} — копия`,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      outputPath: undefined,
      scenes: source.scenes.map((scene, order) => ({ ...clone(scene), id: createId("scene"), order, status: "draft", imagePath: undefined, videoPath: undefined, audioPath: undefined }))
    };
    projects.unshift(project);
    return clone(project);
  },
  async deleteProject(id) {
    projects = projects.filter((project) => project.id !== id);
    tasks = tasks.filter((task) => task.projectId !== id);
  },
  async getQueue() {
    advanceQueue();
    return clone(tasks);
  },
  async startGeneration(projectId) {
    const project = requireProject(projectId);
    if (project.scenes.length === 0) throw new Error("Сначала добавьте хотя бы одну сцену");
    tasks = tasks.filter((task) => task.projectId !== projectId);
    const runId = createId("run");
    const created: QueueTask[] = [];
    for (const [index, scene] of project.scenes.entries()) {
      const image = makeTask(runId, projectId, scene.id, "image", `Изображение · сцена ${index + 1}`, []);
      if (project.settings.voice.enabled) created.push(makeTask(runId, projectId, scene.id, "speech", `Озвучка · сцена ${index + 1}`, []));
      created.push(image);
      if (project.settings.video.enabled) created.push(makeTask(runId, projectId, scene.id, "video", `AI-видео · сцена ${index + 1}`, [image.id]));
    }
    created.push(makeTask(runId, projectId, undefined, "assemble", "Сборка Final.mp4", created.map((task) => task.id)));
    tasks.push(...created);
    project.status = "generating";
    project.outputPath = undefined;
    project.scenes = project.scenes.map((scene) => ({ ...scene, status: "queued", imagePath: undefined, videoPath: undefined, audioPath: undefined }));
    return clone(created);
  },
  async pauseGeneration(projectId) {
    tasks.forEach((task) => {
      if (task.projectId === projectId && (task.status === "pending" || task.status === "running" || task.status === "retry_wait")) {
        task.pausedFrom = task.status;
        task.status = "paused";
      }
    });
    requireProject(projectId).status = "paused";
    return clone(tasks.filter((task) => task.projectId === projectId));
  },
  async resumeGeneration(projectId) {
    tasks.forEach((task) => {
      if (task.projectId === projectId && task.status === "paused") {
        task.status = task.pausedFrom === "running" ? "running" : task.pausedFrom === "retry_wait" ? "retry_wait" : "pending";
        task.pausedFrom = undefined;
      }
    });
    requireProject(projectId).status = "generating";
    return clone(tasks.filter((task) => task.projectId === projectId));
  },
  async stopGeneration(projectId) {
    tasks.forEach((task) => {
      if (task.projectId === projectId && ["pending", "running", "retry_wait", "paused", "blocked"].includes(task.status)) task.status = "cancelled";
    });
    requireProject(projectId).status = "failed";
    return clone(tasks.filter((task) => task.projectId === projectId));
  },
  async retryTask(taskId) {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error("Задача не найдена");
    if (task.status === "cancelled") throw new Error("Остановленный проект нужно запустить заново");
    const project = requireProject(task.projectId);
    const runSceneIds = new Set(tasks.filter((candidate) => candidate.runId === task.runId && candidate.sceneId).map((candidate) => candidate.sceneId as string));
    if (runSceneIds.size !== project.scenes.length || project.scenes.some((scene) => !runSceneIds.has(scene.id))) {
      throw new Error("Состав сцен изменился. Запустите генерацию проекта заново.");
    }
    task.status = "pending";
    task.progress = 0;
    task.attempts = 0;
    task.error = undefined;
    return clone(task);
  },
  async clearFinishedTasks() {
    const runIds = [...new Set(tasks.map((task) => task.runId))];
    const removableRuns = new Set(runIds.filter((runId) => {
      const runTasks = tasks.filter((task) => task.runId === runId);
      return runTasks.length > 0 && runTasks.every((task) => task.status === "done" || task.status === "cancelled");
    }));
    tasks = tasks.filter((task) => !removableRuns.has(task.runId));
    return clone(tasks);
  },
  async regenerateScene(projectId, sceneId) {
    const project = requireProject(projectId);
    const scene = project.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) throw new Error("Сцена не найдена");
    const runId = tasks.find((task) => task.projectId === projectId)?.runId ?? createId("run");
    tasks = tasks.filter(
      (task) => task.projectId !== projectId || (task.sceneId !== sceneId && task.kind !== "assemble")
    );
    const created: QueueTask[] = [];
    if (project.settings.voice.enabled) {
      created.push(makeTask(runId, projectId, sceneId, "speech", `Озвучка · сцена ${scene.order + 1}`, []));
    }
    const image = makeTask(runId, projectId, sceneId, "image", `Изображение · сцена ${scene.order + 1}`, []);
    created.push(image);
    if (project.settings.video.enabled) {
      created.push(makeTask(runId, projectId, sceneId, "video", `AI-видео · сцена ${scene.order + 1}`, [image.id]));
    }
    tasks.push(...created);
    tasks.push(
      makeTask(
        runId,
        projectId,
        undefined,
        "assemble",
        "Сборка Final.mp4",
        tasks.filter((task) => task.projectId === projectId && task.kind !== "assemble").map((task) => task.id)
      )
    );
    project.status = "generating";
    project.outputPath = undefined;
    project.scenes = project.scenes.map((candidate) =>
      candidate.id === sceneId
        ? { ...candidate, status: "queued", imagePath: undefined, videoPath: undefined, audioPath: undefined }
        : candidate
    );
    return clone(tasks.filter((task) => task.projectId === projectId));
  },
  async openProjectFolder() {},
  async writeLog() {},
  async openLogFile() {},
  async pickFiles() { return []; },
  async minimizeWindow() {},
  async toggleMaximizeWindow() {},
  async closeWindow() {},
  async getAppInfo() {
    return {
      version: "0.2.0",
      dataPath: "Режим браузерного предпросмотра",
      workspacePath: "Недоступно в браузерном предпросмотре",
      logPath: "Недоступно в браузерном предпросмотре",
      realtimeUrl: undefined,
      mockMode: true,
      ffmpegAvailable: false,
      queuePolicy: { concurrency: 4, maxAttempts: 3, retryDelaysMs: [1000, 3000] }
    };
  }
};
