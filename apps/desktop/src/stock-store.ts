import electron from "electron";
import { readFile } from "node:fs/promises";
import type {
  SaveStockSettingsInput,
  StockProvider,
  StockProviderStatus,
  StockSettings
} from "@gold-work/shared";
import { atomicWrite } from "./fs-utils.js";
import { parseProxyUrl, proxyDisplayName } from "./proxy-utils.js";

interface StoredStockCheck {
  state: "working" | "error";
  checkedAt: string;
  message: string;
}

interface StoredStockSettings {
  encryptedPexelsApiKey?: string;
  encryptedPixabayApiKey?: string;
  encryptedPexelsProxyUrl?: string;
  encryptedPixabayProxyUrl?: string;
  pexelsCheck?: StoredStockCheck;
  pixabayCheck?: StoredStockCheck;
}

type SecretField = "encryptedPexelsApiKey" | "encryptedPixabayApiKey";
type ProxySecretField = "encryptedPexelsProxyUrl" | "encryptedPixabayProxyUrl";
type CheckField = "pexelsCheck" | "pixabayCheck";

const keyField: Record<StockProvider, SecretField> = {
  pexels: "encryptedPexelsApiKey",
  pixabay: "encryptedPixabayApiKey"
};

const checkField: Record<StockProvider, CheckField> = {
  pexels: "pexelsCheck",
  pixabay: "pixabayCheck"
};

const proxyField: Record<StockProvider, ProxySecretField> = {
  pexels: "encryptedPexelsProxyUrl",
  pixabay: "encryptedPixabayProxyUrl"
};

export interface StockSecretCodec {
  available(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

const electronCodec: StockSecretCodec = {
  available: () => electron.safeStorage.isEncryptionAvailable(),
  encrypt: (value) => electron.safeStorage.encryptString(value).toString("base64"),
  decrypt: (value) => electron.safeStorage.decryptString(Buffer.from(value, "base64"))
};

function assertProvider(provider: StockProvider): void {
  if (provider !== "pexels" && provider !== "pixabay") throw new Error("Неизвестный стоковый провайдер");
}

function publicProviderStatus(
  provider: StockProvider,
  configured: boolean,
  check: StoredStockCheck | undefined,
  proxyUrl?: string
): StockProviderStatus {
  const proxy = {
    proxyConfigured: Boolean(proxyUrl),
    proxyDisplayName: proxyDisplayName(proxyUrl)
  };
  if (!configured) return { provider, configured: false, state: "not_configured", ...proxy };
  if (!check || !["working", "error"].includes(check.state) || !check.checkedAt) {
    return { provider, configured: true, state: "saved", ...proxy };
  }
  return {
    provider,
    configured: true,
    state: check.state,
    ...proxy,
    checkedAt: check.checkedAt,
    message: check.message
  };
}

function sanitizedCheckMessage(message: string, secret?: string): string {
  let safe = String(message || "Проверка завершена").replace(/[\r\n]+/g, " ").trim();
  if (secret) safe = safe.split(secret).join("[REDACTED]");
  safe = safe
    .replace(/([?&](?:key|api[_-]?key|token)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*:\s*)\S+/gi, "$1[REDACTED]");
  return safe.slice(0, 500) || "Проверка завершена";
}

/** Ключи стоковых API никогда не покидают main process и хранятся через Windows safeStorage. */
export class StockStore {
  private writeSequence: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly codec: StockSecretCodec = electronCodec
  ) {}

  async publicSettings(): Promise<StockSettings> {
    const stored = await this.read();
    const pexelsConfigured = Boolean(stored.encryptedPexelsApiKey);
    const pixabayConfigured = Boolean(stored.encryptedPixabayApiKey);
    const pexelsProxyUrl = this.decryptOptional(stored.encryptedPexelsProxyUrl);
    const pixabayProxyUrl = this.decryptOptional(stored.encryptedPixabayProxyUrl);
    return {
      pexelsConfigured,
      pixabayConfigured,
      providers: {
        pexels: publicProviderStatus("pexels", pexelsConfigured, stored.pexelsCheck, pexelsProxyUrl),
        pixabay: publicProviderStatus("pixabay", pixabayConfigured, stored.pixabayCheck, pixabayProxyUrl)
      }
    };
  }

  async apiKey(provider: StockProvider): Promise<string | undefined> {
    assertProvider(provider);
    const encrypted = (await this.read())[keyField[provider]];
    if (!encrypted) return undefined;
    return this.decrypt(encrypted);
  }

  /** Полный адрес с credentials остаётся только в main process. */
  async proxyUrl(provider: StockProvider): Promise<string | undefined> {
    assertProvider(provider);
    return this.decryptOptional((await this.read())[proxyField[provider]]);
  }

  async save(input: SaveStockSettingsInput): Promise<StockSettings> {
    return this.serialize(async () => {
      const current = await this.read();
      if (input.pexelsApiKey?.trim()) {
        current.encryptedPexelsApiKey = this.encrypt(input.pexelsApiKey);
        delete current.pexelsCheck;
      }
      if (input.pixabayApiKey?.trim()) {
        current.encryptedPixabayApiKey = this.encrypt(input.pixabayApiKey);
        delete current.pixabayCheck;
      }
      this.updateProxy(current, "pexels", input.pexelsProxyUrl, input.clearPexelsProxy === true);
      this.updateProxy(current, "pixabay", input.pixabayProxyUrl, input.clearPixabayProxy === true);
      await this.write(current);
      return this.publicSettings();
    });
  }

  async clearKey(provider: StockProvider): Promise<StockSettings> {
    assertProvider(provider);
    return this.serialize(async () => {
      const current = await this.read();
      delete current[keyField[provider]];
      delete current[checkField[provider]];
      await this.write(current);
      return this.publicSettings();
    });
  }

  /** Сохраняет только безопасный результат реального запроса, отдельно для каждого API. */
  async recordTest(
    provider: StockProvider,
    result: { ok: boolean; message: string },
    checkedAt = new Date().toISOString()
  ): Promise<StockSettings> {
    assertProvider(provider);
    return this.serialize(async () => {
      const current = await this.read();
      const encrypted = current[keyField[provider]];
      if (!encrypted) return this.publicSettings();
      let secret: string | undefined;
      let proxySecret: string | undefined;
      try {
        if (this.codec.available()) {
          secret = this.codec.decrypt(encrypted);
          proxySecret = this.decryptOptional(current[proxyField[provider]]);
        }
      } catch {
        // Даже повреждённый/недоступный safeStorage должен вернуть пользователю сохранённый error-статус.
      }
      current[checkField[provider]] = {
        state: result.ok ? "working" : "error",
        checkedAt,
        message: sanitizedCheckMessage(sanitizedCheckMessage(result.message, secret), proxySecret)
      };
      await this.write(current);
      return this.publicSettings();
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.writeSequence.then(operation, operation);
    this.writeSequence = current.then(() => undefined, () => undefined);
    return current;
  }

  private encrypt(value: string): string {
    if (!this.codec.available()) throw new Error("Защищённое хранилище Windows недоступно");
    return this.codec.encrypt(value.trim());
  }

  private decrypt(value: string): string {
    if (!this.codec.available()) throw new Error("Защищённое хранилище Windows недоступно");
    return this.codec.decrypt(value);
  }

  private decryptOptional(value: string | undefined): string | undefined {
    if (!value) return undefined;
    return this.decrypt(value);
  }

  private updateProxy(
    current: StoredStockSettings,
    provider: StockProvider,
    value: string | undefined,
    clear: boolean
  ): void {
    const field = proxyField[provider];
    if (clear) {
      delete current[field];
      delete current[checkField[provider]];
      return;
    }
    if (value === undefined) return;
    const proxyUrl = value.trim();
    if (!proxyUrl) {
      delete current[field];
    } else {
      parseProxyUrl(proxyUrl);
      current[field] = this.encrypt(proxyUrl);
    }
    delete current[checkField[provider]];
  }

  private async read(): Promise<StoredStockSettings> {
    try {
      return JSON.parse((await readFile(this.path, "utf8")).replace(/^\uFEFF/, "")) as StoredStockSettings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  private async write(value: StoredStockSettings): Promise<void> {
    await atomicWrite(this.path, JSON.stringify(value, null, 2));
  }
}
