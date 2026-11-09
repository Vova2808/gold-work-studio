import test from 'node:test';
import assert from 'node:assert/strict';
import {statSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createDefaultProjectSettings,createDocumentarySettings,groundedDocumentaryMotion,type DocumentaryMotionGraphic,type Project} from '@gold-work/shared';
import {buildDocumentaryTimeline} from '../../../packages/remotion-video/src/documentary-timeline.js';
import {documentaryEditErrors} from './documentary-validation.js';
import {missingAssemblyInputs} from './assembly-readiness.js';
import {documentaryDiagram} from './documentary-diagram-plan.js';

function project(graphic:DocumentaryMotionGraphic):Project{
  const settings=createDefaultProjectSettings();settings.voice.enabled=true;settings.assembly.documentary=createDocumentarySettings();
  return {id:'montage-readiness',mediaMode:'stock',aspectRatio:'16:9',settings,scenes:[{id:'scene',order:0,durationSeconds:4,
    narration:'In May 1963, the deal collapsed. June 18, 1966. The race begins.',imagePath:'source.jpg',audioPath:'voice.mp3',
    documentary:{version:2,verified:true,pinned:true,checksum:'source',requirement:{text:'Saved narration'},layout:'full',effects:[],caption:{enabled:false,text:''},
      timing:{sourceKey:'voice',durationInFrames:120},selected:{id:'source',kind:'image',width:1920,height:1080},motionGraphic:graphic}}]} as unknown as Project;
}
const chronology=(value:string,variant?:'date'|'clean',origin:'automatic'|'manual'='automatic'):DocumentaryMotionGraphic=>
  ({kind:'chronology',enabled:true,title:'',value,variant,origin,startSeconds:0,durationSeconds:2});

test('literal montage dates and ordinary years pass the shared assembly readiness unchanged',()=>{
  for(const [value,variant] of [['May 1963','date'],['June 18, 1966','date'],['1963',undefined],['1966','clean']] as const){
    for(const origin of ['automatic','manual'] as const){
      const p=project(chronology(value,variant,origin)),before=structuredClone(p);
      assert.ok(groundedDocumentaryMotion(p.scenes[0]!.documentary!.motionGraphic,p.scenes[0]!.narration,p.scenes[0]!.narration));
      assert.deepEqual(documentaryEditErrors(p),[]);
      assert.deepEqual(missingAssemblyInputs(p,[],path=>['source.jpg','voice.mp3'].includes(path)),[]);
      const rendered=buildDocumentaryTimeline(p).scenes[0]!.documentary!.motionGraphic!;
      assert.equal(rendered.value,value);assert.equal(rendered.variant,variant);assert.equal(rendered.title,'');
      assert.deepEqual(p,before);
    }
  }
});

test('date support does not invent a year or relax the ordinary year format',()=>{
  for(const [value,variant] of [['May','date'],['June 18','date'],['','date'],['June 18, 12345','date'],['May 1963',undefined],['June 18, 1966','clean'],['66',undefined]] as const){
    const p=project(chronology(value,variant)),before=structuredClone(p);
    assert.equal(documentaryEditErrors(p).length,1,`${variant??'year'}: ${value}`);
    assert.deepEqual(p,before);
  }
});

test('valid date cards still require media, voice and valid graphic timing',()=>{
  const p=project(chronology('May 1963','date'));
  assert.ok(missingAssemblyInputs(p,[],path=>path!=='source.jpg').some(issue=>issue.includes('изображение или видео')));
  assert.ok(missingAssemblyInputs(p,[],path=>path!=='voice.mp3').some(issue=>issue.includes('озвучка')));
  p.scenes[0]!.documentary!.motionGraphic!.startSeconds=5;
  assert.ok(missingAssemblyInputs(p).some(issue=>issue.includes('границы сцены')));
});

test('one illustrated evidence card is ready but invalid sources and single-card comparisons remain blocked',()=>{
  const p=project({kind:'explainer',enabled:true,title:'',origin:'automatic',variant:'collage',boardLayout:'parts',startSeconds:0,durationSeconds:4,cards:[{label:'The deal',sceneId:'scene'}]});
  const graphic=p.scenes[0]!.documentary!.motionGraphic!,before=structuredClone(p);
  assert.deepEqual(missingAssemblyInputs(p),[]);
  assert.equal(buildDocumentaryTimeline(p).scenes[0]!.documentary!.motionGraphic!.cards?.[0]?.imagePath,'source.jpg');
  assert.deepEqual(p,before);
  graphic.boardLayout='compare';assert.ok(documentaryEditErrors(p).some(issue=>issue.includes('карточек')));
  graphic.boardLayout='steps';graphic.cards![0]!.sceneId=undefined;assert.ok(documentaryEditErrors(p).some(issue=>issue.includes('карточек')));
  graphic.cards![0]!.sceneId='missing';assert.ok(documentaryEditErrors(p).some(issue=>issue.includes('недоступный материал')));
  graphic.cards![0]!.sceneId='scene';p.scenes[0]!.imagePath=undefined;assert.ok(documentaryEditErrors(p).some(issue=>issue.includes('недоступный материал')));
});

test('typographic comparisons export without fake source identities; mixed or missing material references stay blocked',()=>{
  const p=project({kind:'explainer',enabled:true,title:'',origin:'automatic',variant:'poster',boardLayout:'compare',startSeconds:0,durationSeconds:4,
    cards:[{label:'Industrial power'},{label:'a racing legend'}]});
  assert.deepEqual(documentaryEditErrors(p),[]);
  const cards=p.scenes[0]!.documentary!.motionGraphic!.cards!;
  cards[0]!.sceneId='scene';
  assert.ok(documentaryEditErrors(p).some(issue=>issue.includes('материал каждой карточки')));
  cards[1]!.sceneId='missing';
  assert.ok(documentaryEditErrors(p).some(issue=>issue.includes('недоступный материал')));
});

test('native explanations and numerical diagrams pass export by their own contract without legacy cards',()=>{
  const p=project({kind:'explainer',enabled:true,title:'',origin:'automatic',startSeconds:0,durationSeconds:4});
  const source=p.scenes[0]!;
  p.scenes=['Water enters soil.','Water reaches groundwater.','Water feeds springs.'].map((narration,i)=>({...structuredClone(source),id:`water-${i}`,order:i,narration,
    documentary:{...structuredClone(source.documentary!),motionGraphic:{kind:'explainer',enabled:true,title:'',origin:'automatic',startSeconds:0,durationSeconds:4,
      explanation:{kind:'flow',nodes:[{id:'soil',label:'soil',symbol:'place'},{id:'ground',label:'groundwater',symbol:'place'},{id:'spring',label:'springs',symbol:'place'}],
        sequence:{id:'water-path',offsetFrames:i*120,durationInFrames:360}}}}}));
  const before=structuredClone(p);
  assert.deepEqual(documentaryEditErrors(p),[]);assert.deepEqual(p,before,'validation must preserve saved artwork and clocks');
  p.scenes[1]!.documentary!.motionGraphic!.explanation!.sequence!.offsetFrames=0;
  assert.ok(documentaryEditErrors(p).some(issue=>issue.includes('непрерывность объяснения')));
  p.scenes=structuredClone(before.scenes);
  p.scenes[0]!.documentary!.motionGraphic!.explanation!.nodes[0]!.label='invented cavern';
  assert.ok(documentaryEditErrors(p).some(issue=>issue.includes('узлы, подписи')));
  const numeric=project({kind:'statistic',enabled:true,title:'',origin:'automatic',value:'3 of 4',startSeconds:0,durationSeconds:4});
  numeric.scenes[0]!.narration='3 of 4 samples passed.';
  const graphic=numeric.scenes[0]!.documentary!.motionGraphic!;
  graphic.diagram=documentaryDiagram(numeric.scenes[0]!,graphic);
  assert.ok(graphic.diagram);assert.deepEqual(documentaryEditErrors(numeric),[]);
  graphic.diagram!.amount=2;
  assert.ok(documentaryEditErrors(numeric).some(issue=>issue.includes('числам и единицам')));
  assert.ok(documentaryEditErrors(project({kind:'explainer',enabled:true,title:'',origin:'automatic',startSeconds:0,durationSeconds:4})).some(issue=>issue.includes('карточек')));
});

test('saved 21.10 project dates pass actual file readiness without modifying the project',async t=>{
  const path=process.env.GWS_DATE_MONTAGE_PROJECT;
  if(!path)return t.skip('Set GWS_DATE_MONTAGE_PROJECT to the saved 45-scene project.json.');
  const bytes=await readFile(path,'utf8'),p=JSON.parse(bytes) as Project,before=structuredClone(p);
  assert.equal(p.scenes.length,45);
  const dates=[['doc-c033d719a523efba6543','May 1963'],['doc-29cb42e12464faa2f0a3','June 18, 1966']];
  for(const [id,value] of dates){
    const scene=p.scenes.find(s=>s.id===id)!;
    assert.ok(scene);assert.ok(scene.narration.includes(value!));
    assert.equal(scene.documentary!.motionGraphic!.variant,'date');assert.equal(scene.documentary!.motionGraphic!.value,value);
  }
  assert.deepEqual(documentaryEditErrors(p),[]);
  assert.deepEqual(missingAssemblyInputs(p,[],file=>{try{const stat=statSync(file);return stat.isFile()&&stat.size>0;}catch{return false;}}),[]);
  assert.deepEqual(p,before);assert.equal(await readFile(path,'utf8'),bytes);
});
