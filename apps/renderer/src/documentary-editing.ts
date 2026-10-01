import type { DocumentaryVisualCut, Scene } from "@gold-work/shared";

export const documentaryFrames = (scene: Scene) => Math.max(scene.documentary?.timing?.durationInFrames ?? Math.ceil(scene.durationSeconds * 30), Math.ceil((scene.durationOverrideSeconds ?? 0) * 30));

export function visualCuts(scene: Scene): DocumentaryVisualCut[] {
  return scene.documentary?.cuts?.length ? scene.documentary.cuts : [{ id: `base-${scene.id}`, fromFrame: 0,
    durationInFrames: documentaryFrames(scene), trimStartSeconds: scene.trimStartSeconds ?? 0,
    trimEndSeconds: scene.trimEndSeconds ?? scene.documentary?.selected?.durationSeconds, playbackRate: scene.playbackRate ?? 1 }];
}

export function splitVisualCut(scene: Scene, frame: number, id: string, sources: Scene[] = []): DocumentaryVisualCut[] | undefined {
  const cuts = visualCuts(scene), at = Math.round(frame);
  const index = cuts.findIndex(cut => at > cut.fromFrame && at < cut.fromFrame + cut.durationInFrames);
  if (index < 0) return;
  const cut = cuts[index]!, left = at - cut.fromFrame;
  const source = cut.sourceSceneId ? sources.find(item=>item.id===cut.sourceSceneId) : scene;
  const end = cut.trimEndSeconds ?? source?.documentary?.selected?.durationSeconds;
  const sourceAt = Math.min(end ?? Infinity, cut.trimStartSeconds + left / 30 * cut.playbackRate);
  // Splitting a held last frame must not create an empty/out-of-source trim.
  const rightStart = end === undefined ? sourceAt : Math.min(sourceAt, Math.max(cut.trimStartSeconds,end-1/30));
  return [...cuts.slice(0,index), { ...cut, durationInFrames: left, trimEndSeconds: sourceAt },
    { ...cut, id, fromFrame: at, durationInFrames: cut.durationInFrames - left, trimStartSeconds: rightStart, trimEndSeconds:end }, ...cuts.slice(index+1)];
}

/** Roll a boundary: picture changes, overall duration and narration do not. */
export function rollVisualCut(scene: Scene, rightId: string, deltaFrames: number): DocumentaryVisualCut[] {
  const cuts = visualCuts(scene), index = cuts.findIndex(cut => cut.id === rightId);
  if (index < 1) return cuts;
  const left = cuts[index-1]!, right = cuts[index]!;
  const low = Math.max(1-left.durationInFrames, Math.ceil(-right.trimStartSeconds/right.playbackRate*30));
  const high = Math.min(right.durationInFrames-1,right.trimEndSeconds===undefined?Infinity:Math.floor((right.trimEndSeconds-1/30-right.trimStartSeconds)/right.playbackRate*30+1e-6));
  const delta = Math.max(low, Math.min(high,Math.round(deltaFrames)));
  return cuts.map((cut,i) => i === index-1 ? {...cut,durationInFrames:cut.durationInFrames+delta,
    trimEndSeconds:cut.trimEndSeconds===undefined?undefined:cut.trimEndSeconds+delta/30*cut.playbackRate}
    : i === index ? {...cut,fromFrame:cut.fromFrame+delta,durationInFrames:cut.durationInFrames-delta,trimStartSeconds:cut.trimStartSeconds+delta/30*cut.playbackRate} : cut);
}

export function mergeVisualCut(scene: Scene, id: string): DocumentaryVisualCut[] {
  const cuts = visualCuts(scene), index = cuts.findIndex(cut=>cut.id===id);
  if(index<1)return cuts;
  return cuts.flatMap((cut,i)=>i===index?[]:i===index-1?[{...cut,durationInFrames:cut.durationInFrames+cuts[index]!.durationInFrames,trimEndSeconds:undefined}]:[cut]);
}
