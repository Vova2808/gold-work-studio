import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {documentaryMotionPresetFor,documentaryMotionPresetsFor,type DocumentaryMotionGraphic,type Project} from '@gold-work/shared';
import {createDocumentaryMotionPresetPlanner} from './documentary-motion-preset-planner.js';
import {enrichSemanticMontage,montageFrames} from './documentary-semantic-montage.js';
import {planDocumentaryMontage} from './documentary-montage.js';

function project(texts:string[]):Project{
  return {id:'preset-fixture',mediaMode:'stock',language:'en',aspectRatio:'16:9',settings:{assembly:{kenBurns:true,documentary:{version:2,autoMotionGraphics:true,
    montage:{version:1,style:'editorial',intensity:'rich',hookSeconds:16}}}},
    scenes:texts.map((narration,order)=>({id:`preset-${order}`,order,narration,durationSeconds:6,imagePath:`photo-${order}.jpg`,audioPath:`voice-${order}.wav`,
      documentary:{verified:true,layout:'full',effects:[],caption:{enabled:false,text:''},selected:{kind:'image',width:1920,height:1080},
        requirement:{text:narration,identities:[],years:[]},timing:{sourceKey:`audio-${order}`,durationInFrames:180,speechSeconds:6}}}))} as unknown as Project;
}
const graphic=(kind:DocumentaryMotionGraphic['kind'],fields:Partial<DocumentaryMotionGraphic>={}):DocumentaryMotionGraphic=>({kind,enabled:true,origin:'automatic',title:'A decisive change',startSeconds:0,durationSeconds:3,...fields});

test('turning off photo Ken Burns does not disable authored vector choreography',()=>{
  const p=project(['Water evaporates and condenses into clouds.']);
  p.settings.assembly.kenBurns=false;
  const artwork:NonNullable<DocumentaryMotionGraphic['artwork']>={version:1,intent:'Water cycle',layout:'full',canvas:{width:1000,height:600},
    palette:{background:'#101820',ink:'#ffffff',accent:'#88bbdd',secondary:'#888888'},
    layers:[{id:'water',kind:'ellipse',x:100,y:350,w:300,h:100,fill:'#88bbdd'},
      {id:'vapour',kind:'path',x:250,y:100,w:60,h:250,path:'M30 250 C0 180 60 80 30 0',stroke:'#ffffff',fill:'none'}],startSeconds:0,durationSeconds:4};
  p.scenes[0]!.documentary!.semanticMontage={sceneId:p.scenes[0]!.id,subject:'water',beat:'explain',treatment:'footage',cutawaySceneIds:[],artwork};
  const animated=enrichSemanticMontage(p)[0]!.documentary!;
  assert.ok((animated.templateMotion?.amountPercent??0)>0);
  assert.equal(animated.motionGraphic?.artwork,artwork);
  p.scenes[0]!.documentary!.templateMotion={amountPercent:0,curve:'smooth'};
  assert.equal(enrichSemanticMontage(p)[0]!.documentary!.templateMotion?.amountPercent,0,'explicit local Motion 0 is retained');
});

test('a narrated photograph holds the selected source and retains its literal consequence',()=>{
  const p=project(['One perfect photograph. But the driver who slowed down for that photograph will not win.']);
  const g=createDocumentaryMotionPresetPlanner(p).apply(p.scenes[0]!,graphic('key-point',{title:'One perfect photograph'}),6)!;
  assert.equal(g.photoMoment?.consequence,'will not win');
  assert.ok(g.photoMoment!.captureFrame<g.photoMoment!.consequenceFrame!);
  assert.equal(g.startSeconds+g.durationSeconds,6);
  const ordinary=createDocumentaryMotionPresetPlanner(p).apply(p.scenes[0]!,graphic('key-point',{title:'The driver will not win'}),6)!;
  assert.equal(ordinary.photoMoment,undefined);
});

test('neighboring ordinary phrases keep meaning without repeated preset choreography',()=>{
  const p=project(Array.from({length:10},(_,i)=>'The decisive change '+i+'. The camera returns to the racing cars.'));
  const plan=()=>{const planner=createDocumentaryMotionPresetPlanner(p);return p.scenes.map((s,i)=>planner.apply(s,graphic('key-point',{title:'The decisive change '+i}),6));};
  const first=plan();assert.deepEqual(plan(),first);
  assert.ok(first.every(g=>g!==undefined&&g.preset==='source-emphasis'),'ordinary phrases use a consistent source emphasis');
  assert.deepEqual(first.map(g=>g?.title),p.scenes.map((_,i)=>'The decisive change '+i));
  assert.ok(first.every(g=>g&&g.startSeconds+g.durationSeconds<=6),'the same literal emphasis remains readable inside its own scene');
  const marked=createDocumentaryMotionPresetPlanner(p);
  const marker=(title:string)=>graphic('key-point',{title,variant:'marker',highlight:title});
  assert.equal(marked.apply(p.scenes[0]!,marker('The decisive change 0'),6)?.preset,'source-emphasis');
  const quiet=marked.apply(p.scenes[1]!,marker('The decisive change 1'),6)!;
  assert.equal(quiet.preset,'source-emphasis');assert.equal(quiet.highlight,'The decisive change 1');
  assert.equal(marked.apply(p.scenes[2]!,marker('Ferrari has been beaten'),6)?.preset,'source-emphasis');
  assert.equal(marked.apply(p.scenes[3]!,marker('Money, power, control'),6)?.preset,'source-emphasis');
  const authored=graphic('key-point',{title:'A deliberate repeated effect',preset:'type-ribbon',startSeconds:1,durationSeconds:4});
  assert.deepEqual(marked.apply(p.scenes[4]!,authored,6),authored,'an explicit preset and timing are not overridden');
  const manual={...authored,origin:'manual' as const};assert.deepEqual(marked.apply(p.scenes[5]!,manual,6),manual);
  const intentional=createDocumentaryMotionPresetPlanner(p),same=graphic('key-point',{title:'The same recurring thesis',variant:'poster'});
  assert.equal(intentional.apply(p.scenes[0]!,same,6)?.preset,'source-emphasis');
  assert.equal(intentional.apply(p.scenes[1]!,same,6)?.preset,'source-emphasis','a recurring emphasis keeps the same treatment');
  const examples:[DocumentaryMotionGraphic,DocumentaryMotionGraphic['preset']][]=[
    [graphic('key-point',{title:'Ferrari has been beaten'}),'source-emphasis'],
    [graphic('key-point',{title:'Фаворит побеждён'}),'source-emphasis'],
    [graphic('chronology',{title:'',value:'1966'}),'source-emphasis'],
    [graphic('chronology',{title:'',value:'June 19, 1966'}),'source-emphasis'],
    [graphic('statistic',{title:'',hideTitle:true,value:'Only 3 of 8',showSource:false}),'source-emphasis'],
    [graphic('statistic',{title:'',hideTitle:true,value:'40 inches',showSource:false}),'source-emphasis'],
    [graphic('statistic',{title:'',hideTitle:true,value:'40 km/h',showSource:false}),'source-emphasis'],
    [graphic('explainer',{title:'',hideTitle:true,boardLayout:'compare',cards:[{label:'money'},{label:'control'}]}),'board-ledger'],
    [graphic('explainer',{title:'',hideTitle:true,boardLayout:'parts',cards:[{label:'brakes'},{label:'cooling'},{label:'transmission'}]}),'board-cascade'],
    [graphic('explainer',{title:'',hideTitle:true,boardLayout:'steps',cards:[{label:'prepare'},{label:'test'}]}),'board-staircase'],
  ];
  for(const [g,preset] of examples)assert.equal(createDocumentaryMotionPresetPlanner(p).apply(p.scenes[0]!,g,6)?.preset,preset);
});

test('saved automatic slams become compact accents while explicit posters and owned scenes stay unchanged',()=>{
  const p=project(['With six laps remaining, Biaggi passed Rossi.']),scene=p.scenes[0]!;
  const saved=graphic('key-point',{title:'Biaggi passed Rossi',preset:'type-slam',startSeconds:3.8,durationSeconds:2.2});
  const planned=createDocumentaryMotionPresetPlanner(p).apply(scene,saved,6)!;
  assert.equal(planned.preset,undefined);assert.equal(planned.variant,'clean');
  assert.equal(planned.title,saved.title);assert.equal(planned.startSeconds,saved.startSeconds);assert.equal(planned.durationSeconds,saved.durationSeconds);
  for(const authored of [{...saved,origin:'manual' as const},{...saved,variant:'poster' as const}])
    assert.deepEqual(createDocumentaryMotionPresetPlanner(p).apply(scene,authored,6),authored);
  for(const owned of [{pinned:true},{templateOrigin:'manual' as const},{templateMotion:{amountPercent:0,curve:'smooth' as const}}])
    assert.deepEqual(createDocumentaryMotionPresetPlanner(p).apply({...scene,documentary:{...scene.documentary!,...owned}},saved,6),saved);
});

test('speech, sequences, source-linked cards and hidden essential titles retain their dedicated renderer',()=>{
  const p=project(['A decisive change has happened.']),scene=p.scenes[0]!,planner=createDocumentaryMotionPresetPlanner(p);
  for(const g of [graphic('quote',{quoteMode:'speech'}),graphic('quote',{quoteMode:'phrase',reading:{text:'A decisive change',words:[]}}),
    graphic('explainer',{sequenceId:'list-1'}),graphic('feature-list',{presentation:'panels'}),
    graphic('explainer',{cards:[{label:'Alice',sceneId:scene.id}]}),graphic('feature-list',{panels:[{label:'Alice',sceneId:scene.id}]}),
    graphic('chronology',{value:'1966',items:['1965','1966']}),graphic('subject-card',{hideTitle:true}),graphic('key-point',{hideTitle:true}),
    graphic('key-point',{enabled:false}),graphic('key-point',{origin:'manual'})]){
    assert.deepEqual(planner.apply(scene,g,6),g);
  }
  const linked=graphic('explainer',{cards:[{label:'Alice',sceneId:scene.id}]});assert.deepEqual(documentaryMotionPresetsFor(linked),[]);
});

test('clean, calm, disabled motion, pinned and manual scenes receive no forced preset or photo layout',()=>{
  for(const mode of ['clean','calm','density','off','zero','pinned','manual'] as const){
    const p=project(['A decisive change has happened.']),d=p.settings.assembly.documentary!,scene=p.scenes[0]!;
    if(mode==='clean')d.montage!.style='clean';if(mode==='calm')d.montage!.intensity='calm';if(mode==='density')d.montageDensity='calm';
    if(mode==='off')d.autoMotionGraphics=false;
    if(mode==='zero')scene.documentary!.templateMotion={amountPercent:0,curve:'smooth'};
    if(mode==='pinned')scene.documentary!.pinned=true;if(mode==='manual')scene.documentary!.templateOrigin='manual';
    const planner=createDocumentaryMotionPresetPlanner(p),g=graphic('key-point');
    assert.deepEqual(planner.apply(scene,g,6),g,mode);assert.equal(planner.photoTemplate(scene),undefined,mode);
  }
  const p=project(['One perfect photograph. But the driver will not win.']);p.settings.assembly.kenBurns=false;
  const planner=createDocumentaryMotionPresetPlanner(p);
  assert.ok(planner.apply(p.scenes[0]!,graphic('key-point'),6)?.enabled,'Ken Burns disables photograph movement, not graphic motion');
  assert.equal(planner.photoTemplate(p.scenes[0]!),undefined);
  const planned=enrichSemanticMontage(p);assert.ok(planned[0]!.documentary!.motionGraphic?.preset);
  assert.equal(JSON.stringify(enrichSemanticMontage({...p,scenes:planned})),JSON.stringify(planned));
});

test('short literal thoughts release the source; late facts stay with speech and replanning is stable',()=>{
  const p=project(['One decisive moment. The cars approach the finish after a long day and the cameras wait.',
    'Ford had factories, money, and mass production.','June 19, 1966. The race begins.']);
  p.scenes[0]!.durationSeconds=8;p.scenes[0]!.documentary!.timing!.durationInFrames=240;
  const before=structuredClone(p),planned=enrichSemanticMontage(p),first=planned[0]!.documentary!.motionGraphic!;
  assert.ok(first.preset);assert.ok(first.startSeconds>=.3);
  assert.ok(first.durationSeconds<=3,'a three-word thought does not occupy the eight-second shot');
  assert.ok(8-first.startSeconds-first.durationSeconds>=4,'the same source continues after the thought');
  for(const s of planned){const g=s.documentary!.motionGraphic;if(g){assert.ok(g.startSeconds+g.durationSeconds<=montageFrames(s)/30+1e-7);assert.equal(g.reading,undefined);assert.equal(s.documentary!.template,'full');}}
  assert.deepEqual(planned.map(s=>[s.narration,s.audioPath,s.imagePath,s.durationSeconds,s.documentary!.timing]),p.scenes.map(s=>[s.narration,s.audioPath,s.imagePath,s.durationSeconds,s.documentary!.timing]));
  assert.deepEqual(p,before);assert.equal(JSON.stringify(enrichSemanticMontage({...p,scenes:planned})),JSON.stringify(planned));
  const late=project(['The team completed a long morning of mechanical checks and prepared the workshop. The important number was only 40 inches.']);
  const g=enrichSemanticMontage(late)[0]!.documentary!.motionGraphic!;
  assert.ok(g.startSeconds>0,'late literal quantities retain a source lead-in');
  assert.ok(g.durationSeconds>=3.4,'late facts retain a readable hold instead of flashing at the cut');
  assert.equal(g.startSeconds+g.durationSeconds,6);assert.ok(g.value?.includes('only 40 inches'));
});

test('late years retain a readable window and authored artwork retains explicit timing',()=>{
  const p=project(["Later that year, Rossi secured Yamaha's first premier-class riders' championship since Wayne Rainey in 1992."]);
  const before=structuredClone(p),scene=p.scenes[0]!,planner=createDocumentaryMotionPresetPlanner(p);
  const date=planner.apply(scene,graphic('chronology',{title:'',value:'1992'}),6)!;
  assert.equal(date.startSeconds,2);assert.equal(date.durationSeconds,4);
  assert.deepEqual(p,before,'planning never changes scene or narration duration');
  const artwork={version:1,layers:[]} as unknown as NonNullable<DocumentaryMotionGraphic['artwork']>;
  const authored=graphic('explainer',{title:'',artwork,startSeconds:1.25,durationSeconds:3.75});
  assert.deepEqual(planner.apply(scene,authored,6),authored,'authored geometry and timing bypass preset selection');
});

test('distinct consecutive facts survive; repeated facts do not generate repeated cards',()=>{
  const p=project(Array.from({length:6},(_,i)=>'Only '+(i+3)+' of 8 cars finished the race.'));
  const planner=createDocumentaryMotionPresetPlanner(p),plans=p.scenes.map((s,i)=>planner.apply(s,graphic('statistic',{title:'',value:'Only '+(i+3)+' of 8'}),6));
  assert.ok(plans.every(Boolean),'a cooldown must not erase the second side of an explanation');
  assert.ok(plans.filter(Boolean).every(g=>g!.preset==='stat-split'));
  const repeated=createDocumentaryMotionPresetPlanner(p),g=graphic('statistic',{title:'',value:'Only 3 of 8'});
  assert.ok(repeated.apply(p.scenes[0]!,g,6,'Only 3 of 8'));assert.equal(repeated.apply(p.scenes[2]!,g,6,'Only 3 of 8'),undefined);
  const chapter=createDocumentaryMotionPresetPlanner(p).apply(p.scenes[0]!,graphic('chapter-number',{title:'The Refusal',value:'1',startSeconds:2}),6)!;
  assert.equal(chapter.startSeconds,2);assert.ok(chapter.durationSeconds<=3.2);
  const consequence=project(['Mechanics fight exhaustion while drivers fight the clock.','Only 3 of 8 Mark Two Fords reach the finish. Those three cars take first, second, and third.']);
  consequence.scenes[0]!.durationSeconds=3;consequence.scenes[0]!.documentary!.timing!.durationInFrames=90;
  const planned=enrichSemanticMontage(consequence);
  assert.equal(planned[0]!.documentary!.motionGraphic,undefined,'the source carries the setup');
  assert.equal(planned[1]!.documentary!.motionGraphic?.preset,'stat-split','the numerical consequence retains emphasis');
});

test('photo treatment follows semantic beats and source geometry, with no decorative carousel',()=>{
  const p=project(Array.from({length:14},()=> 'An ordinary photograph of the workshop.'));
  const plan=()=>{const planner=createDocumentaryMotionPresetPlanner(p);return p.scenes.map(s=>planner.photoTemplate(s));};
  assert.deepEqual(plan(),Array(14).fill('full'),'duration alone does not prescribe a push-in');
  const beats=['establish','conflict','evidence','explain','turn','resolve'] as const;
  beats.forEach((beat,i)=>{p.scenes[i]!.documentary!.semanticMontage={sceneId:p.scenes[i]!.id,subject:'workshop',beat,treatment:'footage',cutawaySceneIds:[]};});
  assert.deepEqual(plan().slice(0,6),['pull','push','full','full','push','pull']);assert.deepEqual(plan(),plan());
  for(const direction of ['in','out','off'] as const){
    const explicit={...p.scenes[0]!,kenBurnsDirection:direction,documentary:{...p.scenes[0]!.documentary!,template:'contain' as const}};
    assert.equal(createDocumentaryMotionPresetPlanner(p).photoTemplate(explicit),'contain','explicit photo controls retain the selected layout');
  }
  p.scenes[0]!.documentary!.selected!.width=5000;p.scenes[0]!.documentary!.selected!.height=1000;
  p.scenes[1]!.documentary!.selected!.width=800;p.scenes[1]!.documentary!.selected!.height=1200;
  p.scenes[2]!.narration='An archival photograph from the factory.';
  assert.deepEqual(plan().slice(0,3),['contain','contain','archive-dark']);
  p.settings.assembly.documentary!.excludedTemplates=['push','pull','detail-scan','contain','archive-dark'];
  assert.deepEqual(plan(),Array(14).fill('full'));
  p.scenes[0]!.videoPath='moving.mp4';assert.equal(createDocumentaryMotionPresetPlanner(p).photoTemplate(p.scenes[0]!),undefined);
});

test('actual saved automatic plan is recalculated on normal assembly without changing source files',async t=>{
  const path=process.env.GWS_MOTION_PRESET_PROJECT;if(!path)return t.skip('Set GWS_MOTION_PRESET_PROJECT for the read-only actual-project preview.');
  const source=await readFile(path,'utf8'),original=JSON.parse(source.replace(/^\uFEFF/u,'')) as Project,p=structuredClone(original),planned=enrichSemanticMontage(p);
  const distribution:Record<string,number>={};let cursor=0;
  const rows=planned.filter(s=>s.includeInAssembly!==false).map((s,index)=>{
    const g=s.documentary?.motionGraphic,saved=original.scenes.find(old=>old.id===s.id)?.documentary?.motionGraphic,seconds=montageFrames(s)/30;
    const row={scene:index+1,id:s.id,frames:montageFrames(s),timelineStart:cursor,narration:s.narration,
      kind:g?.enabled?g.kind:'footage',preset:g?.preset,title:g?.title,value:g?.value,cards:g?.cards,items:g?.items,
      boardLayout:g?.boardLayout,start:g?.startSeconds,hold:g?.durationSeconds,
      sourceBefore:g?.startSeconds??seconds,sourceAfter:g?Math.max(0,seconds-g.startSeconds-g.durationSeconds):0,
      template:s.documentary?.template,quoteMode:g?.quoteMode,savedPreset:saved?.preset,savedStart:saved?.startSeconds,savedHold:saved?.durationSeconds};
    cursor+=seconds;return row;
  });
  for(const row of rows)if(row.preset)distribution[row.preset]=(distribution[row.preset]??0)+1;
  const holds=(scenes:Project['scenes'])=>scenes.filter(s=>s.includeInAssembly!==false&&s.documentary?.motionGraphic?.enabled).reduce((sum,s)=>sum+s.documentary!.motionGraphic!.durationSeconds,0);
  const total=cursor,presetRows=rows.filter(r=>r.preset);
  const immutable=(scenes:Project['scenes'])=>scenes.map(s=>[s.narration,s.audioPath,s.imagePath,s.videoPath,s.durationSeconds,s.documentary?.timing]);
  assert.deepEqual(immutable(planned),immutable(original.scenes));
  assert.ok(planned.every(s=>!s.documentary?.motionGraphic?.preset||documentaryMotionPresetFor(s.documentary.motionGraphic)));
  assert.ok(rows.every(r=>!r.preset||r.template==='full'));
  assert.ok(rows.every(r=>!r.preset||(r.hold??0)<=5.5));
  assert.ok(holds(planned)<holds(original.scenes)*.8,'saved full-scene automatic holds are recalculated');
  assert.ok(rows.some(r=>(r.sourceAfter??0)>2),'source continues after short thoughts');
  const ratio=rows.find(r=>r.value?.includes('3 of 8'));assert.equal(ratio?.preset,'stat-split',JSON.stringify(rows.slice(26,30)));assert.equal(ratio?.value,'Only 3 of 8');
  const windows=(scenes:Project['scenes'])=>scenes.map(s=>s.documentary?.motionGraphic);
  assert.deepEqual(windows(planDocumentaryMontage(structuredClone(original))),windows(planned),'normal assembly enters the new planner');
  assert.equal(JSON.stringify(enrichSemanticMontage({...p,scenes:planned})),JSON.stringify(planned));
  assert.equal(await readFile(path,'utf8'),source);assert.deepEqual(p,original);
  const preview={projectSha256:createHash('sha256').update(source).digest('hex'),sourceUnchanged:true,paidCalls:0,rendered:false,
    timingBasis:'editorial estimates from literal narration, not measured word alignment',scenes:rows.length,totalSeconds:total,
    savedGraphicSeconds:holds(original.scenes),plannedGraphicSeconds:holds(planned),unadornedSourceSeconds:total-holds(planned),
    presetScenes:presetRows.length,distribution,rows};
  const output=process.env.GWS_MOTION_PRESET_OUTPUT;
  if(output){assert.notEqual(resolve(output).toLocaleLowerCase(),resolve(path).toLocaleLowerCase());await writeFile(output,JSON.stringify(preview,null,2),'utf8');}
  console.log(JSON.stringify({actualMotionPreview:{...preview,rows:undefined}}));
});
