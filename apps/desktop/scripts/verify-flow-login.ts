/** Real read-only login/refresh acceptance in a disposable encrypted profile copy. */
import { app, type BrowserWindow } from "electron";
import { join } from "node:path";
import assert from "node:assert/strict";
import { FlowAccountStore } from "../src/flow-account-store.js";
import { FlowAuthService } from "../src/flow-auth-service.js";
import { FlowClient } from "../src/flow-client.js";
const root = process.env.GWS_FLOW_PROBE_ROOT!;
app.setPath("userData", root);
app.on("window-all-closed", () => undefined);
const deadline = setTimeout(() => { console.error("Flow login verification exceeded 60s"); app.exit(2); }, 60_000);
app.whenReady().then(async () => {
  const store = new FlowAccountStore(join(root, "accounts.json"));
  const account = (await store.list())[0]!;
  const auth = new FlowAuthService(store, () => undefined, () => undefined);
  const restart = process.argv.includes("--restart");
  let loginWindow: BrowserWindow | undefined;
  const factory = (auth as any).createAuthWindow.bind(auth);
  (auth as any).createAuthWindow = (id: string, partition: string) => {
    const window = factory(id, partition, false);
    if (!restart) loginWindow = window;
    return window;
  };
  const result = restart ? await auth.refresh(account.id) : await auth.login({ accountId: account.id });
  assert.equal(result.status, "ready");
  assert.ok(result.email);
  assert.equal((await store.secret(account.id)).sessionOrigin, "https://flow.google.com");
  if (!restart) {
    const until = Date.now() + 4000;
    while (loginWindow && !loginWindow.isDestroyed() && Date.now() < until) await new Promise(r => setTimeout(r, 100));
    assert.ok(loginWindow?.isDestroyed(), "login window must close automatically after confirmation");
  }
  const client = new FlowClient(store, auth);
  for (let check = 0; check < 2; check++) {
    const tested = await client.test(account.id);
    assert.equal(tested.ok, true, tested.message);
  }
  console.log(JSON.stringify({ phase: restart ? "fresh-electron-process-refresh" : "login-auto-close", status: result.status, hasEmail: !!result.email, credits: result.credits, repeatedSessionAndModelChecks: 2, liveReadOnly: true }));
  await auth.closeAll(); clearTimeout(deadline); app.quit();
}).catch(error => { console.error(error.message); clearTimeout(deadline); app.exit(1); });
