import { app, BrowserWindow, dialog, ipcMain, protocol, shell, type IpcMainInvokeEvent } from "electron";
import { mkdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, normalize, relative } from "node:path";
import { createServer, type Server as HttpServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import { createId, MockDirectorProvider, ProjectService } from "@gold-work/core";
import { allocateSceneDurations, parseYouTubeChannelRef } from "@gold-work/shared";
import { VoicerStore } from "./voicer-store.js";
import { VoicerClient } from "./voicer-client.js";
import { GoogleStore } from "./google-store.js";
import { VeoClient } from "./veo-client.js";
import type { AiChatMessage, AnalyzeReferenceInput, ChatTopic, ConsoleLogEntry, CreateProjectInput, CreateReferenceProjectInput, DesktopApi, LogLevel, Project, ReferenceAnalysis, SaveAnyModelSettingsInput, SaveGoogleSettingsInput, SaveVoicerSettingsInput, SaveYouTubeSettingsInput, Scene, UpdateProjectInput } from "@gold-work/shared";
import { FileProjectRepository } from "./file-project-repository.js";
import { FileTaskRepository } from "./file-task-repository.js";
import { DEFAULT_QUEUE_POLICY, MockGenerationPipeline } from "./mock-generation-pipeline.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { StandardRenderer } from "./standard-renderer.js";
import { TextFileLogger } from "./text-file-logger.js";
import { AnyModelStore } from "./anymodel-store.js";
import { AnyModelClient } from "./anymodel-client.js";
import { ChatTopicRepository } from "./chat-topic-repository.js";
import { YouTubeClient } from "./youtube-client.js";
import { YouTubeStore } from "./youtube-store.js";
import { createMediaFileResponse } from "./media-range.js";

// __dirname доступен, потому что main собирается в CommonJS (см. electron.vite.config.ts).
const currentDirectory = __dirname;
let projectService: ProjectService;
let pipeline: MockGenerationPipeline;
let projectStorage: LocalProjectStorage;
let standardRenderer: StandardRenderer;
let logger: TextFileLogger;
let dataPath: string;
let anyModelStore: AnyModelStore;
let anyModelClient: AnyModelClient;
let voicerStore: VoicerStore;
let voicerClient: VoicerClient;
let googleStore: GoogleStore;
let veoClient: VeoClient;
let chatTopics: ChatTopicRepository;
let youtubeStore: YouTubeStore;
let youtubeClient: YouTubeClient;
let realtimeHttpServer: HttpServer;
let realtimeServer: SocketServer;
let realtimeUrl: string;

function publishLogEntry(entry: ConsoleLogEntry): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("app:log-entry", entry);
  }
}

// gw-media:// — локальные медиа проекта (картинки/озвучка/видео) для <img>/<video> в изолированном renderer.
protocol.registerSchemesAsPrivileged([
  { scheme: "gw-media", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
]);

function resolveDataPath(): string {
  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
  return portableDirectory ? join(portableDirectory, "workspace") : app.getPath("userData");
}

function summarizeArguments(args: unknown[]): unknown[] {
  return args.map((argument) => {
    if (typeof argument === "string") return { type: "string", length: argument.length };
    if (argument === null || ["number", "boolean"].includes(typeof argument)) return argument;
    if (!argument || typeof argument !== "object") return typeof argument;
    const value = argument as Record<string, unknown>;
    return Object.fromEntries(
      ["id", "projectId", "sceneId", "title", "mode", "status", "aspectRatio"]
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, value[key]])
    );
  });
}

function handleIpc<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    const logRequest = !["projects:list", "queue:list", "app:info"].includes(channel);
    if (logRequest) void logger.write("debug", "ipc.request", { channel, args: summarizeArguments(args) });
    try {
      const result = await handler(event, ...(args as TArgs));
      if (logRequest) void logger.write("debug", "ipc.success", { channel });
      return result;
    } catch (error) {
      void logger.write("error", "ipc.failed", { channel, error });
      throw error;
    }
  });
}

function sendDirectorProgress(event: IpcMainInvokeEvent, stage: string, details?: Record<string, unknown>): void {
  event.sender.send("director:progress", stage);
  void logger.write("info", "director.progress", { stage, ...details });
}

async function withRecoveredFinal(project: Project | undefined): Promise<Project | undefined> {
  if (!project || project.outputPath || project.status !== "complete") return project;
  const finalPath = projectStorage.finalPath(project.id);
  try {
    if ((await stat(finalPath)).isFile()) return { ...project, outputPath: finalPath };
  } catch {
    // The project may simply not have been assembled yet.
  }
  return project;
}

function registerIpc(): void {
  handleIpc("projects:list", async () => Promise.all((await projectService.list()).map(withRecoveredFinal)) as Promise<Project[]>);
  handleIpc("projects:get", async (_event, id: string) => withRecoveredFinal(await projectService.get(id)));
  handleIpc("projects:create", (_event, input: CreateProjectInput) => projectService.create(input));
  handleIpc("projects:create-demo", () =>
    projectService.create(
      {
        title: "Барсик — космический кот",
        topic: "Семейный мультфильм о приключении ленивого кота в космосе",
        aspectRatio: "16:9",
        language: "Русский",
        mode: "standard"
      },
      true
    )
  );
  handleIpc("director:analyze-reference", async (event, input: AnalyzeReferenceInput) => {
    const stage = (text: string) => sendDirectorProgress(event, text);
    // «Память режиссёра»: прошлые проекты идут в контекст, чтобы новые темы не повторялись.
    const pastProjects = (await projectService.list()).slice(0, 30).map((project) => `${project.title} — ${project.topic}`);
    const channelRef = parseYouTubeChannelRef(input.url);
    if (channelRef) {
      if (!await anyModelClient.configured()) throw new Error("Для YouTube-разбора сначала подключите AnyModel API в настройках");
      stage("Получаю данные канала через YouTube API: статистика, таймлайн роликов, комментарии…");
      const channelContext = await youtubeClient.collectChannel(channelRef);
      stage(`Канал «${channelContext.title}»: ${channelContext.subscribers.toLocaleString("ru-RU")} подписчиков, ${channelContext.totalViews.toLocaleString("ru-RU")} суммарных просмотров, в таймлайне ${channelContext.videos.length} роликов, комментариев собрано: ${channelContext.topComments.length}.`);
      stage("Claude анализирует нишу: что заходит по таймлайну, чего просят зрители в комментариях — и готовит стратегию с 3 темами…");
      return anyModelClient.analyzeYouTubeChannel(channelContext, input, pastProjects);
    }
    if (/https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(input.url)) {
      if (!await anyModelClient.configured()) throw new Error("Для YouTube-разбора сначала подключите AnyModel API в настройках");
      stage("Получаю данные ролика и канала через YouTube API: статистика, комментарии, топ-ролики…");
      const context = await youtubeClient.collect(input.url);
      const transcriptLabel = context.transcriptSource === "captions" ? "субтитры ролика"
        : context.transcriptSource === "yt-dlp-captions" ? "субтитры (yt-dlp)"
        : context.transcriptSource === "gemini-audio" ? "распознан из аудио"
        : "недоступен";
      stage(`Данные собраны: ${context.views.toLocaleString("ru-RU")} просмотров, ${context.likes.toLocaleString("ru-RU")} лайков, ${context.topComments.length} комментариев, ${context.topVideos.length} топ-роликов канала (${context.channelSubscribers.toLocaleString("ru-RU")} подписчиков). Транскрипт: ${transcriptLabel}.`);
      stage("Claude изучает статистику, комментарии и транскрипт — пишет разбор, находит сильные стороны и готовит 3 темы для новых роликов…");
      return anyModelClient.analyzeYouTube(context, input, pastProjects);
    }
    stage("Разбираю референс по ссылке…");
    return await anyModelClient.configured() ? anyModelClient.analyzeReference(input, pastProjects) : projectService.analyzeReference(input);
  });
  handleIpc("director:refine-reference", (_event, analysis: ReferenceAnalysis, instructions: string, modelId?: string) =>
    analysis.youtubeChannelContext
      ? anyModelClient.analyzeYouTubeChannel(analysis.youtubeChannelContext, {
          url: analysis.sourceUrl,
          language: analysis.language,
          instructions: `${analysis.instructions || ""}\nУточнение: ${instructions}`.trim(),
          modelId: modelId || analysis.modelId
        })
      : analysis.youtubeContext
      ? anyModelClient.analyzeYouTube(analysis.youtubeContext, {
          url: analysis.sourceUrl,
          language: analysis.language,
          instructions: `${analysis.instructions || ""}\nУточнение: ${instructions}`.trim(),
          modelId: modelId || analysis.modelId
        })
      : analysis.provider.startsWith("anymodel:")
        ? anyModelClient.refine(analysis, instructions, modelId || analysis.modelId)
        : projectService.refineReference(analysis, instructions)
  );
  handleIpc("projects:create-reference", (_event, input: CreateReferenceProjectInput) =>
    projectService.createFromReference(input)
  );
  handleIpc("director:regenerate-scenes", async (event, analysis: ReferenceAnalysis, targetSeconds: number, modelId?: string) => {
    const totalScenes = allocateSceneDurations(targetSeconds).length;
    sendDirectorProgress(event, `Пишу сценарий: 0 из ${totalScenes} сцен`);
    const onProgress = (done: number, total: number, stage?: string) => sendDirectorProgress(event, stage ?? `Пишу сценарий: ${done} из ${total} сцен`, { done, total });
    return await anyModelClient.configured()
      ? anyModelClient.regenerateScenes(analysis, targetSeconds, onProgress, modelId || analysis.modelId)
      : resizeScenesLocally(analysis, targetSeconds);
  });
  handleIpc("projects:update", (_event, id: string, input: UpdateProjectInput) => projectService.update(id, input));
  handleIpc("projects:duplicate", (_event, id: string) => projectService.duplicate(id));
  handleIpc("projects:delete", async (_event, id: string) => {
    await pipeline.removeProject(id);
    await projectService.delete(id);
  });
  handleIpc("projects:open-folder", async (_event, id: string) => {
    const project = await projectService.get(id);
    if (!project) throw new Error("Проект не найден");
    const directory = await projectStorage.ensureProject(project);
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
  });
  handleIpc("projects:open-scene-folder", async (_event, projectId: string, sceneId: string) => {
    const project = await projectService.get(projectId);
    if (!project) throw new Error("Проект не найден");
    const scene = project.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) throw new Error("Сцена не найдена");
    await projectStorage.ensureProject(project);
    const directory = projectStorage.sceneDirectory(project, scene);
    await mkdir(directory, { recursive: true });
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
  });

  handleIpc("queue:list", () => pipeline.list());
  handleIpc("queue:start", (_event, projectId: string) => mutateQueue(() => pipeline.start(projectId)));
  handleIpc("queue:pause", (_event, projectId: string) => mutateQueue(() => pipeline.pause(projectId)));
  handleIpc("queue:resume", (_event, projectId: string) => mutateQueue(() => pipeline.resume(projectId)));
  handleIpc("queue:stop", (_event, projectId: string) => mutateQueue(() => pipeline.stop(projectId)));
  handleIpc("queue:retry", (_event, taskId: string) => mutateQueue(() => pipeline.retry(taskId)));
  handleIpc("queue:regenerate-scene", (_event, projectId: string, sceneId: string | string[], target?: "image" | "video" | "audio" | "all") =>
    mutateQueue(() => pipeline.regenerateScene(projectId, sceneId, target))
  );
  handleIpc("queue:clear-finished", () => mutateQueue(() => pipeline.clearFinished()));
  handleIpc("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  handleIpc("window:toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  handleIpc("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("app:write-log", (_event, level: LogLevel, message: string, details?: Record<string, unknown>) => {
    const safeLevel: LogLevel = ["debug", "info", "warn", "error"].includes(level) ? level : "info";
    return logger.write(safeLevel, `renderer.${message}`, details);
  });
  handleIpc("app:open-log", async () => {
    await logger.flush();
    const error = await shell.openPath(logger.path);
    if (error) throw new Error(error);
  });
  handleIpc("app:pick-files", async (_event, kind: "image" | "audio" | "video" | "json" | "cookies", multiple = false) => {
    const filters = {
      image: [{ name: "Изображения", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
      audio: [{ name: "Аудио", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"] }],
      video: [{ name: "Видео", extensions: ["mp4", "mov", "webm", "mkv"] }],
      json: [{ name: "JSON", extensions: ["json"] }],
      cookies: [{ name: "YouTube cookies.txt", extensions: ["txt"] }]
    };
    const result = await dialog.showOpenDialog({
      title: "Выберите файлы",
      properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
      filters: filters[kind] ?? [{ name: "Все файлы", extensions: ["*"] }]
    });
    return result.canceled ? [] : result.filePaths;
  });
  handleIpc("app:pick-directory", async () => {
    const result = await dialog.showOpenDialog({
      title: "Выберите рабочую папку",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
  handleIpc("anymodel:get-settings", () => anyModelStore.publicSettings());
  handleIpc("anymodel:save-settings", (_event, input: SaveAnyModelSettingsInput) => anyModelStore.save(input));
  handleIpc("anymodel:clear-key", () => anyModelStore.clearKey());
  handleIpc("anymodel:test", () => anyModelClient.test());
  handleIpc("anymodel:tts-sample", (_event, voice: string, language: string) =>
    anyModelClient.ttsSample(voice, language, join(dataPath, "tts-samples"))
  );
  handleIpc("voicer:get-settings", () => voicerStore.publicSettings());
  handleIpc("voicer:save-settings", (_event, input: SaveVoicerSettingsInput) => voicerStore.save(input));
  handleIpc("voicer:clear-key", () => voicerStore.clearKey());
  handleIpc("voicer:test", () => voicerClient.test());
  handleIpc("voicer:templates", () => voicerClient.templates());
  handleIpc("voicer:tts-sample", (_event, templateUuid: string | undefined, language: string) =>
    voicerClient.ttsSample(templateUuid, language, join(dataPath, "tts-samples"))
  );
  handleIpc("google:get-settings", () => googleStore.publicSettings());
  handleIpc("google:save-settings", (_event, input: SaveGoogleSettingsInput) => googleStore.save(input));
  handleIpc("google:clear-key", () => googleStore.clearKey());
  handleIpc("google:test", () => veoClient.test());
  handleIpc("projects:assemble", (_event, projectId: string) => pipeline.assembleOnly(projectId));
  handleIpc("projects:improve-scene", async (_event, projectId: string, sceneId: string, instructions: string) => {
    const project = await projectService.get(projectId);
    if (!project) throw new Error("Проект не найден");
    const scene = project.scenes.find((item) => item.id === sceneId);
    if (!scene) throw new Error("Сцена не найдена");
    if (!await anyModelClient.configured()) throw new Error("Подключите AnyModel API в настройках");
    const improved = await anyModelClient.improveScene(project, scene, instructions);
    return projectService.mutate(projectId, (current) => ({
      scenes: current.scenes.map((item) => (item.id === sceneId
        ? { ...item, narration: improved.narration, imagePrompt: improved.imagePrompt }
        : item))
    }));
  });
  handleIpc("projects:character-reference", async (event, projectId: string) => {
    const project = await projectService.get(projectId);
    if (!project) throw new Error("Проект не найден");
    if (project.scenes.length === 0) throw new Error("Сначала соберите сценарий — герой описывается по сценам");
    if (!await anyModelClient.configured()) throw new Error("Подключите AnyModel API в настройках");
    sendDirectorProgress(event, "Референс героя: описываю внешность по сценарию…", { projectId });
    const hero = await anyModelClient.characterReference(project, (stage) => sendDirectorProgress(event, stage, { projectId }));
    const updatedAt = new Date().toISOString();
    const path = await projectStorage.saveCharacterReference(project, hero.image, { name: hero.name, prompt: hero.prompt, updatedAt });
    const character = { name: hero.name, prompt: hero.prompt, imagePath: path, updatedAt };
    void logger.write("info", "project.character_reference.created", { projectId, hero: hero.name });
    const updated = await projectService.mutate(project.id, (current) => ({
      characterReference: character,
      settings: {
        ...current.settings,
        image: {
          ...current.settings.image,
          references: [...new Set([path, ...current.settings.image.references])].slice(0, 3)
        }
      }
    }));
    await projectStorage.ensureProject(updated);
    return {
      project: updated,
      character
    };
  });
  ipcMain.handle("app:read-logs", (_event, limit?: number) => logger.readRecent(limit));
  handleIpc("youtube:get-settings", () => youtubeStore.publicSettings());
  handleIpc("youtube:save-settings", (_event, input: SaveYouTubeSettingsInput) => youtubeStore.save(input));
  handleIpc("youtube:clear-key", () => youtubeStore.clearKey());
  handleIpc("youtube:test", () => youtubeClient.test());
  handleIpc("anymodel:chat", (_event, messages: Parameters<AnyModelClient["chatMessage"]>[0], modelId?: string) =>
    anyModelClient.chatMessage(messages, modelId)
  );
  handleIpc("anymodel:chat-stream", (event, requestId: string, messages: Parameters<AnyModelClient["streamChatMessage"]>[0], modelId?: string) =>
    anyModelClient.streamChatMessage(messages, (chunk) => event.sender.send(`anymodel:chat-chunk:${requestId}`, chunk), modelId)
  );
  handleIpc("chat-topics:list", () => chatTopics.list());
  handleIpc("chat-topics:get", (_event, id: string) => chatTopics.get(id));
  handleIpc("chat-topics:create", (_event, title?: string, modelId?: string) => chatTopics.create(title, modelId));
  handleIpc("chat-topics:append", (_event, topicId: string, message: AiChatMessage) => chatTopics.append(topicId, message));
  handleIpc("chat-topics:set-model", (_event, topicId: string, modelId: string) => chatTopics.setModel(topicId, modelId));
  handleIpc("chat-topics:save-analysis", (_event, topicId: string, analysis: ReferenceAnalysis | null) => chatTopics.saveAnalysis(topicId, analysis));
  handleIpc("chat-topics:delete", (_event, id: string) => chatTopics.delete(id));
  handleIpc("projects:apply-chat-topic", async (event, projectId: string, topicId: string) => {
    const project = await projectService.get(projectId);
    if (!project) throw new Error("Проект не найден");
    const topic = chatTopics.get(topicId);
    if (!topic) throw new Error("Тема чата не найдена");
    const stage = (text: string) => sendDirectorProgress(event, text, { projectId, topicId });

    // Главное: если в теме сохранён разбор — сценарий пишем ПО НЕМУ (тема ролика, ниша, аудитория,
    // комментарии зрителей). Пересказ переписки давал сценарий «о том, как делать ролики».
    if (topic.analysis && await anyModelClient.configured()) {
      const targetSeconds = Math.max(30, Math.round((project.settings.durationMinutes || 1) * 60));
      const total = allocateSceneDurations(targetSeconds).length;
      stage(`Пишу сценарий по теме «${topic.analysis.suggestedTitle}»: 0 из ${total} сцен`);
      const full = await anyModelClient.regenerateScenes(
        { ...topic.analysis, language: project.language },
        targetSeconds,
        (done, count, label) => stage(label ?? `Пишу сценарий: ${done} из ${count} сцен`),
        topic.modelId
      );
      return projectService.mutate(projectId, (current) => ({
        title: topic.analysis!.suggestedTitle || current.title,
        topic: topic.analysis!.suggestedAngle || topic.analysis!.niche || current.topic,
        chatTopicId: topicId,
        scenes: full.scenes,
        status: full.scenes.length > 0 ? "ready" as const : current.status,
        referenceAnalysis: full
      }));
    }

    if (await anyModelClient.configured()) {
      const targetSeconds = Math.max(30, Math.round((project.settings.durationMinutes || 1) * 60));
      const history = topic.messages
        .filter((message) => !/^Ошибка AI-провайдера:/i.test(message.content))
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n\n");
      const firstUserMessage = topic.messages.find((message) => message.role === "user")?.content ?? topic.title;
      const lastAssistantMessage = [...topic.messages].reverse().find((message) => message.role === "assistant")?.content;
      const seed: ReferenceAnalysis = {
        sourceUrl: `chat://${topic.id}`,
        sourceTitle: topic.title,
        niche: "Определи из диалога",
        targetAudience: "Определи из диалога",
        hook: lastAssistantMessage?.slice(0, 500) || firstUserMessage,
        structure: [],
        strengths: [],
        improvements: [],
        suggestedAngle: firstUserMessage,
        suggestedTitle: topic.title,
        recommendedDurationSeconds: targetSeconds,
        language: project.language,
        instructions: `Полный сохранённый диалог:\n${history}`,
        scenes: [],
        provider: `anymodel:${topic.modelId || "default"}+chat`,
        modelId: topic.modelId
      };
      stage(`Строю цельный сценарий из диалога: 0 из ${allocateSceneDurations(targetSeconds).length} сцен`);
      const full = await anyModelClient.regenerateScenes(
        seed,
        targetSeconds,
        (done, count, label) => stage(label ?? `Пишу сценарий: ${done} из ${count} сцен`),
        topic.modelId
      );
      return projectService.mutate(projectId, (current) => ({
        title: full.suggestedTitle || current.title,
        topic: full.suggestedAngle || current.topic,
        chatTopicId: topicId,
        scenes: full.scenes,
        status: "ready" as const,
        referenceAnalysis: full
      }));
    }

    stage("Собираю сценарий из сохранённого диалога…");
    const plan = await createPlanFromTopic(topic, project.language);
    const durationSeconds = plan.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
    // mutate вместо update: за время LLM-вызова настройки могли измениться, снимок project.settings устарел.
    return projectService.mutate(projectId, (current) => ({
      title: plan.title,
      topic: plan.topic,
      chatTopicId: topicId,
      scenes: plan.scenes,
      status: plan.scenes.length > 0 ? "ready" as const : current.status,
      settings: {
        ...current.settings,
        durationMinutes: Math.max(1, Math.ceil(durationSeconds / 60))
      }
    }));
  });
  handleIpc("app:info", async () => ({
    version: app.getVersion(),
    dataPath,
    workspacePath: projectStorage.rootPath,
    logPath: logger.path,
    realtimeUrl,
    // Реальные провайдеры активны, когда сохранён ключ AnyModel; без него работают заглушки.
    mockMode: !(await anyModelStore.publicSettings()).configured,
    ffmpegAvailable: standardRenderer.isAvailable(),
    queuePolicy: pipeline.policy
  } satisfies Awaited<ReturnType<DesktopApi["getAppInfo"]>>));
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1060,
    minHeight: 680,
    backgroundColor: "#090a0f",
    title: "Gold Work Studio",
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(currentDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    void logger.write("error", "renderer.load.failed", { code, description, url });
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    void logger.write("error", "renderer.process.gone", { reason: details.reason, exitCode: details.exitCode });
  });
  window.webContents.on("did-finish-load", () => {
    void logger.write("info", "renderer.load.completed");
  });
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const logLevel: LogLevel = level >= 3 ? "error" : level === 2 ? "warn" : level === 0 ? "debug" : "info";
    void logger.write(logLevel, "renderer.console", { message, line, sourceId });
  });
  window.on("closed", () => void logger.write("info", "window.closed"));
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    const loopbackUrl = devUrl.replace("localhost", "127.0.0.1");
    let lastError: unknown;
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await window.loadURL(loopbackUrl);
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 150));
      }
    }
    throw lastError;
  }
  await window.loadFile(join(currentDirectory, "../renderer/index.html"));
}

async function startRealtimeServer(): Promise<void> {
  realtimeHttpServer = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  realtimeServer = new SocketServer(realtimeHttpServer, {
    cors: { origin: "*" },
    transports: ["websocket", "polling"]
  });
  await new Promise<void>((resolve, reject) => {
    realtimeHttpServer.once("error", reject);
    realtimeHttpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const address = realtimeHttpServer.address();
  if (!address || typeof address === "string") throw new Error("Не удалось запустить локальный Socket.io");
  realtimeUrl = `http://127.0.0.1:${address.port}`;
  realtimeServer.on("connection", (socket) => {
    void pipeline.list().then((tasks) => socket.emit("queue:snapshot", tasks));
  });
}

async function publishQueue(): Promise<void> {
  realtimeServer?.emit("queue:snapshot", await pipeline.list());
}

async function mutateQueue<TResult>(mutation: () => TResult | Promise<TResult>): Promise<TResult> {
  const result = await mutation();
  await publishQueue();
  return result;
}

function resizeScenesLocally(analysis: ReferenceAnalysis, targetSeconds: number): ReferenceAnalysis {
  const durations = allocateSceneDurations(targetSeconds);
  const source = analysis.scenes.length > 0
    ? analysis.scenes
    : [{ id: "", order: 0, title: "Сцена", narration: analysis.hook || analysis.suggestedTitle || "Сцена", imagePrompt: "", animationPrompt: "", durationSeconds: durations[0]!, status: "draft" as const }];
  const scenes: Scene[] = durations.map((duration, index) => {
    const base = source[index % source.length]!;
    return {
      id: createId("scene"),
      order: index,
      title: `Сцена ${index + 1}`,
      narration: base.narration,
      imagePrompt: base.imagePrompt,
      animationPrompt: base.animationPrompt || "Плавное движение камеры и естественное движение объектов",
      durationSeconds: duration,
      status: "draft"
    };
  });
  return { ...analysis, scenes, recommendedDurationSeconds: durations.reduce((sum, duration) => sum + duration, 0) };
}

async function createPlanFromTopic(topic: ChatTopic, language: string): Promise<{ title: string; topic: string; scenes: Scene[] }> {
  const userText = topic.messages.filter((message) => message.role === "user").map((message) => message.content).join(" ");
  const sentences = userText.split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
  const beats = [
    { title: "Хук", narration: sentences[0] || `Почему тема «${topic.title}» важнее, чем кажется?` },
    { title: "Развитие", narration: sentences.slice(1, -1).join(" ") || `Разбираем главную идею темы «${topic.title}» на понятном примере.` },
    { title: "Финал", narration: sentences.at(-1) || "Подводим итог и даём зрителю ясный следующий шаг." }
  ];
  return {
    title: topic.title,
    topic: userText.slice(0, 500) || topic.title,
    scenes: beats.map((beat, order) => ({
      id: createId("scene"),
      order,
      title: beat.title,
      narration: beat.narration,
      imagePrompt: `${beat.narration}. Единый визуальный стиль, выразительная композиция, без текста в кадре`,
      animationPrompt: "Плавное движение камеры и естественное движение объектов",
      durationSeconds: 8,
      status: "draft"
    }))
  };
}

app.whenReady().then(async () => {
  dataPath = resolveDataPath();
  anyModelStore = new AnyModelStore(join(dataPath, "credentials", "anymodel.json"));
  anyModelClient = new AnyModelClient(anyModelStore);
  voicerStore = new VoicerStore(join(dataPath, "credentials", "voicer.json"));
  voicerClient = new VoicerClient(voicerStore);
  googleStore = new GoogleStore(join(dataPath, "credentials", "google.json"));
  veoClient = new VeoClient(googleStore);
  youtubeStore = new YouTubeStore(join(dataPath, "credentials", "youtube.json"));
  youtubeClient = new YouTubeClient(youtubeStore, (audio, format) => anyModelClient.transcribeAudio(audio, format));
  chatTopics = new ChatTopicRepository(join(dataPath, "database", "gold-work-studio.sqlite"));
  await chatTopics.initialize();
  logger = new TextFileLogger(join(dataPath, "logs", "gold-work-studio-log.txt"), publishLogEntry);
  await logger.initialize();
  process.on("uncaughtExceptionMonitor", (error) => void logger.write("error", "process.uncaught_exception", { error }));
  process.on("unhandledRejection", (reason) => void logger.write("error", "process.unhandled_rejection", { reason }));
  void logger.write("info", "app.ready", { version: app.getVersion(), dataPath });
  projectService = new ProjectService(
    new FileProjectRepository(join(dataPath, "projects.json")),
    new MockDirectorProvider()
  );
  projectStorage = new LocalProjectStorage(join(dataPath, "workspace", "projects"));
  standardRenderer = new StandardRenderer(projectStorage);
  pipeline = new MockGenerationPipeline(
    new FileTaskRepository(join(dataPath, "queue.json")),
    projectService,
    projectStorage,
    standardRenderer,
    DEFAULT_QUEUE_POLICY,
    (event) => void logger.write(event.level, event.message, event.details),
    anyModelClient,
    voicerClient,
    veoClient
  );
  await pipeline.initialize();
  await startRealtimeServer();
  setInterval(
    () => void pipeline.tick()
      .then(() => publishQueue())
      .catch((error: unknown) => logger.write("error", "queue.tick.failed", { error })),
    500
  );
  protocol.handle("gw-media", async (request) => {
    const mediaUrl = new URL(request.url);
    if (mediaUrl.hostname !== "local") return new Response("forbidden", { status: 403 });
    const encoded = mediaUrl.pathname.slice(1);
    const filePath = normalize(decodeURIComponent(encoded));
    // Отдаём только файлы из папки данных приложения (workspace, кэши) — не весь диск.
    const localPath = relative(normalize(dataPath), filePath);
    if (localPath.startsWith("..") || isAbsolute(localPath)) {
      return new Response("forbidden", { status: 403 });
    }
    try {
      return await createMediaFileResponse(filePath, request.headers.get("range"));
    } catch (error) {
      void logger.write("warn", "media.request.failed", {
        file: basename(filePath),
        range: request.headers.get("range") ?? "full",
        error
      });
      return new Response("not found", { status: 404 });
    }
  });
  registerIpc();
  await createWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
}).catch((error: unknown) => {
  // Без catch сбой инициализации оставляет процесс без окна и без объяснения.
  const message = error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);
  try {
    dialog.showErrorBox("Gold Work Studio не запустился", message);
  } finally {
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  chatTopics?.close();
  realtimeServer?.close();
  realtimeHttpServer?.close();
  if (logger) void logger.write("info", "app.before_quit");
});
