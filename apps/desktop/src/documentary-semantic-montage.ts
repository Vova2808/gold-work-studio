import {createHash} from 'node:crypto';
import {documentaryDiagram} from './documentary-diagram-plan.js';
import {mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {DocumentarySemanticMontage, DocumentaryMontageComposition, DocumentaryMusicSection, DocumentaryMotionGraphic, DocumentaryTemplate, Project, Scene} from '@gold-work/shared';
import {groundedDocumentaryMotion,documentaryMaterialUsable,documentaryHookSeconds,documentaryArtworkUsesMedia,documentaryAiPlanContext} from '@gold-work/shared';
import {atomicWrite} from './fs-utils.js';
import {mapScriptChapters} from './documentary-script-chapters.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {documentaryDetailAnnotations} from './documentary-explainer.js';
import {localMontageAccent,localAccentTiming} from './documentary-local-montage.js';
import {compactMontageBatches} from './documentary-semantic-batches.js';
import {sparseMontageDirection} from './documentary-hook-direction.js';
import {createDocumentaryMotionPresetPlanner} from './documentary-motion-preset-planner.js';
import {assessArtworkReplacement} from './documentary-artwork-quality.js';
import {documentaryArtworkMediaIssue} from './documentary-artwork-application.js';
import {documentaryDirectedTemplate,documentaryPauseAlignedLengths} from './documentary-montage-direction.js';
import {documentarySourceFootageIssue,documentaryStandaloneArtworkReady} from './documentary-source-eligibility.js';
import {applyDocumentarySourcePreservingFallback,documentarySourcePreservingFallbackReady} from './documentary-native-fallback.js';
import {validateSceneDirection,documentarySceneDirectionSystem,directedMontageSystem} from './documentary-scene-direction.js';
import {validateDocumentaryExplanation,documentaryExplanationEditable,documentaryExplanationSpans,documentaryExplanationDirection,documentaryExplanationSemantics,documentaryEditorialSystem,preObjectTypeMontageSystem} from './documentary-explanation.js';

type Direction = DocumentarySemanticMontage['scenes'][number];
const validArtworkMode=(value:unknown):Direction['artworkMode']=>value==='photographic'||value==='standalone'?value:undefined;
export class DocumentarySemanticMontageError extends Error {}
export function validateSemanticMontagePlan(plan:DocumentarySemanticMontage,project:Project):void {
  const ids=project.scenes.filter(s=>s.includeInAssembly!==false).map(s=>s.id);
  if(plan?.version!==1||plan.inputHash!==semanticMontageHash(project)||!Array.isArray(plan.scenes)
    ||plan.scenes.length!==ids.length||ids.some(id=>plan.scenes.filter(s=>s?.sceneId===id).length!==1))
    throw new DocumentarySemanticMontageError('[no-retry] Монтажный ответ содержит пропущенные или повторные сцены либо относится к другому сценарию. Полученный ответ сохранён; повторная оплата отключена.');
}
const norm=(s:string)=>s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const comparisonName=(value:string)=>norm(value).replace(/^(?:the|a|an) /u,'');
type MontageCards=NonNullable<DocumentaryMotionGraphic['cards']>;

/** Explicit model references can use accepted fast-review observations; inferred
 * matches still require reviewed identities, never search titles or source order. */
export function bindMontageComparisonCards(cards:MontageCards,scene:Scene,all:Scene[],authoredCards:MontageCards=[]):{cards:MontageCards;showSource?:false} {
  const typography=()=>({cards:cards.map(({sceneId,...card})=>card),showSource:false as const});
  const supported=(source:Scene,label:string,explicit:boolean)=>{
    const doc=source.documentary,review=doc?.visualReview;
    if(source.includeInAssembly===false||!source.imagePath||!doc||doc.nativeFallback||review?.status!=='accepted')return false;
    // Fast review deliberately supplies a boolean and an observed description,
    // not an identity score. Trust the model's explicit source/label assignment
    // only here; merely mentioning an owner in a description is not a match.
    const authored=explicit&&authoredCards.some(card=>card.sceneId===source.id&&card.label===label)&&Boolean(narrated(scene,label,70));
    if(authored&&review.fastRelevance?.relevant===true&&review.viewDescription?.trim())return true;
    if(!doc.verified||!documentaryMaterialUsable(source))return false;
    const years=scene.documentary?.requirement.years??[],otherYears=doc.requirement.years??[];
    if(years.length&&otherYears.length&&!years.some(year=>otherYears.some(other=>String(year)===String(other))))return false;
    const evidence=[review.identifiedEntity,review.fastRelevance?.specificEvidence?.identityMatch===true?review.fastRelevance.specificEvidence.subject:undefined]
      .filter((name):name is string=>Boolean(name)).map(comparisonName);
    const target=comparisonName(label);
    if(evidence.includes(target))return true;
    return Boolean(doc.requirement.identities?.some(identity=>{
      const names=[identity.name,...(identity.aliases??[])].map(comparisonName);
      return names.includes(target)&&names.some(name=>evidence.includes(name));
    }));
  };
  const mediaKey=(source:Scene)=>source.documentary?.checksum||source.videoPath||source.imagePath||source.id;
  const used=new Set<string>(),bound:MontageCards=[];
  for(const card of cards){
    const candidates=card.sceneId?all.filter(source=>source.id===card.sceneId):all;
    const matching=new Map<string,Scene>();
    for(const source of candidates)if(supported(source,card.label,Boolean(card.sceneId))){
      const key=mediaKey(source),prior=matching.get(key);
      // Duplicate references to the same approved material are equivalent.
      if(!prior||source.id.localeCompare(prior.id)<0)matching.set(key,source);
    }
    // Several different images of a subject require an authored reference;
    // never silently take whichever happens to be first in the project.
    if(matching.size!==1)return typography();
    const [key,source]=matching.entries().next().value!;
    if(used.has(key))return typography();
    used.add(key);bound.push({...card,sceneId:source.id});
  }
  return bound.length>=2?{cards:bound}:typography();
}

/** Reject a visibly chopped automatic phrase, not a new prose-quality score. */
function unfinishedMontagePhrase(text:string):boolean {
  const tail=text.trim().toLocaleLowerCase().replace(/[.!?…,:;”"»\])]+$/gu,'').trim();
  return /(?:^|\s)(?:didn['’]t|doesn['’]t|don['’]t|isn['’]t|wasn['’]t|weren['’]t|couldn['’]t|wouldn['’]t|shouldn['’]t|can['’]t|won['’]t|is|are|was|were|the|a|an|to|of|with|and|or|but|и|или|но|для|из|без|при|к|с|в|на|от|не)$/u.test(tail);
}
function narrated(scene:Scene,value:unknown,max=120):string|undefined{
  if(typeof value!=='string'||!norm(value)||value.trim().length>max)return;
  const text=value.trim(),at=scene.narration.toLocaleLowerCase().indexOf(text.toLocaleLowerCase());
  return at>=0?scene.narration.slice(at,at+text.length):undefined;
}
const compositionVariants:Partial<Record<DocumentaryMotionGraphic['kind'],DocumentaryMotionGraphic['variant'][]>>={
  'subject-card':['clean','collage','poster'],explainer:['clean','collage','poster'],
  'key-point':['clean','marker','poster'],quote:['marker','collage'],statistic:['clean','poster'],
  'bar-chart':['clean','technical'],chronology:['clean','date'],annotations:['technical','magnifier'],
  'map-locator':['clean'],'map-route':['clean'],'feature-list':['clean','collage']};

/** Ground the optional choice inside the existing plan, without inspecting media again. */
function montageComposition(value:unknown,scene:Scene,all:Scene[],cutawaySources=montageCutawaySources):DocumentaryMotionGraphic|undefined{
  if(!value||typeof value!=='object')return;
  const raw=value as DocumentaryMontageComposition,variants=compositionVariants[raw.kind];
  if(!Array.isArray(variants))return; // Chapters are mapped from the original script separately.
  const variant=variants.includes(raw.variant)?raw.variant:undefined;
  // Some completed answers put one literal date in a text-only card. Accept
  // only the same narrated date our local date parser recognizes, not a new
  // source card, arbitrary label or a replacement for an invalid explicit title.
  const dateCard=raw.kind==='key-point'&&!raw.title&&!raw.kicker&&!raw.value&&Array.isArray(raw.cards)&&raw.cards.length===1
    &&raw.cards[0]&&Object.entries(raw.cards[0]).every(([key,value])=>key==='label'||value===undefined)?raw.cards[0]:undefined;
  const dateAccent=dateCard?localMontageAccent(scene)?.graphic:undefined;
  const cardDate=dateAccent?.kind==='chronology'&&dateAccent.variant==='date'
    &&dateAccent.value===narrated(scene,dateCard?.label,70)?dateAccent.value:undefined;
  const title=narrated(scene,raw.title,raw.kind==='quote'?320:120)
    ??(raw.kind==='key-point'&&!raw.title?narrated(scene,raw.kicker,80)
      ??(!raw.kicker?narrated(scene,raw.value,80):undefined):undefined)
    ??(raw.kind==='quote'&&!raw.title?narrated(scene,raw.highlight,70):undefined)??cardDate??'';
  // A bare historical baseline must not replace an already known event year.
  // Contextual titles remain subject to the same literal narration guard.
  if(raw.kind==='chronology'&&!title&&scene.documentary?.requirement.years?.length
    &&!scene.documentary.requirement.years.some(year=>String(raw.value??'').includes(String(year))))return;
  const items=Array.isArray(raw.items)?raw.items.map(item=>narrated(scene,item,70)).filter((item):item is string=>Boolean(item)).slice(0,5):undefined;
  const cards=Array.isArray(raw.cards)?raw.cards.slice(0,5).map(card=>({label:narrated(scene,card?.label,70)??'',
    value:narrated(scene,card?.value,48),sceneId:typeof card?.sceneId==='string'?card.sceneId:undefined})):undefined;
  const kicker=narrated(scene,raw.kicker,60);
  const fact=narrated(scene,raw.value,48);
  const suggestion={kind:raw.kind,variant,title,kicker:raw.kind==='key-point'&&kicker===title?undefined:kicker,value:raw.kind==='key-point'&&fact===title?undefined:fact,
    items,cards,highlight:narrated(scene,raw.highlight,70)};
  let graphic:DocumentaryMotionGraphic|undefined;
  if(raw.kind==='annotations'){
    // Reuse pixel-grounded data only. A text model cannot supply an anchor.
    const detail=documentaryDetailAnnotations(scene);
    const annotations=detail?.annotations?.filter(a=>(a.confidence??0)>=.93&&Boolean(narrated(scene,a.label,48))
      &&(!title||norm(a.label)===norm(title)));
    if(!detail||!annotations?.length)return;
    return {...detail,title,annotations,variant:variant??'technical',durationSeconds:montageFrames(scene)/30};
  }
  if(raw.kind==='explainer'){
    const allowed=new Set([scene.id,...cutawaySources(scene,all).map(s=>s.id)]);
    const rows=cards?.length?cards:items?.map(label=>({label,sceneId:undefined,value:undefined}));
    const boardLayout=['parts','steps','compare'].includes(raw.boardLayout??'')?raw.boardLayout!:'parts';
    if(!rows?.length||rows.some(c=>!c.label))return;
    if(boardLayout!=='compare'&&rows.some(c=>c.sceneId&&!allowed.has(c.sceneId)))return;
    // This card renderer needs the selected source's own image/poster. Do not
    // substitute another identity or produce an empty labelled video card.
    if(boardLayout!=='compare'&&rows.some(c=>c.sceneId&&!all.find(source=>source.id===c.sceneId)?.imagePath))return;
    if(boardLayout==='compare'&&rows.length<2||rows.length===1&&!rows[0]?.sceneId)return;
    const comparison=boardLayout==='compare'?bindMontageComparisonCards(rows,scene,all,rows):{cards:rows};
    graphic={kind:'explainer',enabled:true,title,hideTitle:!title,...comparison,boardLayout,
      theme:variant==='collage'?'paper':'dark',background:variant==='collage'?'grid-light':'grid-dark',
      origin:'automatic',startSeconds:0,durationSeconds:montageFrames(scene)/30};
  }else{
    if(raw.kind==='subject-card'&&!visibleMontageSubject(scene,title))return;
    if(raw.kind==='key-point'&&(!title||title.length>80||title.split(/\s+/u).length>8||title.length>=scene.narration.length*.7))return;
    if(raw.kind==='quote'){
      const quotes=[...scene.narration.matchAll(/«([^»]+)»|“([^”]+)”|"([^"\n]+)"/gu)].map(m=>norm(m[1]??m[2]??m[3]??''));
      if(!title||!quotes.some(q=>q.includes(norm(title))))return;
    }
    // Map place names use the same literal resolver and no AI coordinates.
    const map=raw.kind==='map-route'?{fromPlace:items?.[0],place:items?.at(-1),route:items}:{place:title};
    graphic=groundedDocumentaryMotion({...suggestion,...map},scene.narration,scene.narration);
  }
  const ratioGroups=graphic&&raw.ratioGroups?documentaryDiagram(scene,{...graphic,ratioGroups:raw.ratioGroups})?.groups:undefined;
  return graphic?{...graphic,variant:variant??graphic.variant,...(ratioGroups?{ratioGroups}:{})}:undefined;
}

function compositionFields(graphic:DocumentaryMotionGraphic):DocumentaryMontageComposition{
  return {kind:graphic.kind,variant:graphic.variant,title:graphic.title,kicker:graphic.kicker,value:graphic.value,
    items:graphic.items,cards:graphic.cards,boardLayout:graphic.boardLayout,highlight:graphic.highlight,
    ...(graphic.ratioGroups?{ratioGroups:graphic.ratioGroups}:{})};
}

/** An abstract insert must add explanation, not erase stronger visual evidence. */
export function documentaryExplanationKeepsEvidence(scene:Scene,all:Scene[],cutawaySources=montageCutawaySources):boolean{
  const doc=scene.documentary;if(!doc)return false;
  if(doc.semanticMontage?.artwork&&assessArtworkReplacement(doc.semanticMontage.artwork).allowReplacement)return true;
  if(doc.motionGraphic?.artwork&&assessArtworkReplacement(doc.motionGraphic.artwork).allowReplacement)return true;
  return documentaryMontageHasEvidence(scene,all,cutawaySources);
}
export function documentaryMontageHasEvidence(scene:Scene,all:Scene[],cutawaySources=montageCutawaySources):boolean{
  const doc=scene.documentary;if(!doc)return false;
  const direction=doc.semanticMontage;
  const native=direction?.treatment==='map'&&direction.location?groundedDocumentaryMotion({kind:'map-locator',title:direction.location,place:direction.location},scene.narration,scene.narration)
    :direction?.treatment==='statistic'&&direction.emphasis?groundedDocumentaryMotion({kind:'statistic',title:direction.subject,value:direction.emphasis},scene.narration,scene.narration):undefined;
  const candidates=[doc.motionGraphic,native,montageComposition(direction?.composition,scene,all,cutawaySources),direction&&objectComposition(scene,direction,all,cutawaySources)].filter((g):g is DocumentaryMotionGraphic=>Boolean(g&&g.enabled!==false));
  return candidates.some(graphic=>{
    if(documentaryDiagram(scene,graphic)||['map-locator','map-route','bar-chart','statistic'].includes(graphic.kind))return true;
    if(graphic.kind!=='explainer'||graphic.boardLayout!=='compare'||graphic.showSource===false||graphic.cards?.length!==2)return false;
    // A typography comparison does not outrank an explanation. Both image
    // bindings must be grounded in their own saved observed subject.
    return graphic.cards.every(card=>Boolean(card.sceneId))&&bindMontageComparisonCards(graphic.cards,scene,all,graphic.cards).showSource!==false;
  });
}
const subjectWords=(s:string)=>norm(s).split(' ').filter(w=>w.length>=3&&!/^\d/.test(w)&&!['the','and','for','with','from','into','of','race','racing','company','manufacturer','car','cars','это','или','для'].includes(w));
function visibleMontageSubject(scene:Scene,subject:string):boolean{
  const doc=scene.documentary;if(!doc||!scene.imagePath||scene.videoPath||!subject)return false;
  if(!doc.illustrative&&doc.requirement.identities?.some(i=>norm(i.name)===norm(subject)))return true;
  // An accepted illustration may introduce its visible object without becoming
  // historical evidence. Generic references need both a physical noun and the
  // saved visual review; abstract concepts such as "sufficient cooling" fail.
  if(!doc.verified||doc.visualReview?.status!=='accepted'||doc.visualReview.fastRelevance?.relevant!==true)return false;
  const observed=norm(doc.visualReview.viewDescription??''),name=norm(subject);
  const noun=name.replace(/^(?:the|this|that) /,'');
  return observed.includes(name)||['car','vehicle','aircraft','plane','ship','boat','building','engine','train','person','машина','автомобиль','самолёт','корабль','здание','двигатель'].includes(noun)
    &&observed.split(' ').includes(noun)&&Boolean(doc.requirement.identities?.some(i=>subjectWords(i.name).some(word=>observed.split(' ').includes(word))));
}

/** Image comparisons reuse distinct confirmed subjects. A narrated count alone
 * cannot establish that one source depicts one item suitable for duplication. */
function objectComposition(scene:Scene,direction:Direction,all:Scene[],cutawaySources=montageCutawaySources):DocumentaryMotionGraphic|undefined{
  if(direction.treatment!=='subject'||!visibleMontageSubject(scene,direction.subject))return;
  let cards:NonNullable<DocumentaryMotionGraphic['cards']>|undefined;
  if(/\b(?:versus|vs|compared|comparison|gegen|vergleich|comparado|comparación)\b|сравнен|против/iu.test(scene.narration)){
    const sources=cutawaySources(scene,all).filter(source=>direction.cutawaySceneIds.includes(source.id));
    for(const source of sources){
      const identity=source.documentary?.requirement.identities?.find(item=>norm(item.name)!==norm(direction.subject)
        &&scene.narration.toLocaleLowerCase().includes(item.name.toLocaleLowerCase())&&visibleMontageSubject(source,item.name));
      if(!identity)continue;
      const at=scene.narration.toLocaleLowerCase().indexOf(identity.name.toLocaleLowerCase());
      cards=[{sceneId:scene.id,label:direction.subject},{sceneId:source.id,label:scene.narration.slice(at,at+identity.name.length)}];break;
    }
  }
  if(!cards)return;
  return {kind:'explainer',enabled:true,title:direction.emphasis??direction.subject,hideTitle:!direction.emphasis,cards,boardLayout:'compare',isolateSubject:true,
    origin:'automatic',startSeconds:0,durationSeconds:montageFrames(scene)/30,theme:'dark',background:'grid-dark'};
}
export const montageFrames=(s:Scene)=>Math.max(1,s.documentary?.timing?.durationInFrames??Math.ceil(s.durationSeconds*30),Math.ceil((s.durationOverrideSeconds??0)*30));
export const montageHookSeconds=(p:Project)=>documentaryHookSeconds(p.settings.assembly.documentary?.montage);
const owned=(s:Scene)=>Boolean(s.documentary&&!s.documentary.pinned&&s.includeInAssembly!==false
  &&!s.documentary.motionGraphic?.routeComparison
  &&s.documentary.templateMotion?.amountPercent!==0
  &&!(s.documentary.layout==='compare'&&s.documentary.comparison)
  &&s.documentary.templateOrigin!=='manual'&&(!s.documentary.template||s.documentary.templateOrigin==='automatic')
  &&(!s.documentary.motionGraphic||s.documentary.motionGraphic.origin==='automatic')
  &&(!s.documentary.cuts?.length||s.documentary.cutsOrigin==='automatic')&&!s.documentary.texts?.length&&!s.documentary.caption.enabled);

/** Cross-shot cuts reuse compatible verified or explicitly accepted sources. This does not
 * change selection, query providers or broaden the source repetition policy. */
export function montageCutawaySources(scene:Scene,scenes:Scene[]):Scene[]{
  return montageCutawaySourcesForPolicy(scene,scenes,true);
}

/** False reconstructs the pre-eligibility catalog before sorting/truncation.
 * Receipt lookup must not inherit a newer authoring exclusion. */
function montageCutawaySourcesForPolicy(scene:Scene,scenes:Scene[],excludeMismatch:boolean):Scene[]{
  const doc=scene.documentary;if(!doc||!documentaryMaterialUsable(scene)||doc.nativeFallback)return [];
  const identities=doc.requirement.identities?.map(i=>norm(i.name)).filter(Boolean)??[];
  if(!identities.length)return [];
  const subjects=new Set(identities.flatMap(subjectWords));
  return scenes.filter(s=>{
    const other=s.documentary;
    if(s.id===scene.id||s.includeInAssembly===false||!other||!documentaryMaterialUsable(s)||excludeMismatch&&documentarySourceFootageIssue(s)||other.nativeFallback||(!s.imagePath&&!s.videoPath))return false;
    if((scene.imagePath||scene.videoPath)===(s.imagePath||s.videoPath)||doc.checksum&&doc.checksum===other.checksum)return false;
    // Requirements often name a compound subject ("Ford and Ferrari") or add
    // an event to a name. Shared named terms admit candidates; the text model
    // still decides whether the observed source supports this precise claim.
    if(!other.requirement.identities?.some(i=>identities.includes(norm(i.name))||subjectWords(i.name).some(w=>subjects.has(w))))return false;
    const years=doc.requirement.years??[],otherYears=other.requirement.years??[];
    if(years.length&&otherYears.length&&!years.some(y=>otherYears.some(other=>String(other)===String(y))))return false;
    return true;
  }).sort((a,b)=>Math.abs(a.order-scene.order)-Math.abs(b.order-scene.order)).slice(0,4);
}
const predecessorMontageCutawaySources=(scene:Scene,scenes:Scene[])=>montageCutawaySourcesForPolicy(scene,scenes,false);

/** Full replacements are silent, so a short reviewed interval may play slower. */
function replacementCutawayPlaybackRate(scene:Scene,source:Scene):number|undefined {
  const rate=source.playbackRate??1;
  if(!source.videoPath)return rate;
  if(!Number.isFinite(rate)||rate<=0)return;
  const duration=source.documentary?.selected?.durationSeconds??0;
  const start=Math.round((source.trimStartSeconds??0)*30);
  const end=Math.min(Math.round((source.trimEndSeconds??duration)*30),Math.floor(duration*30));
  const sourceFrames=Math.max(0,end-start),targetFrames=montageFrames(scene);
  if(sourceFrames/rate>=targetFrames)return rate;
  const slowed=sourceFrames/targetFrames;
  return slowed>=.5?slowed:undefined;
}

/** Explicit illustrative inserts carry no claim about the named historical model. */
function replacementCandidate(scene:Scene,source:Scene):boolean {
  const d=source.documentary;
  return Boolean(source.id!==scene.id&&source.includeInAssembly!==false&&d?.selected&&!d.nativeFallback&&documentaryMaterialUsable(source)
    &&!documentarySourceFootageIssue(source)&&(source.imagePath||source.videoPath)&&d.illustrative
    &&(!d.visualReview||d.visualReview.status==='accepted')&&replacementCutawayPlaybackRate(scene,source)!==undefined);
}

/** The existing full-scene replacement policy, separate from supplemental cuts. */
export function montageReplacementSources(scene:Scene,scenes:Scene[]):Scene[]{
  if(!scene.documentary||scene.includeInAssembly===false)return [];
  return scenes.filter(source=>replacementCandidate(scene,source));
}

function replacementCutawaySource(scene:Scene,scenes:Scene[],direction:Partial<Direction>|undefined):Scene|undefined {
  if(direction?.cutawayMode!=='replace'||!Array.isArray(direction.cutawaySceneIds)||direction.cutawaySceneIds.length!==1
    ||direction.composition||direction.artwork||direction.artworkBrief||direction.artworkSpan||direction.explanation||direction.chapter)return;
  const source=scenes.find(s=>s.id===direction.cutawaySceneIds![0]);
  return source&&replacementCandidate(scene,source)?source:undefined;
}

function acceptedMontageShot(scene:Scene):boolean {
  const doc=scene.documentary;
  if(!doc?.selected||!(doc.selected.kind==='video'?scene.videoPath:scene.imagePath)||!documentaryMaterialUsable(scene)||documentarySourceFootageIssue(scene))return false;
  const review=doc.visualReview?.status,analysis=doc.manualReview?.analysis?.status;
  if(review&&review!=='accepted'||analysis&&analysis!=='accepted')return false;
  return doc.verified||review==='accepted'||analysis==='accepted';
}

/** Candidate catalog for model-authored comparison cards, not footage selection.
 * Only saved accepted observations are exposed; the model still assigns labels. */
export function montageCompositionSources(scene:Scene,scenes:Scene[]):Scene[]{
  return predecessorMontageCompositionSources(scene,scenes);
}

/** Frozen catalog used by all pre-eligibility request serializers. */
function predecessorMontageCompositionSources(scene:Scene,scenes:Scene[]):Scene[]{
  const requirement=scene.documentary?.requirement;if(!requirement)return [];
  const spoken=new Set(subjectWords(scene.narration));
  const subjects=new Set((requirement.identities??[]).flatMap(identity=>[identity.name,...identity.aliases??[]])
    .flatMap(subjectWords).filter(word=>spoken.has(word)));
  if(!subjects.size)return [];
  return scenes.filter(source=>{
    const doc=source.documentary,review=doc?.visualReview;
    if(source.includeInAssembly===false||!source.imagePath||!doc||doc.nativeFallback
      ||review?.status!=='accepted'||review.fastRelevance?.relevant!==true||!review.viewDescription?.trim())return false;
    const years=requirement.years??[],otherYears=doc.requirement.years??[];
    if(years.length&&otherYears.length&&!years.some(year=>otherYears.some(other=>String(other)===String(year))))return false;
    const observed=new Set(subjectWords(review.viewDescription));
    return (doc.requirement.identities??[]).flatMap(identity=>[identity.name,...identity.aliases??[]]).flatMap(subjectWords)
      .some(word=>subjects.has(word)&&observed.has(word));
  }).sort((a,b)=>a.order-b.order);
}

/** Without a text-model decision, require the saved observations to support
 * the same named subject AND details. Broad request-name overlap alone is not
 * evidence. Historical outcomes stay on their own selected sources. */
export function localMontageCutawaySources(scene:Scene,scenes:Scene[]):Scene[]{
  const doc=scene.documentary,observed=doc?.visualReview?.viewDescription;
  if(!doc?.verified||doc.visualReview?.status!=='accepted'||!observed
    ||/\b(?:won|win|lost|lose|finish|victory|defeat|died|killed|crash)\b|побед|поражен|погиб|финиш|авари/iu.test(scene.narration))return [];
  const names=doc.requirement.identities?.flatMap(i=>[i.name,...i.aliases??[]]).filter(name=>
    norm(name).length>=5&&norm(scene.narration).includes(norm(name))&&norm(observed).includes(norm(name)))??[];
  const generic=new Set(['this','that','there','their','behind','about','with','have','has','the','and','from','into','car','cars','race','racing']);
  return montageCutawaySources(scene,scenes).filter(source=>{
    const other=source.documentary,description=other?.visualReview?.viewDescription;
    if(!other?.verified||other.visualReview?.status!=='accepted'||!description)return false;
    if(doc.requirement.years?.length&&!doc.requirement.years.some(y=>other.requirement.years?.includes(y)))return false;
    const name=names.find(name=>norm(description).includes(norm(name))&&other.requirement.identities?.some(i=>norm(i.name)===norm(name)||i.aliases?.some(alias=>norm(alias)===norm(name))));
    if(!name)return false;
    const subject=new Set(subjectWords(name)),details=subjectWords(scene.narration).filter(w=>!subject.has(w)&&!generic.has(w));
    const own=new Set(subjectWords(observed)),candidate=new Set(subjectWords(description));
    return new Set(details.filter(w=>own.has(w)&&candidate.has(w))).size>=2;
  });
}

function sourceRow(s:Scene){return {id:s.id,narration:s.narration,frames:montageFrames(s),
  subject:s.documentary?.requirement.identities?.map(i=>i.name),years:s.documentary?.requirement.years,
  image:s.imagePath,video:s.videoPath,checksum:s.documentary?.checksum,verified:s.documentary?.verified,
  illustrative:s.documentary?.illustrative,manualReview:s.documentary?.manualReview?.status,trim:[s.trimStartSeconds,s.trimEndSeconds,s.playbackRate],
  observed:s.documentary?.visualReview?.viewDescription??s.documentary?.visualReview?.reason};}

function montageHash(project:Project,concepts:boolean):string{
  const montage=project.settings.assembly.documentary?.montage;
  return createHash('sha256').update(JSON.stringify({version:1,...(concepts?{concepts:1}:{}),script:project.videoBrief?.readyScript,language:project.language,settings:montage&&{style:montage.style,intensity:montage.intensity,hookSeconds:montageHookSeconds(project),...(montage.graphicsDensity?{graphicsDensity:montage.graphicsDensity}:{})},
    scenes:project.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order).map(sourceRow)})).digest('hex');
}
export function semanticMontageHash(project:Project):string{
  const settings=project.settings.assembly.documentary;
  return montageHash(project,settings?.autoMotionGraphics!==false&&settings?.montage?.style==='editorial'&&settings.montage.intensity==='rich');
}

/** Keep an already attached drawing and its link together across semantic caches. */
function retainArtworkSpan(direction:Direction,scene:Scene,batch:Scene[]):Direction {
  const existing=scene.documentary?.semanticMontage;
  if(!direction.artworkSpan&&!existing?.artworkSpan)return direction;
  const {artworkSpan:_span,artwork:_artwork,...base}=direction;
  if(direction.composition||direction.chapter||direction.explanation||direction.artworkMode==='photographic')return base;
  const linked=(candidate:Partial<Direction>|undefined)=>{
    const artwork=candidate?.artwork,endSceneId=candidate?.artworkSpan?.endSceneId;
    const first=batch.findIndex(s=>s.id===scene.id),last=batch.findIndex(s=>s.id===endSceneId);
    if(typeof endSceneId!=='string'||first<0||last<=first||last-first>=8||!artwork||artwork.version!==1||artwork.layout!=='full'
      ||!Array.isArray(artwork.layers)||artwork.layers.length<3||artwork.layers.some(l=>!l||l.kind==='media')
      ||!Number.isFinite(artwork.canvas?.width)||!Number.isFinite(artwork.canvas?.height)||artwork.canvas.width<=0||artwork.canvas.height<=0
      ||!artwork.palette||Object.values(artwork.palette).length!==4||Object.values(artwork.palette).some(c=>!/^#[\da-f]{6}$/iu.test(c))
      ||!Number.isFinite(artwork.durationSeconds)||artwork.durationSeconds<=0)return undefined;
    return {artwork,artworkSpan:{endSceneId},artworkMode:'standalone' as const};
  };
  const retained=linked(direction)??(!direction.artworkSpan||direction.artworkSpan.endSceneId===existing?.artworkSpan?.endSceneId?linked(existing):undefined);
  return retained?{...base,...retained}:direction.artworkSpan?base:direction;
}

/** One grounded thought; offsets enforce chronology even within a single scene. */
export function validateMontageArtworkBrief(value:unknown,span:Scene[]):Direction['artworkBrief'] {
  if(!value||typeof value!=='object'||!span.length||span.length>4)return;
  const brief=value as NonNullable<Direction['artworkBrief']>;
  if(!['object','cutaway','system','sequence','comparison'].includes(brief.view)
    ||!Array.isArray(brief.phaseQuotes)||brief.phaseQuotes.length<2||brief.phaseQuotes.length>4)return;
  const canon=(text:string)=>text.toLocaleLowerCase().replace(/\s+/gu,' ').trim();
  const quote=(text:unknown):text is string=>typeof text==='string'&&text.trim().length>0&&text.trim().length<=90;
  if(!quote(brief.subjectQuote)||!brief.phaseQuotes.every(quote))return;
  const narrations=span.map(scene=>canon(scene.narration)),phases=brief.phaseQuotes.map(canon);
  if(!narrations.some(text=>text.includes(canon(brief.subjectQuote)))||new Set(phases).size!==phases.length)return;
  const text=narrations.join(' '),lastStart=narrations.slice(0,-1).reduce((sum,text)=>sum+text.length+1,0);
  let after=0;
  for(const [i,phase] of phases.entries()){
    const at=text.indexOf(phase,after);
    if(at<0||i===0&&at+phase.length>narrations[0]!.length||i===phases.length-1&&at<lastStart)return;
    after=at+phase.length;
  }
  return {view:brief.view,subjectQuote:brief.subjectQuote.trim(),phaseQuotes:brief.phaseQuotes.map(text=>text.trim()),
    ...(span.length>1?{endSceneId:span.at(-1)!.id}:{})};
}

function montageArtworkBrief(value:unknown,scene:Scene,all:Scene[]):Direction['artworkBrief'] {
  const endId=(value as Direction['artworkBrief'])?.endSceneId,start=all.findIndex(s=>s.id===scene.id);
  const end=endId===undefined?start:all.findIndex(s=>s.id===endId);
  if(start<0||end<start||end-start>3)return;
  const span=all.slice(start,end+1),frames=span.reduce((sum,s)=>sum+montageFrames(s),0);
  if(frames<90||frames>660||!span.every(documentaryExplanationEditable))return;
  return validateMontageArtworkBrief(value,span);
}

export function validateMontageDirections(raw:unknown,batch:Scene[],all:Scene[],project?:Project):Direction[]{
  const rows=raw&&typeof raw==='object'&&Array.isArray((raw as {scenes?:unknown}).scenes)?(raw as {scenes:unknown[]}).scenes:[];
  const chapters=project?mapScriptChapters(project):new Map();
  return batch.map(scene=>{
    const row=rows.find(v=>v&&typeof v==='object'&&(v as Direction).sceneId===scene.id) as Partial<Direction>|undefined;
    const literal=(s:unknown)=>narrated(scene,s);
    const subject=literal(row?.subject)??scene.documentary?.requirement.identities?.find(i=>norm(scene.narration).includes(norm(i.name)))?.name??'';
    const allowed=new Set(montageCutawaySources(scene,all).map(s=>s.id));
    const replacement=replacementCutawaySource(scene,all,row);
    if(replacement)allowed.add(replacement.id);
    const beats=['establish','conflict','evidence','explain','turn','resolve'];
    const treatments=['footage','archive','television','map','subject','statistic','quote'];
    const dramatic=row?.beat==='conflict'||row?.beat==='turn';
    const composition=montageComposition(row?.composition,scene,all);
    const artworkMode=validArtworkMode(row?.artworkMode);
    const direction:Direction={sceneId:scene.id,subject,location:literal(row?.location),emphasis:literal(row?.emphasis),language:project?.language,
      composition:composition&&compositionFields(composition),
      explanation:validateDocumentaryExplanation(row?.explanation,scene,batch),
      ...(row?.artworkBrief?{artworkBrief:montageArtworkBrief(row.artworkBrief,scene,all)}:{}),
      ...(validateSceneDirection(row?.sceneDirection)?{sceneDirection:validateSceneDirection(row?.sceneDirection)}:{}),
      ...(artworkMode?{artworkMode}:{}),
      ...(replacement?{cutawayMode:'replace' as const}:{}),
      chapter:chapters.get(scene.id),vignette:dramatic&&row?.vignette===true||undefined,monochrome:dramatic&&row?.monochrome===true||undefined,
      beat:beats.includes(row?.beat??'')?row!.beat!:'evidence',
      treatment:treatments.includes(row?.treatment??'')?row!.treatment!:'footage',
      cutawaySceneIds:Array.isArray(row?.cutawaySceneIds)?[...new Set(row.cutawaySceneIds.filter(id=>typeof id==='string'&&allowed.has(id)))].slice(0,2):[]};
    return retainArtworkSpan(row?.artworkSpan?{...direction,artwork:row.artwork,artworkSpan:row.artworkSpan}:direction,scene,batch);
  });
}

/** Ignore malformed cues locally; never buy a separate repair/music-only request. */
export function validateMusicSections(raw:unknown,scenes:Scene[],wholeFilm=true):DocumentaryMusicSection[]|undefined{
  if(!Array.isArray(raw))return undefined;
  const result:DocumentaryMusicSection[]=[],roles=['hook','narration','turn','climax','resolution'],moods=['tension','reflective','energetic','discovery','calm','silence'];
  let end=-1;
  // Duration/overlap guards below reject per-shot cues. A duration-derived
  // quota can discard an otherwise valid final section of a completed plan.
  for(const candidate of raw.slice(0,12)){
    if(!candidate||typeof candidate!=='object')continue;
    const cue=candidate as DocumentaryMusicSection,start=scenes.findIndex(s=>s.id===cue.startSceneId),last=scenes.findIndex(s=>s.id===cue.endSceneId);
    if(start<=end||last<start||!roles.includes(cue.role)||!moods.includes(cue.mood))continue;
    const seconds=scenes.slice(start,last+1).reduce((sum,s)=>sum+montageFrames(s)/30,0);
    // A musical span normally outlives several five-second shots. Keep deliberate
    // pauses and the opening flexible; do not silently merge unrelated moods.
    if(cue.mood!=='silence'&&seconds<12&&!(start===0&&cue.role==='hook')&&last!==scenes.length-1)continue;
    result.push({startSceneId:cue.startSceneId,endSceneId:cue.endSceneId,role:cue.role,mood:cue.mood});end=last;
  }
  return wholeFilm?withoutWholeFilmBed(result,scenes):result;
}

function withoutWholeFilmBed(result:DocumentaryMusicSection[],scenes:Scene[]):DocumentaryMusicSection[]{
  // Apply only after joining paid batches: a later batch can legitimately
  // continue a narrative span that follows a different opening mood.
  // Do not turn a malformed long-film answer into the old one-bed behavior.
  // The absent arrangement remains a timed request; no invented musical edit.
  if(result.length===1&&result[0]!.mood!=='silence'&&result[0]!.startSceneId===scenes[0]?.id&&result[0]!.endSceneId===scenes.at(-1)?.id
    &&scenes.reduce((sum,s)=>sum+montageFrames(s)/30,0)>90)return [];
  return result;
}

function attachDirections(scenes:Direction[],project:Project,musicSections?:DocumentaryMusicSection[]):Direction[]{
  const chapters=mapScriptChapters(project),sections=new Map(musicSections?.map(section=>[section.startSceneId,section]));
  let seconds=0,lastAccent=-45;
  const starts=new Map(project.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order).map(s=>{const at=seconds;seconds+=montageFrames(s)/30;return [s.id,at];}));
  const attached=scenes.map(direction=>{
    const start=starts.get(direction.sceneId)??0,accent=(direction.vignette||direction.monochrome)&&start-lastAccent>=40;
    if(accent)lastAccent=start;
    const {artworkMode:rawArtworkMode,...rest}=direction,artworkMode=validArtworkMode(rawArtworkMode);
    const attached={...rest,...(artworkMode?{artworkMode}:{}),language:project.language,chapter:chapters.get(direction.sceneId),musicSection:sections.get(direction.sceneId),
      vignette:accent&&direction.vignette||undefined,monochrome:accent&&direction.monochrome||undefined};
    const scene=project.scenes.find(s=>s.id===direction.sceneId);
    return scene?retainArtworkSpan(attached,scene,project.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order)):attached;
  });
  // Resolve whole thoughts after joining batches: an insert can finish in the
  // three supplied continuation scenes, but cannot erase their evidence/manual work.
  const byId=new Map(attached.map(row=>[row.sceneId,row]));
  const all=project.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order)
    .map(s=>s.documentary?{...s,documentary:{...s.documentary,semanticMontage:byId.get(s.id)}}:s);
  const briefs=new Map<string,NonNullable<Direction['artworkBrief']>>(),covered=new Set<string>();
  for(const scene of all){
    const brief=montageArtworkBrief(byId.get(scene.id)?.artworkBrief,scene,all);
    if(!brief)continue;
    const start=all.indexOf(scene),end=brief.endSceneId?all.findIndex(s=>s.id===brief.endSceneId):start,span=all.slice(start,end+1);
    if(span.some(s=>covered.has(s.id)||s.documentary?.semanticMontage?.chapter||documentaryExplanationKeepsEvidence(s,all)))continue;
    briefs.set(scene.id,brief);span.forEach(s=>covered.add(s.id));
  }
  return attached.map(row=>covered.has(row.sceneId)?{...row,artworkBrief:briefs.get(row.sceneId),explanation:undefined,composition:undefined,emphasis:undefined}
    :row.artworkBrief?{...row,artworkBrief:undefined}:row);
}

/** Read only finished compact batches for this exact source edit. Never enter
 * Intelligence, parse an uncertain receipt or manufacture a full-plan cache. */
export async function readCompletedMontageBatches(project:Project,root:string,signal?:AbortSignal):Promise<{inputHash:string;scenes:Direction[]}|undefined>{
  const inputHash=semanticMontageHash(project),directory=join(root,'Documentary','Montage');
  const readJson=async(file:string)=>readFile(file,'utf8').then(JSON.parse).catch((error:NodeJS.ErrnoException)=>{
    if(error.code==='ENOENT'||error instanceof SyntaxError)return undefined;throw error;
  });
  signal?.throwIfAborted();
  const manifest=await readJson(join(directory,`${inputHash}-batches.json`));
  if(manifest?.version!==2||manifest.inputHash!==inputHash)return;
  const all=project.scenes.filter(scene=>scene.includeInAssembly!==false).sort((a,b)=>a.order-b.order);
  const scenes:Direction[]=[],musicSections:DocumentaryMusicSection[]=[];
  for(const [index,batch] of compactMontageBatches(all).entries()){
    signal?.throwIfAborted();
    const saved=await readJson(join(directory,`${inputHash}-compact-${index}.json`));
    if(saved?.version!==1||saved.inputHash!==inputHash||!Array.isArray(saved.scenes)||saved.scenes.length!==batch.length
      ||!batch.every(scene=>saved.scenes.filter((row:unknown)=>row&&typeof row==='object'&&(row as Direction).sceneId===scene.id).length===1))continue;
    scenes.push(...validateMontageDirections(saved,batch,all,project));
    musicSections.push(...validateMusicSections(saved.musicSections,batch,false)??[]);
  }
  signal?.throwIfAborted();
  return scenes.length?{inputHash,scenes:attachDirections(scenes,project,musicSections)}:undefined;
}

/** Uses the existing paid-request/checkpoint machinery supplied by Intelligence. */
export async function createSemanticMontagePlan(project:Project,root:string,complete:(system:string,input:string)=>Promise<Record<string,unknown>>,model:string,signal?:AbortSignal):Promise<DocumentarySemanticMontage>{
  const inputHash=semanticMontageHash(project),directory=join(root,'Documentary','Montage'),path=join(directory,`${inputHash}.json`);
  const readPlan=(file:string)=>readFile(file,'utf8').then(JSON.parse).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT'||error instanceof SyntaxError)return undefined;throw error;}) as Promise<DocumentarySemanticMontage|undefined>;
  const cached=await readPlan(path);
  if(cached?.version===1&&cached.inputHash===inputHash){validateSemanticMontagePlan(cached,project);return {...cached,scenes:attachDirections(cached.scenes,project,cached.musicSections)};}
  // Retain already assembled films under their exact predecessor hash. A new
  // directing contract never grants a new paid commission for this source edit.
  const legacyHash=montageHash(project,false),legacy=inputHash!==legacyHash?await readPlan(join(directory,`${legacyHash}.json`)):undefined;
  if(legacy?.version===1&&legacy.inputHash===legacyHash){
    const reused={...legacy,inputHash};validateSemanticMontagePlan(reused,project);
    return {...reused,scenes:attachDirections(reused.scenes,project,reused.musicSections)};
  }
  const all=project.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order);
  const scenes:Direction[]=[],directionWarnings:string[]=[];
  const musicSections:DocumentaryMusicSection[]=[];let hasMusicPlan=false;
  const aliases=new Map(all.map((scene,index)=>[scene.id,`s${index}`])),ids=new Map([...aliases].map(([id,alias])=>[alias,id]));
  await mkdir(directory,{recursive:true});
  const legacySystem='You are a documentary editor. Return JSON {scenes:[{sceneId,subject,location?,beat,emphasis?,treatment,cutawaySceneIds:[]}]}. '
    +'Plan meaning and rhythm, not decoration. Subject, location and emphasis must be exact short quotations from that scene narration. '
    +'beat: establish|conflict|evidence|explain|turn|resolve; treatment: footage|archive|television|map|subject|statistic|quote. '
    +'Opening 10–20 seconds: establish stakes, vary supporting shots where the approved sources explain the SAME claim. '
    +'Choose 0–2 cutawaySceneIds only from that row allowedSources, only if their observed content and period support this narration. '
    +'Do not turn later victory footage into proof of an earlier defeat or generic footage into a named event. Empty cuts are correct when sources do not fit. '
    +'Requested subjects/years describe the narration request, NOT verified source content. User-accepted illustrative/manual-review sources may support an idea editorially, never prove a historical event. '
    +'Use map only when geography is being explained, never for a company/person with a geographic name. '
    +'Use subject only for an explicitly introduced person/object visible in the selected image. Television only for actual broadcast/interview/archive context, occasionally. '
    +'Use statistic only with an exact quantity in emphasis, quote only for actual quoted speech. Most body scenes remain footage. No invented facts, captions or coordinates.';
  const previousSystem=legacySystem.replace('cutawaySceneIds:[]}]','cutawaySceneIds:[],vignette?,monochrome?}],musicSections:[{startSceneId,endSceneId,role,mood}]')
    +' Keep every displayed word in the narration language. No subtitles, translated English placeholders, chapter titles or chapter numbers: explicit original-script chapters are mapped locally. '
    +'Optionally suggest vignette and/or color-to-monochrome only for a rare dramatic conflict or turn, at least 40 seconds apart. '
    +'Use musicSections for a modest number of contiguous narrative spans across this batch (usually 20–90 seconds, opening 10–20), never one cue for every shot or an unchanged whole-film bed. '
    +'role: hook|narration|turn|climax|resolution; mood: tension|reflective|energetic|discovery|calm|silence. Develop musical character as the story changes; deliberate silence is valuable, especially for a reveal/loss. '
    +'Each span includes both boundary scenes; cover the batch once without overlap. Use mood silence explicitly for pauses; no invented tracks, no speed changes. Continue the preceding span when the story continues.';
  const rossiSystem=previousSystem
    +' Rossi reference compositions: optionally add composition:{kind,variant?,title?,kicker?,value?,items?,cards?:[{label,value?,sceneId?}],boardLayout?,highlight?} to a scene. This is the SAME plan, not another analysis. '
    +'Choose a composition only when it explains this narrative beat better than ordinary footage. Most scenes keep footage and omit composition/emphasis. No every-N-scene patterns or quotas. '
    +'All titles, roles, labels, values, items and highlights must be exact excerpts from THAT scene narration, in its language. No invented facts, attribution, placeholder text or full subtitles. '
    +'Available families: subject-card (clean portrait entrance, collage paper introduction, poster circle/glow) for a visible introduced person/object; '
    +'explainer with boardLayout parts|steps for evidence/document cards or a sequential summary, cards sceneId only this scene or allowedSources; '
    +'explainer boardLayout compare for an actual comparison, clean split sides, collage paper cards or poster circular images. Label each source accurately; do not swap identities. '
    +'key-point variant marker for a short important phrase, poster for rare kinetic thesis (at most 8 words, never the whole narration); quote marker|collage only for actual quoted speech, highlight an exact part. '
    +'statistic for an exact quantity in value; bar-chart for 2–5 cards {label,value} with comparable numeric values and identical units; never infer quantities from years. '
    +'chronology with a literal year in value, or variant date with an exact date including its year; map-locator title names the narrated place, map-route items lists 2–5 narrated resolved places. '
    +'annotations technical for visible-detail callouts or magnifier for a close inspection, only for a narrated physical detail supported by the saved observed source description; optional title selects one exact detail label. Locally reuse saved confident annotations or omit the composition. Never supply anchors/coordinates. '
    +'chapter-number is NOT a model choice: only actual script headings are mapped locally. Do not invent chapters or convert an ordinary phrase into a chapter. '
    +'Use clean|collage|poster variants by meaning and source geometry. Full compositions need entrance, explanation and a readable hold within scene seconds; short text/date accents must leave breathing room. '
    +'A missing optional cutout or detail is ordinary footage, not a reason for another request. Preserve source motion and use vignette/monochrome only for an occasional dramatic turn. No 3D or media discovery.';
  const paceSystem=rossiSystem
    +' Narrative pace: the footage-first guidance above applies mainly to the body. Shape the opening hookSeconds as stakes or contradiction, a meaningful visual shift, then the narrated question or promise, wherever the script supports that progression. '
    +'Actively use suitable approved cutaways and a brief exact key phrase for the strongest opening beat; a short key-point may accompany those cuts. Keep source-bound callouts and full compositions on their intended sources for a readable hold. '
    +'After the hook, settle gradually into longer footage holds. Choose supporting cutaways for conflict, explanation, evidence and turns when the approved content adds meaning; hold when it does not. Space accents around completed reading and narrative changes, not a fixed scene count. '
    +'Use only the supplied narration and approved sources; omit any unsupported hook step. Do not invent a question, promise, heading or fact, or request more analysis or media.';
  const compositionSystem=paceSystem
    +' Composition fields: key-point requires title (a short exact phrase, not value); quote requires title containing actual quoted speech, with optional highlight inside it. statistic requires value; explainer requires cards or items. '
    +'For a narrated contrast, consider explainer boardLayout compare with two exact text labels before choosing a generic key-point. Text-only cards omit sceneId and compare ideas on the chosen background; they do not identify the footage. '
    +'Use image-bound cards only when observed sources support their labels; never label an unknown car or factory as a named brand. A narrated ratio can use statistic, a relationship or process can use explainer, and geography can use a map. '
    +'Choose these only when they clarify the current narration and fit its reading time. Keep exact source-language wording, no invented facts, quotas, or forced comparisons.';
  const artworkSystem=compositionSystem
    +' Artwork intent: optionally add artworkMode: photographic|standalone to each scene in this SAME semantic plan. This is an editorial choice, not another API stage or a request for new media. '
    +'Choose photographic when the beat concerns a visible subject or event supported by the observed selected source; preserve the real source and only point to details actually visible in it. '
    +'Choose standalone for an unseen causal mechanism, process, or numerical relationship that the photograph cannot explain by itself. Explain the narrated relationship independently; do not attach invented measurements or physical claims to illustrative footage. '
    +'A narrated time interval or time difference must not become a distance ruler or pseudo-measurement over photographed objects. Choose standalone when explaining that quantity; preserve exact narrated values and units without inferring new data. '
    +'Base this choice on what the audience needs to understand and what the source actually shows, for any topic. This mode does not itself request a graphic for every scene; omit it when no meaningful choice is supported.';
  const bindingSystem=artworkSystem
    +' For a concrete narrated contrast, first use two already accepted observed sources with explicit cards sceneId references when both sides are actually shown; each label must remain a literal excerpt from this scene narration. '
    +'Assign each reference from its own saved visual observation, never requestedSubjects, search titles or source order. An owner mentioned in an observation is not necessarily visible: "Rossi\'s motorcycle" identifies the motorcycle, not a portrait of Rossi. '
    +'For abstract comparisons, or when suitable observed material is missing for either side, omit both sceneId references and use an intentionally text-only comparison. Do not request new footage or another review.';
  const catalogSystem=bindingSystem
    +' Source catalogs: allowedSources remains the restricted list for cutawaySceneIds. For explainer boardLayout compare, use explicit cards sceneId from that scene compositionSources instead; these are accepted observed image/poster sources compatible with the named subjects and requested period, not additional cutaways. '
    +'A source can mention several entities or an owner without picturing all of them: choose the actual visible subject from observed. Missing compositionSources means no accepted comparison catalog; keep the comparison text-only. Never broaden cutawaySceneIds using compositionSources.';
  const sourceBridgeSystem=catalogSystem
    +' For a brief narrative bridge, a single-image explainer boardLayout parts with one card {label,sceneId} makes that approved image the main full-frame material; it is not a thumbnail. '
    +'Use a short exact narrated label and a source from this scene or allowedSources whose observed content supports the story context. A previous approved image can continue across a reflective bridge without pretending to show an unseen event. '
    +'Use this only when the alternative source materially improves the scene; omit generic visual decoration and do not repeat the same photograph merely to fill time.';
  const accumulatedSystem=sourceBridgeSystem+documentaryExplanationDirection;
  const previousAccumulatedSystem=accumulatedSystem.replace(documentaryExplanationSemantics,'');
  const previousRatioSystem=documentaryEditorialSystem+'\nA statistic with a literal X of Y ratio may add composition.ratioGroups:[{amount,label,sourceQuote}] when the script explicitly identifies a contribution inside X. Use 2–3 groups: first one or two sum to X; the last is Y−X. For three groups the first amount is explicit, the second may be X−first. Copy labels and sourceQuote verbatim from THIS narration. The sourceQuote for an explicit contribution must include its number; for a calculated remainder use the stated ratio or the exact phrase identifying the remaining contributors. Never invent categories, incompatible units or an extra count. Omit groups when the partition is ambiguous.';
  const previousBriefSystem=previousRatioSystem+`
ARTWORK WITHIN THIS EDIT
This montage is the only selection/storyboard pass before artwork authoring. For each useful physical, spatial or photographic explanation, put artworkBrief:{view:"object"|"cutaway"|"system"|"sequence"|"comparison",subjectQuote,phaseQuotes:[string,string,...],endSceneId?} on its FIRST scene. State what the viewer must see change: 2–4 short exact narration quotes in chronological order, first in the first scene and last in the last. Choose a complete thought of 1–4 adjacent scenes, 3–22 seconds, including artworkContinuations when needed. Only scenes marked artworkEditable may participate. Continuations provide context/boundaries, not extra output rows. Later covered rows omit artworkBrief/explanation/composition/emphasis. Use brief for concrete subjects/actions; use native explanation only for genuinely abstract flow/branch/cycle relationships. Preserve accepted image comparisons, factual maps/charts and commissioned artwork. Keep historical action/emotion in real footage when no added visual argument is warranted. Leave ordinary footage between inserts; there is no count to fill.
The brief gives meaning, not layer design: the artwork author chooses suitable observed media or an honest no-media illustration and supplies its timed direction.beats. View describes a useful perspective, not invented anatomy. Vary subject, action and order of observations across the story. Use artworkMode only when evidence actually constrains that choice. Omit the brief when it adds no understanding; no separate concept request follows.`;
  const previousDensitySystem=previousBriefSystem+`
CURRENT EDITING DENSITY
This direction supersedes older footage-first and occasional-television guidance. Use the supplied hookSeconds for a dense opening, then settle into longer holds. Actively cover suitable explanations, comparisons, important numbers, names and dates with a composition or short exact accent; prioritize the hook and major turns. Television is also an allowed treatment of ordinary footage and must not imply an invented broadcast attribution. Ordinary footage remains between explanations, with changes of visual treatment about every 15–25 seconds in the body. Use no full subtitles, invented facts or forced diagrams. Keep complete explanations readable. Motion, short text, layouts and colour-to-monochrome emphasis share this existing edit pass; do not request extra analysis.`;
  const system=previousDensitySystem+`
SOURCE ELIGIBILITY
sourceTitle is unverified discovery metadata, never an observation. observed is present only for a saved actual-frame review. footageIssue is an explicit contradiction between this selected source and its requested object, not just a missing review. Do not use that source as footage, archive, television, a media card or a photographic artwork. Choosing a treatment or illustrative=true cannot repair a mismatch. An approximate source without a contradiction remains available with its manual-review status; missing verification alone does not exclude it. When a source is unsuitable, commission a standalone no-media visual argument only if the narrated relationship warrants one, or choose a suitable allowed replacement. A standalone replacement must fill the whole scene from time zero. Otherwise leave the material unresolved; do not invent a diagram, source or successful match.`;
  const previousEditorialSystem=documentaryEditorialSystem.replace(documentaryExplanationSemantics,'');
  // Keep this serializer byte-for-byte compatible with the previous 64-scene
  // requests. Their receipts must be discovered BEFORE choosing smaller ranges.
  const previousBatchInput=(batch:Scene[],index:number,cutawaySources=predecessorMontageCutawaySources)=>{
    const sourceIds=new Set(batch.flatMap(s=>[s.id,...cutawaySources(s,all).map(s=>s.id)]));
    return JSON.stringify({version:1,inputHash:legacyHash,hookSeconds:montageHookSeconds(project),style:project.settings.assembly.documentary?.montage?.style,intensity:project.settings.assembly.documentary?.montage?.intensity,
      language:project.language,previousMusicSection:musicSections.at(-1),before:all[index-1]?.narration,after:all[index+batch.length]?.narration,
      sources:all.filter(s=>sourceIds.has(s.id)).map(s=>({id:aliases.get(s.id),kind:s.videoPath?'video':'image',
        requestedSubjects:s.documentary?.requirement.identities?.map(i=>i.name),requestedYears:s.documentary?.requirement.years,
        observed:(s.documentary?.visualReview?.viewDescription??s.documentary?.visualReview?.reason??s.documentary?.selected?.title??'').slice(0,260),
        illustrative:s.documentary?.illustrative,manualReview:s.documentary?.manualReview?.status})),
      scenes:batch.map(s=>({sceneId:aliases.get(s.id),narration:s.narration,startSeconds:Math.round(all.slice(0,all.indexOf(s)).reduce((sum,s)=>sum+montageFrames(s)/30,0)*10)/10,
        seconds:Math.round(montageFrames(s)/3)/10,allowedSources:cutawaySources(s,all).map(s=>aliases.get(s.id))}))});
  };
  const batchInput=(batch:Scene[],index:number,fresh=false)=>{
    const previous=previousBatchInput(batch,index,fresh?montageCutawaySources:predecessorMontageCutawaySources);
    const compositionSources=fresh?montageCompositionSources:predecessorMontageCompositionSources;
    const candidates=new Map(batch.map(scene=>[aliases.get(scene.id)!,compositionSources(scene,all)]));
    if(![...candidates.values()].some(sources=>sources.length))return previous;
    const payload=JSON.parse(previous);
    const sourceIds=new Set<string>(payload.sources.map((source:{id:string})=>source.id));
    for(const sources of candidates.values())for(const source of sources)sourceIds.add(aliases.get(source.id)!);
    const previousSources=new Map<string,unknown>(payload.sources.map((source:{id:string})=>[source.id,source]));
    payload.sources=all.filter(source=>sourceIds.has(aliases.get(source.id)!)).map(source=>previousSources.get(aliases.get(source.id)!)??{
      id:aliases.get(source.id),kind:source.videoPath?'video':'image',
      requestedSubjects:source.documentary?.requirement.identities?.map(identity=>identity.name),requestedYears:source.documentary?.requirement.years,
      observed:source.documentary!.visualReview!.viewDescription!.slice(0,260),
      illustrative:source.documentary?.illustrative,manualReview:source.documentary?.manualReview?.status});
    payload.scenes=payload.scenes.map((row:{sceneId:string})=>({...row,compositionSources:(candidates.get(row.sceneId)??[]).map(source=>aliases.get(source.id))}));
    return JSON.stringify(payload);
  };
  const chapters=mapScriptChapters(project);
  const artworkContext=(scene:Scene,fresh=false)=>({sceneId:aliases.get(scene.id),narration:scene.narration,seconds:montageFrames(scene)/30,
    artworkEditable:project.settings.assembly.documentary?.autoMotionGraphics!==false
      &&project.settings.assembly.documentary?.montage?.style==='editorial'&&project.settings.assembly.documentary?.montage?.intensity==='rich'
      &&documentaryExplanationEditable(scene)&&!chapters.has(scene.id)&&!documentaryExplanationKeepsEvidence(scene,all,fresh?montageCutawaySources:predecessorMontageCutawaySources)});
  const previousDirectedInput=(batch:Scene[],index:number,fresh=false)=>{
    const payload=JSON.parse(batchInput(batch,index,fresh));
    payload.scenes=payload.scenes.map((row:Record<string,unknown>,i:number)=>({...row,artworkEditable:artworkContext(batch[i]!,fresh).artworkEditable}));
    payload.artworkContinuations=all.slice(index+batch.length,index+batch.length+3).map(scene=>artworkContext(scene,fresh));
    return JSON.stringify(payload);
  };
  const directedInput=(batch:Scene[],index:number)=>{
    const payload=JSON.parse(previousDirectedInput(batch,index,true));
    payload.sources=payload.sources.map((row:{id:string})=>{
      const source=all.find(s=>aliases.get(s.id)===row.id)!;
      return {...row,sourceTitle:source.documentary?.selected?.title,
        observed:source.documentary?.visualReview?.viewDescription??source.documentary?.visualReview?.reason,
        reviewStatus:source.documentary?.visualReview?.status,footageIssue:documentarySourceFootageIssue(source)};
    });
    payload.scenes=payload.scenes.map((row:Record<string,unknown>,i:number)=>({...row,footageIssue:documentarySourceFootageIssue(batch[i]!)}));
    return JSON.stringify(payload);
  };
  // Keep every predecessor serializer intact: only a fresh request advertises
  // the existing primary-source mode and its own, runtime-identical catalog.
  const replacementInput=(input:string,batch:Scene[])=>{
    const payload=JSON.parse(input),catalog=new Map(batch.map(scene=>[aliases.get(scene.id)!,montageReplacementSources(scene,all)]));
    payload.scenes=payload.scenes.map((row:{sceneId:string})=>({...row,replacementSources:(catalog.get(row.sceneId)??[]).map(source=>aliases.get(source.id))}));
    const sourceIds=new Set<string>(payload.sources.map((source:{id:string})=>source.id));
    for(const sources of catalog.values())for(const source of sources)if(!sourceIds.has(aliases.get(source.id)!)){
      sourceIds.add(aliases.get(source.id)!);
      payload.sources.push({id:aliases.get(source.id),kind:source.videoPath?'video':'image',
        requestedSubjects:source.documentary?.requirement.identities?.map(identity=>identity.name),requestedYears:source.documentary?.requirement.years,
        sourceTitle:source.documentary?.selected?.title,observed:source.documentary?.visualReview?.viewDescription??source.documentary?.visualReview?.reason,
        reviewStatus:source.documentary?.visualReview?.status,illustrative:source.documentary?.illustrative,manualReview:source.documentary?.manualReview?.status});
    }
    return JSON.stringify(payload);
  };
  const replacementSystem=system+`
PRIMARY SOURCE FOR THE SELECTED STORYBOARD
Optionally add cutawayMode:"replace" with exactly one cutawaySceneIds:[id] from that row replacementSources. This existing mode makes that already selected local source the whole scene from time zero, without the scene's original shot first. Choose it when the source's actual observed content supports the selected storyboard better than the original source. It is a silent editorial illustration, never proof of a named event, identity or period. Missing observed content does not verify identity; retain its approximate/manual-review limits. Do not request new media, coordinates, layers or invented camera tracking.
replacementSources is separate from allowedSources (supplemental cuts) and compositionSources (image cards); never broaden either catalog. Omit replace when no source fits. A replacement may accompany an exact literal typography action with a readable hold, but not composition/artworkBrief/artwork/explanation/chapter or another source-bound graphic. State the selected idea honestly for the available whole source; metadata cannot isolate people or create depth. No authored cuts, paths, timing or source selection changes.`;
  const readOptional=async(file:string)=>readFile(file,'utf8').catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});
  const savedRequest=async(requests:Array<{system:string;input:string}>)=>{
    for(const request of requests){
      // Re-enter the paid checkpoint with its original bytes, including the
      // pre-objectType vocabulary. The scene/material input must match exactly.
      for(const system of new Set([request.system,preObjectTypeMontageSystem(request.system)])){
        const key=documentaryCheckpointKey('semantic-montage',system,request.input,[]);
        if(await readOptional(join(root,'Documentary','Analysis',key+'.json'))!==undefined)return {system,input:request.input};
      }
    }
  };
  const predecessors=(input:string)=>{
    const {language:_language,previousMusicSection:_previous,...legacyPayload}=JSON.parse(input);
    return [{system:legacySystem,input:JSON.stringify(legacyPayload)},... [previousSystem,rossiSystem,paceSystem,compositionSystem,artworkSystem,bindingSystem].map(system=>({system,input}))];
  };
  const manifestPath=join(directory,`${inputHash}-batches.json`);
  const manifestText=await readOptional(manifestPath);
  let compact=false,storyContext:ReturnType<typeof documentaryAiPlanContext>|undefined;
  if(manifestText!==undefined){
    // A corrupt strategy must not silently select a different paid key.
    const manifest=JSON.parse(manifestText) as {version?:number;inputHash?:string;storyContext?:typeof storyContext};
    if(manifest.version!==2||manifest.inputHash!==inputHash||manifest.storyContext!==undefined
      &&(typeof manifest.storyContext.originalScript!=='string'||!Array.isArray(manifest.storyContext.contextScenes)))throw new DocumentarySemanticMontageError('[no-retry] Повреждена схема монтажных батчей. Автоматическая повторная оплата отключена.');
    storyContext=manifest.storyContext;
    compact=true;
  }else{
    let legacy=await readOptional(join(directory,`${inputHash}-batch-0.json`))!==undefined;
    // Every later old batch follows either a first receipt or batch-0 saved by
    // this planner. Even pending/partial/failed first receipts retain 64 ranges.
    const current64=JSON.parse(directedInput(all.slice(0,64),0));
    const openingSystem=directedMontageSystem(replacementSystem);
    const opening64=[{...current64,previousDirections:[]},{...current64,storyContext:documentaryAiPlanContext(project),previousDirections:[]}]
      .flatMap(payload=>[openingSystem,sparseMontageDirection(openingSystem,true),sparseMontageDirection(openingSystem)].map(system=>({system,input:replacementInput(JSON.stringify(payload),all.slice(0,64))})));
    legacy=legacy||Boolean(await savedRequest([...opening64,{system:directedMontageSystem(system),input:JSON.stringify({...current64,previousDirections:[]})},
      {system:directedMontageSystem(system),input:JSON.stringify({...current64,storyContext:documentaryAiPlanContext(project),previousDirections:[]})},
      {system,input:directedInput(all.slice(0,64),0)},...[previousDensitySystem,previousBriefSystem].map(system=>({system,input:previousDirectedInput(all.slice(0,64),0)})),...predecessors(previousBatchInput(all.slice(0,64),0)),...[catalogSystem,sourceBridgeSystem,previousAccumulatedSystem,previousEditorialSystem,accumulatedSystem,documentaryEditorialSystem,previousRatioSystem].map(system=>({system,input:batchInput(all.slice(0,64),0)}))]));
    compact=!legacy;
    if(compact){storyContext=documentaryAiPlanContext(project);await atomicWrite(manifestPath,JSON.stringify({version:2,inputHash,storyContext}));}
  }
  const batches=compact?compactMontageBatches(all):Array.from({length:Math.ceil(all.length/64)},(_,i)=>all.slice(i*64,i*64+64));
  let index=0;
  for(const [batchIndex,batch] of batches.entries()){
    signal?.throwIfAborted();
    const batchPath=join(directory,`${inputHash}-${compact?'compact':'batch'}-${batchIndex}.json`);
    const savedText=await readOptional(batchPath);
    const saved=savedText===undefined?undefined:JSON.parse(savedText) as {inputHash:string;scenes:Direction[];musicSections?:DocumentaryMusicSection[];directionVersion?:1};
    if(saved?.inputHash===inputHash&&Array.isArray(saved.scenes)&&saved.scenes.length===batch.length
      &&batch.every(s=>saved.scenes.filter(row=>row.sceneId===s.id).length===1)){
      scenes.push(...validateMontageDirections(saved,batch,all,project));
      if(saved.directionVersion===1)for(const row of saved.scenes)if(!validateSceneDirection(row.sceneDirection))
        directionWarnings.push(`${row.sceneId}: неполная режиссура — нет 3–5 различных вариантов и выбранного storyboard`);
      if(saved.musicSections){hasMusicPlan=true;musicSections.push(...validateMusicSections(saved.musicSections,batch,false)??[]);}
      index+=batch.length;continue;
    }
    const input=directedInput(batch,index),previousInput=batchInput(batch,index);
    // The schema extension must not hide an older paid request behind a new
    // prompt hash. Re-enter the exact predecessor through the existing receipt
    // and revision-bound retry guards; even a complete old answer is reusable.
    // Optional annotation enrichment is deliberately NOT added to the request
    // payload: changing it must not create a fresh key for an uncertain request.
    const historicalInput=storyContext?JSON.stringify({...JSON.parse(input),storyContext}):input;
    const directionInput=JSON.stringify({...JSON.parse(historicalInput),
      previousDirections:scenes.slice(-3).map(s=>({sceneId:s.sceneId,sceneDirection:s.sceneDirection,treatment:s.treatment}))});
    const baseRequest={system:directedMontageSystem(replacementSystem),input:replacementInput(directionInput,batch)};
    const previousSparseSystem=sparseMontageDirection(baseRequest.system,true);
    const sparse=project.settings.assembly.documentary?.montage?.graphicsDensity==='sparse';
    const freshRequest={...baseRequest,system:sparse?sparseMontageDirection(baseRequest.system):baseRequest.system};
    // Preserve every predecessor byte-for-byte, including uncertain receipts.
    // No hash bump to buy a new composition for an already planned film.
    const oldInput=previousDirectedInput(batch,index);
    // A prompt improvement is never permission to resubmit an uncertain job.
    const openingPredecessors=sparse?[{...baseRequest,system:previousSparseSystem},baseRequest]:[];
    const request=await savedRequest([
      {system:directedMontageSystem(system),input:directionInput},
      {system:system+documentarySceneDirectionSystem,input:directionInput},
      {system,input:historicalInput},...(storyContext?[{system,input}]:[]),
      ...(storyContext?[{system:previousDensitySystem,input:JSON.stringify({...JSON.parse(oldInput),storyContext})}]:[]),
      {system:previousDensitySystem,input:oldInput},{system:previousBriefSystem,input:oldInput},...predecessors(previousBatchInput(batch,index)),
      ...[catalogSystem,sourceBridgeSystem,previousAccumulatedSystem,previousEditorialSystem,accumulatedSystem,documentaryEditorialSystem,previousRatioSystem].map(system=>({system,input:previousInput})),
      ...openingPredecessors,freshRequest,
    ])??freshRequest;
    const raw=await complete(request.system,request.input);
    const response={scenes:Array.isArray(raw.scenes)?raw.scenes.map(row=>{
      if(!row||typeof row!=='object')return row;const r=row as Direction;
      return {...r,sceneId:ids.get(r.sceneId)??r.sceneId,cutawaySceneIds:Array.isArray(r.cutawaySceneIds)?r.cutawaySceneIds.map(id=>ids.get(id)??id):[],
        artworkSpan:typeof r.artworkSpan?.endSceneId==='string'?{endSceneId:ids.get(r.artworkSpan.endSceneId)??r.artworkSpan.endSceneId}:undefined,
        artworkBrief:r.artworkBrief&&typeof r.artworkBrief==='object'?{...r.artworkBrief,endSceneId:typeof r.artworkBrief.endSceneId==='string'?(ids.get(r.artworkBrief.endSceneId)??r.artworkBrief.endSceneId):undefined}:undefined,
        explanation:r.explanation&&typeof r.explanation==='object'?{...r.explanation,endSceneId:r.explanation.endSceneId?(ids.get(r.explanation.endSceneId)??r.explanation.endSceneId):undefined}:undefined,
        composition:r.composition&&typeof r.composition==='object'?{...r.composition,cards:Array.isArray(r.composition.cards)?r.composition.cards.map(card=>
          card&&typeof card==='object'?{...card,sceneId:card.sceneId?(ids.get(card.sceneId)??card.sceneId):undefined}:card):undefined}:undefined};
    }):[]};
    if(batch.some(scene=>response.scenes.filter(row=>row&&typeof row==='object'&&(row as Direction).sceneId===scene.id).length!==1))
      throw new DocumentarySemanticMontageError('[no-retry] Монтажный ответ содержит пропущенные или повторные сцены. Ответ сохранён в AI checkpoint; автоматический повтор запроса отключён.');
    const directions=validateMontageDirections(response,batch,all,project);
    if(request.system.endsWith(documentarySceneDirectionSystem))for(const row of directions)if(!row.sceneDirection)
      directionWarnings.push(`${row.sceneId}: неполная режиссура — нет 3–5 различных вариантов и выбранного storyboard`);
    const sections=validateMusicSections(Array.isArray(raw.musicSections)?raw.musicSections.map(row=>{
      if(!row||typeof row!=='object')return row;const section=row as DocumentaryMusicSection;
      return {...section,startSceneId:ids.get(section.startSceneId)??section.startSceneId,endSceneId:ids.get(section.endSceneId)??section.endSceneId};
    }):undefined,batch,false);
    if(sections){hasMusicPlan=true;musicSections.push(...sections);}
    await atomicWrite(batchPath,JSON.stringify({version:1,inputHash,scenes:directions,musicSections:sections,
      ...(request.system.endsWith(documentarySceneDirectionSystem)?{directionVersion:1}:{})},null,2));
    scenes.push(...directions);
    index+=batch.length;
  }
  signal?.throwIfAborted();
  // Adjacent same-mood spans at a paid batch boundary continue one arrangement.
  const joined:DocumentaryMusicSection[]=[];
  for(const section of musicSections){
    const previous=joined.at(-1);
    if(previous&&previous.mood===section.mood&&previous.role===section.role&&all.findIndex(s=>s.id===section.startSceneId)===all.findIndex(s=>s.id===previous.endSceneId)+1)previous.endSceneId=section.endSceneId;
    else joined.push({...section});
  }
  const arrangement=hasMusicPlan?withoutWholeFilmBed(joined,all):undefined;
  const plan:DocumentarySemanticMontage={version:1,inputHash,model,hookSeconds:montageHookSeconds(project),musicSections:arrangement,scenes:attachDirections(scenes,project,arrangement),
    ...(directionWarnings.length?{conceptWarning:directionWarnings.join('; ')}:{})};
  await atomicWrite(path,JSON.stringify(plan,null,2));return plan;
}

/** Frame-exact visual edits; narration timing and selected source files survive. */
const explanatoryComposition=(graphic:DocumentaryMotionGraphic|undefined)=>Boolean(graphic&&['map-locator','map-route','statistic','explainer','quote','bar-chart'].includes(graphic.kind));

/** Translate only an explicit literal text entrance, never general storyboard prose.
 * The selected state supplies an editorial clock, not a speech timestamp. */
function storyboardTypography(scene:Scene,frames:number):{graphic:DocumentaryMotionGraphic;startSeconds:number;durationSeconds:number}|undefined{
  const doc=scene.documentary,direction=doc?.semanticMontage;
  if(!direction||direction.composition||direction.emphasis||direction.location||direction.artwork||direction.artworkBrief||direction.explanation)return;
  const selected=validateSceneDirection(direction.sceneDirection);
  if(selected?.storyboard.typography.mode!=='action'||localMontageAccent(scene))return;
  const cues:Array<{title:string;at:number}>=[];
  for(const state of selected.storyboard.states){
    if(!/(?:^|[^\p{L}])(?:text|words?|phrase|question|текст|слов[ао]?|фраза|вопрос)(?!\p{L})/iu.test(state.object))continue;
    // Parse paired quotes before operation words: "Do not enter" is literal
    // copy, whereas unquoted negation or several operations is ambiguous.
    const quoted=/^(?:«([^»]+)»|“([^”]+)”|"([^"\n]+)")\s+(?:enters?|appears?|reveals?|появляется|входит)(?:\s|[.,;:]|$)/iu.exec(state.change);
    const operations=quoted?[]:[...state.change.matchAll(/(?:^|\s+)(?:enters?|appears?|reveals?|появляется|входит)(?=\s|[.,;:]|$)/giu)];
    if(!quoted&&operations.length>1)return;
    if(!quoted&&!operations.length)continue;
    const title=quoted?(quoted[1]??quoted[2]??quoted[3]!):state.change.slice(0,operations[0]!.index).trim();
    if(!quoted&&(/[«»“”"]/u.test(title)||/(?:^|[^\p{L}])(?:not|never|no|cannot|\p{L}+n['’]t|не|нет|никогда)(?!\p{L})/iu.test(title)))return;
    const words=title.trim().split(/\s+/u);
    const objectQuotes=[...state.object.matchAll(/«([^»]+)»|“([^”]+)”|"([^"\n]+)"/gu)];
    if(objectQuotes.some(match=>(match[1]??match[2]??match[3])!==title))return;
    if(title!==title.trim()||title.length>80||words.length<2||words.length>8||unfinishedMontagePhrase(title))return;
    const at=scene.narration.indexOf(title);
    if(at<0||/[\p{L}\p{N}\p{M}]$/u.test(scene.narration.slice(0,at))||/^[\p{L}\p{N}\p{M}]/u.test(scene.narration.slice(at+title.length))
      ||scene.narration.indexOf(title,at+1)>=0)return;
    cues.push({title,at:state.at});
  }
  if(cues.length!==1)return;
  const cue=cues[0]!,previous=doc?.motionGraphic;
  const startFrame=Math.round(cue.at*frames),available=frames-startFrame;
  const reveal=Math.ceil(Math.min(36,Math.max(0,available-1)*.38)),fade=Math.min(8,Math.max(1,available*.08));
  const reading=Math.max(1.2,cue.title.split(/\s+/u).length/3.2+.8);
  if(available-reveal-fade<Math.ceil(reading*30))return;
  const graphic=groundedDocumentaryMotion({kind:'key-point',title:cue.title,variant:'marker'},scene.narration,scene.narration);
  if(!graphic)return;
  const plain:DocumentaryMotionGraphic={...graphic,variant:'marker',sourceChecksum:doc?.checksum,mapStyle:'inset',
    startSeconds:startFrame/30,durationSeconds:available/30};
  // Only the enabled plain payload this bridge produces can survive replan.
  // Unknown meaningful fields (including disabled, value or styling) block it.
  if(previous&&Object.keys({...plain,...previous}).some(key=>previous[key as keyof DocumentaryMotionGraphic]!==plain[key as keyof DocumentaryMotionGraphic]))return;
  return {graphic:plain,startSeconds:plain.startSeconds,durationSeconds:plain.durationSeconds};
}

export function enrichSemanticMontage(project:Project,editorPreviewDrafts?:ReadonlyMap<string,NonNullable<Direction['artwork']>>):Scene[]{
  const settings=project.settings.assembly.documentary,options=settings?.montage;
  if(!options)return project.scenes;
  const excluded=new Set(settings.excludedTemplates??[]),intensity=settings.montageDensity==='calm'?'calm':options.intensity,hookSeconds=montageHookSeconds(project);
  const sparse=options.graphicsDensity==='sparse';
  let cursor=0,lastGraphicEnd=-30;
  const located=new Set<string>();
  const chapters=mapScriptChapters(project);
  const scenes=[...project.scenes].sort((a,b)=>a.order-b.order);
  const sourceFingerprint=semanticMontageHash(project);
  let hookCursor=0;
  const hookProposals=new Set(scenes.filter(s=>{const at=hookCursor;if(s.includeInAssembly!==false)hookCursor+=montageFrames(s)/30;return s.includeInAssembly!==false&&at<montageHookSeconds(project);}).flatMap(s=>s.documentary?.semanticMontage?.cutawaySceneIds??[]));
  const sourceKey=(s:Scene)=>s.documentary?.checksum||s.videoPath||s.imagePath||s.id,usedHookSources=new Set<string>();
  const shotKey=(source:Scene,trim=source.trimStartSeconds??0)=>JSON.stringify([sourceKey(source),source.videoPath?Math.round(trim*30):null]);
  let previousShot:string|undefined;
  const motionPresets=createDocumentaryMotionPresetPlanner(project);
  const explanationSpans=documentaryExplanationSpans(project,scene=>!documentaryExplanationKeepsEvidence(scene,scenes));
  const planScene=(scene:Scene,index:number):Scene=>{
    const frames=montageFrames(scene),start=cursor;if(scene.includeInAssembly!==false)cursor+=frames/30;
    if(start<montageHookSeconds(project)&&scene.includeInAssembly!==false)usedHookSources.add(sourceKey(scene));
    const doc=scene.documentary;
    if(!doc)return scene;
    if(!owned(scene)){motionPresets.observe(doc.motionGraphic,start);return doc.semanticMontage?.vignette||doc.semanticMontage?.monochrome
      ?{...scene,documentary:{...doc,semanticMontage:{...doc.semanticMontage,vignette:undefined,monochrome:undefined}}}:scene;
    }
    // Preserve the exact bound full-scene native presentation across replans.
    // A changed source remains blocked, rather than inheriting this proof.
    const protectedGraphic=doc.motionGraphic&&(doc.motionGraphic.enabled===false||doc.motionGraphic.artwork||doc.motionGraphic.diagram
      ||doc.motionGraphic.explanation||doc.motionGraphic.argument||doc.motionGraphic.cards?.length||doc.motionGraphic.sequenceId);
    if(doc.nativeFallback&&doc.selected||protectedGraphic&&documentarySourceFootageIssue(scene)){
      motionPresets.observe(doc.motionGraphic,start);return scene;
    }
    const replacement=replacementCutawaySource(scene,scenes,doc.semanticMontage);
    const repeat=replacement&&previousShot===shotKey(replacement)&&previousShot!==shotKey(scene);
    // Borrowing the next shot when it also asks for this one just exchanges the
    // footage under the two narrations. Keep both accepted shots in place.
    const swap=replacement&&replacement===scenes.slice(index+1).find(s=>s.includeInAssembly!==false)
      &&owned(replacement)&&acceptedMontageShot(replacement)
      &&replacementCutawaySource(replacement,scenes,replacement.documentary?.semanticMontage)===scene;
    const stale=doc.semanticMontageInputHash&&doc.semanticMontageInputHash!==sourceFingerprint;
    if(doc.semanticMontage?.cutawayMode==='replace'&&(stale||(repeat||swap)&&acceptedMontageShot(scene))){
      // Keep the independent text/manual payload. An editorial repeat alone
      // must never uncover an unapproved original.
      motionPresets.observe(doc.motionGraphic,start);
      return {...scene,documentary:{...doc,semanticMontage:{...doc.semanticMontage,cutawayMode:undefined,cutawaySceneIds:[]},
        cuts:doc.cutsOrigin==='automatic'?undefined:doc.cuts,cutsOrigin:doc.cutsOrigin==='automatic'?undefined:doc.cutsOrigin}};
    }
    const standalone=doc.semanticMontage?.artwork;
    const independent=standalone?.layout==='full'&&!documentaryArtworkUsesMedia(standalone)&&assessArtworkReplacement(standalone).allowReplacement;
    if((!documentaryMaterialUsable(scene)||(!scene.imagePath&&!scene.videoPath))&&!independent)return scene;
    const replacementAccent=replacement&&!chapters.has(scene.id)&&settings.autoMotionGraphics!==false
      &&options.style!=='clean'&&intensity!=='calm'?storyboardTypography(scene,frames):undefined;
    if(replacement&&doc.motionGraphic&&!replacementAccent){
      motionPresets.observe(doc.motionGraphic,start);return scene;
    }
    if(replacement&&!doc.effects.some(e=>e.enabled&&e.kind!=='audio'&&e.origin!=='automatic')
      &&!doc.motionGraphic?.artwork&&!doc.motionGraphic?.diagram&&!doc.motionGraphic?.explanation){
      const replacementRate=replacementCutawayPlaybackRate(scene,replacement)!;
      motionPresets.observe(replacementAccent?.graphic,start);
      return {...scene,sourceVolume:0,documentary:{...doc,layout:'full',template:'full',templateOrigin:'automatic',templateTiming:undefined,motionGraphic:replacementAccent?.graphic,
        effects:doc.effects.filter(e=>e.kind==='audio'||e.origin!=='automatic'),
        cuts:[{id:`montage-${scene.id}-replacement`,fromFrame:0,durationInFrames:frames,sourceSceneId:replacement.id,
          trimStartSeconds:replacement.trimStartSeconds??0,trimEndSeconds:replacement.videoPath?Math.min(replacement.trimEndSeconds??replacement.documentary?.selected?.durationSeconds??Infinity,
            (replacement.trimStartSeconds??0)+frames/30*replacementRate):replacement.trimEndSeconds,playbackRate:replacementRate,
          motion:!replacement.videoPath&&project.settings.assembly.kenBurns!==false?'push':'none'}],cutsOrigin:'automatic'}};
    }
    const chapter=chapters.get(scene.id);
    const hook=start<hookSeconds,expressive=options.style!=='clean';
    const local=!doc.semanticMontage&&expressive&&intensity!=='calm';
    // A saved shot plan may omit captions. Fill its empty accent slots using
    // literal narration, without replacing an explicit composition or source plan.
    const candidate=!sparse&&!chapter&&settings.autoMotionGraphics!==false&&(local||motionPresets.active
      &&doc.semanticMontage&&['footage','archive','television','statistic'].includes(doc.semanticMontage.treatment)
      &&!doc.semanticMontage.composition&&!doc.semanticMontage.location)
      ?localMontageAccent(scene):undefined;
    const listEmphasis=candidate?.graphic.kind==='explainer'&&candidate.graphic.boardLayout==='parts'
      &&(candidate.graphic.cards?.filter(card=>norm(doc.semanticMontage?.emphasis??'').includes(norm(card.label))).length??0)>=2;
    const missingAccent=candidate&&!doc.semanticMontage?.emphasis
      &&['chronology','statistic','key-point'].includes(candidate.graphic.kind);
    const localAccent=local||listEmphasis||missingAccent?candidate:undefined;
    const localCuts=local?localMontageCutawaySources(scene,scenes):[];
    const direction:Direction|undefined=doc.semanticMontage?{...doc.semanticMontage,language:project.language,chapter}
      :chapter||local?{sceneId:scene.id,subject:'',beat:'evidence' as const,treatment:'footage' as const,cutawaySceneIds:localCuts.map(s=>s.id),language:project.language,chapter}:undefined;
    const dramatic=direction?.beat==='conflict'||direction?.beat==='turn'||direction?.beat==='resolve';
    const graphicGap=local&&motionPresets.active?0:local&&intensity==='rich'?.4:hook?0.75:intensity==='rich'?(dramatic?2:6):intensity==='calm'?16:dramatic?4:10;
    const storyboardAccent=!chapter&&!localAccent&&expressive&&intensity!=='calm'&&settings.autoMotionGraphics!==false
      ?storyboardTypography(scene,frames):undefined;
    const proposal=localAccent?.graphic??storyboardAccent?.graphic??(direction&&montageComposition(direction.composition,scene,scenes));
    const localTiming=localAccent?localAccentTiming(localAccent,scene,frames/30):storyboardAccent;
    let graphic=doc.motionGraphic?.origin==='automatic'?undefined:doc.motionGraphic;
    if(settings.autoMotionGraphics!==false&&chapter){
      graphic={kind:'chapter-number',enabled:true,title:chapter.title,value:chapter.number,origin:'automatic',startSeconds:chapter.startSeconds,
        durationSeconds:Math.max(1/30,frames/30-chapter.startSeconds),theme:'dark',variant:options.style==='clean'?'clean':options.style==='cinematic'?'technical':'poster'};
      graphic=motionPresets.apply(scene,graphic,frames/30);
      if(graphic)lastGraphicEnd=start+graphic.startSeconds+graphic.durationSeconds;
    }else if(settings.autoMotionGraphics!==false&&expressive&&direction&&start+(localTiming?.startSeconds??0)-lastGraphicEnd>=(proposal||direction.location||localAccent&&localAccent.priority>=80?0:graphicGap)){
      const emphasis=direction.emphasis;
      const locate=direction.location&&(direction.treatment==='map'||!hook&&direction.treatment==='footage'&&!located.has(norm(direction.location)));
      const suggestion=locate?{kind:'map-locator',title:direction.location,place:direction.location}
        :direction.treatment==='subject'&&visibleMontageSubject(scene,direction.subject)?{kind:'subject-card',title:direction.subject}
        :direction.treatment==='statistic'&&emphasis?{kind:'statistic',title:direction.subject,value:emphasis}
        :direction.treatment==='quote'&&emphasis&&/[«“"]/.test(scene.narration)?{kind:'quote',title:emphasis}
        :emphasis&&emphasis.length<=80&&emphasis.split(/\s+/).length<=8&&emphasis.length<scene.narration.length*.7?{kind:'key-point',title:emphasis}:undefined;
      graphic=proposal??objectComposition(scene,direction,scenes)??groundedDocumentaryMotion(suggestion,scene.narration,scene.narration);
      if(graphic?.kind==='explainer'&&graphic.boardLayout==='compare'&&graphic.cards)
        graphic={...graphic,...bindMontageComparisonCards(graphic.cards,scene,scenes,direction.composition?.cards)};
      if(graphic?.kind==='key-point'&&unfinishedMontagePhrase(graphic.title))graphic=undefined;
      if(graphic){
        if(graphic.kind==='key-point'&&!graphic.variant&&!direction.composition?.variant&&hook&&intensity==='rich'
          &&project.settings.assembly.kenBurns!==false&&doc.templateMotion?.amountPercent!==0)
          graphic={...graphic,variant:'poster'};
        if(graphic.kind.startsWith('map-')&&direction.location)located.add(norm(direction.location));
        const previous=doc.motionGraphic;
        const same=previous?.origin==='automatic'&&previous.kind===graphic.kind&&previous.title===graphic.title&&previous.value===graphic.value&&JSON.stringify(previous.place)===JSON.stringify(graphic.place);
        const genericSubject=graphic.kind==='subject-card'&&/^(?:(?:the|this|that) )?(?:car|vehicle|aircraft|plane|ship|boat|building|engine|train|person|object)$|^(?:(?:этот|эта|это) )?(?:машина|автомобиль|самолёт|корабль|здание|двигатель|человек|объект)$/u.test(norm(graphic.title));
        const reading=same&&doc.timing?.sourceKey&&previous.reading?.sourceKey===doc.timing.sourceKey&&previous.reading?.text===graphic.title?previous.reading:undefined;
        const previousStart=previous?.startSeconds??0;
        const accent=graphic.kind==='key-point'||graphic.kind==='chronology';
        const durationSeconds=accent?Math.min(frames/30,Math.max(2,Math.min(4,(graphic.value||graphic.title).split(/\s+/u).length*.4+1))):frames/30;
        // Reading times are already measured relative to the old graphic. Keep
        // the same origin when reusing them; never synthesize speech timestamps.
        const actualDuration=localTiming?.durationSeconds??durationSeconds;
        const startSeconds=reading?Math.min(previousStart,Math.max(0,frames/30-actualDuration)):localTiming?.startSeconds??0;
        graphic={...graphic,...(same&&previous.detail?{detail:previous.detail}:{}),
          ...(same&&previous.sourceChecksum===doc.checksum&&previous.cutoutPath?{cutoutPath:previous.cutoutPath}:{}),
          reading:reading&&{...reading,words:reading.words.map(w=>({...w,startSeconds:w.startSeconds+previousStart-startSeconds,endSeconds:w.endSeconds+previousStart-startSeconds}))},
          readingError:reading?undefined:same?previous.readingError:undefined,showSource:graphic.kind==='statistic'&&doc.verified!==true?false:graphic.showSource,
          hideTitle:graphic.hideTitle||genericSubject||undefined,sourceChecksum:doc.checksum,startSeconds,durationSeconds:actualDuration,origin:'automatic',
          mapStyle:graphic.kind.startsWith('map-')&&(localAccent||direction.composition?.kind===graphic.kind)?'full':'inset'};
        const next=scenes.slice(index+1).find(s=>s.includeInAssembly!==false);
        // Reserve the next important fact before spending attention on an
        // incidental comparison. The source then carries the setup into its
        // consequence (e.g. exhaustion -> "Only 3 of 8"), rather than dropping
        // the consequence merely because a lower-priority board came first.
        const nextAccent=motionPresets.active&&localAccent&&localAccent.priority<88&&explanatoryComposition(graphic)
          &&next&&owned(next)&&!next.documentary?.semanticMontage&&documentaryMaterialUsable(next)
          &&(next.imagePath||next.videoPath)&&!chapters.has(next.id)?localMontageAccent(next):undefined;
        const nextOnset=nextAccent&&next?cursor+localAccentTiming(nextAccent,next,montageFrames(next)/30).startSeconds:Infinity;
        if(nextAccent&&nextAccent.priority>=88&&start+graphic.startSeconds+graphic.durationSeconds+3>nextOnset)graphic=undefined;
        // An added fallback must leave the next saved editorial cue its lead-in.
        // This also handles a late year in a long shot that fills the cut.
        const nextDirection=next?.documentary?.semanticMontage;
        if(graphic&&missingAccent&&nextDirection&&(nextDirection.emphasis||nextDirection.composition||nextDirection.location||!['footage','archive','television','statistic'].includes(nextDirection.treatment))
          &&start+graphic.startSeconds+Math.max(graphic.durationSeconds,graphic.kind==='chronology'?4:3)+graphicGap>cursor)graphic=undefined;
        // The selected storyboard already owns this cue's entrance and hold.
        // The usual preset planner estimates a different narration onset.
        if(graphic&&storyboardAccent)motionPresets.observe(graphic,start);
        else if(graphic)graphic=motionPresets.apply(scene,graphic,frames/30,localAccent?.anchor);
        // Leave room for the next explicit explanation instead of letting a
        // fallback phrase consume its lead-in. Never discard an authored choice.
        if(graphic&&!proposal&&graphic.kind==='key-point'&&frames/30-startSeconds-durationSeconds<graphicGap
          &&next&&owned(next)&&documentaryMaterialUsable(next)&&(next.imagePath||next.videoPath)&&!chapters.has(next.id)
          &&explanatoryComposition(montageComposition(next.documentary?.semanticMontage?.composition,next,scenes)))graphic=undefined;
        else if(graphic)lastGraphicEnd=Math.min(cursor,start+graphic.startSeconds+graphic.durationSeconds);
      }
    }
    let template:DocumentaryTemplate='full';
    if(graphic)template='full';
    else if(expressive&&(direction?.treatment==='television'||!sparse&&intensity==='rich'&&direction?.treatment==='footage'
      &&/(?:\b(?:film|movie|television|broadcast|interview)\b|(?:^|\s)(?:фильм|телевидение|трансляция|интервью)(?:\s|[.,]))/iu.test(scene.narration))
      &&frames>=75){template='broadcast-scanlines';}
    else if(expressive&&scene.imagePath&&!scene.videoPath){template=sparse?'contain':documentaryDirectedTemplate(scene,options.style==='cinematic');}
    else if(expressive&&direction?.treatment==='archive'&&intensity==='rich')template=documentaryDirectedTemplate(scene,options.style==='cinematic');
    if(excluded.has(template))template='full';
    // Keep the commissioned drawing and its receipt. Photo viewports follow
    // the export allowlist and structural quality policy, like standalone art.
    const factualGraphic=graphic??doc.motionGraphic;
    const preciseDiagram=factualGraphic?documentaryDiagram(scene,factualGraphic):undefined;
    // Only the editor's exact validated draft may bypass staging quality. This
    // transient map is never project data; ordinary preview/export keep the guard.
    const artworkReplacement=direction?.artwork&&(!documentaryArtworkMediaIssue(project,scene.id,direction.artwork)&&assessArtworkReplacement(direction.artwork).allowReplacement
      ||editorPreviewDrafts?.get(scene.id)===direction.artwork);
    if(settings.autoMotionGraphics!==false&&expressive&&intensity==='rich'&&direction?.artwork&&artworkReplacement&&!chapter&&!preciseDiagram&&!documentaryMontageHasEvidence(scene,scenes)){
      const artwork=direction.artwork,seconds=frames/30;
      const startSeconds=Math.max(0,Math.min(artwork.startSeconds,Math.max(0,seconds-2.4)));
      graphic={kind:'explainer',title:'',hideTitle:true,enabled:true,origin:editorPreviewDrafts?.get(scene.id)===artwork?'manual':'automatic',artwork,
        startSeconds,durationSeconds:Math.min(artwork.durationSeconds,seconds-startSeconds),theme:'dark'};
      template='full';lastGraphicEnd=start+startSeconds+graphic.durationSeconds;
    }
    // Short, grounded phrases and dates are requested accents. A single generic
    // card is still not a substitute for a developed explanation.
    if(expressive&&intensity==='rich'&&graphic?.origin==='automatic'
      &&graphic.kind==='explainer'&&graphic.cards?.length===1&&!graphic.artwork&&!graphic.argument)graphic=undefined;
    if(preciseDiagram&&graphic?.origin==='automatic'){
      graphic={...graphic,showSource:false,...(preciseDiagram.kind==='time-gap'
        ?{diagram:preciseDiagram,startSeconds:0,durationSeconds:frames/30}:{})};
      if(preciseDiagram.kind==='time-gap')lastGraphicEnd=cursor;
    }
    if(graphic?.origin==='automatic'&&graphic.kind.startsWith('map-')&&direction?.composition?.kind===graphic.kind){
      graphic={...graphic,mapStyle:'full',startSeconds:0,durationSeconds:frames/30};lastGraphicEnd=cursor;
    }
    const explanation=settings.autoMotionGraphics!==false&&expressive&&intensity==='rich'&&!chapter?explanationSpans.get(scene.id):undefined;
    if(explanation){
      graphic={kind:'explainer',enabled:true,origin:'automatic',title:'',hideTitle:true,explanation,sequenceId:explanation.sequence!.id,
        startSeconds:0,durationSeconds:frames/30,theme:'paper'};
      template='full';lastGraphicEnd=cursor;
    }
    const candidates=new Map(montageCutawaySources(scene,scenes).map(s=>[s.id,s]));
    const previous=scenes.slice(0,index).reverse().find(s=>s.includeInAssembly!==false);
    let sources=direction?.cutawaySceneIds.map(id=>candidates.get(id)).filter((s):s is Scene=>Boolean(s)
      &&s!.id!==previous?.id&&(!s!.documentary?.checksum||s!.documentary?.checksum!==previous?.documentary?.checksum)
      &&(!hook||!usedHookSources.has(sourceKey(s!))))??[];
    // Empty opening slots can borrow a forward source already proposed by the
    // same hook's AI plan, but only inside this scene's existing subject/year
    // allowlist. No new source, direction request or immediate replay is added.
    if(hook&&intensity==='rich'&&!sources.length)sources=[...candidates.values()].filter(s=>s.order>scene.order&&hookProposals.has(s.id)&&!usedHookSources.has(sourceKey(s)));
    // A source's reviewed interval, not its full remote duration, is the limit.
    const capacity=(s:Scene)=>!s.videoPath?frames:Math.max(0,Math.floor((Math.min(s.trimEndSeconds??Infinity,s.documentary?.selected?.durationSeconds??s.trimEndSeconds??0)-(s.trimStartSeconds??0))/(s.playbackRate??1)*30));
    let cuts=doc.cutsOrigin==='automatic'?undefined:doc.cuts;
    if(!preciseDiagram&&(!graphic||['key-point','chronology','statistic'].includes(graphic.kind)&&graphic.showSource!==false)&&!template.startsWith('broadcast-')&&sources.length&&intensity!=='calm'&&frames>=90
      &&(hook||direction?.beat==='explain'||direction?.beat==='conflict'||direction?.beat==='turn'||direction?.beat==='evidence')){
      // Ease shot length into the body over six seconds; a scene just beyond
      // hookSeconds must not suddenly lose its otherwise usable cutaway.
      const settling=Math.max(0,Math.min(1,(start-hookSeconds)/6));
      const minimumShotFrames=Math.round(42+33*settling);
      // Several scene IDs can point to the same file. Keep the AI's order but
      // do not repeat that file or turn a tiny reviewed remainder into a flash.
      const distinct=new Set([sourceKey(scene)]);
      sources=sources.filter(source=>{
        const key=sourceKey(source);
        if(distinct.has(key)||capacity(source)<minimumShotFrames)return false;
        distinct.add(key);return true;
      });
      const count=Math.min(sources.length+1,hook?3:2,Math.floor(frames/minimumShotFrames));
      const chosen=[scene,...sources.slice(0,count-1)];
      const capacities=chosen.map(capacity);
      let lengths=Array.from({length:count},(_,i)=>Math.min(capacities[i]!,Math.floor(frames*(i+1)/count)-Math.floor(frames*i/count)));
      // A short primary clip must not discard otherwise usable AI-approved
      // cutaways. Give its remaining frames only to sources with reviewed room.
      let remaining=frames-lengths.reduce((sum,length)=>sum+length,0);
      while(remaining>0){
        const available=lengths.map((length,i)=>length<capacities[i]!?i:-1).filter(i=>i>=0);
        if(!available.length)break;
        const share=Math.ceil(remaining/available.length);
        for(const i of available){const add=Math.min(share,remaining,capacities[i]!-lengths[i]!);lengths[i]!+=add;remaining-=add;}
      }
      lengths=documentaryPauseAlignedLengths(scene,lengths,capacities,minimumShotFrames);
      if(count>1&&!remaining&&lengths.every(length=>length>=minimumShotFrames)){let from=0;cuts=chosen.map((source,i)=>{
        if(hook)usedHookSources.add(sourceKey(source));
        const cut={id:`montage-${scene.id}-${i}`,fromFrame:from,durationInFrames:lengths[i]!,sourceSceneId:source.id,
          trimStartSeconds:source.trimStartSeconds??0,trimEndSeconds:source.trimEndSeconds,playbackRate:source.playbackRate??1,
          motion:source.videoPath||project.settings.assembly.kenBurns===false||source.documentary?.templateMotion?.amountPercent===0?'none' as const:direction?.beat==='establish'||direction?.beat==='resolve'?'pull' as const:'push' as const};from+=lengths[i]!;return cut;
      });template='full';}
    }
    // A change of treatment is useful even without a new narrative topic.
    // Keep complete explanations, approved cut sequences and authored overlays
    // intact; vary ordinary material between them on the requested time scale.
    const shortAccent=graphic&&['key-point','chronology'].includes(graphic.kind)&&!graphic.preset&&!graphic.diagram;
    const canDress=!sparse&&options.style==='editorial'&&intensity==='rich'&&!chapter&&!preciseDiagram&&!cuts?.length&&(!graphic||shortAccent)
      &&frames>=90&&!doc.effects.some(e=>e.enabled&&e.kind!=='audio'&&e.role!=='background'&&e.origin!=='automatic');
    if(canDress&&!template.startsWith('broadcast-')){
      const directed=documentaryDirectedTemplate(scene,options.style==='cinematic');
      if(!excluded.has(directed))template=directed;
    }
    const photoCamera=Boolean(scene.imagePath&&!scene.videoPath&&project.settings.assembly.kenBurns!==false
      &&(!scene.kenBurnsDirection||scene.kenBurnsDirection==='auto')&&!cuts?.length&&(!graphic||shortAccent));
    const savedDetail=photoCamera?documentaryDetailAnnotations(scene)?.annotations?.filter(a=>(a.confidence??0)>=.8
      &&scene.narration.toLocaleLowerCase().includes(a.label.toLocaleLowerCase())).sort((a,b)=>(b.confidence??0)-(a.confidence??0))[0]?.points[0]:undefined;
    if(savedDetail&&!excluded.has('push')&&!excluded.has('pull'))template=direction?.beat==='establish'||direction?.beat==='resolve'?'pull':'push';
    // Use an observed point for a targeted zoom. No inferred face position or
    // extra vision request; unannotated photos still have directional movement.
    const camera=photoCamera?{autoKenBurnsDirection:direction?.beat==='establish'||direction?.beat==='resolve'?'out' as const:'in' as const,
      autoKenBurnsZoom:1+Math.min(.18,Math.max(.04,frames/30*(dramatic?.022:.012))),
      autoKenBurnsFocus:savedDetail?{x:savedDetail.x,y:savedDetail.y}:{x:50,y:50}}:{};
    if(direction?.monochrome&&direction.emphasis&&direction.monochromeStartSeconds===undefined){
      const at=scene.narration.indexOf(direction.emphasis);
      if(at>=0)direction.monochromeStartSeconds=Math.min(Math.max(0,frames/30-.9),
        frames/30*scene.narration.slice(0,at).trim().split(/\s+/u).filter(Boolean).length/Math.max(1,scene.narration.trim().split(/\s+/u).length));
    }
    const enriched:Scene={...scene,...camera,documentary:{...doc,semanticMontage:local?undefined:direction,template,templateOrigin:'automatic',motionGraphic:graphic,cuts,
      cutsOrigin:cuts?'automatic':undefined,templateMotion:{amountPercent:doc.templateMotion?.amountPercent===0||project.settings.assembly.kenBurns===false&&!graphic?.preset&&!graphic?.artwork?0:options.style==='clean'?8:hook?22:14,curve:hook?'dramatic':'smooth'}}};
    const issue=documentarySourceFootageIssue(enriched);
    // Existing rich/disabled/authored payload retains its priority even when a
    // fresh automatic accent would otherwise have discarded it.
    const fallback=issue&&!protectedGraphic?applyDocumentarySourcePreservingFallback(project,enriched,issue):enriched;
    if(documentarySourcePreservingFallbackReady(fallback))lastGraphicEnd=cursor;
    return fallback;
  };
  return scenes.map((scene,index)=>{
    const planned=planScene(scene,index);
    if(planned.includeInAssembly!==false){
      const lastFrame=montageFrames(planned)-1;
      const tail=planned.documentary?.cuts?.find(cut=>cut.fromFrame<=lastFrame&&lastFrame<cut.fromFrame+cut.durationInFrames);
      const source=tail?.sourceSceneId?scenes.find(s=>s.id===tail.sourceSceneId):planned;
      previousShot=source&&!documentaryStandaloneArtworkReady(planned)?shotKey(source,tail?.trimStartSeconds):undefined;
    }
    return planned;
  });
}
