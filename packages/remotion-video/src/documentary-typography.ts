/** Keep complete words inside the actual template column. The same browser
 * font metrics are used by Player and export; this never edits the saved text. */
export function fitDocumentaryText(text:string,requested:number,width:number,height:number,weight=800):number {
  if(typeof document==='undefined')return requested;
  const context=document.createElement('canvas').getContext('2d');if(!context)return requested;
  for(let size=requested;size>=12;size-=1){
    context.font=`${weight} ${size}px Arial`;
    let lines=0,tooWide=false;
    for(const paragraph of text.split('\n')){
      let line='';lines++;
      for(const word of paragraph.split(/\s+/).filter(Boolean)){
        if(context.measureText(word).width>width){tooWide=true;break;}
        const next=line?`${line} ${word}`:word;
        if(line&&context.measureText(next).width>width){lines++;line=word;}else line=next;
      }
    }
    if(!tooWide&&lines*size*1.15<=height)return size;
  }
  return 12;
}
