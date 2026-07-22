import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MockDirectorProvider, ProjectService } from "@gold-work/core";
import type { CreateProjectInput, DesktopApi, QueueTask } from "@gold-work/shared";
import { FileProjectRepository } from "./file-project-repository.js";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const queue: QueueTask[] = [];
let projectService: ProjectService;
let dataPath: string;

function resolveDataPath(): string {
  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
  return portableDirectory ? join(portableDirectory, "workspace") : app.getPath("userData");
}

function registerIpc(): void {
  ipcMain.handle("projects:list", () => projectService.list());
  ipcMain.handle("projects:create", (_event, input: CreateProjectInput) => projectService.create(input));
  ipcMain.handle("projects:create-demo", () =>
    projectService.create(
      {
        title: "Первый демонстрационный ролик",
        topic: "Как одна маленькая привычка меняет день",
        aspectRatio: "9:16",
        language: "Русский",
        mode: "standard"
      },
      true
    )
  );
  ipcMain.handle("queue:list", () => queue);
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    dataPath,
    mockMode: true
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
  } else {
    await window.loadFile(join(currentDirectory, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  dataPath = resolveDataPath();
  projectService = new ProjectService(
    new FileProjectRepository(join(dataPath, "projects.json")),
    new MockDirectorProvider()
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
