import { GoogleStore } from "./google-store.js";
import { setTimeout as waitForPoll } from "node:timers/promises";
import { parseProxyUrl, proxyRequest, ProxyConnectError, type ProxyResponse } from "./proxy-utils.js";
import { describeNetworkError, googleError, isDefiniteMediaRejection, type PaidMediaSubmission } from "./google-errors.js";
import type { ProviderVideoJob } from "@gold-work/shared";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 15 * 60_000;

interface InteractionContent {
  type?: string;
  data?: string;
  uri?: string;
  mime_type?: string;
}

interface InteractionResponse {
  id?: string;
  status?: string;
  steps?: Array<{ type?: string; content?: InteractionContent[] }>;
  error?: { message?: string };
}

interface VeoOperation {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string } }>;
      raiMediaFilteredReasons?: string[];
    };
  };
}

type VeoVideoJob = Extract<ProviderVideoJob, { provider: "veo" }>;
type VeoSubmission = PaidMediaSubmission & { resumeJob?: VeoVideoJob; onJobKnown(job: VeoVideoJob): Promise<void> };

/**
 * Видео из картинки через Google AI Studio.
 * Модели gemini-omni-* идут по Interactions API, veo-* — по predictLongRunning.
 */
export class VeoClient {
  constructor(private readonly store: GoogleStore) {}

  async configured(): Promise<boolean> {
    return (await this.store.publicSettings()).configured;
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    try {
      const key = await this.requiredKey();
      const settings = await this.store.publicSettings();
      const model = settings.veoModel?.trim() || "veo-3.1-lite-generate-preview";
      const response = await this.request(`${BASE}/models/${encodeURIComponent(model)}`, {
        headers: { "x-goog-api-key": key },
        timeoutMs: 30_000
      });
      if (!response.ok) throw new Error(googleError(response));
      const methods = response.json<{ supportedGenerationMethods?: string[] }>().supportedGenerationMethods ?? [];
      if (!methods.includes("predictLongRunning")) {
        throw new Error(`Модель ${model} не умеет генерировать видео. Выберите Veo 3.1 Lite, Fast или обычную Veo 3.1.`);
      }
      return { ok: true, message: `Google AI Studio и SOCKS5 работают. Модель ${model} видна ключу. Генерация требует оплаченной квоты проекта — она проверится при запуске первой сцены.` };
    } catch (error) {
      return { ok: false, message: describeNetworkError(error) };
    }
  }

  /** Оживляет кадр сцены: промпт + стартовая картинка. Возвращает MP4. */
  async generateVideo(prompt: string, aspectRatio: string, sourceImage?: Buffer, submission?: VeoSubmission): Promise<Buffer> {
    try {
      if (submission?.resumeJob) {
        return await this.downloadOperation(submission.resumeJob.operationName, {}, await this.requiredKey(), submission.signal);
      }
      const settings = await this.store.publicSettings();
      const model = settings.veoModel?.trim() || "veo-3.1-lite-generate-preview";
      const ratio = aspectRatio === "9:16" ? "9:16" : "16:9";
      const text = prompt.trim() || "Gentle cinematic camera motion, natural movement of the subject, single continuous shot";
      return model.startsWith("veo")
        ? await this.generateWithVeo(model, text, ratio, sourceImage, submission)
        : await this.generateWithOmni(model, text, ratio, sourceImage, submission);
    } catch (error) {
      const message = describeNetworkError(error);
      if (error instanceof Error && error.message === message) throw error;
      throw new Error(message);
    }
  }

  /** Interactions API (gemini-omni-flash-preview): синхронный ответ, видео inline base64 или по uri. */
  private async generateWithOmni(model: string, prompt: string, ratio: string, sourceImage?: Buffer, submission?: VeoSubmission): Promise<Buffer> {
    const key = await this.requiredKey();
    const input: Array<Record<string, unknown>> = [];
    if (sourceImage) input.push({ type: "image", data: sourceImage.toString("base64"), mime_type: "image/png" });
    input.push({ type: "text", text: sourceImage ? `${prompt}. Use the image as the starting frame, single continuous shot` : prompt });
    const response = await this.request(`${BASE}/interactions`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      timeoutMs: REQUEST_TIMEOUT_MS,
      body: JSON.stringify({
        model,
        input,
        response_format: { type: "video", aspect_ratio: ratio, delivery: "uri" },
        generation_config: { video_config: { task: sourceImage ? "image_to_video" : "text_to_video" } },
        // store обязателен при delivery=uri (иначе 400); фон и стрим не нужны — берём готовый клип за один вызов.
        store: true,
        background: false,
        stream: false
      })
    }, submission);
    if (!response.ok) throw new Error(googleError(response));
    const interaction = response.json<InteractionResponse>();
    if (interaction.error?.message) throw new Error(`Omni Flash: ${interaction.error.message}`);
    const video = interaction.steps
      ?.flatMap((step) => step.content ?? [])
      .find((content) => content.type === "video");
    if (!video) throw new Error("Omni Flash не вернул видео (возможно, промпт заблокирован фильтром безопасности)");
    if (video.data) return Buffer.from(video.data, "base64");
    if (!video.uri) throw new Error("Omni Flash вернул пустой результат");
    return this.downloadFileUri(video.uri, key);
  }

  /** Файл по uri: ждём состояния ACTIVE и скачиваем. */
  private async downloadFileUri(uri: string, key: string, signal?: AbortSignal): Promise<Buffer> {
    const fileName = uri.split("/").pop()?.split(":")[0];
    if (fileName) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 5 * 60_000) {
        const info = await this.request(`${BASE}/files/${encodeURIComponent(fileName)}`, {
          signal,
          headers: { "x-goog-api-key": key },
          timeoutMs: 30_000
        });
        if (!info.ok) break; // файл может быть сразу доступен для скачивания
        const state = (info.json<{ state?: string }>()).state;
        if (state === "ACTIVE") break;
        if (state === "FAILED") throw new Error("Google: обработка видеофайла завершилась ошибкой");
        await sleep(4_000, signal);
      }
    }
    const download = await this.request(uri.includes("alt=media") ? uri : `${uri}?alt=media`, {
      signal,
      headers: { "x-goog-api-key": key },
      timeoutMs: REQUEST_TIMEOUT_MS
    });
    if (!download.ok) throw new Error(`Не удалось скачать видео: HTTP ${download.status}`);
    const buffer = download.body;
    if (buffer.byteLength === 0) throw new Error("Google вернул пустой видеофайл");
    return buffer;
  }

  /** Классический Veo: predictLongRunning + поллинг операции. */
  private async generateWithVeo(model: string, prompt: string, ratio: string, sourceImage?: Buffer, submission?: VeoSubmission): Promise<Buffer> {
    const key = await this.requiredKey();
    const startResponse = await this.request(`${BASE}/models/${encodeURIComponent(model)}:predictLongRunning`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      timeoutMs: 60_000,
      body: JSON.stringify({
        instances: [{
          prompt,
          ...(sourceImage ? { image: { bytesBase64Encoded: sourceImage.toString("base64"), mimeType: "image/png" } } : {})
        }],
        parameters: { aspectRatio: ratio }
      })
    }, submission);
    if (!startResponse.ok) throw new Error(googleError(startResponse));
    const started = startResponse.json<VeoOperation>();
    if (typeof started.name !== "string" || !started.name.trim()) throw new Error("Veo не вернул идентификатор операции");
    await submission?.onJobKnown({ provider: "veo", operationName: started.name });
    return this.downloadOperation(started.name, started, key, submission?.signal);
  }

  private async downloadOperation(name: string, started: VeoOperation, key: string, signal?: AbortSignal): Promise<Buffer> {
    const startedAt = Date.now();
    let operation: VeoOperation = started;
    while (!operation.done && Date.now() - startedAt < 12 * 60_000) {
      await sleep(6_000, signal);
      const poll = await this.request(`${BASE}/${name}`, {
        signal,
        headers: { "x-goog-api-key": key },
        timeoutMs: 30_000
      });
      if (!poll.ok) throw new Error(googleError(poll));
      operation = poll.json<VeoOperation>();
    }
    if (!operation.done) throw new Error("Veo: истекло время ожидания видео (12 минут)");
    if (operation.error) throw new Error(`Veo: ${operation.error.message ?? "ошибка генерации"}`);
    const sample = operation.response?.generateVideoResponse?.generatedSamples?.[0];
    const filtered = operation.response?.generateVideoResponse?.raiMediaFilteredReasons;
    if (!sample?.video?.uri) {
      throw new Error(filtered?.length
        ? `Veo отклонил промпт фильтром безопасности: ${filtered[0]}`
        : "Veo не вернул видео");
    }
    return this.downloadFileUri(sample.video.uri, key, signal);
  }

  private async requiredKey(): Promise<string> {
    const key = await this.store.apiKey();
    if (!key) throw new Error("Добавьте ключ Google AI Studio в Настройки → AI и сценарии");
    return key;
  }

  /** Единая точка выхода в Google: при заданном прокси запрос идёт через SOCKS5-туннель. */
  private async request(url: string, init: Parameters<typeof proxyRequest>[1], submission?: PaidMediaSubmission): Promise<ProxyResponse> {
    const { proxyUrl } = await this.store.publicSettings();
    const proxy = parseProxyUrl(proxyUrl);
    await submission?.beforeSubmit();
    let response: ProxyResponse;
    try { response = await proxyRequest(url, submission ? { ...init, redirect: "error" } : init, proxy); }
    catch (error) {
      if (error instanceof ProxyConnectError) await submission?.onRejected();
      throw error;
    }
    if (isDefiniteMediaRejection(response.status)) await submission?.onRejected();
    return response;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return waitForPoll(ms, undefined, { signal });
}
