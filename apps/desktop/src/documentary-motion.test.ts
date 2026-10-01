import test from 'node:test';
import assert from 'node:assert/strict';
import {groundedDocumentaryMotion,resolveDocumentaryPlace,searchDocumentaryPlaces,documentaryVideoCoverage,type Project} from '@gold-work/shared';
import {buildDocumentaryTimeline} from '@gold-work/remotion-video';
import {planDocumentaryMontage} from './documentary-montage.js';
import {documentaryEditErrors} from './documentary-validation.js';
import {isPlainDocumentaryShot} from './documentary-fast-render.js';

test('motion facts are grounded; maps resolve exact places without invented coordinates',()=>{
  const script='In 1858 they arrived in Denver. The group numbered 78,167 people.';
  assert.ok(resolveDocumentaryPlace('Денвер'));
  assert.ok(searchDocumentaryPlaces('Denver').length);
  assert.equal(resolveDocumentaryPlace('Atlantis invented city'),undefined);
  const map=groundedDocumentaryMotion({kind:'map-locator',place:'Denver',country:'US'},script,script);
  assert.ok(map?.place&&map.place.latitude>39&&map.place.latitude<40);
  assert.equal(groundedDocumentaryMotion({kind:'map-locator',place:'Denver'},'The group grew.',script),undefined);
  assert.equal(groundedDocumentaryMotion({kind:'statistic',value:'99,999 people'},script,script),undefined);
  assert.equal(groundedDocumentaryMotion({kind:'statistic',value:'78,167 people'},script,script)?.value,'78,167 people');
  assert.equal(groundedDocumentaryMotion({kind:'callout',title:'Denver'},script,script),undefined);
});

test('narrated Colon to Panama route resolves both towns from the detailed gazetteer',()=>{
  const narration='Проследим маршрут от Колона к городу Панама.';
  const graphic=groundedDocumentaryMotion({kind:'map-route',route:[{name:'Колон',country:'PA'},{name:'Панама',country:'PA'}]},narration,narration);
  assert.equal(graphic?.route?.length,2);
  assert.equal(graphic?.route?.[0]?.source,'Natural Earth 1:10m');
  assert.ok(graphic!.route![0]!.latitude>9.3&&graphic!.route![0]!.latitude<9.4);
  assert.ok(graphic!.route![1]!.latitude>8.9&&graphic!.route![1]!.latitude<9.1);
  assert.equal(resolveDocumentaryPlace('Колон','US'),undefined);
});

test('motion survives serialization/timeline, never changes narration and is sparse on auto resume',()=>{
  const graphic=groundedDocumentaryMotion({kind:'map-locator',place:'Denver'},'In Denver','In Denver')!;
  // Separate sentences test sparse events. Unpunctuated slices deliberately
  // form one continuous graphic sequence, covered in documentary-sequences.
  const project={mediaMode:'stock',aspectRatio:'16:9',settings:{voice:{enabled:false},assembly:{documentary:{version:2,captionsEnabled:true}}},scenes:Array.from({length:8},(_,order)=>({id:String(order),order,durationSeconds:4,transition:'none',videoPath:'unchanged.mp4',audioPath:'paid.wav',narration:'In Denver.',documentary:{verified:true,pinned:false,layout:'full',requirement:{motionGraphic:graphic},selected:{width:1920,height:1080,durationSeconds:10},caption:{enabled:false,text:''},effects:[]}}))} as unknown as Project;
  project.scenes=planDocumentaryMontage(project);
  for(const scene of project.scenes)if(scene.documentary?.motionGraphic)scene.documentary.motionGraphic.detail={kind:'satellite',imagePath:'map.jpg',latitude:graphic.place!.latitude,longitude:graphic.place!.longitude,radiusKm:35,featureCount:0,createdAt:'2026-09-26'};
  assert.deepEqual(project.scenes.filter(s=>s.documentary?.motionGraphic).map(s=>s.order),[0,3,6]);
  assert.deepEqual(planDocumentaryMontage(project),project.scenes);
  const timeline=buildDocumentaryTimeline(JSON.parse(JSON.stringify(project)));
  assert.equal(timeline.scenes[0]!.documentary!.motionGraphic!.place!.name,'Denver');
  assert.equal(isPlainDocumentaryShot(timeline,0),false,'FFmpeg plain-video path must not drop graphics');
  assert.equal(timeline.durationInFrames,960);
  assert.ok(project.scenes.every(s=>s.audioPath==='paid.wav'&&s.narration==='In Denver.'));
  const fullCoverage=documentaryVideoCoverage(project.scenes);
  assert.equal(fullCoverage.videoSeconds,0,'unclassified source is not counted as verified footage');
  for(const scene of project.scenes)scene.documentary!.selected!.kind='video';
  const fullVideoCoverage=documentaryVideoCoverage(project.scenes);
  project.scenes[0]!.documentary!.motionGraphic!.mapStyle='inset';
  const insetCoverage=documentaryVideoCoverage(project.scenes);
  assert.ok(insetCoverage.videoSeconds>fullVideoCoverage.videoSeconds,'inset map retains visible footage; full map does not count as filmed video');
  assert.deepEqual(documentaryEditErrors(project),[]);
  project.scenes[0]!.documentary!.motionGraphic!.place=undefined;
  assert.ok(documentaryEditErrors(project).some(e=>e.includes('координаты')));
});
