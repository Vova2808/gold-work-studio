import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const require = createRequire(import.meta.url);
const directory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const {build} = createRequire(require.resolve("electron-vite"))("esbuild");
const script = process.argv.includes('--motorcycle-search-probe') ? 'motorcycle-search-probe' : process.argv.includes('--documentary-network') ? 'documentary-network-live' : process.argv.includes('--documentary-youtube-discovery') ? 'documentary-youtube-discovery-live' : process.argv.includes('--documentary-alignment') ? 'documentary-alignment-live' : process.argv.includes('--narration-quality') ? 'narration-quality-live' : process.argv.includes('--long-story') ? 'long-scenario-live' : process.argv.includes('--scenario-repair') ? 'scenario-repair-live-check' : process.argv.includes('--ready-script') ? 'ready-script-live-check' : 'service-health-check';
const output = resolve(directory, `dist/qa/${script}.cjs`);
await build({entryPoints:[resolve(directory,`scripts/${script}.ts`)],outfile:output,
  bundle:true, platform:"node", format:"cjs", external:["electron","ffmpeg-static"]});
const env = {...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [output,...process.argv.slice(2)], {cwd:directory, env, stdio:"inherit", windowsHide:true});
child.once("error", error => {console.error(error.message); process.exitCode=1;});
child.once("exit", code => {process.exitCode=code ?? 1;});
