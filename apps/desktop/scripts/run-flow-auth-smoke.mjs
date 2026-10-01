import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const require = createRequire(import.meta.url);
const directory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(require.resolve("electron-vite"))("esbuild");
const output = resolve(directory, "dist/qa/flow-auth-smoke.cjs");
await build({ entryPoints: [resolve(directory, "scripts/flow-auth-smoke.ts")], outfile: output,
  bundle: true, platform: "node", format: "cjs", external: ["electron"] });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [output], { cwd: directory, env, stdio: "inherit", windowsHide: true });
child.once("error", error => { console.error(error.message); process.exitCode = 1; });
child.once("exit", code => { process.exitCode = code ?? 1; });
