import { safeStorage } from "electron";
import { readFile } from "node:fs/promises";
import { atomicWrite } from "./fs-utils.js";
import type { AnyModelSettings, SaveAnyModelSettingsInput } from "@gold-work/shared";
import { parseProxyUrl, proxyDisplayName } from "./proxy-utils.js";

const defaults = {
  baseUrl: "https://anymodel.org/v1",
  textModel: "cc/claude-opus-5",
  imageModel: "ag/gemini-3.1-flash-image",
  videoModel: "xai/grok-imagine-video",
  ttsModel: "google-tts",
  imageRefModel: "gpt-image-2",
  transcriptionModel: "gc/gemini-2.5-flash"
};

interface StoredSettings {
  baseUrl: string;
  textModel: string;
  imageModel: string;
  videoModel: string;
  ttsModel: string;
  imageRefModel: string;
  transcriptionModel: string;
  encryptedApiKey?: string;
  encryptedProxyUrl?: string;
  /** Migration-only field from pre-encryption development builds. Never expose it through IPC. */
  proxyUrl?: string;
}

export class AnyModelStore {
  constructor(private readonly path: string) {}

  async publicSettings(): Promise<AnyModelSettings> {
    const stored = await this.read();
    const proxyUrl = await this.decryptSecret(stored.encryptedProxyUrl, stored.proxyUrl);
    // Return an explicit allowlist. Spreading StoredSettings here would leak the
    // DPAPI ciphertext (and legacy plaintext proxy) to the renderer at runtime.
    return {
      baseUrl: stored.baseUrl,
      textModel: stored.textModel,
      imageModel: stored.imageModel,
      videoModel: stored.videoModel,
      ttsModel: stored.ttsModel,
      imageRefModel: stored.imageRefModel,
      transcriptionModel: stored.transcriptionModel,
      configured: Boolean(stored.encryptedApiKey),
      proxyConfigured: Boolean(proxyUrl),
      proxyDisplayName: proxyDisplayName(proxyUrl)
    };
  }

  async apiKey(): Promise<string | undefined> {
    return this.decryptSecret((await this.read()).encryptedApiKey);
  }

  /** Full proxy credentials are available only to the Electron main process. */
  async proxyUrl(): Promise<string | undefined> {
    const stored = await this.read();
    return this.decryptSecret(stored.encryptedProxyUrl, stored.proxyUrl);
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
      encryptedApiKey: current.encryptedApiKey,
      encryptedProxyUrl: current.encryptedProxyUrl
    };
    if (input.apiKey?.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
      next.encryptedApiKey = safeStorage.encryptString(input.apiKey.trim()).toString("base64");
    }
    if (input.clearProxy) {
      delete next.encryptedProxyUrl;
    } else if (input.proxyUrl !== undefined) {
      const proxyUrl = input.proxyUrl.trim();
      if (proxyUrl) {
        // Validate before reporting a successful save. parseProxyUrl never opens
        // a connection and accepts only the supported proxy schemes.
        parseProxyUrl(proxyUrl);
        if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
        next.encryptedProxyUrl = safeStorage.encryptString(proxyUrl).toString("base64");
      } else {
        delete next.encryptedProxyUrl;
      }
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

  private async decryptSecret(encrypted: string | undefined, legacyPlaintext?: string): Promise<string | undefined> {
    if (!encrypted) return legacyPlaintext?.trim() || undefined;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }
}
