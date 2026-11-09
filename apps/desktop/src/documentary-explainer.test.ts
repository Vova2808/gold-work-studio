import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Project} from '@gold-work/shared';
import {planDocumentaryMontage} from './documentary-montage.js';
import {readDocumentaryAnnotations,documentaryAnnotationInstruction} from './documentary-annotations.js';
import {documentaryOrdinaryVisualContract} from './documentary-review-contract.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {effectFfmpeg} from './effect-media.js';
import {annotationPosition} from '../../../packages/remotion-video/src/documentary-annotation-position.js';

function fixture(text:string):Project{return {id:'local-proof',mediaMode:'stock',aspectRatio:'16:9',videoBrief:{readyScript:text},settings:{stockVideoPercent:35,voice:{enabled:true},assembly:{documentary:{version:2,autoMotionGraphics:true}}},scenes:[{id:'s',order:0,narration:text,audioPath:'paid.wav',durationSeconds:6,documentary:{verified:true,checksum:'source',requirement:{text,entities:[],identities:[],years:[],queries:[],identityContextVersion:3,plannedBy:'semantic'},selected:{kind:'image'},caption:{enabled:false,text:''},effects:[]}}]} as unknown as Project;}

test('literal parts become editable boards across unrelated topics without altering speech',()=>{
  for(const text of ['Автомобиль состоит из кузова, двигателя и колёс.','Корабль включает корпус, палубу и рубку.','Самолёт содержит фюзеляж, крылья и хвост.','Растение состоит из корня, стебля и листьев.','An orchestra includes strings, woodwinds and brass.']){
    const p=fixture(text),result=planDocumentaryMontage(p),g=result[0]!.documentary!.motionGraphic!;
    assert.equal(g.kind,'explainer',text);assert.equal(g.cards!.length,3);assert.equal(g.boardLayout,'parts');
    for(const card of g.cards!)assert.ok(text.includes(card.label));
    assert.equal(result[0]!.narration,text);assert.equal(result[0]!.audioPath,'paid.wav');
    assert.deepEqual(planDocumentaryMontage({...p,scenes:result}),result);
    p.scenes[0]!.documentary!.pinned=true;assert.equal(planDocumentaryMontage(p)[0],p.scenes[0]);
  }
});
test('prices retain units and qualifiers and never fabricate a comparison',()=>{
  for(const text of ['Автомобиль стоит около 2 миллионов рублей.','Стоимость самолёта составляет не менее 90 миллионов долларов.','A ticket costs about 250 dollars.']){
    const g=planDocumentaryMontage(fixture(text))[0]!.documentary!.motionGraphic!;
    assert.equal(g.kind,'statistic');assert.ok(text.includes(g.value!));assert.ok(g.value!.includes(text.includes('рублей')?'рублей':text.includes('долларов')?'долларов':'dollars'));
  }
});
test('annotations require exact narrated labels, confidence and all samples; interpolation never extrapolates',()=>{
  const times=[10,12,14],value={status:'accepted',annotations:[{label:'крышка',confidence:.98,points:[{x:20,y:40},{x:40,y:40},{x:60,y:40}]}]};
  const parsed=readDocumentaryAnnotations(value,'На корпусе видна крышка.',times);assert.equal(parsed.length,1);assert.equal(parsed[0]!.confidence,.98);
  assert.deepEqual(annotationPosition(parsed[0]!.points,11),{x:30,y:40});assert.equal(annotationPosition(parsed[0]!.points,15),undefined);
  for(const bad of [{...value,status:'uncertain'},{...value,annotations:[{...value.annotations[0],label:'турбина'}]},{...value,annotations:[{...value.annotations[0],confidence:.7}]},{...value,annotations:[{...value.annotations[0],points:[{x:20,y:40}]}]}])assert.deepEqual(readDocumentaryAnnotations(bad,'На корпусе видна крышка.',times),[]);
  const p=fixture('На корпусе видна крышка.');p.scenes[0]!.documentary!.visualReview={status:'accepted',confidence:1,reason:'fixture',quality:'fixture',checkedAt:'',sampleSeconds:[0],annotations:[{label:'крышка',points:[{seconds:0,x:45,y:40}]}]};
  const g=planDocumentaryMontage(p)[0]!.documentary!.motionGraphic!;assert.equal(g.kind,'annotations');assert.equal(g.sourceChecksum,'source');
});
test('optional visual labels reuse completed checks and do not resend a pending review',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-annotation-checkpoint-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'fixture.png');await effectFfmpeg(['-y','-f','lavfi','-i','color=c=gray:s=1280x720','-frames:v','1',file]);
  const p=fixture('На корпусе видна крышка.'),s=p.scenes[0]!;s.imagePath=file;
  s.documentary!.selected={...s.documentary!.selected!,title:'Fixture',description:'Local test only',width:1280,height:720};
  let calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async system=>{calls++;assert.ok(system.includes(documentaryAnnotationInstruction)||system.startsWith(documentaryOrdinaryVisualContract));return JSON.stringify({status:'accepted',confidence:.99,reason:'Fixture',quality:'clear',technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Local fixture',orientation:'upright',continuousShot:true},mediaType:'camera',presentation:'clean'});}},()=>root);
  await service.inspect(p,s);await service.inspect(p,s);assert.equal(calls,1);
  const directory=join(root,'Documentary','Analysis'),files=await readdir(directory);
  const target=files.find(f=>/^[a-f0-9]{64}\.json$/.test(f))!;assert.ok(target);
  await writeFile(join(directory,target),JSON.stringify({state:'pending',purpose:'visual-overview'}));
  const before=await readFile(join(directory,target),'utf8');
  await assert.rejects(service.inspect(p,s),/уже отправлялся|неизвестный/);assert.equal(calls,1);assert.equal(await readFile(join(directory,target),'utf8'),before);
});
