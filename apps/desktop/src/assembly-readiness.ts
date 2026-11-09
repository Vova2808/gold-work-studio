import type { Project, QueueTask, Scene, TaskKind } from "@gold-work/shared";
import {documentaryMaterialUsable} from '@gold-work/shared';
import { documentaryEditErrors } from "./documentary-validation.js";
import {documentarySavedContextIssue} from './documentary-context-approval.js';
import {fastDocumentaryGraphicReady} from './documentary-fast-graphics.js';
import {documentaryNativeFallbackReady} from './documentary-native-fallback.js';
import {documentaryStandaloneArtworkReady} from './documentary-source-eligibility.js';

/** Check available inputs and work that is actually scheduled; failed/cancelled jobs are not promises of media. */
export function missingAssemblyInputs(
  project: Project,
  tasks: QueueTask[] = [],
  fileAvailable: (path: string) => boolean = () => true,
): string[] {
  const included = project.scenes.filter(scene => scene.includeInAssembly !== false);
  if (included.length === 0) return ["нет включённых сцен"];
  const stockDocumentary=project.mediaMode==='stock'&&project.settings.assembly.documentary?.version===2;
  const scheduled = (scene: Scene, kind: TaskKind) => tasks.some(task =>
    task.projectId === project.id && task.sceneId === scene.id && task.kind === kind
    && ["pending", "running", "retry_wait", "paused"].includes(task.status));
  return [...documentaryEditErrors(project), ...included.flatMap(scene => {
    const missing: string[] = [];
    const standaloneReady=project.mediaMode==='stock'&&documentaryStandaloneArtworkReady(scene);
    const issue=stockDocumentary&&!standaloneReady?documentarySavedContextIssue(project,scene):undefined;
    if (stockDocumentary) {
      if(!standaloneReady&&!documentaryMaterialUsable(scene,fileAvailable)||issue)missing.push(`сцена ${scene.order + 1}: ${issue??'подтвердите объект, эпоху и условия использования материала'}`);
    }
    const videoEnabled = (project.settings.video.enabled && !scene.videoFallback) || scene.stockSource?.mediaType === "video";
    const imageReady = Boolean(scene.imagePath && fileAvailable(scene.imagePath));
    const videoReady = Boolean(videoEnabled && scene.videoPath && fileAvailable(scene.videoPath));
    const graphic=scene.documentary?.motionGraphic;
    // Saved route comparisons are full-frame media; the edit and context checks validate their binding and geometry.
    const routeReady=stockDocumentary&&!issue&&graphic?.enabled&&graphic.kind==='map-route'&&Boolean(graphic.routeComparison);
    const nativeReady=standaloneReady||scene.documentary?.verified&&(routeReady||documentaryNativeFallbackReady(project,scene)||fastDocumentaryGraphicReady(project,scene));
    if (!nativeReady && !imageReady && !videoReady && !scheduled(scene, "image") && !(videoEnabled && scheduled(scene, "video"))) {
      missing.push(`сцена ${scene.order + 1}: изображение или видео`);
    }
    if (project.settings.voice.enabled && scene.narration.trim() && !(scene.audioPath && fileAvailable(scene.audioPath)) && !scheduled(scene, "speech")) {
      missing.push(`сцена ${scene.order + 1}: озвучка`);
    }
    return missing;
  })];
}
