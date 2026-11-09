import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createDefaultProjectSettings,type DocumentaryArtwork,type Project} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {createArtworkFeedbackPlan,appliedArtworkFeedbackRows,normalizeArtworkFeedback,artworkFeedbackRowsHash,readActiveArtworkFeedback} from './documentary-artwork-feedback.js';
import {artworkForRevision,type ArtworkRevisionHooks} from './documentary-artwork-revision.js';
import {motionArtworkHash,validateMotionArtwork} from './documentary-artwork-plan.js';
import {semanticMontageHash} from './documentary-semantic-montage.js';
import {planDocumentaryMontage} from './documentary-montage.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';

const originalFetch=globalThis.fetch;
test.before(()=>{globalThis.fetch=async()=>{throw Error('SOURCE test: external fetch disabled');};});
test.after(()=>{globalThis.fetch=originalFetch;});

const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
function drawing():DocumentaryArtwork{return {version:1,intent:'Water cycle',motionCoordinates:'absolute',layout:'full',canvas:{width:1000,height:600},
  palette:{background:'#101820',ink:'#f5f0e5',accent:'#7ab5ce',secondary:'#cbb583'},startSeconds:.2,durationSeconds:4.5,
  layers:[{id:'label',kind:'text',x:70,y:60,w:400,h:70,text:'water',fontSize:52},
    {id:'water',kind:'ellipse',x:100,y:420,w:230,h:70,fill:'accent',keyframes:[{t:0,x:100},{t:.5,x:220},{t:1,x:220}]},
    {id:'vapour',kind:'path',x:180,y:180,w:100,h:200,path:'M50 100Q10 70 50 40Q90 10 50 0',stroke:'ink',fill:'none',keyframes:[{t:0,draw:0},{t:.4,draw:1},{t:1,draw:1}]},
    {id:'cloud',kind:'ellipse',x:400,y:150,w:300,h:100,fill:'ink',keyframes:[{t:0,opacity:0},{t:.5,opacity:1},{t:1,opacity:1}]}]};}
async function fixture(root:string){
  const settings=createDefaultProjectSettings();settings.music.enabled=false;
  settings.assembly.documentary={version:2,pace:'balanced',backgroundColor:'#101820',accentColor:'#7ab5ce',textColor:'#ffffff',sfxVolume:25,captionsEnabled:false,
    autoEffects:false,autoTransitions:false,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve'}};
  const project={id:'feedback-fixture',title:'Local mock feedback fixture',topic:'water',mode:'standard',status:'ready',createdAt:'2026-10-29',updatedAt:'2026-10-29',mediaMode:'stock',aspectRatio:'16:9',language:'en',settings,
    videoBrief:{creationMode:'script',readyScript:'Warm water evaporates. The vapour condenses into clouds.'},
    scenes:[{id:'rain',order:0,title:'water',narration:'Warm water evaporates. The vapour condenses into clouds.',durationSeconds:6,status:'ready',imagePrompt:'',animationPrompt:'',
      documentary:{verified:true,layout:'full',effects:[],candidates:[],caption:{enabled:false,text:''},requirement:{text:'water',identities:[],years:[],queries:[],accent:'none'},
        timing:{sourceKey:'voice',durationInFrames:180,speechSeconds:5.8},semanticMontage:{sceneId:'rain',subject:'water',beat:'explain',treatment:'footage',cutawaySceneIds:[],artworkMode:'standalone'}}}]} as unknown as Project;
  const raw=drawing(),artwork=validateMotionArtwork(raw,project.scenes[0]!.narration,6,false).artwork!;assert.ok(artwork);
  project.scenes[0]!.documentary!.semanticMontage!.artwork=artwork;
  const hash=semanticMontageHash(project);project.scenes[0]!.documentary!.semanticMontageInputHash=hash;
  project.scenes=planDocumentaryMontage(project);
  assert.equal(appliedArtworkFeedbackRows(project).length,1);
  const inputHash=motionArtworkHash(project),parentKey=digest('mock-COMPLETE-parent'),dir=join(root,'Documentary','Montage');
  await mkdir(dir,{recursive:true});await mkdir(join(root,'Documentary','Analysis'),{recursive:true});
  const response={scenes:[{sceneId:'rain',artwork:raw}]};
  await writeFile(join(dir,`${inputHash}-artwork-revision-v2-0.attempt.json`),JSON.stringify({version:1,inputHash,from:0,inputSha256:digest('mock exact old request'),analysisKey:parentKey}));
  await writeFile(join(dir,`${inputHash}-artwork-revision-v2-0.json`),JSON.stringify(response));
  await writeFile(join(root,'Documentary','Analysis',parentKey+'.json'),JSON.stringify({state:'complete',purpose:'semantic-montage',result:response,raw:JSON.stringify(response)}));
  const proposal=artworkForRevision(artwork);proposal.layers.find(l=>l.id==='cloud')!.fill='accent';
  return {project,proposal,parentKey};
}
const preview:ArtworkRevisionHooks['preview']=async rows=>rows.map(r=>({sceneId:r.sceneId,frames:[.04,.48,.88].map(t=>({t,image:'data:image/jpeg;base64,bG9jYWw='}))}));
async function harness(root:string){
  const f=await fixture(root);let posts=0;
  const client={configured:async()=>true,documentaryMotionModel:async()=> 'mock-feedback-model',documentaryCompletion:async(_system:string,input:string)=>{
    posts++;const payload=JSON.parse(input);assert.equal(payload.artworkFeedback,1);assert.equal(payload.motionArtworkRevision,1);
    assert.equal(payload.originalScript,f.project.videoBrief!.readyScript);assert.equal(payload.scenes[0].artwork.layers.length,4);
    return JSON.stringify({scenes:[{sceneId:'rain',artwork:f.proposal}]});
  }};
  const ai=new DocumentaryIntelligence(client as never,()=>root);
  const run=(feedback:string,p=f.project)=>ai.planMotionArtwork(p,undefined,{feedback:{feedback},revisionPreview:preview});
  return {...f,run,posts:()=>posts};
}
test('actual intelligence route uses current applied base; normalized and output-as-base repeats reuse COMPLETE after restart',async t=>{
  const root=await mkdtemp(join(tmpdir(),'feedback-route-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const h=await harness(root),original=structuredClone(h.project),result=await h.run('  Cafe\u0301\r\nKeep the final hold  ');
  assert.equal(h.posts(),1);assert.equal(normalizeArtworkFeedback('Cafe\u0301\r\n'), 'Café');
  const saved=JSON.parse(await readFile(join(root,'Documentary','Montage','feedback',(result as any).feedback.operationKey,'request.json'),'utf8'));
  assert.equal(saved.baseArtworkHash,artworkFeedbackRowsHash(appliedArtworkFeedbackRows(original)));
  assert.deepEqual(saved.base[0].artwork,original.scenes[0]!.documentary!.motionGraphic!.artwork);
  const duplicate=await h.run('Café\nKeep the final hold');assert.deepEqual(duplicate,result);assert.equal(h.posts(),1);
  const next=structuredClone(original),row=result.scenes[0]!;
  next.scenes[0]!.documentary!.semanticMontage!.artwork=row.artwork;next.scenes[0]!.documentary!.motionGraphic!.artwork=row.artwork;
  next.settings.assembly.documentary!.artworkFeedback={...(result as any).feedback,status:'applied'};
  next.settings.assembly.documentary!.activeArtworkFeedback=next.settings.assembly.documentary!.artworkFeedback;
  await readActiveArtworkFeedback(next,root);
  const restarted=new DocumentaryIntelligence({configured:async()=>true,documentaryMotionModel:async()=> 'mock',documentaryCompletion:async()=>{throw Error('second paid dispatch');}} as never,()=>root);
  assert.deepEqual(await restarted.planMotionArtwork(next,undefined,{feedback:{feedback:'Café\nKeep the final hold'},revisionPreview:preview}),result);
  assert.equal(h.posts(),1);
  assert.deepEqual(await restarted.planMotionArtwork(next),result,'ordinary planning reads active saved result before primary cache');
});
test('concurrent equivalent intent has one exclusive dispatch; changed text creates a distinct operation',async t=>{
  const root=await mkdtemp(join(tmpdir(),'feedback-concurrent-'));t.after(()=>rm(root,{recursive:true,force:true}));const h=await harness(root);
  const settled=await Promise.allSettled([h.run('improve'),h.run('improve')]);assert.equal(h.posts(),1);assert.ok(settled.some(r=>r.status==='fulfilled'));
  await h.run('improve');assert.equal(h.posts(),1);await h.run('different improvement');assert.equal(h.posts(),2);
});
test('UNKNOWN/PENDING/partial/received/invalid and missing COMPLETE stop before a second dispatch, including changed feedback',async t=>{
  for(const state of ['unknown','pending','partial','received','invalid']){
    const root=await mkdtemp(join(tmpdir(),'feedback-uncertain-'));t.after(()=>rm(root,{recursive:true,force:true}));const h=await harness(root),r=await h.run('improve') as any;
    await writeFile(join(root,'Documentary','Analysis',r.feedback.analysisKey+'.json'),JSON.stringify({purpose:'semantic-montage',state}));
    await assert.rejects(h.run('improve'));await assert.rejects(h.run('different feedback'));assert.equal(h.posts(),1);
  }
});
test('FIX1 linked UNKNOWN cannot be bypassed by changing text, local settings or applied base',async t=>{
  const root=await mkdtemp(join(tmpdir(),'feedback-fix1-unknown-'));t.after(()=>rm(root,{recursive:true,force:true}));const h=await harness(root),result=await h.run('A') as any;
  const file=join(root,'Documentary','Analysis',result.feedback.analysisKey+'.json'),unknown=JSON.stringify({state:'unknown',purpose:'semantic-montage'});await writeFile(file,unknown);
  for(const kind of ['text','settings','base','both']){
    const project=structuredClone(h.project);
    if(kind==='settings'||kind==='both')project.settings.music.volume+=.01;
    if(kind==='base'||kind==='both')for(const art of [project.scenes[0]!.documentary!.semanticMontage!.artwork!,project.scenes[0]!.documentary!.motionGraphic!.artwork!])
      art.layers.find(l=>l.id==='water')!.editTransform={x:4,y:2,scale:1,rotation:0};
    await assert.rejects(h.run(kind==='text'||kind==='both'?'B':'A',project),kind);assert.equal(h.posts(),1,kind);assert.equal(await readFile(file,'utf8'),unknown);
  }
});

test('frozen input, image, attempt, parent and result tampering never dispatch again',async t=>{
  for(const kind of ['input','images','attempt','parent','result']){
    const root=await mkdtemp(join(tmpdir(),'feedback-binding-'));t.after(()=>rm(root,{recursive:true,force:true}));const h=await harness(root),r=await h.run('improve') as any;
    const dir=join(root,'Documentary','Montage','feedback',r.feedback.operationKey),request=JSON.parse(await readFile(join(dir,'request.json'),'utf8'));
    if(kind==='input'){request.input+=' ';await writeFile(join(dir,'request.json'),JSON.stringify(request));}
    if(kind==='images'){request.images[0]='data:image/jpeg;base64,YQ==';await writeFile(join(dir,'request.json'),JSON.stringify(request));}
    if(kind==='attempt')await writeFile(join(dir,'attempt.json'),'null');
    if(kind==='parent')await writeFile(join(root,'Documentary','Analysis',h.parentKey+'.json'),JSON.stringify({state:'unknown'}));
    if(kind==='result'){r.scenes[0].artwork.intent='tampered';await writeFile(join(dir,'result.json'),JSON.stringify(r));}
    await assert.rejects(h.run('improve'));assert.equal(h.posts(),1,kind);
  }
});
test('invalid/no-op/failed local preview keep original and visible reason; local preview recovery reuses COMPLETE',async t=>{
  for(const mode of ['invalid','noop','metadata-only','preview']){
    const root=await mkdtemp(join(tmpdir(),'feedback-invalid-'));t.after(()=>rm(root,{recursive:true,force:true}));const f=await fixture(root);let posts=0,previews=0;
    const hooks:ArtworkRevisionHooks={preview:async rows=>{previews++;if(mode==='preview'&&previews===2)throw Error('mock local render failure');return preview(rows);},complete:async(system,input,images)=>{
      posts++;const metadataOnly=artworkForRevision(appliedArtworkFeedbackRows(f.project)[0]!.artwork);metadataOnly.intent='Changed prose only';
      const response={scenes:[{sceneId:'rain',artwork:mode==='invalid'?{}:mode==='noop'?artworkForRevision(appliedArtworkFeedbackRows(f.project)[0]!.artwork):mode==='metadata-only'?metadataOnly:f.proposal}]};
      const key=documentaryCheckpointKey('semantic-montage',system,input,images);
      await writeFile(join(root,'Documentary','Analysis',key+'.json'),JSON.stringify({state:'complete',purpose:'semantic-montage',result:response}));return response;
    }};
    const result=await createArtworkFeedbackPlan(f.project,root,'improve',hooks,'mock');assert.equal(result.feedback.status,'blocked');
    assert.deepEqual(result.scenes,appliedArtworkFeedbackRows(f.project));assert.ok(result.feedback.message.includes('сохранены'));
    const resumed=await createArtworkFeedbackPlan(f.project,root,'improve',hooks,'mock');assert.equal(posts,1);
    assert.equal(resumed.feedback.status,mode==='preview'?'complete':'blocked');
  }
});
test('pre-dispatch stale input and orphaned historical UNKNOWN cannot be bypassed',async t=>{
  const root=await mkdtemp(join(tmpdir(),'feedback-stale-'));t.after(()=>rm(root,{recursive:true,force:true}));const f=await fixture(root);let posts=0;
  const hooks={preview,complete:async()=>{posts++;throw Error('unexpected dispatch');}};
  await assert.rejects(createArtworkFeedbackPlan(f.project,root,'improve',hooks,'mock',undefined,async()=>{throw Error('stale project');}),/stale project/);
  assert.equal(posts,0);
  const names=await readdir(join(root,'Documentary','Montage','feedback'));assert.equal(names.length,1);
  const unknownPath=join(root,'Documentary','Analysis',digest('unrelated historical unknown')+'.json');await writeFile(unknownPath,JSON.stringify({state:'unknown',purpose:'semantic-montage'}));
  await assert.rejects(createArtworkFeedbackPlan(f.project,root,'different',hooks,'mock'),/неопределённый/);assert.equal(posts,0);
});
