import type {ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {documentaryEditorialStages} from './documentary-editorial.js';

/** Composition moves the selected source without changing its timing. */
export function DocumentaryEditorialScene({template,frame,frames,material,accent,customBackground=false,motionEnabled=true}:{template:string;frame:number;frames:number;material:ReactNode;accent:string;customBackground?:boolean;motionEnabled?:boolean}) {
  const {settle}=documentaryEditorialStages(frame,frames,motionEnabled);
  const shutters=template==='editorial-shutters',iris=template==='editorial-iris',full=shutters||iris;
  // These old full-frame layouts also hold transparent technical drawings.
  // A light backing keeps their original black labels readable.
  return <AbsoluteFill style={{overflow:'hidden',background:customBackground?'transparent':full?'#f1f0eb':'#10161c'}}>
    <div style={{position:'absolute',inset:full?0:'5% 4%',overflow:'hidden',border:full?undefined:'1px solid #ffffff25'}}>{material}</div>
    {!full&&<div style={{position:'absolute',bottom:'2.5%',left:'4%',width:104*settle,height:3,background:accent,opacity:.8}}/>}
  </AbsoluteFill>;
}
