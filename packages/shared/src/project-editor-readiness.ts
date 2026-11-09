import type { Project } from './index.js';
import { documentaryMaterialUsable } from './documentary.js';

/** Input readiness is independent of an exported Final and of queue progress. */
export function projectEditorReady(project: Project): boolean {
  const scenes = project.scenes.filter(scene => scene.includeInAssembly !== false);
  return scenes.length > 0 && scenes.every(scene => {
    const documentary = project.mediaMode === 'stock' && project.settings.assembly.documentary?.version === 2;
    const doc = scene.documentary, graphic = doc?.motionGraphic;
    const nativeGraphic = doc?.verified && !doc.selected && graphic?.enabled && graphic.origin === 'automatic'
      && graphic.title.trim() && graphic.durationSeconds > 0;
    const visual = documentary
      ? Boolean(doc?.selected ? doc.selected.kind === 'video' ? scene.videoPath : scene.imagePath : nativeGraphic)
      : Boolean(scene.imagePath || scene.videoPath);
    return visual && (!documentary || documentaryMaterialUsable(scene))
      && (!project.settings.voice.enabled || !scene.narration.trim() || Boolean(scene.audioPath));
  });
}
