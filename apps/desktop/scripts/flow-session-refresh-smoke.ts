/** Actual Electron windows, isolated storage and a synthetic HTTPS Flow page. No real accounts/network. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, session, type BrowserWindow } from "electron";
import { FlowAccountStore } from "../src/flow-account-store.js";
import { FlowAuthService } from "../src/flow-auth-service.js";
const root = mkdtempSync(join(tmpdir(), "gws-flow-refresh-"));
app.setPath("userData", root);
app.on("window-all-closed", () => undefined);
const deadline = setTimeout(() => { console.error("FLOW_REFRESH_TIMEOUT"); app.exit(2); }, 40_000);
app.whenReady().then(async () => {
  const store = new FlowAccountStore(join(root, "accounts.json"));
  const account = await store.ensure({ label: "Synthetic Flow" });
  await store.updateSession(account.id, { status: "ready", sessionOrigin: "https://flow.google.com" });
  let signedIn = false, pages = 0, rpcCalls = 0, available = true;
  const browserSession = session.fromPartition(await store.partition(account.id));
  await browserSession.protocol.handle("https", request => {
    const url = new URL(request.url);
    assert.equal(url.origin, "https://flow.google.com", "No external network allowed");
    if (url.pathname.includes("batchexecute")) {
      rpcCalls++;
      if (!signedIn) return new Response("", { status: 401 });
      return new Response(`)]}'\n\n${JSON.stringify([
        ["wrb.fr", "nzlxg", "[50,3]"], ["wrb.fr", "KV2T2d", available ? "[1]" : "[4]"], ["wrb.fr", "cPZSdc", "[]"],
      ])}\n`, { headers: { "Content-Type": "application/json" } });
    }
    pages++;
    return new Response(`<html><script>window.WIZ_global_data=${JSON.stringify(signedIn ? { oPEP7c: "synthetic@example.test", SNlM0e: "synthetic-test-token" } : {})}</script><body>Flow fixture</body></html>`,
      { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } });
  });
  const auth = new FlowAuthService(store, () => undefined, () => undefined);
  const factory = (auth as any).createAuthWindow.bind(auth);
  (auth as any).createAuthWindow = (id: string, partition: string) => factory(id, partition, false);
  try {
    await assert.rejects(auth.refresh(account.id), /Войдите в Google/);
    signedIn = true;
    assert.equal((await auth.login({ accountId: account.id })).status, "ready");
    while ((auth as any).loginWindows.size) await new Promise(resolve => setTimeout(resolve, 50));
    // The hidden window still contains the pre-login document, although the visible login succeeded.
    assert.equal((await auth.refresh(account.id)).status, "ready", "Login then refresh must not reuse a logged-out hidden document");
    const runtime = (auth as any).runtimeWindows.get(account.id) as BrowserWindow;
    await runtime.webContents.executeJavaScript("window.WIZ_global_data = {};");
    const beforeRecovery = pages;
    await Promise.all([auth.refresh(account.id), auth.refresh(account.id)]);
    assert.equal(pages - beforeRecovery, 1, "Concurrent checks share a single read-only page reload");
    available = false;
    const beforeRefusal = pages;
    await assert.rejects(auth.refresh(account.id), /unavailable/);
    assert.equal((await store.get(account.id))?.status, "needs_user_action");
    assert.equal(pages, beforeRefusal, "An explicit access refusal must not be retried");
    available = true; signedIn = false;
    const beforeLogout = pages;
    await assert.rejects(auth.refresh(account.id), /Войдите в Google/);
    assert.equal(pages - beforeLogout, 1, "A real logout is checked once, not retried forever");
    assert.equal((await store.get(account.id))?.status, "needs_login");
    assert.equal((await store.list()).length, 1, "Failed refresh never deletes the account");
    console.log("FLOW_SESSION_REFRESH_OK", JSON.stringify({ pages, rpcCalls, paidRequests: 0, isolated: true }));
  } finally { await auth.closeAll(); clearTimeout(deadline); }
  app.quit();
}).catch(error => { console.error(error); clearTimeout(deadline); app.exit(1); });
