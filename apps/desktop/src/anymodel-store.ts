import { safeStorage } from "electron";
import { readFile } from "node:fs/promises";
import { atomicWrite } from "./fs-utils.js";
import type { AnyModelSettings, SaveAnyModelSettingsInput } from "@gold-work/shared";

const defaults: Omit<AnyModelSettings, "configured"> = {
  baseUrl: "https://anymodel.org/v1",
  textModel: "cc/claude-sonnet-5",
  imageModel: "ag/gemini-3.1-flash-image",
  videoModel: "xai/grok-imagine-video",
  ttsModel: "google-tts"
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
      baseUrl: input.baseUrl.replace(/\/+$/, "").replace(/\/v1\/v1$/i, "/v1"),
      textModel: input.textModel.trim(),
      imageModel: input.imageModel.trim(),
      videoModel: input.videoModel.trim(),
      ttsModel: input.ttsModel?.trim() || defaults.ttsModel,
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
    await atomicWrite(this.path, JSON.stringify(value, null, 2));
  }
}
