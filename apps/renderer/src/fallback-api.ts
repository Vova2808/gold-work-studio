import {
  channelImageStyle,
  allocateSceneDurations,
  selectCharacterReference,
  createVoiceCalibration,
  createDefaultProjectSettings,
  voiceCalibrationMatches,
  voiceCalibrationSampleText,
  type AutoStockProgress,
  type AnyModelSettings,
  type CreateProjectInput,
  type ChannelProfile,
  type ChannelDirection,
  type SaveChannelProfileInput,
  type ChatTopic,
  type DesktopApi,
  type FlowAccountPublic,
  type Project,
  type QueueTask,
  type ReferenceAnalysis,
  type Scene,
  type StockSettings,
  type TaskKind,
  type UpdateProjectInput,
  type TrashItemSummary,
  type VoicerSettings
} from "@gold-work/shared";
import { APP_BUILD_CREATED_AT, APP_BUILD_ID } from "./generated-build-identity";

const createId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const clone = <T,>(value: T): T => structuredClone(value);
const safeProxyDisplayName = (value?: string): string | undefined => {
  if (!value?.trim()) return undefined;
  try {
    const parsed = new URL(value.trim());
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return undefined;
  }
};
const autoStockProgressListeners = new Set<(progress: AutoStockProgress) => void>();
const fallbackStockImages = ["cinematic.jpg", "realistic.jpg", "vintage.jpg", "minimal.jpg"];
const waitForAutoStockStep = () => new Promise<void>((resolve) => window.setTimeout(resolve, 24));
const emitAutoStockProgress = (progress: AutoStockProgress) => {
  for (const listener of autoStockProgressListeners) listener(clone(progress));
};
let projects: Project[] = [];
let tasks: QueueTask[] = [];
let channelProfiles: ChannelProfile[] = [];
let trashedChannels: Array<{ summary: TrashItemSummary; profile: ChannelProfile }> = [];
let trashedProjects: Array<{ summary: TrashItemSummary; project: Project }> = [];
let flowAccounts: FlowAccountPublic[] = [];
let stockSettings: StockSettings = {
  pexelsConfigured: false,
  pixabayConfigured: false,
  providers: {
    pexels: { provider: "pexels", configured: false, state: "not_configured" },
    pixabay: { provider: "pixabay", configured: false, state: "not_configured" }
  }
};
let directorOperationVersion = 0;
let anyModelSettings: AnyModelSettings = { configured: false, proxyConfigured: false, baseUrl: "https://anymodel.org/v1", textModel: "cc/claude-opus-5", imageModel: "ag/gemini-3.1-flash-image", videoModel: "xai/grok-imagine-video", ttsModel: "google-tts", imageRefModel: "gpt-image-2", transcriptionModel: "gc/gemini-2.5-flash" };
let voicerSettings: VoicerSettings = { configured: false, proxyConfigured: false, baseUrl: "https://api.lumean.app/api/public" };
let youtubeSettings = { configured: false, cookiesFileConfigured: false, cookiesFileName: undefined as string | undefined, workDirConfigured: false, workDirPath: undefined as string | undefined };

function demoScenes(topic: string): Scene[] {
  return ["Завязка", "Главная мысль", "Финал"].map((title, order) => ({
    id: createId("scene"),
    order,
    title,
    narration: `${title}. Демонстрационный текст для темы «${topic}».`,
    imagePrompt: `${topic}. ${title}. Семейная 3D-анимация, кинематографичный свет`,
    animationPrompt: "Плавное движение камеры и естественная анимация персонажей",
    durationSeconds: 8,
    status: "draft"
  }));
}

function analyzeReference(url: string, instructions = ""): ReferenceAnalysis {
  const parsed = new URL(url);
  const hook = "Ты уверен, что делаешь всё правильно? Одна деталь полностью меняет результат.";
  const titles = ["Хук", "Обещание", "Контекст", "Неожиданный поворот", "Практическое решение", "Финал"];
  const scenes = titles.map((title, order) => ({
    id: createId("scene"),
    order,
    title,
    narration: order === 0 ? hook : `${title}. Самостоятельная улучшенная часть ролика по мотивам структуры референса.`,
    imagePrompt: `${title}. Выразительный кадр для YouTube, единый визуальный стиль, без копирования брендинга референса`,
    animationPrompt: "Динамичное движение камеры и визуальный акцент на главной мысли",
    durationSeconds: 10,
    status: "draft" as const
  }));
  const youtubeContext = /(?:youtube\.com|youtu\.be)$/i.test(parsed.hostname.replace(/^www\./, "")) ? {
    videoId: parsed.searchParams.get("v") || parsed.pathname.split("/").filter(Boolean).at(-1) || "smoke",
    title: "Демонстрационный YouTube-ролик",
    description: "Mock-контекст для проверки интерфейса",
    publishedAt: new Date().toISOString(),
    durationSeconds: 543,
    channelId: "channel-smoke",
    channelTitle: "Тестовый канал",
    views: 125000,
    likes: 8400,
    commentCount: 640,
    channelSubscribers: 92000,
    channelViews: 4200000,
    channelVideoCount: 84,
    transcript: [
      { startSeconds: 0, durationSeconds: 5, text: "Сильный хук исходного ролика." },
      { startSeconds: 5, durationSeconds: 8, text: "Автор формулирует обещание зрителю." }
    ],
    transcriptSource: "captions" as const,
    topComments: [{ author: "Зритель", text: "Полезно и без длинного вступления", likes: 125, publishedAt: new Date().toISOString() }],
    topVideos: [{ id: "top-1", title: "Успешная тема канала", publishedAt: new Date().toISOString(), views: 210000, likes: 11000, commentCount: 700 }],
    visualAnalysisIncluded: false as const
  } : undefined;
  return {
    sourceUrl: parsed.toString(),
    sourceTitle: `Референс с ${parsed.hostname.replace(/^www\./, "")}`,
    niche: "Развлекательный или образовательный YouTube-контент",
    targetAudience: "Зрители 18–44 лет, которым нужен быстрый понятный результат",
    hook,
    structure: ["0–5 сек: хук", "5–15 сек: обещание", "Проблема → поворот → решение", "Вывод и следующий шаг"],
    strengths: ["Понятная тема", "Хорошая основа для серии"],
    improvements: ["Усилить первый кадр", "Убрать длинное вступление", "Менять визуальный акцент каждые 5–8 секунд"],
    suggestedAngle: instructions || "Сделать самостоятельный ролик в той же нише с более сильным удержанием",
    suggestedTitle: "Главная ошибка, которая мешает получить результат",
    recommendedDurationSeconds: 60,
    language: "Русский",
    instructions,
    scenes,
    provider: youtubeContext ? "mock-youtube" : "mock-director",
    youtubeContext,
    suggestedTopics: [
      { title: "Главная ошибка новичков в этой нише", hook: "Вы делаете это каждый день и теряете результат.", angle: "Разбор ошибки с быстрым решением" },
      { title: "7 приёмов, которые удерживают зрителя", hook: "Второй приём используют все топовые каналы.", angle: "Список с примерами из топ-роликов" },
      { title: "Что будет, если сделать наоборот", hook: "Мы проверили противоположный подход — результат удивил.", angle: "Эксперимент с интригой" }
    ]
  };
}

function makeProject(input: CreateProjectInput, withScenes: boolean): Project {
  const now = new Date().toISOString();
  const scenes = withScenes ? demoScenes(input.topic) : [];
  const settings = createDefaultProjectSettings();
  settings.video.enabled = input.mode === "pro";
  settings.assembly.kenBurns = input.mode === "standard";
  settings.assembly.fadeTransitions = input.mode === "standard";
  const mediaMode = input.mediaMode ?? (settings.video.enabled ? "ai" : "stock");
  if (mediaMode === "ai") {
    settings.assembly.kenBurns = true;
    settings.assembly.kenBurnsDirection = "alternate";
    settings.assembly.fadeTransitions = true;
    settings.assembly.transitionType = "mix";
    settings.assembly.transitionDurationSeconds = 0.4;
    if (settings.assembly.montage) settings.assembly.montage.enabled = false;
  }
  return {
    id: createId("project"),
    ...input,
    mediaMode,
    motionTemplate: input.motionTemplate?.trim() || "Без шаблона",
    status: scenes.length ? "ready" : "draft",
    createdAt: now,
    updatedAt: now,
    scenes,
    settings
  };
}

function makeTask(runId: string, projectId: string, sceneId: string | undefined, kind: TaskKind, label: string, dependsOn: string[]): QueueTask {
  const now = new Date().toISOString();
  return {
    id: createId("task"),
    runId,
    projectId,
    sceneId,
    kind,
    label,
    status: "pending",
    attempts: 0,
    maxAttempts: 3,
    progress: 0,
    dependsOn,
    createdAt: now,
    updatedAt: now
  };
}

function advanceQueue(): void {
  const now = new Date().toISOString();
  for (const task of tasks.filter((candidate) => candidate.status === "running")) {
    task.progress = Math.min(100, task.progress + (task.kind === "video" ? 9 : 18));
    task.updatedAt = now;
    if (task.progress === 100) {
      task.status = "done";
      task.resultPath = `mock://${task.projectId}/${task.sceneId ?? "final"}/${task.kind}`;
    }
  }
  let running = tasks.filter((task) => task.status === "running").length;
  for (const task of tasks) {
    if (running >= 4) break;
    if (task.status !== "pending") continue;
    const dependenciesReady = task.dependsOn.every((id) => tasks.find((candidate) => candidate.id === id)?.status === "done");
    if (!dependenciesReady) continue;
    task.status = "running";
    task.attempts += 1;
    task.updatedAt = now;
    running += 1;
  }

  for (const project of projects) {
    const projectTasks = tasks.filter((task) => task.projectId === project.id);
    if (projectTasks.length === 0) continue;
    project.scenes = project.scenes.map((scene) => {
      const sceneTasks = projectTasks.filter((task) => task.sceneId === scene.id);
      const image = sceneTasks.find((task) => task.kind === "image" && task.status === "done")?.resultPath;
      const video = sceneTasks.find((task) => task.kind === "video" && task.status === "done")?.resultPath;
      const audio = sceneTasks.find((task) => task.kind === "speech" && task.status === "done")?.resultPath;
      const status = sceneTasks.length > 0 && sceneTasks.every((task) => task.status === "done")
        ? "ready"
        : sceneTasks.some((task) => task.status === "running") ? "generating" : scene.status;
      return { ...scene, status, imagePath: image ?? scene.imagePath, videoPath: video ?? scene.videoPath, audioPath: audio ?? scene.audioPath };
    });
    if (projectTasks.every((task) => task.status === "done")) {
      const assembled = projectTasks.some((task) => task.kind === "assemble");
      project.status = assembled ? "complete" : "ready";
      if (assembled) project.outputPath = `mock://${project.id}/Final.mp4`;
    } else if (projectTasks.some((task) => task.status === "running")) {
      project.status = "generating";
    }
  }
}

function requireProject(id: string): Project {
  const project = projects.find((candidate) => candidate.id === id);
  if (!project) throw new Error("Проект не найден");
  return project;
}

function directionFromMode(mode?: string): ChannelDirection {
  return mode === "ai" ? "ai-story" : "stock-documentary";
}

export const fallbackApi: DesktopApi = {
  prepareDocumentaryEffect: async () => { throw new Error("Эффекты доступны в приложении Windows"); },
  prepareDocumentaryMap: async()=>{throw new Error('Подробные карты доступны в приложении Windows');},
  prepareDocumentaryPreview: async () => { throw new Error("Подготовка звука доступна в приложении Windows"); },
  getDocumentaryCandidates: async (projectId, sceneId) => (await fallbackApi.getProject(projectId))?.scenes.find(scene=>scene.id===sceneId)?.documentary?.candidates ?? [],
  searchDocumentary: async () => { throw new Error("Поиск материалов доступен в приложении Windows"); },
  applyDocumentaryCandidate: async () => { throw new Error("Материалы доступны в приложении Windows"); },
  importDocumentaryMaterial: async () => { throw new Error("Импорт доступен в приложении Windows"); },
  reviewDocumentaryMaterial: async () => { throw new Error("Проверка доступна в приложении Windows"); },
  getEffectLibrary: async () => ({ rootPath: "Библиотека доступна в приложении Windows", assets: [] }),
  chooseEffectFolders: async () => { throw new Error("Импорт доступен в приложении Windows"); },
  importEffectFolders: async () => { throw new Error("Импорт доступен в приложении Windows"); },
  cancelEffectImport: async () => {},
  updateEffect: async () => { throw new Error("Библиотека доступна в приложении Windows"); },
  analyzeEffect: async () => { throw new Error("Проверка эффектов доступна в приложении Windows"); },
  trashEffect: async () => { throw new Error("Библиотека доступна в приложении Windows"); },
  openEffectLibrary: async () => {},
  onEffectImportProgress: () => () => {},
  async saveStoryCharacterToChannel(projectId, characterId) {
    const project = requireProject(projectId);
    const profile = channelProfiles.find(item => item.id === project.channelProfileId);
    if (!profile || profile.direction !== "ai-story" || project.mediaMode !== "ai") throw new Error("Ролик не привязан к каналу AI Story");
    const character = project.storyCharacters?.find(item => item.id === characterId);
    if (!character?.imagePath || character.status !== "ready") throw new Error("Сначала создайте образ персонажа");
    const now = new Date().toISOString();
    let version = profile.characterVersions.find(item => item.sourceProjectId === projectId && item.sourceCharacterId === characterId
      && item.imagePath === character.imagePath && item.prompt === character.prompt);
    if (!version) {
      version = { versionId: createId("hero"), channelProfileId: profile.id, sourceProjectId: projectId, sourceCharacterId: characterId,
        name: character.name, aliases: clone(character.aliases), imagePath: character.imagePath, prompt: character.prompt,
        characterPrompt: character.prompt, stylePrompt: character.stylePrompt, updatedAt: now, createdAt: now };
      profile.characterVersions.unshift(version);
    }
    profile.primaryCharacter = version;
    profile.updatedAt = now;
    return clone(profile);
  },
  async generateChannelCharacter() { throw new Error("Генерация образа через Flow доступна только в приложении Electron"); },
  async deleteChannelCharacterVersion(channelId, versionId) {
    const profile = channelProfiles.find(item => item.id === channelId);
    if (!profile || profile.direction !== "ai-story") throw new Error("Канал AI Story не найден");
    if (profile.characterGeneration && [profile.characterGeneration.sourceVersionId, profile.characterGeneration.versionId].includes(versionId)) {
      throw new Error("Этот образ связан с незавершённой генерацией. Сначала получите её результат.");
    }
    const character = profile.characterVersions.find(item => item.versionId === versionId);
    if (!character) throw new Error("Версия героя не найдена в этом канале");
    profile.deletedCharacterVersions = [character, ...(profile.deletedCharacterVersions ?? []).filter(item => item.versionId !== versionId)];
    profile.characterVersions = profile.characterVersions.filter(item => item.versionId !== versionId);
    if (profile.primaryCharacter?.versionId === versionId) profile.primaryCharacter = undefined;
    profile.updatedAt = new Date().toISOString();
    return clone(profile);
  },
  async restoreChannelCharacterVersion(channelId, versionId) {
    const profile = channelProfiles.find(item => item.id === channelId);
    const character = profile?.deletedCharacterVersions?.find(item => item.versionId === versionId);
    if (!profile || profile.direction !== "ai-story" || !character) throw new Error("Удалённая версия не найдена в этом канале");
    profile.characterVersions = [character, ...profile.characterVersions.filter(item => item.versionId !== versionId)];
    profile.deletedCharacterVersions = profile.deletedCharacterVersions!.filter(item => item.versionId !== versionId);
    profile.updatedAt = new Date().toISOString();
    return clone(profile);
  },
  async selectChannelCharacterVersion(channelId, versionId) {
    const profile = channelProfiles.find(item => item.id === channelId);
    const version = profile?.characterVersions.find(item => item.versionId === versionId);
    if (!profile || profile.direction !== "ai-story" || !version) throw new Error("Образ не найден в этом канале");
    profile.primaryCharacter = version;
    profile.updatedAt = new Date().toISOString();
    return clone(profile);
  },
  async listChannelProfiles() {
    return clone(channelProfiles).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async createChannelProfile(input: SaveChannelProfileInput) {
    const now = new Date().toISOString();
    const direction = input.direction ?? directionFromMode(input.defaultMediaMode);
    const profile: ChannelProfile = {
      id: createId("channel"),
      ...input,
      name: input.name.trim(),
      masterPrompt: input.masterPrompt.trim(),
      defaultImageStyle: input.defaultImageStyle?.trim().slice(0, 2_000) || undefined,
      defaultDurationMinutes: input.defaultDurationMinutes ?? 10,
      direction,
      defaultMediaMode: direction === "ai-story" ? "ai" : "stock",
      motionTemplate: input.motionTemplate ?? "Без шаблона",
      characterVersions: [],
      createdAt: now,
      updatedAt: now
    };
    channelProfiles.unshift(profile);
    return clone(profile);
  },
  async updateChannelProfile(id, input) {
    const index = channelProfiles.findIndex((profile) => profile.id === id);
    const current = channelProfiles[index];
    if (!current || index < 0) throw new Error("Канал не найден");
    const direction = input.direction ?? (input.defaultMediaMode ? directionFromMode(input.defaultMediaMode) : current.direction);
    if (direction !== current.direction) throw new Error("Направление канала нельзя изменить после создания");
    channelProfiles[index] = {
      ...current,
      ...input,
      name: input.name.trim(),
      masterPrompt: input.masterPrompt.trim(),
      defaultImageStyle: input.defaultImageStyle === undefined ? current.defaultImageStyle : input.defaultImageStyle.trim().slice(0, 2_000) || undefined,
      defaultDurationMinutes: input.defaultDurationMinutes ?? 10,
      direction: current.direction,
      defaultMediaMode: current.direction === "ai-story" ? "ai" : "stock",
      motionTemplate: input.motionTemplate ?? "Без шаблона",
      updatedAt: new Date().toISOString()
    };
    return clone(channelProfiles[index]!);
  },
  async deleteChannelProfile(id) {
    const profile = channelProfiles.find((item) => item.id === id);
    if (!profile) throw new Error("Канал не найден");
    const summary: TrashItemSummary = {
      trashId: createId("trash"), kind: "channel", originalId: id, title: profile.name,
      deletedAt: new Date().toISOString(), relatedProjectCount: projects.filter((project) => project.channelProfileId === id).length
    };
    trashedChannels.unshift({ summary, profile: clone(profile) });
    channelProfiles = channelProfiles.filter((profile) => profile.id !== id);
    return clone(summary);
  },
  async confirmChannelCharacterReference() {
    throw new Error("Референс героя доступен только в приложении Electron");
  },
  async useChannelCharacterReference(projectId, versionId) {
    const project = requireProject(projectId);
    const profile = channelProfiles.find((item) => item.id === project.channelProfileId);
    const character = versionId
      ? profile?.characterVersions.find((item) => item.versionId === versionId)
      : profile?.primaryCharacter;
    if (!character) throw new Error("В этом канале ещё нет подтверждённого героя");
    Object.assign(project, selectCharacterReference(project, clone(character), profile!.characterVersions.map(version => version.imagePath)));
    return { project: clone(project), character: clone(character) };
  },
  async listTrash() {
    return clone([...trashedChannels.map((item) => item.summary), ...trashedProjects.map((item) => item.summary)])
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  },
  async restoreTrashItem(trashId) {
    const channel = trashedChannels.find((item) => item.summary.trashId === trashId);
    if (channel) {
      if (channelProfiles.some((item) => item.id === channel.profile.id)) throw new Error("Канал с таким ID уже существует");
      channelProfiles.unshift(clone(channel.profile));
      trashedChannels = trashedChannels.filter((item) => item.summary.trashId !== trashId);
      return;
    }
    const project = trashedProjects.find((item) => item.summary.trashId === trashId);
    if (!project) throw new Error("Запись в корзине не найдена");
    if (projects.some((item) => item.id === project.project.id)) throw new Error("Проект с таким ID уже существует");
    projects.unshift(clone(project.project));
    trashedProjects = trashedProjects.filter((item) => item.summary.trashId !== trashId);
  },
  async purgeTrashItem(trashId) {
    const before = trashedChannels.length + trashedProjects.length;
    trashedChannels = trashedChannels.filter((item) => item.summary.trashId !== trashId);
    trashedProjects = trashedProjects.filter((item) => item.summary.trashId !== trashId);
    if (before === trashedChannels.length + trashedProjects.length) throw new Error("Запись в корзине не найдена");
  },
  async listProjects() {
    return clone(projects).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async getProjectChanges(previous) {
    const revision = JSON.stringify(projects.map(project => [project.id, project.updatedAt]));
    return { revision, ...(revision === previous ? {} : { projects: await this.listProjects() }) };
  },
  async getProject(id) {
    const project = projects.find((candidate) => candidate.id === id);
    return project ? clone(project) : undefined;
  },
  async createProject(input) {
    const profile = input.channelProfileId ? channelProfiles.find((item) => item.id === input.channelProfileId) : undefined;
    const project = makeProject({
      ...input,
      language: profile?.languageLabel ?? input.language,
      mediaMode: profile ? (profile.direction === "ai-story" ? "ai" : "stock") : input.mediaMode,
      motionTemplate: profile?.motionTemplate ?? input.motionTemplate
    }, false);
    if (profile) project.settings.image.style = channelImageStyle(profile, project.settings.image.style);
    projects.unshift(project);
    return clone(project);
  },
  onDirectorProgress() { return () => undefined; },
  async prepareStoryCharacters(id) { const project = await this.getProject(id); if (!project) throw new Error("Ролик не найден"); return project; },
  async regenerateStoryCharacter() { throw new Error("Образы персонажей доступны в приложении Electron"); },
  async confirmStoryCharacter() { throw new Error("Образы персонажей доступны в приложении Electron"); },
  async cancelDirectorOperation() {
    directorOperationVersion += 1;
    return true;
  },
  async ttsSample() {
    throw new Error("Примеры голосов доступны только в приложении с ключом AnyModel");
  },
  async createCharacterReference(_projectId, _input) {
    throw new Error("Референс героя доступен только в приложении с ключом AnyModel");
  },
  async assembleProject() {
    throw new Error("Пересборка доступна только в приложении");
  },
  async replanMontage(projectId) {
    const target = requireProject(projectId);
    const requestedPlanner = target.settings.assembly.montage?.planner ?? "local";
    target.montagePlan = {
      plannedAt: new Date().toISOString(),
      requestedPlanner,
      usedPlanner: "local",
      visualBeatCount: target.scenes.reduce((sum, scene) => sum + (scene.visualBeats?.length ?? 0), 0),
      templates: [...new Set(target.scenes.flatMap((scene) => scene.visualBeats?.map((beat) => beat.template) ?? []))],
      issueCount: 0
    };
    target.outputPath = undefined;
    target.lastRender = undefined;
    target.updatedAt = new Date().toISOString();
    return clone(target);
  },
  async getGoogleSettings() { return { configured: false, veoModel: "veo-3.1-lite-generate-preview", proxyUrl: "" }; },
  async saveGoogleSettings(input) { return { configured: Boolean(input.apiKey), veoModel: input.veoModel ?? "veo-3.1-lite-generate-preview", proxyUrl: input.proxyUrl ?? "" }; },
  async clearGoogleKey() { return { configured: false, veoModel: "veo-3.1-lite-generate-preview", proxyUrl: "" }; },
  async testGoogleConnection() { return { ok: false, message: "Veo доступен только в приложении" }; },
  async getStockSettings() { return clone(stockSettings); },
  async saveStockSettings(input) {
    const pexelsConfigured = Boolean(input.pexelsApiKey?.trim()) || stockSettings.pexelsConfigured;
    const pixabayConfigured = Boolean(input.pixabayApiKey?.trim()) || stockSettings.pixabayConfigured;
    const nextProvider = (
      provider: "pexels" | "pixabay",
      configured: boolean,
      apiKey: string | undefined,
      proxyUrl: string | undefined,
      clearProxy: boolean | undefined,
    ) => {
      const current = stockSettings.providers[provider];
      const proxyChanged = Boolean(proxyUrl?.trim()) || Boolean(clearProxy);
      return {
        ...current,
        provider,
        configured,
        state: apiKey?.trim() || (proxyChanged && configured)
          ? "saved" as const
          : configured
            ? current.state
            : "not_configured" as const,
        proxyConfigured: clearProxy ? false : Boolean(proxyUrl?.trim()) || current.proxyConfigured,
        proxyDisplayName: clearProxy
          ? undefined
          : safeProxyDisplayName(proxyUrl) ?? current.proxyDisplayName,
        checkedAt: proxyChanged ? undefined : current.checkedAt,
        message: proxyChanged ? undefined : current.message,
      };
    };
    stockSettings = {
      pexelsConfigured,
      pixabayConfigured,
      providers: {
        pexels: nextProvider("pexels", pexelsConfigured, input.pexelsApiKey, input.pexelsProxyUrl, input.clearPexelsProxy),
        pixabay: nextProvider("pixabay", pixabayConfigured, input.pixabayApiKey, input.pixabayProxyUrl, input.clearPixabayProxy),
      }
    };
    return clone(stockSettings);
  },
  async clearStockKey(provider) {
    if (provider === "pexels") {
      stockSettings.pexelsConfigured = false;
      stockSettings.providers.pexels = {
        provider,
        configured: false,
        state: "not_configured",
        proxyConfigured: stockSettings.providers.pexels.proxyConfigured,
        proxyDisplayName: stockSettings.providers.pexels.proxyDisplayName,
      };
    } else {
      stockSettings.pixabayConfigured = false;
      stockSettings.providers.pixabay = {
        provider,
        configured: false,
        state: "not_configured",
        proxyConfigured: stockSettings.providers.pixabay.proxyConfigured,
        proxyDisplayName: stockSettings.providers.pixabay.proxyDisplayName,
      };
    }
    return clone(stockSettings);
  },
  async testStockConnection(provider) {
    const configured = provider === "pexels" ? stockSettings.pexelsConfigured : stockSettings.pixabayConfigured;
    const message = configured
      ? "Проверка стоков доступна только в приложении Electron"
      : `Сначала сохраните ключ ${provider === "pexels" ? "Pexels" : "Pixabay"}`;
    const status = configured
      ? { provider, configured: true, state: "error" as const, checkedAt: new Date().toISOString(), message }
      : { provider, configured: false, state: "not_configured" as const };
    stockSettings.providers[provider] = status;
    return { provider, ok: false, message, status: clone(status) };
  },
  async searchStock() { throw new Error("Поиск Pexels/Pixabay доступен только в приложении Electron"); },
  async applyStockAsset() { throw new Error("Скачивание стока доступно только в приложении Electron"); },
  async refreshDocumentaryMontage() { throw new Error("Автомонтаж доступен в приложении Electron"); },
  async autoSelectStock(projectId, options) {
    const project = requireProject(projectId);
    const includedScenes = project.scenes.filter((scene) => scene.includeInAssembly !== false);
    const total = includedScenes.length;
    let completed = 0;
    let selected = 0;
    let skipped = 0;

    const report = (
      phase: AutoStockProgress["phase"],
      message: string,
      scene?: Scene,
    ) => emitAutoStockProgress({
      projectId,
      phase,
      completed,
      total,
      selected,
      skipped,
      failed: 0,
      currentSceneId: scene?.id,
      currentSceneNumber: scene ? scene.order + 1 : undefined,
      message,
    });

    report("preparing", total > 0 ? `Подготавливаю ${total} сцен для автоподбора…` : "В проекте нет включённых сцен.");
    await waitForAutoStockStep();

    for (const scene of includedScenes) {
      const appliedPath = scene.stockSource?.mediaType === "video" ? scene.videoPath : scene.imagePath;
      if (!options?.force && scene.stockSource && appliedPath) {
        skipped += 1;
        completed += 1;
        report("applying", `Сцена ${scene.order + 1}: готовый stock сохранён.`, scene);
        await waitForAutoStockStep();
        continue;
      }

      const query = (scene.imagePrompt.trim() || `${scene.title} ${scene.narration}`.trim() || `scene ${scene.order + 1}`)
        .replace(/\s+/g, " ")
        .slice(0, 100);
      report("searching", `Сцена ${scene.order + 1}: ищу подходящий stock…`, scene);
      await waitForAutoStockStep();
      report("downloading", `Сцена ${scene.order + 1}: сохраняю выбранный кадр…`, scene);
      await waitForAutoStockStep();

      const provider = scene.order % 2 === 0 ? "pexels" : "pixabay";
      const providerName = provider === "pexels" ? "Pexels" : "Pixabay";
      const assetId = `fallback-${scene.order + 1}`;
      scene.imagePath = `/styles/${fallbackStockImages[scene.order % fallbackStockImages.length]}`;
      scene.videoPath = undefined;
      scene.stockSource = {
        provider,
        assetId,
        mediaType: "image",
        query,
        pageUrl: provider === "pexels"
          ? `https://www.pexels.com/photo/${assetId}/`
          : `https://pixabay.com/photos/${assetId}/`,
        author: "Browser fallback",
        attribution: `Browser fallback / ${providerName}`,
        licenseUrl: provider === "pexels" ? "https://www.pexels.com/license/" : "https://pixabay.com/service/license-summary/",
        downloadedAt: project.createdAt,
      };
      selected += 1;
      completed += 1;
      report("applying", `Сцена ${scene.order + 1}: stock добавлен.`, scene);
      await waitForAutoStockStep();
    }

    project.updatedAt = new Date().toISOString();
    report("complete", selected > 0
      ? `Stock автоматически подобран для ${selected} сцен.`
      : `Все ${skipped} сцен уже содержат готовый stock.`);
    return clone({
      project,
      total,
      selected,
      skipped,
      failed: 0,
      failures: [],
    });
  },
  onAutoStockProgress(listener) {
    autoStockProgressListeners.add(listener);
    return () => autoStockProgressListeners.delete(listener);
  },
  async listFlowAccounts() { return clone(flowAccounts); },
  async loginFlowAccount() { throw new Error("Подключение Flow доступно только в приложении Electron"); },
  async importFlowCookies() { throw new Error("Импорт Flow cookies доступен только в приложении Electron"); },
  async refreshFlowAccount(accountId) {
    const account = flowAccounts.find((item) => item.id === accountId);
    if (!account) throw new Error("Flow-аккаунт не найден");
    return clone(account);
  },
  async refreshAllFlowAccounts() { return clone(flowAccounts); },
  async updateFlowAccount(accountId, input) {
    const index = flowAccounts.findIndex((item) => item.id === accountId);
    if (index < 0) throw new Error("Flow-аккаунт не найден");
    flowAccounts[index] = { ...flowAccounts[index]!, ...input };
    return clone(flowAccounts[index]!);
  },
  async removeFlowAccount(accountId) { flowAccounts = flowAccounts.filter((account) => account.id !== accountId); },
  async openFlowAccount() { throw new Error("Окно Flow доступно только в приложении Electron"); },
  async testFlowAccount() { return { ok: false, message: "Flow доступен только в приложении Electron" }; },
  onFlowAccountsChanged() { return () => undefined; },
  onFlowLoginProgress() { return () => undefined; },
  mediaUrl(path: string) { return path; },
  async getVoicerSettings() { return clone(voicerSettings); },
  async saveVoicerSettings(input) {
    voicerSettings = {
      configured: Boolean(input.apiKey?.trim()) || voicerSettings.configured,
      baseUrl: input.baseUrl?.trim() || voicerSettings.baseUrl,
      proxyConfigured: input.clearProxy ? false : Boolean(input.proxyUrl?.trim()) || voicerSettings.proxyConfigured,
      proxyDisplayName: input.clearProxy
        ? undefined
        : safeProxyDisplayName(input.proxyUrl) ?? voicerSettings.proxyDisplayName,
    };
    return clone(voicerSettings);
  },
  async clearVoicerKey() {
    voicerSettings.configured = false;
    return clone(voicerSettings);
  },
  async testVoicerConnection() { return { ok: false, message: "Voicer доступен только в приложении" }; },
  async listVoicerTemplates() { return []; },
  async voicerSample() {
    throw new Error("Примеры голосов Voicer доступны только в приложении");
  },
  async calibrateVoice(input) {
    const sampleText = voiceCalibrationSampleText(input.language);
    return {
      calibration: createVoiceCalibration({
        ...input,
        sampleText,
        audioDurationSeconds: 4,
        calibratedAt: new Date().toISOString()
      }),
      sampleAudioBase64: ""
    };
  },
  async calibrateProjectVoice(projectId) {
    const project = requireProject(projectId);
    const result = await this.calibrateVoice({
      provider: project.settings.voice.provider,
      voice: project.settings.voice.voice,
      language: project.language
    });
    project.settings.voice.calibration = result.calibration;
    project.updatedAt = new Date().toISOString();
    return { ...result, project: clone(project) };
  },
  async getAnyModelSettings() { return clone(anyModelSettings); },
  async saveAnyModelSettings(input) {
    anyModelSettings = {
      configured: Boolean(input.apiKey?.trim()) || anyModelSettings.configured,
      proxyConfigured: input.clearProxy ? false : Boolean(input.proxyUrl?.trim()) || anyModelSettings.proxyConfigured,
      proxyDisplayName: input.clearProxy
        ? undefined
        : safeProxyDisplayName(input.proxyUrl) ?? anyModelSettings.proxyDisplayName,
      baseUrl: input.baseUrl,
      textModel: input.textModel,
      imageModel: input.imageModel,
      videoModel: input.videoModel,
      ttsModel: input.ttsModel,
      imageRefModel: input.imageRefModel,
      transcriptionModel: input.transcriptionModel,
    };
    return clone(anyModelSettings);
  },
  async clearAnyModelKey() {
    anyModelSettings.configured = false;
    return clone(anyModelSettings);
  },
  async testAnyModelConnection() {
    return { ok: false, message: "Проверка API доступна только в приложении Electron" };
  },
  async getYouTubeSettings() { return clone(youtubeSettings); },
  async listTrackedChannels() { return []; },
  async saveTrackedChannel() { throw new Error("Аналитика доступна в приложении Electron"); },
  async removeTrackedChannel() { throw new Error("Аналитика доступна в приложении Electron"); },
  async refreshTrackedChannels() { throw new Error("Аналитика доступна в приложении Electron"); },
  async saveYouTubeSettings(input) {
    youtubeSettings = {
      configured: Boolean(input.apiKey) || youtubeSettings.configured,
      cookiesFileConfigured: input.clearCookiesFile ? false : Boolean(input.cookiesFilePath) || youtubeSettings.cookiesFileConfigured,
      cookiesFileName: input.clearCookiesFile ? undefined : input.cookiesFilePath?.split(/[\\/]/).at(-1) ?? youtubeSettings.cookiesFileName,
      workDirConfigured: input.clearWorkDir ? false : Boolean(input.workDirPath) || youtubeSettings.workDirConfigured,
      workDirPath: input.clearWorkDir ? undefined : input.workDirPath ?? youtubeSettings.workDirPath
    };
    return clone(youtubeSettings);
  },
  async clearYouTubeKey() {
    youtubeSettings.configured = false;
    return clone(youtubeSettings);
  },
  async testYouTubeConnection() {
    return { ok: false, message: "Проверка YouTube Data API доступна только в приложении Electron" };
  },
  async prepareProjectScript(projectId) {
    const project = requireProject(projectId);
    const script = project.videoBrief?.creationMode === "script" ? project.videoBrief.readyScript : undefined;
    if (!script?.trim()) throw new Error("Вставьте готовый сценарий. Написание сценариев отключено.");
    if (!voiceCalibrationMatches(project.settings.voice.calibration, project.settings.voice.provider, project.settings.voice.voice, project.language)) throw new Error("Сначала измерьте скорость голоса");
    // Explicit local demonstration only: exact text chunks, no invented narration.
    project.scenes = (script.match(/[\s\S]{1,80}/g) ?? []).map((narration, order) => ({
      id: createId("scene"), order, title: `Кадр ${order + 1}`, narration,
      imagePrompt: `Demo illustration for frame ${order + 1}`, animationPrompt: "Slow camera push-in",
      durationSeconds: Math.max(0.1, narration.length / project.settings.voice.calibration!.charactersPerSecond), status: "draft"
    }));
    project.status = "ready";
    project.updatedAt = new Date().toISOString();
    return clone(project);
  },
  async updateProject(id: string, input: UpdateProjectInput) {
    const project = requireProject(id);
    if (input.scenes && (project.status === "generating" || project.status === "paused")) {
      throw new Error("Нельзя менять состав сцен во время активной генерации. Сначала остановите очередь.");
    }
    const contentChanged = input.topic !== undefined || input.aspectRatio !== undefined || input.language !== undefined || input.mode !== undefined || input.scenes !== undefined || input.settings !== undefined || input.chatTopicId !== undefined || input.mediaMode !== undefined || input.motionTemplate !== undefined;
    const active = project.status === "generating" || project.status === "paused";
    Object.assign(project, input, {
      id: project.id,
      createdAt: project.createdAt,
      updatedAt: new Date().toISOString(),
      status: input.status ?? (contentChanged && !active ? (input.scenes ?? project.scenes).length ? "ready" : "draft" : project.status),
      outputPath: contentChanged ? input.outputPath : input.outputPath ?? project.outputPath
    });
    project.scenes = project.scenes
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((scene, order) => ({ ...scene, order }));
    return clone(project);
  },
  async duplicateProject(id) {
    const source = requireProject(id);
    const now = new Date().toISOString();
    const project: Project = {
      ...clone(source),
      id: createId("project"),
      title: `${source.title} — копия`,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      outputPath: undefined,
      scenes: source.scenes.map((scene, order) => ({ ...clone(scene), id: createId("scene"), order, status: "draft", imagePath: undefined, videoPath: undefined, audioPath: undefined }))
    };
    projects.unshift(project);
    return clone(project);
  },
  async deleteProject(id) {
    const project = requireProject(id);
    const summary: TrashItemSummary = {
      trashId: createId("trash"), kind: "project", originalId: id, title: project.title, deletedAt: new Date().toISOString()
    };
    trashedProjects.unshift({ summary, project: clone(project) });
    projects = projects.filter((project) => project.id !== id);
    tasks = tasks.filter((task) => task.projectId !== id);
    return clone(summary);
  },
  async getDocumentaryRecovery() {return [];},
  async choosePixabayMusic() {throw Error('Музыка Pixabay доступна в настольном приложении.');},
  async authorizeDocumentaryRetry() {throw Error('Повтор анализа доступен в настольном приложении.');},
  async probeDocumentaryConnection() {return false;},
  async getQueue() {
    advanceQueue();
    return clone(tasks);
  },
  async startGeneration(projectId) {
    const project = requireProject(projectId);
    if (project.scenes.length === 0) throw new Error("Сначала добавьте хотя бы одну сцену");
    tasks = tasks.filter((task) => task.projectId !== projectId);
    const runId = createId("run");
    const created: QueueTask[] = [];
    for (const [index, scene] of project.scenes.entries()) {
      if (project.settings.voice.enabled) created.push(makeTask(runId, projectId, scene.id, "speech", `Озвучка · сцена ${index + 1}`, []));
      const usesStock = project.mediaMode === "stock" || (project.mediaMode === "mixed" && Boolean(scene.stockSource));
      if (usesStock) continue;
      const image = makeTask(runId, projectId, scene.id, "image", `Изображение · сцена ${index + 1}`, []);
      created.push(image);
      if (project.settings.video.enabled) created.push(makeTask(runId, projectId, scene.id, "video", `AI-видео · сцена ${index + 1}`, [image.id]));
    }
    created.push(makeTask(runId, projectId, undefined, "assemble", "Сборка Final.mp4", created.map((task) => task.id)));
    tasks.push(...created);
    project.status = "generating";
    project.outputPath = undefined;
    project.scenes = project.scenes.map((scene) => {
      const usesStock = project.mediaMode === "stock" || (project.mediaMode === "mixed" && Boolean(scene.stockSource));
      return {
        ...scene,
        status: "queued",
        imagePath: usesStock ? scene.imagePath : undefined,
        videoPath: usesStock ? scene.videoPath : undefined,
        audioPath: undefined,
        stockSource: usesStock ? scene.stockSource : undefined,
      };
    });
    return clone(created);
  },
  async pauseGeneration(projectId) {
    tasks.forEach((task) => {
      if (task.projectId === projectId && (task.status === "pending" || task.status === "running" || task.status === "retry_wait")) {
        task.pausedFrom = task.status;
        task.status = "paused";
      }
    });
    requireProject(projectId).status = "paused";
    return clone(tasks.filter((task) => task.projectId === projectId));
  },
  async resumeGeneration(projectId) {
    tasks.forEach((task) => {
      if (task.projectId === projectId && task.status === "paused") {
        task.status = task.pausedFrom === "running" ? "running" : task.pausedFrom === "retry_wait" ? "retry_wait" : "pending";
        task.pausedFrom = undefined;
      }
    });
    requireProject(projectId).status = "generating";
    return clone(tasks.filter((task) => task.projectId === projectId));
  },
  async stopGeneration(projectId) {
    tasks.forEach((task) => {
      if (task.projectId === projectId && ["pending", "running", "retry_wait", "paused", "blocked"].includes(task.status)) task.status = "cancelled";
    });
    requireProject(projectId).status = "failed";
    return clone(tasks.filter((task) => task.projectId === projectId));
  },
  async retryTask(taskId) {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error("Задача не найдена");
    if (task.status === "cancelled") throw new Error("Остановленный проект нужно запустить заново");
    const project = requireProject(task.projectId);
    const runSceneIds = new Set(tasks.filter((candidate) => candidate.runId === task.runId && candidate.sceneId).map((candidate) => candidate.sceneId as string));
    if (runSceneIds.size !== project.scenes.length || project.scenes.some((scene) => !runSceneIds.has(scene.id))) {
      throw new Error("Состав сцен изменился. Запустите генерацию проекта заново.");
    }
    task.status = "pending";
    task.progress = 0;
    task.attempts = 0;
    task.error = undefined;
    return clone(task);
  },
  async clearFinishedTasks() {
    const runIds = [...new Set(tasks.map((task) => task.runId))];
    const removableRuns = new Set(runIds.filter((runId) => {
      const runTasks = tasks.filter((task) => task.runId === runId);
      return runTasks.length > 0 && runTasks.every((task) => task.status === "done" || task.status === "cancelled");
    }));
    tasks = tasks.filter((task) => !removableRuns.has(task.runId));
    return clone(tasks);
  },
  async clearQueue() {
    const activeProjectIds = new Set(
      tasks
        .filter((task) => ["pending", "running", "retry_wait", "paused", "blocked"].includes(task.status))
        .map((task) => task.projectId)
    );
    for (const projectId of activeProjectIds) {
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project) continue;
      project.status = "failed";
      project.scenes = project.scenes.map((scene) =>
        scene.status === "queued" || scene.status === "generating"
          ? { ...scene, status: "failed" }
          : scene
      );
    }
    tasks = [];
    return [];
  },
  async regenerateScene(projectId, sceneId, target = "all") {
    const project = requireProject(projectId);
    if (!(["image", "video", "audio", "all"] as const).includes(target)) throw new Error("Неизвестный режим перегенерации");
    if (target === "video" && !project.settings.video.enabled) throw new Error("AI-видео отключено в настройках проекта");
    if (target === "audio" && !project.settings.voice.enabled) throw new Error("Озвучка отключена в настройках проекта");
    const requestedIds = [...new Set(Array.isArray(sceneId) ? sceneId : [sceneId])];
    const selectedIds = new Set(requestedIds);
    const selectedScenes = project.scenes.filter((candidate) => selectedIds.has(candidate.id));
    if (selectedScenes.length === 0 || selectedScenes.length !== requestedIds.length) throw new Error("Одна или несколько сцен не найдены");
    const runId = createId("run");
    const replacedKinds = new Set<TaskKind>(target === "all" ? ["speech", "image", "video"] : [target === "audio" ? "speech" : target]);
    tasks = tasks.filter(
      (task) => task.projectId !== projectId || (task.kind !== "assemble" && (!task.sceneId || !selectedIds.has(task.sceneId) || !replacedKinds.has(task.kind)))
    );
    const created: QueueTask[] = [];
    for (const scene of selectedScenes) {
      if ((target === "all" || target === "audio") && project.settings.voice.enabled) {
        created.push(makeTask(runId, projectId, scene.id, "speech", `Озвучка · сцена ${scene.order + 1}`, []));
      }
      let imageTask = tasks.find((task) => task.projectId === projectId && task.sceneId === scene.id && task.kind === "image");
      if (target === "image" || target === "all") {
        imageTask = makeTask(runId, projectId, scene.id, "image", `Изображение · сцена ${scene.order + 1}`, []);
        created.push(imageTask);
      }
      if ((target === "video" || target === "all") && project.settings.video.enabled) {
        created.push(makeTask(runId, projectId, scene.id, "video", `AI-видео · сцена ${scene.order + 1}`, imageTask ? [imageTask.id] : []));
      }
    }
    tasks.push(...created);
    if (target !== "audio") {
      tasks.push(
        makeTask(
          runId,
          projectId,
          undefined,
          "assemble",
          `Пересборка Final.mp4 после ${selectedScenes.length === 1 ? "сцены" : `${selectedScenes.length} сцен`}`,
          tasks.filter((task) => task.projectId === projectId && task.kind !== "assemble").map((task) => task.id)
        )
      );
    }
    project.status = "generating";
    project.outputPath = undefined;
    project.scenes = project.scenes.map((candidate) =>
      selectedIds.has(candidate.id)
        ? {
            ...candidate,
            status: "queued",
            imagePath: target === "all" || target === "image" ? undefined : candidate.imagePath,
            videoPath: target === "all" || target === "video" ? undefined : candidate.videoPath,
            audioPath: target === "all" || target === "audio" ? undefined : candidate.audioPath
          }
        : candidate
    );
    return clone(tasks.filter((task) => task.projectId === projectId));
  },
  async openProjectFolder() {},
  async openSceneFolder() {},
  async writeLog() {},
  async readLogs() { return []; },
  onLogEntry() { return () => undefined; },
  async openLogFile() {},
  async pickFiles() { return []; },
  async importMusic() { throw Error('Импорт музыки доступен в приложении Windows'); },
  async pickCompetitorTranscripts() { return []; },
  async openExternal(url) { window.open(url, "_blank", "noopener,noreferrer"); },
  async pickDirectory() { return undefined; },
  async getWorkspaceStorage() { return { path: "Только в приложении Windows", freeBytes: 0 }; },
  async getWorkspaceUsage(path = "") { return { path, bytes: 0, logicalBytes: 0, files: 0, entries: [], projects: [], scannedAt: new Date().toISOString() }; },
  async openWorkspaceFolder() {},
  async scheduleWorkspaceMove() { throw new Error("Перенос доступен только в приложении Windows"); },
  async minimizeWindow() {},
  async toggleMaximizeWindow() {},
  async closeWindow() {},
  async getAppInfo() {
    return {
      version: "0.2.0",
      buildId: APP_BUILD_ID,
      buildCreatedAt: APP_BUILD_CREATED_AT,
      mainSessionId: "browser-preview",
      mainProcessId: 0,
      dataPath: "Режим браузерного предпросмотра",
      workspacePath: "Недоступно в браузерном предпросмотре",
      logPath: "Недоступно в браузерном предпросмотре",
      realtimeUrl: undefined,
      mockMode: true,
      ffmpegAvailable: false,
      queuePolicy: { concurrency: 5, maxAttempts: 3, retryDelaysMs: [1000, 3000] }
    };
  }
};
