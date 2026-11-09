import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import type {DocumentaryArtwork as Artwork,Project} from '@gold-work/shared';
import {DocumentaryArtwork,artworkCameraState,artworkObjectState,artworkTrajectoryFit} from '../../../packages/remotion-video/dist/DocumentaryArtwork.js';
import {validateMotionArtwork,createMotionArtworkPlan} from './documentary-artwork-plan.js';
import {artworkForRevision,preserveArtworkManualLayers} from './documentary-artwork-revision.js';
import {documentaryMontageSoundEvents} from './documentary-effects.js';
import {planArtworkPhases} from './documentary-artwork-phase-renderer.js';
import {AnyModelModelUnavailableError} from './anymodel-text-fallback.js';
const require=createRequire(import.meta.url);
const {createElement}=require('react') as {createElement:(type:unknown,props:object)=>unknown};
const {renderToStaticMarkup}=require('react-dom/server') as {renderToStaticMarkup:(node:unknown)=>string};
const drawing=():Artwork=>({version:1,motionCoordinates:'relative',intent:'A transfer triggers the receiving object',layout:'full',canvas:{width:1000,height:600},
  palette:{background:'#eeeeee',ink:'#222222',accent:'#dd4433',secondary:'#336677'},startSeconds:0,durationSeconds:6,
  camera:{path:'continuous',keyframes:[{t:0,x:500,y:300,scale:1,rotation:0,velocity:{x:0,y:0,scale:0,rotation:0}},
    {t:.5,x:570,y:320,scale:1.35,rotation:5},{t:1,x:620,y:290,scale:1.1,rotation:-3,velocity:{x:0,y:0,scale:0,rotation:0}}]},
  layers:[{id:'carrier',kind:'rect',x:150,y:200,w:160,h:120,fill:'accent',depth:.7},
    {id:'receiver',kind:'ellipse',x:600,y:200,w:180,h:180,fill:'secondary',depth:-.6},
    {id:'peer',kind:'rect',x:380,y:430,w:160,h:80,fill:'ink'}],
  actions:[{id:'transfer',layerId:'carrier',start:.1,end:.4,from:{x:0},to:{x:200},ease:'linear',sound:'transition'},
    {id:'contact',layerId:'receiver',after:'transfer',start:.4,end:.65,from:{scale:1},to:{scale:1.35},sound:'click'}]});
const project=():Project=>({id:'stage5',title:'Transfer',language:'en',aspectRatio:'16:9',mediaMode:'stock',
  videoBrief:{readyScript:'Original full script.\nThe object moves.\nThen it reacts.\nOutside the slice — точный текст.'},
  settings:{voice:{enabled:true},music:{enabled:false},assembly:{kenBurns:true,documentary:{version:2,autoEffects:true,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich'}}}},
  scenes:['The object moves.','Then it reacts.','Outside the slice — точный текст.'].map((narration,order)=>({id:`s${order}`,order,narration,durationSeconds:6,includeInAssembly:order<2,
    documentary:{effects:[],caption:{enabled:false,text:''},layout:'full',timing:{durationInFrames:180,speechSeconds:6},requirement:{text:narration,identities:[],years:[]},
      semanticMontage:{sceneId:`s${order}`,subject:'object',beat:'explain',treatment:'footage',cutawaySceneIds:[],artworkMode:'standalone'}}}))} as unknown as Project);

test('continuous camera carries velocity through the knot; old camera keeps its exact legacy easing',()=>{
  const art=drawing(),step=1e-5;
  const left=artworkCameraState(art,.5-step),knot=artworkCameraState(art,.5),right=artworkCameraState(art,.5+step);
  assert.ok(Math.abs((knot.x-left.x)/step-(right.x-knot.x)/step)<.1);
  assert.ok(Math.abs((right.x-left.x)/(2*step))>50);
  assert.equal(knot.rotation,5);assert.equal(knot.scale,1.35);
  const legacy={...art,camera:{keyframes:[{t:0,x:500,y:300,scale:1},{t:1,x:600,y:400,scale:1.18}]}};
  assert.deepEqual(artworkCameraState(legacy,.25),{x:515.625,y:315.625,scale:1.028125});
  assert.deepEqual(artworkCameraState(art,0,false),artworkCameraState(art,1));
});

test('actions, depth and manual edits reach SSR; fixed framing and neighbors survive edits and roundtrip',()=>{
  const art=drawing(),before=JSON.stringify(art),layer=art.layers[0]!;
  const early=artworkObjectState(art,layer,.1),middle=artworkObjectState(art,layer,.25);
  assert.ok(middle.x-early.x>90);assert.notEqual(middle.scale,early.scale);
  assert.notEqual(artworkObjectState(art,{...layer,depth:0},.25).x,middle.x);
  const edited=structuredClone(art);edited.layers[0]!.editTransform={x:50,y:30,scale:1.2,rotation:15};
  edited.layers[0]!.fillOrigin='manual';edited.layers[0]!.framingBeforeEdit={strokeWidth:2};
  assert.deepEqual(artworkTrajectoryFit(edited),artworkTrajectoryFit(art));
  const render=(a:Artwork)=>renderToStaticMarkup(createElement(DocumentaryArtwork,{artwork:a,frame:40,frames:181,material:null,moving:true,width:1000,height:600}));
  const html=render(art),changed=render(JSON.parse(JSON.stringify(edited)) as Artwork);
  const transform=(s:string,id:string)=>s.match(new RegExp(`data-artwork-layer="${id}"[^>]*transform="([^"]+)"`))?.[1];
  assert.notEqual(transform(html,'carrier'),transform(changed,'carrier'));assert.equal(transform(html,'peer'),transform(changed,'peer'));
  assert.match(html,/data-artwork-camera="true"[^>]*rotate\(-/);assert.equal(JSON.stringify(art),before);
  const absolute=artworkForRevision(edited),normalized=validateMotionArtwork(absolute,'The object moves.',6,false);
  assert.equal(normalized.issue,undefined);assert.deepEqual(normalized.artwork?.actions,art.actions);
  assert.deepEqual(normalized.artwork?.layers[0]!.editTransform,edited.layers[0]!.editTransform);
  const proposal=structuredClone(absolute);proposal.layers[0]!.x+=70;delete proposal.layers[0]!.editTransform;
  assert.deepEqual(preserveArtworkManualLayers(edited,proposal)?.layers[0],absolute.layers[0]);
});

test('validator rejects unsupported/conflicting actions, broken causes and nonfinite depth/camera',()=>{
  for(const change of [(a:Artwork)=>{a.actions![1]!.start=.2;},(a:Artwork)=>{a.actions![0]!.after='missing';},
    (a:Artwork)=>{a.layers[0]!.depth=2;},(a:Artwork)=>{a.camera!.keyframes[0]!.velocity={x:Infinity};},
    (a:Artwork)=>{a.layers[0]!.keyframes=[{t:0,x:0},{t:1,x:200}];}]){
    const art=drawing();change(art);assert.ok(validateMotionArtwork(art,'object',6,false).issue);
  }
});

test('one fixed framing contains new camera rotation, scale, actions and relative depth throughout the path',()=>{
  const art=drawing(),fit=artworkTrajectoryFit(art);
  for(let frame=0;frame<=1024;frame++){
    const t=frame/1024,camera=artworkCameraState(art,t),angle=-(camera.rotation??0)*Math.PI/180;
    for(const layer of art.layers){
      const state=artworkObjectState(art,layer,t),cx=layer.x+layer.w/2,cy=layer.y+layer.h/2;
      for(const [dx,dy] of [[-layer.w/2,-layer.h/2],[layer.w/2,-layer.h/2],[-layer.w/2,layer.h/2],[layer.w/2,layer.h/2]]){
        const x=(cx+dx!*state.scale+state.x-camera.x)*camera.scale,y=(cy+dy!*state.scale+state.y-camera.y)*camera.scale;
        const px=fit.x+fit.scale*(500+x*Math.cos(angle)-y*Math.sin(angle)),py=fit.y+fit.scale*(300+x*Math.sin(angle)+y*Math.cos(angle));
        assert.ok(px>=-.1&&px<=1000.1&&py>=-.1&&py<=600.1,`frame ${frame} outside fixed framing`);
      }
    }
  }
});

test('new primary and revision carry the exact full script and outside-slice neighbors, then reuse receipts',async t=>{
  const p=project(),root=await mkdtemp(join(tmpdir(),'stage5-context-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const calls:Array<{kind:string;input:Record<string,unknown>}>=[];
  const complete=async(_system:string,input:string,onPaidSubmission?: (key:string)=>Promise<void>)=>{calls.push({kind:'primary',input:JSON.parse(input)});
    await onPaidSubmission?.('a'.repeat(64));return {scenes:[{sceneId:'s0',artwork:drawing()}]};};
  const revision={preview:async()=>[{sceneId:'s0',frames:[.04,.48,.88].map(t=>({t,image:'data:image/jpeg;base64,YQ=='}))}],
    complete:async(_system:string,input:string)=>{calls.push({kind:'revision',input:JSON.parse(input)});return {scenes:[{sceneId:'s0',artwork:artworkForRevision(drawing())}]};}};
  const result=await createMotionArtworkPlan(p,root,complete,'local-only',undefined,{revision});
  assert.deepEqual(calls.map(c=>c.kind),['primary','revision']);assert.equal(result.scenes.length,1);
  for(const call of calls){const context=call.input.storyContext as {originalScript:string;contextScenes:Array<{sceneId:string}>};
    assert.equal(context.originalScript,p.videoBrief!.readyScript);assert.deepEqual(context.contextScenes.map(s=>s.sceneId),['s0','s1','s2']);}
  await createMotionArtworkPlan(p,root,async()=>assert.fail('no repurchase'),'local-only',undefined,{revision:{...revision,complete:async()=>assert.fail('no repeated revision')}});
});

test('the same commission freezes its full context across a terminal-refusal resume and an outside-slice edit',async t=>{
  const p=project(),root=await mkdtemp(join(tmpdir(),'stage5-frozen-context-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const inputs:string[]=[];
  await assert.rejects(createMotionArtworkPlan(p,root,async(_system,input)=>{inputs.push(input);throw new AnyModelModelUnavailableError('Local proven refusal');},'local-only'),/Local proven refusal/);
  p.scenes[2]!.narration='Changed outside this assembly slice.';
  await createMotionArtworkPlan(p,root,async(_system,input)=>{inputs.push(input);return {scenes:[{sceneId:'s0',artwork:drawing()}]};},'local-only',undefined,{resumeUnavailable:true});
  assert.equal(inputs.length,2);assert.equal(inputs[0],inputs[1],'stable manifest context preserves the exact paid input identity');
});

test('action SFX follow the shared sequence clock across a scene boundary without duplicates',()=>{
  const p=project(),art=drawing();art.actions![0]!.sound=undefined;art.actions![1]!.end=.65;
  for(const scene of p.scenes.slice(0,2))scene.documentary!.motionGraphic={enabled:true,kind:'explainer',origin:'automatic',artwork:art,
    sequenceId:'one-span',startSeconds:0,durationSeconds:6} as NonNullable<typeof scene.documentary>['motionGraphic'];
  const events=documentaryMontageSoundEvents(p).filter(e=>e.sceneId==='s1');
  assert.equal(events.length,1);assert.equal(events[0]!.category,'click');assert.ok(Math.abs(events[0]!.seconds-(Math.round(.65*359)/30-6))<1e-9);
});

test('new causal span revision samples the real two sides of the cut on one mounted clock',()=>{
  const p=project(),art={...drawing(),durationSeconds:12};
  const {timeline,items}=planArtworkPhases(p,[{sceneId:'s0',endSceneId:'s1',artwork:art}]);
  const item=items[0]!;assert.equal(item.frames,360);assert.ok(item.phases.length>=7&&item.phases.length<=13);
  assert.ok(item.phases.some(f=>f.globalFrame===179));assert.ok(item.phases.some(f=>f.globalFrame===180));
  for(const action of art.actions!){const contact=Math.round(action.end*359);assert.ok(item.phases.some(f=>f.artworkFrame===contact));}
  assert.deepEqual(timeline.scenes.slice(0,2).map(s=>s.documentary!.motionGraphic!.sequenceOffsetFrames),[0,180]);
  assert.deepEqual(timeline.scenes[0]!.documentary!.motionGraphic!.artwork?.actions,timeline.scenes[1]!.documentary!.motionGraphic!.artwork?.actions);
});
