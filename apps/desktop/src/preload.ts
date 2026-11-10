import { contextBridge, ipcRenderer } from "electron";
import type { CreateProjectInput, DesktopApi, LogLevel, UpdateProjectInput } from "@gold-work/shared";

const api: DesktopApi = {
  getAppUpdateState: () => ipcRenderer.invoke("app:update-state"),
  checkAppUpdates: () => ipcRenderer.invoke("app:update-check"),
  installAppUpdate: () => ipcRenderer.invoke("app:update-install"),
  onAppUpdateState: listener => {
    const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state);
    ipcRenderer.on("app:update-state", handler);
    return () => ipcRenderer.removeListener("app:update-state", handler);
  },
  prepareDocumentaryPreview: projectId => ipcRenderer.invoke("documentary:preview", projectId),
  prepareDocumentaryMap: (projectId,place,radiusKm,route) => ipcRenderer.invoke('documentary:map',projectId,place,radiusKm,route),
  prepareDocumentaryEffect: (projectId, assetId) => ipcRenderer.invoke("documentary:effect", projectId, assetId),
  getDocumentaryCandidates: (projectId, sceneId) => ipcRenderer.invoke("documentary:candidates", projectId, sceneId),
  searchDocumentary: (projectId, sceneId, input) => ipcRenderer.invoke("documentary:search", projectId, sceneId, input),
  stageDocumentaryCandidate: (projectId,sceneId,candidateId,fullOriginal) => ipcRenderer.invoke('documentary:stage-candidate',projectId,sceneId,candidateId,fullOriginal),
  stageDocumentaryImport: (projectId,sceneId,input) => ipcRenderer.invoke('documentary:stage-import',projectId,sceneId,input),
  applyDocumentaryStage: (projectId,sceneId,input) => ipcRenderer.invoke('documentary:apply-stage',projectId,sceneId,input),
  applyDocumentaryCandidate: (projectId, sceneId, candidateId) => ipcRenderer.invoke("documentary:apply", projectId, sceneId, candidateId),
  importDocumentaryMaterial: (projectId, sceneId, input) => ipcRenderer.invoke("documentary:import", projectId, sceneId, input),
  reviewDocumentaryMaterial: (projectId, sceneId, input) => ipcRenderer.invoke("documentary:review", projectId, sceneId, input),
  getDocumentaryQueryPlanIssues: projectId => ipcRenderer.invoke('documentary:query-plan-issues',projectId),
  retryDocumentaryQueryPlan: (projectId,sceneId,retryToken) => ipcRenderer.invoke('documentary:retry-query-plan',projectId,sceneId,retryToken),
  retryDocumentaryGemini: (projectId,sceneId) => ipcRenderer.invoke('documentary:retry-gemini',projectId,sceneId),
  getEffectLibrary: () => ipcRenderer.invoke("library:list"),
  chooseEffectFolders: () => ipcRenderer.invoke("library:choose-folders"),
  chooseBackgroundFiles: () => ipcRenderer.invoke("library:choose-background-files"),
  importBackgroundFiles: (paths: string[]) => ipcRenderer.invoke("library:import-background-files", paths),
  importEffectFolders: roots => ipcRenderer.invoke("library:import", roots),
  cancelEffectImport: () => ipcRenderer.invoke("library:cancel"),
  updateEffect: (id, input) => ipcRenderer.invoke("library:update", id, input),
  analyzeEffect: id => ipcRenderer.invoke("library:analyze", id),
  trashEffect: (id, deleted) => ipcRenderer.invoke("library:trash", id, deleted),
  openEffectLibrary: () => ipcRenderer.invoke("library:open"),
  onEffectImportProgress: listener => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress);
    ipcRenderer.on("library:progress", handler);
    return () => ipcRenderer.removeListener("library:progress", handler);
  },
  prepareStoryCharacters: id => ipcRenderer.invoke("projects:cast-prepare", id),
  regenerateStoryCharacter: (id, characterId, prompt) => ipcRenderer.invoke("projects:cast-regenerate", id, characterId, prompt),
  confirmStoryCharacter: (id, characterId) => ipcRenderer.invoke("projects:cast-confirm", id, characterId),
  saveStoryCharacterToChannel: (projectId, characterId) => ipcRenderer.invoke("channels:character-publish", projectId, characterId),
  generateChannelCharacter: (channelId, input) => ipcRenderer.invoke("channels:character-generate", channelId, input),
  selectChannelCharacterVersion: (channelId, versionId) => ipcRenderer.invoke("channels:character-select", channelId, versionId),
  deleteChannelCharacterVersion: (channelId, versionId) => ipcRenderer.invoke("channels:character-delete", channelId, versionId),
  restoreChannelCharacterVersion: (channelId, versionId) => ipcRenderer.invoke("channels:character-restore", channelId, versionId),
  listChannelProfiles: () => ipcRenderer.invoke("channels:list"),
  createChannelProfile: (input) => ipcRenderer.invoke("channels:create", input),
  updateChannelProfile: (id, input) => ipcRenderer.invoke("channels:update", id, input),
  deleteChannelProfile: (id) => ipcRenderer.invoke("channels:delete", id),
  confirmChannelCharacterReference: (projectId, versionId) => ipcRenderer.invoke("channels:character-confirm", projectId, versionId),
  useChannelCharacterReference: (projectId, versionId) => ipcRenderer.invoke("channels:character-use", projectId, versionId),
  listTrash: () => ipcRenderer.invoke("trash:list"),
  restoreTrashItem: (trashId) => ipcRenderer.invoke("trash:restore", trashId),
  purgeTrashItem: (trashId) => ipcRenderer.invoke("trash:purge", trashId),
  listProjects: () => ipcRenderer.invoke("projects:list"),
  getProjectChanges: revision => ipcRenderer.invoke("projects:changes", revision),
  getProject: (id: string) => ipcRenderer.invoke("projects:get", id),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke("projects:create", input),
  cancelDirectorOperation: () => ipcRenderer.invoke("director:cancel-operation"),
  onDirectorProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, stage: string, context?: { projectId?: string; topicId?: string }) => listener(stage, context);
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
  calibrateVoice: (input) => ipcRenderer.invoke("voice:calibrate", input),
  calibrateProjectVoice: (projectId) => ipcRenderer.invoke("projects:calibrate-voice", projectId),
  getGoogleSettings: () => ipcRenderer.invoke("google:get-settings"),
  saveGoogleSettings: (input) => ipcRenderer.invoke("google:save-settings", input),
  clearGoogleKey: () => ipcRenderer.invoke("google:clear-key"),
  testGoogleConnection: () => ipcRenderer.invoke("google:test"),
  getStockSettings: () => ipcRenderer.invoke("stock:get-settings"),
  saveStockSettings: (input) => ipcRenderer.invoke("stock:save-settings", input),
  clearStockKey: (provider) => ipcRenderer.invoke("stock:clear-key", provider),
  testStockConnection: (provider) => ipcRenderer.invoke("stock:test", provider),
  searchStock: (input) => ipcRenderer.invoke("stock:search", input),
  applyStockAsset: (projectId, sceneId, asset) => ipcRenderer.invoke("stock:apply", projectId, sceneId, asset),
  autoSelectStock: (projectId, options) => ipcRenderer.invoke("stock:auto-select", projectId, options),
  refreshDocumentaryMontage: projectId => ipcRenderer.invoke("documentary:refresh-montage", projectId),
  reviseDocumentaryArtwork: (projectId, input) => ipcRenderer.invoke("documentary:revise-artwork", projectId, input),
  onAutoStockProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress);
    ipcRenderer.on("stock:auto-progress", handler);
    return () => ipcRenderer.removeListener("stock:auto-progress", handler);
  },
  listFlowAccounts: () => ipcRenderer.invoke("flow:accounts:list"),
  loginFlowAccount: (input) => ipcRenderer.invoke("flow:accounts:login", input),
  importFlowCookies: (input) => ipcRenderer.invoke("flow:accounts:import-cookies", input),
  refreshFlowAccount: (accountId) => ipcRenderer.invoke("flow:accounts:refresh", accountId),
  refreshAllFlowAccounts: () => ipcRenderer.invoke("flow:accounts:refresh-all"),
  updateFlowAccount: (accountId, input) => ipcRenderer.invoke("flow:accounts:update", accountId, input),
  removeFlowAccount: (accountId) => ipcRenderer.invoke("flow:accounts:remove", accountId),
  openFlowAccount: (accountId) => ipcRenderer.invoke("flow:accounts:open", accountId),
  testFlowAccount: (accountId) => ipcRenderer.invoke("flow:test", accountId),
  onFlowAccountsChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, accounts: Parameters<typeof listener>[0]) => listener(accounts);
    ipcRenderer.on("flow:accounts-changed", handler);
    return () => ipcRenderer.removeListener("flow:accounts-changed", handler);
  },
  onFlowLoginProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress);
    ipcRenderer.on("flow:login-progress", handler);
    return () => ipcRenderer.removeListener("flow:login-progress", handler);
  },
  createCharacterReference: (projectId, input) => ipcRenderer.invoke("projects:character-reference", projectId, input),
  assembleProject: (projectId) => ipcRenderer.invoke("projects:assemble", projectId),
  replanMontage: (projectId) => ipcRenderer.invoke("projects:replan-montage", projectId),
  mediaUrl: (path) => `gw-media://local/${encodeURIComponent(path)}`,
  getYouTubeSettings: () => ipcRenderer.invoke("youtube:get-settings"),
  listTrackedChannels: () => ipcRenderer.invoke("analytics:list"),
  saveTrackedChannel: (input) => ipcRenderer.invoke("analytics:save", input),
  removeTrackedChannel: (id) => ipcRenderer.invoke("analytics:remove", id),
  refreshTrackedChannels: (input) => ipcRenderer.invoke("analytics:refresh", input),
  saveYouTubeSettings: (input) => ipcRenderer.invoke("youtube:save-settings", input),
  clearYouTubeKey: () => ipcRenderer.invoke("youtube:clear-key"),
  testYouTubeConnection: () => ipcRenderer.invoke("youtube:test"),
  prepareProjectScript: (projectId,mode) => ipcRenderer.invoke("projects:prepare-script", projectId,mode),
  updateProject: (id: string, input: UpdateProjectInput) => ipcRenderer.invoke("projects:update", id, input),
  duplicateProject: (id: string) => ipcRenderer.invoke("projects:duplicate", id),
  deleteProject: (id: string) => ipcRenderer.invoke("projects:delete", id),
  getDocumentaryRecovery: projectId => ipcRenderer.invoke('documentary:recovery',projectId),
  choosePixabayMusic: query => ipcRenderer.invoke('music:pixabay',query),
  authorizeDocumentaryRetry: (projectId,requests) => ipcRenderer.invoke('documentary:retry-analysis',projectId,requests),
  probeDocumentaryConnection: () => ipcRenderer.invoke('documentary:probe'),
  getQueue: () => ipcRenderer.invoke("queue:list"),
  startGeneration: (projectId: string, target?: "all" | "narration") => ipcRenderer.invoke("queue:start", projectId, target),
  pauseGeneration: (projectId: string) => ipcRenderer.invoke("queue:pause", projectId),
  resumeGeneration: (projectId: string) => ipcRenderer.invoke("queue:resume", projectId),
  stopGeneration: (projectId: string) => ipcRenderer.invoke("queue:stop", projectId),
  retryTask: (taskId: string) => ipcRenderer.invoke("queue:retry", taskId),
  clearFinishedTasks: () => ipcRenderer.invoke("queue:clear-finished"),
  clearQueue: () => ipcRenderer.invoke("queue:clear-all"),
  regenerateScene: (projectId: string, sceneId: string | string[], target: "image" | "video" | "audio" | "all" = "all") =>
    ipcRenderer.invoke("queue:regenerate-scene", projectId, sceneId, target),
  openProjectFolder: (projectId: string) => ipcRenderer.invoke("projects:open-folder", projectId),
  openSceneFolder: (projectId: string, sceneId: string) => ipcRenderer.invoke("projects:open-scene-folder", projectId, sceneId),
  writeLog: (level: LogLevel, message: string, details?: Record<string, unknown>) =>
    ipcRenderer.invoke("app:write-log", level, message, details),
  readLogs: (limit) => ipcRenderer.invoke("app:read-logs", limit),
  onLogEntry: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: Parameters<typeof listener>[0]) => listener(entry);
    ipcRenderer.on("app:log-entry", handler);
    return () => ipcRenderer.removeListener("app:log-entry", handler);
  },
  openLogFile: () => ipcRenderer.invoke("app:open-log"),
  pickFiles: (kind: "image" | "audio" | "video" | "json" | "cookies", multiple = false) =>
    ipcRenderer.invoke("app:pick-files", kind, multiple),
  importMusic: (path:string)=>ipcRenderer.invoke('app:import-music',path),
  pickCompetitorTranscripts: () => ipcRenderer.invoke("app:pick-competitor-transcripts"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  pickDirectory: () => ipcRenderer.invoke("app:pick-directory"),
  getWorkspaceStorage: () => ipcRenderer.invoke("storage:info"),
  getWorkspaceUsage: (path, refresh) => ipcRenderer.invoke("storage:usage", path, refresh),
  openWorkspaceFolder: path => ipcRenderer.invoke("storage:open", path),
  scheduleWorkspaceMove: path => ipcRenderer.invoke("storage:schedule", path),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  onWindowCloseRequested: (listener, onCancelled) => {
    const handler = (_event: Electron.IpcRendererEvent, requestId: number, reason: "close" | "update") => {
      void Promise.resolve().then(() => listener(requestId, reason)).then(
        allowed => ipcRenderer.send("window:close-result", requestId, allowed),
        () => ipcRenderer.send("window:close-result", requestId, false)
      );
    };
    const cancel = (_event: Electron.IpcRendererEvent, requestId: number) => onCancelled(requestId);
    ipcRenderer.on("window:request-close", handler);
    ipcRenderer.on("window:close-cancelled", cancel);
    return () => {
      ipcRenderer.removeListener("window:request-close", handler);
      ipcRenderer.removeListener("window:close-cancelled", cancel);
    };
  },
  getAppInfo: () => ipcRenderer.invoke("app:info")
};

contextBridge.exposeInMainWorld("goldWork", api);
