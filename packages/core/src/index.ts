import { equalJson } from './json-equal.js';
import {
  createDefaultProjectSettings,
  createDocumentarySettings,
  documentaryMaterialUsable,
  projectScenarioQualityIssue,
  projectMediaMode,
  voiceCalibrationMatches,
  type AnalyzeReferenceInput,
  type CreateReferenceProjectInput,
  type CreateProjectInput,
  type DocumentaryMotionGraphic,
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

export interface ProjectMutationOptions {
  /** Load candidate evidence only for these scenes; deferred evidence is retained on commit. */
  candidateSceneIds?: readonly string[];
}

export interface ProjectRepository {
  list(options?: {omitCandidates?: boolean}): Promise<Project[]>;
  get(id: string, options?: {omitCandidates?: boolean}): Promise<Project | undefined>;
  save(project: Project): Promise<void>;
  mutate(id: string, updater: (project: Project) => Project, options?: ProjectMutationOptions): Promise<Project>;
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
  const stockVideoPercent = Number.isFinite(settings.stockVideoPercent)
    ? Math.min(100, Math.max(0, Math.round(settings.stockVideoPercent)))
    : defaults.stockVideoPercent;
  return {
    ...defaults,
    ...settings,
    stockVideoPercent,
    script: { ...defaults.script, ...settings.script },
    voice: { ...defaults.voice, ...settings.voice },
    image: { ...defaults.image, ...settings.image, references: [...(settings.image?.references ?? [])] },
    video: { ...defaults.video, ...settings.video },
    music: { ...defaults.music, ...settings.music },
    subtitles: { ...defaults.subtitles, ...settings.subtitles, enabled: false },
    assembly: { ...defaults.assembly, ...settings.assembly }
  };
}

export function normalizeProject(project: Project): Project {
  const mergedSettings = mergeSettings(project.settings);
  const documentary = mergedSettings.assembly.documentary;
  const settings: ProjectSettings = {
    ...mergedSettings,
    // Stock v2 can be created through core without the renderer's second
    // settings update. Give that same normal assembly path a montage preset,
    // retaining explicit automation flags, density and all scene edits.
    ...(projectMediaMode({...project, settings: mergedSettings}) === 'stock' && documentary?.version === 2 && !documentary.montage ? {
      assembly: {...mergedSettings.assembly, documentary: {...documentary, montage: {
        version: 1, style: documentary.montageDensity === 'calm' ? 'clean' : 'editorial',
        intensity: documentary.montageDensity ?? 'rich', hookSeconds: 30
      }}}
    } : {}),
    voice: {
      ...mergedSettings.voice,
      calibration: voiceCalibrationMatches(
        mergedSettings.voice.calibration,
        mergedSettings.voice.provider,
        mergedSettings.voice.voice,
        project.language
      ) ? mergedSettings.voice.calibration : undefined
    }
  };
  const normalized: Project = {
    ...project,
    settings,
    mediaMode: projectMediaMode({ ...project, settings }),
    motionTemplate: project.motionTemplate?.trim() || "Без шаблона",
    scenes: [...project.scenes]
      .sort((a, b) => a.order - b.order)
      .map((scene, index) => ({ ...scene, order: index, status: scene.status ?? "draft" }))
  };
  if (normalized.status === "ready" && projectScenarioQualityIssue(normalized)) {
    normalized.status = "draft";
  }
  return normalized;
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

  async list(options?: {omitCandidates?: boolean}): Promise<Project[]> {
    const projects = await this.projects.list(options);
    return projects.map(normalizeProject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string, options?: {omitCandidates?: boolean}): Promise<Project | undefined> {
    const project = await this.projects.get(id, options);
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
    const mediaMode = input.mediaMode ?? (settings.video.enabled ? "ai" : "stock");
    if (mediaMode === "ai") {
      // AI Story должен стартовать с реальными Flow-провайдерами, а не
      // с Mock Image: Veo не может использовать BMP-заглушку как первый кадр.
      settings.image.provider = "flow";
      settings.video.provider = "flow";
      settings.voice.provider = "elevenlabs";
      settings.voice.voice = "";
      settings.video.model = "veo_3_1_i2v_s_fast";
      settings.video.animationPercent = 15;
      settings.video.selectionMode = "auto";
      settings.assembly.kenBurns = true;
      settings.assembly.kenBurnsDirection = "alternate";
      settings.assembly.fadeTransitions = true;
      settings.assembly.transitionType = "mix";
      settings.assembly.transitionDurationSeconds = 0.4;
      if (settings.assembly.montage) settings.assembly.montage.enabled = false;
    }
    if (input.mediaMode === "stock") {
      settings.assembly.documentary = createDocumentarySettings();
      settings.assembly.montage = { enabled: true, planner: "local", density: "balanced", graphicBeatPercent: 0, hardCutPercent: 100 };
      settings.assembly.transitionType = "none";
      settings.assembly.fadeTransitions = false;
      settings.video.enabled = false;
      settings.video.sourceVolume = 0;
    }
    const project: Project = normalizeProject({
      id: createId("project"),
      ...input,
      mediaMode,
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
      referenceAnalysis: input.analysis,
      montagePlan: input.analysis.montagePlan,
      channelProfileId: input.channelProfileId,
      videoBrief: input.videoBrief
    });
    await this.projects.save(project);
    return project;
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const { expectedUpdatedAt, ...changes } = input;
    input = changes;
    return this.mutate(id, (current) => {
      if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== current.updatedAt) {
        throw new Error("Проект изменился после открытия редактора. Сохранение отменено, чтобы не затереть свежие данные. Проверьте оставленные в редакторе правки и сохраните ещё раз.");
      }
      if (input.storyCharacters && (current.status === "generating" || current.status === "paused")) {
        throw new Error("Нельзя менять персонажей во время производства.");
      }
      if (input.scenes && (current.status === "generating" || current.status === "paused")) {
        throw new Error("Нельзя менять состав сцен во время активной генерации. Сначала остановите очередь.");
      }
      const lastRenderProvided = Object.prototype.hasOwnProperty.call(input, "lastRender");
      const outputPathProvided = Object.prototype.hasOwnProperty.call(input, "outputPath");
      const outputChanged = outputPathProvided && input.outputPath !== current.outputPath;
      const contentChanged = input.topic !== undefined || input.aspectRatio !== undefined || input.language !== undefined || input.mode !== undefined || input.scenes !== undefined || input.settings !== undefined || input.chatTopicId !== undefined || input.characterReference !== undefined || input.channelProfileId !== undefined || input.mediaMode !== undefined || input.motionTemplate !== undefined || input.videoBrief !== undefined || input.montagePlan !== undefined;
      const active = current.status === "generating" || current.status === "paused";
      const scenes=input.scenes??current.scenes;
      let status=input.status??(contentChanged&&!active?scenes.length?"ready":"draft":current.status);
      // An explicitly invalidated export must not be recovered from an older
      // Final.mp4 merely because the previous status still says complete.
      if (outputPathProvided && !input.outputPath && status === "complete") status = scenes.length ? "ready" : "draft";
      // Timeline/settings saves must not turn an incomplete Stock v2 attempt
      // into "ready" merely because it contains planned scenes.
      if(status==='ready'&&(input.mediaMode??current.mediaMode)==='stock'
        &&(input.settings??current.settings).assembly.documentary?.version===2
        &&scenes.some(scene=>scene.includeInAssembly!==false&&!documentaryMaterialUsable(scene)))
        status=current.status==='failed'?'failed':'draft';
      return {
        ...input,
        status,
        outputPath: contentChanged || outputPathProvided ? input.outputPath : current.outputPath,
        lastRender: lastRenderProvided ? input.lastRender : contentChanged || outputChanged ? undefined : current.lastRender,
        montagePlan: input.scenes !== undefined ? input.montagePlan : input.montagePlan ?? current.montagePlan
      };
    });
  }

  async mutate(id: string, updater: (project: Project) => UpdateProjectInput, options?: ProjectMutationOptions): Promise<Project> {
    return this.projects.mutate(id, (stored) => {
      const current = normalizeProject(stored);
      const input = updater(structuredClone(current));
      // Display snapshots deliberately omit heavy candidate lists. Editing a
      // caption/timeline from such a snapshot must retain server-owned evidence.
      if (input.scenes) {
        const byId = new Map(current.scenes.map(scene => [scene.id, scene]));
        input.scenes = input.scenes.map(scene => {
          if (!scene.documentary?.candidatesDeferred) return scene;
          const saved = byId.get(scene.id)?.documentary;
          // A projection-aware repository restores this evidence atomically
          // from its current full snapshot. Do not replace it with an empty list.
          if (saved?.candidatesDeferred) return scene;
          const { candidatesDeferred: _deferred, candidateCount: _count, ...doc } = scene.documentary;
          return { ...scene, documentary: { ...doc, candidates: saved?.candidates ?? [] } };
        });
      }
      const next = normalizeProject({
        ...current,
        ...input,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        scenes: input.scenes ?? current.scenes,
        settings: input.settings ?? current.settings
      });
      const previousTime = Date.parse(current.updatedAt);
      const nextTime = Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0);
      return equalJson(next, current) ? current : { ...next, updatedAt: new Date(nextTime).toISOString() };
    }, options);
  }

  async duplicate(id: string): Promise<Project> {
    const source = await this.require(id);
    const now = new Date().toISOString();
    const sceneIds = new Map(source.scenes.map(scene => [scene.id, createId("scene")]));
    const documentary = source.settings.assembly.documentary;
    const duplicate = normalizeProject({
      ...structuredClone(source),
      id: createId("project"),
      title: `${source.title} — копия`,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      outputPath: undefined,
      lastRender: undefined,
      montagePlan: undefined,
      stockProduction: undefined,
      settings: {
        ...source.settings,
        assembly: { ...source.settings.assembly, documentary: documentary ? {
          ...documentary,
          semanticMontageStatus: undefined, motionArtworkStatus: undefined,
          artworkFeedback: undefined, activeArtworkFeedback: undefined, offlinePrimaryRecovery: undefined,
          resolvedBackground: undefined, resolvedBackgrounds: undefined,
        } : undefined },
      },
      storyCharacters: source.storyCharacters?.map(character => ({ ...character, imagePath: undefined, candidate: undefined, pendingGeneration: undefined, error: undefined, status: "draft" })),
      storyCharacterPlan: undefined,
      storyCharacterSheet: undefined,
      scenes: source.scenes.map((scene, order) => ({
        ...scene,
        id: sceneIds.get(scene.id)!,
        order,
        status: "draft",
        visualBeats: undefined,
        imagePath: undefined,
        videoPath: undefined,
        audioPath: undefined,
        narrationSlice: undefined,
        videoFallback: undefined,
        stockSource: undefined,
        stockAlternates: undefined,
        autoTransition: undefined, autoTransitionDurationSeconds: undefined,
        autoKenBurnsDirection: undefined, autoKenBurnsFocus: undefined, autoKenBurnsZoom: undefined,
        trimStartSeconds: undefined, trimEndSeconds: undefined,
        documentary: scene.documentary ? {
          ...scene.documentary,
          semanticMontage: undefined, semanticMontageInputHash: undefined,
          narrationAlignment: undefined, timing: undefined,
          candidates: [], candidatesDeferred: undefined, candidateCount: undefined, selected: undefined,
          verified: false, pinned: false, illustrative: false, selectionPlan: undefined,
          manualReview: undefined, illustrationLabelInEditorOnly: undefined,
          reviewNote: "", searchError: undefined, checksum: undefined, visualHash: undefined,
          visualReview: undefined, autoError: undefined, nativeFallback: undefined, searchRecovery: undefined,
          motionGraphic: duplicateMotionGraphic(scene.documentary.motionGraphic, sceneIds),
          cuts: undefined, cutsOrigin: undefined, autoTransitionStyle: undefined,
          template: scene.documentary.templateOrigin === "automatic" ? undefined : scene.documentary.template,
          templateOrigin: scene.documentary.templateOrigin === "automatic" ? undefined : scene.documentary.templateOrigin,
          templateTiming: scene.documentary.templateOrigin === "automatic" ? undefined : scene.documentary.templateTiming,
          comparison: scene.documentary.comparison && sceneIds.has(scene.documentary.comparison.sceneId)
            ? { ...scene.documentary.comparison, sceneId: sceneIds.get(scene.documentary.comparison.sceneId)! } : undefined,
          effects: (scene.documentary.effects ?? []).filter(effect => effect.origin !== "automatic").map(effect => ({
            ...effect,
            boundary: effect.boundary && sceneIds.has(effect.boundary.from) && sceneIds.has(effect.boundary.to)
              ? { ...effect.boundary, from: sceneIds.get(effect.boundary.from)!, to: sceneIds.get(effect.boundary.to)! } : undefined,
          })),
        } : undefined,
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

/** Preserve authored graphics while dropping files and timing derived from the source production. */
function duplicateMotionGraphic(graphic: DocumentaryMotionGraphic | undefined, sceneIds: Map<string, string>): DocumentaryMotionGraphic | undefined {
  if (!graphic || graphic.origin === "automatic") return undefined;
  return {
    ...graphic,
    reading: undefined, readingError: undefined, cutoutPath: undefined,
    detail: undefined, detailError: undefined,
    sourceChecksum: undefined, sourceTrimStartSeconds: undefined, sourcePlaybackRate: undefined,
    sequenceId: undefined,
    explanation: graphic.explanation ? { ...graphic.explanation, sequence: undefined } : undefined,
    artworkSpan: graphic.artworkSpan && sceneIds.has(graphic.artworkSpan.endSceneId)
      ? { endSceneId: sceneIds.get(graphic.artworkSpan.endSceneId)! } : undefined,
    panels: graphic.panels?.filter(panel => sceneIds.has(panel.sceneId))
      .map(panel => ({ ...panel, sceneId: sceneIds.get(panel.sceneId)! })),
    cards: graphic.cards?.map(card => ({ ...card, sceneId: card.sceneId ? sceneIds.get(card.sceneId) : undefined })),
    artwork: graphic.artwork ? {
      ...graphic.artwork,
      layers: graphic.artwork.layers.map(layer => ({
        ...layer, sourceSceneId: layer.sourceSceneId ? sceneIds.get(layer.sourceSceneId) : undefined,
      })),
    } : undefined,
  };
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
