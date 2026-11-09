import type {DocumentaryArtwork, DocumentaryArtworkLayer, DocumentaryMotionGraphic, Scene} from '@gold-work/shared';

export function updateArtworkLayer(artwork: DocumentaryArtwork, id: string, patch: Partial<DocumentaryArtworkLayer>): DocumentaryArtwork {
  return {...artwork, layers: artwork.layers.map(layer => layer.id === id ? {...layer, ...patch,
    ...(layer.kind === 'text' && patch.fill !== undefined ? {fillOrigin: 'manual' as const} : {}),
    // These are the editable style fields that contribute to trajectory bounds.
    // Keep the first values, including absent/default ones, through later edits.
    ...('stroke' in patch || 'strokeWidth' in patch ? {framingBeforeEdit: layer.framingBeforeEdit ?? {
      stroke: layer.stroke, strokeWidth: layer.strokeWidth}} : {})} : layer)};
}

// Match the existing shared artwork clock. Editing a member must not split the
// span into independently restarting animations. Unrelated graphics stay intact.
function sequenceKey(g?: DocumentaryMotionGraphic) {
  return g?.enabled && g.artwork && !g.argument && !g.explanation && g.kind !== 'chapter-number'
    && g.sequenceId && g.startSeconds === 0
    ? JSON.stringify([g.sequenceId,g.kind,g.title,g.value,g.items,g.theme,g.variant,g.preset,g.highlight,g.accentColor,g.quoteMode,g.presentation,g.panels?.map(p=>[p.sceneId,p.label]),g.cards,g.boardLayout,g.route,g.artwork,g.artworkSpan]) : undefined;
}

export function updateSceneArtwork<T extends Scene>(scenes: T[], sceneId: string, artwork: DocumentaryArtwork): T[] {
  const ordered = [...scenes].sort((a,b) => a.order-b.order).filter(scene => scene.includeInAssembly !== false);
  const index = ordered.findIndex(scene => scene.id === sceneId);
  const selected = scenes.find(scene => scene.id === sceneId);
  if (!selected?.documentary?.motionGraphic?.artwork) return scenes;
  const ids = new Set([sceneId]);
  const key = sequenceKey(selected.documentary.motionGraphic);
  if (key && index >= 0) {
    for (let i=index-1;i>=0 && sequenceKey(ordered[i]!.documentary?.motionGraphic)===key;i--) ids.add(ordered[i]!.id);
    for (let i=index+1;i<ordered.length && sequenceKey(ordered[i]!.documentary?.motionGraphic)===key;i++) ids.add(ordered[i]!.id);
  }
  return scenes.map(scene => ids.has(scene.id) ? {...scene, documentary: {...scene.documentary!,
    motionGraphic: {...scene.documentary!.motionGraphic!, artwork, origin: 'manual'}}} : scene);
}
