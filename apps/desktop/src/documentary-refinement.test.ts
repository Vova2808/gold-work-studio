import test from 'node:test';
import assert from 'node:assert/strict';
import {matchDocumentaryReading,groundedDocumentaryMotion,documentaryAccent,type Project,type Scene} from '@gold-work/shared';
import {planDocumentaryMontage} from './documentary-montage.js';
import {planDocumentaryComparisons} from './documentary-comparison.js';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';

test('reading uses audio intervals, repairs a merged preposition, rejects different text',()=>{
  const heard=[{text:'машиной',startSeconds:1,endSeconds:1.6},{text:'стратуара',startSeconds:2.2,endSeconds:3}];
  const match=matchDocumentaryReading('машиной с тротуара',heard)!;
  assert.equal(match.length,3);assert.equal(match[1]!.startSeconds,2.2);assert.equal(match[2]!.endSeconds,3);
  assert.equal(matchDocumentaryReading('машиной около аэродрома',heard),undefined);
  assert.equal(groundedDocumentaryMotion({kind:'quote',title:'точный текст диктора'},'Это точный текст диктора.','Это точный текст диктора.')?.quoteMode,'speech');
  assert.equal(groundedDocumentaryMotion({kind:'quote',title:'чужие слова'},'Это точный текст диктора.','Это точный текст диктора.'),undefined);
});
const scene=(id:string,name:string,order:number):Scene=>({id,order,durationSeconds:6,narration:`${name} появился в нашей истории.`,imagePath:`${id}.jpg`,audioPath:'paid.mp3',documentary:{verified:true,pinned:false,layout:'full',caption:{enabled:false},effects:[],requirement:{text:name,entities:[name],identities:[{name,aliases:[]}],years:[],queries:[name]},selected:{kind:'image',title:name,description:name},visualReview:{status:'accepted',identifiedEntity:name}}} as unknown as Scene);
const project=(scenes:Scene[])=>({scenes,settings:{assembly:{documentary:{autoMotionGraphics:true}},stockVideoPercent:0}} as Project);

test('a changed narration timing invalidates previously aligned reading in the preview',()=>{
  const s=scene('reading','Текст',0),p=project([s]);p.settings.voice={enabled:true} as Project['settings']['voice'];
  s.documentary!.timing={sourceKey:'voice-v1',durationInFrames:180,speechSeconds:6};
  s.documentary!.motionGraphic={enabled:true,kind:'quote',title:'Текст',startSeconds:0,durationSeconds:6,
    reading:{text:'Текст',sourceKey:'voice-v1',words:[{text:'Текст',startSeconds:0,endSeconds:1}]}};
  assert.equal(buildDocumentaryTimeline(p).scenes[0]!.documentary!.motionGraphic!.reading!.words.length,1);
  s.documentary!.timing.sourceKey='voice-v2';
  assert.equal(buildDocumentaryTimeline(p).scenes[0]!.documentary!.motionGraphic!.reading,undefined);
});

test('source verification upgrades an automatic text event to a cutout; manual edits stay intact',()=>{
  for(const name of ['Давиде Бривио','Титаник','Boeing 747']){
    const s=scene('first',name,0);s.documentary!.motionGraphic={enabled:true,origin:'automatic',kind:'key-point',title:name,startSeconds:0,durationSeconds:6};
    const planned=planDocumentaryMontage(project([s]));
    assert.equal(planned[0]!.documentary!.motionGraphic!.kind,'subject-card');assert.equal(planned[0]!.documentary!.motionGraphic!.isolateSubject,true);
    assert.equal(planned[0]!.audioPath,s.audioPath);assert.deepEqual(planDocumentaryMontage(project(planned)),planned);
    s.documentary!.motionGraphic!.origin='manual';assert.equal(planDocumentaryMontage(project([s]))[0]!.documentary!.motionGraphic!.kind,'key-point');
  }
  assert.equal(documentaryAccent('Boeing 747'),documentaryAccent('boeing 747'));
  assert.ok(new Set(['Давиде Бривио','Титаник','Boeing 747','Двигатель','История'].map(documentaryAccent)).size>=3);
});
test('Russian comparisons use two independently verified subjects and choose a board',()=>{
  const a=scene('a','Yamaha',0),b=scene('b','Honda',1);a.documentary!.requirement.entities=['Yamaha','Honda'];a.documentary!.requirement.text='Сравнение Yamaha и Honda';
  const compared=planDocumentaryComparisons(project([a,b]));assert.equal(compared[0]!.documentary!.comparison!.sceneId,'b');
  assert.equal(planDocumentaryMontage(project(compared))[0]!.documentary!.template,'compare-grid');
  b.documentary!.verified=false;assert.equal(planDocumentaryComparisons(project([a,b]))[0]!.documentary!.comparison,undefined);
});
test('CRT is selected for a verified archival photograph but manual templates are preserved',()=>{
  const s=scene('archive','Архивная фотография',0);s.narration='Архивная фотография с испытаний.';s.documentary!.requirement.identities=[];s.documentary!.requirement.text='Архивная фотография';
  // A preceding paragraph avoids a chapter/title event at the beginning.
  const intro=scene('intro','Вступление',-1);intro.documentary!.pinned=true;
  assert.equal(planDocumentaryMontage(project([intro,s]))[1]!.documentary!.template,'broadcast-crt');
  s.documentary!.template='gallery';assert.equal(planDocumentaryMontage(project([intro,s]))[1]!.documentary!.template,'gallery');
});

test('automatic layouts adapt to new geometry and comparison; authored layouts stay fixed',()=>{
  const intro=scene('intro','Вступление',0);intro.documentary!.pinned=true;
  const s=scene('diagram','Схема устройства',1);s.documentary!.requirement.identities=[];
  let scenes=planDocumentaryMontage(project([intro,s]));
  assert.equal(scenes[1]!.documentary!.template,'blueprint-board');
  assert.deepEqual(planDocumentaryMontage(project(scenes)),scenes);
  scenes[1]!.documentary!.selected!.width=6000;scenes[1]!.documentary!.selected!.height=1000;
  scenes=planDocumentaryMontage(project(scenes));assert.equal(scenes[1]!.documentary!.template,'detail-scan');
  scenes[1]!.documentary!.layout='compare';scenes[1]!.documentary!.comparison={sceneId:'intro',leftLabel:'А',rightLabel:'Б'};
  scenes=planDocumentaryMontage(project(scenes));assert.equal(scenes[1]!.documentary!.template,'compare-grid');
  scenes[1]!.documentary!.template='archive-slide';scenes[1]!.documentary!.templateOrigin='manual';
  assert.equal(planDocumentaryMontage(project(scenes))[1]!.documentary!.template,'archive-slide');
});

test('explicit montage refresh renews legacy layouts without altering media, paid voice or manual edits',()=>{
  const intro=scene('intro','Вступление',0);intro.documentary!.pinned=true;
  const diagram=scene('diagram','Схема устройства',1);diagram.documentary!.requirement.identities=[];diagram.documentary!.template='gallery';
  const manual=scene('manual','Деталь',2);manual.documentary!.template='archive-slide';manual.documentary!.templateOrigin='manual';
  const pinned=scene('pinned','Архивная фотография',3);pinned.documentary!.pinned=true;pinned.documentary!.template='gallery';
  const p=project([intro,diagram,manual,pinned]);
  assert.equal(planDocumentaryMontage(p)[1]!.documentary!.template,'gallery','normal resume preserves unmarked legacy edits');
  const updated=planDocumentaryMontage(p,false,true);
  assert.equal(updated[1]!.documentary!.template,'blueprint-board');
  assert.equal(updated[2],manual);assert.equal(updated[3],pinned);
  assert.deepEqual(updated.map(s=>[s.narration,s.audioPath,s.imagePath,s.documentary?.selected,s.documentary?.verified]),p.scenes.map(s=>[s.narration,s.audioPath,s.imagePath,s.documentary?.selected,s.documentary?.verified]));
  assert.deepEqual(planDocumentaryMontage({...p,scenes:updated}),updated);
});
