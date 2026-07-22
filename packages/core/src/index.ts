import type { CreateProjectInput, Project, QueueTask, Scene } from "@gold-work/shared";

export interface DirectorBrief {
  topic: string;
  language: string;
  durationSeconds: number;
}

export interface DirectorProvider {
  readonly id: string;
  createScenes(brief: DirectorBrief): Promise<Scene[]>;
}

export interface ProjectRepository {
  list(): Promise<Project[]>;
  save(project: Project): Promise<void>;
}

export interface TaskRepository {
  list(): Promise<QueueTask[]>;
  save(task: QueueTask): Promise<void>;
}

const makeId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

export class MockDirectorProvider implements DirectorProvider {
  readonly id = "mock-director";

  async createScenes(brief: DirectorBrief): Promise<Scene[]> {
    const sceneDuration = Math.max(4, Math.round(brief.durationSeconds / 3));
    const beats = ["Завязка", "Главная мысль", "Финал"];
    return beats.map((title, index) => ({
      id: makeId("scene"),
      order: index,
      title,
      imagePrompt: `${brief.topic}. ${title}. Cinematic illustration, consistent visual style`,
      animationPrompt: "Slow cinematic camera movement, natural motion",
      narration: `${title}: демонстрационный текст для темы «${brief.topic}».`,
      durationSeconds: sceneDuration
    }));
  }
}

export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly director: DirectorProvider
  ) {}

  async list(): Promise<Project[]> {
    return this.projects.list();
  }

  async create(input: CreateProjectInput, withDemoScenes = false): Promise<Project> {
    const now = new Date().toISOString();
    const scenes = withDemoScenes
      ? await this.director.createScenes({ topic: input.topic, language: input.language, durationSeconds: 30 })
      : [];
    const project: Project = {
      id: makeId("project"),
      ...input,
      status: scenes.length ? "ready" : "draft",
      createdAt: now,
      updatedAt: now,
      scenes
    };
    await this.projects.save(project);
    return project;
  }
}

export class MemoryProjectRepository implements ProjectRepository {
  private readonly projects = new Map<string, Project>();

  async list(): Promise<Project[]> {
    return [...this.projects.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(project: Project): Promise<void> {
    this.projects.set(project.id, structuredClone(project));
  }
}

