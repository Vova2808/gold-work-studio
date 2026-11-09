import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm,cp} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import type {Project,DocumentaryArtwork} from '@gold-work/shared';
import {createSemanticMontagePlan} from './documentary-semantic-montage.js';
import {createMotionArtworkPlan,motionArtworkHash} from './documentary-artwork-plan.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {recoverOfflinePrimaryPlans,type OfflinePrimaryRecoveryBinding} from './documentary-offline-primary-recovery.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {LocalProjectStorage} from './local-project-storage.js';
const evidence=resolve(dirname(fileURLToPath(import.meta.url)),'../../../work/release-roadmap-20261026/stage-5-evidence/offline-primary-recovery');
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const drawing=():DocumentaryArtwork=>({version:1,intent:'Water cycle',layout:'full',canvas:{width:1000,height:600},palette:{background:'#101820',ink:'#f5f0e5',accent:'#7ab5ce',secondary:'#cbb583'},startSeconds:.2,durationSeconds:4.5,
  layers:[{id:'label',kind:'text',x:70,y:60,w:400,h:70,text:'water',fontSize:52},
    {id:'water',kind:'ellipse',x:100,y:420,w:230,h:70,fill:'accent'},
    {id:'vapour',kind:'path',x:180,y:180,w:100,h:200,path:'M50 100Q10 70 50 40Q90 10 50 0',stroke:'ink',fill:'none',keyframes:[{t:0,draw:0},{t:.4,draw:1},{t:1,draw:1}]},
    {id:'cloud',kind:'ellipse',x:400,y:150,w:300,h:100,fill:'ink',keyframes:[{t:0,opacity:0},{t:.5,opacity:1},{t:1,opacity:1}]}]});
function project():Project{return {id:'offline-water',name:'Offline water',mediaMode:'stock',aspectRatio:'16:9',language:'en',videoBrief:{readyScript:'Warm water evaporates. The vapour condenses into clouds.'},
  settings:{voice:{enabled:true},music:{enabled:false},assembly:{kenBurns:true,documentary:{version:2,autoMotionGraphics:true,autoEffects:false,autoTransitions:false,montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve'}}}},
  scenes:[{id:'rain',order:0,narration:'Warm water evaporates. The vapour condenses into clouds.',durationSeconds:6,imagePath:'rain.jpg',audioPath:'voice.wav',documentary:{verified:true,checksum:'rain',layout:'full',effects:[],caption:{enabled:false,text:''},selected:{id:'rain',kind:'image',width:1920,height:1080},requirement:{text:'water',identities:[],years:[],accent:'none'},timing:{sourceKey:'voice',durationInFrames:180,speechSeconds:5.8}}}]} as unknown as Project;}
async function fixture(){
  await mkdir(evidence,{recursive:true});const directory=await mkdtemp(join(evidence,'regression-')),input=join(directory,'input'),root=join(input,'cache');
  const analysis=join(root,'Documentary','Analysis');await mkdir(analysis,{recursive:true});await mkdir(join(input,'accounting'));
  const p=project();await writeFile(join(input,'project.json'),JSON.stringify(p));
  const rows:Array<Record<string,unknown>>=[];
  const record=async(system:string,request:string,result:Record<string,unknown>,stage:string)=>{
    const key=documentaryCheckpointKey('semantic-montage',system,request,[]),index=rows.length;
    await writeFile(join(analysis,key+'.json'),JSON.stringify({state:'complete',purpose:'semantic-montage',model:'local-test',result}));
    const wire=Buffer.from(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]}));
    await writeFile(join(input,'accounting',`response-${index}.bin`),wire);
    rows.push({index,stage,state:'complete',status:200,fingerprint:sha(request),receipt:`response-${index}.bin`,responseSha256:sha(wire),headers:{'content-type':'application/json'},
      responseRead:{state:'complete',capturedBytes:wire.length,observedBytes:wire.length,truncated:false}});
    return key;
  };
  let semanticKey='',primaryKey='';
  const semantic=await createSemanticMontagePlan(p,root,async(system,request)=>{
    const raw={scenes:[{sceneId:'s0',subject:'water',beat:'explain',treatment:'footage',cutawaySceneIds:[],artworkMode:'standalone'}]};
    semanticKey=await record(system,request,raw,'semantic');return raw;
  },'local-test');
  const directions=new Map(semantic.scenes.map(scene=>[scene.sceneId,scene]));
  const planned={...p,scenes:p.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,semanticMontage:directions.get(scene.id)}}))};
  const artwork=await createMotionArtworkPlan(planned,root,async(system,request)=>{const raw={scenes:[{sceneId:'rain',artwork:drawing()}]};primaryKey=await record(system,request,raw,'artwork');return raw;},'local-test');
  assert.equal(artwork.scenes.length,1);
  const finalCache=join(root,'Documentary','Montage',`${motionArtworkHash(planned)}-artwork-v1.json`),finalBefore=await readFile(finalCache);
  const savedOnly=await createMotionArtworkPlan(planned,root,async()=>{throw Error('savedOnly dispatched');},'local-test',undefined,{savedOnly:true});
  assert.deepEqual(savedOnly,artwork);assert.deepEqual(await readFile(finalCache),finalBefore);
  await rm(finalCache);rows.push({index:2,stage:'revision',state:'reserved',fingerprint:'f'.repeat(64)});
  await writeFile(join(input,'accounting','posts.json'),JSON.stringify({version:1,rows}));
  const bound=async(file:string)=>({file,sha256:sha(await readFile(join(input,file)))});
  const binding:OfflinePrimaryRecoveryBinding={version:1,project:await bound('project.json'),ledger:await bound('accounting/posts.json'),
    semanticManifest:await bound(`cache/Documentary/Montage/${semantic.inputHash}-batches.json`),primaryManifest:await bound(`cache/Documentary/Montage/${artwork.inputHash}-artwork-batches.json`),
    semantic:[{analysis:await bound(`cache/Documentary/Analysis/${semanticKey}.json`),wireIndex:0,fingerprint:rows[0]!.fingerprint as string}],
    primary:[{from:0,analysis:await bound(`cache/Documentary/Analysis/${primaryKey}.json`),wireIndex:1,fingerprint:rows[1]!.fingerprint as string}]};
  return {directory,input,p,planned,binding,bound};
}

test('explicit product recovery persists applied primary, provenance and incomplete outcome without any intelligence/revision/fetch',async()=>{
  const f=await fixture();let current=f.p,calls=0;const forbidden=async()=>{calls++;throw Error('forbidden offline provider/revision');};
  const storage=new LocalProjectStorage(join(f.directory,'output'));
  const service=new DocumentaryProjectService({get:async()=>structuredClone(current),mutate:async(_id,change)=>{current={...current,...await change(structuredClone(current))};return structuredClone(current);}},
    storage,undefined as never,join(f.directory,'materials'),{download:forbidden},()=>{},{plan:forbidden,inspect:forbidden,available:forbidden,planSemanticMontage:forbidden,planMotionArtwork:forbidden} as never);
  const fetch=globalThis.fetch;globalThis.fetch=forbidden;
  try{
    await service.recoverOfflinePrimaryMontage(current.id,{directory:f.input,binding:f.binding});
    const saved=JSON.parse(await readFile(join(storage.projectDirectory(current.id),'project.json'),'utf8')) as Project;
    assert.equal(saved.settings.assembly.documentary?.offlinePrimaryRecovery?.used,1);
    assert.equal(saved.settings.assembly.documentary?.offlinePrimaryRecovery?.attached,1);
    assert.equal(saved.settings.assembly.documentary?.motionArtworkStatus?.incomplete,true);
    assert.ok(saved.scenes[0]!.documentary?.semanticMontage?.artwork);assert.ok(saved.scenes[0]!.documentary?.motionGraphic?.artwork);
    assert.equal(calls,0);assert.equal(saved.scenes[0]!.narration,f.p.scenes[0]!.narration);assert.deepEqual(saved.settings.music,f.p.settings.music);
    const ledger=JSON.parse(await readFile(join(f.input,'accounting/posts.json'),'utf8'));assert.equal(ledger.rows[2].state,'reserved');
  }finally{globalThis.fetch=fetch;}
});

test('offline primary mode stays separate from ordinary savedOnly and forbids revision hooks',async()=>{
  const f=await fixture();let called=0;
  await assert.rejects(createMotionArtworkPlan(f.planned,join(f.input,'cache'),async()=>{called++;return {};},'local-test',undefined,{savedOnly:true}),/Нет сохранённого плана/);
  await assert.rejects(createMotionArtworkPlan(f.planned,join(f.input,'cache'),async()=>{called++;return {};},'local-test',undefined,
    {offlinePrimary:{read:async()=>{called++;return {};}},revision:{preview:(async()=>{called++;return [];}) as never,complete:async()=>{called++;return {};}}}),/cannot invoke revision/);
  assert.equal(called,0);
});

test('exact binding rejects wrong, missing, unknown, partial, tampered and incompatible cached inputs',async t=>{
  const seed=await fixture();
  const cases={'project-mismatch':/project-snapshot/,'missing-primary':/binding/,'wire-tamper':/file-hash/,'unknown-wire':/incomplete-wire-binding/,
    'pending-analysis':/analysis-wire-mismatch/,'partial-wire':/SSE/,'wrong-analysis-key':/semantic-exact-input/,
    'incompatible-manifest':/primary-input-lineage/,'duplicate-wire':/duplicate-wire-binding/,'missing-file':/ENOENT/,'wrong-fingerprint':/incomplete-wire-binding/,
    'invalid-artwork':/PRE-REVISION.*rain:/,'partial-analysis':/analysis-wire-mismatch/};
  for(const [name,reason] of Object.entries(cases))await t.test(name,async()=>{
    const directory=join(seed.directory,name),input=join(directory,'input');await cp(seed.input,input,{recursive:true});
    const binding=structuredClone(seed.binding),p=structuredClone(seed.p);
    const refresh=async(entry:{file:string;sha256:string})=>{entry.sha256=sha(await readFile(join(input,entry.file)));};
    const ledgerFile=join(input,binding.ledger.file),ledger=JSON.parse(await readFile(ledgerFile,'utf8'));
    if(name==='project-mismatch')p.scenes[0]!.narration='different input';
    if(name==='missing-primary')binding.primary=[];
    if(name==='wire-tamper')await writeFile(join(input,'accounting/response-1.bin'),'tampered');
    if(name==='unknown-wire'){ledger.rows[1].state='unknown';await writeFile(ledgerFile,JSON.stringify(ledger));await refresh(binding.ledger);}
    if(name==='pending-analysis'){const entry=binding.primary[0]!.analysis,a=JSON.parse(await readFile(join(input,entry.file),'utf8'));a.state='pending';await writeFile(join(input,entry.file),JSON.stringify(a));await refresh(entry);}
    if(name==='partial-wire'){
      const bytes=Buffer.from('data: {"choices":[{"delta":{"content":"prefix"}}]}\n\n');await writeFile(join(input,'accounting/response-1.bin'),bytes);
      ledger.rows[1].headers={'content-type':'text/event-stream'};ledger.rows[1].responseSha256=sha(bytes);ledger.rows[1].responseRead.capturedBytes=bytes.length;ledger.rows[1].responseRead.observedBytes=bytes.length;
      await writeFile(ledgerFile,JSON.stringify(ledger));await refresh(binding.ledger);
    }
    if(name==='wrong-analysis-key'){const entry=binding.semantic[0]!.analysis,old=await readFile(join(input,entry.file));entry.file='cache/Documentary/Analysis/'+'0'.repeat(64)+'.json';await writeFile(join(input,entry.file),old);await refresh(entry);}
    if(name==='incompatible-manifest'){const entry=binding.primaryManifest,m=JSON.parse(await readFile(join(input,entry.file),'utf8'));m.inputHash='0'.repeat(64);await writeFile(join(input,entry.file),JSON.stringify(m));await refresh(entry);}
    if(name==='duplicate-wire')binding.semantic.push(structuredClone(binding.semantic[0]!));
    if(name==='missing-file')await rm(join(input,binding.semanticManifest.file));
    if(name==='wrong-fingerprint')binding.primary[0]!.fingerprint='0'.repeat(64);
    if(name==='partial-analysis'){const entry=binding.primary[0]!.analysis,a=JSON.parse(await readFile(join(input,entry.file),'utf8'));a.state='partial';await writeFile(join(input,entry.file),JSON.stringify(a));await refresh(entry);}
    if(name==='invalid-artwork'){
      const entry=binding.primary[0]!.analysis,a=JSON.parse(await readFile(join(input,entry.file),'utf8'));a.result.scenes[0].artwork.canvas.width=-1;
      await writeFile(join(input,entry.file),JSON.stringify(a));await refresh(entry);
      const bytes=Buffer.from(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(a.result)}}]}));
      await writeFile(join(input,'accounting/response-1.bin'),bytes);ledger.rows[1].responseSha256=sha(bytes);
      ledger.rows[1].responseRead.capturedBytes=bytes.length;ledger.rows[1].responseRead.observedBytes=bytes.length;
      await writeFile(ledgerFile,JSON.stringify(ledger));await refresh(binding.ledger);
    }
    await assert.rejects(recoverOfflinePrimaryPlans(p,input,join(directory,'output'),binding),reason);
  });
});
