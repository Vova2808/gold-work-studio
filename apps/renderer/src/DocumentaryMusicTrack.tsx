import {useEffect,useRef,useState,type PointerEvent} from 'react';
import {moveMusicClip,trimMusicClip,type MusicClip} from '@gold-work/shared';
import {loadMusicWaveform,type MusicWaveform} from './music-waveform';
import './documentary-music.css';

export function musicTrackLayout(clips:MusicClip[]){
  const ends:number[]=[];
  const entries=[...clips].sort((a,b)=>a.startSeconds-b.startSeconds).map(clip=>{
    let lane=ends.findIndex(end=>end<=clip.startSeconds);if(lane<0)lane=ends.length;
    ends[lane]=clip.startSeconds+clip.durationSeconds;return {clip,lane};
  });
  return {entries,height:Math.max(1,ends.length)*52+6};
}

function Waveform({clip,src}:{clip:MusicClip;src:string}){
  const [wave,setWave]=useState<MusicWaveform>(),[error,setError]=useState('');
  useEffect(()=>{let alive=true;setWave(undefined);setError('');
    void loadMusicWaveform(src).then(value=>{if(alive)setWave(value);},()=>{if(alive)setError('Не удалось прочитать аудио');});
    return()=>{alive=false;};
  },[src]);
  if(!wave)return <small className="music-wave-status">{error||'Читаем аудио…'}</small>;
  const bars=200,step=clip.durationSeconds/bars;
  const maximum=Math.max(.001,...wave.peaks);
  const path=Array.from({length:bars},(_,i)=>{
    let peak=0;
    const samples=Math.max(1,Math.ceil(step/wave.durationSeconds*wave.peaks.length));
    for(let j=0;j<samples;j++){
      let time=clip.sourceOffsetSeconds+i*step+j*step/samples;
      if(clip.loop)time%=wave.durationSeconds;
      const index=Math.floor(time/wave.durationSeconds*wave.peaks.length);
      peak=Math.max(peak,wave.peaks[index]??0);
    }
    const amplitude=peak/maximum*11;
    return `M${i} ${12-amplitude}V${12+amplitude}`;
  }).join(' ');
  return <svg className="music-waveform" viewBox="0 0 200 24" preserveAspectRatio="none" aria-label="Волна аудио"><path d={path}/></svg>;
}

export function DocumentaryMusicTrack({clips,duration,boundaries,busy,selectedId,enabled,mediaUrl,onSelect,onChange}: {
  clips:MusicClip[];duration:number;boundaries:number[];busy:boolean;selectedId?:string;enabled:boolean;
  mediaUrl:(path:string)=>string;onSelect:(id?:string)=>void;onChange:(id:string,clip:MusicClip|null)=>void;
}){
  const root=useRef<HTMLDivElement>(null);
  const drag=useRef<{clip:MusicClip;x:number;scale:number;mode:string;next:MusicClip}|null>(null);
  const [draft,setDraft]=useState<MusicClip>();
  const layout=musicTrackLayout(clips);
  const move=(event:PointerEvent)=>{const state=drag.current;if(!state)return;
    const snap=(value:number)=>event.altKey?value:boundaries.find(boundary=>Math.abs(value-boundary)*state.scale<8)??value;
    const delta=(event.clientX-state.x)/state.scale,clip=state.clip;
    const next=state.mode==='left'?trimMusicClip(clip,'left',snap(clip.startSeconds+delta),duration)
      :state.mode==='right'?trimMusicClip(clip,'right',snap(clip.startSeconds+clip.durationSeconds+delta),duration)
      :moveMusicClip(clip,snap(clip.startSeconds+delta),duration);
    state.next=next;setDraft(next);
  };
  const finish=(save:boolean)=>{const state=drag.current;drag.current=null;setDraft(undefined);
    if(save&&state&&JSON.stringify(state.next)!==JSON.stringify(state.clip))onChange(state.clip.id,state.next);
  };
  return <div ref={root} className={`timeline-grid-track documentary-music-track${enabled?'':' master-muted'}`} style={{height:layout.height}}
    onDoubleClick={event=>{if(event.target===event.currentTarget)onSelect();}}>
    {!clips.length&&<button type="button" className="music-empty" disabled={busy} onClick={()=>onSelect()}>+ Добавить музыку · пустая дорожка</button>}
    {layout.entries.map(({clip:original,lane})=>{const clip=draft?.id===original.id?draft:original;
      return <div key={clip.id} role="button" tabIndex={0} aria-label={`Музыка: ${clip.name??(clip.status==='missing'?'Нужна музыка':'Фрагмент')}`}
        className={`music-clip${selectedId===clip.id?' selected':''}${clip.enabled?'':' muted'}${clip.status==='missing'?' missing':''}`}
        title={clip.message??'Перетащите фрагмент или края. S — разрез по курсору, M — выключить, Delete — убрать'}
        style={{left:`${clip.startSeconds/Math.max(.1,duration)*100}%`,width:`${clip.durationSeconds/Math.max(.1,duration)*100}%`,top:lane*52+3}}
        onPointerDown={event=>{if(busy||event.button!==0)return;event.preventDefault();event.stopPropagation();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);
          drag.current={clip:original,next:original,x:event.clientX,scale:root.current!.clientWidth/Math.max(.1,duration),mode:(event.target as HTMLElement).dataset.edge??'move'};onSelect(clip.id);}}
        onPointerMove={move} onPointerUp={()=>finish(true)} onPointerCancel={()=>finish(false)} onLostPointerCapture={()=>finish(false)}
        onKeyDown={event=>{if(busy)return;
          if(['Delete','Backspace'].includes(event.key)){event.preventDefault();event.stopPropagation();onChange(clip.id,null);}
          if(event.key.toLowerCase()==='m'){event.preventDefault();event.stopPropagation();onChange(clip.id,{...clip,origin:'manual',enabled:!clip.enabled});}
          if(event.key==='Enter'){event.stopPropagation();onSelect(clip.id);}
        }}>
        <span className="music-clip-label">{clip.status==='missing'?'⚑ Нужна музыка':`♫ ${clip.name??clip.path?.split(/[\\/]/).at(-1)??'Музыка'}`} · {clip.enabled?`${clip.volume}%`:'выкл.'}</span>
        {clip.status==='ready'&&clip.path?<Waveform clip={clip} src={mediaUrl(clip.path)}/>:<small className="music-wave-status">{clip.message??'Подходящий трек не найден · замените файл'}</small>}
        <span data-edge="left" className="music-trim left"/><span data-edge="right" className="music-trim right"/>
      </div>;
    })}
  </div>;
}
