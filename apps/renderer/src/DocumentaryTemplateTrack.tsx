import {useRef,useState,type PointerEvent} from 'react';
import {documentaryTemplates,type Scene,type DocumentaryScene} from '@gold-work/shared';
type Entry={scene:Scene;start:number;duration:number};
export function DocumentaryTemplateTrack({entries,duration,busy,onSelect,onChange}:{entries:Entry[];duration:number;busy:boolean;onSelect:(id:string)=>void;onChange:(id:string,doc:DocumentaryScene)=>void}) {
  const root=useRef<HTMLDivElement>(null),drag=useRef<{entry:Entry;edge:string;x:number;start:number;length:number;next:{startSeconds:number;durationSeconds:number}}|undefined>(undefined);
  const [draft,setDraft]=useState<{id:string;startSeconds:number;durationSeconds:number}>();
  const change=(entry:Entry,range:{startSeconds:number;durationSeconds:number}|null)=>{
    const doc=entry.scene.documentary!,g=doc.motionGraphic;
    onChange(entry.scene.id,g?.enabled?{...doc,motionGraphic:{...g,enabled:range!==null,origin:'manual',...(range??{}),sequenceId:undefined}}
      :{...doc,template:range?doc.template:'full',templateOrigin:'manual',templateTiming:range??undefined});
  };
  const move=(e:PointerEvent)=>{const d=drag.current;if(!d)return;const delta=Math.round((e.clientX-d.x)/root.current!.clientWidth*duration*30)/30;
    const start=d.edge==='right'?d.start:Math.max(0,Math.min(d.edge==='left'?d.start+d.length-.3:d.entry.duration-d.length,d.start+delta));
    const length=d.edge==='left'?Math.max(.3,d.length+d.start-start):d.edge==='right'?Math.max(.3,Math.min(d.entry.duration-start,d.length+delta)):d.length;
    d.next={startSeconds:start,durationSeconds:length};setDraft({id:d.entry.scene.id,...d.next});};
  const finish=(commit:boolean)=>{const d=drag.current;drag.current=undefined;setDraft(undefined);if(commit&&d&&(d.next.startSeconds!==d.start||d.next.durationSeconds!==d.length))change(d.entry,d.next);};
  return <div className="timeline-grid-track documentary-template-track" ref={root}>{entries.filter(e=>e.scene.documentary&&e.scene.includeInAssembly!==false).map(entry=>{
    const doc=entry.scene.documentary!,g=doc.motionGraphic?.enabled?doc.motionGraphic:undefined;
    const range=draft?.id===entry.scene.id?draft:g??doc.templateTiming??{startSeconds:0,durationSeconds:entry.duration};
    const label=g?`${g.kind} · ${g.title??''}`:documentaryTemplates.find(([id])=>id===doc.template)?.[1]??'Без шаблона';
    return <button type="button" key={entry.scene.id} className="documentary-template-clip" disabled={busy} style={{left:`${(entry.start+range.startSeconds)/duration*100}%`,width:`${range.durationSeconds/duration*100}%`}}
      aria-label={`Шаблон сцены ${entry.scene.order+1}: ${label}`} title={`${label}. Клик — настройки, перетаскивание — время, края — длительность, Delete — убрать.`}
      onClick={()=>onSelect(entry.scene.id)} onKeyDown={e=>{if(!busy&&(e.key==='Delete'||e.key==='Backspace')){e.preventDefault();e.stopPropagation();change(entry,null);}}}
      onPointerDown={e=>{if(busy||e.button!==0)return;e.preventDefault();e.stopPropagation();e.currentTarget.focus();onSelect(entry.scene.id);e.currentTarget.setPointerCapture(e.pointerId);drag.current={entry,edge:(e.target as HTMLElement).dataset.edge??'move',x:e.clientX,start:range.startSeconds,length:range.durationSeconds,next:{startSeconds:range.startSeconds,durationSeconds:range.durationSeconds}};}}
      onPointerMove={move} onPointerUp={()=>finish(true)} onPointerCancel={()=>finish(false)} onLostPointerCapture={()=>finish(false)}><span data-edge="left" className="documentary-trim-handle left"/>{label}<span data-edge="right" className="documentary-trim-handle right"/></button>;
  })}</div>;
}
