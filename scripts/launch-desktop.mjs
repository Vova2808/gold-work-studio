import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {access} from 'node:fs/promises';
import {spawn} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const desktop=resolve(root,'apps/desktop');
try {
  await access(resolve(desktop,'dist/main/index.cjs'));
  await access(resolve(desktop,'dist/renderer/index.html'));
  const electron=createRequire(resolve(desktop,'package.json'))('electron');
  // User launch uses the built application. React's development profiler and
  // Vite HMR must not retain large production snapshots for hours.
  const child=spawn(electron,['.'],{cwd:desktop,detached:true,stdio:'ignore',windowsHide:false,
    env:{...process.env,ELECTRON_RENDERER_URL:'',NODE_ENV:'production'}});
  child.once('error',error=>{console.error(error.message);process.exitCode=1;});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  child.unref();
}catch(error){console.error('Gold Work Studio could not start: '+error.message);process.exitCode=1;}
