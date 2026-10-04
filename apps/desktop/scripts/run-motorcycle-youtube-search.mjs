import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('electron-vite'))('esbuild');
await build({entryPoints:['scripts/check-motorcycle-youtube-search.ts'],outfile:'dist/qa/check-motorcycle-youtube-search.cjs',bundle:true,platform:'node',format:'cjs',packages:'external'});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),['dist/qa/check-motorcycle-youtube-search.cjs'],{env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>process.exitCode=code??1);
child.on('error',error=>{console.error(error.name);process.exitCode=1;});
