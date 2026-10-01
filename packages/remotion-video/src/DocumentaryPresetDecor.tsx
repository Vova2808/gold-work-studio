import {AbsoluteFill} from 'remotion';
import {documentaryLayoutPreset} from '@gold-work/shared';

export function DocumentaryPresetDecor({template,accent,frame,customBackground}:{template:string;accent:string;frame:number;customBackground:boolean}){
  const preset=documentaryLayoutPreset(template);if(!preset)return null;
  const ink=preset.paper?'#272d34':'#e5edf4',muted=preset.paper?'#24334518':'#ffffff18';
  const drift=Math.sin(frame/160)*2,decor=preset.decor;
  return <AbsoluteFill style={{pointerEvents:'none',background:customBackground?undefined:preset.paper?'#eeeae1':'#111921',overflow:'hidden'}}>
    {decor==='grid'&&<AbsoluteFill style={{backgroundImage:`linear-gradient(${muted} 1px,transparent 1px),linear-gradient(90deg,${muted} 1px,transparent 1px)`,backgroundSize:'55px 55px',backgroundPosition:`${drift}px ${drift}px`}}/>}
    {decor==='circle'&&<div style={{position:'absolute',left:'21%',top:'2%',width:'58%',height:'96%',borderRadius:'50%',border:`3px solid ${accent}70`,boxShadow:`0 0 140px ${accent}50,inset 0 0 100px ${accent}30`,transform:`translateX(${drift}%)`}}/>}
    {decor==='rail'&&<><div style={{position:'absolute',left:'3%',top:'6%',width:'1%',height:'88%',background:accent}}/><div style={{position:'absolute',left:'5%',top:'6%',width:'2%',height:'16%',background:ink,opacity:.4}}/></>}
    {decor==='film'&&[0,1].map(row=><div key={row} style={{position:'absolute',left:0,top:row?'94%':'2%',width:'100%',height:'4%',display:'flex',justifyContent:'space-around'}}>{Array.from({length:22},(_,i)=><div key={i} style={{width:'2.1%',height:'100%',borderRadius:5,background:ink,opacity:.7}}/>)}</div>)}
    {decor==='paper'&&[0,1].map(i=><div key={i} style={{position:'absolute',left:`${5+i}%`,top:`${5+i}%`,width:'89%',height:'87%',background:i?'#fcfaf4':'#d6d0c4',border:'1px solid #20252c25',boxShadow:'0 12px 28px #0003',transform:`rotate(${i?-.8:1.8}deg)`}}/>)}
    {decor==='lines'&&[0,1,2].map(i=><div key={i} style={{position:'absolute',left:'3%',right:'3%',top:`${5+i*2}%`,height:i===0?3:1,background:accent,opacity:1-i*.3,transform:`translateX(${drift*(i+1)}px)`}}/>)}
    {decor==='brackets'&&<svg width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="none"><path d="M50 190V50H270 M1650 50H1870V190 M50 890V1030H270 M1650 1030H1870V890" stroke={accent} strokeWidth="5" fill="none"/></svg>}
    {decor==='glass'&&<AbsoluteFill style={{background:`linear-gradient(125deg,${accent}26,transparent 45%,${accent}12)`}}/>}
    {decor==='mat'&&<AbsoluteFill style={{inset:'2%',border:`1px solid ${ink}44`}}/>}
    {decor==='ribbon'&&<AbsoluteFill style={{background:`linear-gradient(135deg,transparent 65%,${accent}30 65%,${accent}30 78%,transparent 78%)`}}/>}
  </AbsoluteFill>;
}
