import {AbsoluteFill} from 'remotion';
import {documentaryLayoutPreset} from '@gold-work/shared';

export function DocumentaryPresetDecor({template,accent,frame,customBackground,enhanced=false,motionEnabled=true}:{template:string;accent:string;frame:number;customBackground:boolean;enhanced?:boolean;motionEnabled?:boolean}){
  const preset=documentaryLayoutPreset(template);if(!preset)return null;
  const ink=preset.paper?'#27313b':'#e5edf4',muted=preset.paper?'#24334520':'#ffffff1c',phase=motionEnabled?Math.max(0,Math.min(1,frame/24)):1;
  return <AbsoluteFill style={{pointerEvents:'none',background:customBackground?undefined:preset.paper?'#f1f0eb':'#10161c'}}>
    {preset.decor==='rail'&&<div style={{position:'absolute',left:'3%',top:'8%',width:2,height:'12%',background:accent,opacity:.6}}/>}
    {enhanced&&preset.decor==='grid'&&<AbsoluteFill data-preset-decor="grid" style={{backgroundImage:`linear-gradient(${muted} 1px,transparent 1px),linear-gradient(90deg,${muted} 1px,transparent 1px)`,backgroundSize:'3.5% 6.2%'}}/>}
    {enhanced&&preset.decor==='film'&&[2,94].map(top=><div data-preset-decor="film" key={top} style={{position:'absolute',left:0,top:`${top}%`,width:'100%',height:'4%',display:'flex',justifyContent:'space-around'}}>{Array.from({length:20},(_,i)=><div key={i} style={{width:'2.1%',height:'100%',borderRadius:3,background:ink,opacity:.65}}/>)}</div>)}
    {enhanced&&preset.decor==='paper'&&[0,1].map(i=><div data-preset-decor="paper" key={i} style={{position:'absolute',inset:i?'4% 5%':'5% 6%',background:i?'#f8f4e9':'#d4cfc3',border:'1px solid #20252c25',boxShadow:'0 10px 25px #0003',transform:`rotate(${i?-.7:1.2}deg)`}}/>)}
    {enhanced&&preset.decor==='brackets'&&<svg data-preset-decor="brackets" width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="none"><path d="M55 175V55H255 M1665 55H1865V175 M55 905V1025H255 M1665 1025H1865V905" stroke={accent} strokeWidth="5" fill="none" pathLength="1" strokeDasharray="1" strokeDashoffset={1-phase}/></svg>}
    {enhanced&&preset.decor==='lines'&&[0,1,2].map(i=><div data-preset-decor="lines" key={i} style={{position:'absolute',left:'3%',right:'3%',top:`${5+i*1.8}%`,height:i?1:3,background:accent,opacity:1-i*.25,transform:`scaleX(${phase})`,transformOrigin:'left'}}/>)}
    {enhanced&&preset.decor==='circle'&&<div data-preset-decor="circle" style={{position:'absolute',inset:'4% 23%',borderRadius:'50%',border:`3px solid ${accent}88`,boxShadow:`0 0 80px ${accent}30`,transform:`scale(${.94+.06*phase})`}}/>}
    {enhanced&&preset.decor==='glass'&&<AbsoluteFill data-preset-decor="glass" style={{background:`linear-gradient(125deg,${accent}30,transparent 48%,${accent}18)`}}/>}
    {enhanced&&preset.decor==='mat'&&<AbsoluteFill data-preset-decor="mat" style={{inset:'2%',width:'auto',height:'auto',border:`2px solid ${ink}66`}}/>}
    {enhanced&&preset.decor==='ribbon'&&<AbsoluteFill data-preset-decor="ribbon" style={{background:`linear-gradient(135deg,transparent 67%,${accent}35 67%,${accent}35 80%,transparent 80%)`}}/>}
  </AbsoluteFill>;
}
