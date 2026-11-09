import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { DocumentaryVisualCut, Scene } from "@gold-work/shared";
import { rollVisualCut, visualCuts } from "./documentary-editing";

type Entry={scene:Scene;start:number;duration:number;transition?:'none'|'mix'|'fade'};
export function DocumentaryVisualTrack({entries,scenes,duration,busy,selectedId,selectedScenes,mediaUrl,onSelect,onContext,onChange,onReorder,onTransition}:{
  entries:Entry[];scenes:Scene[];duration:number;busy:boolean;selectedId?:string;mediaUrl:(path:string)=>string;
  selectedScenes:Set<string>;onContext:(sceneId:string,x:number,y:number)=>void;
  onSelect:(sceneId:string,cutId:string,seconds:number,event:{ctrlKey:boolean;metaKey:boolean;shiftKey:boolean})=>void;
  onChange:(sceneId:string,cuts:DocumentaryVisualCut[])=>void;
  onReorder:(from:string,to:string,after:boolean)=>void;
  onTransition:(sceneId:string,nextSceneId:string)=>void;
}){
  const nextScenes=useMemo(()=>{const ordered=scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order);return new Map(ordered.map((s,i)=>[s.id,ordered[i+1]]));},[scenes]);
  const root=useRef<HTMLDivElement>(null),active=useRef<{entry:Entry;cut:DocumentaryVisualCut;rightId?:string;x:number;scale:number;cuts:DocumentaryVisualCut[]}|null>(null);
  const [draft,setDraft]=useState<{id:string;cuts:DocumentaryVisualCut[]}|null>(null);
  const move=(event:PointerEvent)=>{
    const a=active.current;if(!a)return;
    let delta=(event.clientX-a.x)/a.scale;
    if(!event.altKey)delta=Math.round(delta*30)/30;
    let cuts:DocumentaryVisualCut[];
    if(a.rightId)cuts=rollVisualCut(a.entry.scene,a.rightId,delta*30);
    else {
      const source=a.cut.sourceSceneId?scenes.find(s=>s.id===a.cut.sourceSceneId):a.entry.scene;
      const start=Math.max(0,Math.min((source?.documentary?.selected?.durationSeconds??86400)-a.cut.durationInFrames/30*a.cut.playbackRate,a.cut.trimStartSeconds+delta));
      cuts=visualCuts(a.entry.scene).map(cut=>cut.id===a.cut.id?{...cut,trimStartSeconds:start,trimEndSeconds:start+cut.durationInFrames/30*cut.playbackRate}:cut);
    }
    a.cuts=cuts;setDraft({id:a.entry.scene.id,cuts});
  };
  const finish=(commit:boolean)=>{const a=active.current;active.current=null;setDraft(null);if(commit&&a)onChange(a.entry.scene.id,a.cuts);};
  return <div ref={root} className="timeline-grid-track video-track documentary-visual-track">{entries.flatMap(entry=>{
    const cuts=draft?.id===entry.scene.id?draft.cuts:visualCuts(entry.scene);
    return cuts.map((cut,index)=>{
      const source=cut.sourceSceneId?scenes.find(s=>s.id===cut.sourceSceneId):entry.scene;
      return <button key={`${entry.scene.id}:${cut.id}`} className={`timeline-clip${selectedId===cut.id||!selectedId&&selectedScenes.has(entry.scene.id)?" selected":""}${entry.scene.includeInAssembly===false?" excluded":""}`} draggable={!busy}
        style={{left:`${(entry.start+cut.fromFrame/30)/duration*100}%`,width:`${cut.durationInFrames/30/duration*100}%`}}
        title={`${entry.scene.order+1}.${index+1} · ${(cut.durationInFrames/30).toFixed(2)} с. Края — разрез; Alt + перетаскивание — сдвиг видео внутри кадра. Обычное перетаскивание — переставить сцену с диктором.`}
        onDragStart={e=>{if(active.current){e.preventDefault();return;}e.dataTransfer.setData("text/gws-scene",entry.scene.id);e.dataTransfer.effectAllowed="move";}}
        onDragOver={e=>{if(!busy&&e.dataTransfer.types.includes("text/gws-scene"))e.preventDefault();}}
        onDrop={e=>{e.preventDefault();const from=e.dataTransfer.getData("text/gws-scene");if(from)onReorder(from,entry.scene.id,e.clientX>e.currentTarget.getBoundingClientRect().left+e.currentTarget.clientWidth/2);}}
        onClick={e=>{if(!(e.target as HTMLElement).dataset.edge&&!e.altKey)onSelect(entry.scene.id,cut.id,entry.start+cut.fromFrame/30,e);}}
        onContextMenu={e=>{e.preventDefault();onContext(entry.scene.id,e.clientX,e.clientY);}}
        onPointerDown={e=>{
          const edge=(e.target as HTMLElement).dataset.edge;if(busy||e.button!==0||!edge&&!e.altKey)return;
          e.preventDefault();e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);
          const rightId=edge==="left"?cut.id:edge==="right"?cuts[index+1]?.id:undefined;
          active.current={entry,cut,rightId,x:e.clientX,scale:root.current!.clientWidth/duration,cuts:visualCuts(entry.scene)};
        }} onPointerMove={move} onPointerUp={()=>finish(true)} onPointerCancel={()=>finish(false)} onLostPointerCapture={()=>finish(false)}>
        {source?.imagePath&&<img src={`${mediaUrl(source.imagePath)}?thumbnail=240`} alt="" draggable={false} loading="lazy" decoding="async"/>}
        <i>{entry.scene.order+1}{cuts.length>1?`.${index+1}`:""}</i><em>{(cut.durationInFrames/30).toFixed(1)}с</em>
        {index>0&&<span className="documentary-trim-handle left" data-edge="left"/>}
        {index<cuts.length-1&&<span className="documentary-trim-handle right" data-edge="right"/>}
      </button>;
    });
  })}{entries.filter(entry=>entry.scene.includeInAssembly!==false).map(entry=>{
    const next=nextScenes.get(entry.scene.id);if(!next)return null;
    const custom=entry.scene.documentary?.effects.some(e=>e.enabled&&e.boundary?.from===entry.scene.id&&e.boundary.to===next.id);
    const label=custom?'Эффект':entry.transition==='mix'?'Микс':entry.transition==='fade'?'Затемнение':'+';
    return <button key={`seam-${entry.scene.id}`} className={`documentary-seam-button${label!=='+'?' enabled':''}`} disabled={busy}
      style={{left:`${(entry.start+entry.duration)/duration*100}%`}} aria-label={`Переход между кадрами ${entry.scene.order+1} и ${next.order+1}`}
      title={`Переход ${entry.scene.order+1} → ${next.order+1}: ${label==='+'?'склейка':label}. Нажмите, чтобы изменить.`}
      onClick={e=>{e.stopPropagation();onTransition(entry.scene.id,next.id);}}>{label}</button>;
  })}</div>;
}
