/** Keep a connected subject, not detached titles/logos selected by saliency.
 * Anchored diagrams retain every component actually referenced by a label. */
export function connectedSubjectMask(mask:Uint8Array,width:number,height:number,anchors:Array<{x:number;y:number}>):Uint8Array{
  const labels=new Int32Array(mask.length),queue=new Int32Array(mask.length),areas=[0];
  let id=0;
  for(let i=0;i<mask.length;i++){
    if(mask[i]!<80||labels[i])continue;
    id++;let begin=0,end=1;queue[0]=i;labels[i]=id;
    while(begin<end){const p=queue[begin++]!,x=p%width;
      for(const next of [x? p-1:-1,x<width-1?p+1:-1,p>=width?p-width:-1,p+width<mask.length?p+width:-1]){
        if(next>=0&&!labels[next]&&mask[next]!>=80){labels[next]=id;queue[end++]=next;}
      }
    }
    areas[id]=end;
  }
  let largest=0;for(let i=1;i<areas.length;i++)if(areas[i]!>areas[largest]!)largest=i;
  if(!largest)throw Error('Не найден связный контур предмета');
  const keep=new Set([largest]);
  for(const point of anchors){const x=Math.round(point.x/100*(width-1)),y=Math.round(point.y/100*(height-1)),label=labels[y*width+x];if(!label)throw Error('Вырезка скрывает подписанную деталь; сохранён полный исходник');keep.add(label);}
  // Two substantial disconnected subjects cannot be picked by a saliency score.
  if(!anchors.length&&areas.some((area,i)=>i!==largest&&area>areas[largest]!*.4))throw Error('В кадре несколько предметов; сохранён полный исходник');
  const result=new Uint8Array(mask.length);
  for(let i=0;i<mask.length;i++)if(keep.has(labels[i]!))result[i]=mask[i]!;
  // Retain the soft alpha edge only around the accepted components.
  for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){
    const p=y*width+x;if(result[p]||!mask[p])continue;
    if([-2,-1,0,1,2].some(dy=>[-2,-1,0,1,2].some(dx=>keep.has(labels[p+dy*width+dx]!))))result[p]=mask[p]!;
  }
  return result;
}
