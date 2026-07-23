import { safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AnyModelSettings, SaveAnyModelSettingsInput } from "@gold-work/shared";

const defaults: Omit<AnyModelSettings, "configured"> = {
  baseUrl: "https://anymodel.org",
  textModel: "cc/claude-sonnet-4-6",
  imageModel: "gpt-image-2",
  videoModel: "xai/grok-imagine-video"
};

interface StoredSettings extends Omit<AnyModelSettings, "configured"> {
  encryptedApiKey?: string;
}

export class AnyModelStore {
  constructor(private readonly path: string) {}

  async publicSettings(): Promise<AnyModelSettings> {
    const stored = await this.read();
    return { ...defaults, ...stored, configured: Boolean(stored.encryptedApiKey) };
  }

  async apiKey(): Promise<string | undefined> {
    const encrypted = (await this.read()).encryptedApiKey;
    if (!encrypted) return undefined;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }

  async save(input: SaveAnyModelSettingsInput): Promise<AnyModelSettings> {
    const current = await this.read();
    const next: StoredSettings = {
      baseUrl: input.baseUrl.replace(/\/+$/, ""),
      textModel: input.textModel.trim(),
      imageModel: input.imageModel.trim(),
      videoModel: input.videoModel.trim(),
      encryptedApiKey: current.encryptedApiKey
    };
    if (input.apiKey?.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
      next.encryptedApiKey = safeStorage.encryptString(input.apiKey.trim()).toString("base64");
    }
    await this.write(next);
    return this.publicSettings();
  }

  async clearKey(): Promise<AnyModelSettings> {
    const current = await this.read();
    delete current.encryptedApiKey;
    await this.write(current);
    return this.publicSettings();
  }

  private async read(): Promise<StoredSettings> {
    try {
      return { ...defaults, ...JSON.parse(await readFile(this.path, "utf8")) as StoredSettings };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaults };
      throw error;
    }
  }

  private async write(value: StoredSettings): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
    await rename(temporary, this.path);
  }
}
