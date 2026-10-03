import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import type {Project,Scene,DocumentaryMotionGraphic,DocumentaryTemplate} from '@gold-work/shared';
import {LocalProjectStorage} from '../src/local-project-storage.js';
import {StandardRenderer,runFfmpeg,mediaDurationSeconds} from '../src/standard-renderer.js';
import {RemotionMontageRenderer} from '../src/remotion-montage-renderer.js';
import {probeEffectMedia} from '../src/effect-media.js';
import {EffectLibrary} from '../src/effect-library.js';
import {planDocumentaryEffects} from '../src/documentary-effects.js';

const registry='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json',raw=await readFile(registry,'utf8');
const source=(JSON.parse(raw) as Project[]).find(p=>p.id==='project_mukba0q1_0cubga6')!;
const root=resolve('captures/vidrush-reference-20260928/editorial-check');await mkdir(root,{recursive:true});
const hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
const voices=await Promise.all(source.scenes.map(async s=>s.audioPath?{path:s.audioPath,sha:await hash(s.audioPath)}:undefined));
const storage=new LocalProjectStorage(join(root,'projects'));
const project=structuredClone(source);project.id='local-editorial-templates-check';project.outputPath=undefined;project.scenes=[];
project.settings.voice.enabled=false;project.settings.assembly.quality='final';
project.settings.assembly.documentary={...project.settings.assembly.documentary!,autoEffects:false,autoTransitions:false,autoMotionGraphics:true,captionsEnabled:false,accentColor:'#ff1648'};
const hero='C:/Users/rosup/AppData/Local/Temp/codex-clipboard-8ec5c4ba-6c56-4304-a966-cc7e0b0f04ef.png';
const crank=source.scenes.find(s=>s.order===27)!.imagePath!;
const base=source.scenes.find(s=>s.order===1)!;
async function add(name:string,seconds:number,image:string|undefined,template:DocumentaryTemplate,graphic?:Partial<DocumentaryMotionGraphic>){
  const scene=structuredClone(base),order=project.scenes.length;
  scene.id=`editorial-${order}`;scene.order=order;scene.title=name;scene.narration='';scene.audioPath=undefined;scene.sourceVolume=0;scene.durationSeconds=seconds;scene.durationOverrideSeconds=undefined;
  scene.trimStartSeconds=0;scene.trimEndSeconds=seconds;scene.transition='none';scene.autoTransition=undefined;
  if(image){scene.imagePath=image;scene.videoPath=undefined;}
  const media=await probeEffectMedia(image??scene.videoPath!);
  scene.documentary={...scene.documentary!,template,layout:'full',verified:true,pinned:false,cuts:undefined,texts:undefined,effects:[],comparison:undefined,
    selected:{...scene.documentary!.selected!,kind:image?'image':'video',width:media.width,height:media.height,durationSeconds:media.durationSeconds},
    caption:{...scene.documentary!.caption,enabled:false},timing:{sourceKey:'local-visual-fixture',durationInFrames:seconds*30,speechSeconds:0},
    motionGraphic:graphic?{enabled:true,title:'',kind:'subject-card',origin:'manual',startSeconds:0,durationSeconds:seconds,...graphic}:undefined};
  project.scenes.push(scene);
}
await add('Представление героя',4,hero,'full',{kind:'subject-card',title:'Masao Furusawa',kicker:'YAMAHA RACING LEAD',background:'spotlight',isolateSubject:true});
await add('Бумажный коллаж',4,hero,'full',{kind:'subject-card',title:'Masao Furusawa',kicker:'YAMAHA RACING LEAD',background:'grid-dark',variant:'collage',isolateSubject:true});
await add('Выноска на объекте',4,crank,'full',{kind:'annotations',variant:'technical',isolateSubject:true,annotations:[{label:'Коленчатый вал',points:[{seconds:0,x:49,y:50}]}]});
await add('Цитата с выделением',6,undefined,'full',{kind:'quote',title:'Suddenly, I was in charge of a problem nobody had solved: Yamaha had gone more than 10 years without a premier-class title.',highlight:'nobody had solved',variant:'marker'});
await add('Сравнение мощности',4,undefined,'full',{kind:'bar-chart',title:'Сравнение мощности',background:'grid-dark',cards:[{label:'Yamaha',value:'226.7 hp'},{label:'Honda',value:'238.6 hp'}]});
for(const template of ['paper-grid','dark-grid','diagonal-card','contour-card','broadcast-crt'] as const)await add(template,4,undefined,template);
// This is an explicit local template fixture from supplied references, not a
// new production project, automatic source-selection proof or speed benchmark.
await storage.ensureProject(project);
project.scenes=await planDocumentaryEffects(project,new EffectLibrary('D:/GoldWorkStorage/Library'),storage);
await writeFile(join(root,'fixture.json'),JSON.stringify(project,null,2));
const renderer=new StandardRenderer(storage,new RemotionMontageRenderer(id=>storage.projectDirectory(id))),started=Date.now();let last='';
const output=await renderer.render(project,stage=>{const key=stage.replace(/\d+/g,'#');if(key!==last){last=key;console.log(stage);}});
const renderSeconds=(Date.now()-started)/1000;
await runFfmpeg(['-v','error','-i',output,'-f','null','-']);
let cursor=0;const frames=[];
for(const scene of project.scenes){const at=cursor+Math.min(2.5,scene.durationSeconds/2),path=join(root,`frame-${scene.order}.jpg`);await runFfmpeg(['-y','-ss',String(at),'-i',output,'-frames:v','1','-q:v','2',path]);frames.push({name:scene.title,at,path});cursor+=scene.durationSeconds;}
assert.equal(await readFile(registry,'utf8'),raw);
for(const voice of voices)if(voice)assert.equal(await hash(voice.path),voice.sha,'Paid voice changed');
const report={output,duration:await mediaDurationSeconds(output),renderSeconds,frames,registryPreserved:true,voicesPreserved:voices.filter(Boolean).length,paidRequests:0,manualTemplateFixture:true,liveAutomaticSelection:false};
await writeFile(join(root,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
