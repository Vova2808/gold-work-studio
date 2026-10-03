import { randomInt, randomUUID } from "node:crypto";

export const FLOW_ORIGIN = "https://labs.google";
export const FLOW_HOME = `${FLOW_ORIGIN}/fx/tools/flow`;
export const FLOW_TOOL_URL = FLOW_HOME;
export const FLOW_SESSION_URL = `${FLOW_ORIGIN}/fx/api/auth/session`;
export const FLOW_PROJECT_CREATE_URL = `${FLOW_ORIGIN}/fx/api/trpc/project.createProject`;
export const FLOW_MEDIA_URL = `${FLOW_ORIGIN}/fx/api/trpc/media.getMediaUrlRedirect`;
export const FLOW_API_ORIGIN = "https://aisandbox-pa.googleapis.com";

// Public browser identifiers shipped by the current labs.google Flow client.
export const FLOW_WEB_API_KEY = "AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY";
export const FLOW_RECAPTCHA_SITE_KEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV";

export function flowBrowserUserAgent(defaultUserAgent: string): string {
  return defaultUserAgent
    .replace(/\s+Electron\/[^\s]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function shouldReturnToFlowAfterLogin(
  value: string,
  visitedGoogleLogin: boolean,
  alreadyReturned: boolean
): boolean {
  if (!visitedGoogleLogin || alreadyReturned) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host !== "accounts.google.com" && host !== "labs.google" && host !== "flow.google.com";
  } catch {
    return false;
  }
}

export function flowRuntimeBlockReason(value: string): string | undefined {
  try {
    const url = new URL(value);
    if ((url.hostname === "labs.google" || url.hostname === "flow.google.com")
      && /(?:^|\/)unsupported-country(?:\/|$)/i.test(url.pathname)) {
      return "Google Flow отказал в доступе для текущего региона/IP (unsupported-country). "
        + "Откройте Flow в этом аккаунте и проверьте доступность сервиса; затем повторите проверку аккаунта. "
        + "Автоматические попытки генерации остановлены.";
    }
  } catch { /* Only a confirmed Flow URL classifies a regional refusal. */ }
  return undefined;
}

export function isAllowedFlowNavigation(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "google.com" || host.endsWith(".google.com") || host === "labs.google";
  } catch {
    return false;
  }
}

/** The legacy labs client still supplies the account-bound reCAPTCHA used by the
 * generation API. Its current frontend flag redirects to the new Flow shell,
 * which may independently reject an otherwise AVAILABLE account. Keep only the
 * hidden API runtime on the loaded labs client; visible login windows may follow
 * the migration normally.
 */
export function shouldHoldLegacyFlowRuntime(currentValue: string, nextValue: string): boolean {
  try {
    const current = new URL(currentValue);
    const next = new URL(nextValue);
    return current.hostname === "labs.google"
      && /(?:^|\/)tools\/flow(?:\/|$)/i.test(current.pathname)
      && next.hostname === "flow.google.com";
  } catch {
    return false;
  }
}

export function isBenignFlowNavigationAbort(error: unknown, currentUrl = ""): boolean {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const isAbort = record?.code === "ERR_ABORTED"
    || record?.errno === -3
    || /\bERR_ABORTED\b|\(-3\)/i.test(message);
  if (!isAbort) return false;
  const abortedUrl = /loading\s+['"]([^'"]+)['"]/i.exec(message)?.[1] ?? "";
  return [currentUrl, abortedUrl].some((value) => isAllowedFlowNavigation(value));
}

export function flowTrpcInput<T>(input: T): { json: T } {
  return { json: input };
}

export function flowTrpcQueryUrl<T>(url: string, input: T): string {
  const query = new URLSearchParams({
    input: JSON.stringify(flowTrpcInput(input)),
  });
  return `${url}?${query.toString()}`;
}

/** media.getMediaUrlRedirect принимает name напрямую, без обычного tRPC input envelope. */
export function flowMediaDownloadUrl(name: string): string {
  return `${FLOW_MEDIA_URL}?name=${encodeURIComponent(name)}`;
}

export type FlowVideoApiPath =
  | "batchAsyncGenerateVideoText"
  | "batchAsyncGenerateVideoStartImage"
  | "batchAsyncGenerateVideoStartAndEndImage";

export interface FlowVideoPlan {
  apiPath: FlowVideoApiPath;
  modelKey: string;
}

export interface FlowVideoRequestInput {
  prompt: string;
  aspectRatio: string;
  projectId: string;
  paygateTier?: string;
  sessionId?: string;
  recaptchaToken: string;
  modelKey: string;
  startImageId?: string;
  endImageId?: string;
  batchId?: string;
  seed?: number;
}

export interface FlowVideoPayload {
  mediaGenerationContext: {
    batchId: string;
    audioFailurePreference: "BLOCK_SILENCED_VIDEOS";
  };
  clientContext: {
    projectId: string;
    tool: "PINHOLE";
    userPaygateTier: string;
    sessionId: string;
    recaptchaContext: {
      token: string;
      applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB";
    };
  };
  requests: Array<{
    aspectRatio: "VIDEO_ASPECT_RATIO_LANDSCAPE" | "VIDEO_ASPECT_RATIO_PORTRAIT";
    textInput: { prompt: string };
    videoModelKey: string;
    seed: number;
    startImage?: { mediaId: string };
    endImage?: { mediaId: string };
  }>;
  useV2ModelConfig: true;
}

export interface FlowImagePlan {
  modelKey: string;
}

export interface FlowImageRequestInput {
  prompt: string;
  aspectRatio: string;
  projectId: string;
  sessionId?: string;
  recaptchaToken: string;
  modelKey: string;
  referenceImageIds?: string[];
  batchId?: string;
  seed?: number;
}

export interface FlowImagePayload {
  clientContext: {
    projectId: string;
    tool: "PINHOLE";
    sessionId: string;
    recaptchaContext: {
      token: string;
      applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB";
    };
  };
  mediaGenerationContext: {
    batchId: string;
  };
  useNewMedia: true;
  requests: Array<{
    clientContext: FlowImagePayload["clientContext"];
    imageModelName: string;
    imageAspectRatio:
      | "IMAGE_ASPECT_RATIO_LANDSCAPE"
      | "IMAGE_ASPECT_RATIO_PORTRAIT"
      | "IMAGE_ASPECT_RATIO_SQUARE";
    structuredPrompt: {
      parts: Array<
        | { text: string }
        | {
          reference: {
            entity: { entityId: string };
            media: { handle: string };
          };
        }
      >;
    };
    seed: number;
    imageInputs: Array<{
      imageInputType: "IMAGE_INPUT_TYPE_REFERENCE";
      name: string;
    }>;
  }>;
}

const TEXT_MODELS = [
  // Текущие deployment keys из рабочего видеомаршрута Flow/G-LABS.
  "veo_3_1_t2v_fast",
  "veo_3_1_t2v_lite",
  "VEO_3_1_T2V_12STEP",
  "VEO_3_1_T2V_12STEP_VISIBLE_WATERMARK",
  "VEO_3_0_T2V_DISTILLED",
  "VEO_2_1_T2V",
  "VEO_2_0_T2V",
  "VEO_1_5_T2V",
] as const;

// Актуальные ключи image-моделей из web-клиента Flow. Сначала Nano Banana,
// затем совместимые запасные модели для аккаунтов с другим набором доступов.
const IMAGE_MODELS = [
  "GEM_PIX_2",
  "GEM_PIX_2_VERTEX",
  "GEM_PIX_PRO_VERTEX",
  "GEM_PIX_VERTEX",
  "IMAGEN_3_5",
  "IMAGEN_3_5_FAST",
  "IMAGEN_3",
] as const;

const START_IMAGE_MODELS = [
  "veo_3_1_i2v_s_fast",
  "veo_3_1_i2v_fast",
  "VEO_3_1_I2V_12STEP",
  "VEO_3_0_I2V_12STEP",
  "VEO_3_0_I2V_DISTILLED",
  "VEO_2_1_I2V_DISTILLED",
  "VEO_2_1_I2V",
  "VEO_2_0_I2V",
  "VEO_1_5_I2V",
] as const;

const START_END_MODELS = [
  "veo_3_1_i2v_s_fast_fl",
  "VEO_2_1_START_END_IMAGE",
  "VEO_3_1_I2V_12STEP",
  "VEO_3_0_I2V_12STEP",
] as const;

function requestedModelKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^veo_[a-z0-9_]+$/i.test(trimmed)) return undefined;
  // Старые enum-ключи API были верхнего регистра; новые deployment keys
  // чувствительны к регистру и приходят в lower-case.
  return trimmed.startsWith("VEO_") ? trimmed.toUpperCase() : trimmed.toLowerCase();
}

function compatibleRequestedVideoModel(
  requested: string,
  hasStartImage: boolean,
  hasEndImage: boolean
): string {
  if (hasStartImage && hasEndImage && requested === "veo_3_1_i2v_s_fast") {
    return "veo_3_1_i2v_s_fast_fl";
  }
  if (hasStartImage) {
    if (requested === "veo_3_1_t2v_fast") return "veo_3_1_i2v_s_fast";
    if (requested === "VEO_3_1_T2V_12STEP") return "VEO_3_1_I2V_12STEP";
  } else {
    if (requested === "veo_3_1_i2v_s_fast" || requested === "veo_3_1_i2v_s_fast_fl") {
      return "veo_3_1_t2v_fast";
    }
    if (requested === "VEO_3_1_I2V_12STEP") return "VEO_3_1_T2V_12STEP";
  }
  return requested;
}

export function flowVideoPlans(
  requestedModel: string | undefined,
  hasStartImage: boolean,
  hasEndImage: boolean
): FlowVideoPlan[] {
  const apiPath: FlowVideoApiPath = hasStartImage && hasEndImage
    ? "batchAsyncGenerateVideoStartAndEndImage"
    : hasStartImage
      ? "batchAsyncGenerateVideoStartImage"
      : "batchAsyncGenerateVideoText";
  const requested = requestedModelKey(requestedModel);
  // Одна выбранная модель на весь проект: автоматическое переключение между
  // версиями Veo может заметно менять визуальный стиль соседних сцен.
  const modelKey = requested
    ? compatibleRequestedVideoModel(requested, hasStartImage, hasEndImage)
    : hasStartImage && hasEndImage
      ? START_END_MODELS[0]
      : hasStartImage
        ? START_IMAGE_MODELS[0]
        : TEXT_MODELS[0];
  return [{ apiPath, modelKey }];
}

export function flowPaygateTier(value: string | undefined): string {
  const normalized = value?.trim().toUpperCase();
  if (normalized?.startsWith("PAYGATE_TIER_")) return normalized;
  if (normalized === "PRO") return "PAYGATE_TIER_ONE";
  if (normalized === "ULTRA") return "PAYGATE_TIER_TWO";
  if (normalized === "ULTRA1P5") return "PAYGATE_TIER_TIER1P5";
  return "PAYGATE_TIER_NOT_PAID";
}

export function flowAccountTier(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!normalized) return undefined;
  if (normalized === "PAYGATE_TIER_NOT_PAID") return "FREE";
  if (normalized === "PAYGATE_TIER_ONE") return "PRO";
  if (normalized === "PAYGATE_TIER_TWO") return "ULTRA";
  if (normalized === "PAYGATE_TIER_TIER1P5") return "ULTRA1P5";
  return normalized;
}

export function flowAspectRatio(value: string): "VIDEO_ASPECT_RATIO_LANDSCAPE" | "VIDEO_ASPECT_RATIO_PORTRAIT" {
  return value === "9:16" || value.toLowerCase().includes("portrait")
    ? "VIDEO_ASPECT_RATIO_PORTRAIT"
    : "VIDEO_ASPECT_RATIO_LANDSCAPE";
}

export function flowImageAspectRatio(
  value: string
): "IMAGE_ASPECT_RATIO_LANDSCAPE" | "IMAGE_ASPECT_RATIO_PORTRAIT" | "IMAGE_ASPECT_RATIO_SQUARE" {
  if (value === "1:1" || value.toLowerCase().includes("square")) return "IMAGE_ASPECT_RATIO_SQUARE";
  if (value === "9:16" || value.toLowerCase().includes("portrait")) return "IMAGE_ASPECT_RATIO_PORTRAIT";
  return "IMAGE_ASPECT_RATIO_LANDSCAPE";
}

export function flowImagePlans(requestedModel?: string): FlowImagePlan[] {
  const requested = requestedModel?.trim().toUpperCase();
  const safeRequested = requested && /^[A-Z][A-Z0-9_]+$/.test(requested) ? requested : undefined;
  return [...new Set([safeRequested, ...IMAGE_MODELS].filter((value): value is string => Boolean(value)))]
    .map((modelKey) => ({ modelKey }));
}

export function buildFlowImagePayload(input: FlowImageRequestInput): FlowImagePayload {
  const clientContext: FlowImagePayload["clientContext"] = {
    projectId: input.projectId,
    tool: "PINHOLE",
    sessionId: input.sessionId ?? randomUUID(),
    recaptchaContext: {
      token: input.recaptchaToken,
      applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
    },
  };
  return {
    clientContext,
    mediaGenerationContext: {
      batchId: input.batchId ?? randomUUID(),
    },
    useNewMedia: true,
    requests: [{
      clientContext,
      imageModelName: input.modelKey,
      imageAspectRatio: flowImageAspectRatio(input.aspectRatio),
      structuredPrompt: {
        parts: [{
          text: input.prompt.trim() || "Cinematic establishing shot, natural lighting, high detail",
        }],
      },
      seed: input.seed ?? randomInt(0, 0x8000),
      imageInputs: (input.referenceImageIds ?? []).filter(Boolean).map((name) => ({
        imageInputType: "IMAGE_INPUT_TYPE_REFERENCE",
        name,
      })),
    }],
  };
}

export function buildFlowVideoPayload(input: FlowVideoRequestInput): FlowVideoPayload {
  const request: FlowVideoPayload["requests"][number] = {
    aspectRatio: flowAspectRatio(input.aspectRatio),
    textInput: {
      prompt: input.prompt.trim() || "Gentle cinematic motion, natural movement, one continuous shot",
    },
    videoModelKey: input.modelKey,
    seed: input.seed ?? randomInt(0, 0x8000),
  };
  if (input.startImageId) request.startImage = { mediaId: input.startImageId };
  if (input.endImageId) request.endImage = { mediaId: input.endImageId };
  return {
    mediaGenerationContext: {
      batchId: input.batchId ?? randomUUID(),
      audioFailurePreference: "BLOCK_SILENCED_VIDEOS",
    },
    clientContext: {
      projectId: input.projectId,
      tool: "PINHOLE",
      userPaygateTier: flowPaygateTier(input.paygateTier),
      sessionId: input.sessionId ?? randomUUID(),
      recaptchaContext: {
        token: input.recaptchaToken,
        applicationType: "RECAPTCHA_APPLICATION_TYPE_WEB",
      },
    },
    requests: [request],
    useV2ModelConfig: true,
  };
}

export function findFlowString(value: unknown, keys: readonly string[]): string | undefined {
  const wanted = new Set(keys);
  const visited = new Set<object>();
  const walk = (current: unknown): string | undefined => {
    if (!current || typeof current !== "object") return undefined;
    if (visited.has(current)) return undefined;
    visited.add(current);
    if (!Array.isArray(current)) {
      for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
        if (wanted.has(key) && typeof item === "string" && item.trim()) return item;
      }
    }
    for (const item of Array.isArray(current) ? current : Object.values(current as Record<string, unknown>)) {
      const found = walk(item);
      if (found) return found;
    }
    return undefined;
  };
  return walk(value);
}

export function findFlowNumber(value: unknown, keys: readonly string[]): number | undefined {
  const wanted = new Set(keys);
  const visited = new Set<object>();
  const walk = (current: unknown): number | undefined => {
    if (!current || typeof current !== "object") return undefined;
    if (visited.has(current)) return undefined;
    visited.add(current);
    if (!Array.isArray(current)) {
      for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
        if (wanted.has(key) && typeof item === "number" && Number.isFinite(item)) return item;
      }
    }
    for (const item of Array.isArray(current) ? current : Object.values(current as Record<string, unknown>)) {
      const found = walk(item);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(value);
}

export function findFlowMedia(value: unknown, expectedName?: string): Record<string, unknown> | undefined {
  const visited = new Set<object>();
  const candidates: Record<string, unknown>[] = [];
  const walk = (current: unknown): void => {
    if (!current || typeof current !== "object" || visited.has(current)) return;
    visited.add(current);
    if (!Array.isArray(current)) {
      const record = current as Record<string, unknown>;
      if (
        typeof record.name === "string"
        && ("mediaMetadata" in record || "video" in record || "workflowId" in record)
      ) {
        candidates.push(record);
      }
      for (const item of Object.values(record)) walk(item);
      return;
    }
    for (const item of current) walk(item);
  };
  walk(value);
  return candidates.find((candidate) => candidate.name === expectedName) ?? candidates[0];
}

/** Image responses differ from video jobs: media[].image.generatedImage may
 * carry the identifier and ready URL instead of outer mediaMetadata. */
export function findFlowGeneratedImage(value: unknown): Record<string, unknown> | undefined {
  const visited = new Set<object>();
  const walk = (current: unknown): Record<string, unknown> | undefined => {
    if (!current || typeof current !== "object" || visited.has(current)) return undefined;
    visited.add(current);
    if (Array.isArray(current)) {
      for (const item of current) { const found = walk(item); if (found) return found; }
      return undefined;
    }
    const record = current as Record<string, unknown>;
    if (record.image && typeof record.image === "object") {
      const image = record.image as Record<string, unknown>;
      const generated = image.generatedImage && typeof image.generatedImage === "object"
        ? image.generatedImage as Record<string, unknown> : undefined;
      const name = typeof record.name === "string" && record.name
        ? record.name : typeof generated?.mediaId === "string" ? generated.mediaId : undefined;
      if (name || typeof generated?.encodedImage === "string" || typeof generated?.fifeUrl === "string") return { ...record, name };
    }
    for (const item of Object.values(record)) { const found = walk(item); if (found) return found; }
    return undefined;
  };
  return walk(value);
}

export function flowMediaStatus(media: unknown): string | undefined {
  return findFlowString(media, ["mediaGenerationStatus", "status"]);
}

export function flowApiErrorMessage(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 1_000);
  const parts = [
    findFlowString(value, ["message"]),
    findFlowString(value, ["reason"]),
    findFlowString(value, ["status"]),
    findFlowString(value, ["publicErrorKey"]),
  ].filter((part, index, values): part is string => Boolean(part) && values.indexOf(part) === index);
  if (parts.length > 0) return parts.join(": ").slice(0, 1_000);
  try {
    return JSON.stringify(value).slice(0, 1_000);
  } catch {
    return String(value).slice(0, 1_000);
  }
}

export function shouldTryNextFlowModel(status: number, message: string): boolean {
  if (![400, 403, 404, 412, 422].includes(status)) return false;
  return /model|unsupported|not available|unavailable|requirement|paygate|credit|invalid argument|requested entity was not found|not_found/i.test(message);
}

export function flowRetryAfterMs(message: string, fallbackMs = 60_000): number {
  const seconds = /retry(?:\s+after|\s+in)?\s*[:=]?\s*([\d.]+)\s*s/i.exec(message)?.[1];
  if (seconds) return Math.max(1_000, Math.ceil(Number(seconds) * 1_000));
  return fallbackMs;
}

export function flowImageMimeType(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return undefined;
}

export function flowImageFileName(mimeType: string): string {
  if (mimeType === "image/png") return "flow-input.png";
  if (mimeType === "image/webp") return "flow-input.webp";
  return "flow-input.jpg";
}
