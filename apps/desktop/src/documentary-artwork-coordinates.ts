import type {DocumentaryArtwork,DocumentaryArtworkLayer} from '@gold-work/shared';

/** Recover a fully received drawing whose leaf group clearly uses local boxes.
 * Ambiguous/mixed coordinates stay untouched; the normal bounds check owns them. */
export function normalizeArtworkGroupCoordinates(value:unknown):unknown {
  if(!value||typeof value!=='object')return value;
  const artwork=value as DocumentaryArtwork;
  if(!Array.isArray(artwork.layers))return value;
  if(artwork.layers.some(layer=>!layer||typeof layer!=='object'))return value;
  const layers=artwork.layers.map(layer=>({...layer,...(Array.isArray(layer.keyframes)?{keyframes:layer.keyframes.map(key=>({...key}))}:{})}));
  const numeric=(layer:DocumentaryArtworkLayer)=>[layer.x,layer.y,layer.w,layer.h].every(Number.isFinite);
  const inside=(layer:DocumentaryArtworkLayer,x:number,y:number,w:number,h:number)=>numeric(layer)
    &&layer.x>=x&&layer.y>=y&&layer.x+layer.w<=x+w+1&&layer.y+layer.h<=y+h+1;
  for(const group of layers){
    if(group.kind!=='group'||!numeric(group))continue;
    const children=layers.filter(layer=>layer.parentId===group.id);
    if(group.x===0&&group.y===0&&group.w===1&&group.h===1
      &&children.length&&children.every(layer=>layer.kind!=='group'&&numeric(layer)
        &&layer.w>0&&layer.h>0&&layer.x>=0&&layer.y>=0
        &&layer.x+layer.w<=artwork.canvas?.width&&layer.y+layer.h<=artwork.canvas?.height)
      &&children.some(layer=>!inside(layer,0,0,1,1))){
      const left=Math.min(...children.map(layer=>layer.x)),top=Math.min(...children.map(layer=>layer.y));
      group.x=left;group.y=top;
      group.w=Math.max(...children.map(layer=>layer.x+layer.w))-left;
      group.h=Math.max(...children.map(layer=>layer.y+layer.h))-top;
      continue; // Child coordinates are already absolute canvas coordinates.
    }
    if(!group.x&&!group.y)continue;
    if(!children.length||children.some(layer=>layer.kind==='group'))continue;
    if(!children.every(layer=>inside(layer,0,0,group.w,group.h))
      ||children.every(layer=>inside(layer,group.x,group.y,group.w,group.h)))continue;
    for(const child of children){
      const absolute=(axis:'x'|'y')=>artwork.motionCoordinates==='absolute'
        ||artwork.motionCoordinates!=='relative'&&child[axis]!==0&&child.keyframes?.some(key=>key[axis]===child[axis]);
      const absoluteX=absolute('x'),absoluteY=absolute('y');
      if(child.keyframes)for(const key of child.keyframes){
        if(absoluteX&&key.x!==undefined)key.x+=group.x;
        if(absoluteY&&key.y!==undefined)key.y+=group.y;
      }
      child.x+=group.x;child.y+=group.y;
    }
  }
  return {...artwork,layers};
}
