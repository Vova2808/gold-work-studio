import type {
  Scene,
  VisualBeat,
  VisualBeatAiProposal,
  VisualBeatDimming,
  VisualBeatMotion,
  VisualBeatOverlay,
  VisualBeatRole,
  VisualBeatTemplate,
  VisualBeatTransition
} from "@gold-work/shared";

// Локальные runtime-копии public allowlist. TypeScript связывает их с shared-типами,
// а unit-тесты не зависят от того, успели ли пересобрать dist пакета shared.
const VISUAL_BEAT_TEMPLATES: readonly VisualBeatTemplate[] = [
  "full-media", "focus-text", "fact-card", "evidence-card", "compare-split", "timeline-links", "quick-montage",
  "stat-callout", "editorial-panel", "chapter-card", "quote-card", "checklist-grid"
];
const VISUAL_BEAT_ROLES: readonly VisualBeatRole[] = [
  "establish", "explain", "emphasize", "evidence", "compare", "connect", "montage"
];
const VISUAL_BEAT_OVERLAYS: readonly VisualBeatOverlay[] = ["none", "title", "keyword", "fact", "quote"];
const VISUAL_BEAT_DIMMING: readonly VisualBeatDimming[] = ["none", "soft", "strong"];
const VISUAL_BEAT_MOTIONS: readonly VisualBeatMotion[] = ["none", "push-in", "pull-out", "pan-left", "pan-right"];
const VISUAL_BEAT_TRANSITIONS: readonly VisualBeatTransition[] = ["hard", "mix", "fade"];

export type MontagePlannerScene = Pick<
  Scene,
  "id" | "order" | "title" | "narration" | "stockQuery" | "durationSeconds" | "durationOverrideSeconds"
>;

export interface MontagePlannerOptions {
  density?: "calm" | "balanced" | "dynamic";
  /** Любое входное значение нормализуется в 0–35. */
  graphicBeatPercent?: number;
  /** Любое входное значение нормализуется в 70–85. */
  hardCutPercent?: number;
  /** Неструктурированный JSON от AI; неизвестные поля и значения игнорируются. */
  aiProposals?: Readonly<Record<string, readonly unknown[]>>;
}

export interface MontagePlanStats {
  sceneCount: number;
  beatCount: number;
  graphicBeatCount: number;
  graphicBeatPercent: number;
  hardCutCount: number;
  hardCutPercent: number;
  mixCount: number;
  fadeCount: number;
}

export interface MontagePlan {
  version: 1;
  beatsByScene: Record<string, VisualBeat[]>;
  beats: VisualBeat[];
  stats: MontagePlanStats;
  /** Исправления не блокируют сборку: план всегда остаётся пригодным для локального fallback. */
  issues: string[];
}

export interface SanitizedVisualBeatProposal {
  proposal: VisualBeatAiProposal;
  issues: string[];
}

const GRAPHIC_TEMPLATES = new Set<VisualBeatTemplate>([
  "focus-text",
  "fact-card",
  "evidence-card",
  "compare-split",
  "timeline-links",
  "stat-callout",
  "editorial-panel",
  "chapter-card",
  "quote-card",
  "checklist-grid"
]);

const GRAPHIC_SEQUENCE: readonly VisualBeatTemplate[] = [
  "focus-text",
  "editorial-panel",
  "stat-callout",
  "fact-card",
  "evidence-card",
  "compare-split",
  "timeline-links"
];

const DEFAULT_OPTIONS = {
  density: "balanced",
  graphicBeatPercent: 28,
  hardCutPercent: 78
} as const;

const TEMPLATE_DEFAULTS: Record<VisualBeatTemplate, Pick<VisualBeat, "role" | "overlay" | "dimming">> = {
  "full-media": { role: "explain", overlay: "none", dimming: "none" },
  "focus-text": { role: "emphasize", overlay: "keyword", dimming: "strong" },
  "fact-card": { role: "explain", overlay: "fact", dimming: "soft" },
  "evidence-card": { role: "evidence", overlay: "title", dimming: "soft" },
  "compare-split": { role: "compare", overlay: "keyword", dimming: "soft" },
  "timeline-links": { role: "connect", overlay: "title", dimming: "soft" },
  "quick-montage": { role: "montage", overlay: "none", dimming: "none" },
  "stat-callout": { role: "emphasize", overlay: "fact", dimming: "soft" },
  "editorial-panel": { role: "explain", overlay: "title", dimming: "none" },
  "chapter-card": { role: "establish", overlay: "title", dimming: "none" },
  "quote-card": { role: "emphasize", overlay: "quote", dimming: "soft" },
  "checklist-grid": { role: "connect", overlay: "title", dimming: "soft" }
};

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isAllowed<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function normalizedOptions(options: MontagePlannerOptions = {}): Required<Omit<MontagePlannerOptions, "aiProposals">> {
  return {
    density: options.density === "calm" || options.density === "dynamic" ? options.density : DEFAULT_OPTIONS.density,
    graphicBeatPercent: clamp(options.graphicBeatPercent ?? DEFAULT_OPTIONS.graphicBeatPercent, 0, 35),
    hardCutPercent: clamp(options.hardCutPercent ?? DEFAULT_OPTIONS.hardCutPercent, 70, 85)
  };
}

/**
 * Превращает произвольный AI JSON в безопасную конфигурацию. Неизвестные поля,
 * включая duration/CSS/координаты, намеренно не попадают в результат.
 */
export function sanitizeVisualBeatProposal(input: unknown, fallback: VisualBeatAiProposal): SanitizedVisualBeatProposal {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const issues: string[] = [];
  if (source !== input) issues.push("AI beat is not an object; local fallback used");

  const take = <T extends string>(
    key: keyof VisualBeatAiProposal,
    allowed: readonly T[],
    defaultValue: T | undefined
  ): T | undefined => {
    const value = source[key];
    if (value === undefined) return defaultValue;
    if (isAllowed(allowed, value)) return value;
    issues.push(`AI ${String(key)} is outside the allowlist; local fallback used`);
    return defaultValue;
  };

  const known = new Set(["role", "template", "overlay", "dimming", "motion", "transition"]);
  const ignored = Object.keys(source).filter((key) => !known.has(key));
  if (ignored.length > 0) issues.push(`Ignored forbidden AI fields: ${ignored.sort().join(", ")}`);

  return {
    proposal: {
      role: take("role", VISUAL_BEAT_ROLES, fallback.role),
      template: take("template", VISUAL_BEAT_TEMPLATES, fallback.template),
      overlay: take("overlay", VISUAL_BEAT_OVERLAYS, fallback.overlay),
      dimming: take("dimming", VISUAL_BEAT_DIMMING, fallback.dimming),
      motion: take("motion", VISUAL_BEAT_MOTIONS, fallback.motion),
      transition: take("transition", VISUAL_BEAT_TRANSITIONS, fallback.transition)
    },
    issues
  };
}

function sceneDuration(scene: MontagePlannerScene): number {
  const preferred = scene.durationOverrideSeconds ?? scene.durationSeconds;
  return roundSeconds(Math.max(0.1, Number.isFinite(preferred) ? preferred : 0.1));
}

function beatCountForScene(duration: number, globalStartSeconds: number, density: "calm" | "balanced" | "dynamic"): number {
  const bodyTarget = density === "calm" ? 5 : density === "dynamic" ? 3 : 4;
  const maximum = density === "calm" ? 4 : density === "dynamic" ? 6 : 5;
  if (globalStartSeconds < 10) {
    // Hook gets faster visual changes, while narration remains one uninterrupted TTS scene.
    return Math.max(1, Math.min(maximum, Math.ceil(duration / 2.6)));
  }
  return Math.max(1, Math.min(maximum, Math.round(duration / bodyTarget)));
}

function distributeDuration(duration: number, count: number, globalStartSeconds: number): number[] {
  if (count <= 1) return [duration];
  if (globalStartSeconds < 10 && count === 3 && duration >= 6) {
    // Первые два коротких удара удерживают хук; остаток становится обычным body-кадром/hold.
    const first = Math.min(2.25, duration / 3);
    const second = Math.min(2.25, (duration - first) / 2);
    return [roundSeconds(first), roundSeconds(second), roundSeconds(duration - first - second)];
  }
  const result: number[] = [];
  let allocated = 0;
  for (let index = 0; index < count; index += 1) {
    const next = index === count - 1
      ? duration - allocated
      : Math.round((duration / count) * 1000) / 1000;
    result.push(roundSeconds(next));
    allocated += next;
  }
  return result;
}

function tokens(scene: MontagePlannerScene): Set<string> {
  const value = `${scene.stockQuery ?? ""} ${scene.title} ${scene.narration.slice(0, 180)}`.toLocaleLowerCase();
  return new Set((value.match(/[\p{L}\p{N}]+/gu) ?? []).filter((token) => token.length >= 4));
}

function scenesAreRelated(previous: MontagePlannerScene | undefined, current: MontagePlannerScene): boolean {
  if (!previous) return false;
  const before = tokens(previous);
  const after = tokens(current);
  let overlap = 0;
  for (const token of before) {
    if (after.has(token)) overlap += 1;
    if (overlap >= 2) return true;
  }
  return false;
}

function sceneHasStatValue(scene: MontagePlannerScene): boolean {
  const meaningfulTitle = scene.title.replace(
    /^(?:сцена|часть|глава|scene|part|chapter)\s*#?\s*\d+\s*[:.\u2014\u2013-]?\s*/iu,
    ""
  );
  return /\d/u.test(scene.narration) || /\d/u.test(meaningfulTitle);
}

function sceneHasExplicitQuote(scene: MontagePlannerScene): boolean {
  return /(?:[«“„"])[^»”"]{4,180}(?:[»”"])/u.test(scene.narration);
}

function sceneHasChecklist(scene: MontagePlannerScene): boolean {
  const numberedOrBulleted = /(?:^|\n)\s*(?:[-–—•]|\d+[.)])\s+\S/um.test(scene.narration);
  const processMarkers = scene.narration.match(
    /(?:^|[^\p{L}\p{N}])(?:сначала|затем|потом|далее|после\s+этого|наконец|во-первых|во-вторых|во-третьих|first|second|third|then|next|finally)(?=$|[^\p{L}\p{N}])/giu
  ) ?? [];
  const announcedList = /(?:^|[^\p{L}\p{N}])(?:2|3|4|5|два|две|три|четыре|пять|two|three|four|five)\s+(?:шаг\p{L}*|причин\p{L}*|признак\p{L}*|правил\p{L}*|способ\p{L}*|ошиб\p{L}*|steps?|reasons?|signs?|rules?|ways?|mistakes?)(?=$|[^\p{L}\p{N}])/iu
    .test(scene.narration);
  return numberedOrBulleted || processMarkers.length >= 2 || announcedList;
}

function baseTemplate(
  globalBeatIndex: number,
  graphicBudget: number,
  totalBeats: number,
  context: Pick<BeatContext, "actBoundary" | "statEligible" | "quoteEligible" | "checklistEligible" | "chapterEligible">
): VisualBeatTemplate {
  // One deliberate opener is enough locally. AI may still place chapter-card
  // on a real act boundary, but the fallback never turns every act into a card.
  if (graphicBudget > 0 && globalBeatIndex === 0) return "chapter-card";
  const graphicsBefore = Math.floor(globalBeatIndex * graphicBudget / Math.max(1, totalBeats));
  const graphicsAfter = Math.floor((globalBeatIndex + 1) * graphicBudget / Math.max(1, totalBeats));
  if (graphicsAfter > graphicsBefore) {
    if (context.quoteEligible) return "quote-card";
    if (context.checklistEligible) return "checklist-grid";
    const template = GRAPHIC_SEQUENCE[graphicsBefore % GRAPHIC_SEQUENCE.length]!;
    return template === "stat-callout" && !context.statEligible ? "editorial-panel" : template;
  }
  // Не допускаем три одинаковых full-media подряд даже среди неграфических тактов.
  return globalBeatIndex % 3 === 2 ? "quick-montage" : "full-media";
}

function motionFor(index: number, template: VisualBeatTemplate): VisualBeatMotion {
  if (
    template === "focus-text" || template === "fact-card" || template === "evidence-card" ||
    template === "stat-callout" || template === "chapter-card" || template === "quote-card" || template === "checklist-grid"
  ) return "push-in";
  const motions: readonly VisualBeatMotion[] = ["push-in", "pull-out", "pan-left", "pan-right"];
  return motions[index % motions.length]!;
}

interface BeatContext {
  actBoundary: boolean;
  relatedToPrevious: boolean;
  statEligible: boolean;
  quoteEligible: boolean;
  checklistEligible: boolean;
  chapterEligible: boolean;
}

function buildFallback(scenesInput: readonly MontagePlannerScene[], options: MontagePlannerOptions): {
  beats: VisualBeat[];
  contexts: BeatContext[];
} {
  const settings = normalizedOptions(options);
  const scenes = [...scenesInput].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const counts: number[] = [];
  let globalStartSeconds = 0;
  for (const scene of scenes) {
    const duration = sceneDuration(scene);
    counts.push(beatCountForScene(duration, globalStartSeconds, settings.density));
    globalStartSeconds += duration;
  }
  const totalBeats = counts.reduce((sum, count) => sum + count, 0);
  const graphicBudget = Math.min(
    Math.floor(totalBeats * 0.35),
    Math.round(totalBeats * settings.graphicBeatPercent / 100)
  );
  const boundarySceneIndexes = new Set(
    scenes.length >= 3
      ? [Math.round(scenes.length / 3), Math.round(scenes.length * 2 / 3)].filter((index) => index > 0 && index < scenes.length)
      : []
  );

  const beats: VisualBeat[] = [];
  const contexts: BeatContext[] = [];
  globalStartSeconds = 0;
  let globalBeatIndex = 0;
  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex += 1) {
    const scene = scenes[sceneIndex]!;
    const durations = distributeDuration(sceneDuration(scene), counts[sceneIndex]!, globalStartSeconds);
    let sceneStartSeconds = 0;
    const sceneRelated = scenesAreRelated(scenes[sceneIndex - 1], scene);
    const statEligible = sceneHasStatValue(scene);
    const quoteEligible = sceneHasExplicitQuote(scene);
    const checklistEligible = sceneHasChecklist(scene);
    for (let beatIndex = 0; beatIndex < durations.length; beatIndex += 1) {
      const actBoundary = beatIndex === 0 && boundarySceneIndexes.has(sceneIndex);
      const chapterEligible = globalBeatIndex === 0 || actBoundary;
      const context: BeatContext = { actBoundary, relatedToPrevious: false, statEligible, quoteEligible, checklistEligible, chapterEligible };
      const template = baseTemplate(globalBeatIndex, graphicBudget, totalBeats, context);
      const defaults = TEMPLATE_DEFAULTS[template];
      const relatedToPrevious = globalBeatIndex > 0 && (beatIndex > 0 || sceneRelated);
      const transition: VisualBeatTransition = actBoundary
        ? "fade"
        : relatedToPrevious && globalBeatIndex % 5 === 0
          ? "mix"
          : "hard";
      beats.push({
        id: `${scene.id}-beat-${beatIndex + 1}`,
        sceneId: scene.id,
        order: beatIndex,
        startSeconds: roundSeconds(sceneStartSeconds),
        durationSeconds: durations[beatIndex]!,
        role: globalBeatIndex === 0 ? "establish" : defaults.role,
        template,
        overlay: defaults.overlay,
        dimming: defaults.dimming,
        motion: motionFor(globalBeatIndex, template),
        transition: globalBeatIndex === 0 ? "hard" : transition,
        relatedToPrevious
      });
      contexts.push({ actBoundary, relatedToPrevious, statEligible, quoteEligible, checklistEligible, chapterEligible });
      sceneStartSeconds += durations[beatIndex]!;
      globalBeatIndex += 1;
    }
    globalStartSeconds += sceneDuration(scene);
  }
  return { beats, contexts };
}

function nonGraphicReplacement(index: number): Pick<VisualBeat, "template" | "role" | "overlay" | "dimming"> {
  const template: VisualBeatTemplate = index % 3 === 2 ? "quick-montage" : "full-media";
  return { template, ...TEMPLATE_DEFAULTS[template] };
}

function enforceGrammar(
  candidates: readonly VisualBeat[],
  fallbacks: readonly VisualBeat[],
  contexts: readonly BeatContext[],
  options: MontagePlannerOptions,
  initialIssues: readonly string[] = []
): { beats: VisualBeat[]; issues: string[] } {
  const settings = normalizedOptions(options);
  const issues = [...initialIssues];
  const maximumGraphics = Math.floor(candidates.length * Math.min(35, settings.graphicBeatPercent) / 100);
  let graphicCount = 0;
  const beats: VisualBeat[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const fallback = fallbacks[index]!;
    const context = contexts[index]!;
    let beat: VisualBeat = {
      ...fallback,
      role: candidate.role,
      template: candidate.template,
      overlay: candidate.overlay,
      dimming: candidate.dimming,
      motion: candidate.motion,
      transition: candidate.transition,
      relatedToPrevious: context.relatedToPrevious
    };

    if (beat.template === "stat-callout" && !context.statEligible) {
      beat = { ...beat, template: "editorial-panel", ...TEMPLATE_DEFAULTS["editorial-panel"] };
      issues.push(`Beat ${beat.id}: stat-callout requires a number, amount or percentage; editorial-panel used`);
    }

    if (beat.template === "quote-card" && !context.quoteEligible) {
      beat = { ...beat, template: "editorial-panel", ...TEMPLATE_DEFAULTS["editorial-panel"] };
      issues.push(`Beat ${beat.id}: quote-card requires an explicit quotation; editorial-panel used`);
    }

    if (beat.template === "checklist-grid" && !context.checklistEligible) {
      beat = { ...beat, template: "editorial-panel", ...TEMPLATE_DEFAULTS["editorial-panel"] };
      issues.push(`Beat ${beat.id}: checklist-grid requires an explicit list or ordered process; editorial-panel used`);
    }

    if (beat.template === "chapter-card" && !context.chapterEligible) {
      beat = { ...beat, template: "focus-text", ...TEMPLATE_DEFAULTS["focus-text"] };
      issues.push(`Beat ${beat.id}: chapter-card is reserved for the hook or an act boundary; focus-text used`);
    }

    if (GRAPHIC_TEMPLATES.has(beat.template)) {
      if (graphicCount >= maximumGraphics) {
        beat = { ...beat, ...nonGraphicReplacement(index) };
        issues.push(`Beat ${beat.id}: graphic share was capped at 35%`);
      } else {
        graphicCount += 1;
      }
    }

    const previous = beats[index - 1];
    const beforePrevious = beats[index - 2];
    if (previous && beforePrevious && previous.template === beat.template && beforePrevious.template === beat.template) {
      if (GRAPHIC_TEMPLATES.has(beat.template)) graphicCount -= 1;
      const replacementTemplate: VisualBeatTemplate = beat.template === "full-media" ? "quick-montage" : "full-media";
      beat = { ...beat, template: replacementTemplate, ...TEMPLATE_DEFAULTS[replacementTemplate] };
      issues.push(`Beat ${beat.id}: third identical template replaced`);
    }

    if (index === 0) beat.transition = "hard";
    else if (context.actBoundary) {
      if (beat.transition !== "fade") issues.push(`Beat ${beat.id}: act boundary normalized to fade`);
      beat.transition = "fade";
    } else if (beat.transition === "fade") {
      beat.transition = "hard";
      issues.push(`Beat ${beat.id}: fade is allowed only at an act boundary`);
    } else if (beat.transition === "mix" && !context.relatedToPrevious) {
      beat.transition = "hard";
      issues.push(`Beat ${beat.id}: unrelated mix replaced with hard cut`);
    }
    beats.push(beat);
  }

  const desiredHard = Math.round(beats.length * settings.hardCutPercent / 100);
  const minimumHard = Math.ceil(beats.length * 0.70);
  const maximumHard = Math.floor(beats.length * 0.85);
  const targetHard = Math.min(maximumHard, Math.max(minimumHard, desiredHard));
  let hardCount = beats.filter((beat) => beat.transition === "hard").length;

  if (hardCount < targetHard) {
    for (let index = beats.length - 1; index > 0 && hardCount < targetHard; index -= 1) {
      if (beats[index]!.transition !== "mix") continue;
      beats[index] = { ...beats[index]!, transition: "hard" };
      hardCount += 1;
    }
  } else if (hardCount > targetHard) {
    for (let index = 1; index < beats.length && hardCount > targetHard; index += 1) {
      if (beats[index]!.transition !== "hard" || !contexts[index]!.relatedToPrevious || contexts[index]!.actBoundary) continue;
      beats[index] = { ...beats[index]!, transition: "mix" };
      hardCount -= 1;
    }
  }

  return { beats, issues };
}

function proposalFromBeat(beat: VisualBeat): VisualBeatAiProposal {
  return {
    role: beat.role,
    template: beat.template,
    overlay: beat.overlay,
    dimming: beat.dimming,
    motion: beat.motion,
    transition: beat.transition
  };
}

function createPlan(beats: VisualBeat[], issues: string[]): MontagePlan {
  const beatsByScene: Record<string, VisualBeat[]> = {};
  for (const beat of beats) (beatsByScene[beat.sceneId] ??= []).push(beat);
  const graphicBeatCount = beats.filter((beat) => GRAPHIC_TEMPLATES.has(beat.template)).length;
  const hardCutCount = beats.filter((beat) => beat.transition === "hard").length;
  const mixCount = beats.filter((beat) => beat.transition === "mix").length;
  const fadeCount = beats.filter((beat) => beat.transition === "fade").length;
  const percent = (count: number): number => beats.length === 0 ? 0 : Math.round(count * 1000 / beats.length) / 10;
  return {
    version: 1,
    beatsByScene,
    beats,
    issues,
    stats: {
      sceneCount: Object.keys(beatsByScene).length,
      beatCount: beats.length,
      graphicBeatCount,
      graphicBeatPercent: percent(graphicBeatCount),
      hardCutCount,
      hardCutPercent: percent(hardCutCount),
      mixCount,
      fadeCount
    }
  };
}

/** Создаёт универсальный локальный план и безопасно накладывает bounded AI-предложения. */
export function planMontage(scenes: readonly MontagePlannerScene[], options: MontagePlannerOptions = {}): MontagePlan {
  const { beats: fallbackBeats, contexts } = buildFallback(scenes, options);
  const issues: string[] = [];
  const candidates = fallbackBeats.map((fallback) => {
    const sceneProposals = options.aiProposals?.[fallback.sceneId];
    const raw = sceneProposals?.[fallback.order];
    if (raw === undefined) return fallback;
    const sanitized = sanitizeVisualBeatProposal(raw, proposalFromBeat(fallback));
    issues.push(...sanitized.issues.map((issue) => `${fallback.id}: ${issue}`));
    return { ...fallback, ...sanitized.proposal } as VisualBeat;
  });
  const validated = enforceGrammar(candidates, fallbackBeats, contexts, options, issues);
  return createPlan(validated.beats, validated.issues);
}

/** Короткое имя для основной интеграционной точки сценарий → монтажный план. */
export const createLocalMontagePlan = planMontage;

/** Короткое имя для проверки одного bounded AI-объекта до добавления в план. */
export const validateAiMontageProposal = sanitizeVisualBeatProposal;

/**
 * Валидирует сохранённый/внешний план. Геометрия и количество тактов всегда
 * восстанавливаются локально, поэтому AI не может навязать длительности или координаты.
 */
export function validateMontagePlan(
  candidate: Pick<MontagePlan, "beatsByScene"> | undefined,
  scenes: readonly MontagePlannerScene[],
  options: MontagePlannerOptions = {}
): MontagePlan {
  if (!candidate) return planMontage(scenes, options);
  const { beats: fallbackBeats, contexts } = buildFallback(scenes, options);
  const issues: string[] = [];
  const candidates = fallbackBeats.map((fallback) => {
    const raw = candidate.beatsByScene[fallback.sceneId]?.[fallback.order];
    if (!raw) {
      issues.push(`${fallback.id}: missing beat restored from local fallback`);
      return fallback;
    }
    const sanitized = sanitizeVisualBeatProposal(raw, proposalFromBeat(fallback));
    issues.push(...sanitized.issues.map((issue) => `${fallback.id}: ${issue}`));
    return { ...fallback, ...sanitized.proposal } as VisualBeat;
  });
  const validated = enforceGrammar(candidates, fallbackBeats, contexts, options, issues);
  return createPlan(validated.beats, validated.issues);
}

/** Короткое имя для загрузки/очистки сохранённого или AI-плана. */
export const sanitizeMontagePlan = validateMontagePlan;

/** Записывает тот же проверенный план в сцены для preview и финального renderer. */
export function applyMontagePlanToScenes<T extends MontagePlannerScene>(
  scenes: readonly T[],
  plan: MontagePlan
): Array<T & { visualBeats: VisualBeat[] }> {
  return scenes.map((scene) => ({
    ...scene,
    visualBeats: (plan.beatsByScene[scene.id] ?? []).map((beat) => ({ ...beat }))
  }));
}
