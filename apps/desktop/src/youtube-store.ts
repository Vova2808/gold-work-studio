import { safeStorage } from "electron";
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { atomicWrite } from "./fs-utils.js";
import { parseProxyUrl, proxyDisplayName } from "./proxy-utils.js";
import { describeCookiesProblem, validateCookiesContent, type SaveYouTubeSettingsInput, type YouTubeSettings } from "@gold-work/shared";

interface StoredYouTubeSettings {
  encryptedApiKey?: string;
  encryptedProxyUrl?: string;
  downloadRoute?: "system" | "proxy" | "public-dns";
  cookiesFilePath?: string;
  workDirPath?: string;
}

export class YouTubeStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async publicSettings(): Promise<YouTubeSettings> {
    const stored = await this.read();
    return {
      configured: Boolean(stored.encryptedApiKey),
      proxyConfigured: Boolean(stored.encryptedProxyUrl),
      proxyDisplayName: proxyDisplayName(await this.proxyUrl()),
      downloadRoute: stored.downloadRoute ?? (stored.encryptedProxyUrl ? "proxy" : "system"),
      cookiesFileConfigured: Boolean(stored.cookiesFilePath),
      cookiesFileName: stored.cookiesFilePath ? basename(stored.cookiesFilePath) : undefined,
      workDirConfigured: Boolean(stored.workDirPath),
      workDirPath: stored.workDirPath
    };
  }

  async cookiesFilePath(): Promise<string | undefined> {
    return (await this.read()).cookiesFilePath ?? process.env.YT_DLP_COOKIES_PATH;
  }

  /** Рабочая/временная папка для yt-dlp (или переопределение через окружение). undefined — использовать системный tmp. */
  async workDir(): Promise<string | undefined> {
    return (await this.read()).workDirPath ?? process.env.GOLD_WORK_TEMP_DIR;
  }

  /**
   * Пред-проверка cookies перед запуском yt-dlp. Возвращает путь, если cookies заданы и валидны;
   * undefined — если не заданы; бросает понятную ошибку, если заданы, но некорректны или недоступны.
   * Содержимое cookies никогда не логируется и не возвращается наружу.
   */
  async resolveValidatedCookies(): Promise<string | undefined> {
    const cookiesFilePath = await this.cookiesFilePath();
    if (!cookiesFilePath) return undefined;
    let content: string;
    try {
      content = await readFile(cookiesFilePath, "utf8");
    } catch {
      throw new Error("Файл cookies.txt не найден по сохранённому пути. Выберите его заново в Настройки → AI и сценарии.");
    }
    const problem = describeCookiesProblem(validateCookiesContent(content));
    if (problem) throw new Error(problem);
    return cookiesFilePath;
  }

  async apiKey(): Promise<string | undefined> {
    const encrypted = (await this.read()).encryptedApiKey;
    if (!encrypted) return undefined;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }

  async save(input: SaveYouTubeSettingsInput): Promise<YouTubeSettings> {
    const current = await this.read();
    let changed = false;
    if (input.downloadRoute !== undefined) {
      if (!["system", "proxy", "public-dns"].includes(input.downloadRoute)) throw new Error("Неизвестный маршрут загрузки YouTube");
      current.downloadRoute = input.downloadRoute; changed = true;
    }
    if (input.clearProxy || input.proxyUrl !== undefined) {
      const proxyUrl = input.clearProxy ? "" : input.proxyUrl!.trim();
      if (proxyUrl) {
        parseProxyUrl(proxyUrl);
        if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
        current.encryptedProxyUrl = safeStorage.encryptString(proxyUrl).toString("base64");
      } else delete current.encryptedProxyUrl;
      changed = true;
    }
    if (input.apiKey?.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
      current.encryptedApiKey = safeStorage.encryptString(input.apiKey.trim()).toString("base64");
      changed = true;
    }
    if (input.cookiesFilePath?.trim()) {
      const cookiesFilePath = input.cookiesFilePath.trim();
      const content = await readFile(cookiesFilePath, "utf8");
      const problem = describeCookiesProblem(validateCookiesContent(content));
      if (problem) throw new Error(problem);
      current.cookiesFilePath = cookiesFilePath;
      changed = true;
    }
    if (input.clearCookiesFile) {
      delete current.cookiesFilePath;
      changed = true;
    }
    if (input.workDirPath?.trim()) {
      const workDirPath = input.workDirPath.trim();
      const info = await stat(workDirPath).catch(() => undefined);
      if (!info?.isDirectory()) {
        throw new Error("Выбранная рабочая папка не найдена или не является папкой");
      }
      try {
        await access(workDirPath, constants.W_OK);
      } catch {
        throw new Error("Нет прав на запись в выбранную рабочую папку. Выберите другую папку.");
      }
      current.workDirPath = workDirPath;
      changed = true;
    }
    if (input.clearWorkDir) {
      delete current.workDirPath;
      changed = true;
    }
    if (changed) await this.write(current);
    return this.publicSettings();
  }

  async clearKey(): Promise<YouTubeSettings> {
    const current = await this.read();
    delete current.encryptedApiKey;
    await this.write(current);
    return this.publicSettings();
  }

  /** Decrypted only in the main process; public settings contain no credentials. */
  async proxyUrl(): Promise<string | undefined> {
    const encrypted = (await this.read()).encryptedProxyUrl;
    if (!encrypted) return undefined;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }

  async downloadRoute() {
    const stored = await this.read();
    return stored.downloadRoute ?? (stored.encryptedProxyUrl ? "proxy" : "system");
  }

  private async read(): Promise<StoredYouTubeSettings> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as StoredYouTubeSettings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  private async write(value: StoredYouTubeSettings): Promise<void> {
    await atomicWrite(this.path, JSON.stringify(value, null, 2));
  }
}
