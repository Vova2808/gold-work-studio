import { safeStorage } from "electron";
import { readFile } from "node:fs/promises";
import { atomicWrite } from "./fs-utils.js";
import type { SaveVoicerSettingsInput, VoicerSettings } from "@gold-work/shared";

const defaults: Omit<VoicerSettings, "configured"> = {
  baseUrl: "https://api.lumean.app/api/public"
};

interface StoredSettings extends Omit<VoicerSettings, "configured"> {
  encryptedApiKey?: string;
}

/** Настройки Voicer API (озвучка ElevenLabs): base URL + ключ в Windows safeStorage. */
export class VoicerStore {
  constructor(private readonly path: string) {}

  async publicSettings(): Promise<VoicerSettings> {
    const stored = await this.read();
    return { ...defaults, ...stored, configured: Boolean(stored.encryptedApiKey) };
  }

  async apiKey(): Promise<string | undefined> {
    const encrypted = (await this.read()).encryptedApiKey;
    if (!encrypted) return undefined;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }

  async save(input: SaveVoicerSettingsInput): Promise<VoicerSettings> {
    const current = await this.read();
    const next: StoredSettings = {
      baseUrl: input.baseUrl?.trim().replace(/\/+$/, "") || current.baseUrl || defaults.baseUrl,
      encryptedApiKey: current.encryptedApiKey
    };
    if (input.apiKey?.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
      next.encryptedApiKey = safeStorage.encryptString(input.apiKey.trim()).toString("base64");
    }
    await this.write(next);
    return this.publicSettings();
  }

  async clearKey(): Promise<VoicerSettings> {
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
