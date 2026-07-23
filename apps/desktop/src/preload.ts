import { contextBridge, ipcRenderer } from "electron";
import type { CreateProjectInput, DesktopApi, LogLevel, UpdateProjectInput } from "@gold-work/shared";

const api: DesktopApi = {
  listProjects: () => ipcRenderer.invoke("projects:list"),
  getProject: (id: string) => ipcRenderer.invoke("projects:get", id),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke("projects:create", input),
  createDemoProject: () => ipcRenderer.invoke("projects:create-demo"),
  updateProject: (id: string, input: UpdateProjectInput) => ipcRenderer.invoke("projects:update", id, input),
  duplicateProject: (id: string) => ipcRenderer.invoke("projects:duplicate", id),
  deleteProject: (id: string) => ipcRenderer.invoke("projects:delete", id),
  getQueue: () => ipcRenderer.invoke("queue:list"),
  startGeneration: (projectId: string) => ipcRenderer.invoke("queue:start", projectId),
  pauseGeneration: (projectId: string) => ipcRenderer.invoke("queue:pause", projectId),
  resumeGeneration: (projectId: string) => ipcRenderer.invoke("queue:resume", projectId),
  stopGeneration: (projectId: string) => ipcRenderer.invoke("queue:stop", projectId),
  retryTask: (taskId: string) => ipcRenderer.invoke("queue:retry", taskId),
  clearFinishedTasks: () => ipcRenderer.invoke("queue:clear-finished"),
  regenerateScene: (projectId: string, sceneId: string) =>
    ipcRenderer.invoke("queue:regenerate-scene", projectId, sceneId),
  openProjectFolder: (projectId: string) => ipcRenderer.invoke("projects:open-folder", projectId),
  writeLog: (level: LogLevel, message: string, details?: Record<string, unknown>) =>
    ipcRenderer.invoke("app:write-log", level, message, details),
  openLogFile: () => ipcRenderer.invoke("app:open-log"),
  pickFiles: (kind: "image" | "audio" | "video" | "json", multiple = false) =>
    ipcRenderer.invoke("app:pick-files", kind, multiple),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  getAppInfo: () => ipcRenderer.invoke("app:info")
};

contextBridge.exposeInMainWorld("goldWork", api);
