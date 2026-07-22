import { useEffect, useState } from "react";
import {
  Bot,
  Clapperboard,
  FolderKanban,
  Image,
  Library,
  ListChecks,
  Plus,
  Settings,
  Sparkles,
  WandSparkles
} from "lucide-react";
import type { CreateProjectInput, DesktopApi, Project, QueueTask } from "@gold-work/shared";

type SectionKey = "projects" | "director" | "library" | "queue" | "settings";

const fallbackApi: DesktopApi = {
  listProjects: async () => [],
  createProject: async (input: CreateProjectInput): Promise<Project> => ({
    id: `preview_${Date.now()}`,
    ...input,
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scenes: []
  }),
  createDemoProject: async (): Promise<Project> => ({
    id: `preview_${Date.now()}`,
    title: "Первый демонстрационный ролик",
    topic: "Как одна маленькая привычка меняет день",
    aspectRatio: "9:16",
    language: "Русский",
    mode: "standard",
    status: "ready",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    scenes: []
  }),
  getQueue: async () => [],
  getAppInfo: async () => ({ version: "0.1.0", dataPath: "Режим браузерного предпросмотра", mockMode: true })
};

const sectionTitles: Record<SectionKey, { eyebrow: string; title: string }> = {
  projects: { eyebrow: "РАБОЧЕЕ ПРОСТРАНСТВО", title: "Ваши проекты" },
  director: { eyebrow: "AI-ПОМОЩНИК", title: "Режиссёр" },
  library: { eyebrow: "МАТЕРИАЛЫ", title: "Медиатека" },
  queue: { eyebrow: "ОБРАБОТКА", title: "Очередь задач" },
  settings: { eyebrow: "ПРИЛОЖЕНИЕ", title: "Настройки" }
};

export function App() {
  const api = window.goldWork ?? fallbackApi;
  const [activeSection, setActiveSection] = useState<SectionKey>("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [queue, setQueue] = useState<QueueTask[]>([]);
  const [appInfo, setAppInfo] = useState<Awaited<ReturnType<DesktopApi["getAppInfo"]>> | null>(null);
  const [directorPrompt, setDirectorPrompt] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void api.listProjects().then(setProjects);
    void api.getQueue().then(setQueue);
    void api.getAppInfo().then(setAppInfo);
  }, []);

  async function createDemo() {
    setCreating(true);
    try {
      const project = await api.createDemoProject();
      setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
      setActiveSection("projects");
    } finally {
      setCreating(false);
    }
  }

  function navigate(section: SectionKey) {
    setActiveSection(section);
    if (section === "queue") void api.getQueue().then(setQueue);
    if (section === "settings") void api.getAppInfo().then(setAppInfo);
  }

  const heading = sectionTitles[activeSection];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">G</div><div><strong>Gold Work</strong><span>STUDIO</span></div></div>
        <nav aria-label="Главная навигация">
          <NavButton active={activeSection === "projects"} onClick={() => navigate("projects")} icon={<FolderKanban size={19} />} label="Проекты" />
          <NavButton active={activeSection === "director"} onClick={() => navigate("director")} icon={<Bot size={19} />} label="Режиссёр" badge="AI" />
          <NavButton active={activeSection === "library"} onClick={() => navigate("library")} icon={<Library size={19} />} label="Медиатека" />
          <NavButton active={activeSection === "queue"} onClick={() => navigate("queue")} icon={<Clapperboard size={19} />} label="Очередь" />
        </nav>
        <div className="sidebar-spacer" />
        <div className="mock-card"><Sparkles size={17} /><div><strong>Mock-режим</strong><span>API пока не требуются</span></div></div>
        <NavButton active={activeSection === "settings"} onClick={() => navigate("settings")} icon={<Settings size={19} />} label="Настройки" />
      </aside>

      <main>
        <header className="topbar">
          <div><p className="eyebrow">{heading.eyebrow}</p><h1>{heading.title}</h1></div>
          {activeSection === "projects" && <button className="primary" onClick={createDemo} disabled={creating}><Plus size={18} />{creating ? "Создаём…" : "Новый проект"}</button>}
        </header>

        {activeSection === "projects" && <ProjectsView projects={projects} creating={creating} onCreate={createDemo} onOpenDirector={() => navigate("director")} />}
        {activeSection === "director" && <DirectorView prompt={directorPrompt} onPromptChange={setDirectorPrompt} creating={creating} onCreate={createDemo} />}
        {activeSection === "library" && <LibraryView projects={projects} />}
        {activeSection === "queue" && <QueueView queue={queue} />}
        {activeSection === "settings" && <SettingsView appInfo={appInfo} />}
      </main>
    </div>
  );
}

function NavButton({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: string }) {
  return <button className={`nav-item${active ? " active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}>{icon}<span className="nav-label">{label}</span>{badge && <span className="badge">{badge}</span>}</button>;
}

function ProjectsView({ projects, creating, onCreate, onOpenDirector }: { projects: Project[]; creating: boolean; onCreate: () => void; onOpenDirector: () => void }) {
  return <>
    <section className="hero">
      <div className="hero-copy"><span className="hero-icon"><WandSparkles size={22} /></span><div><h2>От идеи до готового ролика</h2><p>Опишите задумку — режиссёр подготовит сцены, промпты и структуру проекта.</p></div></div>
      <button className="secondary" onClick={onOpenDirector}><Bot size={18} />Открыть режиссёра</button>
    </section>
    <section className="section-heading"><div><h2>Последние проекты</h2><p>{projects.length ? `${projects.length} в работе` : "Здесь появятся ваши ролики"}</p></div></section>
    {projects.length === 0 ? <EmptyState icon={<Clapperboard size={38} />} title="Начните первый ролик" text="Создайте демонстрационный проект. Он работает локально и не расходует API." action={<button className="primary" onClick={onCreate} disabled={creating}><Plus size={18} />Создать демо-проект</button>} /> :
      <section className="project-grid">{projects.map((project) => <article className="project-card" key={project.id}><div className="project-preview"><span>{project.aspectRatio}</span><WandSparkles size={32} /></div><div className="project-body"><div className="project-status"><span />{project.status === "ready" ? "ГОТОВ К ГЕНЕРАЦИИ" : "ЧЕРНОВИК"}</div><h3>{project.title}</h3><p>{project.topic}</p><div className="meta"><span>{project.scenes.length} сцен</span><span>{project.mode === "standard" ? "Standard" : "Pro"}</span></div></div></article>)}</section>}
  </>;
}

function DirectorView({ prompt, onPromptChange, creating, onCreate }: { prompt: string; onPromptChange: (value: string) => void; creating: boolean; onCreate: () => void }) {
  return <section className="workspace-card director-card"><div className="workspace-icon"><Bot size={28} /></div><div className="workspace-copy"><h2>Расскажите, какой ролик хотите создать</h2><p>Пока работает mock-режим: он создаст готовый демонстрационный проект из трёх сцен. Позже сюда подключится Gemini.</p><textarea value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="Например: короткий вертикальный ролик про психологию привычек…" rows={6} /><div className="director-footer"><span>{prompt.length} символов</span><button className="primary" onClick={onCreate} disabled={creating}><WandSparkles size={18} />{creating ? "Создаём…" : "Создать демо-сценарий"}</button></div></div></section>;
}

function LibraryView({ projects }: { projects: Project[] }) {
  const sceneCount = projects.reduce((total, project) => total + project.scenes.length, 0);
  return <><section className="stats-grid"><StatCard icon={<Image size={22} />} value={sceneCount} label="Сцен и материалов" /><StatCard icon={<FolderKanban size={22} />} value={projects.length} label="Проектов" /></section><EmptyState icon={<Library size={38} />} title="Медиатека готова" text="Здесь будут храниться изображения, видео, аудио, персонажи и локации из проектов." /></>;
}

function QueueView({ queue }: { queue: QueueTask[] }) {
  return queue.length === 0 ? <EmptyState icon={<ListChecks size={38} />} title="Очередь пуста" text="Задачи генерации появятся здесь после запуска обработки сцен." /> : <section className="workspace-card"><div className="queue-list">{queue.map((task) => <div className="queue-row" key={task.id}><span>{task.kind}</span><strong>{task.status}</strong><small>{task.progress}%</small></div>)}</div></section>;
}

function SettingsView({ appInfo }: { appInfo: Awaited<ReturnType<DesktopApi["getAppInfo"]>> | null }) {
  return <section className="workspace-card settings-card"><div><h2>Состояние приложения</h2><p>На этом этапе ключи API не требуются. Настройки провайдеров появятся при подключении нейросетей.</p></div><dl><div><dt>Версия</dt><dd>{appInfo?.version ?? "Загрузка…"}</dd></div><div><dt>Режим</dt><dd>{appInfo?.mockMode ? "Mock — без расходов" : "API"}</dd></div><div><dt>Папка данных</dt><dd title={appInfo?.dataPath}>{appInfo?.dataPath ?? "Загрузка…"}</dd></div></dl></section>;
}

function EmptyState({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return <section className="empty-state"><div className="empty-visual">{icon}</div><h3>{title}</h3><p>{text}</p>{action}</section>;
}

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return <article className="stat-card"><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></article>;
}
