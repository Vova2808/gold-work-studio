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

interface LumeanEnvelope<T> {
  success?: boolean;
  message?: string;
  data?: T;
}

interface LumeanOrder {
  id: string;
  status: string;
  progress_percent?: number;
  result?: { files?: string[]; service_files?: string[] } | null;
}

/** Клиент Lumean Public API (озвучка ElevenLabs): POST /orders → поллинг → /storage/url → MP3. */
export class VoicerClient {
  constructor(private readonly store: VoicerStore) {}

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
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** TTS-шаблоны пользователя (создаются в кабинете Lumean или этим приложением). */
  async templates(): Promise<VoicerTemplate[]> {
    const data = await this.request<Array<{ id?: string; name?: string; service_key?: string }>>("GET", "/templates");
    return (Array.isArray(data) ? data : [])
      .filter((item) => typeof item.id === "string" && (item.service_key === "elevenlabs" || !item.service_key))
      .map((item) => ({ uuid: item.id as string, name: item.name || "Шаблон", broken: false }));
  }

  /** Полный цикл озвучки: заказ по шаблону → ожидание completed → ссылка на файл → скачивание MP3. */
  async tts(text: string, templateUuid?: string): Promise<Buffer> {
    const input = text.trim();
    if (!input) throw new Error("Пустой текст для озвучки");
    let template = templateUuid?.trim();
    if (!template) {
      const list = await this.templates();
      template = list[0]?.uuid;
      if (!template) throw new Error("В Lumean нет TTS-шаблонов. Выберите голос в проекте или создайте шаблон в кабинете Lumean.");
    }
    const created = await this.request<LumeanOrder>("POST", "/orders", { template_id: template, input_text: input });
    const orderId = created?.id;
    if (!orderId) throw new Error("Lumean не вернул id заказа");

    const startedAt = Date.now();
    let order: LumeanOrder | undefined;
    while (Date.now() - startedAt < 15 * 60_000) {
      await sleep(3_000);
      order = await this.request<LumeanOrder>("GET", `/orders/${orderId}`);
      const status = order?.status ?? "";
      if (status === "completed" || status === "result_delivered") break;
      if (status === "failed" || status === "compensated" || status === "cancelled") {
        throw new Error(`Lumean: заказ озвучки завершился со статусом «${status}»`);
      }
      if (status === "partially_completed") {
        throw new Error("Lumean: часть текста отклонена модерацией провайдера. Перефразируйте текст сцены и повторите.");
      }
    }
    const filePath = order?.result?.files?.[0];
    if (!filePath) throw new Error("Lumean: озвучка не успела за 15 минут или файл результата отсутствует");
    const link = await this.request<{ url?: string }>("POST", "/storage/url", { path: filePath });
    if (!link?.url) throw new Error("Lumean не выдал ссылку на файл результата");
    const download = await fetch(link.url);
    if (!download.ok) throw new Error(`Не удалось скачать озвучку Lumean: HTTP ${download.status}`);
    const buffer = Buffer.from(await download.arrayBuffer());
    if (buffer.byteLength === 0) throw new Error("Lumean вернул пустой аудиофайл");
    return buffer;
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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const settings = await this.store.publicSettings();
    const key = await this.store.apiKey();
    if (!key) throw new Error("Сначала сохраните API-ключ Lumean в Настройки → AI и сценарии");
    if (!settings.baseUrl.trim()) throw new Error("Укажите Base URL Lumean в Настройки → AI и сценарии");
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}${path}`, {
      method,
      headers: { "X-API-KEY": key, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const text = await response.text();
    let parsed: LumeanEnvelope<T> | undefined;
    try {
      parsed = JSON.parse(text) as LumeanEnvelope<T>;
    } catch {
      // не-JSON обработаем ниже
    }
    if (!response.ok) {
      if (response.status === 402) {
        throw new Error("Lumean: не хватает квоты подписки на эту генерацию. Оформите подписку или пополните баланс в кабинете lumean.app.");
      }
      if (response.status === 401) throw new Error("Lumean отклонил ключ API. Проверьте ключ в Настройках.");
      if (response.status === 403) throw new Error(`Lumean: у ключа нет нужного права (${parsed?.message ?? "forbidden"}). Создайте ключ с пресетом full.`);
      throw new Error(`Lumean ${response.status}: ${parsed?.message ?? text.slice(0, 200)}`);
    }
    return (parsed?.data ?? (parsed as unknown)) as T;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
