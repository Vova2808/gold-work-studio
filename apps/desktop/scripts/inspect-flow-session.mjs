/** Snapshot one explicitly selected encrypted account for a read-only provider diagnostic. */
import { createRequire } from "node:module";
import { mkdtemp, mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";
import { spawn } from "node:child_process";
const require = createRequire(import.meta.url);
const source = join(process.env.APPDATA, "@gold-work", "desktop");
const id = process.argv[2];
const stored = JSON.parse(await readFile(join(source, "credentials/flow/accounts.json"), "utf8"));
const account = stored.accounts.find(item => item.id === id);
if (!account || !/^persist:flow-[a-f0-9-]{36}$/i.test(account.partition)) throw new Error("Select an existing Flow account ID");
const root = await mkdtemp(join(tmpdir(), "gws-flow-session-probe-"));
const network = join(root, "Partitions", account.partition.slice(8), "Network");
await mkdir(network, { recursive: true });
await copyFile(join(source, "Local State"), join(root, "Local State"));
await writeFile(join(root, "accounts.json"), JSON.stringify({ version: 1, accounts: [account] }));
const db = new DatabaseSync(join(source, "Partitions", account.partition.slice(8), "Network", "Cookies"), { readOnly: true });
try { await backup(db, join(network, "Cookies")); } finally { db.close(); }
const directory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(require.resolve("electron-vite"))("esbuild");
const verify = process.argv.includes("--verify-login");
const imageCheck = process.argv.includes("--test-image");
const accessCheck = process.argv.includes("--check-access");
const name = process.argv.includes("--test-video") ? "flow-rpc-video-check" : process.argv.includes("--check-rpc") ? "flow-rpc-check" : accessCheck ? "flow-account-access-check" : imageCheck ? "flow-image-account-check" : verify ? "verify-flow-login" : "inspect-flow-session";
const output = join(directory, `dist/qa/${name}.cjs`);
await build({ entryPoints: [join(directory, `scripts/${name}.ts`)], outfile: output, bundle: true, platform: "node", format: "cjs", external: ["electron"] });
const env = { ...process.env, GWS_FLOW_PROBE_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
const resumeReportArg = process.argv.find(arg => arg.startsWith("--resume-report="));
if (resumeReportArg) env.GWS_FLOW_RESUME_REPORT = resolve(resumeReportArg.slice("--resume-report=".length));
const referenceArg = process.argv.find(arg => arg.startsWith("--reference="));
if (referenceArg) env.GWS_FLOW_TEST_REFERENCE = resolve(referenceArg.slice("--reference=".length));
for (const args of verify && !imageCheck && !accessCheck ? [[], ["--restart"]] : [[]]) {
  const code = await new Promise((resolveCode, reject) => {
    const child = spawn(require("electron"), [output, ...args], { cwd: directory, env, stdio: "inherit", windowsHide: true });
    child.once("error", reject); child.once("exit", resolveCode);
  });
  if (code !== 0) { process.exitCode = code ?? 1; break; }
}
console.log(`PROBE_ROOT=${root}`);
