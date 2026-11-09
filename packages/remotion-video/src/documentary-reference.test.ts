import assert from 'node:assert/strict';
import test from 'node:test';
import {documentaryMotionTiming} from '@gold-work/shared';
import {documentaryMagnifierGeometry} from './documentary-magnifier.js';
import {documentaryEditorialStages,documentaryMarkerInk,documentaryPhraseWords,documentaryPhraseWordProgress,documentaryRevealFrame,documentaryStatisticRatio} from './documentary-editorial.js';
import {countValue} from './DocumentaryMotionGraphic.js';
import {documentaryDramaticTreatment} from './documentary-dramatic-treatment.js';
import {buildDocumentaryTimeline,type DocumentaryMotionGraphic,type DocumentaryProjectInput} from './documentary-timeline.js';

const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const magnifier:DocumentaryMotionGraphic={kind:'annotations',variant:'magnifier',title:'Крышка',enabled:true,origin:'automatic',startSeconds:0,durationSeconds:5,zoom:2.6,annotations:[{label:'Крышка',confidence:.98,points:[{seconds:0,x:31,y:44}]}]};

test('lens samples the actual source point after contain fit, inset and magnification in every canvas aspect',()=>{
  for(const [width,height,aspect] of [[1920,1080,4/3],[1080,1920,16/9],[1080,1080,9/16]])for(const cutoutPath of [undefined,'cutout.png']){
    const g=documentaryMagnifierGeometry({...magnifier,cutoutPath},1,aspect!,width!,height!)!;
    assert.ok(g);
    near(g.source.width/g.source.height,aspect!);
    near(g.anchor.x,g.source.x+g.source.width*.31);near(g.anchor.y,g.source.y+g.source.height*.44);
    near(g.image.left+g.source.width*.31*g.zoom,g.radius);near(g.image.top+g.source.height*.44*g.zoom,g.radius);
    assert.ok(g.lens.x-g.radius>=0&&g.lens.x+g.radius<=width!&&g.lens.y-g.radius>=0&&g.lens.y+g.radius<=height!);
  }
});

test('lens vanishes for unverified, stale or unsampled annotation coordinates',()=>{
  const at=(g:DocumentaryMotionGraphic)=>documentaryMagnifierGeometry(g,2,16/9,1920,1080);
  assert.equal(at({...magnifier,annotations:[{label:'Крышка',points:[{seconds:0,x:31,y:44}]}]}),undefined);
  assert.equal(at({...magnifier,annotations:[{label:'Крышка',confidence:.98,points:[{seconds:0,x:31,y:44},{seconds:5,x:32,y:44}]}]}),undefined);
  assert.equal(at({...magnifier,annotations:[{label:'Крышка',confidence:.98,points:[{seconds:0,x:NaN,y:44}]}]}),undefined);
  assert.ok(at({...magnifier,origin:'manual',annotations:[{label:'Крышка',points:[{seconds:0,x:31,y:44}]}]}));
});

test('phrase segmentation preserves original multilingual text and marks only the requested literal span',()=>{
  for(const text of ['  «Первый  шаг»\nnext-step 世界!','الحجة هنا — точно.','中文短语 без подмены']){
    const words=documentaryPhraseWords(text,'шаг');
    assert.equal(words.map(w=>w.text+w.space).join(''),text);
  }
  const words=documentaryPhraseWords('Первый важный шаг, затем итог.','важный шаг');
  assert.equal(words.filter(w=>w.highlightStart>=0).map(w=>w.text.slice(w.highlightStart,w.highlightEnd)).join(' '),'важный шаг');
  assert.equal(words.at(-1)!.readingIndex,4);
  assert.ok(documentaryPhraseWords('Only these words','absent').every(w=>w.highlightStart===-1));
});

test('contrast and number animation preserve authored final formatting',()=>{
  assert.equal(documentaryMarkerInk('#ffdd00'),'#10161c');assert.equal(documentaryMarkerInk('#702db6'),'#ffffff');
  assert.equal(countValue('50,5 %',.5),'25,3 %');assert.equal(countValue('1 250 км',1),'1 250 км');
  assert.equal(countValue('тридцать мотоциклов',.5),'тридцать мотоциклов');
  assert.equal(countValue('50%',0),'0%');
});

test('statistic scale encodes only an explicit valid ratio and preserves authored labels',()=>{
  for(const value of ['14 of 16','14 out of 16 races','14 из 16 гонок']){
    const ratio=documentaryStatisticRatio(value)!;
    assert.equal(ratio.main,'14');assert.equal(ratio.main+ratio.context,value);
    near(ratio.fraction,14/16);assert.equal(ratio.segments,16);assert.equal(ratio.filled,14);
  }
  const percent=documentaryStatisticRatio('50,5 %')!;
  assert.equal(percent.main+percent.context,'50,5 %');near(percent.fraction,.505);
  assert.equal(percent.segments,undefined);
  assert.equal(documentaryStatisticRatio('0 of 16')!.fraction,0);
  assert.equal(documentaryStatisticRatio('100%')!.fraction,1);
  assert.equal(documentaryStatisticRatio('29 of 32')!.segments,undefined);
  near(documentaryStatisticRatio('29 of 32')!.fraction,29/32);
  for(const value of ['2003','990 cc','14/16','3:2','about 14 of 16','14–16','17 of 16','1 of 0','101%','-20%','50% of 16','14 of 16 in 2003','9007199254740992 of 9007199254740993']){
    assert.equal(documentaryStatisticRatio(value),undefined,value);
  }
});

test('editorial beats and every phrase word settle early inside the supplied window',()=>{
  for(const frames of [15,30,60,150,300]){
    const {revealFrames}=documentaryEditorialStages(0,frames);
    assert.ok(revealFrames<=36&&revealFrames<frames*.38);
    const first=documentaryEditorialStages(revealFrames*.15,frames);
    assert.ok(first.main>0);assert.equal(first.detail,0);assert.equal(first.settle,0);
    const second=documentaryEditorialStages(revealFrames*.55,frames);
    assert.equal(second.main,1);assert.ok(second.detail>0);assert.equal(second.settle,0);
    for(const frame of [Math.ceil(revealFrames),frames-1]){
      const hold=documentaryEditorialStages(frame,frames);
      assert.equal(hold.main,1);assert.equal(hold.detail,1);assert.equal(hold.settle,1);
      for(const count of [1,7,20])for(let index=0;index<count;index++)assert.equal(documentaryPhraseWordProgress(frame,frames,index,count),1);
    }
    assert.ok(documentaryPhraseWordProgress(revealFrames*.3,frames,0,7)>0);
    assert.equal(documentaryPhraseWordProgress(revealFrames*.3,frames,6,7),0);
  }
  for(const frames of [1,2]){
    const stages=documentaryEditorialStages(0,frames);
    assert.equal(stages.main,1);assert.equal(stages.detail,1);assert.equal(stages.settle,1);
    assert.equal(documentaryPhraseWordProgress(0,frames,6,7),1);
  }
});

test('entrance completes early on short scenes and dramatic colour holds without scene-long oscillation',()=>{
  assert.ok(documentaryRevealFrame(15,30)>=50);assert.equal(documentaryRevealFrame(48,150),48);
  assert.deepEqual(documentaryDramaticTreatment(undefined,60,150),{vignette:0,filter:undefined});
  assert.equal(documentaryDramaticTreatment({monochrome:true},60,150).filter,'grayscale(1)');
  assert.equal(documentaryDramaticTreatment({monochrome:true},100,150).filter,'grayscale(1)');
});

test('timeline keeps variants, speech duration, background opacity and existing stale-source safeguards',()=>{
  const project:DocumentaryProjectInput={aspectRatio:'16:9',settings:{voice:{enabled:true},assembly:{kenBurns:true}},scenes:[{id:'a',order:0,durationSeconds:3,imagePath:'source.png',documentary:{layout:'full',checksum:'same',motionGraphic:{...magnifier,sourceChecksum:'same'},timing:{sourceKey:'voice',durationInFrames:151,speechSeconds:5},caption:{enabled:false,text:'',position:'bottom',animation:'fade',fontSize:48,color:'#ffffff',backgroundColor:'#000000',opacity:100},effects:[{id:'bg',enabled:true,origin:'manual',kind:'video',role:'background',filePath:'chosen.mp4',startSeconds:0,durationSeconds:6,x:0,y:0,scale:1,blend:'normal',defaults:{opacity:37,volume:0,sourceAudio:false,trimStartSeconds:2,trimEndSeconds:6,fadeInSeconds:0,fadeOutSeconds:0}}]}}]};
  const timeline=buildDocumentaryTimeline(project),scene=timeline.scenes[0]!;
  assert.equal(scene.durationInFrames,151);assert.equal(scene.documentary!.motionGraphic!.variant,'magnifier');
  assert.equal(scene.documentary!.effects[0]!.defaults.opacity,37);assert.equal(scene.documentary!.effects[0]!.defaults.trimStartSeconds,2);
  project.scenes[0]!.documentary!.checksum='replacement';
  assert.equal(buildDocumentaryTimeline(project).scenes[0]!.documentary!.motionGraphic!.enabled,false);
});

test('different directed variants never inherit another scene entrance through a shared sequence id',()=>{
  const graphic:DocumentaryMotionGraphic={kind:'key-point',variant:'marker',title:'Honda и Yamaha',enabled:true,origin:'automatic',startSeconds:0,durationSeconds:4,sequenceId:'comparison'};
  const doc={layout:'full' as const,effects:[],caption:{enabled:false,text:'',position:'bottom' as const,animation:'fade' as const,fontSize:48,color:'#ffffff',backgroundColor:'#000000',opacity:100}};
  const timeline=buildDocumentaryTimeline({aspectRatio:'16:9',settings:{voice:{enabled:false},assembly:{kenBurns:false}},scenes:[
    {id:'a',order:0,durationSeconds:4,documentary:{...doc,motionGraphic:graphic}},
    {id:'b',order:1,durationSeconds:4,documentary:{...doc,motionGraphic:{...graphic,variant:'poster'}}}
  ]});
  assert.ok(timeline.scenes.every(scene=>scene.documentary!.motionGraphic!.sequenceOffsetFrames===undefined));
  assert.equal(timeline.durationInFrames,240);
});

test('automatic chapter timing follows the measured scene and preserves manual or unmarked intervals',()=>{
  const graphic:DocumentaryMotionGraphic={kind:'chapter-number',title:'The Refusal',value:'1',enabled:true,origin:'automatic',startSeconds:0,durationSeconds:3};
  const doc={layout:'full' as const,effects:[],caption:{enabled:false,text:'',position:'bottom' as const,animation:'fade' as const,fontSize:48,color:'#ffffff',backgroundColor:'#000000',opacity:100},motionGraphic:graphic,
    timing:{sourceKey:'voice',durationInFrames:223,speechSeconds:7.2}};
  const project:DocumentaryProjectInput={aspectRatio:'16:9',settings:{voice:{enabled:true},assembly:{kenBurns:true}},scenes:[{id:'chapter',order:0,durationSeconds:6.356,documentary:doc}]};
  let scene=buildDocumentaryTimeline(project).scenes[0]!;
  assert.equal(scene.durationInFrames,223);
  assert.deepEqual(documentaryMotionTiming(graphic,223/30),{startSeconds:0,durationSeconds:223/30});
  assert.equal(scene.documentary!.motionGraphic!.durationSeconds,223/30);
  assert.equal(graphic.durationSeconds,3,'building a timeline does not rewrite the saved project');

  graphic.startSeconds=1.2;
  scene=buildDocumentaryTimeline(project).scenes[0]!;
  assert.equal(Math.round(scene.documentary!.motionGraphic!.startSeconds*30)+Math.round(scene.documentary!.motionGraphic!.durationSeconds*30),223);
  project.scenes[0]!.durationOverrideSeconds=9.02;
  scene=buildDocumentaryTimeline(project).scenes[0]!;
  assert.equal(scene.durationInFrames,271);
  assert.deepEqual(documentaryMotionTiming(graphic,9.02),{startSeconds:1.2,durationSeconds:235/30});
  assert.equal(scene.documentary!.motionGraphic!.durationSeconds,235/30);

  for(const origin of ['manual',undefined] as const){
    graphic.origin=origin;
    assert.deepEqual(documentaryMotionTiming(graphic,9.02),{startSeconds:1.2,durationSeconds:3});
    assert.equal(buildDocumentaryTimeline(project).scenes[0]!.documentary!.motionGraphic!.durationSeconds,3);
  }
  assert.deepEqual(documentaryMotionTiming({...graphic,kind:'statistic',origin:'automatic'},9.02),{startSeconds:1.2,durationSeconds:3});
});

test('taking the displayed chapter interval before a manual edit never restores the old cap',()=>{
  const saved:DocumentaryMotionGraphic={kind:'chapter-number',title:'The Refusal',enabled:true,origin:'automatic',startSeconds:0,durationSeconds:3};
  const edited={...saved,...documentaryMotionTiming(saved,223/30),title:'Edited title',origin:'manual' as const};
  assert.deepEqual(documentaryMotionTiming(edited,12),{startSeconds:0,durationSeconds:223/30});
  assert.deepEqual(documentaryMotionTiming({...edited,startSeconds:.5,durationSeconds:2},12),{startSeconds:.5,durationSeconds:2});
  assert.equal(saved.durationSeconds,3);
  for(const frames of [1,31,181,223]){
    assert.equal(documentaryMotionTiming(saved,frames/30).durationSeconds,frames/30,'frame rounding must not add an extra frame');
  }
});

test('editorial chapters retain a short reading window through timeline and manual editing',()=>{
  const graphic:DocumentaryMotionGraphic={kind:'chapter-number',preset:'chapter-signal',title:'The Refusal',value:'1',enabled:true,origin:'automatic',startSeconds:.4,durationSeconds:2.6};
  const doc={layout:'full' as const,effects:[],caption:{enabled:false,text:'',position:'bottom' as const,animation:'fade' as const,fontSize:48,color:'#ffffff',backgroundColor:'#000000',opacity:100},motionGraphic:graphic,
    timing:{sourceKey:'voice',durationInFrames:223,speechSeconds:7.2}};
  const project:DocumentaryProjectInput={aspectRatio:'16:9',settings:{voice:{enabled:true},assembly:{kenBurns:false}},scenes:[{id:'chapter',order:0,durationSeconds:6.356,documentary:doc}]};
  const scene=buildDocumentaryTimeline(project).scenes[0]!;
  assert.equal(scene.durationInFrames,223);
  assert.deepEqual(documentaryMotionTiming(graphic,223/30),{startSeconds:.4,durationSeconds:2.6});
  assert.equal(scene.documentary!.motionGraphic!.durationSeconds,2.6);
  assert.equal(documentaryMotionTiming({...graphic,durationSeconds:10},223/30).durationSeconds,211/30);
  const edited={...graphic,...documentaryMotionTiming(graphic,223/30),origin:'manual' as const};
  assert.equal(documentaryMotionTiming(edited,12).durationSeconds,2.6);
});
