import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('electron-vite'))('esbuild');
await build({entryPoints:['scripts/montage-provider-readonly.ts'],outfile:'dist/qa/montage-provider-readonly.cjs',bundle:true,platform:'node',format:'cjs',external:['electron','ffmpeg-static']});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),['dist/qa/montage-provider-readonly.cjs'],{env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>process.exitCode=code??1);
