import { useEffect, useRef, useState } from "react";
import type { DesktopApi, DocumentaryCandidate, DocumentaryMaterialStage, Project, Scene } from "@gold-work/shared";
import { documentaryFixedRange,documentaryCandidateSelectionKey,documentaryGeminiRetryAllowed,documentaryManualReviewReady } from "@gold-work/shared";
import {documentaryMaterialReviewNote,documentaryProviderLabels} from './documentary-material-review';
import "./documentary.css";

const allProviders: DocumentaryCandidate["provider"][] = ["pexels","pixabay","web"];
function candidateStream(candidate:DocumentaryCandidate,api:DesktopApi):{type:"video"|"youtube";url:string}|undefined {
  if(candidate.kind!=="video")return;
  if(candidate.localPath)return {type:"video",url:api.mediaUrl(candidate.localPath)};
  if(candidate.provider==="youtube"){
    const id=candidate.id.replace(/^youtube:/,"");
    return /^[\w-]{11}$/.test(id)?{type:"youtube",url:`https://www.youtube-nocookie.com/embed/${id}`}:undefined;
  }
  try {
    const url=new URL(candidate.downloadUrl);
    if(url.protocol==="https:"&&(candidate.provider==="pexels"||candidate.provider==="pixabay"||/\.(?:mp4|webm|mov)$/i.test(url.pathname)))return {type:"video",url:url.toString()};
  }catch { /* The source page remains available. */ }
}
export function DocumentaryMaterialModal({api,project,scene,cutId,onClose,onApplied}:{
  api:DesktopApi;project:Project;scene:Scene;cutId?:string;onClose:()=>void;onApplied:(project:Project)=>Promise<void>
}) {
  const [current,setCurrent]=useState(scene);
  const [stage,setStage]=useState<DocumentaryMaterialStage>();
  const [query,setQuery]=useState(scene.documentary?.requirement.queries[0]||scene.stockQuery||scene.title);
  const [provider,setProvider]=useState("all");
  const [kind,setKind]=useState<"image"|"video">(scene.documentary?.requirement.preferredKind??"video");
  const [candidates,setCandidates]=useState(scene.documentary?.candidates??[]);
  const [previewCandidate,setPreviewCandidate]=useState<DocumentaryCandidate>();
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [matched,setMatched]=useState(false);
  const [rights,setRights]=useState(false);
  const [illustrative,setIllustrative]=useState(Boolean(scene.documentary?.illustrative));
  const [note,setNote]=useState(documentaryMaterialReviewNote(scene));
  const [manual,setManual]=useState({title:"",pageUrl:"",downloadUrl:"",author:"",license:"",licenseUrl:""});
  const [trimStart,setTrimStart]=useState(0);
  const [sourceDuration,setSourceDuration]=useState(0);
  const [playbackSeconds,setPlaybackSeconds]=useState(0);
  const [previewSegment,setPreviewSegment]=useState(false);
  const sourcePlayer=useRef<HTMLVideoElement>(null);
  const initialSearch=useRef(false);
  const retryingGemini=useRef(false);
  const cut=cutId?scene.documentary?.cuts?.find(item=>item.id===cutId):undefined;
  const selected=stage?.scene??(cut?.sourceSceneId?project.scenes.find(item=>item.id===cut.sourceSceneId):undefined)??current,doc=selected.documentary!;
  const pending=documentaryManualReviewReady(selected)?doc.manualReview:undefined;
  const clipSeconds=cut?cut.durationInFrames/30:Math.max((scene.documentary?.timing?.durationInFrames??Math.ceil(scene.durationSeconds*30))/30,scene.durationOverrideSeconds??0);
  const rate=cut?.playbackRate??scene.playbackRate??1;
  const segmentLength=clipSeconds*rate;
  const maxStart=Math.max(0,sourceDuration-segmentLength);
  const trimEnd=trimStart+segmentLength;
  const enoughSource=sourceDuration+.05>=segmentLength;
  const stream=previewCandidate?candidateStream(previewCandidate,api):undefined;
  const run=async(work:()=>Promise<void>)=>{setBusy(true);setError("");try{await work();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  const search=async()=>{
    const result=await api.searchDocumentary(project.id,scene.id,{query,kind,providers:provider==="all"?allProviders:[provider as DocumentaryCandidate["provider"]]});
    const next=result.project.scenes.find(item=>item.id===scene.id)!;
    setCurrent(next);setCandidates(result.result.candidates);setPreviewCandidate(undefined);
  };
  useEffect(()=>{
    let active=true;
    void (async()=>{
      const items=scene.documentary?.candidatesDeferred?await api.getDocumentaryCandidates(project.id,scene.id):scene.documentary?.candidates??[];
      if(!active)return;
      setCandidates(items);
      if(!items.length&&!initialSearch.current){initialSearch.current=true;await run(search);}
    })().catch(e=>{if(active)setError(e instanceof Error?e.message:String(e));});
    return ()=>{active=false;};
  },[api,project.id,scene.id]);
  const prepared=(value:DocumentaryMaterialStage)=>{
    setStage(value);setPreviewCandidate(undefined);setMatched(false);
    setRights(value.scene.documentary?.selected?.rights!=="unknown");
    setIllustrative(false);setNote("");setTrimStart(0);setSourceDuration(0);
    setPlaybackSeconds(0);setPreviewSegment(false);
  };
  const moveSegment=(start:number)=>{
    const safe=Math.max(0,Math.min(maxStart,Number.isFinite(start)?start:0));
    setTrimStart(safe);setPreviewSegment(false);setMatched(false);
    if(sourcePlayer.current)sourcePlayer.current.currentTime=safe;
  };
  const download=(candidate:DocumentaryCandidate,fullOriginal=false)=>run(async()=>prepared(await api.stageDocumentaryCandidate(project.id,scene.id,documentaryCandidateSelectionKey(candidate),fullOriginal)));
  const apply=()=>run(async()=>{
    if(!stage||previewCandidate)throw new Error("Для применения вернитесь к подготовленной замене.");
    if(selected.videoPath)documentaryFixedRange(scene,trimStart,sourceDuration,cutId);
    const updated=await api.applyDocumentaryStage(project.id,scene.id,{stageId:stage.id,startSeconds:trimStart,cutId,illustrative,note,rightsConfirmed:rights});
    await onApplied(updated);onClose();
  });
  return <div className="modal-backdrop documentary-material-backdrop"><section className="documentary-material-modal" role="dialog" aria-modal="true" aria-label="Ручная замена футажа">
    <header><div><h2>Кадр {scene.order+1} · заменить вручную</h2><p>{scene.narration}</p>
      <small>{cut?"Выбранный визуальный клип":"Сцена"} · {clipSeconds.toFixed(1)} с{rate!==1?` · скорость ${rate}×`:""}</small></div>
      <button aria-label="Закрыть подбор материалов" onClick={onClose} disabled={busy}>×</button></header>
    {error&&<p role="alert" className="documentary-error">{error}</p>}
    <div className="documentary-search-controls">
      <input aria-label="Предметный запрос" value={query} onChange={e=>setQuery(e.target.value)}/>
      <select aria-label="Источник материалов" value={provider} onChange={e=>setProvider(e.target.value)}>
        <option value="all">Все внешние источники</option>
        <optgroup label="Поиск в интернете">{allProviders.map(key=><option key={key} value={key}>{documentaryProviderLabels[key]}</option>)}</optgroup>
        <optgroup label="Сохранённые материалы"><option value="local">Мои материалы</option></optgroup></select>
      <select aria-label="Вид материала" value={kind} onChange={e=>setKind(e.target.value as "image"|"video")}><option value="video">Видео</option><option value="image">Фото / документы</option></select>
      <button disabled={busy} onClick={()=>void run(search)}>{busy?"Подготовка…":"Найти"}</button>
      {!cutId&&<button disabled={busy||Boolean(stage)} onClick={()=>void run(async()=>{
        const result=await api.autoSelectStock(project.id,{force:true,sceneIds:[scene.id]});
        await onApplied(result.project);
        setCurrent(result.project.scenes.find(item=>item.id===scene.id)!);
        if(result.failed)setError(result.failures[0]?.message??"Подходящая замена не найдена");
      })}>Автоподбор по сценарию</button>}
      <button onClick={()=>void api.openExternal(`https://www.bing.com/${kind==="video"?"videos":"images"}/search?q=${encodeURIComponent(query)}`)}>Открыть поиск в браузере</button>
    </div>
    {current.documentary?.searchError&&<details className="documentary-error"><summary>Доступность источников</summary><p>{current.documentary.searchError}</p></details>}
    <div className="documentary-material-content"><div className="documentary-results" tabIndex={0} aria-label="Результаты подбора">
      <div className="documentary-candidates">{candidates.map(candidate=><article key={`${candidate.id}:${candidate.excerpt?.startSeconds??""}`}>
        {candidate.previewUrl&&<img loading="lazy" src={candidate.previewUrl} alt={candidate.title}/>}
        <strong>{candidate.title}</strong><small>{documentaryProviderLabels[candidate.provider]} · {candidate.license||"Условия неизвестны"}</small>
        <small>{candidate.match==="exact-metadata"?"Название совпадает; содержимое ещё не подтверждено":"Содержимое не подтверждено"}{candidate.width?` · ${candidate.width} × ${candidate.height}`:""}</small>
        <details><summary>Описание и происхождение</summary><p>{candidate.description}</p>{candidate.concerns.map((concern,i)=><p key={i}>{concern}</p>)}<p>{candidate.attribution}</p></details>
        <div>{candidate.kind==="video"&&<button onClick={()=>{setError("");setPreviewCandidate(candidate);}}>Посмотреть</button>}
          <button disabled={busy} onClick={()=>void download(candidate)}>Скачать и выбрать отрезок</button>
          {candidate.pageUrl&&<button onClick={()=>void api.openExternal(candidate.pageUrl)}>Источник</button>}</div>
      </article>)}
      {!candidates.length&&<p>Нет результатов. Измените запрос, источник или добавьте свой файл.</p>}</div>
      <details className="documentary-manual"><summary>Добавить свой файл или оригинал из веба</summary>
        {([["title","Название материала"],["pageUrl","Страница источника"],["downloadUrl","Прямая HTTPS-ссылка на файл"],["author","Автор"],["license","Лицензия / основание использования"],["licenseUrl","Ссылка на условия"]] as const).map(([key,label])=><label key={key}>{label}<input value={manual[key]} onChange={e=>setManual({...manual,[key]:e.target.value})}/></label>)}
        <button disabled={busy} onClick={()=>void run(async()=>{const files=await api.pickFiles(kind);if(files[0])prepared(await api.stageDocumentaryImport(project.id,scene.id,{...manual,title:manual.title||files[0].split(/[\\/]/).at(-1)!,path:files[0]}));})}>Выбрать локальный файл</button>
        <button disabled={busy||!manual.downloadUrl||!manual.title} onClick={()=>void run(async()=>prepared(await api.stageDocumentaryImport(project.id,scene.id,manual)))}>Скачать оригинал</button>
      </details>
    </div><aside className="documentary-review" tabIndex={0} aria-label="Предпросмотр материала">
      {previewCandidate?<section className="documentary-candidate-preview" aria-label="Просмотр найденного видео">
        <div><strong>{previewCandidate.title}</strong><button onClick={()=>setPreviewCandidate(undefined)}>×</button></div>
        {stream?.type==="video"?<video key={stream.url} controls playsInline preload="metadata" src={stream.url} onError={()=>setError("Источник запретил встроенное воспроизведение. Откройте его страницу.")}/>
          :stream?.type==="youtube"?<iframe key={stream.url} title="Просмотр YouTube" src={stream.url} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>
          :<p>Встроенный поток недоступен. Откройте страницу материала.</p>}
        <small>Просмотр до скачивания.</small>
        {previewCandidate.pageUrl&&<button onClick={()=>void api.openExternal(previewCandidate.pageUrl)}>Открыть источник</button>}
        <button disabled={busy} onClick={()=>void download(previewCandidate)}>Скачать и выбрать отрезок</button>
      </section>:<>
        <h3>{stage?"Выберите отрезок замены":"Текущий материал"}</h3>
        {pending&&<p className="documentary-requirement"><strong>Проверить вручную.</strong> Запасной материал ({documentaryProviderLabels[pending.provider]}). {pending.analysis
          ? `Gemini — ${{pending:'проверка не завершена',error:'ошибка проверки',unknown:'результат неизвестен',accepted:'соответствует визуальной цели; нужна ручная проверка',rejected:'материал отклонён',uncertain:'соответствие не установлено'}[pending.analysis.status]}: ${pending.analysis.reason}`
          : 'Проверка Gemini ещё не выполнялась.'} Выберите материал ниже или импортируйте свой файл.</p>}
        {!cutId&&!stage&&documentaryGeminiRetryAllowed(project,current)&&<button disabled={busy||project.status==='generating'||project.status==='paused'} onClick={()=>{
          if(retryingGemini.current)return;retryingGemini.current=true;
          void run(async()=>{const updated=await api.retryDocumentaryGemini(project.id,scene.id);
            setCurrent(updated.scenes.find(item=>item.id===scene.id)!);await onApplied(updated);
          }).finally(()=>{retryingGemini.current=false;});
        }}>Повторить проверку Gemini</button>}
        {stage&&<p>Прежний кадр сохранён до применения замены.</p>}
        {doc.illustrative&&!pending&&<p className="documentary-requirement">Иллюстрация · {documentaryMaterialReviewNote(selected)}</p>}
        {doc.autoError&&<p className="documentary-error">{doc.autoError}</p>}
        {doc.searchRecovery?.reason&&doc.searchRecovery.reason!==doc.autoError&&(doc.manualReview
          ? <details><summary>История подбора · последний отказ</summary><p>{doc.searchRecovery.reason}</p></details>
          : <p className="documentary-requirement">Причина отказа материала: {doc.searchRecovery.reason}</p>)}
        {doc.visualReview&&(!doc.manualReview||pending)&&<details><summary>Сохранённая проверка</summary><p>{doc.visualReview.reason}</p><p>{doc.visualReview.quality}</p></details>}
        {selected.videoPath?<video ref={sourcePlayer} key={selected.videoPath} controls playsInline preload="metadata" src={api.mediaUrl(selected.videoPath)}
          onLoadedMetadata={e=>{const duration=e.currentTarget.duration;setSourceDuration(Number.isFinite(duration)?duration:0);if(stage){try{documentaryFixedRange(scene,0,duration,cutId);}catch(error){setError(error instanceof Error?error.message:String(error));}}}}
          onTimeUpdate={e=>{setPlaybackSeconds(e.currentTarget.currentTime);if(previewSegment&&e.currentTarget.currentTime>=trimEnd){e.currentTarget.pause();setPreviewSegment(false);}}}
          onSeeked={e=>setPlaybackSeconds(e.currentTarget.currentTime)}/>
          :selected.imagePath&&<img src={api.mediaUrl(selected.imagePath)} alt={doc.selected?.title??"Материал"}/>}
        {doc.selected&&<><strong>{doc.selected.title}</strong><p>{doc.selected.attribution}</p>
          {!stage&&<button disabled={busy} onClick={()=>void download(doc.selected!)}>Выбрать отрезок текущего материала</button>}
          {doc.selected.pageUrl&&<button onClick={()=>void api.openExternal(doc.selected!.pageUrl)}>Открыть источник и права</button>}
          {doc.selected.excerpt&&<p>Скачан отдельный excerpt {doc.selected.excerpt.startSeconds.toFixed(1)}–{doc.selected.excerpt.endSeconds.toFixed(1)} с.
            <button disabled={busy} onClick={()=>void download(doc.selected!,true)}>Скачать полный исходник</button></p>}
        </>}
        {stage&&selected.videoPath&&<div className="documentary-trim">
          <label>Положение отрезка · {segmentLength.toFixed(1)} с из {sourceDuration.toFixed(1)} с<input aria-label="Положение фрагмента в исходнике" type="range" min="0" max={maxStart} step={1/30} value={Math.min(trimStart,maxStart)} disabled={!enoughSource} onChange={e=>moveSegment(Number(e.target.value))}/></label>
          <label>Начало, с<input type="number" step={1/30} min="0" max={maxStart} value={trimStart} disabled={!enoughSource} onChange={e=>moveSegment(Number(e.target.value))}/></label>
          <span>Конец: {trimEnd.toFixed(2)} с · длина сцены: {clipSeconds.toFixed(1)} с</span>
          <button disabled={!enoughSource} onClick={()=>moveSegment(playbackSeconds)}>Начать с текущего момента ({playbackSeconds.toFixed(1)} с)</button>
          <div className="documentary-trim-nudge"><button disabled={!enoughSource} onClick={()=>moveSegment(trimStart-1)}>−1 с</button><button disabled={!enoughSource} onClick={()=>moveSegment(trimStart+1)}>+1 с</button></div>
          <button disabled={!enoughSource} onClick={()=>{const player=sourcePlayer.current;if(!player)return;player.currentTime=trimStart;setPreviewSegment(true);void player.play().catch(()=>setPreviewSegment(false));}}>Просмотреть отрезок</button>
        </div>}
        {stage&&<>
          <label><input type="checkbox" checked={matched} onChange={e=>setMatched(e.target.checked)}/> Содержание и выбранный отрезок проверены</label>
          <label><input type="checkbox" checked={rights} onChange={e=>setRights(e.target.checked)}/> Условия использования проверены</label>
          <label><input type="checkbox" checked={illustrative} onChange={e=>setIllustrative(e.target.checked)}/> Тематическая иллюстрация</label>
          <label>Примечание<textarea value={note} onChange={e=>setNote(e.target.value)}/></label>
        </>}
        {!doc.selected&&<p>Выберите материал слева.</p>}
      </>}
    </aside></div>
    <footer className="documentary-material-actions">
      {stage&&!previewCandidate&&<><button className="documentary-confirm" disabled={busy||!matched||!rights||Boolean(selected.videoPath&&!enoughSource)} onClick={()=>void apply()}>Применить фрагмент</button>
        <button disabled={busy} onClick={()=>{setStage(undefined);setSourceDuration(0);setError("");}}>Отменить замену</button></>}
      {stage&&previewCandidate&&<button onClick={()=>setPreviewCandidate(undefined)}>Вернуться к подготовленной замене</button>}
      {previewCandidate&&!stage&&<button disabled={busy} onClick={()=>void download(previewCandidate)}>Выбрать этот материал</button>}
      <button disabled={busy} onClick={onClose}>Закрыть подбор</button>
    </footer>
  </section></div>;
}
