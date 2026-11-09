import assert from "node:assert/strict";
import test from "node:test";
import { documentaryDesign, documentaryPhotoCutTransform, documentaryPhotoTransform } from "./documentary-design.js";
import {buildDocumentaryTimeline,type DocumentaryProjectInput,type DocumentaryVisualCut} from './documentary-timeline.js';

test('simple templates render distinct motion and honor the selected amount',()=>{
  const at=(name:string,frame:number,amountPercent=20)=>documentaryDesign(name,frame,101,'#fff',{amountPercent,curve:'smooth'}).mediaTransform;
  assert.equal(at('full',100),'scale(1)');assert.equal(at('contain',100),'scale(1)');
  assert.equal(at('push',0),'scale(1)');assert.equal(at('push',100),'scale(1.2)');
  assert.equal(at('pull',0),'scale(1.2)');assert.equal(at('pull',100),'scale(1)');
  assert.equal(at('push',100,0),'scale(1)');assert.notEqual(at('pan-left',0),at('pan-right',0));
  assert.equal(at('pan-left',100,0),'translateX(0%) scale(1)');
});

test("archive card hugs the original photo at every animation frame without inner letterboxing", () => {
  for (const template of ["archive", "archive-dark", "gallery"]) {
    for (const frame of [0, 30, 90]) {
      const design = documentaryDesign(template, frame, 100, "#ffffff", undefined, { width: 2004, height: 1350, canvasWidth: 1920, canvasHeight: 1080 });
      const border = template === "archive-dark" ? 6 : 32;
      assert.ok(Math.abs((Number(design.main.width) - border) / (Number(design.main.height) - border) - 2004 / 1350) < 1e-8);
      assert.ok(Number(design.main.width) < 1920 && Number(design.main.height) < 1080);
    }
  }
});

test('planned photo cuts override full only and keep exact footage and voice intervals',()=>{
  const project:DocumentaryProjectInput={aspectRatio:'16:9',settings:{voice:{enabled:true},assembly:{kenBurns:true}},scenes:[{
    id:'turn',order:0,durationSeconds:3.36,imagePath:'accepted.jpg',kenBurnsZoom:1.06,
    documentary:{layout:'full',template:'full',templateOrigin:'automatic',cutsOrigin:'automatic',
      semanticMontage:{sceneId:'turn',subject:'the driver',beat:'turn',treatment:'footage',cutawaySceneIds:[]},
      cuts:[{id:'photo',fromFrame:50,durationInFrames:51,trimStartSeconds:0,playbackRate:1,motion:'pull'}],
      timing:{sourceKey:'voice',durationInFrames:101,speechSeconds:3.36},effects:[],
      caption:{enabled:false,text:'',position:'bottom',animation:'fade',fontSize:48,color:'#ffffff',backgroundColor:'#000000',opacity:100}}
  }]};
  const before=JSON.stringify(project),timeline=buildDocumentaryTimeline(project),scene=timeline.scenes[0]!,cut=scene.documentary!.cuts![0]!;
  const at=(frame:number)=>documentaryPhotoCutTransform(scene,cut,frame,'full');
  assert.equal(at(50),'scale(1.06)');assert.equal(at(100),'scale(1)');assert.notEqual(at(75),at(50));
  assert.equal(at(78),at(100),'the directed turn finishes its move before the reading hold');
  const explain={...scene,documentary:{...scene.documentary!,semanticMontage:{...scene.documentary!.semanticMontage!,beat:'explain' as const}}};
  assert.notEqual(documentaryPhotoCutTransform(explain,cut,78,'full'),at(78),'ordinary cuts keep their existing continuous motion');
  assert.equal(documentaryPhotoCutTransform({...scene,kenBurnsZoom:1.02},cut,50,'full'),'scale(1.02)');
  assert.equal(documentaryPhotoCutTransform(scene,{...cut,motion:'push'},50,'full'),'scale(1)');
  assert.equal(documentaryPhotoCutTransform(scene,{...cut,motion:'push'},100,'full'),'scale(1.06)');
  for(const template of ['push','archive','compare-cards'])assert.equal(documentaryPhotoCutTransform(scene,cut,75,template),undefined);
  for(const override of [{pinned:true},{cutsOrigin:'manual' as const},{templateOrigin:'manual' as const},{semanticMontage:undefined}]){
    assert.equal(documentaryPhotoCutTransform({...scene,documentary:{...scene.documentary!,...override}},cut,75,'full'),undefined);
    const edited=buildDocumentaryTimeline({...project,scenes:[{...project.scenes[0]!,documentary:{...project.scenes[0]!.documentary!,...override}}]}).scenes[0]!;
    assert.equal(documentaryPhotoCutTransform(edited,edited.documentary!.cuts![0],75,'full'),undefined);
  }
  for(const direction of ['off','in','out'] as const)assert.equal(documentaryPhotoCutTransform({...scene,kenBurnsDirection:direction},cut,75,'full'),undefined);
  assert.equal(documentaryPhotoCutTransform({...scene,motion:false},cut,75,'full'),undefined);
  assert.equal(documentaryPhotoCutTransform({...scene,documentary:{...scene.documentary!,templateMotion:{amountPercent:0,curve:'smooth'}}},cut,75,'full'),undefined);
  for(const override of [{motion:'none' as const},{motion:undefined},{videoPath:'accepted.mp4'},{imagePath:undefined}]){
    assert.equal(documentaryPhotoCutTransform(scene,{...cut,...override},75,'full'),undefined);
  }
  assert.equal(timeline.durationInFrames,101);assert.equal(cut.fromFrame,50);assert.equal(cut.durationInFrames,51);
  assert.equal(JSON.stringify(project),before);
});

test('automatic contain keeps its fit and permits photo motion without overriding manual stops',()=>{
  const project:DocumentaryProjectInput={aspectRatio:'16:9',settings:{voice:{enabled:true},assembly:{kenBurns:true}},scenes:[{
    id:'opening',order:0,durationSeconds:5.933333333333334,imagePath:'museum.jpg',audioPath:'voice.wav',
    documentary:{layout:'contain',template:'contain',templateOrigin:'automatic',templateMotion:{amountPercent:22,curve:'dramatic'},
      timing:{sourceKey:'voice',durationInFrames:178,speechSeconds:5.9},effects:[],
      caption:{enabled:false,text:'',position:'bottom',animation:'fade',fontSize:48,color:'#fff',backgroundColor:'#000',opacity:80}}
  }]};
  const original=JSON.stringify(project),scene=buildDocumentaryTimeline(project).scenes[0]!;
  const transform=(s=scene,frame=105,cut?:DocumentaryVisualCut)=>
    documentaryPhotoCutTransform(s,cut,frame,'contain');
  assert.equal(transform(scene,21),documentaryPhotoTransform(scene,undefined,21).transform);
  assert.equal(transform(),documentaryPhotoTransform(scene,undefined,105).transform);
  assert.notEqual(transform(scene,21),transform());
  const design=documentaryDesign('contain',105,178,'#fff',scene.documentary!.templateMotion);
  assert.equal(design.fit,'contain');assert.equal(design.backdrop,true);
  assert.equal(design.mediaTransform,'scale(1)','manual contain retains the existing static design');
  for(const changes of [{pinned:true},{templateOrigin:'manual' as const},{templateMotion:{amountPercent:0,curve:'dramatic' as const}}])
    assert.equal(transform({...scene,documentary:{...scene.documentary!,...changes}}),undefined);
  for(const changes of [{motion:false},{kenBurnsDirection:'off' as const},{videoPath:'footage.mp4'}])assert.equal(transform({...scene,...changes}),undefined);
  const cut={id:'manual-photo',imagePath:'museum.jpg',fromFrame:0,durationInFrames:178,trimStartSeconds:0,playbackRate:1,motion:'none' as const};
  assert.equal(transform(scene,105,cut),undefined,'explicit manual motion=none is not revived');
  assert.notEqual(transform(scene,21,{...cut,motion:'push'}),transform(scene,105,{...cut,motion:'push'}));
  assert.equal(JSON.stringify(project),original);assert.equal(scene.durationInFrames,178);assert.equal(scene.audioPath,'voice.wav');
});

test('standalone automatic turn completes its push before a stable result hold',()=>{
  const project:DocumentaryProjectInput={aspectRatio:'16:9',settings:{voice:{enabled:true},assembly:{kenBurns:true}},scenes:[{
    id:'turn',order:0,durationSeconds:6,imagePath:'accepted.jpg',
    documentary:{layout:'full',template:'push',templateOrigin:'automatic',templateMotion:{amountPercent:14,curve:'smooth'},
      semanticMontage:{sceneId:'turn',subject:'the driver',beat:'turn',treatment:'footage',cutawaySceneIds:[]},effects:[],
      caption:{enabled:false,text:'',position:'bottom',animation:'fade',fontSize:48,color:'#ffffff',backgroundColor:'#000000',opacity:100}}
  }]};
  const scene=buildDocumentaryTimeline(project).scenes[0]!,at=(frame:number)=>documentaryPhotoCutTransform(scene,undefined,frame,'push');
  assert.equal(at(0),'scale(1)');assert.notEqual(at(45),at(0));
  assert.ok(Math.abs(Number(at(100)?.slice(6,-1))-1.14)<1e-10);
  assert.equal(at(100),at(179),'the final framing holds without a second move or scale reset');
  for(const override of [{pinned:true},{templateOrigin:'manual' as const},{cutsOrigin:'manual' as const},{templateMotion:{amountPercent:0,curve:'smooth' as const}},
    {semanticMontage:{...scene.documentary!.semanticMontage!,beat:'explain' as const}}])
    assert.equal(documentaryPhotoCutTransform({...scene,documentary:{...scene.documentary!,...override}},undefined,100,'push'),undefined);
  for(const direction of ['in','out','off'] as const)
    assert.equal(documentaryPhotoCutTransform({...scene,kenBurnsDirection:direction},undefined,100,'push'),undefined);
  assert.equal(documentaryPhotoCutTransform({...scene,motion:false},undefined,100,'push'),undefined);
  assert.equal(documentaryPhotoCutTransform({...scene,videoPath:'moving.mp4'},undefined,100,'push'),undefined);
  assert.equal(documentaryPhotoCutTransform(scene,undefined,100,'pull'),undefined);
});
