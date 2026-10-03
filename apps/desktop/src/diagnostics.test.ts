import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConsoleLogEntry, DesktopApi } from "@gold-work/shared";
import { diagnoseFailure, ipcDiagnosticContext, observeNetwork, setDiagnosticSink, withDiagnosticContext } from "./diagnostics.js";
import { TextFileLogger } from "./text-file-logger.js";
import { collectStartupHealth, createHealthMonitor, type HealthItem } from "../../renderer/src/startup-health.js";

test("logs retain nested network cause in live and disk history while protecting secrets", async t => {
  const dir = await mkdtemp(join(tmpdir(), "gws-diagnostics-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entries: ConsoleLogEntry[] = [];
  const logger = new TextFileLogger(join(dir, "log.txt"), e => entries.push(e), { buildId: "qa-build" });
  const cause = Object.assign(new Error("socket closed"), { code: "ECONNRESET", status: 502 });
  const error = new Error('fetch failed https://test:userpass@api.test/a?signature=secret-url Bearer secret-bearer', { cause: new AggregateError([cause], "all connections failed") });
  await withDiagnosticContext({ operationId: "op-qa", projectId: "project_a" }, () => logger.write("error", "ipc.failed", {
    error, apiKey: "private-key", prompt: "private-prompt", messages: [{ content: "private-chat" }],
    raw: 'Authorization: "private-auth" password=private-pass', payload: Buffer.from("private-binary"),
  }));
  const history = await logger.readRecent();
  assert.deepEqual(history, entries);
  const entry = history[0]!;
  assert.equal(entry.details?.operationId, "op-qa");
  assert.equal(entry.details?.buildId, "qa-build");
  assert.match(JSON.stringify(entry.details?.error), /fetch failed.*ECONNRESET/);
  const file = await readFile(logger.path, "utf8");
  for (const secret of ["userpass", "secret-url", "secret-bearer", "private-key", "private-prompt", "private-chat", "private-auth", "private-pass", "private-binary"]) assert.ok(!file.includes(secret), secret);
  assert.equal((entry.details?.diagnostic as { category: string }).category, "network");
});

test("logger keeps bounded rotated history and handles circular causes", async t => {
  const dir = await mkdtemp(join(tmpdir(), "gws-rotation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const logger = new TextFileLogger(join(dir, "log.txt"), undefined, { maxFileSizeBytes: 1 });
  for (let i = 0; i < 7; i++) await logger.write("info", `event-${i}`);
  assert.equal((await readdir(dir)).length, 4);
  assert.deepEqual((await logger.readRecent()).map(e => e.message), ["event-3", "event-4", "event-5", "event-6"]);
  const e = new Error("circular"); (e as Error & { cause: unknown }).cause = e;
  await logger.write("error", "circular", { error: e });
  assert.match(JSON.stringify((await logger.readRecent(1))[0]), /\[circular\]/);
});

test("concurrent operations retain separate IDs, timing and no sensitive URL data; response body is untouched", async t => {
  const dir = await mkdtemp(join(tmpdir(), "gws-network-log-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  t.after(() => setDiagnosticSink());
  const entries: ConsoleLogEntry[] = [];
  const logger = new TextFileLogger(join(dir, "log.txt"), e => entries.push(e));
  setDiagnosticSink((level, event, details) => { void logger.write(level, event, details); });
  let release!: () => void;
  const response = new Response("still-readable");
  const slow = withDiagnosticContext({ operationId: "slow" }, () => observeNetwork("https://a.test/path?key=private", "POST", "proxy", async () => { await new Promise<void>(r => { release = r; }); return response; }));
  const fast = withDiagnosticContext({ operationId: "fast" }, () => observeNetwork("https://b.test/", "GET", "system", async () => new Response("limited", { status: 429 })));
  await fast; release();
  assert.equal(await slow, response);
  assert.equal(response.bodyUsed, false);
  assert.equal(await response.text(), "still-readable");
  const failure = Object.assign(new Error("fetch failed"), { cause: { code: "ETIMEDOUT" } });
  await assert.rejects(observeNetwork("https://c.test", "GET", "system", async () => { throw failure; }), e => e === failure);
  await logger.flush();
  assert.ok(entries.filter(e => e.details?.host === "a.test").every(e => e.details?.operationId === "slow"));
  assert.ok(entries.filter(e => e.details?.host === "b.test").every(e => e.details?.operationId === "fast"));
  assert.ok(entries.some(e => e.message === "network.failed"));
  assert.ok(!JSON.stringify(entries).includes("private"));
  assert.ok(entries.filter(e => e.message === "network.response").every(e => typeof e.details?.elapsedMs === "number"));
});

test("diagnosis distinguishes uncertain submission, truncated output, DNS and quota; IPC IDs are allowlisted", () => {
  assert.equal(diagnoseFailure(new Error("AnyModelCompletionUncertainError fetch failed")).category, "uncertain-submission");
  assert.equal(diagnoseFailure(new Error("AnyModelOutputFormatError лимит токенов finish_reason length")).category, "response-format");
  assert.equal(diagnoseFailure(new Error("fetch failed", { cause: { code: "ENOTFOUND" } })).category, "dns");
  assert.equal(diagnoseFailure({ status: 429 }).category, "quota");
  assert.equal(ipcDiagnosticContext("projects:apply-chat-topic", ["project_1", "topic_2"]).topicId, "topic_2");
  assert.equal(ipcDiagnosticContext("flow:test", ["account-id-1"]).accountId, "account-id-1");
  assert.equal(diagnoseFailure({ name: "FlowLoginRequiredError", code: "FLOW_LOGIN_REQUIRED" }).category, "authentication");
  assert.equal(diagnoseFailure("Войдите в Google в открытом окне Flow.").category, "authentication");
  assert.equal(diagnoseFailure({ name: "FlowBrowserStateError", code: "FLOW_BROWSER_STATE_MISSING" }).category, "browser-session");
  assert.ok(!JSON.stringify(ipcDiagnosticContext("projects:create", ["private script here"])).includes("private script"));
});

function healthApi(overrides: Partial<DesktopApi> = {}) {
  const calls: string[] = [];
  const source = {
    getAppInfo: async () => ({ buildId: "qa", ffmpegAvailable: true }),
    getStockSettings: async () => ({ pexelsConfigured: true, pixabayConfigured: true }),
    getAnyModelSettings: async () => ({ configured: true }), getVoicerSettings: async () => ({ configured: true }),
    getGoogleSettings: async () => ({ configured: false }), getYouTubeSettings: async () => ({ configured: false }),
    listFlowAccounts: async () => [{ id: "a", enabled: true }],
    refreshAllFlowAccounts: async () => [{ id: "a", enabled: true, status: "ready" }],
    testAnyModelConnection: async () => ({ ok: true, message: "API accepted" }),
    testVoicerConnection: async () => ({ ok: true, message: "API accepted" }),
    testStockConnection: async () => ({ ok: true, message: "API accepted" }),
    writeLog: async () => undefined,
    ...overrides,
  };
  const api = new Proxy(source, { get(target, key) { const fn = target[key as keyof typeof target];
    if (typeof fn !== "function") throw new Error(`Unexpected (possibly paid) API: ${String(key)}`);
    return (...args: unknown[]) => { calls.push(String(key)); return (fn as (...a: unknown[]) => unknown)(...args); };
  } }) as unknown as DesktopApi;
  return { api, calls };
}

test("startup publishes partial progress; settings failure is error, not unconfigured; StrictMode does not repeat checks", async () => {
  let release!: (v: { ok: boolean; message: string }) => void;
  const { api, calls } = healthApi({ testAnyModelConnection: () => new Promise(r => { release = r; }),
    getVoicerSettings: async () => { throw new Error("Cannot read credentials file"); } });
  const monitor = createHealthMonitor(api, "qa");
  let items: HealthItem[] = [];
  const off = monitor.subscribe(v => { items = v; });
  const run = monitor.run();
  assert.equal(monitor.run(), run);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(items.find(i => i.id === "anymodel")?.tone, "checking");
  assert.equal(items.find(i => i.id === "assembly")?.tone, "ok");
  assert.equal(items.find(i => i.id === "lumean")?.tone, "error");
  off(); monitor.subscribe(v => { items = v; });
  release({ ok: true, message: "API accepted" }); await run; await monitor.run();
  assert.equal(items.length, 9); assert.ok(items.every(i => i.tone !== "checking"));
  assert.equal(calls.filter(c => c === "getAppInfo").length, 1);
  assert.equal(calls.filter(c => c === "testAnyModelConnection").length, 1);
  assert.equal(calls.filter(c => c === "testVoicerConnection").length, 0);
  assert.equal(calls.filter(c => c === "refreshAllFlowAccounts").length, 0, 'Stock startup does not open Flow browsers');
  const refreshed=monitor.run(true);
  await new Promise(r=>setTimeout(r,5));release({ok:true,message:'API accepted'});await refreshed;
  assert.equal(calls.filter(c => c === "refreshAllFlowAccounts").length, 1, 'Explicit refresh still checks Flow sessions');
});

test("startup bounds hanging checks, isolates stocks and reports build mismatch and partial Flow", async () => {
  const { api } = healthApi({ testAnyModelConnection: () => new Promise(() => {}),
    testStockConnection: async p => { if (p === "pexels") throw new Error("fetch failed"); return { provider: p, ok: true, message: "ok", status: { configured: true, provider: p, state: "working" } }; },
    listFlowAccounts: async () => [{ enabled: true }, { enabled: true }] as never,
    refreshAllFlowAccounts: async () => [{ enabled: true, status: "ready" }, { enabled: true, status: "error", lastError: "needs login" }] as never });
  const items: HealthItem[] = [];
  await collectStartupHealth(api, "other-build", i => items.push(i), 15, true);
  assert.equal(items.find(i => i.id === "anymodel")?.tone, "error");
  assert.match(items.find(i => i.id === "anymodel")!.message, /0.015 с/);
  assert.equal(items.find(i => i.id === "pexels")?.tone, "error");
  assert.equal(items.find(i => i.id === "pixabay")?.tone, "ok");
  assert.equal(items.find(i => i.id === "flow")?.tone, "warning");
  assert.equal(items.find(i => i.id === "build")?.tone, "error");
});
