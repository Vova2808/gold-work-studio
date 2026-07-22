import { contextBridge, ipcRenderer } from "electron";
import type { CreateProjectInput, DesktopApi } from "@gold-work/shared";

const api: DesktopApi = {
  listProjects: () => ipcRenderer.invoke("projects:list"),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke("projects:create", input),
  createDemoProject: () => ipcRenderer.invoke("projects:create-demo"),
  getQueue: () => ipcRenderer.invoke("queue:list"),
  getAppInfo: () => ipcRenderer.invoke("app:info")
};

contextBridge.exposeInMainWorld("goldWork", api);

