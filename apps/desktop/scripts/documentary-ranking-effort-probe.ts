// Two explicit, isolated metadata requests on a previously completed shortlist.
// No search/download/visual acceptance, settings edits or production mutations.
import assert from 'node:assert/strict';
import {app} from 'electron';
import {mkdir,readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import type {Project} from '@gold-work/shared';
import {DocumentaryIntelligence,documentaryJson} from '../src/documentary-intelligence.js';
import {AnyModelClient} from '../src/anymodel-client.js';
import {AnyModelStore} from '../src/anymodel-store.js';
import {setDiagnosticSink} from '../src/diagnostics.js';
import {documentaryRankingResponseInstruction} from '../src/documentary-ranking-batch.js';

assert.ok(process.argv.includes('--paid'),'Explicit --paid required');
const snapshot=process.argv.find(v=>v.startsWith('--snapshot='))?.slice(11),output=process.argv.find(v=>v.startsWith('--out='))?.slice(6);
assert.ok(snapshot&&output,'Pass frozen QA snapshot and a new output directory');
const profile=join(process.env.APPDATA!,'@gold-work/desktop'),out=resolve(output);
await mkdir(out,{recursive:true});
await writeFile(join(out,'started.json'),JSON.stringify({at:new Date().toISOString(),maxPosts:process.argv.includes('--low-only')?1:2}),{flag:'wx'});
const temporary=join(out,'electron-profile');await mkdir(temporary,{recursive:true});
await copyFile(join(profile,'Local State'),join(temporary,'Local State'));app.setPath('userData',temporary);
app.on('window-all-closed',()=>undefined);

app.whenReady().then(async()=>{
  const project=JSON.parse(await readFile(snapshot,'utf8')) as Project;
  const scene=project.scenes.find(s=>s.order+1===139)!;
  assert.ok(scene.documentary?.candidates.length);
  const storage=JSON.parse(await readFile(join(profile,'storage-location.json'),'utf8'));
  const originalRoot=join(storage.activePath,'projects',project.id);
  let captured:{system:string;input:string}|undefined;
  const captureRoot=join(out,'capture-only');
  // Reproduce the same already-completed negative filtering as production.
  const negativeRoot=join(originalRoot,'Documentary','RankingNegatives');
  const captureNegatives=join(captureRoot,'Documentary','RankingNegatives');
  await mkdir(captureNegatives,{recursive:true});
  for(const name of await readdir(negativeRoot))if(name.endsWith('.json'))await copyFile(join(negativeRoot,name),join(captureNegatives,name));
  const capture=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input)=>{
    captured={system,input};throw new Error('Offline request capture only');
  }},()=>captureRoot);
  await capture.rankCandidates(project,scene,scene.documentary.candidates).catch(()=>{});
  assert.ok(captured,'Expected one actual product metadata request');
  const request=captured;
  const checkpointSystem=request.system.endsWith(documentaryRankingResponseInstruction)?request.system.slice(0,-documentaryRankingResponseInstruction.length):request.system;
  const key=createHash('sha256').update(JSON.stringify([2,'candidate-relevance',checkpointSystem,request.input,[]])).digest('hex');
  const original=JSON.parse(await readFile(join(originalRoot,'Documentary','Analysis',`${key}.json`),'utf8'));
  assert.equal(original.state,'complete','Never compare by repeating an unknown/pending request');
  // Run the complete product guard against original checkpoints before paying.
  const guard=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>assert.fail('Baseline must already be complete')},()=>originalRoot);
  const previous=await guard.rankCandidates(project,scene,scene.documentary.candidates);
  await writeFile(join(out,'request.json'),JSON.stringify({key,...request,previousIds:previous.map(c=>c.id)},null,2));
  const credentials=join(profile,'credentials/anymodel.json'),settingsHash=createHash('sha256').update(await readFile(credentials)).digest('hex');
  const results=[];
  for(const effort of (process.argv.includes('--low-only')?['low']:['medium','low']) as Array<'medium'|'low'>){
    let posts=0,tokens=0,partial='';const started=Date.now(),checkpoint=join(out,`${effort}.json`);
    const client=new AnyModelClient(new AnyModelStore(credentials));
    const transport=Reflect.get(client,'request').bind(client);
    Reflect.set(client,'request',async(path:string,init:RequestInit={},attempt=0)=>{
      if(init.method==='POST'){
        assert.equal(posts,0,'One POST per variant, no retries or model fallback');
        const body=JSON.parse(String(init.body));assert.equal(body.model,'ag/gemini-2.5-flash');
        body.reasoning_effort=effort;init={...init,body:JSON.stringify(body)};posts++;
        await writeFile(checkpoint,JSON.stringify({state:'pending',effort,at:new Date().toISOString(),key}));
      }
      return transport(path,init,attempt);
    });
    setDiagnosticSink((_level,event,data)=>{if(event==='anymodel.completion.usage')tokens+=typeof data.totalCount==='number'?data.totalCount:0;});
    try{
      const raw=await client.documentaryCompletion(request.system,request.input,[],AbortSignal.timeout(90_000),value=>{partial=value;},'ag/gemini-2.5-flash',1600);
      const answer=documentaryJson(raw),allowed=new Set(JSON.parse(request.input).candidates.map((c:{id:string})=>c.id));
      assert.ok(Array.isArray(answer.ids)&&answer.ids.every((id:unknown)=>allowed.has(id)),'Only supplied candidate IDs');
      const result={state:'complete',effort,seconds:(Date.now()-started)/1000,posts,tokens,answer,raw};
      results.push(result);await writeFile(checkpoint,JSON.stringify(result,null,2));
    }catch(error){
      const result={state:'unresolved',effort,seconds:(Date.now()-started)/1000,posts,tokens,partial,error:String(error).slice(0,500)};
      results.push(result);await writeFile(checkpoint,JSON.stringify(result,null,2));break;
    }
    console.log(JSON.stringify(results.at(-1)));
  }
  assert.equal(createHash('sha256').update(await readFile(credentials)).digest('hex'),settingsHash);
  await writeFile(join(out,'result.json'),JSON.stringify({at:new Date().toISOString(),scene:139,model:'ag/gemini-2.5-flash',metadataOnly:true,
    productionNotModified:true,settingsPreserved:true,baselineAnswer:original.result,results},null,2));
}).then(()=>app.exit(),error=>{console.error(error.message);app.exit(1);});
