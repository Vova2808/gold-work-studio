import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { evaluateFreeSpace, formatBytes, parseYouTubeVideoId, type TranscriptSegment, type YouTubeAnalysisContext, type YouTubeChannelContext, type YouTubeChannelRef, type YouTubeChannelVideoStat } from "@gold-work/shared";
import { YouTubeStore } from "./youtube-store.js";
import { observeNetwork } from "./diagnostics.js";

type AudioTranscriber = (audio: Buffer, format: string) => Promise<TranscriptSegment[]>;

export class YouTubeClient {
  constructor(
    private readonly store: YouTubeStore,
    private readonly transcribeAudio: AudioTranscriber
  ) {}

  async test(): Promise<{ ok: boolean; message: string }> {
    try {
      const key = await this.requiredKey();
      const response = await this.api("videos", { part: "id", id: "dQw4w9WgXcQ" }, key);
      if (!Array.isArray(response.items)) throw new Error("YouTube API вернул неожиданный ответ");
      return { ok: true, message: "YouTube Data API v3 подключён" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Public counters only: one inexpensive channels.list, no AI, videos or comments. */
  async publicChannelStats(ref: YouTubeChannelRef): Promise<import("@gold-work/shared").PublicYouTubeChannelStats> {
    const key = await this.requiredKey();
    const filter: Record<string, string> = ref.kind === "id" ? { id: ref.value } : ref.kind === "user" ? { forUsername: ref.value } : { forHandle: ref.value };
    const response = await this.api("channels", { part: "snippet,statistics", ...filter }, key);
    const channel = asItems(response)[0] as YouTubeChannel | undefined;
    if (!channel?.id || !channel.statistics) throw new Error("YouTube не нашёл канал по этой ссылке. Укажите его актуальный @адрес или /channel/UC…");
    const count = (value: string | undefined): number | null => {
      if (value === undefined) return null;
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < 0) throw new Error("YouTube вернул некорректную статистику канала");
      return n;
    };
    return { channelId: channel.id, title: channel.snippet?.title ?? "YouTube",
      views: count(channel.statistics.viewCount), videos: count(channel.statistics.videoCount),
      subscribers: channel.statistics.hiddenSubscriberCount ? null : count(channel.statistics.subscriberCount) };
  }

  async collect(url: string): Promise<YouTubeAnalysisContext> {
    const videoId = parseYouTubeVideoId(url);
    const key = await this.requiredKey();
    const videoResponse = await this.api("videos", { part: "snippet,statistics,contentDetails", id: videoId }, key);
    const video = asItems(videoResponse)[0] as YouTubeVideo | undefined;
    if (!video) throw new Error("YouTube не вернул данные ролика. Проверьте ссылку и доступ к видео.");
    const channelId = video.snippet.channelId;
    const channelResponse = await this.api("channels", { part: "snippet,statistics,contentDetails", id: channelId }, key);
    const channel = asItems(channelResponse)[0] as YouTubeChannel | undefined;
    if (!channel) throw new Error("YouTube не вернул статистику канала");
    const [comments, topVideos, transcriptResult] = await Promise.all([
      this.comments(videoId, key),
      this.safeTopVideos(channel, key),
      this.safeTranscript(url, videoId)
    ]);
    return {
      videoId,
      title: video.snippet.title,
      description: video.snippet.description ?? "",
      publishedAt: video.snippet.publishedAt,
      durationSeconds: parseIsoDurationSeconds(video.contentDetails?.duration),
      channelId,
      channelTitle: video.snippet.channelTitle,
      views: number(video.statistics.viewCount),
      likes: number(video.statistics.likeCount),
      commentCount: number(video.statistics.commentCount),
      channelSubscribers: number(channel.statistics.subscriberCount),
      channelViews: number(channel.statistics.viewCount),
      channelVideoCount: number(channel.statistics.videoCount),
      transcript: transcriptResult.segments,
      transcriptSource: transcriptResult.source,
      transcriptionAudioMegabytes: transcriptResult.audioMegabytes,
      topComments: comments,
      topVideos,
      visualAnalysisIncluded: false
    };
  }

  private async comments(videoId: string, key: string): Promise<YouTubeAnalysisContext["topComments"]> {
    try {
      const response = await this.api("commentThreads", {
        part: "snippet",
        videoId,
        maxResults: "20",
        order: "relevance",
        textFormat: "plainText"
      }, key);
      return asItems(response).map((item) => {
        const snippet = (item as CommentThread).snippet.topLevelComment.snippet;
        return {
          author: snippet.authorDisplayName,
          text: snippet.textDisplay,
          likes: number(snippet.likeCount),
          publishedAt: snippet.publishedAt
        };
      });
    } catch (error) {
      if (error instanceof Error && /commentsDisabled|disabled/i.test(error.message)) return [];
      throw error;
    }
  }

  /** Полный сбор данных КАНАЛА: статистика, таймлайн загрузок (до 100 роликов) и комментарии под хитами. */
  async collectChannel(ref: YouTubeChannelRef): Promise<YouTubeChannelContext> {
    const key = await this.requiredKey();
    const channel = await this.channelByRef(ref, key);
    const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
    const videos = uploads ? await this.uploadsVideoStats(uploads, key, 100).catch(() => []) : [];
    const topForComments = [...videos].sort((a, b) => b.views - a.views).slice(0, 3);
    const topComments: YouTubeChannelContext["topComments"] = [];
    for (const video of topForComments) {
      const comments = await this.comments(video.id, key).catch(() => []);
      for (const comment of comments.slice(0, 15)) topComments.push({ videoTitle: video.title, ...comment });
    }
    return {
      channelId: channel.id ?? "",
      title: channel.snippet?.title ?? "Канал YouTube",
      description: channel.snippet?.description ?? "",
      subscribers: number(channel.statistics.subscriberCount),
      totalViews: number(channel.statistics.viewCount),
      videoCount: number(channel.statistics.videoCount),
      videos,
      topComments
    };
  }

  private async channelByRef(ref: YouTubeChannelRef, key: string): Promise<YouTubeChannel> {
    const attempts: Array<Record<string, string>> =
      ref.kind === "id" ? [{ id: ref.value }]
        : ref.kind === "handle" ? [{ forHandle: ref.value }]
        : [{ forHandle: `@${ref.value}` }, { forUsername: ref.value }]; // /c/ и /user/: сначала как handle, затем как username
    for (const params of attempts) {
      try {
        const response = await this.api("channels", { part: "snippet,statistics,contentDetails", ...params }, key);
        const channel = asItems(response)[0] as YouTubeChannel | undefined;
        if (channel) return channel;
      } catch {
        // пробуем следующий вариант обращения
      }
    }
    throw new Error("YouTube не нашёл канал по этой ссылке. Проверьте адрес (@handle или /channel/UC…).");
  }

  /** Топ-ролики по просмотрам через плейлист загрузок (~2 единицы квоты вместо 100 у search.list). Сбой не роняет разбор. */
  private async safeTopVideos(channel: YouTubeChannel, key: string): Promise<YouTubeAnalysisContext["topVideos"]> {
    try {
      const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) return [];
      const stats = await this.uploadsVideoStats(uploads, key, 50);
      return stats
        .sort((a, b) => b.views - a.views)
        .slice(0, 10)
        .map(({ id, title, publishedAt, views, likes, commentCount }) => ({ id, title, publishedAt, views, likes, commentCount }));
    } catch {
      return []; // исчерпанная квота или сбой не должны рушить весь разбор
    }
  }

  /** Загрузки канала (до limit роликов) со статистикой и длительностями. */
  private async uploadsVideoStats(playlistId: string, key: string, limit: number): Promise<YouTubeChannelVideoStat[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    while (ids.length < limit) {
      const page = await this.api("playlistItems", {
        part: "contentDetails",
        playlistId,
        maxResults: "50",
        ...(pageToken ? { pageToken } : {})
      }, key);
      for (const item of asItems(page)) {
        const videoId = (item as PlaylistItem).contentDetails?.videoId;
        if (videoId) ids.push(videoId);
      }
      pageToken = page.nextPageToken;
      if (!pageToken) break;
    }
    const stats: YouTubeChannelVideoStat[] = [];
    for (let index = 0; index < Math.min(ids.length, limit); index += 50) {
      const details = await this.api("videos", { part: "snippet,statistics,contentDetails", id: ids.slice(index, index + 50).join(",") }, key);
      for (const item of asItems(details)) {
        const video = item as YouTubeVideo;
        stats.push({
          id: video.id,
          title: video.snippet.title,
          publishedAt: video.snippet.publishedAt,
          durationSeconds: parseIsoDurationSeconds(video.contentDetails?.duration),
          views: number(video.statistics.viewCount),
          likes: number(video.statistics.likeCount),
          commentCount: number(video.statistics.commentCount)
        });
      }
    }
    return stats.slice(0, limit);
  }

  /** Транскрипт необязателен: если получить не удалось (защищённый ролик без cookies), разбор продолжается без текста. */
  private async safeTranscript(url: string, videoId: string): Promise<{
    segments: TranscriptSegment[];
    source: YouTubeAnalysisContext["transcriptSource"];
    audioMegabytes?: number;
  }> {
    try {
      return await this.transcript(url, videoId);
    } catch {
      return { segments: [], source: "none" };
    }
  }

  private async transcript(url: string, videoId: string): Promise<{
    segments: TranscriptSegment[];
    source: YouTubeAnalysisContext["transcriptSource"];
    audioMegabytes?: number;
  }> {
    // 1. Субтитры со страницы ролика: без cookies и без yt-dlp — покрывает большинство роликов.
    try {
      const captions = await transcriptFromWatchPage(videoId);
      if (captions.length > 0) return { segments: captions, source: "captions" };
    } catch {
      // yt-dlp ниже устойчивее для части языков и возрастных ограничений.
    }

    // 2. Готовим рабочую/временную папку и проверяем свободное место (иначе yt-dlp.exe не распакуется).
    const base = await this.resolveWorkBase();
    await assertEnoughSpace(base);
    const directory = await mkdtemp(join(base, "gold-work-youtube-"));
    try {
      // 3. yt-dlp БЕЗ cookies — cookies применяем только как крайнюю меру.
      try {
        return await this.extractWithYtDlp(url, directory, base, undefined);
      } catch (error) {
        if (!isAuthRequired(error)) throw wrapYtDlpError(error);

        // 4. YouTube требует авторизацию. Пробуем cookies, только если они заданы и валидны.
        const cookiesFilePath = await this.store.resolveValidatedCookies();
        if (!cookiesFilePath) {
          throw new Error(
            "Этот ролик требует входа в аккаунт YouTube. Экспортируйте cookies.txt (Netscape) из браузера с активной сессией YouTube и выберите его в Настройки → AI и сценарии — cookies нужны только для таких защищённых роликов."
          );
        }
        try {
          return await this.extractWithYtDlp(url, directory, base, cookiesFilePath);
        } catch (retryError) {
          if (isAuthRequired(retryError)) {
            throw new Error(
              "YouTube отклонил cookies.txt. Откройте YouTube в браузере, экспортируйте свежий cookies.txt и выберите его повторно в Настройки → AI и сценарии."
            );
          }
          throw wrapYtDlpError(retryError);
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Рабочая база для временных файлов yt-dlp: настроенная папка (например D:\\GoldWorkTemp) или системный tmp. */
  private async resolveWorkBase(): Promise<string> {
    const configured = (await this.store.workDir())?.trim();
    const base = configured && configured.length > 0 ? configured : tmpdir();
    await mkdir(base, { recursive: true }).catch(() => undefined);
    return base;
  }

  /** Одна попытка получить транскрипт через yt-dlp (сначала субтитры, затем аудио→Gemini) с заданными cookies или без. */
  private async extractWithYtDlp(url: string, directory: string, base: string, cookiesFilePath?: string): Promise<{
    segments: TranscriptSegment[];
    source: YouTubeAnalysisContext["transcriptSource"];
    audioMegabytes?: number;
  }> {
    const subtitle = await this.ytDlpCaptions(url, directory, base, cookiesFilePath);
    if (subtitle.length > 0) return { segments: subtitle, source: "yt-dlp-captions" };
    const audioPath = await this.ytDlpAudio(url, directory, base, cookiesFilePath);
    const audio = await readFile(audioPath);
    const segments = await this.transcribeAudio(audio, extname(audioPath).slice(1) || "mp3");
    if (segments.length === 0) throw new Error("Gemini не вернул транскрипт аудио");
    return {
      segments,
      source: "gemini-audio",
      audioMegabytes: Math.round((audio.byteLength / 1024 / 1024) * 10) / 10
    };
  }

  private async ytDlpCaptions(url: string, directory: string, base: string, cookiesFilePath?: string): Promise<TranscriptSegment[]> {
    try {
      await runYtDlp([
        ...ytDlpCookieArgs(cookiesFilePath),
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs", "ru.*,en.*",
        "--sub-format", "vtt",
        "--no-playlist",
        "-o", join(directory, "captions"),
        url
      ], base);
      const file = (await readdir(directory)).find((name) => name.endsWith(".vtt"));
      return file ? parseVtt(await readFile(join(directory, file), "utf8")) : [];
    } catch {
      return [];
    }
  }

  private async ytDlpAudio(url: string, directory: string, base: string, cookiesFilePath?: string): Promise<string> {
    // Ошибку не подменяем: сырое сообщение (со stderr yt-dlp) нужно вызывающему коду для классификации авторизации.
    await runYtDlp([
      ...ytDlpCookieArgs(cookiesFilePath),
      "--extract-audio",
      "--audio-format", "mp3",
      "--audio-quality", "7",
      "--no-playlist",
      "-o", join(directory, "audio.%(ext)s"),
      url
    ], base);
    const file = (await readdir(directory)).find((name) => /^audio\./.test(name));
    if (!file) throw new Error("yt-dlp не создал аудиофайл");
    return join(directory, file);
  }

  private async api(resource: string, parameters: Record<string, string>, key: string): Promise<ApiResponse> {
    const query = new URLSearchParams({ ...parameters, key });
    const url = `https://www.googleapis.com/youtube/v3/${resource}?${query}`;
    let response: Response | undefined;
    let lastNetworkError: unknown;
    // До 3 попыток с таймаутом 12с: googleapis.com может быть недоступен (сеть/блокировки) — не висим минутами.
    for (let attempt = 0; attempt < 3 && !response; attempt += 1) {
      try {
        response = await observeNetwork(String(url), "GET", "system", () => fetch(url, { signal: AbortSignal.timeout(12_000) }));
      } catch (error) {
        lastNetworkError = error;
        await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
      }
    }
    if (!response) {
      void lastNetworkError;
      throw new Error(
        "Нет соединения с YouTube API (googleapis.com): запрос не прошёл за 12 секунд после 3 попыток. Проверьте интернет — в некоторых сетях googleapis.com открывается только через VPN."
      );
    }
    const data = await response.json() as ApiResponse & { error?: { message?: string; errors?: Array<{ reason?: string }> } };
    if (!response.ok) {
      const reason = data.error?.errors?.[0]?.reason;
      throw new Error(`YouTube API ${response.status}: ${reason ? `${reason}: ` : ""}${data.error?.message ?? "ошибка запроса"}`);
    }
    return data;
  }

  private async requiredKey(): Promise<string> {
    const key = await this.store.apiKey();
    if (!key) throw new Error("Добавьте ключ YouTube Data API v3 в Настройки → AI и сценарии");
    return key;
  }
}

async function transcriptFromWatchPage(videoId: string): Promise<TranscriptSegment[]> {
  const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=ru`, {
    headers: { "User-Agent": "Mozilla/5.0 GoldWorkStudio/0.2" },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`YouTube watch ${response.status}`);
  const html = await response.text();
  const match = html.match(/"captionTracks":(\[.*?\])/);
  if (!match?.[1]) return [];
  const tracks = JSON.parse(match[1]) as Array<{ baseUrl: string; languageCode?: string; kind?: string }>;
  const track = tracks.find((item) => item.languageCode?.startsWith("ru"))
    ?? tracks.find((item) => item.languageCode?.startsWith("en"))
    ?? tracks.find((item) => item.kind !== "asr")
    ?? tracks[0];
  if (!track) return [];
  const captionsResponse = await fetch(`${track.baseUrl}&fmt=json3`, { signal: AbortSignal.timeout(12_000) });
  if (!captionsResponse.ok) return [];
  const captions = await captionsResponse.json() as {
    events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }>;
  };
  return (captions.events ?? []).flatMap((event) => {
    const text = (event.segs ?? []).map((segment) => segment.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    return text ? [{
      startSeconds: (event.tStartMs ?? 0) / 1000,
      durationSeconds: (event.dDurationMs ?? 0) / 1000,
      text
    }] : [];
  });
}

function parseVtt(content: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const blocks = content.replace(/\r/g, "").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [startRaw, endRaw] = lines[timingIndex]!.split("-->").map((part) => part.trim().split(/\s/)[0]!);
    const start = vttSeconds(startRaw ?? "0:00");
    const end = vttSeconds(endRaw ?? startRaw ?? "0:00");
    const text = lines.slice(timingIndex + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text && text !== segments.at(-1)?.text) segments.push({ startSeconds: start, durationSeconds: Math.max(0, end - start), text });
  }
  return segments;
}

function vttSeconds(value: string): number {
  const parts = value.replace(",", ".").split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

/** Разбирает длительность YouTube (ISO 8601, напр. "PT9M3S") в секунды. Неизвестно → 0. */
function parseIsoDurationSeconds(iso?: string): number {
  if (!iso) return 0;
  const match = /^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

/** Проверяет свободное место в рабочей папке. Если определить не удалось — не блокируем запуск. */
async function assertEnoughSpace(base: string): Promise<void> {
  let availableBytes: number;
  try {
    const stats = await statfs(base);
    availableBytes = stats.bavail * stats.bsize;
  } catch {
    return;
  }
  const result = evaluateFreeSpace(availableBytes);
  if (!result.ok) {
    throw new Error(
      `Недостаточно свободного места в рабочей папке для yt-dlp: ${base}. ` +
      `Свободно ${formatBytes(result.availableBytes)}, требуется минимум ${formatBytes(result.requiredBytes)}. ` +
      "Освободите место или выберите рабочую папку на диске с достаточным местом в Настройки → AI и сценарии."
    );
  }
}

/** Похоже ли, что yt-dlp упал из-за требования авторизации/возрастного ограничения (может помочь cookies). */
function isAuthRequired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Sign in to confirm|not a bot|use --cookies|cookies|age[- ]?restrict|confirm your age|login required|members-only|private video|consent/i.test(message);
}

function wrapYtDlpError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Не удалось получить субтитры или аудио через yt-dlp: ${message}`);
}

async function runYtDlp(args: string[], base: string): Promise<void> {
  const bundled = join(process.resourcesPath || "", "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  const candidates = [process.env.YT_DLP_PATH, existsSync(bundled) ? bundled : undefined, "yt-dlp"].filter((value): value is string => Boolean(value));
  let lastError: unknown;
  for (const executable of candidates) {
    try {
      await runProcess(executable, args, base);
      return;
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw lastError ?? new Error("yt-dlp не найден");
}

function ytDlpCookieArgs(cookiesFilePath?: string): string[] {
  return cookiesFilePath ? ["--cookies", cookiesFilePath] : [];
}

function runProcess(executable: string, args: string[], base: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Указываем рабочую папку и TEMP/TMP: yt-dlp.exe (PyInstaller) распаковывается сюда, а не в переполненный C:\Temp.
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
      cwd: base,
      env: { ...process.env, TEMP: base, TMP: base, TMPDIR: base }
    });
    let errorText = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      errorText = `${errorText}${chunk}`.slice(-3000);
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`yt-dlp завершился с кодом ${code}: ${errorText.trim()}`)));
  });
}

function number(value: string | number | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asItems(response: ApiResponse): unknown[] {
  return Array.isArray(response.items) ? response.items : [];
}

interface ApiResponse {
  items?: unknown[];
  nextPageToken?: string;
}

interface PlaylistItem {
  contentDetails?: { videoId?: string };
}

interface YouTubeVideo {
  id: string;
  snippet: { title: string; description?: string; publishedAt: string; channelId: string; channelTitle: string };
  statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
}

interface YouTubeChannel {
  id?: string;
  snippet?: { title?: string; description?: string };
  statistics: { subscriberCount?: string; hiddenSubscriberCount?: boolean; viewCount?: string; videoCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

interface CommentThread {
  snippet: {
    topLevelComment: {
      snippet: { authorDisplayName: string; textDisplay: string; likeCount?: number; publishedAt: string };
    };
  };
}
