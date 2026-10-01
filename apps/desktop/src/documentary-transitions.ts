import type { Project, Scene } from "@gold-work/shared";

/** Time-spaced transitions plus stronger accents at semantic boundaries.
 * Scene.transition is authored, autoTransition is always replaceable planning. */
export function planDocumentaryTransitions(project: Project): Scene[] {
  const settings = project.settings.assembly.documentary;
  if (!settings || (settings.autoTransitions ?? settings.autoEffects) === false) return project.scenes;
  const included = [...project.scenes].filter(s => s.includeInAssembly !== false).sort((a,b) => a.order-b.order);
  const changes = new Map<string, Scene>();
  const density = settings.montageDensity ?? 'rich';
  let transitions = 0;
  let cursor = 0, lastTransition = -20;
  const seconds = (s: Scene) => Math.max((s.documentary?.timing?.durationInFrames ?? Math.ceil(s.durationSeconds * 30)) / 30, s.durationOverrideSeconds ?? 0);
  for (let i=0;i<included.length;i++) {
    const left=included[i]!, right=included[i+1]; cursor+=seconds(left);
    if (!left.documentary || left.documentary.pinned) continue;
    if (!right || !right.documentary || right.documentary.pinned) {
      if(left.autoTransition!==undefined||left.autoTransitionDurationSeconds!==undefined)changes.set(left.id,{...left,autoTransition:undefined,autoTransitionDurationSeconds:undefined});
      continue;
    }
    if (left.transition !== undefined || left.transitionDurationSeconds !== undefined) {
      if (left.transition !== 'none' && left.transitionDurationSeconds !== 0) lastTransition=cursor;
      continue;
    }
    const l=left.documentary, r=right.documentary;
    const librarySeam=l.effects?.some(e=>e.enabled&&e.boundary?.from===left.id&&e.boundary.to===right.id);
    const continuing=Boolean(l.motionGraphic?.sequenceId&&l.motionGraphic.sequenceId===r.motionGraphic?.sequenceId);
    const chapter=Boolean(r.motionGraphic?.enabled&&r.motionGraphic.kind==='chapter-number'||r.template?.startsWith('chapter-'));
    const section=Boolean(l.requirement.sectionTitle?.trim()&&r.requirement.sectionTitle?.trim()&&l.requirement.sectionTitle.trim()!==r.requirement.sectionTitle.trim());
    const era=Boolean(l.requirement.years?.length&&r.requirement.years?.length&&l.requirement.years.join()!==r.requirement.years.join());
    const sameSection=Boolean(l.requirement.sectionTitle?.trim()&&l.requirement.sectionTitle.trim()===r.requirement.sectionTitle?.trim());
    const sameSubject=l.requirement.identities?.some(a=>r.requirement.identities?.some(b=>a.name.toLowerCase()===b.name.toLowerCase()));
    // Short blends connect related photographs without making every shot a
    // transition or overlapping/truncating narration. Real moving shots keep cuts.
    const photoLink=Boolean(left.imagePath&&right.imagePath&&!left.videoPath&&!right.videoPath&&left.imagePath!==right.imagePath
      &&!l.motionGraphic?.enabled&&!r.motionGraphic?.enabled&&(sameSection||sameSubject));
    const ordinaryLink=density==='rich'&&Boolean(left.videoPath||left.imagePath)&&Boolean(right.videoPath||right.imagePath);
    const gap=density==='calm'?16:density==='rich'?5:photoLink?7:12;
    const dissolve=!librarySeam&&!continuing&&cursor-lastTransition>=gap&&Math.min(seconds(left),seconds(right))>=1.5&&(chapter||section||era||photoLink||ordinaryLink);
    // Preserve an explicitly selected all-film transition. This planner only
    // adds occasional accents where the global default is a straight cut.
    const global=project.settings.assembly.transitionType??'none';
    const autoTransition=dissolve?chapter?'fade':'mix':librarySeam?'none':undefined;
    if (dissolve||librarySeam)lastTransition=cursor;
    const nextKind=global!=='none'&&!librarySeam?undefined:autoTransition;
    const nextDuration=nextKind&&nextKind!=='none'?(chapter?.45:section||era?.35:density==='rich'?.3:.2):undefined;
    const autoTransitionStyle=nextKind==='mix'&&density==='rich'&&++transitions%3===0?'blur':undefined;
    if(left.autoTransition!==nextKind||left.autoTransitionDurationSeconds!==nextDuration||l.autoTransitionStyle!==autoTransitionStyle)
      changes.set(left.id,{...left,autoTransition:nextKind,autoTransitionDurationSeconds:nextDuration,documentary:{...l,autoTransitionStyle}});
  }
  return project.scenes.map(s=>changes.get(s.id)??s);
}
