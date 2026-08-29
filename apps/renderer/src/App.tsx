import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bot, Bookmark, Captions, Check, ChevronLeft, CircleUserRound, Clapperboard, Clock3, Copy, Download, Eye, EyeOff, FileText, Folder, FolderOpen, GripVertical, Grid2X2, Image, Languages, LayoutDashboard, Lightbulb, ListPlus, LogOut, Mic2, MoreHorizontal, Music2, Paperclip, Pause, Play, Plus, RotateCcw, Save, Search, Send, Settings, SlidersHorizontal, Sparkles, Square, SquareTerminal, Trash2, Upload, Video, Volume2, WandSparkles, X, Zap } from "lucide-react";
import { allocateSceneDurations, createDefaultProjectSettings, IMAGE_STYLES, parseExplicitDurationSeconds, parsePastedTranscript, ttsLanguageCode, TTS_VOICES, type AnyModelSettings, type ChatTopicSummary, type ConsoleLogEntry, type DesktopApi, type GoogleSettings, type LogLevel, type Project, type ProjectSettings, type QueueTask, type ReferenceAnalysis, type Scene, type SubtitleSettings, type UpdateProjectInput, type VoicerSettings, type VoicerTemplate, type YouTubeSettings } from "@gold-work/shared";
import { fallbackApi } from "./fallback-api";
import { io } from "socket.io-client";

type SectionKey = "dashboard" | "project" | "scenario" | "clone" | "director" | "projects" | "subtitles" | "thumbnail" | "avatar" | "seo" | "studio" | "queue" | "console" | "settings";
type Overlay = { type: "preview" | "timeline"; projectId: string };

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
    label: "ГЛАВНОЕ",
    items: [
      {
        key: "dashboard",
        title: "Dashboard",
        icon: <LayoutDashboard size={17} />,
      },
      { key: "project", title: "Проект", icon: <Clapperboard size={17} /> },
      { key: "scenario", title: "Сценарий", icon: <FileText size={17} /> },
      { key: "clone", title: "Клон YouTube", icon: <Copy size={17} /> },
      {
        key: "director",
        title: "AI Генератор",
        icon: <WandSparkles size={17} />,
      },
      { key: "projects", title: "Проекты", icon: <FolderOpen size={17} /> },
    ],
  },
  {
    label: "ИНСТРУМЕНТЫ",
    items: [
      { key: "subtitles", title: "Субтитры", icon: <Captions size={17} /> },
      { key: "thumbnail", title: "Превью", icon: <Image size={17} /> },
      { key: "avatar", title: "Аватарка", icon: <CircleUserRound size={17} /> },
      { key: "seo", title: "SEO", icon: <Search size={17} /> },
      {
        key: "studio",
        title: "Студия",
        icon: <Sparkles size={17} />,
        beta: true,
      },
      {
        key: "queue",
        title: "Очередь",
        icon: <ListPlus size={17} />,
        beta: true,
      },
      { key: "console", title: "Консоль", icon: <SquareTerminal size={17} /> },
    ],
  },
];

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
  const [activeSection, setActiveSection] = useState<SectionKey>("dashboard");
  const [projects, setProjects] = useState<Project[]>([]);
  const [queue, setQueue] = useState<QueueTask[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [appInfo, setAppInfo] = useState<Awaited<ReturnType<DesktopApi["getAppInfo"]>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [progressCollapsed, setProgressCollapsed] = useState(false);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleLogEntry[]>([]);
  const [consoleView, setConsoleView] = useState<ConsoleViewState>({ query: "", level: "all", autoScroll: true });
  const consoleHistoryGeneration = useRef(0);
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const socketConnectedRef = useRef(false);
  const [directorProgress, setDirectorProgress] = useState<string | null>(null);
  useEffect(() => api.onDirectorProgress((stage) => setDirectorProgress(stage)), []);

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
  const overlayProject = overlay ? projects.find((project) => project.id === overlay.projectId) : undefined;

  useEffect(() => {
    let mounted = true;
    async function initialLoad() {
      try {
        const [loadedProjects, loadedQueue, info] = await Promise.all([api.listProjects(), api.getQueue(), api.getAppInfo()]);
        if (!mounted) return;
        setProjects(loadedProjects);
        setQueue(loadedQueue);
        setAppInfo(info);
        setSelectedProjectId((current) => (current && loadedProjects.some((project) => project.id === current) ? current : (loadedProjects[0]?.id ?? null)));
      } catch (reason) {
        if (mounted) setError(errorMessage(reason));
      }
    }
    void initialLoad();
    const polling = window.setInterval(() => {
      // Пока живёт сокет — очередь приходит push-ем; при обрыве переходим на поллинг, чтобы прогресс не замерзал.
      const queueRequest = window.goldWork && socketConnectedRef.current ? Promise.resolve<QueueTask[] | null>(null) : api.getQueue();
      void Promise.all([queueRequest, api.listProjects()])
        .then(([tasks, items]) => {
          if (!mounted) return;
          if (tasks) setQueue(tasks);
          setProjects(items);
          setSelectedProjectId((current) => (current && items.some((project) => project.id === current) ? current : (items[0]?.id ?? null)));
        })
        .catch(() => undefined);
    }, 750);
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
    void api.writeLog("info", "ui.mounted");
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

  function upsertProject(project: Project) {
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
    setSelectedProjectId(project.id);
  }

  async function refresh() {
    const [items, tasks] = await Promise.all([api.listProjects(), api.getQueue()]);
    setProjects(items);
    setQueue(tasks);
    setSelectedProjectId((current) => (current && items.some((project) => project.id === current) ? current : (items[0]?.id ?? null)));
  }

  async function createProject(withDemoScenes = false) {
    setBusy(true);
    setError(null);
    try {
      const project = withDemoScenes
        ? await api.createDemoProject()
        : await api.createProject({
            title: `Новый проект ${projects.length + 1}`,
            topic: "Опишите тему нового видео",
            aspectRatio: "16:9",
            language: "Русский",
            mode: "standard",
          });
      upsertProject(project);
      setActiveSection(withDemoScenes ? "project" : "scenario");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function createProjectFromChat(topicId?: string) {
    if (!topicId) {
      await createProject(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject({
        title: "Новый сценарий из AI-чата",
        topic: "Тема будет определена по сохранённому диалогу",
        aspectRatio: "16:9",
        language: "Русский",
        mode: "standard"
      });
      const updated = await api.applyChatTopicToProject(project.id, topicId);
      upsertProject(updated);
      setActiveSection("project");
      setNotice(`Проект создан из диалога: ${updated.scenes.length} сцен. При необходимости выберите другую длину и пересоберите сценарий.`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function createReferenceProject(analysis: ReferenceAnalysis) {
    setBusy(true);
    setError(null);
    try {
      const project = await api.createReferenceProject({ analysis, aspectRatio: "16:9", mode: "standard" });
      upsertProject(project);
      setSelectedProjectId(project.id);
      setActiveSection("project");
      setNotice("Проект создан: сценарий подставлен. Проверьте настройки и нажмите «Генерировать видео».");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function acceptYouTubeAnalysis(analysis: ReferenceAnalysis) {
    setBusy(true);
    setError(null);
    try {
      // Если пользователь не задавал длину, в разборе лежит короткое превью сцен —
      // собираем полный сценарий под длину оригинала (+ ~1.5 мин) перед созданием проекта.
      let finalAnalysis = analysis;
      const targetSeconds = (analysis.youtubeContext?.durationSeconds ?? 0) + 90;
      const expectedScenes = allocateSceneDurations(targetSeconds).length;
      if (targetSeconds > 90 && analysis.scenes.length < Math.min(expectedScenes, 9)) {
        setNotice(`Собираю полный сценарий под длину оригинала (~${Math.round(targetSeconds / 60)} мин, ${expectedScenes} сцен)…`);
        finalAnalysis = await api.regenerateReferenceScenes(analysis, targetSeconds);
      }
      const project = await api.createReferenceProject({ analysis: finalAnalysis, aspectRatio: "16:9", mode: "standard" });
      upsertProject(project);
      setSelectedProjectId(project.id);
      setActiveSection("project");
      await refresh();
      setNotice("Проект создан: сценарий подставлен. Проверьте настройки и запустите генерацию кнопкой в проекте.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  /** Пересборка только Final.mp4 из готовых материалов — без перегенерации картинок и озвучки. */
  async function reassembleProject(id: string) {
    setError(null);
    try {
      await api.assembleProject(id);
      setNotice("Пересборка Final.mp4 запущена — прогресс в очереди.");
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    }
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
  async function createProjectFromTopic(analysis: ReferenceAnalysis) {
    setError(null);
    // Сбрасываем устаревший текст прогресса анализа — иначе он залипает в подсказке нового проекта.
    setDirectorProgress(null);
    try {
      const project = await api.createReferenceProject({ analysis, aspectRatio: "16:9", mode: "standard" });
      upsertProject(project);
      setSelectedProjectId(project.id);
      setActiveSection("project");
      logAction(`Проект «${project.title}» создан`);
      setNotice(project.scenes.length > 0
        ? `Проект открыт: ${project.scenes.length} сцен. Проверьте настройки и запустите генерацию.`
        : "Проект открыт. Выберите длину и язык (кнопки с флагами) и нажмите «Собрать сценарий».");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

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

  async function applyChatTopic(projectId: string, topicId: string) {
    setError(null);
    try {
      const project = await api.applyChatTopicToProject(projectId, topicId);
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
    if (!window.confirm(`Удалить проект «${project?.title ?? id}»?`)) return;
    try {
      await api.deleteProject(id);
      if (overlay?.projectId === id) setOverlay(null);
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  function openProject(id: string, section: SectionKey = "project") {
    setSelectedProjectId(id);
    setActiveSection(section);
  }

  async function startGeneration(id: string) {
    setBusy(true);
    logAction(`Запуск генерации проекта ${id}`);
    try {
      await api.startGeneration(id);
      setSelectedProjectId(id);
      setActiveSection("queue");
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

  async function regenerateScene(projectId: string, sceneId: string | string[], target: "image" | "video" | "audio" | "all" = "all") {
    setBusy(true);
    try {
      await api.regenerateScene(projectId, sceneId, target);
      setNotice(target === "image" ? "Перегенерация изображения запущена." : target === "video" ? "Перегенерация AI-видео запущена." : "Перегенерация сцены запущена.");
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
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
    if (section === "settings") void api.getAppInfo().then(setAppInfo);
  }

  return (
    <div className="desktop-frame">
      <TitleBar />
      <div className="app-body">
        <Sidebar active={activeSection} onNavigate={navigate} onInfo={setNotice} />
        <section className="work-area">
          <div className="top-strips">
            {!window.goldWork && (
              <div className="demo-banner">
                <X size={13} />
                Демо-режим: нет связи с Electron, все данные и анализы — выдуманные. Реальные функции недоступны.
              </div>
            )}
            <StepHintBar hint={computeStepHint(appInfo, selectedProject, queue, activeSection, directorProgress)} onNavigate={navigate} />
          </div>
          <div className={`page-scroll${activeSection === "director" ? " director-scroll" : ""}`} ref={pageScrollRef}>
            {activeSection === "dashboard" && <Dashboard projects={projects} selectedId={selectedProject?.id} busy={busy} onCreate={() => void createProject()} onOpen={openProject} onDelete={(id) => void deleteProject(id)} onPreview={(id) => setOverlay({ type: "preview", projectId: id })} onGenerate={(id) => void startGeneration(id)} onNavigate={navigate} onOpenFolder={(id) => void openProjectFolder(id)} />}
            <div className={activeSection === "project" ? "section-host" : "hidden-section"}>
              <ProjectEditor project={selectedProject} busy={busy} onBack={() => navigate("dashboard")} onSave={saveProject} onApplyChatTopic={applyChatTopic} onGenerate={(id) => void startGeneration(id)} onNavigate={navigate} onInfo={setNotice} />
            </div>
            {activeSection === "scenario" && <ScenarioEditor project={selectedProject} onSave={saveProject} onRegenerateImage={(sceneId) => regenerateScene(selectedProject?.id ?? "", sceneId, "image")} onBack={() => navigate("project")} />}
            {activeSection === "subtitles" && <SubtitleStudio project={selectedProject} onSave={saveProject} />}
            {/* Director всегда смонтирован (скрывается CSS): чат и разбор не пропадают при переключении вкладок.
                display:contents — обёртка не создаёт свой блок и не ломает растяжение чата по высоте. */}
            <div className={activeSection === "director" ? "section-host" : "hidden-section"}>
              <Director busy={busy} onCreate={(topicId) => void createProjectFromChat(topicId)} onPickTopic={(analysis) => void createProjectFromTopic(analysis)} onInfo={setNotice} onLog={logAction} />
            </div>
            {activeSection === "projects" && <ProjectsPage projects={projects} busy={busy} onCreate={() => void createProject()} onOpen={openProject} onDuplicate={(id) => void duplicateProject(id)} onDelete={(id) => void deleteProject(id)} onPreview={(id) => setOverlay({ type: "preview", projectId: id })} onTimeline={(id) => setOverlay({ type: "timeline", projectId: id })} onGenerate={(id) => void startGeneration(id)} onAssemble={(id) => void reassembleProject(id)} onOpenFolder={(id) => void openProjectFolder(id)} onSave={saveProject} />}
            {activeSection === "queue" && <QueuePage tasks={queue} projects={projects} onPause={(id) => void queueAction(() => api.pauseGeneration(id))} onResume={(id) => void queueAction(() => api.resumeGeneration(id))} onStop={(id) => void queueAction(() => api.stopGeneration(id))} onRetry={(id) => void queueAction(() => api.retryTask(id))} onClear={() => void queueAction(() => api.clearFinishedTasks())} />}
            {activeSection === "console" && <ConsolePage entries={consoleEntries} viewState={consoleView} onViewStateChange={setConsoleView} onClear={clearConsole} onOpenFile={() => void api.openLogFile()} />}
            {activeSection === "settings" && <SettingsPage appInfo={appInfo} />}
            {!(["dashboard", "project", "scenario", "subtitles", "director", "projects", "queue", "console", "settings"] as SectionKey[]).includes(activeSection) && <ToolPage section={activeSection} onAction={() => setNotice("Этот инструмент подключим после добавления соответствующего API. Экран уже готов к интеграции.")} />}
          </div>
          <GlobalProgressBar
            tasks={queue}
            projects={projects}
            collapsed={progressCollapsed}
            onToggle={() => setProgressCollapsed((value) => !value)}
            onOpen={(projectId) => {
              setSelectedProjectId(projectId);
              setActiveSection("queue");
            }}
          />
          <ConsoleDock open={consoleOpen} queue={queue} entries={consoleEntries} viewState={consoleView} onViewStateChange={setConsoleView} onToggle={() => setConsoleOpen((value) => !value)} onClear={clearConsole} onOpenFile={() => void api.openLogFile()} />
        </section>
      </div>
      {overlay && overlayProject && (
        <ProjectPreviewModal
          project={overlayProject}
          initialMode={overlay.type}
          onClose={() => setOverlay(null)}
          onRegenerate={(sceneId, target) => regenerateScene(overlayProject.id, sceneId, target)}
          onOpenFolder={() => void openProjectFolder(overlayProject.id)}
          onAssemble={() => reassembleProject(overlayProject.id)}
          onSave={saveProject}
          onEditScenario={() => {
            setOverlay(null);
            setSelectedProjectId(overlayProject.id);
            navigate("scenario");
          }}
          onToggleScene={(sceneId, include) => void toggleSceneAssembly(overlayProject.id, sceneId, include)}
        />
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
  );
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

const CLAUDE_CHAT_MODELS = [
  { id: "cc/claude-opus-5", label: "Claude Opus 5" },
  { id: "ag/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "cc/claude-opus-4-8", label: "Claude Opus 4.8" },
] as const;

/** Приводит голос проекта к id каталога: старые голые имена → edge-tts/, "custom" и пустое → глобальная настройка. */
function normalizeVoiceId(voice: string): string {
  const value = (voice ?? "").trim();
  if (!value || value === "custom") return "";
  if (value.includes("/") || value === "google-tts") return value;
  return `edge-tts/${value}`;
}

/** Компактная сводка данных YouTube для чата: модель отвечает реальными цифрами, а не догадками. */
function youtubeChatContext(analysis: ReferenceAnalysis): string | null {
  const video = analysis.youtubeContext;
  const channel = analysis.youtubeChannelContext;
  if (!video && !channel) return null;
  const payload = video
    ? {
        video: { title: video.title, views: video.views, likes: video.likes, comments: video.commentCount, publishedAt: video.publishedAt, durationSeconds: video.durationSeconds },
        channel: { title: video.channelTitle, subscribers: video.channelSubscribers, totalViews: video.channelViews, videoCount: video.channelVideoCount },
        topVideos: video.topVideos.slice(0, 10),
        topComments: video.topComments.slice(0, 10),
        transcriptSource: video.transcriptSource,
        transcript: video.transcript.map((segment) => `[${formatTimestamp(segment.startSeconds)}] ${segment.text}`).join(" ").slice(0, 12_000),
      }
    : {
        channel: { title: channel!.title, subscribers: channel!.subscribers, totalViews: channel!.totalViews, videoCount: channel!.videoCount },
        videosTimeline: channel!.videos.slice(0, 30),
        topComments: channel!.topComments.slice(0, 15),
      };
  return `Реальные данные YouTube по текущему разбору — отвечай по ним точными цифрами, ничего не выдумывай:\n${JSON.stringify(payload)}`;
}

function directorChatContext(analysis: ReferenceAnalysis): string {
  const summary = {
    title: analysis.suggestedTitle,
    niche: analysis.niche,
    audience: analysis.targetAudience,
    hook: analysis.hook,
    structure: analysis.structure,
    strengths: analysis.strengths,
    improvements: analysis.improvements,
    angle: analysis.suggestedAngle,
    instructions: analysis.instructions,
    sceneCount: analysis.scenes.length,
  };
  return [
    "Это продолжение текущей темы Gold Work Studio. Учитывай весь диалог и сохранённый разбор. Отвечай прямо на последнюю реплику пользователя; не сбрасывай тему и не выдумывай отсутствующие данные.",
    `Текущий разбор: ${JSON.stringify(summary)}`,
    youtubeChatContext(analysis),
  ].filter(Boolean).join("\n\n");
}

function wantsScenarioGeneration(text: string): boolean {
  return /(напиш|созда|собер|сдела)\w*/i.test(text) && /(сценар|ролик|short)/i.test(text);
}

function compactDirectorHistory(messages: Array<{ role: "user" | "assistant" | "system"; content: string }>) {
  return messages.slice(-20).map((message) => {
    if (message.role === "user" && parsePastedTranscript(message.content).length > 0) {
      return { ...message, content: "[Пользователь вставил полную транскрипцию; её текст сохранён в текущем разборе.]" };
    }
    return { ...message, content: message.content.slice(0, 8_000) };
  });
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
      next: "вставите ссылку на видео или канал в AI Генераторе и получите разбор с 3 темами",
      action: { label: "Открыть настройки", section: "settings" },
    };
  }
  if (project?.status === "generating") {
    const tasks = queue.filter((task) => task.projectId === project.id);
    const done = tasks.filter((task) => task.status === "done").length;
    const percent = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
    const readyScenes = project.scenes.filter((scene) => scene.status === "ready").length;
    return {
      now: `идёт генерация «${project.title}»: ${percent}% — сцен готово ${readyScenes} из ${project.scenes.length}`,
      next: "когда все сцены будут готовы, соберётся Final.mp4",
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
    return {
      now: `«${project.title}» готов — Final.mp4 собран`,
      next: "откройте предпросмотр или папку проекта, либо начните новый разбор в AI Генераторе",
      action: { label: "К проектам", section: "projects" },
    };
  }
  if (project?.status === "failed") {
    return {
      now: `в «${project.title}» есть незавершённые или упавшие задачи`,
      next: "откройте Очередь и повторите упавшие задачи или запустите генерацию заново",
      action: { label: "Открыть очередь", section: "queue" },
    };
  }
  if (activeSection === "project" && project) {
    if (project.scenes.length === 0) {
      return {
        now: directorProgress ?? "выберите длину ролика и язык (кнопки с флагами) и нажмите «Собрать сценарий»",
        next: "когда сцены появятся, проверьте текст и нажмите «Генерировать видео»",
      };
    }
    return {
      now: `проверьте сцены (${project.scenes.length} шт.) и настройки: язык, формат, озвучка, референсы`,
      next: "нажмите «Генерировать видео» — по сценам сгенерируются картинки и озвучка",
    };
  }
  if (activeSection === "director") {
    return {
      now: "вставьте ссылку на видео или канал YouTube и напишите задачу: «повтори ролик», «проанализируй канал»",
      next: "получите разбор и 3 темы — по выбранной теме соберётся сценарий и откроется проект",
    };
  }
  if (!project) {
    return {
      now: "начните с разбора: вставьте ссылку на видео или канал в AI Генераторе",
      next: "по выбранной теме соберётся проект со сценами",
      action: { label: "Открыть AI Генератор", section: "director" },
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

function GlobalProgressBar({ tasks, projects, collapsed, onToggle, onOpen }: { tasks: QueueTask[]; projects: Project[]; collapsed: boolean; onToggle: () => void; onOpen: (projectId: string) => void }) {
  const activeStatuses = new Set<QueueTask["status"]>(["pending", "running", "retry_wait", "paused", "blocked"]);
  const activeRunIds = new Set(tasks.filter((task) => activeStatuses.has(task.status)).map((task) => task.runId));
  const relevant = tasks.filter((task) => activeRunIds.has(task.runId));
  if (relevant.length === 0) return null;
  const projectId = relevant.find((task) => activeStatuses.has(task.status))?.projectId ?? relevant[0]?.projectId;
  if (!projectId) return null;
  const project = projects.find((item) => item.id === projectId);
  const summary = (kind: QueueTask["kind"]) => {
    const items = relevant.filter((task) => task.kind === kind);
    return { total: items.length, done: items.filter((task) => task.status === "done").length, progress: items.length ? Math.round(items.reduce((sum, task) => sum + (task.status === "done" ? 100 : task.progress), 0) / items.length) : 0 };
  };
  const images = summary("image");
  const speech = summary("speech");
  const assembly = summary("assemble");
  const overall = Math.round(relevant.reduce((sum, task) => sum + (task.status === "done" ? 100 : task.progress), 0) / relevant.length);
  return (
    <section className={`global-progress${collapsed ? " collapsed" : ""}`}>
      <button className="global-progress-head" onClick={onToggle}>
        <span><Zap size={14} />{project?.title ?? "Генерация"}</span>
        <strong>{overall}%</strong>
        <span>{collapsed ? "⌃" : "⌄"}</span>
      </button>
      {!collapsed && (
        <div className="global-progress-stages">
          {images.total > 0 && <button onClick={() => onOpen(projectId)}><Image size={14} /><span>Картинки <b>{images.done}/{images.total}</b></span><i><em style={{ width: `${images.progress}%` }} /></i></button>}
          {speech.total > 0 && <button onClick={() => onOpen(projectId)}><Mic2 size={14} /><span>Озвучка <b>{speech.done}/{speech.total}</b></span><i><em style={{ width: `${speech.progress}%` }} /></i></button>}
          {assembly.total > 0 && <button onClick={() => onOpen(projectId)}><Clapperboard size={14} /><span>Сборка <b>{assembly.progress}%</b></span><i><em style={{ width: `${assembly.progress}%` }} /></i></button>}
        </div>
      )}
    </section>
  );
}

function TitleBar() {
  const api = window.goldWork ?? fallbackApi;
  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span>GW</span>
        <strong>GOLDWORK STUDIO</strong>
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

function Sidebar({ active, onNavigate, onInfo }: { active: SectionKey; onNavigate: (section: SectionKey) => void; onInfo: (message: string) => void }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-nav">
        {navigation.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map((item) => (
              <button key={item.key} className={`nav-item${active === item.key ? " active" : ""}`} onClick={() => onNavigate(item.key)}>
                {item.icon}
                <span>{item.title}</span>
                {item.beta && <em>BETA</em>}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <div className="profile-card">
          <div>
            <CircleUserRound size={16} />
            <strong>Owner</strong>
            <span>PRO</span>
          </div>
          <small>Локальный профиль</small>
          <button onClick={() => onInfo("Авторизация пока не используется: профиль и все данные хранятся только на этом компьютере.")}>
            <LogOut size={14} />
            Выйти
          </button>
        </div>
        <button className={`settings-link${active === "settings" ? " active" : ""}`} onClick={() => onNavigate("settings")}>
          <Settings size={17} />
          Настройки
        </button>
        <div className="app-stats">
          <span>
            <i />
            Готов
          </span>
          <span>GoldWork Studio v0.2.0</span>
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
      title: "Субтитры",
      subtitle: "POP WORDS стиль",
      icon: <Captions size={19} />,
      route: "subtitles",
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

function ProjectEditor({ project, busy, onBack, onSave, onApplyChatTopic, onGenerate, onNavigate, onInfo }: { project?: Project; busy: boolean; onBack: () => void; onSave: (id: string, input: UpdateProjectInput) => Promise<Project>; onApplyChatTopic: (projectId: string, topicId: string) => Promise<Project>; onGenerate: (id: string) => void; onNavigate: (section: SectionKey) => void; onInfo: (message: string) => void }) {
  const api = window.goldWork ?? fallbackApi;
  const [draft, setDraft] = useState<Project | null>(project ? structuredClone(project) : null);
  const [saving, setSaving] = useState(false);
  const [chatTopics, setChatTopics] = useState<ChatTopicSummary[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState(project?.chatTopicId ?? "");
  const [applyingTopic, setApplyingTopic] = useState(false);
  const [samplePlaying, setSamplePlaying] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [heroBuilding, setHeroBuilding] = useState(false);
  const [heroPreview, setHeroPreview] = useState<{ name: string; prompt: string; imagePath: string } | null>(null);
  const [heroElapsedSeconds, setHeroElapsedSeconds] = useState(0);
  const [scenarioProgress, setScenarioProgress] = useState<string | null>(null);
  useEffect(() => api.onDirectorProgress((text) => setScenarioProgress(text)), []);
  useEffect(() => {
    if (!heroBuilding) {
      setHeroElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => setHeroElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, [heroBuilding]);
  const [voicerTemplates, setVoicerTemplates] = useState<VoicerTemplate[] | null>(null);
  useEffect(() => {
    if (draft?.settings.voice.provider !== "elevenlabs" || voicerTemplates !== null) return;
    api.listVoicerTemplates().then(setVoicerTemplates).catch(() => setVoicerTemplates([]));
  }, [draft?.settings.voice.provider, voicerTemplates]);
  useEffect(() => {
    setDraft(project ? structuredClone(project) : null);
    setHeroPreview(null);
  }, [project?.id]);
  useEffect(() => {
    setSelectedTopicId(project?.chatTopicId ?? "");
  }, [project?.id, project?.chatTopicId]);
  // Фоновые обновления (сборка сценария, генерация) вливаются в черновик, НЕ затирая редактируемый текст.
  useEffect(() => {
    if (!project) return;
    setDraft((current) => {
      if (!current || current.id !== project.id) return structuredClone(project);
      const incoming = structuredClone(project);
      const sameSceneSet = current.scenes.length === incoming.scenes.length
        && current.scenes.every((scene, index) => scene.id === incoming.scenes[index]?.id);
      const scenes = sameSceneSet
        ? incoming.scenes.map((scene, index) => {
            const edited = current.scenes[index]!;
            return { ...scene, title: edited.title, narration: edited.narration, imagePrompt: edited.imagePrompt, animationPrompt: edited.animationPrompt, durationSeconds: edited.durationSeconds };
          })
        : incoming.scenes;
      return { ...current, status: incoming.status, outputPath: incoming.outputPath, updatedAt: incoming.updatedAt, scenes };
    });
  }, [project?.id, project?.updatedAt]);
  useEffect(() => {
    void api.listChatTopics().then(setChatTopics).catch(() => setChatTopics([]));
  }, []);
  if (!draft) return <EmptyState icon={<Clapperboard size={34} />} title="Проект не выбран" text="Создайте проект на Dashboard или выберите его в списке." action="Вернуться на Dashboard" onAction={onBack} />;
  const settings = draft.settings ?? createDefaultProjectSettings();
  const setSettings = (patch: Partial<ProjectSettings>) => setDraft((current) => (current ? { ...current, settings: { ...current.settings, ...patch } } : current));
  const save = async (): Promise<Project | undefined> => {
    setSaving(true);
    try {
      return await onSave(draft.id, {
        title: draft.title,
        topic: draft.topic,
        language: draft.language,
        aspectRatio: draft.aspectRatio,
        mode: draft.mode,
        settings: draft.settings,
        chatTopicId: draft.chatTopicId,
      });
    } catch {
      // Корневой компонент уже показывает понятное сообщение об ошибке.
      return undefined;
    } finally {
      setSaving(false);
    }
  };
  const generate = async () => {
    const saved = await save();
    if (saved) onGenerate(saved.id);
  };
  const saveAndNavigate = async (section: SectionKey) => {
    const saved = await save();
    if (saved) onNavigate(section);
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
    const [path] = await api.pickFiles("audio");
    if (!path) return;
    setSettings({ music: { ...settings.music, path } });
    onInfo("Фоновая музыка добавлена в проект.");
  };
  /** Пересобирает сцены под текущую длину и язык проекта (нужен сохранённый разбор — referenceAnalysis). */
  const rebuildScenario = async () => {
    if (!draft.referenceAnalysis) return;
    setScenarioProgress(null);
    setRebuilding(true);
    try {
      const saved = await save();
      if (!saved) return;
      const targetSeconds = Math.max(30, Math.round((saved.settings.durationMinutes || 1) * 60));
      const full = await api.regenerateReferenceScenes({ ...draft.referenceAnalysis, language: saved.language }, targetSeconds);
      const updated = await onSave(saved.id, { scenes: full.scenes });
      setDraft(structuredClone(updated));
      onInfo(`Сценарий пересобран: ${full.scenes.length} сцен, язык — ${saved.language}.`);
    } catch (reason) {
      onInfo(`Не удалось пересобрать сценарий: ${errorMessage(reason)}`);
    } finally {
      setRebuilding(false);
    }
  };
  /** Портрет главного героя по сценарию → в референсы: все сцены рисуются с одинаковым персонажем. */
  const createHero = async () => {
    setScenarioProgress(null);
    setHeroBuilding(true);
    try {
      const saved = await save();
      if (!saved) return;
      const result = await api.createCharacterReference(saved.id);
      setDraft(structuredClone(result.project));
      setHeroPreview(result.character);
      onInfo("Референс героя создан и добавлен — сцены будут генерироваться с одинаковым персонажем.");
    } catch (reason) {
      onInfo(`Не удалось создать референс героя: ${errorMessage(reason)}`);
    } finally {
      setHeroBuilding(false);
    }
  };
  const projectLanguageCode = ttsLanguageCode(draft.language).split("-")[0]?.toLowerCase() ?? "en";
  const voiceOptions = TTS_VOICES.filter((voice) => voice.language === "any" || voice.language === projectLanguageCode);
  const playVoiceSample = async () => {
    setSamplePlaying(true);
    try {
      const base64 = settings.voice.provider === "elevenlabs"
        ? await api.voicerSample(settings.voice.voice?.trim() || undefined, ttsLanguageCode(draft.language))
        : await api.ttsSample(normalizeVoiceId(settings.voice.voice), ttsLanguageCode(draft.language));
      const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
      audio.onended = () => setSamplePlaying(false);
      audio.onerror = () => setSamplePlaying(false);
      await audio.play();
    } catch (reason) {
      setSamplePlaying(false);
      onInfo(`Не удалось получить пример голоса: ${errorMessage(reason)}`);
    }
  };
  const applyTopic = async (startGeneration: boolean) => {
    if (!selectedTopicId) return;
    setApplyingTopic(true);
    try {
      const updated = await onApplyChatTopic(draft.id, selectedTopicId);
      setDraft(structuredClone(updated));
      onInfo(`Тема чата применена: создано сцен ${updated.scenes.length}.`);
      if (startGeneration) onGenerate(updated.id);
    } finally {
      setApplyingTopic(false);
    }
  };
  return (
    <div className="project-page page-with-actionbar">
      {heroPreview && <CharacterReferenceModal character={heroPreview} imageUrl={api.mediaUrl(heroPreview.imagePath)} onClose={() => setHeroPreview(null)} />}
      <PageHeading
        icon={
          <button className="back-icon" onClick={onBack}>
            <ChevronLeft size={22} />
          </button>
        }
        title={draft.title}
        subtitle="Настройки генерации видео"
      />
      <div className="preset-bar">
        <Bookmark size={16} />
        <span>Пресет:</span>
        <select>
          <option>Рабочий пресет проекта</option>
        </select>
        <button title="Вернуть сохранённые настройки" onClick={restoreSavedSettings}>
          <Download size={16} />
        </button>
        <button title="Сохранить" onClick={() => void save()}>
          <Save size={16} />
        </button>
      </div>
      <div className="chat-topic-source">
        <div>
          <FileText size={16} />
          <span>Тема из чата режиссёра</span>
          <select value={selectedTopicId} onChange={(event) => setSelectedTopicId(event.target.value)}>
            <option value="">Выберите сохранённый диалог...</option>
            {chatTopics.map((topic) => (
              <option key={topic.id} value={topic.id}>{topic.title} · {topic.messageCount} сообщ.</option>
            ))}
          </select>
        </div>
        <button className="outline-button small" disabled={!selectedTopicId || applyingTopic || busy} onClick={() => void applyTopic(false)}>
          <WandSparkles size={14} />
          {applyingTopic ? "Строим..." : "Построить пресет"}
        </button>
        <button className="generate-button compact" disabled={!selectedTopicId || applyingTopic || busy} onClick={() => void applyTopic(true)}>
          <Zap size={14} />
          Создать и запустить
        </button>
      </div>
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
          <Field label="ДЛИТЕЛЬНОСТЬ ВИДЕО" hint="Целевая длина ролика. До 200 сцен; в длинных роликах сцены автоматически становятся длиннее. После смены пересоберите сценарий.">
            <div className="choice-row">
              {[0.5, 1, 5, 10, 15, 30, 60].map((value) => (
                <button className={settings.durationMinutes === value ? "selected" : ""} onClick={() => setSettings({ durationMinutes: value })} key={value}>
                  {value < 1 ? "30с" : `${value}м`}
                </button>
              ))}
            </div>
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={settings.durationMinutes}
              onChange={(event) => setSettings({ durationMinutes: Math.max(0.5, Number(event.target.value) || 0.5) })}
            />
            <small>Своя длина в минутах — если пресеты не подходят.</small>
          </Field>
          {draft.referenceAnalysis && (
            <button className={draft.scenes.length === 0 ? "generate-button" : "outline-button small"} disabled={busy || saving || rebuilding} onClick={() => void rebuildScenario()}>
              <RotateCcw size={15} />
              {rebuilding ? "Пишу сценарий…" : draft.scenes.length === 0 ? "Собрать сценарий" : "Пересобрать сценарий под длину и язык"}
            </button>
          )}
          {draft.scenes.length > 0 && (
            <Field label={`ТЕКСТ СЦЕНАРИЯ (${draft.scenes.length} СЦЕН)`} hint="Текст озвучки каждой сцены. Полное редактирование — в разделе «Сценарий».">
              <div className="scenario-preview">
                {draft.scenes.slice(0, 6).map((scene) => (
                  <p key={scene.id}><b>{scene.order + 1}.</b> {scene.narration || "— без текста —"}</p>
                ))}
                {draft.scenes.length > 6 && <p>…и ещё {draft.scenes.length - 6} сцен</p>}
              </div>
              <button className="outline-button small" onClick={() => void saveAndNavigate("scenario")}>
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
                      voice: { ...settings.voice, provider: event.target.value as ProjectSettings["voice"]["provider"], voice: "" },
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
                      onClick={() => setSettings({ voice: { ...settings.voice, voice: "" } })}
                    >
                      Первый доступный
                    </button>
                    {(voicerTemplates ?? []).map((template) => (
                      <button
                        key={template.uuid}
                        className={settings.voice.voice === template.uuid ? "selected" : ""}
                        onClick={() => setSettings({ voice: { ...settings.voice, voice: template.uuid } })}
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
                        voice: { ...settings.voice, voice: event.target.value },
                      })
                    }
                  >
                    <option value="">Как в общих настройках (Google TTS)</option>
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
                disabled={samplePlaying || (settings.voice.provider !== "elevenlabs" && !normalizeVoiceId(settings.voice.voice))}
                onClick={() => void playVoiceSample()}
              >
                <Volume2 size={15} />
                {samplePlaying ? "Играет пример…" : "Послушать пример"}
              </button>
              <ToggleRow label="Цельная озвучка" checked={settings.voice.singleTrack} onChange={(singleTrack) => setSettings({ voice: { ...settings.voice, singleTrack } })} />
            </>
          )}
        </SettingsPanel>
        <SettingsPanel icon={<Image size={16} />} title="ИЗОБРАЖЕНИЯ">
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
              <option value="nano-banana">Nano Banana Pro</option>
              <option value="gpt-image">GPT Image</option>
              <option value="anymodel-image">AnyModel API</option>
            </select>
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
          <ToggleRow label="Последовательная генерация" hint="Каждая картинка генерируется после предыдущей — важно для бесшовных форматов." checked={settings.image.sequential} onChange={(sequential) => setSettings({ image: { ...settings.image, sequential } })} />
          <Field label={`РЕФЕРЕНСЫ (${settings.image.references.length}/3)`} hint="Опорные изображения: персонаж или стиль сохраняются один в один во всех сценах (генерация переключается на GPT Image).">
            <button className="upload-box" onClick={() => void chooseReferences()}>
              <Plus size={21} />
              <span>Добавить референс</span>
            </button>
            <small>С референсами сцены генерируются моделью GPT Image — герой остаётся одинаковым.</small>
          </Field>
          <button className="outline-button small" disabled={busy || saving || heroBuilding || draft.scenes.length === 0} onClick={() => void createHero()}>
            <CircleUserRound size={15} />
            {heroBuilding
              ? `${scenarioProgress?.startsWith("Референс героя") ? scenarioProgress : "Запускаю создание референса героя…"} · ${heroElapsedSeconds} с`
              : "Создать референс героя по сценарию"}
          </button>
        </SettingsPanel>
        <SettingsPanel icon={<Video size={16} />} title="AI ВИДЕО & ЭФФЕКТЫ">
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
          <Field label="ДВИЖЕНИЕ КАМЕРЫ (ВЕСЬ РОЛИК)" hint="Ken Burns на всех сценах: постоянное приближение, отдаление или чередование. Отдельную сцену можно переопределить в Сценарии.">
            <select
              value={settings.assembly.kenBurnsDirection ?? "in"}
              onChange={(event) =>
                setSettings({
                  assembly: { ...settings.assembly, kenBurnsDirection: event.target.value as ProjectSettings["assembly"]["kenBurnsDirection"] },
                })
              }
            >
              <option value="in">Постоянное приближение</option>
              <option value="out">Постоянное отдаление</option>
              <option value="alternate">Чередование (приближение/отдаление)</option>
            </select>
          </Field>
          <ToggleRow
            label="Генерировать AI-видео"
            hint="Оживляет картинку сцены (image-to-video). Veo — ключ Google AI Studio; AnyModel — grok-imagine. Внимание: видео заметно дороже картинок."
            checked={settings.video.enabled}
            onChange={(enabled) => {
              // mock-video остался в старых проектах и молча отключал реальную генерацию — переводим на Google.
              const provider = settings.video.provider === "anymodel-video" ? "anymodel-video" : "veo";
              setSettings({ video: { ...settings.video, enabled, provider } });
              onInfo(enabled ? "AI-видео включено: выбранные сцены будут оживлены из своих картинок." : "AI-видео выключено — сцены соберутся из картинок с движением камеры.");
            }}
          />
          {settings.video.enabled && (
            <>
              <Field label="ДВИЖОК ВИДЕО" hint="Google — Omni Flash / Veo по ключу AI Studio (нужен VPN). AnyModel — grok-imagine-video с баланса AnyModel.">
                <select
                  value={settings.video.provider === "anymodel-video" ? "anymodel-video" : "veo"}
                  onChange={(event) => setSettings({ video: { ...settings.video, provider: event.target.value as ProjectSettings["video"]["provider"] } })}
                >
                  <option value="veo">Google (Omni Flash / Veo)</option>
                  <option value="anymodel-video">AnyModel (grok-imagine)</option>
                </select>
              </Field>
              <Field label={`АНИМИРОВАТЬ СЦЕН: ${settings.video.animationPercent}%`} hint="Экономия: оживляются только самые важные сцены, остальные идут картинкой с движением камеры.">
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={10}
                  value={settings.video.animationPercent}
                  onChange={(event) => setSettings({ video: { ...settings.video, animationPercent: Number(event.target.value) } })}
                />
                <small>
                  {draft.scenes.length === 0
                    ? "Соберите сценарий — и здесь появится, сколько сцен получат видео."
                    : `Примерно ${Math.max(1, Math.round((draft.scenes.length * settings.video.animationPercent) / 100))} из ${draft.scenes.length} сцен получат видео, остальные — картинка с движением камеры.`}
                </small>
              </Field>
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
        </SettingsPanel>
      </div>
      <div className="editor-secondary">
        <SettingsPanel icon={<Music2 size={16} />} title="ФОНОВАЯ МУЗЫКА">
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
        </SettingsPanel>
        <SettingsPanel icon={<Captions size={16} />} title="СУБТИТРЫ">
          <ToggleRow label="Включить субтитры" checked={settings.subtitles.enabled} onChange={(enabled) => setSettings({ subtitles: { ...settings.subtitles, enabled } })} />
          <button className="outline-button small" onClick={() => void saveAndNavigate("subtitles")}>
            <SlidersHorizontal size={15} />
            Настроить стиль
          </button>
        </SettingsPanel>
        <SettingsPanel icon={<Sparkles size={16} />} title="КОНТЕНТ">
          <div className="content-mode">Custom — {draft.scenes.length} сцен</div>
          <button className="outline-button small" onClick={() => void saveAndNavigate("scenario")}>
            <FileText size={15} />
            Настроить сценарий
          </button>
          <button className="outline-button small" onClick={() => void saveAndNavigate("director")}>
            <Sparkles size={15} />
            Открыть AI-генератор
          </button>
        </SettingsPanel>
      </div>
      <div className="sticky-actions editor-actions">
        <span className="scenario-progress-line">
          {rebuilding
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
              ? `${draft.scenes.length} сцен · данные сохраняются локально`
              : "Сценария пока нет — выберите длину и язык и нажмите «Собрать сценарий»"}
        </span>
        <div>
          <button className="outline-button" disabled={saving} onClick={() => void save()}>
            <Save size={16} />
            {saving ? "Сохраняем..." : "Сохранить"}
          </button>
          <button className="generate-button" disabled={busy || saving || draft.scenes.length === 0} onClick={() => void generate()}>
            <Zap size={17} />
            {draft.scenes.length === 0 ? "Сценарий собирается…" : "Генерировать видео"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CharacterReferenceModal({ character, imageUrl, onClose }: { character: { name: string; prompt: string }; imageUrl: string; onClose: () => void }) {
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
            <small>КАКИМ БУДЕТ ПЕРСОНАЖ</small>
            <p>{character.prompt}</p>
            <span>Этот портрет уже добавлен в референсы. Генератор будет использовать его, чтобы внешность героя оставалась одинаковой между сценами.</span>
          </div>
        </div>
        <footer>
          <button className="generate-button" onClick={onClose}>Использовать этого героя</button>
        </footer>
      </section>
    </div>
  );
}

function ScenarioMaterials({ project, onBack, onSave, onRegenerateImage }: {
  project: Project;
  onBack: () => void;
  onSave: (id: string, input: UpdateProjectInput) => Promise<Project>;
  onRegenerateImage: (sceneId: string) => Promise<void>;
}) {
  const api = window.goldWork ?? fallbackApi;
  const [heroBuilding, setHeroBuilding] = useState(false);
  const [heroProgress, setHeroProgress] = useState<string | null>(null);
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<string | null>(null);
  useEffect(() => api.onDirectorProgress((stage) => {
    if (stage.startsWith("Референс героя")) setHeroProgress(stage);
  }), []);

  const regenerateHero = async () => {
    setHeroBuilding(true);
    setHeroProgress("Референс героя: запускаю генерацию…");
    try {
      const result = await api.createCharacterReference(project.id);
      await onSave(project.id, {
        characterReference: result.character,
        settings: result.project.settings,
        outputPath: result.project.outputPath,
      });
    } finally {
      setHeroBuilding(false);
      setHeroProgress(null);
    }
  };

  const regenerateImage = async (sceneId: string) => {
    setRegeneratingSceneId(sceneId);
    try {
      await onRegenerateImage(sceneId);
    } finally {
      setRegeneratingSceneId(null);
    }
  };

  const hero = project.characterReference;
  const generationBusy = project.status === "generating" || project.status === "paused";
  return (
    <div className="scenario-materials-page">
      <PageHeading
        icon={<button className="back-icon" onClick={onBack}><ChevronLeft size={22} /></button>}
        title="Материалы сценария"
        subtitle={`${project.title} · ${project.scenes.length} сцен`}
        actions={
          <button className="ghost-button" onClick={() => void api.openProjectFolder(project.id)}>
            <FolderOpen size={15} />
            Папка проекта
          </button>
        }
      />

      <section className="scenario-materials-hero">
        <div className="scenario-materials-title">
          <div><CircleUserRound size={18} /><strong>Главный герой</strong></div>
          <button className="outline-button small" disabled={heroBuilding || generationBusy || project.scenes.length === 0} onClick={() => void regenerateHero()}>
            <RotateCcw size={14} />
            {heroBuilding ? heroProgress ?? "Создаю образ…" : hero ? "Перегенерировать героя" : "Создать тестовый образ"}
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
            <div><strong>Образ героя ещё не создан</strong><span>Нажмите «Создать тестовый образ», чтобы увидеть персонажа до генерации всех сцен.</span></div>
          </div>
        )}
      </section>

      <section className="scenario-materials-scenes">
        <div className="scenario-materials-title">
          <div><FileText size={18} /><strong>Сцены по порядку</strong></div>
          <span>{project.scenes.length} сцен</span>
        </div>
        {project.scenes.map((scene) => (
          <article className="scenario-material-card" key={scene.id}>
            <div className="scenario-material-image">
              {scene.imagePath ? (
                <img src={api.mediaUrl(scene.imagePath)} alt={scene.title} />
              ) : (
                <div className="scene-placeholder"><Image size={28} /><span>Кадр ещё не создан</span></div>
              )}
              <button className="outline-button small" disabled={generationBusy || regeneratingSceneId !== null} onClick={() => void regenerateImage(scene.id)}>
                <RotateCcw size={13} />
                {regeneratingSceneId === scene.id ? "Добавляю в очередь…" : scene.imagePath ? "Перегенерировать кадр" : "Сгенерировать кадр"}
              </button>
            </div>
            <div className="scenario-material-copy">
              <header><span>{scene.order + 1}</span><div><strong>{scene.title}</strong><small>{scene.durationSeconds} сек · {scene.status}</small></div></header>
              <div><small>ОЗВУЧКА</small><p>{scene.narration || "Текст не задан"}</p></div>
              <div><small>ПРОМПТ ИЗОБРАЖЕНИЯ</small><p>{scene.imagePrompt || "Промпт не задан"}</p></div>
              <div><small>ПРОМПТ ВИДЕО / АНИМАЦИИ</small><p>{scene.animationPrompt || "Промпт не задан"}</p></div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function ScenarioEditor({ project, onSave, onRegenerateImage, onBack }: { project?: Project; onSave: (id: string, input: UpdateProjectInput) => Promise<Project>; onRegenerateImage: (sceneId: string) => Promise<void>; onBack: () => void }) {
  const api = window.goldWork ?? fallbackApi;
  const [scenes, setScenes] = useState<Scene[]>(project?.scenes ? structuredClone(project.scenes) : []);
  const [selectedId, setSelectedId] = useState<string | null>(project?.scenes[0]?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [improving, setImproving] = useState(false);
  const [improveHint, setImproveHint] = useState("");
  const [view, setView] = useState<"editor" | "materials">("editor");
  useEffect(() => {
    const next = project?.scenes ? structuredClone(project.scenes) : [];
    setScenes(next);
    setSelectedId(next[0]?.id ?? null);
    setView("editor");
  }, [project?.id]);
  // Сценарий, дописанный в фоне, вливается в открытый пустой редактор — иначе сохранение затёрло бы его пустотой.
  useEffect(() => {
    if (!project || project.scenes.length === 0) return;
    setScenes((current) => (current.length === 0 ? structuredClone(project.scenes) : current));
    setSelectedId((current) => current ?? project.scenes[0]?.id ?? null);
  }, [project?.id, project?.updatedAt]);
  if (!project) return <EmptyState icon={<FileText size={34} />} title="Проект не выбран" text="Выберите проект перед редактированием сценария." action="Назад" onAction={onBack} />;
  if (view === "materials") return <ScenarioMaterials project={{ ...project, scenes }} onBack={() => setView("editor")} onSave={onSave} onRegenerateImage={onRegenerateImage} />;
  if (project.status === "generating" || project.status === "paused") return <EmptyState icon={<Pause size={34} />} title="Сценарий временно заблокирован" text="Во время активной генерации нельзя менять состав сцен. Остановите очередь или дождитесь завершения." action="Назад к проекту" onAction={onBack} />;
  const selected = scenes.find((scene) => scene.id === selectedId);
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
  /** Просит модель переписать выбранную сцену: сначала сохраняем текущие правки, потом применяем ответ. */
  const improveSelected = async () => {
    if (!selected) return;
    setImproving(true);
    try {
      await onSave(project.id, { scenes: reindex(scenes) });
      const updated = await api.improveScene(project.id, selected.id, improveHint);
      const improved = updated.scenes.find((scene) => scene.id === selected.id);
      if (improved) {
        setScenes((current) => current.map((scene) => (scene.id === selected.id
          ? { ...scene, narration: improved.narration, imagePrompt: improved.imagePrompt, status: "draft", imagePath: undefined, audioPath: undefined, videoPath: undefined }
          : scene)));
      }
      setImproveHint("");
    } catch {
      // Сообщение об ошибке показывает корневой компонент.
    } finally {
      setImproving(false);
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      await onSave(project.id, {
        scenes: reindex(scenes),
        status: scenes.length ? "ready" : "draft",
      });
    } catch {
      /* Ошибка показана в общем уведомлении. */
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="scenario-page page-with-actionbar">
      <PageHeading
        icon={
          <button className="back-icon" onClick={onBack}>
            <ChevronLeft size={22} />
          </button>
        }
        title="Редактор сценария"
        subtitle={`${project.title} · ${scenes.length} сцен`}
        actions={
          <>
            <button className="ghost-button" onClick={() => void (window.goldWork ?? fallbackApi).openProjectFolder(project.id)}>
              <FolderOpen size={15} />
              Папка проекта
            </button>
            <button className="ghost-button" onClick={addScene}>
              <Plus size={15} />
              Добавить сцену
            </button>
          </>
        }
      />
      {scenes.length === 0 ? (
        <EmptyState icon={<FileText size={34} />} title="Сценарий пуст" text="Добавьте первую сцену. Для каждой сцены можно задать текст, изображение и движение." action="Добавить сцену" onAction={addScene} />
      ) : (
        <div className="scenario-layout">
          <aside className="scene-list">
            {scenes.map((scene, index) => (
              <article className={`scene-list-item${scene.id === selectedId ? " selected" : ""}`} key={scene.id} onClick={() => setSelectedId(scene.id)}>
                <span>{index + 1}</span>
                <div>
                  <strong>{scene.title}</strong>
                  <small>
                    {scene.durationSeconds} сек · {scene.status}{scene.includeInAssembly === false ? " · вне сборки" : ""}
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
                  <button className="ghost-button" disabled={improving} onClick={() => void improveSelected()}>
                    <WandSparkles size={14} />
                    {improving ? "AI улучшает…" : "Улучшить через AI"}
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
                <Field label="ДЛИТЕЛЬНОСТЬ, СЕК">
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={selected.durationSeconds}
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
                <Field label="ПЕРЕХОД К СЛЕДУЮЩЕЙ СЦЕНЕ" hint="Смешивание — кадры плавно перетекают друг в друга; затухание — уход в чёрный.">
                  <select
                    value={selected.transition ?? "auto"}
                    onChange={(event) => {
                      const value = event.target.value;
                      updateSceneMeta({ transition: value === "auto" ? undefined : (value as Scene["transition"]) });
                    }}
                  >
                    <option value="auto">Как в проекте (смешивание)</option>
                    <option value="mix">Смешивание (mix)</option>
                    <option value="fade">Затухание в чёрный</option>
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
              <Field label="ПРОМПТ ИЗОБРАЖЕНИЯ">
                <textarea rows={5} value={selected.imagePrompt} onChange={(event) => updateScene({ imagePrompt: event.target.value })} placeholder="Опишите кадр, персонажей, локацию и стиль" />
              </Field>
              <Field label="ПРОМПТ АНИМАЦИИ / ВИДЕО">
                <textarea rows={4} value={selected.animationPrompt} onChange={(event) => updateScene({ animationPrompt: event.target.value })} placeholder="Движение камеры и объектов в кадре" />
              </Field>
              <Field label="ЧТО ПОПРАВИТЬ В СЦЕНЕ (ДЛЯ AI)" hint="Опишите словами — модель перепишет текст озвучки и промпт кадра с учётом соседних сцен.">
                <input value={improveHint} onChange={(event) => setImproveHint(event.target.value)} placeholder="Например: «жёстче формулировку», «крупный план лица», «добавь цифру»" />
              </Field>
            </section>
          )}
        </div>
      )}
      <div className="sticky-actions editor-actions">
        <span>
          {scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0)} секунд · {scenes.length} сцен
        </span>
        <div>
          <button className="outline-button" onClick={onBack}>
            Отмена
          </button>
          <button className="generate-button" disabled={saving} onClick={() => void save()}>
            <Save size={16} />
            {saving ? "Сохраняем..." : "Сохранить сценарий"}
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

function Director({ busy, onCreate, onPickTopic, onInfo, onLog }: { busy: boolean; onCreate: (topicId?: string) => void; onPickTopic: (analysis: ReferenceAnalysis) => void; onInfo: (message: string) => void; onLog: (text: string) => void }) {
  const api = window.goldWork ?? fallbackApi;
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [analysis, setAnalysis] = useState<ReferenceAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const analyzingRef = useRef(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [defaultChatModel, setDefaultChatModel] = useState("cc/claude-opus-5");
  const [chatModel, setChatModel] = useState("cc/claude-opus-5");
  useEffect(() => {
    analyzingRef.current = analyzing;
    if (!analyzing) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, [analyzing]);
  useEffect(() => api.onDirectorProgress((stage) => {
    if (analyzingRef.current) setStreamingText(stage);
  }), []);
  const [chatTopics, setChatTopics] = useState<ChatTopicSummary[]>([]);
  const [currentTopicId, setCurrentTopicId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pending, setPending] = useState<{ title: string; hook: string; angle: string } | null>(null);

  async function refreshChatTopics() {
    setChatTopics(await api.listChatTopics());
  }

  useEffect(() => {
    let active = true;
    void Promise.all([api.getAnyModelSettings(), api.listChatTopics()])
      .then(async ([settings, topics]) => {
        if (!active) return;
        setDefaultChatModel(settings.textModel);
        setChatModel(settings.textModel);
        setChatTopics(topics);
        if (topics[0]) await openTopic(topics[0].id, false, settings.textModel);
      })
      .catch(() => active && setChatTopics([]));
    return () => { active = false; };
  }, []);

  async function sendPrompt() {
    const text = prompt.trim();
    if (!text || analyzing) return;
    setMessages((current) => [...current, { role: "user", text }]);
    setPrompt("");
    setAnalyzing(true);
    let topicId = currentTopicId;
    try {
      let storedTopic: Awaited<ReturnType<DesktopApi["appendChatMessage"]>>;
      if (!topicId) {
        const created = await api.createChatTopic(text, chatModel);
        topicId = created.id;
        setCurrentTopicId(created.id);
      }
      try {
        storedTopic = await api.appendChatMessage(topicId, { role: "user", content: text });
      } catch {
        // Тема могла быть удалена — создаём новую и продолжаем, не роняя запрос.
        const created = await api.createChatTopic(text, chatModel);
        topicId = created.id;
        setCurrentTopicId(created.id);
        storedTopic = await api.appendChatMessage(topicId, { role: "user", content: text });
      }
      const history = storedTopic.messages.map(({ role, content }) => ({ role, content }));
      await refreshChatTopics();
      const appendAssistant = async (answer: string) => {
        setStreamingText(null);
        setMessages((current) => [...current, { role: "assistant", text: answer }]);
        await api.appendChatMessage(topicId!, { role: "assistant", content: answer });
        await refreshChatTopics();
      };
      const pastedTranscript = analysis?.youtubeContext ? parsePastedTranscript(text) : [];
      const url = pastedTranscript.length === 0 ? text.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[),.;]+$/, "") : undefined;
      if (pastedTranscript.length > 0 && analysis?.youtubeContext) {
        const sourceDuration = pastedTranscript.at(-1)!.startSeconds + pastedTranscript.at(-1)!.durationSeconds;
        const updated: ReferenceAnalysis = {
          ...analysis,
          youtubeContext: {
            ...analysis.youtubeContext,
            transcript: pastedTranscript,
            transcriptSource: "pasted",
            durationSeconds: Math.max(analysis.youtubeContext.durationSeconds, sourceDuration)
          }
        };
        setAnalysis(updated);
        await api.saveChatTopicAnalysis(topicId!, updated);
        await appendAssistant(`Транскрипция сохранена: ${pastedTranscript.length} фрагментов, ${text.length.toLocaleString("ru-RU")} символов. Я ничего не запускаю автоматически. Теперь можешь попросить разбор текста или прямо написать: «создай сценарий на 5 минут».`);
      } else if (url) {
        setStreamingText("Собираю данные ролика и канала, пишу разбор и превью сцен…");
        const priorContext = history.slice(0, -1).filter((message) => message.role === "user").slice(-6).map((message) => message.content).join("\n");
        const result = await api.analyzeReference({
          url,
          instructions: [priorContext, text.replace(url, "").trim()].filter(Boolean).join("\n"),
          language: "Русский",
          modelId: chatModel
        });
        setStreamingText(null);
        setAnalysis(result);
        await api.saveChatTopicAnalysis(topicId!, result).catch(() => undefined);
        await appendAssistant(`Разбор готов: ниша, аудитория, сильные стороны, что улучшить — всё в карточке ниже.\n\nНа основе данных канала я предложил ${result.suggestedTopics?.length ?? 0} темы для нового ролика — выбери одну кнопкой в карточке, и я соберу полный сценарий и открою проект. Либо напиши свою длину («5 минут») или пожелание («сделай хук жёстче»).`);
        onInfo("Референс разобран. Укажи длину ролика или сразу создай проект.");
      } else if (analysis) {
        const requestedSeconds = parseExplicitDurationSeconds(text);
        const wantsScenario = wantsScenarioGeneration(text);
        const wantsRefine = /(измени|переделай|перепиши|усиль|улучши|сделай|добавь|убери|сократи)/i.test(text)
          && /(разбор|хук|структур|сценар|угол|интриг|подач|тем|short|длин|текст)/i.test(text);
        if (requestedSeconds || wantsScenario) {
          const targetSeconds = requestedSeconds ?? Math.max(30, analysis.recommendedDurationSeconds || analysis.youtubeContext?.durationSeconds || 60);
          setStreamingText(`Собираю настоящий сценарий под ~${Math.round((targetSeconds / 60) * 10) / 10} мин…`);
          const resized = await api.regenerateReferenceScenes(analysis, targetSeconds, chatModel);
          setStreamingText(null);
          setAnalysis(resized);
          await api.saveChatTopicAnalysis(topicId!, resized).catch(() => undefined);
          const minutes = Math.round((targetSeconds / 60) * 10) / 10;
          await appendAssistant(`Сценарий действительно написан: ${resized.scenes.length} сцен на ~${minutes} мин. Он сохранён в этой теме; кнопка ниже создаст проект уже с готовыми сценами.`);
        } else if (wantsRefine) {
          setStreamingText("Обновляю разбор с учётом пожелания…");
          const context = history.slice(-10).map((message) => `${message.role}: ${message.content}`).join("\n");
          const refined = await api.refineReferenceAnalysis(analysis, `${text}\n\nКонтекст диалога:\n${context}`, chatModel);
          setStreamingText(null);
          setAnalysis(refined);
          await api.saveChatTopicAnalysis(topicId!, refined).catch(() => undefined);
          await appendAssistant(`Готово. Я обновил разбор и будущий сценарий с учётом просьбы: «${text}».`);
        } else if ((await api.getAnyModelSettings()).configured) {
          let streamed = "";
          const answer = await api.streamChatWithAnyModel([
            { role: "system", content: directorChatContext(analysis) },
            ...compactDirectorHistory(history),
          ], (chunk) => {
            streamed += chunk;
            setStreamingText(streamed);
          }, chatModel);
          await appendAssistant(answer);
        } else {
          await appendAssistant("Для полноценного продолжения диалога добавьте ключ AnyModel в настройках.");
        }
      } else {
        const provider = await api.getAnyModelSettings();
        if (provider.configured) {
          let streamed = "";
          const answer = await api.streamChatWithAnyModel(history, (chunk) => {
            streamed += chunk;
            setStreamingText(streamed);
          }, chatModel);
          await appendAssistant(answer);
          setStreamingText(null);
        } else {
          await appendAssistant("Опишите тему подробнее или пришлите ссылку на YouTube, Rutube или другой открытый ролик. Я подготовлю нишу, хук, структуру и сценарий. Сейчас используется демонстрационный анализатор; добавьте AnyModel API в настройках для настоящего диалога.");
        }
      }
    } catch (reason) {
      setStreamingText(null);
      const message = errorMessage(reason);
      const answer = `Ошибка AI-провайдера: ${message}`;
      setMessages((current) => [...current, { role: "assistant", text: answer }]);
      if (topicId) await api.appendChatMessage(topicId, { role: "assistant", content: answer }).catch(() => undefined);
    } finally {
      setAnalyzing(false);
      setStreamingText(null);
    }
  }

  async function buildAndOpen(base: ReferenceAnalysis, label: string) {
    if (analyzing) return;
    let ready = base;
    if (ready.scenes.length === 0) {
      setAnalyzing(true);
      try {
        const targetSeconds = Math.max(30, ready.recommendedDurationSeconds || ready.youtubeContext?.durationSeconds || 60);
        setStreamingText("Строю план сценария…");
        ready = await api.regenerateReferenceScenes(ready, targetSeconds, chatModel);
        setAnalysis(ready);
        if (currentTopicId) await api.saveChatTopicAnalysis(currentTopicId, ready);
      } catch (reason) {
        const text = `Не удалось написать сценарий: ${errorMessage(reason)}. Проект без сценария не создан — можно повторить запрос.`;
        setMessages((current) => [...current, { role: "assistant", text }]);
        if (currentTopicId) await api.appendChatMessage(currentTopicId, { role: "assistant", content: text }).catch(() => undefined);
        onInfo(text);
        return;
      } finally {
        setAnalyzing(false);
        setStreamingText(null);
      }
    }
    onLog(`Открываю проект с готовым сценарием: ${label}`);
    const text = `Готово: открываю проект по теме «${label}» с готовым сценарием из ${ready.scenes.length} сцен. Настройки можно изменить и при необходимости пересобрать сценарий.`;
    setMessages((current) => [...current, { role: "assistant", text }]);
    if (currentTopicId) await api.appendChatMessage(currentTopicId, { role: "assistant", content: text }).catch(() => undefined);
    onPickTopic({ ...ready, modelId: chatModel });
  }

  /** Подтверждение темы: показываем, что именно уйдёт в сценарий, и даём поправить одной строкой. */
  async function confirmPending(extraInstructions: string) {
    if (!pending || !analysis) return;
    const base: ReferenceAnalysis = {
      ...analysis,
      suggestedTitle: pending.title,
      hook: pending.hook || analysis.hook,
      suggestedAngle: pending.angle || analysis.suggestedAngle,
      scenes: pending.title === analysis.suggestedTitle ? analysis.scenes : [],
      instructions: [analysis.instructions, extraInstructions.trim()].filter(Boolean).join("\n") || undefined,
      modelId: chatModel
    };
    setPending(null);
    setAnalysis(base);
    const choice = `Выбрана тема: «${pending.title}»${extraInstructions.trim() ? ` (правка: ${extraInstructions.trim()})` : ""}`;
    setMessages((current) => [...current, { role: "user", text: choice }]);
    if (currentTopicId) {
      await api.appendChatMessage(currentTopicId, { role: "user", content: choice }).catch(() => undefined);
      await api.saveChatTopicAnalysis(currentTopicId, base).catch(() => undefined);
    }
    await buildAndOpen(base, pending.title);
  }

  function pickTopic(topic: { title: string; hook: string; angle: string }) {
    if (!analysis) return;
    setPending({ title: topic.title, hook: topic.hook, angle: topic.angle });
  }

  async function openTopic(id: string, announce = true, fallbackModel = defaultChatModel) {
    const topic = await api.getChatTopic(id);
    if (!topic) return;
    setCurrentTopicId(topic.id);
    setMessages(topic.messages.filter((message) => message.role !== "system").map((message) => ({
      role: message.role as "user" | "assistant",
      text: message.content
    })));
    setAnalysis(topic.analysis ?? null);
    setChatModel(topic.modelId || topic.analysis?.modelId || fallbackModel);
    setHistoryOpen(false);
    if (announce) onInfo(`Открыта тема «${topic.title}»`);
  }

  async function changeChatModel(modelId: string) {
    setChatModel(modelId);
    if (currentTopicId) {
      await api.setChatTopicModel(currentTopicId, modelId);
      await refreshChatTopics();
    }
  }

  async function attachFile(kind: "image" | "video") {
    const paths = await api.pickFiles(kind, kind === "image");
    if (paths.length === 0) {
      onInfo("Файл не выбран");
      return;
    }
    const names = paths.map((path) => path.split(/[\\/]/).pop() ?? path);
    setPrompt((current) => [current, `Референсы: ${names.join(", ")}`].filter(Boolean).join(" "));
    onInfo(`Добавлено файлов: ${paths.length}`);
  }

  const analysisAnchorIndex = analysis
    ? messages.findIndex((message) => message.role === "assistant" && message.text.startsWith("Разбор готов:"))
    : -1;
  const analysisOrder = analysisAnchorIndex >= 0 ? analysisAnchorIndex * 2 + 1 : messages.length * 2 + 1;

  return (
    <div className="director-page">
      <PageHeading
        icon={<WandSparkles size={24} />}
        title="AI Генератор пресетов"
        subtitle="Создавай сценарии через чат с AI"
        actions={
          <>
            <button className="icon-button" title="Текущая модель чата" onClick={() => onInfo(`Текущая модель: ${chatModel}`)}>
              <Bot size={16} />
            </button>
            <button className={`ghost-button${historyOpen ? " active" : ""}`} onClick={() => setHistoryOpen((value) => !value)}>
              <RotateCcw size={15} />
              История
            </button>
            <button
              className="ghost-button"
              onClick={() => {
                setMessages([]);
                setPrompt("");
                setAnalysis(null);
                setCurrentTopicId(null);
                setChatModel(defaultChatModel);
                setHistoryOpen(false);
                onInfo("Создана новая тема чата");
              }}
            >
              <Plus size={15} />
              Новый
            </button>
          </>
        }
      />
      <div className="chat-area">
        {pending && analysis && <TopicConfirmModal analysis={analysis} topic={pending} onCancel={() => setPending(null)} onConfirm={confirmPending} />}
        {historyOpen && (
          <aside className="chat-history-panel">
            <header>
              <div><RotateCcw size={15} /><strong>Темы чата</strong></div>
              <span>{chatTopics.length}</span>
            </header>
            {chatTopics.length === 0 ? <p>Сохранённых диалогов пока нет.</p> : chatTopics.map((topic) => (
              <div className={topic.id === currentTopicId ? "active" : ""} key={topic.id}>
                <button onClick={() => void openTopic(topic.id)}>
                  <strong>{topic.title}</strong>
                  <span>{topic.preview || "Пустой диалог"}</span>
                  <small>{new Date(topic.updatedAt).toLocaleString("ru-RU")} · {topic.messageCount} сообщ.</small>
                </button>
                <button
                  className="delete-topic"
                  title="Удалить тему"
                  onClick={() => void api.deleteChatTopic(topic.id).then(async () => {
                    if (currentTopicId === topic.id) {
                      setCurrentTopicId(null);
                      setMessages([]);
                      setAnalysis(null);
                      setChatModel(defaultChatModel);
                    }
                    await refreshChatTopics();
                  })}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </aside>
        )}
        {messages.length === 0 ? (
          <div className="chat-empty">
            <WandSparkles size={38} />
            <h2>Создай сценарий</h2>
            <p>Опиши нишу или пришли ссылку на ролик. Чат разберёт хук, аудиторию, структуру и подготовит улучшенный самостоятельный сценарий.</p>
            <div>
              <button className="ghost-button" disabled={busy} onClick={() => onCreate()}>
                Сделай сценарий
              </button>
              <button
                className="ghost-button"
                onClick={() => {
                  setPrompt("Проанализируй нишу и предложи темы, формат роликов, аудиторию и структуру первого выпуска.");
                  onInfo("Шаблон анализа ниши добавлен в поле сообщения");
                }}
              >
                Анализ ниши
              </button>
            </div>
            <small>Недавние диалоги</small>
            {chatTopics.slice(0, 3).map((topic) => (
              <button className="recent-chat" key={topic.id} onClick={() => void openTopic(topic.id)}>
                <FileText size={13} />
                {topic.title}
                <span>{topic.messageCount} сообщ.</span>
              </button>
            ))}
            {chatTopics.length === 0 && <p className="no-recent-chat">Первый диалог сохранится автоматически после отправки сообщения.</p>}
          </div>
        ) : (
          <div className="messages">
            {messages.map((message, index) => (
              <article className={`message ${message.role}`} key={`${message.role}-${index}`} style={{ order: index * 2 }}>
                <CollapsibleChatText text={message.text} />
              </article>
            ))}
            {analyzing && streamingText === null && (
              <article className="message assistant thinking-message" style={{ order: messages.length * 2 + 2 }}>
                <span>Думаю над запросом · {elapsedSeconds} с</span>
                <i /><i /><i />
              </article>
            )}
            {streamingText !== null && (() => {
              const match = /(\d+)\s*из\s*(\d+)/.exec(streamingText);
              const percent = match ? Math.min(100, Math.round((Number(match[1]) / Math.max(1, Number(match[2]))) * 100)) : null;
              return (
                <article className="message assistant streaming-message" style={{ order: messages.length * 2 + 2 }}>
                  {streamingText || <span className="stream-caret">▋</span>}
                  <div className="script-progress">
                    <div className="script-progress-bar">
                      <span className={percent === null ? "indeterminate" : ""} style={percent === null ? undefined : { width: `${percent}%` }} />
                    </div>
                    <small>{percent === null ? `⏱ ${elapsedSeconds} с` : `${percent}% · ⏱ ${elapsedSeconds} с`}</small>
                  </div>
                </article>
              );
            })()}
            {analysis && (
              <article className="reference-analysis" style={{ order: analysisOrder }}>
                <header>
                  <div>
                    <strong>{analysis.sourceTitle}</strong>
                    <small>{analysis.provider.startsWith("mock") ? "⚠ Демонстрационный разбор с выдуманными данными — API не подключён" : `Анализ: ${analysis.provider}`}</small>
                  </div>
                  <span>{analysis.scenes.length > 0 ? `${analysis.scenes.length} сцен` : "выбери тему ниже"}</span>
                </header>
                <div className="analysis-grid">
                  <section><small>НИША</small><p>{analysis.niche}</p></section>
                  <section><small>АУДИТОРИЯ</small><p>{analysis.targetAudience}</p></section>
                  <section className="wide"><small>УЛУЧШЕННЫЙ ХУК</small><p>{analysis.hook}</p></section>
                  <section><small>СИЛЬНЫЕ СТОРОНЫ</small><ul>{analysis.strengths.map((item, index) => <li key={index}>{typeof item === "string" ? item : JSON.stringify(item)}</li>)}</ul></section>
                  <section><small>ЧТО УЛУЧШИТЬ</small><ul>{analysis.improvements.map((item, index) => <li key={index}>{typeof item === "string" ? item : JSON.stringify(item)}</li>)}</ul></section>
                  <section className="wide"><small>НОВЫЙ УГОЛ ПОДАЧИ</small><p>{analysis.suggestedAngle}</p></section>
                </div>
                {analysis.youtubeContext && (
                  <div className="youtube-analysis-details">
                    <div className="youtube-metrics">
                      <span><strong>{analysis.youtubeContext.views.toLocaleString("ru-RU")}</strong> просмотров</span>
                      <span><strong>{analysis.youtubeContext.likes.toLocaleString("ru-RU")}</strong> лайков</span>
                      <span><strong>{analysis.youtubeContext.commentCount.toLocaleString("ru-RU")}</strong> комментариев</span>
                      <span><strong>{analysis.youtubeContext.channelSubscribers.toLocaleString("ru-RU")}</strong> подписчиков</span>
                    </div>
                    <div className="youtube-context-grid">
                      <section>
                        <small>ТРАНСКРИПТ С ТАЙМКОДАМИ</small>
                        <div className="transcript-preview">
                          {analysis.youtubeContext.transcript.slice(0, 12).map((segment, index) => (
                            <p key={`${segment.startSeconds}-${index}`}>
                              <b>{formatTimestamp(segment.startSeconds)}</b>{segment.text}
                            </p>
                          ))}
                          {analysis.youtubeContext.transcript.length === 0 && (
                            <p>Текст ролика недоступен без входа в аккаунт YouTube. Разбор построен на метаданных и комментариях. Чтобы анализировать по тексту, добавьте cookies.txt в Настройки → AI и сценарии.</p>
                          )}
                        </div>
                      </section>
                      <section>
                        <small>ТОП-КОММЕНТАРИИ</small>
                        {analysis.youtubeContext.topComments.slice(0, 5).map((comment, index) => (
                          <p key={`${comment.author}-${index}`}><b>♥ {comment.likes}</b>{comment.text}</p>
                        ))}
                        {analysis.youtubeContext.topComments.length === 0 && <p>Комментарии отключены или отсутствуют.</p>}
                      </section>
                      <section>
                        <small>ЧТО ВЫСТРЕЛИЛО НА КАНАЛЕ</small>
                        {analysis.youtubeContext.topVideos.slice(0, 5).map((video) => (
                          <p key={video.id}><b>{video.views.toLocaleString("ru-RU")}</b>{video.title}</p>
                        ))}
                      </section>
                    </div>
                    <p className="analysis-disclaimer">
                      Кадры ролика не анализировались. Источник текста: {({ captions: "субтитры", "yt-dlp-captions": "субтитры (yt-dlp)", "gemini-audio": "аудио → Gemini", pasted: "вставлен пользователем", none: "недоступен (нужен вход/cookies)" } as const)[analysis.youtubeContext.transcriptSource]}.
                      {analysis.youtubeContext.transcriptionAudioMegabytes ? ` Аудио для Gemini: ${analysis.youtubeContext.transcriptionAudioMegabytes} МБ — расход токенов учитывается провайдером.` : " Транскрибация аудио не потребовалась, дополнительных токенов на неё нет."}
                    </p>
                  </div>
                )}
                {analysis.suggestedTopics && analysis.suggestedTopics.length > 0 && (
                  <div className="suggested-topics">
                    <small>ТЕМЫ ДЛЯ НОВОГО РОЛИКА — НАЖМИ, ЧТОБЫ СОБРАТЬ СЦЕНАРИЙ И ОТКРЫТЬ ПРОЕКТ</small>
                    {analysis.suggestedTopics.map((topic, index) => (
                      <button key={index} className="suggested-topic" disabled={busy || analyzing} onClick={() => pickTopic(topic)}>
                        <strong>{index + 1}. {topic.title}</strong>
                        <span>{topic.hook}</span>
                      </button>
                    ))}
                  </div>
                )}
                <footer>
                  <span>Можно написать: «сделай хук жёстче», «сократи до Shorts» или «добавь больше интриги»</span>
                  <button
                    className="generate-button"
                    disabled={busy || analyzing}
                    onClick={() => setPending({ title: analysis.suggestedTitle || "Улучшенный ролик", hook: analysis.hook, angle: analysis.suggestedAngle })}
                  >
                    <WandSparkles size={15} />
                    {analysis.scenes.length > 0 ? "Создать проект с готовым сценарием" : "Написать сценарий и создать проект"}
                  </button>
                </footer>
              </article>
            )}
            {analysis && analysis.scenes.length > 0 && (
              <section className="chat-ready-scenario" style={{ order: messages.length * 2 + 3 }}>
                <div>
                  <strong>Сценарий готов · {analysis.scenes.length} сцен · ~{Math.round(analysis.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0))} сек</strong>
                  <span>Он сохранён в этой теме чата. Можно посмотреть текст или сразу создать проект.</span>
                </div>
                <details>
                  <summary>Посмотреть текст сценария</summary>
                  <ol>
                    {analysis.scenes.map((scene) => <li key={scene.id}>{scene.narration}</li>)}
                  </ol>
                </details>
                <button
                  className="generate-button"
                  disabled={busy || analyzing}
                  onClick={() => setPending({ title: analysis.suggestedTitle || "Новый ролик", hook: analysis.hook, angle: analysis.suggestedAngle })}
                >
                  <WandSparkles size={15} />
                  Создать проект с готовым сценарием
                </button>
              </section>
            )}
            {!analysis && currentTopicId && messages.length > 0 && !analyzing && (
              <div className="chat-create-from-topic" style={{ order: messages.length * 2 + 4 }}>
                <button className="generate-button" disabled={busy} onClick={() => onCreate(currentTopicId)}>
                  <WandSparkles size={15} />
                  Создать проект из этого диалога
                </button>
                <small>Сохранённая переписка станет контекстом для цельного сценария.</small>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="chat-composer">
        <button title="Добавить изображения" onClick={() => void attachFile("image")}>
          <Paperclip size={19} />
        </button>
        <button title="Добавить видео-референс" onClick={() => void attachFile("video")}>
          <Video size={19} />
        </button>
        <select
          className="chat-model-select"
          title="Claude-модель для этого диалога и сценария"
          value={chatModel}
          onChange={(event) => void changeChatModel(event.target.value)}
          disabled={analyzing}
        >
          {!CLAUDE_CHAT_MODELS.some((model) => model.id === chatModel) && <option value={chatModel}>{chatModel}</option>}
          {CLAUDE_CHAT_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select>
        <textarea
          rows={1}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            void sendPrompt();
          }}
          placeholder="Напиши сообщение или вставь транскрипцию… (Shift+Enter — новая строка)"
        />
        <button className="send" onClick={() => void sendPrompt()} disabled={!prompt.trim() || analyzing}>
          <Send size={19} />
        </button>
      </div>
    </div>
  );
}

function CollapsibleChatText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 1_600 || text.split("\n").length > 18;
  return (
    <>
      <div className={long && !expanded ? "chat-text collapsed" : "chat-text"}>{text}</div>
      {long && (
        <button className="expand-message" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Свернуть" : `Показать полностью · ${text.length.toLocaleString("ru-RU")} символов`}
        </button>
      )}
    </>
  );
}

/** Карточка подтверждения перед сборкой сценария: что именно уйдёт в генерацию и как это поправить. */
function TopicConfirmModal({ analysis, topic, onCancel, onConfirm }: { analysis: ReferenceAnalysis; topic: { title: string; hook: string; angle: string }; onCancel: () => void; onConfirm: (instructions: string) => void }) {
  const [instructions, setInstructions] = useState("");
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="topic-modal">
        <header>
          <div>
            <WandSparkles size={18} />
            <div>
              <strong>Проверьте пресет перед сборкой</strong>
              <small>Сценарий соберётся именно по этим данным</small>
            </div>
          </div>
          <button className="modal-close" onClick={onCancel}><X size={18} /></button>
        </header>
        <div className="topic-modal-body">
          <Field label="ТЕМА РОЛИКА"><div className="topic-value strong">{topic.title}</div></Field>
          <Field label="ХУК (ПЕРВЫЕ СЕКУНДЫ)"><div className="topic-value">{topic.hook || "—"}</div></Field>
          <Field label="УГОЛ ПОДАЧИ"><div className="topic-value">{topic.angle || "—"}</div></Field>
          <div className="topic-grid">
            <Field label="НИША"><div className="topic-value">{analysis.niche}</div></Field>
            <Field label="АУДИТОРИЯ"><div className="topic-value">{analysis.targetAudience}</div></Field>
          </div>
          {analysis.structure.length > 0 && (
            <Field label="СТРУКТУРА">
              <div className="topic-value">{analysis.structure.slice(0, 6).map((item, index) => <div key={index}>• {item}</div>)}</div>
            </Field>
          )}
          <Field label="ЧТО ИЗМЕНИТЬ (НЕОБЯЗАТЕЛЬНО)" hint="Например: «сделай хук жёстче», «больше конкретики и цифр», «от лица новичка».">
            <textarea rows={3} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Пожелания к сценарию — учтутся при генерации" />
          </Field>
          <small className="topic-note">Длину ролика и язык выберете в проекте — он откроется сразу, а сцены будут писаться с прогрессом внизу.</small>
        </div>
        <footer>
          <button className="outline-button" onClick={onCancel}>Отмена</button>
          <button className="generate-button" onClick={() => onConfirm(instructions)}>
            <Check size={15} />
            Согласен — собрать сценарий
          </button>
        </footer>
      </section>
    </div>
  );
}

function ProjectsPage({ projects, busy, onCreate, onOpen, onDuplicate, onDelete, onPreview, onTimeline, onGenerate, onAssemble, onOpenFolder, onSave }: { projects: Project[]; busy: boolean; onCreate: () => void; onOpen: (id: string) => void; onDuplicate: (id: string) => void; onDelete: (id: string) => void; onPreview: (id: string) => void; onTimeline: (id: string) => void; onGenerate: (id: string) => void; onAssemble: (id: string) => void; onOpenFolder: (id: string) => void; onSave: (id: string, input: UpdateProjectInput) => Promise<Project> }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expanded = projects.find((project) => project.id === expandedId);
  const patchAssembly = (project: Project, patch: Partial<ProjectSettings["assembly"]>) =>
    void onSave(project.id, { settings: { ...project.settings, assembly: { ...project.settings.assembly, ...patch } } });
  const patchSubtitles = (project: Project, patch: Partial<SubtitleSettings>) =>
    void onSave(project.id, { settings: { ...project.settings, subtitles: { ...project.settings.subtitles, ...patch } } });
  return (
    <div>
      <PageHeading
        icon={<FolderOpen size={24} />}
        title="Проекты"
        subtitle="Клик по строке раскрывает управление генерацией и сборкой"
        actions={
          <button className="generate-button" disabled={busy} onClick={onCreate}>
            <Plus size={16} />
            Новый проект
          </button>
        }
      />
      {projects.length === 0 ? (
        <EmptyState icon={<FolderOpen size={34} />} title="Список пуст" text="Созданные проекты появятся здесь." action="Создать проект" onAction={onCreate} />
      ) : (
        <div className="projects-table">
          <div className="projects-table-head">
            <span>Название</span>
            <span title="Картинок готово">🖼</span>
            <span title="Озвучек готово">🔊</span>
            <span title="Final.mp4">🎬</span>
            <span>Статус</span>
            <span>Дата</span>
          </div>
          {projects.map((project) => (
            <div key={project.id}>
              <button className={`projects-table-row${project.id === expandedId ? " open" : ""}`} onClick={() => setExpandedId(project.id === expandedId ? null : project.id)}>
                <span className="cell-name">{project.title}</span>
                <span>{project.scenes.filter((scene) => scene.imagePath).length}/{project.scenes.length}</span>
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
                        {project.scenes.some((scene) => !scene.imagePath) ? "Сгенерировать" : "Перегенерировать сцены"}
                      </button>
                      <button className="outline-button small" disabled={busy || project.status === "generating" || project.scenes.length === 0} onClick={() => onAssemble(project.id)}>
                        <RotateCcw size={14} />
                        Пересобрать Final.mp4
                      </button>
                    </div>
                  </div>
                  <div className="expand-block">
                    <small>СБОРКА</small>
                    <div className="expand-checks">
                      <label><input type="checkbox" checked={project.settings.assembly.kenBurns} onChange={(event) => patchAssembly(project, { kenBurns: event.target.checked })} /> Ken Burns</label>
                      <label><input type="checkbox" checked={project.settings.assembly.fadeTransitions} onChange={(event) => patchAssembly(project, { fadeTransitions: event.target.checked })} /> Переходы (mix)</label>
                      <label><input type="checkbox" checked={project.settings.subtitles.enabled} onChange={(event) => patchSubtitles(project, { enabled: event.target.checked })} /> Субтитры</label>
                      <label><input type="checkbox" checked={project.settings.subtitles.popWords} onChange={(event) => patchSubtitles(project, { popWords: event.target.checked })} /> Pop Words</label>
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
                        {project.settings.music.path && project.settings.music.enabled !== false ? "Музыка: есть" : "Музыка: нет"}
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

function QueuePage({ tasks, projects, onPause, onResume, onStop, onRetry, onClear }: { tasks: QueueTask[]; projects: Project[]; onPause: (id: string) => void; onResume: (id: string) => void; onStop: (id: string) => void; onRetry: (id: string) => void; onClear: () => void }) {
  const counts = {
    pending: tasks.filter((task) => task.status === "pending" || task.status === "retry_wait").length,
    running: tasks.filter((task) => task.status === "running").length,
    done: tasks.filter((task) => task.status === "done").length,
    failed: tasks.filter((task) => task.status === "failed" || task.status === "cancelled" || task.status === "blocked").length,
  };
  const activeProjectIds = [...new Set(tasks.filter((task) => !["done", "cancelled", "failed", "blocked"].includes(task.status)).map((task) => task.projectId))];
  const icons: Record<QueueTask["kind"], ReactNode> = {
    director: <WandSparkles size={18} />,
    image: <Image size={18} />,
    video: <Video size={18} />,
    speech: <Volume2 size={18} />,
    assemble: <Clapperboard size={18} />,
  };
  return (
    <div>
      <PageHeading
        icon={<ListPlus size={24} />}
        title="Очередь"
        subtitle="Локальный конвейер, прогресс и повторные попытки"
        actions={
          <button className="ghost-button" onClick={onClear}>
            <Trash2 size={15} />
            Очистить завершённые
          </button>
        }
      />
      {activeProjectIds.length > 0 && (
        <div className="queue-project-controls">
          {activeProjectIds.map((id) => {
            const project = projects.find((item) => item.id === id);
            const paused = project?.status === "paused";
            return (
              <div key={id}>
                <span>
                  <Clapperboard size={15} />
                  {project?.title ?? id}
                </span>
                <button onClick={() => (paused ? onResume(id) : onPause(id))}>
                  {paused ? <Play size={14} /> : <Pause size={14} />}
                  {paused ? "Продолжить" : "Пауза"}
                </button>
                <button className="danger" onClick={() => onStop(id)}>
                  <Square size={13} />
                  Стоп
                </button>
              </div>
            );
          })}
        </div>
      )}
      <section className="queue-board">
        <div className="queue-summary">
          <Stat label="Ожидают" value={String(counts.pending)} />
          <Stat label="В работе" value={String(counts.running)} />
          <Stat label="Завершено" value={String(counts.done)} />
          <Stat label="Ошибки / стоп" value={String(counts.failed)} />
        </div>
        {tasks.length === 0 ? (
          <EmptyState icon={<ListPlus size={34} />} title="Очередь пуста" text="Откройте проект и нажмите «Генерировать видео»." action="Готово" onAction={() => undefined} />
        ) : (
          <div className="queue-cards">
            {tasks.map((task) => (
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
                    {taskStatusLabel(task.status)} · попытка {task.attempts}/{task.maxAttempts}
                  </span>
                  {task.error && <span className="queue-error">{task.error}</span>}
                  {task.status === "failed" && (
                    <button className="retry-button" onClick={() => onRetry(task.id)}>
                      <RotateCcw size={13} />
                      Повторить
                    </button>
                  )}
                </footer>
              </article>
            ))}
          </div>
        )}
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

function timelineTransition(project: Project, scene: TimelineScene): "none" | "fade" | "mix" {
  if (scene.transitionDurationSeconds === 0) return "none";
  return scene.transition ?? (project.settings.assembly.fadeTransitions ? "mix" : "none");
}

function buildTimelineLayout(project: Project, scenes: TimelineScene[], durationOf: (scene: TimelineScene) => number): TimelineClipLayout[] {
  const durations = scenes.map(durationOf);
  const transitions = scenes.map((scene) => timelineTransition(project, scene));
  const usesCrossfadeGraph = transitions.slice(0, -1).some((transition) => transition === "mix");
  let cursor = 0;
  return scenes.map((scene, index) => {
    const duration = durations[index] ?? 0.1;
    const nextDuration = durations[index + 1];
    const transition = transitions[index] ?? "none";
    const requested = clampTimelineNumber(scene.transitionDurationSeconds ?? 0.5, 0, 5);
    const overlapToNext = nextDuration === undefined || !usesCrossfadeGraph
      ? 0
      : transition === "mix"
        ? clampTimelineNumber(requested, 0.02, Math.max(0.02, Math.min(duration - 0.1, nextDuration - 0.1)))
        : 0.05;
    const entry = { scene, index, start: cursor, end: cursor + duration, duration, overlapToNext, transition };
    cursor += duration - overlapToNext;
    return entry;
  });
}

function TimelineEditor({ project, onClose, onShowScenes, onOpenFolder, onAssemble, onSave, onRegenerate }: { project: Project; onClose: () => void; onShowScenes: () => void; onOpenFolder: () => void; onAssemble: () => Promise<void>; onSave: (id: string, input: UpdateProjectInput) => Promise<Project>; onRegenerate: (sceneId: string | string[], target?: TimelineRegenerateTarget) => Promise<void> }) {
  const api = window.goldWork ?? fallbackApi;
  const initialScenes = () => [...project.scenes].sort((a, b) => a.order - b.order) as TimelineScene[];
  const [scenes, setScenes] = useState<TimelineScene[]>(initialScenes);
  const [selectedIds, setSelectedIds] = useState<string[]>(project.scenes[0] ? [project.scenes[0].id] : []);
  const [propertiesOpen, setPropertiesOpen] = useState(Boolean(project.scenes[0]));
  const [menu, setMenu] = useState<{ x: number; y: number; sceneId: string } | null>(null);
  const [zoom, setZoom] = useState(26);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mediaMode, setMediaMode] = useState<"live" | "final">("live");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [finalMediaDuration, setFinalMediaDuration] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [scrubCanvasSeconds, setScrubCanvasSeconds] = useState<number | null>(null);
  const [activeTransitionId, setActiveTransitionId] = useState<string | null>(null);
  const [assetDurations, setAssetDurations] = useState<Record<string, number>>({});
  const [copiedSettings, setCopiedSettings] = useState<Partial<TimelineScene> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const livePreviewRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const playbackFrameRef = useRef<number | null>(null);
  const livePlaybackRef = useRef<{ startedAt: number; timelineTime: number } | null>(null);
  const scrubFrameRef = useRef<number | null>(null);
  const pendingScrubRef = useRef<number | null>(null);
  const scrubPointerRef = useRef<number | null>(null);
  const transitionResizeRef = useRef<{ pointerId: number; sceneId: string; startX: number; startDuration: number; side: -1 | 1 } | null>(null);
  const anchorIdRef = useRef<string | null>(project.scenes[0]?.id ?? null);
  const dragIdRef = useRef<string | null>(null);
  const busy = saving || project.status === "generating" || project.status === "paused";
  const selected = scenes.filter((scene) => selectedIds.includes(scene.id));
  const primary = selected[0];
  const durationOf = (scene: TimelineScene) => {
    if (scene.durationOverrideSeconds) return Math.max(0.1, scene.durationOverrideSeconds);
    const sourcePath = scene.videoPath ?? scene.audioPath;
    const sourceDuration = sourcePath ? assetDurations[sourcePath] ?? 0 : 0;
    const playbackRate = clampTimelineNumber(scene.playbackRate ?? 1, 0.25, 4);
    const trimStart = Math.max(0, scene.trimStartSeconds ?? 0);
    const trimEnd = scene.trimEndSeconds && scene.trimEndSeconds > trimStart
      ? sourceDuration > 0 ? Math.min(sourceDuration, scene.trimEndSeconds) : scene.trimEndSeconds
      : sourceDuration > 0 ? sourceDuration : undefined;
    const timingChanged = trimStart > 0 || playbackRate !== 1 || scene.trimEndSeconds !== undefined;
    if (timingChanged) return Math.max(0.1, ((trimEnd ?? scene.durationSeconds) - trimStart) / playbackRate);
    if (!scene.videoPath && sourceDuration > 0.2) return sourceDuration + 0.5;
    return Math.max(0.1, scene.durationSeconds);
  };
  const layout = buildTimelineLayout(project, scenes, durationOf);
  const timelineDuration = layout.at(-1)?.end ?? 0;
  const totalDuration = timelineDuration;
  const timelineWidth = Math.max(900, timelineDuration * zoom);
  const selectedStart = primary ? layout.find((entry) => entry.scene.id === primary.id)?.start ?? 0 : 0;
  const finalVideoSource = mediaMode === "final" ? project.outputPath : undefined;
  const playheadLeft = (scrubCanvasSeconds ?? currentTime) * zoom;
  const activeLayouts = layout.filter((entry) => currentTime >= entry.start && (currentTime < entry.end || (entry.index === layout.length - 1 && currentTime <= entry.end)));
  const fallbackLayout = layout.find((entry) => currentTime < entry.start) ?? layout.at(-1);
  const visibleLayouts = activeLayouts.length > 0 ? activeLayouts.slice(-2) : fallbackLayout ? [fallbackLayout] : [];
  const assetDurationKey = scenes.map((scene) => `${scene.audioPath ?? ""}|${scene.videoPath ?? ""}`).join(";");

  useEffect(() => {
    const incoming = initialScenes();
    setScenes(incoming);
    setSelectedIds((current) => {
      const valid = current.filter((id) => incoming.some((scene) => scene.id === id));
      return valid.length > 0 ? valid : incoming[0] ? [incoming[0].id] : [];
    });
  }, [project.id, project.updatedAt]);

  useEffect(() => {
    const pending: HTMLMediaElement[] = [];
    const paths = new Map<string, "audio" | "video">();
    scenes.forEach((scene) => {
      if (scene.audioPath) paths.set(scene.audioPath, "audio");
      if (scene.videoPath) paths.set(scene.videoPath, "video");
    });
    paths.forEach((kind, path) => {
      if (assetDurations[path]) return;
      const media = document.createElement(kind);
      media.preload = "metadata";
      media.src = api.mediaUrl(path);
      media.onloadedmetadata = () => {
        if (Number.isFinite(media.duration) && media.duration > 0) {
          setAssetDurations((current) => current[path] ? current : { ...current, [path]: media.duration });
        }
      };
      media.load();
      pending.push(media);
    });
    return () => pending.forEach((media) => { media.removeAttribute("src"); media.load(); });
  }, [assetDurationKey]);

  useEffect(() => {
    setMediaError(null);
    setPlaying(false);
    if (mediaMode === "final") setFinalMediaDuration(0);
    const video = videoRef.current;
    if (video) video.load();
  }, [finalVideoSource, project.updatedAt]);

  useEffect(() => {
    if (!playing) return;
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
        playheadRef.current.style.transform = `translateX(${logicalTime * zoom}px)`;
      }
      const now = performance.now();
      if (now - lastStateUpdate > 32 || logicalTime >= totalDuration) {
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
  }, [playing, mediaMode, totalDuration, zoom]);

  useEffect(() => {
    const container = livePreviewRef.current;
    if (!container) return;
    const media = container.querySelectorAll<HTMLMediaElement>("[data-timeline-media]");
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
      if (playing && mediaMode === "live") void element.play().catch(() => undefined);
      else element.pause();
    });
  }, [currentTime, playing, mediaMode, visibleLayouts, scenes, project.settings.music]);

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
      const timeAtCursor = (scroll.scrollLeft + cursorX) / zoom;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nextZoom = clampTimelineNumber(zoom * factor, 8, 160);
      setZoom(nextZoom);
      requestAnimationFrame(() => {
        scroll.scrollLeft = Math.max(0, timeAtCursor * nextZoom - cursorX);
      });
    };
    scroll.addEventListener("wheel", onWheel, { passive: false });
    return () => scroll.removeEventListener("wheel", onWheel);
  }, [zoom]);

  useEffect(() => () => {
    if (scrubFrameRef.current !== null) cancelAnimationFrame(scrubFrameRef.current);
    if (playbackFrameRef.current !== null) cancelAnimationFrame(playbackFrameRef.current);
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
    setActiveTransitionId(null);
    videoRef.current?.pause();
    pendingSeekRef.current = null;
    livePlaybackRef.current = null;
    setMediaMode("live");
    setPlaying(false);
    setCurrentTime(layout.find((entry) => entry.scene.id === sceneId)?.start ?? 0);
  };
  const patchSelected = (patch: Partial<TimelineScene>) => {
    if (busy) return;
    setScenes((current) => current.map((scene) => selectedIds.includes(scene.id) ? { ...scene, ...patch } : scene));
    setDirty(true);
  };
  const persist = async (next = scenes) => {
    const normalized = reindex(next);
    setScenes(normalized);
    setSaving(true);
    try {
      await onSave(project.id, { scenes: normalized });
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
    if (dirty && !await persist()) return;
    await onRegenerate(ids, target);
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
    setCurrentTime(logicalTime);
    if (mediaMode === "final") {
      pendingSeekRef.current = logicalTime;
      requestAnimationFrame(() => applyVideoSeek(logicalTime));
    }
  };
  const applyScrub = (canvasSeconds: number) => {
    const logicalTime = Math.max(0, Math.min(timelineDuration, canvasSeconds));
    setMediaMode("live");
    setCurrentTime(logicalTime);
    pendingSeekRef.current = null;
  };
  const queueScrub = (canvasSeconds: number) => {
    const bounded = Math.max(0, Math.min(timelineDuration, canvasSeconds));
    pendingScrubRef.current = bounded;
    if (playheadRef.current) playheadRef.current.style.transform = `translateX(${bounded * zoom}px)`;
    if (scrubFrameRef.current !== null) return;
    scrubFrameRef.current = requestAnimationFrame(() => {
      scrubFrameRef.current = null;
      if (pendingScrubRef.current !== null) {
        setScrubCanvasSeconds(pendingScrubRef.current);
        applyScrub(pendingScrubRef.current);
      }
    });
  };
  const scrubTimeFromPointer = (event: ReactPointerEvent<HTMLDivElement>) =>
    (event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom;
  const beginScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubPointerRef.current = event.pointerId;
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
    queueScrub(scrubTimeFromPointer(event));
    scrubPointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    requestAnimationFrame(() => setScrubCanvasSeconds(null));
  };
  const patchScene = (sceneId: string, patch: Partial<TimelineScene>) => {
    if (busy) return;
    setScenes((current) => current.map((scene) => scene.id === sceneId ? { ...scene, ...patch } : scene));
    setDirty(true);
  };
  const selectTransition = (sceneId: string) => {
    const entry = layout.find((candidate) => candidate.scene.id === sceneId);
    if (!entry || entry.index >= layout.length - 1) return;
    setSelectedIds([sceneId]);
    anchorIdRef.current = sceneId;
    setActiveTransitionId(sceneId);
    setPropertiesOpen(true);
    setMediaMode("live");
    setPlaying(false);
    livePlaybackRef.current = null;
    setCurrentTime(Math.max(entry.start, entry.end - Math.max(0.01, entry.scene.transitionDurationSeconds ?? 0.5) / 2));
  };
  const transitionLimit = (entry: TimelineClipLayout) => {
    const next = layout[entry.index + 1];
    return next ? Math.max(0, Math.min(5, entry.duration - 0.1, next.duration - 0.1)) : 0;
  };
  const setTransitionDuration = (sceneId: string, value: number) => {
    const entry = layout.find((candidate) => candidate.scene.id === sceneId);
    if (!entry) return;
    const duration = clampTimelineNumber(value, 0, transitionLimit(entry));
    patchScene(sceneId, duration <= 0.01
      ? { transition: "none", transitionDurationSeconds: 0 }
      : { transition: entry.scene.transition === "none" ? "mix" : entry.scene.transition ?? "mix", transitionDurationSeconds: Math.round(duration * 100) / 100 });
  };
  const beginTransitionResize = (event: ReactPointerEvent<HTMLSpanElement>, entry: TimelineClipLayout, side: -1 | 1) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    transitionResizeRef.current = {
      pointerId: event.pointerId,
      sceneId: entry.scene.id,
      startX: event.clientX,
      startDuration: entry.scene.transition === "none" ? 0 : entry.scene.transitionDurationSeconds ?? 0.5,
      side
    };
    selectTransition(entry.scene.id);
  };
  const moveTransitionResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const resize = transitionResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setTransitionDuration(resize.sceneId, resize.startDuration + ((event.clientX - resize.startX) * resize.side * 2) / zoom);
  };
  const endTransitionResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (transitionResizeRef.current?.pointerId !== event.pointerId) return;
    transitionResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const reportMediaError = (message: string, code?: number) => {
    setMediaError(message);
    setPlaying(false);
    void api.writeLog("error", "timeline.player.error", {
      projectId: project.id,
      mode: mediaMode,
      code,
      file: finalVideoSource?.split(/[\\/]/).at(-1)
    });
  };
  const togglePlayback = async () => {
    if (playing) {
      videoRef.current?.pause();
      livePlaybackRef.current = null;
      setPlaying(false);
      return;
    }
    if (mediaMode === "live") {
      const timelineTime = currentTime >= totalDuration ? 0 : currentTime;
      if (timelineTime !== currentTime) setCurrentTime(timelineTime);
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
  const liveFadeOpacity = (() => {
    if (!liveForeground) return 0;
    const localTime = clampTimelineNumber(currentTime - liveForeground.start, 0, liveForeground.duration);
    const previous = layout[liveForeground.index - 1];
    let opacity = 0;
    if (previous?.transition === "fade") {
      const duration = Math.min(previous.scene.transitionDurationSeconds ?? 0.5, liveForeground.duration / 2);
      if (duration > 0 && localTime < duration) opacity = Math.max(opacity, 1 - localTime / duration);
    }
    if (liveForeground.transition === "fade") {
      const duration = Math.min(liveForeground.scene.transitionDurationSeconds ?? 0.5, liveForeground.duration / 2);
      const remaining = liveForeground.duration - localTime;
      if (duration > 0 && remaining < duration) opacity = Math.max(opacity, 1 - remaining / duration);
    }
    if (liveForeground.scene.fadeEdges) {
      const duration = Math.min(liveForeground.scene.transitionDurationSeconds ?? 0.5, liveForeground.duration / 2);
      if (duration > 0) opacity = Math.max(opacity, 1 - Math.min(1, localTime / duration), 1 - Math.min(1, (liveForeground.duration - localTime) / duration));
    }
    return clampTimelineNumber(opacity, 0, 1);
  })();
  const liveLayerOpacity = (entry: TimelineClipLayout) => {
    if (visibleLayouts.length < 2) return 1;
    const older = visibleLayouts[0]!;
    const newer = visibleLayouts[1]!;
    if (older.transition !== "mix" || older.overlapToNext <= 0) return entry.scene.id === newer.scene.id ? 1 : 0;
    const progress = clampTimelineNumber((currentTime - newer.start) / older.overlapToNext, 0, 1);
    return entry.scene.id === older.scene.id ? 1 - progress : progress;
  };
  const liveTransform = (entry: TimelineClipLayout) => {
    const scene = entry.scene;
    const configured = scene.kenBurnsDirection ?? "auto";
    const projectDirection = project.settings.assembly.kenBurnsDirection ?? "in";
    const direction = configured === "auto"
      ? !project.settings.assembly.kenBurns ? "off" : projectDirection === "alternate" ? (scene.order % 2 === 0 ? "in" : "out") : projectDirection
      : configured;
    if (direction === "off") return "scale(1)";
    const progress = clampTimelineNumber((currentTime - entry.start) / entry.duration, 0, 1);
    const maximum = clampTimelineNumber(scene.kenBurnsZoom ?? 1.1, 1, 1.5);
    const scale = direction === "out" ? maximum - (maximum - 1) * progress : 1 + (maximum - 1) * progress;
    return `scale(${scale.toFixed(4)})`;
  };

  return (
    <div className="timeline-studio-backdrop">
      <section className={`timeline-studio${propertiesOpen && primary ? " properties-open" : ""}`}>
        <header className="timeline-topbar">
          <button className="timeline-icon-button" onClick={() => void leaveTimeline(onClose)} title="Назад"><ChevronLeft size={19} /></button>
          <div className="timeline-project-title">
            <strong>{project.title}</strong>
            <small>{scenes.length} сцен · {formatTimestamp(totalDuration)} · {project.aspectRatio === "16:9" ? "1280×720" : project.aspectRatio}</small>
          </div>
          <div className="timeline-transport">
            <button disabled={scenes.length === 0} onClick={() => seekTimeline(Math.max(0, currentTime - 5))}><ArrowLeft size={14} /></button>
            <button className="play" disabled={scenes.length === 0 || (mediaMode === "final" && !project.outputPath)} onClick={() => void togglePlayback()}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
            <button disabled={scenes.length === 0} onClick={() => seekTimeline(Math.min(totalDuration, currentTime + 5))}><ArrowRight size={14} /></button>
            <time>{formatTimestamp(currentTime)} <span>/ {formatTimestamp(totalDuration)}</span></time>
          </div>
          <div className="timeline-top-actions">
            <button className="timeline-icon-button" onClick={onOpenFolder} title="Открыть папку"><FolderOpen size={16} /></button>
            <label className="timeline-zoom" title="Ctrl + колесо — масштаб под курсором"><span>−</span><input type="range" min="8" max="160" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><span>+</span><em>{Math.round(zoom)}px/с</em></label>
            <button className="generate-button compact" disabled={busy || scenes.length === 0} onClick={() => void rebuild()}><RotateCcw size={14} />{saving ? "Сохраняю…" : "Пересобрать"}</button>
          </div>
        </header>

        <div className="timeline-stage">
          <main className="timeline-preview-area">
            <div className="timeline-media-frame">
              {mediaMode === "final" && finalVideoSource ? (
                <video
                  key={`final-${finalVideoSource}-${project.updatedAt}`}
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
                <div ref={livePreviewRef} className="timeline-live-preview">
                  {visibleLayouts.map((entry) => {
                    const localTime = clampTimelineNumber(currentTime - entry.start, 0, entry.duration);
                    const rate = clampTimelineNumber(entry.scene.playbackRate ?? 1, 0.25, 4);
                    const mediaTime = (entry.scene.trimStartSeconds ?? 0) + localTime * rate;
                    const opacity = liveLayerOpacity(entry);
                    const sourceVolume = project.settings.video.muteSource ? 0 : (entry.scene.sourceVolume ?? project.settings.video.sourceVolume) / 100;
                    const narrationVolume = (entry.scene.narrationVolume ?? 100) / 100;
                    return (
                      <div key={entry.scene.id} className="timeline-live-layer" style={{ opacity, transform: liveTransform(entry) }}>
                        {entry.scene.videoPath ? (
                          <video
                            data-timeline-media
                            data-timeline-time={mediaTime}
                            data-timeline-rate={rate}
                            data-timeline-volume={sourceVolume * opacity}
                            src={api.mediaUrl(entry.scene.videoPath)}
                            poster={entry.scene.imagePath ? api.mediaUrl(entry.scene.imagePath) : undefined}
                            preload="auto"
                            playsInline
                          />
                        ) : entry.scene.imagePath ? (
                          <img src={api.mediaUrl(entry.scene.imagePath)} alt={entry.scene.title} />
                        ) : (
                          <div className="timeline-no-media"><Image size={34} /><span>У сцены нет изображения</span></div>
                        )}
                        {entry.scene.audioPath && (
                          <audio
                            data-timeline-media
                            data-timeline-time={mediaTime}
                            data-timeline-rate={rate}
                            data-timeline-volume={narrationVolume * opacity}
                            src={api.mediaUrl(entry.scene.audioPath)}
                            preload="auto"
                          />
                        )}
                      </div>
                    );
                  })}
                  {project.settings.music.enabled !== false && project.settings.music.path && (
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
                  <div className="timeline-live-fade" style={{ opacity: liveFadeOpacity }} />
                  <span className="timeline-live-label">Живой предпросмотр · сцена {(liveForeground?.index ?? 0) + 1}</span>
                </div>
              ) : (
                <div className="timeline-no-media"><Video size={38} /><span>Сначала сгенерируйте материалы сцены</span></div>
              )}
              {(mediaMode === "live" ? visibleLayouts.length > 0 : Boolean(finalVideoSource)) && !mediaError && <button className="timeline-big-play" onClick={() => void togglePlayback()}>{playing ? <Pause size={26} /> : <Play size={27} />}</button>}
              {mediaMode === "final" && mediaError && <div className="timeline-media-error"><Video size={28} /><strong>Видео не открылось</strong><span>{mediaError}</span><button onClick={reloadVideo}><RotateCcw size={13} />Повторить</button></div>}
            </div>
            <div className="timeline-preview-switch">
              <button className={mediaMode === "live" ? "active" : ""} disabled={scenes.length === 0} onClick={() => { videoRef.current?.pause(); pendingSeekRef.current = null; livePlaybackRef.current = null; setMediaMode("live"); setPlaying(false); }}>Предпросмотр</button>
              <button className={mediaMode === "final" ? "active" : ""} disabled={!project.outputPath || dirty} title={dirty ? "Сначала примените изменения" : "Открыть собранный файл"} onClick={() => { livePlaybackRef.current = null; pendingSeekRef.current = currentTime; setMediaMode("final"); setPlaying(false); }}>Final.mp4</button>
            </div>
          </main>

          {propertiesOpen && primary && (
            <aside className="timeline-properties">
              <header><div><b>{selected.length}</b><strong>{selected.length === 1 ? "Свойства сцены" : `Свойства ${selected.length} сцен`}</strong></div><button onClick={() => setPropertiesOpen(false)}><X size={16} /></button></header>
              <div className="timeline-properties-scroll">
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
                {selected.length === 1 && (
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
                    <label>Зум<select value={primary.kenBurnsZoom ?? 1.1} onChange={(event) => patchSelected({ kenBurnsZoom: Number(event.target.value) })}><option value="1.05">Мягкий 5%</option><option value="1.1">Обычный 10%</option><option value="1.15">Сильный 15%</option><option value="1.2">20%</option></select></label>
                  </div>
                </section>
                <section>
                  <small>ПЕРЕХОД К СЛЕДУЮЩЕЙ СЦЕНЕ</small>
                  <label className="timeline-full-field">Тип<select value={primary.transition ?? "auto"} onChange={(event) => { const transition = event.target.value; patchSelected(transition === "auto" ? { transition: undefined, transitionDurationSeconds: primary.transitionDurationSeconds === 0 ? 0.5 : primary.transitionDurationSeconds } : transition === "none" ? { transition: "none", transitionDurationSeconds: 0 } : { transition: transition as TimelineScene["transition"], transitionDurationSeconds: primary.transitionDurationSeconds && primary.transitionDurationSeconds > 0 ? primary.transitionDurationSeconds : 0.5 }); }}><option value="auto">Как в проекте</option><option value="mix">Смешивание</option><option value="fade">Затухание через чёрный</option><option value="none">Без перехода</option></select></label>
                  <label className="timeline-range-field"><span>Длительность перехода <b>{primary.transition === "none" ? 0 : primary.transitionDurationSeconds ?? 0.5} с</b></span><input type="range" min="0" max="5" step="0.05" value={primary.transition === "none" ? 0 : primary.transitionDurationSeconds ?? 0.5} onChange={(event) => selected.length === 1 ? setTransitionDuration(primary.id, Number(event.target.value)) : patchSelected(Number(event.target.value) <= 0.01 ? { transition: "none", transitionDurationSeconds: 0 } : { transition: primary.transition === "none" ? "mix" : primary.transition, transitionDurationSeconds: Number(event.target.value) })} /></label>
                  <button className="timeline-remove-transition" disabled={busy || primary.order >= scenes.length - 1} onClick={() => patchSelected({ transition: "none", transitionDurationSeconds: 0 })}><X size={13} />Удалить переход</button>
                  <button className={`timeline-switch-row${primary.fadeEdges ? " on" : ""}`} onClick={() => patchSelected({ fadeEdges: !primary.fadeEdges })}><span>Затемнение на краях сцены</span><i /></button>
                  <p className="timeline-live-note">Изменения видны сразу в режиме «Предпросмотр». Маркер перехода на стыке можно растягивать мышью.</p>
                </section>
                {selected.length === 1 && (
                  <section>
                    <small>ПРОМПТЫ СЦЕНЫ</small>
                    <label className="timeline-full-field">Изображение<textarea rows={4} value={primary.imagePrompt} onChange={(event) => patchSelected({ imagePrompt: event.target.value })} /></label>
                    <label className="timeline-full-field">Видео / движение<textarea rows={3} value={primary.animationPrompt} onChange={(event) => patchSelected({ animationPrompt: event.target.value })} /></label>
                  </section>
                )}
                {selected.length > 1 && <p className="timeline-bulk-note">Изменения применятся ко всем выбранным сценам.</p>}
              </div>
              <footer><button className="outline-button" onClick={() => { setScenes(initialScenes()); setDirty(false); }}>Отмена</button><button className="generate-button compact" disabled={!dirty || busy} onClick={() => void persist()}><Check size={14} />Применить</button></footer>
            </aside>
          )}
        </div>

        <div className="timeline-sequencer">
          <div className="timeline-track-labels">
            <span>ВРЕМЯ</span>
            <strong><Video size={15} />Видео</strong>
            <strong><Mic2 size={15} />Озвучка</strong>
            <strong><Music2 size={15} />Музыка</strong>
            <strong><Captions size={15} />Субтитры</strong>
            <span>ОБЗОР</span>
          </div>
          <div ref={timelineScrollRef} className="timeline-scroll" title="Alt + колесо — прокрутка, Ctrl + колесо — масштаб">
            <div className="timeline-canvas" style={{ width: timelineWidth }}>
              <div className="timeline-ruler-new seekable" onPointerDown={beginScrub} onPointerMove={moveScrub} onPointerUp={endScrub} onPointerCancel={endScrub}>
                {Array.from({ length: Math.floor(timelineDuration / 5) + 1 }, (_, index) => <time key={index} style={{ left: index * 5 * zoom }}>{formatTimestamp(index * 5)}</time>)}
              </div>
              <div className="timeline-grid-track video-track">
                {layout.map((entry) => (
                  <button
                    key={entry.scene.id}
                    draggable={!busy}
                    style={{ left: entry.start * zoom, width: Math.max(8, entry.duration * zoom) }}
                    className={`timeline-clip${selectedIds.includes(entry.scene.id) ? " selected" : ""}${entry.scene.includeInAssembly === false ? " excluded" : ""}`}
                    onDragStart={() => { dragIdRef.current = entry.scene.id; }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => dropAt(entry.scene.id, event.clientX > event.currentTarget.getBoundingClientRect().left + event.currentTarget.clientWidth / 2)}
                    onClick={(event) => chooseScene(entry.scene.id, event)}
                    onContextMenu={(event) => { event.preventDefault(); if (!selectedIds.includes(entry.scene.id)) setSelectedIds([entry.scene.id]); setMenu({ x: event.clientX, y: event.clientY, sceneId: entry.scene.id }); }}
                  >
                    {entry.scene.imagePath ? <img src={api.mediaUrl(entry.scene.imagePath)} alt="" draggable={false} /> : <Image size={18} />}
                    <i>{entry.scene.order + 1}</i><em>{entry.duration.toFixed(1)}с</em><GripVertical size={13} />
                  </button>
                ))}
                {layout.slice(0, -1).map((entry) => {
                  const duration = entry.transition === "none" ? 0 : entry.scene.transitionDurationSeconds ?? 0.5;
                  const markerWidth = Math.max(18, duration * zoom);
                  const center = entry.transition === "mix" && entry.overlapToNext > 0 ? entry.end - entry.overlapToNext / 2 : entry.end;
                  return (
                    <button
                      key={`transition-${entry.scene.id}`}
                      className={`timeline-transition-marker ${entry.transition}${activeTransitionId === entry.scene.id ? " selected" : ""}`}
                      style={{ left: center * zoom - markerWidth / 2, width: markerWidth }}
                      title={entry.transition === "none" ? "Добавить переход" : `${entry.transition === "mix" ? "Смешивание" : "Затухание"} · ${duration.toFixed(2)} с`}
                      onClick={(event) => { event.stopPropagation(); selectTransition(entry.scene.id); }}
                    >
                      <span className="left" onPointerDown={(event) => beginTransitionResize(event, entry, -1)} onPointerMove={moveTransitionResize} onPointerUp={endTransitionResize} onPointerCancel={endTransitionResize} />
                      <b>{entry.transition === "none" ? "+" : "∞"}</b>
                      <span className="right" onPointerDown={(event) => beginTransitionResize(event, entry, 1)} onPointerMove={moveTransitionResize} onPointerUp={endTransitionResize} onPointerCancel={endTransitionResize} />
                    </button>
                  );
                })}
              </div>
              <div className="timeline-grid-track audio-track">{layout.map((entry) => <button key={entry.scene.id} style={{ left: entry.start * zoom, width: Math.max(8, entry.duration * zoom) }} className={entry.scene.audioPath ? "ready" : "missing"} onClick={(event) => chooseScene(entry.scene.id, event)} onDoubleClick={() => void regenerateSelected("audio", [entry.scene.id])} title="Клик — свойства звука, двойной клик — перегенерировать"><Volume2 size={12} />{entry.scene.audioPath ? `${entry.scene.narrationVolume ?? 100}%` : "Нет озвучки"}</button>)}</div>
              <div className="timeline-grid-track music-track"><span>{project.settings.music.path && project.settings.music.enabled !== false ? "Фоновая музыка" : "Музыка не добавлена"}</span></div>
              <div className="timeline-grid-track subtitle-track">{layout.map((entry) => <span key={entry.scene.id} style={{ left: entry.start * zoom, width: Math.max(8, entry.duration * zoom) }}>{project.settings.subtitles.enabled && entry.scene.narration ? entry.scene.narration.slice(0, 28) : "—"}</span>)}</div>
              <div className="timeline-overview">{layout.map((entry) => <i key={entry.scene.id} className={entry.scene.includeInAssembly === false ? "excluded" : ""} style={{ left: entry.start * zoom, width: entry.duration * zoom }} />)}</div>
              <div ref={playheadRef} className="timeline-playhead" style={{ left: 0, transform: `translateX(${Math.min(timelineWidth, playheadLeft)}px)` }}><i /></div>
            </div>
          </div>
        </div>

        {selected.length > 1 && (
          <div className="timeline-selection-bar"><b>Выбрано {selected.length}</b><button disabled={busy} onClick={toggleSelected}>{selected.some((scene) => scene.includeInAssembly === false) ? <Eye size={14} /> : <EyeOff size={14} />} {selected.some((scene) => scene.includeInAssembly === false) ? "Включить" : "Отключить"}</button><button onClick={() => setPropertiesOpen(true)}><SlidersHorizontal size={14} />Свойства</button><button disabled={busy} onClick={deleteSelected}><Trash2 size={14} />Удалить</button><button disabled={busy} className="primary" onClick={() => void regenerateSelected("all")}><RotateCcw size={14} />Перегенерировать</button></div>
        )}

        {menu && montageMenuScene && (
          <div className="context-backdrop timeline-context-backdrop" onMouseDown={() => setMenu(null)} onContextMenu={(event) => { event.preventDefault(); setMenu(null); }}>
            <div className="context-menu timeline-context-menu" style={{ left: Math.min(menu.x, window.innerWidth - 245), top: Math.min(menu.y, window.innerHeight - 390) }} onMouseDown={(event) => event.stopPropagation()}>
              <button onClick={() => { setPropertiesOpen(true); setMenu(null); }}><SlidersHorizontal size={14} />Свойства сцены</button>
              <button disabled={busy} onClick={() => { void regenerateSelected("image", [montageMenuScene.id]); setMenu(null); }}><Image size={14} />Перегенерировать фото</button>
              <button disabled={busy || !project.settings.video.enabled} onClick={() => { void regenerateSelected("video", [montageMenuScene.id]); setMenu(null); }}><Video size={14} />Перегенерировать видео</button>
              <button disabled={busy || !project.settings.voice.enabled} onClick={() => { void regenerateSelected("audio", [montageMenuScene.id]); setMenu(null); }}><Mic2 size={14} />Перегенерировать озвучку</button>
              <button disabled={busy} onClick={() => { void regenerateSelected("all", [montageMenuScene.id]); setMenu(null); }}><RotateCcw size={14} />Перегенерировать всё</button>
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

function ProjectPreviewModal({ project, initialMode, onClose, onRegenerate, onOpenFolder, onAssemble, onSave, onEditScenario, onToggleScene }: { project: Project; initialMode: "preview" | "timeline"; onClose: () => void; onRegenerate: (sceneId: string | string[], target?: "image" | "video" | "audio" | "all") => Promise<void>; onOpenFolder: () => void; onAssemble: () => Promise<void>; onSave: (id: string, input: UpdateProjectInput) => Promise<Project>; onEditScenario: () => void; onToggleScene: (sceneId: string, include: boolean) => void }) {
  const api = window.goldWork ?? fallbackApi;
  const [mode, setMode] = useState(initialMode);
  const [menu, setMenu] = useState<{ x: number; y: number; scene: Scene } | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const busyGenerating = project.status === "generating" || project.status === "paused";
  const selectedScene = project.scenes.find((scene) => scene.id === selectedSceneId);
  const totalDuration = Math.round(project.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0));
  if (mode === "timeline") {
    return <TimelineEditor project={project} onClose={onClose} onShowScenes={() => setMode("preview")} onOpenFolder={onOpenFolder} onAssemble={onAssemble} onSave={onSave} onRegenerate={onRegenerate} />;
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
            <button className="active" onClick={() => setMode("preview")}>
              <Grid2X2 size={14} />
              Сцены
            </button>
            <button onClick={() => setMode("timeline")}>
              <Clock3 size={14} />
              Таймлайн
            </button>
            <button className="modal-close" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="preview-stats">
          <Stat label="Сцен" value={String(project.scenes.length)} />
          <Stat label="Изображений" value={String(project.scenes.filter((scene) => scene.imagePath).length)} />
          <Stat label="Видео" value={String(project.scenes.filter((scene) => scene.videoPath).length)} />
          <Stat label="Длительность" value={`${totalDuration} сек`} />
        </div>
        <div className="preview-player">
          {selectedScene?.imagePath ? (
            <img src={api.mediaUrl(selectedScene.imagePath)} alt={selectedScene.title} />
          ) : project.outputPath ? (
            <video key={project.outputPath} controls src={api.mediaUrl(project.outputPath)} />
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
                    <img className="scene-thumb" src={api.mediaUrl(scene.imagePath)} alt={scene.title} onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, scene }); }} />
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
                      {scene.durationSeconds} сек · {scene.imagePath ? "изображение готово" : "изображение ожидается"} · {scene.audioPath ? "озвучка готова" : "озвучка ожидается"}
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
                    {scene.imagePath ? <img src={api.mediaUrl(scene.imagePath)} alt="" loading="lazy" /> : <Image size={16} />}
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
                <span className={`track-cell music${project.settings.music.path && project.settings.music.enabled !== false ? " ready" : ""}`}>
                  <Music2 size={13} />
                  {project.settings.music.path && project.settings.music.enabled !== false ? "Трек добавлен" : "Нет музыки"}
                </span>
              </div>
            </div>
            <div className="timeline-track-row">
              <strong>Субтитры</strong>
              <div className="track-cells">
                {project.scenes.map((scene) => (
                  <span key={scene.id} className={`track-cell subs${project.settings.subtitles.enabled && scene.narration ? " ready" : ""}`}>
                    {project.settings.subtitles.enabled && scene.narration ? "≡" : "—"}
                  </span>
                ))}
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
          <button className="outline-button" disabled={busyGenerating} onClick={onAssemble}>
            <RotateCcw size={15} />
            Пересобрать Final.mp4
          </button>
          <button className="outline-button" onClick={onClose}>
            Закрыть
          </button>
          <button className="generate-button" onClick={() => setMode("timeline")}>
            <Clock3 size={15} />
            Открыть таймлайн
          </button>
        </footer>
      </section>
    </div>
  );
}

function SettingsPage({ appInfo }: { appInfo: Awaited<ReturnType<DesktopApi["getAppInfo"]>> | null }) {
  const api = window.goldWork ?? fallbackApi;
  const [activeTab, setActiveTab] = useState<"general" | "ai" | "images" | "voice" | "video" | "storage">("general");
  const [anyModel, setAnyModel] = useState<AnyModelSettings>({ configured: false, baseUrl: "https://anymodel.org/v1", textModel: "cc/claude-opus-5", imageModel: "ag/gemini-3.1-flash-image", videoModel: "xai/grok-imagine-video", ttsModel: "google-tts", imageRefModel: "gpt-image-2", transcriptionModel: "gc/gemini-2.5-flash" });
  const [apiKey, setApiKey] = useState("");
  const [youtube, setYouTube] = useState<YouTubeSettings>({ configured: false, cookiesFileConfigured: false, workDirConfigured: false });
  const [youtubeApiKey, setYouTubeApiKey] = useState("");
  const [voicer, setVoicer] = useState<VoicerSettings>({ configured: false, baseUrl: "" });
  const [voicerKey, setVoicerKey] = useState("");
  const [google, setGoogle] = useState<GoogleSettings>({ configured: false, veoModel: "veo-3.1-lite-generate-preview", proxyUrl: "" });
  const [googleKey, setGoogleKey] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("");
  useEffect(() => {
    void Promise.all([api.getAnyModelSettings(), api.getYouTubeSettings(), api.getVoicerSettings(), api.getGoogleSettings()]).then(([anyModelSettings, youtubeSettings, voicerSettings, googleSettings]) => {
      setAnyModel(anyModelSettings);
      setYouTube(youtubeSettings);
      setVoicer(voicerSettings);
      setGoogle(googleSettings);
    });
  }, []);
  const saveVoicer = async () => {
    const saved = await api.saveVoicerSettings({ baseUrl: voicer.baseUrl, apiKey: voicerKey || undefined });
    setVoicer(saved);
    setVoicerKey("");
    setConnectionMessage("Настройки Voicer сохранены, ключ зашифрован Windows");
  };
  const saveAnyModel = async () => {
    const saved = await api.saveAnyModelSettings({ ...anyModel, apiKey: apiKey || undefined });
    setAnyModel(saved); setApiKey(""); setConnectionMessage("Настройки сохранены локально и зашифрованы Windows");
  };
  const saveYouTube = async () => {
    const saved = await api.saveYouTubeSettings({ apiKey: youtubeApiKey || undefined });
    setYouTube(saved);
    setYouTubeApiKey("");
    setConnectionMessage("Ключ YouTube Data API сохранён локально и зашифрован Windows");
  };
  const chooseYouTubeCookies = async () => {
    const [cookiesFilePath] = await api.pickFiles("cookies");
    if (!cookiesFilePath) return;
    const saved = await api.saveYouTubeSettings({ cookiesFilePath });
    setYouTube(saved);
    setConnectionMessage("cookies.txt сохранён локально и будет использоваться только yt-dlp");
  };
  const chooseWorkDir = async () => {
    const dir = await api.pickDirectory();
    if (!dir) return;
    const saved = await api.saveYouTubeSettings({ workDirPath: dir });
    setYouTube(saved);
    setConnectionMessage("Рабочая папка сохранена — yt-dlp будет использовать её для временных файлов");
  };
  const tabs = [
    ["general", "Общие"],
    ["ai", "AI и сценарии"],
    ["images", "Изображения"],
    ["voice", "Озвучка"],
    ["video", "Видео"],
    ["storage", "Папки и хранение"],
  ] as const;

  return (
    <div>
      <PageHeading icon={<Settings size={24} />} title="Настройки" subtitle="Провайдеры и параметры приложения" />
      <div className="settings-layout">
        <section className="settings-menu">
          {tabs.map(([key, label]) => (
            <button key={key} className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key)}>
              {label}
            </button>
          ))}
        </section>
        <section className="settings-content">
          {activeTab === "general" && (
            <>
              <h2>Состояние приложения</h2>
              <p>Локальная сборка Standard уже работает. Внешние нейросети пока работают через безопасные mock-адаптеры и не расходуют деньги.</p>
              <InfoRow label="Версия" value={appInfo?.version ?? "Загрузка..."} />
              <InfoRow label="Провайдеры нейросетей" value={appInfo?.mockMode ? "Mock — без расходов" : "API"} />
              <InfoRow label="FFmpeg" value={appInfo?.ffmpegAvailable ? "Готов к сборке MP4" : "Недоступен"} />
              <h2>Очередь</h2>
              <InfoRow label="Параллельные задачи" value={String(appInfo?.queuePolicy.concurrency ?? 4)} />
              <InfoRow label="Максимум попыток" value={String(appInfo?.queuePolicy.maxAttempts ?? 3)} />
              <InfoRow label="Интервалы повтора" value={(appInfo?.queuePolicy.retryDelaysMs ?? []).map((value) => `${value / 1000}с`).join(", ") || "—"} />
            </>
          )}
          {activeTab === "ai" && (
            <>
              <h2>AnyModel API</h2>
              <p>Ключ передаётся только из Electron и хранится зашифрованным через Windows safeStorage. Он не попадает в проекты, логи или GitHub.</p>
              <InfoRow label="Статус" value={anyModel.configured ? "Ключ сохранён" : "Не настроен"} />
              <Field label="НОВЫЙ API-КЛЮЧ">
                <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={anyModel.configured ? "Оставьте пустым, чтобы не менять" : "Вставьте новый ключ после отзыва старого"} />
              </Field>
              <Field label="BASE URL"><input value={anyModel.baseUrl} onChange={(event) => setAnyModel({ ...anyModel, baseUrl: event.target.value })} /></Field>
              <Field label="МОДЕЛЬ СЦЕНАРИЯ"><input value={anyModel.textModel} onChange={(event) => setAnyModel({ ...anyModel, textModel: event.target.value })} /></Field>
              <Field label="МОДЕЛЬ ИЗОБРАЖЕНИЙ"><input value={anyModel.imageModel} onChange={(event) => setAnyModel({ ...anyModel, imageModel: event.target.value })} /></Field>
              <Field label="МОДЕЛЬ ИЗОБРАЖЕНИЙ С РЕФЕРЕНСОМ"><input value={anyModel.imageRefModel} onChange={(event) => setAnyModel({ ...anyModel, imageRefModel: event.target.value })} placeholder="gpt-image-2 — включается сама, если в проекте заданы референсы" /></Field>
              <Field label="МОДЕЛЬ ТРАНСКРИПЦИИ"><input value={anyModel.transcriptionModel} onChange={(event) => setAnyModel({ ...anyModel, transcriptionModel: event.target.value })} placeholder="gc/gemini-2.5-flash — нужна модель с поддержкой аудио" /></Field>
              <Field label="МОДЕЛЬ ВИДЕО"><input value={anyModel.videoModel} onChange={(event) => setAnyModel({ ...anyModel, videoModel: event.target.value })} /></Field>
              <Field label="МОДЕЛЬ ОЗВУЧКИ"><input value={anyModel.ttsModel} onChange={(event) => setAnyModel({ ...anyModel, ttsModel: event.target.value })} placeholder="google-tts, edge-tts или edge-tts/ru-RU-DmitryNeural" /></Field>
              <div className="provider-actions">
                <button className="generate-button" onClick={() => void saveAnyModel()}><Save size={15} />Сохранить</button>
                <button className="outline-button small" disabled={!anyModel.configured} onClick={() => void api.testAnyModelConnection().then((result) => setConnectionMessage(result.message))}>Проверить подключение</button>
                <button className="outline-button small" disabled={!anyModel.configured} onClick={() => void api.clearAnyModelKey().then(setAnyModel)}>Удалить ключ</button>
              </div>
              {connectionMessage && <p>{connectionMessage}</p>}
              <h2>Lumean — премиум-озвучка (ElevenLabs)</h2>
              <p>Голоса ElevenLabs через Lumean API (lumean.app). Ключ создаётся в кабинете Lumean → API ключи; шаблоны голосов выбираются в настройках проекта (движок «Lumean»).</p>
              <InfoRow label="Статус Lumean" value={voicer.configured ? "Ключ сохранён" : "Не настроен"} />
              <Field label="BASE URL LUMEAN"><input value={voicer.baseUrl} onChange={(event) => setVoicer({ ...voicer, baseUrl: event.target.value })} placeholder="https://api.lumean.app/api/public" /></Field>
              <Field label="API-КЛЮЧ LUMEAN (X-API-KEY)">
                <input type="password" value={voicerKey} onChange={(event) => setVoicerKey(event.target.value)} placeholder={voicer.configured ? "Оставьте пустым, чтобы не менять" : "Вставьте ключ из кабинета Lumean"} />
              </Field>
              <div className="provider-actions">
                <button className="generate-button" onClick={() => void saveVoicer()}><Save size={15} />Сохранить Lumean</button>
                <button className="outline-button small" disabled={!voicer.configured} onClick={() => void api.testVoicerConnection().then((result) => setConnectionMessage(result.message))}>Проверить Lumean</button>
                <button className="outline-button small" disabled={!voicer.configured} onClick={() => void api.clearVoicerKey().then(setVoicer)}>Удалить ключ</button>
              </div>
              <h2>Google AI Studio — видео (Omni Flash / Veo)</h2>
              <p>Ключ из aistudio.google.com → Get API key. Оживляет картинки сцен (image-to-video). Google не обслуживает запросы из РФ — нужен VPN. Лимиты видео на подписке AI Pro небольшие: анимируйте часть сцен.</p>
              <InfoRow label="Статус Google" value={google.configured ? "Ключ сохранён" : "Не настроен"} />
              <Field label="КЛЮЧ GOOGLE AI STUDIO">
                <input type="password" value={googleKey} onChange={(event) => setGoogleKey(event.target.value)} placeholder={google.configured ? "Оставьте пустым, чтобы не менять" : "AIza… или AQ.…"} />
              </Field>
              <Field label="МОДЕЛЬ ВИДЕО" hint="Lite — самая дешёвая, для большого числа сцен. Fast — компромисс. Обычная Veo 3.1 — лучшее качество и самая дорогая.">
                <select value={google.veoModel} onChange={(event) => setGoogle({ ...google, veoModel: event.target.value })}>
                  <option value="veo-3.1-lite-generate-preview">Veo 3.1 Lite (рекомендуется, дешевле всего)</option>
                  <option value="veo-3.1-fast-generate-preview">Veo 3.1 Fast</option>
                  <option value="veo-3.1-generate-preview">Veo 3.1 (максимальное качество)</option>
                </select>
              </Field>
              <Field label="SOCKS5-ПРОКСИ ДЛЯ GOOGLE" hint="Обходит региональную блокировку без системного VPN. Формат: socks5://логин:пароль@хост:порт. Пусто — прямое соединение.">
                <input value={google.proxyUrl} onChange={(event) => setGoogle({ ...google, proxyUrl: event.target.value })} placeholder="socks5://логин:пароль@хост:порт" />
              </Field>
              <div className="provider-actions">
                <button className="generate-button" onClick={() => void api.saveGoogleSettings({ apiKey: googleKey || undefined, veoModel: google.veoModel, proxyUrl: google.proxyUrl }).then((saved) => { setGoogle(saved); setGoogleKey(""); setConnectionMessage("Настройки Google сохранены, ключ зашифрован Windows"); })}><Save size={15} />Сохранить Google</button>
                <button className="outline-button small" disabled={!google.configured} onClick={() => void api.testGoogleConnection().then((result) => setConnectionMessage(result.message))}>Проверить Google</button>
                <button className="outline-button small" disabled={!google.configured} onClick={() => void api.clearGoogleKey().then(setGoogle)}>Удалить ключ</button>
              </div>
              <h2>YouTube Data API v3 (BYOK)</h2>
              <p>Используется только официальный API Google: метаданные, просмотры, лайки, комментарии и статистика канала. Ключ не попадает в проекты и логи.</p>
              <InfoRow label="Статус YouTube" value={youtube.configured ? "Ключ сохранён" : "Не настроен"} />
              <Field label="КЛЮЧ YOUTUBE DATA API V3">
                <input type="password" value={youtubeApiKey} onChange={(event) => setYouTubeApiKey(event.target.value)} placeholder={youtube.configured ? "Оставьте пустым, чтобы не менять" : "AIza..."} />
              </Field>
              <div className="provider-actions">
                <button className="generate-button" onClick={() => void saveYouTube()}><Save size={15} />Сохранить YouTube</button>
                <button className="outline-button small" disabled={!youtube.configured} onClick={() => void api.testYouTubeConnection().then((result) => setConnectionMessage(result.message))}>Проверить YouTube</button>
                <button className="outline-button small" disabled={!youtube.configured} onClick={() => void api.clearYouTubeKey().then(setYouTube)}>Удалить ключ</button>
              </div>
              <h2>Авторизация yt-dlp</h2>
              <p>Если YouTube показывает «Sign in to confirm you’re not a bot», экспортируйте свежий cookies.txt из браузера в формате Netscape и выберите его здесь. Файл остаётся на вашем компьютере. Не отправляйте его другим людям и не добавляйте в GitHub.</p>
              <InfoRow label="Cookies YouTube" value={youtube.cookiesFileConfigured ? youtube.cookiesFileName ?? "Настроены" : "Не настроены"} />
              <div className="provider-actions">
                <button className="outline-button small" onClick={() => void chooseYouTubeCookies()}>Выбрать cookies.txt</button>
                <button className="outline-button small" disabled={!youtube.cookiesFileConfigured} onClick={() => void api.saveYouTubeSettings({ clearCookiesFile: true }).then(setYouTube)}>Удалить cookies</button>
              </div>
              <h2>Рабочая папка yt-dlp</h2>
              <p>Папка для временных файлов yt-dlp: распаковка исполняемого файла и загрузки. Выберите папку на диске с достаточным свободным местом (например, D:\GoldWorkTemp), если системный диск переполнен. Если не задана — используется системная временная папка.</p>
              <InfoRow label="Рабочая папка" value={youtube.workDirConfigured ? youtube.workDirPath ?? "Настроена" : "Системная временная папка"} />
              <div className="provider-actions">
                <button className="outline-button small" onClick={() => void chooseWorkDir()}>Выбрать папку</button>
                <button className="outline-button small" disabled={!youtube.workDirConfigured} onClick={() => void api.saveYouTubeSettings({ clearWorkDir: true }).then(setYouTube)}>Сбросить папку</button>
              </div>
              <p>Транскрипт сначала берётся из субтитров. Если их нет, используется yt-dlp и аудио→Gemini через настроенную модель AnyModel. Этот фолбэк расходует токены; анализ кадров пока не выполняется. Получение субтитров и аудио через yt-dlp не является официальным YouTube API и может перестать работать при изменении правил или сайта.</p>
            </>
          )}
          {activeTab === "images" && (
            <>
              <h2>Изображения</h2>
              <p>Каждая сцена получает собственный промпт и отдельную картинку. Неудачный кадр можно будет перегенерировать независимо.</p>
              <InfoRow label="Без референсов" value={anyModel.imageModel} />
              <InfoRow label="С референсами" value={anyModel.imageRefModel} />
              <InfoRow label="Референсы" value="До 3 изображений" />
              <InfoRow label="Сохранение" value="Сразу в папку сцены" />
            </>
          )}
          {activeTab === "voice" && (
            <>
              <h2>Озвучка</h2>
              <p>Озвучка создаётся по сценам, поэтому работу можно продолжить после перезапуска и повторить только проблемный фрагмент. Модель меняется в «AI и сценарии»: google-tts (язык проекта подставится сам), edge-tts (нейроголос по языку) или полный id вида edge-tts/ru-RU-DmitryNeural.</p>
              <InfoRow label="Текущая модель" value={anyModel.ttsModel} />
              <InfoRow label="Бесплатный вариант" value="Microsoft Edge TTS" />
              <InfoRow label="Выход" value="Отдельные аудиофайлы сцен" />
            </>
          )}
          {activeTab === "video" && (
            <>
              <h2>Видео</h2>
              <p>Standard собирает ролик из картинок с движением камеры. Pro дополнительно оживляет выбранные сцены через Veo.</p>
              <InfoRow label="Standard" value="Ken Burns и переходы" />
              <InfoRow label="Pro" value="Veo image-to-video" />
              <InfoRow label="AnyModel" value={anyModel.videoModel} />
              <InfoRow label="Финальная сборка" value="FFmpeg" />
            </>
          )}
          {activeTab === "storage" && (
            <>
              <h2>Папки и хранение</h2>
              <p>Проекты, исходники, очередь и журнал сохраняются локально. Закрытие программы не удаляет готовые сцены.</p>
              <InfoRow label="Папка проектов" value={appInfo?.workspacePath ?? "Загрузка..."} />
              <InfoRow label="Папка данных" value={appInfo?.dataPath ?? "Загрузка..."} />
              <InfoRow label="TXT-лог программы" value={appInfo?.logPath ?? "Загрузка..."} />
              <button className="outline-button small" disabled={!appInfo} onClick={() => void api.openLogFile()}>
                <FileText size={15} />
                Открыть TXT-лог
              </button>
            </>
          )}
        </section>
      </div>
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
          </div>
        ))}
      </div>
    </div>
  );
}

function ConsoleDock({ open, queue, entries, viewState, onViewStateChange, onToggle, onClear, onOpenFile }: { open: boolean; queue: QueueTask[]; entries: ConsoleLogEntry[]; viewState: ConsoleViewState; onViewStateChange: (next: ConsoleViewState) => void; onToggle: () => void; onClear: () => void; onOpenFile: () => void }) {
  const running = queue.filter((task) => task.status === "running").length;
  return (
    <div className={`console-dock${open ? " open" : ""}`}>
      <div className="console-head">
        <button onClick={onToggle}>
          <SquareTerminal size={14} />
          CONSOLE OUTPUT <em>{entries.length}</em>
        </button>
        <button onClick={onToggle}>очередь: {running}/{queue.length} {open ? "⌄" : "⌃"}</button>
      </div>
      {open && <ConsoleViewer entries={entries} viewState={viewState} onViewStateChange={onViewStateChange} compact onClear={onClear} onOpenFile={onOpenFile} />}
    </div>
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

function SettingsPanel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="settings-panel">
      <h2>
        {icon}
        {title}
      </h2>
      <div className="panel-content">{children}</div>
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
  return reason instanceof Error ? reason.message : "Произошла неизвестная ошибка";
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
