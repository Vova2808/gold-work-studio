import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VoicerTemplate } from "@gold-work/shared";
import { VoicerStore } from "./voicer-store.js";

const SAMPLE_TEXTS: Record<string, string> = {
  ru: "Так звучит этот голос. Отлично подходит для озвучки роликов.",
  en: "This is how this voice sounds. A great fit for video narration.",
  es: "Así suena esta voz. Perfecta para narrar videos.",
  de: "So klingt diese Stimme. Ideal für Video-Vertonung.",
  fr: "Voici comment sonne cette voix. Parfaite pour la narration vidéo.",
  it: "Ecco come suona questa voce. Perfetta per la narrazione video.",
  pt: "É assim que esta voz soa. Perfeita para narração de vídeos.",
  uk: "Так звучить цей голос. Чудово підходить для озвучення роликів."
};

/** Клиент Voicer API (TTS на ElevenLabs): POST /tasks → поллинг статуса → GET /tasks/{id}/result (MP3). */
export class VoicerClient {
  constructor(private readonly store: VoicerStore) {}

  async configured(): Promise<boolean> {
    const settings = await this.store.publicSettings();
    return settings.configured && settings.baseUrl.trim().length > 0;
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    try {
      const balance = await this.request<{ balance_text?: string; balance?: number }>("GET", "/balance");
      return { ok: true, message: `Voicer подключён. Баланс: ${balance.balance_text ?? `${balance.balance ?? "?"} символов`}` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Шаблоны настроек озвучки (создаются в Telegram-боте Voicer, выбираются здесь). */
  async templates(): Promise<VoicerTemplate[]> {
    const data = await this.request<unknown>("GET", "/templates");
    const list = Array.isArray(data) ? data : Array.isArray((data as { templates?: unknown[] })?.templates) ? (data as { templates: unknown[] }).templates : [];
    return list
      .map((item) => item as { uuid?: string; name?: string; broken?: boolean })
      .filter((item) => typeof item.uuid === "string" && !item.broken)
      .map((item) => ({ uuid: item.uuid as string, name: item.name || "Шаблон", broken: false }));
  }

  /** Полный цикл озвучки текста; templateUuid — шаблон голоса (без него — настройки по умолчанию). */
  async tts(text: string, templateUuid?: string): Promise<Buffer> {
    const input = text.trim();
    if (!input) throw new Error("Пустой текст для озвучки");
    const created = await this.request<{ task_id?: number }>("POST", "/tasks", {
      text: input,
      ...(templateUuid ? { template_uuid: templateUuid } : {})
    });
    const taskId = created.task_id;
    if (taskId === undefined || taskId === null) throw new Error("Voicer не вернул id задачи");
    const startedAt = Date.now();
    let ready = false;
    while (Date.now() - startedAt < 15 * 60_000) {
      await sleep(3_000);
      const status = await this.request<{ status?: string; error?: { ru?: string; en?: string } | null }>("GET", `/tasks/${taskId}/status`);
      if (status.status === "ending" || status.status === "ending_processed") {
        ready = true;
        break;
      }
      if (status.status === "error" || status.status === "error_handled") {
        throw new Error(`Voicer: ${status.error?.ru || status.error?.en || "ошибка синтеза"}`);
      }
    }
    if (!ready) throw new Error("Voicer: истекло время ожидания озвучки (15 минут)");
    return this.requestBinary(`/tasks/${taskId}/result`);
  }

  /** Пример голоса шаблона с кэшем: одна платная генерация на шаблон, дальше мгновенно. */
  async ttsSample(templateUuid: string | undefined, languageCode: string, cacheDir: string): Promise<string> {
    const key = (templateUuid || "default").replace(/[^a-z0-9-]/gi, "_");
    const cachePath = join(cacheDir, `voicer-${key}.mp3`);
    try {
      return (await readFile(cachePath)).toString("base64");
    } catch {
      // кэша нет — генерируем ниже
    }
    const short = languageCode.split("-")[0]?.toLowerCase() ?? "ru";
    const audio = await this.tts(SAMPLE_TEXTS[short] ?? SAMPLE_TEXTS.ru!, templateUuid);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, audio);
    return audio.toString("base64");
  }

  private async endpoint(path: string): Promise<{ url: string; key: string }> {
    const settings = await this.store.publicSettings();
    const key = await this.store.apiKey();
    if (!key) throw new Error("Сначала сохраните API-ключ Voicer в Настройки → AI и сценарии");
    if (!settings.baseUrl.trim()) throw new Error("Укажите Base URL Voicer в Настройки → AI и сценарии");
    return { url: `${settings.baseUrl.replace(/\/+$/, "")}${path}`, key };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { url, key } = await this.endpoint(path);
    const response = await fetch(url, {
      method,
      headers: { "X-API-Key": key, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw new Error(await voicerError(response));
    return await response.json() as T;
  }

  private async requestBinary(path: string): Promise<Buffer> {
    const { url, key } = await this.endpoint(path);
    const response = await fetch(url, { headers: { "X-API-Key": key } });
    if (!response.ok) throw new Error(await voicerError(response));
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("zip")) {
      throw new Error("Voicer вернул архив чанков. Поставьте в шаблоне тип результата «default» (единый MP3).");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0) throw new Error("Voicer вернул пустой результат");
    return buffer;
  }
}

async function voicerError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { detail?: string | { ru?: string; en?: string } };
    const detail = parsed.detail;
    if (typeof detail === "string") return `Voicer ${response.status}: ${detail}`;
    if (detail?.ru || detail?.en) return `Voicer ${response.status}: ${detail.ru ?? detail.en}`;
  } catch {
    // не JSON — вернём как есть
  }
  if (response.status === 401 || response.status === 403) return "Voicer отклонил ключ API. Проверьте ключ и подписку.";
  return `Voicer ${response.status}: ${text.slice(0, 200)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
