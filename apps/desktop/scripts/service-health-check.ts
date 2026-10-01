/** Read-only authenticated health checks. No generation, credential writes, or production cookie sessions. */
import { app } from "electron";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnyModelStore } from "../src/anymodel-store.js";
import { AnyModelClient } from "../src/anymodel-client.js";
import { VoicerStore } from "../src/voicer-store.js";
import { VoicerClient } from "../src/voicer-client.js";

const sourceProfile = join(process.env.APPDATA!, "@gold-work", "desktop");
const diagnosticProfile = mkdtempSync(join(tmpdir(), "gws-health-"));
// Chromium safeStorage uses this encrypted key. Copy it, never open the production cookie/cache databases.
copyFileSync(join(sourceProfile, "Local State"), join(diagnosticProfile, "Local State"));
app.setPath("userData", diagnosticProfile);
app.on("window-all-closed", () => undefined);
const deadline = setTimeout(() => { console.error("[service-health] bounded diagnostic timeout"); app.exit(2); }, 45_000);
const clean = (value: unknown) => String(value instanceof Error ? value.message : value)
  .replace(/(?:https?|socks5h?):\/\/[^\s]+/gi, "[URL]").replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]").slice(0, 300);
app.whenReady().then(async () => {
  const root = join(process.env.APPDATA!, "@gold-work", "desktop", "credentials");
  const anymodel = new AnyModelClient(new AnyModelStore(join(root, "anymodel.json")));
  const lumeanStore = new VoicerStore(join(root, "voicer.json"));
  const lumean = new VoicerClient(lumeanStore, {requestTimeoutMs:12_000, responseBodyTimeoutMs:8_000, safeRetryAttempts:1});
  await Promise.allSettled([
    (async () => {
      const result = await anymodel.test();
      console.log(JSON.stringify({service:"AnyModel", readOnly:true, ok:result.ok, message:clean(result.message)}));
    })(),
    (async () => {
      const settings = await lumeanStore.publicSettings();
      try {
        const templates = await lumean.templates();
        console.log(JSON.stringify({service:"Lumean", readOnly:true, ok:true, proxyConfigured:settings.proxyConfigured, templates:templates.length}));
      } catch (error) {
        console.log(JSON.stringify({service:"Lumean", readOnly:true, ok:false, proxyConfigured:settings.proxyConfigured, error:clean(error)}));
      }
    })(),
  ]);
  clearTimeout(deadline);
  app.quit();
}).catch(error => { console.error(clean(error)); clearTimeout(deadline); app.exit(1); });
