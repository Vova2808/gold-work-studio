import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { DocumentaryEffect, EffectAsset, Project, Scene } from "@gold-work/shared";
import {documentarySceneTransition,documentaryTransitionPair} from "@gold-work/shared";
import type { EffectLibrary } from "./effect-library.js";
import type { LocalProjectStorage } from "./local-project-storage.js";
import { atomicWrite } from "./fs-utils.js";
import { copyImmutableDocumentaryFile } from "./documentary-storage.js";
import {effectFfmpeg} from './effect-media.js';
import {montageFrames,montageHookSeconds} from './documentary-semantic-montage.js';
import {documentaryBoundaryContext,documentaryTransitionLocked} from './documentary-transitions.js';

/** Audible events follow the cut timeline, with a busy opening and quiet body. */
export function documentaryMontageSoundEvents(project:Project):Array<{sceneId:string;seconds:number;category:'click'|'transition'}>{
  const settings=project.settings.assembly.documentary,options=settings?.montage;
  if(!options||settings.autoEffects===false)return [];
  const hook=montageHookSeconds(project),gap=options.intensity==='rich'?2.3:options.intensity==='balanced'?3.5:5;
  const bodyGap=options.intensity==='rich'?16:options.intensity==='balanced'?32:55;
  const events:Array<{sceneId:string;seconds:number;category:'click'|'transition'}>=[];
  const ordered=[...project.scenes].filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order);
  const starts=new Map<string,number>();let duration=0;
  for(const scene of ordered){starts.set(scene.id,duration);duration+=montageFrames(scene)/30;}
  const actionEvents=new Map<string,Array<{seconds:number;category:'click'|'transition'}>>();
  for(const scene of ordered){
    const g=scene.documentary?.motionGraphic;
    if(!g?.enabled||!g.artwork||scene.documentary?.templateMotion?.amountPercent===0)continue;
    const members=g.sequenceId?ordered.filter(s=>s.documentary?.motionGraphic?.sequenceId===g.sequenceId):[scene];
    if(members[0]!==scene)continue;
    const frames=members.length>1?members.reduce((sum,s)=>sum+montageFrames(s),0):Math.min(montageFrames(scene)-Math.round(g.startSeconds*30),Math.round(g.durationSeconds*30));
    for(const action of g.artwork.actions??[]){
      if(!action.sound)continue;
      const at=starts.get(scene.id)!+(Math.round(g.startSeconds*30)+Math.round(action.end*Math.max(0,frames-1)))/30;
      const target=ordered.find(s=>at>=starts.get(s.id)!&&at<starts.get(s.id)!+montageFrames(s)/30);
      if(!target)continue;
      const points=actionEvents.get(target.id)??[];points.push({seconds:at-starts.get(target.id)!,category:action.sound});actionEvents.set(target.id,points);
    }
  }
  const reserved:number[]=[];let reservedCursor=0;
  for(const scene of [...project.scenes].sort((a,b)=>a.order-b.order)){
    if(scene.includeInAssembly===false)continue;
    for(const effect of scene.documentary?.effects??[])if(effect.enabled&&effect.kind==='audio'&&effect.origin!=='automatic')reserved.push(reservedCursor+effect.startSeconds);
    reservedCursor+=montageFrames(scene)/30;
  }
  let cursor=0,last=-Infinity;
  for(const scene of [...project.scenes].sort((a,b)=>a.order-b.order)){
    if(scene.includeInAssembly===false)continue;
    const start=cursor;cursor+=montageFrames(scene)/30;
    const doc=scene.documentary;
    if(!doc||doc.pinned||doc.effects.some(e=>e.enabled&&e.kind==='audio'&&e.origin!=='automatic'))continue;
    const planned=doc.semanticMontage?.sceneDirection?.storyboard;
    const authored=actionEvents.get(scene.id);
    // Artwork owns its own event/contact clock, including deliberate silence.
    // Do not fill its quiet holds and continuation cuts with generic whooshes.
    if(!authored?.length&&(doc.motionGraphic?.artwork||planned?.sound==='none'))continue;
    const directed=!authored?.length&&planned&&planned.sound!=='none'
      ?[{seconds:Math.round((planned.states[1]?.at??0)*Math.max(0,montageFrames(scene)-1))/30,category:planned.sound}]:undefined;
    const scored=authored?.length?authored:directed;
    const points=scored?.length?scored.map(p=>p.seconds).sort((a,b)=>a-b):start<hook?[0,...(doc.cuts??[]).slice(1).map(c=>c.fromFrame/30)]:[doc.motionGraphic?.startSeconds??0];
    for(const seconds of points){
      const at=start+seconds,inHook=at<hook;
      const meaningful=doc.motionGraphic?.enabled||['turn','conflict','resolve'].includes(doc.semanticMontage?.beat??'')
        ||['broadcast-crt','broadcast-scanlines','editorial-film-gate','editorial-orbit','archive-slide','gallery','paper-grid','museum-mat'].includes(doc.template??'');
      const spacing=scored?.length ? .6 : inHook?gap:bodyGap;
      if((!scored?.length&&!inHook&&!meaningful)||at-last<spacing||reserved.some(point=>Math.abs(at-point)<spacing)||(!scored?.length&&!inHook&&at-hook<bodyGap*.6))continue;
      events.push({sceneId:scene.id,seconds,category:scored?.find(p=>p.seconds===seconds)?.category??(seconds>0||doc.motionGraphic?.enabled?'click':'transition')});last=at;
    }
  }
  return events;
}

async function planMontageSounds(project:Project,assets:EffectAsset[],library:EffectLibrary,storage:LocalProjectStorage,sceneIds?:string[]):Promise<Scene[]>{
  const scoped=(s:Scene)=>!sceneIds||sceneIds.includes(s.id);
  const scenes=project.scenes.map(s=>s.includeInAssembly!==false&&s.documentary&&!s.documentary.pinned&&scoped(s)?{...s,documentary:{...s.documentary,effects:s.documentary.effects.filter(e=>e.origin!=='automatic'||e.kind!=='audio')}}:s);
  const events=documentaryMontageSoundEvents({...project,scenes}),used=new Map<string,number>();
  const total=scenes.filter(s=>s.includeInAssembly!==false).reduce((sum,s)=>sum+montageFrames(s)/30,0);
  const starts=new Map<string,number>();let cursor=0;
  for(const scene of [...scenes].sort((a,b)=>a.order-b.order)){starts.set(scene.id,cursor);if(scene.includeInAssembly!==false)cursor+=montageFrames(scene)/30;}
  const sounds=await Promise.all(assets.filter(a=>a.kind==='audio'&&['click','ding','transition'].includes(a.category)).map(a=>a.category==='click'?documentaryShortClick(a,library.rootPath):a));
  for(const event of events){
    const scene=scenes.find(s=>s.id===event.sceneId)!;if(!scoped(scene))continue;
    const at=starts.get(scene.id)!+event.seconds;
    const choices=sounds.filter(a=>{const length=(a.defaults.trimEndSeconds??a.metadata?.durationSeconds??0)-a.defaults.trimStartSeconds;
      return length>0&&length<=1.4&&at+length<=total&&at-(used.get(a.id)??-Infinity)>=4;})
      .sort((a,b)=>(Number(b.category===event.category)-Number(a.category===event.category))||(used.get(a.id)??-Infinity)-(used.get(b.id)??-Infinity)||a.id.localeCompare(b.id));
    const asset=choices[0];if(!asset)continue;
    const effect=await copyDocumentaryEffect(library,storage,project.id,asset.id,asset);
    effect.id=`montage-sfx-${scene.id}-${Math.round(event.seconds*30)}`;effect.origin='automatic';effect.startSeconds=event.seconds;
    effect.defaults.volume=documentaryAutomaticSoundVolume(asset,project.settings.voice.enabled)*(at>=montageHookSeconds(project)?.8:1);
    effect.defaults.fadeInSeconds=Math.min(.03,effect.durationSeconds/3);effect.defaults.fadeOutSeconds=Math.min(.09,effect.durationSeconds/3);
    scene.documentary!.effects.push(effect);used.set(asset.id,at);
  }
  return scenes;
}

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
  if (settings?.autoEffects === false&&!transitionsEnabled&&settings?.autoMotionGraphics===false) return settings.montage
    ?project.scenes.map(s=>s.includeInAssembly!==false&&s.documentary&&!s.documentary.pinned&&(!sceneIds||sceneIds.includes(s.id))?{...s,documentary:{...s.documentary,effects:s.documentary.effects.filter(e=>e.origin!=='automatic'||e.kind!=='audio')}}:s)
    :project.scenes;
  const approved = (await library.snapshot()).assets.filter(asset => asset.state === "ready" && asset.automatic && asset.review === "approved" && asset.rights === "user-confirmed" && !asset.deletedAt);
  // Silent panels do not justify decoding every sound in the library. Use the
  // approved asset's saved trim when a meaningful event actually needs it.
  const assets=approved;
  if(settings?.montage)project={...project,scenes:await planMontageSounds(project,assets,library,storage,sceneIds)};
  let lastAccentSeconds = -Infinity;
  const usedAutomaticSounds = new Map<string,{at:number;uses:number;sequenceId?:string}>();
  const usedVisuals = new Set<string>();
  const scenes: Scene[] = [];
  const durationOf = (scene: Scene) => Math.max((scene.documentary?.timing?.durationInFrames ?? Math.ceil(scene.durationSeconds * 30)) / 30, scene.durationOverrideSeconds ?? 0);
  const visualBoundaries:number[]=[];
  const plannedBoundaries:number[]=[];
  let visualCursor=0;
  for(const scene of [...project.scenes].sort((a,b)=>a.order-b.order)){
    if(scene.includeInAssembly===false)continue;
    if((settings?.montage||scene.transition!==undefined)&&documentarySceneTransition(scene,project.settings.assembly).kind!=='none')
      plannedBoundaries.push(visualCursor+durationOf(scene));
    for(const effect of scene.documentary?.effects??[])if(effect.kind!=='audio'){
      usedVisuals.add(effect.assetId);
      // Reserve saved seams, including a disabled one: the user may have muted it.
      if(effect.boundary?.to===scene.id)visualBoundaries.push(visualCursor);
      else if(effect.boundary?.from===scene.id)visualBoundaries.push(visualCursor+durationOf(scene));
    }
    visualCursor+=durationOf(scene);
  }
  const totalSeconds = project.scenes.filter(scene => scene.includeInAssembly !== false).reduce((sum, scene) => sum + durationOf(scene), 0);
  // Stock presets space sounds at actual edit boundaries. Other workflows keep
  // sparse accents for meaningful graphics; neither budget is a quota.
  const stock=project.mediaMode==='stock';
  const soundGap=stock?(settings?.montageDensity==='calm'?20:settings?.montageDensity==='balanced'?12:6):45;
  const soundBudget=Math.max(1,Math.ceil(totalSeconds/(stock?soundGap:90)));
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
    if (!doc || doc.pinned || sceneIds && !sceneIds.includes(scene.id)) { scenes.push(scene); continue; }
    if(continued){scenes.push(scene);continue;}
    let previous:Scene|undefined;
    for(let i=scenes.length-1;i>=0;i--)if(scenes[i]!.includeInAssembly!==false){previous=scenes[i];break;}
    const transitionSound=stock&&previous&&!previous.documentary?.pinned
      &&documentarySceneTransition(previous,project.settings.assembly).kind!=='none';
    const accent = transitionSound?'transition':panelChange?'click':graphic ? ['statistic','chronology','callout','feature-list'].includes(graphic.kind)?'ding':'transition' : doc.requirement.accent;
    // Arbitrary model suggestions and panel changes remain silent. A planned
    // Stock transition is a concrete event even without an infographic.
    const meaningfulSound=Boolean(graphic&&(
      graphic.kind==='chapter-number'&&graphic.title.trim()||
      ['statistic','chronology'].includes(graphic.kind)&&graphic.value?.trim()||
      ['map-route','map-locator'].includes(graphic.kind)&&graphic.place));
    const allowSound=!settings?.montage&&settings?.autoEffects!==false&&!doc.effects.some(e=>e.enabled&&e.kind==='audio')
      &&Boolean(accent&&accent!=='none')&&(meaningfulSound||transitionSound)&&soundCount<soundBudget&&sceneStart-lastAccentSeconds>=soundGap;
    // Maps/numbers use clicks; Stock boundaries use the approved transition
    // palette and section changes can build into the cut with a riser.
    const sectionChange=Boolean(previous?.documentary?.requirement.sectionTitle&&doc.requirement.sectionTitle&&previous.documentary.requirement.sectionTitle!==doc.requirement.sectionTitle);
    const soundAccent=transitionSound?(sectionChange||scene.order%3===0?'riser':'transition'):graphic?.kind==='chapter-number'?'transition':'click';
    const preferredSounds=assets.filter(asset=>asset.kind==='audio'&&asset.category===soundAccent);
    const fallbackSounds=assets.filter(asset=>asset.kind==='audio'&&(transitionSound?['transition','riser'].includes(asset.category):asset.category==='ding'));
    const soundAssets=allowSound?await Promise.all((preferredSounds.length?preferredSounds:fallbackSounds)
      .map(asset=>asset.category==='click'?documentaryShortClick(asset,library.rootPath):asset)):[];
    const eventAt=transitionSound?sceneStart:sceneStart+(graphic?.startSeconds??0)+(graphic?Math.min(panelChange ? .2 : accent==='ding' ? .55 : .35,graphic.durationSeconds*.2):0);
    const assetDuration = (asset: (typeof assets)[number]) => Math.max(.1,(asset.defaults.trimEndSeconds ?? asset.metadata?.durationSeconds ?? 3)-asset.defaults.trimStartSeconds);
    const accentOffset=(asset:(typeof assets)[number])=>asset.metadata?.accentSeconds!==undefined
      ? Math.max(0,Math.min(assetDuration(asset),asset.metadata.accentSeconds-asset.defaults.trimStartSeconds))
      : asset.category==='riser'?Math.max(0,assetDuration(asset)-.15):0;
    const sounds = soundAssets.filter(asset => {
      const length = assetDuration(asset), start = eventAt-accentOffset(asset);
      if(!transitionSound&&soundAccent==='transition'&&length>1.2)return false;
      if(panelChange&&length>1.2)return false;
      // Pick a whole sound that fits; never chop its tail at the end of the film.
      return start >= 0 && start + length <= totalSeconds;
    });
    const boundary=previous&&documentaryBoundaryContext(project,previous,scene,sceneStart);
    const visualGap=boundary?.inHook?(boundary.density==='rich'?6:boundary.density==='balanced'?8:10)
      :boundary?.density==='rich'?16:boundary?.density==='balanced'?22:30;
    const visualCandidate=boundary&&(boundary.meaningful||boundary.hasMedia&&(boundary.inHook||boundary.density==='rich')
      ||!settings?.montage&&(previous?.autoTransition==='mix'||previous?.autoTransition==='fade'));
    const visualAllowed=transitionsEnabled&&visualCandidate&&previous?.documentary&&!boundary?.continuing
      &&(!sceneIds||sceneIds.includes(previous.id))&&!documentaryTransitionLocked(previous)&&!documentaryTransitionLocked(scene)
      &&previous.transition===undefined&&previous.transitionDurationSeconds===undefined
      &&previous.documentary.autoTransitionStyle!=='glitch'
      &&(project.settings.assembly.transitionType??'none')==='none'
      &&visualBoundaries.every(at=>Math.abs(sceneStart-at)>=visualGap)
      &&plannedBoundaries.every(at=>Math.abs(sceneStart-at)<.001||Math.abs(sceneStart-at)>=visualGap);
    // Backgrounds and SFX may coexist with the seam. Preserve visual layers that
    // actually occupy either half, instead of rejecting every nonempty track.
    const freeWindow=(s:Scene,start:number,end:number)=>!s.documentary!.effects.some(e=>e.enabled&&e.kind!=='audio'&&e.role!=='background'
      &&e.startSeconds<end&&e.startSeconds+e.durationSeconds>start);
    const visual = visualAllowed ? assets.filter(asset => {
      if(asset.kind==='audio'||!['transition','light-leak'].includes(asset.category))return false;
      const length=(asset.defaults.trimEndSeconds??asset.metadata?.durationSeconds??0)-asset.defaults.trimStartSeconds;
      // Keep complete catalog transitions (including 2–2.5 s), not a clipped
      // arbitrary overlay. At least half of each neighbouring shot stays clear.
      if(!Number.isFinite(length)||length<=0||length>Math.min(3,durationOf(scene),durationOf(previous!)))return false;
      const frames=Math.max(2,Math.round(length*30)),out=Math.floor(frames/2)/30,incoming=(frames-Math.floor(frames/2))/30;
      return freeWindow(previous!,durationOf(previous!)-out,durationOf(previous!))&&freeWindow(scene,0,incoming);
    }) : [];
    // Do not turn a scarce library into a recurring audible pattern.
    const reusableSounds = sounds.filter(asset => {
      const previous=usedAutomaticSounds.get(asset.id);
      return eventAt-(previous?.at??-Infinity)>=(transitionSound?soundGap:180);
    });
    const minimumUses=Math.min(...reusableSounds.map(asset=>usedAutomaticSounds.get(asset.id)?.uses??0));
    const unusedSounds=reusableSounds.filter(asset=>(usedAutomaticSounds.get(asset.id)?.uses??0)===minimumUses);
    // Alternate a library treatment with the short built-in seam. Otherwise a
    // large imported pack replaces every dissolve and leaves no calm contrast.
    const libraryTurn=!plannedBoundaries.length||visualBoundaries.length===0||plannedBoundaries.filter(at=>at<=sceneStart+.001).length%3!==2;
    const unusedVisuals=libraryTurn?visual.filter(asset=>!usedVisuals.has(asset.id)):[];
    const selected = [unusedSounds[scene.order % Math.max(1, unusedSounds.length)], unusedVisuals[scene.order % Math.max(1, unusedVisuals.length)]].filter(asset => asset !== undefined);
    const effects: DocumentaryEffect[] = [...doc.effects];
    for (const asset of selected) {
      let effect:DocumentaryEffect;
      try {effect = await copyDocumentaryEffect(library, storage, project.id, asset.id, asset);}
      catch(error){
        // A removed optional visual asset leaves the planned built-in fallback.
        if(asset.kind!=='audio'&&['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))continue;
        throw error;
      }
      effect.origin='automatic';
      if (asset.kind !== 'audio' && previous) {
        effect.durationSeconds=assetDuration(asset);
        const [outgoing,incoming]=documentaryTransitionPair(previous,scene,effect,'automatic');
        const index=scenes.findIndex(s=>s.id===previous.id);
        scenes[index]={...previous,autoTransition:'none',autoTransitionDurationSeconds:undefined,
          documentary:{...previous.documentary!,autoTransitionStyle:undefined,effects:[...previous.documentary!.effects,outgoing!]}};
        effects.push(incoming!);usedVisuals.add(asset.id);visualBoundaries.push(sceneStart);continue;
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
      documentary: { ...doc, effects, caption: !stock && !graphic && accent&&accent!=='none' && text && !doc.caption.enabled ? { ...doc.caption, enabled: true, text, animation: accent === "keyboard" ? "typing" : "slide" } : doc.caption } });
  }
  // Backgrounds are silent visual layers and do not consume the accent budget.
  if(settings?.autoMotionGraphics!==false&&(!settings?.montage?.background||settings.montage.background.mode==='automatic'))for(const [index,scene] of scenes.entries()){
    const doc=scene.documentary;
    if(!doc||doc.pinned||scene.includeInAssembly===false||sceneIds&&!sceneIds.includes(scene.id)||doc.effects.some(e=>e.role==='background'))continue;
    const graphic=doc.motionGraphic?.enabled?doc.motionGraphic:undefined;
    const style=graphic?.background??(['paper-grid','compare-grid','compare-reveal','archive-slide'].includes(doc.template??'')?'grid-light':['dark-grid','compare-dossier','compare-filmstrip','blueprint-board'].includes(doc.template??'')?'grid-dark':undefined);
    if(!style||!['grid-light','grid-dark'].includes(style)||graphic&&!['explainer','bar-chart','subject-card'].includes(graphic.kind))continue;
    const choices=assets.filter(a=>documentaryBackgroundEligible(a,style));
    const asset=choices[scene.order%Math.max(1,choices.length)];if(!asset)continue;
    const effect=await copyDocumentaryEffect(library,storage,project.id,asset.id,asset);
    effect.origin='automatic';
    effect.durationSeconds=durationOf(scene);effect.defaults={...effect.defaults,sourceAudio:false,opacity:100,fadeInSeconds:0,fadeOutSeconds:0,trimEndSeconds:asset.defaults.trimEndSeconds??asset.metadata?.durationSeconds};
    scenes[index]={...scene,documentary:{...doc,effects:[...doc.effects,effect]}};
  }
  return scenes;
}

export function documentaryBackgroundEligible(asset:EffectAsset,style:string):boolean{
  return asset.category==='background'&&asset.state==='ready'&&asset.automatic&&asset.review==='approved'&&asset.rights==='user-confirmed'&&!asset.deletedAt
    &&(asset.metadata?.width??0)>=1280&&(asset.metadata?.height??0)>=720&&asset.tags.includes(style==='grid-light'?'editorial-light':'editorial-dark');
}
