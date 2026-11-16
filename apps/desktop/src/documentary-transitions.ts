import type { Project, Scene } from "@gold-work/shared";
import {documentaryHookSeconds} from '@gold-work/shared';

export function documentaryTransitionLocked(scene: Scene): boolean {
  const doc=scene.documentary;
  return !doc||Boolean(doc.pinned||doc.templateOrigin==='manual'||doc.motionGraphic?.origin==='manual'
    ||doc.cuts?.length&&doc.cutsOrigin!=='automatic');
}

/** The same narrative boundary drives the built-in fallback and a library seam. */
export function documentaryBoundaryContext(project: Project, left: Scene, right: Scene, at: number) {
  const settings=project.settings.assembly.documentary,l=left.documentary,r=right.documentary;
  const chapter=Boolean(r?.motionGraphic?.enabled&&r.motionGraphic.kind==='chapter-number'||r?.template?.startsWith('chapter-'));
  const section=Boolean(l?.requirement.sectionTitle?.trim()&&r?.requirement.sectionTitle?.trim()&&l.requirement.sectionTitle.trim()!==r.requirement.sectionTitle.trim());
  const era=Boolean(l?.requirement.years?.length&&r?.requirement.years?.length&&l.requirement.years.join()!==r.requirement.years.join());
  const semantic=Boolean(r?.semanticMontage&&['turn','conflict','resolve'].includes(r.semanticMontage.beat)&&r.semanticMontage.beat!==l?.semanticMontage?.beat);
  const continuing=Boolean(l?.motionGraphic?.enabled&&r?.motionGraphic?.enabled&&l.motionGraphic.sequenceId&&l.motionGraphic.sequenceId===r.motionGraphic.sequenceId);
  const treatment=Boolean(l?.template&&r?.template&&l.template!==r.template
    &&!['full','push','pull','contain'].includes(r.template));
  return {chapter,section,era,semantic,continuing,treatment,
    meaningful:chapter||section||era||semantic||treatment,
    inHook:Boolean(settings?.montage&&at<documentaryHookSeconds(settings.montage)),
    density:settings?.montage?.intensity??settings?.montageDensity??'rich',
    hasMedia:Boolean(left.videoPath||left.imagePath)&&Boolean(right.videoPath||right.imagePath)};
}

/** Time-spaced transitions plus stronger accents at semantic boundaries.
 * Scene.transition is authored, autoTransition is always replaceable planning. */
export function planDocumentaryTransitions(project: Project): Scene[] {
  const settings = project.settings.assembly.documentary;
  if (!settings) return project.scenes;
  if ((settings.autoTransitions ?? settings.autoEffects) === false) return project.scenes.map(scene=>{
    const doc=scene.documentary;if(!doc||doc.pinned||scene.includeInAssembly===false)return scene;
    const effects=doc.effects.filter(e=>!(e.kind!=='audio'&&e.boundary?.origin==='automatic'));
    if(scene.autoTransition===undefined&&scene.autoTransitionDurationSeconds===undefined&&doc.autoTransitionStyle===undefined&&effects.length===doc.effects.length)return scene;
    return {...scene,autoTransition:undefined,autoTransitionDurationSeconds:undefined,
      documentary:{...doc,autoTransitionStyle:undefined,effects}};
  });
  const included = [...project.scenes].filter(s => s.includeInAssembly !== false).sort((a,b) => a.order-b.order);
  const changes = new Map<string, Scene>();
  const density = settings.montage?.intensity ?? settings.montageDensity ?? 'rich';
  let cursor = 0;
  const seconds = (s: Scene) => Math.max((s.documentary?.timing?.durationInFrames ?? Math.ceil(s.durationSeconds * 30)) / 30, s.durationOverrideSeconds ?? 0);
  for (let i=0;i<included.length;i++) {
    const left=included[i]!, right=included[i+1]; cursor+=seconds(left);
    if (!left.documentary || documentaryTransitionLocked(left)) continue;
    if (!right || !right.documentary || documentaryTransitionLocked(right)) {
      if(left.autoTransition!==undefined||left.autoTransitionDurationSeconds!==undefined||left.documentary.autoTransitionStyle!==undefined)
        changes.set(left.id,{...left,autoTransition:undefined,autoTransitionDurationSeconds:undefined,documentary:{...left.documentary,autoTransitionStyle:undefined}});
      continue;
    }
    if (left.transition !== undefined || left.transitionDurationSeconds !== undefined) {
      continue;
    }
    const l=left.documentary, r=right.documentary;
    const illustrativeInsert=l.semanticMontage?.cutawayMode==='replace'||r.semanticMontage?.cutawayMode==='replace';
    const librarySeam=[...l.effects,...r.effects].some(e=>e.kind!=='audio'&&e.boundary?.from===left.id&&e.boundary.to===right.id);
    const {continuing,chapter,section,era,semantic,meaningful,hasMedia}=documentaryBoundaryContext(project,left,right,cursor);
    const sameSection=Boolean(l.requirement.sectionTitle?.trim()&&l.requirement.sectionTitle.trim()===r.requirement.sectionTitle?.trim());
    const sameSubject=l.requirement.identities?.some(a=>r.requirement.identities?.some(b=>a.name.toLowerCase()===b.name.toLowerCase()));
    // Short blends connect related photographs without making every shot a
    // transition or overlapping/truncating narration. Real moving shots keep cuts.
    const photoLink=Boolean(left.imagePath&&right.imagePath&&!left.videoPath&&!right.videoPath&&left.imagePath!==right.imagePath
      &&!l.motionGraphic?.enabled&&!r.motionGraphic?.enabled&&(sameSection||sameSubject));
    const beat=r.semanticMontage?.beat;
    // Conflict/turn land on a clean cut. Chapters/era changes breathe through
    // black; related archive photos dissolve. A timer cannot invent a boundary.
    const hardBeat=semantic&&(beat==='conflict'||beat==='turn');
    const candidate=!hardBeat&&(meaningful||hasMedia&&photoLink);
    const dissolve=!illustrativeInsert&&!librarySeam&&!continuing&&Math.min(seconds(left),seconds(right))>=1.5&&candidate;
    // Preserve an explicitly selected all-film transition. This planner only
    // adds occasional accents where the global default is a straight cut.
    const global=project.settings.assembly.transitionType??'none';
    const autoTransition=illustrativeInsert||hardBeat?'none':dissolve?chapter||era?'fade':'mix':librarySeam?'none':undefined;
    const nextKind=global!=='none'&&!librarySeam&&!illustrativeInsert?undefined:autoTransition;
    const nextDuration=nextKind&&nextKind!=='none'?(chapter?.45:section||era?.35:density==='rich'?.3:.2):undefined;
    const televisionChange=l.semanticMontage?.treatment!==r.semanticMontage?.treatment
      &&(l.semanticMontage?.treatment==='television'||r.semanticMontage?.treatment==='television');
    const autoTransitionStyle=nextKind==='mix'&&density==='rich'
      ?televisionChange?'glitch':semantic&&beat==='resolve'?'blur':undefined:undefined;
    if(left.autoTransition!==nextKind||left.autoTransitionDurationSeconds!==nextDuration||l.autoTransitionStyle!==autoTransitionStyle)
      changes.set(left.id,{...left,autoTransition:nextKind,autoTransitionDurationSeconds:nextDuration,documentary:{...l,autoTransitionStyle}});
  }
  return project.scenes.map(s=>changes.get(s.id)??s);
}
