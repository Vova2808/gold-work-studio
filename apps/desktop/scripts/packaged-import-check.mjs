import {app} from 'electron';
import {createRequire} from 'node:module';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'gws-package-import-'));
app.setPath('userData',root);
process.env.PORTABLE_EXECUTABLE_DIR=root;
process.on('uncaughtException',error=>{console.error(error.stack);app.exit(1);});
process.on('unhandledRejection',error=>{console.error(error);app.exit(1);});
try {
  createRequire(import.meta.url)(resolve('../../release/ai-story-20260908/win-unpacked/resources/app.asar/dist/main/index.cjs'));
  app.whenReady().then(()=>setTimeout(()=>{console.log('[packaged-import] Main loaded without exception');app.exit(0);},6000));
} catch(error) {console.error(error.stack);app.exit(1);}
