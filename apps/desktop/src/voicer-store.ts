import { safeStorage } from "electron";
import { readFile } from "node:fs/promises";
import { atomicWrite } from "./fs-utils.js";
import { parseProxyUrl, proxyDisplayName } from "./proxy-utils.js";
import { hasInvalidVoicerApiKeyCharacters, INVALID_VOICER_API_KEY_MESSAGE } from "./voicer-api-key.js";
import type { SaveVoicerSettingsInput, VoicerSettings } from "@gold-work/shared";

const defaults: Pick<VoicerSettings, "baseUrl"> = {
  baseUrl: "https://api.lumean.app/api/public"
};

interface StoredSettings {
  baseUrl: string;
  /** Safe display string without credentials. */
  proxyDisplayName?: string;
  encryptedApiKey?: string;
  /** Full proxy URL can contain credentials and therefore never leaves safeStorage. */
  encryptedProxyUrl?: string;
}

/** Настройки Voicer API (озвучка ElevenLabs): base URL + ключ в Windows safeStorage. */
export class VoicerStore {
  constructor(private readonly path: string) {}

  async publicSettings(): Promise<VoicerSettings> {
    const stored = await this.read();
    return {
      baseUrl: stored.baseUrl || defaults.baseUrl,
      configured: Boolean(stored.encryptedApiKey),
      proxyConfigured: Boolean(stored.encryptedProxyUrl),
      proxyDisplayName: stored.proxyDisplayName
    };
  }

  async apiKey(): Promise<string | undefined> {
    const encrypted = (await this.read()).encryptedApiKey;
    if (!encrypted) return undefined;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }

  /** Secret proxy URL for the main-process transport. Never expose through IPC. */
  async proxyUrl(): Promise<string | undefined> {
    const encrypted = (await this.read()).encryptedProxyUrl;
    if (!encrypted) return undefined;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }

  async save(input: SaveVoicerSettingsInput): Promise<VoicerSettings> {
    const current = await this.read();
    const next: StoredSettings = {
      baseUrl: input.baseUrl?.trim().replace(/\/+$/, "") || current.baseUrl || defaults.baseUrl,
      encryptedApiKey: current.encryptedApiKey,
      encryptedProxyUrl: current.encryptedProxyUrl,
      proxyDisplayName: current.proxyDisplayName
    };
    const apiKey = input.apiKey?.trim();
    if (apiKey) {
      if (hasInvalidVoicerApiKeyCharacters(apiKey)) throw new Error(INVALID_VOICER_API_KEY_MESSAGE);
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
      next.encryptedApiKey = safeStorage.encryptString(apiKey).toString("base64");
    }
    if (input.clearProxy) {
      delete next.encryptedProxyUrl;
      delete next.proxyDisplayName;
    } else if (input.proxyUrl !== undefined) {
      const proxyUrl = input.proxyUrl.trim();
      if (!proxyUrl) {
        delete next.encryptedProxyUrl;
        delete next.proxyDisplayName;
      } else {
        // Reject an invalid proxy before replacing the last working setting. Parser errors
        // deliberately contain no source URL, username or password.
        parseProxyUrl(proxyUrl);
        if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
        next.encryptedProxyUrl = safeStorage.encryptString(proxyUrl).toString("base64");
        next.proxyDisplayName = proxyDisplayName(proxyUrl);
      }
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
