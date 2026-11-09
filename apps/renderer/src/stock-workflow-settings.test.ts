import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultProjectSettings,createDocumentarySettings,type EffectAsset,type Project} from '@gold-work/shared';
import {mergeProjectEditorDraft} from './project-editor-merge';
import {applyStockMontagePreset,createStockWorkflowSettings,patchStockMontage,selectedStockMontagePreset,selectedStockMusicPolicy,stockMontagePresets,stockMusicEditorAssembly,stockMusicEditorPatch,stockMusicPolicyPatch,stockVideoTarget} from './stock-workflow-settings';
import {selectableStockBackgrounds} from './stock-backgrounds';

function fixture():Project {
  const settings=createDefaultProjectSettings();
  settings.assembly.documentary=createDocumentarySettings();
  return {id:'stock-ui-test',title:'Saved',mediaMode:'stock',aspectRatio:'16:9',settings,
    scenes:[{id:'scene',narration:'Original text',audioPath:'saved-voice.wav',documentary:{template:'archive-dark',templateOrigin:'manual',pinned:true}}]} as unknown as Project;
}

test('voice and 0/20/100 video choices survive incoming updates and saved-project reopening',()=>{
  for(const percent of [0,20,100]) {
    const previous=fixture(),local=structuredClone(previous),incoming=structuredClone(previous);
    local.settings.voice.voice='saved-lumean-uuid';local.settings.voice.provider='elevenlabs';
    local.settings.stockVideoPercent=percent;
    incoming.settings.assembly.documentary!.accentColor='#abcdef';
    incoming.scenes[0]!.audioPath='completed-voice.wav';
    const merged=mergeProjectEditorDraft(local,previous,incoming);
    const reopened=JSON.parse(JSON.stringify(merged)) as Project;
    assert.equal(reopened.settings.voice.voice,'saved-lumean-uuid');
    assert.equal(reopened.settings.voice.provider,'elevenlabs');
    assert.equal(stockVideoTarget(reopened.settings.stockVideoPercent),percent);
    assert.equal(reopened.settings.assembly.documentary!.accentColor,'#abcdef');
    assert.equal(reopened.scenes[0]!.audioPath,'completed-voice.wav');
    assert.equal(reopened.scenes[0]!.narration,'Original text');
  }
});

test('montage choices serialize distinct engine policies and preserve sound, background and manual scenes',()=>{
  const project=fixture();
  project.settings.assembly.documentary!.autoEffects=false;
  project.settings.assembly.documentary!.sfxVolume=17;
  project.settings.assembly=patchStockMontage(project.settings.assembly,{background:{mode:'library',assetId:'background-123'},musicPolicy:'preserve',graphicsDensity:'sparse'});
  const original=structuredClone(project);
  const saved=stockMontagePresets.map(({id})=>{
    const assembly=applyStockMontagePreset(project.settings.assembly,id);
    const reopened=JSON.parse(JSON.stringify({...project,settings:{...project.settings,assembly}})) as Project;
    assert.equal(selectedStockMontagePreset(reopened.settings.assembly),id);
    assert.equal(reopened.settings.assembly.documentary!.autoMotionGraphics,true);
    assert.equal(reopened.settings.assembly.documentary!.autoTransitions,true);
    assert.equal(reopened.settings.assembly.kenBurnsDirection,'smart');
    assert.deepEqual(reopened.settings.assembly.documentary!.montage!.background,{mode:'library',assetId:'background-123'});
    assert.equal(reopened.settings.assembly.documentary!.montage!.musicPolicy,'preserve');
    assert.equal(reopened.settings.assembly.documentary!.montage!.graphicsDensity,'sparse');
    assert.equal(reopened.settings.assembly.documentary!.autoEffects,false);
    assert.equal(reopened.settings.assembly.documentary!.sfxVolume,17);
    assert.deepEqual(reopened.scenes,original.scenes);
    assert.deepEqual(reopened.settings.voice,original.settings.voice);
    assert.deepEqual(reopened.settings.music,original.settings.music);
    return reopened.settings.assembly;
  });
  assert.equal(new Set(saved.map(value=>JSON.stringify(value))).size,2);
  assert.equal(saved[0]!.documentary!.montage!.intensity,'rich');
  assert.equal(saved[1]!.documentary!.montage!.intensity,'calm');
  assert.deepEqual(project,original);
  saved[1]!.transitionType='fade';
  assert.equal(selectedStockMontagePreset(saved[1]!),undefined,'manual transition changes no longer display the original preset');
});

test('opening a saved custom montage does not rewrite its settings',()=>{
  const project=fixture();
  project.settings.assembly.transitionType='fade';
  project.settings.assembly.documentary!.excludedTemplates=['archive-dark'];
  delete project.settings.assembly.documentary!.montage;
  const saved=JSON.stringify(project);
  assert.equal(selectedStockMontagePreset(project.settings.assembly),undefined);
  assert.equal(selectedStockMusicPolicy(project.settings),'off');
  assert.equal(JSON.stringify(project),saved);
  assert.equal(stockVideoTarget(undefined),60);
  assert.equal(stockVideoTarget(0),0);
});

test('only newly created Stock settings opt into expressive montage and automatic music',()=>{
  const settings=createStockWorkflowSettings();
  const saved=JSON.parse(JSON.stringify(settings));
  assert.equal(selectedStockMontagePreset(saved.assembly),'expressive');
  assert.equal(selectedStockMusicPolicy(saved),'automatic');
  assert.deepEqual(saved.assembly.documentary.montage.background,{mode:'automatic'});
  assert.equal(saved.assembly.documentary.montage.hookSeconds,30);
  assert.equal(saved.assembly.documentary.montage.graphicsDensity,'sparse');
  const legacy=fixture();
  delete legacy.settings.assembly.documentary!.montage;
  legacy.settings.music={volume:8,path:'saved-music.wav',name:'Original music'};
  const before=JSON.stringify(legacy);
  assert.equal(selectedStockMusicPolicy(legacy.settings),'preserve');
  assert.equal(JSON.stringify(legacy),before);
});

test('background ID and music choice survive editor merges without discarding completed voice/media',()=>{
  const previous=fixture(),local=structuredClone(previous),incoming=structuredClone(previous);
  local.settings.assembly=patchStockMontage(applyStockMontagePreset(local.settings.assembly,'calm'),{background:{mode:'library',assetId:'bg-stable-id'}});
  Object.assign(local.settings,stockMusicPolicyPatch(local.settings,'off'));
  incoming.scenes[0]!.audioPath='completed-voice.wav';
  incoming.scenes[0]!.imagePath='completed-photo.jpg';
  incoming.settings.assembly.documentary!.accentColor='#ffaa00';
  const merged=mergeProjectEditorDraft(local,previous,incoming);
  const reopened=JSON.parse(JSON.stringify(merged)) as Project;
  assert.equal(reopened.settings.assembly.documentary!.montage!.background!.assetId,'bg-stable-id');
  assert.equal(selectedStockMontagePreset(reopened.settings.assembly),'calm');
  assert.equal(selectedStockMusicPolicy(reopened.settings),'off');
  assert.equal(reopened.settings.assembly.documentary!.accentColor,'#ffaa00');
  assert.equal(reopened.scenes[0]!.audioPath,'completed-voice.wav');
  assert.equal(reopened.scenes[0]!.imagePath,'completed-photo.jpg');
  assert.equal(reopened.scenes[0]!.documentary!.templateOrigin,'manual');
  assert.equal(reopened.scenes[0]!.documentary!.pinned,true);
});

test('only explicit automatic music discards the old track; other policies and unrelated settings stay intact',()=>{
  const original=fixture();
  original.settings={...original.settings,...createStockWorkflowSettings()};
  original.settings.music={volume:13,path:'personal-track.wav',name:'Personal',ducking:false};
  const before=structuredClone(original);
  for(const policy of ['automatic','off','preserve'] as const){
    const project=structuredClone(original);
    Object.assign(project.settings,stockMusicPolicyPatch(project.settings,policy));
    assert.equal(selectedStockMusicPolicy(project.settings),policy);
    assert.equal(project.settings.music.path,policy==='automatic'?undefined:'personal-track.wav');
    assert.equal(project.settings.music.volume,13);
    assert.equal(project.settings.music.ducking,false);
    assert.equal(selectedStockMontagePreset(project.settings.assembly),'expressive');
    assert.deepEqual(project.scenes,before.scenes);
    assert.deepEqual(project.settings.voice,before.settings.voice);
    assert.equal(project.settings.stockVideoPercent,before.settings.stockVideoPercent);
  }
  assert.deepEqual(original,before);
});

test('manual timeline music overrides automatic policy while volume-only changes retain it',()=>{
  const settings=createStockWorkflowSettings();
  settings.music.path='auto-track.wav';
  settings.music.assetId='old-auto-id';settings.music.selectionStatus='ready';settings.music.selectionMessage='Old selection';
  assert.equal(stockMusicEditorAssembly(settings,{...settings.music,volume:7}),settings.assembly);
  assert.equal(stockMusicEditorAssembly(settings,{...settings.music,path:'my-track.wav'}).documentary!.montage!.musicPolicy,'preserve');
  assert.equal(stockMusicEditorAssembly(settings,{...settings.music,enabled:false}).documentary!.montage!.musicPolicy,'off');
  const custom=stockMusicEditorPatch(settings,{...settings.music,path:'my-track.wav'});
  assert.equal(custom.music.assetId,undefined);
  assert.equal(custom.music.selectionStatus,undefined);
  assert.equal(custom.music.selectionMessage,undefined);
  assert.equal(custom.music.path,'my-track.wav');
  const ai=createDefaultProjectSettings();delete ai.assembly.documentary;
  assert.equal(stockMusicEditorAssembly(ai,{...ai.music,path:'ai-song.wav'}),ai.assembly);
});

test('background picker only offers ready visual background assets; stable ID does not depend on file path',()=>{
  const base={id:'chosen-bg',category:'background',kind:'video',state:'ready',file:'assets/one.mp4'} as EffectAsset;
  const items=[base,{...base,id:'sound',kind:'audio'},{...base,id:'effect',category:'transition'},{...base,id:'deleted',deletedAt:'now'},{...base,id:'error',state:'error'},{...base,id:'copying',state:'copied'}] as EffectAsset[];
  assert.deepEqual(selectableStockBackgrounds(items).map(item=>item.id),['chosen-bg']);
  assert.equal(selectableStockBackgrounds([{...base,file:'relocated/two.mp4'}])[0]!.id,'chosen-bg');
});
