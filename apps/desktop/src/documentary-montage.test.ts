import test from "node:test";
import assert from "node:assert/strict";
import type { Project } from "@gold-work/shared";
import {documentaryTemplates,documentarySceneTransition} from '@gold-work/shared';
import { planDocumentaryMontage } from "./documentary-montage.js";

test('Stock montage and refresh preserve the saved caption settings on automatic layouts',()=>{
  const caption={enabled:true,text:'An authored caption',fontSize:32,position:'bottom',animation:'slide',color:'#abcdef',backgroundColor:'#123456',opacity:37};
  const project={mediaMode:'stock',settings:{assembly:{documentary:{autoMotionGraphics:false,captionsEnabled:true}}},scenes:[{
    id:'caption',order:0,narration:'A ship travels at sea.',videoPath:'ship.mp4',audioPath:'saved-voice.wav',durationSeconds:4,
    documentary:{verified:true,layout:'full',template:'fact',templateOrigin:'automatic',effects:[],caption,
      selected:{kind:'video',width:1920,height:1080},requirement:{text:'A ship travels at sea.',entities:[],years:[],queries:[]}}
  }]} as unknown as Project;
  for(const refresh of [false,true]){
    const planned=planDocumentaryMontage(project,false,refresh);
    assert.deepEqual(planned[0]!.documentary!.caption,caption);
    assert.deepEqual(planDocumentaryMontage({...project,scenes:planned})[0]!.documentary!.caption,caption);
    assert.equal(planned[0]!.audioPath,'saved-voice.wav');
  }
  assert.equal(project.scenes[0]!.documentary!.caption.fontSize,32);
});

test('UI clean, framed and automatic settings replan existing automatic scenes and preserve manual scenes',()=>{
  const p={mediaMode:'stock',settings:{assembly:{kenBurns:true,transitionType:'none',documentary:{autoTransitions:true,montageDensity:'balanced',autoMotionGraphics:false}}},
    scenes:Array.from({length:7},(_,order)=>({id:String(order),order,narration:'Photo',imagePath:`${order}.jpg`,durationSeconds:8,
      documentary:{verified:true,template:'push',templateOrigin:'automatic',layout:'full',effects:[],caption:{enabled:false,text:''},selected:{kind:'image',width:1920,height:1080},requirement:{sectionTitle:'Same subject'}}}))} as unknown as Project;
  p.scenes[6]!.documentary!.template='gallery';p.scenes[6]!.documentary!.templateOrigin='manual';p.scenes[6]!.transition='fade';
  const automatic=planDocumentaryMontage(p);
  assert.ok(automatic.some(s=>s.documentary!.template==='archive-dark'));
  assert.ok(automatic.some(s=>s.autoTransition==='mix'));
  const cleanSettings={...p.settings,assembly:{...p.settings.assembly,kenBurns:false,fadeTransitions:false,documentary:{...p.settings.assembly.documentary!,autoTransitions:false,montageDensity:'calm',excludedTemplates:documentaryTemplates.filter(t=>t[0]!=='full').map(t=>t[0])}}} as Project['settings'];
  const clean=planDocumentaryMontage({...p,settings:cleanSettings,scenes:automatic});
  assert.ok(clean.slice(0,6).every(s=>s.documentary!.template==='full'&&s.autoTransition===undefined&&documentarySceneTransition(s,cleanSettings.assembly).kind==='none'));
  const allowed=['full','contain','push','pull','archive-dark','museum-mat'];
  const framedSettings={...cleanSettings,assembly:{...cleanSettings.assembly,kenBurns:true,fadeTransitions:true,transitionType:'mix',transitionDurationSeconds:.35,documentary:{...cleanSettings.assembly.documentary!,excludedTemplates:documentaryTemplates.filter(t=>!allowed.includes(t[0])).map(t=>t[0])}}} as Project['settings'];
  const framed=planDocumentaryMontage({...p,settings:framedSettings,scenes:clean});
  assert.deepEqual(framed.slice(0,5).map(s=>s.documentary!.template),['archive-dark','contain','push','pull','museum-mat']);
  assert.ok(framed.slice(0,6).every(s=>documentarySceneTransition(s,framedSettings.assembly).kind==='mix'));
  for(const scenes of [automatic,clean,framed])assert.deepEqual(scenes[6],p.scenes[6]);
});

test('Stock keeps first win since 2002 as footage, preserves authored graphics and varies presets',()=>{
  const project={mediaMode:'stock',settings:{assembly:{documentary:{autoMotionGraphics:true,captionsEnabled:true,montageDensity:'calm'}}},scenes:Array.from({length:6},(_,order)=>({
    id:`s${order}`,order,narration:'Their first win since 2002.',imagePath:`photo${order}.jpg`,audioPath:`voice${order}.wav`,durationSeconds:8,
    documentary:{verified:true,layout:'full',effects:[],caption:{enabled:false,text:''},selected:{kind:'image',width:1920,height:1080},requirement:{text:'Their first win since 2002.',years:[2002],entities:[],queries:[],sectionTitle:'A win'}}
  }))} as unknown as Project;
  project.scenes[3]!.documentary!.motionGraphic={enabled:true,kind:'chronology',title:'Win',value:'2002',origin:'automatic',startSeconds:0,durationSeconds:8};
  project.scenes[4]!.documentary!.motionGraphic={enabled:true,kind:'chronology',title:'Authored date',value:'2002',origin:'manual',startSeconds:0,durationSeconds:8};
  project.scenes[5]!.documentary!.template='pan-left';project.scenes[5]!.documentary!.templateOrigin='manual';
  const calm=planDocumentaryMontage(project);
  assert.ok(calm.slice(0,4).every(s=>!s.documentary!.motionGraphic&&!s.documentary!.caption.enabled));
  assert.deepEqual(calm.slice(0,4).map(s=>s.documentary!.template),['full','contain','full','contain']);
  assert.equal(calm[4]!.documentary!.motionGraphic,project.scenes[4]!.documentary!.motionGraphic);
  assert.equal(calm[5]!.documentary!.template,'pan-left');
  const rich=planDocumentaryMontage({...project,settings:{assembly:{documentary:{...project.settings.assembly.documentary!,montageDensity:'rich'}}} as Project['settings']});
  assert.deepEqual(rich.slice(0,4).map(s=>s.documentary!.template),['push','contain','pull','archive-dark']);
  assert.deepEqual(planDocumentaryMontage({...project,scenes:calm}),calm);
  assert.deepEqual(calm.map(s=>[s.narration,s.imagePath,s.audioPath]),project.scenes.map(s=>[s.narration,s.imagePath,s.audioPath]));
});

test('ordinary footage stays clean; manual television effects and source timing survive',()=>{
  const p={settings:{stockVideoPercent:35,assembly:{documentary:{autoMotionGraphics:true,montageDensity:'rich',captionsEnabled:false}}},scenes:Array.from({length:45},(_,order)=>({
    id:`s${order}`,order,narration:'A vehicle travels on the road.',audioPath:`paid${order}.wav`,videoPath:`source${order}.mp4`,durationSeconds:4,
    documentary:{verified:true,pinned:false,layout:'full',effects:[],caption:{enabled:false,text:''},selected:{kind:'video',title:'Modern vehicle'},requirement:{text:'Vehicle',years:[],entities:[],queries:[],identities:[]}}
  }))} as unknown as Project;
  p.scenes[15]!.documentary!.template='broadcast-crt';p.scenes[15]!.documentary!.templateOrigin='manual';
  const result=planDocumentaryMontage(p),screens=result.filter(s=>['broadcast-crt','broadcast-scanlines'].includes(s.documentary?.template??''));
  assert.deepEqual(screens.map(s=>s.order),[15]);
  assert.deepEqual(result.map(s=>[s.narration,s.audioPath,s.videoPath,s.durationSeconds]),p.scenes.map(s=>[s.narration,s.audioPath,s.videoPath,s.durationSeconds]));
  assert.deepEqual(planDocumentaryMontage({...p,scenes:result}),result);
  const excluded=planDocumentaryMontage({...p,settings:{...p.settings,assembly:{...p.settings.assembly,documentary:{...p.settings.assembly.documentary!,excludedTemplates:['broadcast-crt','broadcast-scanlines']}}}});
  assert.deepEqual(excluded.filter(s=>s.documentary?.template?.startsWith('broadcast-')).map(s=>s.order),[15]);
});

test('automatic photograph layouts avoid reveal effects while authored layouts remain intact',()=>{
  const p={settings:{assembly:{documentary:{autoMotionGraphics:false}}},scenes:Array.from({length:20},(_,order)=>({
    id:`s${order}`,order,narration:'A vehicle on the road.',imagePath:`source${order}.jpg`,audioPath:`paid${order}.wav`,durationSeconds:4,
    documentary:{verified:true,layout:'full',effects:[],caption:{enabled:false,text:''},selected:{kind:'image',width:1920,height:1080},requirement:{text:'Vehicle',years:[],entities:[],queries:[]}}
  }))} as unknown as Project;
  p.scenes[19]!.documentary!.template='studio-curtain';p.scenes[19]!.documentary!.templateOrigin='manual';
  const result=planDocumentaryMontage(p);
  assert.ok(result.slice(0,19).every(s=>['push','pull','contain','archive-dark','museum-mat'].includes(s.documentary!.template!)));
  assert.equal(result[19],p.scenes[19]);
  assert.deepEqual(result.map(s=>[s.narration,s.audioPath,s.imagePath,s.durationSeconds]),p.scenes.map(s=>[s.narration,s.audioPath,s.imagePath,s.durationSeconds]));
});

test("automatic chapter designs are sparse, varied, and preserve voice, pins and authored templates", () => {
  const project = { settings: { assembly: { documentary: { captionsEnabled: true } } }, scenes: Array.from({ length: 12 }, (_, order) => ({
    id: `scene-${order}`, order, narration: `Exact narration ${order}`, audioPath: `voice-${order}.wav`, durationSeconds: 5,
    documentary: { verified: true, pinned: order === 10, layout: "full", requirement: { sectionTitle: `Section ${order}` },
      selected: { kind: "video" }, effects: [], caption: { enabled: false, text: "" }, ...(order === 11 ? { template: "archive" } : {}) }
  })) } as unknown as Project;
  const result = planDocumentaryMontage(project);
  assert.deepEqual(result.filter(scene => scene.documentary?.template?.startsWith("chapter")).map(scene => scene.order), [0, 7]);
  assert.notEqual(result[0]!.documentary!.template, result[7]!.documentary!.template);
  assert.equal(result[10], project.scenes[10]); assert.equal(result[11], project.scenes[11]);
  assert.deepEqual(result.map(scene => [scene.narration, scene.audioPath, scene.durationSeconds]), project.scenes.map(scene => [scene.narration, scene.audioPath, scene.durationSeconds]));
  assert.deepEqual(planDocumentaryMontage({ ...project, scenes: result }), result, "Resuming must not redesign finished scenes");
});
