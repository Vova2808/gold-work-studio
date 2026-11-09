import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Project} from '@gold-work/shared';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {AnyModelCompletionUncertainError} from './anymodel-client.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {listDocumentaryRecovery} from './documentary-retry.js';
import {semanticMontageHash} from './documentary-semantic-montage.js';
import {motionArtworkHash} from './documentary-artwork-plan.js';
import {createDocumentaryConceptPlan} from './documentary-concept-plan.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';

test('an unknown legacy concept retains the confirmed AI base and artwork path, with no receipt replay or swallowed abort',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-concept-base-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p={id:'concept-base',mediaMode:'stock',aspectRatio:'16:9',language:'en',settings:{voice:{enabled:true},music:{enabled:false,volume:10},
    assembly:{kenBurns:true,documentary:{version:2,autoEffects:false,autoTransitions:true,autoMotionGraphics:true,
      montage:{version:1,style:'editorial',intensity:'rich',hookSeconds:16,musicPolicy:'preserve'}}}},
    scenes:Array.from({length:2},(_,order)=>({id:`scene-${order}`,order,narration:'Ford raced in London in 1966.',durationSeconds:6,
      audioPath:`voice-${order}.wav`,imagePath:`image-${order}.jpg`,documentary:{verified:true,checksum:`hash-${order}`,layout:'full',effects:[],
        caption:{enabled:false,text:''},timing:{sourceKey:`voice-${order}`,durationInFrames:181,speechSeconds:5.9},
        selected:{id:`source-${order}`,kind:'image',width:1920,height:1080},
        requirement:{text:'Ford raced in London in 1966.',identities:[{name:'Ford'}],years:[1966],accent:'none'}}}))} as unknown as Project;
  const repo=new MemoryProjectRepository(),projects=new ProjectService(repo,new MockDirectorProvider());await repo.save(p);
  let prior:{system:string;input:string}|undefined;
  await createDocumentaryConceptPlan(p,{version:1,inputHash:semanticMontageHash(p),model:'old',hookSeconds:16,
    scenes:p.scenes.map(s=>({sceneId:s.id,subject:'Ford',beat:'evidence',treatment:'footage',cutawaySceneIds:[]}))},
    async(system,input)=>{prior={system,input};return {explanations:[]};});
  assert.ok(prior);
  const key=documentaryCheckpointKey('semantic-montage',prior.system,prior.input,[]),montage=join(root,'Documentary','Montage'),analysis=join(root,'Documentary','Analysis');
  await mkdir(montage,{recursive:true});await mkdir(analysis,{recursive:true});
  await writeFile(join(montage,semanticMontageHash(p)+'-concept-commission.json'),JSON.stringify({version:1,filmHash:semanticMontageHash(p),key,...prior}));
  await writeFile(join(analysis,key+'.json'),JSON.stringify({state:'pending',purpose:'semantic-montage',createdAt:new Date().toISOString()}));
  let baseCalls=0,conceptCalls=0,artworkCalls=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryQueryModel:async()=> 'fixture',
    documentaryCompletion:async(_system,input)=>{
      const payload=JSON.parse(input);
      if(payload.motionConcepts===1){conceptCalls++;throw new AnyModelCompletionUncertainError('concept result unknown');}
      baseCalls++;
      return JSON.stringify({scenes:payload.scenes.map((s:{sceneId:string})=>({sceneId:s.sceneId,subject:'Ford',beat:'evidence',treatment:'footage',cutawaySceneIds:[]}))});
    }},()=>root);
  const service=new DocumentaryProjectService(projects,{projectDirectory:()=>root,ensureProject:async()=>{}} as never,{} as never,root,{} as never,()=>{},
    {planSemanticMontage:intelligence.planSemanticMontage.bind(intelligence),planMotionArtwork:async(input:Project)=>{
      artworkCalls++;
      assert.deepEqual(input.scenes.map(s=>s.documentary?.semanticMontage?.subject),['Ford','Ford'],'artwork receives the confirmed base directions');
      return {version:1,inputHash:motionArtworkHash(input),model:'artwork-fixture',scenes:[],rejected:[]};
    }} as never);
  const result=await service.prepareMontage(p.id),status=result.settings.assembly.documentary!.semanticMontageStatus!;
  assert.equal(status.status,'planned');
  assert.match(status.message,/Базовый AI-монтаж сохранён, концептуальные вставки недоступны/u);
  assert.equal(result.settings.assembly.documentary!.motionArtworkStatus?.status,'planned');
  assert.equal(artworkCalls,1);assert.equal(baseCalls,1);assert.equal(conceptCalls,0);
  assert.deepEqual(result.scenes.map(s=>[s.narration,s.audioPath,s.documentary!.timing]),p.scenes.map(s=>[s.narration,s.audioPath,s.documentary!.timing]));
  const baseFile=join(root,'Documentary','Montage',semanticMontageHash(p)+'.json'),base=await readFile(baseFile,'utf8');
  const unknown=await listDocumentaryRecovery(root);assert.equal(unknown.length,1);
  const receiptFile=join(root,'Documentary','Analysis',unknown[0]!.id+'.json'),receipt=await readFile(receiptFile,'utf8');
  const resumed=await intelligence.planSemanticMontage(p);
  assert.equal(resumed.scenes.length,2);assert.ok(resumed.conceptWarning);
  assert.equal(baseCalls,1);assert.equal(conceptCalls,0,'unknown optional commission must not be submitted again');
  assert.equal(await readFile(baseFile,'utf8'),base);assert.equal(await readFile(receiptFile,'utf8'),receipt);
  const cached=await service.prepareMontage(p.id);
  const resumedMessage=cached.settings.assembly.documentary!.semanticMontageStatus!.message;
  assert.equal(resumedMessage.split(' AI-графика:')[0],status.message.split(' AI-графика:')[0],'routine cached assembly retains the warning');
  assert.equal(resumedMessage.match(/AI-графика:/gu)?.length,1,'artwork status is not duplicated');
  assert.equal(artworkCalls,1);

  // Exercise the owned boundary directly; paid-checkpoint classification has
  // already been exercised above through the real completion machinery.
  const boundary=intelligence as unknown as {completeConceptCommission:()=>Promise<Record<string,unknown>>};
  for(const failure of [new DOMException('Stopped','AbortError'),Object.assign(new Error('Disk full'),{code:'ENOSPC'})]){
    const stub=t.mock.method(boundary,'completeConceptCommission',async()=>{throw failure;});
    await assert.rejects(intelligence.planSemanticMontage(p),error=>error===failure);stub.mock.restore();
  }
  const controller=new AbortController(),reason=new DOMException('Stopped during concepts','AbortError');
  const stub=t.mock.method(boundary,'completeConceptCommission',async()=>{controller.abort(reason);throw new DocumentaryAnalysisError('optional service failed');});
  await assert.rejects(intelligence.planSemanticMontage(p,controller.signal),error=>error===reason);stub.mock.restore();
});
