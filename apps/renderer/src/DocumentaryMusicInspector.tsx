import {useState} from 'react';
import type {DesktopApi,ProjectSettings} from '@gold-work/shared';
export function DocumentaryMusicInspector({api,value,onChange}:{api:DesktopApi;value:ProjectSettings['music'];onChange:(value:ProjectSettings['music'])=>void}){
  const [error,setError]=useState(''),[query,setQuery]=useState('documentary'),[searching,setSearching]=useState(false);const patch=(change:Partial<ProjectSettings['music']>)=>onChange({...value,...change});
  return <section className="documentary-inspector documentary-music-inspector"><small>ФОНОВАЯ МУЗЫКА · ВЕСЬ РОЛИК</small>
    <label><input type="checkbox" checked={value.enabled!==false} onChange={e=>patch({enabled:e.target.checked})}/>Добавлять музыку</label>
    <p>{value.name??value.path?.split(/[\\/]/).at(-1)??'Трек не выбран'}</p>
    <label>Поиск музыки Pixabay<input aria-label="Запрос музыки Pixabay" value={query} onChange={e=>setQuery(e.target.value)} placeholder="ambient, documentary, cinematic…"/></label>
    <button type="button" disabled={searching} onClick={async()=>{setSearching(true);setError('');try{const selected=await api.choosePixabayMusic(query);if(selected)patch({...selected,enabled:true});}catch(e){setError(String(e));}finally{setSearching(false);}}}>{searching?'Выберите трек в окне Pixabay…':'Найти и добавить с Pixabay'}</button>
    <small>В окне Pixabay прослушайте трек и нажмите Download. После скачивания он появится на музыкальной дорожке.</small>
    <button type="button" onClick={()=>void api.openExternal(`https://pixabay.com/music/search/${encodeURIComponent(query.trim()||'documentary')}/`)}>Открыть поиск в обычном браузере</button>
    <small>Если сайт не открывается во встроенном окне, скачайте трек в браузере и нажмите «Выбрать трек».</small>
    {value.sourcePage&&<button type="button" onClick={()=>void api.openExternal(value.sourcePage!)}>Открыть источник музыки</button>}
    <div className="documentary-effect-actions"><button type="button" onClick={async()=>{try{const [path]=await api.pickFiles('audio');if(path){patch({path:await api.importMusic(path),name:path.split(/[\\/]/).at(-1),sourcePage:undefined,enabled:true});setError('');}}catch(e){setError(String(e));}}}>Выбрать трек</button>{value.path&&<button type="button" onClick={()=>patch({path:undefined,name:undefined,sourcePage:undefined})}>Убрать трек</button>}</div>
    <label>Громкость · {value.volume}%<input aria-label="Громкость музыки" type="range" min={0} max={100} value={value.volume} onChange={e=>patch({volume:Number(e.target.value)})}/></label>
    <label><input type="checkbox" checked={value.ducking!==false} onChange={e=>patch({ducking:e.target.checked})}/>Приглушать под диктором</label>
    <div className="timeline-two-fields">{(['fadeInSeconds','fadeOutSeconds'] as const).map((key,i)=><label key={key}>{i?'Конец':'Начало'}, с<input type="number" min={0} max={20} step={.25} value={value[key]??(i?2:1)} onChange={e=>patch({[key]:Math.max(0,Math.min(20,Number(e.target.value)))})}/></label>)}</div>
    {error&&<p role="alert">{error}</p>}<small>Предпросмотр воспроизводит текущие настройки. «Применить» сохраняет их; отмена и повтор работают вместе с остальными правками.</small>
  </section>;
}
