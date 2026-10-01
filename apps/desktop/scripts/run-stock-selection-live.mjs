import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('electron-vite'))('esbuild');
await build({entryPoints:['scripts/stock-selection-live-check.ts'],outfile:'dist/qa/stock-selection-live.cjs',bundle:true,platform:'node',format:'cjs',external:['electron','ffmpeg-static']});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),['dist/qa/stock-selection-live.cjs',...process.argv.slice(2)],{env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>process.exitCode=code??1);child.on('error',error=>{console.error(error.message);process.exitCode=1});
