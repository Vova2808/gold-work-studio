import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { voiceCalibrationSampleText, type VoicerTemplate } from "@gold-work/shared";
import { atomicWrite } from "./fs-utils.js";
import { NO_RETRY_MARKER } from "./google-errors.js";
import { parseProxyUrl, proxyRequest, ProxyConnectError, type ProxyResponse } from "./proxy-utils.js";
import type { VoicerStore } from "./voicer-store.js";
import { observeNetwork, recordDiagnosticEvent } from "./diagnostics.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RESPONSE_BODY_TIMEOUT_MS = 20_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_POLL_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_SAFE_RETRY_ATTEMPTS = 4;
const DEFAULT_SAFE_RETRY_BASE_DELAY_MS = 1_000;
const TEMPLATE_BROWSE_PATH = "/templates/browse";

export type VoicerClientErrorCode =
  | "configuration"
  | "aborted"
  | "request_timeout"
  | "network"
  | "response_body_timeout"
  | "response_body"
  | "http"
  | "order_response_invalid"
  | "order_failed"
  | "order_timeout"
  | "storage_response_invalid"
  | "download_timeout"
  | "download_network"
  | "download_http"
  | "download_body"
  | "download_empty";

export interface VoicerClientErrorMetadata {
  code: VoicerClientErrorCode;
  /** Можно ли безопасно повторить всю операцию, включая потенциальное создание заказа. */
  retryable: boolean;
  /** Сервер мог создать платный заказ, но клиент не получил подтверждение с его id. */
  creationUncertain: boolean;
  /** Клиент уже получил id заказа: новый POST /orders создал бы отдельный платный заказ. */
  orderKnown?: boolean;
}

/**
 * Ошибка Lumean с машинно-читаемой политикой повторов.
 * Для совместимости с текущей очередью неповторяемые ошибки также содержат её служебный marker.
 */
export class VoicerClientError extends Error {
  readonly code: VoicerClientErrorCode;
  readonly retryable: boolean;
  readonly creationUncertain: boolean;
  readonly orderKnown: boolean;
  readonly userMessage: string;

  constructor(message: string, metadata: VoicerClientErrorMetadata, cause?: unknown) {
    super(metadata.retryable ? message : `${NO_RETRY_MARKER}${message}`, cause === undefined ? undefined : { cause });
    this.name = "VoicerClientError";
    this.code = metadata.code;
    this.retryable = metadata.retryable;
    this.creationUncertain = metadata.creationUncertain;
    this.orderKnown = metadata.orderKnown === true;
    this.userMessage = message;
  }
}

/** Стандартная AbortError, которую очередь может отличить от сбоя провайдера. */
export class VoicerAbortError extends VoicerClientError {
  constructor(creationUncertain: boolean, cause?: unknown) {
    super(
      "Операция Lumean остановлена",
      { code: "aborted", retryable: false, creationUncertain },
      cause
    );
    this.name = "AbortError";
  }
}

export interface VoicerClientOptions {
  requestTimeoutMs?: number;
  responseBodyTimeoutMs?: number;
  downloadTimeoutMs?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  safeRetryAttempts?: number;
  safeRetryBaseDelayMs?: number;
  fetchImpl?: typeof fetch;
  proxyRequestImpl?: typeof proxyRequest;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface ResolvedVoicerClientOptions {
  requestTimeoutMs: number;
  responseBodyTimeoutMs: number;
  downloadTimeoutMs: number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  safeRetryAttempts: number;
  safeRetryBaseDelayMs: number;
  fetchImpl: typeof fetch;
  proxyRequestImpl: typeof proxyRequest;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

interface LumeanEnvelope<T> {
  success?: boolean;
  message?: string;
  data?: T;
}

interface LumeanTemplatePage {
  items: Array<{
    type?: unknown;
    id?: unknown;
    name?: unknown;
    service_key?: unknown;
    service?: { code?: unknown } | null;
  }>;
  current_page: number;
  last_page: number;
}

interface VoicerHttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function proxyResponseAdapter(response: ProxyResponse): VoicerHttpResponse {
  return {
    ok: response.ok,
    status: response.status,
    text: async () => response.text(),
    arrayBuffer: async () => Uint8Array.from(response.body).buffer
  };
}

interface LumeanOrder {
  id: string;
  status: string;
  progress_percent?: number;
  result?: { files?: string[]; service_files?: string[] } | null;
}

export interface TtsOrderLifecycle {
  resumeOrderId?: string;
  onBeforeOrderCreate?: () => Promise<void>;
  onOrderRejected?: () => Promise<void>;
  onOrderKnown?: (orderId: string) => Promise<void>;
}

interface TtsSampleCheckpoint {
  version: 1;
  provider: "lumean";
  templateUuid: string;
  languageCode: string;
  sampleTextHash: string;
  baseUrl: string;
  apiKeyFingerprint: string;
  orderId?: string;
  submissionPending?: true;
  createdAt: string;
}

interface TtsSampleIdentity {
  templateUuid: string;
  languageCode: string;
  sampleText: string;
  sampleTextHash: string;
  baseUrl: string;
  apiKeyFingerprint: string;
  cacheKey: string;
}

/** Клиент Lumean Public API (озвучка ElevenLabs): POST /orders → поллинг → /storage/url → MP3. */
export class VoicerClient {
  private readonly options: ResolvedVoicerClientOptions;
  private readonly sampleFlights = new Map<string, Promise<string>>();

  constructor(private readonly store: VoicerStore, options: VoicerClientOptions = {}) {
    this.options = {
      requestTimeoutMs: positiveTimeout(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
      responseBodyTimeoutMs: positiveTimeout(options.responseBodyTimeoutMs, DEFAULT_RESPONSE_BODY_TIMEOUT_MS),
      downloadTimeoutMs: positiveTimeout(options.downloadTimeoutMs, DEFAULT_DOWNLOAD_TIMEOUT_MS),
      pollIntervalMs: nonNegativeTimeout(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS),
      pollTimeoutMs: positiveTimeout(options.pollTimeoutMs, DEFAULT_POLL_TIMEOUT_MS),
      safeRetryAttempts: positiveInteger(options.safeRetryAttempts, DEFAULT_SAFE_RETRY_ATTEMPTS),
      safeRetryBaseDelayMs: nonNegativeTimeout(options.safeRetryBaseDelayMs, DEFAULT_SAFE_RETRY_BASE_DELAY_MS),
      fetchImpl: (input, init) => observeNetwork(input instanceof Request ? input.url : String(input),
        init?.method ?? (input instanceof Request ? input.method : "GET"), "system", () => (options.fetchImpl ?? fetch)(input, init)),
      proxyRequestImpl: options.proxyRequestImpl ?? proxyRequest,
      sleep: options.sleep ?? sleep,
      now: options.now ?? Date.now,
    };
  }

  async configured(): Promise<boolean> {
    const settings = await this.store.publicSettings();
    return settings.configured && settings.baseUrl.trim().length > 0;
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    try {
      const user = await this.request<{ email?: string }>("GET", "/user");
      let quota = "";
      try {
        const subs = await this.request<{ subscriptions?: Array<{ items?: Array<{ tokens_remaining?: number; plan?: { name?: string } }> }> }>("GET", "/subscriptions");
        const item = subs?.subscriptions?.[0]?.items?.[0];
        quota = item ? ` Тариф: ${item.plan?.name ?? "?"}, осталось токенов: ${item.tokens_remaining ?? "?"}.` : " Активной подписки нет — работает стартовая/PAYG-квота.";
      } catch {
        // подписки не критичны для проверки ключа
      }
      return { ok: true, message: `Lumean подключён (${user?.email ?? "аккаунт"}).${quota}` };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof VoicerClientError
          ? error.userMessage
          : error instanceof Error ? error.message : String(error)
      };
    }
  }

  /** TTS-шаблоны пользователя в корне и вложенных папках Lumean. */
  async templates(signal?: AbortSignal): Promise<VoicerTemplate[]> {
    const templates = new Map<string, VoicerTemplate>();
    const folders: Array<string | undefined> = [undefined];
    const visitedFolders = new Set<string>();
    const recordPage = (data: LumeanTemplatePage, afterFilterCount: number | null) => {
      recordDiagnosticEvent("debug", "voicer.templates.page", {
        endpoint: TEMPLATE_BROWSE_PATH,
        dataType: data === null ? "null" : Array.isArray(data) ? "array" : typeof data,
        extractedCount: Array.isArray(data?.items) ? data.items.length : null,
        afterFilterCount,
      });
    };
    const invalidResponse = (data: LumeanTemplatePage) => {
      recordPage(data, null);
      return new VoicerClientError(
        "Lumean вернул список шаблонов в неизвестном формате.",
        { code: "response_body", retryable: false, creationUncertain: false }
      );
    };

    // Пройдём все страницы корня до папок. Новые корневые шаблоны по-прежнему первые.
    for (const folderId of folders) {
      const query = new URLSearchParams({ per_page: "100", sort_by: "created_at", sort_order: "desc" });
      if (folderId) query.set("folder_id", folderId);
      for (let page = 1, lastPage = 1; page <= lastPage; page += 1) {
        query.set("page", String(page));
        const data = await this.request<LumeanTemplatePage>("GET", `${TEMPLATE_BROWSE_PATH}?${query}`, undefined, signal);
        if (!Array.isArray(data?.items) || data.current_page !== page || !Number.isSafeInteger(data.last_page) || data.last_page < page) {
          throw invalidResponse(data);
        }
        lastPage = data.last_page;

        let afterFilterCount = 0;
        for (const item of data.items) {
          if (typeof item?.id !== "string" || !item.id.trim()) throw invalidResponse(data);
          if (item.type === "folder") {
            if (!visitedFolders.has(item.id)) {
              visitedFolders.add(item.id);
              folders.push(item.id);
            }
            continue;
          }
          if (item.type !== "template") throw invalidResponse(data);
          const service = item.service_key || item.service?.code;
          if (typeof service !== "string" || !service.trim()) throw invalidResponse(data);
          if (service !== "elevenlabs") continue;
          if (typeof item.name !== "string") throw invalidResponse(data);
          afterFilterCount += 1;
          if (!templates.has(item.id)) {
            templates.set(item.id, { uuid: item.id, name: item.name || "Шаблон", broken: false });
          }
        }
        recordPage(data, afterFilterCount);
      }
    }
    return [...templates.values()];
  }

  /** Полный цикл озвучки: заказ по шаблону → ожидание completed → ссылка на файл → скачивание MP3. */
  async tts(text: string, templateUuid?: string, signal?: AbortSignal, lifecycle?: TtsOrderLifecycle): Promise<Buffer> {
    return this.ttsWithLifecycle(text, templateUuid, signal, lifecycle);
  }

  private async ttsWithLifecycle(
    text: string,
    templateUuid?: string,
    signal?: AbortSignal,
    lifecycle: TtsOrderLifecycle = {}
  ): Promise<Buffer> {
    throwIfAborted(signal);
    const input = text.trim();
    if (!input) throw new Error("Пустой текст для озвучки");
    let orderId = lifecycle.resumeOrderId?.trim();
    let template = templateUuid?.trim();
    if (!template && !orderId) {
      const list = await this.templates(signal);
      template = list[0]?.uuid;
      if (!template) {
        throw new VoicerClientError(
          "В Lumean нет TTS-шаблонов. Выберите голос в проекте или создайте шаблон в кабинете Lumean.",
          { code: "configuration", retryable: false, creationUncertain: false }
        );
      }
    }
    let order: LumeanOrder | undefined;
    if (!orderId) {
      // Единственный небезопасный для повтора запрос во всём цикле. request() намеренно
      // выполняет POST /orders ровно один раз даже при timeout/network error.
      await lifecycle.onBeforeOrderCreate?.();
      let created: LumeanOrder;
      try {
        created = await this.request<LumeanOrder>("POST", "/orders", { template_id: template, input_text: input }, signal);
      } catch (error) {
        if (error instanceof VoicerClientError && !error.creationUncertain) await lifecycle.onOrderRejected?.();
        throw error;
      }
      orderId = created?.id;
      if (!orderId) {
        throw new VoicerClientError(
          "Lumean не вернул id заказа. Заказ мог быть создан; автоматический повтор отключён, чтобы не списать квоту повторно. Проверьте заказы в кабинете Lumean.",
          { code: "order_response_invalid", retryable: false, creationUncertain: true }
        );
      }
      order = created;
      if (lifecycle.onOrderKnown) {
        try {
          await lifecycle.onOrderKnown(orderId);
        } catch (error) {
          throw new VoicerClientError(
            `Заказ Lumean ${orderId} создан, но не удалось сохранить данные для безопасного восстановления. Автоматический повтор заказа отключён.`,
            { code: "order_response_invalid", retryable: false, creationUncertain: false, orderKnown: true },
            error
          );
        }
      }
    }
    // A reply may arrive just as Stop is clicked. Persist its receipt before observing Stop.
    if (signal?.aborted) throw this.afterKnownOrderError(new VoicerAbortError(false, signal.reason), orderId);

    const startedAt = this.options.now();
    let lastPollError: VoicerClientError | undefined;
    while (this.options.now() - startedAt < this.options.pollTimeoutMs) {
      const status = order?.status ?? "";
      if (status === "completed" || status === "result_delivered") break;
      if (status === "failed" || status === "compensated" || status === "cancelled") {
        throw new VoicerClientError(
          `Lumean: заказ озвучки ${orderId} завершился со статусом «${status}»`,
          { code: "order_failed", retryable: false, creationUncertain: false, orderKnown: true }
        );
      }
      if (status === "partially_completed") {
        throw new VoicerClientError(
          "Lumean: часть текста отклонена модерацией провайдера. Перефразируйте текст сцены и повторите.",
          { code: "order_failed", retryable: false, creationUncertain: false, orderKnown: true }
        );
      }
      if (order !== undefined || this.options.pollIntervalMs > 0) {
        await withAbort(this.options.sleep(this.options.pollIntervalMs), signal);
      }
      try {
        order = await this.request<LumeanOrder>("GET", `/orders/${orderId}`, undefined, signal);
        lastPollError = undefined;
      } catch (error) {
        if (error instanceof VoicerClientError && error.retryable) {
          lastPollError = error;
          order = undefined;
          continue;
        }
        throw this.afterKnownOrderError(error, orderId);
      }
    }
    const filePath = order?.result?.files?.[0] ?? order?.result?.service_files?.[0];
    if (!filePath) {
      const detail = lastPollError ? ` Последняя ошибка проверки: ${lastPollError.userMessage}` : "";
      throw new VoicerClientError(
        `Lumean: заказ ${orderId} не выдал файл за отведённое время.${detail} Автоматический повтор отключён: заказ уже создан.`,
        { code: "order_timeout", retryable: false, creationUncertain: false, orderKnown: true },
        lastPollError
      );
    }
    return this.downloadCompletedOrder(filePath, orderId, signal);
  }

  /** Пример голоса шаблона с кэшем: одна платная генерация на шаблон, дальше мгновенно. */
  async ttsSample(templateUuid: string | undefined, languageCode: string, cacheDir: string): Promise<string> {
    const identity = await this.ttsSampleIdentity(templateUuid, languageCode);
    const cachePath = join(cacheDir, `calibration-v2-voicer-${identity.cacheKey}.mp3`);
    const existing = this.sampleFlights.get(cachePath);
    if (existing) return existing;
    const operation = this.ttsSampleOnce(templateUuid, identity, cacheDir, cachePath)
      .finally(() => {
        if (this.sampleFlights.get(cachePath) === operation) this.sampleFlights.delete(cachePath);
      });
    this.sampleFlights.set(cachePath, operation);
    return operation;
  }

  private async ttsSampleOnce(
    templateUuid: string | undefined,
    identity: TtsSampleIdentity,
    cacheDir: string,
    cachePath: string
  ): Promise<string> {
    const checkpointPath = `${cachePath}.order.json`;
    try {
      const cached = (await readFile(cachePath)).toString("base64");
      await rm(checkpointPath, { force: true }).catch(() => undefined);
      return cached;
    } catch {
      // кэша нет — генерируем ниже
    }

    await mkdir(cacheDir, { recursive: true });
    const checkpoint = await readSampleCheckpoint(checkpointPath, {
      templateUuid: identity.templateUuid,
      languageCode: identity.languageCode,
      sampleTextHash: identity.sampleTextHash,
      baseUrl: identity.baseUrl,
      apiKeyFingerprint: identity.apiKeyFingerprint,
    });
    if (!checkpoint) await rm(checkpointPath, { force: true }).catch(() => undefined);

    if (checkpoint?.submissionPending && !checkpoint.orderId) {
      throw new VoicerClientError(
        "Предыдущая калибровка могла создать заказ Lumean, но его ID не получен. Проверьте заказы в кабинете: повторная отправка отключена, чтобы не списать квоту дважды.",
        { code: "order_response_invalid", retryable: false, creationUncertain: true }
      );
    }
    const saveCheckpoint = (state: Pick<TtsSampleCheckpoint, "orderId" | "submissionPending">) => atomicWrite(checkpointPath, JSON.stringify({
      version: 1, provider: "lumean", templateUuid: identity.templateUuid,
      languageCode: identity.languageCode, sampleTextHash: identity.sampleTextHash,
      baseUrl: identity.baseUrl, apiKeyFingerprint: identity.apiKeyFingerprint,
      ...state, createdAt: new Date().toISOString(),
    } satisfies TtsSampleCheckpoint, null, 2));

    try {
      const audio = await this.ttsWithLifecycle(identity.sampleText, templateUuid, undefined, {
        resumeOrderId: checkpoint?.orderId,
        onBeforeOrderCreate: () => saveCheckpoint({ submissionPending: true }),
        onOrderRejected: () => rm(checkpointPath, { force: true }),
        onOrderKnown: (orderId) => saveCheckpoint({ orderId }),
      });
      await atomicWrite(cachePath, audio);
      await rm(checkpointPath, { force: true }).catch(() => undefined);
      return audio.toString("base64");
    } catch (error) {
      // Завершившийся неуспешно заказ уже нельзя восстановить. Удаляем checkpoint,
      // но не создаём новый заказ в том же вызове: решение о повторе остаётся за пользователем.
      if (error instanceof VoicerClientError && error.code === "order_failed") {
        await rm(checkpointPath, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  private async ttsSampleIdentity(templateUuid: string | undefined, languageCode: string): Promise<TtsSampleIdentity> {
    const language = languageCode.replace(/[^a-zA-Z-]/g, "").toLowerCase() || "en";
    const template = templateUuid?.trim() || "default";
    const sampleText = voiceCalibrationSampleText(language);
    const sampleTextHash = createHash("sha256").update(sampleText, "utf8").digest("hex");
    const settings = await this.store.publicSettings();
    const apiKey = await this.store.apiKey();
    if (!apiKey) {
      throw new VoicerClientError(
        "Сначала сохраните API-ключ Lumean в Настройки → AI и сценарии",
        { code: "configuration", retryable: false, creationUncertain: false }
      );
    }
    const baseUrl = normalizeBaseUrl(settings.baseUrl);
    if (!baseUrl) {
      throw new VoicerClientError(
        "Укажите Base URL Lumean в Настройки → AI и сценарии",
        { code: "configuration", retryable: false, creationUncertain: false }
      );
    }
    const apiKeyFingerprint = createHash("sha256").update(apiKey, "utf8").digest("hex");
    const cacheKey = createHash("sha256")
      .update(["lumean", baseUrl, apiKeyFingerprint, template, language, sampleTextHash].join("\0"), "utf8")
      .digest("hex")
      .slice(0, 32);
    return {
      templateUuid: template,
      languageCode: language,
      sampleText,
      sampleTextHash,
      baseUrl,
      apiKeyFingerprint,
      cacheKey,
    };
  }

  private async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const safeToRetry = method === "GET" || (method === "POST" && path === "/storage/url");
    const attempts = safeToRetry ? this.options.safeRetryAttempts : 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.requestOnce<T>(method, path, body, signal);
      } catch (error) {
        lastError = error;
        if (!safeToRetry || !isRetryableVoicerError(error) || attempt + 1 >= attempts) throw error;
        await this.safeRetryDelay(attempt, signal);
      }
    }
    throw lastError;
  }

  private async requestOnce<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    const settings = await this.store.publicSettings();
    const key = await this.store.apiKey();
    throwIfAborted(signal);
    if (!key) {
      throw new VoicerClientError(
        "Сначала сохраните API-ключ Lumean в Настройки → AI и сценарии",
        { code: "configuration", retryable: false, creationUncertain: false }
      );
    }
    if (!settings.baseUrl.trim()) {
      throw new VoicerClientError(
        "Укажите Base URL Lumean в Настройки → AI и сценарии",
        { code: "configuration", retryable: false, creationUncertain: false }
      );
    }
    const creationRequest = method === "POST" && path === "/orders";
    const templateBrowseRequest = method === "GET" && path.startsWith(`${TEMPLATE_BROWSE_PATH}?`);
    const controller = new AbortController();
    const unlinkAbort = forwardAbort(signal, controller);
    let response: VoicerHttpResponse;
    try {
      const proxy = parseProxyUrl(await this.configuredProxyUrl());
      const url = `${settings.baseUrl.replace(/\/+$/, "")}${path}`;
      const headers = { "X-API-KEY": key, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) };
      const serializedBody = body === undefined ? undefined : JSON.stringify(body);
      const operation = proxy
        ? this.options.proxyRequestImpl(url, {
            method,
            headers,
            body: serializedBody,
            // proxyRequest buffers the response, so its deadline covers headers and body.
            timeoutMs: this.options.requestTimeoutMs + this.options.responseBodyTimeoutMs + 1_000,
            signal: controller.signal,
          }, proxy).then(proxyResponseAdapter)
        : this.options.fetchImpl(url, {
            method,
            headers,
            ...(serializedBody !== undefined ? { body: serializedBody } : {}),
            signal: controller.signal,
          });
      response = await withTimeout(
        operation,
        proxy ? this.options.requestTimeoutMs + this.options.responseBodyTimeoutMs : this.options.requestTimeoutMs,
        () => controller.abort()
      );
    } catch (error) {
      unlinkAbort();
      const notSent = error instanceof ProxyConnectError;
      if (signal?.aborted) throw new VoicerAbortError(creationRequest && !notSent, signal.reason);
      const timedOut = error instanceof DeadlineExceededError;
      const message = notSent
        ? `Lumean: ${errorMessage(error)}. Запрос не отправлен; повтор безопасен.`
        : creationRequest
        ? `Не удалось подтвердить создание заказа Lumean: ${timedOut ? "сервер не ответил вовремя" : "соединение оборвалось"}. Заказ мог быть создан; автоматический повтор отключён, чтобы не списать квоту повторно. Проверьте заказы в кабинете Lumean.`
        : `Lumean: ${timedOut ? `нет ответа дольше ${formatDuration(this.options.requestTimeoutMs)}` : `ошибка сети (${errorMessage(error)})`}`;
      throw new VoicerClientError(message, {
        code: timedOut ? "request_timeout" : "network",
        retryable: !creationRequest || notSent,
        creationUncertain: creationRequest && !notSent,
      }, error);
    }

    let text: string;
    try {
      text = await withTimeout(response.text(), this.options.responseBodyTimeoutMs, () => controller.abort());
    } catch (error) {
      const timedOut = error instanceof DeadlineExceededError;
      if (signal?.aborted) throw new VoicerAbortError(creationRequest, signal.reason);
      const message = creationRequest
        ? `Lumean не завершил ответ на создание заказа. Заказ мог быть создан; автоматический повтор отключён, чтобы не списать квоту повторно. Проверьте заказы в кабинете Lumean.`
        : `Lumean: ${timedOut ? "истёк таймаут чтения ответа" : `не удалось прочитать ответ (${errorMessage(error)})`}`;
      throw new VoicerClientError(message, {
        code: timedOut ? "response_body_timeout" : "response_body",
        retryable: !creationRequest,
        creationUncertain: creationRequest,
      }, error);
    } finally {
      unlinkAbort();
      controller.abort();
    }
    // Parse a complete creation reply even after abort, so its ID can be checkpointed.
    if (!creationRequest) throwIfAborted(signal);
    let parsed: LumeanEnvelope<T> | undefined;
    try {
      parsed = JSON.parse(text) as LumeanEnvelope<T>;
    } catch {
      if (response.ok) {
        const message = creationRequest
          ? "Lumean вернул повреждённый ответ на создание заказа. Заказ мог быть создан; автоматический повтор отключён, чтобы не списать квоту повторно."
          : "Lumean вернул ответ в неизвестном формате";
        throw new VoicerClientError(message, {
          code: "response_body",
          retryable: !creationRequest,
          creationUncertain: creationRequest,
        });
      }
    }
    if (!response.ok) {
      if (response.status === 402) {
        throw new VoicerClientError(
          "Lumean: не хватает квоты подписки на эту генерацию. Оформите подписку или пополните баланс в кабинете lumean.app.",
          { code: "http", retryable: false, creationUncertain: false }
        );
      }
      if (response.status === 401) {
        throw new VoicerClientError(
          "Lumean отклонил ключ API. Проверьте ключ в Настройках.",
          { code: "http", retryable: false, creationUncertain: false }
        );
      }
      if (response.status === 403) {
        throw new VoicerClientError(
          templateBrowseRequest
            ? "Lumean отклонил доступ к списку шаблонов. Проверьте право templates.read."
            : `Lumean: у ключа нет нужного права (${parsed?.message ?? "forbidden"}). Создайте ключ с пресетом full.`,
          { code: "http", retryable: false, creationUncertain: false }
        );
      }
      const transient = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
      const creationUncertain = creationRequest && ![400, 401, 402, 403, 404, 405, 413, 415, 422, 429].includes(response.status);
      throw new VoicerClientError(
        templateBrowseRequest
          ? `Lumean ${response.status}: не удалось загрузить список шаблонов.`
          : `Lumean ${response.status}: ${parsed?.message ?? text.slice(0, 200)}`,
        { code: "http", retryable: transient && !creationUncertain, creationUncertain }
      );
    }
    if (templateBrowseRequest) return parsed?.data as T;
    return (parsed?.data ?? (parsed as unknown)) as T;
  }

  private async downloadCompletedOrder(filePath: string, orderId: string, signal?: AbortSignal): Promise<Buffer> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.options.safeRetryAttempts; attempt += 1) {
      try {
        // Ссылка временная, поэтому перед каждой повторной загрузкой запрашиваем свежую.
        // POST /storage/url ничего не генерирует и не списывает квоту.
        const link = await this.requestOnce<{ url?: string }>("POST", "/storage/url", { path: filePath }, signal);
        if (!link?.url) {
          throw new VoicerClientError(
            `Lumean не выдал ссылку на файл результата заказа ${orderId}`,
            { code: "storage_response_invalid", retryable: true, creationUncertain: false, orderKnown: true }
          );
        }
        return await this.downloadOnce(link.url, orderId, signal);
      } catch (error) {
        lastError = error;
        if (error instanceof VoicerAbortError || signal?.aborted) throw error;
        if (!isRetryableVoicerError(error) || attempt + 1 >= this.options.safeRetryAttempts) {
          throw this.afterKnownOrderError(error, orderId);
        }
        await this.safeRetryDelay(attempt, signal);
      }
    }
    throw this.afterKnownOrderError(lastError, orderId);
  }

  private async downloadOnce(url: string, orderId: string, signal?: AbortSignal): Promise<Buffer> {
    throwIfAborted(signal);
    const controller = new AbortController();
    const unlinkAbort = forwardAbort(signal, controller);
    let response: VoicerHttpResponse;
    try {
      const proxy = parseProxyUrl(await this.configuredProxyUrl());
      const operation = proxy
        ? this.options.proxyRequestImpl(url, {
            timeoutMs: this.options.downloadTimeoutMs + 1_000,
            signal: controller.signal,
          }, proxy).then(proxyResponseAdapter)
        : this.options.fetchImpl(url, { signal: controller.signal });
      response = await withTimeout(
        operation,
        proxy ? this.options.downloadTimeoutMs : this.options.requestTimeoutMs,
        () => controller.abort()
      );
    } catch (error) {
      unlinkAbort();
      if (signal?.aborted) throw new VoicerAbortError(false, signal.reason);
      const timedOut = error instanceof DeadlineExceededError;
      throw new VoicerClientError(
        `Не удалось скачать озвучку готового заказа ${orderId}: ${timedOut ? "сервер файла не ответил вовремя" : errorMessage(error)}`,
        { code: timedOut ? "download_timeout" : "download_network", retryable: true, creationUncertain: false, orderKnown: true },
        error
      );
    }
    if (!response.ok) {
      unlinkAbort();
      controller.abort();
      throw new VoicerClientError(
        `Не удалось скачать озвучку готового заказа ${orderId}: HTTP ${response.status}`,
        { code: "download_http", retryable: true, creationUncertain: false, orderKnown: true }
      );
    }
    let raw: ArrayBuffer;
    try {
      raw = await withTimeout(response.arrayBuffer(), this.options.downloadTimeoutMs, () => controller.abort());
    } catch (error) {
      const timedOut = error instanceof DeadlineExceededError;
      if (signal?.aborted) throw new VoicerAbortError(false, signal.reason);
      throw new VoicerClientError(
        `Не удалось получить аудиофайл готового заказа ${orderId}: ${timedOut ? `загрузка дольше ${formatDuration(this.options.downloadTimeoutMs)}` : errorMessage(error)}`,
        { code: timedOut ? "download_timeout" : "download_body", retryable: true, creationUncertain: false, orderKnown: true },
        error
      );
    } finally {
      unlinkAbort();
      controller.abort();
    }
    throwIfAborted(signal);
    const buffer = Buffer.from(raw);
    if (buffer.byteLength === 0) {
      throw new VoicerClientError(
        `Lumean вернул пустой аудиофайл для заказа ${orderId}`,
        { code: "download_empty", retryable: true, creationUncertain: false, orderKnown: true }
      );
    }
    return buffer;
  }

  private afterKnownOrderError(error: unknown, orderId: string): VoicerClientError {
    const detail = error instanceof VoicerClientError ? error.userMessage : errorMessage(error);
    return new VoicerClientError(
      `${detail} Заказ ${orderId} уже создан; автоматический повтор отключён, чтобы не создать платный дубликат.`,
      {
        code: error instanceof VoicerClientError ? error.code : "network",
        retryable: false,
        creationUncertain: false,
        orderKnown: true,
      },
      error
    );
  }

  private async safeRetryDelay(attempt: number, signal?: AbortSignal): Promise<void> {
    const delay = Math.min(15_000, this.options.safeRetryBaseDelayMs * 2 ** attempt);
    if (delay <= 0) {
      throwIfAborted(signal);
      return;
    }
    await withAbort(this.options.sleep(delay), signal);
  }

  private async configuredProxyUrl(): Promise<string | undefined> {
    // Небольшие in-memory stores в тестах и старые интеграции могли не иметь
    // proxyUrl(). Для них сохраняем прежний прямой маршрут.
    const reader = (this.store as VoicerStore & { proxyUrl?: () => Promise<string | undefined> }).proxyUrl;
    return typeof reader === "function" ? reader.call(this.store) : undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class DeadlineExceededError extends Error {
  constructor() {
    super("deadline exceeded");
    this.name = "DeadlineExceededError";
  }
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new DeadlineExceededError());
    }, timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new VoicerAbortError(false, signal.reason));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function forwardAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => undefined;
  const onAbort = () => controller.abort(signal.reason);
  if (signal.aborted) {
    onAbort();
    return () => undefined;
  }
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

function throwIfAborted(signal?: AbortSignal, creationUncertain = false): void {
  if (signal?.aborted) throw new VoicerAbortError(creationUncertain, signal.reason);
}

function positiveTimeout(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeTimeout(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isRetryableVoicerError(error: unknown): error is VoicerClientError {
  return error instanceof VoicerClientError && error.retryable;
}

async function readSampleCheckpoint(
  path: string,
  expected: Pick<TtsSampleCheckpoint, "templateUuid" | "languageCode" | "sampleTextHash" | "baseUrl" | "apiKeyFingerprint">
): Promise<TtsSampleCheckpoint | undefined> {
  const invalid = () => new VoicerClientError(
    "Не удалось прочитать сохранённое состояние калибровки Lumean. Новый заказ не отправлен: проверьте предыдущую генерацию в кабинете Lumean.",
    { code: "order_response_invalid", retryable: false, creationUncertain: true }
  );
  try {
    const parsed = JSON.parse((await readFile(path, "utf8")).replace(/^﻿/, "")) as Partial<TtsSampleCheckpoint>;
    if (parsed.version !== 1 || parsed.provider !== "lumean") throw invalid();
    if (parsed.templateUuid !== expected.templateUuid
      || parsed.languageCode !== expected.languageCode
      || parsed.sampleTextHash !== expected.sampleTextHash
      || parsed.baseUrl !== expected.baseUrl
      || parsed.apiKeyFingerprint !== expected.apiKeyFingerprint) throw invalid();
    if ((typeof parsed.orderId !== "string" || !parsed.orderId.trim()) && parsed.submissionPending !== true) throw invalid();
    if (typeof parsed.createdAt !== "string" || !parsed.createdAt.trim()) throw invalid();
    return parsed as TtsSampleCheckpoint;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw invalid();
  }
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const codes = nestedNetworkCodes(error);
  return codes.length > 0 ? `${error.message} (${codes.join(", ")})` : error.message;
}

/** Из cause берём только машинные коды, не URL и не сообщения с signed query. */
function nestedNetworkCodes(error: Error): string[] {
  const codes = new Set<string>();
  const visited = new Set<unknown>();
  const pending: unknown[] = [error];
  while (pending.length > 0 && visited.size < 12) {
    const current = pending.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    if (typeof current === "object") {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(code)) codes.add(code);
      const cause = (current as { cause?: unknown }).cause;
      if (cause) pending.push(cause);
      const errors = (current as { errors?: unknown }).errors;
      if (Array.isArray(errors)) pending.push(...errors.slice(0, 8));
    }
  }
  return [...codes];
}

function formatDuration(ms: number): string {
  return ms >= 60_000 ? `${Math.ceil(ms / 60_000)} мин.` : `${Math.ceil(ms / 1_000)} сек.`;
}
