// One authorized live regression: a complete JSON result for three real ranges.
// Reads an existing source, writes analysis evidence only, never edits the movie.
import assert from 'node:assert/strict';
import {app} from 'electron';
import {copyFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Project} from '@gold-work/shared';
import {AnyModelClient} from '../src/anymodel-client.js';
import {AnyModelStore} from '../src/anymodel-store.js';
import {DocumentaryIntelligence} from '../src/documentary-intelligence.js';
import {inspectDocumentaryRangeBatch} from '../src/documentary-range-batch.js';
import {readVideoFrames} from '../src/documentary-video-catalog.js';
import {setDiagnosticSink} from '../src/diagnostics.js';

assert.ok(process.argv.includes('--paid'));
const profile=join(process.env.APPDATA!,'@gold-work/desktop');
const out=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001/range-budget-live');
assert.ok(!existsSync(join(out,'started.json')),'Inspect the saved request, never blindly resubmit');
mkdirSync(join(out,'profile'),{recursive:true});
copyFileSync(join(profile,'Local State'),join(out,'profile','Local State'));
app.setPath('userData',join(out,'profile'));
app.whenReady().then(async()=>{
  const queue=JSON.parse(await readFile(join(profile,'queue.json'),'utf8'));
  assert.ok(!queue.some((task:{status:string})=>['running','pending','retry_wait'].includes(task.status)));
  const project=JSON.parse(await readFile(resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001/evening-additional/project.json'),'utf8')) as Project;
  const scene=[...project.scenes].sort((a,b)=>a.order-b.order).find(s=>s.documentary?.verified&&s.documentary.selected?.kind==='video'&&(s.documentary.selected.durationSeconds??0)>30&&s.videoPath&&existsSync(s.videoPath))!;
  assert.ok(scene,'An existing verified source is required');
  const duration=scene.documentary!.selected!.durationSeconds!;
  const regions=[.16,.48,.80].map((fraction,id)=>({id,startSeconds:Math.round(duration*fraction*1000)/1000,endSeconds:Math.round(duration*fraction*1000)/1000+3}));
  const client=new AnyModelClient(new AnyModelStore(join(profile,'credentials/anymodel.json')));
  let submissions=0;const usage:unknown[]=[];
  setDiagnosticSink((_level,event,data)=>{if(event==='anymodel.completion.usage')usage.push({input:data.inputCount,output:data.outputCount,total:data.totalCount});});
  const intelligence=new DocumentaryIntelligence(client,id=>join('D:/GoldWorkStorage/projects',id),async()=>{assert.ok(submissions<1,'Only one new paid request');submissions++;});
  writeFileSync(join(out,'started.json'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,projectId:project.id,scene:scene.order+1,regions},null,2));
  const started=Date.now();let failure:string|undefined,reviews:unknown;
  try{
    const result=await inspectDocumentaryRangeBatch({file:scene.videoPath!,root:join(out,'frames'),request:{narration:scene.narration,narrationContext:scene.narration,source:{title:scene.documentary!.selected!.title}},identities:scene.documentary!.requirement.identities,regions,
      complete:(purpose,system,input,images)=>(intelligence as any).complete(project.id,purpose,system,input,images)});
    reviews=[...result].map(([range,review])=>({range,...review}));
    assert.equal(result.size,3);
    assert.ok([...result.values()].every(review=>typeof review.id==='number'&&typeof review.technicalQuality==='object'),'All three original complete reviews are required');
    const samples=await readVideoFrames(scene.videoPath!,join(out,'frames'),regions.map(region=>region.startSeconds+1.5));
    samples.forEach((url,id)=>writeFileSync(join(out,`range-${id}.jpg`),Buffer.from(url.slice(url.indexOf(',')+1),'base64')));
  }catch(error){failure=String(error).replace(/https?:\/\/\S+/g,'[source]');}
  const result={at:new Date().toISOString(),seconds:(Date.now()-started)/1000,submissions,usage,reviews,failure,productionEdited:false,note:'Known downloaded source, not a new footage-search or full-film benchmark.'};
  writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.exit(failure?1:0);
}).catch(error=>{console.error(String(error));app.exit(1);});
