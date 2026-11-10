import { Check, Clapperboard, Download, Film, ListChecks, Volume2 } from "lucide-react";
import {useEffect,useRef,useState} from 'react';
import { projectEditorReady } from '@gold-work/shared';
import { documentaryVideoCoverage, documentaryManualReviewReady, type AutoStockProgress, type Project, type QueueTask, type Scene } from "@gold-work/shared";
import { stockVideoTarget } from "./stock-workflow-settings";
import {documentaryMaterialReviewNote,documentaryProviderLabels} from './documentary-material-review';

export function materialReady(scene: Scene): boolean {
  const doc=scene.documentary,g=doc?.motionGraphic;
  const native=doc?.verified&&!doc.selected&&!scene.imagePath&&!scene.videoPath&&g?.enabled&&g.origin==='automatic'&&g.title.trim()&&g.durationSeconds>0;
  return Boolean(documentaryManualReviewReady(scene)||native||doc?.verified&&doc.selected&&(doc.selected.kind==='video'?scene.videoPath:scene.imagePath));
}

export function stockMaterialApplied(scene: Scene): boolean {
  return Boolean(scene.stockSource
    && (!scene.documentary || materialReady(scene))
    && (scene.stockSource.mediaType === "video" ? scene.videoPath : scene.imagePath));
}

export function stockProductionState(project: Project, tasks: QueueTask[], incoming: AutoStockProgress | null) {
  const progress = incoming?.projectId === project.id ? incoming : null;
  const workflow = project.stockProduction;
  const automatic = Boolean(workflow);
  const scenes = project.scenes.filter(scene => scene.includeInAssembly !== false);
  const total = scenes.length;
  const speechDone = scenes.filter(scene => scene.audioPath).length;
  const ready = scenes.filter(materialReady);
  const planned = scenes.filter(scene => {const req=scene.documentary?.requirement;return req?.plannedBy==='semantic'
    ||req?.fastPlanVersion===1&&req.text===scene.narration&&req.queries.some(query=>query.trim());}).length;
  const materialsActive = Boolean(progress && !["complete", "failed", "stopped"].includes(progress.phase));
  const projectTasks = tasks.filter(task => task.projectId === project.id);
  const latest = [...projectTasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.runId;
  const currentTasks = projectTasks.filter(task => task.runId === latest);
  const queueActive = currentTasks.some(task => ["running", "pending", "retry_wait"].includes(task.status));
  const paused = project.status === "paused" || currentTasks.some(task => task.status === "paused") && !queueActive;
  const interrupted = workflow?.status === 'interrupted';
  const working = !paused && !interrupted && (queueActive || materialsActive || project.status === "generating" || workflow?.status === 'running');
  const stopped = !working && project.status !== "failed" && progress?.phase !== "failed"
    && (workflow?.status === 'stopped' || progress?.phase === "stopped" || currentTasks.some(task => task.status === "cancelled"));
  const failedTask = currentTasks.find(task => ["failed", "blocked"].includes(task.status));
  const failed = !working && !stopped && (Boolean(failedTask) || ready.length<total&&(progress?.phase === "failed"
    || progress?.phase === "complete" && progress.failed > 0) || project.status === "failed" || workflow?.status === 'failed');
  const speechActive = currentTasks.some(task => task.kind === "speech" && ["pending", "running", "retry_wait"].includes(task.status));
  const assembly = currentTasks.find(task => task.kind === "assemble");
  const videoCoverage=documentaryVideoCoverage(scenes);
  const videoTarget=stockVideoTarget(project.settings.stockVideoPercent);
  // A previous Final must not mark a newly started export as complete.
  const finalReady = Boolean(project.outputPath && project.status === "complete" && !working && !failed && !interrupted && total > 0 && ready.length===total);
  const editorReady = !working && !paused && !failed && !stopped && !interrupted && projectEditorReady(project);
  const percent = (done: number) => total ? Math.floor(done / total * 100) : 0;
  const voicePercent = project.settings.voice.enabled ? percent(speechDone) : 100;
  const materialPercent = percent(ready.length);
  const assemblyPercent = Math.max(0, Math.min(100, assembly?.progress ?? 0));
  // Stock's renderer enters the explicit export phase at 95, after the picture
  // and audio mix are ready. These are reported work milestones, not a timer.
  const exporting = Boolean(assembly && !assembly.prepareOnly && (/^Экспорт:/.test(assembly.stage ?? "") || assemblyPercent >= 95));
  const montagePercent = finalReady || exporting || assembly?.status === "done" ? 100 : Math.min(99, Math.floor(assemblyPercent / 95 * 100));
  const exportPercent = finalReady ? 100 : exporting ? Math.min(99, Math.max(0, Math.round((assemblyPercent - 95) * 20))) : 0;
  const planPercent = finalReady ? 100 : percent(planned);
  const overall = finalReady || editorReady ? 100 : Math.min(99, Math.round((planPercent + voicePercent + materialPercent + montagePercent + exportPercent) / 5));
  const status = finalReady ? "Ролик готов"
    : editorReady ? "Монтаж готов к редактированию"
    : failed ? "Производство требует внимания"
    : paused || interrupted ? "Производство на паузе"
    : stopped ? "Производство остановлено — готовое сохранено"
    : assembly?.status === "running" ? exporting ? "Экспортирую готовый монтаж" : "Монтирую ролик"
    : speechActive && materialsActive ? "Готовлю озвучку и материалы параллельно"
    : speechActive ? "Озвучиваю сценарий"
    : materialsActive ? "Подбираю и проверяю кадры"
    : working ? workflow?.phase === 'script' ? "Подготавливаю сценарий" : "Подготавливаю производство"
    : "Производство ещё не запущено";
  const next = finalReady ? "Откройте «Экспорт», чтобы посмотреть готовый ролик."
    : editorReady ? "Проверьте редактор и нажмите «Экспорт», чтобы создать Final.mp4."
    : failed ? failedTask ? "Причина указана ниже и в задаче с ошибкой. После её устранения можно продолжить производство."
      : "Проверьте причину ошибки и продолжите кнопкой «Собрать ролик». Готовые запросы, материалы и озвучка сохранятся."
    : interrupted ? workflow!.message
    : paused ? "Нажмите «Продолжить» в очереди. Готовые файлы будут использованы снова."
    : stopped ? "Для продолжения нажмите «Собрать ролик» в настройках проекта. Готовые голоса и кадры сохранятся."
    : working ? exporting || automatic ? "После автоматического монтажа и экспорта Final.mp4 появится на этапе «Экспорт». Ничего нажимать не нужно."
      : assembly?.status === "running" ? "После подготовки откроется редактор. Экспорт запускается отдельной кнопкой."
      : "Дальше — автоматический монтаж и редактор. Экспорт запускается отдельной кнопкой."
    : "Нажмите «Собрать ролик» в настройках проекта: приложение подготовит материалы, монтаж и Final.mp4.";
  const failureMessage = failedTask?.error
    || (workflow?.status === 'failed' ? workflow.message : undefined)
    || (progress?.phase === "failed" || progress && progress.failed > 0 && !progress.currentSceneId ? progress?.message : undefined)
    || "Подготовка не завершена. Проверьте сообщение об ошибке и продолжите кнопкой «Собрать ролик».";
  const operations = finalReady ? [] : failed ? [failureMessage] : paused || stopped || interrupted ? []
    : assembly?.status === "running" ? [assembly.stage || "Подготавливаю таймлайн"]
    : [speechActive ? `Озвучено ${speechDone} из ${total} сцен` : undefined, materialsActive ? progress!.message : workflow?.status === 'running' ? workflow.message : undefined].filter((value): value is string => Boolean(value));
  const stages = [
    { name: "Подготовка", percent: planPercent, count: planPercent === 100 ? "Готово" : `${planned}/${total}`, note: "Сценарий и план кадров", active: working && planned < total },
    { name: "Озвучка", percent: voicePercent, count: project.settings.voice.enabled ? `${speechDone}/${total}` : "Выключена", note: "Голос и длительность сцен", active: !paused && speechActive },
    { name: "Визуальные сцены", percent: materialPercent, count: `${ready.length}/${total}`, note: `Видео: ${videoCoverage.percent}% · выбрано ${videoTarget}%`, active: !paused && materialsActive },
    { name: "Монтаж", percent: montagePercent, count: assembly ? `${montagePercent}%` : "Ожидает", note: "Кадры, графика, переходы и звук", active: assembly?.status === "running" && !exporting },
    { name: "Экспорт", percent: exportPercent, count: finalReady ? "Готово" : exporting ? `${exportPercent}%` : automatic ? "Ожидает" : "Вручную", note: automatic ? "Автоматическое сохранение Final.mp4" : "Сохранение по кнопке «Экспорт»", active: assembly?.status === "running" && exporting },
  ];
  return { scenes, ready, total, materialPercent, overall, status, next, operations, stages, finalReady, failed, paused, stopped };
}

export function StockProductionOverview({ project, tasks, progress, onReviseArtwork }: { project: Project; tasks: QueueTask[]; progress: AutoStockProgress | null; onReviseArtwork?:(feedback:string)=>Promise<void> }) {
  const { scenes, ready, total, materialPercent, overall, status, next, operations, stages, finalReady, failed } = stockProductionState(project, tasks, progress);
  const videos = ready.filter(scene => scene.documentary?.selected?.kind === "video").length;
  const photos=ready.filter(scene=>scene.documentary?.selected?.kind==='image').length;
  const graphics=ready.length-videos-photos;
  const coverage = documentaryVideoCoverage(scenes);
  const target = stockVideoTarget(project.settings.stockVideoPercent);
  const icons = [ListChecks, Volume2, Film, Clapperboard, Download];
  return <section className="production-overview stock-production-overview" aria-label="Производство Stock">
    <header><div><span className="production-overview-icon"><Clapperboard size={20} /></span><div><small>АВТОМАТИЧЕСКОЕ ПРОИЗВОДСТВО</small><strong>{status}</strong></div></div><em title="Готовность этапов; не оценка оставшегося времени">{overall}%</em></header>
    <div className="production-main-progress" role="progressbar" aria-label="Готовность этапов" aria-valuenow={overall} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${overall}%` }} /></div>
    <div className="production-stage-grid">
      {stages.map((stage, i) => { const Icon = stage.percent === 100 ? Check : icons[i]!; return <article key={stage.name} className={stage.active ? "running" : stage.percent === 100 ? "complete" : "waiting"} aria-current={stage.active ? "step" : undefined}>
        <span><Icon size={18} /></span><div><strong>{i + 1}. {stage.name}</strong><small>{stage.note}</small><div className="production-stage-progress" role="progressbar" aria-label={stage.name} aria-valuenow={stage.percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${stage.percent}%` }} /></div></div><em>{stage.count}</em>
      </article>; })}
    </div>
    <div className={`stock-production-operation${failed ? " failed" : ""}`} aria-live="polite">
      {operations.map((operation, i) => <p key={i}>{operation}</p>)}
      {project.settings.assembly.documentary?.semanticMontageStatus?.status==='local'&&<p>{project.settings.assembly.documentary.semanticMontageStatus.message}</p>}
      {project.settings.assembly.documentary?.motionArtworkStatus&&project.settings.assembly.documentary.semanticMontageStatus?.status!=='local'&&<p>{project.settings.assembly.documentary.motionArtworkStatus.message}</p>}
      <strong>{next}</strong>
      {failed&&Boolean(project.stockProduction?.failures?.length)&&<details>
        <summary>Причины последней остановки по сценам ({project.stockProduction!.failures!.length})</summary>
        <p>Состояние на момент остановки. После ручного изменения сцены её актуальный материал показан в «Видео и фото».</p>
        <ol>{project.stockProduction!.failures!.map(failure=><li key={failure.sceneId}>
          <strong>Сцена №{failure.sceneNumber}</strong>: {failure.message}
          {failure.nextAction&&<p>{failure.nextAction}</p>}
        </li>)}</ol>
      </details>}
      {!finalReady && <small>Редактор доступен для правок по желанию. Для автоматического монтажа открывать его не требуется.</small>}
    </div>
    <div className="stock-production-coverage">
      <span>Цель: {target}% видео / {100 - target}% фото по длительности</span>
      <strong>Готово: {videos} видео · {photos} фото · {graphics} графических сцен · {materialPercent}% сцен</strong>
      {scenes.some(scene=>documentaryManualReviewReady(scene))&&<strong>Проверить вручную: {scenes.filter(scene=>documentaryManualReviewReady(scene)).length} · откройте «Видео и фото»</strong>}
      <span>{scenes.every(scene => scene.documentary?.timing) ? "Фактическая" : "Предварительная"} доля видео: {coverage.percent}% · осталось {total - ready.length} сцен</span>
    </div>
    {onReviseArtwork&&<ArtworkFeedbackAction key={project.id} project={project} onRevise={onReviseArtwork} disabled={tasks.some(t=>['running','pending','retry_wait'].includes(t.status))}/>}
  </section>;
}

export function ArtworkFeedbackAction({project,onRevise,disabled=false}:{project:Project;onRevise:(feedback:string)=>Promise<void>;disabled?:boolean}){
  const saved=project.settings.assembly.documentary?.artworkFeedback;
  const [feedback,setFeedback]=useState(saved?.feedback??''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const submitting=useRef(false);
  useEffect(()=>{if(saved?.feedback!==undefined)setFeedback(saved.feedback);},[saved?.operationKey,saved?.feedback]);
  const available=project.scenes.some(s=>s.includeInAssembly!==false&&!s.documentary?.pinned&&s.documentary?.motionGraphic?.artwork);
  if(!available&&!saved)return null;
  const submit=async()=>{
    if(submitting.current||disabled||!feedback.trim())return;
    submitting.current=true;setBusy(true);setError('');
    try{await onRevise(feedback);}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{submitting.current=false;setBusy(false);}
  };
  return <div className="stock-artwork-feedback">
    <label>Замечание к AI-графике<textarea aria-label="Замечание к AI-графике" value={feedback} maxLength={12000} disabled={busy||disabled} onChange={e=>setFeedback(e.target.value)} placeholder="Опишите, что нужно улучшить в текущей графике"/></label>
    <button className="outline-button" disabled={busy||disabled||!available||!feedback.trim()} onClick={()=>void submit()}>{busy?'Доработка AI-графики…':'Доработать AI-графику по замечанию'}</button>
    {saved&&<p role="status">{saved.message}</p>}{error&&<p role="alert">{error}</p>}
  </div>;
}

export function StockMaterialQueue({ project, progress, onReview }: { project: Project; progress: AutoStockProgress | null; onReview?: (sceneId:string)=>void }) {
  return <div className="stock-material-queue" aria-label="Подбор материалов по сценам">
    {project.scenes.filter(scene => scene.includeInAssembly !== false).map(scene => {
      const ready = materialReady(scene);
      const pending = documentaryManualReviewReady(scene);
      const active = progress?.currentSceneId === scene.id && !["complete", "failed", "stopped"].includes(progress.phase);
      const kind = ready ? scene.documentary?.selected?.kind : scene.documentary?.requirement.preferredKind;
      const native=ready&&!scene.documentary?.selected;
      const status = pending ? `${documentaryProviderLabels[scene.documentary!.manualReview!.provider]} · проверить вручную` : active ? progress.message : native ? "Графика по реплике" : ready ? "Подтверждено" : scene.documentary?.autoError || "Ожидает подбора";
      return <article key={scene.id} className={active ? "running" : ready ? "complete" : ""}>
        <span>{scene.order + 1}</span><div><strong>{scene.title}</strong><small>{ready ? "Выбрано" : "План"}: {native?'графика':kind === "image" ? "фото" : "видео"} · {status}</small></div><em>{ready ? "100%" : active ? "В работе" : scene.documentary?.autoError ? "Не подтверждено" : "Ожидает"}</em>
        {pending&&onReview&&<button className="outline-button small" title={documentaryMaterialReviewNote(scene)} disabled={project.status==='generating'||project.status==='paused'} onClick={()=>onReview(scene.id)}>Проверить вручную</button>}
      </article>;
    })}
  </div>;
}
