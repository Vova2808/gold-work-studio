import { safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { SaveYouTubeSettingsInput, YouTubeSettings } from "@gold-work/shared";

interface StoredYouTubeSettings {
  encryptedApiKey?: string;
  cookiesFilePath?: string;
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
      cookiesFileConfigured: Boolean(stored.cookiesFilePath),
      cookiesFileName: stored.cookiesFilePath ? basename(stored.cookiesFilePath) : undefined
    };
  }

  async cookiesFilePath(): Promise<string | undefined> {
    return (await this.read()).cookiesFilePath ?? process.env.YT_DLP_COOKIES_PATH;
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
    if (input.apiKey?.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
      current.encryptedApiKey = safeStorage.encryptString(input.apiKey.trim()).toString("base64");
      changed = true;
    }
    if (input.cookiesFilePath?.trim()) {
      const cookiesFilePath = input.cookiesFilePath.trim();
      const header = (await readFile(cookiesFilePath, "utf8")).slice(0, 500);
      if (!/Netscape HTTP Cookie File/i.test(header)) {
        throw new Error("Выберите cookies.txt в формате Netscape");
      }
      current.cookiesFilePath = cookiesFilePath;
      changed = true;
    }
    if (input.clearCookiesFile) {
      delete current.cookiesFilePath;
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

  private async read(): Promise<StoredYouTubeSettings> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as StoredYouTubeSettings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  private async write(value: StoredYouTubeSettings): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
    await rename(temporary, this.path);
  }
}
