export const FLOW_SESSION_COOKIE_PREFIX = "__Secure-next-auth.session-token";

export interface ParsedFlowCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
}

export interface FlowCookieSetDetails {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
  sameSite?: ParsedFlowCookie["sameSite"];
}

type CookieRecord = Record<string, unknown>;

export function isFlowSessionCookieName(name: string): boolean {
  return name === FLOW_SESSION_COOKIE_PREFIX
    || (name.startsWith(`${FLOW_SESSION_COOKIE_PREFIX}.`) && /^\d+$/.test(name.slice(FLOW_SESSION_COOKIE_PREFIX.length + 1)));
}

function normalizeExpiry(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return numeric > 10_000_000_000 ? Math.floor(numeric / 1_000) : Math.floor(numeric);
}

function normalizeSameSite(value: unknown): ParsedFlowCookie["sameSite"] {
  const normalized = String(value ?? "").toLowerCase().replace(/[-_\s]/g, "");
  if (normalized === "none" || normalized === "norestriction") return "no_restriction";
  if (normalized === "lax") return "lax";
  if (normalized === "strict") return "strict";
  return "unspecified";
}

function normalizeDomain(value: unknown): string | undefined {
  const domain = String(value ?? ".labs.google").trim().replace(/^https?:\/\//i, "").split("/")[0]!.toLowerCase();
  return domain === "labs.google" || domain.endsWith(".labs.google") ? domain : undefined;
}

function fromRecord(record: CookieRecord): ParsedFlowCookie | null {
  const name = String(record.name ?? record.key ?? "").trim();
  const value = String(record.value ?? record.content ?? "").trim();
  const domain = normalizeDomain(record.domain ?? record.host);
  if (!name || !value || !domain) return null;
  return {
    name,
    value,
    domain,
    path: String(record.path ?? "/").trim() || "/",
    secure: record.secure === undefined ? true : Boolean(record.secure),
    httpOnly: record.httpOnly === undefined ? true : Boolean(record.httpOnly),
    expirationDate: normalizeExpiry(record.expirationDate ?? record.expires ?? record.expiry),
    sameSite: normalizeSameSite(record.sameSite),
  };
}

function parseJsonCookies(text: string): ParsedFlowCookie[] | null {
  if (!text.startsWith("[") && !text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { cookies?: unknown[] }).cookies)
        ? (parsed as { cookies: unknown[] }).cookies
        : parsed && typeof parsed === "object"
          ? Object.entries(parsed as Record<string, unknown>).map(([name, value]) => ({ name, value }))
          : [];
    return values
      .filter((value): value is CookieRecord => Boolean(value) && typeof value === "object")
      .map(fromRecord)
      .filter((cookie): cookie is ParsedFlowCookie => cookie !== null);
  } catch {
    return null;
  }
}

function parseNetscapeCookies(text: string): ParsedFlowCookie[] | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.some((line) => line.includes("\t"))) return null;
  const result: ParsedFlowCookie[] = [];
  for (const rawLine of lines) {
    const line = rawLine.startsWith("#HttpOnly_") ? rawLine.slice("#HttpOnly_".length) : rawLine;
    if (line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields.length < 7) continue;
    const [domain, , path, secure, expires, name, ...valueParts] = fields;
    const cookie = fromRecord({
      domain,
      path,
      secure: secure?.toUpperCase() === "TRUE",
      expires,
      name,
      value: valueParts.join("\t"),
      httpOnly: rawLine.startsWith("#HttpOnly_"),
    });
    if (cookie) result.push(cookie);
  }
  return result;
}

function parseCookieHeader(text: string): ParsedFlowCookie[] {
  const normalized = text.replace(/^cookie\s*:\s*/i, "").trim();
  if (!normalized.includes("=")) {
    return [{
      name: FLOW_SESSION_COOKIE_PREFIX,
      value: normalized,
      domain: ".labs.google",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "unspecified",
    }];
  }
  return normalized.split(/;\s*/).map((part) => {
    const separator = part.indexOf("=");
    return fromRecord({
      name: separator < 0 ? "" : part.slice(0, separator),
      value: separator < 0 ? "" : part.slice(separator + 1),
    });
  }).filter((cookie): cookie is ParsedFlowCookie => cookie !== null);
}

/** Принимает JSON, Netscape cookies.txt, Cookie header или голое значение NextAuth cookie. */
export function parseFlowCookies(input: string): ParsedFlowCookie[] {
  const text = input.replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("Вставьте cookies Google Flow");
  const parsed = parseJsonCookies(text) ?? parseNetscapeCookies(text) ?? parseCookieHeader(text);
  const deduplicated = new Map<string, ParsedFlowCookie>();
  for (const cookie of parsed) {
    if (!cookie.value) continue;
    const key = `${cookie.domain}\n${cookie.path}\n${cookie.name}`;
    deduplicated.set(key, cookie);
  }
  const cookies = [...deduplicated.values()];
  if (!cookies.some((cookie) => isFlowSessionCookieName(cookie.name))) {
    throw new Error(`Cookies не содержат ${FLOW_SESSION_COOKIE_PREFIX}`);
  }
  return cookies;
}

/**
 * Chromium строго проверяет cookie-префиксы. Для __Host-* нельзя передавать
 * Domain, а Path обязан быть "/"; __Secure-* всегда требует HTTPS + Secure.
 */
export function flowCookieSetDetails(
  cookie: ParsedFlowCookie,
  url = "https://labs.google/"
): FlowCookieSetDetails {
  const hostPrefixed = cookie.name.startsWith("__Host-");
  const httpPrefixed = cookie.name.startsWith("__Http-") || cookie.name.startsWith("__Host-Http-");
  const securePrefixed = hostPrefixed || cookie.name.startsWith("__Secure-") || httpPrefixed;
  const secure = cookie.secure || securePrefixed || cookie.sameSite === "no_restriction";
  return {
    url,
    name: cookie.name,
    value: cookie.value,
    ...(hostPrefixed ? {} : { domain: cookie.domain }),
    path: hostPrefixed ? "/" : cookie.path,
    secure,
    httpOnly: cookie.httpOnly || httpPrefixed,
    expirationDate: cookie.expirationDate,
    sameSite: cookie.sameSite,
  };
}

export function flowCookieHeader(cookies: Array<{ name: string; value: string }>): string {
  return cookies
    .filter((cookie) => isFlowSessionCookieName(cookie.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}
