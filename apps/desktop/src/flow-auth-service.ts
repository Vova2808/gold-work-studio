import { BrowserWindow, net, session, type Session } from "electron";
import { recordDiagnosticEvent } from "./diagnostics.js";
import { flowRpcScript, parseFlowRpcResponse, type FlowRpcId } from "./flow-rpc.js";
import { FLOW_BROWSER_HOME, FLOW_READ_SESSION_SCRIPT, FlowLoginRequiredError, flowLoginLocation, flowSessionNeedsReload, parseFlowBrowserSession } from "./flow-browser-session.js";
import { FlowUserActionError, flowAbortError, runFlowStep } from "./flow-request-control.js";
import type {
  FlowAccountPublic,
  FlowAccountUpdateInput,
  FlowCookieImportInput,
  FlowLoginInput,
  FlowLoginProgress,
} from "@gold-work/shared";
import { FlowAccountStore } from "./flow-account-store.js";
import { createSocks5BrowserProxyBridge, type BrowserProxyBridge } from "./proxy-utils.js";
import {
  flowCookieHeader,
  flowCookieSetDetails,
  isFlowSessionCookieName,
  parseFlowCookies,
  type ParsedFlowCookie,
} from "./flow-cookie-import.js";
import {
  FLOW_API_ORIGIN,
  FLOW_HOME,
  FLOW_RECAPTCHA_SITE_KEY,
  FLOW_SESSION_URL,
  FLOW_TOOL_URL,
  FLOW_WEB_API_KEY,
  findFlowNumber,
  findFlowString,
  flowAccountTier,
  flowBrowserUserAgent,
  flowRuntimeBlockReason,
  isAllowedFlowNavigation,
  isBenignFlowNavigationAbort,
  shouldHoldLegacyFlowRuntime,
  shouldReturnToFlowAfterLogin,
} from "./flow-protocol.js";

interface FlowSessionResponse {
  user?: { email?: string; name?: string };
  email?: string;
  accessToken?: string;
  access_token?: string;
  expires?: string;
  exp?: number;
}

function expiryIso(value: unknown): string | undefined {
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value > 10_000_000_000 ? value : value * 1_000).toISOString();
  }
  return undefined;
}

export function flowJwtExpiry(token: string | undefined): string | undefined {
  if (!token) return undefined;
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as { exp?: number };
    return expiryIso(parsed.exp);
  } catch {
    return undefined;
  }
}

function proxyRules(proxyUrl: string | undefined): string | undefined {
  if (!proxyUrl?.trim()) return undefined;
  try {
    const url = new URL(proxyUrl);
    if (!["http:", "https:", "socks5:", "socks5h:"].includes(url.protocol)) throw new Error("unsupported");
    const port = url.port || (url.protocol === "https:" ? "443" : /^socks5h?:$/.test(url.protocol) ? "1080" : "80");
    return `${url.protocol}//${url.hostname}:${port}`;
  } catch {
    throw new Error("Некорректный прокси Flow. Используйте http://, https:// или socks5://логин:пароль@хост:порт");
  }
}

function proxyCredentials(proxyUrl: string | undefined): { username: string; password: string } | undefined {
  if (!proxyUrl?.trim()) return undefined;
  try {
    const url = new URL(proxyUrl);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    if (!url.username && !url.password) return undefined;
    return { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
  } catch {
    return undefined;
  }
}

export class FlowAuthService {
  private readonly loginWindows = new Map<string, BrowserWindow>();
  private readonly runtimeWindows = new Map<string, BrowserWindow>();
  private readonly runtimeLoads = new Map<string, Promise<BrowserWindow>>();
  private readonly refreshes = new Map<string, Promise<FlowAccountPublic>>();
  private readonly proxyBridges = new Map<string, { source: string; bridge: BrowserProxyBridge }>();
  private readonly proxyConfigurations = new Map<string, string>();
  private readonly proxyLoads = new Map<string, Promise<void>>();
  private readonly observedSessions = new WeakSet<Session>();

  constructor(
    private readonly store: FlowAccountStore,
    private readonly publishAccounts: (accounts: FlowAccountPublic[]) => void,
    private readonly publishProgress: (progress: FlowLoginProgress) => void
  ) {}

  async list(): Promise<FlowAccountPublic[]> {
    // An unrecognised browser session is not an abandoned account. Listing must
    // never delete user credentials/proxy/cookies; only explicit remove() does.
    return this.store.list();
  }

  async login(input: FlowLoginInput = {}): Promise<FlowAccountPublic> {
    const account = await this.store.ensure({
      id: input.accountId,
      label: input.label,
      proxyUrl: input.proxyUrl,
    });
    const existing = this.loginWindows.get(account.id);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return account;
    }
    const partition = await this.store.partition(account.id);
    const browserSession = session.fromPartition(partition, { cache: true });
    await this.configureProxy(account.id, browserSession);
    const window = this.createAuthWindow(account.id, partition);
    this.loginWindows.set(account.id, window);
    let lastLocation = "";
    const noteLocation = () => {
      if (window.isDestroyed()) return;
      try {
        const location = flowLoginLocation(window.webContents.getURL());
        if (location === lastLocation) return;
        lastLocation = location;
        recordDiagnosticEvent("info", "flow.login.navigation", { accountId: account.id, location });
      } catch { /* about:blank / incomplete navigation */ }
    };
    window.webContents.on("did-navigate", noteLocation);
    window.webContents.on("did-navigate-in-page", noteLocation);
    this.progress(account.id, "opening", "Открываю Google Flow…");

    return new Promise<FlowAccountPublic>((resolve, reject) => {
      let settled = false;
      let confirmed = false;
      let validation: Promise<void> | undefined;
      let lastValidationError = "";
      const finish = async (result: FlowAccountPublic) => {
        if (settled) return;
        settled = true;
        confirmed = true;
        clearInterval(poll);
        clearTimeout(timeout);
        this.progress(account.id, "ready", `Flow подключён: ${result.email ?? result.label ?? "аккаунт"}`);
        await this.publish();
        resolve(result);
        setTimeout(() => {
          if (!window.isDestroyed()) window.close();
        }, 700);
      };
      const fail = async (error: unknown, cancelled = false) => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        clearTimeout(timeout);
        const message = error instanceof Error ? error.message : String(error);
        await this.store.updateSession(account.id, {
          status: error instanceof FlowUserActionError ? "needs_user_action" : cancelled ? "needs_login" : "error",
          lastError: message,
        }).catch(() => undefined);
        this.progress(account.id, cancelled ? "cancelled" : "error", message);
        await this.publish();
        reject(error);
      };
      const validate = (): Promise<void> => {
        if (validation) return validation;
        if (settled) return Promise.resolve();
        validation = (async () => { try {
          await this.checkRuntimeAccess(account.id, window, false);
          const cookies = await browserSession.cookies.get({ domain: "labs.google" });
          const modern = (window.isDestroyed() ? lastLocation : window.webContents.getURL()).startsWith(FLOW_BROWSER_HOME);
          if (!modern && !cookies.some((cookie) => isFlowSessionCookieName(cookie.name))) {
            this.progress(account.id, "waiting_login", "Завершите вход в открытом окне Google Flow. Данные аккаунта сохраняются.");
            return;
          }
          this.progress(account.id, "validating", "Проверяю сессию Google Flow…");
          const result = await this.refresh(account.id);
          if (result.status !== "ready") throw new FlowUserActionError(result.lastError ?? "Flow требует проверки аккаунта в браузере");
          await finish(result);
        } catch (error) {
          if (error instanceof FlowUserActionError) { await fail(error); return; }
          const message = error instanceof Error ? error.message : "Не удалось подтвердить сессию Flow";
          if (error instanceof FlowLoginRequiredError) this.progress(account.id, "waiting_login", message);
          if (!(error instanceof FlowLoginRequiredError) && message !== lastValidationError) {
            lastValidationError = message;
            recordDiagnosticEvent("warn", "flow.login.validation_failed", { accountId: account.id, message });
          }
          this.progress(account.id, "waiting_login", error instanceof Error ? error.message : "Войдите в Google и дождитесь открытия Flow");
        } finally { validation = undefined; } })();
        return validation;
      };
      const poll = setInterval(() => void validate(), 1_500);
      const timeout = setTimeout(
        () => void fail(new Error("Вход Flow не завершён за 10 минут. Откройте подключение ещё раз.")),
        10 * 60_000
      );
      window.on("closed", () => {
        this.loginWindows.delete(account.id);
        clearInterval(poll);
        // A valid session may have arrived just before close. Finish its read-only
        // check before reporting cancellation; never erase this browser partition.
        if (!settled) void validate().finally(() => {
          recordDiagnosticEvent("info", "flow.login.closed", { accountId: account.id, confirmed, location: lastLocation });
          if (!settled) void fail(new Error(lastValidationError || "Окно Flow закрыто до подтверждения сессии приложением. Аккаунт, прокси и данные входа сохранены. Нажмите «Войти снова», чтобы продолжить."), true);
        });
        else recordDiagnosticEvent("info", "flow.login.closed", { accountId: account.id, confirmed, location: lastLocation });
      });
      window.webContents.on("did-finish-load", () => void validate());
      void this.loadFlowPage(window, FLOW_BROWSER_HOME).catch((error) => fail(error));
    });
  }

  async importCookies(input: FlowCookieImportInput): Promise<FlowAccountPublic> {
    const cookies = parseFlowCookies(input.cookies);
    const account = await this.store.ensure({
      id: input.accountId,
      label: input.label,
      proxyUrl: input.proxyUrl,
    });
    const partition = await this.store.partition(account.id);
    const browserSession = session.fromPartition(partition, { cache: true });
    await this.configureProxy(account.id, browserSession);
    const oldCookies = await browserSession.cookies.get({ domain: "labs.google" });
    for (const cookie of oldCookies.filter((item) => isFlowSessionCookieName(item.name))) {
      const domain = (cookie.domain ?? "labs.google").replace(/^\./, "");
      await browserSession.cookies.remove(`https://${domain}${cookie.path || "/"}`, cookie.name);
    }
    for (const cookie of cookies) await this.setCookie(browserSession, cookie);
    await browserSession.cookies.flushStore();
    const result = await this.refresh(account.id);
    await this.publish();
    return result;
  }

  async refresh(accountId: string): Promise<FlowAccountPublic> {
    const active = this.refreshes.get(accountId);
    if (active) return active;
    const refresh = this.refreshInternal(accountId).finally(() => this.refreshes.delete(accountId));
    this.refreshes.set(accountId, refresh);
    return refresh;
  }

  async refreshAll(): Promise<FlowAccountPublic[]> {
    const accounts = await this.store.list();
    await Promise.all(accounts.filter((account) => account.enabled).map((account) =>
      this.refresh(account.id).catch(() => undefined)
    ));
    await this.publish();
    return this.store.list();
  }

  async update(accountId: string, input: FlowAccountUpdateInput): Promise<FlowAccountPublic> {
    const result = await this.store.update(accountId, input);
    if (input.proxyUrl !== undefined || input.clearProxy) {
      const partition = await this.store.partition(accountId);
      await this.configureProxy(accountId, session.fromPartition(partition, { cache: true }));
    }
    await this.publish();
    return result;
  }

  async open(accountId: string): Promise<void> {
    const partition = await this.store.partition(accountId);
    const browserSession = session.fromPartition(partition, { cache: true });
    await this.configureProxy(accountId, browserSession);
    const window = this.createAuthWindow(accountId, partition);
    await this.loadFlowPage(window, FLOW_BROWSER_HOME);
  }

  async sessionFor(accountId: string): Promise<Session> {
    const partition = await this.store.partition(accountId);
    const browserSession = session.fromPartition(partition, { cache: true });
    await this.configureProxy(accountId, browserSession);
    return browserSession;
  }

  /** Electron Session.fetch cannot expose a manual redirect; net.request can,
   * while retaining the same proxy, cookies and isolated account partition. */
  async requestMediaRedirect(
    accountId: string,
    browserSession: Session,
    url: string,
    init: RequestInit,
    signal: AbortSignal
  ): Promise<Response> {
    const credentials = proxyCredentials((await this.store.secret(accountId)).proxyUrl);
    return runFlowStep("получение ссылки на файл", 30_000, signal, (requestSignal) => new Promise<Response>((resolve, reject) => {
      const request = net.request({ url, method: "GET", session: browserSession, credentials: "include", redirect: "manual" });
      let settled = false;
      const finish = (error?: unknown, response?: Response) => {
        if (settled) return;
        settled = true;
        requestSignal.removeEventListener("abort", onAbort);
        if (error) reject(error); else resolve(response!);
      };
      const onAbort = () => { finish(requestSignal.reason ?? flowAbortError()); request.abort(); };
      requestSignal.addEventListener("abort", onAbort, { once: true });
      request.on("error", (error) => finish(error));
      request.on("login", (info, callback) => {
        if (info.isProxy && credentials) callback(credentials.username, credentials.password);
        else callback();
      });
      request.on("redirect", (status, _method, location) => {
        finish(undefined, new Response(null, { status, headers: { location } }));
        // No followRedirect: the signed file is fetched separately without credentials.
      });
      request.on("response", (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 512 * 1024 * 1024) { finish(new Error("Flow вернул слишком большой файл")); request.abort(); }
          else chunks.push(chunk);
        });
        response.on("error", (error: Error) => finish(error));
        response.on("end", () => {
          const headers = new Headers();
          for (const [name, values] of Object.entries(response.headers)) {
            headers.set(name, Array.isArray(values) ? values.join(", ") : values);
          }
          const empty = [204, 205, 304].includes(response.statusCode);
          finish(undefined, new Response(empty ? null : Buffer.concat(chunks), { status: response.statusCode, headers }));
        });
      });
      new Headers(init.headers).forEach((value, name) => request.setHeader(name, value));
      if (requestSignal.aborted) { onAbort(); return; }
      request.end();
    }));
  }

  async prepareRuntime(accountId: string, signal?: AbortSignal): Promise<void> {
    const window = await runFlowStep("загрузка страницы аккаунта", 60_000, signal, () => this.runtimeWindow(accountId));
    await this.checkRuntimeAccess(accountId, window);
  }

  /** New Flow uses same-origin Google RPC, never a manufactured legacy Bearer. */
  async rpc(accountId: string, rpc: FlowRpcId, payload: unknown[], signal?: AbortSignal, timeoutMs = 30_000): Promise<unknown[]> {
    const window = await runFlowStep("страница нового Flow", 60_000, signal, () => this.runtimeWindow(accountId, true));
    await this.checkRuntimeAccess(accountId, window);
    const started = Date.now();
    recordDiagnosticEvent("debug", "flow.rpc.started", { accountId, rpc });
    const response = await runFlowStep(`Flow RPC ${rpc}`, timeoutMs + 2_000, signal, () =>
      window.webContents.executeJavaScript(flowRpcScript(rpc, payload, timeoutMs))
    ) as { status: number; body: string };
    recordDiagnosticEvent("debug", "flow.rpc.response", { accountId, rpc, status: response.status, elapsedMs: Date.now() - started });
    return parseFlowRpcResponse(rpc, response);
  }

  async prepareRpcProject(accountId: string, projectId: string, signal?: AbortSignal): Promise<void> {
    if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error("Flow returned an invalid project ID");
    const window = await runFlowStep("страница нового Flow", 60_000, signal, () => this.runtimeWindow(accountId, true));
    const url = `${FLOW_BROWSER_HOME}project/${projectId}`;
    if (window.webContents.getURL() !== url) await runFlowStep("открытие проекта Flow", 60_000, signal, () => this.loadFlowPage(window, url));
    await this.checkRuntimeAccess(accountId, window);
  }

  async recaptchaToken(accountId: string, action = "VIDEO_GENERATION", signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new Error("Получение reCAPTCHA Flow отменено");
    const window = await runFlowStep("загрузка страницы аккаунта", 60_000, signal, () => this.runtimeWindow(accountId));
    if (signal?.aborted) throw new Error("Получение reCAPTCHA Flow отменено");
    await this.checkRuntimeAccess(accountId, window);
    const script = `(() => new Promise((resolve, reject) => {
      const deadline = Date.now() + 30000;
      const run = () => {
        const enterprise = window.grecaptcha && window.grecaptcha.enterprise;
        if (!enterprise) {
          if (Date.now() >= deadline) return reject(new Error("grecaptcha.enterprise не загрузилась"));
          return setTimeout(run, 250);
        }
        const scriptUrl = Array.from(document.scripts)
          .map((script) => script.src)
          .find((src) => /recaptcha\\/enterprise\\.js/i.test(src) && /[?&]render=/.test(src));
        const discoveredKey = scriptUrl
          ? new URL(scriptUrl).searchParams.get("render")
          : "";
        const siteKey = discoveredKey && discoveredKey !== "explicit"
          ? discoveredKey
          : ${JSON.stringify(FLOW_RECAPTCHA_SITE_KEY)};
        enterprise.ready(() => {
          Promise.resolve(enterprise.execute(siteKey, {
            action: ${JSON.stringify(action)}
          })).then(resolve, reject);
        });
      };
      run();
    }))()`;
    try {
      const token = await runFlowStep("проверка reCAPTCHA", 35_000, signal, () =>
        window.webContents.executeJavaScript(script, true)
      ) as unknown;
      if (typeof token !== "string" || token.length < 20) throw new Error("страница не вернула токен");
      return token;
    } catch (error) {
      if (signal?.aborted) throw flowAbortError();
      if (!window.isDestroyed()) window.showInactive();
      throw new Error(
        `Flow не смог получить reCAPTCHA-токен из авторизованной страницы: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async remove(accountId: string): Promise<void> {
    const window = this.loginWindows.get(accountId);
    if (window && !window.isDestroyed()) window.destroy();
    const runtimeWindow = this.runtimeWindows.get(accountId);
    if (runtimeWindow && !runtimeWindow.isDestroyed()) runtimeWindow.destroy();
    const partition = await this.store.partition(accountId);
    const browserSession = session.fromPartition(partition);
    await this.closeProxyBridge(accountId);
    await browserSession.clearStorageData();
    await browserSession.clearCache();
    await browserSession.clearAuthCache();
    await this.store.remove(accountId);
    await this.publish();
  }

  async closeAll(): Promise<void> {
    for (const window of this.loginWindows.values()) {
      if (!window.isDestroyed()) window.destroy();
    }
    for (const window of this.runtimeWindows.values()) {
      if (!window.isDestroyed()) window.destroy();
    }
    this.loginWindows.clear();
    this.runtimeWindows.clear();
    this.runtimeLoads.clear();
    await Promise.all([...this.proxyBridges.keys()].map((accountId) => this.closeProxyBridge(accountId)));
  }

  private async refreshInternal(accountId: string): Promise<FlowAccountPublic> {
    const account = await this.store.get(accountId);
    if (!account) throw new Error("Flow-аккаунт не найден");
    const partition = await this.store.partition(accountId);
    const browserSession = session.fromPartition(partition, { cache: true });
    await this.configureProxy(accountId, browserSession);
    const secret = await this.store.secret(accountId);
    let cookies = await browserSession.cookies.get({ domain: "labs.google" });
    const loginWindow = this.loginWindows.get(accountId);
    if (secret.sessionOrigin === "https://flow.google.com" || (loginWindow && !loginWindow.isDestroyed() && loginWindow.webContents.getURL().startsWith(FLOW_BROWSER_HOME))) {
      return this.refreshBrowserSession(accountId, loginWindow);
    }
    if (!cookies.some((cookie) => isFlowSessionCookieName(cookie.name)) && secret.cookieHeader) {
      const restored = parseFlowCookies(secret.cookieHeader).filter((cookie) => isFlowSessionCookieName(cookie.name));
      for (const cookie of restored) await this.setCookie(browserSession, cookie);
      await browserSession.cookies.flushStore();
      cookies = await browserSession.cookies.get({ domain: "labs.google" });
    }
    if (!cookies.some((cookie) => isFlowSessionCookieName(cookie.name))) {
      const googleCookies = await browserSession.cookies.get({ url: FLOW_BROWSER_HOME });
      if (googleCookies.some(cookie => cookie.name === "SID" || cookie.name === "__Secure-1PSID")) {
        return this.refreshBrowserSession(accountId);
      }
      const result = await this.store.updateSession(accountId, {
        status: "needs_login",
        lastError: "Приложение пока не получило подтверждённую сессию Flow. Откройте «Войти снова» и перейдите в проект. Аккаунт и данные браузера сохранены.",
      });
      throw new Error(result.lastError);
    }

    const { response, sessionData } = await runFlowStep("обновление сессии", 30_000, undefined, async (signal) => {
      const response = await browserSession.fetch(FLOW_SESSION_URL, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      signal,
      headers: { Accept: "application/json" },
      });
      return { response, sessionData: response.ok ? await response.json() as FlowSessionResponse : undefined };
    });
    if (!response.ok) {
      const message = `Flow не подтвердил сессию: HTTP ${response.status}`;
      await this.store.updateSession(accountId, {
        status: response.status === 401 || response.status === 403 ? "needs_login" : "error",
        lastError: message,
      });
      throw new Error(message);
    }
    const accessToken = sessionData?.accessToken ?? sessionData?.access_token;
    const email = sessionData?.user?.email ?? sessionData?.email;
    if (!email || !accessToken) {
      const message = "Flow открылся, но /api/auth/session не вернул email или access token";
      await this.store.updateSession(accountId, { status: "needs_login", lastError: message });
      throw new Error(message);
    }
    const sessionExpiries = cookies
      .filter((cookie) => isFlowSessionCookieName(cookie.name))
      .map((cookie) => cookie.expirationDate)
      .filter((value): value is number => typeof value === "number" && value > 0);
    const sessionExpiresAt = sessionExpiries.length > 0
      ? new Date(Math.min(...sessionExpiries) * 1_000).toISOString()
      : expiryIso(sessionData?.expires);
    const entitlements = await this.fetchEntitlements(browserSession, accessToken).catch(() => undefined);
    const result = await this.store.updateSession(accountId, {
      email,
      status: "ready",
      preserveUserAction: true,
      tier: entitlements?.tier,
      credits: entitlements?.credits,
      sessionExpiresAt,
      tokenExpiresAt: expiryIso(sessionData?.exp) ?? flowJwtExpiry(accessToken),
      lastRefreshAt: new Date().toISOString(),
      lastError: undefined,
      cookieHeader: flowCookieHeader(cookies),
      accessToken,
    });
    await this.publish();
    return result;
  }

  private async refreshBrowserSession(accountId: string, loginWindow?: BrowserWindow): Promise<FlowAccountPublic> {
    const interactive = !!loginWindow && !loginWindow.isDestroyed();
    let pageReloaded = false;
    let location = "not-loaded";
    try {
      const window = interactive ? loginWindow! : await this.runtimeWindow(accountId, true);
      await this.checkRuntimeAccess(accountId, window, false);
      location = flowLoginLocation(window.webContents.getURL());
      const read = () => runFlowStep("проверка сессии flow.google.com", 20_000, undefined, () => window.webContents.executeJavaScript(FLOW_READ_SESSION_SCRIPT));
      let response = await read();
      if (!interactive && flowSessionNeedsReload(response)) {
        // Login updates shared cookies, not WIZ_global_data in an already loaded hidden document.
        // Re-read that document once before declaring the account logged out. No paid RPC is retried.
        recordDiagnosticEvent("info", "flow.session.reloading", { accountId, location, source: "runtime-window", reason: response?.reason ?? "http-401" });
        pageReloaded = true;
        await this.loadFlowPage(window, FLOW_BROWSER_HOME);
        location = flowLoginLocation(window.webContents.getURL());
        await this.checkRuntimeAccess(accountId, window, false);
        response = await read();
      }
      const verified = parseFlowBrowserSession(response);
      await window.webContents.session.cookies.flushStore();
      const result = await this.store.updateSession(accountId, {
        ...verified, status: "ready", sessionOrigin: "https://flow.google.com",
        // New Flow authenticates RPC with its own Google browser session, not an
        // old NextAuth bearer. Do not misrepresent an old token as current access.
        accessToken: "", tokenExpiresAt: undefined, sessionExpiresAt: undefined,
        lastRefreshAt: new Date().toISOString(), lastError: undefined,
      });
      recordDiagnosticEvent("info", "flow.session.confirmed", { accountId, mode: "google-rpc", source: interactive ? "login-window" : "runtime-window", location, pageReloaded });
      await this.publish();
      return result;
    } catch (error) {
      recordDiagnosticEvent("warn", "flow.session.failed", { accountId, mode: "google-rpc", source: interactive ? "login-window" : "runtime-window", location, pageReloaded, error });
      await this.store.updateSession(accountId, {
        status: error instanceof FlowUserActionError ? "needs_user_action" : error instanceof FlowLoginRequiredError ? "needs_login" : "error",
        lastError: error instanceof Error ? error.message : "Не удалось подтвердить сессию Flow",
      }).catch(() => undefined);
      throw error;
    }
  }

  private createAuthWindow(accountId: string, partition: string, show = true): BrowserWindow {
    let visitedGoogleLogin = false;
    let returnedToFlow = false;
    const window = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 900,
      minHeight: 640,
      title: "Подключение Google Flow",
      show,
      autoHideMenuBar: true,
      webPreferences: {
        partition,
        javascript: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    window.webContents.on("login", async (event, _details, authInfo, callback) => {
      if (!authInfo.isProxy) return;
      const credentials = proxyCredentials((await this.store.secret(accountId)).proxyUrl);
      if (!credentials) return;
      event.preventDefault();
      callback(credentials.username, credentials.password);
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      // Google иногда открывает авторизацию в новом окне. Оставляем её в той же
      // изолированной Flow-сессии, чтобы cookies не ушли в основной renderer.
      // Скрытому runtime-окну переходить за popup нельзя: иначе страница Flow
      // сама отменит свою загрузку и Electron вернёт ERR_ABORTED (-3).
      if (show && isAllowedFlowNavigation(url)) {
        setTimeout(() => {
          if (!window.isDestroyed()) void this.loadFlowPage(window, url).catch(() => undefined);
        }, 0);
      }
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (!show && shouldHoldLegacyFlowRuntime(window.webContents.getURL(), url)) {
        // The hidden runtime needs the already-loaded labs client for reCAPTCHA.
        // Do not apply this to the visible login/open window.
        event.preventDefault();
        return;
      }
      if (isAllowedFlowNavigation(url)) return;
      event.preventDefault();
    });
    window.webContents.on("did-navigate", (_event, url) => {
      let host = "";
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        return;
      }
      if (host === "accounts.google.com") {
        visitedGoogleLogin = true;
        return;
      }
      if (show && shouldReturnToFlowAfterLogin(url, visitedGoogleLogin, returnedToFlow)) {
        returnedToFlow = true;
        this.progress(accountId, "validating", "Вход выполнен. Возвращаю аккаунт в Google Flow…");
        setTimeout(() => {
          if (window.isDestroyed()) return;
          void this.loadFlowPage(window, FLOW_BROWSER_HOME).catch((error) => {
            this.progress(
              accountId,
              "error",
              `Не удалось вернуться в Google Flow: ${error instanceof Error ? error.message : String(error)}`
            );
          });
        }, 0);
        return;
      }
      if (show && returnedToFlow && host === "one.google.com") {
        this.progress(
          accountId,
          "error",
          "Google вошёл в аккаунт, но Flow снова открыл Google One. Проверьте, что Google AI Pro через Jio активирован именно на этом аккаунте."
        );
      }
    });
    return window;
  }

  private async runtimeWindow(accountId: string, modern = false): Promise<BrowserWindow> {
    const loading = this.runtimeLoads.get(accountId);
    if (loading) return loading;
    const existing = this.runtimeWindows.get(accountId);
    if (existing && !existing.isDestroyed() && !existing.webContents.isDestroyed()) {
      if (!modern || existing.webContents.getURL().startsWith(FLOW_BROWSER_HOME)) return existing;
      existing.destroy();
    }
    const promise = (async () => {
      const partition = await this.store.partition(accountId);
      const browserSession = session.fromPartition(partition, { cache: true });
      await this.configureProxy(accountId, browserSession);
      const window = this.createAuthWindow(accountId, partition, false);
      this.runtimeWindows.set(accountId, window);
      window.on("closed", () => {
        if (this.runtimeWindows.get(accountId) === window) this.runtimeWindows.delete(accountId);
      });
      window.webContents.once("render-process-gone", () => { if (!window.isDestroyed()) window.destroy(); });
      try {
        const secret = await this.store.secret(accountId);
        await this.loadFlowPage(window, modern || secret.sessionOrigin === "https://flow.google.com" ? FLOW_BROWSER_HOME : FLOW_TOOL_URL);
        await this.checkRuntimeAccess(accountId, window);
        return window;
      } catch (error) {
        try {
          // A navigation timeout/ERR_ABORTED must not hide a confirmed product refusal.
          if (!(error instanceof FlowUserActionError)) await this.checkRuntimeAccess(accountId, window, false);
          throw error;
        } finally { if (!window.isDestroyed()) window.destroy(); }
      }
    })().finally(() => this.runtimeLoads.delete(accountId));
    this.runtimeLoads.set(accountId, promise);
    return promise;
  }

  private async loadFlowPage(window: BrowserWindow, url: string): Promise<void> {
    try {
      await runFlowStep("открытие страницы Flow", 60_000, undefined, () => window.loadURL(url));
    } catch (error) {
      if (window.isDestroyed()) throw error;
      const currentUrl = window.webContents.getURL();
      if (!isBenignFlowNavigationAbort(error, currentUrl)) throw error;
      await this.waitForFlowNavigation(window, error);
    }
  }

  private async checkRuntimeAccess(accountId: string, window: BrowserWindow, clearResolved = true): Promise<void> {
    if (window.isDestroyed()) return;
    const reason = flowRuntimeBlockReason(window.webContents.getURL());
    if (reason) {
      await this.store.updateSession(accountId, { status: "needs_user_action", lastError: reason });
      await this.publish();
      throw new FlowUserActionError(reason);
    }
    if (clearResolved && (await this.store.get(accountId))?.status === "needs_user_action") {
      const url = new URL(window.webContents.getURL());
      if (url.hostname === "labs.google" || url.hostname === "flow.google.com") {
        await this.store.updateSession(accountId, { status: "ready", lastError: undefined });
        await this.publish();
      }
    }
  }

  private async waitForFlowNavigation(window: BrowserWindow, originalError: unknown): Promise<void> {
    if (
      !window.isDestroyed()
      && isAllowedFlowNavigation(window.webContents.getURL())
      && !window.webContents.isLoadingMainFrame()
    ) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const webContents = window.webContents;
      let timeout: NodeJS.Timeout;
      const cleanup = () => {
        clearTimeout(timeout);
        webContents.removeListener("did-finish-load", handleSettled);
        webContents.removeListener("did-stop-loading", handleSettled);
        webContents.removeListener("did-fail-load", handleFailed);
        window.removeListener("closed", handleClosed);
      };
      const finish = (error?: unknown) => {
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const handleSettled = () => {
        if (
          !window.isDestroyed()
          && isAllowedFlowNavigation(webContents.getURL())
          && !webContents.isLoadingMainFrame()
        ) {
          finish();
        }
      };
      const handleFailed = (
        _event: Electron.Event,
        errorCode: number,
        errorDescription: string,
        validatedUrl: string,
        isMainFrame: boolean
      ) => {
        if (!isMainFrame) return;
        if (errorCode === -3 && isAllowedFlowNavigation(validatedUrl)) return;
        finish(new Error(`${errorDescription} (${errorCode}) loading '${validatedUrl}'`));
      };
      const handleClosed = () => finish(originalError);
      webContents.on("did-finish-load", handleSettled);
      webContents.on("did-stop-loading", handleSettled);
      webContents.on("did-fail-load", handleFailed);
      window.on("closed", handleClosed);
      timeout = setTimeout(() => {
        const currentUrl = window.isDestroyed() ? "" : webContents.getURL();
        finish(new Error(`Flow не завершил безопасный переход на страницу: ${currentUrl || FLOW_HOME}`));
      }, 20_000);
      handleSettled();
    });
  }

  private async fetchEntitlements(
    browserSession: Session,
    accessToken: string,
    origin = "https://labs.google"
  ): Promise<{ tier?: string; credits?: number }> {
    const { response, data } = await runFlowStep("проверка тарифа", 20_000, undefined, async (signal) => {
      const response = await browserSession.fetch(
      `${FLOW_API_ORIGIN}/v1/credits?key=${encodeURIComponent(FLOW_WEB_API_KEY)}`,
      {
        method: "GET",
        cache: "no-store",
        signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          Origin: origin,
          Referer: `${origin}/`,
        },
      }
      );
      return { response, data: response.ok ? await response.json() as unknown : undefined };
    });
    if (!response.ok) throw new Error(`Flow credits HTTP ${response.status}`);
    return {
      tier: flowAccountTier(findFlowString(data, ["userPaygateTier", "tier"])),
      credits: findFlowNumber(data, ["credits", "subscriptionCredits"]),
    };
  }

  private async configureProxy(accountId: string, browserSession: Session): Promise<void> {
    if (!this.observedSessions.has(browserSession)) {
      this.observedSessions.add(browserSession);
      const noted = new Set<string>();
      browserSession.webRequest.onBeforeSendHeaders({ urls: ["https://aisandbox-pa.googleapis.com/*", "https://flow.google.com/*"] }, (details, callback) => {
        // Observation only. Preserve all original headers and the account's proxy.
        const target = new URL(details.url);
        const authorization = Object.entries(details.requestHeaders).find(([key]) => key.toLowerCase() === "authorization")?.[1];
        const authScheme = typeof authorization === "string" ? (/^([A-Za-z0-9_-]+) /.exec(authorization)?.[1] ?? "other") : "none";
        const route = target.pathname.startsWith("/v1/") ? target.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[id]") : "[page-or-rpc]";
        const rpcIds = target.searchParams.get("rpcids");
        const rpc = rpcIds && /^[A-Za-z0-9_,]{1,120}$/.test(rpcIds) ? rpcIds : undefined;
        const key = `${target.hostname}:${route}:${rpc ?? ""}:${authScheme}`;
        if (noted.size < 25 && !noted.has(key)) {
          noted.add(key);
          recordDiagnosticEvent("debug", "flow.session.request", { accountId, host: target.hostname, route, rpc, authScheme });
        }
        callback({ requestHeaders: details.requestHeaders });
      });
    }
    const previous = this.proxyLoads.get(accountId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const source = (await this.store.secret(accountId)).proxyUrl?.trim() ?? "";
      if (this.proxyConfigurations.get(accountId) === source) return;
      await this.configureProxyInternal(accountId, browserSession, source);
    });
    this.proxyLoads.set(accountId, operation);
    try { await operation; } finally {
      if (this.proxyLoads.get(accountId) === operation) this.proxyLoads.delete(accountId);
    }
  }

  private async configureProxyInternal(accountId: string, browserSession: Session, source: string): Promise<void> {
    this.proxyConfigurations.delete(accountId);
    const runtime = this.runtimeWindows.get(accountId);
    if (runtime && !runtime.isDestroyed()) runtime.destroy();
    // Fail closed during proxy validation, including when changing from direct.
    // This also covers browser windows opened outside runtimeWindows.
    await browserSession.setProxy({ mode: "fixed_servers", proxyRules: "http://127.0.0.1:9", proxyBypassRules: "<-loopback>" });
    await browserSession.closeAllConnections();
    const rules = await this.browserProxyRules(accountId, source);
    browserSession.setUserAgent(
      flowBrowserUserAgent(browserSession.getUserAgent()),
      source ? "en-US,en" : "ru-RU,ru,en-US,en"
    );
    // Flow only needs ordinary web requests; permission prompts must not reveal device sensors.
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    await browserSession.setProxy(rules
      ? { mode: "fixed_servers", proxyRules: rules, proxyBypassRules: "<-loopback>" }
      : { mode: "direct" });
    await browserSession.closeAllConnections();
    this.proxyConfigurations.set(accountId, source);
  }

  private async browserProxyRules(accountId: string, proxyUrl: string | undefined): Promise<string | undefined> {
    const source = proxyUrl?.trim();
    if (!source) {
      await this.closeProxyBridge(accountId);
      return undefined;
    }
    let protocol = "";
    try {
      protocol = new URL(source).protocol.toLowerCase();
    } catch {
      return proxyRules(source);
    }
    if (!/^socks5h?:$/.test(protocol)) {
      await this.closeProxyBridge(accountId);
      return proxyRules(source);
    }
    const existing = this.proxyBridges.get(accountId);
    if (existing?.source === source) return existing.bridge.proxyUrl;
    await this.closeProxyBridge(accountId);
    try {
      const bridge = await createSocks5BrowserProxyBridge(source);
      this.proxyBridges.set(accountId, { source, bridge });
      return bridge.proxyUrl;
    } catch (error) {
      throw new Error(
        `Не удалось подключиться к SOCKS5-прокси: ${error instanceof Error ? error.message : String(error)}. `
        + "Проверьте тип прокси, адрес, порт, логин и пароль."
      );
    }
  }

  private async closeProxyBridge(accountId: string): Promise<void> {
    const existing = this.proxyBridges.get(accountId);
    if (!existing) return;
    this.proxyBridges.delete(accountId);
    await existing.bridge.close().catch(() => undefined);
  }

  private async setCookie(browserSession: Session, cookie: ParsedFlowCookie): Promise<void> {
    try {
      await browserSession.cookies.set(flowCookieSetDetails(cookie, FLOW_HOME));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Не удалось восстановить cookie Flow «${cookie.name}»: ${message}`);
    }
  }

  private progress(accountId: string, stage: FlowLoginProgress["stage"], message: string): void {
    this.publishProgress({ accountId, stage, message });
  }

  private async publish(): Promise<void> {
    this.publishAccounts(await this.store.list());
  }
}
