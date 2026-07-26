import { contextBridge, ipcRenderer } from "electron";
import type { CreateProjectInput, DesktopApi, LogLevel, UpdateProjectInput } from "@gold-work/shared";

const api: DesktopApi = {
  listProjects: () => ipcRenderer.invoke("projects:list"),
  getProject: (id: string) => ipcRenderer.invoke("projects:get", id),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke("projects:create", input),
  createDemoProject: () => ipcRenderer.invoke("projects:create-demo"),
  analyzeReference: (input) => ipcRenderer.invoke("director:analyze-reference", input),
  refineReferenceAnalysis: (analysis, instructions) => ipcRenderer.invoke("director:refine-reference", analysis, instructions),
  createReferenceProject: (input) => ipcRenderer.invoke("projects:create-reference", input),
  regenerateReferenceScenes: (analysis, targetSeconds) => ipcRenderer.invoke("director:regenerate-scenes", analysis, targetSeconds),
  onDirectorProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, stage: string) => listener(stage);
    ipcRenderer.on("director:progress", handler);
    return () => ipcRenderer.removeListener("director:progress", handler);
  },
  getAnyModelSettings: () => ipcRenderer.invoke("anymodel:get-settings"),
  saveAnyModelSettings: (input) => ipcRenderer.invoke("anymodel:save-settings", input),
  clearAnyModelKey: () => ipcRenderer.invoke("anymodel:clear-key"),
  testAnyModelConnection: () => ipcRenderer.invoke("anymodel:test"),
  ttsSample: (voice, language) => ipcRenderer.invoke("anymodel:tts-sample", voice, language),
  getVoicerSettings: () => ipcRenderer.invoke("voicer:get-settings"),
  saveVoicerSettings: (input) => ipcRenderer.invoke("voicer:save-settings", input),
  clearVoicerKey: () => ipcRenderer.invoke("voicer:clear-key"),
  testVoicerConnection: () => ipcRenderer.invoke("voicer:test"),
  listVoicerTemplates: () => ipcRenderer.invoke("voicer:templates"),
  voicerSample: (templateUuid, language) => ipcRenderer.invoke("voicer:tts-sample", templateUuid, language),
  createCharacterReference: (projectId) => ipcRenderer.invoke("projects:character-reference", projectId),
  getYouTubeSettings: () => ipcRenderer.invoke("youtube:get-settings"),
  saveYouTubeSettings: (input) => ipcRenderer.invoke("youtube:save-settings", input),
  clearYouTubeKey: () => ipcRenderer.invoke("youtube:clear-key"),
  testYouTubeConnection: () => ipcRenderer.invoke("youtube:test"),
  chatWithAnyModel: (messages) => ipcRenderer.invoke("anymodel:chat", messages),
  streamChatWithAnyModel: async (messages, onChunk) => {
    const requestId = crypto.randomUUID();
    const channel = `anymodel:chat-chunk:${requestId}`;
    const listener = (_event: Electron.IpcRendererEvent, chunk: string) => onChunk(chunk);
    ipcRenderer.on(channel, listener);
    try {
      return await ipcRenderer.invoke("anymodel:chat-stream", requestId, messages);
    } finally {
      ipcRenderer.removeListener(channel, listener);
    }
  },
  listChatTopics: () => ipcRenderer.invoke("chat-topics:list"),
  getChatTopic: (id) => ipcRenderer.invoke("chat-topics:get", id),
  createChatTopic: (title) => ipcRenderer.invoke("chat-topics:create", title),
  appendChatMessage: (topicId, message) => ipcRenderer.invoke("chat-topics:append", topicId, message),
  saveChatTopicAnalysis: (topicId, analysis) => ipcRenderer.invoke("chat-topics:save-analysis", topicId, analysis),
  deleteChatTopic: (id) => ipcRenderer.invoke("chat-topics:delete", id),
  applyChatTopicToProject: (projectId, topicId) => ipcRenderer.invoke("projects:apply-chat-topic", projectId, topicId),
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
  openSceneFolder: (projectId: string, sceneId: string) => ipcRenderer.invoke("projects:open-scene-folder", projectId, sceneId),
  writeLog: (level: LogLevel, message: string, details?: Record<string, unknown>) =>
    ipcRenderer.invoke("app:write-log", level, message, details),
  openLogFile: () => ipcRenderer.invoke("app:open-log"),
  pickFiles: (kind: "image" | "audio" | "video" | "json" | "cookies", multiple = false) =>
    ipcRenderer.invoke("app:pick-files", kind, multiple),
  pickDirectory: () => ipcRenderer.invoke("app:pick-directory"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  getAppInfo: () => ipcRenderer.invoke("app:info")
};

contextBridge.exposeInMainWorld("goldWork", api);
