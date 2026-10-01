/** Compare Chromium engines without migrating production credentials/cookie databases.
 * Close Gold first. Temporary copies remain encrypted; no generation is permitted.
 */
import { createRequire } from "node:module";
import { mkdtemp, mkdir, copyFile, cp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const electronRequire = createRequire(require.resolve("electron"));
const { downloadArtifact } = electronRequire("@electron/get");
const extract = electronRequire("extract-zip");
const source = join(process.env.APPDATA, "@gold-work", "desktop");
const temporaryRoot = await mkdtemp(join(tmpdir(), "gold-work-flow-engine-"));
const copiedProfile = join(temporaryRoot, "profile");
const runtime = join(temporaryRoot, "runtime");
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
try {
  const zip = await downloadArtifact({ version: "39.8.2", artifactName: "electron", platform: "win32", arch: "x64" });
  await mkdir(runtime);
  await extract(zip, { dir: runtime });
  await mkdir(join(copiedProfile, "credentials", "flow"), { recursive: true });
  await copyFile(join(source, "Local State"), join(copiedProfile, "Local State"));
  await copyFile(join(source, "credentials", "flow", "accounts.json"), join(copiedProfile, "credentials", "flow", "accounts.json"));
  // Read only account metadata; do not decrypt or print credentials in this process.
  const stored = JSON.parse(await readFile(join(source, "credentials", "flow", "accounts.json"), "utf8"));
  const enabled = stored.accounts.filter(account => account.enabled);
  if (enabled.length === 0) throw new Error("Engine probe requires at least one enabled account");
  for (const account of enabled) {
    if (!/^persist:flow-[a-f0-9-]{36}$/i.test(account.partition)) throw new Error("Unexpected account partition path");
    const folder = account.partition.slice("persist:".length);
    await cp(join(source, "Partitions", folder, "Network"), join(copiedProfile, "Partitions", folder, "Network"), { recursive: true, errorOnExist: true, force: false });
  }
  console.log("Testing Electron 39.8.2 with an encrypted temporary profile copy; production profile is untouched.");
  const child = spawn(process.execPath, [join(scriptDirectory, "run-flow-live-check.mjs"), "--profile-window", "--native-profile", "--first-account"], {
    cwd: resolve(scriptDirectory, "../../.."), stdio: "inherit", windowsHide: true,
    env: { ...process.env, GOLD_WORK_FLOW_ELECTRON_BINARY: join(runtime, "electron.exe"), GOLD_WORK_FLOW_DATA_PATH: copiedProfile },
  });
  process.exitCode = await new Promise((resolveCode, reject) => {
    child.once("error", reject);
    child.once("exit", code => resolveCode(code ?? 1));
  });
} finally {
  const target = resolve(temporaryRoot);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith("gold-work-flow-engine-")) {
    throw new Error("Refusing cleanup outside the newly created engine-probe directory");
  }
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
