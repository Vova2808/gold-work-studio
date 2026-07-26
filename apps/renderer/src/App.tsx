import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ArrowDown, ArrowUp, Bot, Bookmark, Captions, Check, ChevronLeft, CircleUserRound, Clapperboard, Clock3, Copy, Download, Eye, FileText, Folder, FolderOpen, Grid2X2, Image, Languages, LayoutDashboard, Lightbulb, ListPlus, LogOut, Mic2, MoreHorizontal, Music2, Paperclip, Pause, Play, Plus, RotateCcw, Save, Search, Send, Settings, SlidersHorizontal, Sparkles, Square, SquareTerminal, Trash2, Upload, Video, Volume2, WandSparkles, X, Zap } from "lucide-react";
import { createDefaultProjectSettings, parseDurationSeconds, type AnyModelSettings, type ChatTopicSummary, type DesktopApi, type Project, type ProjectSettings, type QueueTask, type ReferenceAnalysis, type Scene, type SubtitleSettings, type UpdateProjectInput, type YouTubeSettings } from "@gold-work/shared";
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
  const [uiLog, setUiLog] = useState<Array<{ time: string; level: string; text: string }>>([]);
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const socketConnectedRef = useRef(false);

  /** Пишет действие в Console Output и в лог-файл приложения. */
  function logAction(text: string, level: "UI" | "INFO" | "ERROR" = "UI") {
    setUiLog((current) => [...current.slice(-199), { time: new Date().toLocaleTimeString("ru-RU"), level, text }]);
    void api.writeLog(level === "ERROR" ? "error" : "info", "ui.action", { text }).catch(() => undefined);
  }
  useEffect(() => { if (notice) logAction(notice, "INFO"); }, [notice]);
  useEffect(() => { if (error) logAction(error, "ERROR"); }, [error]);

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
    if (error) void api.writeLog("error", "ui.operation_failed", { message: error });
  }, [error]);

  useEffect(() => {
    if (!notice) return;
    void api.writeLog("info", "ui.notice", { message: notice });
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
      const expectedScenes = Math.min(200, Math.max(6, Math.round(targetSeconds / 5)));
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

  /** Создаёт проект по готовому разбору (сцены уже собраны в чате) и открывает страницу проекта. */
  async function createProjectFromTopic(analysis: ReferenceAnalysis) {
    setBusy(true);
    setError(null);
    try {
      const project = await api.createReferenceProject({ analysis, aspectRatio: "16:9", mode: "standard" });
      upsertProject(project);
      setSelectedProjectId(project.id);
      setActiveSection("project");
      logAction(`Проект «${project.title}» создан (${analysis.scenes.length} сцен)`);
      setNotice(`Проект открыт: ${analysis.scenes.length} сцен. Проверьте настройки и нажмите «Генерировать видео».`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
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

  async function regenerateScene(projectId: string, sceneId: string) {
    setBusy(true);
    try {
      await api.regenerateScene(projectId, sceneId);
      setOverlay(null);
      setSelectedProjectId(projectId);
      setActiveSection("queue");
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
            <StepHintBar hint={computeStepHint(appInfo, selectedProject, queue, activeSection)} onNavigate={navigate} />
          </div>
          <div className="page-scroll" ref={pageScrollRef}>
            {activeSection === "dashboard" && <Dashboard projects={projects} selectedId={selectedProject?.id} busy={busy} onCreate={() => void createProject()} onOpen={openProject} onDelete={(id) => void deleteProject(id)} onPreview={(id) => setOverlay({ type: "preview", projectId: id })} onGenerate={(id) => void startGeneration(id)} onNavigate={navigate} onOpenFolder={(id) => void openProjectFolder(id)} />}
            {activeSection === "project" && <ProjectEditor project={selectedProject} busy={busy} onBack={() => navigate("dashboard")} onSave={saveProject} onApplyChatTopic={applyChatTopic} onGenerate={(id) => void startGeneration(id)} onNavigate={navigate} onInfo={setNotice} />}
            {activeSection === "scenario" && <ScenarioEditor project={selectedProject} onSave={saveProject} onBack={() => navigate("project")} />}
            {activeSection === "subtitles" && <SubtitleStudio project={selectedProject} onSave={saveProject} />}
            {activeSection === "director" && <Director busy={busy} onCreate={() => void createProject(true)} onPickTopic={(analysis) => void createProjectFromTopic(analysis)} onInfo={setNotice} onLog={logAction} />}
            {activeSection === "projects" && <ProjectsPage projects={projects} busy={busy} onCreate={() => void createProject()} onOpen={openProject} onDuplicate={(id) => void duplicateProject(id)} onDelete={(id) => void deleteProject(id)} onPreview={(id) => setOverlay({ type: "preview", projectId: id })} onTimeline={(id) => setOverlay({ type: "timeline", projectId: id })} onGenerate={(id) => void startGeneration(id)} />}
            {activeSection === "queue" && <QueuePage tasks={queue} projects={projects} onPause={(id) => void queueAction(() => api.pauseGeneration(id))} onResume={(id) => void queueAction(() => api.resumeGeneration(id))} onStop={(id) => void queueAction(() => api.stopGeneration(id))} onRetry={(id) => void queueAction(() => api.retryTask(id))} onClear={() => void queueAction(() => api.clearFinishedTasks())} />}
            {activeSection === "settings" && <SettingsPage appInfo={appInfo} />}
            {!(["dashboard", "project", "scenario", "subtitles", "director", "projects", "queue", "settings"] as SectionKey[]).includes(activeSection) && <ToolPage section={activeSection} onAction={() => setNotice("Этот инструмент подключим после добавления соответствующего API. Экран уже готов к интеграции.")} />}
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
          <ConsoleDock open={consoleOpen} queue={queue} log={uiLog} onToggle={() => setConsoleOpen((value) => !value)} />
        </section>
      </div>
      {overlay && overlayProject && <ProjectPreviewModal project={overlayProject} initialMode={overlay.type} onClose={() => setOverlay(null)} onRegenerate={(sceneId) => void regenerateScene(overlayProject.id, sceneId)} onOpenFolder={() => void openProjectFolder(overlayProject.id)} />}
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
      }
    : {
        channel: { title: channel!.title, subscribers: channel!.subscribers, totalViews: channel!.totalViews, videoCount: channel!.videoCount },
        videosTimeline: channel!.videos.slice(0, 30),
        topComments: channel!.topComments.slice(0, 15),
      };
  return `Реальные данные YouTube по текущему разбору — отвечай по ним точными цифрами, ничего не выдумывай:\n${JSON.stringify(payload)}`;
}

type StepHint = { now: string; next?: string; action?: { label: string; section: SectionKey } };

/** Определяет по состоянию приложения, что пользователю сделать сейчас и что произойдёт дальше. */
function computeStepHint(
  appInfo: Awaited<ReturnType<DesktopApi["getAppInfo"]>> | null,
  project: Project | undefined,
  queue: QueueTask[],
  activeSection: SectionKey
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
        now: "сценарий собирается в фоне — пока настройте язык, длительность, формат кадра и озвучку",
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
        <button className="generate-button" disabled={!chosenId || busy} onClick={() => chosenId && onGenerate(chosenId)}>
          <Zap size={17} />
          ГЕНЕРИРОВАТЬ ВИДЕО
        </button>
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
  useEffect(() => {
    setDraft(project ? structuredClone(project) : null);
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
          <Field label="ЯЗЫК">
            <select value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value })}>
              <option>Русский</option>
              <option>English</option>
              <option>Español</option>
            </select>
          </Field>
          <Field label="ДЛИТЕЛЬНОСТЬ ВИДЕО">
            <div className="choice-row">
              {[0.5, 1, 5, 10, 15, 30, 60].map((value) => (
                <button className={settings.durationMinutes === value ? "selected" : ""} onClick={() => setSettings({ durationMinutes: value })} key={value}>
                  {value < 1 ? "30с" : `${value}м`}
                </button>
              ))}
            </div>
          </Field>
          <Field label="СМЕНА КАДРОВ">
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
              <Field label="ДВИЖОК ОЗВУЧКИ">
                <select
                  value={settings.voice.provider}
                  onChange={(event) =>
                    setSettings({
                      voice: {
                        ...settings.voice,
                        provider: event.target.value as ProjectSettings["voice"]["provider"],
                      },
                    })
                  }
                >
                  <option value="edge-tts">Edge TTS</option>
                  <option value="elevenlabs">ElevenLabs API</option>
                </select>
                <small>Сейчас используется mock-адаптер. API можно будет добавить в настройках.</small>
              </Field>
              <Field label="ГОЛОС">
                <select
                  value={settings.voice.voice}
                  onChange={(event) =>
                    setSettings({
                      voice: { ...settings.voice, voice: event.target.value },
                    })
                  }
                >
                  <option value="ru-RU-DmitryNeural">Дмитрий</option>
                  <option value="ru-RU-SvetlanaNeural">Светлана</option>
                  <option value="custom">Пользовательский</option>
                </select>
              </Field>
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
          <Field label="СТИЛЬ ИЗОБРАЖЕНИЙ">
            <input
              value={settings.image.style}
              onChange={(event) =>
                setSettings({
                  image: { ...settings.image, style: event.target.value },
                })
              }
            />
          </Field>
          <ToggleRow label="Последовательная генерация" checked={settings.image.sequential} onChange={(sequential) => setSettings({ image: { ...settings.image, sequential } })} />
          <Field label={`РЕФЕРЕНСЫ (${settings.image.references.length}/3)`}>
            <button className="upload-box" onClick={() => void chooseReferences()}>
              <Plus size={21} />
              <span>Добавить референс</span>
            </button>
          </Field>
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
          <ToggleRow label="Генерировать AI-видео (скоро)" checked={false} onChange={() => onInfo("Видео-генерация пока недоступна: финал собирается из картинок с эффектом Ken Burns и плавными переходами. Подключим позже.")} />
          {settings.video.enabled && (
            <>
              <Field label="ПРОВАЙДЕР ВИДЕО">
                <select value={settings.video.provider} onChange={(event) => setSettings({ video: { ...settings.video, provider: event.target.value as ProjectSettings["video"]["provider"] } })}>
                  <option value="mock-video">Локальный mock</option>
                  <option value="anymodel-video">AnyModel API</option>
                  <option value="veo">Veo</option>
                </select>
              </Field>
              <Field label="МОДЕЛЬ">
                <select
                  value={settings.video.model}
                  onChange={(event) =>
                    setSettings({
                      video: { ...settings.video, model: event.target.value },
                    })
                  }
                >
                  <option>Mock Motion 1</option>
                  <option>Veo 3.1 Lite</option>
                  <option>Veo 3.1 Fast</option>
                  <option>xai/grok-imagine-video</option>
                </select>
              </Field>
              <ToggleRow label="Анимация от первого кадра" checked={settings.video.startFrame} onChange={(startFrame) => setSettings({ video: { ...settings.video, startFrame } })} />
              <ToggleRow label="Парные кадры (Start + End)" checked={settings.video.pairedFrames} onChange={(pairedFrames) => setSettings({ video: { ...settings.video, pairedFrames } })} />
              <ToggleRow label="Без музыки/звука в видео" checked={settings.video.muteSource} onChange={(muteSource) => setSettings({ video: { ...settings.video, muteSource } })} />
              <Field label={`ГРОМКОСТЬ ЗВУКА: ${settings.video.sourceVolume}%`}>
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
        <span>{draft.scenes.length > 0 ? `${draft.scenes.length} сцен · данные сохраняются локально` : "Сценарий собирается в фоне — сцены появятся автоматически"}</span>
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

function ScenarioEditor({ project, onSave, onBack }: { project?: Project; onSave: (id: string, input: UpdateProjectInput) => Promise<Project>; onBack: () => void }) {
  const [scenes, setScenes] = useState<Scene[]>(project?.scenes ? structuredClone(project.scenes) : []);
  const [selectedId, setSelectedId] = useState<string | null>(project?.scenes[0]?.id ?? null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const next = project?.scenes ? structuredClone(project.scenes) : [];
    setScenes(next);
    setSelectedId(next[0]?.id ?? null);
  }, [project?.id]);
  if (!project) return <EmptyState icon={<FileText size={34} />} title="Проект не выбран" text="Выберите проект перед редактированием сценария." action="Назад" onAction={onBack} />;
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
                    {scene.durationSeconds} сек · {scene.status}
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
                <Field label="ДЛИТЕЛЬНОСТЬ, СЕК">
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={selected.durationSeconds}
                    onChange={(event) =>
                      updateScene({
                        durationSeconds: Math.max(1, Number(event.target.value)),
                      })
                    }
                  />
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
          <ToggleRow label="POP WORDS" checked={draft.popWords} onChange={(popWords) => setDraft({ ...draft, popWords })} />
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

function Director({ busy, onCreate, onPickTopic, onInfo, onLog }: { busy: boolean; onCreate: () => void; onPickTopic: (analysis: ReferenceAnalysis) => void; onInfo: (message: string) => void; onLog: (text: string) => void }) {
  const api = window.goldWork ?? fallbackApi;
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [analysis, setAnalysis] = useState<ReferenceAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!analyzing) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, [analyzing]);
  useEffect(() => api.onDirectorProgress((stage) => setStreamingText(stage)), []);
  const [chatTopics, setChatTopics] = useState<ChatTopicSummary[]>([]);
  const [currentTopicId, setCurrentTopicId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [targetMinutes, setTargetMinutes] = useState(5);
  const [language, setLanguage] = useState("Русский");
  useEffect(() => {
    if (!analysis) return;
    const seconds = analysis.youtubeContext?.durationSeconds ?? 0;
    if (seconds > 0) setTargetMinutes(Math.max(1, Math.round((seconds + 90) / 60)));
    if (analysis.language) setLanguage(analysis.language);
  }, [analysis?.sourceUrl]);

  async function refreshChatTopics() {
    setChatTopics(await api.listChatTopics());
  }

  useEffect(() => {
    void refreshChatTopics().catch(() => setChatTopics([]));
  }, []);

  async function sendPrompt() {
    const text = prompt.trim();
    if (!text || analyzing) return;
    setMessages((current) => [...current, { role: "user", text }]);
    setPrompt("");
    setAnalyzing(true);
    let topicId = currentTopicId;
    try {
      if (!topicId) {
        const created = await api.createChatTopic(text);
        topicId = created.id;
        setCurrentTopicId(created.id);
      }
      try {
        await api.appendChatMessage(topicId, { role: "user", content: text });
      } catch {
        // Тема могла быть удалена — создаём новую и продолжаем, не роняя запрос.
        const created = await api.createChatTopic(text);
        topicId = created.id;
        setCurrentTopicId(created.id);
        await api.appendChatMessage(topicId, { role: "user", content: text });
      }
      await refreshChatTopics();
      const appendAssistant = async (answer: string) => {
        // Плавное появление ответа (эффект печати), затем фиксация сообщения.
        const step = Math.max(6, Math.ceil(answer.length / 70));
        for (let index = step; index < answer.length; index += step) {
          setStreamingText(answer.slice(0, index));
          await new Promise((resolve) => setTimeout(resolve, 16));
        }
        setStreamingText(null);
        setMessages((current) => [...current, { role: "assistant", text: answer }]);
        await api.appendChatMessage(topicId!, { role: "assistant", content: answer });
        await refreshChatTopics();
      };
      const url = text.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[),.;]+$/, "");
      if (url) {
        setStreamingText("Собираю данные ролика и канала, пишу разбор и превью сцен…");
        const result = await api.analyzeReference({ url, instructions: text.replace(url, "").trim(), language: "Русский" });
        setStreamingText(null);
        setAnalysis(result);
        await api.saveChatTopicAnalysis(topicId!, result).catch(() => undefined);
        await appendAssistant(`Разбор готов: ниша, аудитория, сильные стороны, что улучшить — всё в карточке ниже.\n\nНа основе данных канала я предложил ${result.suggestedTopics?.length ?? 0} темы для нового ролика — выбери одну кнопкой в карточке, и я соберу полный сценарий и открою проект. Либо напиши свою длину («5 минут») или пожелание («сделай хук жёстче»).`);
        onInfo("Референс разобран. Укажи длину ролика или сразу создай проект.");
      } else if (analysis) {
        const requestedSeconds = parseDurationSeconds(text);
        const looksLikeQuestion = /\?\s*$/.test(text.trim()) || /^(сколько|что|какой|какая|какие|каков|почему|когда|кто|где|как)\b/i.test(text.trim());
        const chatContext = !requestedSeconds && looksLikeQuestion ? youtubeChatContext(analysis) : null;
        if (chatContext && (await api.getAnyModelSettings()).configured) {
          // Вопрос по данным — отвечаем напрямую с реальной статистикой YouTube, не пересобирая разбор.
          let streamed = "";
          const answer = await api.streamChatWithAnyModel([
            { role: "system", content: chatContext },
            ...messages.map((message) => ({ role: message.role, content: message.text }) as const),
            { role: "user", content: text },
          ], (chunk) => {
            streamed += chunk;
            setStreamingText(streamed);
          });
          await appendAssistant(answer);
          setStreamingText(null);
        } else if (requestedSeconds) {
          setStreamingText(`Собираю сцены под ~${Math.round((requestedSeconds / 60) * 10) / 10} мин…`);
          const resized = await api.regenerateReferenceScenes(analysis, requestedSeconds);
          setStreamingText(null);
          setAnalysis(resized);
          await api.saveChatTopicAnalysis(topicId!, resized).catch(() => undefined);
          const minutes = Math.round((requestedSeconds / 60) * 10) / 10;
          await appendAssistant(`Пересобрал сценарий под ~${minutes} мин: ${resized.scenes.length} сцен по 5 секунд. Можешь уточнить длину ещё раз, поправить хук или нажать «Согласен — запустить генерацию».`);
        } else {
          setStreamingText("Обновляю разбор с учётом пожелания…");
          const refined = await api.refineReferenceAnalysis(analysis, text);
          setStreamingText(null);
          setAnalysis(refined);
          await api.saveChatTopicAnalysis(topicId!, refined).catch(() => undefined);
          await appendAssistant(`Разбор обновлён с учётом пожелания: «${text}». Хук и сценарные сцены подготовлены для создания проекта.`);
        }
      } else {
        const provider = await api.getAnyModelSettings();
        if (provider.configured) {
          let streamed = "";
          const answer = await api.streamChatWithAnyModel([
            ...messages.map((message) => ({ role: message.role, content: message.text }) as const),
            { role: "user", content: text },
          ], (chunk) => {
            streamed += chunk;
            setStreamingText(streamed);
          });
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
    setAnalyzing(true);
    onLog(`Пишу сценарий: ${label}`);
    setMessages((current) => [...current, { role: "assistant", text: `Пишу сценарий по теме «${label}». Прогресс — ниже.` }]);
    setStreamingText("Пишу сценарий: подготовка…");
    try {
      const targetSeconds = Math.max(30, Math.round(targetMinutes * 60));
      const full = await api.regenerateReferenceScenes({ ...base, language }, targetSeconds);
      setStreamingText(null);
      setMessages((current) => [...current, { role: "assistant", text: `Сценарий готов: ${full.scenes.length} сцен (у каждой — текст озвучки и промпт для картинки). Открываю проект.` }]);
      onPickTopic(full);
    } catch (reason) {
      setStreamingText(null);
      setMessages((current) => [...current, { role: "assistant", text: `Не удалось собрать сценарий: ${errorMessage(reason)}` }]);
    } finally {
      setAnalyzing(false);
      setStreamingText(null);
    }
  }

  function pickTopic(topic: { title: string; hook: string; angle: string }) {
    if (!analysis) return;
    setMessages((current) => [...current, { role: "user", text: `Выбрана тема: «${topic.title}»` }]);
    void buildAndOpen({
      ...analysis,
      suggestedTitle: topic.title,
      hook: topic.hook || analysis.hook,
      suggestedAngle: topic.angle || analysis.suggestedAngle
    }, topic.title);
  }

  async function openTopic(id: string) {
    const topic = await api.getChatTopic(id);
    if (!topic) return;
    setCurrentTopicId(topic.id);
    setMessages(topic.messages.filter((message) => message.role !== "system").map((message) => ({
      role: message.role as "user" | "assistant",
      text: message.content
    })));
    setAnalysis(topic.analysis ?? null);
    setHistoryOpen(false);
    onInfo(`Открыта тема «${topic.title}»`);
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

  return (
    <div className="director-page">
      <PageHeading
        icon={<WandSparkles size={24} />}
        title="AI Генератор пресетов"
        subtitle="Создавай сценарии через чат с AI"
        actions={
          <>
            <button className="icon-button" title="Статус AI-провайдера" onClick={() => onInfo("Сейчас активен локальный mock-режим. Gemini или Claude подключатся через адаптер провайдера.")}>
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
              <button className="ghost-button" disabled={busy} onClick={onCreate}>
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
              <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
                {message.text}
                {message.role === "assistant" && (
                  <div className="message-files">
                    <span>characters.json</span>
                    <span>locations.json</span>
                    <span>scenario.json</span>
                  </div>
                )}
              </article>
            ))}
            {analyzing && streamingText === null && (
              <article className="message assistant thinking-message">
                <span>Думаю над запросом · {elapsedSeconds} с</span>
                <i /><i /><i />
              </article>
            )}
            {streamingText !== null && (() => {
              const match = /(\d+)\s*из\s*(\d+)/.exec(streamingText);
              const percent = match ? Math.min(100, Math.round((Number(match[1]) / Math.max(1, Number(match[2]))) * 100)) : null;
              return (
                <article className="message assistant streaming-message">
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
              <article className="reference-analysis">
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
                      Кадры ролика не анализировались. Источник текста: {({ captions: "субтитры", "yt-dlp-captions": "субтитры (yt-dlp)", "gemini-audio": "аудио → Gemini", none: "недоступен (нужен вход/cookies)" } as const)[analysis.youtubeContext.transcriptSource]}.
                      {analysis.youtubeContext.transcriptionAudioMegabytes ? ` Аудио для Gemini: ${analysis.youtubeContext.transcriptionAudioMegabytes} МБ — расход токенов учитывается провайдером.` : " Транскрибация аудио не потребовалась, дополнительных токенов на неё нет."}
                    </p>
                  </div>
                )}
                <div className="build-options">
                  <label>
                    <span>ДЛИНА РОЛИКА (МИН)</span>
                    <input type="number" min={1} max={60} value={targetMinutes} disabled={analyzing} onChange={(event) => setTargetMinutes(Math.max(1, Math.min(60, Number(event.target.value) || 1)))} />
                  </label>
                  <label>
                    <span>ЯЗЫК</span>
                    <input value={language} disabled={analyzing} onChange={(event) => setLanguage(event.target.value)} placeholder="Русский" />
                  </label>
                  <small>Сценарий соберётся под эту длину (сцены по 5 сек) и на этом языке. Ничего не запускается без твоей кнопки.</small>
                </div>
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
                  <button className="generate-button" disabled={busy || analyzing} onClick={() => void buildAndOpen(analysis, analysis.suggestedTitle || "улучшенный ролик")}>
                    <WandSparkles size={15} />
                    Написать сценарий и создать проект
                  </button>
                </footer>
              </article>
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
        <input value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void sendPrompt()} placeholder="Опиши идею или вставь ссылку на ролик..." />
        <button className="send" onClick={() => void sendPrompt()} disabled={!prompt.trim() || analyzing}>
          <Send size={19} />
        </button>
      </div>
    </div>
  );
}

function ProjectsPage({ projects, busy, onCreate, onOpen, onDuplicate, onDelete, onPreview, onTimeline, onGenerate }: { projects: Project[]; busy: boolean; onCreate: () => void; onOpen: (id: string) => void; onDuplicate: (id: string) => void; onDelete: (id: string) => void; onPreview: (id: string) => void; onTimeline: (id: string) => void; onGenerate: (id: string) => void }) {
  return (
    <div>
      <PageHeading
        icon={<FolderOpen size={24} />}
        title="Проекты"
        subtitle="Все сохранённые проекты и материалы"
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
        <div className="projects-cards">
          {projects.map((project) => (
            <article key={project.id}>
              <div className="project-cover" onClick={() => onPreview(project.id)}>
                <Clapperboard size={26} />
                <span>{project.aspectRatio}</span>
              </div>
              <h3>{project.title}</h3>
              <p>{project.topic}</p>
              <div className="project-card-meta">
                <span>{project.scenes.length} сцен</span>
                <span>{Math.round(project.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0))} сек</span>
                <span className={`status-${project.status}`}>{statusLabels[project.status]}</span>
              </div>
              <div className="card-action-grid">
                <button onClick={() => onOpen(project.id)}>
                  <Settings size={14} />
                  Настроить
                </button>
                <button onClick={() => onPreview(project.id)}>
                  <Eye size={14} />
                  Превью
                </button>
                <button onClick={() => onTimeline(project.id)}>
                  <Clock3 size={14} />
                  Таймлайн
                </button>
                <button onClick={() => onDuplicate(project.id)}>
                  <Copy size={14} />
                  Копия
                </button>
                <button className="danger" onClick={() => onDelete(project.id)}>
                  <Trash2 size={14} />
                  Удалить
                </button>
                <button className="gold" onClick={() => onGenerate(project.id)}>
                  <Play size={14} />
                  Запустить
                </button>
              </div>
            </article>
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

function ProjectPreviewModal({ project, initialMode, onClose, onRegenerate, onOpenFolder }: { project: Project; initialMode: "preview" | "timeline"; onClose: () => void; onRegenerate: (sceneId: string) => void; onOpenFolder: () => void }) {
  const [mode, setMode] = useState(initialMode);
  const totalDuration = project.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const maxDuration = Math.max(totalDuration, 1);
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
            <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}>
              <Grid2X2 size={14} />
              Сцены
            </button>
            <button className={mode === "timeline" ? "active" : ""} onClick={() => setMode("timeline")}>
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
        {mode === "preview" ? (
          <div className="scene-gallery">
            {project.scenes.length === 0 ? (
              <EmptyState icon={<Image size={32} />} title="Нет сцен" text="Добавьте сцены в редакторе сценария." action="Закрыть" onAction={onClose} />
            ) : (
              project.scenes.map((scene) => (
                <article className="preview-scene" key={scene.id}>
                  <div className="scene-placeholder">
                    <Image size={28} />
                    <span>{scene.status}</span>
                  </div>
                  <div>
                    <strong>
                      Сцена {scene.order + 1}: {scene.title}
                    </strong>
                    <p>{scene.narration || "Текст озвучки не задан"}</p>
                    <small>
                      {scene.durationSeconds} сек · {scene.imagePath ? "изображение готово" : "изображение ожидается"} · {scene.videoPath ? "видео готово" : "видео ожидается"}
                    </small>
                    <button className="retry-button" disabled={project.status === "generating" || project.status === "paused"} onClick={() => onRegenerate(scene.id)}>
                      <RotateCcw size={13} />
                      Перегенерировать сцену
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        ) : (
          <div className="timeline">
            <div className="timeline-ruler">
              <span>0:00</span>
              <span>{Math.round(totalDuration / 2)} сек</span>
              <span>{totalDuration} сек</span>
            </div>
            {(["Видео / фото", "Озвучка", "Субтитры"] as const).map((track) => (
              <div className="timeline-track" key={track}>
                <strong>{track}</strong>
                <div>
                  {project.scenes.map((scene) => (
                    <span
                      key={scene.id}
                      style={{
                        width: `${Math.max(8, (scene.durationSeconds / maxDuration) * 100)}%`,
                      }}
                      title={scene.title}
                    >
                      {scene.order + 1}
                      <small>{scene.title}</small>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <footer>
          <button className="outline-button" onClick={onOpenFolder}>
            <FolderOpen size={15} />
            Открыть папку
          </button>
          <button className="outline-button" onClick={onClose}>
            Закрыть
          </button>
          <button className="generate-button" onClick={() => setMode(mode === "preview" ? "timeline" : "preview")}>
            {mode === "preview" ? <Clock3 size={15} /> : <Grid2X2 size={15} />}
            {mode === "preview" ? "Открыть таймлайн" : "Показать сцены"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function SettingsPage({ appInfo }: { appInfo: Awaited<ReturnType<DesktopApi["getAppInfo"]>> | null }) {
  const api = window.goldWork ?? fallbackApi;
  const [activeTab, setActiveTab] = useState<"general" | "ai" | "images" | "voice" | "video" | "storage">("general");
  const [anyModel, setAnyModel] = useState<AnyModelSettings>({ configured: false, baseUrl: "https://anymodel.org/v1", textModel: "cc/claude-sonnet-5", imageModel: "ag/gemini-3.1-flash-image", videoModel: "xai/grok-imagine-video", ttsModel: "google-tts", imageRefModel: "gpt-image-2", transcriptionModel: "gc/gemini-2.5-flash" });
  const [apiKey, setApiKey] = useState("");
  const [youtube, setYouTube] = useState<YouTubeSettings>({ configured: false, cookiesFileConfigured: false, workDirConfigured: false });
  const [youtubeApiKey, setYouTubeApiKey] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("");
  useEffect(() => {
    void Promise.all([api.getAnyModelSettings(), api.getYouTubeSettings()]).then(([anyModelSettings, youtubeSettings]) => {
      setAnyModel(anyModelSettings);
      setYouTube(youtubeSettings);
    });
  }, []);
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

function ConsoleDock({ open, queue, log, onToggle }: { open: boolean; queue: QueueTask[]; log: Array<{ time: string; level: string; text: string }>; onToggle: () => void }) {
  const running = queue.filter((task) => task.status === "running").length;
  const linesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && linesRef.current) linesRef.current.scrollTop = linesRef.current.scrollHeight;
  }, [log, open]);
  return (
    <div className={`console-dock${open ? " open" : ""}`}>
      <button className="console-head" onClick={onToggle}>
        <span>
          <SquareTerminal size={14} />
          CONSOLE OUTPUT <em>{log.length}</em>
        </span>
        <span>
          <b style={{ opacity: 0.7 }}>очередь: {running}/{queue.length}</b>
          {open ? "⌄" : "⌃"}
        </span>
      </button>
      {open && (
        <div className="console-lines" ref={linesRef}>
          {log.length === 0 && (
            <p><time>{new Date().toLocaleTimeString("ru-RU")}</time><b>INFO</b> Интерфейс GoldWork Studio запущен</p>
          )}
          {log.map((line, index) => (
            <p key={index}>
              <time>{line.time}</time>
              <b>{line.level}</b> {line.text}
            </p>
          ))}
        </div>
      )}
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
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="toggle-row">
      <span>{label}</span>
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
