import {useEffect,useRef,useState} from 'react';
import {editMusicClips,resolveMusicClips,moveMusicClip,trimMusicClip,splitMusicClip,type DesktopApi,type MusicClip,type ProjectSettings} from '@gold-work/shared';
import {loadMusicWaveform} from './music-waveform';

export function DocumentaryMusicInspector({api,value,duration,currentTime,selectedId,busy,onSelect,onChange,onPendingChange}: {
  api:DesktopApi;value:ProjectSettings['music'];duration:number;currentTime:number;selectedId?:string;busy:boolean;
  onSelect:(id?:string)=>void;onChange:(value:ProjectSettings['music'])=>void;onPendingChange:(pending:boolean)=>void;
}){
  const [error,setError]=useState(''),[query,setQuery]=useState('documentary'),[loading,setLoading]=useState(false);
  const request=useRef(0);
  useEffect(()=>()=>{request.current++;onPendingChange(false);},[onPendingChange]);
  const clips=value.clips??resolveMusicClips(value,duration),clip=clips.find(item=>item.id===selectedId);
  const patch=(change:Partial<ProjectSettings['music']>)=>onChange({...value,...change});
  const changeClip=(next:MusicClip)=>onChange(editMusicClips(value,clips.map(item=>item.id===next.id?{...next,origin:'manual'}:item)));
  const insert=async(selected:{path:string;name?:string;sourcePage?:string},replace:boolean,token:number)=>{
    const wave=await loadMusicWaveform(api.mediaUrl(selected.path));
    if(request.current!==token)return;
    const start=replace&&clip?clip.startSeconds:Math.min(currentTime,Math.max(0,duration-1/30));
    const next:MusicClip={...(replace?clip:undefined),...selected,id:replace&&clip?clip.id:crypto.randomUUID(),
      startSeconds:start,durationSeconds:Math.min(replace&&clip?clip.durationSeconds:duration-start,wave.durationSeconds),
      sourceOffsetSeconds:0,sourceDurationSeconds:wave.durationSeconds,volume:replace&&clip?clip.volume:100,enabled:true,origin:'manual',status:'ready',message:undefined,assetId:undefined,loop:false};
    onChange(editMusicClips(value,replace&&clip?clips.map(item=>item.id===clip.id?next:item):[...clips,next]));onSelect(next.id);
  };
  const choose=async(pixabay:boolean,replace:boolean)=>{
    const token=++request.current;setLoading(true);onPendingChange(true);setError('');
    try{
      if(pixabay){const selected=await api.choosePixabayMusic(query);if(selected&&request.current===token)await insert(selected,replace,token);}
      else {const [path]=await api.pickFiles('audio');if(path&&request.current===token){const imported=await api.importMusic(path);if(request.current===token)await insert({path:imported,name:path.split(/[\\/]/).at(-1)},replace,token);}}
    }catch(e){if(request.current===token)setError(String(e));}
    finally{if(request.current===token){setLoading(false);onPendingChange(false);}}
  };
  const split=clip?splitMusicClip(clip,currentTime,'split'):undefined;
  return <section className="documentary-inspector documentary-music-inspector"><small>МУЗЫКА · {clips.length} ФРАГМ.</small>
    <fieldset disabled={busy||loading}>
      <label><input type="checkbox" checked={value.enabled!==false} onChange={e=>patch({enabled:e.target.checked})}/>Включить музыкальную дорожку</label>
      <label>Общая громкость · {value.volume}%<input aria-label="Общая громкость музыки" type="range" min={0} max={100} value={value.volume} onChange={e=>patch({volume:Number(e.target.value)})}/></label>
      <label>Фрагмент<select aria-label="Музыкальный фрагмент" value={clip?.id??''} onChange={e=>onSelect(e.target.value||undefined)}><option value="">Добавить новый</option>{clips.map(item=><option key={item.id} value={item.id}>{item.startSeconds.toFixed(1)}с · {item.name??(item.status==='missing'?'Нужна музыка':item.path?.split(/[\\/]/).at(-1))}</option>)}</select></label>
      {clip&&<div className="music-fragment-fields"><h4>{clip.name??'Музыкальный фрагмент'}</h4>
        {clip.status==='missing'&&<p role="status">{clip.message??'Нужна музыка: подходящий трек не найден.'}</p>}
        <label><input type="checkbox" checked={clip.enabled} onChange={e=>changeClip({...clip,enabled:e.target.checked})}/>Включить фрагмент</label>
        <label>Громкость фрагмента · {clip.volume}%<input aria-label="Громкость фрагмента" type="range" min={0} max={100} value={clip.volume} onChange={e=>changeClip({...clip,volume:Number(e.target.value)})}/></label>
        <div className="timeline-two-fields">
          <label>Позиция, с<input aria-label="Позиция музыки" type="number" min={0} max={duration} step={1/30} value={Number(clip.startSeconds.toFixed(3))} onChange={e=>changeClip(moveMusicClip(clip,Number(e.target.value),duration))}/></label>
          <label>Длина, с<input aria-label="Длина музыки" type="number" min={1/30} max={duration} step={1/30} value={Number(clip.durationSeconds.toFixed(3))} onChange={e=>changeClip(trimMusicClip(clip,'right',clip.startSeconds+Number(e.target.value),duration))}/></label>
        </div>
        <label>Начало в файле, с<input aria-label="Начало музыки в файле" type="number" min={0} step={1/30} value={Number(clip.sourceOffsetSeconds.toFixed(3))} onChange={e=>changeClip({...clip,sourceOffsetSeconds:Math.max(0,Math.min(clip.loop?Infinity:Math.max(0,(clip.sourceDurationSeconds??Infinity)-clip.durationSeconds),Math.round(Number(e.target.value)*30)/30))})}/></label>
        {clip.path&&<label><input type="checkbox" checked={clip.loop===true} onChange={e=>changeClip({...clip,loop:e.target.checked,...(!e.target.checked&&clip.sourceDurationSeconds?{sourceOffsetSeconds:clip.sourceOffsetSeconds%clip.sourceDurationSeconds,durationSeconds:Math.min(clip.durationSeconds,clip.sourceDurationSeconds-clip.sourceOffsetSeconds%clip.sourceDurationSeconds)}:{})})}/>Повторять файл</label>}
        <div className="documentary-effect-actions"><button type="button" disabled={!split} onClick={()=>{const parts=splitMusicClip(clip,currentTime,crypto.randomUUID());if(parts){onChange(editMusicClips(value,clips.flatMap(item=>item.id===clip.id?parts:[item])));onSelect(parts[1].id);}}}>Разрезать по курсору</button>
          <button type="button" onClick={()=>{onChange(editMusicClips(value,clips.filter(item=>item.id!==clip.id)));onSelect();}}>Убрать фрагмент</button></div>
        <button type="button" onClick={()=>void choose(false,true)}>Заменить файл фрагмента</button>
        {clip.sourcePage&&<button type="button" onClick={()=>void api.openExternal(clip.sourcePage!)}>Источник музыки</button>}
      </div>}
      <button type="button" onClick={()=>void choose(false,false)}>Добавить аудиофайл у курсора</button>
      <label>Поиск музыки Pixabay<input aria-label="Запрос музыки Pixabay" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <button type="button" onClick={()=>void choose(true,Boolean(clip))}>{loading?'Выбираем музыку…':clip?'Заменить с Pixabay':'Добавить с Pixabay'}</button>
      <small>На Pixabay прослушайте трек и нажмите Download.</small>
      <button type="button" onClick={()=>void api.openExternal(`https://pixabay.com/music/search/${encodeURIComponent(query.trim()||'documentary')}/`)}>Открыть поиск в браузере</button>
      <label><input type="checkbox" checked={value.ducking!==false} onChange={e=>patch({ducking:e.target.checked})}/>Приглушать под диктором</label>
      <div className="timeline-two-fields">{(['fadeInSeconds','fadeOutSeconds'] as const).map((key,i)=><label key={key}>{i?'Конец ролика':'Начало ролика'}, с<input type="number" min={0} max={20} step={.25} value={value[key]??(i?2:1)} onChange={e=>patch({[key]:Math.max(0,Math.min(20,Number(e.target.value)))})}/></label>)}</div>
    </fieldset>
    {error&&<p role="alert">{error}</p>}<small>Края фрагмента обрезают звук. Промежутки — тишина. «Применить» сохраняет изменения вместе с монтажом.</small>
  </section>;
}
