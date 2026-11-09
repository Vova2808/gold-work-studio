import type { ProjectService } from "@gold-work/core";
import { stat } from "node:fs/promises";
import type {
  AutoStockFailure,
  AutoStockProgress,
  AutoStockSelectionOptions,
  AutoStockSelectionResult,
  Project,
  Scene,
  StockAsset,
  StockAssetSource,
  StockMediaVariant,
  StockMediaType,
  StockOrientation,
  StockProvider,
  StockSettings
} from "@gold-work/shared";
import type { LocalProjectStorage } from "./local-project-storage.js";
import type { DownloadedStockAsset, StockClient } from "./stock-client.js";

type ProjectAccess = Pick<ProjectService, "get" | "update">;
type StockAccess = Pick<StockClient, "search" | "download" | "downloadPreview">;
type StockSettingsAccess = { publicSettings(): Promise<StockSettings> };
type ProjectStorageAccess = Pick<LocalProjectStorage, "ensureProject" | "saveStockAsset" | "writeSceneManifest">;
type StockLog = (level: "info" | "warn", message: string, details?: Record<string, unknown>) => void;
type ApplyStageListener = (stage: "downloading" | "applying") => void;

const MAX_SEARCH_ATTEMPTS = 24;
const MAX_DOWNLOAD_CANDIDATES_PER_SEARCH = 3;
const SEARCH_RESULTS_PER_PAGE = 30;
const MAX_QUERY_WORDS = 6;
const MAX_QUERY_LENGTH = 72;
const VIDEO_MOTION_THRESHOLD = 2.5;
const SEARCH_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "from", "with", "without", "by",
  "into", "through", "across", "near", "beside", "behind", "under", "over", "inside", "outside", "this", "that",
  "these", "those", "its", "his", "her", "their", "is", "are", "was", "were", "be", "being", "been", "show", "shows", "showing", "shown",
  "feature", "features", "featuring", "visible", "wearing", "looking", "view", "moment", "leading", "ending",
  "toward", "towards", "no", "not", "people",
  "cinematic", "photorealistic", "realistic", "photo", "image", "shot", "scene", "frame", "closeup", "close-up", "lighting",
  "light", "dramatic", "moody", "atmospheric", "professional", "detailed", "high", "quality", "resolution", "4k",
  "8k", "bokeh", "shallow", "depth", "field", "composition", "style", "color", "grading", "text", "caption",
  "logo", "watermark", "stock", "camera", "lens", "angle", "wide", "vertical", "horizontal", "extreme", "macro",
  "medium", "tight", "straight-on", "top-down", "low", "warm", "cold", "faint",
  "без", "для", "или", "как", "при", "это", "этот", "эта", "эти", "из", "на", "над", "под", "около",
  "рядом", "через", "между", "внутри", "снаружи", "показывает", "показан", "показана", "виден", "видна",
  "кинематографичный", "кинематографический", "фотореализм", "фотореалистичный", "реалистичный", "изображение",
  "фотография", "кадр", "сцена", "свет", "освещение", "стиль", "текст", "текста", "надпись", "надписей",
  "логотип", "водяной", "знак", "детализированный", "профессиональный", "камера", "объектив", "ракурс"
]);

const GENERIC_SEARCH_WORDS = new Set([
  "documentary", "story", "stories", "mystery", "mysterious", "history", "video", "content", "background",
  "документальный", "история", "истории", "тайна", "загадочный", "видео", "контент", "фон"
]);

const SUBJECT_MOTION_STEMS = [
  "arriv", "approach", "driv", "speed", "run", "walk", "chase", "pursu", "enter", "leav", "opening", "opens", "closing", "closes",
  "search", "inspect", "examin", "arrest", "handcuff", "fight", "escap", "follow", "mov", "turn", "push", "press",
  "pour", "flow", "rain", "burn", "flash", "type", "speak", "talk", "gesture", "dance", "jump", "fall", "crawl",
  "sway", "curl", "rise", "flicker", "trembl", "slide", "tighten", "reced", "depart",
  "подъезжа", "прибыва", "едет", "ехал", "беж", "идёт", "идет", "заход", "вход", "выход", "открыва",
  "закрыва", "обыскива", "ищет", "осматрива", "задерж", "наручник", "преслед", "погон", "убега", "движ",
  "поворачива", "льётся", "льется", "течёт", "течет", "дожд", "горит", "мига", "печатает", "говорит",
  "прыга", "падает", "ползёт", "ползет"
] as const;

const DYNAMIC_PHRASES = [
  "police car", "moving traffic", "busy street", "running shower", "flowing water", "flashing lights", "security camera video",
  "security camera footage", "surveillance video", "surveillance footage", "body camera", "bodycam", "толпа движется",
  "полицейская машина едет", "машина подъезжает",
  "льется вода", "льётся вода", "мигающие огни", "запись видеокамеры"
] as const;

const STATIC_PHRASES = [
  "old photograph", "printed photo", "still photograph", "close-up photograph", "security camera still", "surveillance still",
  "document on table", "documents on table", "key on table", "map on table", "newspaper clipping", "evidence photo",
  "старая фотография", "фотография на столе", "стоп-кадр", "документ на столе", "документы на столе",
  "ключ на столе", "карта на столе", "газетная вырезка", "фотография улики"
] as const;

const STATIC_OBJECT_STEMS = [
  "photograph", "portrait", "document", "paper", "letter", "newspaper", "receipt", "key", "map", "blueprint", "diagram",
  "фотограф", "портрет", "документ", "бумаг", "письм", "газет", "чек", "ключ", "карт", "чертёж", "чертеж", "схем"
] as const;

const CAMERA_MOTION_STEMS = [
  "pan", "zoom", "dolly", "track", "push", "pull", "orbit", "tilt", "handheld", "camera movement", "camera move",
  "наезд", "отъезд", "панорам", "приближ", "отдал", "движение камеры", "камера движется"
] as const;

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/i, "").replace(/\s+/g, " ").trim().slice(0, 500) || "Неизвестная ошибка";
}

function stockFailureCategory(message: string): AutoStockFailure["category"] {
  if (/api-ключ|добавьте api|недействителен|нет доступа/i.test(message)) return "invalid-key";
  if (/cdn|host=.*(?:pexels|pixabay|vimeocdn|videos\.pexels)/i.test(message)) return "cdn";
  if (/скач|пустой файл|неподдерживаемого формата|слишком большой/i.test(message)) return "download";
  if (/временно|лимит запросов|не отвечает|429|5\d\d/i.test(message)) return "provider-temporary";
  if (/не найден|нерелевант|нет готового локального stock/i.test(message)) return "no-results";
  return "unknown";
}

function normalizeQuery(value: string, maximumLength = MAX_QUERY_LENGTH): string {
  return value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[*_`#[\]{}<>]/g, " ")
    .replace(/[|/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,:;!?—–-]+|[\s.,:;!?—–-]+$/g, "")
    .trim()
    .slice(0, maximumLength)
    .trim();
}

function rawWords(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
}

function significantWords(value: string, maximum = MAX_QUERY_WORDS): string {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const word of rawWords(value)) {
    if (words.length >= maximum) break;
    // Pexels/Pixabay заметно стабильнее ищут по коротким английским словам. Русский
    // narration/title не транслируем в API как есть: это и давало случайные совпадения.
    if (!/^[a-z][a-z0-9'’-]*$/i.test(word)) continue;
    if (word.length < 2 || /^\d+$/.test(word) || SEARCH_STOP_WORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  while (words.length > 0 && words.join(" ").length > MAX_QUERY_LENGTH) words.pop();
  return normalizeQuery(words.join(" "));
}

const RUSSIAN_VISUAL_TERMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^полиц(?:ия|ейск)/iu, "police"],
  [/^(?:детектив|следовател)/iu, "detective"],
  [/^(?:автомобил|машин)/iu, "car"],
  [/^мотел/iu, "motel"],
  [/^(?:комнат|номер)/iu, "room"],
  [/^коридор/iu, "corridor"],
  [/^двер/iu, "door"],
  [/^окн/iu, "window"],
  [/^ключ/iu, "key"],
  [/^(?:документ|бумаг)/iu, "documents"],
  [/^(?:фотограф|снимок)/iu, "photograph"],
  [/^(?:видеонаблюден|наблюден)/iu, "security camera"],
  [/^склад/iu, "warehouse"],
  [/^улиц/iu, "street"],
  [/^(?:здани|дом(?:$|а|у|ом|е|ы|ов|ами|ах))/iu, "building"],
  [/^офис/iu, "office"],
  [/^лес/iu, "forest"],
  [/^(?:мор(?:е|я|ем|ю|ск)|океан)/iu, "ocean"],
  [/^(?:кошк|кошач|кот(?:$|а|у|ом|е|ы|ов|ами|ах|ик|ён))/iu, "cat"],
  [/^собак/iu, "dog"],
  [/^рук(?:а|и|у|ой|е|ам|ами|ах)?$/iu, "hands"],
  [/^телефон/iu, "phone"],
  [/^(?:компьютер|ноутбук)/iu, "computer"],
  [/^(?:деньг|банкнот)/iu, "money"],
  [/^ноч/iu, "night"],
  [/^дожд/iu, "rain"],
  [/^(?:огон|плам)/iu, "fire"]
];

function deterministicEnglishFallback(...values: string[]): string {
  const words = rawWords(values.join(" "));
  const translated: string[] = [];
  if (words.some((word) => /^мокр/iu.test(word)) && words.some((word) => /^след/iu.test(word))) {
    translated.push("wet", "footprints");
  }
  for (const [pattern, replacement] of RUSSIAN_VISUAL_TERMS) {
    if (words.some((word) => pattern.test(word))) translated.push(...replacement.split(" "));
  }
  return significantWords(translated.join(" "));
}

function explicitStockQuery(value: string): string {
  const match = value.match(/(?:stock|search)\s*query\s*[:=-]\s*([^\n.;]+)/i)
    ?? value.match(/(?:поисковый\s+запрос|запрос\s+для\s+стока)\s*[:=-]\s*([^\n.;]+)/i);
  return significantWords(match?.[1] ?? "");
}

function isSpecificQuery(value: string): boolean {
  const words = rawWords(value);
  return words.length >= 1 && words.some((word) => word.length >= 3 && !GENERIC_SEARCH_WORDS.has(word));
}

function combinedQuery(primary: string, context: string): string {
  const primaryWords = rawWords(significantWords(primary, 5));
  const contextWords = rawWords(significantWords(context, 4)).filter((word) => !primaryWords.includes(word));
  return normalizeQuery([...primaryWords, ...contextWords].slice(0, MAX_QUERY_WORDS).join(" "));
}

function objectFocusedQuery(value: string): string {
  const describedMedia = value.match(/\b(photograph|picture|image|footage|video|monitor|screen)\s+(?:showing|of)\s+([^,.;]+)/i);
  if (describedMedia) return significantWords(`${describedMedia[1] ?? ""} ${describedMedia[2] ?? ""}`);
  const framedSubject = value.match(/\b(?:extreme\s+)?(?:close[- ]?up|macro|medium|wide|tight)(?:\s+(?:shot|view))?\s+of\s+([^,.;]+)/i);
  if (framedSubject) return significantWords(framedSubject[1] ?? "");
  return significantWords(value);
}

const STOCK_OBJECT_PHRASES = [
  "housekeeping cart", "housekeeping trolley", "cleaning cart", "cleaning supplies", "bed inspection",
  "key card", "keycard", "access card", "wet footprints", "security camera", "police car", "body camera",
  "hotel room", "motel room", "hotel corridor", "money transport", "armored van", "office desk",
  "mobile phone", "door handle", "warehouse door", "shower water"
] as const;

const STOCK_LOCATION_PHRASES = [
  "hotel corridor", "hotel room", "motel room", "warehouse", "office", "street", "road", "forest",
  "bathroom", "bedroom", "kitchen", "garage", "parking lot", "airport", "train station", "hospital"
] as const;

function firstKnownPhrase(value: string, phrases: readonly string[]): string {
  const normalized = ` ${value.toLocaleLowerCase()} `;
  return phrases
    .map((phrase) => ({ phrase, index: normalized.indexOf(` ${phrase} `) }))
    .filter(({ index }) => index >= 0)
    .sort((left, right) => left.index - right.index)[0]?.phrase ?? "";
}

function inferredStockLocation(value: string): string {
  const words = new Set(rawWords(value));
  const hotel = words.has("hotel") || words.has("motel");
  if (hotel && (words.has("corridor") || words.has("hallway"))) return "hotel corridor";
  if (hotel && (words.has("room") || words.has("bed") || words.has("housekeeping"))) return "hotel room";
  return "";
}

function firstActionWord(value: string): string {
  return rawWords(value).find((word) => SUBJECT_MOTION_STEMS.some((stem) => !stem.includes(" ") && word.startsWith(stem))) ?? "";
}

function neutralBrollFor(location: string): string {
  const aliases: Record<string, string> = {
    "hotel corridor": "hotel hallway",
    "motel room": "hotel room",
    "hotel room": "hotel room cleaning",
    warehouse: "warehouse interior",
    office: "office interior",
    street: "city street",
    road: "road traffic",
    bathroom: "bathroom interior",
    bedroom: "bedroom interior",
    garage: "garage interior",
    "parking lot": "parking lot traffic",
    airport: "airport terminal",
    "train station": "train station platform",
    hospital: "hospital corridor"
  };
  return aliases[location] ?? location;
}

/**
 * Provider search is literal enough that a good scene query can still miss the
 * vocabulary used by contributors. Keep a few domain-preserving paraphrases
 * ahead of broad object/location fallbacks; frozen scene intent still validates
 * every returned asset.
 */
function providerFriendlyQueryVariants(value: string): string[] {
  const normalized = ` ${value.toLocaleLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()} `;
  const hotel = /\b(?:hotel|motel)\b/.test(normalized);
  const variants: string[] = [];
  if (hotel && /\b(?:housekeeping|cleaning)\b/.test(normalized) && /\b(?:cart|trolley)\b/.test(normalized)) {
    variants.push("hotel housekeeping cart", "hotel cleaning trolley");
  }
  if (hotel && /\b(?:housekeeping|cleaning)\b/.test(normalized) && /\b(?:supplies|equipment|tools)\b/.test(normalized)) {
    variants.push("hotel housekeeping supplies", "hotel cleaning equipment");
  }
  if (hotel && /\b(?:keycard|key card|access card)\b/.test(normalized)) {
    variants.push("hotel key card door", "hotel access card door");
  }
  if (hotel && /\bbed\b/.test(normalized) && /\b(?:inspect|inspection|checking?)\b/.test(normalized)) {
    variants.push("hotel housekeeping bed inspection", "hotel supervisor checking bed");
  }
  return variants.map((query) => significantWords(query)).filter(isSpecificQuery);
}

/**
 * Разбивает перегруженный stockQuery на видимый каскад: главный объект →
 * короткий объект → действие → локация → нейтральный тематический B-roll.
 */
function dedicatedQueryCascade(project: Project, scene: Scene, dedicated: string): string[] {
  if (!dedicated) return [];
  const words = rawWords(dedicated);
  const knownObject = firstKnownPhrase(dedicated, STOCK_OBJECT_PHRASES);
  const mainObject = knownObject || (words.length > 3 ? words.slice(0, 2).join(" ") : dedicated);
  const shortObjectWords = rawWords(mainObject);
  const shortObject = shortObjectWords.length > 1 ? shortObjectWords.at(-1) ?? "" : mainObject;
  const context = [scene.animationPrompt, scene.narration, scene.imagePrompt, scene.title].join(" ");
  const action = firstActionWord([withoutCameraDirections(scene.animationPrompt), scene.narration, scene.imagePrompt].join(" "));
  const actionQuery = action && shortObject ? `${action} ${shortObject}` : "";
  const locationContext = `${dedicated} ${context} ${project.topic} ${project.title}`;
  const location = firstKnownPhrase(locationContext, STOCK_LOCATION_PHRASES) || inferredStockLocation(locationContext);
  const neutral = neutralBrollFor(location);
  return [dedicated, ...providerFriendlyQueryVariants(dedicated), mainObject, shortObject, actionQuery, location, neutral]
    .map((query) => significantWords(query))
    .filter(isSpecificQuery);
}

/**
 * Короткие запросы для поискового API. imagePrompt остаётся промптом генерации и никогда
 * не отправляется в Pexels/Pixabay целиком: художественные инструкции ухудшают выдачу.
 */
export function buildAutoStockQueries(project: Project, scene: Scene): string[] {
  const dedicated = significantWords(scene.stockQuery ?? "");
  const dedicatedCascade = dedicatedQueryCascade(project, scene, dedicated);
  const explicit = explicitStockQuery(scene.imagePrompt);
  const visual = objectFocusedQuery(scene.imagePrompt);
  const titledVisual = combinedQuery(scene.title, scene.imagePrompt);
  const narratedVisual = combinedQuery(scene.narration, scene.imagePrompt);
  const title = significantWords(scene.title);
  const narration = significantWords(scene.narration);
  const hasSceneSubject = [dedicated, explicit, visual, title, narration].some(isSpecificQuery);
  const topicContext = hasSceneSubject ? combinedQuery(scene.title || scene.narration, project.topic || project.title) : "";
  const translated = deterministicEnglishFallback(
    scene.stockQuery ?? "",
    scene.imagePrompt,
    scene.title,
    scene.narration,
    project.topic || project.title
  );
  const queries = [...dedicatedCascade, explicit, visual, translated, titledVisual, narratedVisual, title, narration, topicContext]
    .map((query) => normalizeQuery(query))
    .filter((query) => isSpecificQuery(query) && !/[^\x00-\x7F]/.test(query));
  const seen = new Set<string>();
  return queries.filter((query) => {
    const key = query.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stemMatches(value: string, stems: readonly string[]): number {
  const normalized = value.toLocaleLowerCase();
  const words = rawWords(normalized);
  return stems.reduce((count, stem) => count + ((stem.includes(" ")
    ? normalized.includes(stem)
    : words.some((word) => word.startsWith(stem))) ? 1 : 0), 0);
}

function phraseMatches(value: string, phrases: readonly string[]): number {
  const normalized = value.toLocaleLowerCase();
  return phrases.reduce((count, phrase) => count + (normalized.includes(phrase) ? 1 : 0), 0);
}

function withoutCameraDirections(value: string): string {
  return value
    .replace(/\b(?:camera\s+movement|camera\s+moves?|moving\s+camera|tracking\s+shot)\b/giu, " ")
    .replace(/\b(?:slow|fast|subtle|gentle|very)?\s*(?:push[- ]?in|pull[- ]?out|pan(?:s|ning)?|zoom(?:s|ing)?|dolly|tilt(?:s|ing)?|orbit(?:s|ing)?)\b/giu, " ")
    .replace(/(?:движение\s+камеры|камера\s+движется|наезд\s+камеры|отъезд\s+камеры|панорамирование\s+камеры)/giu, " ");
}

/** Положительный балл означает реальное движение в кадре, отрицательный — статичный объект. */
export function autoStockMotionScore(scene: Scene): number {
  const imageMotion = stemMatches(scene.imagePrompt, SUBJECT_MOTION_STEMS);
  const narrationMotion = stemMatches(scene.narration, SUBJECT_MOTION_STEMS);
  const animationMotion = stemMatches(withoutCameraDirections(scene.animationPrompt), SUBJECT_MOTION_STEMS);
  const dynamicPhrases = phraseMatches(`${scene.title} ${scene.narration} ${scene.imagePrompt}`, DYNAMIC_PHRASES);
  const staticPhrases = phraseMatches(`${scene.title} ${scene.narration} ${scene.imagePrompt}`, STATIC_PHRASES);
  const staticObjects = stemMatches(`${scene.title} ${scene.imagePrompt}`, STATIC_OBJECT_STEMS);
  const cameraOnlyMotion = stemMatches(scene.animationPrompt, CAMERA_MOTION_STEMS);
  const explicitlyStill = /(?:^|\s)(?:static|still|frozen|no movement|без движения|статичн)/iu.test(scene.animationPrompt);
  return imageMotion * 2.5
    + narrationMotion * 1.25
    + animationMotion * 3
    + dynamicPhrases * 3
    + Math.min(1, cameraOnlyMotion) * 0.35
    - staticPhrases * 4
    - staticObjects * 1.5
    - (explicitlyStill ? 5 : 0);
}

export function preferredAutoStockMediaType(scene: Scene): StockMediaType {
  return autoStockMotionScore(scene) >= VIDEO_MOTION_THRESHOLD ? "video" : "image";
}

function stableSemanticHash(scene: Scene): number {
  const value = `${scene.title}\n${scene.narration}\n${scene.imagePrompt}`.toLocaleLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Процент задаёт желаемый темп, а не приказ превращать статичные улики в видео.
 * Итоговое количество дополнительно ограничивается числом действительно динамичных сцен.
 */
export function desiredAutoStockVideoCount(scenes: Scene[], percent = 35): number {
  if (scenes.length === 0) return 0;
  const normalizedPercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 35;
  return Math.min(scenes.length, Math.max(0, Math.round(scenes.length * normalizedPercent / 100)));
}

/**
 * Выбирает примерно треть video-сцен по смыслу. Порядок сцены используется только как
 * последний стабильный tie-breaker, а не как правило «каждая третья сцена».
 */
export function planAutoStockMediaTypes(scenes: Scene[], requestedVideoCount = desiredAutoStockVideoCount(scenes)): StockMediaType[] {
  // 100% означает буквальное «сначала пробовать видео для каждой сцены».
  // Если уверенного ролика нет, findAndApply безопасно откатится к фото.
  if (scenes.length > 0 && requestedVideoCount >= scenes.length) return scenes.map(() => "video");
  const ranked = scenes
    .map((scene, index) => ({ scene, index, score: autoStockMotionScore(scene), hash: stableSemanticHash(scene) }))
    .filter(({ score }) => score >= VIDEO_MOTION_THRESHOLD)
    .sort((left, right) => right.score - left.score || left.hash - right.hash || left.scene.order - right.scene.order);
  const videoCount = Math.max(0, Math.min(ranked.length, Math.round(requestedVideoCount)));
  const videoIndexes = new Set(ranked.slice(0, videoCount).map(({ index }) => index));
  return scenes.map((_scene, index) => videoIndexes.has(index) ? "video" : "image");
}

function projectOrientation(project: Project): StockOrientation {
  return project.aspectRatio === "9:16" ? "portrait" : project.aspectRatio === "1:1" ? "square" : "landscape";
}

function assetIdentity(asset: Pick<StockAsset, "provider" | "id" | "pageUrl" | "downloadUrl">): string[] {
  return [
    `id:${asset.provider}:${String(asset.id)}`,
    `page:${asset.pageUrl}`,
    `download:${asset.downloadUrl}`
  ];
}

function sourceIdentity(source: StockAssetSource): string[] {
  return [`id:${source.provider}:${source.assetId}`, `page:${source.pageUrl}`];
}

function failedDownloadIdentity(asset: Pick<StockAsset, "downloadUrl">): string {
  return `download:${asset.downloadUrl}`;
}

const SEMANTIC_ALIAS_GROUPS = [
  ["motel", "hotel", "roadside", "lodging"],
  ["room", "interior", "bedroom"],
  ["police", "officer", "patrol", "law", "enforcement", "cop"],
  ["dispatcher", "operator", "headset", "callcenter", "call-centre"],
  ["cctv", "securitycamera", "surveillance", "security-camera"],
  ["footprint", "footprints", "track", "tracks", "footstep"],
  ["administrator", "receptionist", "clerk", "manager"],
  ["automobile", "vehicle", "car", "truck", "van"],
  ["shower", "bathroom", "water"],
  ["door", "doorway", "entrance"],
  ["phone", "telephone", "handset"],
  ["receipt", "invoice", "ticket"],
  ["document", "documents", "paper", "papers", "record", "records"],
  ["key", "keys", "keycard", "key-card", "accesscard", "access-card"],
  ["coffee", "espresso", "cappuccino"],
  ["licenseplate", "numberplate", "license-plate"],
  ["carwash", "car-wash"],
  ["arrive", "arrives", "arriving", "arrival", "approach", "approaching"],
  ["drive", "drives", "driving", "moving", "travel", "travelling"],
  ["enter", "enters", "entering", "walk", "walks", "walking"],
  ["open", "opens", "opening", "unlock", "unlocks", "unlocking"],
  ["cleaning", "housekeeping", "housekeeper", "maid", "janitor", "cleaner"],
  ["cart", "carts", "trolley", "trolleys"],
  ["supplies", "equipment", "tools", "products", "detergent", "detergents"],
  ["bed", "beds", "bedding", "duvet", "linen", "linens"],
  ["supervisor", "inspector", "inspecting", "manager"],
  ["cable", "cables", "wire", "wires", "wiring"]
] as const;

const SEMANTIC_QUALIFIERS = new Set([
  "old", "new", "dark", "night", "day", "empty", "warm", "cold", "wet", "dry", "locked", "closed", "open",
  "wood", "wooden", "metal", "small", "large", "inside", "outside", "indoor", "outdoor", "technical", "service",
  "city", "urban", "rural", "close", "near", "floor", "wall", "table", "desk", "shelf", "brass", "steel", "glass",
  "black", "white", "red", "blue", "green", "brown", "modern", "vintage", "ancient"
]);

const ACTION_ANCHOR_GROUPS = [
  ["arrive", "arrives", "arriving", "arrival", "approach", "approaching"],
  ["drive", "drives", "driving", "moving", "travel", "travelling"],
  ["enter", "enters", "entering", "walk", "walks", "walking"],
  ["open", "opens", "opening", "unlock", "unlocks", "unlocking"],
  ["search", "searches", "searching", "inspect", "inspects", "inspecting", "inspection", "check", "checks", "checking", "examine", "examines", "examining"],
  ["arrest", "arrests", "arresting", "detain", "detains", "detaining", "handcuff", "handcuffs", "handcuffing"]
] as const;

const UNEXPECTED_ASSET_CATEGORIES = [
  { label: "цветы/сад", patterns: ["flower", "flowers", "floral", "blossom", "bouquet", "garden"] },
  { label: "дракон/фестиваль", patterns: ["dragon", "chinese new year", "lunar new year", "festival costume"] },
  {
    label: "канатная дорога",
    patterns: ["cable car", "gondola lift", "ropeway", "aerial tram", "ski lift"],
    allowedPatterns: ["cable car", "gondola lift", "ropeway", "aerial tram", "ski lift"]
  },
  { label: "игрушка/миниатюра", patterns: ["toy", "miniature", "figurine", "statue", "sculpture", "lego", "doll", "model car", "playset"] },
  { label: "рисунок/мультфильм", patterns: ["cartoon", "illustration", "anime", "3d render", "clipart"] }
] as const;

function semanticTokens(value: string): string[] {
  return [...new Set(rawWords(value).filter((word) =>
    word.length >= 3 && !SEARCH_STOP_WORDS.has(word) && !GENERIC_SEARCH_WORDS.has(word)
  ))];
}

function semanticallySimilar(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length >= 4 && right.length >= 4 && (left.startsWith(right) || right.startsWith(left))) return true;
  return SEMANTIC_ALIAS_GROUPS.some((group) => {
    const aliases = group as readonly string[];
    return aliases.includes(left) && aliases.includes(right);
  });
}

function containsSemanticPhrase(value: string, phrase: string): boolean {
  const normalized = ` ${value.toLocaleLowerCase().replace(/[-_]+/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const target = ` ${phrase.toLocaleLowerCase().replace(/[-_]+/g, " ")} `;
  return normalized.includes(target);
}

function semanticConcepts(value: string): string[] {
  const tokens = semanticTokens(value);
  const concepts: string[] = [];
  for (const token of tokens) {
    const actionIndex = ACTION_ANCHOR_GROUPS.findIndex((group) =>
      (group as readonly string[]).some((alias) => semanticallySimilar(token, alias))
    );
    const aliasIndex = SEMANTIC_ALIAS_GROUPS.findIndex((group) => (group as readonly string[]).some((alias) =>
      alias.includes("-") ? containsSemanticPhrase(value, alias) : semanticallySimilar(token, alias)
    ));
    const concept = actionIndex >= 0 ? `action:${actionIndex}` : aliasIndex >= 0 ? `alias:${aliasIndex}` : token;
    if ((actionIndex >= 0 || !SEMANTIC_QUALIFIERS.has(token)) && !concepts.includes(concept)) concepts.push(concept);
  }
  // Двухсловные сущности сохраняем одним обязательным смыслом.
  if (/\blicen[cs]e\s+plates?\b/i.test(value)) {
    const index = SEMANTIC_ALIAS_GROUPS.findIndex((group) => (group as readonly string[]).includes("licenseplate"));
    const concept = `alias:${index}`;
    if (!concepts.includes(concept)) concepts.unshift(concept);
  }
  if (/\bcar\s+wash\b/i.test(value)) {
    const index = SEMANTIC_ALIAS_GROUPS.findIndex((group) => (group as readonly string[]).includes("carwash"));
    const concept = `alias:${index}`;
    if (!concepts.includes(concept)) concepts.unshift(concept);
  }
  if (/\b(?:security\s+camera|surveillance\s+camera)\b/i.test(value)) {
    const index = SEMANTIC_ALIAS_GROUPS.findIndex((group) => (group as readonly string[]).includes("cctv"));
    const concept = `alias:${index}`;
    if (!concepts.includes(concept)) concepts.unshift(concept);
  }
  return concepts;
}

function actionConcepts(value: string): string[] {
  const tokens = semanticTokens(value);
  return ACTION_ANCHOR_GROUPS.flatMap((group, index) =>
    tokens.some((token) => (group as readonly string[]).some((alias) => semanticallySimilar(token, alias))) ? [`action:${index}`] : []
  );
}

function metadataContainsAction(metadata: string, actionConcept: string): boolean {
  const index = Number(actionConcept.split(":")[1]);
  const group = ACTION_ANCHOR_GROUPS[index] as readonly string[] | undefined;
  const tokens = semanticTokens(metadata);
  return Boolean(group?.some((alias) => tokens.some((token) => semanticallySimilar(token, alias))));
}

function unexpectedCategory(query: string, metadata: string): string | undefined {
  for (const category of UNEXPECTED_ASSET_CATEGORIES) {
    const presentInMetadata = category.patterns.some((pattern) => containsSemanticPhrase(metadata, pattern));
    const requestedPatterns = "allowedPatterns" in category ? category.allowedPatterns : category.patterns;
    const requested = requestedPatterns.some((pattern) => containsSemanticPhrase(query, pattern));
    if (presentInMetadata && !requested) return category.label;
  }
  return undefined;
}

const PRIMARY_ANCHOR_ALIASES = new Set([
  "police", "dispatcher", "cctv", "footprint", "administrator", "shower", "door", "phone", "receipt", "document",
  "key", "coffee", "licenseplate", "carwash"
]);

function primaryConcepts(query: string): string[] {
  const result: string[] = [];
  const tokens = semanticTokens(query);
  for (const alias of PRIMARY_ANCHOR_ALIASES) {
    const index = SEMANTIC_ALIAS_GROUPS.findIndex((group) => (group as readonly string[]).includes(alias));
    const requested = alias === "licenseplate"
      ? /\blicen[cs]e\s+plates?\b/i.test(query)
      : alias === "carwash"
        ? /\bcar\s+wash\b/i.test(query)
        : tokens.some((token) => semanticallySimilar(token, alias));
    if (requested) result.push(index >= 0 ? `alias:${index}` : alias);
  }
  return [...new Set(result)];
}

export interface AutoStockAssetRelevance {
  confident: boolean;
  known: boolean;
  matches: number;
  requiredMatches: number;
  reason?: string;
}

export interface AutoStockIntent {
  /** Frozen before retrieval: a broader fallback query cannot redefine the scene. */
  sourceQuery: string;
  anchorConcepts: readonly string[];
  actions: readonly string[];
  /** Optional scene detail used for ranking, never as a hard rejection rule. */
  contextConcepts: readonly string[];
}

export function buildAutoStockIntent(scene: Scene): AutoStockIntent {
  const sourceQuery = significantWords(scene.stockQuery ?? "")
    || explicitStockQuery(scene.imagePrompt)
    || objectFocusedQuery(scene.imagePrompt)
    || deterministicEnglishFallback(scene.title, scene.narration, scene.imagePrompt)
    || significantWords(scene.title)
    || significantWords(scene.narration);
  // A compound subject wins over incidental props: cleaning cart + key card
  // still needs a housekeeping trolley, not both objects in the same stock shot.
  const subjectPhrases = STOCK_OBJECT_PHRASES.filter((phrase) => !(STOCK_LOCATION_PHRASES as readonly string[]).includes(phrase));
  const compound = firstKnownPhrase(sourceQuery, subjectPhrases) || firstKnownPhrase(sourceQuery, STOCK_OBJECT_PHRASES);
  const objects = semanticConcepts(compound || sourceQuery).filter((concept) => !concept.startsWith("action:"));
  const primary = compound ? [] : primaryConcepts(sourceQuery);
  const anchorConcepts = [...new Set(compound ? objects : [...primary, ...objects.slice(0, 2)])];
  const actions = actionConcepts(sourceQuery);
  const contextConcepts = semanticConcepts(`${scene.imagePrompt} ${scene.title} ${scene.narration}`)
    .filter((concept) => !concept.startsWith("action:") && !anchorConcepts.includes(concept))
    .slice(0, 8);
  return {
    sourceQuery,
    anchorConcepts,
    actions,
    contextConcepts,
  };
}

/** Строгая проверка alt/tags: позиция в выдаче API сама по себе не доказывает релевантность. */
export function autoStockAssetRelevance(asset: StockAsset, intent?: AutoStockIntent): AutoStockAssetRelevance {
  const query = intent?.sourceQuery ?? String(asset.query ?? "").trim();
  const metadata = [asset.description, ...(asset.tags ?? [])].filter(Boolean).join(" ").trim();
  const queryConcepts = intent ? [...intent.anchorConcepts, ...intent.actions] : semanticConcepts(query);
  const actions = intent?.actions ?? actionConcepts(query);
  const objectConcepts = queryConcepts.filter((concept) => !concept.startsWith("action:"));
  if (!metadata) return { confident: false, known: false, matches: 0, requiredMatches: 1, reason: "у результата нет описания или тегов" };
  if (objectConcepts.length === 0) return { confident: false, known: true, matches: 0, requiredMatches: 1, reason: "в запросе нет проверяемого объекта" };

  const category = unexpectedCategory(query, metadata);
  if (category) return { confident: false, known: true, matches: 0, requiredMatches: 1, reason: `посторонняя категория: ${category}` };

  const metadataConcepts = semanticConcepts(metadata);
  const matches = objectConcepts.filter((concept) => metadataConcepts.includes(concept)).length;
  const matchedActions = actions.filter((concept) => metadataContainsAction(metadata, concept)).length;
  const requiredMatches = Math.min(2, Math.max(1, objectConcepts.length));
  // Первый предметный смысл — обязательный. Это не даёт incidental-словам вроде
  // metal/door/floor/cables протащить дракона, цветы или канатную дорогу.
  const firstObject = objectConcepts[0];
  const mandatoryConcepts = intent?.anchorConcepts ?? [...new Set([...primaryConcepts(query), ...(firstObject ? [firstObject] : [])])];
  const missingPrimary = mandatoryConcepts.find((concept) => !metadataConcepts.includes(concept));
  if (missingPrimary) {
    return { confident: false, known: true, matches, requiredMatches, reason: intent
      ? "в описании нет главного объекта исходной сцены"
      : "в описании нет главного объекта запроса" };
  }
  const actionRequired = asset.mediaType === "video" && actions.length > 0;
  const confident = matches >= requiredMatches && (!actionRequired || matchedActions > 0);
  return {
    confident,
    known: true,
    matches,
    requiredMatches,
    reason: confident ? undefined : actionRequired && matchedActions === 0
      ? "в описании видео нет требуемого действия"
      : `совпало только ${matches} из ${requiredMatches} обязательных смыслов`
  };
}

function assetScore(asset: StockAsset, project: Project, scene: Scene, index: number, intent: AutoStockIntent): number {
  const targetRatio = project.aspectRatio === "9:16" ? 9 / 16 : project.aspectRatio === "1:1" ? 1 : 16 / 9;
  const ratio = asset.width > 0 && asset.height > 0 ? asset.width / asset.height : targetRatio;
  const ratioPenalty = Math.abs(Math.log(Math.max(0.05, ratio) / targetRatio)) * 220;
  const shortSide = Math.min(asset.width, asset.height);
  const resolutionBonus = Math.min(60, Math.max(0, shortSide) / 12);
  const durationBonus = asset.mediaType === "video"
    ? Math.min(asset.durationSeconds ?? 0, Math.min(20, Math.max(4, scene.durationSeconds))) * 4
    : 0;
  const semantic = autoStockAssetRelevance(asset, intent);
  const semanticBonus = semantic.matches * 120;
  const metadata = [asset.description, ...(asset.tags ?? [])].filter(Boolean).join(" ");
  const metadataConcepts = semanticConcepts(metadata);
  const contextMatches = intent.contextConcepts.filter((concept) => metadataConcepts.includes(concept)).length;
  const contextBonus = Math.min(4, contextMatches) * 60;
  // API сортирует по смысловой релевантности. Не позволяем лишнему разрешению
  // вытеснить первые результаты выдачи, если они уже подходят по формату.
  return 500 + semanticBonus + contextBonus - ratioPenalty + resolutionBonus + durationBonus - index * 20;
}

function rankUnusedAssets(items: StockAsset[], used: Set<string>, project: Project, scene: Scene, intent: AutoStockIntent): StockAsset[] {
  return items
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => assetIdentity(asset).every((key) => !used.has(key)))
    // Нет уверенного совпадения главного объекта/действия — не скачиваем мусор.
    .filter(({ asset }) => autoStockAssetRelevance(asset, intent).confident)
    .sort((left, right) => assetScore(right.asset, project, scene, right.index, intent) - assetScore(left.asset, project, scene, left.index, intent))
    .map(({ asset }) => asset);
}

function licenseUrl(provider: StockProvider): string {
  return provider === "pexels" ? "https://www.pexels.com/license/" : "https://pixabay.com/service/license-summary/";
}

function createSource(asset: StockAsset): StockAssetSource {
  return {
    provider: asset.provider,
    assetId: String(asset.id),
    mediaType: asset.mediaType,
    query: String(asset.query ?? "").slice(0, 200),
    pageUrl: asset.pageUrl,
    author: String(asset.author || `${asset.provider} contributor`).slice(0, 200),
    authorUrl: asset.authorUrl,
    attribution: String(asset.attribution || "").slice(0, 500),
    licenseUrl: licenseUrl(asset.provider),
    downloadedAt: new Date().toISOString()
  };
}

function rotateProviders(providers: StockProvider[], order: number): StockProvider[] {
  if (providers.length < 2) return providers;
  const offset = Math.abs(order) % providers.length;
  return [...providers.slice(offset), ...providers.slice(0, offset)];
}

async function hasUsableStock(scene: Scene, requiredType?: StockMediaType): Promise<boolean> {
  if (requiredType && scene.stockSource?.mediaType !== requiredType) return false;
  const path = scene.stockSource?.mediaType === "image"
    ? scene.imagePath
    : scene.stockSource?.mediaType === "video"
      ? scene.videoPath
      : undefined;
  if (!path) return false;
  try {
    const file = await stat(path);
    return file.isFile() && file.size > 0;
  } catch {
    return false;
  }
}

function strictStockMediaType(percent: number | undefined): StockMediaType | undefined {
  if (Number.isFinite(percent) && Number(percent) <= 0) return "image";
  if (Number.isFinite(percent) && Number(percent) >= 100) return "video";
  return undefined;
}

export class StockProjectService {
  private readonly activeSelections = new Map<string, Promise<AutoStockSelectionResult>>();
  private readonly activeManualApplies = new Set<string>();

  constructor(
    private readonly projects: ProjectAccess,
    private readonly storage: ProjectStorageAccess,
    private readonly stock: StockAccess,
    private readonly settings: StockSettingsAccess,
    private readonly publishProgress: (progress: AutoStockProgress) => void = () => undefined,
    private readonly log: StockLog = () => undefined
  ) {}

  /** Ручной и автоматический выбор используют один путь скачивания, валидации и сохранения. */
  async applyAsset(projectId: string, sceneId: string, asset: StockAsset, onStage?: ApplyStageListener): Promise<Project> {
    if (this.activeSelections.has(projectId)) throw new Error("Сначала дождитесь завершения автоматического подбора stock");
    if (this.activeManualApplies.has(projectId)) throw new Error("Для этого проекта уже скачивается stock-материал");
    this.activeManualApplies.add(projectId);
    try {
      return await this.applyAssetInternal(projectId, sceneId, asset, onStage);
    } finally {
      this.activeManualApplies.delete(projectId);
    }
  }

  private async applyAssetInternal(projectId: string, sceneId: string, asset: StockAsset, onStage?: ApplyStageListener): Promise<Project> {
    const initial = await this.requireEditableProject(projectId);
    if (!initial.scenes.some((scene) => scene.id === sceneId)) throw new Error("Сцена не найдена");

    onStage?.("downloading");
    const downloaded = await this.stock.download(asset);
    let poster: DownloadedStockAsset | undefined;
    if (asset.mediaType === "video") {
      try {
        poster = await this.stock.downloadPreview(asset);
      } catch (error) {
        this.log("warn", "stock.poster.download_failed", {
          projectId,
          sceneId,
          provider: asset.provider,
          assetId: String(asset.id),
          error: errorMessage(error)
        });
      }
    }

    // За время загрузки пользователь мог остановить/запустить очередь или удалить сцену.
    const project = await this.requireEditableProject(projectId);
    const scene = project.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) throw new Error("Сцена больше не существует");
    const source = createSource(asset);
    onStage?.("applying");

    let posterPath: string | undefined;
    if (poster) posterPath = await this.storage.saveStockAsset(project, scene, "image", poster.data, poster.extension, source);
    const path = await this.storage.saveStockAsset(project, scene, asset.mediaType, downloaded.data, downloaded.extension, source);
    // Скачивание и запись могут занять время. Берём самый свежий проект ещё раз,
    // чтобы не затереть параллельную правку текста/длительности другой сцены.
    const latestProject = await this.requireEditableProject(projectId);
    if (!latestProject.scenes.some((candidate) => candidate.id === sceneId)) throw new Error("Сцена больше не существует");
    const scenes = latestProject.scenes.map((candidate) => candidate.id !== sceneId
      ? candidate
      : asset.mediaType === "image"
        ? { ...candidate, imagePath: path, videoPath: undefined, stockSource: source, stockAlternates: undefined, status: "ready" as const }
        : { ...candidate, imagePath: posterPath, videoPath: path, stockSource: source, stockAlternates: undefined, status: "ready" as const });
    const updated = await this.projects.update(projectId, {
      scenes,
      montagePlan: latestProject.montagePlan,
      outputPath: undefined,
    });
    await this.storage.ensureProject(updated);
    const updatedScene = updated.scenes.find((candidate) => candidate.id === sceneId);
    if (updatedScene) await this.storage.writeSceneManifest(updated, updatedScene);
    this.log("info", "stock.asset.applied", {
      projectId,
      sceneId,
      provider: asset.provider,
      assetId: String(asset.id),
      mediaType: asset.mediaType
    });
    return updated;
  }

  /** Best-effort montage material: it never replaces or invalidates the primary asset. */
  private async applyAlternateAssetInternal(projectId: string, sceneId: string, asset: StockAsset): Promise<Project> {
    const initial = await this.requireEditableProject(projectId);
    if (!initial.scenes.some((scene) => scene.id === sceneId)) throw new Error("Сцена не найдена");

    const downloaded = await this.stock.download(asset);
    let poster: DownloadedStockAsset | undefined;
    if (asset.mediaType === "video") {
      try {
        poster = await this.stock.downloadPreview(asset);
      } catch (error) {
        this.log("warn", "stock.alternate.poster.download_failed", {
          projectId,
          sceneId,
          provider: asset.provider,
          assetId: String(asset.id),
          error: errorMessage(error)
        });
      }
    }

    const project = await this.requireEditableProject(projectId);
    const scene = project.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) throw new Error("Сцена больше не существует");
    const source = createSource(asset);
    let posterPath: string | undefined;
    if (poster) {
      posterPath = await this.storage.saveStockAsset(project, scene, "image", poster.data, poster.extension, source, { alternateIndex: 0 });
    }
    const path = await this.storage.saveStockAsset(project, scene, asset.mediaType, downloaded.data, downloaded.extension, source, { alternateIndex: 0 });
    const variant: StockMediaVariant = asset.mediaType === "image"
      ? { imagePath: path, stockSource: source }
      : { imagePath: posterPath, videoPath: path, stockSource: source };

    const latestProject = await this.requireEditableProject(projectId);
    if (!latestProject.scenes.some((candidate) => candidate.id === sceneId)) throw new Error("Сцена больше не существует");
    const scenes = latestProject.scenes.map((candidate) => candidate.id === sceneId
      ? { ...candidate, stockAlternates: [variant] }
      : candidate);
    const updated = await this.projects.update(projectId, {
      scenes,
      montagePlan: latestProject.montagePlan,
      outputPath: undefined,
    });
    await this.storage.ensureProject(updated);
    const updatedScene = updated.scenes.find((candidate) => candidate.id === sceneId);
    if (updatedScene) await this.storage.writeSceneManifest(updated, updatedScene);
    this.log("info", "stock.alternate.applied", {
      projectId,
      sceneId,
      provider: asset.provider,
      assetId: String(asset.id),
      mediaType: asset.mediaType
    });
    return updated;
  }

  autoSelect(projectId: string, options: AutoStockSelectionOptions = {}): Promise<AutoStockSelectionResult> {
    const active = this.activeSelections.get(projectId);
    if (active) return active;
    if (this.activeManualApplies.has(projectId)) return Promise.reject(new Error("Сначала дождитесь завершения ручного скачивания stock"));
    const operation = this.runAutoSelect(projectId, options).finally(() => this.activeSelections.delete(projectId));
    this.activeSelections.set(projectId, operation);
    return operation;
  }

  private async runAutoSelect(projectId: string, options: AutoStockSelectionOptions): Promise<AutoStockSelectionResult> {
    const initial = await this.requireEditableProject(projectId);
    if (initial.mediaMode !== "stock" && initial.mediaMode !== "mixed") {
      throw new Error("Автоподбор stock доступен только в режимах Stock и Mix");
    }
    if (options.sceneIds?.some(id => !initial.scenes.some(scene => scene.id === id))) throw new Error("Сцена для подбора больше не существует");
    const included = initial.scenes.filter((scene) => scene.includeInAssembly !== false && (!options.sceneIds || options.sceneIds.includes(scene.id))).sort((left, right) => left.order - right.order);
    const strictType = strictStockMediaType(initial.settings.stockVideoPercent);
    const readiness = options.force
      ? included.map(() => false)
      : await Promise.all(included.map((scene) => hasUsableStock(scene, strictType)));
    const used = new Set<string>();
    for (const [index, scene] of included.entries()) {
      if (!readiness[index]) continue;
      if (scene.stockSource) for (const key of sourceIdentity(scene.stockSource)) used.add(key);
      for (const alternate of scene.stockAlternates ?? []) {
        for (const key of sourceIdentity(alternate.stockSource)) used.add(key);
      }
    }
    const initiallySkipped = readiness.filter(Boolean).length;
    const targets = included.filter((_scene, index) => !readiness[index]);
    const readyVideoCount = included.reduce((count, scene, index) => count + (
      readiness[index] && scene.stockSource?.mediaType === "video" ? 1 : 0
    ), 0);
    const desiredVideoCount = desiredAutoStockVideoCount(included, initial.settings.stockVideoPercent);
    const desiredVideosForTargets = Math.max(0, desiredVideoCount - readyVideoCount);
    const plannedTypes = strictType
      ? targets.map(() => strictType)
      : planAutoStockMediaTypes(targets, desiredVideosForTargets);
    const plannedTypeByScene = new Map(targets.map((scene, index) => [scene.id, plannedTypes[index] ?? "image"]));
    let selected = 0;
    let skipped = initiallySkipped;
    let failed = 0;
    let completed = initiallySkipped;
    let total = included.length;
    const failures: AutoStockFailure[] = [];
    const baseProgress = () => ({ projectId, completed, total, selected, skipped, failed });
    this.publishProgress({
      ...baseProgress(),
      phase: "preparing",
      message: targets.length > 0
        ? `Подготовлен автоподбор для ${targets.length} ${targets.length === 1 ? "сцены" : "сцен"}`
        : "Все сцены уже имеют stock-материалы"
    });

    const publicSettings = await this.settings.publicSettings();
    const providers = (["pexels", "pixabay"] as const).filter((provider) => publicSettings.providers[provider].configured);
    if (targets.length > 0 && providers.length === 0) throw new Error("Сначала добавьте API-ключ Pexels или Pixabay в настройках Stock");

    for (const originalScene of targets) {
      const current = await this.requireEditableProject(projectId);
      const scene = current.scenes.find((candidate) => candidate.id === originalScene.id);
      if (!scene || scene.includeInAssembly === false || (!options.force && await hasUsableStock(scene, strictType))) {
        skipped += 1;
        completed += 1;
        this.publishProgress({ ...baseProgress(), phase: "preparing", message: `Сцена ${originalScene.order + 1} уже готова — пропускаю` });
        continue;
      }

      let sceneFailed = false;
      try {
        const selectedAsset = await this.findAndApply(
          current,
          scene,
          plannedTypeByScene.get(scene.id) ?? preferredAutoStockMediaType(scene),
          rotateProviders(providers, scene.order),
          used,
          baseProgress,
          strictType === undefined
        );
        for (const key of assetIdentity(selectedAsset)) used.add(key);
        selected += 1;
      } catch (error) {
        sceneFailed = true;
        const message = errorMessage(error);
        failed += 1;
        const category = stockFailureCategory(message);
        failures.push({ sceneId: scene.id, sceneNumber: scene.order + 1, category, message });
        this.log("warn", "stock.auto.scene_failed", { projectId, sceneId: scene.id, sceneNumber: scene.order + 1, category, error: message });
      }
      completed += 1;
      this.publishProgress({
        ...baseProgress(),
        phase: "preparing",
        currentSceneId: scene.id,
        currentSceneNumber: scene.order + 1,
        message: sceneFailed
          ? `Для сцены ${scene.order + 1} stock не найден; продолжаю остальные`
          : `Сцена ${scene.order + 1} готова`
      });
    }

    const project = await this.requireProject(projectId);
    const finalIncluded = project.scenes.filter((scene) => scene.includeInAssembly !== false).sort((left, right) => left.order - right.order);
    const actualReadiness = await Promise.all(finalIncluded.map((scene) => hasUsableStock(scene)));
    const finalReadiness = strictType
      ? await Promise.all(finalIncluded.map((scene) => hasUsableStock(scene, strictType)))
      : actualReadiness;
    const actualVideos = finalIncluded.reduce((count, scene, index) => count + (
      actualReadiness[index] && scene.stockSource?.mediaType === "video" ? 1 : 0
    ), 0);
    const actualImages = finalIncluded.reduce((count, scene, index) => count + (
      actualReadiness[index] && scene.stockSource?.mediaType === "image" ? 1 : 0
    ), 0);
    const failureByScene = new Map(failures.map((failure) => [failure.sceneId, failure]));
    const verifiedFailures = finalIncluded.flatMap((scene, index) => finalReadiness[index]
      ? []
        : [failureByScene.get(scene.id) ?? {
          sceneId: scene.id,
          sceneNumber: scene.order + 1,
          category: "no-results" as const,
          message: "У сцены нет готового локального stock-файла"
        }]);
    failures.splice(0, failures.length, ...verifiedFailures);
    failed = failures.length;
    total = finalIncluded.length;
    completed = total;
    this.publishProgress({
      ...baseProgress(),
      phase: "complete",
      message: failed === 0
        ? `Stock готов: ${selected} подобрано автоматически, ${skipped} уже было готово. Фактически: ${actualVideos} видео, ${actualImages} фото`
        : `Готово ${total - failed} из ${total}; не удалось подобрать для ${failed}. Фактически: ${actualVideos} видео, ${actualImages} фото`
    });
    return { project, total, selected, skipped, failed, failures };
  }

  private async findAndApply(
    project: Project,
    scene: Scene,
    preferredType: StockMediaType,
    providers: StockProvider[],
    used: Set<string>,
    progress: () => Pick<AutoStockProgress, "projectId" | "completed" | "total" | "selected" | "skipped" | "failed">,
    allowVideoToImageFallback: boolean
  ): Promise<StockAsset> {
    // Фото — безопасный fallback для динамичной сцены. Обратный fallback запрещён:
    // иначе настройка «0% видео» незаметно наполняла бы проект роликами.
    const mediaTypes: StockMediaType[] = preferredType === "video" && allowVideoToImageFallback ? ["video", "image"] : [preferredType];
    const queries = buildAutoStockQueries(project, scene);
    const intent = buildAutoStockIntent(scene);
    const orientation = projectOrientation(project);
    let attempts = 0;
    let lastError = "";
    let relevanceRejected = 0;
    const unavailableAssets = new Set(used);
    const unavailableProviders = new Set<StockProvider>();

    const stages: Array<{ query: string; mediaType: StockMediaType }> = [];
    const addStage = (query: string | undefined, mediaType: StockMediaType | undefined) => {
      if (query && mediaType && !stages.some((stage) => stage.query === query && stage.mediaType === mediaType)) {
        stages.push({ query, mediaType });
      }
    };
    // Сначала пробуем несколько конкретных формулировок с выбранным по смыслу типом.
    // Другой тип — только fallback; слишком общий «documentary people» больше не используется.
    for (const query of queries.slice(0, 5)) addStage(query, mediaTypes[0]);
    for (const query of queries.slice(0, 4)) addStage(query, mediaTypes[1]);

    for (const { query, mediaType } of stages) {
      for (const provider of providers) {
        if (attempts >= MAX_SEARCH_ATTEMPTS) break;
        if (unavailableProviders.has(provider)) continue;
        attempts += 1;
        this.publishProgress({
          ...progress(),
          phase: "searching",
          currentSceneId: scene.id,
          currentSceneNumber: scene.order + 1,
          message: `Сцена ${scene.order + 1}: ищу ${mediaType === "video" ? "видео" : "фото"} в ${provider === "pexels" ? "Pexels" : "Pixabay"}`
        });
        let refreshAfterFailedDownload = false;
        for (let searchRound = 0; searchRound < 2; searchRound += 1) {
          if (searchRound === 1 && !refreshAfterFailedDownload) break;
          let candidates: StockAsset[];
          try {
            const result = await this.stock.search(
              { provider, mediaType, query, orientation, page: 1, perPage: SEARCH_RESULTS_PER_PAGE },
              searchRound === 1
            );
            const sameType = result.items.filter((asset) => asset.mediaType === mediaType);
            candidates = rankUnusedAssets(sameType, unavailableAssets, project, scene, intent);
            relevanceRejected += sameType.filter((asset) =>
              assetIdentity(asset).every((key) => !unavailableAssets.has(key)) && !autoStockAssetRelevance(asset, intent).confident
            ).length;
          } catch (error) {
            lastError = errorMessage(error);
            if (searchRound === 0) unavailableProviders.add(provider);
            this.log("warn", "stock.auto.search_failed", {
              projectId: project.id,
              sceneId: scene.id,
              provider,
              mediaType,
              fresh: searchRound === 1,
              error: lastError
            });
            break;
          }

          refreshAfterFailedDownload = false;
          for (const asset of candidates.slice(0, MAX_DOWNLOAD_CANDIDATES_PER_SEARCH)) {
            try {
              const appliedProject = await this.applyAssetInternal(project.id, scene.id, asset, (stage) => {
                this.publishProgress({
                  ...progress(),
                  phase: stage,
                  currentSceneId: scene.id,
                  currentSceneNumber: scene.order + 1,
                  message: stage === "downloading"
                    ? `Сцена ${scene.order + 1}: скачиваю подходящий материал`
                    : `Сцена ${scene.order + 1}: сохраняю материал в проект`
                });
              });
              if (appliedProject.settings.assembly.montage?.enabled === true) {
                const primaryKeys = new Set(assetIdentity(asset));
                const alternate = candidates.find((candidate) => assetIdentity(candidate).every((key) =>
                  !primaryKeys.has(key) && !used.has(key) && !unavailableAssets.has(key)
                ));
                if (alternate) {
                  try {
                    await this.applyAlternateAssetInternal(project.id, scene.id, alternate);
                    for (const key of assetIdentity(alternate)) used.add(key);
                  } catch (error) {
                    // The primary is already valid. A denser montage is optional and
                    // must not turn a successful scene into a failed auto-selection.
                    this.log("warn", "stock.auto.alternate_failed", {
                      projectId: project.id,
                      sceneId: scene.id,
                      provider: alternate.provider,
                      assetId: String(alternate.id),
                      error: errorMessage(error)
                    });
                  }
                }
              }
              return asset;
            } catch (error) {
              const latest = await this.projects.get(project.id);
              const latestScene = latest?.scenes.find((candidate) => candidate.id === scene.id);
              const applied = latestScene?.stockSource;
              if (latestScene && applied?.provider === asset.provider && applied.assetId === String(asset.id) && await hasUsableStock(latestScene)) return asset;
              lastError = errorMessage(error);
              // Запрещаем только конкретный плохой CDN URL. После bypass-cache тот же
              // asset id с обновлённой ссылкой остаётся допустимым кандидатом.
              unavailableAssets.add(failedDownloadIdentity(asset));
              refreshAfterFailedDownload = true;
              this.log("warn", "stock.auto.asset_failed", {
                projectId: project.id,
                sceneId: scene.id,
                provider: asset.provider,
                assetId: String(asset.id),
                fresh: searchRound === 1,
                error: lastError
              });
            }
          }
        }
      }
      if (attempts >= MAX_SEARCH_ATTEMPTS) break;
    }
    if (relevanceRejected > 0) {
      throw new Error(
        `Не найден уверенно подходящий stock для сцены «${scene.title}». `
        + `Отклонено нерелевантных результатов: ${relevanceRejected}. `
        + `Проверьте короткий stockQuery с главным объектом или действием: ${queries.slice(0, 3).join("; ") || "запрос отсутствует"}`
      );
    }
    throw new Error(lastError || `Не найден подходящий stock для сцены «${scene.title}». Проверьте stockQuery (2–6 английских слов).`);
  }

  private async requireProject(projectId: string): Promise<Project> {
    const project = await this.projects.get(projectId);
    if (!project) throw new Error("Проект не найден");
    return project;
  }

  private async requireEditableProject(projectId: string): Promise<Project> {
    const project = await this.requireProject(projectId);
    if (project.status === "generating" || project.status === "paused") {
      throw new Error("Сначала остановите активную генерацию, затем меняйте материалы сцен");
    }
    return project;
  }
}
