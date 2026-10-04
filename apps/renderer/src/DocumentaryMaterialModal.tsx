import { useEffect, useRef, useState } from "react";
import type { DesktopApi, DocumentaryCandidate, Project, Scene } from "@gold-work/shared";
import "./documentary.css";

export const documentaryProviderLabels: Record<DocumentaryCandidate["provider"], string> = {
  commons: "Wikimedia Commons", "internet-archive": "Internet Archive", loc: "Library of Congress", youtube: "YouTube · Creative Commons", pexels: "Pexels", pixabay: "Pixabay", local: "Мои материалы", web: "Веб-источник"
};
function candidateStream(candidate:DocumentaryCandidate,api:DesktopApi):{type:"video"|"youtube";url:string}|undefined {
  if(candidate.kind!=="video")return;
  if(candidate.localPath)return {type:"video",url:api.mediaUrl(candidate.localPath)};
  if(candidate.provider==="youtube"){
    const id=candidate.id.replace(/^youtube:/,"");
    return /^[\w-]{11}$/.test(id)?{type:"youtube",url:`https://www.youtube-nocookie.com/embed/${id}`} : undefined;
  }
  try{
    const url=new URL(candidate.downloadUrl);
    if(url.protocol!=="https:")return;
    if(candidate.provider==="pexels"||candidate.provider==="pixabay"||/\.(?:mp4|webm|mov)$/i.test(url.pathname))
      return {type:"video",url:url.toString()};
  }catch{/* A source page is still available when no direct stream exists. */}
}
export function DocumentaryMaterialModal({ api, project, scene, onClose, onApplied }: { api: DesktopApi; project: Project; scene: Scene; onClose: () => void; onApplied: (project: Project) => Promise<void> }) {
  const [current, setCurrent] = useState(scene);
  const [query, setQuery] = useState(scene.stockQuery || scene.documentary!.requirement.queries[0] || scene.title);
  const [provider, setProvider] = useState("commons");
  const [kind, setKind] = useState<"image" | "video">(scene.documentary?.requirement.preferredKind ?? "video");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [matched, setMatched] = useState(Boolean(scene.documentary?.verified));
  const [rights, setRights] = useState(scene.documentary?.selected?.rights === "user-confirmed");
  const [illustrative, setIllustrative] = useState(Boolean(scene.documentary?.illustrative));
  const [note, setNote] = useState(scene.documentary?.reviewNote || "");
  const [manual, setManual] = useState({ title: "", pageUrl: "", downloadUrl: "", author: "", license: "", licenseUrl: "" });
  const [trimStart, setTrimStart] = useState(scene.trimStartSeconds || 0);
  const [trimEnd, setTrimEnd] = useState<number | undefined>(scene.trimEndSeconds);
  const [sourceDuration,setSourceDuration]=useState(0);
  const [playbackSeconds,setPlaybackSeconds]=useState(0);
  const [previewSegment,setPreviewSegment]=useState(false);
  const [previewCandidate,setPreviewCandidate]=useState<DocumentaryCandidate>();
  const sourcePlayer=useRef<HTMLVideoElement>(null);
  const [candidates, setCandidates] = useState(scene.documentary!.candidates);
  useEffect(() => {
    if (!current.documentary?.candidatesDeferred) {setCandidates(current.documentary?.candidates ?? []);return;}
    let active=true;
    void api.getDocumentaryCandidates(project.id,scene.id).then(items=>{if(active)setCandidates(items);})
      .catch(error=>{if(active)setError(error instanceof Error?error.message:String(error));});
    return ()=>{active=false;};
  },[current,api,project.id,scene.id]);
  const update = async (updated: Project) => { setCurrent(updated.scenes.find(item => item.id === scene.id)!); await onApplied(updated); };
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(""); try { await work(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  const applied = async (updated: Project) => { setMatched(false); setRights(false); setIllustrative(false); setNote(""); setTrimStart(0); setTrimEnd(undefined); setSourceDuration(0); setPlaybackSeconds(0); setPreviewSegment(false); setPreviewCandidate(undefined); await update(updated); };
  const doc = current.documentary!;
  const stream=previewCandidate?candidateStream(previewCandidate,api):undefined;
  const clipSeconds=Math.max(.5,(doc.timing?.durationInFrames??scene.durationSeconds*30)/30);
  const segmentLength=sourceDuration>0?Math.min(sourceDuration,clipSeconds):clipSeconds;
  const maxStart=Math.max(0,sourceDuration-segmentLength);
  const moveSegment=(start:number)=>{
    const safe=Math.max(0,Math.min(maxStart,start));
    setTrimStart(safe);setTrimEnd(safe+segmentLength);setMatched(false);setPreviewSegment(false);
    if(sourcePlayer.current)sourcePlayer.current.currentTime=safe;
  };
  return <div className="modal-backdrop"><section className="documentary-material-modal" role="dialog" aria-modal="true" aria-label="Материалы Stock Documentary">
    <header><div><h2>Кадр {scene.order + 1} · реальные материалы</h2><p>{doc.requirement.text}</p></div><button aria-label="Закрыть подбор материалов" onClick={onClose}>×</button></header>
    <p className="documentary-requirement">Объект: {doc.requirement.entities.join(" / ") || "уточните в запросе"}{doc.requirement.years.length > 0 ? ` · Эпоха: ${doc.requirement.years.join(", ")}` : ""}. Совпадение названия требует визуальной проверки.</p>
    {error && <p role="alert" className="documentary-error">{error}</p>}
    <div className="documentary-search-controls">
      <input aria-label="Предметный запрос" value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label="Источник материалов" value={provider} onChange={event => setProvider(event.target.value)}>{Object.entries(documentaryProviderLabels).filter(([key]) => key !== "web").map(([key, label]) => <option key={key} value={key}>{label}</option>)}<option value="all">Все источники</option></select>
      <select aria-label="Вид материала" value={kind} onChange={event => setKind(event.target.value as "image" | "video")}><option value="image">Фото / документы</option><option value="video">Видео</option></select>
      <button disabled={busy} onClick={() => void run(async () => { const result = await api.searchDocumentary(project.id, scene.id, { query, kind, providers: provider === "all" ? ["commons", "internet-archive", "loc", "youtube", "local", "pexels", "pixabay"] : [provider as DocumentaryCandidate["provider"]] }); setPreviewCandidate(undefined); await update(result.project); })}>{busy ? "Подготовка…" : "Найти"}</button>
      <button disabled={busy} onClick={() => void run(async () => {
        const result = await api.autoSelectStock(project.id, { force: true, sceneIds: [scene.id] });
        const selected = result.project.scenes.find(item => item.id === scene.id)!;
        setMatched(Boolean(selected.documentary?.verified)); setRights(selected.documentary?.selected?.rights === "user-confirmed");
        setIllustrative(Boolean(selected.documentary?.illustrative)); setNote(selected.documentary?.reviewNote ?? "");
        setTrimStart(selected.trimStartSeconds ?? 0); setTrimEnd(selected.trimEndSeconds);
        setSourceDuration(0);setPlaybackSeconds(0);
        await update(result.project);
        if (result.failed) setError(result.failures[0]?.message ?? "Подходящая замена не найдена");
      })}>Автоподбор по сценарию</button>
      <button onClick={() => void api.openExternal(`https://www.bing.com/${kind === "video" ? "videos" : "images"}/search?q=${encodeURIComponent(query)}`)}>Поиск в вебе</button>
    </div>
    {doc.searchError && <details open className="documentary-error"><summary>Доступность источников</summary><p>{doc.searchError}</p></details>}
    {previewCandidate&&<section className="documentary-candidate-preview" aria-label="Просмотр найденного видео">
      <div><strong>{previewCandidate.title}</strong><button onClick={()=>setPreviewCandidate(undefined)} aria-label="Закрыть просмотр">×</button></div>
      {stream?.type==="video"?<video key={stream.url} controls playsInline preload="metadata" src={stream.url} onError={()=>setError("Источник не разрешил встроенное воспроизведение. Откройте его страницу ниже.")}/>
        :stream?.type==="youtube"?<iframe key={stream.url} title="Просмотр YouTube" src={stream.url} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>
        :<p>У источника нет прямого потока для встроенного просмотра. Откройте страницу материала.</p>}
      <div><small>Просмотр без сохранения файла в проект. Проверьте права на странице источника.</small>
        {previewCandidate.pageUrl&&<button onClick={()=>void api.openExternal(previewCandidate.pageUrl)}>Открыть источник</button>}
        <button disabled={busy} onClick={()=>void run(async()=>applied(await api.applyDocumentaryCandidate(project.id,scene.id,previewCandidate.id)))}>Скачать с источника</button></div>
    </section>}
    <div className="documentary-material-content"><div>
      <div className="documentary-candidates">
        {candidates.map(candidate => <article key={candidate.id} className={doc.selected?.id === candidate.id ? "selected" : ""}>
          {candidate.previewUrl && <img loading="lazy" src={candidate.previewUrl} alt={candidate.title} />}
          <strong>{candidate.title}</strong><small>{documentaryProviderLabels[candidate.provider]} · {candidate.license || "Условия неизвестны"}</small>
          {candidate.capturedAt && <small>Дата оригинала: {candidate.capturedAt}</small>}
          <small>{candidate.match === "exact-metadata" ? "Название объекта совпадает" : "Объект не подтверждён"}{candidate.width ? ` · ${candidate.width} × ${candidate.height}` : ""}</small>
          <details><summary>Проверка и происхождение</summary><p>{candidate.description}</p>{candidate.concerns.map((concern, index) => <p key={index}>{concern}</p>)}<p>{candidate.attribution}</p></details>
          <div>{candidate.kind==="video"&&<button onClick={()=>{setError("");setPreviewCandidate(candidate);}}>Посмотреть</button>}
            <button disabled={busy} onClick={() => void run(async () => applied(await api.applyDocumentaryCandidate(project.id, scene.id, candidate.id)))}>Скачать с источника</button>
            {candidate.pageUrl && <button onClick={() => void api.openExternal(candidate.pageUrl)}>Источник</button>}</div>
        </article>)}
        {!candidates.length && <p>Найдите кандидатов или добавьте разрешённый оригинал. Если нужного объекта нет, уточните запрос; случайная замена не добавляется.</p>}
      </div>
      <details className="documentary-manual"><summary>Добавить свой файл или оригинал из веба</summary>
        <p>Для YouTube используйте поиск/просмотр и разрешённый оригинал от автора. Ссылка на страницу просмотра не является медиафайлом.</p>
        {([['title', 'Название материала'], ['pageUrl', 'Страница источника'], ['downloadUrl', 'Прямая HTTPS-ссылка на файл (для веба)'], ['author', 'Автор'], ['license', 'Лицензия / основание использования'], ['licenseUrl', 'Ссылка на условия']] as const).map(([key, label]) => <label key={key}>{label}<input value={manual[key]} onChange={event => setManual({ ...manual, [key]: event.target.value })} /></label>)}
        <button disabled={busy} onClick={() => void run(async () => { const files = await api.pickFiles(kind); if (files[0]) await applied(await api.importDocumentaryMaterial(project.id, scene.id, { ...manual, title: manual.title || files[0].split(/[\\/]/).at(-1)!, path: files[0] })); })}>Выбрать локальный файл</button>
        <button disabled={busy || !manual.downloadUrl || !manual.title} onClick={() => void run(async () => applied(await api.importDocumentaryMaterial(project.id, scene.id, manual)))}>Скачать оригинал</button>
      </details>
    </div>
    <aside className="documentary-review"><h3>Выбранный материал</h3>
      {doc.selected?.kind === "image" && doc.requirement.preferredKind === "video" && <p className="documentary-photo-fallback">Фото вместо видео. Для этой сцены запрошено видео; сейчас выбрана фотография.</p>}
      {doc.visualReview && <details open className="documentary-requirement"><summary>Автопроверка: {doc.visualReview.status === "accepted" ? "соответствует" : doc.visualReview.status === "rejected" ? "отклонён" : "нужна проверка"} · {Math.round(doc.visualReview.confidence * 100)}%</summary><p>{doc.visualReview.reason}</p><p>{doc.visualReview.quality}</p><small>Просмотренные точки, с: {doc.visualReview.sampleSeconds.map(time => time.toFixed(1)).join(", ")}. Проверка выборочная; спорный материал можно заменить.</small></details>}
      {doc.autoError && <p className="documentary-error">{doc.autoError}</p>}
      {doc.selected ? <>
        {current.videoPath ? <video ref={sourcePlayer} key={current.videoPath} controls muted playsInline preload="metadata" src={api.mediaUrl(current.videoPath)} onLoadedMetadata={event => { const duration=event.currentTarget.duration;setSourceDuration(Number.isFinite(duration)?duration:0);event.currentTarget.currentTime=Math.min(trimStart,Number.isFinite(duration)?duration:trimStart); }} onTimeUpdate={event => {setPlaybackSeconds(event.currentTarget.currentTime);if (previewSegment&&trimEnd!==undefined&&event.currentTarget.currentTime >= trimEnd) {event.currentTarget.pause();setPreviewSegment(false);} }} onSeeked={event=>setPlaybackSeconds(event.currentTarget.currentTime)} />
          : current.imagePath && <img src={api.mediaUrl(current.imagePath)} alt={doc.selected.title} />}
        <strong>{doc.selected.title}</strong><p>{doc.selected.attribution}</p>
        {doc.selected.excerpt && <p className="documentary-requirement">Сохранён отдельный фрагмент {doc.selected.excerpt.startSeconds.toFixed(1)}–{doc.selected.excerpt.endSeconds.toFixed(1)} с исходного видео. Монтаж использует этот короткий файл; его начало — 0 с. Для другого участка откройте источник. Журнал фрагментов: Documentary/Excerpts/fragments.json.</p>}
        {doc.selected.concerns.map((concern, index) => <p key={index} className="documentary-requirement">{concern}</p>)}
        {doc.selected.pageUrl && <button onClick={() => void api.openExternal(doc.selected!.pageUrl)}>Открыть источник и права</button>}
        {current.videoPath && <div className="documentary-trim">
          {sourceDuration>0&&<div className="documentary-source-range"><label>Выберите {segmentLength.toFixed(1)} с из исходника длительностью {sourceDuration.toFixed(1)} с
            <input aria-label="Положение фрагмента в исходнике" type="range" min="0" max={maxStart} step="0.1" value={Math.min(trimStart,maxStart)} onChange={event=>moveSegment(Number(event.target.value))}/></label>
            <span>{trimStart.toFixed(1)}–{(trimEnd??trimStart+segmentLength).toFixed(1)} с</span>
            <button onClick={()=>moveSegment(playbackSeconds)}>Начать с текущего момента ({playbackSeconds.toFixed(1)} с)</button>
            <div className="documentary-trim-nudge"><button onClick={()=>moveSegment(trimStart-1)}>−1 с</button><button onClick={()=>moveSegment(trimStart+1)}>+1 с</button></div>
            <button onClick={()=>{const player=sourcePlayer.current;if(!player)return;player.currentTime=trimStart;setPreviewSegment(true);void player.play().catch(()=>setPreviewSegment(false));}}>Просмотреть отрезок</button>
          </div>}
          <label>Начало, с<input type="number" step="0.1" min="0" value={trimStart} onChange={event => { setTrimStart(Number(event.target.value)); setMatched(false); setPreviewSegment(false); }} /></label>
          <label>Конец, с<input type="number" step="0.1" min="0" value={trimEnd ?? ""} placeholder={String(doc.selected.durationSeconds ?? "")} onChange={event => { setTrimEnd(event.target.value ? Number(event.target.value) : undefined); setMatched(false); }} /></label>
          <button disabled={busy} onClick={() => void run(async () => {
            const availableSeconds=sourceDuration>0?sourceDuration:doc.selected?.durationSeconds;
            if (!Number.isFinite(trimStart) || trimStart < 0 || (trimEnd !== undefined && (!Number.isFinite(trimEnd) || trimEnd <= trimStart))
              || (availableSeconds && (trimEnd ?? trimStart) > availableSeconds)) throw new Error("Укажите диапазон внутри исходного видео");
            const latest = await api.getProject(project.id); if (!latest) throw new Error("Проект не найден");
            await update(await api.updateProject(project.id, { scenes: latest.scenes.map(item => item.id === scene.id ? { ...item, trimStartSeconds: trimStart, trimEndSeconds: trimEnd, documentary: { ...item.documentary!, verified: false } } : item) }));
          })}>Сохранить диапазон</button></div>}
        <label><input type="checkbox" checked={matched} onChange={event => setMatched(event.target.checked)} /> Объект, эпоха и выбранный фрагмент проверены</label>
        <label><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} /> Условия использования проверены</label>
        <label><input type="checkbox" checked={illustrative} onChange={event => setIllustrative(event.target.checked)} /> Иллюстративный кадр — есть отличие от текста</label>
        <label>Примечание<textarea value={note} onChange={event => setNote(event.target.value)} /></label>
        <button className="documentary-confirm" disabled={busy || !matched || !rights} onClick={() => void run(async () => update(await api.reviewDocumentaryMaterial(project.id, scene.id, { verified: true, illustrative, note, rightsConfirmed: rights })))}>Подтвердить материал</button>
        <p>{doc.verified ? doc.pinned ? "✓ Подтверждён и закреплён" : "✓ Прошёл автоматическую проверку" : "Нужна проверка перед сборкой"}</p>
      </> : <p>Выберите кандидата слева. После скачивания здесь появится локальное превью.</p>}
    </aside></div>
  </section></div>;
}
