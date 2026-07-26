export type ProjectMode = "standard" | "pro";
export type ProjectStatus = "draft" | "ready" | "generating" | "paused" | "complete" | "failed";
export type SceneStatus = "draft" | "queued" | "generating" | "ready" | "failed";
export type TaskStatus = "pending" | "running" | "retry_wait" | "paused" | "blocked" | "done" | "failed" | "cancelled";
export type TaskKind = "director" | "image" | "video" | "speech" | "assemble";
export type AspectRatio = "9:16" | "16:9" | "1:1";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface SubtitleSettings {
  enabled: boolean;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  accentColor: string;
  outlineColor: string;
  outlineWidth: number;
  shadow: boolean;
  bottomMargin: number;
  popWords: boolean;
}

export interface ProjectSettings {
  durationMinutes: number;
  frameChange: "scenario" | "5s" | "10s";
  script: {
    provider: "mock" | "gemini" | "claude" | "anymodel";
    model: string;
  };
  voice: {
    enabled: boolean;
    provider: "edge-tts" | "elevenlabs";
    voice: string;
    singleTrack: boolean;
  };
  image: {
    provider: "mock-image" | "nano-banana" | "gpt-image" | "anymodel-image";
    style: string;
    sequential: boolean;
    references: string[];
  };
  video: {
    enabled: boolean;
    provider: "mock-video" | "veo" | "anymodel-video";
    model: string;
    mode: "turbo" | "standard";
    startFrame: boolean;
    pairedFrames: boolean;
    muteSource: boolean;
    sourceVolume: number;
    animationPercent: number;
    distribution: "even" | "start" | "fade";
  };
  music: {
    path?: string;
    volume: number;
    /** false — собирать ролик без музыки (музыку добавят вручную, например в CapCut). Отсутствие поля = включено. */
    enabled?: boolean;
  };
  subtitles: SubtitleSettings;
  assembly: {
    kenBurns: boolean;
    fadeTransitions: boolean;
    audioNormalize: boolean;
    dualTrack: boolean;
    removeSilence: boolean;
    quality: "preview" | "standard" | "high";
  };
}

export interface Scene {
  id: string;
  order: number;
  title: string;
  imagePrompt: string;
  animationPrompt: string;
  narration: string;
  durationSeconds: number;
  status: SceneStatus;
  /** false — сцена исключена из финальной сборки (Final.mp4), но остаётся в проекте. */
  includeInAssembly?: boolean;
  /** Переход к следующей сцене в финальной сборке. */
  transition?: "none" | "fade";
  /** Движение камеры сцены: по настройке проекта (auto), приближение, отдаление или без движения. */
  kenBurnsDirection?: "auto" | "in" | "out" | "off";
  imagePath?: string;
  videoPath?: string;
  audioPath?: string;
}

export interface SuggestedTopic {
  title: string;
  hook: string;
  angle: string;
}

export interface ReferenceAnalysis {
  sourceUrl: string;
  sourceTitle: string;
  niche: string;
  targetAudience: string;
  hook: string;
  structure: string[];
  strengths: string[];
  improvements: string[];
  suggestedAngle: string;
  suggestedTitle: string;
  recommendedDurationSeconds: number;
  language: string;
  instructions?: string;
  scenes: Scene[];
  provider: string;
  youtubeContext?: YouTubeAnalysisContext;
  youtubeChannelContext?: YouTubeChannelContext;
  suggestedTopics?: SuggestedTopic[];
}

export interface AnalyzeReferenceInput {
  url: string;
  instructions?: string;
  language?: string;
}

export interface CreateReferenceProjectInput {
  analysis: ReferenceAnalysis;
  aspectRatio: AspectRatio;
  mode: ProjectMode;
}

export interface AnyModelSettings {
  configured: boolean;
  baseUrl: string;
  textModel: string;
  imageModel: string;
  videoModel: string;
  /** Провайдер озвучки: "google-tts"/"edge-tts" (язык проекта подставится сам) или полный id вида "edge-tts/ru-RU-DmitryNeural". */
  ttsModel: string;
  /** Модель картинок при заданных референсах — нужна поддержка опорных изображений (gpt-image-2/gpt-image-1). */
  imageRefModel: string;
  /** Модель транскрипции аудио — должна принимать input_audio (Gemini); Claude аудио не принимает. */
  transcriptionModel: string;
}

export interface YouTubeSettings {
  configured: boolean;
  cookiesFileConfigured: boolean;
  cookiesFileName?: string;
  workDirConfigured: boolean;
  workDirPath?: string;
}

export interface SaveYouTubeSettingsInput {
  apiKey?: string;
  cookiesFilePath?: string;
  clearCookiesFile?: boolean;
  workDirPath?: string;
  clearWorkDir?: boolean;
}

export interface TranscriptSegment {
  startSeconds: number;
  durationSeconds: number;
  text: string;
}

export interface YouTubeAnalysisContext {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  durationSeconds: number;
  channelId: string;
  channelTitle: string;
  views: number;
  likes: number;
  commentCount: number;
  channelSubscribers: number;
  channelViews: number;
  channelVideoCount: number;
  transcript: TranscriptSegment[];
  transcriptSource: "captions" | "yt-dlp-captions" | "gemini-audio" | "none";
  transcriptionAudioMegabytes?: number;
  topComments: Array<{ author: string; text: string; likes: number; publishedAt: string }>;
  topVideos: Array<{ id: string; title: string; publishedAt: string; views: number; likes: number; commentCount: number }>;
  visualAnalysisIncluded: false;
}

export interface ImageStyleOption {
  id: string;
  label: string;
  /** Суффикс, который добавляется к промпту каждой сцены (settings.image.style). */
  promptSuffix: string;
}

/** Каталог стилей изображений; превью лежат в renderer/public/styles/<id>.jpg. */
export const IMAGE_STYLES: ImageStyleOption[] = [
  { id: "cinematic", label: "Кино", promptSuffix: "cinematic photorealistic, dramatic lighting, film grain, 35mm lens, movie still" },
  { id: "pixar3d", label: "3D-мультфильм", promptSuffix: "3D animated family movie style, vibrant colors, soft global illumination, expressive big eyes, high quality render" },
  { id: "anime", label: "Аниме", promptSuffix: "anime style, cel shading, detailed painted background, studio quality" },
  { id: "comic", label: "Комикс", promptSuffix: "comic book art, bold ink outlines, halftone shading, dynamic angle" },
  { id: "watercolor", label: "Акварель", promptSuffix: "soft watercolor painting, gentle brush strokes, pastel palette, paper texture" },
  { id: "realistic", label: "Фотореализм", promptSuffix: "ultra realistic wildlife photography, natural light, high detail, shallow depth of field" },
  { id: "neon", label: "Неон", promptSuffix: "neon cyberpunk aesthetic, glowing magenta and cyan lights, night scene, high contrast" },
  { id: "minimal", label: "Минимализм", promptSuffix: "minimalist flat vector illustration, simple geometric shapes, bold colors" },
  { id: "fantasy", label: "Фэнтези", promptSuffix: "epic fantasy concept art, painterly, atmospheric fog, rich detail" },
  { id: "vintage", label: "Винтаж", promptSuffix: "vintage 1970s film photograph, muted warm colors, heavy grain, faded look" }
];

export interface TtsVoiceOption {
  /** Полный id модели озвучки AnyModel ("edge-tts/<голос>") или "google-tts" (язык проекта подставится сам). */
  id: string;
  label: string;
  /** Короткий код языка ("ru", "en", …); "any" — подходит для любого языка проекта. */
  language: string;
  gender?: "м" | "ж";
}

/** Каталог голосов озвучки: нейроголоса Edge TTS по языкам + стандартный Google TTS. */
export const TTS_VOICES: TtsVoiceOption[] = [
  { id: "google-tts", label: "Google TTS — стандартный", language: "any" },
  { id: "edge-tts/ru-RU-DmitryNeural", label: "Дмитрий — русский", language: "ru", gender: "м" },
  { id: "edge-tts/ru-RU-SvetlanaNeural", label: "Светлана — русский", language: "ru", gender: "ж" },
  { id: "edge-tts/ru-RU-DariyaNeural", label: "Дария — русский", language: "ru", gender: "ж" },
  { id: "edge-tts/en-US-ChristopherNeural", label: "Christopher — английский (США)", language: "en", gender: "м" },
  { id: "edge-tts/en-US-GuyNeural", label: "Guy — английский (США)", language: "en", gender: "м" },
  { id: "edge-tts/en-US-AriaNeural", label: "Aria — английский (США)", language: "en", gender: "ж" },
  { id: "edge-tts/en-US-JennyNeural", label: "Jenny — английский (США)", language: "en", gender: "ж" },
  { id: "edge-tts/en-GB-RyanNeural", label: "Ryan — английский (Британия)", language: "en", gender: "м" },
  { id: "edge-tts/en-GB-SoniaNeural", label: "Sonia — английский (Британия)", language: "en", gender: "ж" },
  { id: "edge-tts/es-ES-AlvaroNeural", label: "Álvaro — испанский", language: "es", gender: "м" },
  { id: "edge-tts/es-ES-ElviraNeural", label: "Elvira — испанский", language: "es", gender: "ж" },
  { id: "edge-tts/es-MX-JorgeNeural", label: "Jorge — испанский (Мексика)", language: "es", gender: "м" },
  { id: "edge-tts/de-DE-ConradNeural", label: "Conrad — немецкий", language: "de", gender: "м" },
  { id: "edge-tts/de-DE-KatjaNeural", label: "Katja — немецкий", language: "de", gender: "ж" },
  { id: "edge-tts/fr-FR-HenriNeural", label: "Henri — французский", language: "fr", gender: "м" },
  { id: "edge-tts/fr-FR-DeniseNeural", label: "Denise — французский", language: "fr", gender: "ж" },
  { id: "edge-tts/it-IT-DiegoNeural", label: "Diego — итальянский", language: "it", gender: "м" },
  { id: "edge-tts/it-IT-ElsaNeural", label: "Elsa — итальянский", language: "it", gender: "ж" },
  { id: "edge-tts/pt-BR-AntonioNeural", label: "Antonio — португальский (Бразилия)", language: "pt", gender: "м" },
  { id: "edge-tts/pt-BR-FranciscaNeural", label: "Francisca — португальский (Бразилия)", language: "pt", gender: "ж" },
  { id: "edge-tts/uk-UA-OstapNeural", label: "Остап — украинский", language: "uk", gender: "м" },
  { id: "edge-tts/uk-UA-PolinaNeural", label: "Полина — украинский", language: "uk", gender: "ж" }
];

export interface YouTubeChannelVideoStat {
  id: string;
  title: string;
  publishedAt: string;
  durationSeconds: number;
  views: number;
  likes: number;
  commentCount: number;
}

export interface YouTubeChannelContext {
  channelId: string;
  title: string;
  description: string;
  subscribers: number;
  totalViews: number;
  videoCount: number;
  /** Таймлайн загрузок канала (до 100 роликов): просмотры, даты публикации, длительности. */
  videos: YouTubeChannelVideoStat[];
  /** Комментарии под самыми просматриваемыми роликами — что хотят зрители ниши. */
  topComments: Array<{ videoTitle: string; author: string; text: string; likes: number; publishedAt: string }>;
}

export interface SaveAnyModelSettingsInput extends Omit<AnyModelSettings, "configured"> {
  apiKey?: string;
}

export interface AiChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatTopicSummary {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatTopic extends ChatTopicSummary {
  messages: Array<AiChatMessage & { id: number; createdAt: string }>;
  analysis?: ReferenceAnalysis;
}

export interface Project {
  id: string;
  title: string;
  topic: string;
  aspectRatio: AspectRatio;
  language: string;
  mode: ProjectMode;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  scenes: Scene[];
  settings: ProjectSettings;
  chatTopicId?: string;
  referenceAnalysis?: ReferenceAnalysis;
  outputPath?: string;
}

export interface QueueTask {
  id: string;
  runId: string;
  projectId: string;
  sceneId?: string;
  kind: TaskKind;
  label: string;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  progress: number;
  dependsOn: string[];
  pausedFrom?: "pending" | "running" | "retry_wait";
  nextAttemptAt?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  resultPath?: string;
}

export interface CreateProjectInput {
  title: string;
  topic: string;
  aspectRatio: AspectRatio;
  language: string;
  mode: ProjectMode;
}

export interface UpdateProjectInput {
  title?: string;
  topic?: string;
  aspectRatio?: AspectRatio;
  language?: string;
  mode?: ProjectMode;
  status?: ProjectStatus;
  scenes?: Scene[];
  settings?: ProjectSettings;
  chatTopicId?: string;
  outputPath?: string;
}

export interface QueuePolicy {
  concurrency: number;
  maxAttempts: number;
  retryDelaysMs: number[];
}

export interface DesktopApi {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(input: CreateProjectInput): Promise<Project>;
  createDemoProject(): Promise<Project>;
  analyzeReference(input: AnalyzeReferenceInput): Promise<ReferenceAnalysis>;
  refineReferenceAnalysis(analysis: ReferenceAnalysis, instructions: string): Promise<ReferenceAnalysis>;
  createReferenceProject(input: CreateReferenceProjectInput): Promise<Project>;
  regenerateReferenceScenes(analysis: ReferenceAnalysis, targetSeconds: number): Promise<ReferenceAnalysis>;
  onDirectorProgress(listener: (stage: string) => void): () => void;
  getAnyModelSettings(): Promise<AnyModelSettings>;
  saveAnyModelSettings(input: SaveAnyModelSettingsInput): Promise<AnyModelSettings>;
  clearAnyModelKey(): Promise<AnyModelSettings>;
  testAnyModelConnection(): Promise<{ ok: boolean; message: string }>;
  /** Короткий аудио-пример голоса (base64 MP3); кэшируется, так что повторное прослушивание бесплатно. */
  ttsSample(voice: string, language: string): Promise<string>;
  /** Создаёт портрет главного героя по сценарию и добавляет его в референсы проекта. */
  createCharacterReference(projectId: string): Promise<Project>;
  getYouTubeSettings(): Promise<YouTubeSettings>;
  saveYouTubeSettings(input: SaveYouTubeSettingsInput): Promise<YouTubeSettings>;
  clearYouTubeKey(): Promise<YouTubeSettings>;
  testYouTubeConnection(): Promise<{ ok: boolean; message: string }>;
  chatWithAnyModel(messages: AiChatMessage[]): Promise<string>;
  streamChatWithAnyModel(messages: AiChatMessage[], onChunk: (chunk: string) => void): Promise<string>;
  listChatTopics(): Promise<ChatTopicSummary[]>;
  getChatTopic(id: string): Promise<ChatTopic | undefined>;
  createChatTopic(title?: string): Promise<ChatTopic>;
  appendChatMessage(topicId: string, message: AiChatMessage): Promise<ChatTopic>;
  saveChatTopicAnalysis(topicId: string, analysis: ReferenceAnalysis | null): Promise<ChatTopic>;
  deleteChatTopic(id: string): Promise<void>;
  applyChatTopicToProject(projectId: string, topicId: string): Promise<Project>;
  updateProject(id: string, input: UpdateProjectInput): Promise<Project>;
  duplicateProject(id: string): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  getQueue(): Promise<QueueTask[]>;
  startGeneration(projectId: string): Promise<QueueTask[]>;
  pauseGeneration(projectId: string): Promise<QueueTask[]>;
  resumeGeneration(projectId: string): Promise<QueueTask[]>;
  stopGeneration(projectId: string): Promise<QueueTask[]>;
  retryTask(taskId: string): Promise<QueueTask>;
  clearFinishedTasks(): Promise<QueueTask[]>;
  regenerateScene(projectId: string, sceneId: string): Promise<QueueTask[]>;
  openProjectFolder(projectId: string): Promise<void>;
  openSceneFolder(projectId: string, sceneId: string): Promise<void>;
  writeLog(level: LogLevel, message: string, details?: Record<string, unknown>): Promise<void>;
  openLogFile(): Promise<void>;
  pickFiles(kind: "image" | "audio" | "video" | "json" | "cookies", multiple?: boolean): Promise<string[]>;
  pickDirectory(): Promise<string | undefined>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  getAppInfo(): Promise<{
    version: string;
    dataPath: string;
    workspacePath: string;
    logPath: string;
    realtimeUrl?: string;
    mockMode: boolean;
    ffmpegAvailable: boolean;
    queuePolicy: QueuePolicy;
  }>;
}

export function createDefaultProjectSettings(): ProjectSettings {
  return {
    durationMinutes: 1,
    frameChange: "scenario",
    script: {
      provider: "mock",
      model: "Built-in Gemini (подключение позже)"
    },
    voice: {
      enabled: true,
      provider: "edge-tts",
      voice: "ru-RU-DmitryNeural",
      singleTrack: false
    },
    image: {
      provider: "mock-image",
      style: "Семейная 3D-анимация, кинематографичный свет",
      sequential: false,
      references: []
    },
    video: {
      enabled: false,
      provider: "mock-video",
      model: "Mock Motion 1",
      mode: "turbo",
      startFrame: true,
      pairedFrames: false,
      muteSource: true,
      sourceVolume: 15,
      animationPercent: 100,
      distribution: "fade"
    },
    music: { volume: 10 },
    subtitles: {
      enabled: false,
      fontFamily: "Montserrat ExtraBold",
      fontSize: 64,
      textColor: "#ffffff",
      accentColor: "#f0c84b",
      outlineColor: "#000000",
      outlineWidth: 4,
      shadow: true,
      bottomMargin: 12,
      popWords: true
    },
    assembly: {
      kenBurns: true,
      fadeTransitions: true,
      audioNormalize: false,
      dualTrack: false,
      removeSilence: false,
      quality: "standard"
    }
  };
}

export function parseYouTubeVideoId(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Укажите полную ссылку YouTube");
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const id = host === "youtu.be"
    ? url.pathname.split("/").filter(Boolean)[0]
    : ["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)
      ? url.searchParams.get("v") ?? (url.pathname.match(/^\/(?:shorts|embed)\/([^/?]+)/)?.[1] ?? "")
      : "";
  if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) throw new Error("Ссылка не содержит корректный ID YouTube-видео");
  return id;
}

/** Как parseYouTubeVideoId, но без исключений: не ссылка на видео → undefined. */
export function tryParseYouTubeVideoId(value: string): string | undefined {
  try {
    return parseYouTubeVideoId(value);
  } catch {
    return undefined;
  }
}

export interface YouTubeChannelRef {
  kind: "id" | "handle" | "custom" | "user";
  value: string;
}

/** Распознаёт ссылку на КАНАЛ YouTube: /@handle, /channel/UC…, /c/имя, /user/имя. Не канал → undefined. */
export function parseYouTubeChannelRef(value: string): YouTubeChannelRef | undefined {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  const host = url.hostname.replace(/^(www|m)\./, "").toLowerCase();
  if (!["youtube.com", "music.youtube.com"].includes(host)) return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  const head = parts[0] ?? "";
  if (head.startsWith("@") && head.length > 1) return { kind: "handle", value: head };
  if (head === "channel" && /^UC[A-Za-z0-9_-]{10,}$/.test(parts[1] ?? "")) return { kind: "id", value: parts[1]! };
  if (head === "c" && parts[1]) return { kind: "custom", value: parts[1]! };
  if (head === "user" && parts[1]) return { kind: "user", value: parts[1]! };
  return undefined;
}

// --- yt-dlp preflight: чистые (без Electron/fs) хелперы для проверки cookies и свободного места ---

/** Минимально требуемое свободное место в рабочей папке для запуска yt-dlp (распаковка PyInstaller + временные файлы). */
export const MIN_FREE_DISK_BYTES = 512 * 1024 * 1024;

export interface CookiesValidationResult {
  /** Файл в формате Netscape (корректный заголовок). */
  netscape: boolean;
  /** Есть хотя бы одна cookie домена youtube.com. */
  hasYouTubeCookie: boolean;
}

/**
 * Проверяет СОДЕРЖИМОЕ cookies.txt, не раскрывая значений: только факты (формат и наличие домена).
 * Никогда не логируйте и не возвращайте сам текст cookies наружу.
 */
export function validateCookiesContent(content: string): CookiesValidationResult {
  const netscape = /Netscape HTTP Cookie File/i.test(content) || /^#\s*HTTP Cookie File/im.test(content);
  const hasYouTubeCookie = content.split(/\r?\n/).some((line) => {
    if (!line || line.startsWith("#")) return false;
    const domain = line.split("\t")[0]?.toLowerCase() ?? "";
    return domain.includes("youtube.com");
  });
  return { netscape, hasYouTubeCookie };
}

/** Понятное сообщение о проблеме с cookies (или undefined, если всё в порядке). Без раскрытия значений. */
export function describeCookiesProblem(result: CookiesValidationResult): string | undefined {
  if (!result.netscape) {
    return "Файл cookies.txt не в формате Netscape. Экспортируйте его расширением для экспорта cookies в формате Netscape.";
  }
  if (!result.hasYouTubeCookie) {
    return "В cookies.txt нет cookies домена youtube.com. Войдите в аккаунт на YouTube и экспортируйте cookies заново.";
  }
  return undefined;
}

export interface FreeSpaceResult {
  ok: boolean;
  availableBytes: number;
  requiredBytes: number;
}

/** Достаточно ли свободного места (по умолчанию — MIN_FREE_DISK_BYTES). */
export function evaluateFreeSpace(availableBytes: number, requiredBytes: number = MIN_FREE_DISK_BYTES): FreeSpaceResult {
  return { ok: availableBytes >= requiredBytes, availableBytes, requiredBytes };
}

/**
 * Разбирает пользовательский ввод длительности в секунды: «5 минут», «90 секунд», «7 мин», «5:30», «300».
 * Голое число ≤ 60 считается минутами, > 60 — секундами. Возвращает null, если длительность не распознана.
 */
export function parseDurationSeconds(text: string): number | null {
  const value = text.trim().toLowerCase().replace(",", ".");
  if (!value) return null;
  const clock = /^(\d{1,3}):([0-5]?\d)$/.exec(value);
  if (clock) return Math.round(Number(clock[1]) * 60 + Number(clock[2]));
  const unit = /(\d+(?:\.\d+)?)\s*(минут\w*|мин\w*|min\w*|m\b|м\b|секунд\w*|сек\w*|sec\w*|s\b|с\b)/.exec(value);
  if (unit) {
    const amount = Number(unit[1]);
    const isSeconds = /^(?:с|s)|сек|sec/.test(unit[2]!);
    return Math.round(isSeconds ? amount : amount * 60);
  }
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const amount = Number(value);
    return Math.round(amount <= 60 ? amount * 60 : amount);
  }
  return null;
}

/** Сопоставляет язык проекта коду для TTS (google-tts/<code>). По умолчанию — ru. */
export function ttsLanguageCode(language: string): string {
  const value = language.trim().toLowerCase();
  const map: Record<string, string> = {
    "русский": "ru", russian: "ru", ру: "ru", ru: "ru",
    english: "en", английский: "en", en: "en",
    "español": "es", espanol: "es", испанский: "es", spanish: "es", es: "es",
    deutsch: "de", немецкий: "de", german: "de", de: "de",
    "français": "fr", francais: "fr", французский: "fr", french: "fr", fr: "fr",
    italiano: "it", итальянский: "it", italian: "it", it: "it",
    "português": "pt", portugues: "pt", португальский: "pt", portuguese: "pt", pt: "pt",
    "українська": "uk", украинский: "uk", ukrainian: "uk", uk: "uk",
    китайский: "zh-CN", chinese: "zh-CN"
  };
  if (map[value]) return map[value]!;
  if (/^[a-z]{2}(-[a-z]{2})?$/i.test(language.trim())) return language.trim();
  return "ru";
}

/** Человекочитаемый размер (Б/КБ/МБ/ГБ/ТБ). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}
