import {existsSync} from 'node:fs';
import {join} from 'node:path';

// Electron can read files through app.asar, but child processes need a real path.
export function remotionBinariesDirectory(resourcesPath=process.resourcesPath):string|undefined {
  if(!resourcesPath||process.platform!=='win32'||process.arch!=='x64')return;
  const directory=join(resourcesPath,'app.asar.unpacked','node_modules','@remotion','compositor-win32-x64-msvc');
  return existsSync(directory)?directory:undefined;
}
