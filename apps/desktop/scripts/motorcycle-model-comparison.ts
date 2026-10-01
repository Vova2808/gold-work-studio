// Authorized small model comparison. No project/settings writes, no full movie,
// no retry of a partial/unknown completion, and identical inputs for both models.
import assert from 'node:assert/strict';
import {app} from 'electron';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Project} from '@gold-work/shared';
import {AnyModelClient,AnyModelProviderResponseError} from '../src/anymodel-client.js';
import {AnyModelStore} from '../src/anymodel-store.js';
import {DocumentaryIntelligence,documentaryJson,documentaryNarrationContext} from '../src/documentary-intelligence.js';
import {inspectDocumentaryRangeBatch} from '../src/documentary-range-batch.js';
import {enforceDocumentaryTechnicalQuality} from '../src/documentary-source-quality.js';
import {setDiagnosticSink} from '../src/diagnostics.js';

const paid=process.argv.includes('--paid');
const finishUnsubmitted=process.argv.includes('--finish-unsubmitted');
assert.ok(!finishUnsubmitted||paid);
const base=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001');
const out=join(base,'gemini-comparison'),profile=join(process.env.APPDATA!,'@gold-work/desktop');
const registry=join(profile,'projects.json'),settingsPath=join(profile,'credentials/anymodel.json');
const sha=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const fileHash=async(path:string)=>sha(await readFile(path));
const save=(file:string,value:unknown)=>writeFileSync(join(out,file),JSON.stringify(value,null,2));
mkdirSync(join(out,'electron-profile'),{recursive:true});
copyFileSync(join(profile,'Local State'),join(out,'electron-profile','Local State'));
app.setPath('userData',join(out,'electron-profile'));app.disableHardwareAcceleration();
type Case={id:string;scene:number;kind:'image'|'video';narration:string;title:string;system:string;input:string;frames:string[];requestKey:string;productionCheckpoint?:string};

app.whenReady().then(async()=>{
  const queue=JSON.parse(await readFile(join(profile,'queue.json'),'utf8'));
  assert.ok(!queue.some((task:{status:string})=>['running','pending','queued','retry_wait'].includes(task.status)),'Production must be idle');
  const originalRegistry=await fileHash(registry),originalSettings=await fileHash(settingsPath);
  const store=new AnyModelStore(settingsPath),originalPublic=store.publicSettings.bind(store),settings=await originalPublic();
  assert.equal(new URL(settings.baseUrl).hostname,'anymodel.org');
  let activeModel=settings.textModel;
  store.publicSettings=async()=>({...await originalPublic(),textModel:activeModel}); // This instance only, no save().
  const client=new AnyModelClient(store);
  const catalogue=await Reflect.get(client,'request').call(client,'/v1/models',{method:'GET',signal:AbortSignal.timeout(30000)}) as Response;
  assert.ok(catalogue.ok,`Catalogue HTTP ${catalogue.status}`);
  const models=(await catalogue.json() as {data:Array<{id:string;name?:string;billing?:unknown}>}).data;
  const matching=models.filter(m=>/(?:^|\/)gemini-2\.5-flash$/.test(m.id));
  const model=matching.find(m=>m.id==='gc/gemini-2.5-flash')??(matching.length===1?matching[0]:undefined);
  assert.ok(model,'An unambiguous listed Gemini 2.5 Flash route is required');
  const catalogueReport={at:new Date().toISOString(),baseline:settings.textModel,baselineBilling:models.find(m=>m.id===settings.textModel)?.billing,gemini:model.id,matching:matching.map(m=>({id:m.id,name:m.name,billing:m.billing})),paidRequests:0};
  save(process.argv.includes('--catalog-only')?'catalogue-after.json':'catalogue.json',catalogueReport);
  if(process.argv.includes('--catalog-only')){console.log(JSON.stringify(catalogueReport));app.exit(0);return;}

  if(!paid){
    assert.ok(!existsSync(join(out,'manifest.json')),'Manifest already prepared; inspect it rather than replacing it');
    const project=JSON.parse(await readFile(join(base,'late-ten-baseline/project.json'),'utf8')) as Project;
    const cases:Case[]=[];
    // Saved assignments, chosen before model responses. Some old approvals may
    // be wrong: they are comparison cases, never treated as ground truth.
    for(const [kind,numbers] of [['image',[7,22,29,39,42]],['video',[3,4,12,46,53]]] as const){
      for(const number of numbers){
        const scene=project.scenes.find(s=>s.order===number-1)!;
        assert.ok(scene.documentary?.verified&&scene.documentary.selected?.kind===kind);
        assert.ok(existsSync(kind==='image'?scene.imagePath!:scene.videoPath!),'Saved media must exist');
        const id=`${kind}-${number}`,root=join(out,id);mkdirSync(root,{recursive:true});
        let captured:{system:string;input:string;images:string[]}|undefined;
        const captureError=Error('QA capture only; no provider request');
        const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input,images=[])=>{
          captured={system,input,images};throw captureError;
        }},()=>root);
        try{
          if(kind==='image')await intelligence.inspectForSelection(project,scene);
          else await inspectDocumentaryRangeBatch({file:scene.videoPath!,root:join(root,'frames'),
            request:{narration:scene.narration,narrationContext:documentaryNarrationContext(project,scene),source:{title:scene.documentary.selected.title},entities:scene.documentary.requirement.entities,years:scene.documentary.requirement.years},
            identities:scene.documentary.requirement.identities,
            regions:[{id:0,startSeconds:scene.trimStartSeconds??0,endSeconds:scene.trimEndSeconds??(scene.trimStartSeconds??0)+scene.durationSeconds}],
            complete:(purpose,system,input,images)=>Reflect.get(intelligence,'complete').call(intelligence,project.id,purpose,system,input,images)});
        }catch{/* Fake capture intentionally terminates before any paid call. */}
        assert.ok(captured,`No model request captured for ${id}`);
        const files=await readdir(join(root,'Documentary/Analysis'));
        assert.equal(files.length,1,'Exactly one captured request per case');
        const productionPath=join('D:/GoldWorkStorage/projects',project.id,'Documentary/Analysis',files[0]!);
        const previous=existsSync(productionPath)?JSON.parse(await readFile(productionPath,'utf8')):undefined;
        assert.ok(!previous||['complete','failed','rejected'].includes(previous.state),`Unknown original request ${id} must not be replayed on another model`);
        const frames=captured.images.map((url,index)=>{assert.ok(url.startsWith('data:image/jpeg;base64,'));const path=join(root,`frame-${index}.jpg`);writeFileSync(path,Buffer.from(url.slice(url.indexOf(',')+1),'base64'));return path;});
        const entry:Case={id,scene:number,kind,narration:scene.narration,title:scene.documentary.selected.title,system:captured.system,input:captured.input,frames,
          requestKey:sha(JSON.stringify([captured.system,captured.input,captured.images])),productionCheckpoint:previous?.state};
        save(`${id}/request.json`,entry);cases.push(entry);
      }
    }
    assert.equal(await fileHash(registry),originalRegistry);assert.equal(await fileHash(settingsPath),originalSettings);
    save('manifest.json',{at:new Date().toISOString(),projectId:project.id,baseline:settings.textModel,gemini:model.id,cases,originalRegistry,originalSettings,
      note:'Five saved photos and five saved video intervals. Fixed model-analysis comparison, not ten new searches; prior approvals are not ground truth.'});
    console.log(JSON.stringify({prepared:cases.map(c=>({id:c.id,frames:c.frames.length,previous:c.productionCheckpoint})),baseline:settings.textModel,gemini:model.id,paidRequests:0}));app.exit(0);return;
  }

  assert.ok(finishUnsubmitted?existsSync(join(out,'result.json')):!existsSync(join(out,'started.json')),'Inspect checkpoints; no blind rerun');
  if(finishUnsubmitted)assert.ok(!existsSync(join(out,'finish-unsubmitted.json')),'Remaining cases already dispatched');
  const manifest=JSON.parse(await readFile(join(out,'manifest.json'),'utf8')) as {cases:Case[];gemini:string;baseline:string};
  assert.equal(manifest.gemini,model.id);assert.equal(manifest.baseline,settings.textModel);
  const previousRun=finishUnsubmitted?JSON.parse(await readFile(join(out,'result.json'),'utf8')):undefined;
  if(previousRun)assert.ok(previousRun.registryPreserved&&previousRun.settingsPreserved);
  let submissions=previousRun?.submissions??0,current:Record<string,any>|undefined,baselineFailures=0,geminiFailures=0;
  const results:Record<string,any>[]=previousRun?.results??[],started=Date.now(),deadline=started+15*60_000;
  const todo=manifest.cases.filter(c=>!finishUnsubmitted||!existsSync(join(out,c.id,'gemini.json'))&&!existsSync(join(out,c.id,'sonnet.json')));
  if(finishUnsubmitted)assert.ok(todo.length===1&&submissions<=20,'Only the untouched last pair is authorized in this continuation');
  const request=Reflect.get(client,'request').bind(client);
  Reflect.set(client,'request',async(path:string,init:RequestInit={},attempt=0)=>{
    if(init.method==='POST'&&path.includes('/chat/completions')){
      assert.ok(submissions<22&&Date.now()<deadline,'Small paid comparison cap reached');
      const body=JSON.parse(String(init.body));assert.equal(body.model,activeModel);submissions++;
      if(current)current.submissions++;
    }
    return request(path,init,attempt);
  });
  setDiagnosticSink((_level,event,data)=>{if(current&&event==='anymodel.completion.usage')current.usage={input:data.inputCount,output:data.outputCount,total:data.totalCount};});
  save(finishUnsubmitted?'finish-unsubmitted.json':'started.json',{at:new Date().toISOString(),pid:process.pid,maximumCalls:22,models:[settings.textModel,model.id],originalRegistry,originalSettings,unsubmittedOnly:finishUnsubmitted,cases:todo.map(c=>c.id)});
  const report=async()=>save('result.json',{at:new Date().toISOString(),elapsedSeconds:(previousRun?.elapsedSeconds??0)+(Date.now()-started)/1000,submissions,results,registryPreserved:await fileHash(registry)===originalRegistry,settingsPreserved:await fileHash(settingsPath)===originalSettings,productionEdited:false});
  for(const [index,c] of todo.entries()){
    const images=await Promise.all(c.frames.map(async file=>'data:image/jpeg;base64,'+(await readFile(file)).toString('base64')));
    assert.equal(sha(JSON.stringify([c.system,c.input,images])),c.requestKey);
    for(const testModel of index%2?[settings.textModel,model.id]:[model.id,settings.textModel]){
      if(testModel===settings.textModel&&baselineFailures>=2||testModel===model.id&&geminiFailures>=2)continue;
      activeModel=testModel;current={case:c.id,kind:c.kind,scene:c.scene,model:testModel,submissions:0,state:'pending'};
      const checkpoint=`${c.id}/${testModel===model.id?'gemini':'sonnet'}.json`,began=Date.now();save(checkpoint,current);
      let partial='',lastSave=0;
      try{
        const raw=await client.documentaryCompletion(c.system,c.input,images,AbortSignal.timeout(120_000),value=>{
          partial=value;if(Date.now()-lastSave>1000){lastSave=Date.now();save(checkpoint,{...current,state:'partial',raw:value});}
        });
        current.raw=raw;current.state='received';save(checkpoint,current);
        const value=enforceDocumentaryTechnicalQuality(documentaryJson(raw),true);
        const rows=c.kind==='video'?value.reviews:[value];
        assert.ok(Array.isArray(rows)&&rows.length===1&&rows.every(r=>r&&typeof r==='object'&&['accepted','rejected','uncertain'].includes(String((r as any).status))),'Complete expected review schema');
        current.review=rows[0];current.state='complete';
      }catch(error){
        const terminal=error instanceof AnyModelProviderResponseError&&!partial;
        current.state=current.state==='received'?'received':terminal?'failed':partial?'partial':'pending';
        current.raw??=partial||undefined;current.error=String(error).replace(/https?:\/\/\S+/g,'[source]');
        if(testModel===settings.textModel)baselineFailures++;else geminiFailures++;
      }
      current.seconds=(Date.now()-began)/1000;results.push(current);save(checkpoint,current);
      console.log(JSON.stringify({...current,raw:undefined,review:current.review?{status:current.review.status,reason:current.review.reason,technicalQuality:current.review.technicalQuality}:undefined}));
      await report();
      if(['pending','partial','received'].includes(current.state))break; // Never send this uncertain case to another model.
    }
    if(geminiFailures>=2)break;
  }
  await report();app.exit(0);
}).catch(error=>{console.error(String(error).replace(/https?:\/\/\S+/g,'[source]'));app.exit(1);});
