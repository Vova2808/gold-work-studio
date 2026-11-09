import { useRef,useState,type PointerEvent } from "react";
import type { DocumentaryTextClip,Scene } from "@gold-work/shared";
type Clip={scene:Scene;sceneStart:number;text:DocumentaryTextClip;lane:number};
export function textTrackClips(layout:{scene:Scene;start:number}[]){
  const ends:number[]=[];
  const clips:Clip[]=layout.flatMap(entry=>(entry.scene.documentary?.texts??[]).map(text=>({scene:entry.scene,sceneStart:entry.start,text,lane:0})))
    .sort((a,b)=>(a.sceneStart+a.text.startSeconds)-(b.sceneStart+b.text.startSeconds)).map(clip=>{
      const start=clip.sceneStart+clip.text.startSeconds;let lane=ends.findIndex(end=>end<=start);if(lane<0)lane=ends.length;
      ends[lane]=start+clip.text.durationSeconds;return {...clip,lane};
    });
  return {clips,height:Math.max(1,ends.length)*30+6};
}
export function DocumentaryTextTrack({clips,height,duration,boundaries,busy,selectedId,onSelect,onChange}:{
  clips:Clip[];height:number;duration:number;boundaries:number[];busy:boolean;selectedId?:string;
  onSelect:(sceneId:string,id:string)=>void;onChange:(sceneId:string,id:string,text:DocumentaryTextClip|null)=>void;
}){
  const root=useRef<HTMLDivElement>(null),drag=useRef<{clip:Clip;x:number;scale:number;mode:string;next:DocumentaryTextClip}|null>(null);
  const [draft,setDraft]=useState<DocumentaryTextClip|null>(null);
  const move=(event:PointerEvent)=>{const a=drag.current;if(!a)return;
    const snap=(value:number)=>Math.round((event.altKey?value:boundaries.find(b=>Math.abs(value-b)*a.scale<8)??value)*30)/30;
    const t=a.clip.text,delta=(event.clientX-a.x)/a.scale;let start=a.clip.sceneStart+t.startSeconds,end=start+t.durationSeconds;
    if(a.mode==="left")start=Math.max(0,Math.min(end-1/30,snap(start+delta)));
    else if(a.mode==="right")end=Math.min(duration,Math.max(start+1/30,snap(end+delta)));
    else {start=Math.max(0,Math.min(duration-t.durationSeconds,snap(start+delta)));end=start+t.durationSeconds;}
    a.next={...t,startSeconds:start-a.clip.sceneStart,durationSeconds:end-start};setDraft(a.next);
  };
  const finish=(save:boolean)=>{const a=drag.current;drag.current=null;setDraft(null);if(save&&a)onChange(a.clip.scene.id,a.clip.text.id,a.next);};
  return <div ref={root} className="timeline-grid-track documentary-text-track" style={{height}}>
    {!clips.length&&<span className="documentary-empty-track">+ Текст — независимый заголовок на таймлайне</span>}
    {clips.map(clip=>{const t=draft?.id===clip.text.id?draft:clip.text;return <div key={t.id} role="button" tabIndex={0}
      className={`documentary-effect-clip text-clip${selectedId===t.id?" selected":""}${t.enabled?"":" muted"}`}
      style={{left:`${(clip.sceneStart+t.startSeconds)/duration*100}%`,width:`${t.durationSeconds/duration*100}%`,top:clip.lane*30+3}}
      onPointerDown={e=>{if(busy||e.button!==0)return;e.preventDefault();e.stopPropagation();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);
        drag.current={clip,x:e.clientX,scale:root.current!.clientWidth/duration,mode:(e.target as HTMLElement).dataset.edge??"move",next:clip.text};onSelect(clip.scene.id,t.id);}}
      onPointerMove={move} onPointerUp={()=>finish(true)} onPointerCancel={()=>finish(false)} onLostPointerCapture={()=>finish(false)}
      onKeyDown={e=>{if(busy)return;if(["Delete","Backspace"].includes(e.key)){e.preventDefault();e.stopPropagation();onChange(clip.scene.id,t.id,null);}
        else if(e.key.toLowerCase()==="m"){e.stopPropagation();onChange(clip.scene.id,t.id,{...t,enabled:!t.enabled});}}}>
      <span data-edge="left" className="documentary-trim-handle left"/><span className="documentary-effect-name">T · {t.text}</span><span data-edge="right" className="documentary-trim-handle right"/>
    </div>})}
  </div>;
}
