import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('electron-vite'))('esbuild');
const probe=process.argv.includes('--final-audio-check')?'stock-final-audio-review':process.argv.includes('--action-check')?'stock-action-probe':process.argv.includes('--class-photo-check')?'stock-class-photo-probe':process.argv.includes('--visual-subject-check')?'stock-visual-subject-probe':process.argv.includes('--context-check')?'stock-context-identity-probe':'stock-analysis-probe';
await build({entryPoints:[`scripts/${probe}.ts`],outfile:`dist/qa/${probe}.cjs`,bundle:true,platform:'node',format:'cjs',external:['electron','ffmpeg-static']});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[`dist/qa/${probe}.cjs`,...process.argv.slice(2)],{env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>process.exitCode=code??1);
