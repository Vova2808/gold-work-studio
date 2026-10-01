import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {documentaryAccent,matchDocumentaryReading,type Project,type Scene,type DocumentaryMotionGraphic,type DocumentaryTemplate} from '@gold-work/shared';
import {LocalProjectStorage} from '../src/local-project-storage.js';
import {StandardRenderer,runFfmpeg,mediaDurationSeconds} from '../src/standard-renderer.js';
import {RemotionMontageRenderer} from '../src/remotion-montage-renderer.js';
import {probeEffectMedia} from '../src/effect-media.js';
import {EffectLibrary} from '../src/effect-library.js';
import {planDocumentaryEffects} from '../src/documentary-effects.js';
import {planDocumentaryMontage} from '../src/documentary-montage.js';
import {localSpeechWords} from '../src/local-speech-recognition.js';

const registry='C:/Users/rosup/AppData/Roaming/@gold-work/desktop/projects.json',raw=await readFile(registry,'utf8');
const source=(JSON.parse(raw) as Project[]).find(p=>p.id==='project_mukba0q1_0cubga6')!;
const root=resolve('captures/vidrush-refinement-20260928/visual');await mkdir(root,{recursive:true});
const hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
const voices=await Promise.all(source.scenes.map(async s=>s.audioPath?{path:s.audioPath,sha:await hash(s.audioPath)}:undefined));
const storage=new LocalProjectStorage(join(root,'projects'));
const project=structuredClone(source);project.id='local-refinement-check';project.outputPath=undefined;project.scenes=[];
project.settings.voice.enabled=true;project.settings.assembly.quality='final';
project.settings.assembly.documentary={...project.settings.assembly.documentary!,autoEffects:false,autoTransitions:false,autoMotionGraphics:true,captionsEnabled:false};
const silent=join(root,'silence.wav');await runFfmpeg(['-y','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','6','-c:a','pcm_s16le',silent]);
const hero='C:/Users/rosup/AppData/Local/Temp/codex-clipboard-8ec5c4ba-6c56-4304-a966-cc7e0b0f04ef.png';
const crank=source.scenes.find(s=>s.order===27)!.imagePath!,engine=source.scenes.find(s=>s.order===12)!.imagePath!;
async function add(name:string,seconds:number,image:string|undefined,template:DocumentaryTemplate,graphic?:Partial<DocumentaryMotionGraphic>):Promise<Scene>{
  const scene=structuredClone(source.scenes[1]!),order=project.scenes.length;
  scene.id=`refinement-${order}`;scene.order=order;scene.title=name;scene.narration='';scene.audioPath=silent;scene.sourceVolume=0;scene.durationSeconds=seconds;scene.durationOverrideSeconds=undefined;scene.narrationSlice=undefined;
  scene.trimStartSeconds=0;scene.trimEndSeconds=seconds;scene.transition='none';scene.autoTransition=undefined;
  if(image){scene.imagePath=image;scene.videoPath=undefined;}
  const media=await probeEffectMedia(image??scene.videoPath!);
  scene.documentary={...scene.documentary!,template,layout:'full',verified:true,pinned:false,cuts:undefined,texts:undefined,effects:[],comparison:undefined,
    selected:{...scene.documentary!.selected!,kind:image?'image':'video',width:media.width,height:media.height,durationSeconds:media.durationSeconds},
    caption:{...scene.documentary!.caption,enabled:false},timing:{sourceKey:'local-fixture',audioPath:silent,durationInFrames:Math.round(seconds*30),speechSeconds:seconds},
    motionGraphic:graphic?{enabled:true,title:'',kind:'subject-card',origin:'manual',startSeconds:0,durationSeconds:seconds,...graphic}:undefined};
  project.scenes.push(scene);return scene;
}
const first=await add('Автоматическое представление по проверенному имени',3.5,hero,'full');
first.narration='Masao Furusawa';first.documentary!.template=undefined;first.documentary!.requirement={...first.documentary!.requirement,motionGraphic:undefined,text:first.narration,sectionTitle:undefined,identities:[{name:first.narration,aliases:[]}]};
project.videoBrief={...project.videoBrief!,readyScript:first.narration};
project.scenes=planDocumentaryMontage(project);assert.equal(project.scenes[0]!.documentary!.motionGraphic!.kind,'subject-card');
await add('Постер',3.5,hero,'full',{kind:'subject-card',title:'Masao Furusawa',variant:'poster',isolateSubject:true,accentColor:documentaryAccent('История')});
await add('Предметные выноски',5,crank,'full',{kind:'annotations',variant:'technical',isolateSubject:true,accentColor:documentaryAccent('Двигатель'),annotations:[{label:'Шейка вала',points:[{seconds:0,x:49,y:50}]},{label:'Противовес',points:[{seconds:0,x:54,y:30}]},{label:'Фланец',points:[{seconds:0,x:87,y:49}]}]});
const voiceScene=source.scenes[0]!,duration=Math.ceil((await mediaDurationSeconds(voiceScene.audioPath!))*30)/30;
const quote=await add('Выделение вслед за сохранённой озвучкой',duration,undefined,'full',{kind:'quote',title:voiceScene.narration.trim(),quoteMode:'speech'});
quote.audioPath=voiceScene.audioPath;quote.narration=voiceScene.narration;quote.documentary!.timing={sourceKey:'original-voice',audioPath:voiceScene.audioPath,speechSeconds:duration,durationInFrames:Math.round(duration*30)};
const other=await add('Материал второй стороны',3.5,crank,'full');other.includeInAssembly=false;
for(const template of ['compare-grid','compare-dossier','compare-diagonal'] as const){const scene=await add(template,3.5,engine,template);scene.documentary!.layout='compare';scene.documentary!.comparison={sceneId:other.id,leftLabel:'Двигатель',rightLabel:'Коленчатый вал'};}
await add('CRT на фотографии',3.5,engine,'broadcast-crt');
await storage.ensureProject(project);project.scenes=await planDocumentaryEffects(project,new EffectLibrary('D:/GoldWorkStorage/Library'),storage);
await writeFile(join(root,'fixture.json'),JSON.stringify(project,null,2));
const renderer=new StandardRenderer(storage,new RemotionMontageRenderer(id=>storage.projectDirectory(id))),started=Date.now();let last='';
const output=await renderer.render(project,stage=>{const key=stage.replace(/\d+/g,'#');if(key!==last){last=key;console.log(stage);}});
const renderSeconds=(Date.now()-started)/1000;
await runFfmpeg(['-v','error','-i',output,'-f','null','-']);
const exportedVoice=join(root,'exported-reading.wav');
await runFfmpeg(['-y','-ss','12','-i',output,'-t',String(duration),'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',exportedVoice]);
const exportedWords=await localSpeechWords(exportedVoice,join(root,'audio-check'),console.log);
const exportedReading=matchDocumentaryReading(quote.narration,exportedWords);
assert.ok(exportedReading,'The exported audio must still contain the complete original sentence');
let cursor=0;const frames=[];
for(const scene of project.scenes.filter(s=>s.includeInAssembly!==false)){
  for(const local of scene.documentary?.motionGraphic?.kind==='quote'?[.5,1.8,3.8,4]:[2]){const at=cursor+local,path=join(root,`frame-${scene.order}-${local}.jpg`);await runFfmpeg(['-y','-ss',String(at),'-i',output,'-frames:v','1','-q:v','2',path]);frames.push({name:scene.title,at,path});}
  cursor+=scene.durationSeconds;
}
assert.equal(await readFile(registry,'utf8'),raw);for(const voice of voices)if(voice)assert.equal(await hash(voice.path),voice.sha);
const timeline=JSON.parse(await readFile(join(storage.projectDirectory(project.id),'Documentary','timeline.json'),'utf8'));
const reading=timeline.scenes.find((s:any)=>s.documentary?.motionGraphic?.kind==='quote').documentary.motionGraphic.reading;assert.equal(reading.words.length,10);
const result={output,duration:await mediaDurationSeconds(output),renderSeconds,frames,words:reading.words,exportedReading,registryPreserved:true,voicesPreserved:voices.filter(Boolean).length,paidRequests:0,localTemplateFixture:true,liveSearch:false};
await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
