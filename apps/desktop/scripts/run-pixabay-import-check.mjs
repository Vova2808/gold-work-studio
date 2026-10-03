import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('electron-vite'))('esbuild');
const output=resolve('dist/qa/pixabay-import-check.cjs');
await build({entryPoints:[resolve('scripts/pixabay-import-check.ts')],outfile:output,bundle:true,platform:'node',format:'cjs',packages:'external'});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[output],{env,stdio:'inherit',windowsHide:true});
child.once('error',error=>{console.error(error);process.exitCode=1;});child.once('exit',code=>process.exitCode=code??1);
