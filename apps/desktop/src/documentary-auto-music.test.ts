import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import type {DocumentaryMusicSection,MusicClip,Project} from '@gold-work/shared';
import {prepareDocumentaryMusic,prepareDocumentaryMusicSections,type PreparedDocumentaryMusic} from './documentary-auto-music.js';
import {importDocumentaryMusic} from './documentary-music-import.js';
import {stockMusicPolicyPatch} from '../../renderer/src/stock-workflow-settings.js';
import {createDocumentarySettings} from '@gold-work/shared';

const project=()=>({language:'es',settings:{music:{enabled:false,volume:0,ducking:false,fadeInSeconds:0,fadeOutSeconds:0}},scenes:Array.from({length:12},(_,order)=>({id:`s${order}`,order,durationSeconds:5,narration:`Texto ${order}`,audioPath:`voice-${order}.wav`}))} as Project);
const ready=(mood:string):PreparedDocumentaryMusic=>({status:'ready',message:'fixture',music:{path:`${mood}.wav`,name:mood,assetId:mood,sourceDurationSeconds:32,volume:10,enabled:true,ducking:true,fadeInSeconds:1,fadeOutSeconds:2}});
const cue=(start:number,end:number,mood:DocumentaryMusicSection['mood'],role:DocumentaryMusicSection['role']='narration'):DocumentaryMusicSection=>({startSceneId:`s${start}`,endSceneId:`s${end}`,mood,role});
const input={directory:'unused',projectDirectory:'unused'};

test('narrative sections create timed clips, explicit silence is a gap, missing music is a marker',async()=>{
  const p=project(),before=JSON.stringify(p),calls:string[]=[];
  const result=await prepareDocumentaryMusicSections(p,[cue(0,2,'energetic','hook'),cue(3,3,'silence','turn'),cue(4,7,'calm'),cue(8,11,'reflective','resolution')],input,
    async options=>{calls.push(options.mood!);return options.mood==='reflective'?{status:'unavailable',message:'Нет подходящего трека'}:ready(options.mood!);});
  assert.deepEqual(calls,['energetic','calm','reflective']);
  assert.deepEqual(result.clips!.map(c=>[c.startSeconds,c.durationSeconds,c.status]),[[0,15,'ready'],[20,20,'ready'],[40,20,'missing']]);
  assert.equal(result.clips![2]!.path,undefined);assert.equal(result.clips![2]!.message,'Нет подходящего трека');
  assert.equal(result.enabled,false);assert.equal(result.volume,0);assert.equal(result.ducking,false);assert.equal(result.fadeInSeconds,0);
  assert.equal(JSON.stringify(p),before);
});

test('an empty semantic plan is silence; an unavailable plan gets grouped fallback cues',async()=>{
  const never=async()=>{throw new Error('No selection should be made');};
  const silent=await prepareDocumentaryMusicSections(project(),[cue(0,11,'silence')],input,never);
  assert.deepEqual(silent.clips,[]);assert.equal(silent.selectionStatus,'off');
  const empty=await prepareDocumentaryMusicSections(project(),[],input,never);
  assert.deepEqual(empty.clips,[]);assert.equal(empty.selectionStatus,'off');
  const moods:string[]=[],oldPlan=project();
  oldPlan.scenes[0]!.narration='Peligro: riesgo y conflicto';oldPlan.scenes[6]!.narration='Discover a new unknown world';
  oldPlan.scenes[6]!.documentary={...oldPlan.scenes[6]!.documentary,semanticMontage:{sceneId:'s6',subject:'turn',beat:'turn',treatment:'footage',cutawaySceneIds:[]}} as never;
  const unknown=await prepareDocumentaryMusicSections(oldPlan,undefined,input,async options=>{moods.push(options.mood!);return {status:'unavailable',message:'Трек не найден'};});
  const missing=unknown.clips!.filter(clip=>clip.status==='missing');
  assert.ok(missing.length>1,'fallback should create block-sized separate requests');
  assert.ok(missing.every(clip=>clip.message==='Трек не найден'));
  assert.ok(missing.every(clip=>clip.durationSeconds<=35));
  assert.ok(moods.includes('tension')&&moods.includes('discovery'));
});

test('fallback holds music across phrases, turns at dramatic beats and reads Russian/English emotional words',async()=>{
  const p=project();
  p.scenes[0]!.narration='Danger arrived, but the first reports did not show it.';
  p.scenes[6]!.documentary={...p.scenes[6]!.documentary,semanticMontage:{sceneId:'s6',subject:'turn',beat:'turn',treatment:'footage',cutawaySceneIds:[]}} as never;
  p.scenes[6]!.narration='However, the story changed.';
  p.scenes[11]!.narration='He died after the race; it was a tragic ending.';
  const result=await prepareDocumentaryMusicSections(p,undefined,input,async options=>ready(options.mood!));
  assert.deepEqual(result.clips!.map(clip=>[clip.startSeconds,clip.durationSeconds,clip.name]),[
    [0,28.75,'tension'],[30,28.75,'reflective']
  ]);

  const russian=project();russian.scenes[0]!.narration='Сильная угроза возникла в начале.';
  const ru=await prepareDocumentaryMusicSections(russian,undefined,input,async options=>ready(options.mood!));
  assert.equal(ru.clips?.[0]?.name,'tension','Cyrillic stem matching identifies tension');
});

test('first, new, left and diesel do not force discovery or reflective mood',async()=>{
  const p=project();p.scenes[11]!.narration='He left first, then a new chapter began with a diesel engine.';
  const result=await prepareDocumentaryMusicSections(p,undefined,input,async options=>ready(options.mood!));
  assert.ok(result.clips!.every(clip=>clip.name==='calm'));
});

test('fallback carries automatic chapter cards and reads explicit Chapter headings',async()=>{
  const p=project();
  p.scenes[0]!.documentary={...p.scenes[0]!.documentary,motionGraphic:{kind:'chapter-number',enabled:true,title:'Alpha',origin:'automatic'}} as never;
  p.scenes[6]!.narration='Chapter 2: Beta\nThe next section begins.';
  const result=await prepareDocumentaryMusicSections(p,undefined,input,async options=>ready(options.mood!));
  assert.deepEqual(result.clips!.map(clip=>clip.startSeconds),[0,30]);
});

test('full manual arrangement, split clips, volumes, mute and deleted gaps survive automatic replanning',async()=>{
  const p=project();p.settings.music={...p.settings.music,manualEdits:true,clips:[{id:'left',path:'manual.wav',startSeconds:3,durationSeconds:7,sourceOffsetSeconds:5,volume:31,enabled:false,origin:'manual',status:'ready'},
    {id:'right',path:'manual.wav',startSeconds:15,durationSeconds:4,sourceOffsetSeconds:12,volume:0,enabled:true,origin:'manual',status:'ready'}]};
  const result=await prepareDocumentaryMusicSections(p,[cue(0,11,'tension')],input,async()=>{throw Error('manual must not retrieve');});
  assert.equal(result,p.settings.music);
  p.settings.music={...p.settings.music,manualEdits:undefined,clips:[]};
  assert.equal(await prepareDocumentaryMusicSections(p,[cue(0,11,'calm')],input,async()=>{throw Error('deleted track must not repopulate');}),p.settings.music);
});

test('individual authored clip is retained and reserves its range; same mood is selected once',async()=>{
  const p=project(),manual:MusicClip={id:'manual',path:'mine.wav',startSeconds:4,durationSeconds:8,sourceOffsetSeconds:7,volume:29,enabled:false,origin:'manual',status:'ready'};
  p.settings.music.clips=[manual];let calls=0;
  const result=await prepareDocumentaryMusicSections(p,[cue(0,5,'calm'),cue(6,11,'calm')],input,async()=>{calls++;return ready('calm');});
  assert.equal(calls,1);assert.equal(result.clips?.find(c=>c.id==='manual'),manual);
  const automatic=result.clips!.filter(c=>c.origin==='automatic');
  assert.deepEqual(automatic.map(c=>[c.startSeconds,c.durationSeconds,c.sourceOffsetSeconds]),[[0,4,0],[12,18,12],[30,30,0]]);
});

test('explicit automatic choice releases manual clips and empty track while ordinary assembly preserves both',async()=>{
  for(const clips of [[{id:'manual',path:'old.wav',startSeconds:3,durationSeconds:7,sourceOffsetSeconds:5,volume:31,enabled:false,origin:'manual',status:'ready'} as MusicClip],[]]){
    const p=project();p.settings.assembly={...p.settings.assembly,documentary:createDocumentarySettings()};
    p.settings.music={...p.settings.music,path:'old.wav',name:'Old track',assetId:'old',sourcePage:'old-source',manualEdits:true,clips};
    const before=JSON.stringify(p),sections=[cue(0,11,'tension')];let retrievals=0;
    const retrieve=async()=>{retrievals++;return ready('tension');};
    assert.equal(await prepareDocumentaryMusicSections(p,sections,input,retrieve),p.settings.music);assert.equal(retrievals,0);
    const automatic={...p,settings:{...p.settings,...JSON.parse(JSON.stringify(stockMusicPolicyPatch(p.settings,'automatic')))}};
    const result=await prepareDocumentaryMusicSections(automatic,sections,input,retrieve);
    assert.equal(retrievals,1);assert.equal(result.enabled,true);assert.equal(result.volume,0);assert.equal(result.ducking,false);
    assert.deepEqual(result.clips?.map(c=>[c.path,c.origin,c.startSeconds,c.durationSeconds]),[['tension.wav','automatic',0,60]]);
    assert.equal(result.manualEdits,undefined);assert.equal(JSON.stringify(p),before,'Explicit choice must not mutate the saved project in place');
  }
});

async function fixture(t:{after(fn:()=>Promise<void>):void}){
  const root=await mkdtemp(join(tmpdir(),'gws-auto-cues-'));
  t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'gws-auto-cues-'));await rm(root,{recursive:true,force:true});});
  const samples=32*8000,wav=Buffer.alloc(44+samples*2);
  wav.write('RIFF');wav.writeUInt32LE(36+samples*2,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  const path=join(root,'calm.wav');await writeFile(path,wav);
  const directory=join(root,'library');await importDocumentaryMusic(path,directory,{name:'Calm soft instrumental',tags:['calm','relaxed','ambient']});
  return {directory,projectDirectory:join(root,'project'),mode:'auto' as const};
}

test('exact suitable local import is copied to the project with zero network requests',async t=>{
  const paths=await fixture(t);
  const selected=await prepareDocumentaryMusic({...paths,mood:'calm'},{fetch:async()=>{throw new Error('Network must not be reached');}});
  assert.equal(selected.status,'ready');assert.equal(selected.diagnostics?.reason,'cache');assert.equal(selected.diagnostics?.searches,0);
  assert.equal(selected.music?.sourceDurationSeconds,32);
  const again=await prepareDocumentaryMusic({...paths,mood:'calm'},{fetch:async()=>{throw new Error('Network must not be reached');}});
  assert.equal(again.diagnostics?.cached,'project');assert.equal(again.music?.assetId,selected.music?.assetId);
});

test('calm cached music never silently fills an incompatible dramatic or discovery cue',async t=>{
  const paths=await fixture(t);let requests=0;
  for(const mood of ['tension','energetic','reflective','discovery'] as const){
    const selected=await prepareDocumentaryMusic({...paths,mood},{fetch:async()=>{requests++;return Response.json({query:{pages:[]}});}});
    assert.equal(selected.status,'unavailable');assert.equal(selected.music,undefined);
  }
  assert.equal(requests,8);
});
