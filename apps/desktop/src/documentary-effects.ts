import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { DocumentaryEffect, EffectAsset, Project, Scene } from "@gold-work/shared";
import {documentaryTransitionPair} from "@gold-work/shared";
import type { EffectLibrary } from "./effect-library.js";
import type { LocalProjectStorage } from "./local-project-storage.js";
import { atomicWrite } from "./fs-utils.js";
import { copyImmutableDocumentaryFile } from "./documentary-storage.js";
import {effectFfmpeg} from './effect-media.js';

const clickTrims=new Map<string,Promise<EffectAsset>>();
/** Use a complete click bounded by real silence, retaining the library file. */
export async function documentaryShortClick(asset:EffectAsset,root:string):Promise<EffectAsset>{
  const begin=asset.defaults.trimStartSeconds,end=asset.defaults.trimEndSeconds??asset.metadata?.durationSeconds??0;
  if(asset.category!=='click'||end-begin<=1.2)return asset;
  const key=JSON.stringify([root,asset.id,asset.version,begin,end]);let job=clickTrims.get(key);
  if(!job){job=(async()=>{
    const log=await effectFfmpeg(['-ss',String(begin),'-t',String(end-begin),'-i',join(root,asset.file),'-af','silencedetect=noise=-42dB:d=0.12','-f','null','-']);
    const markers=[...log.matchAll(/silence_(start|end):\s*([\d.]+)/g)];
    let audible=0;
    for(const marker of markers){
      const at=Number(marker[2]);
      if(marker[1]==='end'){audible=at;continue;}
      if(at-audible<.025)continue;
      if(at-audible>1.05)return asset;
      const trimStartSeconds=begin+Math.max(0,audible-.025),trimEndSeconds=Math.min(end,begin+at+.08);
      return {...asset,metadata:{...asset.metadata!,accentSeconds:begin+audible},defaults:{...asset.defaults,trimStartSeconds,trimEndSeconds}};
    }
    return asset;
  })().catch(()=>asset);clickTrims.set(key,job);}
  return job;
}

/** Attenuate hot library assets from their measured peak; never boost a quiet
 * sound above its saved level. Manual effects keep their authored volume. */
export function documentaryAutomaticSoundVolume(asset:EffectAsset,narration:boolean):number {
  const configured=Math.max(0,Math.min(100,asset.defaults.volume));
  const peak=asset.metadata?.peakDb;
  if(peak===undefined||!Number.isFinite(peak))return Math.min(configured,narration?35:60);
  // The master SFX slider and the renderer's 0.6 voice duck are applied later.
  // At the default 25% this yields a -24.4 dBFS accent, not the old -28.4 dBFS.
  return Math.min(configured,100*10**(((narration?-8:-6)-peak)/20));
}

export async function copyDocumentaryEffect(library: EffectLibrary, storage: LocalProjectStorage, projectId: string, assetId: string, knownAsset?: EffectAsset): Promise<DocumentaryEffect> {
  const asset = (knownAsset ? [knownAsset] : (await library.snapshot()).assets).find(item => item.id === assetId && !item.deletedAt && item.state === "ready");
  if (!asset) throw new Error("Эффект недоступен в библиотеке");
  const compatible = asset.kind === "image" || /\.(mp4|webm)$/i.test(asset.file);
  const source = join(library.rootPath, compatible ? asset.file : asset.proxy ?? asset.file);
  const root = join(storage.projectDirectory(projectId), "Documentary", "Effects"); await mkdir(root, { recursive: true });
  const destination = join(root, basename(source)); await copyImmutableDocumentaryFile(source, destination);
  await atomicWrite(join(root, `${asset.id}.source.json`), JSON.stringify(asset, null, 2));
  const duration = Math.max(.1, (asset.defaults.trimEndSeconds ?? asset.metadata?.durationSeconds ?? 3) - asset.defaults.trimStartSeconds);
  return { id: randomUUID(), assetId: asset.id, assetVersion: asset.version, name: asset.name, filePath: destination, kind: asset.kind,
    role: asset.kind === "audio" ? "sound" : asset.category === "background" ? "background" : asset.category === "transition" ? "transition" : "overlay",
    enabled: true, startSeconds: 0, sourceDurationSeconds: asset.metadata?.durationSeconds, durationSeconds: asset.kind === "audio" ? duration : Math.min(duration, 3), defaults: { ...asset.defaults, sourceAudio: false }, x: 0, y: 0, scale: 1, blend: asset.defaults.blend };
}

export async function planDocumentaryEffects(project: Project, library: EffectLibrary, storage: LocalProjectStorage, sceneIds?: string[]): Promise<Scene[]> {
  const settings=project.settings.assembly.documentary;
  const transitionsEnabled=(settings?.autoTransitions??settings?.autoEffects)!==false;
  if (settings?.autoEffects === false&&!transitionsEnabled&&settings?.autoMotionGraphics===false) return project.scenes;
  const approved = (await library.snapshot()).assets.filter(asset => asset.state === "ready" && asset.automatic && asset.review === "approved" && asset.rights === "user-confirmed" && !asset.deletedAt);
  // Silent panels do not justify decoding every sound in the library. Use the
  // approved asset's saved trim when a meaningful event actually needs it.
  const assets=approved;
  let lastAccentSeconds = -Infinity;
  let lastVisualSeconds = -Infinity;
  const usedAutomaticSounds = new Map<string,{at:number;uses:number;sequenceId?:string}>();
  const usedVisuals = new Set<string>();
  const scenes: Scene[] = [];
  const durationOf = (scene: Scene) => Math.max((scene.documentary?.timing?.durationInFrames ?? Math.ceil(scene.durationSeconds * 30)) / 30, scene.durationOverrideSeconds ?? 0);
  const totalSeconds = project.scenes.filter(scene => scene.includeInAssembly !== false).reduce((sum, scene) => sum + durationOf(scene), 0);
  // A ceiling, never a quota: silence is the default, even when there are many
  // graphics. Only a major editorial event can earn a sound below this limit.
  const soundBudget=Math.max(1,Math.ceil(totalSeconds/90));
  let soundCount=0;
  let cursor = 0;
  let previousGraphic:{sequenceId?:string;activeIndex?:number}|undefined;
  for (const scene of [...project.scenes].sort((a, b) => a.order - b.order)) {
    const sceneStart = cursor;
    if (scene.includeInAssembly !== false) cursor += durationOf(scene);
    const doc = scene.documentary;
    if(scene.includeInAssembly===false){scenes.push(scene);continue;}
    const graphic=doc?.motionGraphic?.enabled?doc.motionGraphic:undefined;
    const panelChange=graphic?.presentation==='panels'&&graphic.activeIndex!==undefined;
    const continued=Boolean(graphic?.sequenceId&&previousGraphic?.sequenceId===graphic.sequenceId&&(!panelChange||previousGraphic?.activeIndex===graphic.activeIndex));
    previousGraphic=graphic;
    for (const effect of doc?.effects ?? []) if (effect.enabled && effect.role === "sound") {
      lastAccentSeconds=Math.max(lastAccentSeconds,sceneStart+effect.startSeconds);
      usedAutomaticSounds.set(effect.assetId,{at:sceneStart+effect.startSeconds,uses:(usedAutomaticSounds.get(effect.assetId)?.uses??0)+1,sequenceId:graphic?.sequenceId});
      soundCount++;
    }
    for (const effect of doc?.effects ?? []) if(effect.enabled&&effect.kind!=='audio') usedVisuals.add(effect.assetId);
    if (!doc || doc.pinned || doc.effects.length || sceneIds && !sceneIds.includes(scene.id)) { scenes.push(scene); continue; }
    if(continued){scenes.push(scene);continue;}
    const accent = panelChange?'click':graphic ? ['statistic','chronology','callout','feature-list'].includes(graphic.kind)?'ding':'transition' : doc.requirement.accent;
    if (!accent || accent === "none") { scenes.push(scene); continue; }
    // A model's generic "ding/transition" suggestion, a card entering, or a
    // panel/list item changing is not a sound event. Keep those edits silent.
    const meaningfulSound=Boolean(graphic&&(
      graphic.kind==='chapter-number'&&graphic.title.trim()||
      ['statistic','chronology'].includes(graphic.kind)&&graphic.value?.trim()||
      ['map-route','map-locator'].includes(graphic.kind)&&graphic.place));
    const allowSound=settings?.autoEffects!==false&&meaningfulSound&&soundCount<soundBudget&&sceneStart-lastAccentSeconds>=45;
    // A map/date/number gets a neutral click when available; a chapter gets a
    // short transition. Heavy impacts, risers and long whooshes are authored
    // choices, not a random automatic palette for every topic.
    const soundAccent=graphic?.kind==='chapter-number'?'transition':'click';
    const preferredSounds=assets.filter(asset=>asset.kind==='audio'&&asset.category===soundAccent);
    const soundAssets=allowSound?await Promise.all((preferredSounds.length?preferredSounds:assets.filter(asset=>asset.kind==='audio'&&asset.category==='ding'))
      .map(asset=>asset.category==='click'?documentaryShortClick(asset,library.rootPath):asset)):[];
    const eventAt=sceneStart+(graphic?.startSeconds??0)+(graphic?Math.min(panelChange ? .2 : accent==='ding' ? .55 : .35,graphic.durationSeconds*.2):0);
    const assetDuration = (asset: (typeof assets)[number]) => Math.max(.1,(asset.defaults.trimEndSeconds ?? asset.metadata?.durationSeconds ?? 3)-asset.defaults.trimStartSeconds);
    const accentOffset=(asset:(typeof assets)[number])=>asset.metadata?.accentSeconds!==undefined
      ? Math.max(0,Math.min(assetDuration(asset),asset.metadata.accentSeconds-asset.defaults.trimStartSeconds))
      : asset.category==='riser'?Math.max(0,assetDuration(asset)-.15):0;
    const sounds = soundAssets.filter(asset => {
      const length = assetDuration(asset), start = eventAt-accentOffset(asset);
      if(soundAccent==='transition'&&length>1.2)return false;
      if(panelChange&&length>1.2)return false;
      // Pick a whole sound that fits; never chop its tail at the end of the film.
      return start >= 0 && start + length <= totalSeconds;
    });
    // A long overlay is not a short transition: prefer the built-in dissolve
    // instead of blindly cutting an arbitrary six-second effect to 0.65 s.
    let previous:Scene|undefined;
    for(let i=scenes.length-1;i>=0;i--)if(scenes[i]!.includeInAssembly!==false){previous=scenes[i];break;}
    const visualAllowed=transitionsEnabled&&accent==='transition'&&sceneStart-lastVisualSeconds>=20&&previous?.documentary
      &&(!sceneIds||sceneIds.includes(previous.id))
      &&(previous.autoTransition==='mix'||previous.autoTransition==='fade'||graphic?.kind==='chapter-number')
      &&!previous.documentary.pinned&&!doc.pinned&&!previous.documentary.effects.length&&previous.transition===undefined&&previous.transitionDurationSeconds===undefined;
    const visual = visualAllowed ? assets.filter(asset => asset.kind !== "audio" && ['transition','light-leak'].includes(asset.category)
      && assetDuration(asset) <= Math.min(durationOf(scene)*2,durationOf(previous!)*2,1.2)) : [];
    // Do not turn a scarce library into a recurring audible pattern.
    const reusableSounds = sounds.filter(asset => {
      const previous=usedAutomaticSounds.get(asset.id);
      return eventAt-(previous?.at??-Infinity)>=180;
    });
    const minimumUses=Math.min(...reusableSounds.map(asset=>usedAutomaticSounds.get(asset.id)?.uses??0));
    const unusedSounds=reusableSounds.filter(asset=>(usedAutomaticSounds.get(asset.id)?.uses??0)===minimumUses);
    const unusedVisuals=visual.filter(asset=>!usedVisuals.has(asset.id));
    const selected = [unusedSounds[scene.order % Math.max(1, unusedSounds.length)], unusedVisuals[scene.order % Math.max(1, unusedVisuals.length)]].filter(asset => asset !== undefined);
    const effects: DocumentaryEffect[] = [];
    for (const asset of selected) {
      const effect = await copyDocumentaryEffect(library, storage, project.id, asset.id, asset);
      if (asset.kind !== 'audio' && previous) {
        effect.durationSeconds=assetDuration(asset);
        const [outgoing,incoming]=documentaryTransitionPair(previous,scene,effect,'automatic');
        const index=scenes.findIndex(s=>s.id===previous.id);
        scenes[index]={...previous,autoTransition:'none',autoTransitionDurationSeconds:undefined,
          documentary:{...previous.documentary!,effects:[...previous.documentary!.effects,outgoing!]}};
        effects.push(incoming!);usedVisuals.add(asset.id);lastVisualSeconds=sceneStart;continue;
      }
      // Keep a riser's build-up before the cut and its end just after it.
      // SFX are project-time layers, so a short shot must not cut off their tail.
      effect.startSeconds = asset.kind === "audio" ? eventAt-sceneStart-accentOffset(asset) : 0;
      effect.defaults.fadeInSeconds = Math.min(effect.durationSeconds / 2, Math.max(.02, asset.defaults.fadeInSeconds));
      effect.defaults.fadeOutSeconds = Math.min(effect.durationSeconds / 2, Math.max(.04, asset.defaults.fadeOutSeconds));
      if(asset.kind==='audio')effect.defaults.volume=documentaryAutomaticSoundVolume(asset,project.settings.voice.enabled)*(panelChange ? .7 : 1);
      if (asset.kind === "audio") {
        usedAutomaticSounds.set(asset.id,{at:eventAt,uses:(usedAutomaticSounds.get(asset.id)?.uses??0)+1,sequenceId:graphic?.sequenceId});
        soundCount++;
        lastAccentSeconds=eventAt;
      }
      else usedVisuals.add(asset.id);
      effects.push(effect);
    }
    const text = doc.requirement.caption;
    scenes.push({ ...scene,
      documentary: { ...doc, effects, caption: !graphic && text && !doc.caption.enabled ? { ...doc.caption, enabled: true, text, animation: accent === "keyboard" ? "typing" : "slide" } : doc.caption } });
  }
  // Backgrounds are silent visual layers and do not consume the accent budget.
  if(settings?.autoMotionGraphics!==false)for(const [index,scene] of scenes.entries()){
    const doc=scene.documentary;
    if(!doc||doc.pinned||scene.includeInAssembly===false||sceneIds&&!sceneIds.includes(scene.id)||doc.effects.some(e=>e.role==='background'))continue;
    const graphic=doc.motionGraphic?.enabled?doc.motionGraphic:undefined;
    const style=graphic?.background??(['paper-grid','compare-grid','compare-reveal','archive-slide'].includes(doc.template??'')?'grid-light':['dark-grid','compare-dossier','compare-filmstrip','blueprint-board'].includes(doc.template??'')?'grid-dark':undefined);
    if(!style||!['grid-light','grid-dark'].includes(style)||graphic&&!['explainer','bar-chart','subject-card'].includes(graphic.kind))continue;
    const choices=assets.filter(a=>documentaryBackgroundEligible(a,style));
    const asset=choices[scene.order%Math.max(1,choices.length)];if(!asset)continue;
    const effect=await copyDocumentaryEffect(library,storage,project.id,asset.id,asset);
    effect.durationSeconds=durationOf(scene);effect.defaults={...effect.defaults,sourceAudio:false,opacity:100,fadeInSeconds:0,fadeOutSeconds:0,trimEndSeconds:asset.defaults.trimEndSeconds??asset.metadata?.durationSeconds};
    scenes[index]={...scene,documentary:{...doc,effects:[...doc.effects,effect]}};
  }
  return scenes;
}

export function documentaryBackgroundEligible(asset:EffectAsset,style:string):boolean{
  return asset.category==='background'&&asset.state==='ready'&&asset.automatic&&asset.review==='approved'&&asset.rights==='user-confirmed'&&!asset.deletedAt
    &&(asset.metadata?.width??0)>=1280&&(asset.metadata?.height??0)>=720&&asset.tags.includes(style==='grid-light'?'editorial-light':'editorial-dark');
}
