import { app, BrowserWindow, dialog, ipcMain, protocol, shell, type IpcMainInvokeEvent } from "electron";
import { randomUUID } from "node:crypto";
import {importDocumentaryMusic} from './documentary-music-import.js';
import {DocumentaryRetryPermissions,listDocumentaryRecovery} from './documentary-retry.js';
import {choosePixabayMusic} from './pixabay-music-window.js';
import type {DocumentaryRecoveryItem} from '@gold-work/shared';
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, normalize, relative } from "node:path";
import { createServer, type Server as HttpServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import { createId, MockDirectorProvider, ProjectService, normalizeProject } from "@gold-work/core";
import {projectResultForDisplay} from './project-display.js';
import { AI_STORY_TARGET_SCENE_SECONDS, allocateAiStorySceneDurations, allocateSceneDurations, channelImageStyle, createNarrationTimingBudget, estimateNarrationDurationSeconds, parseYouTubeChannelRef, prepareCharacterReferencePreview, selectCharacterReference, voiceCalibrationMatches } from "@gold-work/shared";
import { VoicerStore } from "./voicer-store.js";
import { VoicerClient } from "./voicer-client.js";
import { GoogleStore } from "./google-store.js";
import { VeoClient } from "./veo-client.js";
import type { AiChatMessage, AnalyzeReferenceInput, AutoStockProgress, AutoStockSelectionOptions, ChannelCharacterReference, CharacterReferenceRequest, ChatTopic, ConsoleLogEntry, CreateProjectInput, CreateReferenceProjectInput, DesktopApi, FlowAccountPublic, FlowAccountUpdateInput, FlowCookieImportInput, FlowLoginInput, FlowLoginProgress, LogLevel, Project, ReferenceAnalysis, SaveAnyModelSettingsInput, SaveChannelProfileInput, SaveGoogleSettingsInput, SaveStockSettingsInput, SaveVoicerSettingsInput, SaveYouTubeSettingsInput, Scene, StockAsset, StockProvider, TrashItemSummary, UpdateProjectInput, VoiceCalibrationRequest } from "@gold-work/shared";
import { FileProjectRepository } from "./file-project-repository.js";
import { FileTaskRepository } from "./file-task-repository.js";
import { DEFAULT_QUEUE_POLICY, MockGenerationPipeline } from "./mock-generation-pipeline.js";
import { LocalProjectStorage } from "./local-project-storage.js";
import { StandardRenderer } from "./standard-renderer.js";
import { RemotionMontageRenderer } from "./remotion-montage-renderer.js";
import { TextFileLogger } from "./text-file-logger.js";
import { ipcDiagnosticContext, setDiagnosticSink, withDiagnosticContext } from "./diagnostics.js";
import { AnyModelStore } from "./anymodel-store.js";
import { AnyModelClient, resumableScenarioDraft, scenarioFingerprint } from "./anymodel-client.js";
import { createScenarioDraftGuard, scenarioRepairCheckpointPatch } from "./scenario-repair.js";
import { YouTubeClient } from "./youtube-client.js";
import { DocumentaryYouTube } from "./documentary-youtube.js";
import { YouTubeStore } from "./youtube-store.js";
import { ChannelAnalyticsStore } from "./channel-analytics-store.js";
import { createMediaFileResponse } from "./media-range.js";
import { timelineThumbnail } from "./timeline-thumbnail.js";
import { FlowAccountStore } from "./flow-account-store.js";
import { FlowAuthService } from "./flow-auth-service.js";
import { FlowClient } from "./flow-client.js";
import { ChannelProfileStore } from "./channel-profile-store.js";
import { StockStore } from "./stock-store.js";
import { StockClient } from "./stock-client.js";
import { StockProjectService } from "./stock-project-service.js";
import { EffectLibrary } from "./effect-library.js";
import { prepareDocumentaryScript } from "./documentary-plan.js";
import { DocumentarySearch } from "./documentary-search.js";
import { DocumentaryProjectService } from "./documentary-project-service.js";
import { documentaryNarrationReadiness } from "./documentary-production.js";
import { measureDocumentaryStage,startDocumentaryMetrics,finishDocumentaryMetrics } from "./documentary-metrics.js";
import type { QueueTask } from "@gold-work/shared";
import { DocumentaryIntelligence } from "./documentary-intelligence.js";
import { ensureDocumentaryMemory } from "./documentary-resources.js";
import { copyDocumentaryEffect } from "./documentary-effects.js";
import { prepareDocumentaryTiming } from "./documentary-timing.js";
import { prepareDocumentaryImages } from "./documentary-media-cache.js";
import {prepareDocumentaryMap} from './documentary-map.js';
import { atomicWrite } from "./fs-utils.js";
import { moveWorkspaceOnStartup, scheduleWorkspaceMove, workspaceStorageInfo } from "./workspace-storage.js";
import { workspaceUsagePath, workspaceUsageReader } from "./workspace-usage.js";
import { executeDocumentaryCleanup, planDocumentaryCleanup } from "./documentary-cleanup.js";
import { APP_BUILD_CREATED_AT, APP_BUILD_ID } from "./generated-build-identity.js";
import { VoiceCalibrationService } from "./voice-calibration-service.js";
import { StoryCharacterService } from "./story-character-service.js";
import { ChannelCharacterService } from "./channel-character-service.js";
import { readyScriptChannelHeroContext } from "./ready-script.js";

// Flow-сессии с proxy не должны обходить его через прямой WebRTC UDP.
app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");

// __dirname доступен, потому что main собирается в CommonJS (см. electron.vite.config.ts).
const currentDirectory = __dirname;
let projectService: ProjectService;
let projectRepository: FileProjectRepository;
let pipeline: MockGenerationPipeline;
let projectStorage: LocalProjectStorage;
let standardRenderer: StandardRenderer;
let logger: TextFileLogger;
let dataPath: string;
let workspacePath: string;
let anyModelStore: AnyModelStore;
let anyModelClient: AnyModelClient;
let voicerStore: VoicerStore;
let voicerClient: VoicerClient;
let voiceCalibrationService: VoiceCalibrationService;
let googleStore: GoogleStore;
let veoClient: VeoClient;
let flowAccountStore: FlowAccountStore;
let flowAuthService: FlowAuthService;
let flowClient: FlowClient;
let youtubeStore: YouTubeStore;
let youtubeClient: YouTubeClient;
let channelAnalytics: ChannelAnalyticsStore;
let channelProfiles: ChannelProfileStore;
let stockStore: StockStore;
let stockClient: StockClient;
let stockProjectService: StockProjectService;
let effectLibrary: EffectLibrary;
let documentaryService: DocumentaryProjectService;
const documentaryProductions = new Map<string, { controller: AbortController; run: Promise<QueueTask[]> }>();
let realtimeHttpServer: HttpServer;
let realtimeServer: SocketServer;
let realtimeUrl: string;
const activeDirectorOperations = new Map<number, AbortController>();
let storageMoveWindow: BrowserWindow | undefined;
let mainWindow: BrowserWindow | undefined;
let mainWindowWasCreated = false;
const projectRevisions = new Map<string, Map<string, string>>();

function publishToWindows(channel: string, value: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed() || window.webContents.isCrashed()) continue;
    // A frame may disappear between the guard and send. Do not recursively log
    // this secondary error while reporting the original renderer crash.
    try { window.webContents.send(channel, value); } catch { /* window is closing */ }
  }
}

function publishLogEntry(entry: ConsoleLogEntry): void {
  publishToWindows("app:log-entry", entry);
}

function publishFlowAccounts(accounts: FlowAccountPublic[]): void {
  publishToWindows("flow:accounts-changed", accounts);
}

function publishFlowProgress(progress: FlowLoginProgress): void {
  publishToWindows("flow:login-progress", progress);
}

function publishAutoStockProgress(progress: AutoStockProgress): void {
  publishToWindows("stock:auto-progress", progress);
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /\babort(?:ed|ing)?\b/i.test(error.message));
}

const scenarioPreparations = new Set<string>();
let storageMaintenance: Promise<void> | undefined;
let activeWorkspaceRequests = 0;
// These checks only inspect remote connections/account state. In particular,
// a stalled Flow refresh must not retain unused Stock downloads indefinitely.
const independentConnectionChecks = new Set(["anymodel:test", "voicer:test", "voicer:templates", "google:test", "stock:test", "youtube:test", "flow:test", "flow:accounts:refresh", "flow:accounts:refresh-all"]);
let cleanedAssemblyStamp: string | undefined;
function handleIpc<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => withDiagnosticContext(ipcDiagnosticContext(channel, args), async () => {
    await storageMaintenance;
    const started = Date.now();
    const preparationId = ["projects:apply-chat-topic", "projects:prepare-script"].includes(channel) && typeof args[0] === "string" ? args[0] : undefined;
    if (preparationId && scenarioPreparations.has(preparationId)) throw new Error("Этот сценарий уже подготавливается. Другие ролики можно создавать параллельно.");
    if (preparationId) scenarioPreparations.add(preparationId);
    const guardsWorkspace = !independentConnectionChecks.has(channel);
    if (guardsWorkspace) activeWorkspaceRequests++;
    const logRequest = !["projects:list", "projects:changes", "queue:list", "channels:list", "flow:accounts:list", "app:info", "app:write-log"].includes(channel);
    if (logRequest) void logger.write("debug", "ipc.request", { channel, args: summarizeArguments(args) });
    try {
      const result = await anyModelClient.withTextModelFallback(
        async () => handler(event, ...(args as TArgs)),
        (change) => {
          void logger.write("info", "anymodel.model-fallback", { channel, from: change.from, to: change.to });
          if (!event.sender.isDestroyed()) sendDirectorProgress(event, change.message,
            ["projects:apply-chat-topic", "projects:prepare-script"].includes(channel) ? { projectId: args[0] }
              : channel.startsWith("projects:cast-") ? { projectId: args[0] } : undefined);
        }
      );
      if (result && typeof result === "object" && "ok" in result && result.ok === false) {
        void logger.write("warn", "ipc.result_failed", { channel, elapsedMs: Date.now() - started,
          error: "message" in result ? result.message : "Проверка вернула ok: false" });
      } else if (logRequest) void logger.write("debug", "ipc.success", { channel, elapsedMs: Date.now() - started });
      return projectResultForDisplay(result);
    } catch (error) {
      if (isAbortError(error)) void logger.write("info", "ipc.cancelled", { channel, elapsedMs: Date.now() - started });
      else void logger.write("error", "ipc.failed", { channel, elapsedMs: Date.now() - started, error });
      throw error;
    } finally {
      if (guardsWorkspace) activeWorkspaceRequests--;
      if (preparationId) scenarioPreparations.delete(preparationId);
    }
  }));
}

function sendDirectorProgress(event: IpcMainInvokeEvent, stage: string, details?: Record<string, unknown>): void {
  const fallback = anyModelClient.textModelFallbackNotice;
  if (fallback && stage !== fallback) stage = `${fallback}\n${stage}`;
  event.sender.send("director:progress", stage, details);
  void logger.write("info", "director.progress", { stage, ...details });
}

async function runDirectorOperation<TResult>(
  event: IpcMainInvokeEvent,
  operation: (signal: AbortSignal) => Promise<TResult>
): Promise<TResult> {
  const senderId = event.sender.id;
  activeDirectorOperations.get(senderId)?.abort();
  const controller = new AbortController();
  activeDirectorOperations.set(senderId, controller);
  try {
    return await operation(controller.signal);
  } finally {
    if (activeDirectorOperations.get(senderId) === controller) activeDirectorOperations.delete(senderId);
  }
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

async function applyChannelProfileDefaults(project: Project, channelProfileId?: string): Promise<Project> {
  const profile = channelProfileId ? await channelProfiles.get(channelProfileId) : undefined;
  if (!profile) return project;
  const mediaMode = profile.direction === "ai-story" ? "ai" : "stock";
  return projectService.update(project.id, {
    language: profile.languageLabel,
    mediaMode,
    motionTemplate: profile.motionTemplate,
    settings: {
      ...project.settings,
      durationMinutes: profile.defaultDurationMinutes,
      image: { ...project.settings.image, style: channelImageStyle(profile, project.settings.image.style) },
      voice: {
        ...project.settings.voice,
        provider: profile.lumeanTemplateUuid ? "elevenlabs" : project.settings.voice.provider,
        voice: profile.lumeanTemplateUuid || project.settings.voice.voice,
        singleTrack: mediaMode !== "stock" && Boolean(profile.lumeanTemplateUuid)
      },
      video: {
        ...project.settings.video,
        enabled: mediaMode === "ai"
      },
      subtitles: { ...project.settings.subtitles, enabled: false }
    }
  });
}

function registerIpc(): void {
  const retryPermissions=new DocumentaryRetryPermissions();
  handleIpc('music:pixabay',(_event,query:string)=>choosePixabayMusic(join(workspacePath,'Materials','Music'),typeof query==='string'?query:''));
  handleIpc('documentary:probe',()=>anyModelClient.probeDocumentaryConnection());
  handleIpc('documentary:recovery',async(_event,projectId:string)=>{
    if(!await projectService.get(projectId,{omitCandidates:true}))throw Error('Проект не найден');
    return listDocumentaryRecovery(projectStorage.projectDirectory(projectId));
  });
  handleIpc('documentary:retry-analysis',async(_event,projectId:string,requests:DocumentaryRecoveryItem[])=>{
    if(!await projectService.get(projectId,{omitCandidates:true}))throw Error('Проект не найден');
    if(documentaryProductions.has(projectId)||documentaryService.isSelecting(projectId)||(await pipeline.list()).some(t=>t.projectId===projectId&&['running','pending','retry_wait'].includes(t.status)))
      throw Error('Сначала дождитесь остановки текущего производства.');
    return retryPermissions.authorize(projectStorage.projectDirectory(projectId),requests);
  });
  const storyCharacters = new StoryCharacterService({
    get: id => projectService.get(id),
    mutate: async (id, patch) => {
      const updated = await projectService.mutate(id, patch);
      await projectStorage.ensureProject(updated);
      return updated;
    },
  }, anyModelClient, projectStorage, async (project, prompt, recovery) => {
    if (project.mediaMode === 'ai' || recovery.resumeJob || project.settings.image.provider === "flow" || project.settings.image.provider === "mock-image") {
      if (!await flowClient.configured("image")) throw new Error("Google Flow недоступен. Подключите аккаунт и повторите создание этого образа.");
      return flowClient.generateImage({ prompt, aspectRatio: "1:1", ...recovery });
    }
    return anyModelClient.generateImage(prompt, "1024x1024");
  });
  handleIpc("projects:cast-prepare", (event, id: string) => storyCharacters.prepare(id, message => sendDirectorProgress(event, message, { projectId: id })));
  handleIpc("projects:cast-regenerate", (_event, id: string, characterId: string, prompt: string) => storyCharacters.regenerate(id, characterId, prompt));
  handleIpc("projects:cast-confirm", (_event, id: string, characterId: string) => storyCharacters.confirm(id, characterId));
  const channelCharacters = new ChannelCharacterService(channelProfiles, projectService, projectStorage,
    (prompt, style, recovery) => anyModelClient.generateStoryCharacterPortrait(prompt, style, async fullPrompt => {
      if (!await flowClient.configured("image")) throw new Error("Google Flow недоступен. Подключите аккаунт и повторите создание образа.");
      return flowClient.generateImage({ prompt: fullPrompt, aspectRatio: "1:1", ...recovery });
    }));
  handleIpc("channels:character-publish", (_event, projectId: string, characterId: string) => channelCharacters.publish(projectId, characterId));
  handleIpc("channels:character-generate", (_event, channelId: string, input: import("@gold-work/shared").ChannelCharacterGenerationInput) => channelCharacters.generate(channelId, input));
  handleIpc("channels:character-select", (_event, channelId: string, versionId: string) => channelCharacters.select(channelId, versionId));
  handleIpc("channels:character-delete", (_event, channelId: string, versionId: string) => channelCharacters.remove(channelId, versionId));
  handleIpc("channels:character-restore", (_event, channelId: string, versionId: string) => channelCharacters.restore(channelId, versionId));
  handleIpc("channels:list", () => channelProfiles.list());
  handleIpc("channels:create", (_event, input: SaveChannelProfileInput) => channelProfiles.create(input));
  handleIpc("channels:update", (_event, id: string, input: SaveChannelProfileInput) => channelProfiles.update(id, input));
  handleIpc("channels:delete", async (_event, id: string) => {
    const relatedProjectCount = (await projectService.list()).filter((project) => project.channelProfileId === id).length;
    const entry = await channelProfiles.moveToTrash(id);
    return ChannelProfileStore.trashSummary(entry, relatedProjectCount);
  });
  handleIpc("trash:list", async () => {
    const [channelEntries, projectEntries, activeProjects, trashedProjects] = await Promise.all([
      channelProfiles.listTrash(),
      projectRepository.listTrash(),
      projectService.list(),
      projectRepository.listTrash()
    ]);
    const channelItems = channelEntries.map((entry) => ChannelProfileStore.trashSummary(
      entry,
      [...activeProjects, ...trashedProjects.map((item) => item.project)]
        .filter((project) => project.channelProfileId === entry.profile.id).length
    ));
    const projectItems: TrashItemSummary[] = projectEntries.map((entry) => ({
      trashId: entry.trashId,
      kind: "project",
      originalId: entry.project.id,
      title: entry.project.title,
      deletedAt: entry.deletedAt
    }));
    return [...channelItems, ...projectItems].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  });
  handleIpc("trash:restore", async (_event, trashId: string) => {
    if ((await channelProfiles.listTrash()).some((entry) => entry.trashId === trashId)) {
      await channelProfiles.restore(trashId);
      return;
    }
    const entry = (await projectRepository.listTrash()).find((item) => item.trashId === trashId);
    if (!entry) throw new Error("Запись в корзине не найдена");
    const filesRestored = await projectStorage.restoreProjectFromTrash(entry.project.id, trashId);
    try {
      await projectRepository.restore(trashId);
    } catch (error) {
      if (filesRestored) await projectStorage.moveProjectToTrash(entry.project.id, trashId).catch(() => undefined);
      throw error;
    }
  });
  handleIpc("trash:purge", async (_event, trashId: string) => {
    if ((await channelProfiles.listTrash()).some((entry) => entry.trashId === trashId)) {
      await channelProfiles.purge(trashId);
      return;
    }
    const entry = (await projectRepository.listTrash()).find((item) => item.trashId === trashId);
    if (!entry) throw new Error("Запись в корзине не найдена");
    await projectStorage.purgeTrashedProject(trashId);
    await projectRepository.purge(trashId);
  });
  handleIpc("projects:list", async () => Promise.all((await projectRepository.listForDisplay()).projects.map(normalizeProject).map(withRecoveredFinal)) as Promise<Project[]>);
  handleIpc("projects:changes", async (_event, previous?: string) => {
    const file = await stat(join(dataPath, "projects.json"), { bigint: true }).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
    const revision = file ? `${file.mtimeNs}:${file.size}` : "missing";
    if (previous === revision) return { revision };
    const baseline = previous ? projectRevisions.get(previous) : undefined;
    const display = await projectRepository.listForDisplay(baseline);
    const projects = await Promise.all(display.projects.map(normalizeProject).map(withRecoveredFinal)) as Project[];
    projectRevisions.set(revision, display.versions);
    if (projectRevisions.size > 3) projectRevisions.delete(projectRevisions.keys().next().value!);
    return { revision, projects, ...(baseline ? { projectIds: [...display.versions.keys()] } : {}) };
  });
  handleIpc("projects:get", async (_event, id: string) => withRecoveredFinal(await projectService.get(id,{omitCandidates:true})));
  handleIpc("projects:create", async (_event, input: CreateProjectInput) => {
    const created = await projectService.create(input);
    return applyChannelProfileDefaults(created, input.channelProfileId);
  });
  handleIpc("director:cancel-operation", (event) => {
    const controller = activeDirectorOperations.get(event.sender.id);
    if (!controller) return false;
    controller.abort();
    sendDirectorProgress(event, "Операция остановлена пользователем");
    return true;
  });
  // Scenario authorship and reference-analysis chat have been retired. Existing projects remain readable.
  handleIpc("projects:update", (_event, id: string, input: UpdateProjectInput) => projectService.update(id, input));
  handleIpc("projects:duplicate", (_event, id: string) => projectService.duplicate(id));
  handleIpc("projects:delete", async (_event, id: string) => {
    await pipeline.removeProject(id);
    const entry = await projectRepository.moveToTrash(id);
    try {
      await projectStorage.moveProjectToTrash(id, entry.trashId);
    } catch (error) {
      await projectRepository.restore(entry.trashId).catch(() => undefined);
      throw error;
    }
    return {
      trashId: entry.trashId,
      kind: "project",
      originalId: entry.project.id,
      title: entry.project.title,
      deletedAt: entry.deletedAt
    } satisfies TrashItemSummary;
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
  handleIpc("queue:start", async (_event, projectId: string, target: "all" | "narration" = "all") => {
    if (target !== "all" && target !== "narration") throw new Error("Неизвестный этап производства");
    const project = await projectService.get(projectId, { omitCandidates: true });
    if (target === "narration") return mutateQueue(() => pipeline.start(projectId, target));
    if (project?.mediaMode === "stock" && project.settings.assembly.documentary?.version === 2) {
      const active = documentaryProductions.get(projectId);
      if (active) return active.run;
      const controller = new AbortController();
      const run = (async () => {
        try {
          await startDocumentaryMetrics(projectId,projectStorage.projectDirectory(projectId));
          // A previous Final is not the result of the new production. This also
          // covers warm runs where narration has nothing left to enqueue.
          await projectService.update(projectId, { outputPath: undefined, lastRender: undefined });
          // Resolve the search plan before launching workers. Search/download/
          // source analysis then overlap TTS; only range selection waits for
          // that scene's measured voice. Existing paid voices are reused.
          await measureDocumentaryStage("planning", { projectId }, () => documentaryService.planSearch(projectId));
          controller.signal.throwIfAborted();
          await projectService.update(projectId, { status: "generating" });
          const tasks = project.settings.voice.enabled ? await mutateQueue(() => pipeline.start(projectId, "narration")) : [];
          controller.signal.throwIfAborted();
          const waitForNarration = documentaryNarrationReadiness({ projectId, projects: projectService, storage: projectStorage,
            tasks, list: () => pipeline.list(), signal: controller.signal });
          const result = await documentaryService.autoSelect(projectId, {}, waitForNarration);
          controller.signal.throwIfAborted();
          if (result.failed) throw new Error(`Не подтверждены сцены: ${[...new Set(result.failures.map(f=>f.sceneNumber).filter(n=>n>0))].map(n=>`№${n}`).join(', ') || 'проверьте долю видео'}. Причины сохранены в материалах. Остальные кадры готовы и будут сохранены при продолжении.`);
          await waitForNarration();
          controller.signal.throwIfAborted();
          return await mutateQueue(() => pipeline.start(projectId));
        } catch (error) {
          controller.abort();
          await Promise.all([documentaryService.stop(projectId), mutateQueue(() => pipeline.stopAfterDraining(projectId))]);
          await finishDocumentaryMetrics(projectId,isAbortError(error)?'cancelled':'failed');
          await projectService.update(projectId, { status: isAbortError(error) ? "ready" : "failed" });
          if (isAbortError(error)) return (await pipeline.list()).filter(task => task.projectId === projectId);
          throw error;
        } finally { documentaryProductions.delete(projectId); }
      })();
      documentaryProductions.set(projectId, { controller, run });
      return run;
    }
    return mutateQueue(() => pipeline.start(projectId));
  });
  handleIpc("queue:pause", (_event, projectId: string) => mutateQueue(() => pipeline.pause(projectId)));
  handleIpc("queue:resume", (_event, projectId: string) => mutateQueue(() => pipeline.resume(projectId)));
  handleIpc("queue:stop", async (_event, projectId: string) => {
    const active = documentaryProductions.get(projectId);
    if (active) {
      active.controller.abort();
      await Promise.all([documentaryService.stop(projectId), mutateQueue(() => pipeline.stopAfterDraining(projectId))]);
      await active.run.catch(() => {});
      return (await pipeline.list()).filter(task => task.projectId === projectId);
    }
    await documentaryService.stop(projectId);
    return mutateQueue(() => pipeline.stop(projectId));
  });
  handleIpc("queue:retry", (_event, taskId: string) => mutateQueue(() => pipeline.retry(taskId)));
  handleIpc("queue:regenerate-scene", (_event, projectId: string, sceneId: string | string[], target?: "image" | "video" | "audio" | "all") =>
    mutateQueue(() => pipeline.regenerateScene(projectId, sceneId, target))
  );
  handleIpc("queue:clear-finished", () => mutateQueue(() => pipeline.clearFinished()));
  handleIpc("queue:clear-all", () => mutateQueue(() => pipeline.clearAll()));
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
  handleIpc('app:import-music',async(_event,path:string)=>importDocumentaryMusic(path,join(workspacePath,'Materials','Music')));
  handleIpc("app:pick-competitor-transcripts", async () => {
    const result = await dialog.showOpenDialog({
      title: "Выберите TXT-транскрипции роликов конкурентов",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Транскрипции TXT", extensions: ["txt"] }]
    });
    if (result.canceled) return [];
    return Promise.all(result.filePaths.map(async (path) => {
      const info = await stat(path);
      if (info.size > 5 * 1024 * 1024) throw new Error(`Файл ${basename(path)} больше 5 МБ`);
      return {
        id: createId("transcript"),
        name: basename(path),
        text: (await readFile(path, "utf8")).replace(/^﻿/, "").trim()
      };
    }));
  });
  handleIpc("app:open-external", async (_event, value: string) => {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Можно открыть только HTTP/HTTPS-ссылку");
    await shell.openExternal(url.toString());
  });
  handleIpc("app:pick-directory", async () => {
    const result = await dialog.showOpenDialog({
      title: "Выберите рабочую папку",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
  handleIpc("storage:info", () => workspaceStorageInfo(dataPath));
  const readUsage = workspaceUsageReader(workspacePath);
  handleIpc("storage:usage", (_event, path?: string, refresh?: boolean) => readUsage(path, refresh));
  handleIpc("storage:open", async (_event, path?: string) => {
    const directory = workspaceUsagePath(workspacePath, path);
    if (!(await stat(directory)).isDirectory()) throw new Error("Выберите папку");
    const error = await shell.openPath(directory); if (error) throw new Error(error);
  });
  handleIpc("storage:schedule", (_event, path?: string) => scheduleWorkspaceMove(dataPath, path));
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
  handleIpc("voice:calibrate", (_event, input: VoiceCalibrationRequest) =>
    voiceCalibrationService.calibrate(input)
  );
  handleIpc("projects:calibrate-voice", async (_event, projectId: string) => {
    const project = await projectService.get(projectId);
    if (!project) throw new Error("Проект не найден");
    if (project.status === "generating" || project.status === "paused") {
      throw new Error("Нельзя менять голос во время генерации. Сначала остановите очередь.");
    }
    if (!project.settings.voice.enabled) throw new Error("Сначала включите озвучку и выберите голос");
    const sample = await voiceCalibrationService.calibrate({
      provider: project.settings.voice.provider,
      voice: project.settings.voice.voice,
      language: project.language
    });
    const updated = await projectService.mutate(projectId, (current) => {
      if (!voiceCalibrationMatches(
        sample.calibration,
        current.settings.voice.provider,
        current.settings.voice.voice,
        current.language
      )) {
        throw new Error("Голос или язык изменился во время проверки. Запустите тест голоса ещё раз.");
      }
      return {
        settings: {
          ...current.settings,
          voice: { ...current.settings.voice, calibration: sample.calibration }
        }
      };
    });
    void logger.write("info", "voice.calibrated", {
      projectId,
      provider: sample.calibration.provider,
      languageCode: sample.calibration.languageCode,
      charactersPerSecond: sample.calibration.charactersPerSecond,
      wordsPerMinute: sample.calibration.wordsPerMinute
    });
    return { ...sample, project: updated };
  });
  handleIpc("google:get-settings", () => googleStore.publicSettings());
  handleIpc("google:save-settings", (_event, input: SaveGoogleSettingsInput) => googleStore.save(input));
  handleIpc("google:clear-key", () => googleStore.clearKey());
  handleIpc("google:test", () => veoClient.test());
  handleIpc("stock:get-settings", () => stockStore.publicSettings());
  handleIpc("library:list", () => effectLibrary.snapshot());
  const effectReviews = new Map<string, Promise<{ suitable: boolean; description: string }>>();
  handleIpc("library:analyze", async (_event, id: string) => {
    const current = effectReviews.get(id); if (current) return current;
    const run = (async () => {
      const asset = (await effectLibrary.snapshot()).assets.find(asset => asset.id === id && asset.state === "ready" && !asset.deletedAt);
      if (!asset) throw new Error("Эффект не найден");
      return new DocumentaryIntelligence(anyModelClient, () => effectLibrary.rootPath, ensureDocumentaryMemory).inspectEffect(asset, effectLibrary.rootPath);
    })();
    effectReviews.set(id, run);
    try { return await run; } finally { effectReviews.delete(id); }
  });
  handleIpc("library:choose-folders", async () => {
    const result = await dialog.showOpenDialog({ title: "Добавить папки в библиотеку эффектов", properties: ["openDirectory", "multiSelections"] });
    return result.canceled ? [] : result.filePaths;
  });
  handleIpc("library:import", (_event, roots: string[]) => effectLibrary.startImport(roots));
  handleIpc("library:cancel", () => effectLibrary.cancel());
  handleIpc("library:update", (_event, id: string, input: Parameters<EffectLibrary["update"]>[1]) => effectLibrary.update(id, input));
  handleIpc("library:trash", (_event, id: string, deleted: boolean) => effectLibrary.trash(id, deleted));
  handleIpc("library:open", async () => { await effectLibrary.snapshot(); await shell.openPath(effectLibrary.rootPath); });
  handleIpc("stock:save-settings", (_event, input: SaveStockSettingsInput) => stockStore.save(input));
  handleIpc("stock:clear-key", (_event, provider: StockProvider) => stockStore.clearKey(provider));
  handleIpc("stock:test", async (_event, provider: StockProvider) => {
    const result = await stockClient.test(provider);
    const settings = await stockStore.recordTest(provider, result);
    return { provider, ...result, status: settings.providers[provider] };
  });
  handleIpc("stock:search", (_event, input: Parameters<StockClient["search"]>[0]) => stockClient.search(input));
  handleIpc("stock:apply", (_event, projectId: string, sceneId: string, asset: StockAsset) =>
    stockProjectService.applyAsset(projectId, sceneId, asset)
  );
  handleIpc("stock:auto-select", async (_event, projectId: string, options?: AutoStockSelectionOptions) =>
    (await projectService.get(projectId))?.settings.assembly.documentary?.version === 2
      ? documentaryService.autoSelect(projectId, options) : stockProjectService.autoSelect(projectId, options)
  );
  handleIpc("documentary:search", (_event, projectId: string, sceneId: string, input: Parameters<DesktopApi["searchDocumentary"]>[2]) => documentaryService.search(projectId, sceneId, input));
  handleIpc("documentary:refresh-montage", async (_event, projectId: string) => {
    await documentaryService.refreshMontage(projectId);
    return projectService.get(projectId,{omitCandidates:true});
  });
  handleIpc("documentary:candidates", async (_event, projectId: string, sceneId: string) =>
    (await projectService.get(projectId))?.scenes.find(scene => scene.id === sceneId)?.documentary?.candidates ?? []);
  handleIpc("documentary:apply", (_event, projectId: string, sceneId: string, candidateId: string) => documentaryService.applyCandidate(projectId, sceneId, candidateId));
  handleIpc("documentary:import", (_event, projectId: string, sceneId: string, input: Parameters<DesktopApi["importDocumentaryMaterial"]>[2]) => documentaryService.importMaterial(projectId, sceneId, input));
  handleIpc("documentary:review", (_event, projectId: string, sceneId: string, input: Parameters<DesktopApi["reviewDocumentaryMaterial"]>[2]) => documentaryService.review(projectId, sceneId, input));
  const documentaryPreviewRuns = new Map<string, Promise<Project>>();
  handleIpc('documentary:map',async(_event,projectId:string,place:Parameters<DesktopApi['prepareDocumentaryMap']>[1],radiusKm?:number,route?:Parameters<DesktopApi['prepareDocumentaryMap']>[3])=>{
    const project=await projectService.get(projectId);
    if(project?.mediaMode!=='stock')throw new Error('Откройте Stock проект');
    return prepareDocumentaryMap(projectStorage.projectDirectory(projectId),place,radiusKm,route);
  });
  handleIpc("documentary:preview", async (_event, projectId: string) => {
    const previous = documentaryPreviewRuns.get(projectId);
    if (previous) return previous;
    const run = (async () => {
      const project = await projectService.get(projectId);
      if (project?.mediaMode !== "stock" || project.settings.assembly.documentary?.version !== 2) throw new Error("Откройте Stock Documentary v2");
      if (project.status === "generating" || project.status === "paused") throw new Error("Озвучка ещё готовится");
      const timed = await prepareDocumentaryTiming(project, projectStorage);
      const prepared = await prepareDocumentaryImages(projectStorage.projectDirectory(project.id), timed);
      const updated = await projectService.mutate(projectId, current => {
        if (current.status === "generating" || current.status === "paused") throw new Error("Производство уже началось");
        return { scenes: current.scenes.map(scene => {
          const source = project.scenes.find(item => item.id === scene.id);
          const frame = prepared.find(item => item.id === scene.id);
          const timing = frame?.documentary?.timing;
          const sameRange = source?.imagePath === scene.imagePath && source?.videoPath === scene.videoPath && source?.trimStartSeconds === scene.trimStartSeconds && source?.trimEndSeconds === scene.trimEndSeconds;
          return scene.documentary && source?.audioPath === scene.audioPath && JSON.stringify(source?.narrationSlice) === JSON.stringify(scene.narrationSlice) && source?.durationOverrideSeconds === scene.durationOverrideSeconds
            ? { ...scene, imagePath: sameRange ? frame?.imagePath : scene.imagePath, documentary: { ...scene.documentary, timing,
              visualReview: sameRange && scene.documentary.visualReview ? { ...scene.documentary.visualReview, frameHash: frame?.documentary?.visualReview?.frameHash } : scene.documentary.visualReview } } : scene;
        }) };
      });
      await projectStorage.ensureProject(updated);
      return updated;
    })();
    documentaryPreviewRuns.set(projectId, run);
    try { return await run; } finally { documentaryPreviewRuns.delete(projectId); }
  });
  handleIpc("documentary:effect", async (_event, projectId: string, assetId: string): ReturnType<DesktopApi["prepareDocumentaryEffect"]> => {
    const project = await projectService.get(projectId);
    if (project?.mediaMode !== "stock" || project.settings.assembly.documentary?.version !== 2) throw new Error("Откройте Stock Documentary v2");
    if (project.status === "generating" || project.status === "paused") throw new Error("Сначала остановите производство");
    return copyDocumentaryEffect(effectLibrary, projectStorage, projectId, assetId);
  });
  handleIpc("flow:accounts:list", () => flowAuthService.list());
  handleIpc("flow:accounts:login", (_event, input?: FlowLoginInput) => flowAuthService.login(input));
  handleIpc("flow:accounts:import-cookies", (_event, input: FlowCookieImportInput) => flowAuthService.importCookies(input));
  handleIpc("flow:accounts:refresh", (_event, accountId: string) => flowAuthService.refresh(accountId));
  handleIpc("flow:accounts:refresh-all", () => flowAuthService.refreshAll());
  handleIpc("flow:accounts:update", (_event, accountId: string, input: FlowAccountUpdateInput) => flowAuthService.update(accountId, input));
  handleIpc("flow:accounts:remove", (_event, accountId: string) => flowAuthService.remove(accountId));
  handleIpc("flow:accounts:open", (_event, accountId: string) => flowAuthService.open(accountId));
  handleIpc("flow:test", (_event, accountId?: string) => flowClient.test(accountId));
  handleIpc("projects:assemble", (_event, projectId: string) => pipeline.assembleOnly(projectId));
  handleIpc("projects:character-reference", async (event, projectId: string, input?: CharacterReferenceRequest) => {
    const project = await projectService.get(projectId);
    if (!project) throw new Error("Проект не найден");
    if (project.status === "generating" || project.status === "paused") throw new Error("Сначала остановите или завершите генерацию — менять героя во время производства нельзя");
    if (project.scenes.length === 0) throw new Error("Сначала соберите сценарий — герой описывается по сценам");
    if (!await anyModelClient.configured()) throw new Error("Подключите AnyModel API в настройках");
    sendDirectorProgress(event, "Референс героя: описываю внешность по сценарию…", { projectId });
    const requestedFlow = project.mediaMode === 'ai' || project.settings.image.provider === "flow";
    const canUseFlowAsDefault = project.mediaMode !== "stock" && project.settings.image.provider === "mock-image";
    const flowReady = requestedFlow || canUseFlowAsDefault
      ? await flowClient.configured("image").catch(() => false)
      : false;
    // Новый AI-проект попадает к референсу раньше настроек и ещё может хранить
    // технический mock-image. В этом случае берём уже подключённый Flow, иначе
    // пользователь снова получит старую ошибку AnyModel при первом образе героя.
    const useFlow = requestedFlow || (canUseFlowAsDefault && flowReady);
    if (requestedFlow && !flowReady) throw new Error("Google Flow недоступен — проверьте аккаунт и прокси перед созданием референса.");
    const stylePrompt = input?.stylePrompt?.trim().slice(0, 2_000) || project.settings.image.style.trim();
    const characterPrompt = input?.characterPrompt?.trim().slice(0, 4_000) || undefined;
    const referenceProject: Project = {
      ...project,
      settings: {
        ...project.settings,
        image: { ...project.settings.image, style: stylePrompt }
      }
    };
    const hero = await anyModelClient.characterReference(
      referenceProject,
      (stage) => sendDirectorProgress(event, stage, { projectId }),
      useFlow ? (prompt) => flowClient.generateImage({ prompt, aspectRatio: "1:1" }) : undefined,
      characterPrompt
    );
    const updatedAt = new Date().toISOString();
    const characterMetadata = {
      name: hero.name,
      prompt: hero.prompt,
      characterPrompt: characterPrompt || hero.prompt,
      stylePrompt,
      updatedAt
    };
    let character: NonNullable<Project["characterReference"]>;
    if (project.channelProfileId) {
      const profile = await channelProfiles.get(project.channelProfileId);
      if (!profile) throw new Error("Канал проекта не найден");
      if (profile.direction !== "ai-story") throw new Error("Бренд-персонаж доступен только для AI Story");
      const versionId = randomUUID();
      const path = await projectStorage.saveChannelCharacterReference(project.channelProfileId, versionId, hero.image, {
        ...characterMetadata,
        sourceProjectId: project.id
      });
      const channelCharacter: ChannelCharacterReference = {
        ...characterMetadata,
        imagePath: path,
        versionId,
        channelProfileId: project.channelProfileId,
        sourceProjectId: project.id,
        createdAt: updatedAt
      };
      character = channelCharacter;
      await channelProfiles.addCharacterVersion(project.channelProfileId, channelCharacter);
    } else {
      const path = await projectStorage.saveCharacterReference(project, hero.image, characterMetadata);
      character = { ...characterMetadata, imagePath: path };
    }
    void logger.write("info", "project.character_reference.created", { projectId, hero: hero.name });
    const updated = await projectService.mutate(project.id, current => prepareCharacterReferencePreview(
      current, character, stylePrompt, useFlow && current.settings.image.provider === "mock-image" ? "flow" : current.settings.image.provider));
    await projectStorage.ensureProject(updated);
    return {
      project: updated,
      character
    };
  });
  handleIpc("channels:character-confirm", async (_event, projectId: string, versionId: string) => {
    const project = await projectService.get(projectId);
    if (!project?.channelProfileId) throw new Error("Проект не привязан к каналу");
    if (project.status === "generating" || project.status === "paused") throw new Error("Сначала остановите или завершите генерацию — менять героя во время производства нельзя");
    const profile = await channelProfiles.confirmCharacterVersion(project.channelProfileId, versionId);
    const character = profile.primaryCharacter;
    if (!character) throw new Error("Не удалось подтвердить героя канала");
    const updated = await projectService.mutate(project.id, (current) =>
      selectCharacterReference(current, character, profile.characterVersions.map(version => version.imagePath)));
    await projectStorage.ensureProject(updated);
    return { project: updated, character };
  });
  handleIpc("channels:character-use", async (_event, projectId: string, versionId?: string) => {
    const project = await projectService.get(projectId);
    if (!project?.channelProfileId) throw new Error("Проект не привязан к каналу");
    const profile = await channelProfiles.get(project.channelProfileId);
    if (!profile) throw new Error("Канал проекта не найден");
    const character = versionId
      ? profile.characterVersions.find((item) => item.versionId === versionId)
      : profile.primaryCharacter;
    if (!character) throw new Error("В этом канале ещё нет подтверждённого героя");
    const updated = await projectService.mutate(project.id, (current) =>
      selectCharacterReference(current, character, profile.characterVersions.map(version => version.imagePath)));
    await projectStorage.ensureProject(updated);
    return { project: updated, character };
  });
  handleIpc("projects:replan-montage", async (_event, projectId: string) => {
    const project = await projectService.get(projectId);
    if (!project) throw new Error("Проект не найден");
    if (project.status === "generating" || project.status === "paused") {
      throw new Error("Сначала остановите или завершите текущую генерацию");
    }
    if (project.scenes.length === 0) throw new Error("Сначала создайте сценарий");
    const beforeFingerprint = scenarioFingerprint(project.scenes);
    const montageSettings = project.settings.assembly.montage;
    const requestedPlanner = montageSettings?.planner ?? "ai-bounded";
    const modelId = project.referenceAnalysis?.modelId || project.settings.script.model;
    const planned = await anyModelClient.replanMontage(project.scenes, requestedPlanner, modelId, undefined, {
      density: montageSettings?.density,
      graphicBeatPercent: montageSettings?.graphicBeatPercent,
      hardCutPercent: montageSettings?.hardCutPercent,
    });
    const current = await projectService.get(projectId);
    if (!current || scenarioFingerprint(current.scenes) !== beforeFingerprint) {
      throw new Error("Сценарий изменился во время планирования. Повторите создание плана монтажа.");
    }
    const updated = await projectService.update(projectId, {
      scenes: planned.scenes,
      montagePlan: planned.summary,
      outputPath: undefined,
      lastRender: undefined
    });
    await projectStorage.ensureProject(updated);
    void logger.write("info", "montage.replanned", {
      projectId,
      requestedPlanner,
      usedPlanner: planned.summary.usedPlanner,
      visualBeats: planned.summary.visualBeatCount,
      templates: planned.summary.templates,
      modelId: planned.summary.modelId
    });
    return updated;
  });
  ipcMain.handle("app:read-logs", (_event, limit?: number) => logger.readRecent(limit));
  handleIpc("youtube:get-settings", () => youtubeStore.publicSettings());
  handleIpc("youtube:save-settings", (_event, input: SaveYouTubeSettingsInput) => youtubeStore.save(input));
  handleIpc("youtube:clear-key", () => youtubeStore.clearKey());
  handleIpc("youtube:test", () => youtubeClient.test());
  handleIpc("analytics:list", () => channelAnalytics.list());
  handleIpc("analytics:save", (_event, input: Parameters<DesktopApi["saveTrackedChannel"]>[0]) => channelAnalytics.save(input));
  handleIpc("analytics:remove", (_event, id: string) => channelAnalytics.remove(id));
  handleIpc("analytics:refresh", (_event, input: Parameters<DesktopApi["refreshTrackedChannels"]>[0]) => channelAnalytics.refresh(input));
  // Historical chat records remain on disk; there are no writable chat/generation endpoints.
  const prepareProjectScript = async (event: Electron.IpcMainInvokeEvent, projectId: string) => {
    const storedProject = await projectService.get(projectId);
    if (!storedProject) throw new Error("Проект не найден");
    const topicId = storedProject.chatTopicId;
    const modelId = (await anyModelStore.publicSettings()).textModel;
    if (storedProject.status === "generating" || storedProject.status === "paused") {
      throw new Error("Нельзя пересобирать сценарий во время генерации. Сначала остановите очередь.");
    }
    let project = storedProject;
    if (!project.settings.voice.enabled || !project.settings.voice.voice.trim()) {
      throw new Error("Перед разбивкой сценария выберите голос и запустите тестовую озвучку");
    }
    if (!voiceCalibrationMatches(
      project.settings.voice.calibration,
      project.settings.voice.provider,
      project.settings.voice.voice,
      project.language
    )) {
      throw new Error("Перед разбивкой сценария прослушайте тестовую фразу выбранного голоса — по ней программа рассчитает точную длину текста");
    }
    const calibration = project.settings.voice.calibration;
    const readyScriptMode = project.videoBrief?.creationMode === "script";
    if (!readyScriptMode) throw new Error("Написание сценариев отключено. Вставьте готовый текст на этапе «Задание». Существующие сцены сохранены.");
    const readyScript = readyScriptMode ? project.videoBrief?.readyScript ?? "" : "";
    if (readyScriptMode && !readyScript.trim()) {
      throw new Error("Готовый сценарий пуст. Вернитесь к созданию видео и вставьте текст озвучки");
    }
    const readyScriptSeconds = readyScriptMode
      ? estimateNarrationDurationSeconds(readyScript, calibration)
      : 0;
    if (readyScriptMode && readyScriptSeconds > 120 * 60) {
      throw new Error("Готовый сценарий длиннее 120 минут. Разделите его на несколько роликов");
    }
    if (readyScriptMode) {
      const estimatedMinutes = Math.max(0.5, Math.round(readyScriptSeconds / 60 * 1_000) / 1_000);
      project = await projectService.mutate(projectId, (current) => ({
        settings: { ...current.settings, durationMinutes: estimatedMinutes }
      }));
    }
    const targetSeconds = readyScriptMode
      ? Math.max(1, readyScriptSeconds)
      : Math.max(30, Math.round((project.settings.durationMinutes || 1) * 60));
    const sceneTiming = project.mediaMode === "stock" ? "legacy" as const : "ai-story" as const;
    const montagePlanner = project.settings.assembly.montage?.enabled === false
      ? "local" as const
      : project.settings.assembly.montage?.planner ?? "ai-bounded";
    const profile = project.channelProfileId ? await channelProfiles.get(project.channelProfileId) : undefined;
    const contextExcerpt = (value: string, maximum: number): string => {
      const clean = value.trim();
      if (clean.length <= maximum) return clean;
      const head = Math.floor(maximum * 0.6);
      const tail = maximum - head;
      return `${clean.slice(0, head)}\n\n[…контекст сокращён…]\n\n${clean.slice(-tail)}`;
    };
    const permanentContext = [
      profile?.masterPrompt ? `ВИЗУАЛЬНЫЕ ПРАВИЛА КАНАЛА (не изменяют озвучку):\n${contextExcerpt(profile.masterPrompt, 10_000)}` : "",
      project.settings.image.style.trim() ? `ЕДИНЫЙ ВИЗУАЛЬНЫЙ СТИЛЬ:\n${contextExcerpt(project.settings.image.style, 2_000)}` : "",
      readyScriptChannelHeroContext(project),
    ].filter(Boolean).join("\n\n");
    const stage = (text: string) => sendDirectorProgress(event, text, { projectId });
    if (project.mediaMode === "stock" && project.settings.assembly.documentary?.version === 2) {
      stage("Разбиваю исходный текст и готовлю предметные запросы Stock…");
      const scenes = prepareDocumentaryScript(project, calibration);
      if (project.scenes.length && project.scenes.map(scene => scene.id).join() !== scenes.map(scene => scene.id).join()) {
        await atomicWrite(join(projectStorage.projectDirectory(projectId), "Documentary", "Plans", `${Date.now()}.json`), JSON.stringify({ scenes: project.scenes, readyScript, savedAt: new Date().toISOString() }, null, 2));
      }
      const updated = await projectService.mutate(projectId, current => {
        if (current.videoBrief?.readyScript !== readyScript) throw new Error("Исходный текст изменился во время подготовки");
        return { scenes, status: "ready" as const, montagePlan: undefined, outputPath: undefined, lastRender: undefined,
          referenceAnalysis: { sourceUrl: `script://${projectId}`, sourceTitle: project.title, niche: "Stock Documentary", targetAudience: "",
            hook: readyScript.slice(0, 500), structure: [], strengths: [], improvements: [], suggestedAngle: project.title, suggestedTitle: project.title,
            recommendedDurationSeconds: readyScriptSeconds, language: project.language, scenes, provider: "local:stock-documentary-v2" } };
      });
      await projectStorage.ensureProject(updated);
      if (await anyModelClient.configured()) {
        stage("Составляю поисковые запросы к фото и видео по смыслу каждой сцены…");
        const planned = await documentaryService.planSearch(projectId);
        await projectStorage.ensureProject(planned);
        stage(`Готово: ${scenes.length} сцен и поисковые запросы. В настройках нажмите «Автоподобрать сток и собрать»: озвучка → подбор материалов → Final.`);
        return planned;
      }
      stage(`Готово: ${scenes.length} кадров. Для автоматического поиска и визуальной проверки подключите AnyModel; ручной подбор доступен.`);
      return updated;
    }
    const scenarioDraftGuard = createScenarioDraftGuard(project.scenes);
    const checkedScenarioCommit = <T extends { scenes: Scene[] }>(current: Project, patch: T): T => {
      scenarioDraftGuard.assertCurrent(current);
      return patch;
    };
    const checkpointScenarioDraft = async (sourceAnalysis: ReferenceAnalysis, scenes: Scene[]): Promise<void> => {
      if (scenes.length === 0) return;
      await projectService.mutate(projectId, (current) => {
        scenarioDraftGuard.assertCurrent(current);
        return {
        chatTopicId: topicId,
        scenes,
        // Чекпоинт ещё не прошёл финальный аудит: сохраняем его как редактируемый
        // черновик и не переносим на него старый план монтажа/рендер.
        status: "draft" as const,
        referenceAnalysis: {
          ...sourceAnalysis,
          scenes,
          recommendedDurationSeconds: targetSeconds,
          scenarioQuality: undefined,
          scenarioRepair: undefined,
          narrationDraft: current.referenceAnalysis?.narrationDraft,
          montagePlan: undefined
        },
        montagePlan: undefined,
        outputPath: undefined,
        lastRender: undefined
        };
      });
      scenarioDraftGuard.saved(scenes);
      void logger.write("info", "scenario.draft.checkpoint", {
        projectId,
        topicId,
        sceneCount: scenes.length
      });
    };

    if (readyScriptMode) {
      if (!(await anyModelClient.configured())) {
        throw new Error("Для разметки готового сценария настройте AnyModel: он создаёт названия кадров и визуальные промпты, не меняя текст озвучки");
      }
      const seed: ReferenceAnalysis = {
        sourceUrl: topicId ? `chat://${topicId}/ready-script` : `script://${projectId}`,
        sourceTitle: project.title,
        niche: "Определи по готовому сценарию",
        targetAudience: "Определи по готовому сценарию",
        hook: readyScript.slice(0, 500),
        structure: [],
        strengths: [],
        improvements: [],
        suggestedAngle: project.title,
        suggestedTitle: project.title,
        recommendedDurationSeconds: readyScriptSeconds,
        language: project.language,
        instructions: permanentContext,
        scenes: [],
        provider: `anymodel:${modelId || "default"}+ready-script`,
        modelId
      };
      stage("Разбиваю готовый сценарий по измеренной скорости голоса…");
      const full = await anyModelClient.prepareReadyScript(
        seed,
        readyScript,
        calibration,
        (done, count, label) => stage(label ?? `Размечаю готовый сценарий: ${done} из ${count} кадров`),
        modelId,
        undefined,
        montagePlanner,
        (scenes) => checkpointScenarioDraft(seed, scenes),
        sceneTiming === "ai-story" ? AI_STORY_TARGET_SCENE_SECONDS : 8,
        { resumeScenes: project.referenceAnalysis?.sourceUrl === seed.sourceUrl ? project.referenceAnalysis.scenes : undefined }
      );
      return projectService.mutate(projectId, (current) => checkedScenarioCommit(current, {
        chatTopicId: topicId,
        scenes: full.scenes,
        status: "ready" as const,
        referenceAnalysis: full,
        montagePlan: full.montagePlan,
        outputPath: undefined,
        lastRender: undefined,
        settings: {
          ...current.settings,
          durationMinutes: Math.max(0.5, Math.round(full.recommendedDurationSeconds / 60 * 1_000) / 1_000)
        }
      }));
    }

    throw new Error("Вставьте готовый сценарий");
  };
  handleIpc("projects:prepare-script", prepareProjectScript);
  // Compatibility endpoint reads existing scripts only; cannot author text or create a chat.
  handleIpc("projects:apply-chat-topic", (event, projectId: string) => prepareProjectScript(event, projectId));
  handleIpc("app:info", async () => ({
    version: app.getVersion(),
    buildId: APP_BUILD_ID,
    buildCreatedAt: APP_BUILD_CREATED_AT,
    mainSessionId: logger.sessionId,
    mainProcessId: process.pid,
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

  mainWindow = window;
  mainWindowWasCreated = true;

  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    void logger.write("error", "renderer.load.failed", { code, description, url });
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    void logger.write("error", "renderer.process.gone", { reason: details.reason, exitCode: details.exitCode });
    if (details.reason === "clean-exit" || details.reason === "killed") return;
    // Native dialog remains available even when the renderer cannot draw.
    void dialog.showMessageBox(window, { type: "error", title: "GoldWork — восстановление окна",
      message: details.reason === "oom" ? "Интерфейсу не хватило памяти" : "Интерфейс неожиданно остановился",
      detail: "Сохранённые материалы и озвучка остаются на диске. Можно восстановить окно без перезапуска производства и без повторной отправки платных заказов.",
      buttons: ["Восстановить интерфейс", "Закрыть окно"], defaultId: 0, cancelId: 1
    }).then(({ response }) => { if (!window.isDestroyed()) { if (response === 0) window.webContents.reload(); else window.close(); } });
  });
  window.webContents.on("did-finish-load", () => {
    void logger.write("info", "renderer.load.completed");
  });
  window.webContents.on("console-message", ({ level, message, lineNumber: line, sourceId }) => {
    const logLevel: LogLevel = level === "error" ? "error" : level === "warning" ? "warn" : level === "debug" ? "debug" : "info";
    void logger.write(logLevel, "renderer.console", { message, line, sourceId });
  });
  window.on("unresponsive", () => void logger.write("error", "renderer.unresponsive", { error: "Окно не отвечает на события. Проверьте предыдущие операции и загрузку CPU/диска." }));
  window.on("responsive", () => void logger.write("info", "renderer.responsive"));
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
    void logger.write("info", "window.closed");
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
  const tasks = await pipeline.list();
  realtimeServer?.emit("queue:snapshot", tasks);
  const stamp = tasks.filter(task => task.kind === "assemble" && task.status === "done").map(task => task.id).sort().join(",");
  if (storageMaintenance || activeWorkspaceRequests || activeDirectorOperations.size || stamp === cleanedAssemblyStamp
    || tasks.some(task => ["pending", "running", "retry_wait", "paused"].includes(task.status))) return;
  // New IPC mutations wait for this short maintenance pass. The queue has no
  // runnable jobs; do not race a new selection or project edit with deletion.
  storageMaintenance = (async () => {
    const projects = await projectRepository.list();
    if (projects.some(project => ["generating", "paused"].includes(project.status))) return;
    const trash = await projectRepository.listTrash();
    const plan = await planDocumentaryCleanup({ materialRoot: join(workspacePath, "Materials"),
      projects: [...projects, ...trash.map(entry => entry.project)], projectDirectory: id => projectStorage.projectDirectory(id) });
    const result = await executeDocumentaryCleanup(plan);
    cleanedAssemblyStamp = stamp;
    if (result.removed) await logger.write("info", "storage.cleanup.complete", { ...result, recoverable: false,
      message: "Удалены неиспользуемые автоматические загрузки и временные файлы; импорт, используемые исходники, речь и готовые ролики сохранены." });
  })().catch(error => { cleanedAssemblyStamp = stamp; void logger.write("warn", "storage.cleanup.skipped", { error }); })
    .finally(() => { storageMaintenance = undefined; });
  await storageMaintenance;
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

app.whenReady().then(async () => {
  dataPath = resolveDataPath();
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on("second-instance", () => {
    // Flow's hidden browser windows may outlive the main window. Never focus
    // an arbitrary provider window instead of reopening the application.
    if (!mainWindow || mainWindow.isDestroyed()) {
      if (mainWindowWasCreated) void createWindow().catch(error => logger.write("error", "window.reopen.failed", { error }));
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  let lastStorageProgress = 0;
  await moveWorkspaceOnStartup(dataPath, (message) => {
    if (!storageMoveWindow) {
      storageMoveWindow = new BrowserWindow({ width: 620, height: 235, resizable: false, closable: false, autoHideMenuBar: true, title: "GoldWork — перенос хранения", backgroundColor: "#141410", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
      void storageMoveWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<html lang="ru"><meta charset="utf-8"><body style="background:#141410;color:#e8d690;font:16px Segoe UI;padding:24px"><h3>Перенос хранения GoldWork</h3><p id="progress">Проверяю файлы…</p><small>Дождитесь завершения. Исходники сохраняются до проверки копий.</small></body></html>')}`);
    }
    if (Date.now() - lastStorageProgress > 200 && !storageMoveWindow.webContents.isLoading()) {
      lastStorageProgress = Date.now();
      void storageMoveWindow.webContents.executeJavaScript(`document.getElementById('progress').textContent=${JSON.stringify(message)}`).catch(() => {});
    }
  });
  anyModelStore = new AnyModelStore(join(dataPath, "credentials", "anymodel.json"));
  anyModelClient = new AnyModelClient(anyModelStore);
  voicerStore = new VoicerStore(join(dataPath, "credentials", "voicer.json"));
  voicerClient = new VoicerClient(voicerStore);
  voiceCalibrationService = new VoiceCalibrationService(
    anyModelClient,
    voicerClient,
    join(dataPath, "tts-samples")
  );
  googleStore = new GoogleStore(join(dataPath, "credentials", "google.json"));
  veoClient = new VeoClient(googleStore);
  stockStore = new StockStore(join(dataPath, "credentials", "stock.json"));
  stockClient = new StockClient(stockStore, globalThis.fetch, join(dataPath, "cache", "stock-search.json"));
  flowAccountStore = new FlowAccountStore(join(dataPath, "credentials", "flow", "accounts.json"));
  flowAuthService = new FlowAuthService(flowAccountStore, publishFlowAccounts, publishFlowProgress);
  flowClient = new FlowClient(flowAccountStore, flowAuthService);
  youtubeStore = new YouTubeStore(join(dataPath, "credentials", "youtube.json"));
  youtubeClient = new YouTubeClient(youtubeStore, (audio, format) => anyModelClient.transcribeAudio(audio, format));
  channelAnalytics = new ChannelAnalyticsStore(join(dataPath, "channel-analytics.json"), ref => youtubeClient.publicChannelStats(ref));
  logger = new TextFileLogger(join(dataPath, "logs", "gold-work-studio-log.txt"), publishLogEntry, { buildId: APP_BUILD_ID });
  await logger.initialize();
  setDiagnosticSink((level, message, details) => { void logger.write(level, message, details); });
  process.on("uncaughtExceptionMonitor", (error) => void logger.write("error", "process.uncaught_exception", { error }));
  process.on("unhandledRejection", (reason) => void logger.write("error", "process.unhandled_rejection", { reason }));
  void logger.write("info", "app.ready", {
    version: app.getVersion(),
    buildId: APP_BUILD_ID,
    buildCreatedAt: APP_BUILD_CREATED_AT,
    mainSessionId: logger.sessionId,
    mainProcessId: process.pid,
    dataPath
  });
  projectRepository = new FileProjectRepository(join(dataPath, "projects.json"));
  projectService = new ProjectService(projectRepository, new MockDirectorProvider());
  channelProfiles = new ChannelProfileStore(join(dataPath, "database", "channel-profiles.json"));
  const storedProjects = await projectService.list({omitCandidates:true});
  let profiles = await channelProfiles.list();
  if (profiles.length === 0 && storedProjects.length > 0) {
    profiles = [await channelProfiles.create({
      name: "Старые проекты",
      countryCode: "RU",
      languageCode: "ru",
      languageLabel: "Русский",
      masterPrompt: "Сохранённый профиль для проектов, созданных до появления каналов.",
      defaultDurationMinutes: 10,
      defaultMediaMode: "stock",
      motionTemplate: "Без шаблона"
    })];
  }
  const migrationProfile = profiles[0];
  if (migrationProfile) {
    await Promise.all(storedProjects
      .filter((project) => !project.channelProfileId)
      .map((project) => projectService.update(project.id, { channelProfileId: migrationProfile.id })));
  }
  workspacePath = (await workspaceStorageInfo(dataPath)).path;
  await mkdir(workspacePath, { recursive: true });
  projectStorage = new LocalProjectStorage(join(workspacePath, "projects"));
  effectLibrary = new EffectLibrary(join(workspacePath, "Library"), progress => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("library:progress", progress);
    }
  });
  const documentaryYouTube = new DocumentaryYouTube(youtubeStore);
  documentaryService = new DocumentaryProjectService(projectService, projectStorage,
    new DocumentarySearch(stockClient, globalThis.fetch, join(dataPath, "cache", "documentary"), query => documentaryService.localCandidates(query), documentaryYouTube),
    join(workspacePath, "Materials"), stockClient, publishAutoStockProgress,
    new DocumentaryIntelligence(anyModelClient, id => projectStorage.projectDirectory(id), ensureDocumentaryMemory, join(workspacePath, "Materials", "VideoCatalog")), effectLibrary, documentaryYouTube);
  stockProjectService = new StockProjectService(
    projectService,
    projectStorage,
    stockClient,
    stockStore,
    publishAutoStockProgress,
    (level, message, details) => void logger.write(level, message, details)
  );
  const renderLog = (level: "info" | "warn" | "error", message: string, details?: Record<string, unknown>) =>
    void logger.write(level, message, details);
  standardRenderer = new StandardRenderer(
    projectStorage,
    new RemotionMontageRenderer((projectId) => projectStorage.projectDirectory(projectId), { eventSink: renderLog }),
    renderLog
  );
  pipeline = new MockGenerationPipeline(
    new FileTaskRepository(join(dataPath, "queue.json")),
    projectService,
    projectStorage,
    standardRenderer,
    DEFAULT_QUEUE_POLICY,
    (event) => void logger.write(event.level, event.message, event.details),
    anyModelClient,
    voicerClient,
    veoClient,
    flowClient
  );
  await pipeline.initialize();
  await startRealtimeServer();
  setInterval(
    () => void (storageMaintenance ?? pipeline.tick())
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
    const allowed = [dataPath, workspacePath].some(root => { const localPath = relative(normalize(root), filePath); return !localPath.startsWith("..") && !isAbsolute(localPath); });
    if (!allowed) {
      return new Response("forbidden", { status: 403 });
    }
    try {
      const thumbnailWidth = Number(mediaUrl.searchParams.get('thumbnail'));
      const served = [240,640,1280].includes(thumbnailWidth) && /\.(?:png|jpe?g|webp|bmp|tiff?)$/i.test(filePath)
        ? await timelineThumbnail(filePath,join(workspacePath,'Materials','TimelineThumbnails'),thumbnailWidth) : filePath;
      return await createMediaFileResponse(served, request.headers.get("range"), request.signal);
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
  storageMoveWindow?.destroy(); storageMoveWindow = undefined;
  app.on("activate", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) await createWindow();
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
  void flowAuthService?.closeAll();
  realtimeServer?.close();
  realtimeHttpServer?.close();
  if (logger) void logger.write("info", "app.before_quit");
});
