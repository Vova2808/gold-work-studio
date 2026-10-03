import type { CSSProperties } from "react";
import {documentaryLayoutPreset} from '@gold-work/shared';

export function documentaryEase(value: number, curve: "smooth" | "dramatic" = "smooth") {
  const t = Math.max(0, Math.min(1, value));
  const power = curve === "dramatic" ? 5 : 3;
  return t < .5 ? (2 * t) ** power / 2 : 1 - (2 * (1 - t)) ** power / 2;
}

export function documentaryDesign(template: string, frame: number, duration: number, accent: string, motion?: { amountPercent: number; curve: "smooth" | "dramatic" }, media?: { width: number; height: number; canvasWidth: number; canvasHeight: number },captionColor?:string) {
  const enter = Math.max(0, Math.min(1, frame / 16));
  const eased = 1 - (1 - enter) ** 3, p = Math.max(0, Math.min(1, frame / Math.max(1, duration - 1)));
  const main: CSSProperties = {}, second: CSSProperties = {}, text: CSSProperties = {}, textBox: CSSProperties = {};
  let fit: "contain" | "cover" | undefined, backdrop = false, mediaTransform: string | undefined;
  const preset=documentaryLayoutPreset(template);
  if(preset){
    const box=(rect:readonly number[],delay=0):CSSProperties=>{
      const amount=1-documentaryEase(Math.max(0,(frame-delay)/22),motion?.curve);
      return {left:`${rect[0]}%`,top:`${rect[1]}%`,width:`${rect[2]}%`,height:`${rect[3]}%`,right:'auto',bottom:'auto',overflow:'hidden',
        transform:preset.enter==='rise'?`translateY(${amount*36}px)`:preset.enter==='slide'?`translateX(${amount*(delay?45:-45)}px)`:preset.enter==='settle'?`rotate(${amount*(delay?-2:2)}deg) scale(${1-amount*.04})`:undefined,
        clipPath:preset.enter==='wipe'?`inset(0 ${amount*100}% 0 0)`:preset.enter==='iris'?`inset(${amount*48}% ${amount*48}%)`:undefined,
        opacity:1-amount,boxSizing:'border-box',borderRadius:preset.decor==='glass'?18:0,border:preset.decor==='mat'?'8px solid #d5d8d5':preset.decor==='glass'?'2px solid #ffffff66':undefined};
    };
    Object.assign(main,box(preset.main));if(preset.second)Object.assign(second,box(preset.second,7));
    Object.assign(text,{left:`${preset.text[0]}%`,top:`${preset.text[1]}%`,width:`${preset.text[2]}%`,height:`${preset.text[3]}%`,right:'auto',bottom:'auto',padding:0,justifyContent:'center',alignItems:'stretch',
      transform:`translateY(${(1-eased)*22}px)`});
    const color=captionColor??(preset.paper?'#18232b':'#ffffff');
    const rgb=/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
    const bright=!rgb||(parseInt(rgb[1]!,16)*299+parseInt(rgb[2]!,16)*587+parseInt(rgb[3]!,16)*114)/1000>140;
    Object.assign(textBox,{fontWeight:800,maxWidth:'100%',padding:'12px 20px',color,overflowWrap:'normal',wordBreak:'normal',
      borderLeft:preset.decor==='rail'?`6px solid ${accent}`:'none',borderBottom:preset.decor==='lines'?`4px solid ${accent}`:undefined,
      borderRadius:preset.decor==='glass'?14:0,backgroundColor:bright?'#091219eE':'#faf7efeF',
      textTransform:preset.group==='chapter'?'uppercase':undefined,textAlign:preset.group==='chapter'?'center':'left',textShadow:preset.paper?'none':'0 2px 8px #0008',lineHeight:1.12});
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
  if (template === "contain") { fit = "contain"; backdrop = true; }
  const flow=documentaryEase(p,motion?.curve);
  if (template === "push") mediaTransform = `scale(${1+.1*flow})`;
  if (template === "pull") mediaTransform = `scale(${1.1-.1*flow})`;
  if (template === "pan-left" || template === "pan-right") mediaTransform = `translateX(${(template === "pan-left" ? 1 : -1)*(3-6*flow)}%) scale(1.08)`;
  if (template === "archive") card("3%", "3%", "94%", "94%", true);
  if (template === "archive-dark") card("3%", "3%", "94%", "94%");
  if (template === "gallery") { card("4%", "4%", "92%", "92%", true); main.transform = `translateY(${(1-eased)*20}px) rotate(${-.5+p}deg)`; }
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
    Object.assign(main, { filter: template === "chapter-focus" ? `blur(${(1 - documentaryEase(Math.min(1, p * 3))) * 16}px)` : undefined });
    Object.assign(text, { alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg,#0006,#0009,#0006)", padding: "8%" });
    Object.assign(textBox, { textAlign: "center", borderLeft: "none", backgroundColor: "transparent", padding: 0, maxWidth: "100%", fontWeight: 800,
      letterSpacing: `${.04 + (1 - eased) * .16}em`, textTransform: "uppercase", textShadow: "0 4px 28px #000a",
      transform: `translateY(${(1 - eased) * 35}px) scale(${.96 + eased * .04})`,
      clipPath: template === "chapter-wipe" ? `inset(0 ${(1 - eased) * 100}% 0 0)` : undefined });
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
