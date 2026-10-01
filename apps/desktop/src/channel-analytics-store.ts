import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ANALYTICS_AUTO_REFRESH_MS, ANALYTICS_MANUAL_REFRESH_MS, parseYouTubeChannelRef,
  type PublicYouTubeChannelStats, type SaveTrackedChannelInput, type TrackedYouTubeChannel,
  type YouTubeChannelRef } from "@gold-work/shared";
import { atomicWrite } from "./fs-utils.js";

const HISTORY_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeTrackedChannelUrl(input: string): string {
  if (typeof input !== "string" || input.length > 500) throw new Error("Введите ссылку на канал YouTube");
  const text = input.trim();
  const url = text.startsWith("@") ? `https://www.youtube.com/${text}`
    : /^UC[A-Za-z0-9_-]{22}$/.test(text) ? `https://www.youtube.com/channel/${text}`
    : /^((www|m)\.)?youtube\.com\//i.test(text) ? `https://${text}` : text;
  const ref = parseYouTubeChannelRef(url);
  if (!ref || !/^https?:$/.test(new URL(url).protocol) || new URL(url).username || new URL(url).password) {
    throw new Error("Нужна ссылка на канал YouTube (@имя или /channel/UC…), а не на отдельное видео");
  }
  if (ref.kind === "custom") throw new Error("Для старой ссылки /c/ укажите актуальный @адрес или /channel/UC… из YouTube");
  const path = ref.kind === "handle" ? ref.value : `${ref.kind === "id" ? "channel" : "user"}/${ref.value}`;
  return `https://www.youtube.com/${path}`;
}

function label(value: unknown, max: number, fallback = ""): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > max) throw new Error(`Название должно быть не длиннее ${max} символов`);
  return value.trim();
}

/** Independent local tracking file; never edits production channels or projects. */
export class ChannelAnalyticsStore {
  private writes: Promise<unknown> = Promise.resolve();
  private refreshInFlight?: Promise<TrackedYouTubeChannel[]>;

  constructor(private readonly path: string,
    private readonly fetchStats: (ref: YouTubeChannelRef) => Promise<PublicYouTubeChannelStats>,
    private readonly now: () => number = Date.now) {}

  private async read(): Promise<TrackedYouTubeChannel[]> {
    try {
      const data = JSON.parse(await readFile(this.path, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.channels)
        || data.channels.some((c: TrackedYouTubeChannel) => !c || typeof c.id !== "string" || typeof c.url !== "string" || !Array.isArray(c.snapshots))) {
        throw new Error("Неверный формат файла аналитики. Исходный файл сохранён, перезапись отменена.");
      }
      return data.channels;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private mutate(operation: (channels: TrackedYouTubeChannel[]) => void): Promise<TrackedYouTubeChannel[]> {
    const next = this.writes.then(async () => {
      const channels = await this.read();
      operation(channels);
      for (const channel of channels) channel.snapshots = channel.snapshots
        .filter(snapshot => Date.parse(snapshot.capturedAt) >= this.now() - HISTORY_MS).slice(-720);
      await atomicWrite(this.path, JSON.stringify({ version: 1, channels }, null, 2));
      return channels;
    });
    this.writes = next.catch(() => undefined);
    return next;
  }

  async list(): Promise<TrackedYouTubeChannel[]> {
    await this.writes;
    const channels = await this.read();
    if (channels.some(c => c.snapshots.some(s => Date.parse(s.capturedAt) < this.now() - HISTORY_MS))) {
      return this.mutate(() => {});
    }
    return channels;
  }

  save(input: SaveTrackedChannelInput): Promise<TrackedYouTubeChannel[]> {
    const url = normalizeTrackedChannelUrl(input.url);
    const name = label(input.name, 120);
    if (!name) throw new Error("Дайте каналу короткое название");
    const group = label(input.group, 80);
    return this.mutate(channels => {
      const previous = input.id ? channels.find(c => c.id === input.id) : undefined;
      if (input.id && !previous) throw new Error("Канал уже удалён из аналитики");
      if (previous && previous.url !== url) throw new Error("Для другой ссылки добавьте отдельный канал: история не должна смешиваться");
      if (channels.some(c => c.id !== input.id && c.url.toLowerCase() === url.toLowerCase())) throw new Error("Этот канал уже добавлен в аналитику");
      if (previous) Object.assign(previous, { name, group });
      else {
        if (channels.length >= 100) throw new Error("В аналитике можно отслеживать до 100 каналов");
        channels.push({ id: randomUUID(), name, group, url, addedAt: new Date(this.now()).toISOString(), snapshots: [] });
      }
    });
  }

  remove(id: string): Promise<TrackedYouTubeChannel[]> {
    return this.mutate(channels => {
      const index = channels.findIndex(c => c.id === id);
      if (index >= 0) channels.splice(index, 1);
    });
  }

  refresh(input: { id?: string; automatic?: boolean } = {}): Promise<TrackedYouTubeChannel[]> {
    // Calls from multiple windows share the same refresh; no duplicate API requests.
    if (this.refreshInFlight) return this.refreshInFlight;
    const run = this.performRefresh(input).finally(() => { this.refreshInFlight = undefined; });
    this.refreshInFlight = run;
    return run;
  }

  private async performRefresh(input: { id?: string; automatic?: boolean }): Promise<TrackedYouTubeChannel[]> {
    const interval = input.automatic ? ANALYTICS_AUTO_REFRESH_MS : ANALYTICS_MANUAL_REFRESH_MS;
    const candidates = (await this.list()).filter(c => (!input.id || c.id === input.id)
      && (!c.lastAttemptAt || this.now() - Date.parse(c.lastAttemptAt) >= interval));
    const update = async (candidate: TrackedYouTubeChannel) => {
      const capturedAt = new Date(this.now()).toISOString();
      try {
        const stats = await this.fetchStats(candidate.channelId ? { kind: "id", value: candidate.channelId } : parseYouTubeChannelRef(candidate.url)!);
        if (!/^UC[A-Za-z0-9_-]{22}$/.test(stats.channelId)
          || [stats.views, stats.subscribers, stats.videos].some(n => n !== null && (!Number.isSafeInteger(n) || n < 0))) {
          throw new Error("YouTube вернул неполные или некорректные счётчики");
        }
        await this.mutate(channels => {
          const current = channels.find(c => c.id === candidate.id);
          if (!current) return; // Removal during the request must not resurrect the record.
          if (channels.some(c => c.id !== current.id && c.channelId === stats.channelId)) {
            throw new Error("Этот YouTube-канал уже отслеживается под другой ссылкой");
          }
          current.channelId = stats.channelId;
          current.youtubeTitle = stats.title;
          current.lastAttemptAt = capturedAt;
          delete current.lastError;
          // One observed point per hour, never invent historical daily views.
          current.snapshots = current.snapshots.filter(s => s.capturedAt.slice(0, 13) !== capturedAt.slice(0, 13));
          current.snapshots.push({ capturedAt, views: stats.views, subscribers: stats.subscribers, videos: stats.videos });
        });
      } catch (error) {
        await this.mutate(channels => {
          const current = channels.find(c => c.id === candidate.id);
          if (!current) return;
          current.lastAttemptAt = capturedAt;
          current.lastError = error instanceof Error ? error.message.slice(0, 600) : "Не удалось обновить данные YouTube";
        });
      }
    };
    for (let offset = 0; offset < candidates.length; offset += 3) await Promise.all(candidates.slice(offset, offset + 3).map(update));
    return this.list();
  }
}
