// Startup/build identity. Isolated by default; --keep-user-window leaves the real app open.
import { app, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { mkdir, readFile,copyFile,writeFile,stat } from 'node:fs/promises';
import { resolve,join } from 'node:path';
const mapCheck=process.argv.includes('--motion-map');
const keepUserWindow=process.argv.includes('--keep-user-window');
if(mapCheck&&keepUserWindow)throw Error('Map fixture requires an isolated profile');
const profile = keepUserWindow ? join(process.env.APPDATA,'@gold-work','desktop') : resolve(mapCheck?'captures/motion-satellite-native-profile':'captures/documentary-long-video/startup-profile');
await mkdir(profile, { recursive: true });
app.setPath('userData', profile);
delete process.env.ELECTRON_RENDERER_URL; delete process.env.PORTABLE_EXECUTABLE_DIR;
if(!keepUserWindow)app.on('browser-window-created', (_event, window) => window.on('show', () => window.hide()));
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
app.whenReady().then(async () => {
  try {
    const expected = (await readFile('src/generated-build-identity.ts', 'utf8')).match(/APP_BUILD_ID = "([^"]+)"/)[1];
    for (let i = 0; i < 100; i++) {
      const window = BrowserWindow.getAllWindows()[0];
      if (window && !window.webContents.isLoadingMainFrame()) {
        const info = await window.webContents.executeJavaScript('window.goldWork.getAppInfo()');
        if (info.buildId !== expected) throw new Error('Wrong build identity');
        const rendererBuildId = await window.webContents.executeJavaScript('document.querySelector("[data-renderer-build-id]")?.dataset.rendererBuildId');
        if (!rendererBuildId) { await new Promise(resolve => setTimeout(resolve,100)); continue; }
        if (rendererBuildId !== info.buildId) throw new Error(`Loaded renderer ${rendererBuildId} does not match main ${info.buildId}`);
        if(mapCheck){
          if(!resolve(info.workspacePath).startsWith(profile))throw Error('Not an isolated workspace');
          const project=await window.webContents.executeJavaScript(`window.goldWork.createProject({title:'Map IPC check',topic:'Local only',language:'ru',aspectRatio:'16:9',mediaMode:'stock',mode:'standard'})`);
          const mapRoot=join(info.workspacePath,'projects',project.id,'Documentary','Maps');await mkdir(mapRoot,{recursive:true});
          const key='satellite-fac5e56191e6c6663cb429bb9749ea85e49661a387571558f7e7c62eefc92143';
          for(const extension of ['.jpg','.json'])await copyFile(resolve('captures/motion-satellite-20260926/Documentary/Maps',key+extension),join(mapRoot,key+extension));
          const started=Date.now();
          const detail=await window.webContents.executeJavaScript(`window.goldWork.prepareDocumentaryMap(${JSON.stringify(project.id)},{name:'Denver',latitude:39.741134,longitude:-104.985962},35)`);
          const width=await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth);image.onerror=()=>reject(Error('Native media protocol cannot load city map'));image.src=window.goldWork.mediaUrl(${JSON.stringify(detail.imagePath)});})`);
          if(width!==2400)throw Error('Wrong map image size');
          if(detail.kind!=='satellite')throw Error('Satellite source was not preserved');
          const result={buildId:info.buildId,seconds:(Date.now()-started)/1000,width,kind:detail.kind,bytes:(await stat(detail.imagePath)).size,originalProfileUntouched:true};
          await writeFile(resolve('captures/motion-satellite-native-profile/result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
        }
        const result={ startup: 'ok', buildId: info.buildId, rendererBuildId, buildMatch: true };
        console.log(JSON.stringify(result));
        if(keepUserWindow){
          await mkdir(resolve('captures/stock-stall-20260927'),{recursive:true});
          await writeFile(resolve('captures/stock-stall-20260927/final-startup.json'),JSON.stringify(result,null,2));
          window.show();return;
        }
        app.exit(0); return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Startup timed out');
  } catch (error) { console.error(String(error)); app.exit(1); }
});
