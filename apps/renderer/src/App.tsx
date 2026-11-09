import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { projectEditorReady, type DocumentaryQueryPlanIssue } from '@gold-work/shared';
import { stopVoiceSample, useVoiceSample } from './useVoiceSample';
import {LocalMediaImage} from './LocalMediaImage';
import {SceneSearchQueries} from './SceneSearchQueries';
import {channelMediaMode, projectMediaMode} from '@gold-work/shared';
import {DocumentaryRecovery} from './DocumentaryRecovery';
import {DocumentaryAutoSelection} from './DocumentaryAutoSelection';
import {DocumentaryTemplateTrack} from './DocumentaryTemplateTrack';
import { channelImageStyle, documentaryVideoCoverage, createDocumentarySettings } from "@gold-work/shared";
import { materialReady, stockMaterialApplied, StockMaterialQueue, StockProductionOverview } from "./StockProduction";
import {DocumentaryTransitionPicker} from './DocumentaryTransitionPicker';
import { storageSize, storageUsageNeedsRefresh } from "./StorageUsage";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { UniversalVideo, DocumentaryVideo, buildDocumentaryTimeline, normalizeUniversalTimeline, selectProjectDocumentaryPalette, type DocumentaryTimeline, type TimelineMedia, type TimelineText, type UniversalTimeline, type UniversalVisualBeat } from "@gold-work/remotion-video";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bot, Captions, Check, ChevronLeft, CircleAlert, CircleUserRound, Clapperboard, Clock3, Copy, Download, Eye, EyeOff, FileText, Folder, FolderOpen, GripVertical, Grid2X2, Image, Languages, LayoutDashboard, Lightbulb, ListPlus, Mic2, MoreHorizontal, Music2, Paperclip, Pause, Play, Plus, RotateCcw, Save, Search, Send, Settings, SlidersHorizontal, Sparkles, Square, SquareTerminal, Trash2, Upload, Video, Volume2, WandSparkles, X, Zap } from "lucide-react";
import { allocateAiStorySceneDurations, allocateSceneDurations, createDefaultProjectSettings, estimateNarrationDurationSeconds, IMAGE_STYLES, isBareDurationReply, isDirectorChatOnlyRequest, isScenarioGenerationRequest, isTranscriptAnalysisRequest, parseExplicitDurationSeconds, parsePastedTranscript, resolveProjectSceneTransition, resolveProjectSceneTransitionDuration, ttsLanguageCode, TTS_VOICES, voiceCalibrationMatches, type AutoStockProgress, type AutoStockSelectionResult, type ChannelProfile, type ChatTopicSummary, type ConsoleLogEntry, type DesktopApi, type LogLevel, type Project, type ProjectSettings, type QueueTask, type ReferenceAnalysis, type Scene, type StockAsset, type StockMediaType, type StockOrientation, type StockProvider, type SubtitleSettings, type UpdateProjectInput, type VisualBeat, type VoicerTemplate } from "@gold-work/shared";
import { fallbackApi } from "./fallback-api";
import { mergeScenarioDraft, restoreDocumentaryEdit } from "./scenario-draft-merge";
import { preparePreviewFrames, remapPreviewTime } from "./timeline-preview";
import { mergeProjectEditorDraft } from "./project-editor-merge";
import { scenarioFrameProgress, scenarioProgressTopic } from "./scenario-progress";
import { VisualStyleChooser } from "./VisualStyleChooser";
import { StoryCharactersPanel } from "./StoryCharactersPanel";
import { isReadyStockScript, scenarioReviewBlockReason } from "./ready-script-entrypoint";
import { SettingsPage as ClearSettingsPage } from "./SettingsPage";
import { AppUpdatePanel } from "./AppUpdatePanel";
import { AiStorySettings } from "./AiStorySettings";
import { StockWorkflowSettings } from "./StockWorkflowSettings";
import { patchStockMontage, stockMusicEditorPatch, stockVideoTarget } from "./stock-workflow-settings";
import { ChannelsPage, type NewChannelVideoInput } from "./ChannelsPage";
import { StartupHealthToast } from "./StartupHealthToast";
import { LogFailureDetails } from "./LogFailureDetails";
import { ResizableConsolePanel } from "./ResizableConsolePanel";
import { Activity } from "lucide-react";
import { AnalyticsPage } from "./AnalyticsPage";
import { EffectLibraryPage } from "./EffectLibraryPage";
import { DocumentaryMaterialModal } from "./DocumentaryMaterialModal";
import {documentaryMaterialReviewNote,documentaryProviderLabels} from './documentary-material-review';
import { DocumentarySceneInspector } from "./DocumentarySceneInspector";
import {updateSceneArtwork} from './documentary-artwork-edit';
import {DocumentaryMusicInspector} from './DocumentaryMusicInspector';
import {DocumentaryMusicTrack,musicTrackLayout} from './DocumentaryMusicTrack';
import {editMusicClips,resolveMusicClips,splitMusicClip,musicHasAudio,type MusicClip} from '@gold-work/shared';
import {loadMusicWaveform} from './music-waveform';
import { DocumentaryEffectTrack, documentaryEffectClips } from "./DocumentaryEffectTrack";
import { DocumentaryVisualTrack } from "./DocumentaryVisualTrack";
import { DocumentaryTextTrack, textTrackClips } from "./DocumentaryTextTrack";
import { DocumentaryCutInspector, DocumentaryTextInspector } from "./DocumentaryEditInspector";
import { mergeVisualCut, splitVisualCut, visualCuts } from "./documentary-editing";
import { ResizableTimelinePanel } from "./ResizableTimelinePanel";
import { TimelineTrackLabel, useTimelineTrackSizes } from "./TimelineTrackSize";
import type { DocumentaryEffect, DocumentaryTextClip, DocumentaryVisualCut } from "@gold-work/shared";
import { DocumentarySettingsPanel } from "./DocumentarySettingsPanel";
import { ChartNoAxesCombined } from "lucide-react";
import { io } from "socket.io-client";
import { APP_BUILD_CREATED_AT, APP_BUILD_ID } from "./generated-build-identity";

type SectionKey = "channels" | "analytics" | "library" | "dashboard" | "project" | "scenario" | "clone" | "director" | "projects" | "thumbnail" | "avatar" | "seo" | "studio" | "queue" | "console" | "settings";
type Overlay = { type: "preview" | "timeline"; projectId: string };
type ProjectWorkflowStage = "brief" | "scenario" | "settings" | "materials" | "production" | "editor" | "export";
const ScenarioPreparationContext = createContext<ReadonlySet<string>>(new Set());
type ProjectEditorStage = "brief" | "settings";
type ScenarioView = "editor" | "materials";
type OpenProjectWorkflowStage = (projectId: string, stage: ProjectWorkflowStage) => void;
type RegisterLeaveGuard = (section: "project" | "scenario", guard: () => Promise<boolean>) => () => void;

const navigation: Array<{
  label: string;
  items: Array<{
    key: SectionKey;
    title: string;
    icon: ReactNode;
    beta?: boolean;
  }>;
}> = [
  {
    label: "РАБОТА",
    items: [
      { key: "channels", title: "Мои каналы", icon: <Grid2X2 size={17} /> },
      { key: "analytics", title: "Аналитика", icon: <ChartNoAxesCombined size={17} /> },
      { key: "library", title: "Библиотека эффектов", icon: <FolderOpen size={17} /> },
      {
        key: "director",
        title: "Создать ролик",
        icon: <WandSparkles size={17} />,
      },
      {
        key: "projects",
        title: "Мои ролики",
        icon: <FolderOpen size={17} />,
      },
      {
        key: "queue",
        title: "Очередь",
        icon: <ListPlus size={17} />,
      },
    ],
  },
];

const ACTIVE_SECTION_STORAGE_KEY = "gold-work-studio:active-section";

function restoredActiveSection(): SectionKey {
  return "channels";
}

const statusLabels: Record<Project["status"], string> = {
  draft: "Черновик",
  ready: "Готов к генерации",
  generating: "Генерация",
  paused: "На паузе",
  complete: "Готов",
  failed: "Остановлен",
};


type ConsoleViewState = { query: string; level: "all" | LogLevel; autoScroll: boolean };

export function App() {
  const api = window.goldWork ?? fallbackApi;
  const [healthOpenRequest, setHealthOpenRequest] = useState(0);
  const [activeSection, setActiveSection] = useState<SectionKey>(restoredActiveSection);
  const [projects, setProjects] = useState<Project[]>([]);
  const [channels, setChannels] = useState<ChannelProfile[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [createVideoRequest, setCreateVideoRequest] = useState(0);
  const [queue, setQueue] = useState<QueueTask[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [returnProjectId, setReturnProjectId] = useState<string | null>(() => {
    try { return sessionStorage.getItem("gws-current-video"); } catch { return null; }
  });
  const [returnDockHidden, setReturnDockHidden] = useState(() => {
    try { return localStorage.getItem("gws-video-dock-hidden") === "true"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("gws-video-dock-hidden", String(returnDockHidden)); } catch { /* Hiding still works for this session. */ }
  }, [returnDockHidden]);
  useEffect(() => {
    if (returnProjectId) { try { sessionStorage.setItem("gws-current-video", returnProjectId); } catch { /* Navigation still works. */ } }
  }, [returnProjectId]);
  const [projectEditorStage, setProjectEditorStage] = useState<ProjectEditorStage>("settings");
  const [scenarioView, setScenarioView] = useState<ScenarioView>("editor");
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [appInfo, setAppInfo] = useState<Awaited<ReturnType<DesktopApi["getAppInfo"]>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [creatingVideo, setCreatingVideo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [progressCollapsed, setProgressCollapsed] = useState(false);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleLogEntry[]>([]);
  const [consoleView, setConsoleView] = useState<ConsoleViewState>({ query: "", level: "all", autoScroll: true });
  const consoleHistoryGeneration = useRef(0);
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const socketConnectedRef = useRef(false);
  const previousProjectStatusRef = useRef(new Map<string, Project["status"]>());
  const pendingEditorProjectsRef = useRef(new Set<string>());
  const leaveGuardsRef = useRef<Partial<Record<"project" | "scenario", () => Promise<boolean>>>>({});
  const navigationInFlightRef = useRef(false);
  const [directorProgress, setDirectorProgress] = useState<string | null>(null);
  const [directorRefreshToken, setDirectorRefreshToken] = useState(0);
  const [requestedDirectorTopicId, setRequestedDirectorTopicId] = useState<string | null>(null);
  const activeViewRef = useRef({ section: activeSection, projectId: selectedProjectId, topicId: requestedDirectorTopicId });
  activeViewRef.current = { section: activeSection, projectId: selectedProjectId, topicId: requestedDirectorTopicId };
  type ScenarioBuild = { projectId?: string; running: boolean; startedAt: number; count: number; stage: string; error?: string };
  const [scenarioBuilds, setScenarioBuilds] = useState<Record<string, ScenarioBuild>>({});
  const scenarioBuildsRef = useRef<Record<string, ScenarioBuild>>({});
  function updateScenarioBuild(topicId: string, patch: Partial<ScenarioBuild>) {
    const current = scenarioBuildsRef.current[topicId];
    scenarioBuildsRef.current = { ...scenarioBuildsRef.current, [topicId]: { running: false, startedAt: Date.now(), count: 0, stage: "", ...current, ...patch } };
    setScenarioBuilds(scenarioBuildsRef.current);
  }
  const [autoStockProgress, setAutoStockProgress] = useState<AutoStockProgress | null>(null);
  const [autoStockHidden, setAutoStockHidden] = useState(false);
  const autoStockProgressRef = useRef<AutoStockProgress | null>(null);
  const [autoStockResult, setAutoStockResult] = useState<AutoStockSelectionResult | null>(null);
  useEffect(() => api.onDirectorProgress((stage, context) => {
    const topicId = scenarioProgressTopic(scenarioBuildsRef.current, context);
    if (topicId && scenarioBuildsRef.current[topicId]?.running) updateScenarioBuild(topicId, { stage });
    else if (!context?.projectId && !context?.topicId) setDirectorProgress(stage);
  }), []);
  useEffect(() => api.onAutoStockProgress((progress) => {
    const previous = autoStockProgressRef.current;
    const terminal = (phase: AutoStockProgress["phase"]) => phase === "complete" || phase === "failed" || phase === "stopped";
    if (previous?.projectId !== progress.projectId || previous && terminal(previous.phase) && !terminal(progress.phase)) {
      setAutoStockHidden(false); setAutoStockResult(null);
    }
    autoStockProgressRef.current = progress;
    setAutoStockProgress(progress);
  }), []);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, activeSection);
    } catch {
      // Навигация продолжает работать и без sessionStorage.
    }
  }, [activeSection]);

  /** Пишет действие в Console Output и в лог-файл приложения. */
  function logAction(text: string, level: "UI" | "INFO" | "ERROR" = "UI") {
    void api.writeLog(level === "ERROR" ? "error" : "info", "ui.action", { text }).catch(() => undefined);
  }
  useEffect(() => { if (notice) logAction(notice, "INFO"); }, [notice]);
  useEffect(() => { if (error) logAction(error, "ERROR"); }, [error]);
  useEffect(() => {
    let active = true;
    const append = (entry: ConsoleLogEntry) => {
      if (!active) return;
      setConsoleEntries((current) => current.some((item) => item.id === entry.id) ? current : [...current, entry].slice(-1000));
    };
    const unsubscribe = api.onLogEntry(append);
    const historyGeneration = consoleHistoryGeneration.current;
    void api.readLogs(800).then((history) => {
      if (!active || consoleHistoryGeneration.current !== historyGeneration) return;
      setConsoleEntries((current) => {
        const byId = new Map([...history, ...current].map((entry) => [entry.id, entry]));
        return [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-1000);
      });
    }).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  function clearConsole() {
    consoleHistoryGeneration.current += 1;
    setConsoleEntries([]);
  }

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  const currentBuildTopicId = activeSection === "director" ? requestedDirectorTopicId : selectedProject?.id;
  const currentBuild = currentBuildTopicId ? scenarioBuilds[currentBuildTopicId] : undefined;
  const scenarioBuildTopicId = currentBuild?.running ? currentBuildTopicId ?? null : null;
  const scenarioBuildStartedAt = currentBuild?.running ? currentBuild.startedAt : null;
  const scenarioBuildSceneCount = currentBuild?.count ?? 0;
  const currentScenarioProgress = currentBuild?.running ? currentBuild.stage : directorProgress;
  const overlayProject = overlay ? projects.find((project) => project.id === overlay.projectId) : undefined;
  useEffect(() => stopVoiceSample(), [activeSection, selectedProjectId, overlay?.type, overlay?.projectId]);

  useEffect(() => {
    if (!selectedProject) return;
    const previous = previousProjectStatusRef.current.get(selectedProject.id);
    previousProjectStatusRef.current.set(selectedProject.id, selectedProject.status);
    if (previous === "generating" || previous === "paused") pendingEditorProjectsRef.current.add(selectedProject.id);
    if (activeSection !== "queue" || busy || !pendingEditorProjectsRef.current.has(selectedProject.id)
      || !["ready", "complete"].includes(selectedProject.status) || !projectEditorReady(selectedProject)
      || queue.some(task => task.projectId === selectedProject.id && ["pending", "running", "retry_wait", "paused"].includes(task.status))) return;
    pendingEditorProjectsRef.current.delete(selectedProject.id);
    if (selectedProject.stockProduction) {
      if (selectedProject.status === 'complete' && selectedProject.outputPath) setNotice('Ролик готов: Final.mp4 сохранён. Результат доступен на этапе «Экспорт».');
      return;
    }
    setOverlay({ type: "timeline", projectId: selectedProject.id });
    setNotice("Материалы и монтаж готовы. Проверьте редактор и нажмите «Экспорт» для создания Final.mp4.");
  }, [activeSection, selectedProject, busy, queue]);

  useEffect(() => {
    let mounted = true;
    let pollingInFlight = true;
    let projectsRevision: string | undefined;
    async function initialLoad() {
      try {
        const [snapshot, loadedChannels, loadedQueue, info] = await Promise.all([api.getProjectChanges(), api.listChannelProfiles(), api.getQueue(), api.getAppInfo()]);
        const loadedProjects = snapshot.projects ?? [];
        if (!mounted) return;
        projectsRevision = snapshot.revision;
        setProjects(loadedProjects);
        setChannels(loadedChannels);
        setQueue(loadedQueue);
        setAppInfo(info);
        setSelectedProjectId((current) => (current && loadedProjects.some((project) => project.id === current) ? current : (loadedProjects[0]?.id ?? null)));
      } catch (reason) {
        if (mounted) setError(errorMessage(reason));
      } finally { pollingInFlight = false; }
    }
    void initialLoad();
    const polling = window.setInterval(() => {
      if (pollingInFlight) return;
      pollingInFlight = true;
      // Пока живёт сокет — очередь приходит push-ем; при обрыве переходим на поллинг, чтобы прогресс не замерзал.
      const queueRequest = window.goldWork && socketConnectedRef.current ? Promise.resolve<QueueTask[] | null>(null) : api.getQueue();
      void Promise.all([queueRequest, api.getProjectChanges(projectsRevision)])
        .then(([tasks, snapshot]) => {
          if (!mounted) return;
          if (tasks) setQueue(tasks);
          projectsRevision = snapshot.revision;
          const items = snapshot.projects;
          if (!items) return;
          setProjects(current => {
            const byId = new Map(current.map(project => [project.id, project]));
            const updated = items.map(project => byId.get(project.id)?.updatedAt === project.updatedAt ? byId.get(project.id)! : project);
            for (const project of updated) byId.set(project.id, project);
            const next = snapshot.projectIds ? snapshot.projectIds.map(id => byId.get(id)).filter((project): project is Project => Boolean(project)) : updated;
            return next.length === current.length && next.every((project, index) => project === current[index]) ? current : next;
          });
          const ids = snapshot.projectIds ?? items.map(project => project.id);
          setSelectedProjectId((current) => (current && ids.includes(current) ? current : (ids[0] ?? null)));
        })
        .catch(() => undefined)
        .finally(() => { pollingInFlight = false; });
    }, 1500);
    return () => {
      mounted = false;
      window.clearInterval(polling);
    };
  }, []);

  useEffect(() => {
    if (!appInfo?.realtimeUrl) return;
    const socket = io(appInfo.realtimeUrl, { transports: ["websocket", "polling"] });
    socket.on("connect", () => { socketConnectedRef.current = true; });
    socket.on("disconnect", () => { socketConnectedRef.current = false; });
    socket.on("queue:snapshot", (tasks: QueueTask[]) => setQueue(tasks));
    socket.on("connect_error", (reason) => {
      socketConnectedRef.current = false;
      void api.writeLog("warn", "queue.socket_error", { message: reason.message });
    });
    return () => {
      socketConnectedRef.current = false;
      socket.close();
    };
  }, [appInfo?.realtimeUrl]);

  useEffect(() => {
    if (pageScrollRef.current) pageScrollRef.current.scrollTop = 0;
  }, [activeSection]);

  useEffect(() => {
    const reportError = (event: ErrorEvent) => {
      void api.writeLog("error", "window.error", {
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    };
    const reportRejection = (event: PromiseRejectionEvent) => {
      void api.writeLog("error", "window.unhandled_rejection", {
        reason: event.reason instanceof Error ? { message: event.reason.message, stack: event.reason.stack } : String(event.reason),
      });
    };
    window.addEventListener("error", reportError);
    window.addEventListener("unhandledrejection", reportRejection);
    void api.getAppInfo()
      .then((info) => api.writeLog("info", "ui.mounted", {
        rendererBuildId: APP_BUILD_ID,
        rendererBuildCreatedAt: APP_BUILD_CREATED_AT,
        mainBuildId: info.buildId,
        mainSessionId: info.mainSessionId,
        buildMatch: info.buildId === APP_BUILD_ID
      }))
      .catch(() => api.writeLog("info", "ui.mounted", { rendererBuildId: APP_BUILD_ID }));
    return () => {
      window.removeEventListener("error", reportError);
      window.removeEventListener("unhandledrejection", reportRejection);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function upsertProject(project: Project, select = true) {
    setReturnProjectId(project.id);
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
    if (select) setSelectedProjectId(project.id);
  }

  function showPreparedProject(project: Project, topicId: string) {
    const view = activeViewRef.current;
    const show = (view.section === "director" && view.topicId === topicId) || (view.section === "scenario" && view.projectId === project.id);
    upsertProject(project, show);
    if (show) {
      setProjectEditorStage("settings");
      setActiveSection("project");
    }
  }

  async function refresh() {
    const [items, channelItems, tasks] = await Promise.all([api.listProjects(), api.listChannelProfiles(), api.getQueue()]);
    setProjects(items);
    setChannels(channelItems);
    setQueue(tasks);
    setSelectedProjectId((current) => (current && items.some((project) => project.id === current) ? current : (items[0]?.id ?? null)));
  }

  async function createProject(withDemoScenes = false) {
    await navigateSafely("director");
  }

  async function refreshChannels() {
    setChannels(await api.listChannelProfiles());
  }

  useEffect(() => {
    const refreshHero = () => { void refreshChannels().catch(reason => setError(errorMessage(reason))); };
    window.addEventListener("gws:channel-character-changed", refreshHero);
    return () => window.removeEventListener("gws:channel-character-changed", refreshHero);
  }, []);

  async function createChannelVideo(profile: ChannelProfile, input: NewChannelVideoInput) {
    setCreatingVideo(true);
    setError(null);
    try {
      const mediaMode = channelMediaMode(profile);
      const estimatedDurationSeconds = input.calibration
        ? estimateNarrationDurationSeconds(input.content, input.calibration)
        : undefined;
      const project = await api.createProject({
        title: input.title,
        topic: input.title,
        aspectRatio: "16:9",
        language: profile.languageLabel,
        mode: mediaMode === "stock" ? "standard" : "pro",
        channelProfileId: profile.id,
        mediaMode,
        motionTemplate: profile.motionTemplate,
        videoBrief: {
          prompt: input.title,
          competitorTranscripts: [],
          creationMode: input.creationMode,
          readyScript: input.content,
        }
      });
      let updated = await api.updateProject(project.id, {
        settings: {
          ...project.settings,
          ...(mediaMode === "stock" && input.stockSettings ? input.stockSettings : {}),
          ...(estimatedDurationSeconds !== undefined ? { durationMinutes: Math.max(0.5, estimatedDurationSeconds / 60) } : {}),
          voice: {
            ...project.settings.voice,
            enabled: true,
            provider: input.voiceProvider,
            voice: input.voice,
            singleTrack: mediaMode !== "stock" && input.voiceProvider === "elevenlabs",
            calibration: input.calibration,
          },
          image: {
            ...project.settings.image,
            provider: mediaMode === "ai" ? "flow" : project.settings.image.provider,
            style: input.imageStyle?.trim() || channelImageStyle(profile, project.settings.image.style, input.useChannelCharacter),
          },
          video: {
            ...project.settings.video,
            enabled: mediaMode === "ai",
            provider: mediaMode === "ai" ? "flow" : project.settings.video.provider,
            model: mediaMode === "ai" ? "veo_3_1_i2v_s_fast" : project.settings.video.model,
            animationPercent: mediaMode === "ai" ? 15 : project.settings.video.animationPercent,
            selectionMode: mediaMode === "ai" ? "auto" : project.settings.video.selectionMode,
          },
        },
      });
      if (input.useChannelCharacter && profile.primaryCharacter) {
        const applied = await api.useChannelCharacterReference(updated.id, profile.primaryCharacter.versionId);
        updated = applied.project;
        if (input.imageStyle?.trim() && updated.settings.image.style !== input.imageStyle.trim()) {
          updated = await api.updateProject(updated.id, { settings: {
            ...updated.settings, image: { ...updated.settings.image, style: input.imageStyle.trim() },
          } });
        }
      }
      upsertProject(updated);
      setSelectedChannelId(profile.id);
      if (mediaMode === 'stock' && updated.settings.assembly.documentary?.version === 2) {
        void startGeneration(updated.id);
      } else {
        navigateToDirectorTopic(updated.id);
        void prepareReadyProject(updated);
      }
    } catch (reason) {
      setError(errorMessage(reason));
      throw reason;
    } finally {
      setCreatingVideo(false);
    }
  }

  async function prepareReadyProject(project = selectedProject, mode?: 'cached-query-plans') {
    if (!project || scenarioBuildsRef.current[project.id]?.running) return;
    const projectId = project.id;
    updateScenarioBuild(projectId, { projectId, running: true, startedAt: Date.now(), error: undefined,
      count: Math.ceil(project.settings.durationMinutes * 60 / 5), stage: mode ? "Применяю сохранённые поисковые планы…" : "Разбиваю готовый сценарий…" });
    setError(null);
    try {
      let updated = await api.prepareProjectScript(projectId,mode);
      if (updated.mediaMode === "ai") {
        updateScenarioBuild(projectId, { stage: "Персонажи: определяю участников истории…" });
        updated = await api.prepareStoryCharacters(projectId);
      }
      showPreparedProject(updated, projectId);
      setNotice(isReadyStockScript(updated)
        ? `Готовый текст подготовлен: ${updated.scenes.length} сцен. Нажмите «Собрать ролик»: материалы, озвучка, монтаж и экспорт выполнятся автоматически.`
        : `Готовый текст подготовлен: ${updated.scenes.length} сцен. Проверьте кадры и персонажей.`);
    } catch (reason) {
      updateScenarioBuild(projectId, { error: errorMessage(reason) });
      if (activeViewRef.current.projectId === projectId) setError(errorMessage(reason));
      await refresh().catch(() => undefined);
    } finally {
      updateScenarioBuild(projectId, { running: false });
    }
  }

  async function reassembleProject(id: string) {
    if (scenarioBuildsRef.current[id]?.running) {
      setNotice("Дождитесь подготовки сценария этого ролика.");
      return;
    }
    setError(null);
    try {
      assertCompatibleBuild(appInfo);
      await api.assembleProject(id);
      setNotice("Экспорт Final.mp4 запущен — прогресс в очереди.");
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function refreshDocumentaryMontage(id: string) {
    setError(null);setBusy(true);
    try {
      assertCompatibleBuild(appInfo);
      const updated=await api.refreshDocumentaryMontage(id);
      upsertProject(updated);
      setNotice(updated.settings.assembly.documentary?.semanticMontageStatus?.status==='local'
        ? updated.settings.assembly.documentary.semanticMontageStatus.message
        : `${updated.settings.assembly.documentary?.motionArtworkStatus?.message??'Автомонтаж обновлён на готовых материалах.'} Проверьте таймлайн и нажмите «Пересобрать Final.mp4».`);
      setOverlay({type:'timeline',projectId:id});
      return updated;
    } catch(reason){setError(errorMessage(reason));}
    finally{setBusy(false);}
  }

  async function reviseDocumentaryArtwork(id:string,feedback:string){
    setError(null);
    try{
      assertCompatibleBuild(appInfo);
      const updated=await api.reviseDocumentaryArtwork(id,{feedback});
      upsertProject(updated);setNotice(updated.settings.assembly.documentary?.artworkFeedback?.message??'Доработка AI-графики сохранена.');
    }catch(reason){await refresh();throw reason;}
  }

  async function toggleSceneAssembly(projectId: string, sceneId: string, include: boolean) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    try {
      const updated = await api.updateProject(projectId, {
        scenes: project.scenes.map((scene) => (scene.id === sceneId ? { ...scene, includeInAssembly: include } : scene))
      });
      setProjects((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
      setNotice(include ? "Сцена возвращена в сборку." : "Сцена исключена из сборки — нажмите «Пересобрать Final.mp4».");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  /** Мгновенно создаёт проект по выбранной теме и открывает его — длину и язык пользователь выбирает уже в проекте. */

  async function saveProject(id: string, input: UpdateProjectInput) {
    setError(null);
    try {
      const project = await api.updateProject(id, input);
      upsertProject(project);
      return project;
    } catch (reason) {
      setError(errorMessage(reason));
      throw reason;
    }
  }


  async function duplicateProject(id: string) {
    try {
      upsertProject(await api.duplicateProject(id));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function deleteProject(id: string) {
    const project = projects.find((candidate) => candidate.id === id);
    if (!window.confirm(`Окончательно удалить ролик «${project?.title ?? id}» и его локальные файлы? Место освободится после удаления. Восстановить ролик будет нельзя.`)) return;
    try {
      const entry = await api.deleteProject(id);
      await api.purgeTrashItem(entry.trashId);
      if (overlay?.projectId === id) setOverlay(null);
      await refresh();
    } catch (reason) {
      setError(`${errorMessage(reason)}. Если ролик уже исчез из списка, проверьте корзину: при сбое очистки файлы остаются там.`);
    }
  }

  function openProject(id: string, section?: SectionKey) {
    const project = projects.find(item => item.id === id);
    if (!project) return;
    setSelectedProjectId(id);
    setReturnProjectId(id);
    if (scenarioBuildsRef.current[project.id]?.running) {
      navigateToDirectorTopic(project.id);
      return;
    }
    if (!section && project.mediaMode === "ai") {
      if (project.status === "generating" || project.status === "paused") {
        setActiveSection("queue");
      } else if (project.scenes.length === 0) {
        navigateToDirectorTopic(project.id);
      } else {
        setScenarioView("editor"); setActiveSection("scenario");
      }
      return;
    }
    if (section === "scenario") setScenarioView("editor");
    if (section === "project") setProjectEditorStage("settings");
    setActiveSection(section ?? "project");
  }

  async function startGeneration(id: string) {
    if (scenarioBuildsRef.current[id]?.running) {
      setNotice("Дождитесь подготовки сценария этого ролика.");
      return;
    }
    setBusy(true);
    setError(null);
    setAutoStockResult(null);
    // Производство открывается сразу: preflight и создание очереди тоже являются
    // понятным этапом работы, а не похожи на зависшую кнопку.
    setSelectedProjectId(id);
    setActiveSection("queue");
    logAction(`Запуск генерации проекта ${id}`);
    try {
      assertCompatibleBuild(appInfo);
      // Берём свежую версию после save в ProjectEditor. В Stock-режиме пользователь
      // не обязан заполнять сцены вручную: поиск, выбор и скачивание идут перед очередью.
      let project = await api.getProject(id).catch(() => undefined)
        ?? projects.find((candidate) => candidate.id === id);
      if (project) {
        const scenarioBlock = scenarioReviewBlockReason(project);
        if (scenarioBlock) {
          upsertProject(project);
          setScenarioView("editor");
          setActiveSection("scenario");
          setError(scenarioBlock);
          return;
        }
        const mediaMode = project.mediaMode ?? "stock";
        const includedScenes = project.scenes.filter((scene) => scene.includeInAssembly !== false);
        const hasAppliedStock = (scene: Scene) => Boolean(
          scene.stockSource
          && (scene.stockSource.mediaType === "video" ? scene.videoPath : scene.imagePath),
        );
        if (mediaMode === "stock" && project.settings.assembly.documentary?.version !== 2) {
          setSelectedProjectId(id);
          setNotice(project.settings.assembly.documentary?.version === 2 ? "Проверяю подтверждённые материалы и ищу кандидатов в веб/архивных источниках…" : "Проверяю готовые сцены и автоматически подбираю недостающий stock из Pexels/Pixabay…");
          const selection = await api.autoSelectStock(id);
          project = selection.project;
          setAutoStockResult(selection);
          upsertProject(selection.project);
          if (selection.failed > 0) {
            setProjectEditorStage("settings");
            setActiveSection(project.settings.assembly.documentary?.version === 2 ? "scenario" : "project");
            if (project.settings.assembly.documentary?.version === 2) setScenarioView("materials");
            const suffix = selection.failed === 1 ? "сцены" : "сцен";
            setError(project.settings.assembly.documentary?.version === 2 ? `Нужно проверить материалы ${selection.failed} ${suffix}. Откройте подбор, проверьте объект и источник, затем подтвердите кадр.` : `Stock не нашёлся для ${selection.failed} ${suffix}. Готовые материалы сохранены — нажмите «Повторить для пропущенных».`);
            logAction(`Автоподбор stock не завершил ${selection.failed} сцен проекта ${id}`, "ERROR");
            await refresh();
            return;
          }
          setNotice(selection.selected > 0
            ? `Stock автоматически подобран для ${selection.selected} сцен. Запускаю озвучку и сборку…`
            : `Stock проверен: все ${selection.skipped} сцен уже готовы. Запускаю озвучку и сборку…`);
        }
        if (mediaMode === "mixed") {
          const brokenStockScenes = includedScenes.filter((scene) => scene.stockSource && !hasAppliedStock(scene));
          if (brokenStockScenes.length > 0) {
            openProjectWorkflowStage(id, "materials");
            throw new Error(`Для ${brokenStockScenes.length} stock-сцен потеряны локальные файлы. Выберите их заново.`);
          }
        }
      }
      if (project?.mediaMode === "stock" && project.settings.assembly.documentary?.version === 2) {
        setNotice("Производство запущено: сценарий → озвучка и материалы → монтаж → Final.mp4. Прогресс и возможные ошибки появятся здесь.");
      }
      await api.startGeneration(id);
      setAutoStockProgress(null);
      setAutoStockResult(null);
      pendingEditorProjectsRef.current.add(id);
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function queueAction(action: () => Promise<unknown>) {
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function regenerateScene(projectId: string, sceneId: string | string[], target: "image" | "video" | "audio" | "all" = "all"): Promise<boolean> {
    setBusy(true);
    try {
      assertCompatibleBuild(appInfo);
      await api.regenerateScene(projectId, sceneId, target);
      setNotice(target === "image" ? "Перегенерация изображения запущена." : target === "video" ? "Перегенерация AI-видео запущена." : "Перегенерация сцены запущена.");
      await refresh();
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function openProjectFolder(projectId: string) {
    try {
      await api.openProjectFolder(projectId);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  function navigate(section: SectionKey) {
    logAction(`Переход: ${section}`);
    setOverlay(null);
    setActiveSection(section);
    if (section === "director") {
      setRequestedDirectorTopicId(null);
      setDirectorRefreshToken((value) => value + 1);
    }
    if (section === "settings") void api.getAppInfo().then(setAppInfo);
  }

  const registerLeaveGuard = useCallback<RegisterLeaveGuard>((section, guard) => {
    leaveGuardsRef.current[section] = guard;
    return () => {
      if (leaveGuardsRef.current[section] === guard) delete leaveGuardsRef.current[section];
    };
  }, []);

  async function canLeaveActiveEditor(): Promise<boolean> {
    if (navigationInFlightRef.current) return false;
    navigationInFlightRef.current = true;
    const guard = activeSection === "project" || activeSection === "scenario"
      ? leaveGuardsRef.current[activeSection]
      : undefined;
    try {
      return guard ? await guard() : true;
    } finally {
      navigationInFlightRef.current = false;
    }
  }

  async function navigateSafely(section: SectionKey) {
    if (section === "director") {
      if (!(await canLeaveActiveEditor())) return;
      navigate("channels");
      setCreateVideoRequest(value => value + 1);
      if (!selectedChannelId) setNotice("Выберите канал и нажмите «Новый ролик».");
      return;
    }
    if (section === activeSection) return;
    if (!(await canLeaveActiveEditor())) return;
    navigate(section);
  }

  async function openQueueSafely(projectId: string) {
    if (!(await canLeaveActiveEditor())) return;
    setSelectedProjectId(projectId);
    navigate("queue");
  }

  function navigateToDirectorTopic(topicId: string) {
    logAction(`Открыта подготовка ролика: ${topicId}`);
    setOverlay(null);
    setRequestedDirectorTopicId(topicId);
    setActiveSection("director");
    setDirectorRefreshToken((value) => value + 1);
  }

  function openProjectWorkflowStage(projectId: string, stage: ProjectWorkflowStage) {
    if (!["brief", "scenario"].includes(stage) && Object.entries(scenarioBuildsRef.current)
      .some(([id, build]) => build.running && (build.projectId ?? id) === projectId)) {
      setNotice("Дождитесь подготовки сценария этого ролика.");
      return;
    }
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      setError("Не удалось открыть этап: ролик не найден.");
      return;
    }
    logAction(`Этап ролика «${project.title}»: ${stage}`);
    setSelectedProjectId(project.id);
    setReturnProjectId(project.id);
    setOverlay(null);
    if (stage === "brief") {
      if (project.channelProfileId) setSelectedChannelId(project.channelProfileId);
      navigateToDirectorTopic(project.id);
      return;
    }
    if (stage === "scenario" || stage === "materials") {
      setScenarioView(stage === "materials" ? "materials" : "editor");
      setActiveSection("scenario");
      return;
    }
    if (stage === "settings") {
      setProjectEditorStage("settings");
      setActiveSection("project");
      return;
    }
    if (stage === "production") {
      setActiveSection("queue");
      return;
    }
    setOverlay({ type: stage === "editor" ? "timeline" : "preview", projectId: project.id });
  }

  const selectedProjectHasQueueTasks = Boolean(selectedProject && queue.some((task) => task.projectId === selectedProject.id));
  const aiStoryBriefProject = selectedProject?.id === requestedDirectorTopicId
    ? selectedProject : undefined;
  const selectedProjectHasProductionContext = Boolean(selectedProject && (
    selectedProjectHasQueueTasks || busy || autoStockProgress?.projectId === selectedProject.id || ["generating", "paused", "failed", "complete"].includes(selectedProject.status)
  ));
  const workflowReplacesHint = activeSection === "project"
    || activeSection === "scenario"
    || (activeSection === "director" && Boolean(aiStoryBriefProject))
    || (activeSection === "queue" && selectedProjectHasProductionContext);
  const buildMismatch = Boolean(window.goldWork && appInfo && appInfo.buildId !== APP_BUILD_ID);
  const returnProject = projects.find(project => project.id === returnProjectId)
    ?? projects.find(project => scenarioBuilds[project.id]?.running)
    ?? projects.find(project => project.status === "generating" || project.status === "paused");
  const onReturnProjectScreen = returnProject && returnProject.id === selectedProject?.id
    && (["project", "scenario", "queue"].includes(activeSection) || (activeSection === "director" && requestedDirectorTopicId === returnProject.id));

  return (
    <ScenarioPreparationContext.Provider value={new Set(Object.entries(scenarioBuilds).filter(([, build]) => build.running).map(([id, build]) => build.projectId ?? id))}>
    <div className="desktop-frame" data-renderer-build-id={APP_BUILD_ID}>
      <TitleBar appInfo={appInfo} />
      <div className="app-body">
        <Sidebar active={activeSection} appInfo={appInfo} onNavigate={(section) => void navigateSafely(section)} onRestoreVideo={returnProject && returnDockHidden ? () => setReturnDockHidden(false) : undefined} onRestoreStock={autoStockProgress && autoStockHidden ? () => setAutoStockHidden(false) : undefined} onOpenHealth={window.goldWork ? () => setHealthOpenRequest(v => v + 1) : undefined} />
        <section className="work-area">
          <div className="top-strips">
            <AppUpdatePanel api={api} compact />
            {!window.goldWork && (
              <div className="demo-banner">
                <X size={13} />
                Демо-режим: нет связи с Electron, все данные и анализы — выдуманные. Реальные функции недоступны.
              </div>
            )}
            {buildMismatch && appInfo && (
              <div className="build-mismatch-banner" role="alert">
                <CircleAlert size={15} />
                <span>
                  Renderer <b>{shortBuildId(APP_BUILD_ID)}</b> и Electron main <b>{shortBuildId(appInfo.buildId)}</b> относятся к разным сборкам.
                  Производство заблокировано — полностью закройте и заново запустите Gold Work Studio.
                </span>
              </div>
            )}
            {!workflowReplacesHint && activeSection !== "analytics" && <StepHintBar hint={computeStepHint(appInfo, selectedProject, queue, activeSection, directorProgress)} onNavigate={navigate} />}
          </div>
          <div className={`page-scroll${activeSection === "director" && !aiStoryBriefProject ? " director-scroll" : ""}${selectedProject?.mediaMode === "ai" && ["director", "scenario", "project", "queue"].includes(activeSection) ? " ai-story-workflow" : ""}`} ref={pageScrollRef}>
            {activeSection === "analytics" && <AnalyticsPage api={api} onSettings={() => {
              try { sessionStorage.setItem("gold-work-studio:settings-tab-v2", "youtube"); } catch { /* Settings remain accessible. */ }
              void navigateSafely("settings");
            }} />}
            {activeSection === "channels" && <ChannelsPage api={api} channels={channels} projects={projects} selectedChannelId={selectedChannelId} busy={creatingVideo} createVideoRequest={createVideoRequest} onCreateVideoRequestHandled={() => setCreateVideoRequest(0)} onSelectChannel={setSelectedChannelId} onChannelsChange={refreshChannels} onProjectsChange={refresh} onCreateVideo={createChannelVideo} onOpenProject={(id) => openProject(id)} onOpenSettings={() => navigate("settings")} onError={setError} onNotice={setNotice} />}
            {activeSection === "dashboard" && <Dashboard projects={projects} selectedId={selectedProject?.id} busy={busy} onCreate={() => void createProject()} onOpen={openProject} onDelete={(id) => void deleteProject(id)} onPreview={(id) => setOverlay({ type: "preview", projectId: id })} onGenerate={(id) => void startGeneration(id)} onNavigate={navigate} onOpenFolder={(id) => void openProjectFolder(id)} />}
            {activeSection === "project" && <ProjectEditor
              project={selectedProject} currentStage={projectEditorStage} busy={busy || !!currentBuild?.running}
              autoStockProgress={autoStockProgress} autoStockResult={autoStockResult} hasQueueTasks={selectedProjectHasQueueTasks}
              onBack={() => navigate("projects")} onSave={saveProject} onGenerate={(id) => void startGeneration(id)}
              onRefreshMontage={refreshDocumentaryMontage}
              onNavigate={navigate} onNavigateStage={openProjectWorkflowStage} onRegisterLeaveGuard={registerLeaveGuard} onInfo={setNotice} />}
            {activeSection === "scenario" && <ScenarioEditor project={selectedProject} initialView={scenarioView} hasQueueTasks={selectedProjectHasQueueTasks} busy={busy || !!currentBuild?.running} progress={currentScenarioProgress} onContinueReview={() => prepareReadyProject()} onViewChange={setScenarioView} onNavigateStage={openProjectWorkflowStage} onRegisterLeaveGuard={registerLeaveGuard} onSave={saveProject} onRegenerateImage={(sceneId) => regenerateScene(selectedProject?.id ?? "", sceneId, "image").then(() => undefined)} onAnimateWithVeo={(sceneIds) => regenerateScene(selectedProject?.id ?? "", sceneIds, "video")} onBack={() => navigate("project")} />}
            {activeSection === "director" && aiStoryBriefProject && <AiStoryPreparation
              key={aiStoryBriefProject.id} project={aiStoryBriefProject} onRetried={updated=>{
                upsertProject(updated,false);updateScenarioBuild(updated.id,{error:undefined});setError(null);
              }} busy={!!currentBuild?.running} stage={currentScenarioProgress} startedAt={scenarioBuildStartedAt}
              expectedScenes={scenarioBuildSceneCount} error={currentBuild?.error ?? error}
              onSaveScript={async (text) => {
                const updated = await saveProject(aiStoryBriefProject.id, { videoBrief: { ...aiStoryBriefProject.videoBrief, prompt: aiStoryBriefProject.title, competitorTranscripts: [], creationMode: "script", readyScript: text } });
                void prepareReadyProject(updated);
              }}
              onBuild={mode => void prepareReadyProject(aiStoryBriefProject,mode)}
              onNavigate={stage => openProjectWorkflowStage(aiStoryBriefProject.id, stage)} />}
            {activeSection === "projects" && <ProjectsPage projects={projects} busy={busy} onCreate={() => void createProject()} onOpen={(id) => openProject(id, "project")} onDuplicate={(id) => void duplicateProject(id)} onDelete={(id) => void deleteProject(id)} onPreview={(id) => setOverlay({ type: "preview", projectId: id })} onTimeline={(id) => setOverlay({ type: "timeline", projectId: id })} onGenerate={(id) => void startGeneration(id)} onAssemble={(id) => void reassembleProject(id)} onRefreshMontage={id=>void refreshDocumentaryMontage(id)} onOpenFolder={(id) => void openProjectFolder(id)} onSave={saveProject} />}
            {activeSection === "queue" && <QueuePage tasks={queue} projects={projects} workflowProject={selectedProjectHasProductionContext ? selectedProject : undefined} autoStockProgress={autoStockProgress} onApplied={updated=>upsertProject(updated,false)} onReviseArtwork={reviseDocumentaryArtwork} onNavigateStage={openProjectWorkflowStage} onContinue={startGeneration} onPause={(id) => void queueAction(() => api.pauseGeneration(id))} onResume={(id) => void queueAction(async () => { assertCompatibleBuild(appInfo); return api.resumeGeneration(id); })} onStop={(id) => queueAction(() => api.stopGeneration(id))} onRetry={(id) => void queueAction(async () => { assertCompatibleBuild(appInfo); return api.retryTask(id); })} onClear={() => void queueAction(() => api.clearFinishedTasks())} onClearAll={() => void queueAction(() => api.clearQueue())} />}
            {activeSection === "console" && <ConsolePage entries={consoleEntries} viewState={consoleView} onViewStateChange={setConsoleView} onClear={clearConsole} onOpenFile={() => void api.openLogFile()} />}
            {activeSection === "settings" && <ClearSettingsPage appInfo={appInfo} projects={projects} />}
            {activeSection === "library" && <EffectLibraryPage api={api} />}
            {!(["channels", "analytics", "library", "dashboard", "project", "scenario", "director", "projects", "queue", "console", "settings"] as SectionKey[]).includes(activeSection) && <ToolPage section={activeSection} onAction={() => setNotice("Этот инструмент подключим после добавления соответствующего API. Экран уже готов к интеграции.")} />}
          </div>
          <GlobalProgressBar
            tasks={queue}
            projects={projects}
            collapsed={progressCollapsed}
            onToggle={() => setProgressCollapsed((value) => !value)}
            onOpen={(projectId) => void openQueueSafely(projectId)}
          />
          <ConsoleDock open={consoleOpen} queue={queue} entries={consoleEntries} viewState={consoleView} onViewStateChange={setConsoleView} onToggle={() => setConsoleOpen((value) => !value)} onClear={clearConsole} onOpenFile={() => void api.openLogFile()} />
        </section>
      </div>
      {overlay && overlayProject && (
        <ProjectPreviewModal
          key={overlayProject.id}
          project={overlayProject}
          mode={overlay.type}
          onModeChange={(mode) => setOverlay({ type: mode, projectId: overlayProject.id })}
          hasQueueTasks={queue.some((task) => task.projectId === overlayProject.id)}
          onClose={() => setOverlay(null)}
          onRegenerate={(sceneId, target) => regenerateScene(overlayProject.id, sceneId, target).then(() => undefined)}
          onOpenFolder={() => void openProjectFolder(overlayProject.id)}
          onAssemble={() => reassembleProject(overlayProject.id)}
          onSave={saveProject}
          onNavigateStage={(stage) => openProjectWorkflowStage(overlayProject.id, stage)}
          onEditScenario={() => {
            setOverlay(null);
            setSelectedProjectId(overlayProject.id);
            setScenarioView("editor");
            navigate("scenario");
          }}
          onToggleScene={(sceneId, include) => void toggleSceneAssembly(overlayProject.id, sceneId, include)}
        />
      )}
      {autoStockProgress && !autoStockHidden && !(activeSection === "queue" && autoStockProgress.projectId === selectedProject?.id) && (
        <AutoStockProgressToast
          progress={autoStockProgress}
          project={projects.find((project) => project.id === autoStockProgress.projectId)}
          result={autoStockResult?.project.id === autoStockProgress.projectId ? autoStockResult : null}
          projectTitle={projects.find((project) => project.id === autoStockProgress.projectId)?.title}
          onOpenProject={() => {
            setSelectedProjectId(autoStockProgress.projectId);
            setProjectEditorStage("settings");
            setActiveSection("project");
          }}
          onClose={() => setAutoStockHidden(true)}
        />
      )}
      {returnProject && !onReturnProjectScreen && !returnDockHidden && <aside className="active-video-dock" aria-label="Текущий ролик">
        <button className="active-video-return" onClick={() => void (async () => { if (await canLeaveActiveEditor()) openProject(returnProject.id); })()}>
          <Clapperboard size={19} /><span><strong>{returnProject.title}</strong><small>{channels.find(channel => channel.id === returnProject.channelProfileId)?.name ?? "Ролик"}</small><em>{scenarioBuilds[returnProject.id]?.running ? "Подготовка сценария…" : returnProject.status === "generating" ? "Идёт производство" : returnProject.storyCharacters?.some(character => character.status === "generating") ? "Создаётся образ персонажа…" : statusLabels[returnProject.status]} · Вернуться</em></span>
        </button>
        <button className="icon-button" aria-label="Скрыть карточку ролика" title="Скрыть. Вернуть можно кнопкой «Показать текущий ролик» в боковой панели" onClick={() => setReturnDockHidden(true)}><X size={15} /></button>
      </aside>}
      {window.goldWork && (
        <StartupHealthToast api={api} openRequest={healthOpenRequest} onOpenSettings={() => void navigateSafely("settings")} />
      )}
      {error && (
        <div className="error-toast">
          <X size={15} />
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}
      {notice && (
        <div className="notice-toast">
          <Check size={15} />
          <span>{notice}</span>
          <button onClick={() => setNotice(null)}>×</button>
        </div>
      )}
    </div>
    </ScenarioPreparationContext.Provider>
  );
}

function AutoStockProgressToast({ progress, result, project, projectTitle, onOpenProject, onClose }: {
  progress: AutoStockProgress;
  result: AutoStockSelectionResult | null;
  project?: Project;
  projectTitle?: string;
  onOpenProject: () => void;
  onClose: () => void;
}) {
  const documentary=project?.settings.assembly.documentary?.version===2;
  const included=project?.scenes.filter(s=>s.includeInAssembly!==false)??[];
  const total=documentary?included.length:progress.total;
  const ready=documentary?included.filter(materialReady).length:progress.completed;
  const percent = total > 0 ? Math.floor((ready / total) * 100) : 0;
  const stopped = progress.phase === "failed" || progress.phase === "stopped";
  const complete = progress.phase === "complete" || stopped;
  const failed = result?.failed ?? progress.failed;
  const actualStockVideo = result?.project.scenes.filter((scene) => (
    scene.includeInAssembly !== false && stockMaterialApplied(scene) && scene.stockSource?.mediaType === "video"
  )).length ?? 0;
  const actualStockImage = result?.project.scenes.filter((scene) => (
    scene.includeInAssembly !== false && stockMaterialApplied(scene) && scene.stockSource?.mediaType === "image"
  )).length ?? 0;
  const coverage = result?.project.settings.assembly.documentary?.version === 2 ? documentaryVideoCoverage(result.project.scenes) : undefined;
  return (
    <aside className={`auto-stock-toast${complete ? " complete" : ""}${complete && failed > 0 ? " failed" : ""}`} aria-live="polite">
      <header>
        <span className="auto-stock-toast-icon">{complete && failed > 0 ? <CircleAlert size={18} /> : complete ? <Check size={18} /> : <Search size={18} />}</span>
        <div>
          <strong>{stopped ? "Подбор приостановлен" : complete ? failed > 0 ? "Stock подобран не полностью" : "Stock подобран" : "Автоподбор stock"}</strong>
          <small>{projectTitle ?? "Ролик"}</small>
        </div>
        <button className="auto-stock-toast-close" onClick={onClose} aria-label="Скрыть подбор материалов" title="Скрыть. Вернуть можно в боковой панели; подбор продолжится."><X size={15} /></button>
      </header>
      <p>{progress.message}</p>
      {documentary && !complete && <small>Обработано {progress.completed} из {total}; подтверждено {ready}. {progress.currentSceneNumber ? `Сцена №${progress.currentSceneNumber} — её номер, а не число готовых кадров.` : 'Номер сцены не равен числу готовых кадров.'}</small>}
      <div className="auto-stock-toast-counts">
        <span>{documentary?'Подтверждено: ':''}{ready} из {total}</span>
        <strong>{percent}%</strong>
      </div>
      <i className="auto-stock-toast-bar"><em style={{ width: `${percent}%` }} /></i>
      {complete && result && (
        <div className="auto-stock-toast-result">
          <span>Фактически: {actualStockVideo} видео · {actualStockImage} фото</span>
          {coverage && <span>Видео: {coverage.percent}% длительности · цель {result.project.settings.stockVideoPercent}%</span>}
          <span>Подтверждено в этом запуске: {result.selected}</span>
          {result.skipped > 0 && <span>Уже было: {result.skipped}</span>}
          {failed > 0 && <span>Не подтверждено: {failed}</span>}
          {result.failures.slice(0, 3).map((failure) => (
            <small key={failure.sceneId} title={failure.message}>
              Сцена {failure.sceneNumber}: {stockFailureLabel(failure.category)} — {failure.message}
            </small>
          ))}
          {failed > 0 && <button onClick={onOpenProject}>Открыть и повторить</button>}
        </div>
      )}
    </aside>
  );
}

function stockFailureLabel(category: AutoStockSelectionResult["failures"][number]["category"]): string {
  if (category === "no-results") return "нет релевантных результатов";
  if (category === "content-rejected") return "материал отклонён по содержимому";
  if (category === "budget-exhausted") return "исчерпан бюджет подбора";
  if (category === "analysis") return "проверка материала не завершена";
  if (category === "download") return "ошибка скачивания";
  if (category === "cdn") return "ошибка CDN";
  if (category === "invalid-key") return "неправильный ключ";
  if (category === "provider-temporary") return "временная ошибка провайдера";
  return "неизвестная ошибка";
}

/** Языки проекта: один клик по кнопке с флагом вместо ручного ввода. */
const PROJECT_LANGUAGES: Array<{ label: string; flag: string }> = [
  { label: "Русский", flag: "🇷🇺" },
  { label: "English", flag: "🇬🇧" },
  { label: "Español", flag: "🇪🇸" },
  { label: "Deutsch", flag: "🇩🇪" },
  { label: "Français", flag: "🇫🇷" },
  { label: "Italiano", flag: "🇮🇹" },
  { label: "Português", flag: "🇵🇹" },
  { label: "Українська", flag: "🇺🇦" },
];

/** Приводит голос проекта к id каталога: старые голые имена → edge-tts/, "custom" и пустое → глобальная настройка. */
function normalizeVoiceId(voice: string): string {
  const value = (voice ?? "").trim();
  if (!value || value === "custom") return "";
  if (value.includes("/") || value === "google-tts") return value;
  return `edge-tts/${value}`;
}

type StepHint = { now: string; next?: string; action?: { label: string; section: SectionKey } };

/** Определяет по состоянию приложения, что пользователю сделать сейчас и что произойдёт дальше. */
function computeStepHint(
  appInfo: Awaited<ReturnType<DesktopApi["getAppInfo"]>> | null,
  project: Project | undefined,
  queue: QueueTask[],
  activeSection: SectionKey,
  directorProgress: string | null
): StepHint | null {
  if (appInfo?.mockMode) {
    return {
      now: "подключите ключи AnyModel и YouTube в Настройках — пока работают заглушки без реальной генерации",
      next: "после подключения выберите канал и нажмите «Новый ролик»",
      action: { label: "Открыть настройки", section: "settings" },
    };
  }
  if (project?.status === "generating") {
    const tasks = queue.filter((task) => task.projectId === project.id);
    const exporting = tasks.some(task => task.kind === "assemble" && !task.prepareOnly
      && ["pending", "running", "retry_wait", "paused"].includes(task.status));
    const done = tasks.filter((task) => task.status === "done").length;
    const percent = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
    const readyScenes = project.scenes.filter((scene) => scene.status === "ready").length;
    return {
      now: `идёт генерация «${project.title}»: ${percent}% — сцен готово ${readyScenes} из ${project.scenes.length}`,
      next: exporting || project.stockProduction ? "после автоматического экспорта Final.mp4 появится в проекте"
        : "после подготовки откроется редактор; Final.mp4 создаётся кнопкой «Экспорт»",
      action: { label: "Открыть очередь", section: "queue" },
    };
  }
  if (project?.status === "paused") {
    return {
      now: `генерация «${project.title}» на паузе`,
      next: "продолжите или остановите её в Очереди",
      action: { label: "Открыть очередь", section: "queue" },
    };
  }
  if (project?.status === "complete" && project.outputPath) {
    if (project.lastRender?.engine === "ffmpeg-fallback") {
      return {
        now: `«${project.title}» собран резервным FFmpeg: Remotion не завершил монтаж`,
        next: "откройте экспорт, посмотрите причину и повторите сборку после исправления Remotion",
        action: { label: "Открыть экспорт", section: "projects" },
      };
    }
    return {
      now: `«${project.title}» готов — Final.mp4 собран`,
      next: "откройте предпросмотр или папку проекта, либо создайте новый ролик с готовым сценарием",
      action: { label: "К проектам", section: "projects" },
    };
  }
  if (project?.status === "failed") {
    return {
      now: `в «${project.title}» есть незавершённые или упавшие задачи`,
      next: project.mediaMode === "stock" && project.settings.assembly.documentary?.version === 2
        ? "проверьте причину ошибки и продолжите кнопкой «Собрать ролик»; готовые запросы, материалы и озвучка сохранятся"
        : "откройте Очередь и повторите упавшие задачи или запустите генерацию заново",
      action: { label: "Открыть очередь", section: "queue" },
    };
  }
  if (project?.status === "ready" && project.mediaMode === "stock"
    && project.settings.assembly.documentary?.version === 2 && projectEditorReady(project)) {
    return {
      now: `материалы «${project.title}» готовы к редактированию`,
      next: "откройте «Редактор», проверьте монтаж и нажмите «Экспорт» для создания Final.mp4",
    };
  }
  if (activeSection === "project" && project) {
    if (project.scenes.length === 0) {
      return {
        now: directorProgress ?? "выберите длину ролика и язык (кнопки с флагами) и нажмите «Собрать сценарий»",
        next: project.mediaMode === "stock"
          ? "после подготовки проверьте настройки и нажмите «Собрать ролик»"
          : "когда сцены появятся, проверьте текст и нажмите «Генерировать видео»",
      };
    }
    if (project.mediaMode === "stock") {
      const included = project.scenes.filter((scene) => scene.includeInAssembly !== false);
      const selected = included.filter(stockMaterialApplied).length;
      return {
        now: `режим Stock: готово материалов ${selected} из ${included.length}`,
        next: project.settings.assembly.documentary?.version === 2
          ? "нажмите «Собрать ролик» — материалы, озвучка, монтаж и экспорт выполнятся автоматически"
          : selected === included.length
          ? "нажмите «Собрать ролик» — начнётся озвучка и сборка"
          : "нажмите «Автоподобрать сток и собрать» — софт сам найдёт и скачает материалы",
      };
    }
    return {
      now: `проверьте сцены (${project.scenes.length} шт.) и настройки: язык, формат, озвучка, референсы`,
      next: project.mediaMode === "mixed"
        ? "выберите нужные stock-сцены; остальные кадры сгенерирует AI"
        : "нажмите «Генерировать видео» — по сценам сгенерируются картинки и озвучка",
    };
  }
  if (activeSection === "channels") {
    return {
      now: "выберите канал или создайте новый, затем нажмите «Новый ролик»",
      next: "Master Prompt канала подставится автоматически — останется указать задачу ролика",
    };
  }
  if (activeSection === "director") {
    return {
      now: "опишите тему ролика или вставьте ссылку на видео/канал YouTube и напишите задачу",
      next: "после уточнения темы соберётся сценарий и откроются настройки ролика",
    };
  }
  if (!project) {
    return {
      now: "начните с разбора: вставьте ссылку на видео или канал в AI Генераторе",
      next: "по выбранной теме соберётся проект со сценами",
      action: { label: "Создать ролик", section: "director" },
    };
  }
  return {
    now: `проект «${project.title}» ждёт: проверьте сценарий и настройки`,
    next: "запустите генерацию — прогресс появится в очереди и на подсказке",
    action: { label: "Открыть проект", section: "project" },
  };
}

/** Тонкая строка-подсказка вверху рабочей области: «Сейчас … → Дальше …». */
function StepHintBar({ hint, onNavigate }: { hint: StepHint | null; onNavigate: (section: SectionKey) => void }) {
  if (!hint) return null;
  return (
    <div className="step-hint-bar">
      <Lightbulb size={14} />
      <span className="step-hint-now"><strong>Сейчас:</strong> {hint.now}</span>
      {hint.next && <span className="step-hint-next"><strong>Дальше:</strong> {hint.next}</span>}
      {hint.action && <button onClick={() => onNavigate(hint.action!.section)}>{hint.action.label}</button>}
    </div>
  );
}

const PROJECT_WORKFLOW_STAGES: Array<{ id: ProjectWorkflowStage; label: string; lockedHint: string }> = [
  { id: "brief", label: "Задание", lockedHint: "" },
  { id: "scenario", label: "Сценарий", lockedHint: "Сначала заполните задание ролика." },
  { id: "settings", label: "Настройки", lockedHint: "Сначала соберите сценарий." },
  { id: "materials", label: "Материалы", lockedHint: "Сначала заполните текст и длительность сцен." },
  { id: "production", label: "Производство", lockedHint: "Производство ещё не запускалось." },
  { id: "editor", label: "Редактор", lockedHint: "Редактор откроется после появления первых материалов." },
  { id: "export", label: "Экспорт", lockedHint: "Сначала подготовьте материалы и озвучку." },
];

function ProjectWorkflowBar({
  project,
  current,
  hasQueueTasks = false,
  busy = false,
  onNavigate,
}: {
  project: Project;
  current: ProjectWorkflowStage;
  hasQueueTasks?: boolean;
  busy?: boolean;
  onNavigate: (stage: ProjectWorkflowStage) => void;
}) {
  const preparingScenario = useContext(ScenarioPreparationContext).has(project.id);
  const includedScenes = project.scenes.filter((scene) => scene.includeInAssembly !== false);
  const meaningfulTopic = project.topic.trim() && project.topic.trim() !== "Опишите тему нового видео";
  const briefComplete = Boolean(project.videoBrief?.prompt.trim() || project.referenceAnalysis || meaningfulTopic);
  const scenarioComplete = includedScenes.length > 0
    && !scenarioReviewBlockReason(project)
    && includedScenes.every((scene) => Boolean(scene.narration.trim()) && scene.durationSeconds > 0);
  const settingsComplete = scenarioComplete && Boolean(
    project.language.trim()
    && project.aspectRatio
    && project.settings.durationMinutes > 0
    && project.settings.image.provider
    && (!project.settings.voice.enabled || project.settings.voice.provider),
  );
  const materialsComplete = scenarioComplete
    && includedScenes.every((scene) => {
      if (project.mediaMode === "stock") return stockMaterialApplied(scene);
      if (project.mediaMode === "mixed" && scene.stockSource) return stockMaterialApplied(scene);
      return Boolean(scene.imagePrompt.trim());
    });
  const mediaStarted = includedScenes.some((scene) => Boolean(scene.imagePath || scene.videoPath || scene.audioPath));
  const productionStarted = hasQueueTasks || ["generating", "paused", "failed", "complete"].includes(project.status);
  const finalReady = project.status === "complete" && Boolean(project.outputPath);
  const editorReady = projectEditorReady(project);
  const workflowStages = PROJECT_WORKFLOW_STAGES;
  const rules: Record<ProjectWorkflowStage, { available: boolean; complete: boolean }> = {
    brief: { available: true, complete: briefComplete },
    scenario: { available: briefComplete || project.scenes.length > 0, complete: scenarioComplete },
    settings: { available: scenarioComplete, complete: settingsComplete },
    materials: { available: scenarioComplete, complete: materialsComplete },
    production: { available: productionStarted, complete: editorReady && project.status !== "generating" },
    editor: { available: mediaStarted || Boolean(project.outputPath), complete: finalReady },
    export: { available: editorReady || finalReady, complete: finalReady },
  };

  return (
    <nav className="project-workflow" aria-label="Этапы ролика" aria-busy={busy || preparingScenario}>
      <div className="project-workflow-heading">
        <span>ЭТАПЫ РОЛИКА</span>
        <strong title={project.title}>{project.title} · {workflowStages.findIndex((step) => step.id === current) + 1} из {workflowStages.length} · {workflowStages.find((step) => step.id === current)?.label}</strong>
      </div>
      <ol style={{ gridTemplateColumns: `repeat(${workflowStages.length}, minmax(98px, 1fr))` }}>
        {workflowStages.map((step, index) => {
          const active = step.id === current;
          const blocked = preparingScenario && index > 1;
          const available = !blocked && (active || rules[step.id].available);
          const complete = !active && rules[step.id].complete;
          const running = step.id === "production" && (project.status === "generating" || project.status === "paused");
          const failed = step.id === "production" && project.status === "failed";
          const status = failed ? "error" : running ? "running" : active ? "current" : complete ? "complete" : available ? "available" : "locked";
          const accessibilityStatus = active ? "текущий этап" : complete ? "готово" : available ? "доступно" : "недоступно";
          return (
            <li className={status} data-flow-status={status} key={step.id}>
              <button
                type="button"
                data-flow-step={step.id}
                aria-current={active ? "step" : undefined}
                aria-label={step.label + ": " + accessibilityStatus}
                title={blocked ? "Подготавливаю сценарий этого ролика…" : available ? step.label : step.lockedHint}
                disabled={active || !available}
                onClick={() => onNavigate(step.id)}
              >
                <span className="project-workflow-mark">{complete ? <Check size={11} /> : index + 1}</span>
                <span>{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}


function generationTimeLabel(tasks: QueueTask[]): string {
  const unfinished = tasks.filter((task) => !["done", "cancelled", "failed", "blocked"].includes(task.status));
  if (tasks.some((task) => task.status === "failed" || task.status === "blocked")) {
    return "нужна проверка: есть ошибка";
  }
  if (unfinished.length === 0) return "готово";
  if (unfinished.every((task) => task.status === "paused")) return "на паузе";
  const weight: Record<QueueTask["kind"], number> = {
    director: 60,
    speech: 30,
    image: 60,
    video: 150,
    assemble: 90,
  };
  const parallelWork = unfinished
    .filter((task) => task.kind === "director" || task.kind === "speech" || task.kind === "image")
    .reduce((sum, task) => sum + weight[task.kind], 0) / 4;
  const videoWork = unfinished.filter((task) => task.kind === "video").reduce((sum, task) => sum + weight[task.kind], 0);
  const assemblyWork = unfinished.filter((task) => task.kind === "assemble").reduce((sum, task) => sum + weight[task.kind], 0);
  const expected = Math.max(parallelWork, videoWork) + assemblyWork;
  const lower = Math.max(30, expected * 0.8);
  const upper = Math.max(60, expected * 1.35);
  return `осталось примерно ${formatEtaDuration(lower)}–${formatEtaDuration(upper)}`;
}

function retryCountdown(task: QueueTask): string | null {
  if (task.status !== "retry_wait" || !task.nextAttemptAt) return null;
  const seconds = Math.max(0, Math.ceil((Date.parse(task.nextAttemptAt) - Date.now()) / 1_000));
  return formatEtaDuration(seconds);
}

function queueTaskStatusText(task: QueueTask): string {
  const retryIn = retryCountdown(task);
  if (retryIn) return `Временная ошибка — повтор автоматически через ${retryIn}`;
  if (task.status === "pending" && task.attempts > 0) return "Повтор поставлен в очередь";
  return taskStatusLabel(task.status);
}

function GlobalProgressBar({ tasks, projects, collapsed, onToggle, onOpen }: { tasks: QueueTask[]; projects: Project[]; collapsed: boolean; onToggle: () => void; onOpen: (projectId: string) => void }) {
  const activeStatuses = new Set<QueueTask["status"]>(["pending", "running", "retry_wait", "paused"]);
  const activeRunIds = new Set(tasks.filter((task) => activeStatuses.has(task.status)).map((task) => task.runId));
  const relevant = tasks.filter((task) => activeRunIds.has(task.runId));
  if (relevant.length === 0) return null;
  const projectId = relevant.find((task) => activeStatuses.has(task.status))?.projectId ?? relevant[0]?.projectId;
  if (!projectId) return null;
  const project = projects.find((item) => item.id === projectId);
  const activeProjectIds = new Set(relevant.filter((task) => activeStatuses.has(task.status)).map((task) => task.projectId));
  const title = activeProjectIds.size > 1 ? `Генерация: ${activeProjectIds.size} проекта` : project?.title ?? "Генерация";
  const summary = (kind: QueueTask["kind"]) => {
    const items = relevant.filter((task) => task.kind === kind);
    return { total: items.length, done: items.filter((task) => task.status === "done").length, progress: items.length ? Math.round(items.reduce((sum, task) => sum + (task.status === "done" ? 100 : task.progress), 0) / items.length) : 0 };
  };
  const images = summary("image");
  const videos = summary("video");
  const speech = summary("speech");
  const assembly = summary("assemble");
  const overall = Math.round(relevant.reduce((sum, task) => sum + (task.status === "done" ? 100 : task.progress), 0) / relevant.length);
  return (
    <section className={`global-progress${collapsed ? " collapsed" : ""}`}>
      <button className="global-progress-head" onClick={onToggle}>
        <span><Zap size={14} />{title}<small>{generationTimeLabel(relevant)}</small></span>
        <strong>{overall}%</strong>
        <span>{collapsed ? "⌃" : "⌄"}</span>
      </button>
      {!collapsed && (
        <div className="global-progress-stages">
          {images.total > 0 && <button onClick={() => onOpen(projectId)}><Image size={14} /><span>Картинки <b>{images.done}/{images.total}</b></span><i><em style={{ width: `${images.progress}%` }} /></i></button>}
          {videos.total > 0 && <button onClick={() => onOpen(projectId)}><Video size={14} /><span>Видео <b>{videos.done}/{videos.total}</b></span><i><em style={{ width: `${videos.progress}%` }} /></i></button>}
          {speech.total > 0 && <button onClick={() => onOpen(projectId)}><Mic2 size={14} /><span>Озвучка <b>{speech.done}/{speech.total}</b></span><i><em style={{ width: `${speech.progress}%` }} /></i></button>}
          {assembly.total > 0 && <button onClick={() => onOpen(projectId)}><Clapperboard size={14} /><span>Сборка <b>{assembly.progress}%</b></span><i><em style={{ width: `${assembly.progress}%` }} /></i></button>}
        </div>
      )}
    </section>
  );
}

function shortBuildId(value: string): string {
  return value.length > 24 ? `${value.slice(0, 15)}…${value.slice(-7)}` : value;
}

function assertCompatibleBuild(appInfo: Awaited<ReturnType<DesktopApi["getAppInfo"]>> | null): void {
  if (!window.goldWork) return;
  if (!appInfo) throw new Error("Electron main ещё не подтвердил версию сборки. Подождите несколько секунд и повторите.");
  if (appInfo.buildId !== APP_BUILD_ID) {
    throw new Error(
      `Нельзя запустить производство: renderer ${shortBuildId(APP_BUILD_ID)} и Electron main ${shortBuildId(appInfo.buildId)} не совпадают. `
      + "Полностью перезапустите Gold Work Studio."
    );
  }
}

async function assertCurrentRuntimeBuild(api: DesktopApi): Promise<void> {
  if (!window.goldWork) return;
  assertCompatibleBuild(await api.getAppInfo());
}

function TitleBar({ appInfo }: { appInfo: Awaited<ReturnType<DesktopApi["getAppInfo"]>> | null }) {
  const api = window.goldWork ?? fallbackApi;
  const mismatch = Boolean(window.goldWork && appInfo && appInfo.buildId !== APP_BUILD_ID);
  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span>GW</span>
        <strong>GOLDWORK STUDIO</strong>
        <small
          className={`main-build-badge${mismatch ? " mismatch" : ""}`}
          data-build-id={appInfo?.buildId ?? APP_BUILD_ID}
          title={appInfo
            ? `Electron main: ${appInfo.buildId}\nСессия: ${appInfo.mainSessionId}\nPID: ${appInfo.mainProcessId}`
            : `Renderer: ${APP_BUILD_ID}`}
        >
          MAIN {shortBuildId(appInfo?.buildId ?? APP_BUILD_ID)}{appInfo ? ` · ${appInfo.mainSessionId}` : " · preview"}
        </small>
      </div>
      <div className="window-actions">
        <button aria-label="Свернуть" onClick={() => void api.minimizeWindow()}>
          —
        </button>
        <button aria-label="Развернуть" onClick={() => void api.toggleMaximizeWindow()}>
          □
        </button>
        <button aria-label="Закрыть" onClick={() => void api.closeWindow()}>
          ×
        </button>
      </div>
    </header>
  );
}

function Sidebar({ active, appInfo, onNavigate, onRestoreVideo, onRestoreStock, onOpenHealth }: { active: SectionKey; appInfo: Awaited<ReturnType<DesktopApi["getAppInfo"]>> | null; onNavigate: (section: SectionKey) => void; onRestoreVideo?: () => void; onRestoreStock?: () => void; onOpenHealth?: () => void }) {
  const visibleActive: SectionKey = active === "dashboard" || active === "project" || active === "scenario" ? "projects" : active;
  return (
    <aside className="sidebar">
      <div className="sidebar-nav">
        {navigation.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map((item) => (
              <button
                key={item.key}
                className={`nav-item${visibleActive === item.key ? " active" : ""}`}
                data-nav-key={item.key}
                aria-current={visibleActive === item.key ? "page" : undefined}
                onClick={() => onNavigate(item.key)}
              >
                {item.icon}
                <span>{item.title}</span>
                {item.beta && <em>BETA</em>}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        {onOpenHealth && <button className="settings-link" data-action="open-health" onClick={onOpenHealth}><Activity size={17} /><span>Подключения</span></button>}
        {onRestoreVideo && <button className="settings-link restore-video-dock" onClick={onRestoreVideo}><Clapperboard size={17} /><span>Показать текущий ролик</span></button>}
        {onRestoreStock && <button className="settings-link" onClick={onRestoreStock}><Search size={17} /><span>Показать подбор материалов</span></button>}
        <button
          className={`settings-link${active === "settings" ? " active" : ""}`}
          data-nav-key="settings"
          aria-current={active === "settings" ? "page" : undefined}
          onClick={() => onNavigate("settings")}
        >
          <Settings size={17} />
          Настройки
        </button>
        <div className="app-stats">
          <span>
            <i />
            Готов
          </span>
          <span>GoldWork Studio v{appInfo?.version ?? "0.2.0"}</span>
          <span title={appInfo?.buildId ?? APP_BUILD_ID}>Main: {shortBuildId(appInfo?.buildId ?? APP_BUILD_ID)}</span>
        </div>
      </div>
    </aside>
  );
}

function Dashboard({ projects, selectedId, busy, onCreate, onOpen, onDelete, onPreview, onGenerate, onNavigate, onOpenFolder }: { projects: Project[]; selectedId?: string; busy: boolean; onCreate: () => void; onOpen: (id: string) => void; onDelete: (id: string) => void; onPreview: (id: string) => void; onGenerate: (id: string) => void; onNavigate: (section: SectionKey) => void; onOpenFolder: (id: string) => void }) {
  const tools: Array<{
    title: string;
    subtitle: string;
    icon: ReactNode;
    route: SectionKey;
  }> = [
    {
      title: "Превью",
      subtitle: "AI генерация обложек",
      icon: <Image size={19} />,
      route: "thumbnail",
    },
    {
      title: "Аватарка",
      subtitle: "Генератор аватарок",
      icon: <CircleUserRound size={19} />,
      route: "avatar",
    },
    {
      title: "SEO",
      subtitle: "Заголовки и теги",
      icon: <Search size={19} />,
      route: "seo",
    },
    {
      title: "Сценарий",
      subtitle: "Auto / Custom",
      icon: <FileText size={19} />,
      route: "scenario",
    },
  ];
  const chosenId = selectedId ?? projects[0]?.id;
  // Батч-запуск: все проекты со сценами, которые сейчас не генерируются.
  const batchReady = projects.filter((project) => project.scenes.length > 0 && project.status !== "generating" && project.status !== "paused");
  return (
    <div className="dashboard-page page-with-actionbar">
      <PageHeading icon={<Zap size={25} />} title="Dashboard" subtitle="Управление проектами видео" />
      <section className="quick-panel">
        <h2>
          <Grid2X2 size={16} />
          Быстрые инструменты
        </h2>
        <div className="quick-grid">
          {tools.map((tool) => (
            <button className="quick-card" key={tool.title} onClick={() => onNavigate(tool.route)}>
              <span>{tool.icon}</span>
              <strong>{tool.title}</strong>
              <small>{tool.subtitle}</small>
            </button>
          ))}
        </div>
      </section>
      <div className="projects-heading">
        <h2>
          <Folder size={17} />
          Проекты <span>({projects.length})</span>
        </h2>
        <div>
          <button className="ghost-button" disabled={!chosenId} onClick={() => chosenId && onOpenFolder(chosenId)}>
            <FolderOpen size={15} />
            Папка с видео
          </button>
          <button className="ghost-button" onClick={onCreate}>
            <Plus size={15} />
            Добавить ({projects.length}/30)
          </button>
        </div>
      </div>
      {projects.length === 0 ? (
        <EmptyState icon={<Clapperboard size={34} />} title="Пока нет проектов" text="Создайте первый проект и добавьте сцены будущего ролика." action="Новый проект" onAction={onCreate} />
      ) : (
        <div className="project-list">
          {projects.map((project, index) => (
            <article className={`project-row${project.id === selectedId ? " selected" : ""}`} key={project.id} onClick={() => onOpen(project.id)}>
              <span className="project-check">
                <Check size={12} />
              </span>
              <span className="project-number">{index + 1}</span>
              <span className="project-main">
                <strong>{project.title}</strong>
                <small>
                  <Languages size={12} />
                  {project.language}
                  <i />
                  {project.scenes.length} сцен
                  <i />
                  <Mic2 size={12} />
                  {project.settings.voice.provider}
                  <i />
                  <Image size={12} />
                  {project.settings.image.provider}
                </small>
              </span>
              <span className={`project-status status-${project.status}`}>{statusLabels[project.status]}</span>
              <span className="project-actions">
                <button
                  title="Предпросмотр"
                  onClick={(event) => {
                    event.stopPropagation();
                    onPreview(project.id);
                  }}
                >
                  <Eye size={15} />
                </button>
                <button
                  className="danger"
                  title="Удалить"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(project.id);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </span>
            </article>
          ))}
        </div>
      )}
      <div className="sticky-actions">
        <div>
          <button className="outline-button" onClick={onCreate} disabled={busy}>
            <Plus size={17} />
            {busy ? "Подождите..." : "Новый проект"}
          </button>
          <button className="outline-button gold" disabled={!chosenId} onClick={() => chosenId && onPreview(chosenId)}>
            <Eye size={17} />
            Предпросмотр
          </button>
        </div>
        <div>
          <button
            className="outline-button gold"
            disabled={busy || batchReady.length === 0}
            title="Запускает генерацию всех проектов, у которых есть сцены — можно оставить на ночь"
            onClick={() => {
              if (window.confirm(`Запустить генерацию сразу ${batchReady.length} проектов? Это потратит токены на каждый.`)) {
                batchReady.forEach((project) => onGenerate(project.id));
              }
            }}
          >
            <ListPlus size={17} />
            Сгенерировать все ({batchReady.length})
          </button>
          <button className="generate-button" disabled={!chosenId || busy} onClick={() => chosenId && onGenerate(chosenId)}>
            <Zap size={17} />
            ГЕНЕРИРОВАТЬ ВИДЕО
          </button>
        </div>
      </div>
    </div>
  );
}

function projectEditorSnapshot(project: Project): string {
  return JSON.stringify({
    title: project.title,
    topic: project.topic,
    language: project.language,
    aspectRatio: project.aspectRatio,
    mode: project.mode,
    mediaMode: project.mediaMode,
    settings: project.settings,
    chatTopicId: project.chatTopicId,
  });
}

function scenarioEditorSnapshot(scenes: Scene[]): string {
  return JSON.stringify(scenes.map((scene, order) => ({
    id: scene.id,
    order,
    title: scene.title,
    narration: scene.narration,
    imagePrompt: scene.imagePrompt,
    animationPrompt: scene.animationPrompt,
    durationSeconds: scene.durationSeconds,
    durationOverrideSeconds: scene.durationOverrideSeconds,
    includeInAssembly: scene.includeInAssembly,
    transition: scene.transition,
    kenBurnsDirection: scene.kenBurnsDirection,
  })));
}

type StoryStructurePoint = {
  label: "Хук" | "Вступление" | "Часть" | "Финал";
  title: string;
  summary: string;
  sceneNumber: number;
  endSceneNumber: number;
};

function cleanStoryStructureTitle(value: string): string {
  return value
    .replace(/^\s*(?:хук|hook|вступление|intro|часть\s*\d*|глава\s*\d*|финал|заключение|вывод|outro|ending)\s*[:—–-]?\s*/iu, "")
    .trim();
}

function compactStoryExcerpt(value: string, limit = 118): string {
  const clean = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (clean.length <= limit) return clean;
  const head = clean.slice(0, limit + 1);
  const boundary = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "), head.lastIndexOf(" "));
  return `${head.slice(0, boundary >= Math.floor(limit * 0.62) ? boundary + 1 : limit).trim()}…`;
}

function storyRangeSummary(scenes: Scene[], start: number, end: number): string {
  const range = scenes.slice(start, end + 1).filter((scene) => scene.narration.trim());
  if (range.length === 0) return "Для этого блока текст озвучки пока не задан.";
  const first = compactStoryExcerpt(range[0]!.narration);
  const last = compactStoryExcerpt(range.at(-1)!.narration, 104);
  if (range.length < 2 || first === last) return first;
  return `${first} Затем: ${last.charAt(0).toLocaleLowerCase("ru-RU")}${last.slice(1)}`;
}

function meaningfulStoryTitle(scene: Scene | undefined, fallback: string): string {
  const title = cleanStoryStructureTitle(scene?.title ?? "");
  return title && !/^(?:сцена|кадр)\s*\d+$/iu.test(title) ? title : fallback;
}

/**
 * Собирает понятную карту всего сюжета. Даже старые проекты с тремя слишком
 * общими названиями получают 4–7 последовательных блоков с диапазоном сцен и
 * коротким пересказом фактической озвучки; сам narration не меняется.
 */
function scenarioStoryStructure(project: Project, scenes: Scene[]): StoryStructurePoint[] {
  if (scenes.length === 0) return [];
  const explicit = (project.referenceAnalysis?.structure ?? []).map((item) => item.trim()).filter(Boolean);
  const explicitHook = explicit.find((item) => /(?:^|\s)(?:хук|hook)(?:\s|:|—|–|-|$)/iu.test(item));
  const explicitIntro = explicit.find((item) => /(вступ|intro|контекст|завязк|обещан)/iu.test(item));
  const explicitFinal = explicit.find((item) => /(финал|заключ|вывод|итог|развязк|outro|ending|conclusion)/iu.test(item));
  const explicitMiddle = explicit.filter((item) => item !== explicitHook && item !== explicitIntro && item !== explicitFinal);
  const targetCount = Math.min(scenes.length, scenes.length >= 60 ? 7 : scenes.length >= 30 ? 6 : scenes.length >= 12 ? 5 : scenes.length >= 4 ? 4 : scenes.length);
  const finalStart = scenes.length > 2 ? Math.max(2, scenes.length - Math.max(1, Math.ceil(scenes.length * 0.1))) : scenes.length - 1;
  const boundaries: Array<{ index: number; label: StoryStructurePoint["label"]; title: string }> = [{
    index: 0,
    label: "Хук",
    title: cleanStoryStructureTitle(explicitHook ?? "") || meaningfulStoryTitle(scenes[0], "С чего начинается ролик"),
  }];
  if (scenes.length > 2) {
    boundaries.push({
      index: 1,
      label: "Вступление",
      title: cleanStoryStructureTitle(explicitIntro ?? "") || meaningfulStoryTitle(scenes[1], "Исходная ситуация и обещание"),
    });
  }
  const middleCount = Math.max(0, targetCount - boundaries.length - (scenes.length > 1 ? 1 : 0));
  const firstMiddle = 2;
  const lastMiddle = Math.max(firstMiddle, finalStart - 1);
  for (let part = 0; part < middleCount; part += 1) {
    const ratio = (part + 1) / (middleCount + 1);
    const index = Math.min(lastMiddle, Math.max(firstMiddle, Math.round(firstMiddle + (lastMiddle - firstMiddle) * ratio)));
    if (boundaries.some((point) => point.index === index)) continue;
    const explicitTitle = explicitMiddle[part];
    boundaries.push({
      index,
      label: "Часть",
      title: cleanStoryStructureTitle(explicitTitle ?? "") || meaningfulStoryTitle(scenes[index], `Развитие истории ${part + 1}`),
    });
  }
  if (scenes.length > 1 && !boundaries.some((point) => point.index === finalStart)) {
    boundaries.push({
      index: finalStart,
      label: "Финал",
      title: cleanStoryStructureTitle(explicitFinal ?? "") || meaningfulStoryTitle(scenes[finalStart], "Чем заканчивается история"),
    });
  }
  boundaries.sort((left, right) => left.index - right.index);
  return boundaries.map((point, index) => {
    const end = Math.max(point.index, (boundaries[index + 1]?.index ?? scenes.length) - 1);
    return {
      label: point.label,
      title: point.title,
      summary: storyRangeSummary(scenes, point.index, end),
      sceneNumber: point.index + 1,
      endSceneNumber: end + 1,
    };
  });
}

async function copyPlainText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // В Electron политика clipboard может отличаться между dev и portable;
      // ниже остаётся синхронный DOM-fallback.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Буфер обмена недоступен");
}

function ProjectEditor({ project, currentStage, busy, autoStockProgress, autoStockResult, hasQueueTasks, onBack, onSave, onGenerate, onRefreshMontage, onNavigate, onNavigateStage, onRegisterLeaveGuard, onInfo }: {
  project?: Project;
  currentStage: ProjectEditorStage;
  busy: boolean;
  autoStockProgress: AutoStockProgress | null;
  autoStockResult: AutoStockSelectionResult | null;
  hasQueueTasks: boolean;
  onBack: () => void;
  onSave: (id: string, input: UpdateProjectInput) => Promise<Project>;
  onGenerate: (id: string) => void;
  onRefreshMontage: (id: string) => Promise<Project | undefined>;
  onNavigate: (section: SectionKey) => void;
  onNavigateStage: OpenProjectWorkflowStage;
  onRegisterLeaveGuard: RegisterLeaveGuard;
  onInfo: (message: string) => void;
}) {
  const api = window.goldWork ?? fallbackApi;
  const [draft, setDraft] = useState<Project | null>(() => project ? structuredClone(project) : null);
  const previousProjectRef = useRef(project);
  const leaveGuardRef = useRef<() => Promise<boolean>>(async () => true);
  const [saving, setSaving] = useState(false);
  const voiceSample = useVoiceSample(`${project?.id}:${currentStage}:${draft?.settings.voice.provider}:${draft?.settings.voice.voice}:${draft?.language}`);
  const samplePlaying = voiceSample.playing;
  const samplePreparing = voiceSample.preparing;
  const rebuilding = false;
  const [montageReplanning, setMontageReplanning] = useState(false);
  const [scenarioProgress, setScenarioProgress] = useState<string | null>(null);
  useEffect(() => onRegisterLeaveGuard("project", () => leaveGuardRef.current()), [onRegisterLeaveGuard]);
  useEffect(() => api.onDirectorProgress((text) => setScenarioProgress(text)), []);
  const [voicerTemplates, setVoicerTemplates] = useState<VoicerTemplate[] | null>(null);
  useEffect(() => {
    if (draft?.settings.voice.provider !== "elevenlabs" || voicerTemplates !== null) return;
    api.listVoicerTemplates().then(setVoicerTemplates).catch(() => setVoicerTemplates([]));
  }, [draft?.settings.voice.provider, voicerTemplates]);
  useEffect(() => {
    setDraft(project ? structuredClone(project) : null);
  }, [project?.id]);
  // Фоновые обновления (сборка сценария, генерация) вливаются в черновик, НЕ затирая редактируемый текст.
  useEffect(() => {
    if (!project) return;
    const previous = previousProjectRef.current;
    previousProjectRef.current = project;
    setDraft((current) => mergeProjectEditorDraft(current, previous, project));
  }, [project?.id, project?.updatedAt]);
  if (!draft) {
    leaveGuardRef.current = async () => true;
    return <EmptyState icon={<Clapperboard size={34} />} title="Ролик не выбран" text="Создайте ролик в канале или выберите его в списке." action="Вернуться к роликам" onAction={onBack} />;
  }
  const settings = draft.settings ?? createDefaultProjectSettings();
  const setSettings = (patch: Partial<ProjectSettings>) => setDraft((current) => (current ? { ...current, settings: { ...current.settings, ...patch } } : current));
  const hasUnsavedChanges = !project || projectEditorSnapshot(draft) !== projectEditorSnapshot(project);
  const save = async (): Promise<Project | undefined> => {
    if (!hasUnsavedChanges) return project ?? draft;
    setSaving(true);
    try {
      const input: UpdateProjectInput = {};
      if (!project || draft.title !== project.title) input.title = draft.title;
      if (!project || draft.topic !== project.topic) input.topic = draft.topic;
      if (!project || draft.language !== project.language) input.language = draft.language;
      if (!project || draft.aspectRatio !== project.aspectRatio) input.aspectRatio = draft.aspectRatio;
      if (!project || draft.mode !== project.mode) input.mode = draft.mode;
      if (!project || draft.mediaMode !== project.mediaMode) input.mediaMode = draft.mediaMode;
      if (!project || JSON.stringify(draft.settings) !== JSON.stringify(project.settings)) input.settings = draft.settings;
      if (draft.chatTopicId !== project?.chatTopicId && draft.chatTopicId !== undefined) input.chatTopicId = draft.chatTopicId;
      const saved = await onSave(draft.id, input);
      setDraft(structuredClone(saved));
      return saved;
    } catch {
      // Корневой компонент уже показывает понятное сообщение об ошибке.
      return undefined;
    } finally {
      setSaving(false);
    }
  };
  leaveGuardRef.current = async () => Boolean(await save());
  const generate = async () => {
    const saved = await save();
    if (saved) onGenerate(saved.id);
  };
  const saveAndNavigate = async (section: SectionKey) => {
    const saved = await save();
    if (saved) onNavigate(section);
  };
  const navigateWorkflow = async (stage: ProjectWorkflowStage) => {
    if (stage === currentStage) return;
    const saved = await save();
    if (saved) onNavigateStage(saved.id, stage);
  };
  const saveAndBack = async () => {
    const saved = await save();
    if (saved) onBack();
  };
  const restoreSavedSettings = () => {
    if (!project) return;
    setDraft(structuredClone(project));
    onInfo("Загружены последние сохранённые настройки проекта.");
  };
  const chooseReferences = async () => {
    const selected = await api.pickFiles("image", true);
    if (selected.length === 0) return;
    setSettings({
      image: {
        ...settings.image,
        references: [...new Set([...settings.image.references, ...selected])].slice(0, 3),
      },
    });
    onInfo(`Добавлено референсов: ${Math.min(3, settings.image.references.length + selected.length)}.`);
  };
  const chooseMusic = async () => {
    setSaving(true);
    try {
      const [path] = await api.pickFiles("audio");
      if (!path) return;
      const savedPath = isDocumentary ? await api.importMusic(path) : path;
      const name=path.split(/[\\/]/).at(-1);
      const wave=isDocumentary&&settings.music.clips!==undefined?await loadMusicWaveform(api.mediaUrl(savedPath)):undefined;
      const addedClip:MusicClip|undefined=wave?{id:crypto.randomUUID(),path:savedPath,name,startSeconds:0,durationSeconds:Math.min(wave.durationSeconds,(project?.scenes??[]).filter(scene=>scene.includeInAssembly!==false).reduce((sum,scene)=>sum+Math.max(scene.durationOverrideSeconds??0,(scene.documentary?.timing?.durationInFrames??Math.ceil(scene.durationSeconds*30))/30),0)||wave.durationSeconds),sourceOffsetSeconds:0,sourceDurationSeconds:wave.durationSeconds,volume:100,enabled:true,origin:'manual',status:'ready'}:undefined;
      setSettings({ music: { ...settings.music, path: savedPath, name, ...(isDocumentary ? { enabled: true, sourcePage: undefined, assetId: undefined, selectionStatus: undefined, selectionMessage: undefined, ...(addedClip?{clips:[...settings.music.clips!,addedClip],manualEdits:true}:{}) } : {}) }, ...(isDocumentary ? { assembly: patchStockMontage(settings.assembly, { musicPolicy: "preserve" }) } : {}) });
      onInfo("Фоновая музыка добавлена в проект.");
    } catch (error) { onInfo(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };
  const replanMontage = async () => {
    if (settings.assembly.montage?.enabled === false) return;
    setMontageReplanning(true);
    try {
      await assertCurrentRuntimeBuild(api);
      const saved = await save();
      if (!saved) return;
      const updated = await api.replanMontage(saved.id);
      setDraft(structuredClone(updated));
      const summary = updated.montagePlan;
      onInfo(summary
        ? `План монтажа пересоздан без изменения narration: ${summary.visualBeatCount} VisualBeat, planner ${summary.usedPlanner}.`
        : "План монтажа пересоздан без изменения narration.");
    } catch (reason) {
      onInfo(`Не удалось пересоздать план монтажа: ${errorMessage(reason)}`);
    } finally {
      setMontageReplanning(false);
    }
  };
  const projectLanguageCode = ttsLanguageCode(draft.language).split("-")[0]?.toLowerCase() ?? "en";
  const canStartScenario = Boolean(draft.topic.trim() && draft.topic.trim() !== "Опишите тему нового видео");
  const voiceOptions = TTS_VOICES.filter((voice) => voice.language === "any" || voice.language === projectLanguageCode);
  const selectedMediaMode = draft.mediaMode ?? "stock";
  const isAiStory = selectedMediaMode === "ai";
  const isDocumentary = selectedMediaMode === "stock" && settings.assembly.documentary?.version === 2;
  const stockVideoPercent = stockVideoTarget(settings.stockVideoPercent);
  const autoMontageSceneCount = draft.scenes.filter((scene) => (
    scene.autoTransition !== undefined || scene.autoKenBurnsDirection !== undefined
  )).length;
  const montageSettings = settings.assembly.montage ?? {
    enabled: true,
    planner: "ai-bounded" as const,
    density: "balanced" as const,
    graphicBeatPercent: 28,
    hardCutPercent: 78,
  };
  const effectiveMontageEnabled = !isAiStory && montageSettings.enabled;
  const veoSelectionMode = settings.video.selectionMode ?? "auto";
  const eligibleVeoSceneCount = draft.scenes.filter((scene) => scene.includeInAssembly !== false && !scene.stockSource).length;
  const plannedVeoSceneCount = veoSelectionMode === "manual"
    ? 0
    : veoSelectionMode === "every-second"
      ? Math.floor(eligibleVeoSceneCount / 2)
      : veoSelectionMode === "every-third"
        ? Math.floor(eligibleVeoSceneCount / 3)
        : Math.max(eligibleVeoSceneCount > 0 ? 1 : 0, Math.round(eligibleVeoSceneCount * settings.video.animationPercent / 100));
  const slideshowTransitionType = settings.assembly.fadeTransitions
    ? settings.assembly.transitionType ?? "mix"
    : "none";
  const slideshowTransitionDuration = Math.min(
    isAiStory ? 1 : 2,
    Math.max(isAiStory ? 0.15 : 0.1, settings.assembly.transitionDurationSeconds ?? (selectedMediaMode === "ai" ? 0.4 : 0.5)),
  );
  const visualBeatCount = draft.scenes.reduce((sum, scene) => sum + (scene.visualBeats?.length ?? 0), 0);
  const assignedMontageTemplates = [...new Set(draft.scenes.flatMap((scene) => scene.visualBeats?.map((beat) => beat.template) ?? []))];
  const renderedVisualBeatCount = draft.lastRender?.visualBeatCount;
  const renderedMontageTemplates = draft.lastRender?.templates ?? [];
  const includedMaterialScenes = draft.scenes.filter((scene) => scene.includeInAssembly !== false);
  const hasAppliedStock = stockMaterialApplied;
  const selectedStockScenes = includedMaterialScenes.filter(hasAppliedStock).length;
  const actualStockVideoScenes = includedMaterialScenes.filter((scene) => (
    hasAppliedStock(scene) && scene.stockSource?.mediaType === "video"
  )).length;
  const actualStockImageScenes = includedMaterialScenes.filter((scene) => (
    hasAppliedStock(scene) && scene.stockSource?.mediaType === "image"
  )).length;
  const alternateStockAssets = includedMaterialScenes.reduce(
    (sum, scene) => sum + (scene.stockAlternates ?? []).filter((variant) => Boolean(variant.videoPath ?? variant.imagePath)).length,
    0
  );
  const missingStockScenes = includedMaterialScenes.length - selectedStockScenes;
  const mixedAiScenes = includedMaterialScenes.filter((scene) => !scene.stockSource).length;
  const brokenMixedStockScenes = includedMaterialScenes.filter((scene) => scene.stockSource && !hasAppliedStock(scene)).length;
  const stockProgressPercent = includedMaterialScenes.length > 0
    ? Math.round((selectedStockScenes / includedMaterialScenes.length) * 100)
    : 0;
  const currentAutoStockProgress = autoStockProgress?.projectId === draft.id ? autoStockProgress : null;
  const currentAutoStockResult = autoStockResult?.project.id === draft.id ? autoStockResult : null;
  const confirmedStockScenes = isDocumentary ? includedMaterialScenes.filter(materialReady).length : selectedStockScenes;
  const autoStockPercent = currentAutoStockProgress && currentAutoStockProgress.total > 0
    ? Math.round((isDocumentary ? confirmedStockScenes : currentAutoStockProgress.completed) / currentAutoStockProgress.total * 100)
    : 0;
  const autoStockRunning = Boolean(currentAutoStockProgress && !["complete", "failed", "stopped"].includes(currentAutoStockProgress.phase) && busy);
  const autoStockFailed = currentAutoStockResult?.failed ?? 0;
  const scenarioStartBlockReason = scenarioReviewBlockReason(draft);
  const materialsStartBlockReason = scenarioStartBlockReason ?? (selectedMediaMode === "mixed" && brokenMixedStockScenes > 0
    ? `Для ${brokenMixedStockScenes} ${brokenMixedStockScenes === 1 ? "stock-сцены потерян файл" : "stock-сцен потеряны файлы"}. Выберите материалы заново.`
    : null);
  const materialsPanelSummary = selectedMediaMode === "stock"
    ? `Stock авто: готово ${selectedStockScenes} из ${includedMaterialScenes.length}`
    : selectedMediaMode === "mixed"
      ? `Mix: Stock ${selectedStockScenes} · AI ${mixedAiScenes}`
      : `AI: ${settings.image.provider} · стиль ${settings.image.style ? "выбран" : "по умолчанию"}`;
  const calibrateProjectVoice = async () => {
    const selectedVoice = settings.voice.provider === "edge-tts"
      ? normalizeVoiceId(settings.voice.voice)
      : settings.voice.voice.trim();
    if (!selectedVoice) {
      onInfo("Сначала выберите конкретный голос.");
      return;
    }
    try {
      await voiceSample.toggle(async isCurrent => {
      const saved = await save();
      if (!saved || !isCurrent()) return;
      const result = await api.calibrateProjectVoice(saved.id);
      if (!isCurrent()) return;
      let calibratedProject = result.project;
      const readyScript = calibratedProject.videoBrief?.creationMode === "script"
        ? calibratedProject.videoBrief.readyScript?.trim()
        : undefined;
      if (readyScript) {
        const durationMinutes = Math.max(0.5, estimateNarrationDurationSeconds(readyScript, result.calibration) / 60);
        calibratedProject = await onSave(calibratedProject.id, {
          settings: { ...calibratedProject.settings, durationMinutes },
        });
      }
      if (!isCurrent()) return;
      setDraft(structuredClone(calibratedProject));
      onInfo(`Скорость измерена: ${result.calibration.charactersPerSecond.toFixed(1)} зн./с, ${Math.round(result.calibration.wordsPerMinute)} слов/мин.`);
      return result.sampleAudioBase64;
      });
    } catch (reason) {
      onInfo(`Не удалось измерить голос: ${errorMessage(reason)}`);
    }
  };
  return (
    <div className="project-page page-with-actionbar">
      <PageHeading
        icon={
          <button className="back-icon" disabled={saving} onClick={() => void saveAndBack()}>
            <ChevronLeft size={22} />
          </button>
        }
        title={draft.title}
        subtitle={currentStage === "brief" ? "Задание ролика: название и тема" : "Основные настройки ролика"}
        actions={
          hasUnsavedChanges ? <button className="ghost-button" disabled={saving} onClick={restoreSavedSettings}>
            <RotateCcw size={15} />
            Отменить несохранённые изменения
          </button> : undefined
        }
      />
      <ProjectWorkflowBar project={draft} current={currentStage} hasQueueTasks={hasQueueTasks} busy={saving || busy} onNavigate={(stage) => void navigateWorkflow(stage)} />
      {currentStage === "brief" ? (
        <section className="project-brief-card"><h2>Готовый сценарий</h2><p>Откройте задание ролика и вставьте полный текст озвучки.</p><button className="generate-button" onClick={() => onNavigateStage(draft.id, "brief")}>Открыть задание</button></section>
      ) : (
      <>
      {isAiStory ? <AiStorySettings
        project={draft} disabled={busy || saving || draft.status === "generating" || draft.status === "paused"} samplePlaying={samplePlaying} samplePreparing={samplePreparing}
        templates={voicerTemplates} voices={voiceOptions} normalizedVoice={normalizeVoiceId(settings.voice.voice)}
        plannedVeoCount={plannedVeoSceneCount}
        styleChooser={<VisualStyleChooser compact value={settings.image.style} onChange={style => setSettings({ image: { ...settings.image, style } })} />}
        onSettings={setSettings} onCalibrate={() => void calibrateProjectVoice()}
        onAspectRatio={aspectRatio => setDraft({ ...draft, aspectRatio })}
        onRefreshTemplates={() => setVoicerTemplates(null)} onReferences={() => void chooseReferences()}
        onAccounts={() => void saveAndNavigate("settings")}
      /> : isDocumentary ? <StockWorkflowSettings
        project={draft} api={api} disabled={busy || saving || draft.status === "generating" || draft.status === "paused"}
        samplePlaying={samplePlaying} samplePreparing={samplePreparing} templates={voicerTemplates} voices={voiceOptions} normalizedVoice={normalizeVoiceId(settings.voice.voice)}
        onSettings={setSettings} onAspectRatio={aspectRatio => setDraft({ ...draft, aspectRatio })}
        onCalibrate={() => void calibrateProjectVoice()} onRefreshTemplates={() => setVoicerTemplates(null)}
        onScenario={() => void navigateWorkflow("scenario")} onAccounts={() => void saveAndNavigate("settings")}
        onLibrary={() => void saveAndNavigate("library")} onChooseMusic={() => void chooseMusic()}
        onRefreshMontage={async () => {
          const saved=await save();
          if(!saved)throw new Error('Не удалось сохранить настройки перед обновлением монтажа.');
          const updated=await onRefreshMontage(saved.id);
          if(!updated)throw new Error('Не удалось обновить автомонтаж. Подробности показаны в сообщении приложения.');
          setDraft(structuredClone(updated));
        }}
      /> : <>
      <div className="editor-grid">
        <SettingsPanel icon={<SlidersHorizontal size={16} />} title="ОСНОВНЫЕ">
          <Field label="НАЗВАНИЕ ПРОЕКТА">
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </Field>
          <Field label="ТЕМА ВИДЕО">
            <input value={draft.topic} onChange={(event) => setDraft({ ...draft, topic: event.target.value })} />
          </Field>
          <Field label="ЯЗЫК РОЛИКА" hint="Язык сценария и озвучки. Один клик — писать ничего не нужно.">
            <div className="choice-row language-row">
              {PROJECT_LANGUAGES.map((item) => (
                <button
                  key={item.label}
                  className={draft.language === item.label ? "selected" : ""}
                  onClick={() => setDraft({ ...draft, language: item.label })}
                >
                  {item.flag} {item.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="ДЛИТЕЛЬНОСТЬ ВИДЕО" hint="Рассчитывается по готовому тексту и выбранному голосу."><span>{settings.durationMinutes.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} мин</span></Field>
          {draft.scenes.length > 0 && (
            <Field label={`ТЕКСТ СЦЕНАРИЯ (${draft.scenes.length} СЦЕН)`} hint="Текст озвучки каждой сцены. Полное редактирование — в разделе «Сценарий».">
              <div className="scenario-preview">
                {draft.scenes.slice(0, 6).map((scene) => (
                  <p key={scene.id}><b>{scene.order + 1}.</b> {scene.narration || "— без текста —"}</p>
                ))}
                {draft.scenes.length > 6 && <p>…и ещё {draft.scenes.length - 6} сцен</p>}
              </div>
              <button className="outline-button small" onClick={() => void navigateWorkflow("scenario")}>
                <FileText size={14} />
                Открыть редактор сценария
              </button>
            </Field>
          )}
          <Field label="СМЕНА КАДРОВ" hint="Как часто меняется кадр. Значение по умолчанию настроено под удержание внимания на YouTube.">
            <select
              value={settings.frameChange}
              onChange={(event) =>
                setSettings({
                  frameChange: event.target.value as ProjectSettings["frameChange"],
                })
              }
            >
              <option value="scenario">По сценарию</option>
              <option value="5s">Каждые 5 секунд</option>
              <option value="10s">Каждые 10 секунд</option>
            </select>
          </Field>
          <Field label="ФОРМАТ ВИДЕО">
            <select
              value={draft.aspectRatio}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  aspectRatio: event.target.value as Project["aspectRatio"],
                })
              }
            >
              <option value="16:9">▣ 16:9 (YouTube)</option>
              <option value="9:16">▯ 9:16 (Shorts)</option>
              <option value="1:1">□ 1:1</option>
            </select>
          </Field>
          {(selectedMediaMode === "stock" || selectedMediaMode === "mixed") && (
            <Field
              label={`СООТНОШЕНИЕ STOCK: ${stockVideoPercent}% ВИДЕО · ${100 - stockVideoPercent}% ФОТО`}
              hint="Ориентир для автоподбора. Софт не станет вставлять неподходящее видео только ради точной квоты."
            >
              <input
                type="range"
                min={0}
                max="100"
                step="5"
                value={stockVideoPercent}
                onChange={(event) => setSettings({ stockVideoPercent: Number(event.target.value) })}
              />
              <small>
                {stockVideoPercent === 0
                  ? "Искать только stock-фото."
                  : stockVideoPercent === 100
                    ? "Искать только stock-видео. Если подходящего ролика нет, сцена будет честно отмечена как неготовая — фото не подменит видео."
                    : `Цель — ${stockVideoPercent}% длительности ролика с настоящим видео, остальное — фото. Фактическая доля появится на этапе производства.`}
              </small>
            </Field>
          )}
          {isDocumentary && <Field label="ТОЧНОСТЬ ПОДБОРА">
            <select aria-label="Точность подбора" value={settings.assembly.documentary?.matchMode??'literal'}
              onChange={event=>setSettings({assembly:{...settings.assembly,documentary:{...(settings.assembly.documentary??createDocumentarySettings()),matchMode:event.target.value as 'literal'|'thematic'}}})}>
              <option value="literal">Точное соответствие сценарию</option>
              <option value="thematic">По теме — быстрее</option>
            </select>
            <small>По теме: общие планы без обязательного повторения действия. Такие кадры помечаются в редакторе как иллюстрация. Готовые сцены сохраняются.</small>
          </Field>}
        </SettingsPanel>
        <SettingsPanel icon={<Mic2 size={16} />} title="ОЗВУЧКА">
          <ToggleRow label="Озвучка" checked={settings.voice.enabled} onChange={(enabled) => setSettings({ voice: { ...settings.voice, enabled } })} />
          {settings.voice.enabled && (
            <>
              <Field label="ДВИЖОК ОЗВУЧКИ" hint="Встроенная — голоса Edge/Google через AnyModel. Voicer — премиум-голоса ElevenLabs по шаблонам из Telegram-бота.">
                <select
                  value={settings.voice.provider}
                  onChange={(event) =>
                    setSettings({
                      voice: { ...settings.voice, provider: event.target.value as ProjectSettings["voice"]["provider"], voice: "", calibration: undefined },
                    })
                  }
                >
                  <option value="edge-tts">Встроенная (Edge / Google)</option>
                  <option value="elevenlabs">Lumean (ElevenLabs)</option>
                </select>
              </Field>
              {settings.voice.provider === "elevenlabs" ? (
                <Field label="ШАБЛОН ГОЛОСА LUMEAN" hint="Шаблон = голос + настройки из кабинета lumean.app. Кнопки подтягиваются с сервиса автоматически.">
                  <div className="choice-row template-row">
                    <button
                      className={!settings.voice.voice ? "selected" : ""}
                      onClick={() => setSettings({ voice: { ...settings.voice, voice: "", calibration: undefined } })}
                    >
                      Выберите шаблон
                    </button>
                    {(voicerTemplates ?? []).map((template) => (
                      <button
                        key={template.uuid}
                        className={settings.voice.voice === template.uuid ? "selected" : ""}
                        onClick={() => setSettings({ voice: { ...settings.voice, voice: template.uuid, calibration: undefined } })}
                      >
                        {template.name}
                      </button>
                    ))}
                    <button title="Обновить список шаблонов с Lumean" onClick={() => setVoicerTemplates(null)}>
                      <RotateCcw size={12} />
                    </button>
                  </div>
                  <small>{voicerTemplates === null ? "Загружаю шаблоны с Lumean…" : voicerTemplates.length === 0 ? "Шаблоны не найдены — сохраните ключ Lumean в Настройках, и они появятся здесь" : "Ваши шаблоны с lumean.app. Пример генерируется один раз и кэшируется."}</small>
                </Field>
              ) : (
                <Field label="ГОЛОС" hint="Голос озвучки этого проекта. Кнопка ниже проиграет короткий пример выбранного голоса.">
                  <select
                    value={normalizeVoiceId(settings.voice.voice)}
                    onChange={(event) =>
                      setSettings({
                        voice: { ...settings.voice, voice: event.target.value, calibration: undefined },
                      })
                    }
                  >
                    <option value="">Выберите конкретный голос</option>
                    {voiceOptions.map((voiceOption) => (
                      <option key={voiceOption.id} value={voiceOption.id}>
                        {voiceOption.label}{voiceOption.gender ? ` (${voiceOption.gender})` : ""}
                      </option>
                    ))}
                  </select>
                  <small>Список подобран под язык проекта. Пример голоса генерируется один раз и кэшируется.</small>
                </Field>
              )}
              <button
                className="outline-button small"
                disabled={samplePreparing || !settings.voice.voice.trim()}
                onClick={() => void calibrateProjectVoice()}
              >
                <Volume2 size={15} />
                {samplePreparing ? "Готовлю пример…" : samplePlaying ? "Остановить пример" : "Прослушать и измерить скорость"}
              </button>
              {voiceCalibrationMatches(settings.voice.calibration, settings.voice.provider, settings.voice.voice, draft.language) && (
                <small className="voice-calibration-ready-line">
                  <Check size={13} /> {settings.voice.calibration!.charactersPerSecond.toFixed(1)} зн./с · {Math.round(settings.voice.calibration!.wordsPerMinute)} слов/мин · тест {settings.voice.calibration!.audioDurationSeconds.toFixed(1)} с
                </small>
              )}
              <small>Озвучка автоматически синхронизируется со сценами и никогда не обрезается под длину stock-видео.</small>
            </>
          )}
        </SettingsPanel>
        <SettingsPanel
          key={`materials-${selectedMediaMode}`}
          icon={<Image size={16} />}
          title={selectedMediaMode === "stock" ? "ВИДЕО И ФОТО · АВТОПОДБОР" : "МАТЕРИАЛЫ И ИЗОБРАЖЕНИЯ"}
          summary={materialsPanelSummary}
          defaultOpen
        >
          {selectedMediaMode === "stock" && (
            <div className={`project-stock-materials${missingStockScenes === 0 && includedMaterialScenes.length > 0 ? " ready" : ""}${autoStockRunning ? " running" : ""}${autoStockFailed > 0 ? " failed" : ""}`}>
              <div className="project-stock-materials-head">
                <span>{autoStockFailed > 0 ? <CircleAlert size={18} /> : missingStockScenes === 0 && includedMaterialScenes.length > 0 ? <Check size={18} /> : <Search size={18} />}</span>
                <div>
                  <strong>{autoStockRunning ? "Софт сам подбирает stock…" : "Stock подбирается автоматически"}</strong>
                  <small>
                    {isDocumentary ? "Веб, архивы и библиотека" : "Pexels + Pixabay"} · цель: {stockVideoPercent}% видео / {100 - stockVideoPercent}% фото
                    {selectedStockScenes > 0 ? ` · фактически: ${actualStockVideoScenes} видео / ${actualStockImageScenes} фото` : ""}
                    {" · ручной выбор не обязателен"}
                  </small>
                </div>
                <b className="project-stock-optional">АВТО</b>
              </div>
              <div className="project-stock-progress">
                <div>
                  <span>{autoStockRunning ? currentAutoStockProgress?.message ?? "Ищу материалы…" : "Готовые сцены"}</span>
                  <strong>{autoStockRunning ? isDocumentary
                    ? `Подтверждено ${confirmedStockScenes} из ${includedMaterialScenes.length} · обработано ${currentAutoStockProgress?.completed ?? 0}`
                    : `Проверено ${currentAutoStockProgress?.completed ?? 0} из ${currentAutoStockProgress?.total ?? includedMaterialScenes.length} · подтверждено ${selectedStockScenes}`
                    : `${confirmedStockScenes} из ${includedMaterialScenes.length}`}</strong>
                </div>
                <i><em style={{ width: `${autoStockRunning ? autoStockPercent : stockProgressPercent}%` }} /></i>
              </div>
              <p>
                {includedMaterialScenes.length === 0
                  ? "Сначала добавьте сцены в сценарий."
                  : autoStockRunning
                    ? currentAutoStockProgress?.message ?? "Анализирую сцены и скачиваю подходящие файлы."
                    : autoStockFailed > 0
                      ? `Не удалось заполнить ${autoStockFailed} ${autoStockFailed === 1 ? "сцену" : "сцен"}. Повторный запуск обработает только их.`
                      : missingStockScenes > 0
                        ? isDocumentary
                          ? `Нажмите внизу «Собрать ролик» — софт подберёт недостающие материалы для ${missingStockScenes} сцен, подготовит озвучку и монтаж и откроет редактор.`
                          : `Нажмите внизу «Автоподобрать сток и собрать» — софт сам найдёт материалы для всех ${missingStockScenes} сцен.`
                        : "Все сцены готовы. При желании можно открыть проверку и заменить отдельный кадр."}
              </p>
              {currentAutoStockResult && currentAutoStockResult.failures.length > 0 && (
                <div className="project-stock-failures">
                  {currentAutoStockResult.failures.slice(0, 3).map((failure) => <span key={failure.sceneId}>Сцена {failure.sceneNumber}: {failure.message}</span>)}
                  {currentAutoStockResult.failures.length > 3 && <span>…и ещё {currentAutoStockResult.failures.length - 3}</span>}
                </div>
              )}
              <small>Кнопка сборки запускает озвучку и подбор параллельно, затем монтаж. Для точечных замен есть этап «Материалы».</small>
            </div>
          )}

          {selectedMediaMode === "mixed" && (
            <div className="project-mixed-materials">
              <article>
                <span className="project-material-source-icon"><Search size={17} /></span>
                <div><strong>Stock</strong><small>{selectedStockScenes} сцен выбрано вручную</small></div>
                <button className="outline-button small" disabled={busy || saving || includedMaterialScenes.length === 0} onClick={() => void navigateWorkflow("materials")}>Подобрать</button>
              </article>
              <article>
                <span className="project-material-source-icon ai"><WandSparkles size={17} /></span>
                <div><strong>AI для остальных сцен</strong><small>{mixedAiScenes} сцен создаст выбранный генератор</small></div>
              </article>
              {brokenMixedStockScenes > 0 && <p><CircleAlert size={14} />У {brokenMixedStockScenes} выбранных stock-сцен нет локального файла. Откройте материалы и выберите их заново.</p>}
            </div>
          )}

          {selectedMediaMode !== "stock" && (
          <>
          {selectedMediaMode === "mixed" && <div className="project-ai-materials-heading"><WandSparkles size={14} /><strong>Настройки AI для незаполненных сцен</strong></div>}
          <Field label="ГЕНЕРАТОР ИЗОБРАЖЕНИЙ">
            <select
              value={settings.image.provider}
              onChange={(event) =>
                setSettings({
                  image: {
                    ...settings.image,
                    provider: event.target.value as ProjectSettings["image"]["provider"],
                  },
                })
              }
            >
              <option value="mock-image">Mock Image</option>
              <option value="flow">Google Flow — только Flow</option>
              <option value="nano-banana">Nano Banana Pro</option>
              <option value="gpt-image">GPT Image</option>
              <option value="anymodel-image">AnyModel API</option>
            </select>
            <small>
              Для настоящей генерации кадры автоматически делятся между выбранной API-моделью и подключённым Google Flow. Если один источник недоступен, второй подхватит его сцену.
            </small>
          </Field>
          <Field label="СТИЛЬ — ВЫБЕРИТЕ КАРТИНКОЙ" hint="Единый стиль всех сцен ролика: клик по превью допишет его к каждому промпту изображения.">
            <div className="style-grid">
              {IMAGE_STYLES.map((style) => (
                <button
                  key={style.id}
                  className={`style-card${settings.image.style === style.promptSuffix ? " selected" : ""}`}
                  onClick={() => {
                    setSettings({ image: { ...settings.image, style: style.promptSuffix } });
                    onInfo(`Стиль «${style.label}» будет применён ко всем сценам.`);
                  }}
                >
                  <img src={`/styles/${style.id}.jpg`} alt={style.label} loading="lazy" />
                  <span>{style.label}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="СВОЙ СТИЛЬ (ТЕКСТОМ)">
            <input
              value={settings.image.style}
              onChange={(event) =>
                setSettings({
                  image: { ...settings.image, style: event.target.value },
                })
              }
            />
          </Field>
          <ToggleRow label="Последовательная генерация" hint="Каждая картинка генерируется после предыдущей — важно для бесшовных форматов, но отключает параллельную работу двух источников." checked={settings.image.sequential} onChange={(sequential) => setSettings({ image: { ...settings.image, sequential } })} />
          <Field label={`ДОПОЛНИТЕЛЬНЫЕ РЕФЕРЕНСЫ (${settings.image.references.length}/3)`} hint="Образ главного героя создаётся и проверяется на этапе «Сценарий». Здесь можно добавить дополнительные изображения стиля или предметов.">
            <button className="upload-box" onClick={() => void chooseReferences()}>
              <Plus size={21} />
              <span>Добавить своё изображение</span>
            </button>
            <small>Главный персонаж уже хранится отдельно в проекте и автоматически используется во всех его сценах.</small>
          </Field>
          </>
          )}
        </SettingsPanel>
        <SettingsPanel
          icon={<SlidersHorizontal size={16} />}
          title="ДВИЖЕНИЕ КАРТИНОК"
          summary={settings.assembly.kenBurns
            ? settings.assembly.kenBurnsDirection === "smart" || !settings.assembly.kenBurnsDirection
              ? "Умное движение к главному объекту"
              : settings.assembly.kenBurnsDirection === "alternate"
                ? "Приближение и отдаление по очереди"
                : "Приближение и отдаление по очереди"
            : "Без движения"}
        >
          <Field
            label="ЭФФЕКТ ДЛЯ ВСЕХ ФОТО"
            hint="Работает отдельно от генерации AI-видео. Для конкретной сцены направление можно переопределить в сценарии или редакторе."
          >
            <select
              value={!settings.assembly.kenBurns
                ? "off"
                : settings.assembly.kenBurnsDirection === "smart" ? "smart" : "alternate"}
              onChange={(event) => {
                const motion = event.target.value as "off" | "smart" | "alternate";
                setSettings({
                  assembly: {
                    ...settings.assembly,
                    kenBurns: motion !== "off",
                    kenBurnsDirection: motion === "off" ? settings.assembly.kenBurnsDirection ?? "alternate" : motion,
                    ...(isAiStory ? { montage: { ...montageSettings, enabled: false } } : {}),
                  },
                });
                onInfo(motion === "off"
                  ? "Движение картинок отключено для всего ролика."
                  : motion === "smart"
                    ? "Фото будут двигаться по смыслу: улики приближаются, общие планы отдаляются."
                    : "Фото-сцены будут по очереди приближаться и отдаляться.");
              }}
            >
              <option value="off">Без движения</option>
              <option value="alternate">По очереди: приближение → отдаление</option>
              <option value="smart">Умное: zoom и pan к главному объекту</option>
            </select>
            <small>
              {selectedMediaMode === "stock"
                ? "Эффект применится ко всем stock-фото. Готовые stock-видео останутся без искусственного приближения."
                : "Если AI-видео выключено, эффект применяется ко всем картинкам; если включено — только к сценам, которые остались фотографиями."}
            </small>
          </Field>
        </SettingsPanel>
        {isDocumentary ? <DocumentarySettingsPanel assembly={settings.assembly} onChange={assembly => setSettings({ assembly })} /> : <SettingsPanel
          icon={<Clapperboard size={16} />}
          title={isAiStory ? "ПЕРЕХОДЫ AI STORY" : "РЕЖИМ МОНТАЖА"}
          summary={isAiStory
            ? `Слайд-шоу · ${slideshowTransitionType === "mix" ? "растворение" : slideshowTransitionType === "fade" ? "через чёрный" : "мгновенная склейка"}`
            : !montageSettings.enabled
            ? "Слайд-шоу · движение картинок и простые переходы"
            : visualBeatCount > 0
              ? `Качественный монтаж · ${visualBeatCount} визуальных смен`
              : autoMontageSceneCount > 0 ? `Качественный монтаж · ${autoMontageSceneCount} сцен` : "Качественный монтаж · план добавится при сборке"}
          collapsible
          defaultOpen={false}
        >
          {!isAiStory && <Field label="КАК СОБИРАТЬ РОЛИК">
            <div className="choice-row" role="group" aria-label="Режим монтажа">
              {([
                { enabled: true, label: "Качественный монтаж" },
                { enabled: false, label: "Слайд-шоу" },
              ] as const).map(({ enabled, label }) => (
                <button
                  key={label}
                  type="button"
                  className={montageSettings.enabled === enabled ? "selected" : ""}
                  aria-pressed={montageSettings.enabled === enabled}
                  disabled={montageReplanning}
                  onClick={() => {
                    setSettings({
                      assembly: {
                        ...settings.assembly,
                        montage: { ...montageSettings, enabled },
                      },
                    });
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>}
          {isAiStory && (
            <div className="settings-help-card ai-story-safe-mode">
              <strong>Чистое AI-слайд-шоу</strong>
              <small>Автоматические инфографика, титры и карточки Remotion отключены. В кадре остаются только изображение, движение камеры и выбранный переход.</small>
            </div>
          )}
          {!effectiveMontageEnabled && (
            <>
              <Field label="ПЕРЕХОД МЕЖДУ ВСЕМИ КАДРАМИ" hint="Это значение используется на каждом стыке слайд-шоу. В редакторе можно отдельно переопределить любой конкретный стык.">
                <select
                  value={slideshowTransitionType}
                  onChange={(event) => {
                    const transitionType = event.target.value as "none" | "fade" | "mix";
                    setSettings({
                      assembly: {
                        ...settings.assembly,
                        fadeTransitions: transitionType !== "none",
                        transitionType,
                        ...(isAiStory ? { montage: { ...montageSettings, enabled: false } } : {}),
                      },
                    });
                  }}
                >
                  <option value="none">Мгновенная склейка</option>
                  <option value="mix">Плавное растворение</option>
                  <option value="fade">Через чёрный экран</option>
                </select>
              </Field>
              <Field label={`ДЛИТЕЛЬНОСТЬ ПЕРЕХОДА: ${slideshowTransitionDuration.toFixed(2)} С`} hint="Для спокойного слайд-шоу рекомендуются 0,35–0,50 секунды.">
                <input
                  type="range"
                  min={isAiStory ? 0.15 : 0.1}
                  max={isAiStory ? 1 : 2}
                  step="0.05"
                  disabled={slideshowTransitionType === "none"}
                  value={slideshowTransitionDuration}
                  onChange={(event) => setSettings({
                    assembly: {
                      ...settings.assembly,
                      transitionDurationSeconds: Number(event.target.value),
                      ...(isAiStory ? { montage: { ...montageSettings, enabled: false } } : {}),
                    },
                  })}
                />
              </Field>
            </>
          )}
          {!isAiStory && <div className="settings-help-card">
            <strong>{effectiveMontageEnabled ? "Визуальные смены и графические акценты" : "Плавное приближение, отдаление и простые переходы"}</strong>
            <small>{effectiveMontageEnabled
              ? "Remotion добавляет внутри сцен смены кадров, текстовые акценты, карточки фактов и сравнения. Настройте темп и долю графики ниже."
              : "Слайд-шоу собирает сцены по порядку. Zoom in/out настраивается в разделе «Движение картинок», простые переходы — в параметрах сборки и редакторе. Действующие настройки движения и переходов сохраняются."}</small>
            {effectiveMontageEnabled && <small>Если Remotion временно недоступен, приложение сохранит резервный FFmpeg-вариант и покажет причину.</small>}
          </div>}
          {!isAiStory && <div className={`montage-diagnostics${draft.lastRender?.engine === "ffmpeg-fallback" ? " fallback" : ""}`}>
            <strong>Диагностика текущего проекта</strong>
            <span>
              Stock: <b>{actualStockVideoScenes} основных видео · {actualStockImageScenes} основных фото</b>
              {draft.settings.assembly.documentary?.version === 2 && <span> · видео занимает {documentaryVideoCoverage(draft.scenes).percent}% длительности, цель 80–90%</span>}
              {alternateStockAssets > 0 && <> · дополнительных планов: <b>{alternateStockAssets}</b></>}
            </span>
            <span>
              VisualBeat в плане: <b>{visualBeatCount}</b>
              {renderedVisualBeatCount !== undefined && <> · в последнем Final: <b>{renderedVisualBeatCount}</b></>}
            </span>
            <span>
              Planner: <b>{draft.montagePlan?.usedPlanner ?? (visualBeatCount > 0 ? "старый план · источник не записан" : "ещё не запускался")}</b>
            </span>
            <span title={assignedMontageTemplates.join(", ")}>
              Шаблоны плана: <b>{assignedMontageTemplates.length > 0 ? assignedMontageTemplates.join(", ") : "ещё не назначены"}</b>
            </span>
            {draft.lastRender && (
              <span title={renderedMontageTemplates.join(", ")}>
                Шаблоны Final: <b>{renderedMontageTemplates.length > 0 ? renderedMontageTemplates.join(", ") : "не записаны"}</b>
              </span>
            )}
            <span>
              Следующий экспорт: <b>{montageSettings.enabled ? "Remotion" : "FFmpeg"}</b>
            </span>
            <span>
              Последний экспорт: <b>{draft.lastRender
                ? draft.lastRender.engine === "remotion" ? "Remotion завершён"
                  : draft.lastRender.engine === "ffmpeg-fallback" ? "FFmpeg fallback — Remotion упал"
                    : "обычный FFmpeg"
                : "ещё не записан"}</b>
            </span>
            {draft.lastRender?.engine === "ffmpeg-fallback" && (
              <p role="alert">Это резервная FFmpeg-сборка, а не полноценный Remotion-монтаж. Причина: {draft.lastRender.fallbackReason ?? "неизвестная ошибка Remotion"}</p>
            )}
          </div>}
          {effectiveMontageEnabled && (
            <>
              <Field label="КТО ВЫБИРАЕТ ПРИЁМЫ" hint="AI не получает свободу писать монтажный код: только выбирает из двенадцати проверенных шаблонов. Невалидный ответ заменяется локальным планом.">
                <select
                  value={montageSettings.planner}
                  onChange={(event) => setSettings({
                    assembly: {
                      ...settings.assembly,
                      montage: { ...montageSettings, planner: event.target.value as "local" | "ai-bounded" },
                    },
                  })}
                >
                  <option value="ai-bounded">Выбранная AI-модель · с жёсткими ограничениями</option>
                  <option value="local">Только локальные правила · без дополнительного AI-запроса</option>
                </select>
              </Field>
              <Field label="ТЕМП МОНТАЖА" hint="Меняет частоту визуальных смен, но не режет и не растягивает озвучку.">
                <div className="choice-row">
                  {(["calm", "balanced", "dynamic"] as const).map((density) => (
                    <button
                      key={density}
                      className={montageSettings.density === density ? "selected" : ""}
                      onClick={() => setSettings({
                        assembly: { ...settings.assembly, montage: { ...montageSettings, density } },
                      })}
                    >
                      {density === "calm" ? "Спокойный" : density === "dynamic" ? "Динамичный" : "Сбалансированный"}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={`ГРАФИЧЕСКИЕ АКЦЕНТЫ: ${montageSettings.graphicBeatPercent}%`} hint="Карточки фактов, цифр, цитат и сравнений. Жёсткий предел приложения — 35%, чтобы ролик не превращался в кашу.">
                <input
                  type="range"
                  min="0"
                  max="35"
                  step="5"
                  value={montageSettings.graphicBeatPercent}
                  onChange={(event) => setSettings({
                    assembly: {
                      ...settings.assembly,
                      montage: { ...montageSettings, graphicBeatPercent: Number(event.target.value) },
                    },
                  })}
                />
              </Field>
            </>
          )}
          {effectiveMontageEnabled && (
            <>
              <button
                className="outline-button montage-replan-button"
                disabled={busy || saving || montageReplanning || draft.scenes.length === 0}
                onClick={() => void replanMontage()}
              >
                <RotateCcw size={14} />
                {montageReplanning ? "Пересоздаю план монтажа…" : "Пересоздать план монтажа"}
              </button>
              <small className="montage-replan-note">Narration и готовая озвучка не переписываются; меняются только VisualBeat и безопасные шаблоны.</small>
            </>
          )}
        </SettingsPanel>}
        {selectedMediaMode !== "stock" && <SettingsPanel
          icon={<Video size={16} />}
          title="ОЖИВЛЕНИЕ ЧЕРЕЗ VEO"
          summary={settings.video.enabled
            ? veoSelectionMode === "manual" ? "Включено · ручной выбор в «Материалах»" : `Включено · ${plannedVeoSceneCount} кадров`
            : "Выключено · используюются изображения"}
          collapsible
          defaultOpen={false}
        >
          <Field label="РЕЖИМ ГЕНЕРАЦИИ">
            <select
              value={settings.video.mode}
              onChange={(event) =>
                setSettings({
                  video: {
                    ...settings.video,
                    mode: event.target.value as ProjectSettings["video"]["mode"],
                  },
                })
              }
            >
              <option value="turbo">TURBO</option>
              <option value="standard">STANDARD</option>
            </select>
            <small>До четырёх задач одновременно.</small>
          </Field>
          <ToggleRow
            label="Генерировать AI-видео"
            hint="Оживляет картинку сцены (image-to-video). Veo — ключ Google AI Studio; AnyModel — grok-imagine. Внимание: видео заметно дороже картинок."
            checked={settings.video.enabled}
            onChange={(enabled) => {
              // mock-video остался в старых проектах и молча отключал реальную генерацию — переводим на Google.
              const provider = settings.video.provider === "anymodel-video" || settings.video.provider === "flow"
                ? settings.video.provider
                : "veo";
              setSettings({ video: { ...settings.video, enabled, provider } });
              onInfo(enabled ? "AI-видео включено: выбранные сцены будут оживлены из своих картинок." : "AI-видео выключено — сцены соберутся из картинок с движением камеры.");
            }}
          />
          {settings.video.enabled && (
            <>
              <Field label="ДВИЖОК ВИДЕО" hint="Google AI Studio — официальный Veo по API-ключу. Google Flow — пользовательские аккаунты в разделе Настройки → Видео. AnyModel — модель с баланса AnyModel.">
                <select
                  value={settings.video.provider === "anymodel-video" || settings.video.provider === "flow" ? settings.video.provider : "veo"}
                  onChange={(event) => {
                    const provider = event.target.value as ProjectSettings["video"]["provider"];
                    const switchFromMock = provider === "flow" && settings.image.provider === "mock-image";
                    setSettings({
                      video: {
                        ...settings.video,
                        provider,
                        // В одном проекте фиксируем одну модель: Flow больше не будет
                        // незаметно перескакивать между поколениями Veo.
                        model: provider === "flow"
                          ? (settings.video.model === "veo_3_1_t2v_lite"
                            || settings.video.model === "veo_3_1_i2v_s_fast"
                            || settings.video.model === "VEO_3_1_I2V_12STEP"
                            ? settings.video.model
                            : "veo_3_1_i2v_s_fast")
                          : settings.video.model,
                      },
                      ...(switchFromMock
                        ? { image: { ...settings.image, provider: "flow" as const } }
                        : {}),
                    });
                    if (switchFromMock) {
                      onInfo("Для Flow-видео генератор кадров переключён с Mock Image на AnyModel API + резервный Google Flow.");
                    }
                  }}
                >
                  <option value="veo">Google AI Studio / Veo</option>
                  <option value="flow">Google Flow / аккаунты</option>
                  <option value="anymodel-video">AnyModel (grok-imagine)</option>
                </select>
              </Field>
              {settings.video.provider === "flow" && (
                <>
                  <Field label="МОДЕЛЬ VEO В FLOW" hint="Выбранная модель закрепляется за проектом и используется для всех его сцен. Это помогает сохранить единый стиль.">
                    <select
                      value={settings.video.model === "veo_3_1_t2v_lite"
                        || settings.video.model === "veo_3_1_i2v_s_fast"
                        || settings.video.model === "VEO_3_1_I2V_12STEP"
                        ? settings.video.model
                        : "veo_3_1_i2v_s_fast"}
                      onChange={(event) =>
                        setSettings({
                          video: {
                            ...settings.video,
                            model: event.target.value,
                          },
                        })
                      }
                    >
                      <option value="veo_3_1_t2v_lite">Veo 3.1 Lite — экономнее для массовой генерации</option>
                      <option value="veo_3_1_i2v_s_fast">Veo 3.1 Fast — быстрее</option>
                      <option value="VEO_3_1_I2V_12STEP">Veo 3.1 Quality — качественнее</option>
                    </select>
                  </Field>
                  <button className="outline-button small" onClick={() => void saveAndNavigate("settings")}>
                    <CircleUserRound size={14} />
                    Открыть аккаунты Google Flow
                  </button>
                </>
              )}
              <Field label="КАК ВЫБРАТЬ КАДРЫ" hint="Картинки всегда создаются первыми; неудача Veo не удаляет готовый кадр.">
                <select
                  value={veoSelectionMode}
                  onChange={(event) => setSettings({
                    video: {
                      ...settings.video,
                      selectionMode: event.target.value as NonNullable<ProjectSettings["video"]["selectionMode"]>,
                    },
                  })}
                >
                  <option value="auto">Автоматически по важности сцен</option>
                  <option value="key-scenes">Первые ключевые сцены</option>
                  <option value="every-second">Каждый второй подходящий кадр</option>
                  <option value="every-third">Каждый третий подходящий кадр</option>
                  <option value="manual">Вручную после генерации картинок</option>
                </select>
              </Field>
              {(veoSelectionMode === "auto" || veoSelectionMode === "key-scenes") && (
                <Field label={`ОЖИВИТЬ: ${settings.video.animationPercent}%`} hint="По умолчанию — 15% самых важных кадров.">
                  <div className="veo-percent-presets" role="group" aria-label="Доля кадров Veo">
                    {[10, 15, 20, 30, 50].map((percent) => (
                      <button
                        type="button"
                        key={percent}
                        className={settings.video.animationPercent === percent ? "selected" : ""}
                        onClick={() => setSettings({ video: { ...settings.video, animationPercent: percent } })}
                      >
                        {percent}%
                      </button>
                    ))}
                  </div>
                  <small>{eligibleVeoSceneCount > 0 ? `${plannedVeoSceneCount} из ${eligibleVeoSceneCount} кадров получат видео.` : "После сценария здесь появится точное число кадров."}</small>
                </Field>
              )}
              {veoSelectionMode === "manual" && (
                <div className="settings-help-card">
                  <strong>Сначала — все картинки</strong>
                  <small>После их генерации приложение откроет «Материалы». Там можно выбрать несколько кадров и запустить только их.</small>
                </div>
              )}
              <ToggleRow label="Анимация от первого кадра" hint="Кадр сцены становится первым кадром видео — движение продолжает картинку, а не рисует новую." checked={settings.video.startFrame} onChange={(startFrame) => setSettings({ video: { ...settings.video, startFrame } })} />
              <ToggleRow label="Без звука из видео" hint="Модель добавляет к клипу свой звук. Обычно его убирают, чтобы слышать только озвучку сцены." checked={settings.video.muteSource} onChange={(muteSource) => setSettings({ video: { ...settings.video, muteSource } })} />
              {!settings.video.muteSource && (
                <Field label={`ГРОМКОСТЬ ЗВУКА ИЗ ВИДЕО: ${settings.video.sourceVolume}%`} hint="Насколько слышен звук, сгенерированный видео-моделью, под озвучкой сцены.">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={settings.video.sourceVolume}
                    onChange={(event) =>
                      setSettings({
                        video: {
                          ...settings.video,
                          sourceVolume: Number(event.target.value),
                        },
                      })
                    }
                  />
                </Field>
              )}
            </>
          )}
        </SettingsPanel>}
      </div>
      <div className="editor-secondary">
        <SettingsPanel
          icon={<Music2 size={16} />}
          title="ФОНОВАЯ МУЗЫКА"
          summary={settings.music.enabled !== false ? (settings.music.path ? "Трек выбран" : "Включена · трек не выбран") : "Выключена"}
          collapsible
          defaultOpen={false}
        >
          <ToggleRow
            label="Добавлять музыку в сборку"
            checked={settings.music.enabled !== false}
            onChange={(enabled) => {
              setSettings({ music: { ...settings.music, enabled } });
              onInfo(enabled ? "Музыка будет подмешана в финальный ролик." : "Ролик соберётся без музыки — добавите её сами, например в CapCut.");
            }}
          />
          <p className="empty-note">
            <Music2 size={21} />
            {settings.music.path ?? "Нет добавленных треков — ролик соберётся без музыки"}
          </p>
          <button className="outline-button small" onClick={() => void chooseMusic()}>
            <Upload size={15} />
            Выбрать трек
          </button>
          {settings.music.path && (
            <button
              className="outline-button small"
              onClick={() => {
                setSettings({ music: { ...settings.music, path: undefined } });
                onInfo("Трек убран из проекта — ролик соберётся без музыки.");
              }}
            >
              <Trash2 size={15} />
              Убрать трек
            </button>
          )}
          <Field label={`ГРОМКОСТЬ: ${settings.music.volume}%`}>
            <input
              type="range"
              value={settings.music.volume}
              onChange={(event) =>
                setSettings({
                  music: {
                    ...settings.music,
                    volume: Number(event.target.value),
                  },
                })
              }
            />
          </Field>
          {settings.music.path && <audio aria-label="Прослушать музыкальный трек" controls preload="none" src={api.mediaUrl(settings.music.path)} style={{width:'100%'}} />}
          {isDocumentary && <>
            <button type="button" className="outline-button" onClick={async()=>{try{const selected=await api.choosePixabayMusic('documentary');if(selected)setSettings({music:{...settings.music,...selected,enabled:true}});}catch(e){onInfo(errorMessage(e));}}}>Найти музыку на Pixabay</button>
            <ToggleRow label="Приглушать музыку под диктором" checked={settings.music.ducking !== false} onChange={ducking=>setSettings({music:{...settings.music,ducking}})} />
            <div className="timeline-two-fields">
              <Field label="ПЛАВНОЕ НАЧАЛО, С"><input type="number" min={0} max={20} step={.25} value={settings.music.fadeInSeconds??1} onChange={event=>setSettings({music:{...settings.music,fadeInSeconds:Math.max(0,Math.min(20,Number(event.target.value)))}})} /></Field>
              <Field label="ПЛАВНЫЙ КОНЕЦ, С"><input type="number" min={0} max={20} step={.25} value={settings.music.fadeOutSeconds??2} onChange={event=>setSettings({music:{...settings.music,fadeOutSeconds:Math.max(0,Math.min(20,Number(event.target.value)))}})} /></Field>
            </div>
            <small>Короткий трек повторяется до конца ролика. Громкость, приглушение и плавность слышны в редакторе и сохраняются при экспорте.</small>
          </>}
        </SettingsPanel>
      </div>
      </>}
      </>
      )}
      <div className="sticky-actions editor-actions">
        <span className={`scenario-progress-line${materialsStartBlockReason || autoStockFailed > 0 ? " materials-required" : ""}${autoStockRunning ? " auto-stock-running" : ""}`}>
          {autoStockRunning
            ? (
                <>
                  <Search size={15} />
                  <span>{currentAutoStockProgress?.message ?? "Автоподбор stock…"} · {autoStockPercent}%</span>
                  <i className="scenario-progress-bar"><em style={{ width: `${autoStockPercent}%` }} /></i>
                </>
              )
            : autoStockFailed > 0
              ? (
                  <>
                    <CircleAlert size={15} />
                    <span>Не подобрано: {autoStockFailed}. Готовые сцены не будут скачиваться заново.</span>
                  </>
                )
          : materialsStartBlockReason
            ? (
                <>
                  <CircleAlert size={15} />
                  <span>{materialsStartBlockReason}</span>
                  <button disabled={saving || busy} onClick={() => void navigateWorkflow(scenarioStartBlockReason ? "scenario" : "materials")}>{scenarioStartBlockReason ? "Завершить сценарий" : "Открыть материалы"}</button>
                </>
              )
            : rebuilding
            ? (() => {
                const match = scenarioProgress ? /(\d+)\s+из\s+(\d+)/.exec(scenarioProgress) : null;
                const percent = match ? Math.round((Number(match[1]) / Math.max(1, Number(match[2]))) * 100) : null;
                return (
                  <>
                    {scenarioProgress ?? "Пишу сценарий…"}{percent === null ? "" : ` · ${percent}%`}
                    <i className="scenario-progress-bar"><em className={percent === null ? "indeterminate" : ""} style={percent === null ? undefined : { width: `${percent}%` }} /></i>
                  </>
                );
              })()
            : draft.scenes.length > 0
              ? selectedMediaMode === "stock" && missingStockScenes > 0
                ? `${draft.scenes.length} сцен · stock будет подобран автоматически при запуске`
                : `${draft.scenes.length} сцен · данные сохраняются локально`
              : currentStage === "brief"
                ? "Заполните тему ролика — затем перейдите к сценарию"
                : "Сценария пока нет — добавьте сцены вручную или соберите их из AI-диалога"}
        </span>
        <div>
          {(!isAiStory || hasUnsavedChanges || saving) && <button className="outline-button" disabled={saving} onClick={() => void save()}>
            <Save size={16} />
            {saving ? "Сохраняем..." : "Сохранить"}
          </button>}
          <button
            className="generate-button"
            disabled={busy || saving || (draft.scenes.length === 0 && !canStartScenario) || (draft.scenes.length > 0 && Boolean(materialsStartBlockReason))}
            title={materialsStartBlockReason ?? undefined}
            onClick={() => void (draft.scenes.length === 0 ? navigateWorkflow("scenario") : generate())}
          >
            {draft.scenes.length === 0 ? <FileText size={17} /> : selectedMediaMode === "stock" && missingStockScenes > 0 ? <Search size={17} /> : selectedMediaMode === "stock" ? <Clapperboard size={17} /> : <Zap size={17} />}
            {draft.scenes.length === 0
              ? "Перейти к сценарию"
              : selectedMediaMode === "stock" && autoStockRunning
                ? isDocumentary
                  ? `Подтверждено: ${confirmedStockScenes} из ${includedMaterialScenes.length}`
                  : `Подбираю stock: ${currentAutoStockProgress?.completed ?? 0} из ${currentAutoStockProgress?.total ?? includedMaterialScenes.length}`
                : selectedMediaMode === "stock" && autoStockFailed > 0
                  ? `Повторить для ${autoStockFailed} сцен`
                  : isDocumentary
                    ? "Собрать ролик"
                  : selectedMediaMode === "stock" && missingStockScenes > 0
                    ? "Автоподобрать сток и собрать"
                    : selectedMediaMode === "stock"
                      ? "Собрать ролик"
                      : "Начать генерацию"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CharacterReferenceModal({ character, imageUrl, visualStyle, regenerating = false, progress, error, onRegenerate, onUse, onClose }: {
  character: { name: string; prompt: string; characterPrompt?: string };
  imageUrl: string;
  visualStyle: string;
  regenerating?: boolean;
  progress?: string;
  error?: string;
  onRegenerate?: (characterPrompt: string) => void;
  onUse?: () => void;
  onClose: () => void;
}) {
  const [characterPrompt, setCharacterPrompt] = useState(character.characterPrompt || character.prompt);
  useEffect(() => setCharacterPrompt(character.characterPrompt || character.prompt), [character.prompt, character.characterPrompt]);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="character-reference-modal">
        <header>
          <div>
            <CircleUserRound size={21} />
            <div><strong>{character.name}</strong><small>Главный герой ролика</small></div>
          </div>
          <button className="modal-close" onClick={onClose} title="Закрыть"><X size={18} /></button>
        </header>
        <div className="character-reference-body">
          <img src={imageUrl} alt={`Референс героя ${character.name}`} />
          <div>
            <label className="character-prompt-editor">
              <small>КАК ДОЛЖЕН ВЫГЛЯДЕТЬ ПЕРСОНАЖ</small>
              <textarea
                rows={8}
                maxLength={4_000}
                value={characterPrompt}
                disabled={regenerating}
                placeholder="Оставьте описание от AI или задайте возраст, лицо, причёску, одежду, телосложение и постоянные детали героя."
                onChange={(event) => setCharacterPrompt(event.target.value)}
              />
            </label>
            <div className="character-style-summary"><small>ЕДИНЫЙ СТИЛЬ РОЛИКА</small><p>{visualStyle || "Стиль не задан"}</p></div>
            <span>После изменения описания нажмите «Перегенерировать», затем «Использовать этого героя». Новая версия героя канала не заменяет выбранную, пока вы её не подтвердите.</span>
          </div>
        </div>
        {error && <div className="character-reference-error"><CircleAlert size={15} /><span><strong>Новый образ не создан</strong><small>{error}</small></span></div>}
        <footer>
          {progress && <span className="character-reference-progress">{progress}</span>}
          {onRegenerate && <button className="outline-button" disabled={regenerating} onClick={() => onRegenerate(characterPrompt)}><RotateCcw size={14} />{regenerating ? "Создаю новый образ…" : "Перегенерировать по описанию"}</button>}
          <button className="generate-button" disabled={regenerating} onClick={onUse ?? onClose}>Использовать этого героя</button>
        </footer>
      </section>
    </div>
  );
}

function stockQueryForScene(scene: Scene): string {
  if (scene.stockSource?.query.trim()) return scene.stockSource.query.trim();
  if (scene.stockQuery?.trim()) return scene.stockQuery.trim();
  const prompt = scene.imagePrompt.replace(/\s+/g, " ").trim();
  const narration = scene.narration.replace(/\s+/g, " ").trim();
  return (prompt || `${scene.title} ${narration}`).slice(0, 100);
}

function StockMediaModal(props: { project: Project; scene: Scene; onClose: () => void; onApplied: (updated: Project) => Promise<void> }) {
  return props.project.settings.assembly.documentary?.version === 2
    ? <DocumentaryMaterialModal {...props} api={window.goldWork ?? fallbackApi} /> : <LegacyStockMediaModal {...props} />;
}
function LegacyStockMediaModal({ project, scene, onClose, onApplied }: {
  project: Project;
  scene: Scene;
  onClose: () => void;
  onApplied: (updated: Project) => Promise<void>;
}) {
  const api = window.goldWork ?? fallbackApi;
  const [provider, setProvider] = useState<StockProvider>(scene.stockSource?.provider === "pixabay" ? "pixabay" : "pexels");
  const [mediaType, setMediaType] = useState<StockMediaType>(scene.stockSource?.mediaType ?? "image");
  const [query, setQuery] = useState(stockQueryForScene(scene));
  const [configured, setConfigured] = useState<{ pexels: boolean; pixabay: boolean } | null>(null);
  const [items, setItems] = useState<StockAsset[]>([]);
  const [selected, setSelected] = useState<StockAsset | null>(null);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const orientation: StockOrientation = project.aspectRatio === "9:16" ? "portrait" : project.aspectRatio === "1:1" ? "square" : "landscape";

  useEffect(() => {
    let active = true;
    void api.getStockSettings().then((settings) => {
      if (!active) return;
      const next = { pexels: settings.pexelsConfigured, pixabay: settings.pixabayConfigured };
      setConfigured(next);
      if (!next[provider] && next.pixabay) setProvider("pixabay");
    }).catch((reason) => active && setError(errorMessage(reason)));
    return () => { active = false; };
  }, []);

  const search = async () => {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      setError("Введите короткий запрос для поиска.");
      return;
    }
    if (configured && !configured[provider]) {
      setError(`Сначала добавьте API-ключ ${provider === "pexels" ? "Pexels" : "Pixabay"} в Настройках → Stock.`);
      return;
    }
    setSearching(true);
    setError(null);
    setSelected(null);
    try {
      const result = await api.searchStock({ provider, mediaType, query: cleanQuery, orientation, page: 1, perPage: 24 });
      setItems(result.items);
      if (result.items.length === 0) setError("Ничего не найдено. Попробуйте более короткий или английский запрос.");
    } catch (reason) {
      setItems([]);
      setError(errorMessage(reason));
    } finally {
      setSearching(false);
    }
  };

  const apply = async () => {
    if (!selected) return;
    setApplying(true);
    setError(null);
    try {
      await assertCurrentRuntimeBuild(api);
      const updated = await api.applyStockAsset(project.id, scene.id, selected);
      await onApplied(updated);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !applying && onClose()}>
      <section className="stock-picker-modal">
        <header>
          <div><Search size={18} /><div><strong>Выбрать stock для сцены {scene.order + 1}</strong><small>{scene.title}</small></div></div>
          <button className="modal-close" disabled={applying} onClick={onClose}><X size={17} /></button>
        </header>
        <form className="stock-picker-search" onSubmit={(event) => { event.preventDefault(); void search(); }}>
          <select value={provider} onChange={(event) => { setProvider(event.target.value as StockProvider); setItems([]); setSelected(null); setError(null); }}>
            <option value="pexels">Pexels{configured && !configured.pexels ? " · нет ключа" : ""}</option>
            <option value="pixabay">Pixabay{configured && !configured.pixabay ? " · нет ключа" : ""}</option>
          </select>
          <select value={mediaType} onChange={(event) => { setMediaType(event.target.value as StockMediaType); setItems([]); setSelected(null); }}>
            <option value="image">Фотографии</option>
            <option value="video">Видео</option>
          </select>
          <input value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} placeholder="Например: cat looking at owner" autoFocus />
          <button className="generate-button compact" disabled={searching || applying} type="submit">
            <Search size={14} />{searching ? "Ищу…" : "Найти"}
          </button>
        </form>
        <div className="stock-picker-note">
          Формат {project.aspectRatio}. Результаты поиска кешируются; исходный файл скачивается только после кнопки «Использовать».
        </div>
        {error && <div className="stock-picker-error">{error}</div>}
        <div className="stock-picker-grid">
          {items.map((asset) => (
            <button
              type="button"
              key={`${asset.provider}:${asset.mediaType}:${asset.id}`}
              className={`stock-picker-card${selected?.id === asset.id && selected.provider === asset.provider ? " selected" : ""}`}
              onClick={() => setSelected(asset)}
            >
              <span className="stock-picker-thumb">
                <img src={asset.previewUrl} alt={asset.attribution} loading="lazy" />
                <em>{asset.mediaType === "video" ? `${Math.round(asset.durationSeconds ?? 0)} сек` : `${asset.width}×${asset.height}`}</em>
              </span>
              <span><strong>{asset.provider === "pexels" ? "Pexels" : "Pixabay"}</strong><small>{asset.author || "Автор не указан"}</small></span>
            </button>
          ))}
          {!searching && items.length === 0 && !error && <div className="stock-picker-empty"><Image size={28} /><span>Проверьте запрос и нажмите «Найти»</span></div>}
        </div>
        <footer>
          <div>
            {selected ? <><strong>{selected.attribution}</strong><button onClick={() => void api.openExternal(selected.pageUrl)}>Открыть источник</button></> : <span>Выберите один результат</span>}
          </div>
          <button className="ghost-button" disabled={applying} onClick={onClose}>Отмена</button>
          <button className="generate-button" disabled={!selected || applying} onClick={() => void apply()}>{applying ? "Скачиваю…" : "Использовать"}</button>
        </footer>
      </section>
    </div>
  );
}

function ScenarioMaterials({ project, hasQueueTasks, onBack, onSave, onRegenerateImage, onAnimateWithVeo, onNavigateStage }: {
  project: Project;
  hasQueueTasks: boolean;
  onBack: () => void;
  onSave: (id: string, input: UpdateProjectInput) => Promise<Project>;
  onRegenerateImage: (sceneId: string) => Promise<void>;
  onAnimateWithVeo: (sceneIds: string[]) => Promise<boolean>;
  onNavigateStage: OpenProjectWorkflowStage;
}) {
  const api = window.goldWork ?? fallbackApi;
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<string | null>(null);
  const [stockSceneId, setStockSceneId] = useState<string | null>(null);
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  useEffect(() => setPreviewSceneId(null), [stockSceneId, project.id]);
  const [selectedVeoSceneIds, setSelectedVeoSceneIds] = useState<Set<string>>(new Set());
  const [animatingVeo, setAnimatingVeo] = useState(false);
  const [veoError, setVeoError] = useState<string | null>(null);

  const regenerateImage = async (sceneId: string) => {
    setRegeneratingSceneId(sceneId);
    try {
      await onRegenerateImage(sceneId);
    } finally {
      setRegeneratingSceneId(null);
    }
  };

  const hero = project.characterReference;
  const stockMode = (project.mediaMode ?? "stock") === "stock";
  const generationBusy = project.status === "generating" || project.status === "paused";
  const includedDocumentaryScenes = project.scenes.filter(scene => scene.includeInAssembly !== false);
  const confirmedDocumentaryScenes = includedDocumentaryScenes.filter(materialReady);
  const confirmedDocumentaryVideos = confirmedDocumentaryScenes.filter(scene => scene.documentary?.selected?.kind === "video").length;
  const stockScene = project.scenes.find((scene) => scene.id === stockSceneId);
  const veoCandidates = stockMode
    ? []
    : project.scenes.filter((scene) => scene.includeInAssembly !== false && Boolean(scene.imagePath));
  const selectedVeoScenes = veoCandidates.filter((scene) => selectedVeoSceneIds.has(scene.id));
  const toggleVeoScene = (sceneId: string) => setSelectedVeoSceneIds((current) => {
    const next = new Set(current);
    if (next.has(sceneId)) next.delete(sceneId);
    else next.add(sceneId);
    return next;
  });
  const animateSelectedWithVeo = async () => {
    if (selectedVeoScenes.length === 0 || generationBusy || animatingVeo) return;
    setAnimatingVeo(true);
    setVeoError(null);
    try {
      const currentProvider = project.settings.video.provider;
      const provider = currentProvider === "veo" || currentProvider === "flow" || currentProvider === "anymodel-video"
        ? currentProvider
        : "flow";
      await onSave(project.id, {
        settings: {
          ...project.settings,
          video: {
            ...project.settings.video,
            enabled: true,
            provider,
            selectionMode: "manual",
          },
          assembly: {
            ...project.settings.assembly,
            montage: {
              planner: "ai-bounded",
              density: "balanced",
              graphicBeatPercent: 0,
              hardCutPercent: 100,
              ...project.settings.assembly.montage,
              enabled: false,
            },
          },
        },
      });
      const started = await onAnimateWithVeo(selectedVeoScenes.map((scene) => scene.id));
      if (started) {
        setSelectedVeoSceneIds(new Set());
        onNavigateStage(project.id, "production");
      }
    } catch (reason) {
      setVeoError(`Не удалось запустить Veo: ${errorMessage(reason)}. Выбор кадров сохранён.`);
    } finally {
      setAnimatingVeo(false);
    }
  };
  return (
    <div className="scenario-materials-page">
      {stockScene && (
        <StockMediaModal
          project={project}
          scene={stockScene}
          onClose={() => setStockSceneId(null)}
          onApplied={async (updated) => {
            await onSave(updated.id, { scenes: updated.scenes, outputPath: undefined });
          }}
        />
      )}
      <PageHeading
        icon={<button className="back-icon" onClick={onBack}><ChevronLeft size={22} /></button>}
        title={stockMode ? "Проверка stock" : "Материалы сценария"}
        subtitle={project.settings.assembly.documentary?.version === 2 ? `${project.title} · подтверждено ${confirmedDocumentaryScenes.length} из ${includedDocumentaryScenes.length} · видео: ${confirmedDocumentaryVideos} · фото: ${confirmedDocumentaryScenes.length - confirmedDocumentaryVideos}` : stockMode ? `${project.title} · ручная замена не обязательна` : `${project.title} · ${project.scenes.length} сцен`}
        actions={
          <button className="ghost-button" onClick={() => void api.openProjectFolder(project.id)}>
            <FolderOpen size={15} />
            Папка проекта
          </button>
        }
      />
      <ProjectWorkflowBar project={project} current="materials" hasQueueTasks={hasQueueTasks} busy={generationBusy || regeneratingSceneId !== null} onNavigate={(stage) => onNavigateStage(project.id, stage)} />

      {stockMode && (
        <section className="scenario-stock-auto-note">
          <span><Check size={19} /></span>
          <div>
            <strong>{project.settings.assembly.documentary?.version === 2 ? "Софт подбирает и проверяет материалы автоматически" : "Здесь не нужно заполнять сцены вручную"}</strong>
            <p>{project.settings.assembly.documentary?.version === 2 ? "Автоподбор проверяет реальные кадры и источник, сохраняет готовые сцены и помечает иллюстрации. Здесь можно подобрать пропущенные материалы или вручную заменить отдельный кадр." : "Автоподбор выполняется при нажатии главной кнопки сборки. Этот экран нужен только если вы хотите проверить или заменить отдельный кадр."}</p>
            {project.settings.assembly.documentary?.version===2&&<DocumentaryAutoSelection api={api} project={project} disabled={generationBusy||regeneratingSceneId!==null} onSelected={async updated=>{await onSave(updated.id,{});}}/>}
          </div>
          <button className="outline-button small" onClick={onBack}>Вернуться к сборке</button>
        </section>
      )}

      {!stockMode && project.storyCharacters && <StoryCharactersPanel project={project} api={api} disabled readOnly onUpdated={() => undefined} />}
      {!stockMode && !project.storyCharacters && <section className="scenario-materials-hero">
        <div className="scenario-materials-title">
          <div><CircleUserRound size={18} /><strong>Главный герой</strong></div>
          <button className="outline-button small" onClick={() => onNavigateStage(project.id, "scenario")}>
            <FileText size={14} />
            {hero ? "Посмотреть в сценарии" : "Создать в сценарии"}
          </button>
        </div>
        {hero ? (
          <div className="scenario-character-card">
            <img key={hero.updatedAt} src={api.mediaUrl(hero.imagePath)} alt={hero.name} />
            <div>
              <small>ИМЯ</small>
              <h3>{hero.name}</h3>
              <small>ПРОМПТ ПЕРСОНАЖА</small>
              <p>{hero.prompt}</p>
              <span>Изображение сохранено в проекте и используется как референс внешности.</span>
            </div>
          </div>
        ) : (
          <div className="scenario-materials-empty">
            <CircleUserRound size={32} />
            <div><strong>Образ героя ещё не создан</strong><span>Вернитесь на этап «Сценарий»: там можно создать, проверить и при необходимости заменить персонажа до генерации кадров.</span></div>
          </div>
        )}
      </section>}

      {!stockMode && (
        <section className="veo-selection-panel">
          <div className="veo-selection-copy">
            <span><Video size={19} /></span>
            <div>
              <strong>Оживление готовых кадров</strong>
              <p>Выберите несколько уже созданных картинок. Исходные кадры сохранятся, даже если Veo не завершит видео.</p>
            </div>
          </div>
          <div className="veo-selection-actions">
            <span>Выбрано: <b>{selectedVeoScenes.length}</b> из {veoCandidates.length}</span>
            <button
              className="ghost-button"
              disabled={generationBusy || animatingVeo || veoCandidates.length === 0}
              onClick={() => setSelectedVeoSceneIds(new Set(veoCandidates.map((scene) => scene.id)))}
            >
              Выбрать все готовые
            </button>
            {selectedVeoScenes.length > 0 && (
              <button className="ghost-button" disabled={animatingVeo} onClick={() => setSelectedVeoSceneIds(new Set())}>
                Снять выбор
              </button>
            )}
            <button
              className="generate-button compact"
              disabled={generationBusy || animatingVeo || selectedVeoScenes.length === 0}
              onClick={() => void animateSelectedWithVeo()}
            >
              <WandSparkles size={15} />
              {animatingVeo ? "Добавляю в очередь…" : `Оживить через Veo (${selectedVeoScenes.length})`}
            </button>
          </div>
          {veoCandidates.length === 0 && <small>Сначала создайте изображения — здесь появится ручной выбор.</small>}
          {veoError && <p className="veo-selection-error" role="alert">{veoError}</p>}
        </section>
      )}

      <section className="scenario-materials-scenes">
        <div className="scenario-materials-title">
          <div><FileText size={18} /><strong>Сцены по порядку</strong></div>
          <span>{project.scenes.length} сцен</span>
        </div>
        {project.scenes.map((scene) => (
          <article className={`scenario-material-card${selectedVeoSceneIds.has(scene.id) ? " veo-selected" : ""}`} key={scene.id}>
            <div className="scenario-material-image">
              {!stockMode && scene.imagePath && (
                <button
                  type="button"
                  className="scenario-material-veo-select"
                  aria-pressed={selectedVeoSceneIds.has(scene.id)}
                  aria-label={`${selectedVeoSceneIds.has(scene.id) ? "Убрать" : "Выбрать"} сцену ${scene.order + 1} для Veo`}
                  disabled={generationBusy || animatingVeo || scene.includeInAssembly === false}
                  title={scene.includeInAssembly === false ? "Сцена исключена из ролика" : undefined}
                  onClick={() => toggleVeoScene(scene.id)}
                >
                  {selectedVeoSceneIds.has(scene.id) ? <Check size={15} /> : <Plus size={15} />}
                  {selectedVeoSceneIds.has(scene.id) ? "Выбрано для Veo" : "Выбрать для Veo"}
                </button>
              )}
              {scene.videoPath && !scene.videoFallback ? previewSceneId === scene.id ? (
                <video src={api.mediaUrl(scene.videoPath)} poster={scene.imagePath ? api.mediaUrl(scene.imagePath) : undefined} controls autoPlay muted preload="metadata" />
              ) : (
                <button className="scenario-video-preview" aria-label={`Просмотреть видео сцены ${scene.order + 1}`} onClick={() => setPreviewSceneId(scene.id)}>
                  {scene.imagePath && <LocalMediaImage src={api.mediaUrl(scene.imagePath)} alt={scene.title} />}
                  <span><Play size={22} />Просмотреть видео</span>
                </button>
              ) : scene.imagePath ? (
                <LocalMediaImage src={api.mediaUrl(scene.imagePath)} alt={scene.title} />
              ) : (
                <div className="scene-placeholder"><Image size={28} /><span>Кадр ещё не создан</span></div>
              )}
              <div className="scenario-material-actions">
                <button className="outline-button small" disabled={generationBusy || regeneratingSceneId !== null} onClick={() => setStockSceneId(scene.id)}>
                  <Search size={13} />
                  {scene.documentary ? scene.documentary.manualReview?.status==='pending' ? "Проверить вручную · заменить" : scene.documentary.verified ? "Материал подтверждён · заменить" : "Найти / проверить материал" : scene.stockSource ? "Заменить stock" : "Найти stock"}
                </button>
                {!stockMode && (
                  <button className="outline-button small" disabled={generationBusy || regeneratingSceneId !== null} onClick={() => void regenerateImage(scene.id)}>
                    <RotateCcw size={13} />
                    {regeneratingSceneId === scene.id ? "Добавляю в очередь…" : scene.imagePath ? "Сгенерировать заново" : "Сгенерировать AI-кадр"}
                  </button>
                )}
              </div>
              {scene.stockSource && (
                <button className="scenario-stock-source" onClick={() => void api.openExternal(scene.stockSource!.pageUrl)}>
                  {documentaryProviderLabels[scene.stockSource.provider]} · {scene.stockSource.author} · открыть источник
                </button>
              )}
              {!stockMode && scene.videoPath && <span className="scenario-material-video-ready">
                {scene.videoFallback ? "Без анимации: использован исходный кадр" : <><Check size={12} />AI-видео готово</>}
              </span>}
            </div>
            <div className="scenario-material-copy">
              <header><span>{scene.order + 1}</span><div><strong>{scene.title}</strong><small>{sceneDurationLabel(scene)} · {scene.status}</small></div></header>
              <div><small>ОЗВУЧКА</small><p>{scene.narration || "Текст не задан"}</p></div>
              {scene.documentary ? <div><small>ЧТО ДОЛЖНО БЫТЬ В КАДРЕ</small><p>{scene.documentary.requirement.entities.join(" / ") || scene.stockQuery}{scene.documentary.requirement.years.length ? ` · ${scene.documentary.requirement.years.join(", ")}` : ""}</p><small>{scene.documentary.verified ? "Подтверждён" : (scene.documentary.candidateCount ?? scene.documentary.candidates.length) ? `Кандидатов: ${scene.documentary.candidateCount ?? scene.documentary.candidates.length} · нужна проверка` : "Материал пока не найден"}</small></div> : <><div><small>ПРОМПТ ИЗОБРАЖЕНИЯ</small><p>{scene.imagePrompt || "Промпт не задан"}</p></div><div><small>ПРОМПТ ВИДЕО / АНИМАЦИИ</small><p>{scene.animationPrompt || "Промпт не задан"}</p></div></>}
              {scene.documentary?.selected?.kind === "image" && scene.documentary.requirement.preferredKind === "video" && <p className="documentary-photo-fallback">Фото вместо видео</p>}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function ScenarioEditor({ project, initialView, hasQueueTasks, busy, progress, onContinueReview, onViewChange, onNavigateStage, onRegisterLeaveGuard, onSave, onRegenerateImage, onAnimateWithVeo, onBack }: { project?: Project; initialView: ScenarioView; hasQueueTasks: boolean; busy: boolean; progress: string | null; onContinueReview: () => Promise<void>; onViewChange: (view: ScenarioView) => void; onNavigateStage: OpenProjectWorkflowStage; onRegisterLeaveGuard: RegisterLeaveGuard; onSave: (id: string, input: UpdateProjectInput) => Promise<Project>; onRegenerateImage: (sceneId: string) => Promise<void>; onAnimateWithVeo: (sceneIds: string[]) => Promise<boolean>; onBack: () => void }) {
  const api = window.goldWork ?? fallbackApi;
  // Edits below are immutable. Do not clone all candidates on each progress render.
  const [scenes, setScenes] = useState<Scene[]>(() => project?.scenes ?? []);
  const leaveGuardRef = useRef<() => Promise<boolean>>(async () => true);
  const loadedProjectIdRef = useRef(project?.id);
  const sceneBaselineRef = useRef<Scene[]>(project?.scenes ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(project?.scenes[0]?.id ?? null);
  const [saving, setSaving] = useState(false);
  const improving = false;
  const [view, setView] = useState<ScenarioView>(initialView);
  const [editorMode, setEditorMode] = useState<"scenes" | "full">(project && projectMediaMode(project) !== "stock" ? "full" : "scenes");
  const [copiedAll, setCopiedAll] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [heroBuilding, setHeroBuilding] = useState(false);
  const [heroConfirming, setHeroConfirming] = useState(false);
  const [heroProgress, setHeroProgress] = useState<string | null>(null);
  const [heroElapsedSeconds, setHeroElapsedSeconds] = useState(0);
  const [heroError, setHeroError] = useState<string | null>(null);
  const [heroPreview, setHeroPreview] = useState<NonNullable<Project["characterReference"]> | null>(null);
  const [visualStyle, setVisualStyle] = useState(project?.settings.image.style ?? "");
  const [characterPrompt, setCharacterPrompt] = useState(project?.characterReference?.characterPrompt ?? project?.characterReference?.prompt ?? "");
  useEffect(() => onRegisterLeaveGuard("scenario", () => leaveGuardRef.current()), [onRegisterLeaveGuard]);
  useEffect(() => setView(initialView), [initialView]);
  useEffect(() => api.onDirectorProgress((stage) => {
    if (stage.startsWith("Референс героя")) setHeroProgress(stage);
  }), [api]);
  useEffect(() => {
    if (!heroBuilding) {
      setHeroElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const update = () => setHeroElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [heroBuilding]);
  useEffect(() => {
    if (!project) {
      loadedProjectIdRef.current = undefined;
      sceneBaselineRef.current = [];
      setScenes([]);
      setSelectedId(null);
      setHeroPreview(null);
      setVisualStyle("");
      setCharacterPrompt("");
      return;
    }
    if (loadedProjectIdRef.current !== project.id) {
      loadedProjectIdRef.current = project.id;
      const next = project.scenes;
      sceneBaselineRef.current = next;
      setScenes(next);
      setSelectedId(next[0]?.id ?? null);
      setEditorMode(projectMediaMode(project) !== "stock" ? "full" : "scenes");
      setHeroPreview(null);
      setHeroError(null);
      setVisualStyle(project.settings.image.style);
      setCharacterPrompt(project.characterReference?.characterPrompt ?? project.characterReference?.prompt ?? "");
      return;
    }
    const previous = sceneBaselineRef.current;
    const incoming = project.scenes;
    sceneBaselineRef.current = incoming;
    setScenes(current => mergeScenarioDraft(current, previous, incoming));
    setSelectedId((current) => current ?? project.scenes[0]?.id ?? null);
  }, [project?.id, project?.updatedAt]);
  useEffect(() => {
    if (!project?.characterReference || heroBuilding) return;
    setCharacterPrompt(project.characterReference.characterPrompt ?? project.characterReference.prompt);
  }, [project?.characterReference?.updatedAt, heroBuilding]);
  if (!project) {
    leaveGuardRef.current = async () => true;
    return <EmptyState icon={<FileText size={34} />} title="Проект не выбран" text="Выберите проект перед редактированием сценария." action="Назад" onAction={onBack} />;
  }
  if (view === "materials") {
    leaveGuardRef.current = async () => true;
    return <ScenarioMaterials project={{ ...project, scenes }} hasQueueTasks={hasQueueTasks} onBack={() => onNavigateStage(project.id, "settings")} onSave={onSave} onRegenerateImage={onRegenerateImage} onAnimateWithVeo={onAnimateWithVeo} onNavigateStage={onNavigateStage} />;
  }
  if (project.status === "generating" || project.status === "paused") {
    leaveGuardRef.current = async () => true;
    return <div className="scenario-page ai-story-review">
      <PageHeading icon={<FileText size={22} />} title="Сценарий" subtitle={`${project.title} · просмотр во время производства`} />
      <ProjectWorkflowBar project={project} current="scenario" hasQueueTasks={hasQueueTasks} onNavigate={stage => onNavigateStage(project.id, stage)} />
      <p>Сценарий можно читать. Редактирование станет доступно после завершения или остановки производства.</p>
      {project.storyCharacters && <StoryCharactersPanel project={project} api={api} disabled readOnly onUpdated={() => undefined} />}
      <section className="full-scenario-view"><div className="full-scenario-document"><p>{project.videoBrief?.creationMode === "script" ? project.videoBrief.readyScript : project.scenes.map(scene => scene.narration).join("\n\n")}</p></div></section>
    </div>;
  }
  const selected = scenes.find((scene) => scene.id === selectedId);
  const assembledNarration = scenes.map((scene) => scene.narration.trim()).filter(Boolean).join("\n\n");
  const storedReadyScript = project.videoBrief?.creationMode === "script"
    ? project.videoBrief.readyScript
    : undefined;
  const normalizeNarrationSpacing = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const fullNarration = storedReadyScript
    && normalizeNarrationSpacing(storedReadyScript) === normalizeNarrationSpacing(assembledNarration)
    ? storedReadyScript
    : assembledNarration;
  const narrationCharacters = fullNarration.length;
  const narrationWords = fullNarration ? fullNarration.split(/\s+/u).filter(Boolean).length : 0;
  const storyStructure = scenarioStoryStructure(project, scenes);
  const isAiProject = projectMediaMode(project) !== "stock";
  const hero = project.characterReference;
  const reindex = (items: Scene[]) => items.map((scene, order) => ({ ...scene, order }));
  const addScene = () => {
    const scene: Scene = {
      id: `scene_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      order: scenes.length,
      title: `Сцена ${scenes.length + 1}`,
      narration: "",
      imagePrompt: "",
      animationPrompt: "",
      durationSeconds: 5,
      status: "draft",
    };
    setScenes([...scenes, scene]);
    setSelectedId(scene.id);
  };
  const updateScene = (patch: Partial<Scene>) =>
    setScenes((current) =>
      current.map((scene) =>
        scene.id === selectedId
          ? {
              ...scene,
              ...patch,
              status: "draft",
              imagePath: undefined,
              videoPath: undefined,
              audioPath: undefined,
            }
          : scene,
      ),
    );
  // Монтажные свойства (участие в сборке, переход, Ken Burns) не трогают сгенерированные медиа —
  // в отличие от updateScene, который сбрасывает сцену в draft.
  const updateSceneMeta = (patch: Partial<Scene>) =>
    setScenes((current) => current.map((scene) => (scene.id === selectedId ? { ...scene, ...patch } : scene)));
  const removeScene = (id: string) => {
    const next = reindex(scenes.filter((scene) => scene.id !== id));
    setScenes(next);
    setSelectedId(next[0]?.id ?? null);
  };
  const duplicateScene = (scene: Scene) => {
    const copy: Scene = {
      ...structuredClone(scene),
      id: `scene_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: `${scene.title} — копия`,
      status: "draft",
      imagePath: undefined,
      videoPath: undefined,
      audioPath: undefined,
    };
    const index = scenes.findIndex((item) => item.id === scene.id);
    const next = [...scenes];
    next.splice(index + 1, 0, copy);
    setScenes(reindex(next));
    setSelectedId(copy.id);
  };
  const move = (id: string, direction: -1 | 1) => {
    const index = scenes.findIndex((scene) => scene.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= scenes.length) return;
    const next = [...scenes];
    const current = next[index];
    const other = next[target];
    if (!current || !other) return;
    next[index] = other;
    next[target] = current;
    setScenes(reindex(next));
  };
  const sceneChanges = scenarioEditorSnapshot(reindex(scenes)) !== scenarioEditorSnapshot(project.scenes);
  const styleChanges = visualStyle.trim() !== project.settings.image.style.trim();
  const hasUnsavedChanges = sceneChanges || styleChanges;
  const save = async () => {
    if (!hasUnsavedChanges) return true;
    setSaving(true);
    try {
      const alreadyReviewed = !scenarioReviewBlockReason(project);
      const needsReview = scenes.length === 0 || (!isReadyStockScript(project) && (
        (project.status === "draft" && !alreadyReviewed)
        || (sceneChanges && Boolean(project.referenceAnalysis || project.videoBrief?.creationMode === "script"))
      ));
      await onSave(project.id, {
        ...(sceneChanges ? { scenes: reindex(scenes) } : {}),
        ...(styleChanges ? { settings: { ...project.settings, image: { ...project.settings.image, style: visualStyle.trim() } } } : {}),
        status: sceneChanges ? needsReview ? "draft" : "ready" : project.status,
      });
      return true;
    } catch { return false; } finally { setSaving(false); }
  };
  const copyFullNarration = async () => {
    if (!fullNarration) return;
    setCopyError(null);
    try { await copyPlainText(fullNarration); setCopiedAll(true); window.setTimeout(() => setCopiedAll(false), 2000); }
    catch (reason) { setCopyError(errorMessage(reason)); }
  };
  const createHero = async (promptOverride?: string) => {
    setHeroError(null);
    setHeroProgress("Референс героя: подготавливаю сохранённый сценарий…");
    setHeroBuilding(true);
    try {
      await assertCurrentRuntimeBuild(api);
      if (!(await save())) return;
      const requestedPrompt = (promptOverride ?? characterPrompt).trim();
      const result = await api.createCharacterReference(project.id, {
        stylePrompt: visualStyle.trim(),
        characterPrompt: requestedPrompt || undefined,
      });
      await onSave(project.id, {
        // Новая версия показывается как candidate и не заменяет
        // подтверждённого героя до кнопки «Использовать этого героя».
        characterReference: result.project.characterReference,
        settings: result.project.settings,
        status: result.project.status,
        outputPath: result.project.outputPath,
      });
      setVisualStyle(result.project.settings.image.style);
      setCharacterPrompt(result.character.characterPrompt ?? result.character.prompt);
      setHeroPreview(result.character);
    } catch (reason) {
      setHeroError(errorMessage(reason));
    } finally {
      setHeroBuilding(false);
      setHeroProgress(null);
    }
  };
  const useHeroPreview = async () => {
    if (!heroPreview) return;
    if (!("versionId" in heroPreview) || typeof heroPreview.versionId !== "string") {
      setHeroPreview(null);
      return;
    }
    setHeroConfirming(true);
    try {
      const result = await api.confirmChannelCharacterReference(project.id, heroPreview.versionId);
      await onSave(project.id, {
        characterReference: result.project.characterReference,
        settings: result.project.settings,
        status: result.project.status,
        outputPath: result.project.outputPath,
      });
      setHeroPreview(null);
    } catch (reason) {
      setHeroError(errorMessage(reason));
    } finally {
      setHeroConfirming(false);
    }
  };
  leaveGuardRef.current = async () => Boolean(await save());
  const navigateWorkflow = async (stage: ProjectWorkflowStage) => {
    if (stage === "scenario") return;
    if (!(await save())) return;
    if (stage === "materials") {
      setView("materials");
      onViewChange("materials");
      return;
    }
    onNavigateStage(project.id, stage);
  };
  return (
    <div className={`scenario-page page-with-actionbar${isAiProject ? " ai-story-review" : ""}`}>
      {scenarioReviewBlockReason({...project, scenes}) && (
        <section className="scenario-review-notice" role="status" aria-live="polite">
          <strong>{busy ? "Проверка и исправление сценария…" : "Сценарий ещё не готов к производству"}</strong>
          <p>{progress || scenarioReviewBlockReason({...project, scenes})}</p>
          {project.referenceAnalysis?.scenarioRepair && <p>Сохранено исправлений: {project.referenceAnalysis.scenarioRepair.completedScenes.length} из {project.referenceAnalysis.scenarioRepair.sourceSceneCount - project.referenceAnalysis.scenarioRepair.fromIndex}. До завершения здесь показан исходный черновик.</p>}
          <button className="generate-button" disabled={busy || saving || hasQueueTasks} onClick={() => void (async () => { if (!(await save())) return; if (project.videoBrief?.creationMode === "script") await onContinueReview(); else onNavigateStage(project.id, "brief"); })()}>
            <RotateCcw size={16} />{busy ? "Подготавливаю кадры…" : project.videoBrief?.creationMode === "script" ? "Продолжить подготовку кадров" : "Вставить готовый сценарий"}
          </button>
          {project.videoBrief?.creationMode !== "script" && <p>Существующие сцены сохранены. Для новой подготовки нужен готовый текст.</p>}
        </section>
      )}
      {heroPreview && (
        <CharacterReferenceModal
          character={heroPreview}
          imageUrl={api.mediaUrl(heroPreview.imagePath)}
          visualStyle={visualStyle}
          regenerating={heroBuilding || heroConfirming}
          progress={heroProgress ? `${heroProgress} · ${heroElapsedSeconds} с` : undefined}
          error={heroError ?? undefined}
          onRegenerate={(nextPrompt) => void createHero(nextPrompt)}
          onUse={() => void useHeroPreview()}
          onClose={() => setHeroPreview(null)}
        />
      )}
      <PageHeading
        icon={isAiProject ? <FileText size={22} /> :
          <button className="back-icon" disabled={saving} onClick={() => void navigateWorkflow("settings")}>
            <ChevronLeft size={22} />
          </button>
        }
        title={isAiProject ? "Проверьте сценарий" : "Редактор сценария"}
        subtitle={`${project.title} · ${scenes.length} сцен`}
        actions={
          <details className="scenario-extra-actions"><summary><MoreHorizontal size={16} /> Дополнительно</summary><div>
            <button className="ghost-button" onClick={() => void (window.goldWork ?? fallbackApi).openProjectFolder(project.id)}>
              <FolderOpen size={15} />
              Папка проекта
            </button>
            <button className="ghost-button" onClick={addScene}>
              <Plus size={15} />
              Добавить сцену
            </button>
            <button className="ghost-button" disabled={saving || scenes.length === 0} onClick={() => void navigateWorkflow("materials")}>
              <Image size={15} />
              Материалы сцен
            </button>
          </div></details>
        }
      />
      <ProjectWorkflowBar project={{ ...project, scenes }} current="scenario" hasQueueTasks={hasQueueTasks} busy={saving || improving || heroBuilding} onNavigate={(stage) => void navigateWorkflow(stage)} />
      {scenes.length > 0 && isAiProject && (
        <details className="scenario-style-stage" open={isAiProject ? undefined : true}>
          <summary>Стиль изображений · {IMAGE_STYLES.find(style => style.promptSuffix === visualStyle.trim())?.label ?? "Свой стиль"}</summary>
          <header>
            <div><Sparkles size={18} /><span><strong>Стиль всех кадров</strong><small>Выберите готовый вариант или опишите свой — он сохранится для всего ролика</small></span></div>
            <em>{IMAGE_STYLES.find((style) => style.promptSuffix === visualStyle.trim())?.label ?? "Свой стиль"}</em>
          </header>
          <VisualStyleChooser value={visualStyle} onChange={setVisualStyle} />
        </details>
      )}
      {scenes.length > 0 && (
        <div className={`scenario-overview-grid${isAiProject ? "" : " stock-only"}`}>
          <details className="scenario-story-map" open={isAiProject ? undefined : true}>
            <summary>Как развивается история · {storyStructure.length} блоков</summary>
            <header>
              <div><ListPlus size={17} /><span><strong>Как развивается история</strong><small>Структура ролика до генерации материалов</small></span></div>
              <em>{storyStructure.length} блоков</em>
            </header>
            <div className="scenario-story-points">
              {storyStructure.map((point, index) => (
                <article key={`${point.label}-${point.sceneNumber ?? index}-${point.title}`}>
                  <span>{point.label === "Часть" ? `Часть ${storyStructure.slice(0, index + 1).filter((item) => item.label === "Часть").length}` : point.label}</span>
                  <strong>{point.title}</strong>
                  <p>{point.summary}</p>
                  <small>{point.sceneNumber === point.endSceneNumber ? `сцена ${point.sceneNumber}` : `сцены ${point.sceneNumber}–${point.endSceneNumber}`}</small>
                </article>
              ))}
            </div>
          </details>

          {isAiProject && !project.storyCharacterPlan && (
            <details className={`scenario-hero-stage${heroBuilding ? " building" : ""}`} open={hero ? true : undefined}>
              <summary>{hero ? `Герой: ${hero.name}` : "Добавить постоянного героя · необязательно"}</summary>
              <header>
                <div><CircleUserRound size={18} /><span><strong>Образ главного героя</strong><small>Один референс для всех AI-кадров</small></span></div>
                {hero && <em>Создан</em>}
              </header>
              {hero ? (
                <div className="scenario-hero-ready">
                  <button className="scenario-hero-thumb" onClick={() => setHeroPreview(hero)} title="Открыть изображение героя">
                    <img key={hero.updatedAt} src={api.mediaUrl(hero.imagePath)} alt={hero.name} />
                  </button>
                  <div>
                    <strong>{hero.name}</strong>
                    <p>{hero.prompt}</p>
                    <div>
                      <button className="outline-button small" disabled={heroBuilding} onClick={() => setHeroPreview(hero)}><Eye size={13} />Посмотреть</button>
                      <button className="outline-button small" disabled={heroBuilding} onClick={() => void createHero(characterPrompt)}><RotateCcw size={13} />Создать заново</button>
                    </div>
                    {hero.stylePrompt && hero.stylePrompt.trim() !== visualStyle.trim() && <small className="scenario-hero-style-warning">Стиль изменён — перегенерируйте героя, чтобы он совпадал с будущими кадрами.</small>}
                  </div>
                </div>
              ) : (
                <div className="scenario-hero-empty-wrap">
                  <div className="scenario-hero-empty">
                    <CircleUserRound size={34} />
                    <div><strong>Персонаж ещё не создан</strong><p>Опишите постоянные черты сами или оставьте поле пустым — AI найдёт главного героя в сценарии. До генерации всех кадров вы увидите тестовый образ.</p></div>
                    <button className="generate-button compact" disabled={heroBuilding || scenes.length === 0} onClick={() => void createHero(characterPrompt)}><WandSparkles size={14} />Создать образ героя</button>
                  </div>
                  <label className="scenario-character-draft">
                    <span>СВОЙ ПРОМПТ ВНЕШНОСТИ · НЕОБЯЗАТЕЛЬНО</span>
                    <textarea
                      rows={3}
                      maxLength={4_000}
                      value={characterPrompt}
                      disabled={heroBuilding}
                      placeholder="Например: Максим, 37 лет, круглое лицо, короткие тёмные волосы, серо-голубая рубашка, коричневый ремень и часы на левой руке"
                      onChange={(event) => setCharacterPrompt(event.target.value)}
                    />
                  </label>
                </div>
              )}
              {heroBuilding && (
                <div className="scenario-hero-progress" role="status" aria-live="polite">
                  <Sparkles size={17} />
                  <div>
                    <strong>{heroProgress ?? "Референс героя: запускаю генерацию…"}</strong>
                    <span>Прошло {heroElapsedSeconds} с · приложение работает, дождитесь результата</span>
                    <i><em /></i>
                  </div>
                </div>
              )}
              {heroError && (
                <div className="scenario-inline-error" role="alert">
                  <CircleAlert size={16} />
                  <span><strong>Референс не создан</strong><small>{heroError}</small></span>
                  <button className="outline-button small" disabled={heroBuilding} onClick={() => void createHero(characterPrompt)}><RotateCcw size={13} />Повторить</button>
                </div>
              )}
            </details>
          )}
        </div>
      )}
      {scenes.length > 0 && (
        <div className="scenario-view-toolbar">
          <div role="tablist" aria-label="Режим просмотра сценария">
            <button role="tab" aria-selected={editorMode === "full"} className={editorMode === "full" ? "active" : ""} onClick={() => setEditorMode("full")}><FileText size={14} />Весь сценарий</button>
            <button role="tab" aria-selected={editorMode === "scenes"} className={editorMode === "scenes" ? "active" : ""} onClick={() => setEditorMode("scenes")}><Grid2X2 size={14} />{isAiProject ? "Сцены и промпты" : "Сцены и поисковые запросы"}</button>
          </div>
          <span>{narrationCharacters.toLocaleString("ru-RU")} символов · {narrationWords.toLocaleString("ru-RU")} слов</span>
        </div>
      )}
      {isAiProject && <StoryCharactersPanel project={{ ...project, scenes }} api={api} disabled={busy || saving || heroBuilding || hasUnsavedChanges}
        onUpdated={async updated => { await onSave(project.id, { storyCharacters: updated.storyCharacters, storyCharacterPlan: updated.storyCharacterPlan,
          storyCharacterSheet: updated.storyCharacterSheet, status: updated.status }); }} />}
      {scenes.length === 0 ? (
        <EmptyState icon={<FileText size={34} />} title="Сценарий пуст" text="Добавьте первую сцену. Для каждой сцены можно задать текст, изображение и движение." action="Добавить сцену" onAction={addScene} />
      ) : editorMode === "full" ? (
        <section className="full-scenario-view">
          <header>
            <div><strong>Полный текст озвучки</strong><small>Только слова диктора, без промптов изображений и служебных полей</small></div>
            <button className="outline-button" disabled={!fullNarration} onClick={() => void copyFullNarration()}>
              {copiedAll ? <Check size={15} /> : <Copy size={15} />}
              {copiedAll ? "Скопировано" : "Копировать весь сценарий"}
            </button>
          </header>
          {copyError && <div className="scenario-inline-error" role="alert"><CircleAlert size={15} /><span><strong>Не удалось скопировать</strong><small>{copyError}</small></span></div>}
          <div className="full-scenario-document">
            <p>{fullNarration || "—"}</p>
          </div>
        </section>
      ) : (
        <div className="scenario-layout">
          <aside className="scene-list">
            {scenes.map((scene, index) => (
              <article className={`scene-list-item${scene.id === selectedId ? " selected" : ""}`} key={scene.id} onClick={() => setSelectedId(scene.id)}>
                <span>{index + 1}</span>
                <div>
                  <strong>{scene.title}</strong>
                  <small>
                    {sceneDurationLabel(scene)}{scene.includeInAssembly === false ? " · вне сборки" : ""}
                  </small>
                </div>
                <div className="scene-mini-actions">
                  <button
                    title="Вверх"
                    onClick={(event) => {
                      event.stopPropagation();
                      move(scene.id, -1);
                    }}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    title="Вниз"
                    onClick={(event) => {
                      event.stopPropagation();
                      move(scene.id, 1);
                    }}
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>
              </article>
            ))}
          </aside>
          {selected && (
            <section className="scene-editor">
              <div className="scene-editor-head">
                <div>
                  <strong>Сцена {selected.order + 1}</strong>
                  <small>ID: {selected.id}</small>
                </div>
                <div>
                  <button className="ghost-button" onClick={() => void (window.goldWork ?? fallbackApi).openSceneFolder(project.id, selected.id)}>
                    <FolderOpen size={14} />
                    Папка сцены
                  </button>
                  <button className="ghost-button" onClick={() => duplicateScene(selected)}>
                    <Copy size={14} />
                    Копировать
                  </button>
                  <button className="danger-button" onClick={() => removeScene(selected.id)}>
                    <Trash2 size={14} />
                    Удалить
                  </button>
                </div>
              </div>
              <div className="scene-form-grid">
                <Field label="НАЗВАНИЕ СЦЕНЫ">
                  <input value={selected.title} onChange={(event) => updateScene({ title: event.target.value })} />
                </Field>
                <Field label={selected.documentary ? selected.documentary.timing ? "ПО ОЗВУЧКЕ, СЕК" : "ОЦЕНКА ДО ОЗВУЧКИ, СЕК" : "ДЛИТЕЛЬНОСТЬ, СЕК"} hint={selected.documentary ? "Точная длительность определяется готовым голосом. До озвучки показан ориентир по скорости выбранного голоса." : undefined}>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    step="0.01"
                    readOnly={Boolean(selected.documentary)}
                    value={Number(((selected.documentary?.timing?.durationInFrames ?? selected.durationSeconds * 30) / 30).toFixed(2))}
                    onChange={(event) =>
                      updateScene({
                        durationSeconds: Math.max(1, Number(event.target.value)),
                        durationOverrideSeconds: undefined,
                      })
                    }
                  />
                </Field>
              </div>
              <ToggleRow
                label="Сцена участвует в сборке"
                hint="Выключите — сцена не попадёт в Final.mp4, но останется в проекте и её можно вернуть."
                checked={selected.includeInAssembly !== false}
                onChange={(included) => updateSceneMeta({ includeInAssembly: included })}
              />
              <div className="scene-form-grid">
                <Field label="ПЕРЕХОД К СЛЕДУЮЩЕЙ СЦЕНЕ" hint="Смешивание — кадры плавно перетекают друг в друга; мягкое затухание отделяет смысловые блоки.">
                  <select
                    value={selected.transition ?? "auto"}
                    onChange={(event) => {
                      const value = event.target.value;
                      updateSceneMeta({ transition: value === "auto" ? undefined : (value as Scene["transition"]) });
                    }}
                  >
                    <option value="auto">Автомонтаж / как в проекте</option>
                    <option value="mix">Смешивание (mix)</option>
                    <option value="fade">Мягкое затухание</option>
                    <option value="none">Без перехода</option>
                  </select>
                </Field>
                <Field label="ДВИЖЕНИЕ КАМЕРЫ (KEN BURNS)" hint="Эффект живой камеры на картинке сцены: плавное приближение или отдаление.">
                  <select value={selected.kenBurnsDirection ?? "auto"} onChange={(event) => updateSceneMeta({ kenBurnsDirection: event.target.value as Scene["kenBurnsDirection"] })}>
                    <option value="auto">Как в проекте</option>
                    <option value="in">Приближение</option>
                    <option value="out">Отдаление</option>
                    <option value="off">Без движения</option>
                  </select>
                </Field>
              </div>
              <Field label="ТЕКСТ ОЗВУЧКИ">
                <textarea rows={5} value={selected.narration} onChange={(event) => updateScene({ narration: event.target.value })} placeholder="Текст, который прозвучит в этой сцене" />
              </Field>
              {isAiProject ? <><Field label="ПРОМПТ ИЗОБРАЖЕНИЯ">
                <textarea rows={5} value={selected.imagePrompt} onChange={(event) => updateScene({ imagePrompt: event.target.value })} placeholder="Опишите кадр, персонажей, локацию и стиль" />
              </Field>
              <Field label="ПРОМПТ АНИМАЦИИ / ВИДЕО">
                <textarea rows={4} value={selected.animationPrompt} onChange={(event) => updateScene({ animationPrompt: event.target.value })} placeholder="Движение камеры и объектов в кадре" />
              </Field></> : <SceneSearchQueries project={{...project, scenes}} scene={selected} />}
            </section>
          )}
        </div>
      )}
      <div className="sticky-actions editor-actions">
        <span>
          {scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0)} секунд · {scenes.length} сцен
        </span>
        <div>
          {hasUnsavedChanges && <button className="outline-button" disabled={saving || busy} onClick={() => void save()}>
            <Save size={16} />
            {saving ? "Сохраняю…" : "Сохранить изменения"}
          </button>}
          <button className="generate-button" disabled={saving || busy || improving || heroBuilding || scenes.length === 0 || Boolean(scenarioReviewBlockReason({ ...project, scenes }))} onClick={() => void navigateWorkflow("settings")}>
            Далее — настройки <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SubtitleStudio({ project, onSave }: { project?: Project; onSave: (id: string, input: UpdateProjectInput) => Promise<Project> }) {
  const defaults = createDefaultProjectSettings().subtitles;
  const [draft, setDraft] = useState<SubtitleSettings>(project?.settings.subtitles ?? defaults);
  const [saving, setSaving] = useState(false);
  const [presets, setPresets] = useState<Record<string, SubtitleSettings>>(() => {
    try {
      return JSON.parse(localStorage.getItem("gw-subtitle-presets") ?? "{}") as Record<string, SubtitleSettings>;
    } catch {
      return {};
    }
  });
  const [presetName, setPresetName] = useState("");
  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const next = { ...presets, [name]: structuredClone(draft) };
    setPresets(next);
    localStorage.setItem("gw-subtitle-presets", JSON.stringify(next));
    setPresetName("");
  };
  useEffect(() => setDraft(structuredClone(project?.settings.subtitles ?? defaults)), [project?.id]);
  if (!project) return <EmptyState icon={<Captions size={34} />} title="Проект не выбран" text="Создайте или выберите проект для настройки субтитров." action="Понятно" onAction={() => undefined} />;
  const save = async () => {
    setSaving(true);
    try {
      await onSave(project.id, {
        settings: { ...project.settings, subtitles: draft },
      });
    } catch {
      /* Ошибка показана в общем уведомлении. */
    } finally {
      setSaving(false);
    }
  };
  const previewStyle: CSSProperties = {
    fontFamily: draft.fontFamily,
    fontSize: `${Math.max(20, draft.fontSize / 2)}px`,
    color: draft.textColor,
    WebkitTextStroke: `${draft.outlineWidth}px ${draft.outlineColor}`,
    bottom: `${draft.bottomMargin}%`,
    textShadow: draft.shadow ? "0 6px 12px #000" : "none",
  };
  return (
    <div className="subtitle-page page-with-actionbar">
      <PageHeading icon={<Captions size={24} />} title="Студия субтитров" subtitle="Настройка стиля с живым предпросмотром" />
      <div className="subtitle-studio">
        <section className="subtitle-controls">
          <ToggleRow label="Включить субтитры" checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />
          <Field label="ШРИФТ">
            <select value={draft.fontFamily} onChange={(event) => setDraft({ ...draft, fontFamily: event.target.value })}>
              <option>Montserrat ExtraBold</option>
              <option>Arial Black</option>
              <option>Impact</option>
              <option>Segoe UI</option>
            </select>
          </Field>
          <Field label={`РАЗМЕР: ${draft.fontSize}`}>
            <input type="range" min="24" max="110" value={draft.fontSize} onChange={(event) => setDraft({ ...draft, fontSize: Number(event.target.value) })} />
          </Field>
          <div className="color-grid">
            <Field label="ЦВЕТ ТЕКСТА">
              <input type="color" value={draft.textColor} onChange={(event) => setDraft({ ...draft, textColor: event.target.value })} />
            </Field>
            <Field label="КАРАОКЕ-АКЦЕНТ">
              <input type="color" value={draft.accentColor} onChange={(event) => setDraft({ ...draft, accentColor: event.target.value })} />
            </Field>
            <Field label="ОБВОДКА">
              <input type="color" value={draft.outlineColor} onChange={(event) => setDraft({ ...draft, outlineColor: event.target.value })} />
            </Field>
          </div>
          <Field label={`ТОЛЩИНА ОБВОДКИ: ${draft.outlineWidth}`}>
            <input type="range" min="0" max="10" value={draft.outlineWidth} onChange={(event) => setDraft({ ...draft, outlineWidth: Number(event.target.value) })} />
          </Field>
          <Field label={`ОТСТУП СНИЗУ: ${draft.bottomMargin}%`}>
            <input type="range" min="2" max="35" value={draft.bottomMargin} onChange={(event) => setDraft({ ...draft, bottomMargin: Number(event.target.value) })} />
          </Field>
          <ToggleRow label="Тень" checked={draft.shadow} onChange={(shadow) => setDraft({ ...draft, shadow })} />
          <ToggleRow label="POP WORDS" hint="Караоке-подсветка: произносимые слова окрашиваются в акцентный цвет." checked={draft.popWords} onChange={(popWords) => setDraft({ ...draft, popWords })} />
          <Field label="ПРЕСЕТЫ СТИЛЯ" hint="Сохраните подобранные настройки и загружайте их в других проектах одним кликом.">
            <div className="preset-row">
              <select
                value=""
                onChange={(event) => {
                  const preset = presets[event.target.value];
                  if (preset) {
                    setDraft(structuredClone(preset));
                  }
                }}
              >
                <option value="">Загрузить пресет…</option>
                {Object.keys(presets).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Название пресета" />
              <button className="outline-button small" disabled={!presetName.trim()} onClick={savePreset}>
                <Save size={14} />
                Сохранить
              </button>
            </div>
          </Field>
        </section>
        <section className="subtitle-preview-panel">
          <div className={`subtitle-video aspect-${project.aspectRatio.replace(":", "-")}`}>
            <div className="preview-orbit">
              <span />
              <span />
              <span />
            </div>
            <p style={previewStyle}>
              КОСМИЧЕСКИЙ <em style={{ color: draft.accentColor }}>КОТ</em>
            </p>
          </div>
          <small>Предпросмотр {project.aspectRatio}. Текст будет синхронизирован после генерации озвучки.</small>
        </section>
      </div>
      <div className="sticky-actions editor-actions">
        <span>Стиль хранится внутри проекта</span>
        <div>
          <button className="generate-button" disabled={saving} onClick={() => void save()}>
            <Save size={16} />
            {saving ? "Сохраняем..." : "Сохранить стиль"}
          </button>
        </div>
      </div>
    </div>
  );
}

type DirectorUiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

function directorUiMessage(role: DirectorUiMessage["role"], text: string, id = crypto.randomUUID()): DirectorUiMessage {
  return { id, role, text };
}


function sceneDurationLabel(scene: Scene): string {
  const timing = scene.documentary?.timing;
  const seconds = (timing ? timing.durationInFrames / 30 : scene.durationSeconds).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  return scene.documentary ? timing ? `${seconds} с${timing.sourceKey === "silent" ? "" : " · по озвучке"}` : `≈ ${seconds} с · оценка` : `${seconds} с`;
}

function formatEtaDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} сек`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function scenarioTimeRange(sceneCount: number): [number, number] {
  const batches = Math.max(1, Math.ceil(sceneCount / 15));
  return [60 + batches * 35, 120 + batches * 80];
}

function mediaTimeRange(sceneCount: number): [number, number] {
  // На этом компьютере один кадр в среднем занимает около минуты, озвучка — около 30 секунд.
  // Четыре воркера выполняют независимые задачи параллельно; финальная сборка добавляет ~1–2 минуты.
  const expected = (sceneCount * (60 + 30)) / 4 + 90;
  return [Math.max(120, expected * 0.8), Math.max(240, expected * 1.35)];
}

function ScenarioBuildProgress({ stage, elapsedSeconds, expectedScenes, stock = false, style }: { stage: string; elapsedSeconds: number; expectedScenes: number; stock?: boolean; style?: CSSProperties }) {
  const [counts, setCounts] = useState<{ done: number; total: number }>();
  useEffect(() => {
    const next = scenarioFrameProgress(stage);
    if (next) setCounts(next);
    else if (stage.startsWith("Персонажи:")) setCounts(undefined);
  }, [stage]);
  const percent = counts && counts.total > 0 ? Math.min(100, Math.round(counts.done / counts.total * 100)) : null;
  return (
    <div className="scenario-build-card" style={style} aria-live="polite">
      <div className="scenario-build-head">
        <WandSparkles size={17} />
        <div>
          <strong>{stock ? "Разбиваю текст и составляю поисковые запросы" : counts ? "Подготавливаю кадры и промпты" : "Подготавливаю сценарий"}</strong>
          <small>{stock ? "Видео, фото и озвучка начнут готовиться после запуска в настройках." : "Сначала кадры и промпты, затем образы персонажей. Полное производство запускается отдельно."}</small>
        </div>
        <em>{percent === null ? "…" : `${percent}%`}</em>
      </div>
      <div className="scenario-build-track" role="progressbar" aria-label={stock ? "Подготовка поисковых запросов" : "Готовность промптов кадров"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
        <span className={percent === null ? "indeterminate" : ""} style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
      <div className="scenario-build-meta">
        <span>{stage}</span>
        <small>Прошло {formatEtaDuration(elapsedSeconds)}{counts ? ` · готово ${counts.done} из ${counts.total} кадров` : expectedScenes > 0 ? ` · ожидается около ${expectedScenes} кадров` : ""}. Ответ модели может занять несколько минут.</small>
        {elapsedSeconds >= 45 && <small>Пока модель отвечает, счётчик не растёт. Переключение VPN во время запроса может оборвать соединение.</small>}
      </div>
    </div>
  );
}

function AiStoryPreparation({ project, busy, stage, startedAt, expectedScenes, error, onBuild, onSaveScript, onNavigate, onRetried }: {
  project: Project; busy: boolean; stage: string | null; startedAt: number | null; expectedScenes: number;
  error: string | null; onBuild: (mode?: 'cached-query-plans') => void; onNavigate: (stage: ProjectWorkflowStage) => void;
  onSaveScript: (text: string) => Promise<void>; onRetried: (project: Project) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [inputText, setInputText] = useState(project.videoBrief?.readyScript ?? "");
  const [savingText, setSavingText] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  useEffect(() => { setInputText(project.videoBrief?.readyScript ?? ""); setInputError(null); }, [project.id, project.videoBrief?.readyScript]);
  useEffect(() => {
    if (!startedAt) return;
    const update = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const stock = project.mediaMode === "stock";
  const api = window.goldWork ?? fallbackApi;
  const [issues, setIssues] = useState<DocumentaryQueryPlanIssue[]>();
  const [inspectionError, setInspectionError] = useState('');
  const inspectPlans = stock && project.settings.assembly.documentary?.version === 2 && project.scenes.length > 0;
  const [retrying, setRetrying] = useState(false);
  const retryLock = useRef(false);
  const [retryError, setRetryError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (busy) { setRetryError(''); return; }
    if (!inspectPlans) return;
    let current = true;
    setIssues(undefined);
    setInspectionError('');
    void api.getDocumentaryQueryPlanIssues(project.id).then(rows => {
      if (current) setIssues(rows);
    }).catch(reason => { if (current) setInspectionError(errorMessage(reason)); });
    return () => { current = false; };
  }, [api, inspectPlans, busy, project.id, project.updatedAt, revision]);
  const retryScene = async (issue: DocumentaryQueryPlanIssue) => {
    if (!issue.retryToken || retryLock.current || busy) return;
    retryLock.current = true;
    setRetrying(true);
    setRetryError('');
    try { onRetried(await api.retryDocumentaryQueryPlan(project.id, issue.sceneId, issue.retryToken)); }
    catch (reason) { setRetryError(errorMessage(reason)); }
    finally { retryLock.current = false; setRetrying(false); setRevision(value => value + 1); }
  };
  const ready = project.scenes.length > 0 && !scenarioReviewBlockReason(project) && (!stock || (!error && !issues?.length && (!inspectPlans || issues !== undefined)));
  const script = project.videoBrief?.creationMode === "script";
  const activeProduction = project.status === "generating" || project.status === "paused";
  const hasCachedPlan = issues?.some(issue => issue.cached);
  const canContinue = !issues?.length || hasCachedPlan || issues.some(issue => issue.canContinue);
  const saveText = async () => {
    if (!inputText.trim() || busy || activeProduction) return;
    if (project.scenes.length && !window.confirm("Заново подготовить сцены по этому тексту? Существующий план кадров будет заменён. Файлы материалов останутся на диске.")) return;
    setSavingText(true); setInputError(null);
    try { await onSaveScript(inputText); } catch (reason) { setInputError(errorMessage(reason)); } finally { setSavingText(false); }
  };
  return <div className="ai-story-preparation">
    <PageHeading icon={<FileText size={22} />} title={busy ? "Подготовка кадров" : ready ? "Сценарий подготовлен" : "Задание ролика"} subtitle={project.title} />
    <ProjectWorkflowBar project={project} current="brief" busy={busy} onNavigate={onNavigate} />
    <section className="ai-preparation-summary"><strong>Готовый сценарий — без переписывания</strong>
      <p>{stock ? "Текст разбивается на сцены без изменений. Для каждой сцены программа составляет запросы для поиска видео и фото. Точная длительность появится после озвучки." : "Вставленный текст распределяется по кадрам под скорость голоса. Программа создаёт визуальные промпты и образы персонажей, а не пишет сценарий."}</p>
      <span>{project.language} · ≈ {project.settings.durationMinutes.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} мин{project.settings.voice.calibration ? ` · ${project.settings.voice.calibration.charactersPerSecond.toFixed(1)} зн./с` : " · оценка до озвучки"}</span>
    </section>
    {busy ? <ScenarioBuildProgress key={startedAt} stage={stage ?? "Подготавливаю сохранённый текст…"} elapsedSeconds={elapsed} expectedScenes={stock ? project.scenes.length : expectedScenes} stock={stock} />
      : inspectPlans && inspectionError ? <section className="ai-preparation-recovery">
          <p role="alert">Не удалось проверить поисковые планы. {inspectionError}</p>
          <button type="button" className="outline-button" onClick={() => setRevision(value => value + 1)}>Проверить ещё раз</button>
        </section>
      : inspectPlans && !issues ? <p role="status">Проверяю сохранённые поисковые планы…</p>
      : ready ? <button className="generate-button" onClick={() => onNavigate(stock ? "settings" : "scenario")}>{stock ? "К настройкам ролика" : "Посмотреть сценарий"} <ArrowRight size={16} /></button>
      : script ? <section className="ai-preparation-recovery">
          {error && <p role="alert">{error}</p>}
          <p>{stock ? "Исходный текст и подготовленные поисковые запросы сохранены." : "Исходный текст и полученные промпты сохранены. Можно продолжить подготовку в этом ролике."}</p>
          {canContinue && <button className="generate-button" disabled={activeProduction || retrying} onClick={()=>onBuild(hasCachedPlan?'cached-query-plans':undefined)}><Play size={16} />{hasCachedPlan ? "Применить сохранённые запросы" : "Продолжить подготовку"}</button>}
        </section> : <p>Это старый проект. Его сцены сохранены. Для новой подготовки вставьте полный готовый текст ниже.</p>}
    {inspectPlans && !busy && !!issues?.length && <section className="ai-preparation-recovery">
      <strong>Сцены, для которых нужно завершить подготовку</strong>
      {issues.map(issue => <div key={issue.sceneId}>
        <p>Сцена №{issue.sceneNumber} — {issue.reason}</p>
        {issue.retryToken && <button type="button" className="outline-button" disabled={retrying || activeProduction}
          onClick={() => void retryScene(issue)}>Повторить только эту сцену</button>}
      </div>)}
    </section>}
    {retryError && <p role="alert">{retryError}</p>}
    <details className="ai-preparation-source" open={!script && !ready}><summary>{stock ? "Исходный текст" : "Готовый текст и визуальный стиль"}</summary>
      <label className="ready-script-input">
        <span>Готовый сценарий</span>
        <textarea rows={18} readOnly={busy || activeProduction || savingText} spellCheck={false}
          value={inputText} onChange={event => setInputText(event.target.value)} placeholder="Вставьте полный текст озвучки…" />
      </label>
      <p className="ready-script-hint">{busy || activeProduction
        ? "Подготовка или генерация выполняется. Весь текст доступен для чтения и копирования; редактирование — после завершения или остановки."
        : "Полный исходный текст, без сокращений. Изменения применяются только после сохранения и новой подготовки кадров."}</p>
      {(!script || inputText !== project.videoBrief?.readyScript) && <div className="ready-script-actions">
        {!script && project.scenes.length > 0 && <button className="outline-button" disabled={busy || activeProduction || savingText} onClick={() => setInputText([...project.scenes].sort((a,b) => a.order-b.order).map(scene => scene.narration).join(" "))}>Взять текст из сохранённых сцен</button>}
        <button className="generate-button" disabled={busy || activeProduction || savingText || !inputText.trim()} onClick={() => void saveText()}>{savingText ? "Сохраняю…" : "Сохранить текст и подготовить кадры"}</button>
      </div>}
      {inputError && <p role="alert">{inputError}</p>}
      {!stock && <details className="ready-script-style"><summary>Визуальный стиль</summary><p>{project.settings.image.style || "Стиль не указан."}</p></details>}
    </details>
  </div>;
}


function ProjectsPage({ projects, busy, onCreate, onOpen, onDuplicate, onDelete, onPreview, onTimeline, onGenerate, onAssemble, onRefreshMontage, onOpenFolder, onSave }: { projects: Project[]; busy: boolean; onCreate: () => void; onOpen: (id: string) => void; onDuplicate: (id: string) => void; onDelete: (id: string) => void; onPreview: (id: string) => void; onTimeline: (id: string) => void; onGenerate: (id: string) => void; onAssemble: (id: string) => void; onRefreshMontage: (id: string) => void; onOpenFolder: (id: string) => void; onSave: (id: string, input: UpdateProjectInput) => Promise<Project> }) {
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [sizesLoaded, setSizesLoaded] = useState(false);
  const [sizeError, setSizeError] = useState("");
  const ids = projects.map(project => project.id).join("|");
  useEffect(() => {
    let active = true;
    const api = window.goldWork ?? fallbackApi;
    void (async () => {
      try {
        const usage = await api.getWorkspaceUsage();
        if (!active) return;
        setSizes(Object.fromEntries(usage.projects.map(entry => [entry.name, entry.bytes])));
        setSizesLoaded(true);
        setSizeError("");
        if (storageUsageNeedsRefresh(usage)) {
          const refreshed = await api.getWorkspaceUsage("", true);
          if (active) {
            setSizes(Object.fromEntries(refreshed.projects.map(entry => [entry.name, entry.bytes])));
            setSizeError("");
          }
        }
      } catch (reason) {
        if (active) setSizeError(String(reason));
      }
    })();
    return () => { active = false; };
  }, [ids]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expanded = projects.find((project) => project.id === expandedId);
  const patchAssembly = (project: Project, patch: Partial<ProjectSettings["assembly"]>) =>
    void onSave(project.id, { settings: { ...project.settings, assembly: { ...project.settings.assembly, ...patch } } });
  return (
    <div>
      <PageHeading
        icon={<FolderOpen size={24} />}
        title="Мои ролики"
        subtitle="Выберите ролик, чтобы открыть настройки, предпросмотр или сборку"
        actions={
          <button className="generate-button" disabled={busy} onClick={onCreate}>
            <Plus size={16} />
            Новый ролик
          </button>
        }
      />
      {projects.length === 0 ? (
        <EmptyState icon={<FolderOpen size={34} />} title="Роликов пока нет" text="Созданные ролики появятся здесь." action="Создать ролик" onAction={onCreate} />
      ) : (
        <div className="projects-table">
          <div className="projects-table-head">
            <span>Название</span>
            <span title="Визуальных материалов готово">🖼</span>
            <span title="Озвучек готово">🔊</span>
            <span title="Final.mp4">🎬</span>
            <span>Статус</span>
            <span>Дата</span>
          </div>
          {projects.map((project) => (
            <div key={project.id}>
              <button className={`projects-table-row${project.id === expandedId ? " open" : ""}`} onClick={() => setExpandedId(project.id === expandedId ? null : project.id)}>
                <span className="cell-name">{project.title}<small className="project-storage-size" title={sizeError || "Уникальные файлы проекта; общие с другими проектами материалы могут учитываться в обоих"}>{sizes[project.id] === undefined ? sizeError ? "Размер недоступен" : sizesLoaded ? "Нет папки проекта" : "Считаю размер…" : storageSize(sizes[project.id]!)}</small></span>
                <span>{project.scenes.filter((scene) => project.mediaMode==='stock'&&project.settings.assembly.documentary?.version===2
                  ?materialReady(scene):scene.imagePath).length}/{project.scenes.length}</span>
                <span>{project.scenes.filter((scene) => scene.audioPath).length}/{project.scenes.length}</span>
                <span>{project.outputPath ? "✅" : "—"}</span>
                <span className={`status-${project.status}`}>{statusLabels[project.status]}</span>
                <span className="cell-date">{new Date(project.updatedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              </button>
              {project.id === expandedId && expanded && (
                <div className="project-expand">
                  <div className="expand-block">
                    <small>ГЕНЕРАЦИЯ</small>
                    <div className="expand-actions">
                      <button className="generate-button compact" disabled={busy || project.status === "generating"} onClick={() => onGenerate(project.id)}>
                        <Play size={14} />
                        {project.mediaMode==='stock'&&project.settings.assembly.documentary?.version===2
                          ?project.scenes.some(scene=>scene.includeInAssembly!==false&&!materialReady(scene))?"Продолжить подбор и сборку":"Собрать"
                          :project.scenes.some((scene) => !scene.imagePath) ? "Сгенерировать" : "Перегенерировать сцены"}
                      </button>
                      <button className="outline-button small" disabled={busy || project.status === "generating" || project.status === "paused" || !projectEditorReady(project)} onClick={() => onAssemble(project.id)}>
                        <RotateCcw size={14} />
                        Экспорт
                      </button>
                      {project.mediaMode==='stock'&&project.settings.assembly.documentary?.version===2&&<button className="outline-button small"
                        disabled={busy||project.status==='generating'||project.status==='paused'||!project.scenes.length||project.scenes.some(s=>s.includeInAssembly!==false&&!materialReady(s))}
                        title="Заново выбрать графику и шаблоны, включая старые назначения. Закреплённые сцены и помеченные ручные правки сохраняются. Материалы и озвучка не генерируются повторно."
                        onClick={()=>onRefreshMontage(project.id)}>Обновить автомонтаж</button>}
                    </div>
                  </div>
                  <div className="expand-block">
                    <small>СБОРКА</small>
                    <div className="expand-checks">
                      <label><input type="checkbox" checked={project.settings.assembly.kenBurns} onChange={(event) => patchAssembly(project, { kenBurns: event.target.checked })} /> Ken Burns</label>
                      <label><input type="checkbox" checked={project.settings.assembly.fadeTransitions && project.settings.assembly.transitionType !== "none"} onChange={(event) => patchAssembly(project, { fadeTransitions: event.target.checked, ...(event.target.checked && project.settings.assembly.transitionType === "none" ? { transitionType: "mix" as const } : {}) })} /> Плавные переходы</label>
                      <label>
                        Качество:
                        <select value={project.settings.assembly.quality} onChange={(event) => patchAssembly(project, { quality: event.target.value as ProjectSettings["assembly"]["quality"] })}>
                          <option value="preview">Черновик</option>
                          <option value="standard">Стандарт</option>
                          <option value="high">Высокое</option>
                        </select>
                      </label>
                      <span className="expand-music">
                        <Music2 size={13} />
                        {musicHasAudio(project.settings.music) ? "Музыка: есть" : "Музыка: нет"}
                      </span>
                    </div>
                  </div>
                  <div className="expand-block">
                    <small>ДЕЙСТВИЯ</small>
                    <div className="expand-actions">
                      <button className="outline-button small" onClick={() => onTimeline(project.id)}><Clock3 size={14} />Таймлайн</button>
                      <button className="outline-button small" onClick={() => onPreview(project.id)}><Eye size={14} />Предпросмотр</button>
                      <button className="outline-button small" onClick={() => onOpen(project.id)}><Settings size={14} />Настроить</button>
                      <button className="outline-button small" onClick={() => onOpenFolder(project.id)}><FolderOpen size={14} />Открыть папку</button>
                      <button className="outline-button small" onClick={() => onDuplicate(project.id)}><Copy size={14} />Копия</button>
                      <button className="outline-button small danger" onClick={() => onDelete(project.id)}><Trash2 size={14} />Удалить</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QueuePage({ tasks, projects, workflowProject, autoStockProgress, onApplied, onReviseArtwork, onNavigateStage, onPause, onResume, onStop, onRetry, onClear, onClearAll,onContinue }: { tasks: QueueTask[]; projects: Project[]; workflowProject?: Project; autoStockProgress: AutoStockProgress | null; onApplied:(project:Project)=>void; onReviseArtwork:(id:string,feedback:string)=>Promise<void>; onNavigateStage: OpenProjectWorkflowStage; onPause: (id: string) => void; onResume: (id: string) => void; onStop: (id: string) => Promise<void>; onRetry: (id: string) => void; onClear: () => void; onClearAll: () => void;onContinue:(id:string)=>Promise<void> }) {
  const [stockTab, setStockTab] = useState<"speech" | "materials" | "assemble">("speech");
  const [reviewSceneId,setReviewSceneId]=useState<string>();
  const reviewScene=workflowProject?.scenes.find(scene=>scene.id===reviewSceneId);
  const [stopping,setStopping]=useState<string[]>([]);
  const stock = workflowProject?.mediaMode === "stock" && workflowProject.settings.assembly.documentary?.version === 2;
  const materialProgress = autoStockProgress?.projectId === workflowProject?.id ? autoStockProgress : null;
  const visibleTasks = stock ? tasks.filter(task => task.projectId === workflowProject.id && task.kind === stockTab) : tasks;
  const counts = {
    pending: visibleTasks.filter((task) => task.status === "pending" || task.status === "retry_wait").length,
    running: visibleTasks.filter((task) => task.status === "running").length,
    done: visibleTasks.filter((task) => task.status === "done").length,
    failed: visibleTasks.filter((task) => task.status === "failed" || task.status === "blocked").length,
    stopped: visibleTasks.filter((task) => task.status === "cancelled").length,
  };
  const selectingProject = autoStockProgress && !["complete", "failed", "stopped"].includes(autoStockProgress.phase) ? autoStockProgress.projectId : undefined;
  const activeProjectIds = [...new Set([...tasks.filter((task) => !["done", "cancelled", "failed", "blocked"].includes(task.status)).map((task) => task.projectId), ...(selectingProject ? [selectingProject] : []),
    ...projects.filter(project => project.stockProduction?.status === 'running').map(project => project.id)])];
  const icons: Record<QueueTask["kind"], ReactNode> = {
    director: <WandSparkles size={18} />,
    image: <Image size={18} />,
    video: <Video size={18} />,
    speech: <Volume2 size={18} />,
    assemble: <Clapperboard size={18} />,
  };
  const projectTasks = workflowProject ? tasks.filter((task) => task.projectId === workflowProject.id) : [];
  const latestRunId = projectTasks
    .map((task) => task.runId)
    .filter((runId, index, all) => all.indexOf(runId) === index)
    .sort((left, right) => {
      const leftTime = Math.max(...projectTasks.filter((task) => task.runId === left).map((task) => Date.parse(task.createdAt) || 0));
      const rightTime = Math.max(...projectTasks.filter((task) => task.runId === right).map((task) => Date.parse(task.createdAt) || 0));
      return rightTime - leftTime;
    })[0];
  const productionTasks = latestRunId ? projectTasks.filter((task) => task.runId === latestRunId) : [];
  const productionProgress = productionTasks.length > 0
    ? Math.round(productionTasks.reduce((sum, task) => sum + (task.status === "done" ? 100 : task.progress), 0) / productionTasks.length)
    : 0;
  const currentProductionTask = productionTasks.find((task) => task.status === "running")
    ?? productionTasks.find((task) => task.status === "retry_wait")
    ?? productionTasks.find((task) => task.status === "pending" || task.status === "paused");
  const productionGroups = workflowProject ? ([
    {
      kind: "speech" as const,
      label: "Озвучка",
      service: workflowProject.settings.voice.provider === "elevenlabs" ? "Lumean" : "AnyModel TTS",
    },
    {
      kind: "image" as const,
      label: "Изображения",
      service: workflowProject.settings.image.provider === "flow" ? "Google Flow · изолированный пул" : "AnyModel / Flow fallback",
    },
    {
      kind: "video" as const,
      label: "Оживление Veo",
      service: workflowProject.settings.video.provider === "flow" ? "Google Flow · Veo" : workflowProject.settings.video.provider === "veo" ? "Google AI Studio · Veo" : "AnyModel Video",
    },
    {
      kind: "assemble" as const,
      label: projectTasks.some(task => task.kind === "assemble" && task.prepareOnly) ? "Подготовка редактора" : "Экспорт Final.mp4",
      service: projectTasks.some(task => task.kind === "assemble" && task.prepareOnly) ? "Тайминг и монтаж" : workflowProject.mediaMode === "ai" ? "FFmpeg · AI Story" : workflowProject.settings.assembly.montage?.enabled === false ? "FFmpeg" : "Remotion + FFmpeg",
    },
  ]).map((group) => {
    const items = productionTasks.filter((task) => task.kind === group.kind);
    const done = items.filter((task) => task.status === "done").length;
    const failed = items.filter((task) => task.status === "failed" || task.status === "blocked" || task.status === "cancelled").length;
    const running = items.some((task) => task.status === "running");
    const progress = items.length > 0
      ? Math.round(items.reduce((sum, task) => sum + (task.status === "done" ? 100 : task.progress), 0) / items.length)
      : 0;
    return { ...group, items, done, failed, running, progress };
  }) : [];
  return (
    <div>
      <PageHeading
        icon={<ListPlus size={24} />}
        title={workflowProject ? "Производство" : "Очередь"}
        subtitle={workflowProject ? `${workflowProject.title} · живой прогресс по этапам` : "Локальный конвейер, прогресс и повторные попытки"}
        actions={<>
          <button className="ghost-button" disabled={tasks.every((task) => !["done", "failed", "cancelled", "blocked"].includes(task.status))} onClick={onClear}>
            <Trash2 size={15} />
            Очистить завершённые
          </button>
          <button
            className="ghost-button danger"
            disabled={tasks.length === 0}
            title="Убрать все задачи из очереди. Проекты и файлы останутся."
            onClick={() => {
              if (window.confirm("Убрать все задачи из очереди? Проекты, медиафайлы и Final.mp4 останутся. Уже отправленный запрос провайдеру может завершить текущий файл в фоне.")) onClearAll();
            }}
          >
            <Trash2 size={14} />
            Очистить всю очередь
          </button>
        </>}
      />
      {workflowProject && <ProjectWorkflowBar project={workflowProject} current="production" hasQueueTasks={tasks.some((task) => task.projectId === workflowProject.id)} onNavigate={(stage) => onNavigateStage(workflowProject.id, stage)} />}
      {workflowProject && stock && <StockProductionOverview project={workflowProject} tasks={projectTasks} progress={materialProgress} onReviseArtwork={feedback=>onReviseArtwork(workflowProject.id,feedback)} />}
      {workflowProject&&stock&&!projectTasks.some(t=>['running','pending','retry_wait'].includes(t.status))&&( ['failed','paused'].includes(workflowProject.status)||['interrupted','stopped','failed'].includes(workflowProject.stockProduction?.status??''))&&<DocumentaryRecovery key={workflowProject.id} api={window.goldWork??fallbackApi} projectId={workflowProject.id} onContinue={()=>onContinue(workflowProject.id)}/>}
      {workflowProject && !stock && (
        <section className={`production-overview status-${workflowProject.status}`}>
          <header>
            <div>
              <span className="production-overview-icon"><Clapperboard size={20} /></span>
              <div>
                <small>СЕЙЧАС</small>
                <strong>{currentProductionTask?.stage || currentProductionTask?.label || (workflowProject.status === "complete" ? "Ролик готов" : workflowProject.status === "failed" ? "Нужно исправить ошибку" : "Проверяю проект и создаю очередь")}</strong>
              </div>
            </div>
            <em>{productionProgress}%</em>
          </header>
          <div className="production-main-progress"><i style={{ width: `${productionProgress}%` }} /></div>
          <div className="production-stage-grid">
            {productionGroups.map((group) => (
              <article key={group.kind} className={`${group.running ? "running" : ""}${group.failed > 0 ? " failed" : ""}`}>
                <span>{icons[group.kind]}</span>
                <div>
                  <strong>{group.label}</strong>
                  <small>{group.service}</small>
                  <div className="production-stage-progress"><i style={{ width: `${group.progress}%` }} /></div>
                </div>
                <em>{group.items.length === 0 ? "—" : `${group.done}/${group.items.length}`}</em>
                {group.failed > 0 && <p>{group.failed} задач требуют внимания</p>}
              </article>
            ))}
          </div>
          {productionTasks.length === 0 && <p className="production-preflight-note">Окно уже открыто. Приложение проверяет сценарий и подготавливает задачи.</p>}
        </section>
      )}
      {activeProjectIds.length > 0 && (
        <div className="queue-project-controls">
          {activeProjectIds.map((id) => {
            const project = projects.find((item) => item.id === id);
            const paused = project?.status === "paused";
            const runIds = new Set(tasks.filter((task) => task.projectId === id && !["done", "cancelled", "failed", "blocked"].includes(task.status)).map((task) => task.runId));
            const projectTasks = tasks.filter((task) => task.projectId === id && runIds.has(task.runId));
            return (
              <div key={id}>
                <span>
                  <Clapperboard size={15} />
                  <span className="queue-project-name">{project?.title ?? id}<small>{generationTimeLabel(projectTasks)}</small></span>
                </span>
                {selectingProject !== id && projectTasks.length > 0 && <button onClick={() => (paused ? onResume(id) : onPause(id))}>
                  {paused ? <Play size={14} /> : <Pause size={14} />}
                  {paused ? "Продолжить" : "Пауза"}
                </button>}
                <button className="danger" disabled={stopping.includes(id)} onClick={() => {setStopping(items=>[...items,id]);void onStop(id).finally(()=>setStopping(items=>items.filter(item=>item!==id)));}}>
                  <Square size={13} />
                  {stopping.includes(id)?'Останавливаю и сохраняю…':'Стоп'}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <section className="queue-board">
        {stock && <div className="stock-production-tabs" role="tablist" aria-label="Этапы производства Stock">
          {([ ["speech", "Озвучка"], ["materials", "Видео и фото"], ["assemble", "Сборка"] ] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={stockTab === id} className={stockTab === id ? "active" : ""} onClick={() => setStockTab(id)}>{label}</button>)}
        </div>}
        {stock && stockTab === "materials" && <StockMaterialQueue project={workflowProject} progress={materialProgress} onReview={setReviewSceneId} />}
        {workflowProject&&reviewScene&&<StockMediaModal project={workflowProject} scene={reviewScene} onClose={()=>setReviewSceneId(undefined)} onApplied={async updated=>{onApplied(updated);setReviewSceneId(undefined);}} />}
        {(!stock || stockTab !== "materials") && <>
        <div className="queue-summary">
          <Stat label="Ожидают" value={String(counts.pending)} />
          <Stat label="В работе" value={String(counts.running)} />
          <Stat label="Завершено" value={String(counts.done)} />
          <Stat label="Ошибки" value={String(counts.failed)} />
          {counts.stopped > 0 && <Stat label="Остановлено" value={String(counts.stopped)} />}
        </div>
        {visibleTasks.length === 0 ? (
          stock ? <p className="production-preflight-note">{stockTab === "assemble" ? "Сборка начнётся автоматически, когда озвучка и подходящие материалы будут готовы." : "Готовая озвучка сохраняется в сценах. Новые задачи появятся при запуске производства."}</p> : <EmptyState icon={<ListPlus size={34} />} title="Очередь пуста" text="Откройте проект и нажмите «Генерировать видео»." action="Готово" onAction={() => undefined} />
        ) : (
          <div className="queue-cards">
            {visibleTasks.map((task) => (
              <article key={task.id} className={`queue-task status-${task.status}`}>
                <div className="queue-card-head">
                  <span>{icons[task.kind]}</span>
                  <div>
                    <strong>{task.label}</strong>
                    <small>{projects.find((project) => project.id === task.projectId)?.title ?? task.projectId}</small>
                  </div>
                  <em>{task.progress}%</em>
                </div>
                <div className="progress">
                  <span style={{ width: `${task.progress}%` }} />
                </div>
                <footer>
                  <span className="queue-status">
                    {queueTaskStatusText(task)} · попытка {task.attempts}/{task.maxAttempts}
                  </span>
                  {task.stage && <span className="queue-stage">{task.stage}</span>}
                  {task.error && task.status !== "pending" && <span className="queue-error">{task.error}</span>}
                  {task.status === "failed" && !task.retryBlockedReason && (
                    <button className="retry-button" onClick={() => onRetry(task.id)}>
                      <RotateCcw size={13} />
                      Повторить
                    </button>
                  )}
                  {task.status === "failed" && task.retryBlockedReason && (
                    <span className="queue-error">Повтор отключён: {task.retryBlockedReason}</span>
                  )}
                </footer>
              </article>
            ))}
          </div>
        )}
        </>}
      </section>
    </div>
  );
}

type TimelineScene = Scene & {
  durationOverrideSeconds?: number;
  playbackRate?: number;
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  narrationVolume?: number;
  sourceVolume?: number;
  transitionDurationSeconds?: number;
  fadeEdges?: boolean;
  kenBurnsZoom?: number;
};

type TimelineRegenerateTarget = "image" | "video" | "audio" | "all";

type TimelineClipLayout = {
  scene: TimelineScene;
  index: number;
  start: number;
  end: number;
  duration: number;
  overlapToNext: number;
  transition: "none" | "fade" | "mix";
};

const clampTimelineNumber = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const timelinePositionStyle = (entry: TimelineClipLayout, totalDuration: number, minimumWidth = true): CSSProperties => {
  const safeTotal = Math.max(0.1, totalDuration);
  const width = `${(entry.duration / safeTotal) * 100}%`;
  return {
    left: `${(entry.start / safeTotal) * 100}%`,
    width: minimumWidth ? `max(8px, ${width})` : width
  };
};
const timelineTimeStyle = (seconds: number, totalDuration: number): CSSProperties => ({
  left: `${(seconds / Math.max(0.1, totalDuration)) * 100}%`
});

function timelineTransition(project: Project, scene: TimelineScene): "none" | "fade" | "mix" {
  return resolveProjectSceneTransition(project, scene);
}

function buildTimelineLayout(project: Project, scenes: TimelineScene[], durationOf: (scene: TimelineScene) => number): TimelineClipLayout[] {
  if (project.mediaMode === "stock" && project.settings.assembly.documentary?.version === 2) {
    // Use the export clock: transition tails and excluded shots must not shift SFX handles.
    const timeline = buildDocumentaryTimeline({ ...project, scenes });
    const byId = new Map(scenes.map(scene => [scene.id, scene]));
    return timeline.scenes.map((item, index) => ({ scene: byId.get(item.id)!, index, start: item.fromFrame / timeline.fps,
      end: (item.fromFrame + item.durationInFrames) / timeline.fps, duration: item.durationInFrames / timeline.fps,
      overlapToNext: item.transitionFrames / timeline.fps, transition: item.transition ?? "none" }));
  }
  const durations = scenes.map(durationOf);
  const transitions = scenes.map((scene) => timelineTransition(project, scene));
  const measuredAiTimeline = project.mediaMode === "ai" || project.settings.assembly.documentary?.version === 2;
  const usesCrossfadeGraph = transitions.slice(0, -1).some((transition) => transition === "mix" || (measuredAiTimeline && transition === "fade"));
  let cursor = 0;
  return scenes.map((scene, index) => {
    const duration = durations[index] ?? 0.1;
    const nextDuration = durations[index + 1];
    const transition = transitions[index] ?? "none";
    const requested = clampTimelineNumber(resolveProjectSceneTransitionDuration(project, scene), 0, 5);
    const overlapToNext = nextDuration === undefined || !usesCrossfadeGraph
      ? 0
      : transition === "mix"
        ? clampTimelineNumber(requested, 0.02, Math.max(0.02, Math.min(duration - 0.1, nextDuration - 0.1)))
        : transition === "fade"
          ? clampTimelineNumber(requested, 0.02, Math.max(0.02, Math.min(duration - 0.1, nextDuration - 0.1)))
          : 0.02;
    // FFmpeg добавляет исходящему визуалу технический хвост для xfade, а речь
    // склеивает без сокращения. В AI preview используем тот же контракт.
    const visualDuration = measuredAiTimeline ? duration + overlapToNext : duration;
    const entry = { scene, index, start: cursor, end: cursor + visualDuration, duration: visualDuration, overlapToNext, transition };
    cursor += measuredAiTimeline ? duration : duration - overlapToNext;
    return entry;
  });
}

function remotionPreviewText(scene: Scene, beat: VisualBeat): TimelineText | undefined {
  const parts = (scene.narration.match(/[^.!?…]+[.!?…]*/g) ?? [scene.narration])
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const title = (scene.title || parts[0] || "").slice(0, 100);
  const first = (parts[0] || title).slice(0, 180);
  const quote = /[«“"]([^»”"]{4,120})[»”"]/.exec(scene.narration)?.[1];
  const fact = scene.narration.match(/(?:[$€₽£]\s*)?\b\d[\d\s.,:/-]{0,18}(?:%|\s*(?:лет|года?|дней|час(?:а|ов)?|минут(?:ы)?|seconds?|minutes?|years?))?/iu)?.[0]?.trim();
  if (beat.template === "chapter-card") {
    return { eyebrow: scene.order === 0 ? "Главная тема" : `Глава ${scene.order + 1}`, headline: title, body: first };
  }
  if (beat.template === "quote-card") {
    return { eyebrow: title, headline: (quote ?? first).slice(0, 140), body: quote ? parts[1]?.slice(0, 180) : undefined };
  }
  if (beat.template === "checklist-grid") {
    return { eyebrow: title, headline: fact ?? title, items: parts.slice(0, 4).map((label, index) => ({ label: label.slice(0, 64), value: String(index + 1) })) };
  }
  if (beat.template === "timeline-links") {
    return { eyebrow: title, headline: fact ?? title, items: parts.slice(0, 5).map((label, index) => ({ label: label.slice(0, 64), value: String(index + 1) })) };
  }
  if (beat.template === "compare-split") {
    return { headline: fact ?? title, leftLabel: (parts[0] ?? title).slice(0, 48), rightLabel: (parts[1] ?? parts[0] ?? title).slice(0, 48) };
  }
  if (beat.template === "stat-callout") return { eyebrow: title, headline: fact ?? title, body: first };
  if (beat.template === "editorial-panel") return { eyebrow: fact, headline: title, body: first };
  if (beat.template === "focus-text") return { eyebrow: title, headline: (quote ?? fact ?? first).slice(0, 140), body: parts[1]?.slice(0, 180) };
  if (beat.template === "fact-card") return { eyebrow: title, headline: (fact ?? first).slice(0, 140), body: fact ? first : parts[1]?.slice(0, 180) };
  if (beat.template === "evidence-card") return { headline: title, body: first };
  if (beat.overlay === "none") return undefined;
  return { headline: beat.overlay === "quote" ? (quote ?? first) : beat.overlay === "fact" ? (fact ?? first) : title, body: beat.overlay === "title" ? first : undefined };
}

function buildRemotionPreviewTimeline(project: Project, layout: TimelineClipLayout[], mediaUrl: (path: string) => string): UniversalTimeline | DocumentaryTimeline | null {
  if (project.mediaMode === "stock" && project.settings.assembly.documentary?.version === 2) {
    return buildDocumentaryTimeline({ ...project, scenes: layout.map(entry => entry.scene) }, mediaUrl);
  }
  if (project.mediaMode === "ai" || project.settings.assembly.montage?.enabled === false || !layout.some((entry) => (entry.scene.visualBeats?.length ?? 0) > 0)) return null;
  const fps = 30 as const;
  const width = project.aspectRatio === "9:16" ? 720 : project.aspectRatio === "1:1" ? 900 : 1280;
  const height = project.aspectRatio === "9:16" ? 1280 : project.aspectRatio === "1:1" ? 900 : 720;
  const palette = selectProjectDocumentaryPalette(project.id, project.title);
  const beats: UniversalVisualBeat[] = [];
  for (const entry of layout) {
    const planned = [...(entry.scene.visualBeats ?? [])].sort((left, right) => left.order - right.order);
    if (planned.length === 0) continue;
    const plannedSeconds = planned.reduce((sum, beat) => sum + Math.max(0.01, beat.durationSeconds), 0);
    let cursor = 0;
    for (let index = 0; index < planned.length; index += 1) {
      const beat = planned[index]!;
      const startShare = cursor / plannedSeconds;
      cursor += Math.max(0.01, beat.durationSeconds);
      const endShare = cursor / plannedSeconds;
      const fromFrame = Math.round((entry.start + entry.duration * startShare) * fps);
      const endFrame = Math.round((entry.start + entry.duration * endShare) * fps);
      const primaryPath = entry.scene.videoPath && ((project.settings.video.enabled && !entry.scene.videoFallback) || entry.scene.stockSource?.mediaType === "video")
        ? entry.scene.videoPath
        : entry.scene.imagePath;
      const availableMedia: TimelineMedia[] = [];
      if (primaryPath) {
        availableMedia.push({
          id: `${entry.scene.id}-primary`,
          src: mediaUrl(primaryPath),
          kind: primaryPath === entry.scene.videoPath ? "video" : "image",
          muted: true,
          startFromFrame: primaryPath === entry.scene.videoPath
            ? Math.max(0, Math.round(((entry.scene.trimStartSeconds ?? 0) + entry.duration * startShare * (entry.scene.playbackRate ?? 1)) * fps))
            : undefined,
          endAtFrame: primaryPath === entry.scene.videoPath && entry.scene.trimEndSeconds !== undefined
            ? Math.max(1, Math.round(entry.scene.trimEndSeconds * fps))
            : undefined,
          playbackRate: primaryPath === entry.scene.videoPath ? entry.scene.playbackRate ?? 1 : undefined
        });
      }
      for (const [alternateIndex, alternate] of (entry.scene.stockAlternates ?? []).entries()) {
        const alternatePath = alternate.videoPath ?? alternate.imagePath;
        if (!alternatePath) continue;
        availableMedia.push({
          id: `${entry.scene.id}-alternate-${alternateIndex + 1}`,
          src: mediaUrl(alternatePath),
          kind: alternate.videoPath ? "video" : "image",
          muted: true,
          startFromFrame: alternate.videoPath ? Math.max(0, Math.round(entry.duration * startShare * fps)) : undefined,
          endAtFrame: alternate.videoPath ? Math.max(1, Math.round(entry.duration * endShare * fps)) : undefined,
          attribution: alternate.stockSource.attribution
        });
      }
      const selectedIndex = index % Math.max(1, availableMedia.length);
      const selectedMedia = availableMedia[selectedIndex];
      const media: TimelineMedia[] = selectedMedia ? [{ ...selectedMedia, id: `${selectedMedia.id}-beat-${index + 1}` }] : [];
      if (selectedMedia && (beat.template === "compare-split" || beat.template === "quick-montage")) {
        media.push(...availableMedia
          .filter((candidate) => candidate !== selectedMedia)
          .slice(0, beat.template === "quick-montage" ? 2 : 1)
          .map((candidate) => ({ ...candidate, id: `${candidate.id}-beat-${index + 1}` })));
      }
      beats.push({
        id: beat.id,
        sceneId: beat.sceneId,
        fromFrame,
        durationInFrames: Math.max(1, endFrame - fromFrame),
        template: beat.template,
        media,
        text: remotionPreviewText(entry.scene, beat),
        motion: {
          kind: beat.motion === "push-in" ? "zoom-in" : beat.motion === "pull-out" ? "zoom-out" : beat.motion === "pan-left" || beat.motion === "pan-right" ? beat.motion : "static",
          strength: beat.role === "emphasize" ? 0.7 : 0.48,
        },
        transition: beat.transition === "mix"
          ? { kind: "crossfade", durationSeconds: 0.16 }
          : beat.transition === "fade" ? { kind: "dip-black", durationSeconds: 0.17 } : { kind: "cut", durationSeconds: 0 },
        dim: beat.dimming === "strong" ? 0.58 : beat.dimming === "soft" ? 0.28 : 0,
        accentColor: palette.accentColor,
      });
    }
  }
  if (beats.length === 0) return null;
  return normalizeUniversalTimeline({
    version: 1,
    fps,
    width,
    height,
    durationInFrames: Math.max(1, Math.round((layout.at(-1)?.end ?? 0.1) * fps)),
    beats,
    backgroundColor: palette.backgroundColor,
    foregroundColor: palette.foregroundColor,
    accentColor: palette.accentColor,
    surfaceColor: palette.surfaceColor,
    surfaceForegroundColor: palette.surfaceForegroundColor,
    mutedColor: palette.mutedColor,
    fontFamily: "system",
  });
}

function UnifiedPreviewVideo(timeline: UniversalTimeline | DocumentaryTimeline) {
  return timeline.version === 2 ? <DocumentaryVideo {...timeline} /> : <UniversalVideo {...timeline} />;
}
type PreviewControls = { seek: (seconds: number) => void };
const RemotionLivePreview = forwardRef<PreviewControls, { timeline: UniversalTimeline | DocumentaryTimeline; currentTime: number; playing: boolean; onFrame: (seconds: number) => void; onEnded: () => void; onError: (message: string) => void }>(function RemotionLivePreview({ timeline, currentTime, playing, onFrame, onEnded, onError }, ref) {
  const playerRef = useRef<PlayerRef>(null);
  const initialTime = useRef(currentTime);
  const events = useRef({ onFrame, onEnded, onError, playing });
  events.current = { onFrame, onEnded, onError, playing };
  useImperativeHandle(ref, () => ({ seek(seconds) {
    const player = playerRef.current;
    if (!player) return;
    player.pause();
    player.seekTo(Math.max(0, Math.min(timeline.durationInFrames - 1, Math.round(seconds * timeline.fps))));
  } }), [timeline.durationInFrames, timeline.fps]);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const frame = (event: { detail: { frame: number } }) => {
      // Paused seek acknowledgements are not new cursor commands.
      if (events.current.playing) events.current.onFrame(event.detail.frame / timeline.fps);
    };
    const ended = () => events.current.onEnded();
    const failed = (event: { detail: { error: Error } }) => events.current.onError(event.detail.error.message);
    player.addEventListener("frameupdate", frame);
    player.addEventListener("ended", ended);
    player.addEventListener("error", failed);
    player.seekTo(Math.max(0, Math.min(timeline.durationInFrames - 1, Math.round(initialTime.current * timeline.fps))));
    return () => { player.removeEventListener("frameupdate", frame); player.removeEventListener("ended", ended); player.removeEventListener("error", failed); };
  }, [timeline.fps]);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    // Playback observations never feed back into seek/play commands, including buffering.
    if (playing) player.play(); else player.pause();
  }, [playing]);
  // Electron can mount native audio per clip; the shared autoplay pool's
  // default five slots can overflow during narration/music/SFX swaps or seeks.
  return (
    <Player
      ref={playerRef}
      component={UnifiedPreviewVideo}
      inputProps={timeline}
      numberOfSharedAudioTags={0}
      durationInFrames={timeline.durationInFrames}
      fps={timeline.fps}
      compositionWidth={timeline.width}
      compositionHeight={timeline.height}
      controls={false}
      clickToPlay={false}
      errorFallback={({ error }) => <div className="timeline-media-error"><strong>Ошибка предпросмотра</strong><span>{error.message}</span></div>}
      style={{ width: "100%", height: "100%" }}
    />
  );
});

function TimelineEditor({ project, hasQueueTasks, onClose, onShowScenes, onOpenFolder, onAssemble, onSave, onRegenerate, onNavigateStage }: { project: Project; hasQueueTasks: boolean; onClose: () => void; onShowScenes: () => void; onOpenFolder: () => void; onAssemble: () => Promise<void>; onSave: (id: string, input: UpdateProjectInput) => Promise<Project>; onRegenerate: (sceneId: string | string[], target?: TimelineRegenerateTarget) => Promise<void>; onNavigateStage: (stage: ProjectWorkflowStage) => void }) {
  const api = window.goldWork ?? fallbackApi;
  const initialScenes = () => [...project.scenes].sort((a, b) => a.order - b.order) as TimelineScene[];
  const [scenes, setScenes] = useState<TimelineScene[]>(initialScenes);
  const isDocumentary = project.mediaMode === "stock" && project.settings.assembly.documentary?.version === 2;
  const [music,setMusic]=useState(project.settings.music);
  const [musicOpen,setMusicOpen]=useState(false);
  const [musicImporting,setMusicImporting]=useState(false);
  const [selectedMusicId,setSelectedMusicId]=useState<string>();
  const [undoStack, setUndoStack] = useState<Array<{scenes:TimelineScene[];music:ProjectSettings['music'];materialSceneIds?:string[]}>>([]);
  const [redoStack, setRedoStack] = useState<Array<{scenes:TimelineScene[];music:ProjectSettings['music'];materialSceneIds?:string[]}>>([]);
  const materialHistorySceneIds=useRef(new Set<string>());
  const [selectedCutId, setSelectedCutId] = useState<string>();
  const [transitionPair,setTransitionPair]=useState<{left:string;right:string}>();
  const [selectedTextId, setSelectedTextId] = useState<string>();
  const [materialPicker,setMaterialPicker]=useState<{project:Project;sceneId:string;cutId?:string}>();
  const [preparingAudio, setPreparingAudio] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(project.scenes[0] ? [project.scenes[0].id] : []);
  const [propertiesOpen, setPropertiesOpen] = useState(Boolean(project.scenes[0]));
  const [menu, setMenu] = useState<{ x: number; y: number; sceneId: string } | null>(null);
  const [zoom, setZoom] = useState(26);
  const [dirty, setDirty] = useState(false);
  useEffect(()=>{if(!dirty&&!musicImporting)setMusic(project.settings.music);},[project.settings.music,musicImporting]);
  const [saving, setSaving] = useState(false);
  const [mediaMode, setMediaMode] = useState<"live" | "final">("live");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const previewControls = useRef<PreviewControls>(null);
  const requestPreviewTime = useCallback((seconds: number) => {
    previewControls.current?.seek(seconds);
    setCurrentTime(seconds);
  }, []);
  const lastPlayerUpdateRef = useRef(0);
  const [finalMediaDuration, setFinalMediaDuration] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const lastScrubUpdateRef = useRef(0);
  const [assetDurations, setAssetDurations] = useState<Record<string, number>>({});
  const [copiedSettings, setCopiedSettings] = useState<Partial<TimelineScene> | null>(null);
  const [timelineViewport, setTimelineViewport] = useState({ left: 0, width: 1600 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const livePreviewRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const timelineCanvasRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const playbackFrameRef = useRef<number | null>(null);
  const livePlaybackRef = useRef<{ startedAt: number; timelineTime: number } | null>(null);
  const scrubFrameRef = useRef<number | null>(null);
  const pendingScrubRef = useRef<number | null>(null);
  const scrubPointerRef = useRef<number | null>(null);
  const zoomFrameRef = useRef<number | null>(null);
  const pendingZoomRef = useRef<number | null>(null);
  const zoomAnchorRef = useRef<{seconds:number;x:number}|null>(null);
  const zoomRef = useRef(zoom);
  const viewportFrameRef = useRef<number | null>(null);
  const pendingViewportRef = useRef<{ left: number; width: number } | null>(null);
  const anchorIdRef = useRef<string | null>(project.scenes[0]?.id ?? null);
  const dragIdRef = useRef<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const playbackLayoutRef = useRef<TimelineClipLayout[] | null>(null);
  const previousProjectScenesRef = useRef(project.scenes);
  const paintPreviewRef = useRef<(time: number) => void>(() => undefined);
  const busy = saving || musicImporting || project.status === "generating" || project.status === "paused";
  const documentaryAudioKey = isDocumentary ? JSON.stringify(project.scenes.map(scene => [scene.id, scene.audioPath, scene.narrationSlice, scene.durationOverrideSeconds])) : "";
  useEffect(() => {
    if (!isDocumentary || project.status === "generating" || project.status === "paused" || !project.scenes.length || project.settings.voice.enabled && project.scenes.some(scene => scene.includeInAssembly !== false && !scene.audioPath)) return;
    let cancelled = false;
    setPreparingAudio(true);
    void api.prepareDocumentaryPreview(project.id).then(updated => {
      if (cancelled) return;
      setScenes(current => current.map(scene => {
        const prepared = updated.scenes.find(item => item.id === scene.id);
        const source = project.scenes.find(item => item.id === scene.id);
        return scene.documentary && prepared && prepared.audioPath === scene.audioPath ? { ...scene, imagePath: source?.imagePath === scene.imagePath ? prepared.imagePath : scene.imagePath, documentary: { ...scene.documentary, timing: prepared.documentary?.timing } } : scene;
      }));
    }).catch(error => { if (!cancelled) setMediaError(String(error)); }).finally(() => { if (!cancelled) setPreparingAudio(false); });
    return () => { cancelled = true; };
  }, [documentaryAudioKey, project.status, project.settings.assembly.audioNormalize, project.settings.voice.enabled]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selected = useMemo(() => scenes.filter((scene) => selectedIdSet.has(scene.id)), [scenes, selectedIdSet]);
  const primary = selected[0];
  const measuredLayout = useMemo(() => buildTimelineLayout(project, scenes, (scene) => {
    if (scene.documentary?.version === 2) {
      return Math.max((scene.documentary.timing?.durationInFrames ?? Math.ceil(scene.durationSeconds * 30)) / 30, scene.durationOverrideSeconds ?? 0);
    }
    if (project.settings.voice.enabled && scene.audioPath && scene.narrationSlice) {
      const speechDuration = scene.narrationSlice.endSeconds - scene.narrationSlice.startSeconds;
      return Math.max(scene.durationOverrideSeconds ?? 0, speechDuration + (scene.narrationSlice.last ? 0.2 : 0));
    }
    if (scene.durationOverrideSeconds) return Math.max(0.1, scene.durationOverrideSeconds);
    const videoActive = Boolean(scene.videoPath && ((project.settings.video.enabled && !scene.videoFallback) || scene.stockSource?.mediaType === "video"));
    const sourcePath = videoActive ? scene.videoPath : project.settings.voice.enabled ? scene.audioPath : undefined;
    const sourceDuration = sourcePath ? assetDurations[sourcePath] ?? 0 : 0;
    const playbackRate = clampTimelineNumber(scene.playbackRate ?? 1, 0.25, 4);
    const trimStart = Math.max(0, scene.trimStartSeconds ?? 0);
    const trimEnd = scene.trimEndSeconds && scene.trimEndSeconds > trimStart
      ? sourceDuration > 0 ? Math.min(sourceDuration, scene.trimEndSeconds) : scene.trimEndSeconds
      : sourceDuration > 0 ? sourceDuration : undefined;
    const timingChanged = trimStart > 0 || playbackRate !== 1 || scene.trimEndSeconds !== undefined;
    if (timingChanged) return Math.max(0.1, ((trimEnd ?? scene.durationSeconds) - trimStart) / playbackRate);
    if (!videoActive && sourceDuration > 0.2) return sourceDuration;
    return Math.max(0.1, scene.durationSeconds);
  }), [project, scenes, assetDurations]);
  // A pass of playback is immutable: background TTS cannot move the currently playing scene.
  const layout = playing && mediaMode === "live" && playbackLayoutRef.current ? playbackLayoutRef.current : measuredLayout;
  const previousLayoutRef = useRef(layout);
  useEffect(() => {
    if (!playing && mediaMode === "live" && previousLayoutRef.current !== layout) {
      const previous = previousLayoutRef.current;
      const remapped = remapPreviewTime(previous, layout, currentTime);
      if (Math.abs(remapped - currentTime) > 1e-6) requestPreviewTime(remapped);
    }
    previousLayoutRef.current = layout;
  }, [layout, playing, mediaMode, currentTime, requestPreviewTime]);
  const remotionPreviewTimeline = useMemo(
    () => buildRemotionPreviewTimeline({ ...project, settings:{...project.settings,music}, scenes }, layout, (path) => api.mediaUrl(path)),
    [api, layout, project, scenes, music],
  );
  const timelineDuration = layout.at(-1)?.end ?? 0;
  const totalDuration = timelineDuration;
  const musicClips=useMemo(()=>music.clips??resolveMusicClips(music,totalDuration),[music,totalDuration]);
  const changeMusic=(next:ProjectSettings['music'])=>{
    if(busy)return;setUndoStack(current=>[...current.slice(-39),{scenes,music}]);setRedoStack([]);
    setMusic(next);setPlaying(false);setMediaMode('live');setDirty(true);
  };
  const selectMusic=(id?:string)=>{setSelectedMusicId(id);setMusicOpen(true);setPropertiesOpen(true);setPlaying(false);};
  const changeMusicClip=(id:string,clip:MusicClip|null)=>changeMusic(editMusicClips(music,musicClips.flatMap(item=>item.id===id?clip?[clip]:[]:[item])));
  const timelineWidth = Math.max(900, timelineDuration * zoom);
  const timelineScale = timelineWidth / Math.max(0.1, timelineDuration);
  const layoutBySceneId = useMemo(() => new Map(layout.map((entry) => [entry.scene.id, entry])), [layout]);
  const finalVideoSource = mediaMode === "final" ? project.outputPath : undefined;
  const finalVideoRevision = mediaMode === "final" ? project.lastRender?.completedAt : undefined;
  const visibleLayouts = useMemo(() => {
    const activeLayouts = layout.filter((entry) => currentTime >= entry.start && (currentTime < entry.end || (entry.index === layout.length - 1 && currentTime <= entry.end)));
    const fallbackLayout = layout.find((entry) => currentTime < entry.start) ?? layout.at(-1);
    return activeLayouts.length > 0 ? activeLayouts.slice(-2) : fallbackLayout ? [fallbackLayout] : [];
  }, [currentTime, layout]);
  const mountedPreviewLayouts = useMemo(() => {
    const next = layout[(visibleLayouts.at(-1)?.index ?? -1) + 1];
    return next ? [...visibleLayouts, next] : visibleLayouts;
  }, [visibleLayouts, layout]);
  const previewFrames = useMemo(() => preparePreviewFrames(project, layout), [project.settings, layout]);
  const pendingMediaPlayRef = useRef(new WeakSet<HTMLMediaElement>());
  paintPreviewRef.current = (time) => {
    if (remotionPreviewTimeline) return;
    const container = livePreviewRef.current;
    if (!container) return;
    const frame = previewFrames(time);
    const active = new Map(frame.layers.map(layer => [layer.entry.scene.id, layer]));
    container.querySelectorAll<HTMLElement>("[data-preview-layer]").forEach(element => {
      const layer = active.get(element.dataset.sceneId ?? "");
      element.style.opacity = String(layer?.opacity ?? 0);
      element.style.visibility = layer ? "visible" : "hidden";
      if (layer) element.style.transform = layer.transform;
      element.querySelectorAll<HTMLMediaElement>("[data-timeline-media]").forEach(media => {
        if (!layer) { if (!media.paused) media.pause(); return; }
        const { scene } = layer.entry;
        const local = Math.max(0, time - layer.entry.start);
        const rate = media.tagName === "AUDIO" ? 1 : clampTimelineNumber(scene.playbackRate ?? 1, 0.25, 4);
        const speechEnd = scene.narrationSlice ? scene.narrationSlice.endSeconds - scene.narrationSlice.startSeconds : layer.entry.duration - layer.entry.overlapToNext;
        const desired = media.tagName === "AUDIO"
          ? Math.min((scene.narrationSlice?.startSeconds ?? 0) + local, scene.narrationSlice?.endSeconds ?? Infinity)
          : (scene.trimStartSeconds ?? 0) + local * rate;
        const volume = media.tagName === "AUDIO" ? local < speechEnd ? (scene.narrationVolume ?? 100) / 100 : 0
          : project.settings.video.muteSource ? 0 : (scene.sourceVolume ?? project.settings.video.sourceVolume) / 100 * layer.opacity;
        if (media.playbackRate !== rate) media.playbackRate = rate;
        media.volume = clampTimelineNumber(volume, 0, 1);
        if (media.readyState >= 1 && Math.abs(media.currentTime - desired) > (playing ? 0.3 : 0.025)) {
          try { media.currentTime = Math.max(0, desired); } catch { /* Media is still loading. */ }
        }
        if (playing && media.paused && !media.ended && !pendingMediaPlayRef.current.has(media)) {
          pendingMediaPlayRef.current.add(media);
          void media.play().catch(() => undefined).finally(() => pendingMediaPlayRef.current.delete(media));
        } else if (!playing && !media.paused) media.pause();
      });
    });
    const fade = container.querySelector<HTMLElement>(".timeline-live-fade");
    if (fade) fade.style.opacity = String(frame.fade);
  };
  useLayoutEffect(() => { paintPreviewRef.current(currentTime); }, [currentTime, playing, layout, mountedPreviewLayouts]);
  const visibleTimelineLayouts = useMemo(() => {
    const overscan = Math.max(800, timelineViewport.width);
    const visibleStart = Math.max(0, (timelineViewport.left - overscan) / timelineScale);
    const visibleEnd = (timelineViewport.left + timelineViewport.width + overscan) / timelineScale;
    return layout.filter((entry) => entry.end >= visibleStart && entry.start <= visibleEnd);
  }, [layout, timelineViewport, timelineScale]);
  const visibleTimelineTicks = useMemo(() => {
    const overscan = Math.max(400, timelineViewport.width / 2);
    const first = Math.max(0, Math.floor(((timelineViewport.left - overscan) / timelineScale) / 5));
    const last = Math.min(Math.floor(timelineDuration / 5), Math.ceil(((timelineViewport.left + timelineViewport.width + overscan) / timelineScale) / 5));
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => (first + index) * 5);
  }, [timelineDuration, timelineViewport, timelineScale]);
  const assetDurationKey = useMemo(() => scenes.map((scene) => `${scene.audioPath ?? ""}|${scene.videoPath ?? ""}`).join(";"), [scenes]);

  useEffect(() => {
    const incoming = initialScenes();
    const previous = previousProjectScenesRef.current;
    previousProjectScenesRef.current = project.scenes;
    setScenes(current => dirty ? mergeScenarioDraft(current, previous, incoming,[...materialHistorySceneIds.current]) as TimelineScene[] : incoming);
    setSelectedIds((current) => {
      const valid = current.filter((id) => incoming.some((scene) => scene.id === id));
      return valid.length > 0 ? valid : incoming[0] ? [incoming[0].id] : [];
    });
  }, [project.id, project.scenes]);

  useEffect(() => {
    // Stock already has measured speech timing and probed source metadata from main.
    // Opening up to six extra decoders after every download only competes with Player.
    if (isDocumentary) return;
    const paths = new Map<string, "audio" | "video">();
    scenes.forEach((scene) => {
      if (scene.audioPath) paths.set(scene.audioPath, "audio");
      if (scene.videoPath) paths.set(scene.videoPath, "video");
    });
    const jobs = [...paths].filter(([path]) => !assetDurations[path]);
    const activeMedia = new Map<HTMLMediaElement, () => void>();
    let cancelled = false;
    let cursor = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let discovered: Record<string, number> = {};

    const flushDurations = () => {
      flushTimer = null;
      const batch = discovered;
      discovered = {};
      if (cancelled || Object.keys(batch).length === 0) return;
      setAssetDurations((current) => ({ ...current, ...batch }));
    };
    const scheduleFlush = () => {
      if (flushTimer === null) flushTimer = setTimeout(flushDurations, 80);
    };
    const loadDuration = (path: string, kind: "audio" | "video") => new Promise<void>((resolve) => {
      if (cancelled) return resolve();
      const media = document.createElement(kind);
      media.preload = "metadata";
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        media.onloadedmetadata = null;
        media.onerror = null;
        activeMedia.delete(media);
        media.removeAttribute("src");
        resolve();
      };
      activeMedia.set(media, finish);
      media.onloadedmetadata = () => {
        if (!cancelled && Number.isFinite(media.duration) && media.duration > 0) {
          discovered[path] = media.duration;
          scheduleFlush();
        }
        finish();
      };
      media.onerror = finish;
      media.src = api.mediaUrl(path);
      media.load();
    });
    const worker = async () => {
      while (!cancelled) {
        const job = jobs[cursor++];
        if (!job) return;
        await loadDuration(job[0], job[1]);
      }
    };
    void Promise.all(Array.from({ length: Math.min(6, jobs.length) }, worker)).then(flushDurations);

    return () => {
      cancelled = true;
      if (flushTimer !== null) clearTimeout(flushTimer);
      activeMedia.forEach((finish) => finish());
      activeMedia.clear();
    };
  }, [assetDurationKey, isDocumentary]);

  useEffect(() => {
    setMediaError(null);
    setPlaying(false);
    if (mediaMode === "final") setFinalMediaDuration(0);
    const video = videoRef.current;
    if (video) video.load();
  }, [finalVideoSource, finalVideoRevision, project.id]);

  useEffect(() => {
    if (!playing || (mediaMode === "live" && remotionPreviewTimeline)) return;
    let lastStateUpdate = 0;
    const updatePlayhead = () => {
      let logicalTime = currentTime;
      if (mediaMode === "final") {
        const video = videoRef.current;
        if (video) logicalTime = Math.min(totalDuration, video.currentTime);
      } else {
        const clock = livePlaybackRef.current ?? { startedAt: performance.now(), timelineTime: currentTime };
        livePlaybackRef.current = clock;
        logicalTime = Math.min(totalDuration, clock.timelineTime + (performance.now() - clock.startedAt) / 1000);
        if (logicalTime >= totalDuration) {
          setPlaying(false);
          livePlaybackRef.current = null;
        }
      }
      if (scrubPointerRef.current === null && playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${logicalTime * timelineScale}px)`;
      }
      const now = performance.now();
      if (mediaMode === "live") paintPreviewRef.current(logicalTime);
      if (now - lastStateUpdate > 80 || logicalTime >= totalDuration) {
        lastStateUpdate = now;
        setCurrentTime(logicalTime);
      }
      playbackFrameRef.current = requestAnimationFrame(updatePlayhead);
    };
    playbackFrameRef.current = requestAnimationFrame(updatePlayhead);
    return () => {
      if (playbackFrameRef.current !== null) cancelAnimationFrame(playbackFrameRef.current);
      playbackFrameRef.current = null;
    };
  }, [playing, mediaMode, totalDuration, timelineScale, Boolean(remotionPreviewTimeline)]);

  useEffect(() => {
    const container = livePreviewRef.current;
    if (!container) return;
    const media = container.querySelectorAll<HTMLMediaElement>(remotionPreviewTimeline ? "[data-timeline-media]" : "[data-timeline-loop]");
    media.forEach((element) => {
      const requestedTime = Number(element.dataset.timelineTime ?? 0);
      const playbackRate = clampTimelineNumber(Number(element.dataset.timelineRate ?? 1), 0.25, 4);
      const volume = clampTimelineNumber(Number(element.dataset.timelineVolume ?? 1), 0, 1);
      element.playbackRate = playbackRate;
      element.volume = volume;
      const desiredTime = element.dataset.timelineLoop === "true" && Number.isFinite(element.duration) && element.duration > 0
        ? requestedTime % element.duration
        : requestedTime;
      if (Number.isFinite(desiredTime) && Math.abs(element.currentTime - desiredTime) > (playing ? 0.22 : 0.03)) {
        try { element.currentTime = Math.max(0, desiredTime); } catch { /* Метаданные ещё загружаются. */ }
      }
      if (playing && mediaMode === "live") {
        if (element.paused) void element.play().catch(() => undefined);
      } else if (!element.paused) {
        element.pause();
      }
    });
  }, [currentTime, playing, mediaMode, visibleLayouts, scenes, project.settings.music]);

  const queueTimelineZoom = (nextZoom: number) => {
    const bounded = clampTimelineNumber(nextZoom, 8, 160);
    pendingZoomRef.current = bounded;
    zoomRef.current = bounded;
    if (zoomFrameRef.current !== null) return;
    zoomFrameRef.current = requestAnimationFrame(() => {
      zoomFrameRef.current = null;
      if (pendingZoomRef.current !== null) setZoom(pendingZoomRef.current);
    });
  };
  useLayoutEffect(()=>{
    const anchor=zoomAnchorRef.current, scroll=timelineScrollRef.current;
    if(anchor&&scroll){scroll.scrollLeft=Math.max(0,anchor.seconds*timelineScale-anchor.x);zoomAnchorRef.current=null;queueTimelineViewport(scroll);}
  },[zoom]);
  const queueTimelineViewport = (element: HTMLDivElement) => {
    pendingViewportRef.current = { left: element.scrollLeft, width: element.clientWidth };
    if (viewportFrameRef.current !== null) return;
    viewportFrameRef.current = requestAnimationFrame(() => {
      viewportFrameRef.current = null;
      const next = pendingViewportRef.current;
      if (!next) return;
      setTimelineViewport((current) =>
        Math.abs(current.left - next.left) < 1 && Math.abs(current.width - next.width) < 1 ? current : next
      );
    });
  };

  useEffect(() => {
    const scroll = timelineScrollRef.current;
    if (!scroll) return;
    const onWheel = (event: WheelEvent) => {
      if (event.altKey) {
        event.preventDefault();
        scroll.scrollLeft += event.deltaY !== 0 ? event.deltaY : event.deltaX;
        return;
      }
      if (!event.ctrlKey) return;
      event.preventDefault();
      const rect = scroll.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const currentZoom = zoomRef.current;
      const currentScale = Math.max(900, timelineDuration * currentZoom) / Math.max(0.1, timelineDuration);
      const timeAtCursor = (scroll.scrollLeft + cursorX) / currentScale;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nextZoom = clampTimelineNumber(currentZoom * factor, 8, 160);
      if(nextZoom===currentZoom)return;
      zoomAnchorRef.current={seconds:zoomAnchorRef.current?.seconds??timeAtCursor,x:cursorX};
      queueTimelineZoom(nextZoom);
    };
    scroll.addEventListener("wheel", onWheel, { passive: false });
    return () => scroll.removeEventListener("wheel", onWheel);
  }, [timelineDuration]);

  useEffect(() => {
    const scroll = timelineScrollRef.current;
    if (!scroll) return;
    queueTimelineViewport(scroll);
    const observer = new ResizeObserver(() => queueTimelineViewport(scroll));
    observer.observe(scroll);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    zoomRef.current = zoom;
    const canvas = timelineCanvasRef.current;
    if (canvas) {
      canvas.style.width = `${timelineWidth}px`;
    }
    if (scrubPointerRef.current === null && playheadRef.current) {
      playheadRef.current.style.transform = `translateX(${Math.min(timelineWidth, currentTime * timelineScale)}px)`;
    }
  }, [currentTime, timelineWidth, zoom, timelineScale]);

  useEffect(() => () => {
    if (scrubFrameRef.current !== null) cancelAnimationFrame(scrubFrameRef.current);
    if (playbackFrameRef.current !== null) cancelAnimationFrame(playbackFrameRef.current);
    if (zoomFrameRef.current !== null) cancelAnimationFrame(zoomFrameRef.current);
    if (viewportFrameRef.current !== null) cancelAnimationFrame(viewportFrameRef.current);
    scrubFrameRef.current = null;
    playbackFrameRef.current = null;
    zoomFrameRef.current = null;
    viewportFrameRef.current = null;
    pendingScrubRef.current = null;
    pendingZoomRef.current = null;
    pendingViewportRef.current = null;
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedIds(scenes.map((scene) => scene.id));
        setPropertiesOpen(true);
      }
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scenes]);

  const reindex = (items: TimelineScene[]) => items.map((scene, order) => ({ ...scene, order }));
  const chooseScene = (sceneId: string, event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => {
    setMusicOpen(false);
    const index = scenes.findIndex((scene) => scene.id === sceneId);
    if (event?.shiftKey && anchorIdRef.current) {
      const anchor = scenes.findIndex((scene) => scene.id === anchorIdRef.current);
      if (anchor >= 0 && index >= 0) {
        const [start, end] = anchor < index ? [anchor, index] : [index, anchor];
        setSelectedIds(scenes.slice(start, end + 1).map((scene) => scene.id));
      }
    } else if (event?.ctrlKey || event?.metaKey) {
      setSelectedIds((current) => current.includes(sceneId) ? current.filter((id) => id !== sceneId) : [...current, sceneId]);
      anchorIdRef.current = sceneId;
    } else {
      setSelectedIds([sceneId]);
      anchorIdRef.current = sceneId;
    }
    setPropertiesOpen(true);
    videoRef.current?.pause();
    pendingSeekRef.current = null;
    livePlaybackRef.current = null;
    setMediaMode("live");
    setPlaying(false);
    requestPreviewTime(layoutBySceneId.get(sceneId)?.start ?? 0);
  };
  const patchSelected = (patch: Partial<TimelineScene>) => {
    if (busy) return;
    if (isDocumentary) { setUndoStack(current => [...current.slice(-39), {scenes,music}]); setRedoStack([]); }
    setScenes((current) => current.map((scene) => selectedIds.includes(scene.id) ? { ...scene, ...patch } : scene));
    setDirty(true);
  };
  const persist = async (next = scenes) => {
    const normalized = reindex(next);
    setScenes(normalized);
    setSaving(true);
    try {
      await onSave(project.id, { scenes: normalized, ...(isDocumentary?{settings:{...project.settings,...stockMusicEditorPatch(project.settings,music)}}:{}) });
      setDirty(false);
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  };
  const mutateAndPersist = async (updater: (current: TimelineScene[]) => TimelineScene[]) => {
    if (busy) return false;
    const previous = scenes;
    if (isDocumentary) { setUndoStack(current => [...current.slice(-39), {scenes,music}]); setRedoStack([]); }
    const next = reindex(updater(scenes));
    setScenes(next);
    const saved = await persist(next);
    if (!saved) setScenes(previous);
    return saved;
  };
  const toggleSelected = () => {
    if (busy || selectedIds.length === 0) return;
    const include = selected.some((scene) => scene.includeInAssembly === false);
    void mutateAndPersist((current) => current.map((scene) => selectedIds.includes(scene.id) ? { ...scene, includeInAssembly: include } : scene));
  };
  const deleteSelected = () => {
    if (selectedIds.length === 0 || busy) return;
    const next = reindex(scenes.filter((scene) => !selectedIds.includes(scene.id)));
    setSelectedIds(next[0] ? [next[0].id] : []);
    void mutateAndPersist(() => next).then((saved) => { if (!saved) setSelectedIds(selectedIds); });
  };
  const duplicatePrimary = (source = primary) => {
    if (!source || busy) return;
    const copy: TimelineScene = {
      ...structuredClone(source),
      id: `scene_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: `${source.title} — копия`
    };
    if (copy.documentary) {
      copy.documentary.cuts = copy.documentary.cuts?.map(cut => ({ ...cut, id: crypto.randomUUID() }));
      copy.documentary.texts = copy.documentary.texts?.map(text => ({ ...text, id: crypto.randomUUID() }));
      copy.documentary.effects = copy.documentary.effects.map(effect => ({ ...effect, id: crypto.randomUUID() }));
    }
    const index = scenes.findIndex((scene) => scene.id === source.id);
    const next = [...scenes];
    next.splice(index + 1, 0, copy);
    setSelectedIds([copy.id]);
    void mutateAndPersist(() => next).then((saved) => { if (!saved) setSelectedIds([source.id]); });
  };
  const copySceneSettings = (source = primary) => {
    if (!source) return;
    setCopiedSettings({
      includeInAssembly: source.includeInAssembly,
      transition: source.transition,
      kenBurnsDirection: source.kenBurnsDirection,
      durationOverrideSeconds: source.durationOverrideSeconds,
      playbackRate: source.playbackRate,
      trimStartSeconds: source.trimStartSeconds,
      trimEndSeconds: source.trimEndSeconds,
      narrationVolume: source.narrationVolume,
      sourceVolume: source.sourceVolume,
      transitionDurationSeconds: source.transitionDurationSeconds,
      fadeEdges: source.fadeEdges,
      kenBurnsZoom: source.kenBurnsZoom
    });
  };
  const dropAt = (targetId: string, after: boolean) => {
    const draggedId = dragIdRef.current;
    dragIdRef.current = null;
    setDraggedId(null);
    setDropTarget(null);
    if (!draggedId || draggedId === targetId || busy) return;
    const moving = scenes.find((scene) => scene.id === draggedId);
    if (!moving) return;
    const rest = scenes.filter((scene) => scene.id !== draggedId);
    const target = rest.findIndex((scene) => scene.id === targetId);
    rest.splice(Math.max(0, target + (after ? 1 : 0)), 0, moving);
    void mutateAndPersist(() => rest);
  };
  const regenerateSelected = async (target: TimelineRegenerateTarget, ids = selected.map((scene) => scene.id)) => {
    if (busy || ids.length === 0) return;
    if (isDocumentary && (target === "image" || target === "video")) { await leaveTimeline(() => onNavigateStage("materials")); return; }
    if (dirty && !await persist()) return;
    await onRegenerate(ids, isDocumentary && target === "all" ? "audio" : target);
  };
  const applyVideoSeek = (logicalSeconds: number) => {
    const video = videoRef.current;
    if (!video || video.dataset.mode !== "final" || video.readyState < 1) return;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : finalMediaDuration;
    video.currentTime = Math.max(0, Math.min(duration || logicalSeconds, logicalSeconds));
    pendingSeekRef.current = null;
  };
  const seekTimeline = (seconds: number) => {
    const logicalTime = Math.max(0, Math.min(totalDuration, seconds));
    videoRef.current?.pause();
    livePlaybackRef.current = null;
    setPlaying(false);
    requestPreviewTime(logicalTime);
    if (mediaMode === "final") {
      pendingSeekRef.current = logicalTime;
      requestAnimationFrame(() => applyVideoSeek(logicalTime));
    }
  };
  const applyScrub = (canvasSeconds: number) => {
    const logicalTime = Math.max(0, Math.min(timelineDuration, canvasSeconds));
    setMediaMode("live");
    requestPreviewTime(logicalTime);
    pendingSeekRef.current = null;
  };
  const queueScrub = (canvasSeconds: number) => {
    const bounded = Math.max(0, Math.min(timelineDuration, canvasSeconds));
    pendingScrubRef.current = bounded;
    if (playheadRef.current) playheadRef.current.style.transform = `translateX(${bounded * timelineScale}px)`;
    if (scrubFrameRef.current !== null) return;
    scrubFrameRef.current = requestAnimationFrame(now => {
      scrubFrameRef.current = null;
      if (pendingScrubRef.current !== null && now - lastScrubUpdateRef.current >= 60) {
        lastScrubUpdateRef.current = now;
        applyScrub(pendingScrubRef.current);
      }
    });
  };
  const scrubTimeFromPointer = (event: ReactPointerEvent<HTMLDivElement>) =>
    (event.clientX - event.currentTarget.getBoundingClientRect().left) / Math.max(1, event.currentTarget.getBoundingClientRect().width) * timelineDuration;
  const beginScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubPointerRef.current = event.pointerId;
    lastScrubUpdateRef.current = 0;
    videoRef.current?.pause();
    setPlaying(false);
    queueScrub(scrubTimeFromPointer(event));
  };
  const moveScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubPointerRef.current !== event.pointerId) return;
    queueScrub(scrubTimeFromPointer(event));
  };
  const endScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubPointerRef.current !== event.pointerId) return;
    if (scrubFrameRef.current !== null) cancelAnimationFrame(scrubFrameRef.current);
    scrubFrameRef.current = null;
    applyScrub(scrubTimeFromPointer(event));
    scrubPointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const patchScene = (sceneId: string, patch: Partial<TimelineScene>) => {
    if (busy) return;
    if (isDocumentary) { setUndoStack(current => [...current.slice(-39), {scenes,music}]); setRedoStack([]); }
    setScenes((current) => current.map((scene) => scene.id === sceneId ? { ...scene, ...patch } : scene));
    setDirty(true);
  };
  const changeCuts = (sceneId: string, cuts: DocumentaryVisualCut[]) => {
    const scene = scenes.find(item => item.id === sceneId);
    if (!scene?.documentary) return;
    patchScene(sceneId, { documentary: { ...scene.documentary, cuts } });
    setPlaying(false); setMediaMode("live");
  };
  const changeText = (sceneId: string, id: string, text: DocumentaryTextClip | null) => {
    const scene = scenes.find(item => item.id === sceneId);
    if (!scene?.documentary) return;
    patchScene(sceneId, { documentary: { ...scene.documentary, texts: (scene.documentary.texts ?? []).flatMap(item => item.id === id ? text ? [text] : [] : [item]) } });
    setPlaying(false); setMediaMode("live");
  };
  const splitAtPlayhead = () => {
    if (busy) return;
    if(musicOpen){
      const clip=musicClips.find(item=>item.id===selectedMusicId);
      const parts=clip&&splitMusicClip(clip,currentTime,crypto.randomUUID());
      if(parts){changeMusic(editMusicClips(music,musicClips.flatMap(item=>item.id===clip!.id?parts:[item])));setSelectedMusicId(parts[1].id);}
      return;
    }
    const entry = layout.find(item => currentTime >= item.start && currentTime < item.start + item.duration);
    if (!entry?.scene.documentary) return;
    const id = crypto.randomUUID(), cuts = splitVisualCut(entry.scene, (currentTime - entry.start) * 30, id, scenes);
    if (!cuts) return;
    changeCuts(entry.scene.id, cuts); setSelectedIds([entry.scene.id]); setSelectedCutId(id); setSelectedTextId(undefined); setPropertiesOpen(true);
  };
  const addText = () => {
    if (busy) return;
    setMusicOpen(false);
    const at = Math.min(Math.round(currentTime*30)/30, totalDuration-1/30);
    const entry = layout.find(item => at >= item.start && at < item.start + item.duration);
    if (!entry?.scene.documentary) return;
    const text: DocumentaryTextClip = { id: crypto.randomUUID(), text: "Заголовок", enabled: true,
      startSeconds: at-entry.start, durationSeconds: Math.min(3,totalDuration-at), x:50,y:50,fontSize:96,
      color:"#ffffff",backgroundColor:"#101318",backgroundOpacity:0,opacity:100,animation:"slide",fadeInSeconds:.4,fadeOutSeconds:.3 };
    patchScene(entry.scene.id, {documentary:{...entry.scene.documentary,texts:[...entry.scene.documentary.texts??[],text]}});
    setSelectedIds([entry.scene.id]);setSelectedTextId(text.id);setSelectedCutId(undefined);setPropertiesOpen(true);setPlaying(false);setMediaMode("live");
  };
  const undoEdit = () => {
    const previous = undoStack.at(-1); if (busy || !previous) return;
    setRedoStack(current => [...current, {scenes,music,materialSceneIds:previous.materialSceneIds}]); setUndoStack(current => current.slice(0,-1));
    setScenes(restoreDocumentaryEdit(previous.scenes, scenes,previous.materialSceneIds) as TimelineScene[]);setMusic(previous.music); setPlaying(false); setDirty(true);
  };
  const redoEdit = () => {
    const next = redoStack.at(-1); if (busy || !next) return;
    setUndoStack(current => [...current.slice(-39), {scenes,music,materialSceneIds:next.materialSceneIds}]);setRedoStack(current=>current.slice(0,-1));
    setScenes(restoreDocumentaryEdit(next.scenes,scenes,next.materialSceneIds) as TimelineScene[]);setMusic(next.music);setPlaying(false);setDirty(true);
  };
  const transitionLimit = (entry: TimelineClipLayout) => {
    const next = layout[entry.index + 1];
    return next ? Math.max(0, Math.min(5, entry.duration - 0.1, next.duration - 0.1)) : 0;
  };
  const setTransitionDuration = (sceneId: string, value: number) => {
    const entry = layoutBySceneId.get(sceneId);
    if (!entry) return;
    const duration = clampTimelineNumber(value, 0, transitionLimit(entry));
    const inheritedTransition = resolveProjectSceneTransition(project, entry.scene);
    patchScene(sceneId, duration <= 0.01
      ? { transition: "none", transitionDurationSeconds: 0 }
      : { transition: entry.scene.transition === "none" ? (inheritedTransition === "none" ? "mix" : inheritedTransition) : entry.scene.transition ?? (inheritedTransition === "none" ? "mix" : inheritedTransition), transitionDurationSeconds: Math.round(duration * 100) / 100 });
  };
  const reportMediaError = (message: string, code?: number) => {
    setMediaError(message);
    setPlaying(false);
    void api.writeLog("error", "timeline.player.error", {
      projectId: project.id,
      mode: mediaMode,
      code,
      message,
      file: finalVideoSource?.split(/[\\/]/).at(-1)
    });
  };
  const togglePlayback = async () => {
    if (preparingAudio) return;
    if (playing) {
      videoRef.current?.pause();
      livePlaybackRef.current = null;
      setPlaying(false);
      return;
    }
    if (mediaMode === "live") {
      playbackLayoutRef.current = measuredLayout;
      const timelineTime = currentTime >= totalDuration ? 0 : currentTime;
      if (timelineTime !== currentTime) requestPreviewTime(timelineTime);
      livePlaybackRef.current = { startedAt: performance.now(), timelineTime };
      setMediaError(null);
      setPlaying(true);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setMediaError(null);
    } catch (reason) {
      reportMediaError(reason instanceof Error ? reason.message : "Не удалось запустить видео");
    }
  };
  const handleLoadedMetadata = (video: HTMLVideoElement) => {
    setMediaError(null);
    if (mediaMode === "final") setFinalMediaDuration(Number.isFinite(video.duration) ? video.duration : 0);
    if (pendingSeekRef.current !== null) applyVideoSeek(pendingSeekRef.current);
  };
  const handleVideoTime = (video: HTMLVideoElement) => {
    if (scrubPointerRef.current !== null) return;
    setCurrentTime(Math.max(0, Math.min(totalDuration, video.currentTime)));
  };
  const reloadVideo = () => {
    setMediaError(null);
    const video = videoRef.current;
    if (!video) return;
    video.load();
  };
  const rebuild = async () => {
    if (dirty && !await persist()) return;
    await onAssemble();
  };
  const leaveTimeline = async (action: () => void) => {
    if (dirty && !await persist()) return;
    action();
  };
  const montageMenuScene = menu ? scenes.find((scene) => scene.id === menu.sceneId) : undefined;
  const liveForeground = visibleLayouts.at(-1);
  const sceneUsesVideo = (scene: TimelineScene) => Boolean(
    scene.videoPath && ((project.settings.video.enabled && !scene.videoFallback) || scene.stockSource?.mediaType === "video")
  );
  const soundClips = useMemo(() => documentaryEffectClips(layout, true), [layout]);
  const visualClips = useMemo(() => documentaryEffectClips(layout, false), [layout]);
  const textClips = useMemo(() => textTrackClips(layout), [layout]);
  const effectBoundaries = useMemo(() => [...layout.map(entry => entry.start), totalDuration], [layout, totalDuration]);
  const trackSizes = useTimelineTrackSizes();
  const musicHeight=isDocumentary?musicTrackLayout(musicClips).height:38;
  const trackRows = `28px ${trackSizes.row("video",76)} ${trackSizes.row("voice",38)} ${isDocumentary
    ? `${trackSizes.row("templates",38)} ${trackSizes.row("text",textClips.height)} ${trackSizes.row("sound",soundClips.height)} ${trackSizes.row("effects",visualClips.height)} ` : ""}${trackSizes.row("music",musicHeight)} 22px`;
  const trackLabel = (track: Parameters<typeof trackSizes.row>[0], label: string, icon: ReactNode, fallback = 38) =>
    <TimelineTrackLabel track={track} label={label} height={trackSizes.heights[track]} fallback={fallback} onChange={trackSizes.save}
      onResizeStart={()=>{videoRef.current?.pause();setPlaying(false);}}>{icon}</TimelineTrackLabel>;
  const changeEffect = (sceneId: string, effectId: string, effect: DocumentaryEffect | null) => {
    if (busy) return;
    setUndoStack(current => [...current.slice(-39), {scenes,music}]); setRedoStack([]);
    setScenes(current => current.map(scene => scene.id === sceneId && scene.documentary ? { ...scene, documentary: { ...scene.documentary,
      effects: scene.documentary.effects.flatMap(item => item.id === effectId ? effect ? [effect] : [] : [item]) } } : scene));
    setPlaying(false); setDirty(true);
  };
  const selectEffectScene = (sceneId: string) => { setMusicOpen(false); setSelectedIds([sceneId]); setSelectedTextId(undefined); setSelectedCutId(undefined); setPropertiesOpen(true); setPlaying(false); };
  const selectedText = primary?.documentary?.texts?.find(text => text.id === selectedTextId);
  const selectedCut = primary?.documentary?.cuts?.find(cut => cut.id === selectedCutId);
  const selectedMaterial=selectedCut?.sourceSceneId?scenes.find(scene=>scene.id===selectedCut.sourceSceneId):primary;
  useEffect(() => {
    if (!isDocumentary) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || target?.closest("dialog")) return;
      const key = event.key.toLowerCase(), command = event.ctrlKey || event.metaKey;
      if (command && key === "s") {event.preventDefault();if (!busy && dirty) void persist();return;}
      if (target?.closest("input,textarea,select,[contenteditable=true]")) return;
      if (command && key === "z") { event.preventDefault(); event.shiftKey ? redoEdit() : undoEdit(); }
      else if (command && key === "y") {event.preventDefault();redoEdit();}
      else if (command || event.altKey) return;
      else if (event.code === "Space") {event.preventDefault();void togglePlayback();}
      else if (key === "s") {event.preventDefault();splitAtPlayhead();}
      else if (key === "t") {event.preventDefault();addText();}
      else if (key === "arrowleft" || key === "arrowright") {event.preventDefault();seekTimeline(currentTime+(key === "arrowleft" ? -1:1)*(event.shiftKey ? 1:1/30));}
      else if (key === "home" || key === "end") {event.preventDefault();seekTimeline(key === "home" ? 0:Math.max(0,totalDuration-1/30));}
    };
    window.addEventListener("keydown",keydown);return()=>window.removeEventListener("keydown",keydown);
  });
  const timelineSequencer = useMemo(() => (
    <div className="timeline-sequencer" style={trackSizes.style}>
      <div className="timeline-track-labels" style={{ gridTemplateRows: trackRows }}>
        <span>ВРЕМЯ</span>
        {trackLabel("video","Видео",<Video size={15}/>,76)}
        {trackLabel("voice","Озвучка",<Mic2 size={15}/>)}
        {isDocumentary&&trackLabel("templates","Шаблоны",<Clapperboard size={15}/>)}
        {isDocumentary&&trackLabel("text","Текст",<Captions size={15}/>,textClips.height)}
        {isDocumentary&&trackLabel("sound","Звуки",<Music2 size={15}/>,soundClips.height)}
        {isDocumentary&&trackLabel("effects","Эффекты",<Sparkles size={15}/>,visualClips.height)}
        {trackLabel("music","Музыка",<Music2 size={15}/>,musicHeight)}
        <span>ОБЗОР</span>
      </div>
      <div ref={timelineScrollRef} className="timeline-scroll" title="Alt + колесо — прокрутка, Ctrl + колесо — масштаб" onScroll={(event) => queueTimelineViewport(event.currentTarget)}>
        <div
          ref={timelineCanvasRef}
          className="timeline-canvas"
          style={{ width: Math.max(900, timelineDuration * zoomRef.current), gridTemplateRows: trackRows }}
        >
          <div className="timeline-ruler-new seekable" onPointerDown={beginScrub} onPointerMove={moveScrub} onPointerUp={endScrub} onPointerCancel={endScrub}>
            {visibleTimelineTicks.map((seconds) => <time key={seconds} style={timelineTimeStyle(seconds, timelineDuration)}>{formatTimestamp(seconds)}</time>)}
          </div>
          {isDocumentary ? <DocumentaryVisualTrack entries={visibleTimelineLayouts} scenes={scenes} duration={timelineDuration} busy={busy} selectedId={selectedCutId} selectedScenes={selectedIdSet} mediaUrl={path=>api.mediaUrl(path)}
            onTransition={(left,right)=>{setPlaying(false);setTransitionPair({left,right});}}
            onSelect={(sceneId,cutId,seconds,event)=>{chooseScene(sceneId,event);setSelectedCutId(event.ctrlKey||event.metaKey||event.shiftKey?undefined:cutId);setSelectedTextId(undefined);if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey)seekTimeline(seconds);}}
            onContext={(sceneId,x,y)=>{if(!selectedIdSet.has(sceneId))setSelectedIds([sceneId]);setMenu({sceneId,x,y});}}
            onChange={changeCuts} onReorder={(from,to,after)=>{dragIdRef.current=from;dropAt(to,after);}} /> : <div className="timeline-grid-track video-track">
            {visibleTimelineLayouts.map((entry) => (
              <button
                key={entry.scene.id}
                draggable={!busy}
                style={timelinePositionStyle(entry, timelineDuration)}
                className={`timeline-clip${selectedIdSet.has(entry.scene.id) ? " selected" : ""}${entry.scene.includeInAssembly === false ? " excluded" : ""}${draggedId === entry.scene.id ? " dragging" : ""}${dropTarget?.id === entry.scene.id ? dropTarget.after ? " drop-after" : " drop-before" : ""}`}
                onDragStart={(event) => { dragIdRef.current = entry.scene.id; setDraggedId(entry.scene.id); setSelectedIds([entry.scene.id]); setPropertiesOpen(true); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", entry.scene.id); }}
                onDragEnd={() => { dragIdRef.current = null; setDraggedId(null); setDropTarget(null); }}
                onDragOver={(event) => { if (busy || !dragIdRef.current) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; const after = event.clientX > event.currentTarget.getBoundingClientRect().left + event.currentTarget.clientWidth / 2; setDropTarget(current => current?.id === entry.scene.id && current.after === after ? current : { id: entry.scene.id, after }); }}
                onDrop={(event) => { event.preventDefault(); dropAt(entry.scene.id, event.clientX > event.currentTarget.getBoundingClientRect().left + event.currentTarget.clientWidth / 2); }}
                onClick={(event) => chooseScene(entry.scene.id, event)}
                onContextMenu={(event) => { event.preventDefault(); if (!selectedIdSet.has(entry.scene.id)) setSelectedIds([entry.scene.id]); setMenu({ x: event.clientX, y: event.clientY, sceneId: entry.scene.id }); }}
              >
                {entry.scene.imagePath ? <LocalMediaImage widthHint={240} src={api.mediaUrl(entry.scene.imagePath)} alt="" draggable={false} /> : <Image size={18} />}
                <i>{entry.scene.order + 1}</i><em>{entry.duration.toFixed(1)}с</em><GripVertical size={13} />
              </button>
            ))}
          </div>}
          <div className="timeline-grid-track audio-track">{visibleTimelineLayouts.map((entry) => <button key={entry.scene.id} style={timelinePositionStyle(entry, timelineDuration)} className={entry.scene.audioPath ? "ready" : "missing"} onClick={(event) => {chooseScene(entry.scene.id, event);setSelectedTextId(undefined);setSelectedCutId(undefined);}} onDoubleClick={() => {if(!isDocumentary)void regenerateSelected("audio", [entry.scene.id]);}} title={isDocumentary?"Свойства озвучки — разрезы картинки не меняют речь":"Клик — свойства звука, двойной клик — перегенерировать"}><Volume2 size={12} />{entry.scene.audioPath ? `${entry.scene.narrationVolume ?? 100}%` : "Нет озвучки"}</button>)}</div>
          {isDocumentary ? <>
            <div className="timeline-track-viewport"><DocumentaryTemplateTrack entries={visibleTimelineLayouts} duration={timelineDuration} busy={busy} onSelect={id=>{selectEffectScene(id);setMusicOpen(false);}} onChange={(id,documentary)=>patchScene(id,{documentary})}/></div>
            <div className="timeline-track-viewport"><DocumentaryTextTrack {...textClips} duration={totalDuration} boundaries={effectBoundaries} busy={busy} selectedId={selectedTextId} onChange={changeText} onSelect={(sceneId,id)=>{selectEffectScene(sceneId);setSelectedTextId(id);}} /></div>
            <div className="timeline-track-viewport"><DocumentaryEffectTrack {...soundClips} duration={timelineDuration} boundaries={effectBoundaries} busy={busy} onChange={changeEffect} onSelect={selectEffectScene} /></div>
            <div className="timeline-track-viewport"><DocumentaryEffectTrack {...visualClips} duration={timelineDuration} boundaries={effectBoundaries} busy={busy} onChange={changeEffect} onSelect={selectEffectScene} /></div>
            <div className="timeline-track-viewport"><DocumentaryMusicTrack clips={musicClips} duration={totalDuration} boundaries={effectBoundaries} busy={busy} selectedId={selectedMusicId} enabled={music.enabled!==false} mediaUrl={path=>api.mediaUrl(path)} onSelect={selectMusic} onChange={changeMusicClip}/></div>
          </> : <div className="timeline-grid-track music-track"><span>{project.settings.music.path && project.settings.music.enabled !== false ? "Фоновая музыка" : "Музыка не добавлена"}</span></div>}
          <div className="timeline-overview">{layout.map((entry) => <i key={entry.scene.id} className={entry.scene.includeInAssembly === false ? "excluded" : ""} style={timelinePositionStyle(entry, timelineDuration, false)} />)}</div>
          <div ref={playheadRef} className="timeline-playhead" style={{ left: 0, transform: "translateX(0px)" }}><i /></div>
        </div>
      </div>
    </div>
  ), [
    api,
    busy,
    layout,
    project.settings.music.enabled,
    project.settings.music.path,
    selectedIdSet,
    timelineDuration,
    visibleTimelineLayouts,
    visibleTimelineTicks
    , draggedId, dropTarget, scenes, dirty, saving, soundClips, visualClips, textClips, selectedCutId, selectedTextId, totalDuration, effectBoundaries, trackRows, trackSizes.heights, isDocumentary, music, musicClips, selectedMusicId
  ]);

  return (
    <div className="timeline-studio-backdrop">
      {materialPicker&&materialPicker.project.scenes.some(s=>s.id===materialPicker.sceneId)&&<DocumentaryMaterialModal api={api}
        cutId={materialPicker.cutId}
        project={materialPicker.project} scene={materialPicker.project.scenes.find(s=>s.id===materialPicker.sceneId)!}
        onClose={()=>setMaterialPicker(undefined)} onApplied={async updated=>{
          const saved=await onSave(updated.id,{scenes:updated.scenes,outputPath:undefined});
          materialHistorySceneIds.current.add(materialPicker.sceneId);
          setUndoStack(current=>[...current.slice(-39),{scenes:materialPicker.project.scenes,music,materialSceneIds:[materialPicker.sceneId]}]);setRedoStack([]);
          setScenes([...saved.scenes].sort((a,b)=>a.order-b.order));setDirty(false);setMediaMode('live');
          setMaterialPicker({project:saved,sceneId:materialPicker.sceneId,cutId:materialPicker.cutId});
        }}/>
      }
      {transitionPair&&scenes.some(s=>s.id===transitionPair.left)&&scenes.some(s=>s.id===transitionPair.right)&&<DocumentaryTransitionPicker
        api={api} project={{...project,scenes}} left={scenes.find(s=>s.id===transitionPair.left)!} right={scenes.find(s=>s.id===transitionPair.right)!} busy={busy}
        onClose={()=>setTransitionPair(undefined)} onApply={changes=>{
          if(busy)return;setUndoStack(current=>[...current.slice(-39),{scenes,music}]);setRedoStack([]);
          setScenes(current=>current.map(scene=>changes.has(scene.id)?{...scene,...changes.get(scene.id)}:scene));setDirty(true);setMediaMode('live');
        }}/>
      }
      <section className={`timeline-studio${propertiesOpen && primary ? " properties-open" : ""}`}>
        <header className="timeline-topbar">
          <button className="timeline-icon-button" onClick={() => void leaveTimeline(onClose)} title="Назад"><ChevronLeft size={19} /></button>
          <div className="timeline-project-title">
            <strong>{project.title}</strong>
            <small>{scenes.length} сцен · {formatTimestamp(totalDuration)} · {project.aspectRatio === "16:9" ? isDocumentary ? "1920×1080" : "1280×720" : project.aspectRatio}</small>
          </div>
          <div className="timeline-transport">
            <button disabled={scenes.length === 0} onClick={() => seekTimeline(Math.max(0, currentTime - 5))}><ArrowLeft size={14} /></button>
            <button className="play" disabled={preparingAudio || scenes.length === 0 || (mediaMode === "final" && !project.outputPath)} title={preparingAudio ? "Подготавливаю звуковую дорожку" : "Воспроизведение / пауза"} onClick={() => void togglePlayback()}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
            <button disabled={scenes.length === 0} onClick={() => seekTimeline(Math.min(totalDuration, currentTime + 5))}><ArrowRight size={14} /></button>
            <time>{formatTimestamp(currentTime)} <span>/ {formatTimestamp(totalDuration)}</span></time>
          </div>
          <div className="timeline-top-actions">
            {isDocumentary && <><button disabled={busy || !undoStack.length} onClick={undoEdit} title="Ctrl+Z">↶ Отменить</button><button disabled={busy || !redoStack.length} onClick={redoEdit} title="Ctrl+Shift+Z">↷ Повторить</button>{preparingAudio && <small>Подготавливаю звук…</small>}</>}
            <button className="timeline-icon-button" onClick={onOpenFolder} title="Открыть папку"><FolderOpen size={16} /></button>
            <label className="timeline-zoom" title="Ctrl + колесо — масштаб под курсором"><span>−</span><input type="range" min="8" max="160" value={zoom} onChange={(event) => queueTimelineZoom(Number(event.target.value))} /><span>+</span><em>{Math.round(zoom)}px/с</em></label>
            <button className="generate-button compact" disabled={busy || !projectEditorReady({ ...project, scenes })} onClick={() => void rebuild()}><Download size={14} />{saving ? "Сохраняю…" : "Экспорт"}</button>
          </div>
        </header>

        <ProjectWorkflowBar project={{ ...project, scenes }} current="editor" hasQueueTasks={hasQueueTasks} busy={saving} onNavigate={(stage) => void leaveTimeline(() => onNavigateStage(stage))} />

        <div className="timeline-stage">
          <main className="timeline-preview-area">
            <div className="timeline-media-frame">
              {mediaMode === "final" && finalVideoSource ? (
                <video
                  key={`final-${finalVideoSource}-${finalVideoRevision ?? "original"}`}
                  ref={videoRef}
                  data-mode="final"
                  src={api.mediaUrl(finalVideoSource)}
                  preload="metadata"
                  playsInline
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  onLoadedMetadata={(event) => handleLoadedMetadata(event.currentTarget)}
                  onTimeUpdate={(event) => handleVideoTime(event.currentTarget)}
                  onError={(event) => {
                    const error = event.currentTarget.error;
                    reportMediaError(error?.message || "Final.mp4 не удалось загрузить", error?.code);
                  }}
                />
              ) : mediaMode === "live" && visibleLayouts.length > 0 ? (
                <div ref={livePreviewRef} className={`timeline-live-preview${remotionPreviewTimeline ? " remotion-preview" : ""}${playing ? " playing" : ""}`}>
                  {remotionPreviewTimeline ? (
                    <RemotionLivePreview key={previewRevision} ref={previewControls} timeline={remotionPreviewTimeline} currentTime={currentTime} playing={playing} onError={reportMediaError}
                      onFrame={seconds => {
                        if (scrubPointerRef.current !== null || !playing) return;
                        if (playheadRef.current) playheadRef.current.style.transform = `translateX(${seconds * timelineScale}px)`;
                        const now = performance.now();
                        if (now - lastPlayerUpdateRef.current > 80) { lastPlayerUpdateRef.current = now; setCurrentTime(seconds); }
                      }}
                      onEnded={() => { setPlaying(false); setCurrentTime(totalDuration); livePlaybackRef.current = null; }} />
                  ) : mountedPreviewLayouts.map((entry) => {
                    const localTime = clampTimelineNumber(currentTime - entry.start, 0, entry.duration);
                    const rate = clampTimelineNumber(entry.scene.playbackRate ?? 1, 0.25, 4);
                    const mediaTime = (entry.scene.trimStartSeconds ?? 0) + localTime * rate;
                    const sourceVolume = project.settings.video.muteSource ? 0 : (entry.scene.sourceVolume ?? project.settings.video.sourceVolume) / 100;
                    const narrationVolume = (entry.scene.narrationVolume ?? 100) / 100;
                    return (
                      <div key={entry.scene.id} data-preview-layer data-scene-id={entry.scene.id} className="timeline-live-layer" style={{ visibility: visibleLayouts.includes(entry) ? "visible" : "hidden", transformOrigin: "0 0" }}>
                        {sceneUsesVideo(entry.scene) ? (
                          <video
                            data-timeline-media
                            data-timeline-time={mediaTime}
                            data-timeline-rate={rate}
                            data-timeline-volume={sourceVolume}
                            src={api.mediaUrl(entry.scene.videoPath!)}
                            poster={entry.scene.imagePath ? api.mediaUrl(entry.scene.imagePath) : undefined}
                            preload="auto"
                            playsInline
                          />
                        ) : entry.scene.imagePath ? (
                          <img src={api.mediaUrl(entry.scene.imagePath)} alt={entry.scene.title} decoding="async" />
                        ) : (
                          <div className="timeline-no-media"><Image size={34} /><span>У сцены нет изображения</span></div>
                        )}
                        {project.settings.voice.enabled && entry.scene.audioPath && (
                          <audio
                            data-timeline-media
                            data-timeline-time={Math.min((entry.scene.narrationSlice?.startSeconds ?? 0) + localTime, entry.scene.narrationSlice?.endSeconds ?? Infinity)}
                            data-timeline-rate={1}
                            data-timeline-volume={localTime < (entry.scene.narrationSlice
                              ? entry.scene.narrationSlice.endSeconds - entry.scene.narrationSlice.startSeconds
                              : entry.duration - entry.overlapToNext) ? narrationVolume : 0}
                            src={api.mediaUrl(entry.scene.audioPath)}
                            preload="auto"
                          />
                        )}
                      </div>
                    );
                  })}
                  {remotionPreviewTimeline?.version === 1 && visibleLayouts.map((entry) => {
                    const localTime = clampTimelineNumber(currentTime - entry.start, 0, entry.duration);
                    return project.settings.voice.enabled && entry.scene.audioPath ? (
                      <audio
                        key={`remotion-audio-${entry.scene.id}`}
                        data-timeline-media
                        data-timeline-time={Math.min((entry.scene.narrationSlice?.startSeconds ?? 0) + localTime, entry.scene.narrationSlice?.endSeconds ?? Infinity)}
                        data-timeline-rate={1}
                        data-timeline-volume={localTime < (entry.scene.narrationSlice
                          ? entry.scene.narrationSlice.endSeconds - entry.scene.narrationSlice.startSeconds
                          : entry.duration - entry.overlapToNext) ? (entry.scene.narrationVolume ?? 100) / 100 : 0}
                        src={api.mediaUrl(entry.scene.audioPath)}
                        preload="auto"
                      />
                    ) : null;
                  })}
                  {!isDocumentary && project.settings.music.enabled !== false && project.settings.music.path && (
                    <audio
                      key={project.settings.music.path}
                      data-timeline-media
                      data-timeline-loop="true"
                      data-timeline-time={currentTime}
                      data-timeline-rate="1"
                      data-timeline-volume={project.settings.music.volume / 100}
                      src={api.mediaUrl(project.settings.music.path)}
                      preload="auto"
                      loop
                    />
                  )}
                  {!remotionPreviewTimeline && <div className="timeline-live-fade" />}
                  <span className="timeline-live-label">{remotionPreviewTimeline ? "Remotion-предпросмотр" : "Живой предпросмотр"} · сцена {(liveForeground?.index ?? 0) + 1}</span>
                </div>
              ) : (
                <div className="timeline-no-media"><Video size={38} /><span>Сначала сгенерируйте материалы сцены</span></div>
              )}
              {(mediaMode === "live" ? visibleLayouts.length > 0 : Boolean(finalVideoSource)) && !mediaError && <button className="timeline-big-play" disabled={preparingAudio} title={preparingAudio ? "Подготавливаю звуковую дорожку" : "Воспроизведение / пауза"} onClick={() => void togglePlayback()}>{preparingAudio ? <span>Подготавливаю звук…</span> : playing ? <Pause size={26} /> : <Play size={27} />}</button>}
              {mediaError && <div className="timeline-media-error"><Video size={28} /><strong>{mediaMode === "final" ? "Видео не открылось" : "Ошибка предпросмотра"}</strong><span>{mediaError}</span><button onClick={() => { if (mediaMode === "final") reloadVideo(); else { setMediaError(null); setPreviewRevision(value => value + 1); } }}><RotateCcw size={13} />Повторить</button></div>}
            </div>
            <div className="timeline-preview-switch">
              <button className={mediaMode === "live" ? "active" : ""} disabled={scenes.length === 0} onClick={() => { videoRef.current?.pause(); pendingSeekRef.current = null; livePlaybackRef.current = null; setMediaMode("live"); setPlaying(false); }}>Предпросмотр</button>
              <button className={mediaMode === "final" ? "active" : ""} disabled={!project.outputPath || dirty} title={dirty ? "Сначала примените изменения" : "Открыть собранный файл"} onClick={() => { livePlaybackRef.current = null; pendingSeekRef.current = currentTime; setMediaMode("final"); setPlaying(false); }}>Final.mp4</button>
            </div>
            {playing && mediaMode === "live" && measuredLayout !== layout && <small className="timeline-pending-media">Новые материалы появятся после паузы — текущий просмотр не прерывается.</small>}
          </main>

          {propertiesOpen && isDocumentary && musicOpen && <aside className="timeline-properties">
            <header><strong>Музыкальная дорожка</strong><button onClick={()=>setPropertiesOpen(false)}><X size={16}/></button></header>
            <div className="timeline-properties-scroll"><DocumentaryMusicInspector api={api} value={music} duration={totalDuration} currentTime={currentTime} selectedId={selectedMusicId} busy={busy} onSelect={selectMusic} onChange={changeMusic} onPendingChange={setMusicImporting}/></div>
            <footer><button className="outline-button" disabled={busy} onClick={()=>{setScenes(initialScenes());setMusic(project.settings.music);setDirty(false);setUndoStack([]);setRedoStack([]);setSelectedMusicId(undefined);}}>Отмена</button><button className="generate-button compact" disabled={!dirty||busy} onClick={()=>void persist()}><Check size={14}/>Применить</button></footer>
          </aside>}
          {propertiesOpen && primary && !(isDocumentary&&musicOpen) && (
            <aside className="timeline-properties">
              <header><div><b>{selected.length}</b><strong>{selected.length === 1 ? "Свойства сцены" : `Свойства ${selected.length} сцен`}</strong></div><button onClick={() => setPropertiesOpen(false)}><X size={16} /></button></header>
              <div className="timeline-properties-scroll">
                {busy && <p className="timeline-properties-note">Просмотр доступен. Изменение сцен — после остановки или завершения генерации.</p>}
                <fieldset className="timeline-property-fields" disabled={busy}>
                {isDocumentary&&selected.length===1&&<button className="outline-button" title="Сохраняет текущие правки перед поиском. Замена материала доступна через отмену в редакторе." onClick={async()=>{
                  if(busy)return;setPlaying(false);videoRef.current?.pause();
                  if(dirty&&!await persist())return;
                  setMaterialPicker({project:{...project,scenes:reindex(scenes),settings:{...project.settings,music}},sceneId:primary.id,cutId:selectedCut?.id});
                }}><Search size={14}/>Заменить вручную</button>}
                {isDocumentary&&selectedMaterial?.documentary?.illustrative&&<p className="timeline-properties-note">Иллюстрация · {documentaryMaterialReviewNote(selectedMaterial)||'Тематический материал вместо точного изображения'}</p>}
                {isDocumentary && selected.length === 1 && selectedText && <DocumentaryTextInspector text={selectedText} sceneStart={layoutBySceneId.get(primary.id)?.start??0} duration={totalDuration} onChange={text=>changeText(primary.id,text.id,text)} onDelete={()=>changeText(primary.id,selectedText.id,null)} />}
                {isDocumentary && selected.length === 1 && selectedCut && <DocumentaryCutInspector cut={selectedCut} scene={primary} scenes={scenes} onChange={cut=>changeCuts(primary.id,visualCuts(primary).map(item=>item.id===cut.id?cut:item))} onMerge={()=>changeCuts(primary.id,mergeVisualCut(primary,selectedCut.id))} onReset={()=>{changeCuts(primary.id,[]);setSelectedCutId(undefined);}} />}
                {isDocumentary && primary.documentary && selected.length === 1 && <DocumentarySceneInspector key={primary.id} api={api} project={{ ...project, scenes }} scene={primary} onChange={documentary => patchSelected({ documentary })} onArtworkChange={artwork=>{
                  if(busy)return;
                  setUndoStack(current=>[...current.slice(-39),{scenes,music}]);setRedoStack([]);
                  setScenes(current=>updateSceneArtwork(current,primary.id,artwork));setDirty(true);
                }} />}
                {selected.length === 1 && (
                  <div className="timeline-property-thumb">
                    {primary.imagePath ? <img src={api.mediaUrl(primary.imagePath)} alt="" /> : <Image size={30} />}
                    <span>{primary.order + 1}. {primary.title}</span>
                  </div>
                )}
                <section>
                  <small>СОСТОЯНИЕ</small>
                  <button disabled={busy} className={`timeline-switch-row${selected.every((scene) => scene.includeInAssembly !== false) ? " on" : ""}`} onClick={() => patchSelected({ includeInAssembly: !selected.every((scene) => scene.includeInAssembly !== false) })}>
                    <span>Сцена участвует в сборке</span><i />
                  </button>
                </section>
                {selected.length === 1 && !primary.documentary?.cuts?.length && (
                  <section>
                    <small>ТАЙМИНГ И ОБРЕЗКА</small>
                    <div className="timeline-two-fields">
                      <label>Длительность, с<input type="number" min="1" max="600" step="0.1" value={primary.durationOverrideSeconds ?? primary.durationSeconds} onChange={(event) => patchSelected({ durationOverrideSeconds: Math.max(1, Number(event.target.value)) })} /></label>
                      <label>Скорость<select value={primary.playbackRate ?? 1} onChange={(event) => patchSelected({ playbackRate: Number(event.target.value) })}><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1.0×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2.0×</option></select></label>
                      <label>С начала, с<input type="number" min="0" step="0.1" value={primary.trimStartSeconds ?? 0} onChange={(event) => { const start = Math.max(0, Number(event.target.value)); patchSelected({ trimStartSeconds: start, trimEndSeconds: primary.trimEndSeconds !== undefined && primary.trimEndSeconds <= start ? undefined : primary.trimEndSeconds }); }} /></label>
                      <label>До, с<input type="number" min={(primary.trimStartSeconds ?? 0) + 0.1} step="0.1" placeholder="до конца" value={primary.trimEndSeconds ?? ""} onChange={(event) => patchSelected({ trimEndSeconds: event.target.value ? Math.max((primary.trimStartSeconds ?? 0) + 0.1, Number(event.target.value)) : undefined })} /></label>
                    </div>
                  </section>
                )}
                <section>
                  <small>ЗВУК</small>
                  <label className="timeline-range-field"><span>Громкость озвучки <b>{primary.narrationVolume ?? 100}%</b></span><input type="range" min="0" max="150" value={primary.narrationVolume ?? 100} onChange={(event) => patchSelected({ narrationVolume: Number(event.target.value) })} /></label>
                  <label className="timeline-range-field"><span>Громкость видео <b>{primary.sourceVolume ?? project.settings.video.sourceVolume}%</b></span><input type="range" min="0" max="100" value={primary.sourceVolume ?? project.settings.video.sourceVolume} onChange={(event) => patchSelected({ sourceVolume: Number(event.target.value) })} /></label>
                  <div className="timeline-audio-actions">
                    <button disabled={busy} onClick={() => patchSelected({ narrationVolume: (primary.narrationVolume ?? 100) > 0 ? 0 : 100 })}>{(primary.narrationVolume ?? 100) > 0 ? <EyeOff size={13} /> : <Volume2 size={13} />}{(primary.narrationVolume ?? 100) > 0 ? "Отключить озвучку" : "Включить озвучку"}</button>
                    <button disabled={busy || !project.settings.voice.enabled} onClick={() => void regenerateSelected("audio")}><RotateCcw size={13} />Перегенерировать звук</button>
                  </div>
                </section>
                <section>
                  <small>ПАНОРАМА ФОТО-СЦЕНЫ</small>
                  <div className="timeline-two-fields">
                    <label>Направление<select value={primary.kenBurnsDirection ?? "auto"} onChange={(event) => patchSelected({ kenBurnsDirection: event.target.value as TimelineScene["kenBurnsDirection"] })}><option value="auto">Авто</option><option value="in">Приближение</option><option value="out">Отдаление</option><option value="off">Отключено</option></select></label>
                    <label>Зум<select value={primary.kenBurnsZoom ?? primary.autoKenBurnsZoom ?? 1.1} onChange={(event) => patchSelected({ kenBurnsZoom: Number(event.target.value) })}><option value="1.05">Мягкий 5%</option><option value="1.06">6%</option><option value="1.08">8%</option><option value="1.1">Обычный 10%</option><option value="1.12">12%</option><option value="1.15">Сильный 15%</option><option value="1.2">20%</option></select></label>
                  </div>
                </section>
                <section>
                  <small>ПЕРЕХОД К СЛЕДУЮЩЕЙ СЦЕНЕ</small>
                  <label className="timeline-full-field">Тип<select value={primary.transition ?? "auto"} onChange={(event) => { const transition = event.target.value; patchSelected(transition === "auto" ? { transition: undefined, transitionDurationSeconds: undefined } : transition === "none" ? { transition: "none", transitionDurationSeconds: 0 } : { transition: transition as TimelineScene["transition"], transitionDurationSeconds: primary.transitionDurationSeconds && primary.transitionDurationSeconds > 0 ? primary.transitionDurationSeconds : resolveProjectSceneTransitionDuration(project, primary) || .35 }); }}><option value="auto">Как во всём ролике</option><option value="mix">Плавное растворение</option><option value="fade">Затухание через чёрный</option><option value="none">Без перехода</option></select></label>
                  <label className="timeline-range-field"><span>Длительность перехода <b>{primary.transition === "none" ? 0 : resolveProjectSceneTransitionDuration(project, primary).toFixed(2)} с</b></span><input type="range" min="0" max="5" step="0.05" value={primary.transition === "none" ? 0 : resolveProjectSceneTransitionDuration(project, primary)} onChange={(event) => selected.length === 1 ? setTransitionDuration(primary.id, Number(event.target.value)) : patchSelected(Number(event.target.value) <= 0.01 ? { transition: "none", transitionDurationSeconds: 0 } : { transition: primary.transition === "none" ? "mix" : primary.transition ?? (resolveProjectSceneTransition(project, primary) === "none" ? "mix" : resolveProjectSceneTransition(project, primary)), transitionDurationSeconds: Number(event.target.value) })} /></label>
                  <button className="timeline-remove-transition" disabled={busy || primary.order >= scenes.length - 1} onClick={() => patchSelected({ transition: "none", transitionDurationSeconds: 0 })}><X size={13} />Удалить переход</button>
                  <button className={`timeline-switch-row${primary.fadeEdges ? " on" : ""}`} onClick={() => patchSelected({ fadeEdges: !primary.fadeEdges })}><span>Затемнение на краях сцены</span><i /></button>
                  <p className="timeline-live-note">По умолчанию: {resolveProjectSceneTransition(project, primary) === "mix" ? "плавное растворение" : resolveProjectSceneTransition(project, primary) === "fade" ? "затухание через чёрный" : "без перехода"}, {resolveProjectSceneTransitionDuration(project, primary).toFixed(2)} с. Здесь можно переопределить только выбранный стык.</p>
                </section>
                {!isDocumentary && selected.length === 1 && (
                  <section>
                    <small>ПРОМПТЫ СЦЕНЫ</small>
                    <label className="timeline-full-field">Изображение<textarea rows={4} value={primary.imagePrompt} onChange={(event) => patchSelected({ imagePrompt: event.target.value })} /></label>
                    <label className="timeline-full-field">Видео / движение<textarea rows={3} value={primary.animationPrompt} onChange={(event) => patchSelected({ animationPrompt: event.target.value })} /></label>
                  </section>
                )}
                {selected.length > 1 && <p className="timeline-bulk-note">Изменения применятся ко всем выбранным сценам.</p>}
                </fieldset>
              </div>
              <footer><button className="outline-button" disabled={busy} onClick={() => { setScenes(initialScenes());setMusic(project.settings.music); setDirty(false);setUndoStack([]);setRedoStack([]);setSelectedCutId(undefined);setSelectedTextId(undefined); }}>Отмена</button><button className="generate-button compact" disabled={!dirty || busy} onClick={() => void persist()}><Check size={14} />Применить</button></footer>
            </aside>
          )}
        </div>

        <ResizableTimelinePanel onResizeStart={() => { videoRef.current?.pause(); setPlaying(false); }}>
          {isDocumentary && <div className="documentary-edit-toolbar"><button disabled={busy || !scenes.length} onClick={splitAtPlayhead} title={musicOpen?'S — разрез выбранной музыки по курсору':'S — разрез видеоряда по курсору'}>✂ Разрезать{musicOpen?' музыку':''}</button><button disabled={busy || !scenes.length} onClick={addText} title="T — добавить независимый текст"><Captions size={14}/>Текст</button><button disabled={busy || !scenes.length} onClick={()=>selectMusic()}><Music2 size={14}/>Музыка</button><button disabled={busy || !dirty} onClick={()=>void persist()} title="Ctrl+S"><Save size={14}/>Сохранить</button><span>Space · просмотр　← → · кадр　Shift+← → · секунда　Alt+тяга · сдвиг исходника</span></div>}
          {timelineSequencer}
        </ResizableTimelinePanel>

        {selected.length > 1 && (
          <div className="timeline-selection-bar"><b>Выбрано {selected.length}</b><button disabled={busy} onClick={toggleSelected}>{selected.some((scene) => scene.includeInAssembly === false) ? <Eye size={14} /> : <EyeOff size={14} />} {selected.some((scene) => scene.includeInAssembly === false) ? "Включить" : "Отключить"}</button><button onClick={() => setPropertiesOpen(true)}><SlidersHorizontal size={14} />Свойства</button><button disabled={busy} onClick={deleteSelected}><Trash2 size={14} />Удалить</button><button disabled={busy} className="primary" onClick={() => void regenerateSelected("all")}><RotateCcw size={14} />Перегенерировать</button></div>
        )}

        {menu && montageMenuScene && (
          <div className="context-backdrop timeline-context-backdrop" onMouseDown={() => setMenu(null)} onContextMenu={(event) => { event.preventDefault(); setMenu(null); }}>
            <div className="context-menu timeline-context-menu" style={{ left: Math.min(menu.x, window.innerWidth - 245), top: Math.min(menu.y, window.innerHeight - 390) }} onMouseDown={(event) => event.stopPropagation()}>
              <button onClick={() => { setPropertiesOpen(true); setMenu(null); }}><SlidersHorizontal size={14} />Свойства сцены</button>
              {!isDocumentary && <button disabled={busy} onClick={() => { void regenerateSelected("image", [montageMenuScene.id]); setMenu(null); }}><Image size={14} />Перегенерировать фото</button>}
              {!isDocumentary && <button disabled={busy || !project.settings.video.enabled} onClick={() => { void regenerateSelected("video", [montageMenuScene.id]); setMenu(null); }}><Video size={14} />Перегенерировать видео</button>}
              {isDocumentary && <button disabled={busy} onClick={() => { setMenu(null); void leaveTimeline(() => onNavigateStage("materials")); }}><Image size={14} />Заменить материал</button>}
              <button disabled={busy || !project.settings.voice.enabled} onClick={() => { void regenerateSelected("audio", [montageMenuScene.id]); setMenu(null); }}><Mic2 size={14} />Перегенерировать озвучку</button>
              {!isDocumentary && <button disabled={busy} onClick={() => { void regenerateSelected("all", [montageMenuScene.id]); setMenu(null); }}><RotateCcw size={14} />Перегенерировать всё</button>}
              <hr />
              <button disabled={busy} onClick={() => { toggleSelected(); setMenu(null); }}>{selected.some((scene) => scene.includeInAssembly === false) ? <Eye size={14} /> : <EyeOff size={14} />}{selected.some((scene) => scene.includeInAssembly === false) ? `Включить ${selected.length > 1 ? "выбранные" : "сцену"}` : `Отключить ${selected.length > 1 ? "выбранные" : "сцену"}`}</button>
              <button disabled={busy} onClick={() => { duplicatePrimary(montageMenuScene); setMenu(null); }}><Copy size={14} />Дублировать</button>
              <button onClick={() => { copySceneSettings(montageMenuScene); setMenu(null); }}><Save size={14} />Копировать настройки</button>
              <button disabled={!copiedSettings} onClick={() => { if (copiedSettings) patchSelected(copiedSettings); setMenu(null); }}><Download size={14} />Вставить настройки</button>
              <hr />
              <button disabled={busy} className="danger" onClick={() => { deleteSelected(); setMenu(null); }}><Trash2 size={14} />{selected.length > 1 ? "Удалить выбранные" : "Удалить сцену"}</button>
            </div>
          </div>
        )}

        <button className="timeline-scenes-button" onClick={() => void leaveTimeline(onShowScenes)}><Grid2X2 size={14} />Показать сцены</button>
      </section>
    </div>
  );
}

function ProjectPreviewModal({ project, mode, onModeChange, hasQueueTasks, onClose, onRegenerate, onOpenFolder, onAssemble, onSave, onNavigateStage, onEditScenario, onToggleScene }: { project: Project; mode: "preview" | "timeline"; onModeChange: (mode: "preview" | "timeline") => void; hasQueueTasks: boolean; onClose: () => void; onRegenerate: (sceneId: string | string[], target?: "image" | "video" | "audio" | "all") => Promise<void>; onOpenFolder: () => void; onAssemble: () => Promise<void>; onSave: (id: string, input: UpdateProjectInput) => Promise<Project>; onNavigateStage: (stage: ProjectWorkflowStage) => void; onEditScenario: () => void; onToggleScene: (sceneId: string, include: boolean) => void }) {
  const api = window.goldWork ?? fallbackApi;
  const [menu, setMenu] = useState<{ x: number; y: number; scene: Scene } | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [finalDurationSeconds, setFinalDurationSeconds] = useState<number | null>(null);
  const busyGenerating = project.status === "generating" || project.status === "paused";
  const selectedScene = project.scenes.find((scene) => scene.id === selectedSceneId);
  const totalDuration = Math.round(project.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0));
  const includedScenes = project.scenes.filter((scene) => scene.includeInAssembly !== false);
  const allStockAssets = includedScenes.flatMap((scene) => [
    ...(stockMaterialApplied(scene) ? [{ stockSource: scene.stockSource!, imagePath: scene.imagePath, videoPath: scene.videoPath }] : []),
    ...(!scene.documentary || materialReady(scene) ? scene.stockAlternates ?? [] : [])
  ]);
  const availableStockVideos = allStockAssets.filter((variant) => variant.stockSource.mediaType === "video" && Boolean(variant.videoPath)).length;
  const availableStockImages = allStockAssets.filter((variant) => variant.stockSource.mediaType === "image" && Boolean(variant.imagePath)).length;
  const actualStockVideos = project.lastRender?.stockVideoCount ?? availableStockVideos;
  const actualStockImages = project.lastRender?.stockImageCount ?? availableStockImages;
  const visualBeats = includedScenes.reduce((sum, scene) => sum + (scene.visualBeats?.length ?? 0), 0);
  const templates = [...new Set(includedScenes.flatMap((scene) => scene.visualBeats?.map((beat) => beat.template) ?? []))];
  const finalVisualBeats = project.lastRender?.visualBeatCount ?? visualBeats;
  const finalTemplates = project.lastRender ? project.lastRender.templates : templates;
  if (mode === "timeline") {
    return <TimelineEditor project={project} hasQueueTasks={hasQueueTasks} onClose={onClose} onShowScenes={() => onModeChange("preview")} onOpenFolder={onOpenFolder} onAssemble={onAssemble} onSave={onSave} onRegenerate={onRegenerate} onNavigateStage={onNavigateStage} />;
  }
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="preview-modal">
        <header>
          <div>
            <Clapperboard size={20} />
            <div>
              <strong>{project.title}</strong>
              <small>{project.outputPath ?? "Final.mp4 ещё не собран"}</small>
            </div>
          </div>
          <div>
            <button className="active" onClick={() => onModeChange("preview")}>
              <Grid2X2 size={14} />
              Сцены
            </button>
            <button onClick={() => onModeChange("timeline")}>
              <Clock3 size={14} />
              Таймлайн
            </button>
            <button className="modal-close" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>
        <ProjectWorkflowBar project={project} current={project.outputPath ? "export" : "editor"} hasQueueTasks={hasQueueTasks} busy={busyGenerating} onNavigate={onNavigateStage} />
        {project.lastRender?.engine === "ffmpeg-fallback" && (
          <div className="render-fallback-warning" role="alert">
            <CircleAlert size={17} />
            <span><b>Remotion не сработал.</b> Открыт резервный FFmpeg Final.mp4 без полноценного автомонтажа. {project.lastRender.fallbackReason}</span>
          </div>
        )}
        {!!project.lastRender?.warnings?.length&&<details className="render-fallback-warning"><summary>Сборка: есть замечания ({project.lastRender.warnings.length})</summary><ul>{project.lastRender.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>}
        <div className="preview-stats">
          <Stat label="Сцен" value={String(project.scenes.length)} />
          <Stat label="Stock-видео" value={String(actualStockVideos)} />
          <Stat label="Stock-фото" value={String(actualStockImages)} />
          <Stat label="VisualBeat Final" value={String(finalVisualBeats)} />
          {finalVisualBeats !== visualBeats && <Stat label="VisualBeat план" value={String(visualBeats)} />}
          <Stat
            label={finalDurationSeconds !== null ? "Длительность Final" : "Плановая длительность"}
            value={`${Math.round(finalDurationSeconds ?? totalDuration)} сек`}
          />
          <Stat label="Planner" value={project.montagePlan?.usedPlanner ?? "не записан"} />
          <Stat label="Экспорт" value={project.lastRender
            ? project.lastRender.engine === "remotion" ? "Remotion" : project.lastRender.engine === "ffmpeg-fallback" ? "FFmpeg fallback" : "FFmpeg"
            : project.settings.assembly.montage?.enabled === false ? "будет FFmpeg" : "будет Remotion"} />
        </div>
        <div className="preview-template-summary" title={finalTemplates.join(", ")}>Шаблоны Final: {finalTemplates.length > 0 ? finalTemplates.join(", ") : "ещё не назначены"}</div>
        <div className="preview-player">
          {selectedScene?.imagePath ? (
            <img src={api.mediaUrl(selectedScene.imagePath)} alt={selectedScene.title} />
          ) : project.outputPath ? (
            <video
              key={project.outputPath}
              controls
              src={api.mediaUrl(project.outputPath)}
              onLoadedMetadata={(event) => {
                const duration = event.currentTarget.duration;
                setFinalDurationSeconds(Number.isFinite(duration) ? duration : null);
              }}
            />
          ) : project.scenes[0]?.imagePath ? (
            <img src={api.mediaUrl(project.scenes[0].imagePath)} alt="Первая сцена" />
          ) : (
            <div className="scene-placeholder"><Image size={34} /><span>Медиа появится после генерации</span></div>
          )}
          <small>
            {selectedScene
              ? `Сцена ${selectedScene.order + 1} из ${project.scenes.length} · клик по дорожке выбирает сцену, правый клик — меню`
              : project.outputPath
                ? "Final.mp4 · правый клик по сцене в дорожке — меню действий"
                : "Final.mp4 ещё не собран"}
          </small>
        </div>
        {mode === "preview" ? (
          <div className="scene-gallery">
            {project.scenes.length === 0 ? (
              <EmptyState icon={<Image size={32} />} title="Нет сцен" text="Добавьте сцены в редакторе сценария." action="Закрыть" onAction={onClose} />
            ) : (
              project.scenes.map((scene) => (
                <article className="preview-scene" key={scene.id}>
                  {scene.imagePath ? (
                    <LocalMediaImage widthHint={240} className="scene-thumb" src={api.mediaUrl(scene.imagePath)} alt={scene.title} onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, scene }); }} />
                  ) : (
                    <div className="scene-placeholder">
                      <Image size={28} />
                      <span>{scene.status}</span>
                    </div>
                  )}
                  <div>
                    <strong>
                      Сцена {scene.order + 1}: {scene.title}{scene.includeInAssembly === false ? " · вне сборки" : ""}
                    </strong>
                    <p>{scene.narration || "Текст озвучки не задан"}</p>
                    <small>
                      {sceneDurationLabel(scene)} · {scene.imagePath ? "изображение готово" : "изображение ожидается"} · {scene.audioPath ? "озвучка готова" : "озвучка ожидается"}
                    </small>
                    <button className="retry-button" disabled={busyGenerating} onClick={() => onRegenerate(scene.id)}>
                      <RotateCcw size={13} />
                      Перегенерировать сцену
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        ) : (
          <div className="timeline-tracks">
            <div className="timeline-track-row">
              <strong>Видео/Фото</strong>
              <div className="track-cells">
                {project.scenes.map((scene) => (
                  <button
                    key={scene.id}
                    className={`track-thumb${scene.includeInAssembly === false ? " excluded" : ""}${scene.id === selectedSceneId ? " selected" : ""}`}
                    title={`${scene.order + 1}. ${scene.title}`}
                    onClick={() => setSelectedSceneId(scene.id === selectedSceneId ? null : scene.id)}
                    onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, scene }); }}
                  >
                    <i>{scene.order + 1}</i>
                    {scene.imagePath ? <LocalMediaImage widthHint={240} src={api.mediaUrl(scene.imagePath)} alt="" /> : <Image size={16} />}
                  </button>
                ))}
              </div>
            </div>
            <div className="timeline-track-row">
              <strong>Audio TTS</strong>
              <div className="track-cells">
                {project.scenes.map((scene) => (
                  <span key={scene.id} className={`track-cell audio${scene.audioPath ? " ready" : ""}`} title={scene.narration.slice(0, 120)}>
                    <Volume2 size={13} />
                  </span>
                ))}
              </div>
            </div>
            <div className="timeline-track-row">
              <strong>Музыка</strong>
              <div className="track-cells single">
                <span className={`track-cell music${musicHasAudio(project.settings.music) ? " ready" : ""}`}>
                  <Music2 size={13} />
                  {musicHasAudio(project.settings.music) ? "Трек добавлен" : "Нет музыки"}
                </span>
              </div>
            </div>
          </div>
        )}
        {menu && (
          <div className="context-backdrop" onMouseDown={() => setMenu(null)} onContextMenu={(event) => { event.preventDefault(); setMenu(null); }}>
            <div className="context-menu" style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 190) }} onMouseDown={(event) => event.stopPropagation()}>
              <button onClick={() => { setMenu(null); onEditScenario(); }}>
                <FileText size={14} />
                Редактировать сцену
              </button>
              <button disabled={busyGenerating} onClick={() => { onRegenerate(menu.scene.id); setMenu(null); }}>
                <RotateCcw size={14} />
                Перегенерировать сцену
              </button>
              <button onClick={() => { onToggleScene(menu.scene.id, menu.scene.includeInAssembly === false); setMenu(null); }}>
                {menu.scene.includeInAssembly === false ? <Check size={14} /> : <X size={14} />}
                {menu.scene.includeInAssembly === false ? "Вернуть в сборку" : "Исключить из сборки"}
              </button>
            </div>
          </div>
        )}
        <footer>
          <button className="outline-button" onClick={onOpenFolder}>
            <FolderOpen size={15} />
            Открыть папку
          </button>
          <button className="outline-button" disabled={busyGenerating || !projectEditorReady(project)} onClick={onAssemble}>
            <RotateCcw size={15} />
            Экспорт
          </button>
          <button className="outline-button" onClick={onClose}>
            Закрыть
          </button>
          <button className="generate-button" onClick={() => onModeChange("timeline")}>
            <Clock3 size={15} />
            Открыть таймлайн
          </button>
        </footer>
      </section>
    </div>
  );
}

function ToolPage({ section, onAction }: { section: SectionKey; onAction: () => void }) {
  const definitions: Partial<Record<SectionKey, { title: string; subtitle: string; icon: ReactNode; action: string }>> = {
    clone: {
      title: "Клон YouTube",
      subtitle: "Анализ структуры референсного ролика",
      icon: <Copy size={25} />,
      action: "Добавить ссылку",
    },
    thumbnail: {
      title: "Превью",
      subtitle: "AI генерация обложек для YouTube",
      icon: <Image size={25} />,
      action: "Создать превью",
    },
    avatar: {
      title: "Аватарка",
      subtitle: "Генератор аватаров канала",
      icon: <CircleUserRound size={25} />,
      action: "Создать аватар",
    },
    seo: {
      title: "SEO",
      subtitle: "Заголовки, описание и теги",
      icon: <Search size={25} />,
      action: "Проанализировать тему",
    },
    studio: {
      title: "Студия",
      subtitle: "Ручная работа со сценами и медиа",
      icon: <Sparkles size={25} />,
      action: "Открыть проект",
    },
    console: {
      title: "Консоль",
      subtitle: "Системные события и журнал генерации",
      icon: <SquareTerminal size={25} />,
      action: "Очистить журнал",
    },
  };
  const definition = definitions[section] ?? definitions.studio!;
  return (
    <div>
      <PageHeading icon={definition.icon} title={definition.title} subtitle={definition.subtitle} />
      <section className="tool-workspace">
        <div className="tool-hero">
          {definition.icon}
          <h2>{definition.title} готов к подключению</h2>
          <p>Экран повторяет структуру исходной программы. Провайдер будет подключён после добавления API-ключа.</p>
          <button className="generate-button" onClick={onAction}>
            <Plus size={16} />
            {definition.action}
          </button>
        </div>
      </section>
    </div>
  );
}

function describeConsoleEntry(entry: ConsoleLogEntry): string {
  const details = entry.details ?? {};
  const label = String(details.label ?? details.kind ?? "Задача");
  const attempt = details.attempts ? ` · попытка ${details.attempts}/${details.maxAttempts ?? "?"}` : "";
  const messages: Record<string, string> = {
    "queue.project.started": `Генерация проекта запущена: ${details.scenes ?? "?"} сцен, ${details.tasks ?? "?"} задач`,
    "queue.project.reassemble": "Запущена пересборка Final.mp4",
    "queue.scene.regeneration.started": `Перегенерация запущена: ${details.scenes ?? 1} сцен · ${details.target ?? "all"}`,
    "timeline.player.error": `Плеер не открыл ${details.file ?? "Final.mp4"}${details.code ? ` · код ${details.code}` : ""}`,
    "queue.task.started": `${label}: запуск${attempt}`,
    "queue.task.completed": `${label}: готово${details.resultFile ? ` · ${details.resultFile}` : ""}`,
    "queue.task.retry_scheduled": `${label}: ошибка, повтор будет автоматически${attempt}`,
    "queue.task.retry_ready": `${label}: повторный запуск готов`,
    "queue.task.blocked": `${label}: заблокировано предыдущей ошибкой`,
    "queue.task.failed": `${label}: ошибка после всех попыток`,
    "queue.task.failed_permanently": `${label}: постоянная ошибка провайдера, повторы остановлены`,
    "queue.task.failed_while_paused": `${label}: ошибка во время паузы`,
    "queue.task.placeholder_used": `${label}: использована локальная заглушка`,
    "queue.task.video_fallback": `${label}: AI-видео недоступно, использован кадр с движением камеры`,
    "queue.run.completed": `Генерация завершена: ${details.completed ?? details.tasks ?? "?"} задач`,
    "queue.run.failed": `Генерация завершилась с ошибками: ${details.failed ?? "?"}`,
    "queue.run.cancelled": `Генерация остановлена: отменено ${details.cancelled ?? "?"} задач`,
    "queue.project.paused": "Генерация поставлена на паузу",
    "queue.project.resumed": "Генерация продолжена",
    "queue.project.stopped": "Генерация остановлена",
    "queue.restored_paused": `После перезапуска восстановлено на паузе: ${details.tasks ?? "?"} задач`,
    "app.session.started": "Запущена новая сессия Gold Work Studio",
    "app.ready": "Приложение готово к работе"
  };
  if (entry.message === "director.progress") return String(details.stage ?? "AI-режиссёр выполняет задачу");
  if (entry.message === "queue.task.stage") return `${label}: ${details.stage ?? "выполняется"}`;
  if (entry.message === "ui.action") return String(details.text ?? "Действие интерфейса");
  if (entry.message === "ipc.failed") return `Ошибка операции ${details.channel ?? "IPC"}`;
  if (entry.message === "ipc.result_failed") return `Проверка не пройдена: ${details.channel ?? "IPC"}`;
  if (entry.message === "network.failed") return `Сбой сети: ${details.host ?? "сервис"} · ${details.route === "proxy" ? "через прокси" : "системный маршрут"}`;
  if (entry.message === "network.response") return `Ответ ${details.host}: HTTP ${details.status} · ${details.elapsedMs} мс`;
  if (entry.message === "network.request") return `Запрос к ${details.host} · ${details.method}`;
  if (entry.message === "ipc.cancelled") return `Операция остановлена: ${details.channel ?? "IPC"}`;
  if (entry.message === "ipc.request") return `Запрос ${details.channel ?? "IPC"}`;
  if (entry.message === "ipc.success") return `Готово ${details.channel ?? "IPC"}`;
  return messages[entry.message] ?? entry.message;
}

function formatConsoleLine(entry: ConsoleLogEntry): string {
  const details = entry.details && Object.keys(entry.details).length > 0 ? ` ${JSON.stringify(entry.details)}` : "";
  return `${entry.timestamp} [${entry.level.toUpperCase()}] ${describeConsoleEntry(entry)}${details}`;
}

function ConsoleViewer({ entries, compact = false, viewState, onViewStateChange, onClear, onOpenFile }: { entries: ConsoleLogEntry[]; compact?: boolean; viewState: ConsoleViewState; onViewStateChange: (next: ConsoleViewState) => void; onClear: () => void; onOpenFile: () => void }) {
  const { query, level, autoScroll } = viewState;
  const linesRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = entries.filter((entry) => {
    if (level !== "all" && entry.level !== level) return false;
    if (!normalizedQuery) return true;
    return `${describeConsoleEntry(entry)} ${entry.message} ${JSON.stringify(entry.details ?? {})}`.toLowerCase().includes(normalizedQuery);
  });
  useEffect(() => {
    if (autoScroll && linesRef.current) linesRef.current.scrollTop = linesRef.current.scrollHeight;
  }, [filtered.length, filtered[filtered.length - 1]?.id, autoScroll]);
  const copyVisible = () => void navigator.clipboard.writeText(filtered.map(formatConsoleLine).join("\n")).catch(() => undefined);
  return (
    <div className={`console-viewer${compact ? " compact" : ""}`}>
      <div className="console-toolbar">
        <label><Search size={13} /><input value={query} onChange={(event) => onViewStateChange({ ...viewState, query: event.target.value })} placeholder="Поиск по журналу…" /></label>
        <select value={level} onChange={(event) => onViewStateChange({ ...viewState, level: event.target.value as "all" | LogLevel })}>
          <option value="all">Все уровни</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
          <option value="debug">Debug</option>
        </select>
        <button className={autoScroll ? "active" : ""} onClick={() => onViewStateChange({ ...viewState, autoScroll: !autoScroll })} title="Автопрокрутка"><ArrowDown size={13} /></button>
        <button onClick={copyVisible} title="Копировать видимые строки"><Copy size={13} /></button>
        <button onClick={onOpenFile} title="Открыть полный лог-файл"><FolderOpen size={13} /></button>
        <button onClick={onClear} title="Очистить консоль на экране"><Trash2 size={13} /></button>
        <span>{filtered.length}/{entries.length}</span>
      </div>
      <div
        className="console-lines"
        ref={linesRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          if (element.scrollHeight - element.scrollTop - element.clientHeight > 36 && autoScroll) onViewStateChange({ ...viewState, autoScroll: false });
        }}
      >
        {filtered.length === 0 && <div className="console-empty">Событий по выбранному фильтру пока нет.</div>}
        {filtered.map((entry) => (
          <div className={`console-line level-${entry.level}`} key={entry.id}>
            <time>{new Date(entry.timestamp).toLocaleTimeString("ru-RU")}</time>
            <b>{entry.level.toUpperCase()}</b>
            <span>{describeConsoleEntry(entry)}</span>
            {entry.details && Object.keys(entry.details).length > 0 && (
              <details><summary>данные</summary><pre>{JSON.stringify(entry.details, null, 2)}</pre></details>
            )}
            <LogFailureDetails entry={entry} entries={entries} onTrace={query => onViewStateChange({ query, level: "all", autoScroll: false })} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ConsoleDock({ open, queue, entries, viewState, onViewStateChange, onToggle, onClear, onOpenFile }: { open: boolean; queue: QueueTask[]; entries: ConsoleLogEntry[]; viewState: ConsoleViewState; onViewStateChange: (next: ConsoleViewState) => void; onToggle: () => void; onClear: () => void; onOpenFile: () => void }) {
  const running = queue.filter((task) => task.status === "running").length;
  return (
    <ResizableConsolePanel open={open}>
      <div className="console-head">
        <button onClick={onToggle}>
          <SquareTerminal size={14} />
          CONSOLE OUTPUT <em>{entries.length}</em>
        </button>
        <button onClick={onToggle}>очередь: {running}/{queue.length} {open ? "⌄" : "⌃"}</button>
      </div>
      {open && <ConsoleViewer entries={entries} viewState={viewState} onViewStateChange={onViewStateChange} compact onClear={onClear} onOpenFile={onOpenFile} />}
    </ResizableConsolePanel>
  );
}

function ConsolePage({ entries, viewState, onViewStateChange, onClear, onOpenFile }: { entries: ConsoleLogEntry[]; viewState: ConsoleViewState; onViewStateChange: (next: ConsoleViewState) => void; onClear: () => void; onOpenFile: () => void }) {
  return (
    <div className="console-page">
      <PageHeading icon={<SquareTerminal size={24} />} title="Консоль" subtitle="События сценария, генерации, провайдеров, повторных попыток и сборки" />
      <ConsoleViewer entries={entries} viewState={viewState} onViewStateChange={onViewStateChange} onClear={onClear} onOpenFile={onOpenFile} />
    </div>
  );
}

function SettingsPanel({
  icon,
  title,
  summary,
  collapsible = false,
  defaultOpen = true,
  children,
}: {
  icon: ReactNode;
  title: string;
  summary?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`settings-panel${collapsible ? " collapsible" : ""}${open ? " open" : " collapsed"}`}>
      <header>
        <div>
          <h2>
            {icon}
            {title}
          </h2>
          {summary && <p>{summary}</p>}
        </div>
        {collapsible && (
          <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {open ? "Свернуть" : "Настроить"}
            <ChevronLeft size={15} />
          </button>
        )}
      </header>
      {open && <div className="panel-content">{children}</div>}
    </section>
  );
}
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>
        {label}
        {hint && <i className="field-hint" title={hint}>?</i>}
      </span>
      {children}
    </label>
  );
}
function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="toggle-row">
      <span>
        {label}
        {hint && <i className="field-hint" title={hint}>?</i>}
      </span>
      <button className={`toggle${checked ? " on" : ""}`} onClick={() => onChange(!checked)} aria-pressed={checked}>
        <i />
      </button>
    </div>
  );
}
function PageHeading({ icon, title, subtitle, actions }: { icon: ReactNode; title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <header className="page-heading">
      <div className="page-title-icon">{icon}</div>
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </header>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}
function EmptyState({ icon, title, text, action, onAction }: { icon: ReactNode; title: string; text: string; action: string; onAction: () => void }) {
  return (
    <section className="empty-state">
      {icon}
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="outline-button" onClick={onAction}>
        <Plus size={15} />
        {action}
      </button>
    </section>
  );
}
function errorMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "Произошла неизвестная ошибка";
  return message
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
}
function formatTimestamp(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
function taskStatusLabel(status: QueueTask["status"]) {
  return (
    {
      pending: "Ожидает",
      running: "Выполняется",
      retry_wait: "Ждёт повтора",
      paused: "Пауза",
      blocked: "Заблокировано",
      done: "Готово",
      failed: "Ошибка",
      cancelled: "Остановлено",
    } satisfies Record<QueueTask["status"], string>
  )[status];
}
