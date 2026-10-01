import { FlowUserActionError } from "./flow-request-control.js";

export const FLOW_BROWSER_HOME = "https://flow.google.com/";
export class FlowLoginRequiredError extends Error {
  readonly code = "FLOW_LOGIN_REQUIRED";
  constructor() { super("Войдите в Google в открытом окне Flow. Аккаунт и данные браузера сохраняются."); this.name = "FlowLoginRequiredError"; }
}
export class FlowBrowserStateError extends Error {
  readonly code = "FLOW_BROWSER_STATE_MISSING";
  constructor() {
    super("Flow открыл аккаунт, но страница не предоставила данные сессии. Это не подтверждает выход из Google. Обновите сессию Flow; если ошибка повторяется, сохраните отчёт для проверки интеграции.");
    this.name = "FlowBrowserStateError";
  }
}

/** Only a read-only session check may recover by loading a fresh document. Never retry a generation here. */
export function flowSessionNeedsReload(value: unknown): boolean {
  const result = value as { loginRequired?: boolean; status?: number } | undefined;
  return result?.loginRequired === true || result?.status === 401;
}

/** RPC IDs/fields verified against the public Flow Angular client and live read-only replies. */
export const FLOW_READ_SESSION_SCRIPT = `(async () => {
  if (location.origin !== "https://flow.google.com") return { loginRequired: true, reason: "not_flow_origin" };
  const data = window.WIZ_global_data || {};
  const email = data.oPEP7c;
  if (typeof email !== "string" || !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) return { loginRequired: true, reason: "identity_missing" };
  if (typeof data.SNlM0e !== "string" || !data.SNlM0e) return { loginRequired: true, reason: "session_data_missing" };
  const url = new URL("/_/AiSandboxAngularFrontend/data/batchexecute", location.origin);
  url.searchParams.set("rpcids", "nzlxg,KV2T2d,cPZSdc");
  url.searchParams.set("source-path", location.pathname);
  url.searchParams.set("rt", "c");
  if (typeof data.cfb2h === "string") url.searchParams.set("bl", data.cfb2h);
  if (typeof data.FdrFJe === "string") url.searchParams.set("f.sid", data.FdrFJe);
  const body = new URLSearchParams({ at: data.SNlM0e, "f.req": JSON.stringify([[
    ["nzlxg", "[]", null, "generic"], ["KV2T2d", "[22]", null, "generic"], ["cPZSdc", "[]", null, "generic"]
  ]]) });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  try {
    const response = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "X-Same-Domain": "1" }, body, signal: abort.signal });
    return { status: response.status, email, body: await response.text() };
  } finally { clearTimeout(timer); }
})()`;

export function parseFlowRpc(text: string, rpc: string): unknown[] {
  if (text.length > 4_000_000) throw new Error("Слишком большой ответ проверки Flow");
  for (const line of text.split("\n")) {
    if (!line.trimStart().startsWith("[[")) continue;
    let rows: unknown;
    try { rows = JSON.parse(line); } catch { continue; }
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!Array.isArray(row) || row[0] !== "wrb.fr" || row[1] !== rpc) continue;
      if (typeof row[2] !== "string") throw new Error(`Flow не подтвердил проверку ${rpc} (ошибка RPC)`);
      let payload: unknown;
      try { payload = JSON.parse(row[2]); } catch { throw new Error(`Flow вернул некорректный ответ проверки ${rpc}`); }
      if (!Array.isArray(payload)) throw new Error(`Flow изменил формат проверки ${rpc}`);
      return payload;
    }
  }
  throw new Error(`Flow не вернул результат проверки ${rpc}`);
}

export function parseFlowBrowserSession(value: unknown): { email: string; credits: number; tier?: string } {
  const result = value as { loginRequired?: boolean; reason?: string; status?: number; email?: unknown; body?: unknown } | undefined;
  if (result?.loginRequired && result.reason === "session_data_missing") throw new FlowBrowserStateError();
  if (!result || result.loginRequired || result.status === 401) throw new FlowLoginRequiredError();
  if (result.status !== 200 || typeof result.body !== "string") throw new Error(`Flow не подтвердил сессию: HTTP ${result.status ?? "unknown"}`);
  if (typeof result.email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(result.email)) throw new FlowLoginRequiredError();
  const availability = parseFlowRpc(result.body, "KV2T2d");
  const config = parseFlowRpc(result.body, "cPZSdc");
  if (config[30] === false) throw new FlowUserActionError("Google Flow отказал в доступе для текущего аккаунта/региона (unsupported-country).");
  if (config[31] === false || availability[0] === 7) throw new FlowUserActionError("Google Flow требует проверки возраста аккаунта (age-restricted).");
  if ([4, 5, 6, 8].includes(Number(availability[0]))) throw new FlowUserActionError("Google Flow сообщил, что сервис недоступен этому аккаунту (unavailable).");
  if (availability[0] !== 1) throw new Error("Flow пока не подтвердил доступность сервиса для аккаунта");
  const credits = parseFlowRpc(result.body, "nzlxg");
  if (typeof credits[0] !== "number" || !Number.isFinite(credits[0]) || credits[0] < 0) throw new Error("Flow изменил формат счётчика кредитов");
  const tiers: Record<number, string> = { 1: "PRO", 2: "ULTRA", 3: "FREE", 4: "PAYG", 8: "ULTRA1P5" };
  return { email: result.email, credits: credits[0], tier: tiers[Number(credits[1])] };
}

export function flowLoginLocation(value: string): string {
  try {
    const url = new URL(value);
    if (url.hostname === "accounts.google.com") return `${url.origin}/[login]`;
    if (url.hostname !== "flow.google.com" && url.hostname !== "labs.google") return url.origin;
    return `${url.origin}${url.pathname.startsWith("/asb/") ? "/asb/[media]" : url.pathname.replace(/\/project\/[^/]+/g, "/project/[id]")}`;
  } catch { return "about:blank"; }
}
