import type {DocumentaryAnnotation} from '@gold-work/shared';

// Optional enrichment of the SAME new visual review. Existing cached responses
// and unknown request keys are kept; absence never causes another paid call.
export const documentaryAnnotationInstruction=' Optional editorial enrichment, without changing the acceptance criteria: for an accepted review you may return annotations:[{label,confidence,points:[{x,y}]}], at most 3. Each label must be an exact short phrase from narration/narrationContext naming a clearly visible physical part or object. Do not label abstract properties, infer hidden parts or invent facts. Coordinates are percentages (0..100) of the ORIGINAL uncropped image. Supply one point per supplied sample, in order (for reviews[] use only the five samples in that group). Track the SAME visible detail in every sample; omit the label if occluded, uncertain, offscreen or crossing a cut. Only confidence >=0.93 is usable. This is optional data from the already supplied pixels, never a reason for a new request.';

export function readDocumentaryAnnotations(value:Record<string,unknown>,narration:string,samples:number[]):DocumentaryAnnotation[]{
  if(value.status!=='accepted'||!samples.length||!Array.isArray(value.annotations))return [];
  const normalized=` ${narration.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()} `;
  return value.annotations.slice(0,3).flatMap((raw:unknown)=>{
    if(!raw||typeof raw!=='object')return [];
    const row=raw as Record<string,unknown>,label=typeof row.label==='string'?row.label.trim():'';
    const key=label.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    if(label.length<3||label.length>48||!normalized.includes(` ${key} `)||typeof row.confidence!=='number'||row.confidence<.93
      ||!Array.isArray(row.points)||row.points.length!==samples.length)return [];
    const points=row.points.map((raw:unknown,index)=>{
      const point=raw as {x?:unknown;y?:unknown}|null;
      return point&&typeof point.x==='number'&&typeof point.y==='number'&&Number.isFinite(point.x)&&Number.isFinite(point.y)
        &&point.x>=2&&point.x<=98&&point.y>=2&&point.y<=98?{seconds:samples[index]!,x:point.x,y:point.y}:undefined;
    });
    if(points.some(p=>!p))return [];
    return [{label,points:points as DocumentaryAnnotation['points']}];
  });
}
