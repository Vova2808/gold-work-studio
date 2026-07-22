import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Bot,
  Bookmark,
  Captions,
  Check,
  ChevronLeft,
  CircleUserRound,
  Clapperboard,
  Copy,
  Download,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  Gauge,
  Grid2X2,
  Image,
  Languages,
  Layers3,
  LayoutDashboard,
  ListPlus,
  LogOut,
  Mic2,
  Monitor,
  MoreHorizontal,
  Music2,
  Paperclip,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  Trash2,
  Upload,
  Video,
  Volume2,
  WandSparkles,
  X,
  Zap
} from "lucide-react";
import type { CreateProjectInput, DesktopApi, Project, QueueTask } from "@gold-work/shared";

type SectionKey =
  | "dashboard"
  | "project"
  | "scenario"
  | "clone"
  | "director"
  | "projects"
  | "subtitles"
  | "thumbnail"
  | "avatar"
  | "seo"
  | "studio"
  | "queue"
  | "console"
  | "settings";

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
    title: "Барсик — космический кот",
    topic: "Семейный мультфильм о приключении ленивого кота в космосе",
    aspectRatio: "16:9",
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

const navigation: Array<{ label?: string; items: Array<{ key: SectionKey; title: string; icon: ReactNode; beta?: boolean }> }> = [
  {
    label: "ГЛАВНОЕ",
    items: [
      { key: "dashboard", title: "Dashboard", icon: <LayoutDashboard size={17} /> },
      { key: "project", title: "Проект", icon: <Clapperboard size={17} /> },
      { key: "scenario", title: "Сценарий", icon: <FileText size={17} /> },
      { key: "clone", title: "Клон YouTube", icon: <Copy size={17} /> },
      { key: "director", title: "AI Генератор", icon: <WandSparkles size={17} /> },
      { key: "projects", title: "Проекты", icon: <FolderOpen size={17} /> }
    ]
  },
  {
    label: "ИНСТРУМЕНТЫ",
    items: [
      { key: "subtitles", title: "Субтитры", icon: <Captions size={17} /> },
      { key: "thumbnail", title: "Превью", icon: <Image size={17} /> },
      { key: "avatar", title: "Аватарка", icon: <CircleUserRound size={17} /> },
      { key: "seo", title: "SEO", icon: <Search size={17} /> },
      { key: "studio", title: "Студия", icon: <Sparkles size={17} />, beta: true },
      { key: "queue", title: "Очередь", icon: <ListPlus size={17} />, beta: true },
      { key: "console", title: "Консоль", icon: <SquareTerminal size={17} /> }
    ]
  }
];

export function App() {
  const api = window.goldWork ?? fallbackApi;
  const [activeSection, setActiveSection] = useState<SectionKey>("dashboard");
  const [projects, setProjects] = useState<Project[]>([]);
  const [queue, setQueue] = useState<QueueTask[]>([]);
  const [appInfo, setAppInfo] = useState<Awaited<ReturnType<DesktopApi["getAppInfo"]>> | null>(null);
  const [creating, setCreating] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const pageScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.listProjects().then(setProjects);
    void api.getQueue().then(setQueue);
    void api.getAppInfo().then(setAppInfo);
  }, []);

  useEffect(() => {
    if (pageScrollRef.current) pageScrollRef.current.scrollTop = 0;
  }, [activeSection]);

  async function createDemo(openProject = true) {
    setCreating(true);
    try {
      const project = await api.createDemoProject();
      setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
      if (openProject) setActiveSection("project");
    } finally {
      setCreating(false);
    }
  }

  function navigate(section: SectionKey) {
    setActiveSection(section);
    if (section === "queue") void api.getQueue().then(setQueue);
    if (section === "settings") void api.getAppInfo().then(setAppInfo);
  }

  return (
    <div className="desktop-frame">
      <TitleBar />
      <div className="app-body">
        <Sidebar active={activeSection} onNavigate={navigate} />
        <section className="work-area">
          <div className="page-scroll" ref={pageScrollRef}>
            {activeSection === "dashboard" && (
              <Dashboard projects={projects} creating={creating} onCreate={() => void createDemo(false)} onNavigate={navigate} />
            )}
            {activeSection === "project" && <ProjectEditor project={projects[0]} />}
            {activeSection === "director" && <Director creating={creating} onCreate={() => void createDemo()} />}
            {activeSection === "projects" && <ProjectsPage projects={projects} creating={creating} onCreate={() => void createDemo()} />}
            {activeSection === "queue" && <QueuePage tasks={queue} />}
            {activeSection === "settings" && <SettingsPage appInfo={appInfo} />}
            {!["dashboard", "project", "director", "projects", "queue", "settings"].includes(activeSection) && (
              <ToolPage section={activeSection} />
            )}
          </div>
          <ConsoleDock open={consoleOpen} onToggle={() => setConsoleOpen((value) => !value)} />
        </section>
      </div>
    </div>
  );
}

function TitleBar() {
  return (
    <header className="titlebar">
      <div className="titlebar-brand"><span>GW</span><strong>GOLDWORK STUDIO</strong></div>
      <div className="window-actions" aria-hidden="true"><button>—</button><button>□</button><button>×</button></div>
    </header>
  );
}

function Sidebar({ active, onNavigate }: { active: SectionKey; onNavigate: (section: SectionKey) => void }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-nav">
        {navigation.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map((item) => (
              <button key={item.key} className={`nav-item${active === item.key ? " active" : ""}`} onClick={() => onNavigate(item.key)}>
                {item.icon}<span>{item.title}</span>{item.beta && <em>BETA</em>}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <div className="profile-card">
          <div><CircleUserRound size={16} /><strong>Owner</strong><span>PRO</span></div>
          <small>Локальный профиль</small>
          <button><LogOut size={14} />Выйти</button>
        </div>
        <button className={`settings-link${active === "settings" ? " active" : ""}`} onClick={() => onNavigate("settings")}>
          <Settings size={17} />Настройки
        </button>
        <div className="app-stats"><span><i />Готов</span><span>GoldWork Studio v0.1.0</span></div>
      </div>
    </aside>
  );
}

function Dashboard({ projects, creating, onCreate, onNavigate }: {
  projects: Project[];
  creating: boolean;
  onCreate: () => void;
  onNavigate: (section: SectionKey) => void;
}) {
  const visibleProjects = projects.length ? projects : [demoProject("demo-1", "Новый проект"), demoProject("demo-2", "Нет темы")];
  const tools: Array<{ title: string; subtitle: string; icon: ReactNode; route: SectionKey }> = [
    { title: "Превью", subtitle: "AI генерация обложек", icon: <Image size={19} />, route: "thumbnail" },
    { title: "Аватарка", subtitle: "Генератор аватарок", icon: <CircleUserRound size={19} />, route: "avatar" },
    { title: "Субтитры", subtitle: "POP WORDS стиль", icon: <Captions size={19} />, route: "subtitles" },
    { title: "SEO", subtitle: "Заголовки и теги", icon: <Search size={19} />, route: "seo" },
    { title: "Сценарий", subtitle: "Auto / Custom", icon: <FileText size={19} />, route: "scenario" }
  ];

  return (
    <div className="dashboard-page page-with-actionbar">
      <PageHeading icon={<Zap size={25} />} title="Dashboard" subtitle="Управление проектами видео" />
      <section className="quick-panel">
        <h2><Grid2X2 size={16} />Быстрые инструменты</h2>
        <div className="quick-grid">
          {tools.map((tool) => (
            <button className="quick-card" key={tool.title} onClick={() => onNavigate(tool.route)}>
              <span>{tool.icon}</span><strong>{tool.title}</strong><small>{tool.subtitle}</small>
            </button>
          ))}
        </div>
      </section>

      <div className="projects-heading">
        <h2><Folder size={17} />Проекты <span>({visibleProjects.length})</span></h2>
        <div><button className="ghost-button"><FolderOpen size={15} />Папка с видео</button><button className="ghost-button" onClick={onCreate}><Plus size={15} />Добавить ({visibleProjects.length}/30)</button></div>
      </div>

      <div className="project-list">
        {visibleProjects.map((project, index) => (
          <button className="project-row" key={project.id} onClick={() => onNavigate("project")}>
            <span className="project-check"><Check size={12} /></span>
            <span className="project-number">{index + 1}</span>
            <span className="project-main"><strong>{project.title}</strong><small><Languages size={12} />{project.language}<i />1 минута<i /><Mic2 size={12} />Edge TTS<i /><Image size={12} />Nano Banana Pro</small></span>
            <span className="project-actions"><i /><span><FolderOpen size={15} /></span><span className="danger"><Trash2 size={15} /></span></span>
          </button>
        ))}
      </div>

      <div className="sticky-actions">
        <div><button className="outline-button" onClick={onCreate} disabled={creating}><Plus size={17} />{creating ? "Создаём..." : "Новый проект"}</button><button className="outline-button gold"><Eye size={17} />Предпросмотр</button></div>
        <button className="generate-button" onClick={() => onNavigate("project")}><Zap size={17} />ГЕНЕРИРОВАТЬ ВИДЕО</button>
      </div>
    </div>
  );
}

function ProjectEditor({ project }: { project?: Project }) {
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [startFrame, setStartFrame] = useState(true);
  const [pairedFrames, setPairedFrames] = useState(false);
  const [muteVeo, setMuteVeo] = useState(true);
  const [subtitles, setSubtitles] = useState(false);
  const [duration, setDuration] = useState("1м");
  const [topic, setTopic] = useState(project?.topic ?? "Барсик — космический кот");

  return (
    <div className="project-page page-with-actionbar">
      <PageHeading icon={<ChevronLeft size={22} />} title={`Проект #${project ? "1" : "1"}`} subtitle="Настройки генерации видео" />
      <div className="preset-bar"><Bookmark size={16} /><span>Пресет:</span><select><option>Выбрать пресет... (3)</option></select><button title="Загрузить"><Download size={16} /></button><button title="Сохранить"><Save size={16} /></button><button className="danger" title="Удалить"><Trash2 size={16} /></button></div>

      <div className="editor-grid">
        <SettingsPanel icon={<SlidersHorizontal size={16} />} title="ОСНОВНЫЕ">
          <Field label="ТЕМА ВИДЕО"><input value={topic} onChange={(event) => setTopic(event.target.value)} /></Field>
          <Field label="ЯЗЫК"><select defaultValue="Русский"><option>Русский</option><option>English</option><option>Español</option></select></Field>
          <Field label="ДЛИТЕЛЬНОСТЬ ВИДЕО">
            <div className="choice-row">{["30с", "1м", "5м", "10м", "15м", "30м", "60м"].map((value) => <button className={duration === value ? "selected" : ""} onClick={() => setDuration(value)} key={value}>{value}</button>)}</div>
          </Field>
          <Field label="СМЕНА КАДРОВ"><select><option>По умолчанию (по сценарию)</option></select><small className="hint">Для опытных пользователей</small></Field>
          <Field label="ФОРМАТ ВИДЕО"><select><option>▣ 16:9 (YouTube)</option><option>▯ 9:16 (Shorts)</option><option>□ 1:1</option></select></Field>
        </SettingsPanel>

        <SettingsPanel icon={<Mic2 size={16} />} title="ОЗВУЧКА">
          <ToggleRow label="Озвучка" checked={voiceEnabled} onChange={setVoiceEnabled} />
          {voiceEnabled && <>
            <Field label="ДВИЖОК ОЗВУЧКИ"><select><option>ElevenLabs API</option><option>Edge TTS</option></select><small>Edge TTS бесплатно. ElevenLabs работает по вашему API ключу.</small></Field>
            <Field label="ШАБЛОН ELEVENLABS"><select><option>ПСИХО</option><option>Мягкий рассказчик</option></select><button className="inline-link">Загрузить шаблоны</button></Field>
            <ToggleRow label="Цельная озвучка" checked={false} onChange={() => undefined} />
          </>}
        </SettingsPanel>

        <SettingsPanel icon={<Image size={16} />} title="ИЗОБРАЖЕНИЯ">
          <Field label="ГЕНЕРАТОР ИЗОБРАЖЕНИЙ"><select><option>Nano Banana Pro</option><option>GPT Image</option></select></Field>
          <Field label="СТИЛЬ ИЗОБРАЖЕНИЙ"><select><option>Photorealistic live-action photography mixed</option><option>Family 3D animation</option></select></Field>
          <ToggleRow label="Последовательная генерация" checked={false} onChange={() => undefined} />
          <Field label="РЕФЕРЕНС ИЗОБРАЖЕНИЯ (0/3)"><button className="upload-box"><Plus size={21} /><span>Добавить референс</span></button><small>Nano Banana Pro — максимум 3 референса.</small></Field>
        </SettingsPanel>

        <SettingsPanel icon={<Video size={16} />} title="AI ВИДЕО & ЭФФЕКТЫ" wide>
          <Field label="РЕЖИМ ГЕНЕРАЦИИ"><select><option>TURBO</option><option>STANDARD</option></select><small>Максимальная скорость. 4 промпта параллельно.</small></Field>
          <ToggleRow label="Veo 3.1 (Image-to-Video)" checked={videoEnabled} onChange={setVideoEnabled} />
          {videoEnabled && <>
            <Field label="МОДЕЛЬ VEO"><select><option>Lite</option><option>Fast</option><option>Quality</option></select></Field>
            <ToggleRow label="Анимация от первого кадра" checked={startFrame} onChange={setStartFrame} />
            <ToggleRow label="Парные кадры (Start + End)" checked={pairedFrames} onChange={setPairedFrames} />
            <ToggleRow label="Без музыки/звука в видео" checked={muteVeo} onChange={setMuteVeo} />
            <Field label="ГРОМКОСТЬ ЗВУКА VEO: 15%"><input type="range" defaultValue="15" /></Field>
          </>}
          <div className="sub-card"><strong>Анимация</strong><small>Сколько видео из всех сцен:</small><input type="range" defaultValue="100" /><label><input type="radio" name="distribution" />Равномерно</label><label><input type="radio" name="distribution" defaultChecked />Затухание (плавно)</label></div>
        </SettingsPanel>
      </div>

      <div className="editor-secondary">
        <SettingsPanel icon={<Music2 size={16} />} title="ФОНОВАЯ МУЗЫКА"><p className="empty-note"><Music2 size={21} />Нет добавленных треков</p><button className="outline-button small"><Upload size={15} />Выбрать трек</button><Field label="ГРОМКОСТЬ: 0.1"><input type="range" defaultValue="10" /></Field></SettingsPanel>
        <SettingsPanel icon={<Captions size={16} />} title="СУБТИТРЫ"><ToggleRow label="Включить субтитры" checked={subtitles} onChange={setSubtitles} /><button className="outline-button small"><SlidersHorizontal size={15} />Настроить стиль субтитров</button></SettingsPanel>
        <SettingsPanel icon={<Sparkles size={16} />} title="КОНТЕНТ"><div className="content-mode">Режим: Custom — 120 сцен</div><button className="outline-button small"><FileText size={15} />Настроить сценарий</button><button className="outline-button small"><Sparkles size={15} />AI Автозаполнение</button><button className="outline-button small"><WandSparkles size={15} />AI Улучшение</button></SettingsPanel>
      </div>

      <div className="sticky-actions editor-actions"><span>Все изменения сохраняются локально</span><div><button className="outline-button"><Save size={16} />Сохранить</button><button className="generate-button"><Zap size={17} />Генерировать видео</button></div></div>
    </div>
  );
}

function Director({ creating, onCreate }: { creating: boolean; onCreate: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);

  function sendPrompt() {
    if (!prompt.trim()) return;
    setMessages((current) => [...current, { role: "user", text: prompt }, { role: "assistant", text: "Я подготовлю идею, персонажей, локации и полный сценарий. Пока API не подключён, можно создать демонстрационный проект." }]);
    setPrompt("");
  }

  return (
    <div className="director-page">
      <PageHeading icon={<WandSparkles size={24} />} title="AI Генератор пресетов" subtitle="Создавай сценарии через чат с AI" actions={<><button className="icon-button"><Bot size={16} /></button><button className="icon-button"><SlidersHorizontal size={16} /></button><button className="ghost-button"><RotateCcw size={15} />История</button><button className="ghost-button"><Plus size={15} />Новый</button></>} />
      <div className="chat-area">
        {messages.length === 0 ? <div className="chat-empty"><WandSparkles size={38} /><h2>Создай сценарий</h2><p>Опиши нишу или идею. AI поможет придумать сюжет и подготовит полный пресет проекта.</p><div><button className="ghost-button" onClick={onCreate}>Сделай сценарий</button><button className="ghost-button">Анализ ниши</button></div><small>Недавние диалоги</small>{["Мультфильм о космическом коте", "История для YouTube", "Первое видео канала"].map((text) => <button className="recent-chat" key={text}><FileText size={13} />{text}<span>сегодня</span></button>)}</div> : <div className="messages">{messages.map((message, index) => <article className={`message ${message.role}`} key={`${message.role}-${index}`}>{message.text}{message.role === "assistant" && <div className="message-files"><span>characters.json</span><span>locations.json</span><span>scenario.json</span></div>}</article>)}</div>}
      </div>
      <div className="chat-composer"><button><Paperclip size={19} /></button><button><Video size={19} /></button><input value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => event.key === "Enter" && sendPrompt()} placeholder="Опиши что нужно или вставь скрин..." /><button className="send" onClick={sendPrompt} disabled={!prompt.trim()}>{creating ? <MoreHorizontal size={19} /> : <Send size={19} />}</button></div>
    </div>
  );
}

function ProjectsPage({ projects, creating, onCreate }: { projects: Project[]; creating: boolean; onCreate: () => void }) {
  return <div><PageHeading icon={<FolderOpen size={24} />} title="Проекты" subtitle="Все сохранённые проекты и материалы" actions={<button className="generate-button" onClick={onCreate}><Plus size={16} />{creating ? "Создаём..." : "Новый проект"}</button>} /><div className="projects-cards">{(projects.length ? projects : [demoProject("empty", "Проект #1")]).map((project) => <article key={project.id}><div><Clapperboard size={26} /><span>{project.aspectRatio}</span></div><h3>{project.title}</h3><p>{project.topic}</p><footer><span><i />{project.status === "ready" ? "Готов к генерации" : "Черновик"}</span><button><MoreHorizontal size={16} /></button></footer></article>)}</div></div>;
}

function QueuePage({ tasks }: { tasks: QueueTask[] }) {
  const mockTasks = tasks.length ? tasks : [
    { id: "audio", label: "Аудио", progress: 0, detail: "Ожидает запуска", icon: <Volume2 size={18} /> },
    { id: "images", label: "Картинки", progress: 35, detail: "42 / 120 сцен", icon: <Image size={18} /> },
    { id: "video", label: "AI Видео", progress: 0, detail: "После изображений", icon: <Video size={18} /> },
    { id: "assemble", label: "Сборка", progress: 0, detail: "Финальный этап", icon: <Clapperboard size={18} /> }
  ];
  return <div><PageHeading icon={<ListPlus size={24} />} title="Очередь" subtitle="Задачи генерации и повторные попытки" actions={<button className="danger-button"><X size={15} />Остановить всё</button>} /><section className="queue-board"><div className="queue-summary"><Stat label="Ожидают" value="3" /><Stat label="В работе" value="1" /><Stat label="Завершено" value="0" /><Stat label="Ошибки" value="0" /></div><div className="queue-cards">{mockTasks.map((task: any) => <article key={task.id}><div className="queue-card-head"><span>{task.icon}</span><div><strong>{task.label ?? task.kind}</strong><small>{task.detail ?? task.status}</small></div><em>{task.progress}%</em></div><div className="progress"><span style={{ width: `${task.progress}%` }} /></div><footer><span>{task.progress ? "Выполняется" : "В очереди"}</span><button><MoreHorizontal size={15} /></button></footer></article>)}</div></section></div>;
}

function SettingsPage({ appInfo }: { appInfo: Awaited<ReturnType<DesktopApi["getAppInfo"]>> | null }) {
  return <div><PageHeading icon={<Settings size={24} />} title="Настройки" subtitle="Провайдеры и параметры приложения" /><div className="settings-layout"><section className="settings-menu"><button className="active">Общие</button><button>AI и сценарии</button><button>Изображения</button><button>Озвучка</button><button>Видео</button><button>Папки и хранение</button></section><section className="settings-content"><h2>Состояние приложения</h2><p>Сейчас работает безопасный mock-режим. Реальные API подключим через отдельные адаптеры.</p><InfoRow label="Версия" value={appInfo?.version ?? "Загрузка..."} /><InfoRow label="Режим" value={appInfo?.mockMode ? "Mock — без расходов" : "API"} /><InfoRow label="Папка данных" value={appInfo?.dataPath ?? "Загрузка..."} /><h2>Очередь</h2><InfoRow label="Параллельные изображения" value="4" /><InfoRow label="Повторные попытки" value="3" /></section></div></div>;
}

function ToolPage({ section }: { section: SectionKey }) {
  const definitions: Partial<Record<SectionKey, { title: string; subtitle: string; icon: ReactNode; action: string }>> = {
    scenario: { title: "Сценарий", subtitle: "Редактирование сцен и текста озвучки", icon: <FileText size={25} />, action: "Создать сценарий" },
    clone: { title: "Клон YouTube", subtitle: "Анализ структуры референсного ролика", icon: <Copy size={25} />, action: "Добавить ссылку" },
    subtitles: { title: "Субтитры", subtitle: "Стилизация и синхронизация текста", icon: <Captions size={25} />, action: "Загрузить видео" },
    thumbnail: { title: "Превью", subtitle: "AI генерация обложек для YouTube", icon: <Image size={25} />, action: "Создать превью" },
    avatar: { title: "Аватарка", subtitle: "Генератор аватаров канала", icon: <CircleUserRound size={25} />, action: "Создать аватар" },
    seo: { title: "SEO", subtitle: "Заголовки, описание и теги", icon: <Search size={25} />, action: "Проанализировать тему" },
    studio: { title: "Студия", subtitle: "Ручная работа со сценами и медиа", icon: <Sparkles size={25} />, action: "Открыть проект" },
    console: { title: "Консоль", subtitle: "Системные события и журнал генерации", icon: <SquareTerminal size={25} />, action: "Очистить журнал" }
  };
  const definition = definitions[section] ?? definitions.studio!;
  return <div><PageHeading icon={definition.icon} title={definition.title} subtitle={definition.subtitle} /><section className="tool-workspace"><div className="tool-hero">{definition.icon}<h2>{definition.title} готов к работе</h2><p>Интерфейс уже подключён к навигации. Функциональность будет добавляться по этапам вместе с API провайдеров.</p><button className="generate-button"><Plus size={16} />{definition.action}</button></div></section></div>;
}

function ConsoleDock({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return <div className={`console-dock${open ? " open" : ""}`}><button className="console-head" onClick={onToggle}><span><SquareTerminal size={14} />CONSOLE OUTPUT <em>4</em></span><span><Search size={13} /><Copy size={13} /><Save size={13} />{open ? "⌄" : "⌃"}</span></button>{open && <div className="console-lines"><p><time>22:18:04</time><b>INFO</b> Интерфейс GoldWork Studio запущен</p><p><time>22:18:05</time><b>QUEUE</b> Очередь готова · 4 параллельных задачи</p></div>}</div>;
}

function SettingsPanel({ icon, title, children, wide }: { icon: ReactNode; title: string; children: ReactNode; wide?: boolean }) {
  return <section className={`settings-panel${wide ? " wide" : ""}`}><h2>{icon}{title}</h2><div className="panel-content">{children}</div></section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="toggle-row"><span>{label}</span><button className={`toggle${checked ? " on" : ""}`} onClick={() => onChange(!checked)} aria-pressed={checked}><i /></button></div>;
}

function PageHeading({ icon, title, subtitle, actions }: { icon: ReactNode; title: string; subtitle: string; actions?: ReactNode }) {
  return <header className="page-heading"><div className="page-title-icon">{icon}</div><div><h1>{title}</h1><p>{subtitle}</p></div>{actions && <div className="heading-actions">{actions}</div>}</header>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <article><span>{label}</span><strong>{value}</strong></article>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="info-row"><span>{label}</span><strong title={value}>{value}</strong></div>;
}

function demoProject(id: string, title: string): Project {
  return { id, title, topic: "Проект для автоматической генерации видео", aspectRatio: "16:9", language: "Русский", mode: "standard", status: "draft", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), scenes: [] };
}
