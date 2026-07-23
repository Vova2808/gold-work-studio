import {
  createDefaultProjectSettings,
  type CreateProjectInput,
  type DesktopApi,
  type Project,
  type QueueTask,
  type Scene,
  type TaskKind,
  type UpdateProjectInput
} from "@gold-work/shared";

const createId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const clone = <T,>(value: T): T => structuredClone(value);
let projects: Project[] = [];
let tasks: QueueTask[] = [];

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

function makeProject(input: CreateProjectInput, withScenes: boolean): Project {
  const now = new Date().toISOString();
  const scenes = withScenes ? demoScenes(input.topic) : [];
  return {
    id: createId("project"),
    ...input,
    status: scenes.length ? "ready" : "draft",
    createdAt: now,
    updatedAt: now,
    scenes,
    settings: createDefaultProjectSettings()
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
  async minimizeWindow() {},
  async toggleMaximizeWindow() {},
  async closeWindow() {},
  async getAppInfo() {
    return {
      version: "0.2.0",
      dataPath: "Режим браузерного предпросмотра",
      mockMode: true,
      queuePolicy: { concurrency: 4, maxAttempts: 3, retryDelaysMs: [1000, 3000] }
    };
  }
};
