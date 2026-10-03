import {app} from 'electron';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,mkdtemp,readdir} from 'node:fs/promises';
import {mkdirSync,mkdtempSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import type {Project} from '@gold-work/shared';
import {AnyModelClient} from '../src/anymodel-client.js';
import {AnyModelStore} from '../src/anymodel-store.js';
import {DocumentaryIntelligence} from '../src/documentary-intelligence.js';

assert.ok(process.argv.includes('--paid'));
const profile='C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
const root=resolve('captures/stock-editorial-speed-20260927/range-live');
mkdirSync(root,{recursive:true});
// Configure Chromium's key store synchronously, before Electron becomes ready.
const isolated=mkdtempSync(join(root,'electron-'));copyFileSync(join(profile,'Local State'),join(isolated,'Local State'));
app.setPath('userData',isolated);app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  const registry=await readFile(join(profile,'projects.json'),'utf8');
  const original=(JSON.parse(registry) as Project[]).find(p=>p.id==='project_muj5r1uv_pphrclx')!;
  const p=structuredClone(original),scene=p.scenes[16]!;assert.ok(scene.videoPath&&scene.documentary!.verified);
  p.id='one-batch-live';
  for(const other of p.scenes)if(other!==scene){other.videoPath=undefined;other.imagePath=undefined;other.documentary!.selected=undefined;}
  const checksum=scene.documentary!.checksum!,catalogRoot=join(root,'Documentary','VideoCatalog',checksum);await mkdir(catalogRoot,{recursive:true});
  await copyFile(join('D:/GoldWorkStorage/Materials/VideoCatalog',checksum,'catalog-v1.json'),join(catalogRoot,'catalog-v1.json'));
  const store=new AnyModelStore(join(profile,'credentials/anymodel.json'));
  await store.apiKey();await store.proxyUrl(); // Local preflight before creating any paid checkpoint.
  const previous=await readFile(join(root,'result.json'),'utf8').then(text=>JSON.parse(text)).catch(()=>undefined);
  if(previous?.error?.includes('safeStorage.decryptString')&&previous.analysis?.length===1){
    // Only this probe's proven local preflight failure, never a network error.
    await writeFile(join(root,'local-preflight-error.json'),JSON.stringify({...previous,requests:0,reason:'Decryption failed before HTTP request'},null,2));
    for(const name of await readdir(join(root,'Documentary','Analysis'))){
      const path=join(root,'Documentary','Analysis',name),saved=JSON.parse(await readFile(path,'utf8'));
      assert.equal(saved.purpose,'catalog-range-batch');assert.equal(saved.state,'pending');
      await writeFile(path,JSON.stringify({...saved,state:'failed',error:'Local safeStorage decryption failed before HTTP; original evidence in local-preflight-error.json'}));
    }
  }
  let requests=0;const client=new AnyModelClient(store);
  const intelligence=new DocumentaryIntelligence(client,()=>root,async()=>{assert.ok(requests<1,'One paid batch limit reached; no further submission');requests++;});
  const started=Date.now();let review:unknown,error:string|undefined;
  try{review=await intelligence.inspect(p,scene);}catch(e){error=String(e).replace(/https?:\/\/\S+/gu,'[URL]');}
  const names=await readdir(join(root,'Documentary','Analysis')).catch(()=>[]);
  const analysis=await Promise.all(names.filter(n=>n.endsWith('.json')).map(async name=>{const a=JSON.parse(await readFile(join(root,'Documentary','Analysis',name),'utf8'));return {purpose:a.purpose,state:a.state};}));
  assert.equal(await readFile(join(profile,'projects.json'),'utf8'),registry);
  const result={requests,seconds:(Date.now()-started)/1000,review,error,analysis,registryUnchanged:true,noSearchDownloadOrTts:true};
  await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.exit(error?1:0);
}).catch(error=>{console.error(String(error).replace(/https?:\/\/\S+/gu,'[URL]'));app.exit(1);});
