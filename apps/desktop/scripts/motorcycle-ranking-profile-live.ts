// Bounded comparison of the existing and shortened metadata profiles. The
// second request is allowed only after the first has a known complete result.
import assert from 'node:assert/strict';
import {app} from 'electron';
import {copyFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Project} from '@gold-work/shared';
import {AnyModelClient} from '../src/anymodel-client.js';
import {AnyModelStore} from '../src/anymodel-store.js';
import {DocumentaryIntelligence} from '../src/documentary-intelligence.js';
import {setDiagnosticSink} from '../src/diagnostics.js';

assert.ok(process.argv.includes('--paid'));
const profile=join(process.env.APPDATA!,'@gold-work/desktop');
const out=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001/ranking-profile-live');
assert.ok(!existsSync(join(out,'started.json')),'Read existing checkpoints, do not replay unknown requests');
mkdirSync(join(out,'profile'),{recursive:true});copyFileSync(join(profile,'Local State'),join(out,'profile','Local State'));
app.setPath('userData',join(out,'profile'));
app.whenReady().then(async()=>{
  const queue=JSON.parse(await readFile(join(profile,'queue.json'),'utf8'));
  assert.ok(!queue.some((task:{status:string})=>['running','pending','retry_wait'].includes(task.status)));
  const project=JSON.parse(await readFile(resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001/evening-additional/project.json'),'utf8')) as Project;
  const client=new AnyModelClient(new AnyModelStore(join(profile,'credentials/anymodel.json')));
  let submissions=0,current:Record<string,any>|undefined;
  const chat=(client as any).chat.bind(client);
  (client as any).chat=(...args:any[])=>{if(current?.profile==='after'){args[2]=1800;args[3]='low';}return chat(...args);};
  const results:Record<string,any>[]=[];
  setDiagnosticSink((_level,event,data)=>{if(current&&event==='anymodel.completion.usage')current.usage={input:data.inputCount,output:data.outputCount,total:data.totalCount};});
  writeFileSync(join(out,'started.json'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,maximumPaidRequests:4,scenes:[138,19]},null,2));
  for(const number of [138,19]){
    const scene=project.scenes.find(s=>s.order===number-1)!;
    let system='',input='';
    const capture=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(s,t)=>{system=s;input=t;return '{"ids":[]}';}},()=>join(out,`capture-${number}`));
    await capture.rankCandidates(project,scene,scene.documentary!.candidates);
    assert.ok(system&&input,'A genuine metadata-ranking case is required');
    const request=JSON.parse(input);
    writeFileSync(join(out,`case-${number}.json`),JSON.stringify({system,input:request},null,2));
    for(const profileName of ['before','after']){
      const connection={configured:()=>client.configured(),documentaryCompletion:(s:string,t:string,images:string[]=[],signal?:AbortSignal,onPartial?:(raw:string)=>void)=>
        client.documentaryCompletion(s,t,images,signal,onPartial)};
      const intel=new DocumentaryIntelligence(connection,()=>join(out,`${number}-${profileName}`),async()=>{assert.ok(submissions<4);submissions++;});
      current={scene:number,profile:profileName,candidates:request.candidates.length};const started=Date.now();
      try{
        const response=await (intel as any).complete(project.id,'candidate-relevance',system,input,[]);
        assert.ok(Array.isArray(response.ids)&&response.ids.every((id:unknown)=>typeof id==='string'&&request.candidates.some((candidate:any)=>candidate.id===id)));
        current.ids=response.ids;current.reason=response.reason;
        current.titles=response.ids.map((id:string)=>request.candidates.find((candidate:any)=>candidate.id===id).title);
      }catch(error){current.failure=String(error).replace(/https?:\/\/\S+/g,'[source]');}
      current.seconds=(Date.now()-started)/1000;results.push(current);console.log(JSON.stringify(current));
      writeFileSync(join(out,'result.json'),JSON.stringify({at:new Date().toISOString(),submissions,results,productionEdited:false},null,2));
      if(current.failure)break;
    }
  }
  app.exit(results.some(row=>row.failure)?1:0);
}).catch(error=>{console.error(String(error));app.exit(1);});
