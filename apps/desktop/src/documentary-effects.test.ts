import test from 'node:test';
import assert from 'node:assert/strict';
import type {DocumentaryEffect,EffectAsset,Project} from '@gold-work/shared';
import {documentaryAutomaticSoundVolume,documentaryShortClick,planDocumentaryEffects} from './documentary-effects.js';
import {effectFfmpeg} from './effect-media.js';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {EffectLibrary} from './effect-library.js';
import type {LocalProjectStorage} from './local-project-storage.js';
import {renderDocumentaryAudio} from './documentary-fast-render.js';
import type {DocumentaryTimeline} from '@gold-work/remotion-video';

test('Stock uses full imported whoosh across the cut and preserves existing edits; final mix contains the tail',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-stock-whoosh-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await effectFfmpeg(['-y','-f','lavfi','-i','sine=frequency=1100:duration=3','-c:a','pcm_s16le',join(root,'whoosh.wav')]);
  const asset={id:'whoosh',version:1,name:'Imported whoosh',file:'whoosh.wav',kind:'audio',category:'transition',state:'ready',automatic:true,review:'approved',rights:'user-confirmed',
    defaults:{volume:65,trimStartSeconds:0,fadeInSeconds:0,fadeOutSeconds:0},metadata:{durationSeconds:3,peakDb:-18,accentSeconds:1}} as EffectAsset;
  const library={rootPath:root,snapshot:async()=>({assets:[asset]})} as unknown as EffectLibrary;
  const storage={projectDirectory:()=>join(root,'project')} as unknown as LocalProjectStorage;
  const p={id:'stock-whoosh',mediaMode:'stock',settings:{voice:{enabled:false},assembly:{documentary:{autoEffects:true,autoTransitions:true,montageDensity:'rich',autoMotionGraphics:false}}},
    scenes:[8,1,6].map((durationSeconds,order)=>({id:String(order),order,durationSeconds,autoTransition:order===0?'mix':'none',documentary:{effects:[],caption:{enabled:false,text:''},requirement:{accent:'none'}}}))} as unknown as Project;
  const manual={id:'manual',assetId:'visual',kind:'image',role:'overlay',enabled:false} as DocumentaryEffect;
  p.scenes[1]!.documentary!.effects=[manual];
  const scenes=await planDocumentaryEffects(p,library,storage),effect=scenes[1]!.documentary!.effects[1]!;
  assert.equal(scenes[0]!.documentary!.effects.length,0);
  assert.equal(scenes[1]!.documentary!.effects[0],manual);
  assert.equal(effect.assetId,'whoosh');assert.equal(effect.startSeconds,-1);assert.equal(effect.durationSeconds,3);
  assert.deepEqual(await planDocumentaryEffects({...p,scenes},library,storage),scenes);
  assert.deepEqual(await planDocumentaryEffects({...p,settings:{...p.settings,assembly:{...p.settings.assembly,documentary:{...p.settings.assembly.documentary!,autoEffects:false}}}},library,storage),p.scenes);
  let fromFrame=0;
  const timeline={fps:30,durationInFrames:450,sfxVolume:100,scenes:scenes.map(s=>{const row={...s,fromFrame,durationInFrames:s.durationSeconds*30,narrationEnabled:false};fromFrame+=row.durationInFrames;return row;})} as unknown as DocumentaryTimeline;
  const audio=await renderDocumentaryAudio(timeline,root);assert.ok(audio);
  const tail=await effectFfmpeg(['-ss','9.2','-t','0.3','-i',audio,'-af','volumedetect','-f','null','-']);
  const db=Number(/mean_volume:\s*(-?[\d.]+) dB/.exec(tail)?.[1]);
  assert.ok(Number.isFinite(db)&&db>-40,`SFX tail after the one-second shot must be audible: ${db} dBFS`);
  const riser={...asset,id:'riser',category:'riser',metadata:{...asset.metadata!,accentSeconds:undefined},defaults:{...asset.defaults,trimStartSeconds:1.7,trimEndSeconds:2.4}} as EffectAsset;
  const withRiser=await planDocumentaryEffects(p,{...library,snapshot:async()=>({assets:[riser]})} as unknown as EffectLibrary,storage);
  const rising=withRiser[1]!.documentary!.effects[1]!;
  assert.equal(rising.assetId,'riser');assert.ok(Math.abs(rising.startSeconds+.55)<1e-8);assert.ok(Math.abs(rising.durationSeconds-.7)<1e-8);
});
test('automatic SFX attenuation uses measured peaks without boosting quiet assets or rewriting defaults',()=>{
  const loud={defaults:{volume:65},metadata:{peakDb:-1}} as EffectAsset;
  const level=documentaryAutomaticSoundVolume(loud,true);
  assert.ok(level<45);
  assert.ok(Math.abs(-1+20*Math.log10(level/100)-(-8))<.001);
  assert.equal(loud.defaults.volume,65);
  assert.equal(documentaryAutomaticSoundVolume({...loud,metadata:{...loud.metadata!,peakDb:-30}},true),65);
  assert.equal(documentaryAutomaticSoundVolume({...loud,metadata:undefined},true),35);
});
test('panel switching stays silent; an explicitly chosen short click retains its whole audible tail',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-panel-click-'));
  await effectFfmpeg(['-y','-f','lavfi','-i','sine=frequency=900:duration=0.18','-af','apad=whole_dur=3','-c:a','pcm_s16le',join(root,'click.wav')]);
  const asset={id:'click',version:1,name:'Click',file:'click.wav',kind:'audio',category:'click',state:'ready',automatic:true,review:'approved',rights:'user-confirmed',defaults:{volume:65,trimStartSeconds:0,fadeInSeconds:0,fadeOutSeconds:0},metadata:{durationSeconds:3,peakDb:-18}} as EffectAsset;
  const short=await documentaryShortClick(asset,root);assert.ok(short.defaults.trimEndSeconds!>.18&&short.defaults.trimEndSeconds!<.4);assert.equal(asset.defaults.trimEndSeconds,undefined);
  const library={rootPath:root,snapshot:async()=>({assets:[asset]})} as unknown as EffectLibrary;
  const p={id:'panels',settings:{voice:{enabled:true},assembly:{documentary:{autoEffects:true}}},scenes:Array.from({length:3},(_,order)=>({id:String(order),order,durationSeconds:4,documentary:{effects:[],caption:{enabled:false},requirement:{accent:'none'},motionGraphic:{enabled:true,kind:'feature-list',presentation:'panels',sequenceId:'one-series',activeIndex:order,startSeconds:0,durationSeconds:4}}}))} as unknown as Project;
  const result=await planDocumentaryEffects(p,library,{projectDirectory:()=>join(root,'project')} as unknown as LocalProjectStorage);
  assert.ok(result.every(s=>s.documentary!.effects.length===0));
  assert.deepEqual(await planDocumentaryEffects({...p,scenes:result},library,{projectDirectory:()=>join(root,'project')} as unknown as LocalProjectStorage),result);
});

test('long-form sound design leaves arbitrary suggestions silent and accents only sparse meaningful graphics',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-sfx-cooldown-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'ding.wav'),'local copy fixture');
  const asset={id:'ding',version:1,name:'Ding',file:'ding.wav',kind:'audio',category:'ding',state:'ready',automatic:true,review:'approved',rights:'user-confirmed',
    defaults:{volume:65,trimStartSeconds:0,fadeInSeconds:0,fadeOutSeconds:0},metadata:{durationSeconds:3,peakDb:-1}} as EffectAsset;
  const library={rootPath:root,snapshot:async()=>({assets:[asset]})} as unknown as EffectLibrary;
  const storage={projectDirectory:()=>join(root,'project')} as unknown as LocalProjectStorage;
  const p={id:'sfx',settings:{voice:{enabled:true},assembly:{documentary:{autoEffects:true}}},scenes:Array.from({length:24},(_,order)=>({
    id:String(order),order,durationSeconds:10,documentary:{effects:[],requirement:{accent:'ding'},caption:{enabled:false,text:''},
      motionGraphic:order>=2?{enabled:true,kind:'statistic',title:'Fact',value:'26 metres',startSeconds:0,durationSeconds:10}:undefined}
  }))} as unknown as Project;
  const scenes=await planDocumentaryEffects(p,library,storage);
  assert.deepEqual(scenes.filter(s=>s.documentary!.effects.length).map(s=>s.order),[2,20]);
  assert.equal(scenes[20]!.documentary!.effects[0]!.durationSeconds,3);
  assert.deepEqual(await planDocumentaryEffects({...p,scenes},library,storage),scenes);
  const excluded={...p.scenes[0]!,id:'excluded',order:-1,includeInAssembly:false,
    documentary:{...p.scenes[0]!.documentary!,effects:scenes[2]!.documentary!.effects}};
  const withExcluded=await planDocumentaryEffects({...p,scenes:[excluded,...p.scenes]},library,storage);
  assert.deepEqual(withExcluded[0],excluded,'Excluded authored effects remain intact');
  assert.deepEqual(withExcluded.slice(1).filter(s=>s.documentary!.effects.length).map(s=>s.order),[2,20],
    'Excluded scenes must not consume the included sound budget');
  const short={...p,scenes:[{...p.scenes[2]!,durationSeconds:1}]};
  assert.equal((await planDocumentaryEffects(short,library,storage))[0]!.documentary!.effects.length,0);
});
