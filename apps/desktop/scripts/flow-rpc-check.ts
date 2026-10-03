/** Read-only discovery of public model configuration in a copied account profile. */
import { app } from "electron";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { FlowAccountStore } from "../src/flow-account-store.js";
import { FlowAuthService } from "../src/flow-auth-service.js";
import { FLOW_RPC, flowRpcImageMedia } from "../src/flow-rpc.js";
const root = process.env.GWS_FLOW_PROBE_ROOT!;
app.setPath("userData", root);
app.on("window-all-closed", () => undefined);
const deadline = setTimeout(() => app.exit(2), 90_000);
app.whenReady().then(async () => {
  const store = new FlowAccountStore(join(root, "accounts.json"));
  const account = (await store.list())[0]!;
  const auth = new FlowAuthService(store, () => undefined, () => undefined);
  try {
    const verified = await auth.refresh(account.id);
    console.log(JSON.stringify({ status: verified.status, credits: verified.credits }));
    if (verified.status !== "ready") throw new Error("Account not available");
    // Model capabilities are public configuration, not personal/account content.
    if (process.env.GWS_FLOW_RESUME_REPORT) {
      const report = JSON.parse(await readFile(process.env.GWS_FLOW_RESUME_REPORT, "utf8"));
      const media = flowRpcImageMedia(await auth.rpc(account.id, FLOW_RPC.getMedia, [report.remoteJob.mediaName]));
      const url = new URL(media.url!, "https://flow.google.com");
      console.log(JSON.stringify({ mediaName: media.name, host: url.hostname, protocol: url.protocol, pathPrefix: url.pathname.split("/").slice(0, 2).join("/") }));
    } else {
      const models = await auth.rpc(account.id, FLOW_RPC.models, []);
      const config = models[0] as unknown[];
      console.log(JSON.stringify({ imageModels: config[5] }));
    }
  } finally { clearTimeout(deadline); await auth.closeAll(); app.quit(); }
}).catch(error => { console.error(error.message); app.exit(1); });
