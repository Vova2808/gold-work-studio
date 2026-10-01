/** Offline Electron regression: real encrypted store/cookies, synthetic login and API. No user profile/network. */
import { app, session } from "electron";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowAccountStore } from "../src/flow-account-store.js";
import { FlowAuthService } from "../src/flow-auth-service.js";

const root = mkdtempSync(join(tmpdir(), "gws-flow-auth-smoke-"));
app.setPath("userData", root);
app.on("window-all-closed", () => undefined);
const timeout = setTimeout(() => { console.error("flow-auth-smoke timed out"); app.exit(1); }, 30_000);
let browserResult: unknown = { loginRequired: true };
let requests = 0;

class LoginWindow extends EventEmitter {
  destroyed = false;
  webContents = Object.assign(new EventEmitter(), {
    getURL: () => "https://flow.google.com/project/test", isDestroyed: () => this.destroyed,
    executeJavaScript: async (script: string) => { assert.ok(script.includes("nzlxg,KV2T2d,cPZSdc")); requests++; return browserResult; },
  });
  isDestroyed() { return this.destroyed; }
  close() { this.destroyed = true; this.emit("closed"); }
}

app.whenReady().then(async () => {
  const storePath = join(root, "accounts.json");
  const store = new FlowAccountStore(storePath);
  const service = new FlowAuthService(store, () => undefined, () => undefined);
  // Isolate only provider/window I/O; exercise real login, list, refresh and store.
  const internal = service as any;
  internal.configureProxy = async () => undefined;
  internal.loadFlowPage = async (window: LoginWindow) => { window.webContents.emit("did-navigate"); };
  internal.runtimeWindow = async () => new LoginWindow();
  let window = new LoginWindow();
  internal.createAuthWindow = () => window;
  const account = await store.ensure({ proxyUrl: "socks5://test-user:test-pass@127.0.0.1:1234" });
  const browser = session.fromPartition(await store.partition(account.id));
  await browser.cookies.set({ url: "https://flow.google.com", name: "synthetic-flow-cookie", value: "test-cookie", secure: true });
  await store.updateSession(account.id, { status: "needs_login", lastError: "Окно входа Flow закрыто до завершения авторизации" });
  assert.equal((await service.list()).length, 1);
  assert.equal((await browser.cookies.get({ name: "synthetic-flow-cookie" })).length, 1);
  assert.ok((await store.secret(account.id)).proxyUrl);
  console.log("PASS list never deletes incomplete accounts or cookies");

  const login = service.login({ accountId: account.id });
  const rejected = assert.rejects(login, /сохранены/);
  while (!internal.loginWindows.has(account.id)) await new Promise(r => setTimeout(r, 5));
  window.close();
  await rejected;
  assert.equal((await service.list()).length, 1);
  assert.equal((await new FlowAccountStore(storePath).get(account.id))?.status, "needs_login");
  assert.equal((await browser.cookies.get({ name: "synthetic-flow-cookie" })).length, 1);
  console.log("PASS closing incomplete login preserves account across store reload");

  // Browser identity alone is insufficient: all three read-only RPC checks must pass.
  await store.updateSession(account.id, { status: "needs_login", sessionOrigin: "https://flow.google.com", accessToken: "obsolete-token", tokenExpiresAt: "2099-01-01T00:00:00Z", sessionExpiresAt: "2099-01-01T00:00:00Z" });
  browserResult = { status: 200, email: "synthetic@example.test", body: JSON.stringify([
    ["wrb.fr","nzlxg", "[77,3]"], ["wrb.fr","KV2T2d", "[1]"], ["wrb.fr","cPZSdc", "[]"],
  ]) };
  requests = 0;
  const ready = await service.refresh(account.id);
  assert.equal(ready.status, "ready");
  assert.equal(ready.credits, 77);
  assert.equal(requests, 1);
  assert.equal((await new FlowAccountStore(storePath).secret(account.id)).sessionOrigin, "https://flow.google.com");
  assert.equal(ready.tokenExpiresAt, undefined);
  assert.equal(ready.sessionExpiresAt, undefined);
  assert.equal((await store.secret(account.id)).accessToken, undefined);
  await store.update(account.id, { enabled: false });
  assert.equal((await store.update(account.id, { enabled: true })).status, "ready");
  const direct = await store.ensure({});
  await store.updateSession(direct.id, { status: "ready", sessionOrigin: "https://flow.google.com" });
  assert.equal((await new FlowAccountStore(storePath).secret(direct.id)).sessionOrigin, "https://flow.google.com", "protocol persists without proxy or legacy bearer");
  await store.remove(direct.id);
  console.log("PASS modern RPC session confirms API access and persists protocol");

  window = new LoginWindow();
  const secondLogin = service.login({ accountId: account.id });
  while (!internal.loginWindows.has(account.id)) await new Promise(r => setTimeout(r, 5));
  window.close();
  assert.equal((await secondLogin).status, "ready");
  console.log("PASS close at the end of login confirms the arrived session instead of cancellation");

  await store.updateSession(account.id, { status: "needs_login" });
  browserResult = { status: 403 };
  await assert.rejects(service.refresh(account.id), /403/);
  assert.equal((await store.get(account.id))?.status, "error");
  assert.equal((await service.list()).length, 1);
  console.log("PASS refused API never marks a session ready or deletes the account");
  clearTimeout(timeout);
  await service.closeAll();
  app.quit();
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
