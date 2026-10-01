import { setTimeout as delay } from "node:timers/promises";
import type { ProjectService } from "@gold-work/core";
import type { QueueTask } from "@gold-work/shared";
import type { LocalProjectStorage } from "./local-project-storage.js";
import { prepareDocumentaryTiming } from "./documentary-timing.js";

/** A scene can choose its final range as soon as its own paid voice is saved.
 * The no-id call is the all-tracks barrier before effects/render. */
export function documentaryNarrationReadiness(input: {
  projectId: string;
  projects: Pick<ProjectService, "get" | "mutate">;
  storage: LocalProjectStorage;
  tasks: QueueTask[];
  list: () => Promise<QueueTask[]>;
  signal: AbortSignal;
}): (sceneId?: string) => Promise<void> {
  const ids = new Set(input.tasks.map(task => task.id));
  const measured = new Map<string, Promise<void>>();
  return async sceneId => {
    while (true) {
      input.signal.throwIfAborted();
      const tasks = (await input.list()).filter(task => ids.has(task.id));
      if (tasks.length !== ids.size) throw new Error("Очередь озвучки изменилась; готовые файлы и заказы сохранены");
      if (tasks.some(task => task.status === "cancelled")) throw new DOMException("Производство остановлено", "AbortError");
      if (tasks.some(task => ["failed", "blocked"].includes(task.status))) throw new Error("Подготовка озвучки требует внимания. Готовые файлы и оплаченные заказы сохранены.");
      const required = sceneId ? tasks.filter(task => task.sceneId === sceneId || task.narrationSceneIds?.includes(sceneId)) : tasks;
      if (required.every(task => task.status === "done")) break;
      await delay(300, undefined, { signal: input.signal });
    }
    if (sceneId && measured.has(sceneId)) return measured.get(sceneId)!;
    const project = await input.projects.get(input.projectId, { omitCandidates: true });
    if (!project) throw new Error("Проект не найден");
    const scenes = project.scenes.filter(scene => scene.includeInAssembly !== false && (!sceneId || scene.id === sceneId));
    for (const scene of scenes) {
      input.signal.throwIfAborted();
      let pending = measured.get(scene.id);
      if (!pending) {
        pending = (async () => {
          const [timed] = await prepareDocumentaryTiming({ ...project, scenes: [scene] }, input.storage, { prepareAudio: false });
          // A resumed production usually already has measured, unchanged audio.
          // Do not clone/write the entire candidate history for every such scene.
          if (timed === scene) return;
          await input.projects.mutate(project.id, current => ({ scenes: current.scenes.map(latest => {
            if (latest.id !== scene.id) return latest;
            if (latest.narration !== scene.narration || latest.audioPath !== scene.audioPath || JSON.stringify(latest.narrationSlice) !== JSON.stringify(scene.narrationSlice)) throw new Error("Озвучка изменилась во время измерения; диапазон не выбран");
            return { ...latest, documentary: { ...latest.documentary!, timing: timed!.documentary!.timing } };
          }) }));
        })();
        measured.set(scene.id, pending);
      }
      await pending;
    }
  };
}
