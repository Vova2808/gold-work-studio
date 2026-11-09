import {createHash} from 'node:crypto';
import type {Project,Scene,DocumentaryScene} from '@gold-work/shared';
import {documentaryAutomaticRecoveryPolicyIssue,documentaryThematicDiscoveryRequirement} from './documentary-automatic-thematic-recovery.js';

type Fit=NonNullable<NonNullable<DocumentaryScene['visualReview']>['narrativeFit']>;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const legacyRevisions=[1,2] as const;
const currentRevision=3 as const;
export const documentaryFallbackNarrativeRevisions=[...legacyRevisions,currentRevision] as const;
type Revision=typeof documentaryFallbackNarrativeRevisions[number];

export function documentaryLegacyFallbackNarrativeApproval(project:Project,scene:Scene):boolean {
 const doc=scene.documentary,review=doc?.visualReview;
 if(!doc?.checksum||review?.status!=='accepted'||!review.illustrationApproval
  ||!documentaryFallbackNarrativeContext(project,scene))return false;
 return !review.narrativeFit||review.narrativeFit.status==='supported'
  &&legacyRevisions.some(revision=>review.narrativeFit?.binding===documentaryFallbackNarrativeTask(project,scene,revision)?.binding);
}

/** Frozen story referent, separate from the deliberately simplified pixel target.
 * Neither a place dictionary nor the primary planner's extra visible states
 * determine which original narrative facts the same visual request must honor. */
export function documentaryFallbackNarrativeContext(project:Project,scene:Scene){
 const source=scene.documentary?.selected;
 if(!source||source.id.startsWith('manual:'))return;
 return documentaryFallbackNarrativeTask(project,scene);
}

/** The same semantic task can be recovered from a receipt after an unsuccessful candidate was discarded. */
export function documentaryFallbackNarrativeTask(project:Project,scene:Scene,version:Revision=currentRevision){
 const doc=scene.documentary,req=doc?.requirement,ai=req?.aiSearchPlan,fallback=req?.footageFallback;
 if(!doc||!ai||!fallback?.automaticRecovery
  ||!documentaryThematicDiscoveryRequirement(project,scene)
  ||documentaryAutomaticRecoveryPolicyIssue(project,{...scene,documentary:{...doc,verified:false}}))return;
 const script=project.videoBrief?.readyScript||[...project.scenes].sort((a,b)=>a.order-b.order).map(s=>s.narration).join('\n');
 const context={version,mode:project.settings.assembly.documentary?.matchMode??'subject-illustration',
  narration:scene.narration,primarySubject:ai.subject,primaryTarget:ai.visualTarget,primaryYears:ai.years,
  primaryIdentities:req.identities??[],fallbackTarget:fallback.target,scriptSha256:hash(script),
  editorOnlyNoteIsNotViewerDisclosure:true};
 return {...context,binding:hash(context)};
}

export function documentaryFallbackNarrativeFit(project:Project,scene:Scene,value:unknown):Fit|undefined{
 const context=documentaryFallbackNarrativeContext(project,scene);
 return context?documentaryBoundFallbackNarrativeFit(project,context.binding,value):undefined;
}

export function documentaryBoundFallbackNarrativeFit(project:Project,binding:string,value:unknown):Fit|undefined{
 const raw=(value as {narrativeFit?:unknown}|undefined)?.narrativeFit;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return;
 const row=raw as Record<string,unknown>,script=project.videoBrief?.readyScript||project.scenes.map(s=>s.narration).join('\n');
 if(row.version!==1||row.binding!==binding||!['supported','conflict','uncertain'].includes(String(row.status))
  ||typeof row.evidence!=='string'||row.evidence.trim().length<16||row.evidence.length>800
  ||typeof row.scriptQuote!=='string'||!row.scriptQuote.trim()||row.scriptQuote.length>200||!script.includes(row.scriptQuote))return;
 return {version:1,binding,status:row.status as Fit['status'],scriptQuote:row.scriptQuote,evidence:row.evidence.trim()};
}

/** Shared by new visual verdicts, saved approvals and automatic export readiness. */
export function documentaryFallbackNarrativeIssue(project:Project,scene:Scene,value:unknown):{status:'rejected'|'uncertain';reason:string}|undefined{
 if(!documentaryFallbackNarrativeContext(project,scene))return;
 const fit=documentaryFallbackNarrativeFit(project,scene,value);
 if(!fit)return {status:'uncertain',reason:'Не подтверждено сохранение смысла исходной сцены в тематическом материале. Исходник и прежний ответ сохранены; новый критерий проверяется при явном запуске подбора.'};
 if(fit.status!=='supported')return {status:fit.status==='conflict'?'rejected':'uncertain',reason:'Тематическая иллюстрация не подтверждает исходный смысл сцены: '+fit.evidence};
}
