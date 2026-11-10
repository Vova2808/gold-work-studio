import { setTimeout as delay } from "node:timers/promises";
import type { ProjectService } from "@gold-work/core";
import type { Project, QueueTask, Scene } from "@gold-work/shared";
import {documentaryAutomaticMaterialReady, documentaryMissingSelectedMaterialMessage} from './documentary-auto-readiness.js';
import {documentaryCheckedVideoCoverage} from './documentary-automatic-native-recovery.js';
import type { LocalProjectStorage } from "./local-project-storage.js";
import { prepareDocumentaryTiming } from "./documentary-timing.js";
import type {DocumentaryProjectService} from './documentary-project-service.js';
import {AnyModelModelUnavailableError} from './anymodel-text-fallback.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {measureDocumentaryStage} from './documentary-metrics.js';
import {documentarySelectionFailureSummary} from './documentary-selection-failure.js';

/** A bounded selection needs user attention, not cancellation of saved jobs. */
export class DocumentarySelectionIncompleteError extends Error {
  readonly recoverable = true;
  constructor(message:string) { super(message); this.name='DocumentarySelectionIncompleteError'; }
}

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
  const measured = new Map<string, { key: string; pending: Promise<void> }>();
  const timingInput = (project: Project, scene: Scene) => JSON.stringify([scene.narration, scene.audioPath, scene.narrationSlice,
    scene.durationSeconds, scene.durationOverrideSeconds, scene.includeInAssembly, project.settings.voice.enabled, project.settings.assembly.audioNormalize]);
  return async sceneId => {
    const requiredIds = sceneId ? new Set(input.tasks.filter(task => task.sceneId === sceneId || task.narrationSceneIds?.includes(sceneId)).map(task => task.id)) : ids;
    while (true) {
      input.signal.throwIfAborted();
      const required = (await input.list()).filter(task => requiredIds.has(task.id));
      if (required.length !== requiredIds.size) throw new Error("Очередь озвучки изменилась; готовые файлы и заказы сохранены");
      if (required.some(task => task.status === "cancelled")) throw new DOMException("Производство остановлено", "AbortError");
      if (required.some(task => ["failed", "blocked"].includes(task.status))) throw new Error("Подготовка озвучки требует внимания. Готовые файлы и оплаченные заказы сохранены.");
      if (required.every(task => task.status === "done")) break;
      await delay(300, undefined, { signal: input.signal });
    }
    const project = await input.projects.get(input.projectId, { omitCandidates: true });
    if (!project) throw new Error("Проект не найден");
    const scenes = project.scenes.filter(scene => scene.includeInAssembly !== false && (!sceneId || scene.id === sceneId));
    for (const scene of scenes) {
      input.signal.throwIfAborted();
      const key = timingInput(project, scene);
      let saved = measured.get(scene.id);
      if (saved?.key !== key) {
        const pending = (async () => {
          const [timed] = await prepareDocumentaryTiming({ ...project, scenes: [scene] }, input.storage, { prepareAudio: false });
          // A resumed production usually already has measured, unchanged audio.
          // Do not clone/write the entire candidate history for every such scene.
          if (timed === scene) return;
          await input.projects.mutate(project.id, current => ({ scenes: current.scenes.map(latest => {
            if (latest.id !== scene.id) return latest;
            if (!latest.documentary || timingInput(current, latest) !== key) throw new Error("Озвучка или длительность изменились во время измерения; диапазон не выбран");
            return { ...latest, documentary: { ...latest.documentary!, timing: timed!.documentary!.timing } };
          }) }));
        })();
        saved = { key, pending };
        measured.set(scene.id, saved);
      }
      await saved.pending;
    }
  };
}

/** Shared by queue:start and the bounded native production check. */
export async function prepareDocumentaryProduction(projectId:string,options:{
  projects:Pick<ProjectService,'get'|'update'>;
  documentary:Pick<DocumentaryProjectService,'planSearch'|'autoSelect'> & Partial<Pick<DocumentaryProjectService,'prepareMontage'|'automaticVideoQuotaRequired'|'completeWithVideoQuota'|'prepareRouteComparisons'>>;
  signal:AbortSignal;
  allowActiveNarration?:boolean;
  startNarration:()=>Promise<(sceneId?:string)=>Promise<void>>;
}) {
  const {projects,documentary,signal}=options;
  signal.throwIfAborted();
  await projects.update(projectId,{outputPath:undefined,lastRender:undefined});
  await measureDocumentaryStage('planning',{projectId},()=>documentary.planSearch(projectId,undefined,signal,{allowActiveNarration:options.allowActiveNarration}));
  signal.throwIfAborted();
  await projects.update(projectId,{status:'generating'});
  const waitForNarration=await options.startNarration();
  signal.throwIfAborted();
  let result:Awaited<ReturnType<DocumentaryProjectService['autoSelect']>>|undefined,sourceOutage:string|undefined;
  try{result=await documentary.autoSelect(projectId,{},waitForNarration);}
  catch(error){
    signal.throwIfAborted();
    if(error instanceof AnyModelModelUnavailableError||error instanceof DocumentaryAnalysisError&&error.kind==='unavailable')sourceOutage=error.message;
    else throw error;
  }
  signal.throwIfAborted();
  await waitForNarration();
  signal.throwIfAborted();
  if(documentary.prepareRouteComparisons)await documentary.prepareRouteComparisons(projectId,result?.failures??[],signal);
  const selectedProject=await projects.get(projectId,{omitCandidates:true});
  if(!selectedProject)throw new Error('Проект не найден');
  let project=selectedProject;
  const missingFiles=new Set(result?.failures.filter(failure=>failure.message===documentaryMissingSelectedMaterialMessage).map(failure=>failure.sceneId));
  const unfinished=project.scenes.filter(scene=>scene.includeInAssembly!==false&&(!documentaryAutomaticMaterialReady(scene)||missingFiles.has(scene.id)));
  const numbers=unfinished.map(s=>s.order+1);
  if(numbers.length){
    const manual=unfinished.filter(s=>s.documentary?.manualReview),pending=manual.filter(s=>['pending','unknown','error'].includes(s.documentary!.manualReview!.analysis?.status??'pending')).length;
    throw new DocumentarySelectionIncompleteError((sourceOutage
      ?`Подбор приостановлен: сервис проверки материалов недоступен. ${sourceOutage} Ожидают завершения ${numbers.length} сцен: `
      :`Не найдены подходящие материалы для ${numbers.length} сцен: `)
      +`${numbers.slice(0,12).map(n=>`№${n}`).join(', ')}${numbers.length>12?'…':''}.`
      +(missingFiles.size?` Недоступны сохранённые файлы материалов: ${missingFiles.size}.`:'')
      +(manual.length?` Сохранены для ручной проверки: ${manual.length}; из них ${pending} без завершённого результата. Это не готовые сцены автоматического ролика.`:'')
      +documentarySelectionFailureSummary(unfinished,result?.failures)
      +' Ограниченный поиск завершён. Выберите материал вручную или продолжите подбор; готовые кадры, озвучка и ответы сервисов сохранены.');
  }
  signal.throwIfAborted();
  // Only an otherwise complete timeline can benefit from replacing stills.
  // The quota selector checks feasibility before any network request.
  if(documentary.automaticVideoQuotaRequired&&documentary.completeWithVideoQuota)
    project=await documentary.completeWithVideoQuota(project,signal);
  const requireVideoQuota=()=>{
    // Mixed percentages guide selection; only explicit video-only mode is a hard gate.
    if(project.settings.stockVideoPercent<100)return;
    const coverage=documentaryCheckedVideoCoverage(project),target=project.settings.stockVideoPercent;
    if(coverage.videoSeconds+1e-6<coverage.totalSeconds*target/100){
      const actual=coverage.totalSeconds?100*coverage.videoSeconds/coverage.totalSeconds:0;
      throw new DocumentarySelectionIncompleteError(`Недостаточно проверенного видео: ${actual.toFixed(1)}% длительности при цели ${target}%. Ограниченный добор завершён; фотографии, озвучка и ответы сервисов сохранены. Продолжите подбор подходящих видеоматериалов.`);
    }
  };
  requireVideoQuota();
  if(documentary.prepareMontage)project=await measureDocumentaryStage('montage',{projectId},()=>documentary.prepareMontage!(projectId,signal));
  // Montage can change cuts and the amount of visible moving footage.
  requireVideoQuota();
  return {project,result,sourceOutage};
}
