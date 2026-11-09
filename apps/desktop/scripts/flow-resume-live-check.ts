/** Live read-only provider QA: resume one existing successful Veo receipt.
 * No generation, image upload, paid retry, user-project write or Lumean request. */
import assert from "node:assert/strict";
import { app } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { FlowAccountStore } from "../src/flow-account-store.js";
import { FlowAuthService } from "../src/flow-auth-service.js";
import { FlowClient, type FlowRemoteVideoJob } from "../src/flow-client.js";
import { mediaDurationSeconds, runFfmpeg } from "../src/standard-renderer.js";

const profile = process.env.GOLD_WORK_FLOW_DATA_PATH!;
assert.ok(profile && /^gws-flow-live-/u.test(basename(profile)), "Use an isolated QA profile");
const receiptPath = resolve(process.env.GW_FLOW_RESUME_JOB ?? "");
assert.ok(receiptPath.startsWith(resolve("captures", "flow-story-live") + "\\")
  && basename(receiptPath) === "veo-job.json", "Use an existing QA receipt, never a user queue");
app.setPath("userData", profile);
app.on("window-all-closed", () => undefined);
app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");
app.commandLine.appendSwitch("disable-quic");
const root = resolve("captures", "flow-resume-live", String(Date.now()));
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const clean = (error: unknown) => String(error instanceof Error ? error.message : error)
  .replace(/(?:https?|socks5h?):\/\/[^\s]+/giu, "[URL]")
  .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]").slice(0, 800);
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(new Error("Resume-only QA deadline")), 120_000);
let auth: FlowAuthService | undefined;
let forbiddenSubmissions = 0;
let statusRequests = 0;
let lastStage = "startup";
app.whenReady().then(async () => {
  await mkdir(root, { recursive: true });
  const receiptBytes = await readFile(receiptPath);
  const job = JSON.parse(receiptBytes.toString("utf8")) as FlowRemoteVideoJob;
  assert.equal(job.provider, "flow");
  assert.ok(job.accountId && job.projectId && job.mediaName && job.modelKey && job.submittedAt);
  const originalPath = join(dirname(receiptPath), "veo.mp4");
  const originalHash = sha(await readFile(originalPath));
  const store = new FlowAccountStore(join(profile, "credentials/flow/accounts.json"));
  auth = new FlowAuthService(store, () => undefined, () => undefined);
  // A second independent guard rejects any fresh generation before reCAPTCHA/upload.
  auth.recaptchaToken = async () => {
    forbiddenSubmissions += 1;
    throw new Error("New submissions forbidden in resume-only QA");
  };
  const flow = new FlowClient(store, auth);
  // Observe the actual provider request, not a mocked response. Only status POST is allowed.
  const guarded = flow as unknown as { postJson: (...args: unknown[]) => Promise<unknown> };
  const originalPost = guarded.postJson.bind(flow);
  guarded.postJson = async (...args) => {
    const url = String(args[1]);
    assert.equal(new URL(url).pathname, "/v1/video:batchCheckAsyncVideoGenerationStatus", "Only existing-job status POST allowed");
    statusRequests += 1;
    return originalPost(...args);
  };
  await auth.refresh(job.accountId);
  const video = await flow.generateVideo({
    accountId: job.accountId, resumeJob: job, prompt: "", aspectRatio: "16:9", durationSeconds: 8,
    signal: controller.signal,
    onBeforeSubmit: async () => { forbiddenSubmissions += 1; throw new Error("Paid submit forbidden"); },
    onProgress: async progress => {
      lastStage = clean(progress.stage);
      if (progress.remoteJob) assert.deepEqual(progress.remoteJob, job, "Resume must retain the original receipt");
      console.log(`[flow-resume-live] ${lastStage}`);
    },
  });
  assert.ok(statusRequests > 0, "A real status request must be observed");
  assert.equal(forbiddenSubmissions, 0);
  assert.equal(sha(video), originalHash, "Resume must download the same existing clip");
  const outputPath = join(root, "resumed-veo.mp4");
  await writeFile(outputPath, video);
  const seconds = await mediaDurationSeconds(outputPath);
  await runFfmpeg(["-v", "error", "-xerror", "-i", outputPath, "-f", "null", "-"]);
  assert.equal(sha(await readFile(receiptPath)), sha(receiptBytes));
  assert.equal(sha(await readFile(originalPath)), originalHash);
  await writeFile(join(root, "result.json"), JSON.stringify({ receiptPath, outputPath, seconds,
    existingClipHash: originalHash, statusRequests, forbiddenSubmissions, newPaidSubmissions: 0,
    originalFilesUnchanged: true, fullDecodePassed: true, realProviderResume: true,
    limitation: "Existing completed job resumed in a fresh process; not a crash during paid submission or fresh TTS E2E." }, null, 2));
  console.log(`[flow-resume-live] PASS existing job resumed, same clip, ${seconds}s, no new submission`);
}).catch(async error => {
  process.exitCode = 1;
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "failure.json"), JSON.stringify({ error: clean(error), lastStage, statusRequests, forbiddenSubmissions }, null, 2));
  console.error(`[flow-resume-live] ${clean(error)}`);
}).finally(async () => { clearTimeout(deadline); await auth?.closeAll(); app.exit(process.exitCode ?? 0); });
