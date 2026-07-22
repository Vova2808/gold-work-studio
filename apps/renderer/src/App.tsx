import { useEffect, useState } from "react";
import {
  Bot,
  Clapperboard,
  FolderKanban,
  Library,
  Plus,
  Settings,
  Sparkles,
  WandSparkles
} from "lucide-react";
import type { Project } from "@gold-work/shared";

const fallbackApi = {
  listProjects: async (): Promise<Project[]> => [],
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
  })
};

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void (window.goldWork?.listProjects() ?? fallbackApi.listProjects()).then(setProjects);
  }, []);

  async function createDemo() {
    setCreating(true);
    try {
      const project = await (window.goldWork?.createDemoProject() ?? fallbackApi.createDemoProject());
      setProjects((current) => [project, ...current]);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">G</div><div><strong>Gold Work</strong><span>STUDIO</span></div></div>
        <nav>
          <button className="nav-item active"><FolderKanban size={19} />Проекты</button>
          <button className="nav-item"><Bot size={19} />Режиссёр<span className="badge">AI</span></button>
          <button className="nav-item"><Library size={19} />Медиатека</button>
          <button className="nav-item"><Clapperboard size={19} />Очередь</button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="mock-card"><Sparkles size={17} /><div><strong>Mock-режим</strong><span>API пока не требуются</span></div></div>
        <button className="nav-item"><Settings size={19} />Настройки</button>
      </aside>

      <main>
        <header className="topbar">
          <div><p className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p><h1>Ваши проекты</h1></div>
          <button className="primary" onClick={createDemo} disabled={creating}><Plus size={18} />{creating ? "Создаём…" : "Новый проект"}</button>
        </header>

        <section className="hero">
          <div className="hero-copy"><span className="hero-icon"><WandSparkles size={22} /></span><div><h2>От идеи до готового ролика</h2><p>Опишите задумку — режиссёр подготовит сцены, промпты и структуру проекта.</p></div></div>
          <button className="secondary"><Bot size={18} />Открыть режиссёра</button>
        </section>

        <section className="section-heading"><div><h2>Последние проекты</h2><p>{projects.length ? `${projects.length} в работе` : "Здесь появятся ваши ролики"}</p></div></section>

        {projects.length === 0 ? (
          <section className="empty-state"><div className="empty-visual"><Clapperboard size={38} /></div><h3>Начните первый ролик</h3><p>Создайте демонстрационный проект. Он работает локально и не расходует API.</p><button className="primary" onClick={createDemo} disabled={creating}><Plus size={18} />Создать демо-проект</button></section>
        ) : (
          <section className="project-grid">
            {projects.map((project) => <article className="project-card" key={project.id}><div className="project-preview"><span>{project.aspectRatio}</span><WandSparkles size={32} /></div><div className="project-body"><div className="project-status"><span />{project.status === "ready" ? "ГОТОВ К ГЕНЕРАЦИИ" : "ЧЕРНОВИК"}</div><h3>{project.title}</h3><p>{project.topic}</p><div className="meta"><span>{project.scenes.length} сцен</span><span>{project.mode === "standard" ? "Standard" : "Pro"}</span></div></div></article>)}
          </section>
        )}
      </main>
    </div>
  );
}

