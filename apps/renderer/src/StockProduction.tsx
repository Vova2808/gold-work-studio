import { Check, Clapperboard, Download, Film, ListChecks, Volume2 } from "lucide-react";
import { documentaryVideoCoverage, type AutoStockProgress, type Project, type QueueTask, type Scene } from "@gold-work/shared";

export function materialReady(scene: Scene): boolean {
  return Boolean(scene.documentary?.verified && scene.documentary.selected && (scene.documentary.selected.kind === "video" ? scene.videoPath : scene.imagePath));
}

export function stockMaterialApplied(scene: Scene): boolean {
  return Boolean(scene.stockSource
    && (!scene.documentary || materialReady(scene))
    && (scene.stockSource.mediaType === "video" ? scene.videoPath : scene.imagePath));
}

export function stockProductionState(project: Project, tasks: QueueTask[], incoming: AutoStockProgress | null) {
  const progress = incoming?.projectId === project.id ? incoming : null;
  const scenes = project.scenes.filter(scene => scene.includeInAssembly !== false);
  const total = scenes.length;
  const speechDone = scenes.filter(scene => scene.audioPath).length;
  const ready = scenes.filter(materialReady);
  const planned = scenes.filter(scene => scene.documentary?.requirement.plannedBy === "semantic").length;
  const materialsActive = Boolean(progress && !["complete", "failed", "stopped"].includes(progress.phase));
  const projectTasks = tasks.filter(task => task.projectId === project.id);
  const latest = [...projectTasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.runId;
  const currentTasks = projectTasks.filter(task => task.runId === latest);
  const queueActive = currentTasks.some(task => ["running", "pending", "retry_wait"].includes(task.status));
  const paused = project.status === "paused" || currentTasks.some(task => task.status === "paused") && !queueActive;
  const working = !paused && (queueActive || materialsActive || project.status === "generating");
  const stopped = !working && (progress?.phase === "stopped" || currentTasks.some(task => task.status === "cancelled"));
  const failedTask = currentTasks.find(task => ["failed", "blocked"].includes(task.status));
  const failed = !working && !stopped && (Boolean(failedTask) || progress?.phase === "failed" || project.status === "failed");
  const speechActive = currentTasks.some(task => task.kind === "speech" && ["pending", "running", "retry_wait"].includes(task.status));
  const assembly = currentTasks.find(task => task.kind === "assemble");
  // A previous Final must not mark a newly started export as complete.
  const finalReady = Boolean(project.outputPath && project.status === "complete" && !working);
  const percent = (done: number) => total ? Math.floor(done / total * 100) : 0;
  const voicePercent = project.settings.voice.enabled ? percent(speechDone) : 100;
  const materialPercent = percent(ready.length);
  const assemblyPercent = Math.max(0, Math.min(100, assembly?.progress ?? 0));
  // Stock's renderer enters the explicit export phase at 95, after the picture
  // and audio mix are ready. These are reported work milestones, not a timer.
  const exporting = Boolean(assembly && (/^Экспорт:/.test(assembly.stage ?? "") || assemblyPercent >= 95));
  const montagePercent = finalReady || exporting || assembly?.status === "done" ? 100 : Math.min(99, Math.floor(assemblyPercent / 95 * 100));
  const exportPercent = finalReady ? 100 : exporting ? Math.min(99, Math.max(0, Math.round((assemblyPercent - 95) * 20))) : 0;
  const planPercent = finalReady ? 100 : percent(planned);
  const overall = finalReady ? 100 : Math.min(99, Math.round((planPercent + voicePercent + materialPercent + montagePercent + exportPercent) / 5));
  const status = finalReady ? "Ролик готов"
    : failed ? "Производство требует внимания"
    : paused ? "Производство на паузе"
    : stopped ? "Производство остановлено — готовое сохранено"
    : assembly?.status === "running" ? exporting ? "Экспортирую готовый монтаж" : "Монтирую ролик"
    : speechActive && materialsActive ? "Готовлю озвучку и материалы параллельно"
    : speechActive ? "Озвучиваю сценарий"
    : materialsActive ? "Подбираю и проверяю кадры"
    : working ? "Подготавливаю производство"
    : "Производство ещё не запущено";
  const next = finalReady ? "Откройте «Экспорт», чтобы посмотреть готовый ролик."
    : failed ? "Причина указана ниже и в задаче с ошибкой. После её устранения можно продолжить производство."
    : paused ? "Нажмите «Продолжить» в очереди. Готовые файлы будут использованы снова."
    : stopped ? "Для продолжения нажмите «Собрать ролик» в настройках проекта. Готовые голоса и кадры сохранятся."
    : working ? exporting ? "После сохранения результат будет доступен на этапе «Экспорт». Ничего нажимать не нужно."
      : assembly?.status === "running" ? "Дальше — автоматический экспорт. Отдельно запускать его не нужно."
      : "Дальше — автоматический монтаж и экспорт. Отдельно запускать монтаж не нужно."
    : "Нажмите «Собрать ролик» в настройках проекта один раз: приложение само подготовит материалы, смонтирует и экспортирует видео.";
  const operations = finalReady ? [] : failed ? [failedTask?.error || progress?.message || "Откройте задачу с ошибкой ниже."] : paused || stopped ? []
    : assembly?.status === "running" ? [assembly.stage || "Подготавливаю таймлайн"]
    : [speechActive ? `Озвучено ${speechDone} из ${total} сцен` : undefined, materialsActive ? progress!.message : undefined].filter((value): value is string => Boolean(value));
  const stages = [
    { name: "Подготовка", percent: planPercent, count: planPercent === 100 ? "Готово" : `${planned}/${total}`, note: "Сценарий и план кадров", active: working && planned < total },
    { name: "Озвучка", percent: voicePercent, count: project.settings.voice.enabled ? `${speechDone}/${total}` : "Выключена", note: "Голос и длительность сцен", active: !paused && speechActive },
    { name: "Видео и фото", percent: materialPercent, count: `${ready.length}/${total}`, note: "Поиск, загрузка и проверка", active: !paused && materialsActive },
    { name: "Монтаж", percent: montagePercent, count: assembly ? `${montagePercent}%` : "Ожидает", note: "Кадры, графика, переходы и звук", active: assembly?.status === "running" && !exporting },
    { name: "Экспорт", percent: exportPercent, count: finalReady ? "Готово" : exporting ? `${exportPercent}%` : "Ожидает", note: "Сохранение готового видео", active: assembly?.status === "running" && exporting },
  ];
  return { scenes, ready, total, materialPercent, overall, status, next, operations, stages, finalReady, failed, paused, stopped };
}

export function StockProductionOverview({ project, tasks, progress }: { project: Project; tasks: QueueTask[]; progress: AutoStockProgress | null }) {
  const { scenes, ready, total, materialPercent, overall, status, next, operations, stages, finalReady, failed } = stockProductionState(project, tasks, progress);
  const videos = ready.filter(scene => scene.documentary?.selected?.kind === "video").length;
  const coverage = documentaryVideoCoverage(scenes);
  const target = project.settings.stockVideoPercent;
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
      <strong>{next}</strong>
      {!finalReady && <small>Редактор доступен для правок по желанию. Для автоматического монтажа открывать его не требуется.</small>}
    </div>
    <div className="stock-production-coverage">
      <span>Цель: {target}% видео / {100 - target}% фото по длительности</span>
      <strong>Подтверждено: {videos} видео · {ready.length - videos} фото · {materialPercent}% сцен</strong>
      <span>{scenes.every(scene => scene.documentary?.timing) ? "Фактическая" : "Предварительная"} доля видео: {coverage.percent}% · осталось {total - ready.length} сцен</span>
    </div>
  </section>;
}

export function StockMaterialQueue({ project, progress }: { project: Project; progress: AutoStockProgress | null }) {
  return <div className="stock-material-queue" aria-label="Подбор материалов по сценам">
    {project.scenes.filter(scene => scene.includeInAssembly !== false).map(scene => {
      const ready = materialReady(scene);
      const active = progress?.currentSceneId === scene.id && !["complete", "failed", "stopped"].includes(progress.phase);
      const kind = ready ? scene.documentary?.selected?.kind : scene.documentary?.requirement.preferredKind;
      const status = active ? progress.message : ready ? "Подтверждено" : scene.documentary?.autoError || "Ожидает подбора";
      return <article key={scene.id} className={active ? "running" : ready ? "complete" : ""}>
        <span>{scene.order + 1}</span><div><strong>{scene.title}</strong><small>{ready ? "Выбрано" : "План"}: {kind === "image" ? "фото" : "видео"} · {status}</small></div><em>{ready ? "100%" : active ? "В работе" : scene.documentary?.autoError ? "Не подтверждено" : "Ожидает"}</em>
      </article>;
    })}
  </div>;
}
