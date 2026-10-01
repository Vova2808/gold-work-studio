/** One authorized image-to-video test. Always persist receipt; never auto-resubmit. */
import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FlowAccountStore } from "../src/flow-account-store.js";
import { FlowAuthService } from "../src/flow-auth-service.js";
import { FlowClient } from "../src/flow-client.js";
const root = process.env.GWS_FLOW_PROBE_ROOT!;
app.setPath("userData", root);
app.on("window-all-closed", () => undefined);
const deadline = setTimeout(() => app.exit(2), 9 * 60_000);
app.whenReady().then(async () => {
  const store = new FlowAccountStore(join(root, "accounts.json"));
  const account = (await store.list())[0]!;
  const auth = new FlowAuthService(store, () => undefined, () => undefined);
  const output = join(root, "video-check"); await mkdir(output, { recursive: true });
  const report: Record<string, unknown> = { accountId: account.id, submissions: 0, videoCreated: false };
  const save = () => writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  try {
    const verified = await auth.refresh(account.id);
    if (verified.status !== "ready") throw new Error("Flow account not ready");
    const previous = process.env.GWS_FLOW_RESUME_REPORT ? JSON.parse(await readFile(process.env.GWS_FLOW_RESUME_REPORT, "utf8")) : undefined;
    const reference = process.env.GWS_FLOW_TEST_REFERENCE;
    if (!previous && !reference) throw new Error("One reference is required");
    if (previous && (!previous.remoteJob || previous.remoteJob.accountId !== account.id)) throw new Error("Resume receipt required");
    const bytes = await new FlowClient(store, auth).generateVideo({ accountId: account.id, aspectRatio: "16:9", durationSeconds: 8,
      model: "veo_3_1_i2v_s_fast", startFrame: reference ? await readFile(reference) : undefined,
      prompt: "A very slow camera push-in toward the blue ceramic teapot. Keep the teapot completely unchanged and stationary. No people, no text.",
      resumeJob: previous?.remoteJob, signal: AbortSignal.timeout(7 * 60_000),
      onBeforeSubmit: async () => { if (previous || Number(report.submissions) > 0) throw new Error("No repeat submission allowed"); report.submissions = 1; await save(); },
      onSubmitRejected: async () => { report.rejected = true; await save(); },
      onRemoteJob: async job => { report.remoteJob = job; await save(); },
      onProgress: async progress => { if (progress.remoteJob) report.remoteJob = progress.remoteJob; console.log(progress.stage); await save(); },
    });
    await writeFile(join(output, "app-video.mp4"), bytes); report.videoCreated = true;
  } catch (error) { report.error = error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[url]") : "Video failed"; process.exitCode = 1; }
  finally { await save(); console.log(JSON.stringify(report)); clearTimeout(deadline); await auth.closeAll(); app.quit(); }
}).catch(error => { console.error(error.message); app.exit(1); });
