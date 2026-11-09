import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Project} from '@gold-work/shared';
import {AnyModelCompletionUncertainError,AnyModelProviderResponseError} from './anymodel-client.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {artworkOrphanedRequestMessage,createMotionArtworkPlan,motionArtworkHash} from './documentary-artwork-plan.js';
import {motionArtworkPreviews} from './documentary-artwork-previews.js';
import {previousMotionArtworkSystems} from './documentary-artwork-direction.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';

const invoke=(service:DocumentaryIntelligence,purpose:string,input:string)=>
  Reflect.get(service,'complete').call(service,'project',purpose,'Transport regression',input,[]) as Promise<Record<string,unknown>>;

async function receipt(root:string):Promise<Record<string,unknown>> {
  const dir=join(root,'Documentary','Analysis'),files=(await readdir(dir)).filter(name=>name.endsWith('.json'));
  assert.equal(files.length,1,'one paid request identity must keep one checkpoint');
  return JSON.parse(await readFile(join(dir,files[0]!),'utf8'));
}

test('ordinary selection keeps its cooldown and wait budget',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,9,22)});
  for(const mode of ['selection-long','selection-recover','ordinary-montage'] as const){
    const root=await mkdtemp(join(tmpdir(),'gws-artwork-transport-'));
    t.after(()=>rm(root,{recursive:true,force:true}));
    const selection=mode.startsWith('selection');
    const cooldown=mode==='selection-recover'?19_000:60_000;
    const purpose=selection?'candidate-relevance':'semantic-montage',input='{}';
    let calls=0,waitedMs=0;const submissions:number[]=[];
    const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
      submissions.push(Date.now());calls++;
      if(calls>1)assert.equal(waitedMs,cooldown,'the second paid submission cannot precede the provider cooldown');
      if(calls===1)throw new AnyModelProviderResponseError('HTTP 503: temporarily unavailable',503,cooldown);
      return '{"ok":true}';
    }},()=>root,async()=>{},undefined,async ms=>{
      assert.equal(calls,1,'only the first confirmed failure may be waiting before a recovery');
      if(waitedMs===0)assert.equal((await receipt(root)).state,'failed','save a definite failure before considering a replay');
      waitedMs+=ms;t.mock.timers.tick(ms);
    });
    const run=()=>invoke(service,purpose,input);
    if(mode==='selection-recover'){
      assert.deepEqual(await run(),{ok:true});
      assert.deepEqual(await run(),{ok:true}); // A successful recovery is cached.
      assert.equal((await receipt(root)).state,'complete');
    }else{
      await assert.rejects(run(),error=>{
        assert.ok(error instanceof DocumentaryAnalysisError);
        assert.equal(error.retryableTerminal,false);
        assert.equal(error.retryAfterMs,cooldown);
        assert.match(error.message,/Выполнено 1 отправок/);
        return true;
      });
    }
    const recovered=mode==='selection-recover';
    assert.equal(calls,recovered?2:1,mode);
    assert.equal(waitedMs,recovered?cooldown:0,mode);
    if(recovered)assert.equal(submissions[1]!-submissions[0]!,cooldown,mode);
  }
});

test('terminal HTTP200 gateway error is rejected without replay; unknown pending and partial artwork retain their guards',async t=>{
  const signature='[Error] The upstream provider is temporarily unavailable. Try again shortly.';
  for(const mode of ['terminal','pending','partial'] as const){
    const root=await mkdtemp(join(tmpdir(),'gws-artwork-transport-'));
    t.after(()=>rm(root,{recursive:true,force:true}));
    let calls=0,waitedMs=0;
    const partial=mode==='terminal'?signature:mode==='partial'?'{"scenes":[':'';
    const service=new DocumentaryIntelligence({configured:async()=>true,
      documentaryCompletion:async(_system,_input,_images,_signal,onPartial)=>{
        calls++;if(partial)onPartial?.(partial);
        if(mode==='terminal')throw new AnyModelProviderResponseError('Вышестоящий провайдер временно недоступен',undefined,undefined,false,true);
        throw new AnyModelCompletionUncertainError('ECONNRESET',partial);
      },
    },()=>root,async()=>{},undefined,async ms=>{waitedMs+=ms;});
    const run=()=>invoke(service,'semantic-montage','{"motionArtwork":1}');
    for(let attempt=0;attempt<2;attempt++)await assert.rejects(run(),error=>{
      assert.ok(error instanceof DocumentaryAnalysisError);
      assert.equal(error.kind,mode==='terminal'?'unavailable':'pending');
      assert.equal(error.retryableTerminal,false);
      if(mode==='terminal')assert.doesNotMatch(error.message,/незавершён|неизвестен|Сохранено \d+ знаков/);
      return true;
    });
    const saved=await receipt(root);
    assert.equal(saved.state,mode==='terminal'?'rejected':mode);
    assert.equal(saved.rejection,mode==='terminal'?'provider-unavailable':undefined);
    if(partial)assert.equal(saved.raw,partial,'retain the actual response for review without mislabelling it as partial');
    assert.equal(calls,1,mode);assert.equal(waitedMs,0,mode);
  }
});

test('an uncertain second artwork revision leaves its primary intact and permits later new batches without replay',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-artwork-revision-independent-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const project={id:'artwork-independent',mediaMode:'stock',aspectRatio:'16:9',language:'en',
    settings:{voice:{enabled:true},music:{enabled:false},assembly:{kenBurns:true,documentary:{version:2,autoMotionGraphics:true,
      montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve'}}}},
    scenes:Array.from({length:17},(_,index)=>({id:`water-${index}`,order:index,narration:'water cycle',durationSeconds:6,
      documentary:{verified:true,checksum:`water-${index}`,layout:'full',effects:[],caption:{enabled:false,text:''},
        requirement:{text:'water cycle',identities:[],years:[],accent:'none'},
        timing:{sourceKey:'voice',durationInFrames:180,speechSeconds:5.8}}}))} as unknown as Project;
  const drawing={version:1,intent:'water cycle',layout:'full',canvas:{width:1000,height:600},
    palette:{background:'#101820',ink:'#ffffff',accent:'#7ab5ce',secondary:'#cbb583'},startSeconds:0,durationSeconds:6,
    layers:[{id:'label',kind:'text',x:100,y:50,w:400,h:70,text:'water'},
      {id:'water',kind:'ellipse',x:100,y:420,w:230,h:70,fill:'accent'},
      {id:'vapour',kind:'path',x:180,y:180,w:100,h:200,path:'M50 200 L50 0',stroke:'ink',fill:'none'},
      {id:'cloud',kind:'ellipse',x:400,y:150,w:300,h:100,fill:'ink'}]};
  const montage=join(root,'Documentary','Montage'),hash=motionArtworkHash(project);
  await mkdir(montage,{recursive:true});
  await writeFile(join(montage,`${hash}-artwork-16.failed.json`),
    JSON.stringify({message:artworkOrphanedRequestMessage,safeToResume:false}));
  const submissions:string[]=[];
  const service=new DocumentaryIntelligence({configured:async()=>true,
    documentaryCompletion:async(_system,input,_images,_signal,onPartial)=>{
      const request=JSON.parse(input) as {motionArtworkRevision?:number;scenes:Array<{sceneId:string}>};
      const sceneId=request.scenes[0]!.sceneId;
      submissions.push(`${request.motionArtworkRevision?'revision':'draft'}:${sceneId}`);
      if(request.motionArtworkRevision&&sceneId==='water-8'){
        onPartial?.('{"scenes":');
        throw new AnyModelCompletionUncertainError('ECONNRESET','{"scenes":');
      }
      return JSON.stringify({scenes:[{sceneId,artwork:request.motionArtworkRevision
        ?{...drawing,motionCoordinates:'absolute'}:drawing}]});
    }},()=>root,async()=>{});
  const preview=async(rows:Array<{sceneId:string}>)=>rows.map(row=>({sceneId:row.sceneId,
    frames:[.1,.5,.9].map(t=>({t,image:'data:image/jpeg;base64,AA=='}))}));
  const first=await service.planMotionArtwork(project,undefined,{revisionPreview:preview});
  assert.deepEqual(first.scenes.map(row=>row.sceneId),['water-0','water-8','water-16']);
  assert.match(first.incomplete??'',/ECONNRESET|Сохранено/);
  assert.deepEqual(submissions,['draft:water-0','revision:water-0','draft:water-8','revision:water-8',
    'draft:water-16','revision:water-16']);
  assert.ok(await readFile(join(montage,`${hash}-artwork-8.json`),'utf8'));
  assert.ok(await readFile(join(montage,`${hash}-artwork-revision-v2-8.attempt.json`),'utf8'));
  await assert.rejects(readFile(join(montage,`${hash}-artwork-revision-v2-8.json`),'utf8'),{code:'ENOENT'});
  const second=await service.planMotionArtwork(project,undefined,{revisionPreview:preview});
  assert.deepEqual(second.scenes.map(row=>row.sceneId),first.scenes.map(row=>row.sceneId));
  assert.match(second.incomplete??'',/не завершена/);
  assert.equal(submissions.length,6,'ordinary resume cannot replay either the unknown editor or a completed batch');
});

test('only explicit artwork refresh resumes a proven terminal gateway receipt, archives it and preserves successful batches',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-artwork-explicit-resume-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const signature='[Error] The upstream provider is temporarily unavailable. Try again shortly.';
  const project={id:'artwork-resume',mediaMode:'stock',aspectRatio:'16:9',language:'en',
    settings:{voice:{enabled:true},music:{enabled:false},assembly:{kenBurns:true,documentary:{version:2,autoMotionGraphics:true,
      montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve'}}}},
    scenes:Array.from({length:9},(_,index)=>({id:`water-${index}`,order:index,narration:'water',durationSeconds:6,
      documentary:{verified:true,checksum:`water-${index}`,layout:'full',effects:[],caption:{enabled:false,text:''},
        requirement:{text:'water',identities:[],years:[],accent:'none'},timing:{sourceKey:'voice',durationInFrames:180,speechSeconds:5.8}}}))} as unknown as Project;
  const drawing={version:1,intent:'water',layout:'full',canvas:{width:1000,height:600},
    palette:{background:'#101820',ink:'#ffffff',accent:'#7ab5ce',secondary:'#cbb583'},startSeconds:0,durationSeconds:6,
    layers:[{id:'label',kind:'text',x:100,y:50,w:400,h:70,text:'water'},
      {id:'water',kind:'ellipse',x:100,y:420,w:230,h:70,fill:'accent'},
      {id:'vapour',kind:'path',x:180,y:180,w:100,h:200,path:'M50 200 L50 0',stroke:'ink',fill:'none'},
      {id:'cloud',kind:'ellipse',x:400,y:150,w:300,h:100,fill:'ink'}]};
  let model='route-before',calls=0,waits=0;
  const submissions:Array<{sceneId:string;model:string|undefined}>=[];
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryMotionModel:async()=>model,
    documentaryCompletion:async(_system,input,_images,_signal,onPartial,route)=>{
      calls++;const sceneId=JSON.parse(input).scenes[0].sceneId as string;
      submissions.push({sceneId,model:route});
      if(calls===2){onPartial?.(signature);throw new AnyModelProviderResponseError('Gateway unavailable',undefined,undefined,false,true);}
      return JSON.stringify({scenes:[{sceneId,artwork:drawing}]});
    }},()=>root,async()=>{},undefined,async()=>{waits++;});
  const first=await service.planMotionArtwork(project);
  assert.ok(first.incomplete);assert.equal(first.scenes.length,1);assert.equal(calls,2);
  const analysis=join(root,'Documentary','Analysis'),montage=join(root,'Documentary','Montage');
  const receipts=await Promise.all((await readdir(analysis)).filter(name=>name.endsWith('.json')).map(async name=>({path:join(analysis,name),
    value:JSON.parse(await readFile(join(analysis,name),'utf8')) as Record<string,unknown>})));
  const gateway=receipts.find(row=>row.value.rejection==='provider-unavailable');assert.ok(gateway);
  const failedName=(await readdir(montage)).find(name=>name.endsWith('-artwork-8.failed.json'));assert.ok(failedName);
  const failedPath=join(montage,failedName),failure=JSON.parse(await readFile(failedPath,'utf8'));
  assert.equal(failure.safeToResume,true,'new terminal failures carry explicit-resume evidence');
  // Reproduce receipts written before this fix: the plan denied resume, while
  // Analysis retained the exact completed gateway response without the new flag.
  const legacy={...gateway.value};delete legacy.completedGatewayError;
  const original=JSON.stringify(legacy);
  await writeFile(gateway.path,original);await writeFile(failedPath,JSON.stringify({...failure,safeToResume:false}));
  model='route-after';
  const ordinary=await service.planMotionArtwork(project);
  assert.equal(calls,2,'changing route during an ordinary rebuild grants no retry');
  assert.deepEqual(ordinary.scenes,first.scenes);
  for(const blocked of [{...legacy,state:'pending'},{...legacy,state:'partial'},
    {...legacy,raw:signature+' incomplete extra text'},{...legacy,completedAt:undefined}]){
    await writeFile(gateway.path,JSON.stringify(blocked));
    const guarded=await service.planMotionArtwork(project,undefined,{resumeUnavailable:true});
    assert.ok(guarded.incomplete);assert.equal(calls,2,'refresh cannot bypass an unknown or unproven receipt');
  }
  await writeFile(gateway.path,original);
  const resumed=await service.planMotionArtwork(project,undefined,{resumeUnavailable:true});
  assert.match(resumed.incomplete??'',/Предпросмотр визуальной доработки не подключён/);
  assert.equal(resumed.scenes.length,2);
  assert.deepEqual(resumed.scenes[0],first.scenes[0],'the successful paid drawing is preserved');
  assert.deepEqual(submissions,[{sceneId:'water-0',model:'route-before'},{sceneId:'water-8',model:'route-before'},
    {sceneId:'water-8',model:'route-after'}]);
  const archive=join(analysis,'ProviderUnavailable'),archived=await readdir(archive);
  assert.equal(archived.length,1);assert.equal(await readFile(join(archive,archived[0]!),'utf8'),original,'archive the original receipt byte for byte');
  assert.equal(JSON.parse(await readFile(gateway.path,'utf8')).state,'complete');
  await service.planMotionArtwork(project);await service.planMotionArtwork(project,undefined,{resumeUnavailable:true});
  assert.equal(calls,3,'the successful resume is cached even under another explicit refresh');assert.equal(waits,0,'gateway responses never trigger automatic retry waits');
});

test('new artwork mode re-enters predecessor Analysis receipts after a crash without buying another request',async t=>{
  for(const previousSystem of previousMotionArtworkSystems)for(const state of ['pending','partial','complete'] as const){
    const root=await mkdtemp(join(tmpdir(),'gws-artwork-old-receipt-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const project={id:'artwork-old-receipt',mediaMode:'stock',aspectRatio:'16:9',language:'en',
      settings:{voice:{enabled:true},music:{enabled:false},assembly:{kenBurns:true,documentary:{version:2,autoMotionGraphics:true,
        montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve'}}}},
      scenes:[{id:'water',order:0,narration:'water',durationSeconds:6,imagePath:'unneeded-source.jpg',
        documentary:{verified:true,checksum:'water',layout:'full',effects:[],caption:{enabled:false,text:''},
          selected:{id:'water',kind:'image',width:1920,height:1080},requirement:{text:'water',identities:[],years:[],accent:'none'},
          semanticMontage:{sceneId:'water',subject:'water',beat:'explain',treatment:'footage',cutawaySceneIds:[],artworkMode:'standalone'},
          timing:{sourceKey:'voice',durationInFrames:180,speechSeconds:5.8}}}]} as unknown as Project;
    // Reproduce the exact pre-density input, then lose the old manifest as in
    // a crash with only an Analysis receipt left. History must not add timing.
    const montage=join(root,'Documentary','Montage'),manifest=join(montage,`${motionArtworkHash(project)}-artwork-batches.json`);
    await mkdir(montage,{recursive:true});
    await writeFile(manifest,JSON.stringify({version:1,inputHash:motionArtworkHash(project),sceneIds:['water'],ranges:[{from:0,until:1}]}));
    let captured='';
    await assert.rejects(createMotionArtworkPlan(project,root,async(_system,input)=>{captured=input;throw Error('capture only');},'fixture'),/capture only/);
    const payload=JSON.parse(captured);assert.equal(payload.scenes[0].artworkMode,'standalone');
    assert.equal(payload.scenes[0].timelineStartSeconds,undefined);
    assert.equal(payload.scenes[0].storyBeat,undefined);
    const legacyInput=JSON.stringify({...payload,scenes:payload.scenes.map(({artworkMode:_mode,...row}:Record<string,unknown>)=>row)});
    assert.ok(!(await readdir(join(root,'Documentary','Montage'))).some(name=>/-artwork-0(?:\.failed)?\.json$/u.test(name)),
      'simulate death before Montage raw/failure was saved');
    const drawing={version:1,intent:'water',layout:'full',canvas:{width:1000,height:600},
      palette:{background:'#101820',ink:'#ffffff',accent:'#7ab5ce',secondary:'#cbb583'},startSeconds:0,durationSeconds:6,
      layers:[{id:'label',kind:'text',x:100,y:50,w:400,h:70,text:'water'},
        {id:'water',kind:'ellipse',x:100,y:420,w:230,h:70,fill:'accent'},
        {id:'vapour',kind:'path',x:180,y:180,w:100,h:200,path:'M50 200 L50 0',stroke:'ink',fill:'none'},
        {id:'cloud',kind:'ellipse',x:400,y:150,w:300,h:100,fill:'ink'}]};
    const analysis=join(root,'Documentary','Analysis'),key=documentaryCheckpointKey('semantic-montage',previousSystem,legacyInput,[]);
    await mkdir(analysis,{recursive:true});
    const original=JSON.stringify({state,purpose:'semantic-montage',...(state==='partial'?{raw:'{"scenes":['}:{}),
      ...(state==='complete'?{result:{scenes:[{sceneId:'water',artwork:drawing}]}}:{})});
    await writeFile(join(analysis,key+'.json'),original);
    await rm(manifest);
    let calls=0;
    const service=new DocumentaryIntelligence({configured:async()=>true,documentaryMotionModel:async()=> 'new-route',
      documentaryCompletion:async()=>{calls++;throw Error('must not submit');}},()=>root);
    if(state==='complete'){
      const result=await service.planMotionArtwork(project);assert.equal(result.scenes.length,1);
      assert.equal(result.scenes[0]!.artwork.intent,'water');
    }else await assert.rejects(service.planMotionArtwork(project),/Автоповтор отключён|Этот платный запрос не повторяется|платный повтор/);
    assert.equal(calls,0,state);assert.deepEqual(await readdir(analysis),[key+'.json']);
    assert.equal(await readFile(join(analysis,key+'.json'),'utf8'),original,'original paid receipt stays byte-identical');
  }
});

test('photographic preview descriptor still finds the prior paid image checkpoint',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-artwork-photo-receipt-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=join(root,'source.ppm');
  await writeFile(source,Buffer.concat([Buffer.from('P6\n16 9\n255\n'),Buffer.alloc(16*9*3,180)]));
  const project={id:'photo-receipt',mediaMode:'stock',aspectRatio:'16:9',language:'en',
    settings:{voice:{enabled:true},music:{enabled:false},assembly:{kenBurns:true,documentary:{version:2,autoMotionGraphics:true,
      montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve'}}}},
    scenes:[{id:'water',order:0,narration:'water',durationSeconds:6,imagePath:source,
      documentary:{verified:true,checksum:'water',layout:'full',effects:[],caption:{enabled:false,text:''},
        selected:{id:'water',kind:'image',width:1920,height:1080},requirement:{text:'water',identities:[],years:[],accent:'none'},
        semanticMontage:{sceneId:'water',subject:'water',beat:'explain',treatment:'footage',cutawaySceneIds:[],artworkMode:'photographic'},
        timing:{sourceKey:'voice',durationInFrames:180,speechSeconds:5.8}}}]} as unknown as Project;
  let commissionInput='';
  await assert.rejects(createMotionArtworkPlan(project,root,async(_system,input)=>{
    commissionInput=input;throw Error('capture only');},'fixture'),/capture only/);
  const preview=await motionArtworkPreviews(project,commissionInput,root);
  const priorInput=JSON.stringify({...JSON.parse(preview.input),scenes:JSON.parse(preview.input).scenes.map(
    ({sourcePreviewSha256:_digest,...row}:Record<string,unknown>)=>row)});
  const previousSystem=previousMotionArtworkSystems.at(-1)!;
  const key=documentaryCheckpointKey('semantic-montage',previousSystem,priorInput,preview.images);
  const analysis=join(root,'Documentary','Analysis');await mkdir(analysis,{recursive:true});
  const drawing={version:1,intent:'water',layout:'full',canvas:{width:1000,height:600},
    palette:{background:'#101820',ink:'#ffffff',accent:'#7ab5ce',secondary:'#cbb583'},startSeconds:0,durationSeconds:6,
    layers:[{id:'label',kind:'text',x:100,y:50,w:400,h:70,text:'water'},
      {id:'water',kind:'ellipse',x:100,y:420,w:230,h:70,fill:'accent'},
      {id:'vapour',kind:'path',x:180,y:180,w:100,h:200,path:'M50 200 L50 0',stroke:'ink',fill:'none'},
      {id:'cloud',kind:'ellipse',x:400,y:150,w:300,h:100,fill:'ink'}]};
  await writeFile(join(analysis,`${key}.json`),JSON.stringify({state:'complete',purpose:'semantic-montage',
    result:{scenes:[{sceneId:'water',artwork:drawing}]}}));
  let paid=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryMotionModel:async()=> 'new-route',
    documentaryCompletion:async()=>{paid++;throw Error('must not submit');}},()=>root);
  const result=await service.planMotionArtwork(project);
  assert.equal(result.scenes.length,1);assert.equal(paid,0);
});
