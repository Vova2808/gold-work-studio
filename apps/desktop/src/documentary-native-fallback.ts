import type {Project,Scene,DocumentaryMotionGraphic} from '@gold-work/shared';
import {documentaryThematicReserveIssue} from '@gold-work/shared';
import {documentarySceneSeconds} from './documentary-sequences.js';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {documentaryThematicRecoveryBinding} from './documentary-automatic-thematic-recovery.js';

function sourceFallbackGraphic(scene:Scene):DocumentaryMotionGraphic {
  const doc=scene.documentary;
  const frames=Math.max(1,doc?.timing?.durationInFrames??Math.ceil(scene.durationSeconds*30),Math.ceil((scene.durationOverrideSeconds??0)*30));
  // Bind the presentation to the actual source, including its review and trim.
  // It is not a replacement source or a claim that its pixels were approved.
  const sourceChecksum=createHash('sha256').update(JSON.stringify([doc?.selected,scene.imagePath,scene.videoPath,
    scene.stockSource,doc?.checksum,doc?.visualHash,doc?.visualReview,doc?.verified,doc?.manualReview,
    scene.trimStartSeconds,scene.trimEndSeconds,scene.playbackRate,scene.sourceVolume,doc?.requirement])).digest('hex');
  return {kind:'quote',enabled:true,title:scene.narration.replace(/\s+/gu,' ').trim(),origin:'automatic',
    quoteMode:'phrase',preset:'type-slam',showSource:false,theme:'dark',sourceChecksum,
    startSeconds:0,durationSeconds:frames/30};
}

/** This exact native preset has an opaque, unfaded background and never mounts
 * its material when showSource=false. Arbitrary titles/metadata are not proof. */
export function documentarySourcePreservingFallbackReady(scene:Scene):boolean {
  const doc=scene.documentary,fallback=doc?.nativeFallback,graphic=doc?.motionGraphic;
  if(documentaryThematicReserveIssue(doc?.requirement.aiSearchPlan))return false;
  if(!doc||doc.pinned||!doc.selected||!fallback||fallback.version!==1||fallback.narration!==scene.narration
    ||!fallback.reason.trim()||!fallback.previousMaterial||doc.layout!=='full'||doc.template!=='full'
    ||doc.templateOrigin!=='automatic'||doc.templateTiming||doc.cuts?.length||doc.comparison||doc.caption.enabled||doc.texts?.length
    ||doc.effects.some(e=>e.enabled&&e.kind!=='audio'&&e.role==='background'))return false;
  const expected=sourceFallbackGraphic(scene);
  return expected.title.length>0&&expected.title.length<=320&&Number.isFinite(expected.durationSeconds)&&expected.durationSeconds>=1/30
    &&isDeepStrictEqual(graphic,expected)&&isDeepStrictEqual(
      [fallback.previousMaterial.selected,fallback.previousMaterial.imagePath,fallback.previousMaterial.videoPath,
        fallback.previousMaterial.checksum,fallback.previousMaterial.visualHash,fallback.previousMaterial.visualReview],
      [doc.selected,scene.imagePath,scene.videoPath,doc.checksum,doc.visualHash,doc.visualReview]);
}

/** Called only for an explicit canonical mismatch after ordinary replacements
 * and authored compositions had their priority. Keep every source/review byte. */
export function applyDocumentarySourcePreservingFallback(project:Project,scene:Scene,issue:string):Scene {
  const doc=scene.documentary,g=doc?.motionGraphic,settings=project.settings.assembly.documentary;
  if(documentaryThematicReserveIssue(doc?.requirement.aiSearchPlan))return scene;
  if(project.mediaMode!=='stock'||settings?.version!==2||settings.autoMotionGraphics===false||scene.includeInAssembly===false
    ||!doc||doc.verified||doc.pinned||!doc.selected||!issue||doc.templateOrigin==='manual'||doc.templateMotion?.amountPercent===0
    ||g&&(g.origin!=='automatic'||g.enabled===false||g.artwork||g.diagram||g.explanation||g.argument||g.cards?.length||g.sequenceId)
    ||doc.semanticMontage?.composition||doc.semanticMontage?.artwork||doc.semanticMontage?.explanation||doc.semanticMontage?.chapter
    ||doc.cuts?.length||doc.texts?.length||doc.caption.enabled||doc.layout==='compare'||doc.comparison
    ||doc.effects.some(e=>e.enabled&&e.kind!=='audio'&&(e.origin!=='automatic'||e.role==='background')))return scene;
  // A changed source must not silently inherit an old fallback's acceptance.
  if(doc.nativeFallback&&!documentarySourcePreservingFallbackReady(scene))return scene;
  const graphic=sourceFallbackGraphic(scene);
  if(!graphic.title||graphic.title.length>320||!Number.isFinite(graphic.durationSeconds)||graphic.durationSeconds<1/30)return scene;
  return {...scene,documentary:{...doc,layout:'full',template:'full',templateOrigin:'automatic',templateTiming:undefined,motionGraphic:graphic,
    nativeFallback:{version:1,narration:scene.narration,reason:issue,previousMaterial:{selected:doc.selected,imagePath:scene.imagePath,
      videoPath:scene.videoPath,checksum:doc.checksum,visualHash:doc.visualHash,visualReview:doc.visualReview}}}};
}

function graphicFor(scene:Scene):DocumentaryMotionGraphic {
  return {kind:'quote',enabled:true,title:scene.narration.replace(/\s+/gu,' ').trim(),kicker:'',quoteMode:'speech',
    variant:'marker',origin:'automatic',startSeconds:0,durationSeconds:documentarySceneSeconds(scene),background:'grid-dark'};
}

/** Full narration card using the existing animated editorial composition. */
export function applyDocumentaryNativeFallback(project:Project,scene:Scene):Scene {
  const doc=scene.documentary,g=doc?.motionGraphic,text=scene.narration.trim();
  if(documentaryThematicReserveIssue(doc?.requirement.aiSearchPlan))return scene;
  if(project.mediaMode!=='stock'||project.settings.assembly.documentary?.version!==2||scene.includeInAssembly===false
    ||!doc||doc.verified||doc.pinned||!text||text.replace(/\s+/gu,' ').length>320||!doc.autoError
    ||doc.cuts?.length||doc.texts?.length||doc.caption.enabled||doc.layout==='compare'||doc.comparison
    ||doc.templateOrigin==='manual'||(doc.effects??[]).some(e=>e.enabled&&e.kind!=='audio'&&e.boundary?.origin!=='automatic')||g&&g.origin!=='automatic')return scene;
  const graphic=graphicFor(scene);
  if(!Number.isFinite(graphic.durationSeconds)||graphic.durationSeconds<=0)return scene;
  const previousMaterial=doc.nativeFallback?.previousMaterial??{selected:doc.selected,imagePath:scene.imagePath,videoPath:scene.videoPath,
    checksum:doc.checksum,visualHash:doc.visualHash,visualReview:doc.visualReview};
  return {...scene,imagePath:undefined,videoPath:undefined,stockSource:undefined,trimStartSeconds:undefined,trimEndSeconds:undefined,
    documentary:{...doc,selected:undefined,checksum:undefined,visualHash:undefined,visualReview:undefined,
      candidates:doc.selected?[doc.selected,...doc.candidates.filter(c=>c.id!==doc.selected!.id)]:doc.candidates,
      template:'full',templateTiming:undefined,templateOrigin:'automatic',layout:'full',motionGraphic:graphic,
      nativeFallback:{version:1,narration:scene.narration,reason:doc.autoError,previousMaterial},
      verified:true,illustrative:true,illustrationLabelInEditorOnly:true,autoError:undefined,
      reviewNote:`Графическая сцена по исходной реплике. Материал можно заменить. Причина: ${doc.autoError}`}};
}

export function documentaryNativeFallbackReady(project:Project,scene:Scene):boolean {
  const doc=scene.documentary,fallback=doc?.nativeFallback;
  if(documentaryThematicReserveIssue(doc?.requirement.aiSearchPlan))return false;
  if(project.mediaMode!=='stock'||project.settings.assembly.documentary?.version!==2||!doc?.verified||!fallback
    ||fallback.version!==1||fallback.narration!==scene.narration||!fallback.reason.trim()
    ||doc.selected||scene.imagePath||scene.videoPath||doc.visualReview||doc.checksum||doc.pinned)return false;
  if(fallback.automaticRecovery&&(project.settings.assembly.documentary.autoMotionGraphics!==true
    ||project.settings.assembly.documentary.excludedTemplates?.includes('full')
    ||fallback.automaticRecovery.binding!==documentaryThematicRecoveryBinding(project,scene)))return false;
  const expected=graphicFor(scene),actual=doc.motionGraphic;
  return Boolean(expected.title&&expected.title.length<=320&&actual?.enabled&&actual.kind===expected.kind
    &&actual.title===expected.title&&actual.quoteMode==='speech'&&actual.origin==='automatic'
    &&actual.startSeconds===0&&Math.abs(actual.durationSeconds-expected.durationSeconds)<1/30);
}
