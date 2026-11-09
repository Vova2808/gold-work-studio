/** Real Electron-session probe; --generate explicitly permits ONE new image per account.
 * Close the main app before running: its cookie database must not be shared concurrently.
 * Proxy arrives only via GOLD_WORK_FLOW_PROXY and is stored with Windows safeStorage.
 */
import { app, BrowserWindow, session, type Session } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { FlowAccountStore } from "../src/flow-account-store.js";
import { FlowAuthService } from "../src/flow-auth-service.js";
import { FlowClient, type FlowRemoteImageJob } from "../src/flow-client.js";
import { runFlowStep } from "../src/flow-request-control.js";
import { FLOW_HOME, FLOW_ORIGIN, FLOW_PROJECT_CREATE_URL, flowTrpcInput } from "../src/flow-protocol.js";

const dataPath = process.env.GOLD_WORK_FLOW_DATA_PATH
  || join(process.env.APPDATA!, "@gold-work", "desktop");
app.setPath("userData", dataPath);
// A rejected hidden runtime may close between accounts; only the runner decides exit.
app.on("window-all-closed", () => undefined);
app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");
app.commandLine.appendSwitch("disable-quic");
if (process.argv.includes("--profile-window") && !process.argv.includes("--native-profile")) app.commandLine.appendSwitch("lang", "en-US");
const outputPath = resolve(process.env.GOLD_WORK_FLOW_QA_DIR
  || join("captures", `flow-live-${new Date().toISOString().replace(/[:.]/g, "-")}`));
const generate = process.argv.includes("--generate");
const clean = (error: unknown) => String(error instanceof Error ? error.message : error)
  .replace(/((?:https?|socks5h?):\/\/)[^\s/@]+@/gi, "$1[REDACTED]@")
  .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
  .replace(/((?:cookie|accessToken|session-token)[^=:\s]*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]")
  .slice(0, 600);

async function profileWindowProbe(browserSession: Session, expectedEmail?: string): Promise<Record<string, unknown>> {
  const window = new BrowserWindow({ show: false, width: 1180, height: 820,
    webPreferences: { session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const navigation: string[] = [];
  const popupUrls: string[] = [];
  const responses: Array<{ url: string; status: number; type: string }> = [];
  const availability: Record<string, unknown> = {};
  const pendingConfig = new Map<string, string>();
  let existingProjectId: string | undefined;
  const safeUrl = (value: string) => { try { const url = new URL(value); return url.protocol === "about:" ? value : url.origin + url.pathname; } catch { return "about:blank"; } };
  // Record only regional/availability flags, never auth responses or full account data.
  const publicFlags = (value: unknown, path = ""): Record<string, unknown> => {
    const flags: Record<string, unknown> = {};
    if (!value || typeof value !== "object") return flags;
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (child && typeof child === "object") Object.assign(flags, publicFlags(child, childPath));
      else if (/country|region|locale|availab|enabled|migration|redirect/i.test(key)
        && (typeof child === "boolean" || typeof child === "number" || (typeof child === "string" && /^[a-zA-Z_-]{1,40}$/.test(child)))) flags[childPath] = child;
    }
    return flags;
  };
  const findProjectId = (value: unknown): string | undefined => {
    if (!value || typeof value !== "object") return undefined;
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:id|projectId)$/i.test(key) && typeof child === "string" && /^[a-f0-9-]{36}$/i.test(child)) return child;
      const nested = findProjectId(child);
      if (nested) return nested;
    }
    return undefined;
  };
  window.webContents.on("did-navigate", (_event, url) => navigation.push(safeUrl(url)));
  window.webContents.on("will-navigate", (event, url) => {
    if (process.argv.includes("--block-new-flow") && /^https:\/\/flow\.google\.com\//.test(url)) {
      navigation.push(`blocked:${safeUrl(url)}`);
      event.preventDefault();
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => { popupUrls.push(safeUrl(url)); return { action: "deny" }; });
  try {
    // Start a real renderer first; DevTools emulation before any frame can stall startup.
    await runFlowStep("blank diagnostic window", 10_000, undefined, () => window.loadURL("about:blank"));
    window.webContents.debugger.attach("1.3");
    window.webContents.debugger.on("message", (_event, method, params) => {
      if (method === "Network.loadingFinished" && pendingConfig.has(params.requestId)) {
        const path = pendingConfig.get(params.requestId)!;
        pendingConfig.delete(params.requestId);
        void window.webContents.debugger.sendCommand("Network.getResponseBody", { requestId: params.requestId }).then((response) => {
          const body = response.base64Encoded ? Buffer.from(response.body, "base64").toString("utf8") : response.body;
          const parsed = JSON.parse(body);
          if (/project\.searchUserProjects$/.test(path)) existingProjectId = findProjectId(parsed);
          else availability[path] = publicFlags(parsed);
        }).catch(() => undefined);
      }
      if (method !== "Network.responseReceived" || !["Document", "XHR", "Fetch"].includes(params.type)) return;
      if (!/^https:\/\/(?:labs\.google|flow\.google\.com)\//.test(params.response.url)) return;
      if (responses.length < 40) responses.push({ url: safeUrl(params.response.url), status: params.response.status, type: params.type });
      const path = new URL(params.response.url).pathname;
      if (/\/(?:general\.fetchToolAvailability|videoFx\.getFlowAppConfig|project\.searchUserProjects)$/.test(path)) pendingConfig.set(params.requestId, path);
    });
    await window.webContents.debugger.sendCommand("Network.enable");
    await runFlowStep("diagnostic profile", 5_000, undefined, async () => {
      if (process.argv.includes("--native-profile")) return;
      await window.webContents.debugger.sendCommand("Emulation.setTimezoneOverride", { timezoneId: process.env.GOLD_WORK_FLOW_QA_TIMEZONE || "America/New_York" });
      await window.webContents.debugger.sendCommand("Emulation.setLocaleOverride", { locale: "en_US" });
    });
    const before = await runFlowStep("profile metadata", 5_000, undefined, () => window.webContents.executeJavaScript(`({language:navigator.language,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,userAgent:navigator.userAgent})`));
    const cookieCounts: Record<string, number> = {};
    for (const host of ["labs.google", "flow.google.com", "accounts.google.com"]) cookieCounts[host] = (await browserSession.cookies.get({ url: "https://" + host + "/" })).length;
    const googleAuthCookieNames = (await browserSession.cookies.get({ url: "https://flow.google.com/" }))
      .map((cookie) => cookie.name).filter((name) => /^(?:SID|HSID|SSID|APISID|SAPISID|__Secure-[13]PSID|__Secure-[13]PAPISID)$/.test(name));
    let createdProject: Record<string, unknown> | undefined;
    if (process.argv.includes("--create-project-route")) {
      const response = await runFlowStep("create route probe project", 45_000, undefined, signal => browserSession.fetch(FLOW_PROJECT_CREATE_URL, {
        method: "POST", credentials: "include", cache: "no-store", signal,
        headers: { Accept: "*/*", "Content-Type": "application/json", Origin: FLOW_ORIGIN, Referer: FLOW_HOME },
        body: JSON.stringify(flowTrpcInput({ projectTitle: "Gold Work Studio route probe", toolName: "PINHOLE" })),
      }));
      const data = await response.json().catch(() => undefined);
      existingProjectId = findProjectId(data);
      createdProject = { status: response.status, projectIdPresent: Boolean(existingProjectId) };
      if (!response.ok || !existingProjectId) throw new Error(`Flow route probe project failed: HTTP ${response.status}`);
    }
    let loadError: string | undefined;
    const entryUrl = process.argv.includes("--create-project-route")
      ? `https://labs.google/fx/project/${existingProjectId}/tools/flow`
      : process.argv.includes("--localized-entry") ? "https://labs.google/fx/ru/tools/flow" : FLOW_HOME;
    await runFlowStep("diagnostic Flow page", 45_000, undefined, () => window.loadURL(entryUrl))
      .catch((error) => { loadError = clean(error); });
    let page: Record<string, unknown> = {};
    let stableUrl = "";
    let stableSince = Date.now();
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      try {
        const evaluated = await runFlowStep("diagnostic page content", 5_000, undefined, () => window.webContents.debugger.sendCommand("Runtime.evaluate", { expression: `({
          href: location.href, text: document.body?.innerText.slice(0, 1000) || '', language: navigator.language,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, userAgent: navigator.userAgent,
          identity: (() => {
            const emails = Object.values(window.WIZ_global_data || {}).filter(v => typeof v === 'string' && /^[^ @]+@[^ @]+\\.[^ @]+$/.test(v));
            return { googleEmailFieldPresent: emails.length > 0, matchesExpectedAccount: emails.some(v => v.toLowerCase() === ${JSON.stringify(expectedEmail?.toLowerCase() ?? "")}) };
          })(),
          readyState: document.readyState, recaptchaReady: typeof window.grecaptcha?.enterprise?.execute === 'function'
        })`, returnByValue: true }));
        if (evaluated.result?.value) page = evaluated.result.value;
        const currentUrl = safeUrl(String(page.href || "about:blank"));
        if (currentUrl !== stableUrl) { stableUrl = currentUrl; stableSince = Date.now(); }
        if (page.text && /unsupported-country/.test(currentUrl)) break;
        if (page.text && page.readyState === "complete" && Date.now() - stableSince > 5_000) break;
      } catch (error) { page.readError = clean(error); }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    let projectRouteProbe: Record<string, unknown> | undefined;
    if (process.argv.includes("--project-route")) {
      const initialUrl = safeUrl(window.webContents.getURL());
      if (!existingProjectId) projectRouteProbe = { existingProjectFound: false, initialUrl };
      else {
        let projectLoadError: string | undefined;
        await runFlowStep("existing Flow project route", 45_000, undefined, () => window.loadURL(`https://labs.google/fx/project/${existingProjectId}/tools/flow`))
          .catch((error) => { projectLoadError = clean(error); });
        const projectDeadline = Date.now() + 35_000;
        let projectPage: Record<string, unknown> = {};
        while (Date.now() < projectDeadline) {
          try {
            const evaluated = await runFlowStep("project route content", 5_000, undefined, () => window.webContents.debugger.sendCommand("Runtime.evaluate", { expression: `({
              href: location.href, text: document.body?.innerText.slice(0, 500) || '', readyState: document.readyState,
              recaptchaReady: typeof window.grecaptcha?.enterprise?.execute === 'function'
            })`, returnByValue: true }));
            if (evaluated.result?.value) projectPage = evaluated.result.value;
            if (projectPage.text && projectPage.readyState === "complete") break;
            if (/unsupported-country/.test(String(projectPage.href || "")) && projectPage.text) break;
          } catch { /* Cross-document transition; poll the next document. */ }
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        const finalUrl = safeUrl(String(projectPage.href || window.webContents.getURL()));
        delete projectPage.href;
        projectRouteProbe = { existingProjectFound: true, initialUrl, finalUrl, loadError: projectLoadError, ...projectPage };
      }
    }
    delete page.href;
    return { before, cookieCounts, googleAuthCookieNames, createdProject, navigation, popupUrls, responses, availability, projectRouteProbe, url: safeUrl(window.webContents.getURL()), route: await browserSession.resolveProxy(window.webContents.getURL()), loadError, ...page };
  } finally { if (!window.isDestroyed()) window.destroy(); }
}

async function transientProfileProbe(source: Session, expectedEmail?: string): Promise<Record<string, unknown>[]> {
  const route = await source.resolveProxy(FLOW_HOME);
  if (!/^PROXY 127\.0\.0\.1:\d+$/.test(route)) throw new Error("Transient probe requires the configured local SOCKS bridge; no direct fallback");
  const cookies = (await source.cookies.get({})).filter((cookie) => {
    const domain = cookie.domain?.replace(/^\./, "") || "";
    return domain === "labs.google" || domain.endsWith(".labs.google") || domain === "google.com" || domain.endsWith(".google.com");
  });
  const reports: Record<string, unknown>[] = [];
  // These sessions are memory-only; do not clear or replace the original profile.
  for (const mode of ["all-cookies", "auth-cookies-only"] as const) {
    const transient = session.fromPartition(`flow-qa-${mode}-${Date.now()}`, { cache: false });
    try {
      await transient.setProxy({ mode: "fixed_servers", proxyRules: `http://${route.slice(6)}`, proxyBypassRules: "<-loopback>" });
      transient.setUserAgent(source.getUserAgent(), "en-US,en");
      transient.setPermissionCheckHandler(() => false);
      transient.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      let copiedCookies = 0;
      for (const cookie of cookies) {
        if (mode === "auth-cookies-only" && !/^(?:__Secure-next-auth\.session-token(?:\.\d+)?|SID|HSID|SSID|APISID|SAPISID|__Secure-[13]PSID(?:TS|CC)?|__Secure-[13]PAPISID|SIDCC|ACCOUNT_CHOOSER|LSID|OSID|__Secure-OSID)$/.test(cookie.name)) continue;
        const host = cookie.domain!.replace(/^\./, "");
        await transient.cookies.set({
          url: `https://${host}${cookie.path || "/"}`, name: cookie.name, value: cookie.value,
          ...(cookie.hostOnly ? {} : { domain: cookie.domain }), path: cookie.path || "/",
          secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite,
          ...(cookie.expirationDate ? { expirationDate: cookie.expirationDate } : {}),
        });
        copiedCookies++;
      }
      const probe = await profileWindowProbe(transient, expectedEmail);
      if (expectedEmail && typeof probe.text === "string") probe.text = probe.text.replaceAll(expectedEmail, "[ACCOUNT]");
      reports.push({ mode, copiedCookies, ...probe });
    } finally {
      await transient.closeAllConnections();
      await transient.clearStorageData();
    }
  }
  return reports;
}

void (async () => {
  await app.whenReady();
  await mkdir(outputPath, { recursive: true });
  const store = new FlowAccountStore(join(dataPath, "credentials", "flow", "accounts.json"));
  const auth = new FlowAuthService(store, () => undefined, () => undefined);
  // Diagnostic A/B only. Not a product setting or a promise of regional eligibility.
  if (process.argv.includes("--diagnose-region") && process.env.GOLD_WORK_FLOW_QA_TIMEZONE) {
    const hooks = auth as unknown as { loadFlowPage(window: BrowserWindow, url: string): Promise<void> };
    const load = hooks.loadFlowPage.bind(auth);
    hooks.loadFlowPage = async (window, url) => {
      if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
      await window.webContents.debugger.sendCommand("Emulation.setTimezoneOverride", { timezoneId: process.env.GOLD_WORK_FLOW_QA_TIMEZONE });
      await window.webContents.debugger.sendCommand("Emulation.setLocaleOverride", { locale: "en_US" });
      await window.webContents.debugger.sendCommand("Emulation.setUserAgentOverride", {
        userAgent: window.webContents.session.getUserAgent(), acceptLanguage: "en-US,en", platform: "Win32",
      });
      await load(window, url);
    };
  }
  const client = new FlowClient(store, auth);
  const accounts = (await store.list()).filter((account) => account.enabled);
  if (accounts.length === 0) throw new Error("No enabled Flow accounts found. No generation performed.");
  const partitions = await Promise.all(accounts.map((account) => store.partition(account.id)));
  if (new Set(partitions).size !== accounts.length) throw new Error("Account partitions are not unique");
  const results: Record<string, unknown>[] = [];
  try {
    if (process.env.GOLD_WORK_FLOW_PROXY) {
      for (const account of accounts) await auth.update(account.id, { proxyUrl: process.env.GOLD_WORK_FLOW_PROXY });
    }
    for (const [index, account] of accounts.entries()) {
      if (process.argv.includes("--first-account") && index > 0) break;
      const result: Record<string, unknown> = { account: index + 1, accountId: account.id, partition: partitions[index] };
      results.push(result);
      try {
        const browserSession = await auth.sessionFor(account.id);
        result.proxyConfigured = Boolean((await store.get(account.id))?.proxyDisplayName);
        result.route = await browserSession.resolveProxy("https://labs.google/fx/tools/flow");
        if (result.proxyConfigured && /DIRECT/.test(String(result.route))) throw new Error("Configured proxy resolved to DIRECT");
        const ipResponse = await browserSession.fetch("https://api.ipify.org?format=json", {
          signal: AbortSignal.timeout(25_000), credentials: "omit",
        });
        if (!ipResponse.ok) throw new Error(`Egress probe HTTP ${ipResponse.status}`);
        result.egressIp = (await ipResponse.json() as { ip: string }).ip;
        const markerUrl = "https://gold-work-isolation.invalid";
        await browserSession.cookies.set({ url: markerUrl, name: "gold-work-isolation-probe", value: account.id, secure: true });
        try {
          for (const other of accounts.filter((candidate) => candidate.id !== account.id)) {
            const otherSession = await auth.sessionFor(other.id);
            const leaked = await otherSession.cookies.get({ url: markerUrl, name: "gold-work-isolation-probe" });
            if (leaked.some((cookie) => cookie.value === account.id)) throw new Error("Cookie isolation probe failed");
          }
          result.cookieIsolation = "passed";
        } finally {
          await browserSession.cookies.remove(markerUrl, "gold-work-isolation-probe");
        }
        const refreshed = await auth.refresh(account.id);
        result.authStatus = refreshed.status;
        result.creditsBefore = refreshed.credits;
        result.sameIdentity = !account.email || account.email === refreshed.email;
        if (!result.sameIdentity) throw new Error("Refreshed account identity changed");
        if (process.argv.includes("--profile-window")) {
          if (generate) throw new Error("Profile diagnostic does not permit generation");
          if (process.argv.includes("--transient-profiles")) result.transientProfiles = await transientProfileProbe(browserSession, refreshed.email);
          else result.profileProbe = await profileWindowProbe(browserSession, refreshed.email);
          // Keep any account identity out of the diagnostic page excerpt.
          for (const known of accounts) {
            const probe = (result.profileProbe || {}) as { text?: string };
            if (known.email && probe.text) probe.text = probe.text.replaceAll(known.email, "[ACCOUNT]");
          }
          result.probeOnly = true;
          console.log(JSON.stringify(result));
          await writeFile(join(outputPath, "report.json"), JSON.stringify({ generate, results }, null, 2));
          continue;
        }
        if (process.argv.includes("--diagnose-region")) {
          await browserSession.clearCache(); // Keep cookies/login intact; exclude stale HTTP redirects.
        }
        await auth.prepareRuntime(account.id);
        result.runtime = "ready";
        if (generate) {
          let job: FlowRemoteImageJob | undefined;
          const image = await client.generateImage({
            accountId: account.id,
            prompt: "Editorial photograph of a well-maintained early-2000s compact passenger car interior, close-up of physical air conditioning knobs and analog dashboard, natural daylight, realistic proportions, landscape composition. No text, no logos, no collage.",
            aspectRatio: "16:9",
            signal: AbortSignal.timeout(180_000),
            onRemoteJob: async (remoteJob) => {
              if (!remoteJob) return;
              job = remoteJob;
              await writeFile(join(outputPath, `account-${index + 1}-job.json`), JSON.stringify(remoteJob, null, 2));
            },
            onProgress: (progress) => { console.log(JSON.stringify({ account: index + 1, stage: clean(progress.stage) })); },
          });
          if (image.length < 1024) throw new Error("Generated image is unexpectedly small");
          result.imagePath = join(outputPath, `account-${index + 1}.png`);
          await writeFile(String(result.imagePath), image);
          result.bytes = image.length;
          result.sha256 = createHash("sha256").update(image).digest("hex");
          if (job) {
            const downloadedAgain = await client.generateImage({
              accountId: account.id, prompt: "", aspectRatio: "16:9", resumeJob: job,
              signal: AbortSignal.timeout(60_000),
            });
            result.resumeSameImage = createHash("sha256").update(downloadedAgain).digest("hex") === result.sha256;
            if (!result.resumeSameImage) throw new Error("Resume returned different image bytes");
          }
          result.generation = "passed";
        }
        result.ok = true;
      } catch (error) {
        result.ok = false;
        result.error = clean(error);
        if (process.argv.includes("--diagnose-region")) {
          const activeSession = await auth.sessionFor(account.id);
          result.pages = await Promise.all(BrowserWindow.getAllWindows()
            .filter((window) => window.webContents.session === activeSession)
            .map(async (window) => {
              const rawUrl = window.webContents.getURL() || "about:blank";
              const location = new URL(rawUrl);
              const page = await runFlowStep("чтение диагностической страницы", 5_000, undefined, () => window.webContents.executeJavaScript(`({
                text: document.body.innerText.slice(0, 1000), language: navigator.language,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
              })`)).catch(() => ({ text: "Page unavailable" }));
              for (const known of accounts) if (known.email) page.text = page.text.replaceAll(known.email, "[ACCOUNT]");
              return { url: location.origin + location.pathname, ...page };
            })).catch((diagnosticError) => [{ diagnosticError: clean(diagnosticError) }]);
        }
        process.exitCode = 1;
      }
      console.log(JSON.stringify(result));
      await writeFile(join(outputPath, "report.json"), JSON.stringify({ generate, results }, null, 2));
    }
  } finally {
    await auth.closeAll();
    app.exit(process.exitCode || 0);
  }
})().catch((error) => { console.error(clean(error)); app.exit(1); });
