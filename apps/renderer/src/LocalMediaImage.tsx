import {useEffect,useRef,useState,type ImgHTMLAttributes} from 'react';

/** Lazy loading alone retains every decoded original after scrolling. Release
 * offscreen tiles and ask the media protocol for a bounded preview instead. */
export function LocalMediaImage({src,widthHint=640,...props}:ImgHTMLAttributes<HTMLImageElement>&{widthHint?:240|640|1280}) {
  const ref=useRef<HTMLImageElement>(null),[visible,setVisible]=useState(false);
  useEffect(()=>{
    const observer=new IntersectionObserver(([entry])=>setVisible(Boolean(entry?.isIntersecting)),{rootMargin:'300px'});
    if(ref.current)observer.observe(ref.current);
    return()=>observer.disconnect();
  },[]);
  const preview=src?.startsWith('gw-media:')?`${src}${src.includes('?')?'&':'?'}thumbnail=${widthHint}`:src;
  return <img {...props} ref={ref} src={visible?preview:undefined} loading="lazy" decoding="async"/>;
}
