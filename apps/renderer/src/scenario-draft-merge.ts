import type {Scene} from "@gold-work/shared";

const editable = ["title", "narration", "imagePrompt", "animationPrompt", "durationSeconds", "durationOverrideSeconds",
  "includeInAssembly", "transition", "kenBurnsDirection", "playbackRate", "trimStartSeconds", "trimEndSeconds",
  "narrationVolume", "sourceVolume", "transitionDurationSeconds", "fadeEdges", "kenBurnsZoom"] as const;
const documentaryEditable = ["caption", "effects", "layout", "comparison", "template", "templateMotion", "templateOrigin", "templateTiming", "transitionStyle", "motionGraphic", "cuts", "texts"] as const;
const materialEditable=['imagePath','videoPath','stockSource','stockAlternates'] as const;
const documentaryMaterialEditable=['selected','checksum','visualHash','visualReview','verified','pinned','manualReview','illustrative','illustrationLabelInEditorOnly','reviewNote','autoError'] as const;

/** Apply backend repairs, retaining only fields actually changed locally since the last snapshot. */
export function mergeScenarioDraft(local: Scene[], previous: Scene[], incoming: Scene[],materialSceneIds:readonly string[]=[]): Scene[] {
  const oldById = new Map(previous.map(scene => [scene.id, scene]));
  const localById = new Map(local.map(scene => [scene.id, scene]));
  const incomingById = new Map(incoming.map(scene => [scene.id, scene]));
  const structureChanged = local.length !== previous.length || local.some((scene, index) => scene.id !== previous[index]?.id);
  const ordered = structureChanged
    ? [...local, ...incoming.filter(scene => !oldById.has(scene.id) && !localById.has(scene.id))]
    : incoming;
  return ordered.map((scene, order) => {
    const remote = incomingById.get(scene.id);
    const edited = localById.get(scene.id);
    const baseline = oldById.get(scene.id);
    if (!remote || !edited || !baseline) return {...(remote ?? edited ?? scene), order};
    const fields=materialSceneIds.includes(scene.id)?[...editable,...materialEditable]:editable;
    const documentaryFields=materialSceneIds.includes(scene.id)?[...documentaryEditable,...documentaryMaterialEditable]:documentaryEditable;
    const changed = Object.fromEntries(fields.filter(key => JSON.stringify(edited[key]) !== JSON.stringify(baseline[key])).map(key => [key, edited[key]]));
    // Material/TTS updates are remote-owned. Retain only edited Stock composition fields.
    const documentary = remote.documentary && edited.documentary && baseline.documentary ? {
      ...remote.documentary,
      ...Object.fromEntries(documentaryFields
        .filter(key => JSON.stringify(edited.documentary![key]) !== JSON.stringify(baseline.documentary![key]))
        .map(key => [key, edited.documentary![key]]))
    } : remote.documentary;
    return {...remote, ...changed, ...(remote.documentary ? { documentary } : {}), order};
  });
}

/** Undo composition edits without rolling back media or TTS that arrived meanwhile. */
export function restoreDocumentaryEdit(snapshot: Scene[], current: Scene[],materialSceneIds:readonly string[]=[]): Scene[] {
  return snapshot.map((saved, order) => {
    const latest = current.find(scene => scene.id === saved.id);
    if (!latest) return { ...saved, order };
    const fields=materialSceneIds.includes(saved.id)?[...editable,...materialEditable]:editable;
    const documentaryFields=materialSceneIds.includes(saved.id)?[...documentaryEditable,...documentaryMaterialEditable]:documentaryEditable;
    return { ...latest, ...Object.fromEntries(fields.map(key => [key, saved[key]])), order,
      ...(latest.documentary && saved.documentary ? { documentary: { ...latest.documentary,
        ...Object.fromEntries(documentaryFields.map(key => [key, saved.documentary![key]])) } } : {}) };
  });
}
