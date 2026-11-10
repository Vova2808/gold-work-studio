export * from "./effect-library.js";
export * from "./music.js";
import type { MusicSettings } from "./music.js";
export * from "./documentary.js";
import type { EffectLibraryApi } from "./effect-library.js";
import type { DocumentaryApi, DocumentaryScene, DocumentarySettings, DocumentarySourceProvider } from "./documentary.js";
import { documentarySceneTransition } from "./documentary-transitions.js";
export type ProjectMode = "standard" | "pro";
export type ProjectStatus = "draft" | "ready" | "generating" | "paused" | "complete" | "failed";
export type SceneStatus = "draft" | "queued" | "generating" | "ready" | "failed";
export type TaskStatus = "pending" | "running" | "retry_wait" | "paused" | "blocked" | "done" | "failed" | "cancelled";
export type TaskKind = "director" | "image" | "video" | "speech" | "assemble";
export { projectEditorReady } from './project-editor-readiness.js';
export type AspectRatio = "9:16" | "16:9" | "1:1";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type ChannelMediaMode = "stock" | "ai" | "mixed";
/** Пользовательское направление канала. Mixed остаётся только для чтения старых проектов. */
export type ChannelDirection = "ai-story" | "stock-documentary";
/** Direction is authoritative for new channel videos; old profiles retain their default. */
export function channelMediaMode(profile: Pick<ChannelProfile, "direction" | "defaultMediaMode">): ChannelMediaMode {
  if (profile.direction === "ai-story") return "ai";
  if (profile.direction === "stock-documentary") return "stock";
  return profile.defaultMediaMode === "ai" ? "ai" : "stock";
}

/** Saved project choices take precedence over channel defaults and legacy video switches. */
export function projectMediaMode(project: Pick<Project, "mediaMode" | "settings">): ChannelMediaMode {
  if (project.mediaMode === "stock" || project.mediaMode === "ai" || project.mediaMode === "mixed") return project.mediaMode;
  if (project.settings.assembly.documentary?.version === 2) return "stock";
  return project.settings.video.enabled ? "ai" : "stock";
}
export type StockProvider = "pexels" | "pixabay";
export type StockMediaType = "image" | "video";
export type StockOrientation = "landscape" | "portrait" | "square";
export type StockConnectionState = "not_configured" | "saved" | "working" | "error";

export interface StockProviderStatus {
  provider: StockProvider;
  configured: boolean;
  state: StockConnectionState;
  /** Прокси хранится зашифрованно в main process; renderer видит только безопасный адрес без credentials. */
  proxyConfigured?: boolean;
  proxyDisplayName?: string;
  checkedAt?: string;
  message?: string;
}

export interface StockSettings {
  pexelsConfigured: boolean;
  pixabayConfigured: boolean;
  /** Наличие ключа и результат реальной API-проверки — отдельно для каждого источника. */
  providers: Record<StockProvider, StockProviderStatus>;
}

export interface StockConnectionTestResult {
  provider: StockProvider;
  ok: boolean;
  message: string;
  status: StockProviderStatus;
}

export interface SaveStockSettingsInput {
  pexelsApiKey?: string;
  pixabayApiKey?: string;
  pexelsProxyUrl?: string;
  pixabayProxyUrl?: string;
  clearPexelsProxy?: boolean;
  clearPixabayProxy?: boolean;
}

export interface StockSearchInput {
  provider: StockProvider;
  mediaType: StockMediaType;
  query: string;
  orientation?: StockOrientation;
  page?: number;
  perPage?: number;
}

/** Нормализованный результат Pexels/Pixabay. downloadUrl используется только после ручного выбора. */
export interface StockAsset {
  /** Provider-supplied HD photo variant for documentary downloads. */
  optimizedDownloadUrl?: string;
  provider: StockProvider;
  id: string;
  mediaType: StockMediaType;
  query: string;
  width: number;
  height: number;
  durationSeconds?: number;
  previewUrl: string;
  downloadUrl: string;
  pageUrl: string;
  /** Текстовое описание результата от провайдера (Pexels alt / slug). Используется только для проверки релевантности. */
  description?: string;
  /** Нормализованные теги Pixabay/Pexels, если провайдер их вернул. */
  tags?: string[];
  author: string;
  authorUrl?: string;
  attribution: string;
}

export interface StockSearchResult {
  items: StockAsset[];
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
}

export interface AutoStockSelectionOptions {
  /** Явно заменить уже выбранный stock. По умолчанию ручной и прошлый автоматический выбор сохраняются. */
  force?: boolean;
  /** Ограничить подбор указанными сценами; пустой список не запускает подбор. */
  sceneIds?: string[];
}

export type AutoStockProgressPhase = "preparing" | "searching" | "downloading" | "applying" | "complete" | "failed" | "stopped";

export interface AutoStockProgress {
  projectId: string;
  phase: AutoStockProgressPhase;
  /** Обработано сцен, включая сохранённые ранее и неудачные. */
  completed: number;
  total: number;
  selected: number;
  skipped: number;
  failed: number;
  currentSceneId?: string;
  /** Человеческий номер сцены (начиная с 1). */
  currentSceneNumber?: number;
  message: string;
}

export interface AutoStockFailure {
  sceneId: string;
  sceneNumber: number;
  category: "no-results" | "content-rejected" | "budget-exhausted" | "analysis" | "download" | "cdn" | "invalid-key" | "provider-temporary" | "unknown";
  message: string;
}

export interface AutoStockSelectionResult {
  project: Project;
  total: number;
  selected: number;
  skipped: number;
  failed: number;
  failures: AutoStockFailure[];
}

/** Источник уже скачанного стокового файла. Хранится в project.json и рядом со сценой. */
export interface StockAssetSource {
  provider: StockProvider | DocumentarySourceProvider;
  assetId: string;
  mediaType: StockMediaType;
  query: string;
  pageUrl: string;
  author: string;
  authorUrl?: string;
  attribution: string;
  licenseUrl: string;
  downloadedAt: string;
}

/** Дополнительный локальный stock-кадр для более плотного монтажа одной сцены. */
export interface StockMediaVariant {
  stockSource: StockAssetSource;
  /** Для фото — сам материал; для видео — необязательный локальный poster. */
  imagePath?: string;
  videoPath?: string;
}

export interface CompetitorTranscript {
  id: string;
  name: string;
  text: string;
}

export interface VideoBrief {
  prompt: string;
  competitorTranscripts: CompetitorTranscript[];
  /** Новый ролик пишется по заданию или собирается из уже готового текста без переписывания. */
  creationMode?: "prompt" | "script";
  /** Исходный готовый текст. В режиме script приложение может только разметить и рассчитать его. */
  readyScript?: string;
}

export interface ChannelProfile {
  id: string;
  name: string;
  countryCode: string;
  languageCode: string;
  languageLabel: string;
  masterPrompt: string;
  lumeanTemplateUuid?: string;
  lumeanTemplateName?: string;
  defaultDurationMinutes: number;
  /** Неизменяемое после создания направление канала. */
  direction: ChannelDirection;
  /** Совместимое с существующим pipeline представление направления. Новые каналы не хранят mixed. */
  defaultMediaMode: ChannelMediaMode;
  motionTemplate: string;
  /** AI Story visual default; individual projects can override it. */
  defaultImageStyle?: string;
  /** Подтверждённый бренд-персонаж, автоматически доступный новым роликам этого канала. */
  primaryCharacter?: ChannelCharacterReference;
  /** Версии не затираются при перегенерации; primary меняется только после подтверждения. */
  characterVersions: ChannelCharacterReference[];
  /** Removed from the selectable library, recoverable; referenced image files remain intact. */
  deletedCharacterVersions?: ChannelCharacterReference[];
  /** Durable state of an explicitly requested channel portrait; never auto-replayed. */
  characterGeneration?: ChannelCharacterGeneration;
  createdAt: string;
  updatedAt: string;
}

export interface SaveChannelProfileInput {
  name: string;
  countryCode: string;
  languageCode: string;
  languageLabel: string;
  masterPrompt: string;
  lumeanTemplateUuid?: string;
  lumeanTemplateName?: string;
  defaultDurationMinutes?: number;
  direction?: ChannelDirection;
  defaultMediaMode?: ChannelMediaMode;
  motionTemplate?: string;
  defaultImageStyle?: string;
}

/** New projects inherit the channel, or the selected brand portrait's own style. */
export function channelImageStyle(profile: Pick<ChannelProfile, "direction" | "defaultImageStyle" | "primaryCharacter">,
  fallback: string, usePrimaryCharacter = false): string {
  if (profile.direction !== "ai-story") return fallback;
  const heroStyle = profile.primaryCharacter?.stylePrompt?.trim();
  if (usePrimaryCharacter && heroStyle) return heroStyle;
  return profile.defaultImageStyle?.trim() || heroStyle || fallback;
}

export interface ConsoleLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  details?: Record<string, unknown>;
}

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

/**
 * Измеренная скорость конкретного TTS-голоса. Хранится в project.json, потому
 * что одинаковое имя голоса у другого провайдера или языка не означает ту же скорость.
 */
export interface VoiceCalibration {
  version: 1;
  provider: "edge-tts" | "elevenlabs";
  voice: string;
  languageCode: string;
  sampleText: string;
  sampleCharacterCount: number;
  sampleWordCount: number;
  /** Длина слышимой речи без технической тишины в начале и конце файла. */
  audioDurationSeconds: number;
  charactersPerSecond: number;
  wordsPerMinute: number;
  calibratedAt: string;
}

/** Целевой объём озвучки, рассчитанный из реальной скорости выбранного голоса. */
export interface NarrationTimingBudget {
  targetSeconds: number;
  targetCharacterCount: number;
  targetWordCount: number;
  charactersPerSecond: number;
  wordsPerMinute: number;
}

export interface VoiceCalibrationRequest {
  provider: "edge-tts" | "elevenlabs";
  /** Полный id Edge TTS/Google TTS или UUID шаблона Lumean. Пустое значение запрещено. */
  voice: string;
  /** Язык проекта: название или код, например «Русский»/ru. */
  language: string;
}

export interface VoiceCalibrationSampleResult {
  calibration: VoiceCalibration;
  sampleAudioBase64: string;
}

export interface ProjectSettings {
  durationMinutes: number;
  frameChange: "scenario" | "5s" | "10s";
  /** Желаемая доля stock-видео: 0/100 — явные крайние режимы, между ними смысл сцены определяет лучших кандидатов на видео. */
  stockVideoPercent: number;
  script: {
    provider: "mock" | "gemini" | "claude" | "anymodel";
    model: string;
  };
  voice: {
    enabled: boolean;
    provider: "edge-tts" | "elevenlabs";
    voice: string;
    singleTrack: boolean;
    /** Отсутствует до обязательной тестовой озвучки выбранного голоса. */
    calibration?: VoiceCalibration;
  };
  image: {
    provider: "mock-image" | "nano-banana" | "gpt-image" | "anymodel-image" | "flow";
    style: string;
    sequential: boolean;
    references: string[];
  };
  video: {
    enabled: boolean;
    provider: "mock-video" | "veo" | "anymodel-video" | "flow";
    model: string;
    mode: "turbo" | "standard";
    startFrame: boolean;
    pairedFrames: boolean;
    muteSource: boolean;
    sourceVolume: number;
    animationPercent: number;
    /** Как выбираются AI Story кадры для Veo. Отсутствие в старом проекте означает auto. */
    selectionMode?: "auto" | "key-scenes" | "every-second" | "every-third" | "manual";
    /** @deprecated Оставлено только для чтения старых project.json. */
    distribution: "even" | "start" | "fade";
  };
  music: MusicSettings;
  subtitles: SubtitleSettings;
  assembly: {
    kenBurns: boolean;
    /** Направление камеры для всех сцен: по смыслу, приближение, отдаление или чередование. Сцена может переопределить. */
    kenBurnsDirection?: "smart" | "in" | "out" | "alternate" | "cycle";
    fadeTransitions: boolean;
    /** Переход по умолчанию между сценами слайд-шоу. Ручная настройка сцены имеет приоритет. */
    transitionType?: "none" | "fade" | "mix";
    /** Длительность перехода по умолчанию между сценами слайд-шоу, в секундах. */
    transitionDurationSeconds?: number;
    audioNormalize: boolean;
    dualTrack: boolean;
    removeSilence: boolean;
    quality: "preview" | "standard" | "high";
    /**
     * Универсальный монтаж поверх сцен. Поле опционально, чтобы старые project.json
     * продолжали открываться; createDefaultProjectSettings всегда создаёт его.
     */
    montage?: MontageSettings;
    /** Present only for explicitly created Stock v2 projects. Absence preserves legacy rendering. */
    documentary?: DocumentarySettings;
  };
}

/** Разрешённые, не привязанные к нише шаблоны визуального монтажа. */
export const VISUAL_BEAT_TEMPLATES = [
  "full-media",
  "focus-text",
  "fact-card",
  "evidence-card",
  "compare-split",
  "timeline-links",
  "quick-montage",
  "stat-callout",
  "editorial-panel",
  "chapter-card",
  "quote-card",
  "checklist-grid"
] as const;

export type VisualBeatTemplate = typeof VISUAL_BEAT_TEMPLATES[number];

/** Смысловая роль кадра, которую AI может выбрать только из этого списка. */
export const VISUAL_BEAT_ROLES = [
  "establish",
  "explain",
  "emphasize",
  "evidence",
  "compare",
  "connect",
  "montage"
] as const;

export type VisualBeatRole = typeof VISUAL_BEAT_ROLES[number];

export const VISUAL_BEAT_OVERLAYS = ["none", "title", "keyword", "fact", "quote"] as const;
export type VisualBeatOverlay = typeof VISUAL_BEAT_OVERLAYS[number];

export const VISUAL_BEAT_DIMMING = ["none", "soft", "strong"] as const;
export type VisualBeatDimming = typeof VISUAL_BEAT_DIMMING[number];

export const VISUAL_BEAT_MOTIONS = ["none", "push-in", "pull-out", "pan-left", "pan-right"] as const;
export type VisualBeatMotion = typeof VISUAL_BEAT_MOTIONS[number];

export const VISUAL_BEAT_TRANSITIONS = ["hard", "mix", "fade"] as const;
export type VisualBeatTransition = typeof VISUAL_BEAT_TRANSITIONS[number];

/**
 * Один визуальный такт внутри сцены. Сцена по-прежнему является неделимой
 * единицей narration/TTS; такты меняют только изображение и графику поверх неё.
 */
export interface VisualBeat {
  id: string;
  sceneId: string;
  order: number;
  /** Смещение от начала сцены, рассчитанное локальным планировщиком. */
  startSeconds: number;
  /** Длительность рассчитывается локально и не принимается из AI-ответа. */
  durationSeconds: number;
  role: VisualBeatRole;
  template: VisualBeatTemplate;
  overlay: VisualBeatOverlay;
  dimming: VisualBeatDimming;
  motion: VisualBeatMotion;
  /** Переход В этот такт. Для первого такта ролика всегда hard. */
  transition: VisualBeatTransition;
  /** Локальный признак для безопасного применения mix. */
  relatedToPrevious: boolean;
}

/**
 * Ограниченное предложение AI. Здесь намеренно нет React/CSS, координат,
 * текста, длительностей и произвольных названий эффектов или шаблонов.
 */
export interface VisualBeatAiProposal {
  role?: VisualBeatRole;
  template?: VisualBeatTemplate;
  overlay?: VisualBeatOverlay;
  dimming?: VisualBeatDimming;
  motion?: VisualBeatMotion;
  transition?: VisualBeatTransition;
}

export interface MontageSettings {
  enabled: boolean;
  /** local — полностью детерминированно; ai-bounded — AI только предлагает значения allowlist. */
  planner: "local" | "ai-bounded";
  density: "calm" | "balanced" | "dynamic";
  /** Желаемая доля графических тактов; валидатор всегда ограничивает её 35%. */
  graphicBeatPercent: number;
  /** Желаемая доля жёстких склеек; валидатор удерживает её в диапазоне 70–85%. */
  hardCutPercent: number;
}

export type MontagePlannerOutcome = "local" | "ai-bounded" | "local-fallback";

/** Фактически сохранённый план, а не только выбранная пользователем настройка planner. */
export interface MontagePlanSummary {
  plannedAt: string;
  requestedPlanner: MontageSettings["planner"];
  usedPlanner: MontagePlannerOutcome;
  modelId?: string;
  visualBeatCount: number;
  templates: VisualBeatTemplate[];
  issueCount: number;
}

export type RenderEngine = "remotion" | "ffmpeg-fallback" | "ffmpeg";

/** Последний завершённый экспорт. Хранится в project.json и честно показывается в UI. */
export interface ProjectRenderReport {
  completedAt: string;
  buildId: string;
  engine: RenderEngine;
  requestedPlanner?: MontageSettings["planner"];
  plannerUsed?: MontagePlannerOutcome;
  visualBeatCount: number;
  templates: VisualBeatTemplate[];
  stockVideoCount: number;
  stockImageCount: number;
  fallbackReason?: string;
  /** Completed export with visible local preparation fallbacks. */
  warnings?: string[];
}

export interface Scene {
  documentary?: DocumentaryScene;
  /** Explicit visual cast; an empty list means no recurring characters in this shot. */
  characterIds?: string[];
  id: string;
  order: number;
  title: string;
  imagePrompt: string;
  /** Короткий предметный запрос (2–6 слов) для Pexels/Pixabay; не является AI-промптом изображения. */
  stockQuery?: string;
  animationPrompt: string;
  narration: string;
  durationSeconds: number;
  status: SceneStatus;
  /** false — сцена исключена из финальной сборки (Final.mp4), но остаётся в проекте. */
  includeInAssembly?: boolean;
  /** Переход к следующей сцене: mix — плавное смешивание кадров, fade — уход в чёрный. Отсутствие = как в проекте. */
  transition?: "none" | "fade" | "mix";
  /** Автоматический переход из монтажной грамматики; ручной transition имеет приоритет. */
  autoTransition?: "none" | "fade" | "mix";
  autoTransitionDurationSeconds?: number;
  /** Движение камеры сцены: по настройке проекта (auto), приближение, отдаление или без движения. */
  kenBurnsDirection?: "auto" | "in" | "out" | "off";
  /** Автонаправление по смыслу кадра; используется только в глобальном режиме smart. */
  autoKenBurnsDirection?: "in" | "out" | "pan-left" | "pan-right" | "pan-up" | "pan-down";
  /** Percent of the uncropped source, from a saved observation or authored framing. */
  autoKenBurnsFocus?: { x: number; y: number };
  autoKenBurnsZoom?: number;
  /** Явная длительность сцены в монтаже. Отсутствие сохраняет автоматический расчёт старых проектов. */
  durationOverrideSeconds?: number;
  /** Скорость воспроизведения исходного видео и звука: 1 — без изменения. */
  playbackRate?: number;
  /** Начало используемого фрагмента исходного медиа, в секундах. */
  trimStartSeconds?: number;
  /** Конец используемого фрагмента исходного медиа, в секундах; отсутствие — до конца. */
  trimEndSeconds?: number;
  /** Громкость озвучки сцены в процентах. */
  narrationVolume?: number;
  /** Громкость исходного звука AI-видео в процентах. */
  sourceVolume?: number;
  /** Длительность перехода к следующей сцене, в секундах. */
  transitionDurationSeconds?: number;
  /** Добавить затемнение на входе и выходе именно этой сцены. */
  fadeEdges?: boolean;
  /** Максимальный масштаб Ken Burns как множитель, например 1.1 = 10% приближения. */
  kenBurnsZoom?: number;
  imagePath?: string;
  videoPath?: string;
  /** Видеосервис не сгенерировал анимацию: используется исходная картинка. */
  videoFallback?: "static-image";
  audioPath?: string;
  /** Фрагмент готового TTS-файла после локального деления длинного кадра.
   * Границы относятся к исходному файлу, а не к trim визуала. Файл не меняется. */
  narrationSlice?: {
    sourceSceneId: string;
    startSeconds: number;
    endSeconds: number;
    /** Только последняя часть получает обычную короткую паузу после реплики. */
    last: boolean;
  };
  /** Атрибуция и ссылка на исходник, если медиа сцены вручную выбрано в стоках. */
  stockSource?: StockAssetSource;
  /** Дополнительные релевантные материалы сцены; старые проекты могут не иметь этого поля. */
  stockAlternates?: StockMediaVariant[];
  /** Необязательный новый слой монтажа; отсутствие означает старый режим один кадр на сцену. */
  visualBeats?: VisualBeat[];
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
  /** Модель, выбранная в AI-чате для анализа и последующей сборки сценария. */
  modelId?: string;
  youtubeContext?: YouTubeAnalysisContext;
  youtubeChannelContext?: YouTubeChannelContext;
  suggestedTopics?: SuggestedTopic[];
  /**
   * Результат строгой проверки уже собранного сценария. Маркер позволяет не
   * отправлять незавершённую историю в производство и не делать платный
   * AI-запрос при каждом нажатии «Собрать ролик».
   */
  scenarioQuality?: ScenarioQualityAudit;
  scenarioRepair?: ScenarioRepairCheckpoint;
  /** Narration-first writer checkpoint; never a production-ready audit by itself. */
  narrationDraft?: NarrationDraftCheckpoint;
  /** Каким planner был фактически размечен текущий набор visualBeats. */
  montagePlan?: MontagePlanSummary;
}

/** Persisted separately from active scenes until a coherent repair is complete. */
export interface ScenarioRepairPlan {
  title: string;
  promise: string;
  tone: string;
  visualBible: string;
  continuityRules: string[];
  requiredBeats: string[];
  endingResolution: string;
  sections: Array<{ title: string; goal: string; keyPoints: string[]; transition: string }>;
}

export interface NarrationDraftCheckpoint {
  version: 1;
  contextFingerprint: string;
  plan: ScenarioRepairPlan & { writingBrief: string; narrator: string; sectionWeights: number[]; genre?: string; factLedger?: string[] };
  sections: string[];
  editorial?: { accepted: boolean; notes: string[] };
  /** Last completed editor response, retained even if its patches fail validation. No transport data. */
  editorialResponse?: string;
  /** At most one automatic follow-up on a completed editorial response, never on a network error. */
  editorialCorrectionAttempted?: boolean;
  /** Accepted visual prefix, tied to this exact edited narration. */
  visuals: Scene[];
}

export interface ScenarioRepairAudit {
  complete: boolean;
  endingResolved: boolean;
  missingRequiredBeats: string[];
  unresolvedSetups: string[];
  rewriteFromScene: number;
  reason: string;
}

export interface ScenarioRepairCheckpoint {
  version: 1;
  sourceFingerprint: string;
  contextFingerprint: string;
  sourceSceneCount: number;
  fromIndex: number;
  plan: ScenarioRepairPlan;
  audit: ScenarioRepairAudit;
  /** One immutable continuity contract for every batch: chronology, inventory, ending. */
  continuityContract: string;
  /** Consecutive repaired tail prefix; never a mix of new and unrepaired scenes. */
  completedScenes: Scene[];
  updatedAt: string;
}

export interface ScenarioQualityAudit {
  version: 1;
  checkedAt: string;
  targetSeconds: number;
  totalDurationSeconds: number;
  wordCount: number;
  sceneCount: number;
  fingerprint: string;
  complete: boolean;
  endingResolved: boolean;
  repaired: boolean;
  requiredBeats: string[];
  /** Аудит содержания перенесён без нового AI-запроса: изменились только
   * границы кадров, конкатенация narration осталась побайтово прежней. */
  timingAdjustment?: {
    method: "measured-audio-split" | "calibrated-text-split";
    previousFingerprint: string;
    appliedAt: string;
  };
}

export interface AnalyzeReferenceInput {
  url: string;
  instructions?: string;
  language?: string;
  channelProfileId?: string;
  /** Модель чата, выбранная для текущей темы. Пусто — модель из настроек. */
  modelId?: string;
}

export interface CreateReferenceProjectInput {
  analysis: ReferenceAnalysis;
  aspectRatio: AspectRatio;
  mode: ProjectMode;
  channelProfileId?: string;
  videoBrief?: VideoBrief;
}

export interface AnyModelSettings {
  configured: boolean;
  proxyConfigured: boolean;
  proxyDisplayName?: string;
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
  proxyConfigured?: boolean;
  proxyDisplayName?: string;
  downloadRoute?: "system" | "proxy" | "public-dns";
  cookiesFileConfigured: boolean;
  cookiesFileName?: string;
  workDirConfigured: boolean;
  workDirPath?: string;
}

export interface SaveYouTubeSettingsInput {
  apiKey?: string;
  proxyUrl?: string;
  clearProxy?: boolean;
  downloadRoute?: "system" | "proxy" | "public-dns";
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
  transcriptSource: "captions" | "yt-dlp-captions" | "gemini-audio" | "pasted" | "none";
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

export interface SaveAnyModelSettingsInput extends Omit<AnyModelSettings, "configured" | "proxyConfigured" | "proxyDisplayName"> {
  apiKey?: string;
  proxyUrl?: string;
  clearProxy?: boolean;
}

/** Google AI Studio — движок видео Veo (image-to-video). */
export interface GoogleSettings {
  configured: boolean;
  veoModel: string;
  /** SOCKS5-прокси для обхода региональной блокировки Google: socks5://user:pass@host:port. */
  proxyUrl: string;
}

export interface SaveGoogleSettingsInput {
  apiKey?: string;
  veoModel?: string;
  proxyUrl?: string;
}

export type FlowAccountStatus =
  | "connecting"
  | "ready"
  | "expired"
  | "needs_login"
  | "needs_user_action"
  | "cooldown"
  | "disabled"
  | "error";

/** Maximum number of independently isolated Google Flow browser profiles. */
export const MAX_FLOW_ACCOUNTS = 5;

export interface FlowAccountPublic {
  id: string;
  email?: string;
  label?: string;
  enabled: boolean;
  videoEnabled: boolean;
  status: FlowAccountStatus;
  tier?: string;
  credits?: number;
  proxyDisplayName?: string;
  sessionExpiresAt?: string;
  tokenExpiresAt?: string;
  cooldownUntil?: string;
  lastRefreshAt?: string;
  lastError?: string;
}

export interface FlowLoginInput {
  accountId?: string;
  label?: string;
  proxyUrl?: string;
}

export interface FlowCookieImportInput {
  accountId?: string;
  label?: string;
  cookies: string;
  proxyUrl?: string;
}

export interface FlowRemoteVideoJob {
  provider: "flow";
  /** Older saved video jobs have no discriminator. */
  kind?: "video";
  accountId: string;
  projectId: string;
  mediaName: string;
  workflowId?: string;
  modelKey: string;
  submittedAt: string;
}

export interface FlowRemoteImageJob {
  provider: "flow";
  kind: "image";
  accountId: string;
  projectId: string;
  mediaName: string;
  workflowId?: string;
  modelKey: string;
  submittedAt: string;
}

export interface FlowAccountUpdateInput {
  label?: string;
  enabled?: boolean;
  videoEnabled?: boolean;
  proxyUrl?: string;
  clearProxy?: boolean;
}

export interface FlowLoginProgress {
  accountId: string;
  stage: "opening" | "waiting_login" | "validating" | "ready" | "cancelled" | "error";
  message: string;
}

/** Voicer API — озвучка на ElevenLabs (X-API-Key, шаблоны из Telegram-бота). */
export interface VoicerSettings {
  configured: boolean;
  proxyConfigured: boolean;
  proxyDisplayName?: string;
  baseUrl: string;
}

export interface SaveVoicerSettingsInput {
  baseUrl: string;
  apiKey?: string;
  proxyUrl?: string;
  clearProxy?: boolean;
}

export interface VoicerTemplate {
  uuid: string;
  name: string;
  broken?: boolean;
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
  modelId?: string;
  channelProfileId?: string;
}

export interface CharacterReference {
  name: string;
  aliases?: string[];
  prompt: string;
  /** Пожелание пользователя, по которому был собран текущий образ. */
  characterPrompt?: string;
  /** Снимок единого стиля кадров на момент создания референса. */
  stylePrompt?: string;
  imagePath: string;
  updatedAt: string;
}

/** Версия бренд-персонажа, физически сохранённая в библиотеке одного канала. */
export interface ChannelCharacterReference extends CharacterReference {
  versionId: string;
  channelProfileId: string;
  sourceProjectId?: string;
  sourceCharacterId?: string;
  createdAt: string;
}

export interface ChannelCharacterGenerationInput {
  sourceVersionId: string;
  name: string;
  prompt: string;
}

export interface ChannelCharacterGeneration extends ChannelCharacterGenerationInput {
  versionId: string;
  stylePrompt: string;
  remoteJob?: FlowRemoteImageJob;
  error?: string;
}

/** Смена героя заменяет прежние портреты, сохраняя независимые style/location
 * references. Две версии лица нельзя одновременно отправлять генератору. */
export function selectCharacterReference(project: Project, character: CharacterReference, knownCharacterPaths: string[] = []): Pick<Project, "characterReference" | "settings"> {
  if (project.status === "generating" || project.status === "paused") throw new Error("Сначала остановите или завершите генерацию — менять героя во время производства нельзя");
  if ("channelProfileId" in character && character.channelProfileId !== project.channelProfileId) {
    throw new Error("Персонаж принадлежит другому каналу");
  }
  const key = (value: string) => value.replace(/\\/g, "/").toLowerCase();
  const replaced = new Set([project.characterReference?.imagePath, character.imagePath, ...knownCharacterPaths].filter((path): path is string => Boolean(path)).map(key));
  const references = [character.imagePath, ...project.settings.image.references.filter(path => path.trim() && !replaced.has(key(path)))].slice(0, 3);
  return {characterReference: character, settings: {...project.settings, image: {...project.settings.image, references}}};
}

/** Новая версия показывается в модальном preview, не меняя активного героя канала. */
export function prepareCharacterReferencePreview(project: Project, character: CharacterReference, style: string, provider: Project["settings"]["image"]["provider"]): Pick<Project, "characterReference" | "settings"> {
  if (project.status === "generating" || project.status === "paused") throw new Error("Сначала остановите или завершите генерацию — менять героя во время производства нельзя");
  const selected = project.channelProfileId ? {characterReference:project.characterReference, settings:project.settings} : selectCharacterReference(project, character);
  return {...selected, settings:{...selected.settings, image:{...selected.settings.image, style, provider}}};
}

export interface CharacterReferenceRequest {
  /** Единый стиль рисовки текущего ролика. Сохраняется до генерации портрета. */
  stylePrompt?: string;
  /** Необязательное ручное описание внешности героя. */
  characterPrompt?: string;
}

/** Project-local cast. Channel branding remains separate and backwards compatible. */
export interface StoryCharacter {
  id: string;
  name: string;
  aliases: string[];
  prompt: string;
  stylePrompt: string;
  imagePath?: string;
  status: "draft" | "generating" | "ready" | "failed";
  error?: string;
  candidate?: { imagePath: string; prompt: string; stylePrompt: string; createdAt: string };
  /** Persist a known paid image job so a download failure never submits it again. */
  pendingGeneration?: { prompt: string; stylePrompt: string; remoteJob?: FlowRemoteImageJob };
}

export interface CharacterReferenceResult {
  project: Project;
  character: CharacterReference | ChannelCharacterReference;
}

export type TrashItemKind = "channel" | "project";

/** Безопасное описание записи внутренней корзины; файловые пути и содержимое наружу не передаются. */
export interface TrashItemSummary {
  trashId: string;
  kind: TrashItemKind;
  originalId: string;
  title: string;
  deletedAt: string;
  /** Для канала — число роликов, которые сохраняются и снова привяжутся после восстановления. */
  relatedProjectCount?: number;
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
  channelProfileId?: string;
  /** Сохранённый режим материалов канала. Нужен, чтобы AI и Mix не терялись после создания ролика. */
  mediaMode?: ChannelMediaMode;
  /** Motion-шаблон, выбранный в канале на момент создания ролика. */
  motionTemplate?: string;
  videoBrief?: VideoBrief;
  chatTopicId?: string;
  referenceAnalysis?: ReferenceAnalysis;
  /** Последний подтверждённый образ главного героя. Хранится вместе с проектом. */
  characterReference?: CharacterReference;
  storyCharacters?: StoryCharacter[];
  storyCharacterPlan?: { fingerprint: string; status: "planning" | "ready" | "failed"; error?: string };
  storyCharacterSheet?: { imagePath: string; identityKey: string };
  outputPath?: string;
  /** Диагностика конкретного Final.mp4; отсутствие означает старый или ещё не собранный проект. */
  lastRender?: ProjectRenderReport;
  /** Диагностика сохранённых visualBeats, не меняющая narration. */
  montagePlan?: MontagePlanSummary;
  /** Durable intent/progress of the one-button Stock run; queue owns paid jobs. */
  stockProduction?: StockProductionRun;
}

export interface StockProductionRun {
  phase: "script" | "materials" | "export";
  status: "running" | "interrupted" | "failed" | "stopped" | "complete";
  message: string;
  updatedAt: string;
  assemblyTaskId?: string;
}

export type ScenarioQualityIssue = "missing" | "stale" | "incomplete";

/**
 * Stable fingerprint of the narration and timing that will actually reach the
 * renderer. An audit stops being current as soon as an included scene changes.
 */
export function scenarioQualityFingerprint(scenes: Scene[]): string {
  const value = scenes
    .filter((scene) => scene.includeInAssembly !== false)
    .map((scene) => {
      const narration = scene.narration
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
      return `${scene.order}:${Number(scene.durationSeconds) || 0}:${narration}`;
    })
    .join("\n");
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * AnyModel output may enter production only after its final audit. Ready-script
 * mode keeps the user's text immutable, so a current marker is sufficient;
 * generated scripts additionally require a confirmed complete ending.
 */
export function projectScenarioQualityIssue(project: Pick<Project, "scenes" | "referenceAnalysis" | "videoBrief">): ScenarioQualityIssue | undefined {
  const analysis = project.referenceAnalysis;
  if (!analysis?.provider.trim().toLowerCase().startsWith("anymodel:")) return undefined;
  const audit = analysis.scenarioQuality;
  if (!audit) return "missing";
  if (audit.fingerprint !== scenarioQualityFingerprint(project.scenes)) return "stale";
  const readyScriptMode = project.videoBrief?.creationMode === "script"
    && Boolean(project.videoBrief.readyScript?.trim());
  if (!readyScriptMode && (!audit.complete || !audit.endingResolved)) return "incomplete";
  return undefined;
}

export interface VoiceCalibrationResult {
  project: Project;
  calibration: VoiceCalibration;
  /** Та же тестовая озвучка, которую пользователь может сразу прослушать. */
  sampleAudioBase64: string;
}

export type ProviderVideoJob =
  | { provider: "anymodel"; jobId: string; connectionId: string }
  | { provider: "veo"; operationName: string };

export interface QueueTask {
  id: string;
  runId: string;
  /** Scene-only work may finish without assembling the entire project. Persisted across restarts. */
  scope?: "project" | "scenes";
  /** Полная генерация может дополнить кадры по готовому TTS. Обычная
   * пересборка/частичная перегенерация не создаёт неожиданные платные задачи. */
  allowTimingExpansion?: boolean;
  /** Prepare timing/montage for the live editor; never encode or publish Final. */
  prepareOnly?: boolean;
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
  /** Повтор может создать платный дубликат уже отправленного удалённого задания. */
  retryBlockedReason?: string;
  resultPath?: string;
  /** Persisted degraded result, never presented as successful AI animation. */
  resultFallback?: "static-image";
  /** Текущий подробный этап долгой операции, например ожидание Flow-видео. */
  stage?: string;
  /** Уже отправленное удалённое Flow-задание. Позволяет продолжить polling/скачивание без повторной генерации. */
  remoteJob?: FlowRemoteVideoJob | FlowRemoteImageJob;
  /** Written before a paid POST; without a receipt its result is unknown after a crash. */
  pendingSubmission?: { provider: "flow" | "lumean" | "anymodel" | "veo" | "legacy-media"; kind: "image" | "video" | "speech"; accountId?: string; startedAt: string };
  /** Existing paid speech order; retry polls/downloads this ID instead of buying another. */
  lumeanOrder?: { orderId: string; inputFingerprint: string };
  /** Existing video receipt for the legacy AnyModel and Google AI Studio routes. */
  providerVideoJob?: ProviderVideoJob;
  /** One continuous Stock narration order shared by these exact, ordered scene IDs. */
  narrationSceneIds?: string[];
  /** Version 1 tracked Flow/Lumean only. Version 2 also tracks AnyModel and Google video. */
  submissionTrackingVersion?: 1 | 2;
}

export interface CreateProjectInput {
  title: string;
  topic: string;
  aspectRatio: AspectRatio;
  language: string;
  mode: ProjectMode;
  channelProfileId?: string;
  mediaMode?: ChannelMediaMode;
  motionTemplate?: string;
  videoBrief?: VideoBrief;
}

export interface UpdateProjectInput {
  /** Revision of the editor's source snapshot; checked atomically before saving. */
  expectedUpdatedAt?: string;
  stockProduction?: StockProductionRun;
  storyCharacters?: StoryCharacter[];
  storyCharacterPlan?: Project["storyCharacterPlan"];
  storyCharacterSheet?: Project["storyCharacterSheet"];
  title?: string;
  topic?: string;
  aspectRatio?: AspectRatio;
  language?: string;
  mode?: ProjectMode;
  status?: ProjectStatus;
  scenes?: Scene[];
  settings?: ProjectSettings;
  channelProfileId?: string;
  mediaMode?: ChannelMediaMode;
  motionTemplate?: string;
  videoBrief?: VideoBrief;
  chatTopicId?: string;
  characterReference?: CharacterReference;
  outputPath?: string;
  lastRender?: ProjectRenderReport;
  montagePlan?: MontagePlanSummary;
}

export interface QueuePolicy {
  concurrency: number;
  maxAttempts: number;
  retryDelaysMs: number[];
}

export * from "./channel-analytics.js";
import type { SaveTrackedChannelInput, TrackedYouTubeChannel } from "./channel-analytics.js";

export interface DocumentaryRecoveryItem {id:string;revision:string;purpose:string;state:string;characters:number;createdAt:string}
export interface AppUpdateState {
  status: "unsupported" | "idle" | "checking" | "up-to-date" | "downloading" | "downloaded" | "installing" | "error";
  currentVersion: string;
  availableVersion?: string;
  percent?: number;
  checkedAt?: string;
  message: string;
}

export interface DesktopApi extends EffectLibraryApi, DocumentaryApi {
  getAppUpdateState(): Promise<AppUpdateState>;
  checkAppUpdates(): Promise<AppUpdateState>;
  installAppUpdate(): Promise<AppUpdateState>;
  onAppUpdateState(listener: (state: AppUpdateState) => void): () => void;
  listTrackedChannels(): Promise<TrackedYouTubeChannel[]>;
  saveTrackedChannel(input: SaveTrackedChannelInput): Promise<TrackedYouTubeChannel[]>;
  removeTrackedChannel(id: string): Promise<TrackedYouTubeChannel[]>;
  refreshTrackedChannels(input?: { id?: string; automatic?: boolean }): Promise<TrackedYouTubeChannel[]>;
  listChannelProfiles(): Promise<ChannelProfile[]>;
  createChannelProfile(input: SaveChannelProfileInput): Promise<ChannelProfile>;
  updateChannelProfile(id: string, input: SaveChannelProfileInput): Promise<ChannelProfile>;
  deleteChannelProfile(id: string): Promise<TrashItemSummary>;
  /** Copy the accepted project portrait into this project's channel, without changing the project. */
  saveStoryCharacterToChannel(projectId: string, characterId: string): Promise<ChannelProfile>;
  /** Generate a new, unconfirmed channel version; existing videos keep their snapshots. */
  generateChannelCharacter(channelId: string, input: ChannelCharacterGenerationInput): Promise<ChannelProfile>;
  selectChannelCharacterVersion(channelId: string, versionId: string): Promise<ChannelProfile>;
  deleteChannelCharacterVersion(channelId: string, versionId: string): Promise<ChannelProfile>;
  restoreChannelCharacterVersion(channelId: string, versionId: string): Promise<ChannelProfile>;
  /** Подтверждает уже сгенерированную версию и делает её главным героем канала. */
  confirmChannelCharacterReference(projectId: string, versionId: string): Promise<CharacterReferenceResult>;
  /** Подставляет подтверждённого героя канала в проект без новой платной генерации. */
  useChannelCharacterReference(projectId: string, versionId?: string): Promise<CharacterReferenceResult>;
  listTrash(): Promise<TrashItemSummary[]>;
  restoreTrashItem(trashId: string): Promise<void>;
  purgeTrashItem(trashId: string): Promise<void>;
  listProjects(): Promise<Project[]>;
  /** Poll only the small revision when the on-disk project registry is unchanged. */
  getProjectChanges(revision?: string): Promise<{ revision: string; projects?: Project[]; projectIds?: string[] }>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(input: CreateProjectInput): Promise<Project>;
  /** Останавливает текущий AI-запрос режиссёра/чата для этого окна. */
  cancelDirectorOperation(): Promise<boolean>;
  onDirectorProgress(listener: (stage: string, context?: { projectId?: string; topicId?: string }) => void): () => void;
  getAnyModelSettings(): Promise<AnyModelSettings>;
  saveAnyModelSettings(input: SaveAnyModelSettingsInput): Promise<AnyModelSettings>;
  clearAnyModelKey(): Promise<AnyModelSettings>;
  testAnyModelConnection(): Promise<{ ok: boolean; message: string }>;
  /** Короткий аудио-пример голоса (base64 MP3); кэшируется, так что повторное прослушивание бесплатно. */
  ttsSample(voice: string, language: string): Promise<string>;
  getVoicerSettings(): Promise<VoicerSettings>;
  saveVoicerSettings(input: SaveVoicerSettingsInput): Promise<VoicerSettings>;
  clearVoicerKey(): Promise<VoicerSettings>;
  testVoicerConnection(): Promise<{ ok: boolean; message: string }>;
  listVoicerTemplates(): Promise<VoicerTemplate[]>;
  /** Пример голоса шаблона Voicer (base64 MP3); кэшируется по шаблону. */
  voicerSample(templateUuid: string | undefined, language: string): Promise<string>;
  /** Калибрует выбранный голос до создания проекта; результат затем сохраняется в настройках проекта. */
  calibrateVoice(input: VoiceCalibrationRequest): Promise<VoiceCalibrationSampleResult>;
  /** Озвучивает фиксированную фразу, измеряет скорость выбранного голоса и сохраняет её в project.json. */
  calibrateProjectVoice(projectId: string): Promise<VoiceCalibrationResult>;
  getGoogleSettings(): Promise<GoogleSettings>;
  saveGoogleSettings(input: SaveGoogleSettingsInput): Promise<GoogleSettings>;
  clearGoogleKey(): Promise<GoogleSettings>;
  testGoogleConnection(): Promise<{ ok: boolean; message: string }>;
  getStockSettings(): Promise<StockSettings>;
  saveStockSettings(input: SaveStockSettingsInput): Promise<StockSettings>;
  clearStockKey(provider: StockProvider): Promise<StockSettings>;
  testStockConnection(provider: StockProvider): Promise<StockConnectionTestResult>;
  searchStock(input: StockSearchInput): Promise<StockSearchResult>;
  /** Скачивает только выбранный пользователем сток и назначает его одной сцене. */
  applyStockAsset(projectId: string, sceneId: string, asset: StockAsset): Promise<Project>;
  /** Автоматически подбирает и локально сохраняет stock для всех незаполненных включённых сцен. */
  autoSelectStock(projectId: string, options?: AutoStockSelectionOptions): Promise<AutoStockSelectionResult>;
  /** Replans existing verified media; does not search, buy, or render anything. */
  refreshDocumentaryMontage(projectId: string): Promise<Project>;
  reviseDocumentaryArtwork(projectId: string, input: {feedback: string}): Promise<Project>;
  onAutoStockProgress(listener: (progress: AutoStockProgress) => void): () => void;
  listFlowAccounts(): Promise<FlowAccountPublic[]>;
  loginFlowAccount(input?: FlowLoginInput): Promise<FlowAccountPublic>;
  importFlowCookies(input: FlowCookieImportInput): Promise<FlowAccountPublic>;
  refreshFlowAccount(accountId: string): Promise<FlowAccountPublic>;
  refreshAllFlowAccounts(): Promise<FlowAccountPublic[]>;
  updateFlowAccount(accountId: string, input: FlowAccountUpdateInput): Promise<FlowAccountPublic>;
  removeFlowAccount(accountId: string): Promise<void>;
  openFlowAccount(accountId: string): Promise<void>;
  testFlowAccount(accountId?: string): Promise<{ ok: boolean; message: string }>;
  onFlowAccountsChanged(listener: (accounts: FlowAccountPublic[]) => void): () => void;
  onFlowLoginProgress(listener: (progress: FlowLoginProgress) => void): () => void;
  /** Создаёт портрет главного героя по сценарию и добавляет его в референсы проекта. */
  createCharacterReference(projectId: string, input?: CharacterReferenceRequest): Promise<CharacterReferenceResult>;
  prepareStoryCharacters(projectId: string): Promise<Project>;
  regenerateStoryCharacter(projectId: string, characterId: string, prompt: string): Promise<Project>;
  confirmStoryCharacter(projectId: string, characterId: string): Promise<Project>;
  /** Пересобирает только Final.mp4 из готовых материалов (без перегенерации картинок и озвучки). */
  assembleProject(projectId: string): Promise<QueueTask[]>;
  /** Переписывает текст и промпт одной сцены по пожеланию пользователя. */
  /** Пересоздаёт только VisualBeat-план, не меняя narration и TTS. */
  replanMontage(projectId: string): Promise<Project>;
  /** URL для показа локального медиафайла проекта в интерфейсе (gw-media://). */
  mediaUrl(path: string): string;
  getYouTubeSettings(): Promise<YouTubeSettings>;
  saveYouTubeSettings(input: SaveYouTubeSettingsInput): Promise<YouTubeSettings>;
  clearYouTubeKey(): Promise<YouTubeSettings>;
  testYouTubeConnection(): Promise<{ ok: boolean; message: string }>;
  prepareProjectScript(projectId: string, mode?: 'cached-query-plans'): Promise<Project>;
  updateProject(id: string, input: UpdateProjectInput): Promise<Project>;
  duplicateProject(id: string): Promise<Project>;
  deleteProject(id: string): Promise<TrashItemSummary>;
  getDocumentaryRecovery(projectId:string):Promise<DocumentaryRecoveryItem[]>;
  choosePixabayMusic(query:string):Promise<{path:string;name:string;sourcePage:string}|undefined>;
  authorizeDocumentaryRetry(projectId:string,requests:DocumentaryRecoveryItem[]):Promise<number>;
  probeDocumentaryConnection():Promise<boolean>;
  getQueue(): Promise<QueueTask[]>;
  startGeneration(projectId: string, target?: "all" | "narration"): Promise<QueueTask[]>;
  pauseGeneration(projectId: string): Promise<QueueTask[]>;
  resumeGeneration(projectId: string): Promise<QueueTask[]>;
  stopGeneration(projectId: string): Promise<QueueTask[]>;
  retryTask(taskId: string): Promise<QueueTask>;
  clearFinishedTasks(): Promise<QueueTask[]>;
  /** Останавливает текущую работу и очищает только записи очереди, не затрагивая проекты и их файлы. */
  clearQueue(): Promise<QueueTask[]>;
  regenerateScene(projectId: string, sceneId: string | string[], target?: "image" | "video" | "audio" | "all"): Promise<QueueTask[]>;
  openProjectFolder(projectId: string): Promise<void>;
  openSceneFolder(projectId: string, sceneId: string): Promise<void>;
  writeLog(level: LogLevel, message: string, details?: Record<string, unknown>): Promise<void>;
  readLogs(limit?: number): Promise<ConsoleLogEntry[]>;
  onLogEntry(listener: (entry: ConsoleLogEntry) => void): () => void;
  openLogFile(): Promise<void>;
  pickFiles(kind: "image" | "audio" | "video" | "json" | "cookies", multiple?: boolean): Promise<string[]>;
  importMusic(path:string):Promise<string>;
  pickCompetitorTranscripts(): Promise<CompetitorTranscript[]>;
  openExternal(url: string): Promise<void>;
  pickDirectory(): Promise<string | undefined>;
  getWorkspaceStorage(): Promise<WorkspaceStorageInfo>;
  getWorkspaceUsage(path?: string, refresh?: boolean): Promise<WorkspaceUsage>;
  openWorkspaceFolder(path?: string): Promise<void>;
  scheduleWorkspaceMove(path?: string): Promise<WorkspaceStorageInfo>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  onWindowCloseRequested?(listener: () => Promise<boolean>): () => void;
  getAppInfo(): Promise<{
    version: string;
    buildId: string;
    buildCreatedAt: string;
    mainSessionId: string;
    mainProcessId: number;
    dataPath: string;
    workspacePath: string;
    logPath: string;
    realtimeUrl?: string;
    mockMode: boolean;
    ffmpegAvailable: boolean;
    queuePolicy: QueuePolicy;
  }>;
}

export interface WorkspaceStorageInfo { path: string; freeBytes: number; pendingPath?: string; retainedPath?: string; error?: string }
export interface WorkspaceUsageEntry { path: string; name: string; label?: string; directory: boolean; bytes: number; logicalBytes: number; files: number }
export interface WorkspaceUsage { path: string; bytes: number; logicalBytes: number; files: number; entries: WorkspaceUsageEntry[]; projects: WorkspaceUsageEntry[]; scannedAt: string }

export function createDefaultProjectSettings(): ProjectSettings {
  return {
    durationMinutes: 1,
    frameChange: "scenario",
    stockVideoPercent: 60,
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
      animationPercent: 15,
      selectionMode: "auto",
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
      kenBurnsDirection: "smart",
      fadeTransitions: true,
      transitionType: "mix",
      transitionDurationSeconds: 0.5,
      audioNormalize: false,
      dualTrack: false,
      removeSilence: false,
      quality: "standard",
      montage: {
        enabled: true,
        planner: "ai-bounded",
        density: "balanced",
        graphicBeatPercent: 28,
        hardCutPercent: 78
      }
    }
  };
}

/** Итоговый переход стыка: ручная сцена → автомонтаж → настройка слайд-шоу. */
export function resolveProjectSceneTransition(project: Project, scene: Scene): "none" | "fade" | "mix" {
  if (project.mediaMode === "stock" && project.settings.assembly.documentary?.version === 2) return documentarySceneTransition(scene, project.settings.assembly).kind;
  if (scene.transitionDurationSeconds === 0) return "none";
  if (scene.transition) return scene.transition;
  const assembly = project.settings.assembly;
  if (!assembly.fadeTransitions) return "none";
  if (assembly.montage?.enabled !== false && scene.autoTransition) return scene.autoTransition;
  return assembly.transitionType ?? "mix";
}

/** Длительность ручного/автоматического стыка с безопасными пределами FFmpeg и preview. */
export function resolveProjectSceneTransitionDuration(project: Project, scene: Scene): number {
  if (project.mediaMode === "stock" && project.settings.assembly.documentary?.version === 2) return documentarySceneTransition(scene, project.settings.assembly).durationSeconds;
  const automaticDuration = project.settings.assembly.montage?.enabled !== false
    && scene.transition === undefined
    && Number.isFinite(scene.autoTransitionDurationSeconds)
    ? scene.autoTransitionDurationSeconds
    : undefined;
  const requested = Number.isFinite(scene.transitionDurationSeconds)
    ? scene.transitionDurationSeconds
    : Number.isFinite(automaticDuration)
      ? automaticDuration
      : Number.isFinite(project.settings.assembly.transitionDurationSeconds)
        ? project.settings.assembly.transitionDurationSeconds
        : Number.isFinite(scene.autoTransitionDurationSeconds)
          ? scene.autoTransitionDurationSeconds
          : 0.5;
  return Math.min(5, Math.max(0.05, requested as number));
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

/** Разбирает вставленную расшифровку с таймкодами вида [0:00] или [01:23:45]. */
export function parsePastedTranscript(text: string): TranscriptSegment[] {
  const value = text.trim();
  if (!value) return [];
  const matches = [...value.matchAll(/\[(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\]/g)];
  if (matches.length < 3) {
    if (value.length < 300 || !/(транскрипц|расшифровк|озвучк|текст ролика)/i.test(value)) return [];
    const clean = value.replace(/^(?:вот\s+)?(?:полная\s+)?(?:транскрипция|расшифровка|озвучка)(?:\s+ролика)?\s*[:—-]?\s*/i, "").trim();
    return clean ? [{ startSeconds: 0, durationSeconds: Math.max(5, Math.round(clean.split(/\s+/).length / 2)), text: clean }] : [];
  }
  const segments: TranscriptSegment[] = [];
  for (const [index, match] of matches.entries()) {
    const hours = Number(match[1] ?? 0);
    const minutes = Number(match[2] ?? 0);
    const seconds = Number(match[3] ?? 0);
    const startSeconds = hours * 3600 + minutes * 60 + seconds;
    const contentStart = (match.index ?? 0) + match[0].length;
    const contentEnd = index + 1 < matches.length ? (matches[index + 1]?.index ?? value.length) : value.length;
    const segmentText = value.slice(contentStart, contentEnd).replace(/\s+/g, " ").trim();
    if (segmentText) segments.push({ startSeconds, durationSeconds: 0, text: segmentText });
  }
  for (let index = 0; index < segments.length; index += 1) {
    const next = segments[index + 1];
    const current = segments[index]!;
    current.durationSeconds = Math.max(1, next ? next.startSeconds - current.startSeconds : 5);
  }
  return segments;
}

/** Длительность принимаем только из короткой явной команды, а не из текста транскрипции. */
export function parseExplicitDurationSeconds(text: string): number | null {
  const value = text.trim();
  if (value.length > 240 || (value.match(/\[?\d{1,3}:\d{2}\]?/g) ?? []).length > 2) return null;
  if (!/(минут|мин\b|секунд|сек\b|\bmin\b|\bsec\b|\d{1,3}:\d{2}|\bshorts?\b|коротк)/i.test(value)) return null;
  // В живом чате «на минуту» часто пишут без цифры, а «на минуты» — как опечатку.
  if (/(?:^|\s)на\s+(?:одн(?:у|ой)\s+)?минут(?:у|ы)(?![а-яё])/i.test(value) || /минутн[а-яё]*\s+(?:ролик|сценар)/i.test(value)) return 60;
  return parseDurationSeconds(value);
}

/** Пользователь просит написать новый сценарий, а не просто обсудить текущий разбор. */
export function isScenarioGenerationRequest(text: string): boolean {
  if (isDirectorChatOnlyRequest(text)) return false;
  return /(напиш|написа|созда|собер|собр|состав|сдела|подготов|сгенерир|сочин)[а-яё]*/i.test(text)
    && /(сценар|ролик|видео|short)/i.test(text);
}

/**
 * Явные формулировки ответа в чате. Они имеют приоритет над совпадениями
 * «написать + ролик», чтобы вопрос о ролике не запускал дорогую генерацию сцен.
 */
export function isDirectorChatOnlyRequest(text: string): boolean {
  return /(сюда\s+(?:в\s+)?чат|(?:в|для)\s+чат(?:е|а)?|как\s+(?:устроен|построен|сделан)|просто\s+(?:разбор|ответ|объясн)|(?:сделай|дай|напиш[а-яё]*|покажи)\s+(?:мне\s+)?(?:подробн[а-яё]*\s+)?(?:разбор|анализ)|(?:объясни|расскажи|ответь)(?![а-яё])|^(?:а\s+)?(?:как|почему|зачем|какой|какая|какие)\s+|без\s+(?:создания|генерации|сценария|проекта)|не\s+(?:создавай|генерируй|запускай))/i.test(text);
}

/** Короткий ответ на ранее заданный вопрос о длительности: «5 минут», «на минуту». */
export function isBareDurationReply(text: string): boolean {
  const value = text.trim();
  if (value.length > 80) return false;
  return /^(?:на\s+)?(?:\d+(?:[.,]\d+)?\s*(?:минут[а-яё]*|мин[а-яё]*|секунд[а-яё]*|сек[а-яё]*|min\w*|sec\w*)|(?:одну?\s+)?минут(?:у|ы)|\d{1,3}:[0-5]?\d|shorts?)[.!?]?$/i.test(value);
}

/** Пользователь просит именно разобрать сохранённый текст/транскрипцию ролика. */
export function isTranscriptAnalysisRequest(text: string): boolean {
  return /(разобрать|разбери(?:те)?|проанализ[а-яё]*|оцени[а-яё]*|разбор|что\s+(?:можно\s+)?улучш|слаб[а-яё]*\s+мест|ошиб[а-яё]*)/i.test(text)
    && /(транскрип|сценар|текст|ролик|видео|его|её|это)/i.test(text);
}

/**
 * Делит целевую длину ролика между смысловыми сценами примерно по 8 секунд.
 * Реплика успевает прозвучать естественно, а длинный ролик не раздувается больше
 * чем до 200 дорогих генераций. Сумма всегда точно равна targetSeconds.
 */
export function allocateSceneDurations(targetSeconds: number, maxScenes = 200): number[] {
  const total = Math.max(30, Math.round(Number.isFinite(targetSeconds) ? targetSeconds : 30));
  const safeMax = Math.max(4, Math.round(maxScenes));
  const count = Math.min(safeMax, Math.max(4, Math.round(total / 8)));
  const base = Math.floor(total / count);
  const remainder = total % count;
  // Раскладываем лишние секунды по ролику, а не складываем их только в начале.
  return Array.from({ length: count }, (_, index) => {
    const before = Math.floor(index * remainder / count);
    const after = Math.floor((index + 1) * remainder / count);
    return base + (after > before ? 1 : 0);
  });
}

/** Preferred cadence for generated-image stories. Stock keeps its legacy allocator. */
export const AI_STORY_TARGET_SCENE_SECONDS = 5;
export const AI_STORY_ORDINARY_MAX_SCENE_SECONDS = 8;
export const AI_STORY_HARD_MAX_SCENE_SECONDS = 9;

/**
 * Splits an AI Story timeline into short visual frames. The default upper bound
 * covers the existing 120 minute project limit while keeping every frame at or
 * below the nine-second product invariant.
 */
export function allocateAiStorySceneDurations(targetSeconds: number, maxScenes = 1_600): number[] {
  const total = Math.max(30, Math.round(Number.isFinite(targetSeconds) ? targetSeconds : 30));
  const safeMax = Math.max(4, Math.round(Number.isFinite(maxScenes) ? maxScenes : 1_600));
  const minimumCount = Math.max(4, Math.ceil(total / AI_STORY_HARD_MAX_SCENE_SECONDS));
  if (minimumCount > safeMax) {
    throw new Error(
      `Для ${total} с нужно не меньше ${minimumCount} AI-кадров, чтобы каждый длился не более ${AI_STORY_HARD_MAX_SCENE_SECONDS} с`
    );
  }
  const preferredCount = Math.max(minimumCount, Math.round(total / AI_STORY_TARGET_SCENE_SECONDS));
  const count = Math.min(safeMax, preferredCount);
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from({ length: count }, (_, index) => {
    const before = Math.floor(index * remainder / count);
    const after = Math.floor((index + 1) * remainder / count);
    return base + (after > before ? 1 : 0);
  });
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

const VOICE_CALIBRATION_SAMPLE_TEXTS: Readonly<Record<string, string>> = {
  ru: "Этот голос будет рассказывать историю спокойно, ясно и с естественными паузами.",
  en: "This voice will tell the story clearly, naturally, and with comfortable pauses.",
  es: "Esta voz contará la historia con claridad, naturalidad y pausas cómodas.",
  de: "Diese Stimme erzählt die Geschichte klar, natürlich und mit angenehmen Pausen.",
  fr: "Cette voix racontera l'histoire clairement, naturellement et avec des pauses agréables.",
  it: "Questa voce racconterà la storia in modo chiaro, naturale e con pause piacevoli.",
  pt: "Esta voz contará a história com clareza, naturalidade e pausas confortáveis.",
  uk: "Цей голос розповідатиме історію чітко, природно та зі зручними паузами.",
  zh: "这个声音会用清晰自然的节奏和舒适的停顿来讲述整个故事。"
};

/** Неизменная фраза, по которой сравнивается скорость TTS-голосов. */
export function voiceCalibrationSampleText(language: string): string {
  const code = ttsLanguageCode(language).split("-")[0]?.toLowerCase() || "en";
  return VOICE_CALIBRATION_SAMPLE_TEXTS[code] ?? VOICE_CALIBRATION_SAMPLE_TEXTS.en!;
}

/** Число видимых Unicode-символов после нормализации пробелов. */
export function countNarrationCharacters(value: string): number {
  return Array.from(value.normalize("NFKC").replace(/\s+/gu, " ").trim()).length;
}

/** Число слов; для языков без пробелов используются речевые CJK-символы. */
export function countNarrationWords(value: string): number {
  const words = value.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  const cjk = value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  return Math.max(words, cjk);
}

function roundedRate(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

/** Строит проверенную запись для project.json из фактической длины тестовой озвучки. */
export function createVoiceCalibration(input: {
  provider: VoiceCalibration["provider"];
  voice: string;
  language: string;
  sampleText: string;
  audioDurationSeconds: number;
  calibratedAt?: string;
}): VoiceCalibration {
  const voice = input.voice.trim();
  const languageCode = ttsLanguageCode(input.language);
  const sampleText = input.sampleText.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const sampleCharacterCount = countNarrationCharacters(sampleText);
  const sampleWordCount = countNarrationWords(sampleText);
  const duration = input.audioDurationSeconds;
  if (!voice) throw new Error("Сначала выберите конкретный голос");
  if (sampleCharacterCount < 20 || sampleWordCount < 3) throw new Error("Тестовая фраза слишком короткая для калибровки голоса");
  if (!Number.isFinite(duration) || duration < 0.5 || duration > 300) {
    throw new Error("Не удалось надёжно измерить длительность тестовой озвучки");
  }
  const charactersPerSecond = sampleCharacterCount / duration;
  const wordsPerMinute = sampleWordCount / duration * 60;
  if (charactersPerSecond < 0.5 || charactersPerSecond > 100 || wordsPerMinute < 5 || wordsPerMinute > 1_500) {
    throw new Error("Измеренная скорость голоса выходит за допустимый диапазон");
  }
  return {
    version: 1,
    provider: input.provider,
    voice,
    languageCode,
    sampleText,
    sampleCharacterCount,
    sampleWordCount,
    audioDurationSeconds: roundedRate(duration),
    charactersPerSecond: roundedRate(charactersPerSecond),
    wordsPerMinute: roundedRate(wordsPerMinute),
    calibratedAt: input.calibratedAt ?? new Date().toISOString()
  };
}

/** Калибровка годится только для того же провайдера, голоса, языка и тестовой фразы. */
export function voiceCalibrationMatches(
  calibration: VoiceCalibration | undefined,
  provider: VoiceCalibration["provider"],
  voice: string,
  language: string
): calibration is VoiceCalibration {
  if (!calibration || calibration.version !== 1) return false;
  const languageCode = ttsLanguageCode(language);
  return calibration.provider === provider
    && calibration.voice === voice.trim()
    && calibration.languageCode.toLowerCase() === languageCode.toLowerCase()
    && calibration.sampleText === voiceCalibrationSampleText(languageCode)
    && Number.isFinite(calibration.charactersPerSecond)
    && calibration.charactersPerSecond > 0
    && Number.isFinite(calibration.wordsPerMinute)
    && calibration.wordsPerMinute > 0;
}

/** Рассчитывает объём текста, который выбранный голос прочитает за целевое время. */
export function createNarrationTimingBudget(calibration: Pick<VoiceCalibration, "charactersPerSecond" | "wordsPerMinute">, targetSeconds: number): NarrationTimingBudget {
  const safeSeconds = Math.max(1, Math.round(Number.isFinite(targetSeconds) ? targetSeconds : 1));
  return {
    targetSeconds: safeSeconds,
    targetCharacterCount: Math.max(1, Math.round(calibration.charactersPerSecond * safeSeconds)),
    targetWordCount: Math.max(1, Math.round(calibration.wordsPerMinute * safeSeconds / 60)),
    charactersPerSecond: calibration.charactersPerSecond,
    wordsPerMinute: calibration.wordsPerMinute
  };
}

/** Оценка готового текста без изменения единого символа. */
export function estimateNarrationDurationSeconds(text: string, calibration: Pick<VoiceCalibration, "charactersPerSecond">): number {
  if (!Number.isFinite(calibration.charactersPerSecond) || calibration.charactersPerSecond <= 0) {
    throw new Error("Калибровка голоса повреждена или устарела");
  }
  const characters = countNarrationCharacters(text);
  return characters === 0 ? 0 : roundedRate(characters / calibration.charactersPerSecond);
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
export { resolveImageMotionZoom, resolveImageMotionDirection, resolveImageMotionPlan, imageMotionFrame } from "./image-motion.js";
export type { ImageMotionDirection, ImageMotionPlan } from "./image-motion.js";
export { sceneStoryCharacters, sceneImageReferences, storyCharacterIdentityKey } from "./story-characters.js";
export * from './documentary-reading.js';
export * from './documentary-palette.js';
export * from './documentary-motion-presets.js';
export type {DocumentaryArgument} from './documentary-motion.js';
export type {DocumentaryExplanation} from './documentary-explanation.js';
export type {DocumentaryArtwork, DocumentaryArtworkLayer, DocumentaryArtworkKeyframe, DocumentaryArtworkSourceWindow, DocumentaryArtworkPreparedMaterial, DocumentaryLinkedMechanism} from './documentary-artwork.js';
export {documentaryArtworkUsesMedia} from './documentary-artwork.js';
export * from './documentary-route-comparison.js';
