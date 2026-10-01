import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('electron-vite'))('esbuild');
await build({entryPoints:['scripts/stock-range-batch-live.ts'],outfile:'dist/qa/stock-range-batch-live.cjs',bundle:true,platform:'node',format:'cjs',external:['electron','ffmpeg-static']});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),['dist/qa/stock-range-batch-live.cjs',...process.argv.slice(2)],{env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>process.exitCode=code??1);
