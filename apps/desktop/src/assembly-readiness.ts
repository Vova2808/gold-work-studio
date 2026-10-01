import type { Project, QueueTask, Scene, TaskKind } from "@gold-work/shared";
import { documentaryEditErrors } from "./documentary-validation.js";

/** Check available inputs and work that is actually scheduled; failed/cancelled jobs are not promises of media. */
export function missingAssemblyInputs(
  project: Project,
  tasks: QueueTask[] = [],
  fileAvailable: (path: string) => boolean = () => true,
): string[] {
  const included = project.scenes.filter(scene => scene.includeInAssembly !== false);
  if (included.length === 0) return ["нет включённых сцен"];
  const scheduled = (scene: Scene, kind: TaskKind) => tasks.some(task =>
    task.projectId === project.id && task.sceneId === scene.id && task.kind === kind
    && ["pending", "running", "retry_wait", "paused"].includes(task.status));
  return [...documentaryEditErrors(project), ...included.flatMap(scene => {
    const missing: string[] = [];
    if (project.mediaMode === "stock" && project.settings.assembly.documentary?.version === 2 && !scene.documentary?.verified) {
      missing.push(`сцена ${scene.order + 1}: подтвердите объект, эпоху и условия использования материала`);
    }
    const videoEnabled = (project.settings.video.enabled && !scene.videoFallback) || scene.stockSource?.mediaType === "video";
    const imageReady = Boolean(scene.imagePath && fileAvailable(scene.imagePath));
    const videoReady = Boolean(videoEnabled && scene.videoPath && fileAvailable(scene.videoPath));
    if (!imageReady && !videoReady && !scheduled(scene, "image") && !(videoEnabled && scheduled(scene, "video"))) {
      missing.push(`сцена ${scene.order + 1}: изображение или видео`);
    }
    if (project.settings.voice.enabled && scene.narration.trim() && !(scene.audioPath && fileAvailable(scene.audioPath)) && !scheduled(scene, "speech")) {
      missing.push(`сцена ${scene.order + 1}: озвучка`);
    }
    return missing;
  })];
}
