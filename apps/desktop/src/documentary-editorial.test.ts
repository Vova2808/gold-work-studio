import test from 'node:test';
import assert from 'node:assert/strict';
import {groundedDocumentaryMotion,type Project} from '@gold-work/shared';
import {planDocumentaryMontage} from './documentary-montage.js';
import {documentaryStatisticValue} from './documentary-editorial.js';

test('a preposition between qualifier and number does not turn an estimate into an exact statistic',()=>{
  assert.equal(documentaryStatisticValue('Уровень находится примерно на 26 метров выше моря.','26 метров'),'примерно 26 метров');
  assert.equal(documentaryStatisticValue('Высота примерно 26 метров.','26 метров'),'примерно 26 метров');
  assert.equal(documentaryStatisticValue('Повышение примерно на 60 процентов.','60%'),'примерно 60%');
  assert.equal(documentaryStatisticValue('Высота 26 метров.','26 метров'),'26 метров');
});

test('commas inside relative clauses do not create automatic list panels or overwrite manual lists',()=>{
  for(const text of ['Открывание прохода — не отдельный жест, который можно выполнить в любой момент.',
    'Для человека на берегу — возможностью увидеть, как вода, рельеф и инженерный расчёт действуют вместе.']){
    const project={videoBrief:{readyScript:text},settings:{assembly:{documentary:{autoMotionGraphics:true}}},scenes:[{
      id:'one',order:0,narration:text,durationSeconds:6,documentary:{verified:true,requirement:{text},selected:{kind:'image'},effects:[],caption:{enabled:false}}
    }]} as unknown as Project;
    assert.notEqual(planDocumentaryMontage(project)[0]!.documentary!.motionGraphic?.kind,'feature-list');
    const old={enabled:true,origin:'automatic',kind:'feature-list',title:'Проход',items:['не отдельный жест','который можно выполнить'],startSeconds:0,durationSeconds:6} as const;
    project.scenes[0]!.documentary!.motionGraphic={...old,items:[...old.items]};
    assert.equal(planDocumentaryMontage(project)[0]!.documentary!.motionGraphic!.enabled,false);
    project.scenes[0]!.documentary!.motionGraphic!.origin='manual';
    assert.deepEqual(planDocumentaryMontage(project),project.scenes);
  }
});

test('saved automatic percentage cards retain qualifiers across a split sentence',()=>{
  const texts=['Система позволяет повторно ','использовать около 60 процентов воды за цикл. '];
  const project={settings:{assembly:{documentary:{autoMotionGraphics:true}}},scenes:texts.map((narration,order)=>({
    id:String(order),order,narration,audioPath:`paid-${order}.wav`,durationSeconds:4,documentary:{verified:true,requirement:{text:narration},
      motionGraphic:{enabled:true,origin:'automatic',kind:'statistic',title:'Вода',value:'60%',sequenceId:'sentence-water',startSeconds:0,durationSeconds:4}}
  }))} as unknown as Project;
  const result=planDocumentaryMontage(project);
  assert.deepEqual(result.map(s=>s.documentary!.motionGraphic!.value),['около 60%','около 60%']);
  assert.deepEqual(result.map(s=>[s.narration,s.audioPath]),project.scenes.map(s=>[s.narration,s.audioPath]));
  project.scenes[1]!.documentary!.motionGraphic!.origin='manual';
  assert.equal(planDocumentaryMontage(project)[1]!.documentary!.motionGraphic!.value,'60%');
});

test('automatic editorial events preserve literal facts, prioritize a route and keep authored decisions on resume',()=>{
  const narration=['Два океана связаны каналом.\n\n','Длина составляет около 82 километров. ','Теперь проследим путь. ','Маршрут от Колона к городу Панама. ','В 1914 году канал открыли. ','Проверяем три детали: ворота, воду и суда. '];
  const script=narration.join('');
  const route=groundedDocumentaryMotion({kind:'map-route',route:[{name:'Колон',country:'PA'},{name:'Панама',country:'PA'}]},narration[3]!,script)!;
  const p={videoBrief:{readyScript:script},settings:{assembly:{documentary:{pace:'dynamic',autoMotionGraphics:true}}},scenes:narration.map((text,order)=>({
    id:String(order),order,narration:text,durationSeconds:9,audioPath:`paid-${order}.mp3`,videoPath:'verified.mp4',
    documentary:{verified:true,layout:'full',requirement:{text,...(order===2?{motionGraphic:{enabled:true,kind:'chapter-number',title:'Теперь проследим путь'}}:order===3?{motionGraphic:route}:{})},selected:{kind:'video'},effects:[],caption:{enabled:false,text:''}}
  }))} as unknown as Project;
  // A route arriving six seconds after a proposed chapter must win the slot.
  p.scenes[2]!.durationSeconds=6;
  const result=planDocumentaryMontage(p);
  assert.equal(result[0]!.documentary!.motionGraphic?.kind,'key-point');
  assert.equal(result[1]!.documentary!.motionGraphic?.value,'около 82 километров');
  assert.equal(result[2]!.documentary!.motionGraphic,undefined);
  assert.equal(result[3]!.documentary!.motionGraphic?.kind,'map-route');
  assert.equal(result[4]!.documentary!.motionGraphic?.value,'1914');
  assert.deepEqual(result[5]!.documentary!.motionGraphic?.items,['ворота','воду','суда']);
  assert.deepEqual(result.map(s=>[s.audioPath,s.narration]),p.scenes.map(s=>[s.audioPath,s.narration]));
  assert.deepEqual(planDocumentaryMontage({...p,scenes:result}),result);
  const manual=structuredClone(p);manual.scenes[1]!.documentary!.pinned=true;
  manual.scenes[4]!.documentary!.motionGraphic={kind:'chronology',value:'1914',title:'',enabled:false,startSeconds:0,durationSeconds:4,origin:'manual'};
  assert.equal(planDocumentaryMontage(manual)[1],manual.scenes[1]);
  assert.equal(planDocumentaryMontage(manual)[4],manual.scenes[4]);
  const qualified=structuredClone(p);
  qualified.scenes[1]!.documentary!.requirement.motionGraphic={kind:'statistic',enabled:true,value:'82 километров',title:'',startSeconds:0,durationSeconds:4};
  const qualifiedResult=planDocumentaryMontage(qualified)[1]!.documentary!.motionGraphic!;
  assert.equal(qualifiedResult.value,'около 82 километров','A semantic suggestion must retain the original qualifier');
  assert.equal(qualifiedResult.title,'Длина составляет около 82 километров');
  qualified.scenes[1]!.narration='Рядом расположен город. Длина составляет около 82 километров. ';
  qualified.videoBrief!.readyScript=qualified.scenes.map(s=>s.narration).join('');
  assert.equal(planDocumentaryMontage(qualified)[1]!.documentary!.motionGraphic!.title,'Длина составляет около 82 километров');
  qualified.scenes[0]!.narration='Представьте огромный контейнеровоз, который пересекает сушу. Не по рельсам и не на колёсах.';
  qualified.videoBrief!.readyScript=qualified.scenes.map(s=>s.narration).join('');
  assert.equal(planDocumentaryMontage(qualified)[0]!.documentary!.motionGraphic!.title,'Представьте огромный контейнеровоз, который пересекает сушу');
});
