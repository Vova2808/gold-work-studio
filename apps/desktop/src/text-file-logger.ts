import { appendFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, extname, basename, join } from "node:path";
import type { ConsoleLogEntry, LogLevel } from "@gold-work/shared";
import { currentDiagnosticContext, diagnoseFailure } from "./diagnostics.js";

const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024;
const REDACTED_KEYS = /api.?key|authorization|cookie|password|secret|token|prompt|narration|transcript|^messages$|^content$|request.?body|response.?body|base64|signature|credential/i;

export function redactLogText(value: string): string {
  return value
    .replace(/((?:https?|socks5h?):\/\/)[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/((?:https?|socks5h?):\/\/[^\s?\#"'<>]+)[?\#][^\s"'<>]*/gi, "$1?[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [REDACTED]")
    .replace(/(["']?(?:api[_-]?key|password|secret|[\w-]*token|cookie|authorization)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/(?:Начало ответа|response body|request body):[\s\S]*/i, "[тело ответа/запроса скрыто]");
}

const redactText = redactLogText;

function safeValue(value: unknown, depth = 0, seen = new Set<unknown>()): unknown {
  if (depth > 7) return "[maximum depth]";
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen = new Set(seen).add(value);
  }
  if (value instanceof Error) {
    const technical = value as unknown as Record<string, unknown>;
    return {
      name: value.name,
      message: redactText(value.message).slice(0, 1000),
      stack: value.stack ? redactText(value.stack).slice(0, 4000) : undefined,
      ...Object.fromEntries(["code", "errno", "syscall", "address", "port", "status", "statusCode", "cause", "errors"]
        .filter(key => technical[key] !== undefined).map(key => [key, safeValue(technical[key], depth + 1, seen)]))
    };
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return "[binary omitted]";
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => safeValue(item, depth + 1, seen));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([key, item]) => [key, REDACTED_KEYS.test(key) ? "[REDACTED]" : safeValue(item, depth + 1, seen)])
    );
  }
  if (typeof value === "string") {
    const redacted = redactText(value);
    return redacted.length > 4000 ? `${redacted.slice(0, 4000)}…` : redacted;
  }
  return typeof value === "bigint" ? value.toString() : value;
}

function sanitizedDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!details || Object.keys(details).length === 0) return undefined;
  return safeValue(details) as Record<string, unknown>;
}

function serialize(details?: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) return "";
  try {
    return ` ${JSON.stringify(details)}`;
  } catch {
    return " {\"details\":\"[not serializable]\"}";
  }
}

export class TextFileLogger {
  private pending: Promise<void> = Promise.resolve();
  private initialized = false;
  private entryCounter = 0;
  readonly sessionId = `${Date.now().toString(36)}-${process.pid}`;

  constructor(readonly path: string, private readonly entrySink: (entry: ConsoleLogEntry) => void = () => undefined,
    private readonly options: { buildId?: string; maxFileSizeBytes?: number } = {}) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(dirname(this.path), { recursive: true });
    await this.rotateIfNeeded();
    this.initialized = true;
    await this.write("info", "app.session.started", {
      sessionId: this.sessionId,
      platform: process.platform,
      arch: process.arch,
      node: process.version
    });
  }

  write(level: LogLevel, message: string, details?: Record<string, unknown>): Promise<void> {
    const timestamp = new Date().toISOString();
    const normalizedMessage = redactText(message.replaceAll(/\r?\n/g, " ")).slice(0, 1000);
    const enriched: Record<string, unknown> = { sessionId: this.sessionId, buildId: this.options.buildId, ...currentDiagnosticContext(), ...details };
    const failure = details?.error ?? details?.reason;
    if ((level === "error" || level === "warn") && failure !== undefined && !enriched.diagnostic) {
      enriched.diagnostic = diagnoseFailure(failure);
    }
    const safeDetails = sanitizedDetails(enriched);
    const entry: ConsoleLogEntry = {
      id: `${this.sessionId}-${timestamp}-${this.entryCounter++}`,
      timestamp,
      level,
      message: normalizedMessage,
      details: safeDetails
    };
    const line = `${timestamp} [${level.toUpperCase()}] [${this.sessionId}] [${entry.id}] ${normalizedMessage}${serialize(safeDetails)}\n`;
    this.pending = this.pending
      .then(async () => {
        if (!this.initialized) {
          await mkdir(dirname(this.path), { recursive: true });
          this.initialized = true;
        }
        await this.rotateIfNeeded();
        await appendFile(this.path, line, "utf8");
        this.entrySink(entry);
      })
      .catch((error: unknown) => {
        process.stderr.write(`[logger] ${error instanceof Error ? error.message : String(error)}\n`);
      });
    return this.pending;
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  async readRecent(limit = 500): Promise<ConsoleLogEntry[]> {
    await this.flush();
    const count = Math.max(1, Math.min(2000, Number.isFinite(limit) ? limit : 500));
    let lines: string[] = [];
    for (const path of [this.path, this.archivePath(1), this.archivePath(2), this.archivePath(3)]) {
      try { lines = [...(await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean), ...lines]; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (lines.length >= count) break;
    }
    const content = lines.slice(-count).join("\n");
    return content.split(/\r?\n/).filter(Boolean).flatMap((line, index) => {
      const match = /^(\S+) \[([A-Z]+)\] \[([^\]]+)\](?: \[([^\]]+)\])? (.*)$/.exec(line);
      if (!match) return [];
      const raw = match[5] ?? "";
      const detailsAt = raw.indexOf(" {");
      const message = redactText(detailsAt >= 0 ? raw.slice(0, detailsAt) : raw).slice(0, 1000);
      let details: Record<string, unknown> | undefined;
      if (detailsAt >= 0) {
        try {
          details = sanitizedDetails(JSON.parse(raw.slice(detailsAt + 1)) as Record<string, unknown>);
        } catch {
          details = { raw: "[не удалось разобрать безопасные данные]" };
        }
      }
      const level = String(match[2]).toLowerCase();
      if (!(["debug", "info", "warn", "error"] as string[]).includes(level)) return [];
      return [{
        id: match[4] ?? `history-${match[3]}-${match[1]}-${index}`,
        timestamp: match[1]!,
        level: level as LogLevel,
        message,
        details
      }];
    });
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const current = await stat(this.path);
      if (current.size < (this.options.maxFileSizeBytes ?? MAX_LOG_SIZE_BYTES)) return;
      await rm(this.archivePath(3), { force: true });
      for (const index of [2, 1]) {
        await rename(this.archivePath(index), this.archivePath(index + 1)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      }
      await rename(this.path, this.archivePath(1));
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code !== "ENOENT") throw error;
    }
  }

  private archivePath(index: number): string {
    const extension = extname(this.path);
    return join(dirname(this.path), `${basename(this.path, extension)}-previous${index === 1 ? "" : `-${index}`}${extension}`);
  }
}
