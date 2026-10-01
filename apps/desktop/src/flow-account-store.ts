import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { safeStorage } from "electron";
import type { FlowAccountPublic, FlowAccountStatus, FlowAccountUpdateInput } from "@gold-work/shared";
import { atomicWrite } from "./fs-utils.js";
import { assertFlowAccountCapacity } from "./flow-account-policy.js";

export interface FlowAccountSecret {
  cookieHeader?: string;
  accessToken?: string;
  proxyUrl?: string;
  sessionOrigin?: "https://flow.google.com";
}

interface StoredFlowAccount extends Omit<FlowAccountPublic, "proxyDisplayName"> {
  partition: string;
  encryptedSecret?: string;
}

interface StoredFlowAccounts {
  version: 1;
  accounts: StoredFlowAccount[];
}

export interface FlowAccountSessionPatch {
  email?: string;
  status: FlowAccountStatus;
  tier?: string;
  credits?: number;
  sessionExpiresAt?: string;
  tokenExpiresAt?: string;
  cooldownUntil?: string;
  lastRefreshAt?: string;
  lastError?: string;
  cookieHeader?: string;
  accessToken?: string;
  sessionOrigin?: "https://flow.google.com";
  preserveUserAction?: boolean;
}

function cleanPublicError(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(__Secure-next-auth\.session-token(?:\.\d+)?=)[^;\s]+/gi, "$1[REDACTED]")
    .replace(/((?:https?|socks5h?):\/\/)[^@\s/]+@/gi, "$1[REDACTED]@")
    .slice(0, 500);
}

export function flowProxyDisplayName(proxyUrl: string | undefined): string | undefined {
  if (!proxyUrl?.trim()) return undefined;
  try {
    const url = new URL(proxyUrl);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return "Прокси настроен";
  }
}

export class FlowAccountStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async list(): Promise<FlowAccountPublic[]> {
    const stored = await this.read();
    const result: FlowAccountPublic[] = [];
    for (const account of stored.accounts) {
      const secret = this.decryptSecret(account.encryptedSecret);
      result.push(this.toPublic(account, secret));
    }
    return result;
  }

  async get(id: string): Promise<FlowAccountPublic | undefined> {
    return (await this.list()).find((account) => account.id === id);
  }

  async partition(id: string): Promise<string> {
    const account = (await this.read()).accounts.find((item) => item.id === id);
    if (!account) throw new Error("Flow-аккаунт не найден");
    return account.partition;
  }

  async secret(id: string): Promise<FlowAccountSecret> {
    const account = (await this.read()).accounts.find((item) => item.id === id);
    if (!account) throw new Error("Flow-аккаунт не найден");
    return this.decryptSecret(account.encryptedSecret);
  }

  async ensure(input: { id?: string; label?: string; proxyUrl?: string }): Promise<FlowAccountPublic> {
    const id = input.id || randomUUID();
    return this.mutate(async (stored) => {
      let account = stored.accounts.find((item) => item.id === id);
      if (!account) {
        assertFlowAccountCapacity(stored.accounts.map((item) => item.id), id);
        account = {
          id,
          partition: `persist:flow-${id}`,
          label: input.label?.trim() || undefined,
          enabled: true,
          videoEnabled: true,
          status: "connecting",
        };
        stored.accounts.push(account);
      }
      const secret = this.decryptSecret(account.encryptedSecret);
      if (input.label?.trim()) account.label = input.label.trim();
      if (input.proxyUrl !== undefined) secret.proxyUrl = input.proxyUrl.trim() || undefined;
      account.encryptedSecret = this.encryptSecret(secret);
      return this.toPublic(account, secret);
    });
  }

  async update(id: string, input: FlowAccountUpdateInput): Promise<FlowAccountPublic> {
    return this.mutate(async (stored) => {
      const account = stored.accounts.find((item) => item.id === id);
      if (!account) throw new Error("Flow-аккаунт не найден");
      const secret = this.decryptSecret(account.encryptedSecret);
      if (input.label !== undefined) account.label = input.label.trim() || undefined;
      if (input.enabled !== undefined) account.enabled = input.enabled;
      if (input.videoEnabled !== undefined) account.videoEnabled = input.videoEnabled;
      if (input.clearProxy) secret.proxyUrl = undefined;
      else if (input.proxyUrl !== undefined) secret.proxyUrl = input.proxyUrl.trim() || undefined;
      if (!account.enabled) account.status = "disabled";
      else if (account.status === "disabled") account.status = secret.accessToken || secret.sessionOrigin ? "ready" : "needs_login";
      account.encryptedSecret = this.encryptSecret(secret);
      return this.toPublic(account, secret);
    });
  }

  async updateSession(id: string, patch: FlowAccountSessionPatch): Promise<FlowAccountPublic> {
    return this.mutate(async (stored) => {
      const account = stored.accounts.find((item) => item.id === id);
      if (!account) throw new Error("Flow-аккаунт не найден");
      const secret = this.decryptSecret(account.encryptedSecret);
      if (patch.cookieHeader !== undefined) secret.cookieHeader = patch.cookieHeader || undefined;
      if (patch.sessionOrigin !== undefined) secret.sessionOrigin = patch.sessionOrigin;
      if (patch.accessToken !== undefined) secret.accessToken = patch.accessToken || undefined;
      account.email = patch.email ?? account.email;
      const preserveUserAction = patch.preserveUserAction && account.status === "needs_user_action";
      account.status = account.enabled ? preserveUserAction ? "needs_user_action" : patch.status : "disabled";
      account.tier = patch.tier ?? account.tier;
      account.credits = patch.credits ?? account.credits;
      if (Object.prototype.hasOwnProperty.call(patch, "sessionExpiresAt")) account.sessionExpiresAt = patch.sessionExpiresAt;
      if (Object.prototype.hasOwnProperty.call(patch, "tokenExpiresAt")) account.tokenExpiresAt = patch.tokenExpiresAt;
      if (Object.prototype.hasOwnProperty.call(patch, "cooldownUntil")) account.cooldownUntil = patch.cooldownUntil;
      account.lastRefreshAt = patch.lastRefreshAt ?? account.lastRefreshAt;
      if (!preserveUserAction) account.lastError = cleanPublicError(patch.lastError);
      account.encryptedSecret = this.encryptSecret(secret);
      return this.toPublic(account, secret);
    });
  }

  async remove(id: string): Promise<void> {
    await this.mutate(async (stored) => {
      stored.accounts = stored.accounts.filter((account) => account.id !== id);
    });
  }

  private toPublic(account: StoredFlowAccount, secret: FlowAccountSecret): FlowAccountPublic {
    return {
      id: account.id,
      email: account.email,
      label: account.label,
      enabled: account.enabled,
      videoEnabled: account.videoEnabled,
      status: account.status,
      tier: account.tier,
      credits: account.credits,
      proxyDisplayName: flowProxyDisplayName(secret.proxyUrl),
      sessionExpiresAt: account.sessionExpiresAt,
      tokenExpiresAt: account.tokenExpiresAt,
      cooldownUntil: account.cooldownUntil,
      lastRefreshAt: account.lastRefreshAt,
      lastError: cleanPublicError(account.lastError),
    };
  }

  private encryptSecret(secret: FlowAccountSecret): string | undefined {
    if (!secret.cookieHeader && !secret.accessToken && !secret.proxyUrl && !secret.sessionOrigin) return undefined;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
    return safeStorage.encryptString(JSON.stringify(secret)).toString("base64");
  }

  private decryptSecret(value: string | undefined): FlowAccountSecret {
    if (!value) return {};
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Защищённое хранилище Windows недоступно");
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(value, "base64"))) as FlowAccountSecret;
    } catch {
      throw new Error("Не удалось расшифровать данные Flow-аккаунта в текущем профиле Windows");
    }
  }

  private async read(): Promise<StoredFlowAccounts> {
    try {
      const parsed = JSON.parse((await readFile(this.path, "utf8")).replace(/^\uFEFF/, "")) as Partial<StoredFlowAccounts>;
      return {
        version: 1,
        accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, accounts: [] };
      throw error;
    }
  }

  private async mutate<TResult>(operation: (stored: StoredFlowAccounts) => TResult | Promise<TResult>): Promise<TResult> {
    let result!: TResult;
    const run = this.writeQueue.catch(() => undefined).then(async () => {
      const stored = await this.read();
      result = await operation(stored);
      await atomicWrite(this.path, JSON.stringify(stored, null, 2));
    });
    this.writeQueue = run;
    await run;
    return result;
  }
}
