/** User-authorized single-image probe on one copied profile; never rotates accounts or repeats submissions. */
import { app, BrowserWindow } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FlowAccountStore } from "../src/flow-account-store.js";
import { FlowAuthService } from "../src/flow-auth-service.js";
import { FlowClient } from "../src/flow-client.js";
const root = process.env.GWS_FLOW_PROBE_ROOT!;
if (!root) throw new Error("A copied probe profile is required");
app.setPath("userData", root);
app.on("window-all-closed", () => undefined);
const deadline = setTimeout(() => { console.error("Flow image probe timed out; no automatic retry"); app.exit(2); }, 15 * 60_000);
app.whenReady().then(async () => {
  const store = new FlowAccountStore(join(root, "accounts.json"));
  const account = (await store.list())[0]!;
  const auth = new FlowAuthService(store, () => undefined, () => undefined);
  const client = new FlowClient(store, auth);
  const output = join(root, "image-check");
  await mkdir(output, { recursive: true });
  const report: Record<string, unknown> = { accountId: account.id, paidSubmissions: 0, appImageCreated: false };
  const save = async () => { await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2)); };
  const shutdown = async () => { clearTimeout(deadline); await auth.closeAll(); app.quit(); };
  try {
    const verified = await auth.refresh(account.id);
    report.status = verified.status; report.hasEmail = !!verified.email; report.credits = verified.credits;
    if (verified.status !== "ready") throw new Error(verified.lastError ?? "Flow access not confirmed");
    const previous = process.env.GWS_FLOW_RESUME_REPORT ? JSON.parse(await readFile(process.env.GWS_FLOW_RESUME_REPORT, "utf8")) : undefined;
    const reference = process.env.GWS_FLOW_TEST_REFERENCE ? await readFile(process.env.GWS_FLOW_TEST_REFERENCE) : undefined;
    if (previous && (!previous.remoteJob || previous.remoteJob.accountId !== account.id)) throw new Error("Expected an existing job on this account");
    try {
      const bytes = await client.generateImage({ accountId: account.id, aspectRatio: "16:9",
        resumeJob: previous?.remoteJob,
        references: reference ? [reference] : undefined,
        prompt: reference ? "Keep the exact blue ceramic teapot from the reference image, same rounded body, curved handle, lid and glaze. Place it alone on a plain red table with a pale gray background, studio product photograph. No cup, no plants, no window, no text, no logos." : "A small blue ceramic teapot on a wooden table beside a sunlit window, a single still life photograph, no text, no logos.",
        signal: AbortSignal.timeout(180_000),
        onBeforeSubmit: async () => { if (previous) throw new Error("Resume must not submit"); report.paidSubmissions = Number(report.paidSubmissions) + 1; await save(); },
        onRemoteJob: async job => { report.remoteJob = job; await save(); },
        onProgress: async progress => { if (progress.remoteJob) report.remoteJob = progress.remoteJob; console.log(progress.stage); await save(); },
      });
      await writeFile(join(output, "app-image.png"), bytes);
      report.appImageCreated = true; await save();
      console.log(JSON.stringify(report)); await shutdown(); return;
    } catch (error) {
      const modern = (await store.secret(account.id)).sessionOrigin === "https://flow.google.com";
      if (!modern || Number(report.paidSubmissions) !== 0 || !String(error).includes("новый Google RPC")) throw error;
      report.appBlocker = "modern-protocol-not-implemented";
      await save(); console.log(JSON.stringify(report));
    }
    // Separate manual-browser acceptance. UI inputs are performed by the Computer Use tool.
    const existing = new Set(BrowserWindow.getAllWindows().map(w => w.id));
    await auth.open(account.id);
    const opened = BrowserWindow.getAllWindows().filter(w => !existing.has(w.id));
    if (opened.length !== 1) throw new Error(`Expected one new Flow window, got ${opened.length}`);
    opened[0]!.setTitle("Flow — тест одной картинки");
    opened[0]!.show();
    opened[0]!.on("closed", () => { void shutdown(); });
    console.log("FLOW_UI_READY — one image only; close this Flow window to finish. Result directory: " + output);
  } catch (error) {
    report.error = error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[url]") : "Flow check failed";
    await save(); console.log(JSON.stringify(report)); await shutdown(); process.exitCode = 1;
  }
}).catch(() => { console.error("Flow image probe initialization failed"); clearTimeout(deadline); app.exit(1); });
