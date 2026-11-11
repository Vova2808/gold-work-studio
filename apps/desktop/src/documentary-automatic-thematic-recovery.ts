import {createHash} from 'node:crypto';
import type {DocumentaryRequirement,Project,Scene} from '@gold-work/shared';
import {documentaryThematicReserveIssue} from '@gold-work/shared';
import {currentDocumentaryAiSearchPlan,documentaryAiPlanContext} from './documentary-ai-plan-state.js';
import {currentDocumentaryFootageFallback} from './documentary-fast-plan.js';
import {documentaryGeographicReservePlan,documentaryGeographicReserveIssue} from './documentary-thematic-location.js';
import {documentaryGroundedReserveIssue} from './documentary-illustration-fallback.js';

/** Bind automatic scope to the user's input/composition, not a downloaded source. */
export function documentaryThematicRecoveryBinding(project:Project,scene:Scene):string {
  const doc=scene.documentary;
  const {footageFallback:_fallback,...requirement}=doc?.requirement??{};
  return createHash('sha256').update(JSON.stringify([documentaryAiPlanContext(project),project.videoBrief?.prompt,scene.id,scene.narration,
    project.settings.assembly.documentary?.matchMode,requirement,scene.includeInAssembly,scene.imagePrompt,scene.animationPrompt,
    scene.characterIds,doc?.pinned,doc?.cuts,doc?.texts,doc?.caption,doc?.layout,doc?.comparison,
    doc?.template,doc?.templateOrigin,doc?.motionGraphic,doc?.effects])).digest('hex');
}

/** Shared authored-input policy for automatic footage and native narration cards. */
export function documentaryAutomaticRecoveryPolicyIssue(project:Project,scene:Scene):string|undefined {
  const doc=scene.documentary;
  if(!doc||doc.verified||doc.pinned||scene.includeInAssembly===false)return 'Сцена готова, закреплена или исключена.';
  const reserveIssue=documentaryThematicReserveIssue(doc.requirement.aiSearchPlan);if(reserveIssue)return reserveIssue;
  // AI's historical/exact classification alone is not an authored visual directive.
  // A literal user policy, required shot checks or editor composition is binding.
  if(project.settings.assembly.documentary?.matchMode==='literal')return 'Явно задано точное визуальное соответствие.';
  if(doc.requirement.scriptRequirements?.mode!=='thematic'&&doc.requirement.scriptRequirements?.checks.length)
    return 'Есть обязательные визуальные проверки сценария.';
  if(scene.characterIds?.length||doc.cuts?.length||doc.texts?.length||doc.caption.enabled||doc.layout!=='full'||doc.comparison
    ||doc.template&&doc.templateOrigin!=='automatic'||doc.motionGraphic?.enabled&&doc.motionGraphic.origin!=='automatic'
    ||doc.effects?.some(effect=>effect.enabled&&effect.kind!=='audio'&&effect.boundary?.origin!=='automatic'))return 'Сохранена ручная композиция.';
  // Script uploads can contain explicit shot directions without a parsed storyboard.
  // Nonempty prompts alone have no manual provenance: generated scene prompts
  // are common. Explicit shot directives remain binding wherever they occur.
  const authored=[project.videoBrief?.readyScript,project.videoBrief?.prompt,scene.narration,scene.imagePrompt,scene.animationPrompt].filter(Boolean).join('\n');
  if(/(?:\[|^|\n)\s*(?:visuals?|shot|b[ -]?roll|on[ -]?screen|кадр|визуал|видеоряд|раскадровка)\s*[:\]]/imu.test(authored))return 'Есть явные визуальные указания сценария.';
  const explicitDirective=/(?:^|[.!?\n]\s*|\[)\s*(?:(?:please\s+)?(?:show|use|include)\s+(?:only|exclusively)\s+(?:the\s+)?(?:actual|authentic|archival|historical|exact)\b|(?:do\s+not|don't|never)\s+use\s+(?:any\s+)?(?:generic|thematic|illustrative|stock)\s+(?:footage|images?|illustrations?|b[ -]?roll)\b|(?:покажи(?:те)?|показывать|используй(?:те)?|использовать)\s+только\s+(?:исторические|архивные|подлинные|точные)\s+(?:кадры|снимки|изображения)|не\s+(?:использовать|используй(?:те)?|показывать)\s+(?:тематические|общие|стоковые)\s+(?:иллюстрации|кадры|изображения))/imu;
  // Restrictive adverbs can precede the imperative or follow its object.
  // Keep the sentence-start imperative gate: narrative archive references are not instructions.
  const archivalOnlyDirective=/(?:^|[.!?\n]\s*|\[)\s*(?:(?:please\s+)?(?:(?:only|exclusively)\s+(?:show|use|include)\s+(?:the\s+)?(?:actual|authentic|archival|historical|exact)\b|(?:show|use|include)\s+(?:the\s+)?(?:actual|authentic|archival|historical|exact)\s+(?:footage|images?|photographs?|videos?|shots?|material)\s+(?:only|exclusively)\b)|(?:покажи(?:те)?|показывать|используй(?:те)?|использовать)\s+(?:только|исключительно)\s+(?:историческ(?:ие|ое)|архивн(?:ые|ое)|подлинн(?:ые|ое)|точн(?:ые|ое))\s+(?:кадры|снимки|изображения|видео))/imu;
  if(explicitDirective.test(authored)||archivalOnlyDirective.test(authored))
    return 'Есть явный запрет тематических иллюстраций или требование архивных кадров.';
}

export function documentaryAutomaticThematicIssue(project:Project,scene:Scene):string|undefined {
  const policy=documentaryAutomaticRecoveryPolicyIssue(project,scene);if(policy)return policy;
  const doc=scene.documentary!,ai=currentDocumentaryAiSearchPlan(project,scene);
  if(doc.requirement.footageFallback)return 'Резерв уже сохранён; продолжение использует его существующую стадию.';
  if(!ai)return 'Нет актуального AI-плана.';
  const groundedIssue=documentaryGroundedReserveIssue(doc.requirement);if(groundedIssue)return groundedIssue;
  if(!ai.fallbackVisualTarget.trim()||!ai.fallbackVideoQueries.length)return 'AI-план не содержит разрешённого тематического резерва.';
  if(ai.fallbackVideoQueries.some(query=>query.trim().length<2||query.length>240))return 'Некорректные запросы AI-резерва.';
  const bound=documentaryGeographicReservePlan(scene,ai);
  if(!bound.fallbackVideoQueries.length||bound.fallbackVideoQueries.some(query=>query.trim().length<2||query.length>240))
    return 'Не удалось сохранить обязательную географию в доступных видеозапросах резерва; нужен новый план.';
}

export function documentaryAutomaticThematicEligible(project:Project,scene:Scene):boolean {
  return !documentaryAutomaticThematicIssue(project,scene);
}

/** Called only after the primary queue AND its donor pass have exhausted their work. */
export function claimDocumentaryThematicRecovery(project:Project,scene:Scene,blockedSourceKeys:string[]=[]):Scene {
  if(!documentaryAutomaticThematicEligible(project,scene))return scene;
  const previous=scene.documentary!,ai=documentaryGeographicReservePlan(scene,currentDocumentaryAiSearchPlan(project,scene)!);
  scene={...scene,documentary:{...previous,requirement:{...previous.requirement,aiSearchPlan:ai}}};
  const doc=scene.documentary!;
  const reason='Основной поиск исчерпан. Тематическая иллюстрация; не архив названного события.';
  return {...scene,status:'failed',documentary:{...doc,verified:false,visualReview:undefined,manualReview:undefined,nativeFallback:undefined,searchRecovery:undefined,
    illustrative:true,illustrationLabelInEditorOnly:true,reviewNote:reason,autoError:reason,
    selectionPlan:{kind:'video',videoPercent:project.settings.stockVideoPercent},
    requirement:{...doc.requirement,footageFallback:{version:1,target:ai.fallbackVisualTarget,queries:[...ai.fallbackVideoQueries],
      originalTarget:ai.visualTarget,narration:scene.narration,kind:'video',reason,
      automaticRecovery:{version:1,binding:documentaryThematicRecoveryBinding(project,scene),startedAt:new Date().toISOString(),blockedSourceKeys}}}}};
}

/** Only discovery is projected. Primary identities/narration remain persisted and auditable. */
export function documentaryThematicDiscoveryRequirement(project:Project,scene:Scene):DocumentaryRequirement|undefined {
  if(documentaryGeographicReserveIssue(scene))return;
  const reserve=scene.documentary?.requirement.footageFallback;
  if(scene.documentary&&documentaryGroundedReserveIssue(scene.documentary.requirement,reserve?.target,reserve?.queries))return;
  const fallback=currentDocumentaryFootageFallback(scene),ai=currentDocumentaryAiSearchPlan(project,scene);
  if(!fallback?.automaticRecovery||!ai||fallback.target!==ai.fallbackVisualTarget
    ||JSON.stringify(fallback.queries)!==JSON.stringify(ai.fallbackVideoQueries)
    ||fallback.automaticRecovery.binding!==documentaryThematicRecoveryBinding(project,scene))return;
  return {...scene.documentary!.requirement,entities:[],identities:[],years:[...new Set(fallback.target.match(/\b(?:18|19|20)\d{2}\b/g)??[])],
    detail:fallback.target,queries:[...fallback.queries],visualScope:'illustrative',preferredKind:'video',historicalIllustration:undefined};
}

/** Called at selection resume, after reading the current query plan. Keep media
 * and disk receipts, but never carry a generic pixel approval into a new task. */
export function repairDocumentaryGeographicReserve(project:Project,scene:Scene):Scene {
  const doc=scene.documentary,fallback=doc?.requirement.footageFallback,issue=documentaryGeographicReserveIssue(scene);
  const ai=currentDocumentaryAiSearchPlan(project,scene);
  if(!doc||doc.pinned||!fallback?.automaticRecovery||!issue||!ai
    ||fallback.automaticRecovery.binding!==documentaryThematicRecoveryBinding(project,scene))return scene;
  const corrected=documentaryGeographicReservePlan(scene,ai);
  if(!corrected.fallbackVideoQueries.length||corrected.fallbackVideoQueries.some(query=>query.length>240))return scene;
  const base={...scene,documentary:{...doc,verified:false,visualReview:undefined,manualReview:undefined,autoError:issue,
    requirement:{...doc.requirement,aiSearchPlan:corrected}}};
  return {...base,documentary:{...base.documentary,requirement:{...base.documentary.requirement,
    footageFallback:{...fallback,target:corrected.fallbackVisualTarget,queries:[...corrected.fallbackVideoQueries],
      automaticRecovery:{...fallback.automaticRecovery,binding:documentaryThematicRecoveryBinding(project,base)}}}}};
}
