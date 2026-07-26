import { safeStorage } from "electron";
import { readFile } from "node:fs/promises";
import { atomicWrite } from "./fs-utils.js";
import type { AnyModelSettings, SaveAnyModelSettingsInput } from "@gold-work/shared";

const defaults: Omit<AnyModelSettings, "configured"> = {
  baseUrl: "https://anymodel.org/v1",
  textModel: "cc/claude-opus-5",
  imageModel: "ag/gemini-3.1-flash-image",
  videoModel: "xai/grok-imagine-video",
  ttsModel: "google-tts",
  imageRefModel: "gpt-image-2",
  transcriptionModel: "gc/gemini-2.5-flash"
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
      // Пустые поля не должны затирать дефолты — иначе одно случайное сохранение ломает все запросы.
      baseUrl: (input.baseUrl?.trim() || defaults.baseUrl).replace(/\/+$/, "").replace(/\/v1\/v1$/i, "/v1"),
      textModel: input.textModel?.trim() || defaults.textModel,
      imageModel: input.imageModel?.trim() || defaults.imageModel,
      videoModel: input.videoModel?.trim() || defaults.videoModel,
      ttsModel: input.ttsModel?.trim() || defaults.ttsModel,
      imageRefModel: input.imageRefModel?.trim() || defaults.imageRefModel,
      transcriptionModel: input.transcriptionModel?.trim() || defaults.transcriptionModel,
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
      // BOM срезаем: файл могли создать/править внешние инструменты (PowerShell пишет UTF-8 c BOM).
      const raw = (await readFile(this.path, "utf8")).replace(/^﻿/, "");
      return { ...defaults, ...JSON.parse(raw) as StoredSettings };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaults };
      throw error;
    }
  }

  private async write(value: StoredSettings): Promise<void> {
    await atomicWrite(this.path, JSON.stringify(value, null, 2));
  }
}
