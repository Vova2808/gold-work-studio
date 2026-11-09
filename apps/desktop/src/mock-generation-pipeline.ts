import { access, readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { projectForDisplay } from "./project-display.js";
import { withDiagnosticContext } from "./diagnostics.js";
import {measureDocumentaryStage,finishDocumentaryMetrics} from './documentary-metrics.js';
import { prepareDocumentaryTiming } from "./documentary-timing.js";
import {prepareDocumentaryReading} from './documentary-reading.js';
import { prepareDocumentaryExcerpts } from "./documentary-excerpts.js";
import { rebaseDocumentaryExcerptMontage } from "./documentary-excerpt-montage.js";
import { prepareDocumentaryMaps } from "./documentary-map.js";
import { planDocumentaryMontage } from "./documentary-montage.js";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createId, type ProjectService, type TaskRepository } from "@gold-work/core";
import { sceneImageReferences, sceneStoryCharacters, createNarrationTimingBudget, projectScenarioQualityIssue, ttsLanguageCode, type LogLevel, type Project, type QueuePolicy, type QueueTask, type Scene, type ScenarioQualityIssue, type TaskKind } from "@gold-work/shared";
import { LocalProjectStorage } from "./local-project-storage.js";
import { StandardRenderer, inspectNarration } from "./standard-renderer.js";
import { documentaryNarrationText, distributeDocumentaryNarration, hasPreparedDocumentaryNarration, preparedDocumentarySceneNarrationIds, usesContinuousDocumentaryNarration } from "./documentary-narration.js";
import { DocumentaryIntelligence } from "./documentary-intelligence.js";
import { atomicWrite } from "./fs-utils.js";
import { AnyModelClient, findSceneIssues, inspectScenarioReadiness, inspectGeneratedScenarioReadiness, scenarioFingerprint } from "./anymodel-client.js";
import { plannedStoryTimingPatch } from "./planned-story-timing.js";
import { normalizeImageAspect } from "./media-utils.js";
import { VoicerClient, VoicerClientError } from "./voicer-client.js";
import { VeoClient } from "./veo-client.js";
import { cleanErrorMessage, isPermanentFailure, NO_RETRY_MARKER } from "./google-errors.js";
import { FlowClient, FlowSubmissionUncertainError } from "./flow-client.js";
import { missingAssemblyInputs } from "./assembly-readiness.js";
import {fastDocumentaryGraphicReady} from './documentary-fast-graphics.js';
import {documentaryNativeFallbackReady} from './documentary-native-fallback.js';
import {documentaryMaterialUsable} from '@gold-work/shared';
import { applyMeasuredStoryTiming, measuredStoryTimingExpansion, MeasuredStoryTimingExpansion } from "./measured-story-timing.js";

/**
 * Финальный промпт кадра = сюжет сцены + единый стиль + формат + технические запреты.
 * Модель видит только эту строку, поэтому всё, что должно повторяться от сцены к сцене, живёт здесь.
 */
export function requestsVisibleSceneText(prompt: string): boolean {
  // "Visible nose", "full body visible" and "character design" are not text
  // requests. Negative lists and explicitly blank signs must not enable labels.
  const object = "(?:(?:any|extra|additional|visible|readable)\\s+)*(?:text|writing|lettering|captions?|labels?|words?|signs?|typography|watermarks?|logos?)";
  const positive = prompt
    .replace(new RegExp(`\\b(?:no|without)\\s+${object}(?:\\s*(?:,|and|or)\\s*${object})*`, "giu"), "")
    .replace(/\b(?:blank|empty|unmarked)\s+(?:[a-z-]+\s+){0,4}(?:signboards?|signs?|labels?|posters?|screens?)\b/giu, "")
    .replace(/\b(?:text|caption|label)-free\b/giu, "")
    .replace(/(?:без|никаких)\s+(?:видим\p{L}*\s+)?(?:текст\p{L}*|надпис\p{L}*|подпис\p{L}*|букв\p{L}*)(?:\s*(?:,|и|или)\s*(?:текст\p{L}*|надпис\p{L}*|подпис\p{L}*|букв\p{L}*))*/giu, "");
  return /\b(?:(?:visible|readable)\s+(?:text|words|lettering|writing)|written\s+(?:on|inside|words?|text)|signboards?|signs?|labels?|headlines?|captions?|posters?|screen\s+text|text\s+(?:on|inside)|(?:word|words)\s+written)\b|видим\p{L}*\s+текст|читаем\p{L}*\s+(?:текст|надпис)|надпис\p{L}*|вывеск\p{L}*|плакат\p{L}*|написан\p{L}*/iu.test(positive);
}

export function buildImagePrompt(project: Project, scene: Scene): string {
  const framing = project.aspectRatio === "9:16"
    ? "Vertical 9:16 full-frame composition, subject centered, safe margins top and bottom"
    : project.aspectRatio === "1:1"
      ? "Square 1:1 composition, subject centered"
      : "Wide cinematic 16:9 composition, full widescreen framing, horizon respected";
  const style = project.settings.image.style.trim();
  const references = sceneImageReferences(project, scene);
  const cast = sceneStoryCharacters(project, scene);
  const character = project.characterReference;
  const characterAnchors = !project.storyCharacters && character && references.includes(character.imagePath)
    ? `Recurring character identity, only when this character is present in the scene: ${character.name}. ${character.prompt.trim().slice(0, 4_000)}` : "";
  const requestsVisibleText = requestsVisibleSceneText(scene.imagePrompt);
  const textRule = requestsVisibleText
    ? `The scene explicitly requires visible text. Render only the requested words, accurately, in the video's language (${project.language}); do not invent extra text.`
    : "Do not add text, captions, labels, infographics or title cards.";
  return [
    scene.imagePrompt.trim(),
    style ? `Style: ${style}` : "",
    framing,
    characterAnchors,
    ...cast.map((item, index) => `Character identity ${index + 1}: ${item.name}. ${item.prompt}. Preserve this person's face, age, hair, build and clothing. Do not blend identities or duplicate them.`),
    cast.length > 3 ? `The first reference is an identity board, three columns in reading order: ${(project.storyCharacters ?? []).map((item, i) => `${i + 1}: ${item.name}`).join("; ")}. Draw ONLY the characters requested for this scene (${cast.map(item => item.name).join(", ")}). Do not reproduce the board, panels or a lineup.` : cast.length ? "Portrait references follow the same order as the identities above. Draw only the specified cast in this scene." : "",
    references.length > 0 ? "Use the portrait reference for identity only: face, hair, body type and clothing. The scene description determines the action, expression, pose, environment and camera framing; do not copy the portrait's neutral pose or plain background. Do not insert the character into shots that do not call for them." : "",
    "Follow the specified Style exactly; do not add unrelated photorealism, 3D shading or another drawing technique. Canonical identity descriptions and portrait references override conflicting facial or clothing details in the scene prose; the scene still determines action and pose.",
    textRule,
    "Character names in identity descriptions are metadata, not words to draw on clothes, objects or backgrounds unless the scene explicitly requests them.",
    "No watermarks, logos, UI elements, borders, collage or split frames."
  ].filter(Boolean).join("\n");
}

async function loadFlowReference(reference: string): Promise<Buffer> {
  if (reference.startsWith("data:")) {
    const match = /^data:image\/[^;,]+;base64,(.+)$/i.exec(reference);
    if (!match?.[1]) throw new Error("Некорректный data:URI референса");
    return Buffer.from(match[1], "base64");
  }
  if (/^https?:\/\//i.test(reference)) {
    // A URL fetched here would use Node's direct route, outside the account session.
    throw new Error("Для Flow сначала сохраните референс локально и выберите файл");
  }
  return readFile(reference.startsWith("file:") ? fileURLToPath(reference) : reference);
}

async function loadFlowReferences(references: string[]): Promise<{ images: Buffer[]; failed: number }> {
  const settled = await Promise.allSettled(references.slice(0, 3).map(loadFlowReference));
  return {
    images: settled
      .filter((result): result is PromiseFulfilledResult<Buffer> => result.status === "fulfilled" && result.value.length > 0)
      .map((result) => result.value),
    failed: settled.filter((result) => result.status === "rejected").length,
  };
}

export const DEFAULT_QUEUE_POLICY: QueuePolicy = {
  concurrency: 5,
  maxAttempts: 3,
  retryDelaysMs: [1000, 3000]
};

/** Local queue checkpoint; no provider inputs or credentials are copied into queue.json. */
type PersistedQueueTask = QueueTask & { failedAssemblyInputHash?: string };

function assemblyInputHash(project: Project): string {
  const scenes = projectForDisplay(project).scenes.map(scene => ({
    ...scene, status: undefined,
    documentary: scene.documentary ? {...scene.documentary, candidateCount: undefined, candidatesDeferred: undefined} : undefined,
  }));
  return createHash('sha256').update(JSON.stringify({
    title: project.title, topic: project.topic, mediaMode: project.mediaMode, aspectRatio: project.aspectRatio,
    language: project.language, videoBrief: project.videoBrief, motionTemplate: project.motionTemplate,
    settings: project.settings, scenes,
  })).digest('hex');
}

const taskStep: Record<TaskKind, number> = {
  director: 18,
  speech: 14,
  image: 10,
  video: 6,
  assemble: 8
};

export interface PipelineLogEvent {
  level: LogLevel;
  message: string;
  details?: Record<string, unknown>;
}

export type PipelineEventSink = (event: PipelineLogEvent) => void;

type ImageGenerationSource = "anymodel" | "flow";

function usesStockMedia(project: Pick<Project, "mediaMode">, scene: Scene): boolean {
  return project.mediaMode === "stock" || (project.mediaMode === "mixed" && Boolean(scene.stockSource));
}

const VEO_IMPORTANCE_WORDS = /(?:hook|reveal|turning point|climax|discovery|shock|danger|escape|arrival|transformation|secret|first|final|хук|развязк|кульминац|поворот|открыт|секрет|опасн|впервые|финал)/iu;
const VEO_STATIC_WORDS = /(?:chart|table|document|receipt|letter|map|diagram|screenshot|график|таблиц|документ|чек|письмо|карта|диаграм|скриншот)/iu;

/**
 * Детерминированно выбирает AI Story кадры для Veo. В manual-режиме
 * первая очередь создаёт только картинки, а видео пользователь запускает
 * позже из «Материалов». Старые project.json без selectionMode считаются auto.
 */
export function selectAiVideoSceneIndexes(project: Pick<Project, "mediaMode" | "scenes" | "settings">): Set<number> {
  const candidates = project.scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => scene.includeInAssembly !== false && !usesStockMedia(project, scene));
  if (candidates.length === 0) return new Set();
  const mode = project.settings.video.selectionMode ?? "auto";
  if (mode === "manual") return new Set();
  if (mode === "every-second") return new Set(candidates.filter((_, position) => position % 2 === 1).map(({ index }) => index));
  if (mode === "every-third") return new Set(candidates.filter((_, position) => position % 3 === 2).map(({ index }) => index));

  const percent = Math.min(100, Math.max(1, project.settings.video.animationPercent || 15));
  const targetCount = Math.max(1, Math.min(candidates.length, Math.round(candidates.length * percent / 100)));
  if (mode === "key-scenes") return new Set(candidates.slice(0, targetCount).map(({ index }) => index));

  const lastIndex = Math.max(0, project.scenes.length - 1);
  const ranked = candidates.map(({ scene, index }) => {
    const text = `${scene.title}\n${scene.narration}\n${scene.animationPrompt}`;
    let score = 0;
    if (index === 0) score += 100;
    if (index === lastIndex) score += 65;
    if (VEO_IMPORTANCE_WORDS.test(text)) score += 45;
    if (VEO_STATIC_WORDS.test(text)) score -= 40;
    if (scene.animationPrompt.trim().length >= 24) score += 12;
    // Распределяем акценты по ролику, а не скапливаем их только в начале.
    score += (index * 37) % 29;
    return { index, score };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  return new Set(ranked.slice(0, targetCount).map(({ index }) => index));
}

function scenarioQualityIssueMessage(issue: ScenarioQualityIssue): string {
  if (issue === "missing") return "отсутствует актуальная финальная проверка сценария";
  if (issue === "stale") return "текст менялся после последней проверки полноты";
  return "автопроверка не подтвердила завершённую развязку";
}

async function hasLocalStockMedia(scene: Scene): Promise<boolean> {
  const path = scene.stockSource?.mediaType === "image"
    ? scene.imagePath
    : scene.stockSource?.mediaType === "video"
      ? scene.videoPath
      : undefined;
  if (!path?.trim()) return false;
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function hasLocalSceneImage(scene: Scene): Promise<boolean> {
  if (!scene.imagePath?.trim()) return false;
  try {
    await access(scene.imagePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Две соседние сцены сразу уходят разным провайдерам. Так AnyModel и Flow
 * действительно работают параллельно, но один кадр не оплачивается дважды.
 */
function imageSourceOrder(sceneOrder: number): readonly [ImageGenerationSource, ImageGenerationSource] {
  return sceneOrder % 2 === 0 ? ["anymodel", "flow"] : ["flow", "anymodel"];
}

const KNOWN_LUMEAN_ORDER_FAILURES = new Set([
  "order_timeout",
  "storage_response_invalid",
  "download_timeout",
  "download_network",
  "download_http",
  "download_body",
  "download_empty",
]);

function lumeanRetryBlockedReason(error: unknown, task?: QueueTask): string | undefined {
  if (error instanceof FlowSubmissionUncertainError) {
    return "Flow мог уже создать платное изображение. Проверьте проект в Flow: слепой повтор отключён, чтобы не списать квоту повторно.";
  }
  if (!(error instanceof VoicerClientError)) return undefined;
  if (error.creationUncertain) {
    return "Lumean мог уже создать платный заказ. Сначала сверьте его в кабинете Lumean; слепой повтор отключён.";
  }
  if (error.orderKnown || KNOWN_LUMEAN_ORDER_FAILURES.has(error.code)) {
    if (task?.lumeanOrder && error.code !== "order_failed") return undefined;
    return "Заказ Lumean уже создан. Повтор отключён, чтобы не списать квоту второй раз.";
  }
  return undefined;
}

function pendingSubmissionReason(task: QueueTask): string | undefined {
  if (!task.pendingSubmission) return undefined;
  const provider = task.pendingSubmission.provider === "lumean" ? "Lumean" : "Flow";
  if (task.pendingSubmission.provider === "lumean" ? task.lumeanOrder : task.remoteJob) return undefined;
  return `${provider} мог принять платное задание до прерывания приложения, но его ID не был сохранён. Проверьте результаты в ${provider}; повторная отправка отключена, чтобы не списать кредиты дважды.`;
}

function speechOrderFingerprint(text: string, template?: string): string {
  return createHash("sha256").update(JSON.stringify([text.trim(), template?.trim() || "default"])).digest("hex");
}

export class MockGenerationPipeline {
  private syncedTaskStates = new Map<string, string>();
  private tasks: PersistedQueueTask[] = [];
  private initialization?: Promise<void>;
  private mutation: Promise<void> = Promise.resolve();
  /** Реально выполняющиеся задачи (API-вызовы, FFmpeg) — работают вне мьютекса состояния. */
  private readonly executing = new Map<string, Promise<void>>();
  /** Отмена долгих провайдерских запросов по кнопке «Остановить». */
  private readonly executionControllers = new Map<string, AbortController>();
  private readonly reportedTerminalRuns = new Set<string>();

  constructor(
    private readonly repository: TaskRepository,
    private readonly projects: ProjectService,
    private readonly storage: LocalProjectStorage,
    private readonly renderer: StandardRenderer,
    readonly policy: QueuePolicy = DEFAULT_QUEUE_POLICY,
    private readonly eventSink: PipelineEventSink = () => undefined,
    private readonly anyModel?: AnyModelClient,
    private readonly voicer?: VoicerClient,
    private readonly veo?: VeoClient,
    private readonly flow?: FlowClient,
    private readonly documentaryProductionActive: (projectId: string) => boolean = () => false
  ) {}

  async initialize(): Promise<void> {
    if (!this.initialization) {
      // При ошибке загрузки не кэшируем отказ навсегда — следующий вызов попробует снова.
      this.initialization = this.load().catch((error) => {
        this.initialization = undefined;
        throw error;
      });
    }
    await this.initialization;
  }

  async list(): Promise<QueueTask[]> {
    await this.initialize();
    // A task is marked done before the same queue mutation synchronizes its
    // project status.  Readers that chain another production stage must not
    // observe that intermediate state (for example, Stock narration ->
    // auto-select).  Taking the queue mutex makes a completed task observable
    // only after syncProjects has reconciled the project as well.
    return this.mutate(async () => structuredClone(this.tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async start(projectId: string, target: "all" | "narration" = "all"): Promise<QueueTask[]> {
    await this.initialize();
    return this.mutate(async () => {
      let project = await this.requireProject(projectId);
      const narrationOnly = target === "narration";
      const documentaryStock = project.mediaMode === "stock" && project.settings.assembly.documentary?.version === 2;
      const continuousStock = usesContinuousDocumentaryNarration(project);
      if (target !== "all" && target !== "narration") throw new Error("Неизвестный этап производства");
      if (narrationOnly && !documentaryStock) throw new Error("Отдельная озвучка доступна для Stock Documentary v2");
      this.assertNoUncertainSubmission(projectId);
      if(project.mediaMode==='ai'&&project.settings.voice.enabled&&project.settings.voice.provider!=='elevenlabs'
        &&project.scenes.some(scene=>scene.includeInAssembly!==false&&!scene.audioPath))
        throw new Error('Перед генерацией AI Story выберите шаблон Lumean для озвучки. Сохранённые материалы остаются в проекте.');
      const reuseNarration = Boolean(continuousStock && await hasPreparedDocumentaryNarration(project));
      const preparedSceneNarration = !continuousStock && documentaryStock
        ? await preparedDocumentarySceneNarrationIds(project)
        : new Set<string>();
      if (narrationOnly && (reuseNarration || preparedSceneNarration.size === project.scenes.filter(scene => scene.includeInAssembly !== false).length)) return [];
      await this.storage.ensureProject(project);
      if (project.scenes.length === 0) throw new Error("Сначала добавьте хотя бы одну сцену");
      if (project.storyCharacterPlan && project.storyCharacterPlan.status !== "ready") throw new Error("Завершите подготовку персонажей на этапе «Сценарий».");
      if (project.storyCharacters) {
        for (const scene of project.scenes.filter(scene => scene.includeInAssembly !== false)) sceneImageReferences(project, scene);
      }
      const qualityIssue = projectScenarioQualityIssue(project);
      if (qualityIssue) {
        throw new Error(
          `Сценарий не готов к производству: ${scenarioQualityIssueMessage(qualityIssue)}. `
          + "Откройте этап «Сценарий» и завершите или пересоберите сценарий."
        );
      }
      const originalFingerprint = scenarioFingerprint(project.scenes);
      const timingPatch = project.videoBrief?.creationMode !== "script" ? plannedStoryTimingPatch(project) : undefined;
      if (timingPatch) project = { ...project, ...timingPatch };
      // В режиме готового сценария пользователь запретил редакционное
      // переписывание текста. Его pipeline уже проверил точную сохранность всех
      // фрагментов; обычный AI-аудит финала здесь не должен блокировать намеренный
      // клиффхэнгер или требовать «пересобрать» исходный текст.
      if (project.referenceAnalysis?.provider.startsWith("anymodel:") && project.videoBrief?.creationMode !== "script") {
        const targetSeconds = Math.max(30, Math.round((project.settings.durationMinutes || 1) * 60));
        const calibration = project.settings.voice.calibration;
        const narrationTiming = calibration
          ? createNarrationTimingBudget(calibration, targetSeconds)
          : undefined;
        const readiness = project.mediaMode === "ai" && narrationTiming
          ? inspectGeneratedScenarioReadiness(project.scenes, targetSeconds, narrationTiming)
          : inspectScenarioReadiness(project.scenes, targetSeconds, narrationTiming);
        // Небольшое отличие от ориентира остаётся предупреждением: Final идёт по
        // фактической озвучке. Но явное переполнение отдельной реплики уже не
        // допускаем — иначе 30-секундный план снова превращается в минутный ролик.
        const obviousErrors = [...readiness.errors];
        const overlongScenes = findSceneIssues(project.scenes, project.scenes.length, narrationTiming)
          .filter((issue) => issue.kind === "length");
        if (overlongScenes.length > 0) {
          const sceneNumbers = overlongScenes.slice(0, 12).map((issue) => issue.sceneNumber).join(", ");
          obviousErrors.push(
            overlongScenes.length === 1
              ? `текст не помещается в хронометраж сцены ${sceneNumbers}`
              : `текст не помещается в хронометраж сцен ${sceneNumbers}`
          );
        }
        if (obviousErrors.length > 0) {
          throw new Error(
            `Сценарий не готов к производству: ${[...new Set(obviousErrors)].join("; ")}. `
            + "Откройте этап «Сценарий» и нажмите «Пересобрать сценарий под длину и язык»."
          );
        }
      }
      if (project.mediaMode === "stock" && !narrationOnly) {
        const missing: number[] = [];
        for (const scene of project.scenes) {
          if (scene.includeInAssembly === false) continue;
          if(documentaryStock&&scene.documentary?.verified&&(documentaryNativeFallbackReady(project,scene)||fastDocumentaryGraphicReady(project,scene)))continue;
          if (!scene.stockSource || !(await hasLocalStockMedia(scene)) || (project.settings.assembly.documentary?.version === 2 && !documentaryMaterialUsable(scene))) missing.push(scene.order + 1);
        }
        if (missing.length > 0) {
          throw new Error(
            `Стоковый режим: сначала выберите сток и дождитесь скачивания локального файла для ${missing.length === 1 ? `сцены ${missing[0]}` : `сцен ${missing.join(", ")}`}.`
          );
        }
      }
      if (project.mediaMode === "mixed") {
        const broken: number[] = [];
        for (const scene of project.scenes) {
          if (scene.includeInAssembly === false || !scene.stockSource) continue;
          if (!(await hasLocalStockMedia(scene))) broken.push(scene.order + 1);
        }
        if (broken.length > 0) {
          throw new Error(
            `Локальный stock-файл потерян или не совпадает с типом медиа. Пере-выберите stock для ${broken.length === 1 ? `сцены ${broken[0]}` : `сцен ${broken.join(", ")}`}.`
          );
        }
      }
      if (
        project.mediaMode !== 'ai' && project.settings.video.enabled
        && project.scenes.some((scene) => !usesStockMedia(project, scene))
        && project.settings.video.provider === "flow"
        && project.settings.video.startFrame
        && project.settings.image.provider === "mock-image"
      ) {
        throw new Error(
          "Для Flow-видео от первого кадра нельзя использовать Mock Image: он создаёт тестовые BMP-заглушки. "
          + "Выберите Nano Banana, GPT Image или AnyModel API в разделе «Изображения»."
        );
      }

      const active = this.tasks.filter((task) =>
        task.projectId === projectId && ["pending", "running", "retry_wait", "paused"].includes(task.status)
      );
      if (active.length > 0) return structuredClone(active);
      if (this.tasks.some(task => task.projectId === projectId && this.executing.has(task.id))) {
        throw new Error("Остановка ещё завершается. Дождитесь сохранения текущих заданий и повторите запуск.");
      }

      if (timingPatch) {
        project = await this.projects.mutate(projectId, current => {
          if (scenarioFingerprint(current.scenes) !== originalFingerprint) throw new Error("Сценарий изменился во время запуска. Повторите запуск с актуальным текстом.");
          return timingPatch;
        });
        this.emit("info", "scenario.timing.calibrated", { projectId, scenes: project.scenes.length });
      }

      // Keep paid Stock orders accepted before Stop; execution checks their text/voice fingerprint.
      const savedSpeech = documentaryStock
        ? this.tasks.filter(task => task.projectId === projectId && task.kind === "speech" && task.status !== "done" && task.lumeanOrder)
        : [];
      this.tasks = this.tasks.filter((task) => task.projectId !== projectId);
      const now = new Date().toISOString();
      const runId = createId("run");
      const created: QueueTask[] = [];
      const images: Array<QueueTask | undefined> = [];
      if (continuousStock && !reuseNarration) {
        const narrated = project.scenes.filter(scene => scene.includeInAssembly !== false).sort((a, b) => a.order - b.order);
        if (narrated[0]) created.push({ ...this.makeTask(runId, project, narrated[0], "speech", "Непрерывная озвучка документального ролика", [], now), narrationSceneIds: narrated.map(scene => scene.id) });
      }

      for (const [index, scene] of project.scenes.entries()) {
        if (scene.includeInAssembly === false) continue;
        const imageDependencies: string[] = [];
        if (project.settings.voice.enabled && !continuousStock && !preparedSceneNarration.has(scene.id)) {
          const speech = this.makeTask(runId, project, scene, "speech", `Озвучка · сцена ${index + 1}`, [], now);
          created.push(speech);
        }

        if (narrationOnly) continue;

        if (usesStockMedia(project, scene)) continue;

        const previousImage = images.filter(Boolean).at(-1);
        if (project.settings.image.sequential && previousImage) imageDependencies.push(previousImage.id);
        const image = this.makeTask(runId, project, scene, "image", `Изображение · сцена ${index + 1}`, imageDependencies, now);
        images[index] = image;
        created.push(image);
      }

      if (project.settings.video.enabled && !narrationOnly) {
        const animated = selectAiVideoSceneIndexes(project);
        for (const [index, scene] of project.scenes.entries()) {
          if (usesStockMedia(project, scene)) continue;
          if (!animated.has(index)) continue;
          const currentImage = images[index];
          if (!currentImage) continue;
          const nextImage = images[index + 1];
          // AI Story reviews/creates the image set first; Veo must not race ahead of missing frames.
          const videoDependencies = images.filter((image): image is QueueTask => Boolean(image)).map(image => image.id);
          if (project.settings.video.pairedFrames && nextImage) videoDependencies.push(nextImage.id);
          created.push(this.makeTask(runId, project, scene, "video", `AI-видео · сцена ${index + 1}`, [...new Set(videoDependencies)], now));
        }
      }

      if (!narrationOnly) created.push({...this.makeTask(runId, project, undefined, "assemble", "Подготовка редактора", created.map((task) => task.id), now), allowTimingExpansion: true, prepareOnly: true});
      for (const task of created.filter(task => task.kind === "speech")) {
        const previous = savedSpeech.find(saved => saved.sceneId === task.sceneId
          && JSON.stringify(saved.narrationSceneIds) === JSON.stringify(task.narrationSceneIds));
        if (previous) task.lumeanOrder = previous.lumeanOrder;
      }
      this.tasks.push(...created);
      await this.projects.mutate(projectId, (current) => ({
        status: "generating",
        outputPath: undefined,
        lastRender: undefined,
        scenes: current.scenes.map((scene) => scene.includeInAssembly === false ? scene : ({
          ...scene,
          status: "queued",
          imagePath: narrationOnly || usesStockMedia(project, scene) ? scene.imagePath : undefined,
          videoPath: narrationOnly || usesStockMedia(project, scene) ? scene.videoPath : undefined,
          videoFallback: undefined,
          audioPath: reuseNarration || preparedSceneNarration.has(scene.id) ? scene.audioPath : undefined,
          narrationSlice: reuseNarration ? scene.narrationSlice : undefined,
          stockSource: narrationOnly || usesStockMedia(project, scene) ? scene.stockSource : undefined
        }))
      }));
      await this.persist();
      this.emit("info", "queue.project.started", {
        projectId,
        runId,
        title: project.title,
        scenes: project.scenes.length,
        tasks: created.length,
        voiceProvider: project.settings.voice.enabled ? project.settings.voice.provider : "off",
        mediaMode: project.mediaMode ?? "ai",
        imageProvider: project.mediaMode === "stock" ? "stock" : project.settings.image.provider,
        videoProvider: project.mediaMode === "stock" ? "stock" : project.settings.video.enabled ? project.settings.video.provider : "off"
      });
      return this.forProject(projectId);
    });
  }

  /** Только пересборка Final.mp4 из готовых материалов — без перегенерации картинок и озвучки. */
  async assembleOnly(projectId: string): Promise<QueueTask[]> {
    await this.initialize();
    return this.mutate(async () => {
      const project = await this.requireProject(projectId);
      this.assertNoUncertainSubmission(projectId);
      if (project.scenes.length === 0) throw new Error("В проекте нет сцен");
      const active = this.tasks.some((task) =>
        task.projectId === projectId && ["pending", "running", "retry_wait", "paused"].includes(task.status)
      );
      if (active) throw new Error("Сначала дождитесь завершения или остановите текущую очередь");
      const missing = missingAssemblyInputs(project);
      if (missing.length > 0) {
        throw new Error(`Для сборки ещё нужны материалы: ${missing.slice(0, 8).join("; ")}${missing.length > 8 ? "; …" : ""}. Откройте «Материалы» или продолжите генерацию.`);
      }
      const now = new Date().toISOString();
      const runId = createId("run");
      this.tasks = this.tasks.filter((task) => task.projectId !== projectId);
      const assemble = {...this.makeTask(runId, project, undefined, "assemble", "Пересборка Final.mp4", [], now), prepareOnly: false};
      this.tasks.push(assemble);
      await this.projects.update(projectId, { status: "generating", outputPath: undefined, lastRender: undefined });
      await this.persist();
      this.emit("info", "queue.project.reassemble", { projectId, runId });
      return this.forProject(projectId);
    });
  }

  async regenerateScene(projectId: string, sceneId: string | string[], target: "image" | "video" | "audio" | "all" = "all"): Promise<QueueTask[]> {
    await this.initialize();
    return this.mutate(async () => {
      if (!(["image", "video", "audio", "all"] as const).includes(target)) throw new Error("Неизвестный режим перегенерации");
      const project = await this.requireProject(projectId);
      if (project.mediaMode === "stock" && project.settings.assembly.documentary?.version === 2) {
        if (target === "image" || target === "video") throw new Error("В Stock Documentary замените реальный материал через подбор кадров");
        if (target === "all") target = "audio";
      }
      const requestedIds = [...new Set(Array.isArray(sceneId) ? sceneId : [sceneId])];
      const selectedIds = new Set(requestedIds);
      this.assertNoUncertainSubmission(projectId, selectedIds, target);
      const selectedScenes = project.scenes
        .filter((candidate) => selectedIds.has(candidate.id))
        .sort((left, right) => left.order - right.order);
      if (selectedScenes.length === 0 || selectedScenes.length !== requestedIds.length) throw new Error("Одна или несколько сцен не найдены");
      if (target === "video" && !project.settings.video.enabled) throw new Error("AI-видео отключено в настройках проекта");
      if (target === "audio" && !project.settings.voice.enabled) throw new Error("Озвучка отключена в настройках проекта");
      const projectTasks = this.tasks.filter((task) => task.projectId === projectId);
      if (projectTasks.some((task) => ["pending", "running", "retry_wait", "paused"].includes(task.status))) {
        throw new Error("Сначала дождитесь завершения или остановите текущую очередь");
      }

      const runId = createId("run");
      this.reportedTerminalRuns.delete(runId);
      const now = new Date().toISOString();
      // Запоминаем старые задачи сцены по типам: зависимости других сцен нужно перевязать на новые id.
      const oldSceneTaskIds = new Map<string, string>();
      for (const task of this.tasks) {
        if (task.projectId === projectId && task.sceneId && selectedIds.has(task.sceneId)) {
          oldSceneTaskIds.set(`${task.sceneId}:${task.kind}`, task.id);
        }
      }
      const replacedKinds = new Set<TaskKind>(target === "all"
        ? ["speech", "image", "video"]
        : target === "image" ? ["image"] : target === "video" ? ["video"] : ["speech"]);
      this.tasks = this.tasks.filter((task) =>
        task.projectId !== projectId || (task.kind !== "assemble" && (!task.sceneId || !selectedIds.has(task.sceneId) || !replacedKinds.has(task.kind)))
      );
      const remainingProjectTasks = this.tasks.filter((task) => task.projectId === projectId);
      const created: QueueTask[] = [];
      const findTask = (candidateId: string, kind: TaskKind) =>
        created.find((task) => task.sceneId === candidateId && task.kind === kind)
        ?? remainingProjectTasks.find((task) => task.sceneId === candidateId && task.kind === kind);

      // Озвучка и картинки независимы: сбой TTS не должен блокировать Flow.
      // Между картинками остаётся только явная sequential-зависимость.
      for (const scene of selectedScenes) {
        const imageDependencies: string[] = [];
        if ((target === "all" || target === "audio") && project.settings.voice.enabled) {
          const speech = this.makeTask(runId, project, scene, "speech", `Озвучка · сцена ${scene.order + 1}`, [], now);
          created.push(speech);
        }
        if (target === "all" || target === "image") {
          const previousScene = project.scenes.find((candidate) => candidate.order === scene.order - 1);
          const previousImage = project.settings.image.sequential && previousScene ? findTask(previousScene.id, "image") : undefined;
          if (previousImage) imageDependencies.push(previousImage.id);
          created.push(this.makeTask(runId, project, scene, "image", `Изображение · сцена ${scene.order + 1}`, imageDependencies, now));
        }
      }
      for (const scene of selectedScenes) {
        if (!((target === "all" || target === "video") && project.settings.video.enabled)) continue;
        const nextScene = project.scenes.find((candidate) => candidate.order === scene.order + 1);
        const nextImage = project.settings.video.pairedFrames && nextScene
          ? findTask(nextScene.id, "image")
          : undefined;
        const currentImage = findTask(scene.id, "image");
        created.push(
          this.makeTask(
            runId,
            project,
            scene,
            "video",
            `AI-видео · сцена ${scene.order + 1}`,
            [...(currentImage ? [currentImage.id] : []), ...(nextImage ? [nextImage.id] : [])],
            now
          )
        );
      }
      for (const task of created) task.scope = "scenes";
      this.tasks.push(...created);
      // Перевязываем зависимости остальных задач со старых id сцены на новые (sequential-картинки, парные кадры)
      // и возвращаем «заблокированные» задачи в очередь — их блокировала удалённая упавшая задача.
      const replacedIds = new Map<string, string>();
      for (const task of created) {
        const oldId = task.sceneId ? oldSceneTaskIds.get(`${task.sceneId}:${task.kind}`) : undefined;
        if (oldId) replacedIds.set(oldId, task.id);
      }
      for (const task of this.tasks) {
        if (task.projectId !== projectId) continue;
        const hadReplacedDependency = task.dependsOn.some((id) => replacedIds.has(id));
        task.dependsOn = task.dependsOn.map((id) => replacedIds.get(id) ?? id);
        if (hadReplacedDependency && task.status === "blocked") {
          task.status = "pending";
          task.error = undefined;
          task.updatedAt = now;
        }
      }
      const plannedScenes = project.scenes.map(candidate => selectedIds.has(candidate.id) ? {
        ...candidate,
        imagePath: target === "all" || target === "image" ? undefined : candidate.imagePath,
        videoPath: target === "all" || target === "video" ? undefined : candidate.videoPath,
        videoFallback: target === "all" || target === "video" ? undefined : candidate.videoFallback,
        audioPath: target === "all" || target === "audio" ? undefined : candidate.audioPath,
      } : candidate);
      const missingInputs = missingAssemblyInputs({ ...project, scenes: plannedScenes }, this.tasks);
      await this.projects.mutate(projectId, (current) => ({
        status: "generating",
        // Любое изменение исходников делает прежний Final.mp4 устаревшим. Живой таймлайн
        // показывает новый звук сразу, а экспорт появится только после явной пересборки.
        outputPath: undefined,
        lastRender: undefined,
        scenes: current.scenes.map((candidate) =>
          selectedIds.has(candidate.id)
            ? {
                ...candidate,
                status: "queued",
                imagePath: target === "all" || target === "image" ? undefined : candidate.imagePath,
                videoPath: target === "all" || target === "video" ? undefined : candidate.videoPath,
                videoFallback: target === "all" || target === "video" ? undefined : candidate.videoFallback,
                audioPath: target === "all" || target === "audio" ? undefined : candidate.audioPath,
                narrationSlice: target === "all" || target === "audio" ? undefined : candidate.narrationSlice,
                stockSource: target === "all" || target === "image" ? undefined : candidate.stockSource
              }
            : candidate
        )
      }));
      await this.storage.ensureProject(await this.requireProject(projectId));
      await this.persist();
      this.emit("info", "queue.scene.regeneration.started", { projectId, sceneIds: requestedIds, scenes: requestedIds.length, runId, target });
      if (target !== "audio" && missingInputs.length > 0) {
        this.emit("info", "queue.assembly.waiting_for_materials", { projectId, runId, missing: missingInputs.slice(0, 12) });
      }
      return this.forProject(projectId);
    });
  }

  async pause(projectId: string): Promise<QueueTask[]> {
    await this.initialize();
    return this.mutate(async () => {
      const now = new Date().toISOString();
      let changed = false;
      for (const task of this.tasks) {
        if (task.projectId === projectId && (task.status === "pending" || task.status === "running" || task.status === "retry_wait")) {
          task.pausedFrom = task.status;
          task.status = "paused";
          task.updatedAt = now;
          changed = true;
        }
      }
      if (!changed) {
        await this.syncProjects();
        return this.forProject(projectId);
      }
      await this.projects.update(projectId, { status: "paused" });
      await this.persist();
      this.emit("info", "queue.project.paused", { projectId });
      return this.forProject(projectId);
    });
  }

  async resume(projectId: string): Promise<QueueTask[]> {
    await this.initialize();
    return this.mutate(async () => {
      const now = new Date().toISOString();
      let changed = false;
      for (const task of this.tasks) {
        if (task.projectId === projectId && task.status === "paused") {
          // Если реальное выполнение всё ещё идёт (пауза не прерывает начатый API-вызов) — возвращаем в running.
          const inFlight = this.executing.has(task.id);
          task.status = task.pausedFrom === "retry_wait" ? "retry_wait" : inFlight ? "running" : "pending";
          if (task.pausedFrom !== "running" || inFlight) task.pausedFrom = undefined;
          task.updatedAt = now;
          changed = true;
        }
      }
      if (!changed) {
        await this.syncProjects();
        return this.forProject(projectId);
      }
      await this.projects.update(projectId, { status: "generating" });
      await this.persist();
      this.emit("info", "queue.project.resumed", { projectId });
      return this.forProject(projectId);
    });
  }

  /** Stop scheduling, save responses already in flight, then cancel the rest. */
  async stopAfterDraining(projectId: string): Promise<QueueTask[]> {
    await this.pause(projectId);
    const pending = this.tasks.filter(task => task.projectId === projectId).flatMap(task => {
      const work = this.executing.get(task.id); return work ? [work] : [];
    });
    await Promise.allSettled(pending);
    return this.stop(projectId);
  }

  async stop(projectId: string): Promise<QueueTask[]> {
    await this.initialize();
    return this.mutate(async () => {
      const now = new Date().toISOString();
      let changed = false;
      for (const task of this.tasks) {
        if (task.projectId === projectId && ["pending", "running", "retry_wait", "paused", "blocked"].includes(task.status)) {
          this.executionControllers.get(task.id)?.abort(new Error("Остановлено пользователем"));
          task.status = "cancelled";
          task.pausedFrom = undefined;
          task.nextAttemptAt = undefined;
          task.updatedAt = now;
          changed = true;
        }
      }
      if (!changed) {
        await this.syncProjects();
        return this.forProject(projectId);
      }
      await this.projects.mutate(projectId, (project) => ({
        status: "failed",
        scenes: project.scenes.map((scene) =>
          scene.status === "ready" ? scene : { ...scene, status: "failed" }
        )
      }));
      await this.persist();
      this.emit("warn", "queue.project.stopped", { projectId });
      await this.syncProjects();
      return this.forProject(projectId);
    });
  }

  async retry(taskId: string): Promise<QueueTask> {
    await this.initialize();
    return this.mutate(async () => {
      const task = this.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw new Error(`Задача ${taskId} не найдена`);
      if (task.status === "cancelled") throw new Error("Остановленный проект нужно запустить заново");
      if (task.status !== "failed") return structuredClone(task);
      if (task.retryBlockedReason || pendingSubmissionReason(task)) throw new Error(task.retryBlockedReason ?? pendingSubmissionReason(task));
      const project = await this.requireProject(task.projectId);
      if (task.kind === 'assemble' && task.prepareOnly === false
        && this.tasks.filter(candidate => candidate.runId === task.runId).length === 1
        && project.mediaMode === 'stock' && project.settings.assembly.documentary?.version === 2) {
        this.assertNoUncertainSubmission(project.id);
        if (!task.failedAssemblyInputHash) throw new Error('Для старой ошибки экспорта нет сохранённого состояния входов. Запустите экспорт заново.');
        if (task.failedAssemblyInputHash !== assemblyInputHash(project)) {
          throw new Error('Сцены или настройки изменились после ошибки. Запустите экспорт заново.');
        }
        const missing = missingAssemblyInputs(project, [], existsSync);
        if (missing.length) throw new Error(`Для сборки ещё нужны материалы: ${missing.slice(0, 8).join('; ')}.`);
      } else if (task.narrationSceneIds) {
        documentaryNarrationText(project, task);
      } else if (!(task.kind === "speech" && project.mediaMode === "stock" && project.settings.assembly.documentary?.version === 2)) {
      const runSceneIds = new Set(this.tasks.filter((candidate) => candidate.runId === task.runId && candidate.sceneId).map((candidate) => candidate.sceneId as string));
      if (runSceneIds.size !== project.scenes.length || project.scenes.some((scene) => !runSceneIds.has(scene.id))) {
        throw new Error("Состав сцен изменился. Запустите генерацию проекта заново.");
      }
      }
      this.reportedTerminalRuns.delete(task.runId);
      task.status = "pending";
      task.progress = 0;
      task.attempts = 0;
      task.error = undefined;
      task.retryBlockedReason = undefined;
      task.stage = undefined;
      task.nextAttemptAt = undefined;
      task.pausedFrom = undefined;
      task.updatedAt = new Date().toISOString();
      let unblocked = true;
      while (unblocked) {
        unblocked = false;
        for (const dependent of this.tasks) {
          if (dependent.runId !== task.runId || dependent.status !== "blocked") continue;
          const dependencies = dependent.dependsOn.map((id) => this.tasks.find((candidate) => candidate.id === id));
          if (dependencies.some((dependency) => dependency && ["failed", "cancelled", "blocked"].includes(dependency.status))) continue;
          dependent.status = "pending";
          dependent.error = undefined;
          dependent.updatedAt = task.updatedAt;
          unblocked = true;
        }
      }
      await this.projects.update(task.projectId, { status: "generating" });
      await this.persist();
      this.emit("info", "queue.task.manual_retry", {
        projectId: task.projectId,
        taskId: task.id,
        kind: task.kind
      });
      return structuredClone(task);
    });
  }

  async clearFinished(): Promise<QueueTask[]> {
    await this.initialize();
    return this.mutate(async () => {
      const runIds = [...new Set(this.tasks.map((task) => task.runId))];
      const removableRuns = new Set(runIds.filter((runId) => {
        const runTasks = this.tasks.filter((task) => task.runId === runId);
        return runTasks.length > 0 && runTasks.every((task) => task.status === "done" || task.status === "cancelled");
      }));
      this.tasks = this.tasks.filter((task) => !removableRuns.has(task.runId));
      await this.persist();
      this.emit("info", "queue.finished_runs.cleared", { runs: removableRuns.size });
      return structuredClone(this.tasks);
    });
  }

  /**
   * Инвалидирует незавершённые задачи и удаляет только журнал очереди.
   * Проекты, уже созданные файлы сцен и Final.mp4 не трогаются. Долгие
   * провайдерские запросы прерываются тем же AbortSignal, что и при Stop.
   */
  async clearAll(): Promise<QueueTask[]> {
    await this.initialize();
    return this.mutate(async () => {
      const taskCount = this.tasks.length;
      const runCount = new Set(this.tasks.map((task) => task.runId)).size;
      const activeStatuses = new Set<QueueTask["status"]>(["pending", "running", "retry_wait", "paused"]);
      const activeTasks = this.tasks.filter((task) => activeStatuses.has(task.status));
      const activeProjectIds = new Set(activeTasks.map((task) => task.projectId));

      for (const task of activeTasks) {
        this.executionControllers.get(task.id)?.abort(new Error("Очередь очищена пользователем"));
      }

      // Повторяем безопасную часть stop(): проект не должен остаться в вечном
      // generating/paused. Все пути и сами файлы намеренно сохраняются.
      for (const projectId of activeProjectIds) {
        const project = await this.projects.get(projectId);
        if (!project) continue;
        await this.projects.mutate(projectId, (current) => ({
          status: "failed",
          scenes: current.scenes.map((scene) =>
            scene.status === "queued" || scene.status === "generating"
              ? { ...scene, status: "failed" as const }
              : scene
          )
        }));
      }

      // beginExecution ищет исходную задачу перед фиксацией результата. После
      // очистки он увидит, что её уже нет, и тихо завершится.
      this.tasks = [];
      this.reportedTerminalRuns.clear();
      await this.persist();
      this.emit("info", "queue.all.cleared", {
        tasks: taskCount,
        runs: runCount,
        stopped: activeTasks.length,
        projects: activeProjectIds.size
      });
      return [];
    });
  }

  async removeProject(projectId: string): Promise<void> {
    await this.initialize();
    await this.mutate(async () => {
      for (const task of this.tasks) {
        if (task.projectId === projectId) {
          this.executionControllers.get(task.id)?.abort(new Error("Проект удалён пользователем"));
        }
      }
      this.tasks = this.tasks.filter((task) => task.projectId !== projectId);
      await this.persist();
    });
  }

  async tick(): Promise<void> {
    await this.initialize();
    await this.mutate(async () => {
      const now = new Date().toISOString();
      const nowTime = Date.now();
      let changed = false;

      for (const task of this.tasks) {
        if (task.status === "retry_wait" && (!task.nextAttemptAt || Date.parse(task.nextAttemptAt) <= nowTime)) {
          task.status = "pending";
          task.nextAttemptAt = undefined;
          task.updatedAt = now;
          changed = true;
          this.emit("info", "queue.task.retry_ready", this.taskDetails(task));
        }
      }

      // Реальная работа идёт в beginExecution вне мьютекса; здесь только «сердцебиение» прогресса до 90%,
      // остальные 10% задача получает в момент фактического завершения.
      for (const task of this.tasks.filter((candidate) => candidate.status === "running")) {
        const hasProviderProgress = task.kind === "assemble" || (task.kind === "video" || task.kind === "image") && Boolean(task.stage);
        if (task.progress < 90 && !hasProviderProgress) {
          task.progress = Math.min(90, task.progress + taskStep[task.kind]);
          task.updatedAt = now;
          changed = true;
        }
      }

      let running = this.tasks.filter((task) => task.status === "running").length;
      // Видео — дорогой long-running запрос с низкой RPM-квотой. Пускаем по одной сцене,
      // а картинки и озвучку по-прежнему обрабатываем параллельно.
      let videoRunning = this.tasks.some((task) => task.status === "running" && task.kind === "video");
      for (const task of this.tasks) {
        if (running >= this.policy.concurrency) break;
        if (task.status !== "pending") continue;
        if (task.kind === "video" && videoRunning) continue;
        const dependencies = task.dependsOn.map((id) => this.tasks.find((candidate) => candidate.id === id));
        if (dependencies.some((dependency) => dependency?.status === "failed" || dependency?.status === "cancelled" || dependency?.status === "blocked")) {
          task.status = "blocked";
          task.error = "Не выполнена предыдущая задача";
          task.updatedAt = now;
          changed = true;
          this.emit("warn", "queue.task.blocked", {
            ...this.taskDetails(task),
            blockedByTaskIds: dependencies.filter((dependency) => dependency && ["failed", "cancelled", "blocked"].includes(dependency.status)).map((dependency) => dependency!.id)
          });
          continue;
        }
        if (!dependencies.every((dependency) => dependency?.status === "done")) continue;
        task.status = "running";
        // A resumed local assembly starts a new render pass (possibly cached),
        // not at the percentage left by the crashed encoder.
        if (task.kind === "assemble") { task.progress = 0; task.stage = "Продолжаю сборку по сохранённым материалам"; }
        task.submissionTrackingVersion = 1;
        if (task.pausedFrom !== "running") task.attempts += 1;
        task.pausedFrom = undefined;
        task.error = undefined;
        task.nextAttemptAt = undefined;
        task.updatedAt = now;
        running += 1;
        if (task.kind === "video") videoRunning = true;
        changed = true;
        this.emit("info", "queue.task.started", this.taskDetails(task));
        this.beginExecution(task);
      }

      if (changed) {
        await this.persist();
        await this.syncProjects();
      }
    });
  }

  /** Запускает реальное выполнение задачи вне мьютекса: очередь остаётся отзывчивой, задачи идут параллельно. */
  private beginExecution(task: QueueTask): void {
    if (this.executing.has(task.id)) return;
    const snapshot = structuredClone(task);
    const controller = new AbortController();
    this.executionControllers.set(task.id, controller);
    const work = withDiagnosticContext({ operationId: `task-${randomUUID()}`, taskId: task.id, projectId: task.projectId,
      sceneId: task.sceneId, runId: task.runId, attempt: task.attempts }, async () => {
      const started = Date.now();
      this.emit("info", "queue.task.execution_started", this.taskDetails(snapshot));
      let resultPath: string | undefined;
      let failure: unknown;
      try {
        if (await this.shouldSimulateFailure(snapshot)) throw new Error("Тестовая ошибка провайдера ([FAIL])");
        resultPath = await this.executeTask(snapshot, controller.signal);
      } catch (error) {
        failure = error;
      }
      await this.mutate(async () => {
        const current = this.tasks.find((candidate) => candidate.id === snapshot.id);
        if (!current || current.status === "cancelled") return;
        const nowTime = Date.now();
        current.updatedAt = new Date(nowTime).toISOString();
        if (failure instanceof MeasuredStoryTimingExpansion) {
          try {
            const expansion = failure;
            const expanded = await this.projects.mutate(current.projectId, project => applyMeasuredStoryTiming(project, expansion));
            const paused = current.status === "paused";
            const added = this.ensureMeasuredTimingTasks(expanded, current, paused);
            current.status = paused ? "paused" : "pending";
            current.pausedFrom = paused ? "pending" : undefined;
            current.attempts = Math.max(0, current.attempts - 1);
            current.progress = 0;
            current.stage = added > 0 ? `Уточнён тайминг озвучки: ещё ${added} кадров без повторного TTS` : "Тайминг готовой озвучки измерен; сборка";
            current.error = undefined;
            this.emit("info", "queue.narration.split", {...this.taskDetails(current), addedFrames: added});
          } catch (error) {
            this.scheduleFailure(current, error, nowTime);
          }
        } else if (failure === undefined) {
          current.resultPath = resultPath;
          current.pendingSubmission = undefined;
          current.resultFallback = snapshot.resultFallback;
          current.status = "done";
          current.progress = 100;
          current.stage = snapshot.resultFallback ? "Без анимации: использован исходный кадр" : "Готово";
          current.error = undefined;
          current.retryBlockedReason = undefined;
          current.nextAttemptAt = undefined;
          current.pausedFrom = undefined;
          this.emit("info", "queue.task.completed", { ...this.taskDetails(current), elapsedMs: Date.now() - started });
        } else if (current.status === "paused") {
          const retryBlockedReason = pendingSubmissionReason(current) ?? lumeanRetryBlockedReason(failure, current);
          if (retryBlockedReason) {
            current.status = "failed";
            current.progress = 0;
            current.error = failure instanceof Error ? cleanErrorMessage(failure.message) : String(failure);
            current.retryBlockedReason = retryBlockedReason;
            current.pausedFrom = undefined;
            current.nextAttemptAt = undefined;
            this.emit("error", "queue.task.failed_permanently", { ...this.taskDetails(current), error: failure, elapsedMs: Date.now() - started });
          } else {
          // Пауза важнее ретрая: сбой запомним, но продолжение — только по кнопке пользователя.
            current.progress = 0;
            current.error = failure instanceof Error ? failure.message : String(failure);
            current.pausedFrom = "pending";
            current.nextAttemptAt = undefined;
            this.emit("warn", "queue.task.failed_while_paused", { ...this.taskDetails(current), error: failure, elapsedMs: Date.now() - started });
          }
        } else {
          this.scheduleFailure(current, failure, nowTime);
        }
        // Preparation (including the renderer's montage callback) can persist timing,
        // excerpts and artwork. Bind manual retry to those final prepared inputs,
        // before any user edits made after the failure; queue status is excluded.
        if (current.status === 'failed' && current.kind === 'assemble' && current.prepareOnly === false
          && this.tasks.filter(candidate => candidate.runId === current.runId).length === 1) {
          const project = await this.projects.get(current.projectId);
          if (project?.mediaMode === 'stock' && project.settings.assembly.documentary?.version === 2) {
            current.failedAssemblyInputHash = assemblyInputHash(project);
          }
        }
        await this.persist();
        await this.syncProjects();
      });
    });
    this.executing.set(task.id, work.catch(error => {
      this.emit("error", "queue.task.execution_failed", { ...this.taskDetails(snapshot), error });
    }).finally(() => {
      this.executing.delete(task.id);
      this.executionControllers.delete(task.id);
    }));
  }

  /** Для тестов и отладки: доводит очередь до состояния без активных задач. */
  async drain(maxIterations = 1000): Promise<void> {
    await this.initialize();
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      await this.tick();
      const inFlight = [...this.executing.values()];
      if (inFlight.length > 0) {
        await Promise.all(inFlight);
        continue;
      }
      const active = this.tasks.some((task) => ["pending", "running", "retry_wait"].includes(task.status));
      if (!active) return;
      await new Promise((resolve) => setTimeout(resolve, 50)); // ждём retry_wait
    }
    throw new Error("drain: очередь не завершилась за отведённые итерации");
  }

  private async load(): Promise<void> {
    const loaded = await this.repository.list();
    const now = new Date().toISOString();
    const legacyRuns = new Map<string, string>();
    this.tasks = loaded.map((task) => ({
      ...task,
      runId: task.runId || legacyRuns.get(task.projectId) || (() => {
        const runId = createId("run");
        legacyRuns.set(task.projectId, runId);
        return runId;
      })(),
      label: task.label || task.kind,
      // При перезапуске незавершённые задачи ставим на ПАУЗУ — прогресс сохранён,
      // но генерация не возобновляется сама, только по кнопке пользователя.
      status: task.status === "pending" || task.status === "running" || task.status === "retry_wait" ? "paused" : task.status,
      pausedFrom: task.status === "running" ? "running"
        : task.status === "pending" ? "pending"
        : task.status === "retry_wait" ? "retry_wait"
        : task.pausedFrom,
      dependsOn: task.dependsOn ?? [],
      createdAt: task.createdAt ?? now,
      updatedAt: task.updatedAt ?? now,
      maxAttempts: task.maxAttempts || this.policy.maxAttempts
    }));
    const legacyProjects = new Map<string, Project | undefined>();
    for (const task of this.tasks) {
      // Old automatic assembly checkpoints continue as editor preparation.
      // Explicit exports (assembleOnly's label, no expansion flag) retain their intent.
      if (task.kind === 'assemble' && task.prepareOnly === undefined && task.status !== 'done'
        && (task.allowTimingExpansion || task.label === 'Сборка Final.mp4' || task.label.startsWith('Пересборка Final.mp4 после '))) {
        task.prepareOnly = true;
        task.label = 'Подготовка редактора';
      }
      if (task.status === "paused" && task.pausedFrom === "running" && !task.submissionTrackingVersion && !task.remoteJob && !task.lumeanOrder && !task.pendingSubmission) {
        if (!legacyProjects.has(task.projectId)) legacyProjects.set(task.projectId, await this.projects.get(task.projectId));
        const project = legacyProjects.get(task.projectId);
        const flowKind = task.kind === "image" && project?.settings.image.provider === "flow" ? "image"
          : task.kind === "video" && project?.settings.video.provider === "flow" ? "video" : undefined;
        if (flowKind) task.pendingSubmission = { provider: "flow", kind: flowKind, startedAt: task.updatedAt };
        if (task.kind === "speech" && project?.settings.voice.provider === "elevenlabs") {
          task.pendingSubmission = { provider: "lumean", kind: "speech", startedAt: task.updatedAt };
        }
      }
      const reason = pendingSubmissionReason(task);
      if (reason && ["paused", "pending", "running", "retry_wait"].includes(task.status)) {
        task.status = "failed";
        task.retryBlockedReason = reason;
        task.error = `${NO_RETRY_MARKER}${reason}`;
        task.nextAttemptAt = undefined;
        task.pausedFrom = undefined;
        this.emit("warn", "queue.submission.uncertain_after_restart", this.taskDetails(task));
      }
    }
    // project.json и queue.json пишутся отдельно. Если приложение закрылось
    // между ними, восстанавливаем только локально запланированные image-задачи.
    // Старые TTS/Flow job ID и неопределённые платные отправки не повторяем.
    for (const assembly of this.tasks.filter(task => task.kind === "assemble" && task.status === "paused" && task.allowTimingExpansion)) {
      const project = await this.projects.get(assembly.projectId);
      if (project) this.ensureMeasuredTimingTasks(project, assembly, true);
    }
    for (const runId of new Set(this.tasks.map((task) => task.runId))) {
      const runTasks = this.tasks.filter((task) => task.runId === runId);
      if (runTasks.length > 0 && runTasks.every((task) => ["done", "failed", "blocked", "cancelled"].includes(task.status))) {
        this.reportedTerminalRuns.add(runId);
      }
    }
    await this.persist();
    await this.syncProjects();
    const restoredPaused = this.tasks.filter((task) => task.status === "paused");
    if (restoredPaused.length > 0) {
      this.emit("warn", "queue.restored_paused", {
        tasks: restoredPaused.length,
        projects: new Set(restoredPaused.map((task) => task.projectId)).size
      });
    }
  }

  private ensureMeasuredTimingTasks(project: Project, assembly: QueueTask, paused: boolean): number {
    const runTasks = this.tasks.filter(task => task.projectId === project.id && task.runId === assembly.runId);
    const hasTrackedScenes = runTasks.some(task => task.sceneId);
    let previous: QueueTask | undefined;
    let added = 0;
    for (const scene of project.scenes) {
      if (!scene.narrationSlice || scene.includeInAssembly === false) continue;
      // Сохранённый результат старого TTS теперь указывает на неизменяемую
      // общую дорожку, иначе syncProjects вернул бы перезаписываемый voice.wav.
      for (const speech of runTasks.filter(task => task.sceneId === scene.id && task.kind === "speech" && task.status === "done")) {
        speech.resultPath = scene.audioPath;
      }
      if (usesStockMedia(project, scene) || scene.id === scene.narrationSlice.sourceSceneId) continue;
      let image = runTasks.find(task => task.sceneId === scene.id && task.kind === "image");
      if (!image) {
        image = this.makeTask(assembly.runId, project, scene, "image", `Кадр по озвучке · сцена ${scene.order + 1}`,
          project.settings.image.sequential && previous ? [previous.id] : [], new Date().toISOString());
        image.scope = hasTrackedScenes ? assembly.scope : "scenes";
        if (scene.imagePath) {
          image.status = "done";
          image.progress = 100;
          image.resultPath = scene.imagePath;
        } else if (paused) {
          image.status = "paused";
          image.pausedFrom = "pending";
        }
        this.tasks.push(image);
        runTasks.push(image);
        added++;
      }
      assembly.dependsOn = [...new Set([...assembly.dependsOn, image.id])];
      previous = image;
    }
    return added;
  }

  private makeTask(
    runId: string,
    project: Project,
    scene: Scene | undefined,
    kind: TaskKind,
    label: string,
    dependsOn: string[],
    now: string
  ): QueueTask {
    return {
      id: createId("task"),
      runId,
      projectId: project.id,
      sceneId: scene?.id,
      kind,
      label,
      status: "pending",
      attempts: 0,
      maxAttempts: this.policy.maxAttempts,
      progress: 0,
      dependsOn,
      createdAt: now,
      updatedAt: now
    };
  }

  private async shouldSimulateFailure(task: QueueTask): Promise<boolean> {
    if (!task.sceneId || task.kind === "speech" || task.kind === "assemble") return false;
    const project = await this.projects.get(task.projectId);
    const scene = project?.scenes.find((candidate) => candidate.id === task.sceneId);
    return Boolean(scene && `${scene.imagePrompt}\n${scene.animationPrompt}`.includes("[FAIL]"));
  }

  private async executeTask(task: QueueTask, signal?: AbortSignal): Promise<string> {
    task.resultFallback = undefined;
    let project = await this.requireProject(task.projectId);
    // New AI Story media always uses connected Flow accounts, including older
    // projects. Existing files and remote receipts are left intact.
    if (project.mediaMode === 'ai' && task.kind !== 'assemble') {
      project = {...project, settings: {...project.settings,
        image: {...project.settings.image, provider: 'flow'},
        video: {...project.settings.video, provider: 'flow', model: /veo_3_1/i.test(project.settings.video.model)
          ? project.settings.video.model : 'veo_3_1_i2v_s_fast'}}};
      if (task.kind === 'speech' && project.settings.voice.provider !== 'elevenlabs')
        throw new Error(`${NO_RETRY_MARKER}Для новой озвучки AI Story выберите шаблон Lumean. Сохранённые голоса остаются в проекте.`);
    }
    await this.storage.ensureProject(project);
    if (task.kind === "assemble") {
      if (project.mediaMode === "stock" && project.settings.assembly.documentary?.version === 2) {
        await this.updateTaskRuntime(task.id, 1, "Монтаж: связываю кадры с готовой озвучкой");
        const scenes = await prepareDocumentaryTiming(projectForDisplay(project), this.storage);
        project = await this.projects.mutate(project.id, () => ({ scenes: planDocumentaryMontage({ ...project, scenes }) }));
        const readingSnapshot=projectForDisplay(project).scenes;
        if(readingSnapshot.some(s=>s.documentary?.motionGraphic?.enabled&&s.documentary.motionGraphic.kind==='quote'&&s.documentary.motionGraphic.quoteMode!=='phrase')){
          const reading=await prepareDocumentaryReading(projectForDisplay(project),join(this.storage.projectDirectory(project.id),'Documentary','Reading'),message=>{void this.updateTaskRuntime(task.id,2,message);},signal);
          project=await this.projects.mutate(project.id,current=>{
            if(!isDeepStrictEqual(projectForDisplay(current).scenes,readingSnapshot))throw new Error('Монтаж изменился во время синхронизации текста; озвучка сохранена');
            return {scenes:reading.scenes};
          });
        }
        const before = projectForDisplay(project).scenes;
        const compacted = await prepareDocumentaryExcerpts(projectForDisplay(project), this.storage.projectDirectory(project.id),
          (done, total) => { void this.updateTaskRuntime(task.id, 2, `Монтаж: подготавливаю выбранные фрагменты ${done}/${total}`); }, signal, join(dirname(this.storage.rootPath), "Materials"));
        signal?.throwIfAborted();
        if (compacted.count) project = await this.projects.mutate(project.id, current => {
          if (!isDeepStrictEqual(projectForDisplay(current).scenes, before)) throw new Error("Монтаж изменился во время сохранения фрагментов; исходники оставлены, повторите сборку");
          return rebaseDocumentaryExcerptMontage(current,compacted.scenes);
        });
        if(project.scenes.some(s=>s.includeInAssembly!==false&&s.documentary?.motionGraphic?.enabled&&(s.documentary.motionGraphic.kind==='map-route'||s.documentary.motionGraphic.kind==='map-locator'&&s.documentary.motionGraphic.cityDetail!==false))){
          await this.updateTaskRuntime(task.id,3,"Монтаж: подготавливаю карты и географические подписи");
          // Compare against the persisted form: JSON omits undefined fields from the new montage.
          const snapshot=projectForDisplay(await this.requireProject(project.id)).scenes;
          const mapped=await prepareDocumentaryMaps(this.storage.projectDirectory(project.id),snapshot);
          signal?.throwIfAborted();
          project=await this.projects.mutate(project.id,current=>{
            if(!isDeepStrictEqual(projectForDisplay(current).scenes,snapshot))throw new Error("Монтаж изменился во время подготовки карты; данные сохранены, повторите сборку");
            return {scenes:mapped};
          });
          for(const scene of mapped)if(scene.documentary?.motionGraphic?.detailError)this.emit('warn','documentary.map.overview',{projectId:project.id,sceneId:scene.id,reason:scene.documentary.motionGraphic.detailError});
        }
        await this.storage.ensureProject(project);
      }
      if (task.allowTimingExpansion && this.renderer.isAvailable?.()) {
        await this.updateTaskRuntime(task.id, 1, "Измеряю готовую озвучку перед сборкой");
        const expansion = await measuredStoryTimingExpansion(project, this.storage);
        if (expansion) throw expansion;
      }
      // This directory is internal preparation evidence, never an output video.
      if (task.prepareOnly) return this.storage.projectDirectory(project.id);
      this.emit("info", "queue.task.stage", { ...this.taskDetails(task), stage: "FFmpeg: собираю и кодирую Final.mp4" });
      let previousProgress = "";
      return this.renderer.render(project, (stage, progress) => {
        const key = `${Math.round(progress)}:${stage}`;
        if (key === previousProgress) return;
        previousProgress = key;
        void this.updateTaskRuntime(task.id, progress, stage);
      },signal);
    }
    if (task.kind === "director") return `local://${project.id}/scenario.json`;
    const scene = project.scenes.find((candidate) => candidate.id === task.sceneId);
    if (!scene) throw new Error("Сцена для задачи не найдена");
    if (task.kind === "image") {
      const realImageGeneration = project.settings.image.provider !== "mock-image";
      if (scene.imagePrompt.trim().length > 0 && realImageGeneration) {
        const size = project.aspectRatio === "9:16" ? "1080x1920" : project.aspectRatio === "1:1" ? "1024x1024" : "1920x1080";
        const prompt = buildImagePrompt(project, scene);
        const references = sceneImageReferences(project, scene);
        const [anyModelConfigured, flowConfigured] = await Promise.all([
          project.mediaMode !== 'ai' && this.anyModel ? this.anyModel.configured() : Promise.resolve(false),
          this.flow ? this.flow.configured("image") : Promise.resolve(false),
        ]);
        const available = new Set<ImageGenerationSource>();
        if (anyModelConfigured && this.anyModel) available.add("anymodel");
        if (flowConfigured && this.flow) available.add("flow");
        let imageJob = task.remoteJob?.kind === "image" ? task.remoteJob : undefined;
        const flowOnly = project.settings.image.provider === "flow" || Boolean(imageJob);
        const sources = (flowOnly ? ["flow" as const] : imageSourceOrder(scene.order)).filter((source) => available.has(source));
        // A known job must resume even if the account is currently cooling down.
        if (task.remoteJob?.kind === "image" && this.flow && !sources.includes("flow")) sources.push("flow");
        let raw: Buffer | undefined;
        let completedSource: ImageGenerationSource | undefined;
        const errors: Partial<Record<ImageGenerationSource, unknown>> = {};

        for (const [index, source] of sources.entries()) {
          const previousSource = sources[index - 1];
          if (previousSource) {
            this.emit("warn", "queue.task.image_fallback", {
              ...this.taskDetails(task),
              from: previousSource === "anymodel" ? "AnyModel" : "Google Flow",
              to: source === "anymodel" ? "AnyModel" : "Google Flow",
              reason: cleanErrorMessage(
                errors[previousSource] instanceof Error
                  ? errors[previousSource].message
                  : String(errors[previousSource])
              ),
            });
          }
          this.emit("info", "queue.task.stage", {
            ...this.taskDetails(task),
            imageSource: source,
            stage: source === "anymodel"
              ? `${previousSource ? "Google Flow не создал кадр — переключаюсь. " : ""}AnyModel: генерирую изображение`
              : `${previousSource ? "AnyModel не создал кадр — переключаюсь. " : ""}Google Flow: генерирую изображение`,
          });
          try {
            if (source === "anymodel" && this.anyModel) {
              const preferredModel = project.settings.image.provider === "gpt-image" ? "reference" : "primary";
              raw = await this.anyModel.generateImage(prompt, size, references, preferredModel);
            } else if (source === "flow" && this.flow) {
              const loaded = imageJob ? { images: [], failed: 0 } : await loadFlowReferences(references);
              if (loaded.failed > 0) {
                this.emit("warn", "queue.task.flow_reference_skipped", {
                  ...this.taskDetails(task),
                  failedReferences: loaded.failed,
                });
                throw new Error(`${NO_RETRY_MARKER}Не удалось прочитать ${loaded.failed} референс(а) Flow. Выберите доступные локальные файлы; генерация без заданного референса не запускается.`);
              }
              raw = await this.flow.generateImage({
                prompt,
                aspectRatio: project.aspectRatio,
                references: loaded.images,
                signal,
                resumeJob: imageJob,
                onBeforeSubmit: (accountId) => this.updateSubmission(task.id, { provider: "flow", kind: "image", accountId, startedAt: new Date().toISOString() }),
                onSubmitRejected: () => this.updateSubmission(task.id, undefined),
                onRemoteJob: async (remoteJob) => {
                  if (remoteJob) imageJob = remoteJob;
                  await this.updateTaskRuntime(task.id, undefined, undefined, remoteJob);
                },
                onProgress: (update) => this.updateTaskRuntime(task.id, update.percent, update.stage, update.remoteJob),
              });
            }
            if (raw) {
              completedSource = source;
              this.emit("info", "queue.task.image_provider_completed", {
                ...this.taskDetails(task),
                imageSource: source,
                provider: source === "anymodel" ? "AnyModel" : "Google Flow",
              });
              break;
            }
          } catch (error) {
            // Never turn an ambiguous submission / known remote job into a paid fallback.
            if (signal?.aborted || error instanceof FlowSubmissionUncertainError || imageJob) throw error;
            errors[source] = error;
          }
        }

        if (raw) {
          // Любой провайдер приводим к формату проекта, чтобы JPEG/WebP/3:2 не ломали монтаж.
          try {
            const framed = await normalizeImageAspect(raw, project.aspectRatio);
            return await this.storage.saveGeneratedImage(project, scene, framed);
          } catch (error) {
            if (completedSource === "flow" && !imageJob) throw new FlowSubmissionUncertainError("локальное сохранение уже созданного изображения");
            throw error;
          }
        }
        if (sources.length > 0) {
          const details = sources.map((source) => {
            const error = errors[source];
            const message = cleanErrorMessage(error instanceof Error ? error.message : String(error));
            return `${source === "anymodel" ? "AnyModel" : "Google Flow"}: ${message}`;
          });
          const permanent = sources.every((source) => {
            const error = errors[source];
            return isPermanentFailure(error instanceof Error ? error.message : String(error));
          });
          throw new Error(`${permanent ? NO_RETRY_MARKER : ""}Кадр не создан. ${details.join(". ")}`);
        }
        throw new Error(`${NO_RETRY_MARKER}${flowOnly ? "Google Flow недоступен — проверьте аккаунты и прокси в настройках." : "Провайдер изображений не настроен."} Кадр не создан; заглушка не будет подставлена.`);
      }
      if (realImageGeneration) throw new Error(`${NO_RETRY_MARKER}Пустой промпт изображения. Заполните его перед генерацией.`);
      this.emit("warn", "queue.task.placeholder_used", {
        ...this.taskDetails(task),
        reason: scene.imagePrompt.trim().length === 0
          ? "пустой промпт изображения"
          : !realImageGeneration
            ? "в проекте выбран тестовый Mock Image"
            : "AnyModel и Google Flow не настроены"
      });
      return this.storage.createPlaceholderImage(project, scene);
    }
    if (task.kind === "speech") {
      const speechText = documentaryNarrationText(project, task);
      const saveSpeech = async (audio: Buffer): Promise<string> => {
        if (!task.narrationSceneIds) return this.storage.saveGeneratedAudio(project, scene, audio);
        const directory = join(this.storage.projectDirectory(project.id), "Documentary", "Narration"); await mkdir(directory, { recursive: true });
        const audioPath = join(directory, `${createHash("sha256").update(audio).digest("hex")}.mp3`);
        await writeFile(audioPath, audio);
        await atomicWrite(join(directory, `${task.id}.json`), JSON.stringify({ text: speechText, sceneIds: task.narrationSceneIds, orderId: this.tasks.find(item => item.id === task.id)?.lumeanOrder?.orderId, audioPath }));
        await atomicWrite(`${audioPath}.json`, JSON.stringify({ text: speechText, sceneIds: task.narrationSceneIds, voice: project.settings.voice.voice, provider: project.settings.voice.provider }));
        const timing = await inspectNarration(audioPath);
        // Attach the actual voice before optional word alignment so a provider failure cannot hide it.
        await this.projects.mutate(project.id, current => {
          if (documentaryNarrationText(current, task) !== speechText) throw new Error("Текст изменился; общая озвучка сохранена, повторная отправка запрещена");
          return { scenes: distributeDocumentaryNarration(current, task.narrationSceneIds!, audioPath, timing) };
        });
        if (this.anyModel) await this.updateTaskRuntime(task.id, 96, "Привязываю смену кадров к словам в готовой озвучке");
        const alignment = this.anyModel ? await new DocumentaryIntelligence(this.anyModel, id => this.storage.projectDirectory(id)).alignNarration(project, audioPath, timing).catch(error => {
          this.emit("warn", "documentary.narration.estimated", { projectId: project.id, reason: `Озвучка готова. Привязка кадров пока приблизительная: ${error instanceof Error ? error.message : String(error)}` });
          return undefined;
        }) : undefined;
        await this.projects.mutate(project.id, current => {
          if (documentaryNarrationText(current, task) !== speechText) throw new Error("Текст изменился; общая озвучка сохранена, автоматическая повторная отправка запрещена");
          return { scenes: distributeDocumentaryNarration(current, task.narrationSceneIds!, audioPath, timing, alignment) };
        });
        return audioPath;
      };
      if (task.lumeanOrder && (project.settings.voice.provider !== "elevenlabs"
        || task.lumeanOrder.inputFingerprint !== speechOrderFingerprint(speechText, project.settings.voice.voice))) {
        throw new Error(`${NO_RETRY_MARKER}Текст или голос изменён после создания заказа Lumean. Сохранённый заказ не подходит этой сцене; новая платная отправка автоматически не выполняется.`);
      }
      // Провайдер "elevenlabs" = Voicer API: голос задаётся шаблоном (uuid в settings.voice.voice).
      if (project.settings.voice.provider === "elevenlabs" && speechText.trim().length > 0) {
        this.emit("debug", "queue.task.stage", { ...this.taskDetails(task), stage: "Генерирую озвучку через Lumean" });
        if (!this.voicer || !(await this.voicer.configured())) {
          throw new Error("В проекте выбран движок Lumean, но он не настроен. Добавьте ключ в Настройки → AI и сценарии или переключите движок озвучки.");
        }
        const templateUuid = project.settings.voice.voice?.trim() || undefined;
        const audio = await measureDocumentaryStage('narration',{projectId:project.id,sceneId:task.sceneId},()=>this.voicer!.tts(speechText, templateUuid, signal, {
          resumeOrderId: task.lumeanOrder?.orderId,
          onBeforeOrderCreate: () => this.updateSubmission(task.id, { provider: "lumean", kind: "speech", startedAt: new Date().toISOString() }),
          onOrderRejected: () => this.updateSubmission(task.id, undefined),
          onOrderKnown: (orderId) => this.updateLumeanOrder(task.id, { orderId, inputFingerprint: speechOrderFingerprint(speechText, templateUuid) }),
        }));
        return saveSpeech(audio);
      }
      if (this.anyModel && (await this.anyModel.configured()) && speechText.trim().length > 0) {
        this.emit("debug", "queue.task.stage", { ...this.taskDetails(task), stage: "Генерирую озвучку через AnyModel" });
        // Голос из настроек проекта важнее глобального; "custom" и пустое значение = глобальная настройка.
        const projectVoice = project.settings.voice.voice?.trim();
        const voiceOverride = projectVoice && projectVoice !== "custom" ? projectVoice : undefined;
        const audio = await measureDocumentaryStage('narration',{projectId:project.id,sceneId:task.sceneId},()=>this.anyModel!.textToSpeech(speechText, ttsLanguageCode(project.language), voiceOverride));
        return saveSpeech(audio);
      }
      if (project.settings.assembly.documentary?.version === 2) throw new Error(`${NO_RETRY_MARKER}Озвучка Stock не создана: подключите выбранный сервис голоса. Тестовый звук не подставляется.`);
      this.emit("warn", "queue.task.placeholder_used", {
        ...this.taskDetails(task),
        reason: scene.narration.trim().length === 0 ? "пустой текст озвучки" : "AnyModel не настроен"
      });
      return this.storage.createPlaceholderAudio(project, scene);
    }
    if (task.kind === "video" && project.settings.video.provider === "veo") {
      if (!this.veo || !(await this.veo.configured())) {
        throw new Error("Движок Veo не настроен — добавьте ключ Google AI Studio в Настройки → AI и сценарии");
      }
      // Переключатель «Анимация от первого кадра» действует одинаково для обоих движков.
      const startFrame = project.settings.video.startFrame && scene.imagePath
        ? await readFile(scene.imagePath).catch(() => undefined)
        : undefined;
      const prompt = scene.animationPrompt?.trim() || scene.imagePrompt;
      try {
        this.emit("info", "queue.task.stage", { ...this.taskDetails(task), stage: "Veo: запрос отправлен, ожидаю готовое видео" });
        return this.storage.saveGeneratedVideo(project, scene, await this.veo.generateVideo(prompt, project.aspectRatio, startFrame));
      } catch (error) {
        // Модель видео недоступна (нет биллинга) — не роняем весь ролик: сцена собирается из кадра
        // с движением камеры. Пользователь получает готовый Final.mp4 и предупреждение в журнале.
        const message = error instanceof Error ? error.message : String(error);
        if (!isPermanentFailure(message)) throw error;
        task.resultFallback = "static-image";
        this.emit("warn", "queue.task.video_fallback", {
          ...this.taskDetails(task),
          reason: cleanErrorMessage(message)
        });
        return this.renderer.renderScene(project, scene);
      }
    }
    if (task.kind === "video" && project.settings.video.provider === "flow") {
      if (project.settings.video.startFrame && project.settings.image.provider === "mock-image") {
        throw new Error(
          `${NO_RETRY_MARKER}Flow-видео остановлено: исходный кадр создан тестовым Mock Image и является BMP-заглушкой. `
          + "Выберите Nano Banana, GPT Image или AnyModel API, заново создайте изображения и затем повторите видео."
        );
      }
      // Уже принятое Flow-задание всегда пытаемся докачать по его
      // accountId: текущий configured() может вернуть false из-за cooldown/флага аккаунта.
      // Новый платный запрос при недоступном Flow не запускаем: готовый кадр
      // безопасно рендерим как статичную сцену и явно пишем о fallback в журнал.
      const hasPersistedFlowJob = task.remoteJob?.provider === "flow";
      let flowConfigured = false;
      let configurationFailure: unknown;
      if (this.flow && !hasPersistedFlowJob) {
        try {
          flowConfigured = await this.flow.configured("video");
        } catch (error) {
          configurationFailure = error;
        }
      }
      if (!hasPersistedFlowJob && !flowConfigured) {
        const reason = configurationFailure
          ? cleanErrorMessage(configurationFailure instanceof Error ? configurationFailure.message : String(configurationFailure))
          : "нет доступного Flow-аккаунта с видео";
        if (!(await hasLocalSceneImage(scene))) {
          throw new Error(`${NO_RETRY_MARKER}Flow недоступен (${reason}), а готовый кадр сцены не найден. Сначала создайте изображение.`);
        }
        this.emit("warn", "queue.task.video_fallback", {
          ...this.taskDetails(task),
          provider: "Google Flow",
          fallback: "static-image",
          reason,
        });
        task.resultFallback = "static-image";
        return this.renderer.renderScene(project, scene);
      }
      if (!this.flow) {
        // Эта ветка возможна только для сохранённого remoteJob. Не подменяем его
        // статикой: после восстановления FlowClient очередь должна продолжить именно его.
        throw new Error(`${NO_RETRY_MARKER}Flow-задание сохранено, но FlowClient сейчас недоступен. Повтор должен продолжить это же задание.`);
      }
      const startFrame = project.settings.video.startFrame && scene.imagePath
        ? await readFile(scene.imagePath).catch(() => undefined)
        : undefined;
      const prompt = scene.animationPrompt?.trim() || scene.imagePrompt;
      this.emit("info", "queue.task.stage", {
        ...this.taskDetails(task),
        stage: task.remoteJob
          ? "Flow: продолжаю готовое задание и скачивание без новой генерации"
          : "Flow: загружаю кадр и запускаю Veo",
      });
      // Если Flow ещё не принял платное задание и вернул постоянный отказ
      // (регион/доступ/исчерпанная квота), ролик всё равно можно закончить на
      // исходной картинке. Уже принятое или неоднозначное задание не скрываем
      // fallback-ом: его нужно безопасно докачать, не запуская Veo повторно.
      let remoteJobPersisted = Boolean(task.remoteJob);
      try {
        const video = await this.flow.generateVideo({
          prompt,
          aspectRatio: project.aspectRatio,
          durationSeconds: scene.durationSeconds,
          startFrame,
          model: project.settings.video.model,
          signal,
          resumeJob: task.remoteJob?.kind === "image" ? undefined : task.remoteJob,
          onBeforeSubmit: (accountId) => this.updateSubmission(task.id, { provider: "flow", kind: "video", accountId, startedAt: new Date().toISOString() }),
          onSubmitRejected: () => this.updateSubmission(task.id, undefined),
          onRemoteJob: async (remoteJob) => {
            await this.updateTaskRuntime(task.id, undefined, undefined, remoteJob);
            remoteJobPersisted = true;
          },
          onProgress: (update) => this.updateTaskRuntime(
            task.id,
            update.percent,
            update.stage,
            update.remoteJob
          ),
        });
        return this.storage.saveGeneratedVideo(project, scene, video);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (signal?.aborted || error instanceof FlowSubmissionUncertainError || remoteJobPersisted || !isPermanentFailure(message)) {
          throw error;
        }
        task.resultFallback = "static-image";
        this.emit("warn", "queue.task.video_fallback", {
          ...this.taskDetails(task),
          provider: "Google Flow",
          reason: cleanErrorMessage(message),
        });
        return this.renderer.renderScene(project, scene);
      }
    }
    if (task.kind === "video" && project.settings.video.provider === "anymodel-video") {
      if (!this.anyModel || !(await this.anyModel.configured())) throw new Error("AnyModel не настроен");
      this.emit("info", "queue.task.stage", { ...this.taskDetails(task), stage: "AnyModel: генерирую AI-видео" });
      const startFrame = project.settings.video.startFrame && scene.imagePath
        ? await readFile(scene.imagePath).catch(() => undefined)
        : undefined;
      return this.storage.saveGeneratedVideo(project, scene, await this.anyModel.generateVideo(scene.animationPrompt, scene.durationSeconds, project.aspectRatio, startFrame));
    }
    if (task.kind === "video") return this.renderer.renderScene(project, scene);
    throw new Error(`Неизвестный тип задачи: ${task.kind}`);
  }

  private scheduleFailure(task: QueueTask, error: unknown, nowTime: number): void {
    const raw = error instanceof Error ? error.message : String(error);
    task.progress = 0;
    task.error = cleanErrorMessage(raw);
    task.retryBlockedReason = pendingSubmissionReason(task) ?? lumeanRetryBlockedReason(error, task);
    task.stage = task.remoteJob?.provider === "flow"
      ? "Flow-задание сохранено — повтор продолжит скачивание без новой генерации"
      : task.lumeanOrder ? "Заказ Lumean сохранён — повтор проверит и скачает его без новой генерации" : undefined;
    // Нет доступа к модели — повтор даст ту же ошибку. 12 сцен × 3 попытки = 36 бессмысленных запросов.
    const localResourceFailure = /ENOSPC|ENOMEM|no space left|Недостаточно (?:места|памяти)/i.test(raw);
    if (localResourceFailure) task.stage = "Не хватает места или памяти — освободите ресурсы и нажмите «Повторить»";
    if (task.retryBlockedReason || localResourceFailure || isPermanentFailure(raw)) {
      task.status = "failed";
      task.nextAttemptAt = undefined;
      this.emit("error", "queue.task.failed_permanently", { ...this.taskDetails(task), error });
      return;
    }
    if (task.attempts < task.maxAttempts) {
      const policyDelay = this.policy.retryDelaysMs[
        Math.min(task.attempts - 1, this.policy.retryDelaysMs.length - 1)
      ] ?? 1000;
      // Google пишет точное время в 429: "Please retry in 38.7s". Ранний повтор только
      // снова расходует попытку, поэтому ждём указанное время (+1 секунда запаса).
      const retrySeconds = /retry in\s+([\d.]+)s/i.exec(raw)?.[1];
      const providerDelay = retrySeconds ? (Math.ceil(Number(retrySeconds)) + 1) * 1000 : 0;
      const delay = Math.max(policyDelay, Number.isFinite(providerDelay) ? providerDelay : 0);
      task.status = "retry_wait";
      task.nextAttemptAt = new Date(nowTime + delay).toISOString();
      this.emit("warn", "queue.task.retry_scheduled", { ...this.taskDetails(task), error });
    } else {
      task.status = "failed";
      task.nextAttemptAt = undefined;
      this.emit("error", "queue.task.failed", { ...this.taskDetails(task), error });
    }
  }

  private taskDetails(task: QueueTask): Record<string, unknown> {
    return {
      runId: task.runId,
      projectId: task.projectId,
      sceneId: task.sceneId,
      taskId: task.id,
      label: task.label,
      kind: task.kind,
      status: task.status,
      attempts: task.attempts,
      maxAttempts: task.maxAttempts,
      progress: task.progress,
      stage: task.stage,
      remoteMediaName: task.remoteJob?.mediaName,
      retryBlockedReason: task.retryBlockedReason,
      nextAttemptAt: task.nextAttemptAt,
      error: task.error ? cleanErrorMessage(task.error).slice(0, 500) : undefined,
      resultFile: task.resultPath ? basename(task.resultPath) : undefined
    };
  }

  private emit(level: LogLevel, message: string, details?: Record<string, unknown>): void {
    this.eventSink({ level, message, details });
  }

  private async updateTaskRuntime(
    taskId: string,
    progress?: number,
    stage?: string,
    remoteJob?: QueueTask["remoteJob"]
  ): Promise<void> {
    await this.mutate(async () => {
      const task = this.tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;
      // A late provider reply after Stop still contains a paid job worth preserving.
      if (task.status === "cancelled" && remoteJob) {
        task.remoteJob = remoteJob;
        task.pendingSubmission = undefined;
        task.updatedAt = new Date().toISOString();
        await this.persist();
        return;
      }
      if (!["running", "paused"].includes(task.status)) return;
      const nextProgress = progress === undefined ? task.progress : Math.max(task.progress, Math.max(0, Math.min(99, Math.round(progress))));
      if (!remoteJob && nextProgress === task.progress && (stage === undefined || stage === task.stage)) return;
      if (progress !== undefined) {
        task.progress = Math.max(task.progress, Math.max(0, Math.min(99, Math.round(progress))));
      }
      if (stage !== undefined) task.stage = stage;
      if (remoteJob) { task.remoteJob = remoteJob; task.pendingSubmission = undefined; }
      task.updatedAt = new Date().toISOString();
      await this.persist();
      this.emit("info", "queue.task.progress", this.taskDetails(task));
    });
  }

  private async updateSubmission(taskId: string, checkpoint: QueueTask["pendingSubmission"]): Promise<void> {
    await this.mutate(async () => {
      const task = this.tasks.find((candidate) => candidate.id === taskId);
      if (!task || (checkpoint && !["running", "paused"].includes(task.status))) {
        throw new Error(`${NO_RETRY_MARKER}Задача остановлена до отправки платного запроса.`);
      }
      const previous = task.pendingSubmission;
      task.pendingSubmission = checkpoint;
      try { await this.persist(); }
      catch (error) {
        task.pendingSubmission = previous;
        throw new Error(`${NO_RETRY_MARKER}Не удалось сохранить состояние отправки; новый запрос не отправлен. ${cleanErrorMessage(error instanceof Error ? error.message : String(error))}`);
      }
    });
  }

  private assertNoUncertainSubmission(projectId: string, scenes?: Set<string>, target = "all"): void {
    for (const task of this.tasks) {
      if (task.projectId !== projectId || task.status === "done") continue;
      if (scenes && (!task.sceneId || !scenes.has(task.sceneId))) continue;
      if (target !== "all" && task.kind !== (target === "audio" ? "speech" : target)) continue;
      const reason = pendingSubmissionReason(task);
      if (reason) throw new Error(`${NO_RETRY_MARKER}${reason}`);
    }
  }

  private async updateLumeanOrder(taskId: string, order: NonNullable<QueueTask["lumeanOrder"]>): Promise<void> {
    await this.mutate(async () => {
      const task = this.tasks.find(candidate => candidate.id === taskId);
      if (!task) throw new Error(`${NO_RETRY_MARKER}Не найдена задача для сохранения заказа Lumean.`);
      const previousOrder = task.lumeanOrder;
      const previousPending = task.pendingSubmission;
      task.lumeanOrder = order;
      task.pendingSubmission = undefined;
      try { await this.persist(); }
      catch (error) {
        task.lumeanOrder = previousOrder;
        task.pendingSubmission = previousPending;
        throw error;
      }
    });
  }

  private async syncProjects(): Promise<void> {
    const projectIds = [...new Set(this.tasks.map((task) => task.projectId))];
    for (const projectId of projectIds) {
      const tasks = this.tasks.filter((task) => task.projectId === projectId);
      if (tasks.length === 0) continue;
      // Percentages, polling timestamps and remote checkpoints belong to the
      // queue. Rewriting the whole project registry on each heartbeat flooded
      // renderer updates even though no project media/status had changed.
      const taskState = JSON.stringify(tasks.map(task => [task.id, task.runId, task.sceneId, task.narrationSceneIds,
        task.kind, task.status, task.label, task.scope, task.prepareOnly, task.resultPath, task.resultFallback]));
      if (this.syncedTaskStates.get(projectId) === taskState) continue;
      try {
        const completedRenderReport = this.renderer.lastRenderReport?.(projectId);
        const syncedProject = await this.projects.mutate(projectId, (project) => {
          const finishedAssembly = tasks.find(task => task.kind === "assemble" && !task.prepareOnly && task.status === "done");
          if (project.mediaMode === "stock" && project.settings.assembly.documentary?.version === 2
            && finishedAssembly && tasks.every(task => task.status === "done")
            && (project.scenes.some(scene => scene.includeInAssembly !== false && !documentaryMaterialUsable(scene))
              || !project.outputPath && Date.parse(project.updatedAt) > Date.parse(finishedAssembly.updatedAt))) {
            // Restart must not resurrect an old Final after a new selection or
            // explicit output invalidation. A genuinely newer completed render
            // can still be reconciled after a crash between queue/project saves.
            return { status: project.status === "complete" ? "ready" : project.status, outputPath: undefined, lastRender: undefined };
          }
          const trackedSceneIds = new Set(tasks.flatMap(task => task.narrationSceneIds ?? (task.sceneId ? [task.sceneId] : [])));
          // Ран без сценных задач: либо обычная пересборка, либо stock-ролик без озвучки.
          // Готовые stock-сцены не имеют своей queue task, но после assemble не должны оставаться queued.
          if (trackedSceneIds.size === 0) {
            const assembleTask = tasks.find((task) => task.kind === "assemble");
            const assembleStatus = assembleTask?.status === "done"
              ? assembleTask.prepareOnly ? "ready" as const : "complete" as const
              : assembleTask && ["failed", "blocked", "cancelled"].includes(assembleTask.status)
                ? "failed" as const
                : "generating" as const;
            return {
              status: assembleStatus,
              scenes: project.scenes.map((scene) => usesStockMedia(project, scene)
                ? { ...scene, status: "ready" as const }
                : scene),
              outputPath: assembleTask?.prepareOnly ? undefined : assembleStatus === "complete" ? assembleTask?.resultPath : project.outputPath,
              lastRender: assembleStatus === "complete" ? completedRenderReport ?? project.lastRender : project.lastRender
            };
          }
          const projectSceneIds = new Set(project.scenes.map((scene) => scene.id));
          const hasSceneGraphMismatch = [...trackedSceneIds].some((sceneId) => !projectSceneIds.has(sceneId))
            || project.scenes.some((scene) => scene.includeInAssembly !== false && !trackedSceneIds.has(scene.id) && !usesStockMedia(project, scene));
          const audioOnly = tasks.every((task) => task.kind === "speech");
          const isPartialRegeneration = tasks.some((task) => task.kind === "assemble" && task.label.startsWith("Пересборка Final.mp4 после"))
            || tasks.some((task) => task.scope === "scenes")
            || audioOnly;
          const hasAssembly = tasks.some((task) => task.kind === "assemble" && !task.prepareOnly);
          const stockMaterialsPending=project.mediaMode==='stock'&&project.settings.assembly.documentary?.version===2
            &&project.scenes.some(scene=>scene.includeInAssembly!==false&&!documentaryMaterialUsable(scene));
          const projectStatus = hasSceneGraphMismatch && !isPartialRegeneration
            ? "failed"
            : tasks.every((task) => task.status === "done")
              ? hasAssembly ? "complete" : stockMaterialsPending
                ? this.documentaryProductionActive(projectId) ? "generating"
                  : project.status === "generating" ? "failed" : project.status === "complete" ? "ready" : project.status
                : "ready"
              : tasks.some((task) => task.status === "failed" || task.status === "blocked" || task.status === "cancelled")
                ? "failed"
                : tasks.every((task) => task.status === "paused" || task.status === "done")
                  ? "paused"
                  : "generating";
          const scenes = project.scenes.map((scene) => {
            const sceneTasks = tasks.filter((task) => task.sceneId === scene.id);
            if (sceneTasks.length === 0) {
              if (scene.includeInAssembly === false) return scene;
              if (usesStockMedia(project, scene)) return { ...scene, status: "ready" as const };
              return isPartialRegeneration ? scene : { ...scene, status: "failed" as const };
            }
            const imageTask = sceneTasks.find((task) => task.kind === "image" && task.status === "done");
            const videoTask = sceneTasks.find((task) => task.kind === "video" && task.status === "done");
            const speechTask = sceneTasks.find((task) => task.kind === "speech" && task.status === "done");
            const status = sceneTasks.some((task) => task.status === "failed" || task.status === "blocked" || task.status === "cancelled")
              ? "failed"
              : sceneTasks.every((task) => task.status === "done")
                ? "ready"
                : sceneTasks.some((task) => task.status === "running")
                  ? "generating"
                  : "queued";
            return {
              ...scene,
              status,
              imagePath: imageTask?.resultPath ?? scene.imagePath,
              videoPath: videoTask?.resultPath ?? scene.videoPath,
              videoFallback: videoTask?.resultPath ? videoTask.resultFallback : scene.videoFallback,
              audioPath: speechTask?.resultPath ?? scene.audioPath
            } satisfies Scene;
          });
          const finalTask = tasks.find((task) => task.kind === "assemble" && !task.prepareOnly && task.status === "done");
          return {
            status: projectStatus,
            scenes,
            outputPath: projectStatus === "complete" ? finalTask?.resultPath ?? project.outputPath : undefined,
            lastRender: projectStatus === "complete" ? completedRenderReport ?? project.lastRender : project.lastRender
          };
        });
        if (syncedProject.status === "complete" && syncedProject.outputPath) {
          await this.storage.ensureProject(syncedProject);
        }
        for (const runId of new Set(tasks.map((task) => task.runId))) {
          const runTasks = tasks.filter((task) => task.runId === runId);
          const terminal = runTasks.every((task) => ["done", "failed", "blocked", "cancelled"].includes(task.status));
          if (!terminal || this.reportedTerminalRuns.has(runId)) continue;
          this.reportedTerminalRuns.add(runId);
          const failed = runTasks.filter((task) => ["failed", "blocked"].includes(task.status)).length;
          const cancelled = runTasks.filter((task) => task.status === "cancelled").length;
          if((failed||cancelled)&&syncedProject.mediaMode==='stock'&&runTasks.some(task=>task.kind==='assemble'))
            await finishDocumentaryMetrics(projectId,failed?'failed':'cancelled');
          const message = failed > 0 ? "queue.run.failed" : cancelled > 0 ? "queue.run.cancelled" : "queue.run.completed";
          this.emit(failed > 0 ? "error" : cancelled > 0 ? "warn" : "info", message, {
            projectId,
            runId,
            tasks: runTasks.length,
            completed: runTasks.filter((task) => task.status === "done").length,
            failed,
            cancelled
          });
        }
        this.syncedTaskStates.set(projectId, taskState);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("не найден")) throw error;
      }
    }
  }

  private async requireProject(projectId: string): Promise<Project> {
    const project = await this.projects.get(projectId);
    if (!project) throw new Error(`Проект ${projectId} не найден`);
    return project;
  }

  private forProject(projectId: string): QueueTask[] {
    return structuredClone(this.tasks.filter((task) => task.projectId === projectId));
  }

  private async persist(): Promise<void> {
    await this.repository.replace(this.tasks);
  }

  private async mutate<T>(action: () => Promise<T>): Promise<T> {
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
