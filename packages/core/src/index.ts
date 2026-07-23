import {
  createDefaultProjectSettings,
  type AnalyzeReferenceInput,
  type CreateReferenceProjectInput,
  type CreateProjectInput,
  type Project,
  type ProjectSettings,
  type QueueTask,
  type ReferenceAnalysis,
  type Scene,
  type UpdateProjectInput
} from "@gold-work/shared";

export interface DirectorBrief {
  topic: string;
  language: string;
  durationSeconds: number;
}

export interface DirectorProvider {
  readonly id: string;
  createScenes(brief: DirectorBrief): Promise<Scene[]>;
  analyzeReference(input: AnalyzeReferenceInput): Promise<ReferenceAnalysis>;
  refineReference(analysis: ReferenceAnalysis, instructions: string): Promise<ReferenceAnalysis>;
}

export interface ProviderContext {
  projectId: string;
  sceneId?: string;
  signal?: AbortSignal;
}

export interface GeneratedMedia {
  provider: string;
  path: string;
  mimeType: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface ImageProvider {
  readonly id: string;
  generate(prompt: string, aspectRatio: Project["aspectRatio"], context: ProviderContext): Promise<GeneratedMedia>;
}

export interface SpeechProvider {
  readonly id: string;
  synthesize(text: string, voice: string, context: ProviderContext): Promise<GeneratedMedia>;
}

export interface VideoProvider {
  readonly id: string;
  animate(imagePath: string, prompt: string, durationSeconds: number, context: ProviderContext): Promise<GeneratedMedia>;
}

export interface ProjectRepository {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | undefined>;
  save(project: Project): Promise<void>;
  mutate(id: string, updater: (project: Project) => Project): Promise<Project>;
  delete(id: string): Promise<void>;
}

export interface TaskRepository {
  list(): Promise<QueueTask[]>;
  replace(tasks: QueueTask[]): Promise<void>;
}

export const createId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

function mergeSettings(settings?: ProjectSettings): ProjectSettings {
  const defaults = createDefaultProjectSettings();
  if (!settings) return defaults;
  return {
    ...defaults,
    ...settings,
    script: { ...defaults.script, ...settings.script },
    voice: { ...defaults.voice, ...settings.voice },
    image: { ...defaults.image, ...settings.image, references: [...(settings.image?.references ?? [])] },
    video: { ...defaults.video, ...settings.video },
    music: { ...defaults.music, ...settings.music },
    subtitles: { ...defaults.subtitles, ...settings.subtitles },
    assembly: { ...defaults.assembly, ...settings.assembly }
  };
}

export function normalizeProject(project: Project): Project {
  return {
    ...project,
    settings: mergeSettings(project.settings),
    scenes: [...project.scenes]
      .sort((a, b) => a.order - b.order)
      .map((scene, index) => ({ ...scene, order: index, status: scene.status ?? "draft" }))
  };
}

export class MockDirectorProvider implements DirectorProvider {
  readonly id = "mock-director";

  async createScenes(brief: DirectorBrief): Promise<Scene[]> {
    const sceneDuration = Math.max(4, Math.round(brief.durationSeconds / 3));
    const beats = [
      {
        title: "Завязка",
        narration: `Обычный день меняется, когда начинается история о теме «${brief.topic}».`,
        image: "Главный герой впервые сталкивается с неожиданным событием"
      },
      {
        title: "Главная мысль",
        narration: `Герой делает важный выбор и раскрывает главную мысль темы «${brief.topic}».`,
        image: "Ключевой момент истории, выразительная эмоция героя"
      },
      {
        title: "Финал",
        narration: `История завершается понятным выводом и ярким финальным кадром.`,
        image: "Тёплый финальный кадр с главным героем, ощущение завершённости"
      }
    ];
    return beats.map((beat, index) => ({
      id: createId("scene"),
      order: index,
      title: beat.title,
      imagePrompt: `${brief.topic}. ${beat.image}. Семейная 3D-анимация, кинематографичный свет, единый стиль`,
      animationPrompt: "Плавное кинематографичное движение камеры, естественное движение персонажей",
      narration: beat.narration,
      durationSeconds: sceneDuration,
      status: "draft"
    }));
  }

  async analyzeReference(input: AnalyzeReferenceInput): Promise<ReferenceAnalysis> {
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      throw new Error("Укажите полную ссылку на ролик, например https://youtube.com/watch?v=...");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Поддерживаются только HTTP/HTTPS-ссылки");
    const language = input.language ?? "Русский";
    const niche = "Развлекательный или образовательный YouTube-контент";
    const angle = input.instructions?.trim() || "Сделать самостоятельный ролик в той же нише, усилив первые 30 секунд и удержание";
    const sceneBriefs = [
      ["Хук", "Большинство зрителей упускают главную деталь — и именно она полностью меняет результат."],
      ["Обещание", "За несколько минут разберём путь от распространённой ошибки до понятного решения."],
      ["Контекст", "Сначала покажем проблему на знакомом зрителю примере и объясним, почему она возникает."],
      ["Поворот", "Затем добавим неожиданный факт, который заставляет пересмотреть привычный подход."],
      ["Практика", "Покажем последовательность действий и закрепим её на конкретном примере."],
      ["Финал", "Соберём выводы, дадим зрителю следующий шаг и мягкий призыв подписаться."]
    ];
    const duration = 60;
    const scenes = sceneBriefs.map(([title, narration], order) => ({
      id: createId("scene"),
      order,
      title: title!,
      narration: narration!,
      imagePrompt: `${niche}. ${title}. Визуально сильный кадр, единый стиль, кинематографичный свет, без копирования персонажей и брендинга референса`,
      animationPrompt: "Выразительное движение камеры, визуальный акцент на главной мысли сцены",
      durationSeconds: Math.round(duration / sceneBriefs.length),
      status: "draft" as const
    }));
    return {
      sourceUrl: parsed.toString(),
      sourceTitle: `Референс с ${parsed.hostname.replace(/^www\./, "")}`,
      niche,
      targetAudience: "Зрители 18–44 лет, которым нужен быстрый понятный результат",
      hook: "Большинство зрителей упускают главную деталь — и именно она полностью меняет результат.",
      structure: ["0–5 сек: сильный хук", "5–15 сек: обещание результата", "Основная часть: проблема → поворот → решение", "Финал: вывод и следующий шаг"],
      strengths: ["Понятная тема", "Возможность быстро показать ценность", "Формат легко масштабируется в серию"],
      improvements: ["Усилить конкретику первого кадра", "Убрать длинное вступление", "Добавлять новый визуальный акцент каждые 5–8 секунд", "Сделать финал связанным с обещанием из хука"],
      suggestedAngle: angle,
      suggestedTitle: "Главная ошибка, которая мешает получить результат",
      recommendedDurationSeconds: duration,
      language,
      instructions: input.instructions,
      scenes,
      provider: this.id
    };
  }

  async refineReference(analysis: ReferenceAnalysis, instructions: string): Promise<ReferenceAnalysis> {
    const request = instructions.trim();
    if (!request) return analysis;
    const hook = request.toLowerCase().includes("хук")
      ? `Ты уверен, что делаешь всё правильно? Через ${Math.max(1, Math.round(analysis.recommendedDurationSeconds / 60))} минут станет ясно, где теряется результат.`
      : analysis.hook;
    return {
      ...analysis,
      hook,
      instructions: [analysis.instructions, request].filter(Boolean).join("\n"),
      suggestedAngle: `${analysis.suggestedAngle}. Дополнительное пожелание: ${request}`,
      improvements: [...analysis.improvements, `Учесть пожелание: ${request}`],
      scenes: analysis.scenes.map((scene, index) =>
        index === 0 ? { ...scene, narration: hook, imagePrompt: `${scene.imagePrompt}. Сильный контрастный первый кадр для хука` } : scene
      )
    };
  }
}

export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly director: DirectorProvider
  ) {}

  async list(): Promise<Project[]> {
    const projects = await this.projects.list();
    return projects.map(normalizeProject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Project | undefined> {
    const project = await this.projects.get(id);
    return project ? normalizeProject(project) : undefined;
  }

  async create(input: CreateProjectInput, withDemoScenes = false): Promise<Project> {
    const now = new Date().toISOString();
    const scenes = withDemoScenes
      ? await this.director.createScenes({ topic: input.topic, language: input.language, durationSeconds: 30 })
      : [];
    const settings = createDefaultProjectSettings();
    settings.video.enabled = input.mode === "pro";
    settings.assembly.kenBurns = input.mode === "standard";
    settings.assembly.fadeTransitions = input.mode === "standard";
    const project: Project = normalizeProject({
      id: createId("project"),
      ...input,
      status: scenes.length ? "ready" : "draft",
      createdAt: now,
      updatedAt: now,
      scenes,
      settings
    });
    await this.projects.save(project);
    return project;
  }

  async analyzeReference(input: AnalyzeReferenceInput): Promise<ReferenceAnalysis> {
    return this.director.analyzeReference(input);
  }

  async refineReference(analysis: ReferenceAnalysis, instructions: string): Promise<ReferenceAnalysis> {
    return this.director.refineReference(analysis, instructions);
  }

  async createFromReference(input: CreateReferenceProjectInput): Promise<Project> {
    const now = new Date().toISOString();
    const settings = createDefaultProjectSettings();
    settings.durationMinutes = Math.max(1, Math.ceil(input.analysis.recommendedDurationSeconds / 60));
    settings.video.enabled = input.mode === "pro";
    settings.assembly.kenBurns = input.mode === "standard";
    settings.assembly.fadeTransitions = input.mode === "standard";
    const project = normalizeProject({
      id: createId("project"),
      title: input.analysis.suggestedTitle,
      topic: input.analysis.suggestedAngle,
      aspectRatio: input.aspectRatio,
      language: input.analysis.language,
      mode: input.mode,
      status: "ready",
      createdAt: now,
      updatedAt: now,
      scenes: input.analysis.scenes.map((scene, order) => ({ ...scene, id: createId("scene"), order, status: "draft" })),
      settings,
      referenceAnalysis: input.analysis
    });
    await this.projects.save(project);
    return project;
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    return this.mutate(id, (current) => {
      if (input.scenes && (current.status === "generating" || current.status === "paused")) {
        throw new Error("Нельзя менять состав сцен во время активной генерации. Сначала остановите очередь.");
      }
      const contentChanged = input.topic !== undefined || input.aspectRatio !== undefined || input.language !== undefined || input.mode !== undefined || input.scenes !== undefined || input.settings !== undefined || input.chatTopicId !== undefined;
      const active = current.status === "generating" || current.status === "paused";
      return {
        ...input,
        status: input.status ?? (contentChanged && !active ? (input.scenes ?? current.scenes).length ? "ready" : "draft" : current.status),
        outputPath: contentChanged ? undefined : input.outputPath ?? current.outputPath
      };
    });
  }

  async mutate(id: string, updater: (project: Project) => UpdateProjectInput): Promise<Project> {
    return this.projects.mutate(id, (stored) => {
      const current = normalizeProject(stored);
      const input = updater(structuredClone(current));
      return normalizeProject({
        ...current,
        ...input,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
        scenes: input.scenes ?? current.scenes,
        settings: input.settings ?? current.settings
      });
    });
  }

  async duplicate(id: string): Promise<Project> {
    const source = await this.require(id);
    const now = new Date().toISOString();
    const duplicate = normalizeProject({
      ...structuredClone(source),
      id: createId("project"),
      title: `${source.title} — копия`,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      outputPath: undefined,
      scenes: source.scenes.map((scene, order) => ({
        ...scene,
        id: createId("scene"),
        order,
        status: "draft",
        imagePath: undefined,
        videoPath: undefined,
        audioPath: undefined
      }))
    });
    await this.projects.save(duplicate);
    return duplicate;
  }

  async delete(id: string): Promise<void> {
    await this.projects.delete(id);
  }

  private async require(id: string): Promise<Project> {
    const project = await this.get(id);
    if (!project) throw new Error(`Проект ${id} не найден`);
    return project;
  }
}

export class MemoryProjectRepository implements ProjectRepository {
  private readonly projects = new Map<string, Project>();
  private mutation: Promise<void> = Promise.resolve();

  async list(): Promise<Project[]> {
    return [...this.projects.values()]
      .map((project) => structuredClone(project))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Project | undefined> {
    const project = this.projects.get(id);
    return project ? structuredClone(project) : undefined;
  }

  async save(project: Project): Promise<void> {
    await this.enqueue(async () => {
      this.projects.set(project.id, structuredClone(project));
    });
  }

  async mutate(id: string, updater: (project: Project) => Project): Promise<Project> {
    return this.enqueue(async () => {
      const project = this.projects.get(id);
      if (!project) throw new Error(`Проект ${id} не найден`);
      const updated = updater(structuredClone(project));
      this.projects.set(id, structuredClone(updated));
      return structuredClone(updated);
    });
  }

  async delete(id: string): Promise<void> {
    await this.enqueue(async () => {
      this.projects.delete(id);
    });
  }

  private async enqueue<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.mutation;
    let release: () => void = () => undefined;
    this.mutation = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }
}

export class MemoryTaskRepository implements TaskRepository {
  private tasks: QueueTask[] = [];

  async list(): Promise<QueueTask[]> {
    return structuredClone(this.tasks);
  }

  async replace(tasks: QueueTask[]): Promise<void> {
    this.tasks = structuredClone(tasks);
  }
}
