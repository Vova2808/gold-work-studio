// Zero-AnyModel measurement: product YouTube downloader on the preview-confirmed
// interval of the existing motorcycle source. The user's registry is read-only.
import assert from 'node:assert/strict';
import {app} from 'electron';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Project} from '@gold-work/shared';
import {YouTubeStore} from '../src/youtube-store.js';
import {DocumentaryYouTube} from '../src/documentary-youtube.js';
import {documentaryPreviewDownloadRange,documentaryPreviewKey,readDocumentaryPreview} from '../src/documentary-preview.js';
import {probeEffectMedia} from '../src/effect-media.js';
import {atomicWrite} from '../src/fs-utils.js';

const projectId='project_mun42rx8_1jcven5';
const root=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001');
const out=join(root,'scene155-range-download');
assert.ok(!existsSync(join(out,'result.json')),'Probe already completed');
mkdirSync(out,{recursive:true});
const profile=join(process.env.APPDATA!,'@gold-work/desktop');
const temporary=join(out,'electron-profile');mkdirSync(temporary,{recursive:true});
copyFileSync(join(profile,'Local State'),join(temporary,'Local State'));
app.setPath('userData',temporary);app.on('window-all-closed',()=>undefined);

app.whenReady().then(async()=>{
  const project=JSON.parse(await readFile(join(root,'speed-oct04-current','project.json'),'utf8')) as Project;
  assert.equal(project.id,projectId);
  const scene=project.scenes.find(scene=>scene.order===154);
  assert.ok(scene);
  const candidate=scene.documentary?.candidates?.find(item=>item.id==='youtube:L0BXb5I86Ac');
  assert.ok(candidate);
  const preview=await readDocumentaryPreview(join('D:/GoldWorkStorage/Materials/Previews',documentaryPreviewKey(candidate)));
  assert.ok(preview);
  const match=JSON.parse(await readFile(join(root,'scene155-preview-gate','result.json'),'utf8')) as {selectedIndex:number};
  const duration=Math.max(scene.durationOverrideSeconds??0,(scene.documentary?.timing?.durationInFrames??scene.durationSeconds*30)/30);
  const range=documentaryPreviewDownloadRange(preview,match.selectedIndex,candidate.durationSeconds!,duration);
  assert.ok(range);
  const registryPath=join(profile,'projects.json');
  const digest=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
  const registryHash=digest(await readFile(registryPath));
  const destination=join(out,'clip.mp4');
  const started=Date.now();let failure:string|undefined;
  try{
    await new DocumentaryYouTube(new YouTubeStore(join(profile,'credentials/youtube.json')))
      .download(candidate,destination,AbortSignal.timeout(90000),undefined,true,range);
  }catch(error){failure=String(error).replace(/https?:\/\/\S+/g,'[source]').slice(0,700);}
  const media=!failure?await probeEffectMedia(destination):undefined;
  const result={projectId,sceneNumber:155,sourceId:candidate.id,range,elapsedSeconds:(Date.now()-started)/1000,
    bytes:(await stat(destination).catch(()=>undefined))?.size??0,width:media?.width,height:media?.height,
    durationSeconds:media?.durationSeconds,videoCodec:media?.videoCodec,anyModelPosts:0,failure,
    registryPreserved:digest(await readFile(registryPath))===registryHash};
  await atomicWrite(join(out,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));app.exit();
}).catch(error=>{console.error(String(error).replace(/https?:\/\/\S+/g,'[source]'));app.exit(1);});
