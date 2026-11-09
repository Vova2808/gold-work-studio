import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,cp,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createDefaultProjectSettings,type DocumentaryArtwork,type Project} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {FileProjectRepository} from './file-project-repository.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {appliedArtworkFeedbackRows,artworkFeedbackProtectedInput,artworkFeedbackRowsHash} from './documentary-artwork-feedback.js';
import {artworkForRevision,type ArtworkRevisionHooks} from './documentary-artwork-revision.js';
import {motionArtworkHash,validateMotionArtwork,createMotionArtworkPlan} from './documentary-artwork-plan.js';
import {semanticMontageHash} from './documentary-semantic-montage.js';
import {planDocumentaryMontage} from './documentary-montage.js';
import {renderDocumentaryArtworkPhases} from './documentary-artwork-phase-renderer.js';
import {openDocumentaryRenderBrowser} from './documentary-renderer.js';
import {buildDocumentaryTimeline} from '../../../packages/remotion-video/src/documentary-timeline.js';

const originalFetch=globalThis.fetch;
test.before(()=>{globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('SOURCE test: external fetch disabled');
  return originalFetch(input,init);
};});
test.after(()=>{globalThis.fetch=originalFetch;});

const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const preview:ArtworkRevisionHooks['preview']=async rows=>rows.map(r=>({sceneId:r.sceneId,frames:[.04,.48,.88].map(t=>({t,image:'data:image/jpeg;base64,dGVzdA=='}))}));
function mockDrawing(text='water',seconds=4.5,start=.2):DocumentaryArtwork{return {version:1,intent:'NEW LOCAL MOCK — source validation only',layout:'full',motionCoordinates:'absolute',
  canvas:{width:1000,height:562},palette:{background:'#14252e',ink:'#f4f0e8',accent:'#83b7cd',secondary:'#c7b176'},startSeconds:start,durationSeconds:seconds,
  layers:[{id:'literal',kind:'text',x:60,y:50,w:850,h:80,text,fontSize:40},
    {id:'object',kind:'rect',x:80,y:250,w:240,h:150,fill:'accent',keyframes:[{t:0,x:80},{t:.5,x:500},{t:.76,x:500},{t:1,x:500}]},
    {id:'child',kind:'ellipse',x:115,y:290,w:60,h:60,fill:'ink'},
    {id:'result',kind:'ellipse',x:680,y:250,w:200,h:150,fill:'secondary',keyframes:[{t:0,opacity:0},{t:.65,opacity:1},{t:1,opacity:1}]}]};}
async function basicProject():Promise<Project>{
  const settings=createDefaultProjectSettings();settings.music.enabled=false;
  settings.assembly.documentary={version:2,pace:'balanced',backgroundColor:'#14252e',accentColor:'#83b7cd',textColor:'#ffffff',sfxVolume:25,captionsEnabled:false,
    autoEffects:false,autoTransitions:false,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich',musicPolicy:'preserve'}};
  const p={id:'feedback-service',title:'Source-only fixture',topic:'water',mode:'standard',status:'ready',createdAt:'2026-10-29',updatedAt:'2026-10-29',mediaMode:'stock',aspectRatio:'16:9',language:'en',settings,
    videoBrief:{creationMode:'script',readyScript:'Warm water evaporates. The vapour condenses into clouds.'},
    scenes:[{id:'rain',order:0,title:'water',imagePrompt:'',animationPrompt:'',narration:'Warm water evaporates. The vapour condenses into clouds.',durationSeconds:6,status:'ready',
      documentary:{verified:true,layout:'full',effects:[],candidates:[],caption:{enabled:false,text:''},requirement:{text:'water',identities:[],years:[],queries:[],accent:'none'},
        timing:{sourceKey:'voice',durationInFrames:180,speechSeconds:5.8},semanticMontage:{sceneId:'rain',subject:'water',beat:'explain',treatment:'footage',cutawaySceneIds:[],artworkMode:'standalone'}}}]} as unknown as Project;
  const a=mockDrawing();a.intent='OLD MOCK COMPLETE predecessor';
  const artwork=validateMotionArtwork(a,p.scenes[0]!.narration,6,false).artwork!;assert.ok(artwork);
  p.scenes[0]!.documentary!.semanticMontage!.artwork=artwork;
  p.scenes[0]!.documentary!.semanticMontageInputHash=semanticMontageHash(p);p.scenes=planDocumentaryMontage(p);return p;
}
async function seedParent(project:Project,root:string){
  const hash=motionArtworkHash(project),analysis=join(root,'Documentary','Analysis'),montage=join(root,'Documentary','Montage');
  await mkdir(analysis,{recursive:true});await mkdir(montage,{recursive:true});
  const parentKey=sha('service mock COMPLETE parent'),response={scenes:appliedArtworkFeedbackRows(project).map(r=>({...r,artwork:artworkForRevision(r.artwork)}))};
  await writeFile(join(analysis,parentKey+'.json'),JSON.stringify({state:'complete',purpose:'semantic-montage',result:response}));
  await writeFile(join(montage,`${hash}-artwork-revision-v2-0.json`),JSON.stringify(response));
  await writeFile(join(montage,`${hash}-artwork-revision-v2-0.attempt.json`),JSON.stringify({version:1,inputHash:hash,from:0,inputSha256:sha('mock original request'),analysisKey:parentKey}));
}
async function harness(root:string,input:Project,options:{native?:boolean;existingParents?:boolean;reply?:(input:any)=>any;afterReply?:()=>Promise<void>;beforePaidRequest?:()=>Promise<void>;failPreview?:boolean}={}){
  const storage=new LocalProjectStorage(join(root,'projects')),projectRoot=storage.projectDirectory(input.id);await mkdir(projectRoot,{recursive:true});
  const repo=new FileProjectRepository(join(root,'projects.json')),projects=new ProjectService(repo,new MockDirectorProvider());
  await repo.save(input);const before=(await projects.get(input.id))!;
  if(!options.existingParents)await seedParent(before,projectRoot);
  let posts=0,previews=0;
  const client={configured:async()=>true,documentaryMotionModel:async()=> 'mock-feedback-model',documentaryCompletion:async(system:string,text:string)=>{
    posts++;const data=JSON.parse(text);assert.equal(data.artworkFeedback,1);assert.ok(system.includes('CURRENT APPLIED'));
    const response=options.reply?.(data)??{scenes:data.scenes.map((r:any)=>{
      const a=structuredClone(r.artwork) as DocumentaryArtwork;a.intent='NEW LOCAL MOCK feedback answer';a.palette.accent='#d19c70';return {sceneId:r.sceneId,artwork:a};
    })};
    await options.afterReply?.();return JSON.stringify(response);
  }};
  const ai=new DocumentaryIntelligence(client as never,()=>projectRoot,options.beforePaidRequest);
  const phase:typeof renderDocumentaryArtworkPhases=async(p,rows,opts)=>{previews++;if(options.failPreview)throw Error('mock native preview failed');return options.native?renderDocumentaryArtworkPhases(p,rows,opts):preview(rows);};
  const service=new DocumentaryProjectService(projects,storage,{} as never,root,{download:async()=>{throw Error('no downloads');}} as never,()=>{},ai,undefined,undefined,undefined,phase);
  return {service,projects,repo,storage,projectRoot,before,ai,posts:()=>posts,previews:()=>previews};
}
test('service double click → actual intelligence/validators → narrow application → FileProjectRepository reopen → ordinary assembly retains result',async t=>{
  const root=await mkdtemp(join(tmpdir(),'feedback-service-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=await basicProject(),art=p.scenes[0]!.documentary!.semanticMontage!.artwork!;
  art.layers.unshift({id:'manual-group',kind:'group',x:40,y:210,w:320,h:240,editTransform:{x:12,y:4,scale:1.1,rotation:2}});
  art.layers.find(l=>l.id==='object')!.parentId='manual-group';art.layers.find(l=>l.id==='child')!.parentId='manual-group';
  const manual=validateMotionArtwork(artworkForRevision(art),p.scenes[0]!.narration,6,false).artwork!;assert.ok(manual);
  p.scenes[0]!.documentary!.semanticMontage!.artwork=manual;p.scenes[0]!.documentary!.motionGraphic!.artwork=manual;
  const pinned=structuredClone(p.scenes[0]!);pinned.id='pinned';pinned.order=1;pinned.documentary!.pinned=true;pinned.documentary!.semanticMontage!.sceneId='pinned';
  p.scenes.push(pinned);
  for(const scene of p.scenes)scene.documentary!.semanticMontageInputHash=semanticMontageHash(p);
  const h=await harness(root,p,{reply:data=>({scenes:data.scenes.map((r:any)=>{
    const a=structuredClone(r.artwork) as DocumentaryArtwork;a.palette.accent='#ff0000';
    a.layers.find(l=>l.id==='manual-group')!.x=600;a.layers.find(l=>l.id==='object')!.keyframes=[{t:0,x:500},{t:1,x:500}];
    a.layers.find(l=>l.id==='child')!.fill='#ff0000';a.layers.find(l=>l.id==='result')!.x=650;
    return {sceneId:r.sceneId,artwork:a};
  })})}),rows=appliedArtworkFeedbackRows(h.before),protectedBefore=await artworkFeedbackProtectedInput(h.before,rows,h.projectRoot);
  const [updated,duplicate]=await Promise.all([h.service.reviseArtwork(p.id,{feedback:'  Improve the visual connection  '}),h.service.reviseArtwork(p.id,{feedback:'Improve the visual connection'})]);
  assert.deepEqual(updated,duplicate);assert.equal(h.posts(),1);assert.equal(h.previews(),2);
  const pointer=updated.settings.assembly.documentary!.artworkFeedback!;assert.equal(pointer.status,'applied');assert.equal(pointer.accepted,1);assert.equal(pointer.used,1);
  assert.deepEqual(updated.scenes[1],h.before.scenes[1],'pinned scene unchanged');
  assert.deepEqual(updated.scenes[0]!.documentary!.motionGraphic!.artwork!.layers.find(l=>l.id==='object'),h.before.scenes[0]!.documentary!.motionGraphic!.artwork!.layers.find(l=>l.id==='object'));
  assert.deepEqual(updated.scenes[0]!.documentary!.motionGraphic!.artwork!.layers.filter(l=>l.id==='manual-group'||l.parentId==='manual-group'),
    h.before.scenes[0]!.documentary!.motionGraphic!.artwork!.layers.filter(l=>l.id==='manual-group'||l.parentId==='manual-group'));
  assert.deepEqual(updated.scenes[0]!.documentary!.motionGraphic!.artwork!.palette,h.before.scenes[0]!.documentary!.motionGraphic!.artwork!.palette);
  assert.equal((await artworkFeedbackProtectedInput(updated,rows,h.projectRoot)).hash,protectedBefore.hash);
  const reopened=(await new FileProjectRepository(join(root,'projects.json')).get(p.id))!;assert.deepEqual(reopened.settings.assembly.documentary!.activeArtworkFeedback,pointer);
  const deny=async()=>{throw Error('ordinary assembly must not call semantic/primary/revision/effects');};
  const nextProjects=new ProjectService(new FileProjectRepository(join(root,'projects.json')),new MockDirectorProvider());
  const restart=new DocumentaryProjectService(nextProjects,h.storage,{} as never,root,{} as never,()=>{},{planMotionArtwork:deny,planSemanticMontage:deny} as never);
  const assembled=await restart.prepareMontage(p.id);assert.equal(artworkFeedbackRowsHash(appliedArtworkFeedbackRows(assembled)),pointer.resultArtworkHash);
  const repeated=await h.service.reviseArtwork(p.id,{feedback:'Improve the visual connection'});assert.equal(h.posts(),1);assert.equal(repeated.settings.assembly.documentary!.artworkFeedback!.operationKey,pointer.operationKey);
});
test('FIX1 accepted artwork remains an editable saved montage after music and manual changes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'feedback-fix1-local-edits-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=await basicProject(),pinned=structuredClone(p.scenes[0]!);pinned.id='pinned';pinned.order=1;
  pinned.documentary!.pinned=true;pinned.documentary!.semanticMontage!.sceneId='pinned';p.scenes.push(pinned);
  for(const scene of p.scenes)scene.documentary!.semanticMontageInputHash=semanticMontageHash(p);
  const h=await harness(root,p),accepted=await h.service.reviseArtwork(p.id,{feedback:'A'}),pointer=accepted.settings.assembly.documentary!.activeArtworkFeedback!;
  let callbacks=0;const deny=async()=>{callbacks++;throw Error('ordinary prepare must not rebuild');};
  const restart=new DocumentaryProjectService(new ProjectService(new FileProjectRepository(join(root,'projects.json')),new MockDirectorProvider()),h.storage,{} as never,root,{} as never,()=>{},
    {planMotionArtwork:deny,planSemanticMontage:deny} as never);
  await h.projects.mutate(p.id,current=>({settings:{...current.settings,music:{...current.settings.music,volume:current.settings.music.volume+.01}}}));
  const music=(await h.projects.get(p.id,{omitCandidates:true}))!;
  const preparedMusic=await restart.prepareMontage(p.id);assert.deepEqual(preparedMusic.settings,music.settings);assert.deepEqual(preparedMusic.scenes,music.scenes);
  assert.deepEqual(preparedMusic.settings.assembly.documentary!.activeArtworkFeedback,pointer);assert.equal(callbacks,0);assert.equal(h.posts(),1);
  await h.projects.mutate(p.id,current=>({scenes:current.scenes.map(scene=>{
    if(scene.id!=='rain')return scene;const d=scene.documentary!,art=structuredClone(d.motionGraphic!.artwork!);
    art.layers.unshift({id:'local-group',kind:'group',x:0,y:0,w:1000,h:562,editTransform:{x:14,y:7,scale:1.05,rotation:2}});
    art.layers.find(l=>l.id==='object')!.parentId='local-group';art.layers.find(l=>l.id==='child')!.parentId='local-group';
    art.layers.find(l=>l.id==='object')!.editTransform={x:3,y:6,scale:1.01,rotation:0};art.palette.accent='#86aabb';
    return {...scene,documentary:{...d,semanticMontage:{...d.semanticMontage!,artwork:structuredClone(art)},motionGraphic:{...d.motionGraphic!,artwork:art}}};
  })}));
  const manual=(await h.projects.get(p.id,{omitCandidates:true}))!,manualPersisted=(await new FileProjectRepository(join(root,'projects.json')).get(p.id))!;
  const preparedManual=await restart.prepareMontage(p.id);assert.deepEqual(preparedManual.scenes,manual.scenes);assert.deepEqual(preparedManual.settings,manual.settings);
  assert.deepEqual(preparedManual.scenes[1],music.scenes[1],'pinned artwork unchanged');assert.equal(callbacks,0);assert.equal(h.posts(),1);
  assert.notEqual(artworkFeedbackRowsHash(appliedArtworkFeedbackRows(preparedManual)),pointer.resultArtworkHash,'current manual artwork retained, not original feedback cache');
  const reopened=(await new FileProjectRepository(join(root,'projects.json')).get(p.id))!;assert.deepEqual(reopened,manualPersisted);
});

test('FIX2 ordinary and explicit preparation plan a new active scene and retain current manual feedback artwork',async t=>{
  for(const refreshSemantic of [false,true]){
    const root=await mkdtemp(join(tmpdir(),'feedback-fix2-new-scene-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const p=await basicProject(),pinned=structuredClone(p.scenes[0]!);pinned.id='pinned';pinned.order=1;
    pinned.documentary!.pinned=true;pinned.documentary!.semanticMontage!.sceneId=pinned.id;p.scenes.push(pinned);
    for(const scene of p.scenes)scene.documentary!.semanticMontageInputHash=semanticMontageHash(p);
    const h=await harness(root,p),a=await h.service.reviseArtwork(h.before.id,{feedback:'A'}),pointer=a.settings.assembly.documentary!.activeArtworkFeedback!;
    await h.projects.mutate(a.id,current=>{
      const scenes=structuredClone(current.scenes),d=scenes[0]!.documentary!,art=d.motionGraphic!.artwork!;
      art.layers.unshift({id:'retained-group',kind:'group',x:0,y:0,w:1000,h:562,editTransform:{x:11,y:8,scale:1.03,rotation:2}});
      art.layers.find(l=>l.id==='object')!.parentId='retained-group';art.layers.find(l=>l.id==='child')!.parentId='retained-group';art.palette.accent='#998877';
      d.semanticMontage!.artwork=structuredClone(art);
      const next=structuredClone(scenes[0]!);next.id='new-active';next.order=scenes.length;next.narration='Metal melts in a furnace.';
      delete next.documentary!.semanticMontage;delete next.documentary!.semanticMontageInputHash;delete next.documentary!.motionGraphic;
      return {scenes:[...scenes,next]};
    });
    const edited=(await h.projects.get(a.id))!,kept=edited.scenes[0]!.documentary!.motionGraphic!;
    let semantic=0,artwork=0;
    const service=new DocumentaryProjectService(h.projects,h.storage,{} as never,root,{} as never,()=>{},{
      planSemanticMontage:async(input:Project)=>{semantic++;return {version:1,inputHash:semanticMontageHash(input),model:'mock-semantic',hookSeconds:16,
        scenes:input.scenes.filter(s=>s.includeInAssembly!==false).map(s=>({sceneId:s.id,subject:s.narration,beat:'explain',treatment:'footage',cutawaySceneIds:[]}))};},
      planMotionArtwork:async(input:Project)=>{artwork++;assert.deepEqual(input.scenes[0]!.documentary!.semanticMontage!.artwork,kept.artwork);
        return {version:1,validationVersion:13,inputHash:motionArtworkHash(input),model:'mock-local-no-new-artwork',scenes:[],rejected:[]};}
    } as never);
    const prepared=await service.prepareMontage(a.id,undefined,{refreshSemantic});
    assert.equal(semantic,1);assert.equal(artwork,1);assert.equal(h.posts(),1,'only the original mocked feedback completion');
    const next=prepared.scenes.find(s=>s.id==='new-active')!;
    assert.equal(next.documentary!.semanticMontage!.subject,'Metal melts in a furnace.');
    assert.equal(next.documentary!.semanticMontageInputHash,semanticMontageHash(prepared));
    assert.equal(prepared.settings.assembly.documentary!.semanticMontageStatus!.status,'planned');
    assert.deepEqual(prepared.scenes[0]!.documentary!.motionGraphic,kept);
    const {semanticMontageInputHash:_oldStamp,...oldPinned}=edited.scenes[1]!.documentary!,{semanticMontageInputHash:_newStamp,...newPinned}=prepared.scenes[1]!.documentary!;
    assert.deepEqual(newPinned,oldPinned,'pinned presentation and direction remain intact during new-scene preparation');
    assert.deepEqual(prepared.settings.assembly.documentary!.activeArtworkFeedback,pointer);
    assert.deepEqual(prepared.videoBrief,edited.videoBrief);assert.deepEqual(prepared.settings.music,edited.settings.music);
    assert.deepEqual(prepared.scenes.map(s=>[s.id,s.narration,s.durationSeconds,s.documentary!.timing,s.imagePath,s.videoPath,s.audioPath]),
      edited.scenes.map(s=>[s.id,s.narration,s.durationSeconds,s.documentary!.timing,s.imagePath,s.videoPath,s.audioPath]));
    const reopened=(await new FileProjectRepository(join(root,'projects.json')).get(a.id))!;
    assert.deepEqual(reopened.scenes,JSON.parse(JSON.stringify(prepared.scenes)));
    const raw=await readFile(join(root,'projects.json'));await service.prepareMontage(a.id);assert.equal(semantic,1);assert.equal(artwork,1);
    assert.deepEqual(await readFile(join(root,'projects.json')),raw,'the now-prepared input can use the saved fast path');
  }
});

test('FIX2 narration, media and clock edits invalidate the feedback fast path',async t=>{
  for(const change of ['narration','media','clock'] as const){
    const root=await mkdtemp(join(tmpdir(),'feedback-fix2-invalidate-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const h=await harness(root,await basicProject()),a=await h.service.reviseArtwork(h.before.id,{feedback:'A'});
    await h.projects.mutate(a.id,current=>({scenes:current.scenes.map(scene=>{
      if(change==='narration')return {...scene,narration:scene.narration+' Rain falls to the ground.'};
      if(change==='media')return {...scene,documentary:{...scene.documentary!,checksum:'changed-source-checksum'}};
      return {...scene,documentary:{...scene.documentary!,timing:{...scene.documentary!.timing!,durationInFrames:210}}};
    })}));
    const edited=(await h.projects.get(a.id,{omitCandidates:true}))!;let calls=0;
    const service=new DocumentaryProjectService(h.projects,h.storage,{} as never,root,{} as never,()=>{},{
      planSemanticMontage:async(input:Project)=>{calls++;return {version:1,inputHash:semanticMontageHash(input),model:'mock-semantic',hookSeconds:16,
        scenes:input.scenes.map(s=>({...s.documentary!.semanticMontage!,subject:'prepared '+change}))};},
      planMotionArtwork:async(input:Project)=>({version:1,validationVersion:13,inputHash:motionArtworkHash(input),model:'mock-local',scenes:[],rejected:[]})
    } as never);
    const prepared=await service.prepareMontage(a.id);assert.equal(calls,1,change);
    assert.equal(prepared.scenes[0]!.documentary!.semanticMontage!.subject,'prepared '+change);
    assert.equal(prepared.scenes[0]!.documentary!.semanticMontageInputHash,semanticMontageHash(prepared));
    assert.deepEqual(prepared.scenes[0]!.documentary!.motionGraphic,edited.scenes[0]!.documentary!.motionGraphic);assert.equal(h.posts(),1);
  }
});

test('FIX2 a retained feedback span keeps the exact current artwork on every member while a new scene prepares',async t=>{
  const root=await mkdtemp(join(tmpdir(),'feedback-fix2-span-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=await basicProject(),second=structuredClone(p.scenes[0]!);second.id='cloud';second.order=1;second.documentary!.semanticMontage!.sceneId=second.id;
  delete second.documentary!.semanticMontage!.artwork;delete second.documentary!.motionGraphic;p.scenes.push(second);
  const drawing=validateMotionArtwork(mockDrawing('water',12,0),p.scenes.map(s=>s.narration).join(' '),12,false,16/9,undefined,true).artwork!;assert.ok(drawing);
  p.scenes[0]!.documentary!.semanticMontage!.artwork=drawing;p.scenes[0]!.documentary!.semanticMontage!.artworkSpan={endSceneId:second.id};
  for(const scene of p.scenes)scene.documentary!.semanticMontageInputHash=semanticMontageHash(p);p.scenes=planDocumentaryMontage(p);
  const h=await harness(root,p),a=await h.service.reviseArtwork(p.id,{feedback:'A'});
  await h.projects.mutate(p.id,current=>{
    const next=structuredClone(current.scenes[1]!);next.id='new-active';next.order=2;
    delete next.documentary!.semanticMontage;delete next.documentary!.semanticMontageInputHash;delete next.documentary!.motionGraphic;
    return {scenes:[...current.scenes,next]};
  });
  const before=(await h.projects.get(p.id))!,rows=appliedArtworkFeedbackRows(before);assert.equal(rows.length,1);assert.equal(rows[0]!.artworkSpan!.endSceneId,'cloud');
  const service=new DocumentaryProjectService(h.projects,h.storage,{} as never,root,{} as never,()=>{},{
    planSemanticMontage:async(input:Project)=>({version:1,inputHash:semanticMontageHash(input),model:'mock-semantic',hookSeconds:16,
      scenes:input.scenes.map(s=>({sceneId:s.id,subject:s.narration,beat:'explain',treatment:'footage',cutawaySceneIds:[]}))}),
    planMotionArtwork:async(input:Project)=>({version:1,validationVersion:13,inputHash:motionArtworkHash(input),model:'mock-local',scenes:[],rejected:[]})
  } as never);
  const prepared=await service.prepareMontage(p.id);assert.deepEqual(appliedArtworkFeedbackRows(prepared),rows);
  for(const scene of before.scenes.slice(0,2))assert.deepEqual(prepared.scenes.find(s=>s.id===scene.id)!.documentary!.motionGraphic,scene.documentary!.motionGraphic);
  assert.equal(prepared.scenes[2]!.documentary!.semanticMontageInputHash,semanticMontageHash(prepared));assert.equal(h.posts(),1);
  assert.deepEqual(prepared.settings.assembly.documentary!.activeArtworkFeedback,a.settings.assembly.documentary!.activeArtworkFeedback);
});

test('FIX2 unchanged explicit refresh runs local preparation without restoring the old artwork cache',async t=>{
  const root=await mkdtemp(join(tmpdir(),'feedback-fix2-refresh-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const h=await harness(root,await basicProject()),a=await h.service.reviseArtwork(h.before.id,{feedback:'A'});
  const old=appliedArtworkFeedbackRows(h.before),file=join(h.projectRoot,'Documentary','Montage',motionArtworkHash(a)+'-artwork-v1.json');
  const stale=JSON.stringify({version:1,inputHash:motionArtworkHash(a),model:'OLD-cache',scenes:old,rejected:[]});await writeFile(file,stale);
  let semantic=0,artwork=0,saves=0;const deny=async()=>{semantic++;throw Error('unexpected semantic planner');},ensure=h.storage.ensureProject.bind(h.storage);
  h.storage.ensureProject=async(...args)=>{saves++;return ensure(...args);};
  const service=new DocumentaryProjectService(h.projects,h.storage,{} as never,root,{} as never,()=>{},{planSemanticMontage:deny,
    planMotionArtwork:async(...args:Parameters<DocumentaryIntelligence['planMotionArtwork']>)=>{artwork++;return h.ai.planMotionArtwork(...args);}} as never);
  const prepared=await service.prepareMontage(a.id,undefined,{refreshSemantic:true});
  assert.equal(saves,1,'explicit refresh reached normal local preparation');assert.equal(semantic,0);assert.equal(artwork,1);assert.equal(h.posts(),1,'actual guard reused COMPLETE without a new completion');
  assert.deepEqual(appliedArtworkFeedbackRows(prepared),appliedArtworkFeedbackRows(a));assert.equal(await readFile(file,'utf8'),stale);
});

test('FIX2 changed inputs still reach the actual strict artwork guard, preserving pointer and receipts without a retry',async t=>{
  const root=await mkdtemp(join(tmpdir(),'feedback-fix2-strict-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const h=await harness(root,await basicProject()),a=await h.service.reviseArtwork(h.before.id,{feedback:'A'}),pointer=a.settings.assembly.documentary!.activeArtworkFeedback!;
  const receipt=join(h.projectRoot,'Documentary','Analysis',pointer.analysisKey+'.json'),bytes=await readFile(receipt);
  await h.projects.mutate(a.id,current=>({scenes:current.scenes.map(s=>({...s,narration:s.narration+' Rain returns.'}))}));
  const persisted=await readFile(join(root,'projects.json'));let semantic=0;
  const service=new DocumentaryProjectService(h.projects,h.storage,{} as never,root,{} as never,()=>{},{
    planSemanticMontage:async(input:Project)=>{semantic++;return {version:1,inputHash:semanticMontageHash(input),model:'mock-semantic',hookSeconds:16,
      scenes:input.scenes.map(s=>s.documentary!.semanticMontage!)};},planMotionArtwork:h.ai.planMotionArtwork.bind(h.ai)
  } as never);
  await assert.rejects(service.prepareMontage(a.id),/no-retry/);assert.equal(semantic,1);assert.equal(h.posts(),1);
  assert.deepEqual(await readFile(receipt),bytes);assert.deepEqual(await readFile(join(root,'projects.json')),persisted);
  assert.deepEqual((await h.projects.get(a.id))!.settings.assembly.documentary!.activeArtworkFeedback,pointer);
});

test('FIX3 missing whole or nested automatic artwork reaches the actual strict guard without silent success or retry',async t=>{
  for(const missing of ['graphic','payload'] as const){
    const root=await mkdtemp(join(tmpdir(),'feedback-fix3-missing-mounted-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const h=await harness(root,await basicProject()),a=await h.service.reviseArtwork(h.before.id,{feedback:'A'}),pointer=a.settings.assembly.documentary!.activeArtworkFeedback!;
    const receipt=join(h.projectRoot,'Documentary','Analysis',pointer.analysisKey+'.json'),receiptBytes=await readFile(receipt);
    await h.projects.mutate(a.id,current=>({scenes:current.scenes.map(s=>{
      const documentary=structuredClone(s.documentary!);
      if(missing==='graphic')delete documentary.motionGraphic;else delete documentary.motionGraphic!.artwork;
      return {...s,documentary};
    })}));
    const current=(await h.projects.get(a.id,{omitCandidates:true}))!;
    assert.ok(planDocumentaryMontage(current)[0]!.documentary!.motionGraphic!.artwork,'saved semantic artwork can be mounted locally');
    if(missing==='payload'){assert.equal(current.scenes[0]!.documentary!.motionGraphic!.enabled,true);assert.equal(current.scenes[0]!.documentary!.motionGraphic!.origin,'automatic');}
    const persisted=await readFile(join(root,'projects.json'));let semantic=0,artwork=0;
    const service=new DocumentaryProjectService(h.projects,h.storage,{} as never,root,{} as never,()=>{},{
      planSemanticMontage:async()=>{semantic++;throw Error('semantic stamps are current');},
      planMotionArtwork:async(...args:Parameters<DocumentaryIntelligence['planMotionArtwork']>)=>{artwork++;return h.ai.planMotionArtwork(...args);}
    } as never);
    await assert.rejects(service.prepareMontage(a.id),/no-retry/);assert.equal(semantic,0);assert.equal(artwork,1);assert.equal(h.posts(),1);
    assert.deepEqual(await readFile(join(root,'projects.json')),persisted,'strict guard stops visibly without an old cache attachment');
    assert.deepEqual(await readFile(receipt),receiptBytes);
    assert.deepEqual((await h.projects.get(a.id))!.settings.assembly.documentary!.activeArtworkFeedback,pointer);
  }
});

test('FIX3 deliberate disabled or manual graphics retain their priority without preparation callbacks or writes',async t=>{
  for(const priority of ['disabled','manual'] as const){
    const root=await mkdtemp(join(tmpdir(),'feedback-fix3-manual-priority-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const h=await harness(root,await basicProject()),a=await h.service.reviseArtwork(h.before.id,{feedback:'A'}),pointer=a.settings.assembly.documentary!.activeArtworkFeedback!;
    const receipt=join(h.projectRoot,'Documentary','Analysis',pointer.analysisKey+'.json'),receiptBytes=await readFile(receipt);
    await h.projects.mutate(a.id,current=>({scenes:current.scenes.map(s=>{
      const documentary=structuredClone(s.documentary!);delete documentary.motionGraphic!.artwork;
      if(priority==='disabled')documentary.motionGraphic!.enabled=false;else documentary.motionGraphic!.origin='manual';
      return {...s,documentary};
    })}));
    const current=(await h.projects.get(a.id,{omitCandidates:true}))!,persisted=await readFile(join(root,'projects.json'));let callbacks=0;
    const deny=async()=>{callbacks++;throw Error('deliberate manual/disabled priority must remain current');};
    const service=new DocumentaryProjectService(h.projects,h.storage,{} as never,root,{} as never,()=>{},{planSemanticMontage:deny,planMotionArtwork:deny} as never);
    assert.deepEqual(await service.prepareMontage(a.id),current);assert.equal(callbacks,0);assert.equal(h.posts(),1);
    assert.deepEqual(await readFile(join(root,'projects.json')),persisted);assert.deepEqual(await readFile(receipt),receiptBytes);
    assert.deepEqual((await h.projects.get(a.id))!.settings.assembly.documentary!.activeArtworkFeedback,pointer);
  }
});

test('FIX2 a concurrent manual artwork edit during preparation is preserved and causes a visible stop',async t=>{
  const root=await mkdtemp(join(tmpdir(),'feedback-fix2-concurrent-manual-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const h=await harness(root,await basicProject()),a=await h.service.reviseArtwork(h.before.id,{feedback:'A'});
  await h.projects.mutate(a.id,current=>({scenes:current.scenes.map(s=>({...s,narration:s.narration+' Rain returns.'}))}));
  let edited:Project|undefined;
  const service=new DocumentaryProjectService(h.projects,h.storage,{} as never,root,{} as never,()=>{},{
    planSemanticMontage:async(input:Project)=>{
      edited=await h.projects.mutate(a.id,current=>({scenes:current.scenes.map(s=>{
        const d=s.documentary!,art=structuredClone(d.motionGraphic!.artwork!);art.palette.accent='#112233';
        return {...s,documentary:{...d,motionGraphic:{...d.motionGraphic!,artwork:art},semanticMontage:{...d.semanticMontage!,artwork:art}}};
      })}));
      return {version:1,inputHash:semanticMontageHash(input),model:'mock-semantic',hookSeconds:16,scenes:input.scenes.map(s=>s.documentary!.semanticMontage!)};
    },planMotionArtwork:async(input:Project)=>({version:1,validationVersion:13,inputHash:motionArtworkHash(input),model:'mock-local',scenes:[],rejected:[]})
  } as never);
  await assert.rejects(service.prepareMontage(a.id),/графика изменилась/);assert.equal(h.posts(),1);
  assert.deepEqual(appliedArtworkFeedbackRows((await h.projects.get(a.id))!),appliedArtworkFeedbackRows(edited!));
});

test('FIX1 failed B retains accepted A across reopen, ordinary prepare and exact A repeat',async t=>{
  const root=await mkdtemp(join(tmpdir(),'feedback-fix1-failed-b-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=await basicProject(),h=await harness(root,p,{reply:data=>data.userFeedback==='B'?{scenes:[]}:{scenes:data.scenes.map((r:any)=>{
    const artwork=structuredClone(r.artwork);artwork.palette.accent='#d19c70';return {sceneId:r.sceneId,artwork};
  })}});
  const a=await h.service.reviseArtwork(p.id,{feedback:'A'}),pointer=a.settings.assembly.documentary!.activeArtworkFeedback!;
  const b=await h.service.reviseArtwork(p.id,{feedback:'B'});assert.equal(b.settings.assembly.documentary!.artworkFeedback!.status,'blocked');assert.equal(h.posts(),2);
  const reopened=(await h.projects.get(p.id,{omitCandidates:true}))!;assert.deepEqual(reopened.settings.assembly.documentary!.activeArtworkFeedback,pointer);
  let callbacks=0;const deny=async()=>{callbacks++;throw Error('unexpected planner');};
  const restart=new DocumentaryProjectService(new ProjectService(new FileProjectRepository(join(root,'projects.json')),new MockDirectorProvider()),h.storage,{} as never,root,{} as never,()=>{},
    {planMotionArtwork:deny,planSemanticMontage:deny} as never);
  const prepared=await restart.prepareMontage(p.id);assert.deepEqual(prepared.scenes,reopened.scenes);assert.deepEqual(prepared.settings,reopened.settings);assert.equal(callbacks,0);
  const repeat=await h.service.reviseArtwork(p.id,{feedback:'A'});assert.equal(repeat.settings.assembly.documentary!.activeArtworkFeedback!.operationKey,pointer.operationKey);
  assert.deepEqual(appliedArtworkFeedbackRows(repeat),appliedArtworkFeedbackRows(a));assert.equal(h.posts(),2);
});

test('FIX1 ordinary prepare preserves current montage without fabricating corrupt receipt completion; paid reuse still stops',async t=>{
  const root=await mkdtemp(join(tmpdir(),'feedback-fix1-receipt-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const p=await basicProject(),h=await harness(root,p),a=await h.service.reviseArtwork(p.id,{feedback:'A'}),pointer=a.settings.assembly.documentary!.activeArtworkFeedback!;
  const file=join(h.projectRoot,'Documentary','Analysis',pointer.analysisKey+'.json'),unknown=JSON.stringify({state:'unknown',purpose:'semantic-montage'});
  await writeFile(file,unknown);
  const before=(await h.projects.get(p.id,{omitCandidates:true}))!,prepared=await h.service.prepareMontage(p.id);
  assert.deepEqual(prepared.scenes,before.scenes);assert.deepEqual(prepared.settings,before.settings);assert.equal(await readFile(file,'utf8'),unknown);
  await assert.rejects(h.service.reviseArtwork(p.id,{feedback:'A'}));assert.equal(h.posts(),1);assert.equal(await readFile(file,'utf8'),unknown);
  const after=(await h.projects.get(p.id))!;assert.deepEqual(after.settings.assembly.documentary!.activeArtworkFeedback,pointer);
});

test('paid COMPLETE after concurrent project edit remains saved for local recovery; no stale application or repeat POST',async t=>{
  const root=await mkdtemp(join(tmpdir(),'feedback-service-stale-'));t.after(()=>rm(root,{recursive:true,force:true}));const p=await basicProject();let h:Awaited<ReturnType<typeof harness>>;
  h=await harness(root,p,{afterReply:async()=>{await h.projects.mutate(p.id,current=>({scenes:current.scenes.map(s=>({...s,narration:s.narration+' Changed while model ran.'}))}));}});
  await assert.rejects(h.service.reviseArtwork(p.id,{feedback:'improve'}),/изменились/);assert.equal(h.posts(),1);
  const changed=(await h.projects.get(p.id))!,pointer=changed.settings.assembly.documentary!.artworkFeedback!;assert.equal(pointer.status,'blocked');
  assert.deepEqual(changed.scenes[0]!.documentary!.motionGraphic!.artwork,h.before.scenes[0]!.documentary!.motionGraphic!.artwork);
  assert.equal(JSON.parse(await readFile(join(h.projectRoot,'Documentary','Analysis',pointer.analysisKey+'.json'),'utf8')).state,'complete');
  await h.projects.mutate(p.id,()=>({scenes:h.before.scenes}));
  const recovered=await h.service.reviseArtwork(p.id,{feedback:'improve'});assert.equal(recovered.settings.assembly.documentary!.artworkFeedback!.status,'applied');assert.equal(h.posts(),1);
});
test('transport-time stale guard stops before actual model dispatch',async t=>{
  const root=await mkdtemp(join(tmpdir(),'feedback-presubmit-'));t.after(()=>rm(root,{recursive:true,force:true}));const p=await basicProject();let h:Awaited<ReturnType<typeof harness>>;
  h=await harness(root,p,{beforePaidRequest:async()=>{await h.projects.mutate(p.id,current=>({settings:{...current.settings,music:{...current.settings.music,enabled:true}}}));}});
  await assert.rejects(h.service.reviseArtwork(p.id,{feedback:'improve'}),/изменились/);assert.equal(h.posts(),0);
});
test('failed pre-request preview persists the text and visible blocked status with original artwork and zero posts',async t=>{
  const root=await mkdtemp(join(tmpdir(),'feedback-preview-block-'));t.after(()=>rm(root,{recursive:true,force:true}));const p=await basicProject(),h=await harness(root,p,{failPreview:true});
  await assert.rejects(h.service.reviseArtwork(p.id,{feedback:'keep whole objects'}),/mock native preview failed/);
  const reopened=(await new FileProjectRepository(join(root,'projects.json')).get(p.id))!;
  assert.equal(reopened.settings.assembly.documentary!.artworkFeedback!.feedback,'keep whole objects');assert.equal(reopened.settings.assembly.documentary!.artworkFeedback!.status,'blocked');
  assert.ok(reopened.settings.assembly.documentary!.artworkFeedback!.message.includes('preview failed'));
  assert.deepEqual(appliedArtworkFeedbackRows(reopened),appliedArtworkFeedbackRows(h.before));assert.equal(h.posts(),0);
});

test('changed UI action saves text/status, blocks double click and reopens from the real repository', {timeout:90000},async t=>{
  const persistent=process.env.GWS_FEEDBACK_UI_EVIDENCE;
  if(persistent)await mkdir(resolve(persistent),{recursive:true});
  const root=await mkdtemp(join(persistent?resolve(persistent):tmpdir(),'feedback-ui-'));
  if(!persistent)t.after(()=>rm(root,{recursive:true,force:true}));
  const p=await basicProject(),h=await harness(join(root,'fixture'),p),require=createRequire(import.meta.url);
  const esbuild=createRequire(require.resolve('electron-vite'))('esbuild') as {build:(options:Record<string,unknown>)=>Promise<{outputFiles:Array<{contents:Uint8Array}>}>};
  const renderer=resolve(import.meta.dirname,'../../renderer/src');
  const bundle=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ArtworkFeedbackAction} from './StockProduction';
    function Fixture(){const [project,setProject]=React.useState(window.__project);return <ArtworkFeedbackAction project={project} onRevise={async feedback=>{const r=await fetch('/revise',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({feedback})});const value=await r.json();if(!r.ok)throw Error(value.error);setProject(value);}}/>};
    createRoot(document.getElementById('root')).render(<Fixture/>);`,loader:'tsx',resolveDir:renderer},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',logLevel:'silent'});
  let requests=0;
  const server=createServer(async(req,res)=>{
    try{
      if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0]!.contents);return;}
      if(req.url==='/revise'&&req.method==='POST'){
        let body='';for await(const part of req)body+=String(part);requests++;
        const updated=await h.service.reviseArtwork(p.id,JSON.parse(body));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(updated));return;
      }
      const current=(await h.projects.get(p.id))!;res.setHeader('Content-Type','text/html');
      res.end(`<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;padding:40px;max-width:900px;background:#eef1f5}textarea{display:block;width:800px;height:130px;margin:12px 0}button{padding:12px;font-size:16px}p{line-height:1.5}</style><div id="root"></div><script>window.__project=${JSON.stringify(current).replace(/</gu,'\\u003c')}</script><script src="/app.js"></script>`);
    }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error instanceof Error?error.message:String(error)}));}
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise<void>(done=>server.close(()=>done())));
  const port=(server.address() as {port:number}).port,browser=await openDocumentaryRenderBrowser();t.after(()=>browser.instance.close({silent:true}));
  const page=await browser.instance.newPage({context:null as never,logLevel:'warn',indent:false,pageIndex:0,onBrowserLog:null,onLog:()=>{}});
  await page.setViewport({width:1040,height:700,deviceScaleFactor:1});
  const waitFor=async(expression:string)=>{for(let i=0;i<100;i++){if(await page.evaluate(expression))return;await new Promise(done=>setTimeout(done,50));}throw Error('UI timeout: '+expression);};
  const url=`http://127.0.0.1:${port}`;await page.goto({url,timeout:30000});await waitFor('Boolean(document.querySelector("textarea"))');
  const feedback='Сохранить финальное время чтения и улучшить связь целых объектов.';
  await page.evaluate(`(()=>{const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(feedback)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await waitFor('!document.querySelector("button").disabled');
  await page.evaluate(`document.querySelector('button').click();document.querySelector('button').click();`);
  await waitFor('Boolean(document.querySelector("[role=status]")?.textContent.includes("Прикреплено"))');
  assert.equal(requests,1);assert.equal(h.posts(),1);
  await page.goto({url,timeout:30000});await waitFor('Boolean(document.querySelector("[role=status]"))');
  assert.equal(await page.evaluate('document.querySelector("textarea").value'),feedback);
  assert.ok(String(await page.evaluate('document.querySelector("[role=status]").textContent')).includes('Прикреплено'));
  const capture=await page._client().send('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'ui-save-reopen.png'),Buffer.from(capture.value.data,'base64'));
  await writeFile(join(root,'ui-result.json'),JSON.stringify({scope:'local browser changed component + real service/repository, mocked model/native previews',requests,mockedRevisionPosts:h.posts(),realProviderPosts:0,textReopened:feedback,status:'applied',doubleClick:'one request'},null,2));
});

// Explicitly opt in to copying the already-known immutable project. No canonical write, live model or Final render.
test('isolated current-project copy: REAL native pre/post previews, fresh mocked answer, protected tracks and ordinary reopen/assemble',{
  skip:!process.env.GWS_FEEDBACK_SOURCE_PROJECT,timeout:240000,
},async t=>{
  const sourceFile=resolve(process.env.GWS_FEEDBACK_SOURCE_PROJECT!),sourceRoot=dirname(sourceFile);
  const evidence=resolve(process.env.GWS_FEEDBACK_EVIDENCE??join(tmpdir(),'gws-feedback-native-evidence'));
  await mkdir(evidence,{recursive:true});const sourceBytes=await readFile(sourceFile),project=JSON.parse(sourceBytes.toString()) as Project;
  const task=join(evidence,'task-copy'),taskProjectRoot=join(task,'projects',project.id);await mkdir(taskProjectRoot,{recursive:true});
  const filesBefore:Array<{path:string;sha256:string}>=[];
  // Copy only immutable JSON receipts and actual project-owned media refs; Final and old preview caches are excluded.
  for(const folder of ['Analysis','Montage']){
    const from=join(sourceRoot,'Documentary',folder),to=join(taskProjectRoot,'Documentary',folder);
    await cp(from,to,{recursive:true,filter:path=>!path.includes('feedback')});
    for(const name of await readdir(from)){if(!name.endsWith('.json'))continue;const path=join(from,name);filesBefore.push({path,sha256:sha(await readFile(path))});}
  }
  // Media stays read-only at its exact existing identity; all generated caches/stills/receipts use taskProjectRoot.
  delete project.outputPath;delete project.lastRender;
  const h=await harness(task,project,{native:true,existingParents:true,reply:data=>({scenes:data.scenes.map((r:any)=>{
    // Fresh tiny synthetic response, unrelated to old 33-layer COMPLETE. Its role is storage/validator/native-route proof only.
    const source=project.scenes.find(s=>s.id===r.sceneId)!,literal=source.narration.split(/\s+/u).slice(0,4).join(' ').replace(/[.,;:!?]+$/u,'');
    return {sceneId:r.sceneId,artwork:mockDrawing(literal,r.artwork.durationSeconds,r.artwork.startSeconds)};
  })})});
  const rows=appliedArtworkFeedbackRows(h.before),protectedBefore=await artworkFeedbackProtectedInput(h.before,rows,h.projectRoot),timeline=buildDocumentaryTimeline(h.before);
  assert.equal(h.before.scenes.length,50);assert.equal(h.before.scenes.filter(s=>s.includeInAssembly!==false).length,6);assert.equal(timeline.durationInFrames,914);
  const oldMode=await createMotionArtworkPlan(h.before,h.projectRoot,async()=>{throw Error('old mode must reuse immutable COMPLETE, no model call');},'zero-call-oldmode',undefined,{savedOnly:true});
  assert.equal(oldMode.scenes[0]!.artwork.layers.length,33);assert.deepEqual(oldMode.scenes,rows,'old 33-layer COMPLETE is only a zero-call old-mode regression');
  const updated=await h.service.reviseArtwork(project.id,{feedback:'LOCAL MOCK SOURCE TEST: improve the readable relation while preserving narration, span, whole-object action and final hold.'});
  const pointer=updated.settings.assembly.documentary!.artworkFeedback!;assert.equal(pointer.status,'applied');assert.ok(pointer.accepted!>0);assert.equal(h.posts(),1);assert.equal(h.previews(),2);
  assert.equal((await artworkFeedbackProtectedInput(updated,rows,h.projectRoot)).hash,protectedBefore.hash);
  const reopened=(await new FileProjectRepository(join(task,'projects.json')).get(project.id))!;
  const assembled=await h.service.prepareMontage(project.id);assert.deepEqual(appliedArtworkFeedbackRows(assembled),appliedArtworkFeedbackRows(reopened));assert.equal(h.posts(),1);
  const repeated=await h.service.reviseArtwork(project.id,{feedback:pointer.feedback});assert.equal(repeated.settings.assembly.documentary!.artworkFeedback!.operationKey,pointer.operationKey);assert.equal(h.posts(),1);
  assert.equal(sha(await readFile(sourceFile)),sha(sourceBytes));for(const file of filesBefore)assert.equal(sha(await readFile(file.path)),file.sha256,file.path);
  await writeFile(join(evidence,'native-result.json'),JSON.stringify({scope:'SOURCE-ONLY; fresh mock completion, real native stills; NOT artistic/live PASS',sourceProjectSha256:sha(sourceBytes),
    projectId:project.id,scenes:50,active:6,frames:914,scriptBytes:Buffer.byteLength(h.before.videoBrief?.readyScript??''),voices:h.before.scenes.filter(s=>s.audioPath).length,
    operation:pointer,protectedBefore:protectedBefore.hash,protectedAfter:(await artworkFeedbackProtectedInput(updated,rows,h.projectRoot)).hash,
    externalFetch:'fail-closed except loopback',realProviderPosts:0,mockedRevisionPosts:h.posts(),nativePreviewBatches:h.previews(),semanticPosts:0,primaryPosts:0,canonicalWrites:0,finalRenders:0,preservedFiles:filesBefore},null,2));
});
