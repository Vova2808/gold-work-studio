/** Checks current Flow access on one copied profile; no generation, no region/proxy changes. */
import { app } from "electron";
import { join } from "node:path";
import { FlowAccountStore } from "../src/flow-account-store.js";
import { FlowAuthService } from "../src/flow-auth-service.js";
const root = process.env.GWS_FLOW_PROBE_ROOT!;
if (!root) throw new Error("A copied profile is required");
app.setPath("userData", root);
app.on("window-all-closed", () => undefined);
const deadline = setTimeout(() => { console.error("Flow access check exceeded 60s"); app.exit(2); }, 60_000);
app.whenReady().then(async () => {
  const store = new FlowAccountStore(join(root, "accounts.json"));
  const account = (await store.list())[0]!;
  const auth = new FlowAuthService(store, () => undefined, () => undefined);
  try {
    // Explicitly inspect the current frontend, rather than a stale legacy NextAuth token.
    const result = await (auth as any).refreshBrowserSession(account.id);
    console.log(JSON.stringify({ accountId: account.id, status: result.status, hasEmail: !!result.email, credits: result.credits, readOnly: true }));
  } catch (error) {
    const result = await store.get(account.id);
    console.log(JSON.stringify({ accountId: account.id, status: result?.status, readOnly: true,
      error: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[url]") : "Flow access check failed" }));
  } finally { clearTimeout(deadline); await auth.closeAll(); app.quit(); }
}).catch(() => { clearTimeout(deadline); app.exit(1); });
