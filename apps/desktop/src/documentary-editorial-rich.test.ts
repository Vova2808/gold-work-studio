import test from 'node:test';
import assert from 'node:assert/strict';
import {groundedDocumentaryMotion,documentaryVideoCoverage,type Scene,type Project,type EffectAsset} from '@gold-work/shared';
import {documentaryEditorialSuggestion} from './documentary-editorial.js';
import {planDocumentaryMontage} from './documentary-montage.js';
import {documentaryBackgroundEligible} from './documentary-effects.js';
import {connectedSubjectMask} from './documentary-subject-mask.js';

test('literal quotations and comparable quantities, no invented attribution or mixed units',()=>{
  const quote='Он сказал: «Этот корабль изменил наши представления о дальности плавания». ';
  const suggestion=documentaryEditorialSuggestion({narration:quote} as Scene,'');
  const g=groundedDocumentaryMotion(suggestion,quote,quote)!;assert.equal(g.kind,'quote');assert.equal(g.title,'Этот корабль изменил наши представления о дальности плавания');assert.equal(g.kicker,'');
  assert.equal(groundedDocumentaryMotion({kind:'quote',title:'Invented quote'},quote,quote),undefined);
  const sentence='Модель A — 120 кВт; Модель B — 180 кВт.';
  const chart=groundedDocumentaryMotion(documentaryEditorialSuggestion({narration:sentence} as Scene,''),sentence,sentence)!;
  assert.equal(chart.kind,'bar-chart');assert.equal(chart.cards![1]!.value,'180 кВт');
  assert.equal(groundedDocumentaryMotion({kind:'bar-chart',cards:[{label:'A',value:'120 кВт'},{label:'B',value:'180 км'}]},'A 120 кВт B 180 км','A 120 кВт B 180 км'),undefined);
});
test('first verified named subject is introduced once across niches; manual montage and audio remain untouched',()=>{
  for(const name of ['Титаник','Boeing 747','Иван Петров']){
    const scene={id:'s',order:0,narration:`${name} появился в этой истории.`,imagePath:'original.jpg',audioPath:'paid.wav',durationSeconds:6,documentary:{verified:true,layout:'full',requirement:{identities:[{name,aliases:[]}],years:[]},selected:{kind:'image'},effects:[],caption:{enabled:false}}} as unknown as Scene;
    assert.equal((documentaryEditorialSuggestion(scene,'') as {kind:string}).kind,'subject-card');
    assert.equal(documentaryEditorialSuggestion(scene,`${name} уже представлен.`),undefined);
    const project={scenes:[scene],settings:{assembly:{documentary:{autoMotionGraphics:true}}}} as Project;
    const output=planDocumentaryMontage(project);assert.equal(output[0]!.documentary!.motionGraphic!.kind,'subject-card');assert.equal(output[0]!.audioPath,'paid.wav');
    assert.deepEqual(planDocumentaryMontage({...project,scenes:output}),output);
    scene.documentary!.pinned=true;assert.equal(planDocumentaryMontage(project)[0],scene);
  }
});
test('full charts cannot inflate reported video coverage; low resolution/unreviewed backgrounds stay out of auto',()=>{
  const scenes=[{durationSeconds:6,videoPath:'film.mp4',documentary:{verified:true,selected:{kind:'video',durationSeconds:6},motionGraphic:{enabled:true,kind:'bar-chart',startSeconds:1,durationSeconds:4}}}] as unknown as Scene[];
  assert.equal(documentaryVideoCoverage(scenes).videoSeconds,2);
  const asset={category:'background',state:'ready',automatic:true,review:'approved',rights:'user-confirmed',metadata:{width:1920,height:1080},tags:['editorial-light']} as EffectAsset;
  assert.ok(documentaryBackgroundEligible(asset,'grid-light'));
  assert.equal(documentaryBackgroundEligible({...asset,metadata:{...asset.metadata!,width:736,height:414}},'grid-light'),false);
  assert.equal(documentaryBackgroundEligible({...asset,review:'pending'},'grid-light'),false);
});
test('subject mask removes detached text, keeps anchored parts, refuses hidden anchors and ambiguous peers',()=>{
  const mask=new Uint8Array(100*100);
  for(let y=10;y<90;y++)for(let x=10;x<35;x++)mask[y*100+x]=255;
  for(let y=40;y<50;y++)for(let x=70;x<90;x++)mask[y*100+x]=255;
  const clean=connectedSubjectMask(mask,100,100,[]);assert.equal(clean[45*100+75],0);assert.equal(clean[40*100+20],255);
  const anchored=connectedSubjectMask(mask,100,100,[{x:75,y:45}]);assert.equal(anchored[45*100+75],255);
  assert.throws(()=>connectedSubjectMask(mask,100,100,[{x:90,y:90}]),/скрывает/);
  for(let y=10;y<90;y++)for(let x=60;x<85;x++)mask[y*100+x]=255;
  assert.throws(()=>connectedSubjectMask(mask,100,100,[]),/несколько/);
});
