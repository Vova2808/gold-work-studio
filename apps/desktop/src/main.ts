import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MockDirectorProvider, ProjectService } from "@gold-work/core";
import type { CreateProjectInput, DesktopApi, UpdateProjectInput } from "@gold-work/shared";
import { FileProjectRepository } from "./file-project-repository.js";
import { FileTaskRepository } from "./file-task-repository.js";
import { MockGenerationPipeline } from "./mock-generation-pipeline.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { StandardRenderer } from "./standard-renderer.js";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
let projectService: ProjectService;
let pipeline: MockGenerationPipeline;
let projectStorage: LocalProjectStorage;
let standardRenderer: StandardRenderer;
let dataPath: string;

function resolveDataPath(): string {
  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
  return portableDirectory ? join(portableDirectory, "workspace") : app.getPath("userData");
}

function registerIpc(): void {
  ipcMain.handle("projects:list", () => projectService.list());
  ipcMain.handle("projects:get", (_event, id: string) => projectService.get(id));
  ipcMain.handle("projects:create", (_event, input: CreateProjectInput) => projectService.create(input));
  ipcMain.handle("projects:create-demo", () =>
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
  ipcMain.handle("projects:update", (_event, id: string, input: UpdateProjectInput) => projectService.update(id, input));
  ipcMain.handle("projects:duplicate", (_event, id: string) => projectService.duplicate(id));
  ipcMain.handle("projects:delete", async (_event, id: string) => {
    await pipeline.removeProject(id);
    await projectService.delete(id);
  });
  ipcMain.handle("projects:open-folder", async (_event, id: string) => {
    const project = await projectService.get(id);
    if (!project) throw new Error("Проект не найден");
    const directory = await projectStorage.ensureProject(project);
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
  });

  ipcMain.handle("queue:list", () => pipeline.list());
  ipcMain.handle("queue:start", (_event, projectId: string) => pipeline.start(projectId));
  ipcMain.handle("queue:pause", (_event, projectId: string) => pipeline.pause(projectId));
  ipcMain.handle("queue:resume", (_event, projectId: string) => pipeline.resume(projectId));
  ipcMain.handle("queue:stop", (_event, projectId: string) => pipeline.stop(projectId));
  ipcMain.handle("queue:retry", (_event, taskId: string) => pipeline.retry(taskId));
  ipcMain.handle("queue:regenerate-scene", (_event, projectId: string, sceneId: string) =>
    pipeline.regenerateScene(projectId, sceneId)
  );
  ipcMain.handle("queue:clear-finished", () => pipeline.clearFinished());
  ipcMain.handle("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle("window:toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.handle("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    dataPath,
    workspacePath: projectStorage.rootPath,
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
    console.error(`[renderer] failed to load ${url}: ${code} ${description}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[renderer] process gone: ${details.reason}`);
  });
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

app.whenReady().then(async () => {
  dataPath = resolveDataPath();
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
    standardRenderer
  );
  await pipeline.initialize();
  setInterval(() => void pipeline.tick().catch((error: unknown) => console.error("[queue]", error)), 500);
  registerIpc();
  await createWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
