// One bounded paid check of an already saved three-part preview. No download,
// no project/queue mutation, and no retry of an unknown completion.
import assert from 'node:assert/strict';
import {app} from 'electron';
import {copyFileSync,existsSync,mkdirSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Project} from '@gold-work/shared';
import {AnyModelStore} from '../src/anymodel-store.js';
import {AnyModelClient} from '../src/anymodel-client.js';
import {DocumentaryIntelligence} from '../src/documentary-intelligence.js';
import {documentaryPreviewKey,readDocumentaryPreview} from '../src/documentary-preview.js';
import {atomicWrite} from '../src/fs-utils.js';

const projectId='project_mun42rx8_1jcven5';
const root=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001');
const out=join(root,'scene155-preview-gate');
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
  const client=new AnyModelClient(new AnyModelStore(join(profile,'credentials/anymodel.json')));
  const request=Reflect.get(client,'request').bind(client);
  let posts=0;
  Reflect.set(client,'request',async(path:string,init:RequestInit={},attempt=0)=>{
    if(init.method==='POST'&&path.includes('/chat/completions')){
      if(posts>=1)throw Error('Bounded preview probe: one AnyModel POST maximum');
      posts++;
    }
    return request(path,init,attempt);
  });
  const started=Date.now();let match:Awaited<ReturnType<DocumentaryIntelligence['inspectPreviewForScene']>>|undefined,failure:string|undefined;
  try{
    match=await new DocumentaryIntelligence(client,()=>join('D:/GoldWorkStorage/projects',projectId)).inspectPreviewForScene(project,scene,candidate,preview);
  }catch(error){failure=String(error).replace(/https?:\/\/\S+/g,'[source]').slice(0,500);}
  const result={projectId,sceneNumber:155,sourceId:candidate.id,sourceDurationSeconds:candidate.durationSeconds,
    elapsedSeconds:(Date.now()-started)/1000,anyModelPosts:posts,selectedIndex:match?.selectedIndex,reason:match?.reason,failure};
  await atomicWrite(join(out,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));app.exit();
}).catch(error=>{console.error(String(error).replace(/https?:\/\/\S+/g,'[source]'));app.exit(1);});
