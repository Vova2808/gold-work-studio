import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createDefaultProjectSettings,type Project,type DocumentaryArtwork} from '@gold-work/shared';
import {FileProjectRepository} from './file-project-repository.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {AnyModelProviderResponseError} from './anymodel-client.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {documentaryExplanationSpans} from './documentary-explanation.js';
import {semanticMontageHash} from './documentary-semantic-montage.js';
import {planDocumentaryMontage} from './documentary-montage.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {appliedArtworkFeedbackRows,artworkFeedbackRowsHash,artworkFeedbackProtectedInput} from './documentary-artwork-feedback.js';
import {buildDocumentaryTimeline} from '../../../packages/remotion-video/src/documentary-timeline.js';

const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const stable=(value:unknown):string=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const feedback={sceneId:'s1',feedback:'The picture should show the actual type of vehicle in this comparison.'};
function fixture():Project{
  const settings=createDefaultProjectSettings();settings.music.enabled=true;
  settings.assembly.documentary={version:2,pace:'balanced',backgroundColor:'#14252e',accentColor:'#83b7cd',textColor:'#ffffff',sfxVolume:25,captionsEnabled:false,
    autoEffects:false,autoTransitions:false,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve'}};
  const p={id:'native-feedback-service',title:'NEW source-only mock',topic:'comparison',mode:'standard',status:'ready',createdAt:'2026-10-29',updatedAt:'2026-10-29',
    mediaMode:'stock',aspectRatio:'16:9',language:'en',settings,outputPath:'old/Final.mp4',lastRender:{path:'old/Final.mp4'},
    scenes:Array.from({length:50},(_,order)=>({id:`s${order}`,order,title:'',imagePrompt:'',animationPrompt:'',
      narration:order===1?'Does the rider or the racing motorcycle make the difference?':`Preserved original narration ${order}.`,
      imagePath:`mock-source-${order}.jpg`,audioPath:`original-voice-${order}.mp3`,durationSeconds:5,status:'ready',sourceVolume:0,
      documentary:{verified:true,checksum:`source-checksum-${order}`,layout:'full',effects:[{id:`sfx${order}`,kind:'audio',role:'accent',enabled:true,origin:'manual',path:`sound-${order}.wav`}],
        candidates:[],template:'full',templateOrigin:'automatic',caption:{enabled:false,text:''},timing:{sourceKey:`voice-${order}`,durationInFrames:150,speechSeconds:4.8},
        selected:{id:`source-${order}`,kind:'image',width:1920,height:1080},requirement:{text:'comparison',identities:[],years:[],queries:[],accent:'none'},
        semanticMontage:{sceneId:`s${order}`,subject:'',beat:'explain',treatment:'footage',cutawaySceneIds:[]}}}))} as unknown as Project;
  p.videoBrief={creationMode:'script',readyScript:p.scenes.map(s=>s.narration).join('\n')} as Project['videoBrief'];
  p.scenes[1]!.documentary!.semanticMontage!.explanation={kind:'contrast',nodes:[{id:'a',label:'the rider',symbol:'person'},
    {id:'b',label:'the racing motorcycle',symbol:'machine'}]};
  const native=documentaryExplanationSpans(p).get('s1')!;
  p.scenes[1]!.documentary!.motionGraphic={kind:'explainer',enabled:true,origin:'automatic',title:'',hideTitle:true,explanation:native,sequenceId:native.sequence!.id,startSeconds:0,durationSeconds:5,theme:'paper'};
  // A previously accepted drawing on another scene is deliberately retained byte-for-byte.
  const artwork={version:1,intent:'OLD mock artwork',layout:'full',motionCoordinates:'absolute',canvas:{width:1000,height:562},
    palette:{background:'#14252e',ink:'#ffffff',accent:'#83b7cd',secondary:'#c7b176'},startSeconds:0,durationSeconds:5,
    layers:[{id:'object',kind:'rect',x:50,y:150,w:300,h:200,fill:'accent',keyframes:[{t:0,x:50},{t:1,x:500}]}]} as DocumentaryArtwork;
  p.scenes[0]!.documentary!.semanticMontage!.artwork=artwork;
  p.scenes[0]!.documentary!.motionGraphic={kind:'explainer',enabled:true,origin:'automatic',title:'',artwork,startSeconds:0,durationSeconds:5};
  const hash=semanticMontageHash(p);for(const s of p.scenes)s.documentary!.semanticMontageInputHash=hash;
  p.settings.assembly.documentary!.semanticMontageStatus={status:'planned',inputHash:hash,message:'OLD saved plan'};
  p.settings.assembly.documentary!.motionArtworkStatus={status:'planned',inputHash:'old-artwork-hash',message:'OLD applied artwork',incomplete:false};
  p.settings.assembly.documentary!.activeArtworkFeedback={status:'applied',operationKey:'a'.repeat(64),resultArtworkHash:artworkFeedbackRowsHash(appliedArtworkFeedbackRows(p))} as never;
  return p;
}
function response(project:Project){
  const explanation=structuredClone(project.scenes[1]!.documentary!.semanticMontage!.explanation!);
  explanation.nodes[1]={...explanation.nodes[1]!,symbol:'motorcycle',objectType:'motorcycle'};
  return {sceneId:'s1',status:'accepted',explanation};
}
async function harness(options:{beforePaid?:()=>Promise<void>;reply?:(data:any)=>Promise<unknown>;afterComplete?:()=>Promise<void>;
  beforeRead?:()=>Promise<void>;beforeMutation?:()=>Promise<void>}={}){
  const root=await mkdtemp(join(tmpdir(),'native-feedback-service-')),storage=new LocalProjectStorage(join(root,'projects'));
  const repo=new FileProjectRepository(join(root,'projects.json')),projects=new ProjectService(repo,new MockDirectorProvider());await repo.save(fixture());
  const p=(await projects.get('native-feedback-service'))!,projectRoot=storage.projectDirectory(p.id);await mkdir(projectRoot,{recursive:true});
  await writeFile(join(projectRoot,'Final.mp4'),'OLD MOCK export bytes');await writeFile(join(projectRoot,'old-render.marker.json'),'OLD MOCK marker');
  let calls=0;
  const makeService=(paid=options.beforePaid,model='mock-native')=>{
    const ai=new DocumentaryIntelligence({configured:async()=>true,documentaryMontageModel:async()=>model,documentaryCompletion:async(_system:string,text:string)=>{
      calls++;return JSON.stringify(await options.reply?.(JSON.parse(text))??response(p));
    }} as never,()=>projectRoot,paid);
    if(options.afterComplete){const revise=ai.reviseExplanation.bind(ai);ai.reviseExplanation=async(...args)=>{
      const result=await revise(...args);await options.afterComplete!();return result;
    };}
    const reopened=new ProjectService(new FileProjectRepository(join(root,'projects.json')),new MockDirectorProvider());
    if(options.beforeRead){const get=reopened.get.bind(reopened);reopened.get=async(...args)=>{await options.beforeRead!();return get(...args);};}
    if(options.beforeMutation){const mutate=reopened.mutate.bind(reopened);reopened.mutate=async(...args)=>{await options.beforeMutation!();return mutate(...args);};}
    return new DocumentaryProjectService(reopened,storage,{} as never,root,{} as never,()=>{},ai);
  };
  return {root,projectRoot,storage,projects,repo,p,service:makeService(),makeService,calls:()=>calls,
    current:async()=>(await projects.get(p.id))!,
    operation:async()=>{const dir=join(projectRoot,'Documentary','Montage','explanation-feedback'),names=await readdir(dir);assert.equal(names.length,1);
      const path=join(dir,names[0]!);return {path,value:JSON.parse(await readFile(path,'utf8'))};}};
}

test('unbranded valid response applies once, preserves the other 49 records and all original tracks, restart never dispatches own output',async()=>{
  const h=await harness(),before=structuredClone(h.p);
  const a=h.service.reviseExplanation(h.p.id,feedback),b=h.service.reviseExplanation(h.p.id,feedback);
  assert.equal(a,b);const after=await a;assert.equal(h.calls(),1);
  assert.deepEqual(after.scenes.filter(s=>s.id!=='s1'),before.scenes.filter(s=>s.id!=='s1'));
  assert.deepEqual(after.settings,before.settings);assert.deepEqual(after.videoBrief,before.videoBrief);
  assert.deepEqual(after.scenes.map(s=>s.audioPath),before.scenes.map(s=>s.audioPath));
  const d=structuredClone(after.scenes[1]!),original=structuredClone(before.scenes[1]!);
  d.documentary!.semanticMontage!.explanation=original.documentary!.semanticMontage!.explanation;
  d.documentary!.motionGraphic=original.documentary!.motionGraphic;assert.deepEqual(d,original);
  assert.equal(after.scenes[1]!.documentary!.motionGraphic!.explanation!.nodes[1]!.objectType,'motorcycle');
  assert.equal(after.outputPath,undefined);assert.equal(after.lastRender,undefined);
  assert.equal(await readFile(join(h.projectRoot,'Final.mp4'),'utf8'),'OLD MOCK export bytes');
  assert.equal(await readFile(join(h.projectRoot,'old-render.marker.json'),'utf8'),'OLD MOCK marker');
  const op=(await h.operation()).value;assert.ok(op.startedAt&&op.analysisKey&&op.dispatchAt&&op.resultAt&&op.afterHash&&op.appliedAt);
  const receipt=JSON.parse(await readFile(join(h.projectRoot,'Documentary','Analysis',op.analysisKey+'.json'),'utf8'));assert.equal(receipt.state,'complete');
  const restart=h.makeService();assert.deepEqual(await restart.reviseExplanation(h.p.id,feedback),await h.projects.get(h.p.id,{omitCandidates:true}));assert.equal(h.calls(),1);
  const prepared=await restart.prepareMontage(h.p.id);assert.deepEqual(prepared,await h.projects.get(h.p.id,{omitCandidates:true}));assert.equal(h.calls(),1);
  const assembled=planDocumentaryMontage(prepared),target=assembled.find(s=>s.id==='s1')!;
  assert.equal(target.documentary!.motionGraphic!.explanation!.nodes[1]!.objectType,'motorcycle');
  assert.deepEqual(assembled[0]!.documentary!.motionGraphic!.artwork,before.scenes[0]!.documentary!.motionGraphic!.artwork);
  assert.equal(buildDocumentaryTimeline({...prepared,scenes:assembled}).scenes.find(s=>s.id==='s1')!.documentary!.motionGraphic!.explanation!.nodes[1]!.objectType,'motorcycle');
});

test('start, pending, partial, UNKNOWN, invalid and missing trustworthy receipt block identical and changed feedback/model after restart',async()=>{
  for(const state of ['start','pending','partial','UNKNOWN','invalid','received','missing','complete-without-result']){
    const h=await harness({beforePaid:async()=>{throw Error('mock interrupted before pending');}});
    await assert.rejects(h.service.reviseExplanation(h.p.id,feedback),/mock interrupted/);assert.equal(h.calls(),0);
    const {path,value}=await h.operation();
    if(state==='start'){delete value.analysisKey;await writeFile(path,JSON.stringify(value));}
    else if(state!=='missing'){
      const dir=join(h.projectRoot,'Documentary','Analysis');await mkdir(dir,{recursive:true});
      await writeFile(join(dir,value.analysisKey+'.json'),JSON.stringify({state:state==='complete-without-result'?'complete':state,purpose:'semantic-montage',raw:'mock partial'}));
    }
    const restart=h.makeService(undefined,'changed-mock-model');
    await assert.rejects(restart.reviseExplanation(h.p.id,feedback),/неизвестен|trustworthy|COMPLETE/);
    await assert.rejects(restart.reviseExplanation(h.p.id,{...feedback,feedback:'A different remark must not bypass the unresolved request.'}),/Исход предыдущей/);
    assert.equal(h.calls(),0,state);assert.deepEqual(await h.current(),h.p);
  }
});

test('COMPLETE invalid/refused output is durable and never repaired by another paid input',async()=>{
  for(const reply of [
    (p:Project)=>({...response(p),sceneId:'wrong'}),
    (p:Project)=>({...response(p),explanation:{...response(p).explanation,endSceneId:'s2'}}),
    (p:Project)=>({...response(p),explanation:{...response(p).explanation,nodes:[{id:'a',label:'invented label',symbol:'generic'},{id:'b',label:'the rider',symbol:'person'}]}}),
    (p:Project)=>({...response(p),explanation:{...response(p).explanation,nodes:[response(p).explanation.nodes[0],{...response(p).explanation.nodes[1],symbol:'machine'}]}}),
    ()=>({sceneId:'s1',status:'refused',reason:'The literal technical mechanism has no faithful native shape.'}),
  ]){
    const h=await harness({reply:async()=>reply(fixture())});
    await assert.rejects(h.service.reviseExplanation(h.p.id,feedback),/отклонена|validator|span/);assert.equal(h.calls(),1);
    await assert.rejects(h.makeService().reviseExplanation(h.p.id,feedback),/отклонена|validator|span/);
    await assert.rejects(h.makeService().reviseExplanation(h.p.id,{...feedback,feedback:'Changed text'}),/Исход предыдущей/);
    assert.equal(h.calls(),1);assert.deepEqual(await h.current(),h.p);
  }
});

test('an interrupted actual mock client call keeps its dispatch receipt and blocks changed feedback/model',async()=>{
  const h=await harness({reply:async()=>{throw Error('mock client outcome UNKNOWN');}});
  await assert.rejects(h.service.reviseExplanation(h.p.id,feedback),/UNKNOWN/);assert.equal(h.calls(),1);
  const op=(await h.operation()).value;assert.ok(op.analysisKey&&op.dispatchAt);assert.equal(op.appliedAt,undefined);
  const receipt=JSON.parse(await readFile(join(h.projectRoot,'Documentary','Analysis',op.analysisKey+'.json'),'utf8'));assert.equal(receipt.state,'pending');
  await assert.rejects(h.makeService(undefined,'another-model').reviseExplanation(h.p.id,feedback),/COMPLETE/);
  await assert.rejects(h.makeService(undefined,'another-model').reviseExplanation(h.p.id,{...feedback,feedback:'Changed feedback'}),/Исход предыдущей/);
  assert.equal(h.calls(),1);assert.deepEqual(await h.current(),h.p);
});

test('stale before pending and after complete never dispatches or applies an obsolete edit',async()=>{
  for(const phase of ['before','after']){
    let h:Awaited<ReturnType<typeof harness>>;
    const alter=async()=>{await h.projects.mutate(h.p.id,current=>({scenes:current.scenes.map(s=>s.id==='s49'?{...s,narration:s.narration+' changed'}:s)}));};
    h=await harness({beforePaid:phase==='before'?alter:undefined,reply:async()=>{if(phase==='after')await alter();return response(fixture());}});
    await assert.rejects(h.service.reviseExplanation(h.p.id,feedback),/изменились/);assert.equal(h.calls(),phase==='before'?0:1);
    assert.deepEqual((await h.current()).scenes[1],h.p.scenes[1]);
    await assert.rejects(h.makeService().reviseExplanation(h.p.id,feedback),/изменился/);assert.equal(h.calls(),phase==='before'?0:1);
  }
});

test('project-save-before-application-receipt recovers with COMPLETE reuse and zero new dispatch',async()=>{
  const h=await harness(),ensure=h.storage.ensureProject.bind(h.storage);let fail=true;
  h.storage.ensureProject=async(...args)=>{if(fail){fail=false;throw Error('mock crash after repository save');}return ensure(...args);};
  await assert.rejects(h.service.reviseExplanation(h.p.id,feedback),/mock crash/);
  const op=(await h.operation()).value;assert.ok(op.afterHash);assert.equal(op.appliedAt,undefined);assert.equal(h.calls(),1);
  const after=await h.makeService().reviseExplanation(h.p.id,feedback);assert.equal(h.calls(),1);
  assert.equal(after.scenes[1]!.documentary!.semanticMontage!.explanation!.nodes[1]!.objectType,'motorcycle');
  const projectFile=JSON.parse(await readFile(join(h.projectRoot,'project.json'),'utf8'));
  assert.equal(projectFile.scenes[1].documentary.semanticMontage.explanation.nodes[1].objectType,'motorcycle');
  assert.ok((await h.operation()).value.appliedAt);
});

test('crash after COMPLETE before result receipt reuses the same Analysis response without another client dispatch',async()=>{
  let fail=true;
  const h=await harness({afterComplete:async()=>{if(fail){fail=false;throw Error('mock crash after COMPLETE');}}});
  await assert.rejects(h.service.reviseExplanation(h.p.id,feedback),/mock crash after COMPLETE/);assert.equal(h.calls(),1);
  const op=(await h.operation()).value;assert.ok(op.analysisKey&&op.dispatchAt);assert.equal(op.result,undefined);assert.deepEqual(await h.current(),h.p);
  const after=await h.makeService().reviseExplanation(h.p.id,feedback);assert.equal(h.calls(),1);
  assert.equal(after.scenes[1]!.documentary!.motionGraphic!.explanation!.nodes[1]!.objectType,'motorcycle');
});

test('manual target refuses before start without a mock submission',async()=>{
  const h=await harness();await h.projects.mutate(h.p.id,current=>({scenes:current.scenes.map(s=>s.id==='s1'?{...s,documentary:{...s.documentary!,templateOrigin:'manual' as const}}:s)}));
  const before=await h.current();await assert.rejects(h.service.reviseExplanation(h.p.id,feedback),/редактируемой|ручную/);assert.equal(h.calls(),0);
  assert.deepEqual(await h.current(),before);
});

test('historical artwork snapshot remains immutable and explicit reviseSavedArtwork fails its stale guard after a legitimate explanation edit',async()=>{
  const h=await harness(),base=appliedArtworkFeedbackRows(h.p),protectedInput=await artworkFeedbackProtectedInput(h.p,base,h.projectRoot);
  const parentKey=sha('mock historical COMPLETE parent'),parentResult={legacy:'source-only fixture'},raw=JSON.stringify({state:'complete',result:parentResult});
  const analysis=join(h.projectRoot,'Documentary','Analysis');await mkdir(analysis,{recursive:true});await writeFile(join(analysis,parentKey+'.json'),raw);
  const parents=[{analysisKey:parentKey,inputSha256:sha('parent input'),resultSha256:sha(stable(parentResult)),files:[{path:`Documentary/Analysis/${parentKey}.json`,sha256:sha(raw)}]}];
  const normalizedFeedback='OLD historical mock',baseHash=artworkFeedbackRowsHash(base);
  const key=sha(stable({contract:1,feedback:normalizedFeedback,protectedInput:protectedInput.hash,base:baseHash,parents}));
  const input=JSON.stringify({operationKey:key,userFeedback:normalizedFeedback,protectedInputHash:protectedInput.hash,baseArtworkHash:baseHash,parents}),system='OLD mock request';
  const request={version:1,operationKey:key,projectId:h.p.id,feedback:normalizedFeedback,normalizedFeedback,protectedInput:protectedInput.value,protectedInputHash:protectedInput.hash,
    base,baseArtworkHash:baseHash,parents,system,input,images:[],imageHashes:[],inputSha256:sha(input),analysisKey:documentaryCheckpointKey('semantic-montage',system,input,[])};
  const dir=join(h.projectRoot,'Documentary','Montage','feedback',key);await mkdir(dir,{recursive:true});
  const requestBytes=JSON.stringify(request),resultBytes=JSON.stringify({feedback:{resultArtworkHash:baseHash},scenes:base});
  await writeFile(join(dir,'request.json'),requestBytes);await writeFile(join(dir,'result.json'),resultBytes);
  await h.projects.mutate(h.p.id,current=>({settings:{...current.settings,assembly:{...current.settings.assembly,documentary:{...current.settings.assembly.documentary!,
    activeArtworkFeedback:{...current.settings.assembly.documentary!.activeArtworkFeedback!,operationKey:key}}}}}));
  const after=await h.service.reviseExplanation(h.p.id,feedback);assert.equal(h.calls(),1);
  assert.notEqual((await artworkFeedbackProtectedInput(after,base,h.projectRoot)).hash,protectedInput.hash);
  assert.deepEqual(JSON.parse(JSON.stringify(await h.service.prepareMontage(h.p.id))),JSON.parse(JSON.stringify(await h.projects.get(h.p.id,{omitCandidates:true}))));assert.equal(h.calls(),1);
  await assert.rejects(h.service.prepareMontage(h.p.id,undefined,{reviseSavedArtwork:true}),/применённая доработка не соответствует текущим входам/);
  assert.equal(h.calls(),1);assert.deepEqual((await h.current()).scenes,after.scenes);
  assert.equal(await readFile(join(dir,'request.json'),'utf8'),requestBytes);assert.equal(await readFile(join(dir,'result.json'),'utf8'),resultBytes);
  assert.equal((await h.current()).settings.assembly.documentary!.activeArtworkFeedback!.operationKey,key);
});

test('initial generating, paused and active auto-selection refuse before start with zero dispatch or project writes',async()=>{
  for(const mode of ['generating','paused','auto-selection'] as const){
    const h=await harness();
    if(mode==='auto-selection')(Reflect.get(h.service,'autoRuns') as Map<string,Promise<unknown>>).set(h.p.id,Promise.resolve({}));
    else await h.projects.mutate(h.p.id,()=>({status:mode}));
    const before=await readFile(join(h.root,'projects.json'));
    await assert.rejects(h.service.reviseExplanation(h.p.id,feedback),/подбора|производство/);assert.equal(h.calls(),0,mode);
    assert.deepEqual(await readFile(join(h.root,'projects.json')),before);
    await assert.rejects(readdir(join(h.projectRoot,'Documentary','Montage','explanation-feedback')),e=>(e as NodeJS.ErrnoException).code==='ENOENT');
  }
});

test('busy transitions before pending, at client, after response and inside the application callback never apply or bypass the durable operation',async()=>{
  for(const phase of ['pending','client','response','mutation'])for(const mode of ['generating','paused','auto-selection'] as const){
    let h:Awaited<ReturnType<typeof harness>>,busy=false;
    const becomeBusy=async()=>{
      if(busy)return;busy=true;
      if(mode==='auto-selection')(Reflect.get(h.service,'autoRuns') as Map<string,Promise<unknown>>).set(h.p.id,Promise.resolve({}));
      else await h.projects.mutate(h.p.id,()=>({status:mode}));
    };
    h=await harness({beforePaid:phase==='pending'?becomeBusy:undefined,
      beforeRead:phase==='client'?async()=>{
        const record=await h.operation().catch(()=>undefined);if(!record?.value.dispatchAt)return;
        const receipt=JSON.parse(await readFile(join(h.projectRoot,'Documentary','Analysis',record.value.analysisKey+'.json'),'utf8'));
        if(receipt.state==='pending')await becomeBusy();
      }:undefined,
      reply:async()=>{if(phase==='response')await becomeBusy();return response(fixture());},
      beforeMutation:phase==='mutation'?becomeBusy:undefined});
    await assert.rejects(h.service.reviseExplanation(h.p.id,feedback),/подбора|производство/);assert.ok(busy,phase+mode);
    assert.equal(h.calls(),phase==='pending'||phase==='client'?0:1,phase+mode);
    const current=await h.current();assert.deepEqual(current.scenes,h.p.scenes);assert.deepEqual(current.settings,h.p.settings);
    assert.equal(current.outputPath,h.p.outputPath);assert.deepEqual(current.lastRender,h.p.lastRender);
    const record=await h.operation();assert.ok(record.value.analysisKey);assert.equal(record.value.appliedAt,undefined);
    const receipt=await readFile(join(h.projectRoot,'Documentary','Analysis',record.value.analysisKey+'.json'),'utf8').then(JSON.parse,()=>undefined);
    assert.equal(receipt?.state,phase==='pending'?undefined:phase==='client'?'pending':'complete');
    if(mode==='auto-selection')(Reflect.get(h.service,'autoRuns') as Map<string,Promise<unknown>>).delete(h.p.id);
    else await h.projects.mutate(h.p.id,()=>({status:'ready'}));
    const opBytes=await readFile(record.path);
    await assert.rejects(h.service.reviseExplanation(h.p.id,{...feedback,feedback:'Changed feedback must not reset the held operation.'}),/Исход предыдущей/);
    assert.deepEqual(await readFile(record.path),opBytes);assert.equal(h.calls(),phase==='pending'||phase==='client'?0:1);
  }
});

test('confirmed output-free feedback 503 retains its failed receipt and blocks identical or altered intent after service restart',async()=>{
  const h=await harness({reply:async()=>{throw new AnyModelProviderResponseError('mock feedback terminal 503',503,0,true);}});
  await assert.rejects(h.service.reviseExplanation(h.p.id,feedback),/mock feedback terminal 503/);assert.equal(h.calls(),1);
  const record=await h.operation(),receiptPath=join(h.projectRoot,'Documentary','Analysis',record.value.analysisKey+'.json');
  const receiptBytes=await readFile(receiptPath);assert.equal(JSON.parse(receiptBytes.toString()).state,'failed');
  await assert.rejects(h.makeService(undefined,'changed-model').reviseExplanation(h.p.id,feedback),/COMPLETE/);
  await assert.rejects(h.makeService(undefined,'changed-model').reviseExplanation(h.p.id,{...feedback,feedback:'Different remark'}),/Исход предыдущей/);
  assert.equal(h.calls(),1);assert.deepEqual(await readFile(receiptPath),receiptBytes);assert.deepEqual(await h.current(),h.p);
});
