import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Project,Scene} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryThematicRequirement,documentaryRepresentationIssue} from './documentary-thematic.js';
import {documentaryScriptEvidence,documentaryScriptEvidenceIssue,documentaryScriptRequirements} from './documentary-script-evidence.js';
import {documentarySavedContextIssue} from './documentary-context-approval.js';

const narration='The car brakes on wet asphalt.';
const scene={id:'s',narration,order:0,audioPath:'paid.mp3',documentary:{requirement:{text:narration,entities:['car'],identities:[],years:[],queries:['car braking wet road']}}} as unknown as Scene;
const row={id:'s',scriptText:narration,subject:'road traffic',queries:['car traffic road','cars highway']};
const project={id:'p',settings:{assembly:{documentary:{version:2,matchMode:'thematic'}}},scenes:[scene]} as Project;

test('a filmed toy cannot approve the real subject in thematic mode; explicit toys remain valid',()=>{
  const review={status:'accepted',reason:'The video clearly shows a toy train with wheels moving on plastic tracks/rails.'};
  assert.match(documentaryRepresentationIssue('Колёса вагонов движутся по рельсам.',review)!,/игрушку/);
  assert.equal(documentaryRepresentationIssue('Дети запускают игрушечный поезд.',review),undefined);
  assert.equal(documentaryRepresentationIssue('Колёса вагонов движутся по рельсам.',{reason:'Real train wheels rolling on steel tracks.'}),undefined);
  assert.equal(documentaryRepresentationIssue('The car drives on the road.',{reason:'A 2024 model car drives past the camera.'}),undefined);
  assert.equal(documentaryRepresentationIssue('Train wheels.',{reason:'This is a real train, not a toy.'}),undefined);
  assert.equal(documentaryRepresentationIssue('Train wheels.',{reason:42,scriptEvidence:{checks:[null,{evidence:123}]}}),undefined);
});

test('thematic plan preserves original script/plan and requires explicit validation mode',()=>{
  const req=documentaryThematicRequirement(scene,row)!;
  assert.equal(scene.narration,narration);assert.equal(scene.audioPath,'paid.mp3');
  assert.deepEqual(req.literalRequirement,scene.documentary!.requirement);
  assert.equal(documentaryScriptRequirements(req.scriptRequirements,narration),undefined);
  assert.ok(documentaryScriptRequirements(req.scriptRequirements,narration,true));
  const checks=req.scriptRequirements!.checks.map(check=>({...check,requirementId:check.id,match:true,evidence:'Several real cars visible in the road.'}));
  const evidence={version:1 as const,scriptText:narration,checks};
  assert.equal(documentaryScriptEvidenceIssue(evidence,true,[.1,2,4],req.scriptRequirements),undefined);
  assert.ok(documentaryScriptEvidenceIssue({...evidence,checks:checks.map(c=>({...c,match:false}))},true,[.1,2,4],req.scriptRequirements));
  const actionLabel={...req.scriptRequirements!,checks:req.scriptRequirements!.checks.map(c=>({...c,required:'car braking wet road'}))};
  assert.equal(documentaryScriptEvidenceIssue({...evidence,checks:checks.map(c=>({...c,required:'car braking wet road'}))},true,[.1,2,4],actionLabel),undefined);
  const strict={...project,settings:{assembly:{documentary:{version:2}}}} as Project;
  assert.match(documentarySavedContextIssue(strict,{...scene,documentary:{...scene.documentary!,verified:true,requirement:req}})!,/Тематическая/);
});

test('thematic planning reuses completed paid rows and blocks an unknown batch',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-thematic-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let calls=0;
  const client={configured:async()=>true,documentaryCompletion:async()=>{calls++;return JSON.stringify({scenes:[row]});}};
  for(let i=0;i<2;i++){
    let saved=0;
    await new DocumentaryIntelligence(client,()=>root).resolveThematicTargets(project,[scene],async plan=>{saved+=plan.size;},{progress:()=>{},shouldStop:()=>false});
    assert.equal(saved,1);
  }
  assert.equal(calls,1);
  const dir=join(root,'Documentary','Analysis');await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'f'.repeat(64)+'.json'),JSON.stringify({state:'pending',purpose:'thematic-plan'}));
  await assert.rejects(()=>new DocumentaryIntelligence(client,()=>root).resolveThematicTargets(project,[scene],async()=>{},{progress:()=>{},shouldStop:()=>false}),/повтор не отправлен/);
  assert.equal(calls,1);
});

test('trimmed model JSON preserves exact narration and does not discard paid pixel evidence',()=>{
  const spaced={...scene,narration:narration+' '};
  const req=documentaryThematicRequirement(spaced,{...row,scriptText:spaced.narration})!;
  const raw={version:1,scriptText:narration,checks:[{requirementId:'theme',kind:'object',scriptQuote:narration,
    required:row.subject,match:true,evidence:'Real cars visible in the traffic lane.'}]};
  const evidence=documentaryScriptEvidence({scriptEvidence:raw},spaced.narration)!;
  assert.equal(evidence.scriptText,spaced.narration);
  assert.equal(documentaryScriptEvidenceIssue(evidence,true,[.1,2,4],req.scriptRequirements),undefined);
  assert.equal(documentaryScriptEvidence({scriptEvidence:{...raw,scriptText:'A different scene.'}},spaced.narration),undefined);
  const alias={...raw,checks:raw.checks.map(({requirementId,...check})=>({...check,id:requirementId}))};
  assert.equal(documentaryScriptEvidenceIssue(documentaryScriptEvidence({scriptEvidence:alias},spaced.narration)!,true,[.1,2,4],req.scriptRequirements),undefined);
  assert.equal(documentaryScriptEvidence({scriptEvidence:{...raw,checks:raw.checks.map(check=>({...check,id:'wrong'}))}},spaced.narration),undefined);
});

test('the local thematic submission binds a damaged echo to exact narration once and rejects a stale script',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-thematic-binding-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let calls=0;
  const client={configured:async()=>true,documentaryCompletion:async(_system:string,input:string)=>{
    calls++;
    const original=JSON.parse(input).scenes[0];
    return JSON.stringify({scenes:[{...row,id:original.id,scriptText:'Damaged model copy'}]});
  }};
  for(let pass=0;pass<2;pass++){
    let saved=0;
    await new DocumentaryIntelligence(client,()=>root).resolveThematicTargets(project,[scene],async plan=>{
      assert.equal(plan.get('s')!.scriptRequirements!.scriptText,narration);
      assert.equal(plan.get('s')!.literalRequirement!.text,narration);saved+=plan.size;
    },{progress:()=>{},shouldStop:()=>false});
    assert.equal(saved,1);
  }
  assert.equal(calls,1,'Completed topics are reused without a second paid echo repair');
  const edited={...scene,narration:'New original narration.'};
  await new DocumentaryIntelligence(client,()=>root).resolveThematicTargets({...project,scenes:[edited]},[edited],async plan=>{
    assert.equal(plan.get('s')!.scriptRequirements!.scriptText,edited.narration);
  },{progress:()=>{},shouldStop:()=>false});
  assert.equal(calls,2,'A changed original is not bound to the old submission');
});

test('compact thematic rows require unique known ids and valid topics even with a local submission',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-thematic-malformed-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const [index,rows] of [
    [{id:'s',subject:'road traffic',queries:['cars road']}],
    [{...row,id:'unknown'}],
    [row,row],
    [{...row,queries:[42]}],
  ].entries()){
    let calls=0;
    const client={configured:async()=>true,documentaryCompletion:async()=>{calls++;return JSON.stringify({scenes:rows});}};
    for(let pass=0;pass<2;pass++){
      const run=()=>new DocumentaryIntelligence(client,()=>join(root,String(index))).resolveThematicTargets(project,[scene],async plan=>{
        if(index===0)assert.equal(plan.get('s')!.scriptRequirements!.scriptText,narration);
        else assert.equal(plan.size,0,'Malformed rows cannot be saved as requirements');
      },{progress:()=>{},shouldStop:()=>false});
      if(index===0)await run();else await assert.rejects(run(),/некорректн/);
    }
    assert.equal(calls,1,'A malformed received row never causes an automatic paid retry');
  }
});
