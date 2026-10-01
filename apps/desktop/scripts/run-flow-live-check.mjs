import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

const directory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("electron-vite"))("esbuild");
const script = process.argv.includes("--resume-only") ? "flow-resume-live-check"
  : process.argv.includes("--parallel") ? "flow-parallel-live-check"
  : process.argv.includes("--story") ? "flow-story-live-check" : "flow-live-check";
const output = resolve(directory, `dist/qa/${script}.cjs`);
await build({
  entryPoints: [resolve(directory, `scripts/${script}.ts`)],
  outfile: output, bundle: true, platform: "node", format: "cjs",
  external: ["electron", "ffmpeg-static"],
});
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
// Run while the user's app is open without sharing its Chromium cookie database.
// Session restoration uses only the app's existing encrypted credentials. This is
// not a full-profile test: a Google login needed by the new route may be absent.
if (process.argv.includes("--isolated-copy")) {
  const source = childEnv.GOLD_WORK_FLOW_DATA_PATH || resolve(process.env.APPDATA, "@gold-work/desktop");
  const isolated = await mkdtemp(resolve(tmpdir(), "gws-flow-live-"));
  await mkdir(resolve(isolated, "credentials/flow"), { recursive: true });
  await copyFile(resolve(source, "Local State"), resolve(isolated, "Local State"));
  await copyFile(resolve(source, "credentials/flow/accounts.json"), resolve(isolated, "credentials/flow/accounts.json"));
  childEnv.GOLD_WORK_FLOW_DATA_PATH = isolated;
  delete childEnv.GOLD_WORK_FLOW_PROXY;
  console.log("[flow-live] Isolated encrypted credential copy; production cookies and settings untouched.");
}
const binary = process.env.GOLD_WORK_FLOW_ELECTRON_BINARY || require("electron");
if (process.env.GOLD_WORK_FLOW_ELECTRON_BINARY && !process.env.GOLD_WORK_FLOW_DATA_PATH) {
  throw new Error("An alternate engine requires a separate copied QA profile");
}
const child = spawn(binary, [output, ...process.argv.slice(2)], {
  cwd: resolve(directory, "../.."), env: childEnv, stdio: "inherit", windowsHide: true,
});
child.once("error", () => { console.error("Unable to start Electron Flow diagnostics"); process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
