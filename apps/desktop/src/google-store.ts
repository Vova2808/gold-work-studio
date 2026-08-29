import { safeStorage } from "electron";
import { readFile } from "node:fs/promises";
import { atomicWrite } from "./fs-utils.js";
import type { GoogleSettings, SaveGoogleSettingsInput } from "@gold-work/shared";

// Veo Lite — единственная из доступных линеек, что реально делает видео (у gemini-omni-flash
// в API только generateContent) и самая дешёвая на большом объёме генераций.
const defaults: Omit<GoogleSettings, "configured"> = {
  veoModel: "veo-3.1-lite-generate-preview",
  proxyUrl: ""
};

interface StoredSettings extends Omit<GoogleSettings, "configured"> {
  encryptedApiKey?: string;
}

/** Ключ Google AI Studio (Veo, image-to-video): хранится в Windows safeStorage. */
export class GoogleStore {
  constructor(private readonly path: string) {}

  async publicSettings(): Promise<GoogleSettings> {
    const stored = await this.read();
    return { ...defaults, ...stored, configured: Boolean(stored.encryptedApiKey) };
  }

  async apiKey(): Promise<string | undefined> {
    const encrypted = (await this.read()).encryptedApiKey;
    if (!encrypted) return undefined;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }

  async save(input: SaveGoogleSettingsInput): Promise<GoogleSettings> {
    const current = await this.read();
    const next: StoredSettings = {
      veoModel: input.veoModel?.trim() || current.veoModel || defaults.veoModel,
      // Пустую строку сохраняем осознанно — так пользователь отключает прокси.
      proxyUrl: input.proxyUrl === undefined ? current.proxyUrl ?? "" : input.proxyUrl.trim(),
      encryptedApiKey: current.encryptedApiKey
    };
    if (input.apiKey?.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
      next.encryptedApiKey = safeStorage.encryptString(input.apiKey.trim()).toString("base64");
    }
    await this.write(next);
    return this.publicSettings();
  }

  async clearKey(): Promise<GoogleSettings> {
    const current = await this.read();
    delete current.encryptedApiKey;
    await this.write(current);
    return this.publicSettings();
  }

  private async read(): Promise<StoredSettings> {
    try {
      // BOM срезаем: файл могли создать/править внешние инструменты.
      const raw = (await readFile(this.path, "utf8")).replace(/^﻿/, "");
      const stored = { ...defaults, ...JSON.parse(raw) as StoredSettings };
      // Раньше по умолчанию стоял gemini-omni-*, но эти модели не генерируют видео
      // (в API только generateContent) — молча переводим на рабочую Veo.
      if (/^gemini-omni/.test(stored.veoModel)) stored.veoModel = defaults.veoModel;
      return stored;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaults };
      throw error;
    }
  }

  private async write(value: StoredSettings): Promise<void> {
    await atomicWrite(this.path, JSON.stringify(value, null, 2));
  }
}
