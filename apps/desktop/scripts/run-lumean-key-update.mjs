import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('electron-vite'))('esbuild');
const output=resolve('dist/qa/update-lumean-key.cjs');
await build({entryPoints:['scripts/update-lumean-key.ts'],outfile:output,bundle:true,platform:'node',format:'cjs',external:['electron','ffmpeg-static']});
if(process.stdin.isTTY)process.stdin.setRawMode(true);
console.log('Ready for credential on stdin; input is not echoed or saved.');
let input='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
  input+=chunk;
  if(!/[\r\n]/.test(input))return;
  if(!input.trim()){input='';return;}
  process.stdin.pause();if(process.stdin.isTTY)process.stdin.setRawMode(false);
  const env={...process.env,GWS_CREDENTIAL_UPDATE:input.trim()};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),[output],{env,stdio:['ignore','inherit','inherit'],windowsHide:true});
  delete env.GWS_CREDENTIAL_UPDATE;input='';
  child.once('exit',code=>process.exit(code??1));
});
