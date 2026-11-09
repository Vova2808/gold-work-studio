import type {DocumentaryArtwork,DocumentaryArtworkLayer as Layer} from '@gold-work/shared';

/** Small local contrast surfaces for text over unpredictable photographic pixels. */
export function prepareArtworkLabels(artwork:DocumentaryArtwork,validated:Layer[]):Layer[]{
  const sameParent=(a:Layer,b:Layer)=>a.parentId===b.parentId;
  const contains=(box:Layer,item:Layer)=>box.x<=item.x+1&&box.y<=item.y+1
    &&box.x+box.w>=item.x+item.w-1&&box.y+box.h>=item.y+item.h-1;
  const overlaps=(a:Layer,b:Layer)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  const area=artwork.canvas.width*artwork.canvas.height;
  const kept=new Set(validated.map(layer=>layer.id));
  const removed=artwork.layers.filter(layer=>layer.kind==='text'&&!kept.has(layer.id));
  const layers=validated.filter(layer=>{
    if(layer.kind!=='rect'||layer.w*layer.h>area*.08||layer.fill==='none')return true;
    if(!removed.some(text=>sameParent(text,layer)&&contains(layer,text)))return true;
    return validated.some(other=>other!==layer&&other.kind!=='group'&&other.kind!=='media'
      &&sameParent(other,layer)&&contains(layer,other));
  }).map(layer=>({...layer}));
  const original=new Map(layers.map(layer=>[layer.id,{...layer}]));
  for(const text of layers.filter(layer=>layer.kind==='text')){
    // The renderer cannot fit two readable lines in a shallow box. Give short
    // values enough width before it reaches its minimum font size/ellipsis.
    const units=[...(text.text??'')].reduce((sum,c)=>sum+(/\s/u.test(c)?.3:/[ilI1.,:'!]/u.test(c)?.28:/[MW@%ЖШЩЮ]/u.test(c)?.95:/[A-ZА-Я0-9]/u.test(c)?.66:.57),0);
    const needed=Math.ceil(units*22+8);
    if((text.text?.length??0)<=32&&text.h<55&&needed>text.w&&needed<artwork.canvas.width*.65){
      const cx=text.x+text.w/2;text.w=needed;text.x=Math.max(0,Math.min(artwork.canvas.width-needed,cx-needed/2));
    }
    const before=original.get(text.id)!;
    for(const plate of layers){
      if(plate.kind!=='rect'||plate.fill==='none'||!sameParent(plate,text)||plate.w*plate.h>area*.12
        ||plate.keyframes?.some(key=>key.rotation||key.scale!==undefined&&key.scale!==1))continue;
      const overlap=Math.max(0,Math.min(plate.x+plate.w,before.x+before.w)-Math.max(plate.x,before.x))
        *Math.max(0,Math.min(plate.y+plate.h,before.y+before.h)-Math.max(plate.y,before.y));
      if(overlap<before.w*before.h*.75)continue;
      const right=Math.max(plate.x+plate.w,text.x+text.w),bottom=Math.max(plate.y+plate.h,text.y+text.h);
      plate.x=Math.min(plate.x,text.x);plate.y=Math.min(plate.y,text.y);plate.w=right-plate.x;plate.h=bottom-plate.y;
    }
  }
  const media=layers.find(layer=>layer.kind==='media');
  if(!media)return layers;
  const result:Layer[]=[];let surfaces=0;
  for(const layer of layers){
    const backed=layer.kind==='text'&&layers.some(plate=>plate.kind==='rect'&&plate.fill!=='none'
      &&sameParent(plate,layer)&&contains(plate,layer));
    if(layer.kind!=='text'||backed||!overlaps(media,layer)||layer.fill==='none'||layers.length+surfaces>=96){result.push(layer);continue;}
    // Equal padding keeps the transform centre identical to the caption.
    const px=Math.max(0,Math.min(9,layer.x,artwork.canvas.width-layer.x-layer.w));
    const py=Math.max(0,Math.min(4,layer.y,artwork.canvas.height-layer.y-layer.h));
    let id=`text-surface-${surfaces++}`;while(kept.has(id))id+='x';kept.add(id);
    result.push({id,kind:'rect',...(layer.parentId?{parentId:layer.parentId}:{}),x:layer.x-px,y:layer.y-py,w:layer.w+px*2,h:layer.h+py*2,
      fill:'#16191d',stroke:'none',strokeWidth:0,radius:1,repeat:layer.repeat??1,
      ...(layer.keyframes?{keyframes:layer.keyframes.map(key=>({...key}))}:{})});
    result.push({...layer,fill:'#f8f7f2'});
  }
  return result;
}
