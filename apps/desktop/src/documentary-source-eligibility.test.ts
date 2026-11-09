import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentaryArtwork,Project} from '@gold-work/shared';
import {documentaryAiPlanContext,documentaryManualReviewReady} from '@gold-work/shared';
import {documentarySourceFootageIssue,documentaryStandaloneArtworkReady,documentaryVisualSourceIssue} from './documentary-source-eligibility.js';
import {missingAssemblyInputs} from './assembly-readiness.js';
import {documentaryEditErrors} from './documentary-validation.js';
import {createSemanticMontagePlan,enrichSemanticMontage,montageCutawaySources,semanticMontageHash} from './documentary-semantic-montage.js';
import {allowedArtworkMediaSources} from './documentary-artwork-source-allowlist.js';
import {motionArtworkPreviews} from './documentary-artwork-previews.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {buildDocumentaryTimeline} from '../../../packages/remotion-video/src/documentary-timeline.js';

function fixture(title='pit crew members pushing a f1 car'):Project {
  const narration="His destination was Yamaha, a team that hadn't won a single race all year.";
  return {id:'eligibility',mediaMode:'stock',aspectRatio:'16:9',language:'en',settings:{voice:{enabled:true},video:{enabled:true},music:{enabled:false},
    assembly:{documentary:{version:2,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich'}}}},
    scenes:[{id:'yamaha',order:0,narration,durationSeconds:128/30,imagePath:'poster.jpg',videoPath:'selected.mp4',audioPath:'original-voice.mp3',
      documentary:{verified:false,illustrative:true,layout:'full',effects:[],caption:{enabled:false,text:''},checksum:'selected-hash',
        requirement:{text:narration,identities:[{name:'Yamaha YZR-M1 factory team 2003'}],years:['2003'],detail:'Yamaha YZR-M1 motorcycle 2003 season'},
        selected:{id:'pexels:16605635',provider:'pexels',kind:'video',title,rights:'pexels',localPath:'selected.mp4',width:1920,height:1080,durationSeconds:12},
        manualReview:{version:1,status:'pending',provider:'pexels',kind:'video',candidateId:'pexels:16605635',checksum:'selected-hash',mediaPath:'selected.mp4',narration,reason:'Approximate footage; manual review pending'},
        timing:{sourceKey:'voice',durationInFrames:128,speechSeconds:4.03669,audioPath:'original-voice.mp3'},
        semanticMontage:{sceneId:'yamaha',subject:'Yamaha',beat:'conflict',treatment:'footage',cutawaySceneIds:[]}}}]} as unknown as Project;
}

// Existing water-cycle test drawing, solely an offline compositor fixture.
function drawing():DocumentaryArtwork {
  return {version:1,intent:'Water cycle',layout:'full',canvas:{width:1000,height:600},startSeconds:0,durationSeconds:128/30,
    palette:{background:'#101820',ink:'#f5f0e5',accent:'#7ab5ce',secondary:'#cbb583'},
    layers:[{id:'water',kind:'ellipse',x:100,y:420,w:230,h:70,fill:'accent'},
      {id:'vapour',kind:'path',x:180,y:180,w:100,h:200,path:'M50 100Q10 70 50 40Q90 10 50 0',stroke:'ink',fill:'none',keyframes:[{t:0,draw:0},{t:1,draw:1}]},
      {id:'cloud',kind:'ellipse',x:400,y:150,w:300,h:100,fill:'ink'}]};
}

test('the exported F1/Yamaha mismatch fails ordinary validation/readiness despite illustrative and footage treatment',()=>{
  const p=fixture(),before=structuredClone(p),s=p.scenes[0]!;
  assert.equal(documentaryManualReviewReady(s),true,'approximate file retains its current review contract');
  assert.match(documentarySourceFootageIssue(s)!,/мотоцикл.*автомобиль/u);
  assert.ok(documentaryEditErrors(p).some(issue=>issue.includes('противоречит')));
  assert.ok(missingAssemblyInputs(p).some(issue=>issue.includes('противоречит')));
  for(const treatment of ['footage','archive','television'] as const){s.documentary!.semanticMontage!.treatment=treatment;
    assert.ok(documentaryVisualSourceIssue(s,p.scenes));}
  s.documentary!.semanticMontage!.treatment='footage';assert.deepEqual(p,before);
  assert.deepEqual(allowedArtworkMediaSources(p,s.id),[],'mismatched source cannot become a media layer');
});

test('compatible approximate footage keeps pending review and explicit Export; absence of review is not a mismatch',()=>{
  for(const title of ['exciting motorcycle race in urban circuit','MotoGP pit garage team bike','racing team in a garage']){
    const p=fixture(title),s=p.scenes[0]!;
    assert.equal(documentaryManualReviewReady(s),true);assert.equal(s.documentary!.verified,false);
    assert.equal(documentarySourceFootageIssue(s),undefined);assert.deepEqual(missingAssemblyInputs(p),[]);
    assert.deepEqual(allowedArtworkMediaSources(p,s.id),[s]);
  }
});

test('negative title evidence uses object families, not a Rossi/F1 blacklist or generated search hints',()=>{
  const p=fixture('motorbike on a circuit'),s=p.scenes[0]!;
  s.narration='The automobile entered the pits.';s.documentary!.requirement={...s.documentary!.requirement,text:s.narration,detail:'a car',identities:[]};
  assert.match(documentarySourceFootageIssue(s)!,/автомобиль.*мотоцикл/u);
  for(const title of ['a motorcycle passing a car','a garage','not a motorcycle']){s.documentary!.selected!.title=title;assert.equal(documentarySourceFootageIssue(s),undefined);}
  s.documentary!.selected!.title='garage';s.documentary!.selected!.description='motorbike';s.documentary!.selected!.query='motorcycle';
  assert.equal(documentarySourceFootageIssue(s),undefined);
  s.documentary!.selected!.title='motorbike';s.documentary!.verified=true;assert.equal(documentarySourceFootageIssue(s),undefined);
  s.documentary!.verified=false;s.documentary!.pinned=true;assert.equal(documentarySourceFootageIssue(s),undefined);
});

test('only a fully covering applied standalone artwork can replace the source; semantic intent and overlays cannot',()=>{
  const p=fixture(),s=p.scenes[0]!,d=s.documentary!;
  s.narration='Warm water evaporates. The vapour condenses into clouds.';d.requirement={...d.requirement,text:s.narration,detail:'motorcycle',identities:[]};
  d.semanticMontage!.artworkMode='standalone';assert.ok(documentaryVisualSourceIssue(s,p.scenes));
  d.semanticMontage!.artwork=drawing();p.scenes=enrichSemanticMontage(p);
  const applied=p.scenes[0]!;assert.equal(documentaryStandaloneArtworkReady(applied),true);
  assert.equal(applied.documentary!.verified,false);assert.equal(documentaryVisualSourceIssue(applied,p.scenes),undefined);
  assert.deepEqual(documentaryEditErrors(p),[]);assert.deepEqual(missingAssemblyInputs(p),[]);
  const timeline=buildDocumentaryTimeline(p);assert.equal(timeline.durationInFrames,128);assert.equal(timeline.scenes[0]!.audioPath,s.audioPath);
  const g=applied.documentary!.motionGraphic!;
  for(const change of [()=>g.startSeconds=.2,()=>g.durationSeconds=4,()=>g.artwork!.layout='overlay',()=>g.artwork!.layers.push({id:'media',kind:'media',x:0,y:0,w:100,h:100})]){
    const original=structuredClone(g);change();assert.equal(documentaryStandaloneArtworkReady(applied),false);assert.ok(documentaryVisualSourceIssue(applied,p.scenes));Object.assign(g,original);
  }
  delete applied.videoPath;delete applied.imagePath;delete applied.documentary!.manualReview;
  assert.deepEqual(missingAssemblyInputs(p),[],'fully independent visual needs no verified underlying stock');
});

test('mismatched cutaway cannot enter another scene or a replacement; a complete compatible replacement remains usable',()=>{
  const p=fixture('MotoGP team in a garage'),good=p.scenes[0]!,bad=structuredClone(good);
  bad.id='bad';bad.order=1;bad.videoPath='other.mp4';bad.imagePath='other.jpg';bad.documentary!.checksum='other';bad.documentary!.selected!.title='F1 car';
  p.scenes.push(bad);assert.deepEqual(montageCutawaySources(good,p.scenes),[]);
  good.documentary!.cuts=[{id:'wrong',fromFrame:0,durationInFrames:128,sourceSceneId:bad.id,trimStartSeconds:0,playbackRate:1}];
  assert.ok(documentaryVisualSourceIssue(good,p.scenes));
  good.documentary!.cuts=undefined;bad.documentary!.cuts=[{id:'replacement',fromFrame:0,durationInFrames:128,sourceSceneId:good.id,trimStartSeconds:0,playbackRate:1}];
  assert.equal(documentaryVisualSourceIssue(bad,p.scenes),undefined);
  bad.documentary!.cuts[0]!.durationInFrames=64;assert.ok(documentaryVisualSourceIssue(bad,p.scenes));
});

test('new ordinary semantic input separates title from observation and commissions by meaning; legacy pending receipt keeps its exact key',async t=>{
  const p=fixture(),root=await mkdtemp(join(tmpdir(),'source-eligibility-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await createSemanticMontagePlan(p,root,async(system,input)=>{
    const payload=JSON.parse(input),source=payload.sources[0];
    assert.equal(source.observed,undefined);assert.equal(source.sourceTitle,'pit crew members pushing a f1 car');
    assert.match(source.footageIssue,/противоречит/u);assert.match(system,/missing verification alone does not exclude/u);
    return {scenes:payload.scenes.map((row:{sceneId:string})=>({sceneId:row.sceneId,beat:'conflict',treatment:'footage',cutawaySceneIds:[]}))};
  },'offline');
  // Frozen pre-eligibility serializer and prompt, before sceneDirection and replacementSources existed.
  const key='933dad4d82d558bd130999d934be33d71862547ea11b7c2b46f73f644c366808',storyContext=documentaryAiPlanContext(p);
  const legacyRoot=join(root,'pending');await mkdir(join(legacyRoot,'Documentary','Analysis'),{recursive:true});await mkdir(join(legacyRoot,'Documentary','Montage'),{recursive:true});
  await writeFile(join(legacyRoot,'Documentary','Analysis',key+'.json'),JSON.stringify({state:'pending'}));
  await writeFile(join(legacyRoot,'Documentary','Montage',semanticMontageHash(p)+'-batches.json'),JSON.stringify({version:2,inputHash:semanticMontageHash(p),storyContext}));
  await assert.rejects(createSemanticMontagePlan(p,legacyRoot,async(system,input)=>{
    assert.equal(documentaryCheckpointKey('semantic-montage',system,input,[]),key);throw Error('existing unknown retained; no dispatch');
  },'offline'),/existing unknown retained/u);
});

test('new artwork authoring receives an unavailable mismatched source without extracting frames; legacy reconstruction stays unchanged',async t=>{
  const p=fixture(),root=await mkdtemp(join(tmpdir(),'artwork-source-eligibility-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const input=JSON.stringify({scenes:[{sceneId:'yamaha',editable:true,sourceMedia:{available:true,kind:'video'}}]});
  const preview=await motionArtworkPreviews(p,input,root),row=JSON.parse(preview.input).scenes[0];
  assert.deepEqual(preview.images,[]);assert.equal(row.sourceMedia.available,false);assert.match(row.footageIssue,/противоречит/u);
  assert.equal(row.sourceTitle,p.scenes[0]!.documentary!.selected!.title);
});
