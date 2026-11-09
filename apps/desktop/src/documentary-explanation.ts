import type {DocumentaryExplanation,DocumentarySemanticMontage,Project,Scene} from '@gold-work/shared';

type Direction=DocumentarySemanticMontage['scenes'][number];
const kinds=new Set(['flow','branch','merge','exchange','cycle','contrast']);
const symbols=new Set(['person','team','machine','motorcycle','signal','energy','document','place','time','generic']);
const canonical=(s:string)=>s.toLocaleLowerCase().replace(/\s+/gu,' ').trim();
const frames=(s:Scene)=>Math.max(s.documentary?.timing?.durationInFrames??Math.ceil(s.durationSeconds*30),Math.ceil((s.durationOverrideSeconds??0)*30));
export const documentaryExplanationEditable=(s:Scene)=>Boolean(s.documentary&&s.includeInAssembly!==false&&!s.documentary.pinned
  &&s.documentary.templateOrigin!=='manual'&&(!s.documentary.motionGraphic||s.documentary.motionGraphic.origin==='automatic')
  &&(!s.documentary.template||s.documentary.templateOrigin==='automatic')
  &&s.documentary.templateMotion?.amountPercent!==0&&!s.documentary.caption.enabled&&!s.documentary.texts?.length
  &&!(s.documentary.layout==='compare'&&s.documentary.comparison)&&!(s.documentary.cuts?.length&&s.documentary.cutsOrigin!=='automatic'));

/** The model supplies meaning; local code bounds the span, literal labels and
 * compatibility of an explicitly declared concrete subject with its symbol. */
export function validateDocumentaryExplanation(value:unknown,scene:Scene,batch:Scene[]):Direction['explanation']|undefined{
  if(!value||typeof value!=='object')return;
  const raw=value as NonNullable<Direction['explanation']>,start=batch.findIndex(s=>s.id===scene.id);
  const end=raw.endSceneId?batch.findIndex(s=>s.id===raw.endSceneId):start;
  if(start<0||end<start||end-start>3)return;
  const span=batch.slice(start,end+1),duration=span.reduce((sum,s)=>sum+frames(s),0);
  if(!span.every(documentaryExplanationEditable)||duration<90||duration>660||!kinds.has(raw.kind)||!Array.isArray(raw.nodes)
    ||raw.nodes.length<2||raw.nodes.length>4||raw.kind==='exchange'&&raw.nodes.length!==2
    ||['branch','merge'].includes(raw.kind)&&raw.nodes.length<3)return;
  const context=canonical(span.map(s=>s.narration).join(' '));
  const literal=(v:unknown)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=60&&context.includes(canonical(v));
  if(raw.nodes.some(n=>!n||typeof n.id!=='string'||!n.id||n.id.length>30||!literal(n.label)||!symbols.has(n.symbol)
      ||n.objectType!==undefined&&(n.objectType!=='motorcycle'||n.symbol!=='motorcycle'))
    ||new Set(raw.nodes.map(n=>n.id)).size!==raw.nodes.length||new Set(raw.nodes.map(n=>canonical(n.label))).size!==raw.nodes.length)return;
  return {kind:raw.kind,nodes:raw.nodes.map(n=>({id:n.id,label:n.label.trim(),symbol:n.symbol,
      ...(n.objectType?{objectType:n.objectType}:{})})),
    ...(raw.kind==='flow'&&['steady','interrupted'].includes(raw.signal??'')?{signal:raw.signal}:{}),
    ...(literal(raw.emphasis)?{emphasis:raw.emphasis!.trim()}:{}),...(end>start?{endSceneId:batch[end]!.id}:{})};
}

/** Carry one explanation across sentence fragments without splitting/re-timing the narration. */
export function documentaryExplanationSpans(project:Project,canReplace:(scene:Scene)=>boolean=()=>true):Map<string,DocumentaryExplanation>{
  const result=new Map<string,DocumentaryExplanation>(),all=project.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order);
  for(const scene of all){
    const value=scene.documentary?.semanticMontage?.explanation;
    const valid=validateDocumentaryExplanation(value,scene,all);if(!valid)continue;
    const start=all.indexOf(scene),end=valid.endSceneId?all.findIndex(s=>s.id===valid.endSceneId):start,span=all.slice(start,end+1);
    if(span.some(s=>result.has(s.id)||s.documentary?.semanticMontage?.chapter||!canReplace(s)))continue;
    const durationInFrames=span.reduce((sum,s)=>sum+frames(s),0),id=`explanation:${scene.id}:${span.at(-1)!.id}`;
    let offsetFrames=0;
    for(const member of span){
      const {endSceneId:_end,...explanation}=valid;
      result.set(member.id,{...explanation,sequence:{id,offsetFrames,durationInFrames}});offsetFrames+=frames(member);
    }
  }
  return result;
}

export const documentaryExplanationSemantics=' Arrows assert a narrated causal/transfer relationship, not just word order. Never turn a condition, constraint, enabling factor or co-occurring item into the output of a flow. Control/signals go from controller to controlled object; a device improving that path is not upstream of the controller unless the narration says so. In a merge, ALL earlier nodes contribute to the LAST node, a genuinely narrated result. An existing collaborator/team is another contributor, never the produced result. If more than three contributors are named, select a faithful subset or another kind; never silently reclassify the omitted contributor as the outcome. Keep negation, uncertainty, obstruction and comparisons intact. If the grammar would assert an unsupported relationship, omit the insert. A short exact result clause is allowed; a bare pronoun is not. ';

const motorcycleExplanation='Preserve concrete object type independently of its exact label: for a motorcycle use objectType:"motorcycle" and symbol:"motorcycle", a whole neutral two-wheeled silhouette. machine depicts general machinery; it cannot stand in for a motorcycle. objectType currently supports only motorcycle and must agree with symbol. A label does not prove the pictured object. If a different concrete object needs a shape this native vocabulary cannot represent faithfully, omit the native explanation and use the existing artwork commission or appropriate real footage; do not disguise it with machine or generic. Do not invent branded design, physical internals or details. ';

/** The same explanation text was embedded in several independently checkpointed montage prompts. */
export function preObjectTypeMontageSystem(system:string):string {
  if(!system.includes(motorcycleExplanation))return system;
  return system.replace('nodes:[{id,label,symbol,objectType?}]','nodes:[{id,label,symbol}]')
    .replace('person|team|machine|motorcycle|signal','person|team|machine|signal').replace(motorcycleExplanation,'');
}

export const documentaryExplanationDirection=' Editorial direction: do not place decorative slogans, dates, single-image caption cards or repeated text+line overlays on photos. Omit ordinary key-point/chronology accents; let full-size footage breathe. '
  +'For a relationship that footage cannot show, optionally return explanation:{kind,nodes:[{id,label,symbol,objectType?}],emphasis?,endSceneId?} on the FIRST scene of a complete thought. This is the same planning request. '
  +'The full-screen explanatory insert has no photo background. It shows objects acting, not a slide listing keywords. '
  +'kind flow: 2–4 successive stages in a genuine transfer/process, ordered input to output; branch: one source to 2–3 alternatives, source first; merge: 2–3 contributors combine into a result, result LAST; exchange: exactly TWO entities physically exchange roles/positions only if the narration says so; cycle: 2–4 ordered steps return to the start only for an explicitly recurring process; contrast: 2–4 genuinely opposed/comparable concepts, no inferred winner, quantities or transformation. '
  +'symbol person|team|machine|motorcycle|signal|energy|document|place|time|generic selects a neutral illustrative pictogram, never a portrait or technical drawing. Use the same symbol for like concepts. '
  +motorcycleExplanation
  +'Labels must be concise exact narration fragments (usually 1–4 words), with an optional exact emphasis up to 5 words. No bare pronouns as labels, no invented facts. '
  +'A thought cut by scene boundaries can span the next 1–3 scenes of THIS batch using endSceneId, at most 22 seconds. Labels may quote the complete span. Later covered rows MUST omit explanation/composition/emphasis. Do not split one sentence into repeated diagrams. '
  +'Choose the action from meaning, never cycle through kinds for decoration. Keep maps for geography, real source splits for visible subjects, exact native charts for numbers, actual footage for actions/emotion; explanation is for causal, organisational or conceptual relationships. A literal technical mechanism must remain real footage or separately authored drawing, never a fake machine diagram. '
  +documentaryExplanationSemantics
  +'Make substantial explanations where the script warrants them; do not impose a per-batch quota. Alternate explanatory inserts with clean footage. If a photo offers nothing beyond the spoken keywords, a standalone explanation can replace it; do not fill gaps with text over that photo.';

/** Keep the active contract short and explicit instead of accumulating historical briefs. */
export const documentaryEditorialSystem=`You are the director and motion storyboard artist of a high-quality documentary. Read the narration as a story; source observations describe available images, NOT what the story says. Build a varied edit: genuine full-size footage, meaningful image comparisons, geographic context, exact numerical evidence, and substantial standalone animated explanations of unseen relationships. Do not create a slideshow with slogans.
Return compact JSON {scenes:[{sceneId,subject,beat,treatment,cutawaySceneIds:[],composition?,explanation?,artworkMode?}],musicSections:[{startSceneId,endSceneId,role,mood}]}. Return exactly one row for EVERY supplied scene. Omit undefined optional fields, no markdown.
subject is a short exact excerpt from narration, not source metadata. beat is establish|conflict|evidence|explain|turn|resolve. treatment is normally footage; map only for actual geography, statistic only for a quantity, quote only for actual quoted speech, archive/television only for that context, subject only for a visible introduced person/object.
${documentaryExplanationDirection}
composition is optional {kind,variant?,title?,value?,cards?:[{label,value?,sceneId?}],boardLayout?,items?}. Use:
- explainer/compare with exactly two cards for a genuine visible comparison; sceneId comes ONLY from this scene's compositionSources and the source's OWN observed description must show that labelled subject. Never broaden cutawaySceneIds using compositionSources. A vehicle owner's name does not show that owner. If no image pair exists, prefer explanation/contrast for the actual conceptual contrast.
- statistic with an exact narrated value; bar-chart with exact comparable same-unit values, never infer a measurement from an image or a year.
- map-locator title=exact narrated place, map-route items=exact narrated places; no invented coordinates.
- annotations/technical only for a visible narrated detail supported by source observation; no coordinates. quote title=actual quoted speech. No key-point, single-photo caption or generic text-card explainer.
All composition text must quote THIS scene's narration; explanation labels may quote their complete explicitly chosen span. Keep literal numbers and units. Never display requested names over an unrelated observed object. Do not invent chapters.
cutawaySceneIds: choose 0–2 only from allowedSources when their observed content supports the SAME claim/period; empty is correct if none fit. Never use a later victory as evidence of an earlier defeat. Keep true action footage at full size. At the opening develop stakes with compatible shots; in the body let an explanatory action finish and hold.
artworkMode standalone commissions a specific additional animated drawing for a technical/conceptual relationship that neither the footage nor explanation grammar can express; photographic retains actual visual evidence. Do not commission decoration. A mechanical illustration cannot invent the actual construction.
musicSections: a few narrative spans with role hook|narration|turn|climax|resolution and mood tension|reflective|energetic|discovery|calm|silence. Boundary IDs belong to this batch. Continue the preceding mood when appropriate; never one cue per shot. Keep narration timing and language intact.`;
