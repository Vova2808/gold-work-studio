import type { CSSProperties } from "react";
import {documentaryLayoutPreset} from '@gold-work/shared';
import type {DocumentaryTimeline,DocumentaryVisualCut} from './documentary-timeline.js';

export function documentaryEase(value: number, curve: "smooth" | "dramatic" = "smooth") {
  const t = Math.max(0, Math.min(1, value));
  const power = curve === "dramatic" ? 5 : 3;
  return t < .5 ? (2 * t) ** power / 2 : 1 - (2 * (1 - t)) ** power / 2;
}

/** Project a saved original-source focus into the actual contain/cover viewport.
 * It is a framing coordinate, never an inferred face or object identity. */
export function documentaryPhotoFocus(scene:DocumentaryTimeline['scenes'][number],cut:DocumentaryVisualCut|undefined,template:string,aspect:number,canvasAspect:number,fit:'contain'|'cover') {
  const doc=scene.documentary,point=scene.autoKenBurnsFocus;
  if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.x>100||point.y<0||point.y>100
    ||!Number.isFinite(aspect)||aspect<=0||!Number.isFinite(canvasAspect)||canvasAspect<=0
    ||cut||!scene.imagePath||scene.videoPath||!scene.motion||doc?.pinned||doc?.templateOrigin!=='automatic'
    ||doc?.templateMotion?.amountPercent===0||scene.kenBurnsDirection&&scene.kenBurnsDirection!=='auto'
    ||!['full','push','pull'].includes(template)||doc?.motionGraphic?.enabled&&['annotations','callout'].includes(doc.motionGraphic.kind))return;
  const sourceWidth=fit==='cover'?Math.max(canvasAspect,aspect):Math.min(canvasAspect,aspect),sourceHeight=sourceWidth/aspect;
  return {x:Math.max(0,Math.min(100,((canvasAspect-sourceWidth)/2+point.x/100*sourceWidth)/canvasAspect*100)),
    y:Math.max(0,Math.min(100,((1-sourceHeight)/2+point.y/100*sourceHeight)*100))};
}

/** Camera movement belongs to still photographs; footage keeps its own motion. */
export function documentaryPhotoTransform(scene:DocumentaryTimeline['scenes'][number],cut:DocumentaryVisualCut|undefined,frame:number) {
  const moving=!(cut?cut.videoPath:scene.videoPath)&&scene.kenBurnsDirection!=='off'&&scene.documentary?.templateMotion?.amountPercent!==0
    &&(cut?.motion?cut.motion!=='none':scene.motion);
  const progress=Math.max(0,Math.min(1,(cut?frame-cut.fromFrame:frame)/Math.max(1,(cut?.durationInFrames??scene.durationInFrames)-1)));
  const zoom=Math.max(1,Math.min(1.2,scene.kenBurnsZoom??scene.autoKenBurnsZoom??1.06));
  const direction=scene.kenBurnsDirection&&scene.kenBurnsDirection!=='auto'?scene.kenBurnsDirection:scene.autoKenBurnsDirection;
  const out=cut?.motion?cut.motion==='pull':direction==='out'||direction!=='in'&&scene.order%2!==0;
  const scale=moving?1+(zoom-1)*(out?1-documentaryEase(progress):documentaryEase(progress)):1;
  const transform=moving&&(direction==='pan-left'||direction==='pan-right')
    ?`translateX(${(direction==='pan-left'?1:-1)*(3-6*documentaryEase(progress))}%) scale(${Math.max(1.08,zoom)})`
    :moving&&(direction==='pan-up'||direction==='pan-down')
    ?`translateY(${(direction==='pan-up'?1:-1)*(3-6*documentaryEase(progress))}%) scale(${Math.max(1.08,zoom)})`:`scale(${scale})`;
  return {moving,direction,transform};
}

/** Honour an existing automatic photo shot without overriding authored layouts. */
export function documentaryPhotoCutTransform(scene:DocumentaryTimeline['scenes'][number],cut:DocumentaryVisualCut|undefined,frame:number,template:string) {
  const doc=scene.documentary;
  // Automatic contain chooses the fit, not a frozen camera. Reuse the already
  // permitted photo motion; authored templates, Motion0 and cut motion=none stay put.
  if(template==='contain'&&doc?.templateOrigin==='automatic'&&!doc.pinned&&scene.motion
    &&(cut?cut.imagePath:scene.imagePath)&&!(doc.motionGraphic?.enabled&&['annotations','callout'].includes(doc.motionGraphic.kind))){
    const photo=documentaryPhotoTransform(scene,cut,frame);
    if(photo.moving)return photo.transform;
  }
  // A semantic turning point reaches its framing, then holds the result.
  // This narrow standalone case shares the existing source/camera path; other
  // templates and explicit photo controls retain their own transforms.
  if(!cut&&template==='push'&&doc?.templateOrigin!=='manual'&&doc?.semanticMontage?.beat==='turn'
    &&!doc.pinned&&doc.cutsOrigin!=='manual'&&scene.imagePath&&!scene.videoPath&&scene.motion
    &&(!scene.kenBurnsDirection||scene.kenBurnsDirection==='auto')&&doc.templateMotion?.amountPercent!==0){
    const amount=Math.max(0,Math.min(40,doc.templateMotion?.amountPercent??10))/100;
    const progress=documentaryEase(frame/Math.max(1,(scene.durationInFrames-1)*.55),doc.templateMotion?.curve);
    return `scale(${1+amount*progress})`;
  }
  // Timeline strips semantic direction for manual/pinned scenes and retains
  // their ownership flags so additional camera guards stay explicit.
  if(template!=='full'||!doc?.semanticMontage||doc.pinned||doc.templateOrigin==='manual'||doc.cutsOrigin==='manual'
    ||!scene.motion||doc.templateMotion?.amountPercent===0||scene.kenBurnsDirection&&scene.kenBurnsDirection!=='auto'
    ||!cut?.imagePath||cut.videoPath||cut.motion!=='push'&&cut.motion!=='pull')return undefined;
  // A directed turn reaches its framing, then leaves a quiet reading hold.
  const travelFrames=Math.max(1,((cut.sequenceDurationFrames??cut.durationInFrames)-1)*(cut.sequenceDurationFrames?1:doc.semanticMontage.beat==='turn'?.55:1));
  const progress=documentaryEase((frame-cut.fromFrame+(cut.sequenceOffsetFrames??0))/travelFrames);
  const zoom=cut.sequenceDurationFrames||doc.semanticMontage.cutawayMode==='replace'?1.03:Math.max(1,Math.min(1.2,scene.kenBurnsZoom??scene.autoKenBurnsZoom??1.06));
  return `scale(${1+(zoom-1)*(cut.motion==='pull'?1-progress:progress)})`;
}

export function documentaryDesign(template: string, frame: number, duration: number, accent: string, motion?: { amountPercent: number; curve: "smooth" | "dramatic" }, media?: { width: number; height: number; canvasWidth: number; canvasHeight: number },captionColor?:string,enhanced=false) {
  const still=motion?.amountPercent===0;
  const enter = still?1:Math.max(0, Math.min(1, frame / 16));
  const eased = 1 - (1 - enter) ** 3, p = still?1:Math.max(0, Math.min(1, frame / Math.max(1, duration - 1)));
  const main: CSSProperties = {}, second: CSSProperties = {}, text: CSSProperties = {}, textBox: CSSProperties = {};
  let fit: "contain" | "cover" | undefined, backdrop = false, mediaTransform: string | undefined;
  const preset=documentaryLayoutPreset(template);
  if(preset){
    const box=(rect:readonly number[],delay=0):CSSProperties=>{
      const amount=still?0:1-documentaryEase(Math.max(0,(frame-delay)/22),motion?.curve);
      return {left:`${rect[0]}%`,top:`${rect[1]}%`,width:`${rect[2]}%`,height:`${rect[3]}%`,right:'auto',bottom:'auto',overflow:'hidden',
        transform:enhanced&&preset.enter==='slide'?`translateX(${amount*(delay?-60:60)}px)`:enhanced&&preset.enter==='settle'?`translateY(${amount*30}px) rotate(${amount*-2}deg)`:`translateY(${amount*12}px)`,opacity:1-amount,boxSizing:'border-box',borderRadius:2,
        border:enhanced&&preset.group==='photo'?`${preset.paper?14:4}px solid ${preset.paper?'#f7f2e7':'#d9e1e2'}`:preset.decor==='mat'||preset.decor==='glass'?'1px solid #ffffff25':undefined,
        boxShadow:enhanced&&preset.group==='photo'?'0 18px 45px #0006':undefined};
    };
    Object.assign(main,box(preset.main));if(preset.second)Object.assign(second,box(preset.second,7));
    Object.assign(text,{left:`${preset.text[0]}%`,top:`${preset.text[1]}%`,width:`${preset.text[2]}%`,height:`${preset.text[3]}%`,right:'auto',bottom:'auto',padding:0,justifyContent:'center',alignItems:'stretch',
      transform:`translateY(${(1-eased)*22}px)`});
    const color=captionColor??(preset.paper?'#18232b':'#ffffff');
    const rgb=/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
    const bright=!rgb||(parseInt(rgb[1]!,16)*299+parseInt(rgb[2]!,16)*587+parseInt(rgb[3]!,16)*114)/1000>140;
    Object.assign(textBox,{fontWeight:500,maxWidth:'100%',padding:'16px 22px',color,overflowWrap:'normal',wordBreak:'normal',
      borderLeft:'none',borderBottom:preset.decor==='lines'?`2px solid ${accent}`:undefined,
      borderRadius:3,backgroundColor:bright?'#10161ce8':'#f1f0ebef',
      textAlign:preset.group==='chapter'?'center':'left',textShadow:'none',lineHeight:1.2});
    const camera=preset.group==='chapter'?`scale(${1+Math.max(0,Math.min(40,motion?.amountPercent??18))/100*.4*documentaryEase(p,motion?.curve)})`:undefined;
    return {main,second,text,textBox,fit:'contain' as const,backdrop:false,mediaTransform:camera};
  }
  const card = (left: string, top: string, width: string, height: string, light = false) => {
    Object.assign(main, { left, top, width, height, right: "auto", bottom: "auto", overflow: "hidden", border: `${light ? 16 : 3}px solid ${light ? "#e8e4d9" : "#ffffff40"}`, boxSizing: "border-box", borderRadius: 10, boxShadow: "0 18px 60px #0009", transform: `translateY(${(1-eased)*35}px)` });
    // The border must hug the photograph, not a second fixed-aspect container.
    // Contain inside the old oversized card exposed background as an inner
    // frame; zoom made those strips change width during playback.
    if (media && media.width > 0 && media.height > 0 && !template.startsWith("compare-")) {
      const border = (light ? 16 : 3) * 2;
      const boxWidth = parseFloat(width) / 100 * media.canvasWidth, boxHeight = parseFloat(height) / 100 * media.canvasHeight;
      const scale = Math.min((boxWidth - border) / media.width, (boxHeight - border) / media.height);
      const fittedWidth = media.width * scale + border, fittedHeight = media.height * scale + border;
      Object.assign(main, { width: fittedWidth, height: fittedHeight,
        left: parseFloat(left) / 100 * media.canvasWidth + (boxWidth - fittedWidth) / 2,
        top: parseFloat(top) / 100 * media.canvasHeight + (boxHeight - fittedHeight) / 2 });
    }
    fit = "contain"; backdrop = true;
  };
  if (template === "full" || template === "contain") mediaTransform='scale(1)';
  if (template === "contain") { fit = "contain"; backdrop = true; }
  const flow=documentaryEase(p,motion?.curve);
  const amount=Math.max(0,Math.min(40,motion?.amountPercent??10))/100;
  if (template === "push") mediaTransform = `scale(${1+amount*flow})`;
  if (template === "pull") mediaTransform = `scale(${1+amount*(1-flow)})`;
  if (template === "pan-left" || template === "pan-right") mediaTransform = `translateX(${(template === "pan-left" ? 1 : -1)*amount*30*(1-2*flow)}%) scale(${1+amount*.8})`;
  if (template === "archive") {card(enhanced?"10%":"3%",enhanced?"8%":"3%",enhanced?"80%":"94%",enhanced?"84%":"94%",true);if(enhanced)main.transform=`translateY(${(1-eased)*36}px) rotate(${-1.2-(1-eased)*1.4}deg)`;}
  if (template === "archive-dark") card(enhanced?"8%":"3%",enhanced?"9%":"3%",enhanced?"84%":"94%",enhanced?"82%":"94%");
  if (template === "gallery") { card(enhanced?"12%":"4%",enhanced?"10%":"4%",enhanced?"76%":"92%",enhanced?"80%":"92%",true); main.transform = enhanced?`translateY(${(1-eased)*36}px) rotate(${1.2+(1-eased)*2}deg)`:`translateY(${(1-eased)*20}px) rotate(${-.5+p}deg)`;if(enhanced)main.boxShadow='18px 17px 0 -7px #c9c5b9,-14px -10px 0 -7px #eee9dc,0 24px 55px #0008'; }
  if (template === "inset-left") card("5%", "9%", "69%", "82%");
  if (template === "inset-right") card("26%", "9%", "69%", "82%");
  if (template === "editorial-left" || template === "editorial-right") {
    const left = template === "editorial-left";
    card(left ? "43%" : "4%", "8%", "53%", "84%");
    Object.assign(text, { left: left ? "3%" : "61%", width: "36%", padding: "3%", justifyContent: "center" });
    Object.assign(textBox, { maxWidth: "100%", backgroundColor: "transparent", borderLeft: "none", borderTop: `4px solid ${accent}`, padding: "22px 0", fontSize: "2.5em" });
  }
  if (template === "chapter" || template === "chapter-line") {
    Object.assign(text, { alignItems: "center", justifyContent: "center", background: template === "chapter" ? "#0008" : "linear-gradient(90deg,#000a,transparent)" });
    Object.assign(textBox, { textAlign: "center", borderLeft: "none", backgroundColor: "transparent", fontSize: "3.4em", borderBottom: template === "chapter-line" ? `5px solid ${accent}` : undefined, letterSpacing: 2 });
  }
  const chapterMotion = ["chapter-push", "chapter-pull", "chapter-breathe", "chapter-focus", "chapter-wipe"].includes(template);
  if (chapterMotion) {
    const amount = Math.max(0, Math.min(40, motion?.amountPercent ?? 18)) / 100;
    const flow = documentaryEase(p, motion?.curve);
    const breathe = p < .42 ? documentaryEase(p / .42, motion?.curve) : p > .58 ? 1 - documentaryEase((p - .58) / .42, motion?.curve) : 1;
    const zoom = template === "chapter-pull" ? 1 - flow : template === "chapter-breathe" ? breathe : flow;
    mediaTransform = `scale(${1 + amount * zoom})`;
    Object.assign(text, { alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg,#0006,#0009,#0006)", padding: "8%" });
    Object.assign(textBox, { textAlign: "center", borderLeft: "none", backgroundColor: "transparent", padding: 0, maxWidth: "100%", fontWeight: 800,
      letterSpacing: `${.04 + (1 - eased) * .16}em`, textTransform: "uppercase", textShadow: "0 4px 28px #000a",
      transform: `translateY(${(1 - eased) * 35}px) scale(${.96 + eased * .04})`,
      opacity:eased });
  }
  if (template === "fact") { Object.assign(text, { justifyContent: "flex-end", padding: "5%" }); Object.assign(textBox, { borderRadius: 10, borderLeft: "none", borderBottom: `4px solid ${accent}`, transform: `translateX(${(1-eased)*-60}px)` }); }
  if (template === "fact-large") { Object.assign(text, { justifyContent: "flex-end", padding: "7%", background: "linear-gradient(0deg,#000b,transparent 65%)" }); Object.assign(textBox, { fontSize: "3.5em", backgroundColor: "transparent", borderLeft: "none", padding: 0, textShadow: "0 3px 16px #000" }); }
  if (template.startsWith("compare-")) {
    fit = "contain"; backdrop = true;
    Object.assign(main, { width: "49%", right: "auto" }); Object.assign(second, { width: "49%", left: "51%" });
    if (template === "compare-cards") {
      card("3%", "17%", "45%", "71%");
      Object.assign(second, { ...main, left: "52%", transform: `translateY(${(1-eased)*-35}px)` });
    }
    if (template === "compare-stack") {
      Object.assign(main, { left: "8%", top: "3%", width: "84%", height: "45%", right: "auto", bottom: "auto" });
      Object.assign(second, { left: "8%", top: "52%", width: "84%", height: "45%", right: "auto", bottom: "auto" });
    }
  }
  return { main, second, text, textBox, fit, backdrop, mediaTransform };
}
