import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Project,Scene} from '@gold-work/shared';
import {DocumentaryIntelligence,explanationFeedbackRequest,validateExplanationFeedback,type ExplanationFeedbackHooks} from './documentary-intelligence.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {documentaryExplanationSpans} from './documentary-explanation.js';
import {AnyModelProviderResponseError} from './anymodel-client.js';

function fixture():Project{
  const scenes=['Does the rider or ','the racing motorcycle make the difference?','A later unrelated thought.'].map((narration,order)=>({
    id:`s${order}`,order,narration,durationSeconds:4,imagePath:`${order}.jpg`,documentary:{verified:true,layout:'full',effects:[],
      template:'full',templateOrigin:'automatic',caption:{enabled:false,text:''},timing:{durationInFrames:120},
      requirement:{text:narration,identities:[],years:[],queries:[]},
      semanticMontage:{sceneId:`s${order}`,subject:'',beat:'explain',treatment:'footage',cutawaySceneIds:[]}}})) as unknown as Scene[];
  scenes[0]!.documentary!.semanticMontage!.explanation={kind:'contrast',endSceneId:'s1',nodes:[
    {id:'a',label:'the rider',symbol:'person'},{id:'b',label:'the racing motorcycle',symbol:'machine'}]};
  const p={id:'explanation-feedback-source',mediaMode:'stock',aspectRatio:'16:9',language:'en',scenes,
    settings:{assembly:{fps:30,documentary:{version:2,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich'}}}}} as unknown as Project;
  const spans=documentaryExplanationSpans(p);
  for(const scene of scenes.slice(0,2))scene.documentary!.motionGraphic={kind:'explainer',enabled:true,origin:'automatic',title:'',hideTitle:true,
    explanation:spans.get(scene.id),sequenceId:spans.get(scene.id)!.sequence!.id,startSeconds:0,durationSeconds:4,theme:'paper'};
  return p;
}
function accepted(p=fixture()){
  const explanation=structuredClone(p.scenes[0]!.documentary!.semanticMontage!.explanation!);
  explanation.nodes[1]={...explanation.nodes[1]!,symbol:'motorcycle',objectType:'motorcycle'};
  return {sceneId:'s0',status:'accepted',explanation};
}
const hooks=():ExplanationFeedbackHooks=>({assertCurrent:async()=>{},onIdentity:async()=>{},onDispatch:async()=>{}});

test('natural unbranded request freezes the existing thought and rejects expanded, nonliteral and mismatched native output',()=>{
  const p=fixture(),snapshot=structuredClone(p),request=explanationFeedbackRequest(p,'s0','Show the vehicle as its real object type.','before');
  assert.deepEqual(request.sceneIds,['s0','s1']);assert.equal(request.scenes[0]!.narration,p.scenes[0]!.narration);
  assert.equal(request.scenes[0]!.durationInFrames,120);
  assert.equal(explanationFeedbackRequest(p,'s0','  Show the vehicle as its real object type.  ','before').operationKey,request.operationKey);
  assert.equal(validateExplanationFeedback(accepted(),request,p).nodes[1]!.objectType,'motorcycle');
  for(const response of [
    {...accepted(),sceneId:'s2'},
    {...accepted(),explanation:{...accepted().explanation,endSceneId:'s2'}},
    {...accepted(),explanation:{...accepted().explanation,endSceneId:undefined}},
    {...accepted(),explanation:{...accepted().explanation,nodes:[accepted().explanation.nodes[0],{id:'b',label:'invented winner',symbol:'motorcycle',objectType:'motorcycle'}]}},
    {...accepted(),explanation:{...accepted().explanation,nodes:[accepted().explanation.nodes[0],{...accepted().explanation.nodes[1],symbol:'machine'}]}},
    {sceneId:'s0',status:'refused',reason:'Literal technical construction is unsupported'},
  ])assert.throws(()=>validateExplanationFeedback(response,request,p),/отклонена|validator|span/);
  assert.deepEqual(p,snapshot);
  for(const change of [
    (q:Project)=>{q.scenes[1]!.documentary!.pinned=true;},
    (q:Project)=>{q.scenes[0]!.documentary!.motionGraphic!.origin='manual';},
    (q:Project)=>{q.scenes[1]!.documentary!.templateOrigin='manual';},
  ]){const q=fixture();change(q);assert.throws(()=>explanationFeedbackRequest(q,'s0','change','before'),/редактируемой|ручную|span/);}
});

test('actual intelligence text boundary records the exact Analysis key, one-attempt transport and complete cache reuse',async()=>{
  const root=await mkdtemp(join(tmpdir(),'explanation-intelligence-')),p=fixture(),request=explanationFeedbackRequest(p,'s0','Show its actual object type.','before');
  let calls=0,key='',submissions=0;const assertions:string[]=[];
  const client={configured:async()=>true,documentaryMontageModel:async()=>'mock-native-model',documentaryCompletion:async(...args:any[])=>{
    calls++;const [system,input,images]=args;const data=JSON.parse(input);
    assert.equal(data.explanationFeedback,1);assert.equal(data.motionArtwork,undefined);assert.equal(data.motionArtworkRevision,undefined);
    assert.equal(data.feedback,request.feedback);assert.deepEqual(data.sceneIds,request.sceneIds);assert.deepEqual(images,[]);
    assert.equal(documentaryCheckpointKey('semantic-montage',system,input,images),key);
    assert.deepEqual(args[8],{purpose:'semantic-montage',singleAttempt:true});
    assert.ok(system.includes('literal technical mechanisms'));
    assert.equal(JSON.parse(await readFile(join(root,'Documentary','Analysis',key+'.json'),'utf8')).state,'pending');
    return JSON.stringify(accepted());
  }};
  const ai=new DocumentaryIntelligence(client as never,()=>root);
  const guard:ExplanationFeedbackHooks={assertCurrent:async()=>{assertions.push('current');},onIdentity:async k=>{key=k;},onDispatch:async k=>{assert.equal(k,key);submissions++;}};
  const result=await ai.reviseExplanation(p,request,guard);assert.deepEqual(result,accepted());assert.equal(calls,1);assert.equal(submissions,1);
  assert.ok(assertions.length>=3);
  const restart=new DocumentaryIntelligence({...client,documentaryCompletion:async()=>{throw Error('replay forbidden');}} as never,()=>root);
  assert.deepEqual(await restart.reviseExplanation(p,request,{...guard,resumeOnly:true}),accepted());assert.equal(calls,1);assert.equal(submissions,1);
});

test('feedback dispatch guards fail closed both before pending persistence and immediately before the client',async()=>{
  for(const boundary of ['pending','client']){
    const root=await mkdtemp(join(tmpdir(),'explanation-stale-')),p=fixture(),request=explanationFeedbackRequest(p,'s0','change','before');
    let calls=0,key='',stale=false;
    const ai=new DocumentaryIntelligence({documentaryCompletion:async()=>{calls++;return '{}';}} as never,()=>root,
      async()=>{if(boundary==='pending')stale=true;});
    await assert.rejects(ai.reviseExplanation(p,request,{assertCurrent:async()=>{if(stale)throw Error('stale current');},
      onIdentity:async k=>{key=k;},onDispatch:async()=>{stale=true;}}),/stale current/);
    assert.equal(calls,0);
    const receipt=await readFile(join(root,'Documentary','Analysis',key+'.json'),'utf8').then(JSON.parse,()=>undefined);
    assert.equal(receipt?.state,boundary==='pending'?undefined:'pending');
  }
});

test('resume-only refuses pending/partial/UNKNOWN/invalid/missing receipts without a client call',async()=>{
  for(const state of ['pending','partial','UNKNOWN','invalid','missing']){
    const root=await mkdtemp(join(tmpdir(),'explanation-unresolved-')),p=fixture(),request=explanationFeedbackRequest(p,'s0','change','before');let calls=0;
    const ai=new DocumentaryIntelligence({documentaryCompletion:async()=>{calls++;return '{}';}} as never,()=>root);
    await assert.rejects(ai.reviseExplanation(p,request,{...hooks(),resumeOnly:true,onIdentity:async key=>{
      if(state==='missing')return;const dir=join(root,'Documentary','Analysis');await mkdir(dir,{recursive:true});
      await writeFile(join(dir,key+'.json'),JSON.stringify({state,purpose:'semantic-montage',raw:state==='partial'?'incomplete':undefined}));
    }}),/COMPLETE|неподдерживаем|сохранён|результат|повтор/i);
    assert.equal(calls,0,state);
  }
});

test('feedback 503 fails once without closing the shared analysis gate for an unrelated ordinary request',async()=>{
  const root=await mkdtemp(join(tmpdir(),'explanation-no-retry-')),p=fixture(),request=explanationFeedbackRequest(p,'s0','change','before');let calls=0;
  const ai=new DocumentaryIntelligence({documentaryCompletion:async()=>{calls++;if(calls===1)throw new AnyModelProviderResponseError('mock terminal refusal',503,0,true);return '{"ok":true}';}} as never,()=>root);
  await assert.rejects(ai.reviseExplanation(p,request,hooks()),/mock terminal refusal/);assert.equal(calls,1);
  assert.ok(Reflect.get(ai,'analysisLimit')>0);assert.equal(Reflect.get(ai,'analysisResume'),undefined);
  const started=Date.now();
  assert.deepEqual(await Reflect.get(ai,'complete').call(ai,'unrelated','semantic-montage','Independent ordinary request','{}',[]),{ok:true});
  assert.ok(Date.now()-started<1000,'independent mock work must proceed without manual gate repair');assert.equal(calls,2);
  await assert.rejects(ai.reviseExplanation(p,request,{...hooks(),resumeOnly:true}),/COMPLETE/);assert.equal(calls,2);
});
