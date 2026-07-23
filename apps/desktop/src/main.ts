import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server as HttpServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import { createId, MockDirectorProvider, ProjectService } from "@gold-work/core";
import type { AiChatMessage, AnalyzeReferenceInput, ChatTopic, CreateProjectInput, CreateReferenceProjectInput, DesktopApi, LogLevel, ReferenceAnalysis, SaveAnyModelSettingsInput, Scene, UpdateProjectInput } from "@gold-work/shared";
import { FileProjectRepository } from "./file-project-repository.js";
import { FileTaskRepository } from "./file-task-repository.js";
import { DEFAULT_QUEUE_POLICY, MockGenerationPipeline } from "./mock-generation-pipeline.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { StandardRenderer } from "./standard-renderer.js";
import { TextFileLogger } from "./text-file-logger.js";
import { AnyModelStore } from "./anymodel-store.js";
import { AnyModelClient } from "./anymodel-client.js";
import { ChatTopicRepository } from "./chat-topic-repository.js";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
let projectService: ProjectService;
let pipeline: MockGenerationPipeline;
let projectStorage: LocalProjectStorage;
let standardRenderer: StandardRenderer;
let logger: TextFileLogger;
let dataPath: string;
let anyModelStore: AnyModelStore;
let anyModelClient: AnyModelClient;
let chatTopics: ChatTopicRepository;
let realtimeHttpServer: HttpServer;
let realtimeServer: SocketServer;
let realtimeUrl: string;

function resolveDataPath(): string {
  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
  return portableDirectory ? join(portableDirectory, "workspace") : app.getPath("userData");
}

function summarizeArguments(args: unknown[]): unknown[] {
  return args.map((argument) => {
    if (argument === null || ["string", "number", "boolean"].includes(typeof argument)) return argument;
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

function registerIpc(): void {
  handleIpc("projects:list", () => projectService.list());
  handleIpc("projects:get", (_event, id: string) => projectService.get(id));
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
  handleIpc("director:analyze-reference", async (_event, input: AnalyzeReferenceInput) =>
    await anyModelClient.configured() ? anyModelClient.analyzeReference(input) : projectService.analyzeReference(input)
  );
  handleIpc("director:refine-reference", (_event, analysis: ReferenceAnalysis, instructions: string) =>
    analysis.provider.startsWith("anymodel:") ? anyModelClient.refine(analysis, instructions) : projectService.refineReference(analysis, instructions)
  );
  handleIpc("projects:create-reference", (_event, input: CreateReferenceProjectInput) =>
    projectService.createFromReference(input)
  );
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

  handleIpc("queue:list", () => pipeline.list());
  handleIpc("queue:start", (_event, projectId: string) => mutateQueue(() => pipeline.start(projectId)));
  handleIpc("queue:pause", (_event, projectId: string) => mutateQueue(() => pipeline.pause(projectId)));
  handleIpc("queue:resume", (_event, projectId: string) => mutateQueue(() => pipeline.resume(projectId)));
  handleIpc("queue:stop", (_event, projectId: string) => mutateQueue(() => pipeline.stop(projectId)));
  handleIpc("queue:retry", (_event, taskId: string) => mutateQueue(() => pipeline.retry(taskId)));
  handleIpc("queue:regenerate-scene", (_event, projectId: string, sceneId: string) =>
    mutateQueue(() => pipeline.regenerateScene(projectId, sceneId))
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
  handleIpc("app:pick-files", async (_event, kind: "image" | "audio" | "video" | "json", multiple = false) => {
    const filters = {
      image: [{ name: "Изображения", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
      audio: [{ name: "Аудио", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"] }],
      video: [{ name: "Видео", extensions: ["mp4", "mov", "webm", "mkv"] }],
      json: [{ name: "JSON", extensions: ["json"] }]
    };
    const result = await dialog.showOpenDialog({
      title: "Выберите файлы",
      properties: multiple ? ["openFile", "multiSelections"] : ["openFile"],
      filters: filters[kind] ?? [{ name: "Все файлы", extensions: ["*"] }]
    });
    return result.canceled ? [] : result.filePaths;
  });
  handleIpc("anymodel:get-settings", () => anyModelStore.publicSettings());
  handleIpc("anymodel:save-settings", (_event, input: SaveAnyModelSettingsInput) => anyModelStore.save(input));
  handleIpc("anymodel:clear-key", () => anyModelStore.clearKey());
  handleIpc("anymodel:test", () => anyModelClient.test());
  handleIpc("anymodel:chat", (_event, messages: Parameters<AnyModelClient["chatMessage"]>[0]) =>
    anyModelClient.chatMessage(messages)
  );
  handleIpc("anymodel:chat-stream", (event, requestId: string, messages: Parameters<AnyModelClient["streamChatMessage"]>[0]) =>
    anyModelClient.streamChatMessage(messages, (chunk) => event.sender.send(`anymodel:chat-chunk:${requestId}`, chunk))
  );
  handleIpc("chat-topics:list", () => chatTopics.list());
  handleIpc("chat-topics:get", (_event, id: string) => chatTopics.get(id));
  handleIpc("chat-topics:create", (_event, title?: string) => chatTopics.create(title));
  handleIpc("chat-topics:append", (_event, topicId: string, message: AiChatMessage) => chatTopics.append(topicId, message));
  handleIpc("chat-topics:delete", (_event, id: string) => chatTopics.delete(id));
  handleIpc("projects:apply-chat-topic", async (_event, projectId: string, topicId: string) => {
    const project = await projectService.get(projectId);
    if (!project) throw new Error("Проект не найден");
    const topic = chatTopics.get(topicId);
    if (!topic) throw new Error("Тема чата не найдена");
    const plan = await createPlanFromTopic(topic, project.language);
    const durationSeconds = plan.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
    return projectService.update(projectId, {
      title: plan.title,
      topic: plan.topic,
      chatTopicId: topicId,
      scenes: plan.scenes,
      settings: {
        ...project.settings,
        durationMinutes: Math.max(1, Math.ceil(durationSeconds / 60))
      }
    });
  });
  handleIpc("app:info", () => ({
    version: app.getVersion(),
    dataPath,
    workspacePath: projectStorage.rootPath,
    logPath: logger.path,
    realtimeUrl,
    mockMode: true,
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

async function createPlanFromTopic(topic: ChatTopic, language: string): Promise<{ title: string; topic: string; scenes: Scene[] }> {
  const messages = topic.messages.map(({ role, content }) => ({ role, content }));
  if (await anyModelClient.configured()) return anyModelClient.createProjectPlanFromChat(messages, language);
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
  chatTopics = new ChatTopicRepository(join(dataPath, "database", "gold-work-studio.sqlite"));
  await chatTopics.initialize();
  logger = new TextFileLogger(join(dataPath, "logs", "gold-work-studio-log.txt"));
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
    anyModelClient
  );
  await pipeline.initialize();
  await startRealtimeServer();
  setInterval(
    () => void pipeline.tick()
      .then(() => publishQueue())
      .catch((error: unknown) => logger.write("error", "queue.tick.failed", { error })),
    500
  );
  registerIpc();
  await createWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
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
