import {AbsoluteFill,Img} from 'remotion';
import {resolveMediaSource} from './MediaSurface.js';
import {documentaryEase} from './documentary-design.js';

/** A readable detail and an uncropped navigator. The navigator keeps the source
 * context visible; the outlined viewport is the actual crop, not an annotation
 * pretending to identify an object. Short shots scan only a bounded distance. */
export function DocumentaryDetail({source,aspect,frame,frames,width,height,accent,moving=true}:{
  source:string;aspect:number;frame:number;frames:number;width:number;height:number;accent:string;moving?:boolean;
}){
  const wide=aspect>=width/height;
  const box={x:width*.025,y:height*.025,w:width*.95,h:height*.71};
  const scale=Math.max(box.w/aspect,box.h);
  const imageW=aspect*scale,imageH=scale;
  const travel=wide?imageW-box.w:imageH-box.h;
  const maxTravel=Math.min(travel,Math.max(0,frames/30-1)*Math.min(box.w,box.h)*.22);
  const progress=moving?documentaryEase((frame-15)/Math.max(1,frames-30)):0;
  const offset=(travel-maxTravel)/2+maxTravel*progress;
  const x=wide?-offset:(box.w-imageW)/2,y=wide?(box.h-imageH)/2:-offset;
  const overviewScale=Math.min(width*.9/aspect,height*.2);
  const ow=overviewScale*aspect,oh=overviewScale,ox=(width-ow)/2,oy=height*.78+(height*.2-oh)/2;
  return <AbsoluteFill style={{background:'#101b20'}}>
    <div style={{position:'absolute',left:box.x,top:box.y,width:box.w,height:box.h,overflow:'hidden',borderRadius:10}}>
      <Img src={resolveMediaSource(source)} style={{position:'absolute',left:x,top:y,width:imageW,height:imageH,maxWidth:'none'}}/>
    </div>
    <Img src={resolveMediaSource(source)} style={{position:'absolute',left:ox,top:oy,width:ow,height:oh}}/>
    <div style={{position:'absolute',left:ox-x/imageW*ow,top:oy-y/imageH*oh,width:box.w/imageW*ow,height:box.h/imageH*oh,
      border:`3px solid ${accent}`,boxSizing:'border-box',boxShadow:'0 0 0 1px #0008'}}/>
  </AbsoluteFill>;
}
