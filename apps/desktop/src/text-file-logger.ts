import { appendFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, extname, basename, join } from "node:path";
import type { ConsoleLogEntry, LogLevel } from "@gold-work/shared";

const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024;
const REDACTED_KEYS = /api.?key|authorization|cookie|password|secret|token|prompt|narration|transcript|messages?|content|request.?body|response.?body|base64/i;

function redactText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/((?:api[_-]?key|password|secret|token)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[maximum depth]";
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message).slice(0, 1000),
      stack: value.stack ? redactText(value.stack).slice(0, 4000) : undefined
    };
  }
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => safeValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([key, item]) => [key, REDACTED_KEYS.test(key) ? "[REDACTED]" : safeValue(item, depth + 1)])
    );
  }
  if (typeof value === "string") {
    const redacted = redactText(value);
    return redacted.length > 4000 ? `${redacted.slice(0, 4000)}…` : redacted;
  }
  return value;
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

  constructor(readonly path: string, private readonly entrySink: (entry: ConsoleLogEntry) => void = () => undefined) {}

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
    const normalizedMessage = redactText(message.replaceAll(/\r?\n/g, " ").slice(0, 1000));
    const safeDetails = sanitizedDetails(details);
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
    let content: string;
    try {
      content = await readFile(this.path, "utf8");
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "ENOENT") return [];
      throw error;
    }
    return content.split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(2000, limit))).flatMap((line, index) => {
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
      if (current.size < MAX_LOG_SIZE_BYTES) return;
      const extension = extname(this.path);
      const previousPath = join(dirname(this.path), `${basename(this.path, extension)}-previous${extension}`);
      await rm(previousPath, { force: true });
      await rename(this.path, previousPath);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code !== "ENOENT") throw error;
    }
  }
}
