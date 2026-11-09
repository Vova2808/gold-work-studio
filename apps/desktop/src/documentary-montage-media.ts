import {join} from 'node:path';
import type {DocumentarySemanticMontage,Project} from '@gold-work/shared';
import {selectedDocumentaryBackgroundIds} from '@gold-work/shared';
import type {EffectLibrary} from './effect-library.js';
import {resolveDocumentaryBackgrounds} from './documentary-background.js';
import {prepareDocumentaryMusicSections} from './documentary-auto-music.js';
import {probeEffectMedia} from './effect-media.js';
import {semanticMontageHash} from './documentary-semantic-montage.js';

export async function prepareDocumentaryMontageMedia(project:Project,projectDirectory:string,materialRoot:string,library?:EffectLibrary,signal?:AbortSignal,plan?:DocumentarySemanticMontage):Promise<Project>{
  const doc=project.settings.assembly.documentary,montage=doc?.montage;if(!doc||!montage)return project;
  signal?.throwIfAborted();
  let resolvedBackgrounds=doc.resolvedBackgrounds;
  if(montage.background?.mode==='library'&&selectedDocumentaryBackgroundIds(montage.background).length){
    if(!library)throw new Error('Библиотека фонов недоступна');
    resolvedBackgrounds=[];
    for(const background of await resolveDocumentaryBackgrounds(library,projectDirectory,montage.background)){
      signal?.throwIfAborted();
      resolvedBackgrounds.push(background.kind==='video'?{...background,durationSeconds:(await probeEffectMedia(background.path,signal)).durationSeconds}:background);
    }
  }else resolvedBackgrounds=undefined;
  const resolvedBackground=resolvedBackgrounds?.[0];
  let music=project.settings.music;
  const policy=montage.musicPolicy??'preserve';
  if(policy==='off')music={...music,enabled:false,selectionStatus:'off',selectionMessage:'Музыка выключена.'};
  else if(policy==='automatic'){
    const hash=semanticMontageHash(project);
    const saved=project.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order).flatMap(s=>
      s.documentary?.semanticMontageInputHash===hash&&s.documentary.semanticMontage?.musicSection?[s.documentary.semanticMontage.musicSection]:[]);
    music=await prepareDocumentaryMusicSections(project,plan?plan.musicSections:saved.length?saved:undefined,{directory:join(materialRoot,'Music'),projectDirectory,signal});
  }
  signal?.throwIfAborted();
  return {...project,settings:{...project.settings,music,assembly:{...project.settings.assembly,documentary:{...doc,resolvedBackground,resolvedBackgrounds}}}};
}
