import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {DocumentaryArtwork,DocumentaryArtworkLayer,DocumentarySemanticMontage,DocumentarySceneDirection,Project,Scene} from '@gold-work/shared';
import {documentaryAiPlanContext} from '@gold-work/shared';
import {artworkMediaFraming} from '../../../packages/remotion-video/src/documentary-artwork-media.js';
import {sliderCrankBounds,sliderCrankPose} from '../../../packages/remotion-video/src/documentary-linked-mechanism.js';
import {atomicWrite} from './fs-utils.js';
import {parseDocumentaryJson} from './documentary-json.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {AnyModelModelUnavailableError} from './anymodel-text-fallback.js';
import {semanticMontageHash,montageFrames,documentaryMontageHasEvidence,DocumentarySemanticMontageError} from './documentary-semantic-montage.js';
import {documentaryExplanationEditable} from './documentary-explanation.js';
import {motionArtworkSystem,sparseMotionArtworkDirection} from './documentary-artwork-direction.js';
import {artworkSourceCandidates,motionArtworkPreviews} from './documentary-artwork-previews.js';
import {assessArtworkReplacement} from './documentary-artwork-quality.js';
import {artworkForRevision,preserveArtworkManualLayers,motionArtworkRevisionSystem,validateArtworkRevisionPreviews,type ArtworkRevisionHooks} from './documentary-artwork-revision.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {normalizeArtworkGroupCoordinates} from './documentary-artwork-coordinates.js';
import {prepareArtworkLabels} from './documentary-artwork-labels.js';
import {normalizeArtworkPathBounds} from './documentary-artwork-path-bounds.js';
import {reviewArtworkTemporal} from './documentary-artwork-temporal-review.js';
import {createArtworkFeedbackPlan,readActiveArtworkFeedback,type ArtworkFeedbackInput} from './documentary-artwork-feedback.js';
export {motionArtworkSystem} from './documentary-artwork-direction.js';

const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const numberOr=(v:unknown,fallback:number)=>finite(v)?v:fallback;
const normalized=(s:string)=>s.toLocaleLowerCase().replace(/\s+/gu,' ').trim();
/** A rectangular SVG caption surface has the same annotation meaning as rect.
 * Inspect actual straight edges, including relative/implicit line notation;
 * multiple subpaths and other pictured geometry keep their original kind. */
function artworkAnnotationShape(layer:DocumentaryArtworkLayer):DocumentaryArtworkLayer {
  if(layer.kind!=='path'||!layer.path)return layer;
  const tokens=layer.path.match(/[a-z]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?/giu)??[];
  let i=0,x=0,y=0,command='',closed=false;
  const points:Array<[number,number]>=[];
  while(i<tokens.length){
    if(/^[a-z]$/iu.test(tokens[i]!))command=tokens[i++]!;
    const op=command.toUpperCase(),relative=command!==op;
    if(op==='Z'){closed=true;break;}
    if(!['M','L','H','V'].includes(op)||op==='M'&&points.length)return layer;
    const count=op==='H'||op==='V'?1:2,values=tokens.slice(i,i+count).map(Number);
    if(values.length!==count||!values.every(Number.isFinite)||!points.length&&op!=='M')return layer;
    i+=count;
    if(op==='H')x=values[0]!+(relative?x:0);
    else if(op==='V')y=values[0]!+(relative?y:0);
    else {x=values[0]!+(relative?x:0);y=values[1]!+(relative?y:0);}
    points.push([x,y]);if(op==='M')command=relative?'l':'L';
  }
  if(i!==tokens.length||points.length<4)return layer;
  const same=(a:number,b:number)=>Math.abs(a-b)<1e-7;
  if(!closed&&!(same(x,points[0]![0])&&same(y,points[0]![1])))return layer;
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
  if(right<=left||bottom<=top)return layer;
  const edges=points.every(([x,y],at)=>{
    const [nextX,nextY]=points[(at+1)%points.length]!;
    return same(x,nextX)&&(same(x,left)||same(x,right))||same(y,nextY)&&(same(y,top)||same(y,bottom));
  });
  if(!edges||![left,right].every(x=>[top,bottom].every(y=>points.some(p=>same(p[0],x)&&same(p[1],y)))))return layer;
  return {...layer,kind:'rect',x:layer.x+left,y:layer.y+top,w:right-left,h:bottom-top};
}
function captionGrounded(text:string,context:string):boolean {
  const canonical=(s:string)=>normalized(s.replace(/(\p{L})[-–](?=\p{L})/gu,'$1 ')
    .replace(/°/gu,' degrees ').replace(/\bdegrees?\b/giu,'degree')
    .replace(/(?<!\d)[.,]|[.,](?!\d)|[!?;:()[\]{}"“”]/gu,' '));
  const source=` ${canonical(context)} `,label=canonical(text);
  if(source.includes(` ${label} `))return true;
  // Require a unit/noun; bare "3" must not be inferred from "three hundred".
  if(!/\d/u.test(label)||!/[a-z]/iu.test(label))return false;
  const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  const spoken=label.replace(/(?<![\d.])\d{1,2}(?![\d.])/gu,digits=>{
    const n=Number(digits);return n<20?small[n]!:tens[Math.floor(n/10)]!+(n%10?' '+small[n%10]:'');
  });
  return source.includes(` ${spoken} `);
}
const colors=new Set(['ink','accent','secondary','background','none']);
const color=(v:unknown)=>typeof v==='string'&&(colors.has(v)||/^#[\da-f]{6}$/iu.test(v))?v:undefined;
/** Separate property tracks may meet at one instant if their values agree. */
function coalesceArtworkKeyframes(frames:DocumentaryArtworkLayer['keyframes']):DocumentaryArtworkLayer['keyframes']{
  if(!Array.isArray(frames))return frames;
  const merged:NonNullable<DocumentaryArtworkLayer['keyframes']>=[];
  for(const frame of frames){
    if(!frame||typeof frame!=='object'||Array.isArray(frame))return frames;
    const previous=merged.at(-1);
    if(previous&&previous.t===frame.t){
      if(Object.keys(frame).some(key=>key!=='t'&&Object.hasOwn(previous,key)
        &&(previous as unknown as Record<string,unknown>)[key] !== (frame as unknown as Record<string,unknown>)[key]))return frames;
      merged[merged.length-1]={...previous,...frame};
    }else merged.push({...frame});
  }
  return merged;
}
/** Keep a readable resolved state even when the designer puts its last reveal at t=.9. */
export function settleArtworkKeys<T extends {t:number}>(keys:T[]|undefined):T[]|undefined {
  if(!keys?.length)return keys;
  const changed=(a:T,b:T)=>JSON.stringify({...a,t:0,ease:undefined})!==JSON.stringify({...b,t:0,ease:undefined});
  const lastChange=keys.reduce((last,key,i)=>i&&changed(keys[i-1]!,key)?key.t:last,0);
  if(lastChange<=.76)return keys;
  const factor=.76/lastChange;
  const settled=keys.map(key=>({...key,t:key.t*factor}));
  if(settled.at(-1)!.t<1)settled.push({...settled.at(-1)!,t:1});
  return settled;
}
/** Recover one observed transport typo in a fully received drawing, never a partial answer. */
export function receivedMotionArtwork(raw:string):Record<string,unknown>|undefined {
  const repaired=raw.replace(/("(?:strokeWidth|fontSize|weight|radius|repeat|x|y|w|h|t|rotation|scale|opacity|draw)"\s*:\s*-?\d+(?:\.\d+)?)"(?=\s*[,}])/gu,'$1');
  const parsed=parseDocumentaryJson(repaired)?.result;
  return parsed&&Array.isArray(parsed.scenes)&&parsed.scenes.every(row=>row&&typeof row==='object'&&'artwork' in row)?parsed:undefined;
}
export function artworkEnabled(project:Project):boolean {
  const settings=project.settings.assembly.documentary;
  return settings?.autoMotionGraphics!==false&&settings?.montage?.style==='editorial'&&settings.montage.intensity==='rich';
}
export function artworkSceneEditable(scene:Scene):boolean {
  const d=scene.documentary;
  if(d?.motionGraphic?.routeComparison)return false;
  return Boolean(d&&scene.includeInAssembly!==false&&!d.pinned&&(!d.template||d.templateOrigin==='automatic')
    &&(!d.motionGraphic||d.motionGraphic.origin==='automatic')&&!d.caption.enabled&&!d.texts?.length
    &&!(d.layout==='compare'&&d.comparison)&&(!d.cuts?.length||d.cutsOrigin==='automatic'));
}
export function motionArtworkHash(project:Project):string {
  return createHash('sha256').update(JSON.stringify({version:2,semantic:semanticMontageHash(project),aspect:project.aspectRatio,
    eligible:project.scenes.map(s=>[s.id,artworkSceneEditable(s)])})).digest('hex');
}

/** Only drawing data is accepted. The renderer never runs model-authored JS/HTML. */
export function validateMotionArtwork(value:unknown,context:string,seconds:number,hasSource=true,outputAspect=16/9,
  source?:{width?:number;height?:number;contain?:boolean;mediaAllowed?:boolean;currentSceneId?:string;
    allowedSources?:Array<{sceneId:string;kind:'image'|'video';width?:number;height?:number;
      variants?:Array<{name:'original'|'foreground';status:'actual'|'on-request'}>}>},preserveSpanTiming=false):{artwork?:DocumentaryArtwork;issue?:string} {
  const fail=(issue:string)=>({issue});
  if(!value||typeof value!=='object')return fail('missing artwork');
  const v=normalizeArtworkPathBounds(normalizeArtworkGroupCoordinates(value)) as DocumentaryArtwork;
  if(!['full','left','right','overlay'].includes(v.layout)||!finite(v.canvas?.width)||!finite(v.canvas?.height)
    ||v.canvas.width<400||v.canvas.width>2000||v.canvas.height<400||v.canvas.height>2000)return fail('invalid canvas');
  if(!Array.isArray(v.layers)||v.layers.length<3||v.layers.length>96)return fail('expected 3–96 layers');
  if(source?.mediaAllowed===false&&(v.layout!=='full'||v.layers.some(layer=>layer?.kind==='media')))
    return fail('standalone explanation must use a full drawing without photographic measurements');
  const palette=v.palette?{...v.palette}:undefined;
  if(palette?.background==='none'){
    const ink=typeof palette.ink==='string'?palette.ink.replace('#',''):'';
    const light=/^[\da-f]{6}$/iu.test(ink)&&(parseInt(ink.slice(0,2),16)+parseInt(ink.slice(2,4),16)+parseInt(ink.slice(4,6),16))/3>128;
    palette.background=light?'#191b20':'#f5f1ed';
  }
  if(!palette||[palette.background,palette.ink,palette.accent,palette.secondary].some(c=>typeof c!=='string'||!/^#[\da-f]{6}$/iu.test(c)))return fail('invalid palette');
  const layers:DocumentaryArtworkLayer[]=[],ids=new Set<string>();
  const mediaLayers=v.layers.filter(layer=>layer?.kind==='media');
  // Match the renderer's authored viewport branch; the legacy single footage
  // layer still keeps its original framing/near-1 scale protection.
  const authoredViewports=mediaLayers.length>1||mediaLayers.some(layer=>layer.sourceSceneId||layer.sourceVariant||layer.sourceWindow||layer.clip);
  if(mediaLayers.length>3)return fail('too many source media viewports');
  if(mediaLayers.length&&!mediaLayers.some(layer=>finite(layer.w)&&finite(layer.h)
    &&layer.w*layer.h>=v.canvas.width*v.canvas.height*.35))return fail('source media must include one large root viewport');
  const usedSources=new Set<string>();let videoLayers=0;
  for(const candidate of v.layers){
    const l=candidate;
    if(!l||!['path','rect','ellipse','text','group','media'].includes(l.kind)||typeof l.id!=='string'||!l.id||l.id.length>50||ids.has(l.id)
      ||![l.x,l.y,l.w,l.h].every(finite)||l.w<=0||l.h<=0||l.x<0||l.y<0||l.x+l.w>v.canvas.width+1||l.y+l.h>v.canvas.height+1)return fail('invalid layer bounds/id');
    ids.add(l.id);
    if(l.depth!==undefined&&(!finite(l.depth)||l.depth < -1||l.depth > 1))return fail('invalid relative depth');
    if(l.kind==='media'&&l.depth)return fail('media parallax requires native whole-source staging');
    if(l.editTransform&&(![l.editTransform.x,l.editTransform.y,l.editTransform.rotation,l.editTransform.scale].every(finite)||l.editTransform.scale<=0))return fail('invalid manual transform');
    if(l.framingBeforeEdit&&(l.framingBeforeEdit.stroke!==undefined&&!color(l.framingBeforeEdit.stroke)
      ||l.framingBeforeEdit.strokeWidth!==undefined&&(!finite(l.framingBeforeEdit.strokeWidth)||l.framingBeforeEdit.strokeWidth<0)))return fail('invalid manual framing');
    if(l.kind!=='media'&&['sourceSceneId','sourceVariant','sourceWindow','clip'].some(field=>Object.hasOwn(l,field)))
      return fail('source fields require a media viewport');
    if(l.kind==='media'){
      if(!hasSource||v.layout!=='full'||l.parentId||l.w*l.h<v.canvas.width*v.canvas.height*.04)
        return fail('source media must be one large root layer in a full composition');
      const id=l.sourceSceneId??source?.currentSceneId;
      const allowed=id?source?.allowedSources?.find(item=>item.sceneId===id):undefined;
      if(Object.hasOwn(l,'sourceSceneId')&&(typeof l.sourceSceneId!=='string'||!l.sourceSceneId))
        return fail('invalid selected source id');
      if(l.sourceSceneId&&(!allowed||!source?.currentSceneId))return fail('media source is outside selected allowlist');
      if(source?.currentSceneId&&!allowed)return fail('media source is outside selected allowlist');
      if(id)usedSources.add(id);
      if(usedSources.size>2)return fail('too many selected media sources');
      if(l.sourceVariant!==undefined&&!['original','foreground'].includes(l.sourceVariant)
        ||l.clip!==undefined&&!['rect','ellipse'].includes(l.clip))return fail('invalid media variant or clip');
      const kind=allowed?.kind;
      if(kind==='video'){
        videoLayers++;
        if(videoLayers>1||id!==source?.currentSceneId||l.sourceVariant==='foreground'||l.sourceWindow||l.clip==='ellipse')
          return fail('video media requires one current original viewport');
      }
      if(l.sourceVariant==='foreground'&&(kind!=='image'
        ||!allowed?.variants?.some(variant=>variant.name==='foreground')))
        return fail('foreground requires a verified selected still image');
      if(Object.hasOwn(l,'sourceWindow')&&(!l.sourceWindow||typeof l.sourceWindow!=='object'))
        return fail('invalid detail window');
      if(l.sourceWindow){
        const w=l.sourceWindow;
        if(kind!=='image'||l.sourceVariant==='foreground'||![w.x,w.y,w.w,w.h].every(finite)
          ||w.x<0||w.y<0||w.w<.05||w.h<.05||w.x+w.w>1+1e-6||w.y+w.h>1+1e-6)
          return fail('detail window must be inside an original still image');
      }
      if(['path','url','file','actualVariant','sourceIdentity','fallbackReason'].some(field=>Object.hasOwn(l,field)))
        return fail('media asset paths and prepared state are not model-authored');
    }
    const chosen=l.kind==='media'?(l.sourceSceneId?source?.allowedSources?.find(item=>item.sceneId===l.sourceSceneId):undefined):undefined;
    const sourceAspect=(chosen?.width??source?.width)&&(chosen?.height??source?.height)
      ?(chosen?.width??source!.width)!/(chosen?.height??source!.height)!:undefined;
    const contained=source?.contain||sourceAspect!==undefined&&(sourceAspect<outputAspect*.88||sourceAspect/outputAspect>1.3);
    // Repair the existing large frame locally; a narrow photograph must not
    // discard paid graphics simply because 40% is impossible without cropping.
    const mediaBox=l.kind==='media'&&!authoredViewports
      ?artworkMediaFraming(l,v.canvas,outputAspect,sourceAspect,contained?'contain':'cover').box:undefined;
    const bounds=mediaBox??l;
    if(l.kind==='path'&&(typeof l.path!=='string'||l.path.length>3200||!/^\s*[Mm][MmZzLlHhVvCcSsQqTtAaEe\d\s.,+\-]+$/u.test(l.path)))return fail('invalid drawing path');
    // Omit an ungrounded caption, not the otherwise useful drawing. No rewritten facts.
    if(l.kind==='text'&&(typeof l.text!=='string'||!l.text.trim()||l.text.length>100||!captionGrounded(l.text,context)))continue;
    const frames=coalesceArtworkKeyframes(l.keyframes);
    if(frames&&(!Array.isArray(frames)||frames.length>12||frames.some((f,i)=>!f||!finite(f.t)||f.t<0||f.t>1||i>0&&f.t<=frames[i-1]!.t
      ||[f.x,f.y,f.scale,f.rotation,f.opacity,f.draw].some(n=>n!==undefined&&!finite(n)))))return fail('invalid motion keyframes');
    const absolute=(axis:'x'|'y')=>v.motionCoordinates==='absolute'||v.motionCoordinates!=='relative'&&l[axis]!==0&&frames?.some(f=>f[axis]===l[axis]);
    const offset=(axis:'x'|'y',n:number)=>n-(absolute(axis)?l[axis]:0);
    let mediaScale=1,mediaRotation=0;
    const normalizedFrames=frames?.map(f=>{
      const authoredMedia=l.kind==='media'&&authoredViewports;
      if(f.scale!==undefined)mediaScale=clamp(f.scale,authoredMedia?0:l.kind==='media'?.95:0,1.5);
      if(f.rotation!==undefined)mediaRotation=clamp(f.rotation,-720,720);
      const position=(axis:'x'|'y',value:number)=>{
        const n=offset(axis,value),limit=axis==='x'?v.canvas.width:v.canvas.height;
        if(l.kind==='group')return clamp(n,-limit,limit);
        if(authoredMedia){
          // DSL scale/rotation act about the UNCHANGED box centre. Constraining
          // an unscaled top-left here shifts a correctly aligned small detail.
          const angle=mediaRotation*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
          const half=mediaScale*(axis==='x'?c*l.w+s*l.h:s*l.w+c*l.h)/2;
          const centre=axis==='x'?l.x+l.w/2:l.y+l.h/2;
          return half*2<=limit?clamp(n,half-centre,limit-half-centre):clamp(n,-limit,limit);
        }
        return axis==='x'?clamp(n,-bounds.x,v.canvas.width-bounds.x-bounds.w)
          :clamp(n,-bounds.y,v.canvas.height-bounds.y-bounds.h);
      };
      return {t:f.t,...(['linear','out','inOut'].includes(f.ease??'')?{ease:f.ease}:{}),
        ...(f.x!==undefined?{x:position('x',f.x)}:{}),...(f.y!==undefined?{y:position('y',f.y)}:{}),
        ...(f.scale!==undefined?{scale:mediaScale}:{}),...(f.rotation!==undefined?{rotation:mediaRotation}:{}),
        ...(f.opacity!==undefined?{opacity:clamp(f.opacity,0,1)}:{}),...(f.draw!==undefined?{draw:clamp(f.draw,0,1)}:{})};
    });
    layers.push({id:l.id,kind:l.kind,x:l.x,y:l.y,w:l.w,h:l.h,...mediaBox,
      ...(l.depth!==undefined?{depth:l.depth}:{}),
      ...(l.editTransform?{editTransform:{...l.editTransform}}:{}),
      ...(l.fillOrigin==='manual'?{fillOrigin:'manual' as const}:{}),
      ...(l.framingBeforeEdit?{framingBeforeEdit:{...l.framingBeforeEdit}}:{}),
      ...(typeof l.parentId==='string'?{parentId:l.parentId}:{}),
      ...(l.shading==='soft'?{shading:'soft' as const}:{}),...(l.shadow===true?{shadow:true}:{}),
      ...(l.kind==='media'&&l.sourceSceneId?{sourceSceneId:l.sourceSceneId}:{}),
      ...(l.kind==='media'&&l.sourceVariant?{sourceVariant:l.sourceVariant}:{}),
      ...(l.kind==='media'&&l.sourceWindow?{sourceWindow:{...l.sourceWindow}}:{}),
      ...(l.kind==='media'&&l.clip?{clip:l.clip}:{}),
      ...(l.kind==='path'?{path:l.path}:{}),...(l.kind==='text'?{text:l.text!.trim(),fontSize:clamp(numberOr(l.fontSize,48),24,160),weight:clamp(numberOr(l.weight,500),400,900),align:['left','center','right'].includes(l.align??'')?l.align:'left' as const}:{}),
      ...(color(l.fill)?{fill:color(l.fill)}:{}),...(color(l.stroke)?{stroke:color(l.stroke)}:{}),strokeWidth:clamp(numberOr(l.strokeWidth,2),0,12),radius:clamp(numberOr(l.radius,0),0,60),
      repeat:Math.round(clamp(numberOr(l.repeat,1),1,8)),...(normalizedFrames?{keyframes:normalizedFrames}:{})});
  }
  // Previously validated manual artwork must not reflow its labels or peers
  // when it passes through revision validation again.
  if(!layers.some(l=>l.editTransform||l.fillOrigin==='manual'||l.framingBeforeEdit))
    layers.splice(0,layers.length,...prepareArtworkLabels(v,layers));
  const byId=new Map(layers.map(l=>[l.id,l]));
  for(const l of layers){
    const seen=new Set([l.id]);let parentId=l.parentId;
    while(parentId){
      const parent=byId.get(parentId);
      if(!parent||parent.kind!=='group'||seen.has(parentId)||seen.size>3)return fail('invalid or cyclic object group');
      seen.add(parentId);parentId=parent.parentId;
    }
  }
  const actions:NonNullable<DocumentaryArtwork['actions']>=[];
  if(v.actions!==undefined){
    if(!Array.isArray(v.actions)||v.actions.length>12)return fail('invalid object actions');
    const actionIds=new Map<string,typeof actions[number]>(),fields=['x','y','rotation','scale','opacity','draw'] as const;
    for(const a of v.actions){
      const layer=byId.get(a?.layerId),after=a?.after?actionIds.get(a.after):undefined;
      if(!a||typeof a.id!=='string'||!a.id||a.id.length>50||actionIds.has(a.id)||!layer||layer.kind==='media'
        ||(layer.repeat??1)>1||!finite(a.start)||!finite(a.end)||a.start<0||a.end>1||a.end<=a.start
        ||a.after!==undefined&&(!after||after.end>a.start)||!a.from||!a.to
        ||Object.keys(a.from).some(name=>!fields.includes(name as typeof fields[number]))||Object.keys(a.to).some(name=>!fields.includes(name as typeof fields[number]))
        ||a.ease!==undefined&&!['linear','out','inOut'].includes(a.ease)
        ||a.sound!==undefined&&!['click','transition'].includes(a.sound))return fail('invalid causal object action');
      const from:typeof a.from={},to:typeof a.to={};let count=0;
      for(const field of fields){
        const f=a.from[field],t=a.to[field];if(f===undefined&&t===undefined)continue;
        if(!finite(f)||!finite(t)||layer.keyframes?.some(key=>key[field]!==undefined))return fail('action conflicts with authored keys');
        const limit=field==='x'?v.canvas.width:field==='y'?v.canvas.height:field==='rotation'?720:field==='scale'?1.5:1;
        const origin=(field==='x'||field==='y')&&v.motionCoordinates!=='relative'?layer[field]:0;
        if(Math.abs(f-origin)>limit||Math.abs(t-origin)>limit||['scale','opacity','draw'].includes(field)&&(f<0||t<0))return fail('object action outside bounds');
        from[field]=f-origin;to[field]=t-origin;count++;
        const previous=actions.filter(action=>action.layerId===a.layerId&&action.to[field]!==undefined).at(-1);
        if(previous&&(previous.end>a.start||previous.to[field]!==from[field]))return fail('object action breaks state continuity');
      }
      if(!count)return fail('empty object action');
      const action={id:a.id,layerId:a.layerId,start:a.start,end:a.end,from,to,
        ...(a.after?{after:a.after}:{}),...(a.ease?{ease:a.ease}:{}),...(a.sound?{sound:a.sound}:{})};
      actionIds.set(a.id,action);actions.push(action);
    }
  }
  if(!preserveSpanTiming&&!actions.length)for(const layer of layers)if(layer.keyframes&&(layer.repeat??1)===1&&!layer.editTransform&&!layer.fillOrigin&&!layer.framingBeforeEdit)layer.keyframes=settleArtworkKeys(layer.keyframes);
  // One compound path may picture many objects. Count subject geometry with
  // the existing annotation policy, rather than requiring three SVG layers.
  if(!v.linkedMechanism&&!layers.some(l=>l.kind==='media')&&!assessArtworkReplacement({...v,layers:layers.map(artworkAnnotationShape)} as DocumentaryArtwork).allowReplacement)return fail('text-only composition');
  const startSeconds=clamp(finite(v.startSeconds)?v.startSeconds:0,0,Math.max(0,seconds-2.4));
  const durationSeconds=clamp(finite(v.durationSeconds)?v.durationSeconds:seconds-startSeconds,Math.min(2.4,seconds-startSeconds),seconds-startSeconds);
  const camera=v.camera;
  if(camera&&(camera.path!==undefined&&camera.path!=='continuous'||!Array.isArray(camera.keyframes)||camera.keyframes.length<2||camera.keyframes.length>6||camera.keyframes.some((k,i)=>
    !k||![k.t,k.x,k.y,k.scale].every(finite)||k.t<0||k.t>1||i>0&&k.t<=camera.keyframes[i-1]!.t
    ||camera.path!=='continuous'&&(k.rotation!==undefined||k.velocity!==undefined)
    ||k.rotation!==undefined&&(!finite(k.rotation)||Math.abs(k.rotation)>20)
    ||k.velocity!==undefined&&(!k.velocity||typeof k.velocity!=='object'||Object.entries(k.velocity).some(([name,n])=>
      !['x','y','scale','rotation'].includes(name)||!finite(n)||Math.abs(n)>(name==='x'?v.canvas.width*2:name==='y'?v.canvas.height*2:name==='rotation'?80:4))))))return fail('invalid camera');
  if(camera?.path==='continuous'&&mediaLayers.some(l=>!authoredViewports))return fail('continuous camera requires authored media viewport');
  const cameraKeys=camera?.keyframes.map(k=>{
    if(camera.path==='continuous')return {t:k.t,scale:clamp(k.scale,.65,2.4),x:clamp(k.x,0,v.canvas.width),y:clamp(k.y,0,v.canvas.height),
      ...(k.rotation!==undefined?{rotation:k.rotation}:{}),...(k.velocity?{velocity:{...k.velocity}}:{})};
    const scale=clamp(k.scale,1,1.18),halfW=v.canvas.width/(2*scale),halfH=v.canvas.height/(2*scale);
    return {t:k.t,scale,x:clamp(k.x,halfW,v.canvas.width-halfW),y:clamp(k.y,halfH,v.canvas.height-halfH)};
  });
  const mechanism=v.linkedMechanism;
  if(mechanism){
    const m=mechanism;
    if(m.kind!=='slider-crank'||![m.centerX,m.centerY,m.crankRadius,m.rodLength,m.pistonWidth,m.pistonHeight].every(finite)
      ||m.crankRadius<20||m.rodLength<=m.crankRadius+20||m.pistonWidth<40||m.pistonHeight<30
      ||m.startAngle!==undefined&&!finite(m.startAngle)||m.turns!==undefined&&(!finite(m.turns)||m.turns<0||m.turns>4)
      ||m.annotations!==undefined&&(!m.annotations||typeof m.annotations!=='object'
        ||[m.annotations.reciprocatingForce,m.annotations.crankTorque].some(value=>value!==undefined&&typeof value!=='boolean')
        ||[m.annotations.forceAt,m.annotations.torqueAt].some(value=>value!==undefined&&(!finite(value)||value<0||value>1)))
      )return fail('invalid linked mechanism geometry');
    const box=sliderCrankBounds(m);
    const left=Math.min(box.x,...layers.map(l=>l.x)),top=Math.min(box.y,...layers.map(l=>l.y));
    const right=Math.max(box.x+box.w,...layers.map(l=>l.x+l.w));
    const bottom=Math.max(box.y+box.h,...layers.map(l=>l.y+l.h));
    // The renderer applies one scale/translation to every layer and every joint.
    // Refuse diagrams that would become too small after this common fit.
    if(Math.min(v.canvas.width/(right-left),v.canvas.height/(bottom-top))<.7)
      return fail('linked mechanism would be too small after scene-wide fit');
    for(const beat of v.direction?.beats??[]){
      if(!beat||!finite(beat.at)||typeof beat.action!=='string')continue;
      const action=beat.action.toLowerCase();
      const topClaim=/top dead cent(?:er|re)/u.test(action),bottomClaim=/bottom dead cent(?:er|re)/u.test(action);
      if(!topClaim&&!bottomClaim)continue;
      const wristY=sliderCrankPose(m,beat.at).wristPin.y;
      const expected=m.centerY+(bottomClaim?m.crankRadius:-m.crankRadius)-m.rodLength;
      if(Math.abs(wristY-expected)>m.crankRadius*.16||/rod (?:is )?horizontal/u.test(action))
        return fail('linked mechanism contradicts storyboard dead-centre phase');
    }
  }
  const direction=v.direction&&typeof v.direction.concept==='string'?{
    concept:v.direction.concept.slice(0,300),
    alternatives:Array.isArray(v.direction.alternatives)?v.direction.alternatives.filter(s=>typeof s==='string').slice(0,5).map(s=>s.slice(0,180)):[],
    beats:Array.isArray(v.direction.beats)?v.direction.beats.filter(b=>b&&finite(b.at)&&b.at>=0&&b.at<=1&&typeof b.action==='string').slice(0,12).map(b=>({at:b.at,action:b.action.slice(0,200),
      ...(Array.isArray(b.layerIds)?{layerIds:[...new Set(b.layerIds.filter(id=>typeof id==='string'))].slice(0,8)}:{})})):[],
    ...Object.fromEntries((['entry','exit','cameraPurpose','depthPurpose','typographyPurpose'] as const).flatMap(field=>
      typeof v.direction![field]==='string'?[[field,v.direction![field]!.slice(0,360)]]:[]))
  }:undefined;
  return {artwork:{version:1,motionCoordinates:'relative',intent:String(v.intent??'').slice(0,300),layout:v.layout,canvas:{width:v.canvas.width,height:v.canvas.height},palette:{...palette},layers,startSeconds,durationSeconds,
    ...(mechanism?{linkedMechanism:{kind:'slider-crank' as const,centerX:mechanism.centerX,centerY:mechanism.centerY,
      crankRadius:mechanism.crankRadius,rodLength:mechanism.rodLength,pistonWidth:mechanism.pistonWidth,
      pistonHeight:mechanism.pistonHeight,startAngle:mechanism.startAngle??0,turns:mechanism.turns??1,
      ...(mechanism.annotations?{annotations:{reciprocatingForce:mechanism.annotations.reciprocatingForce===true,
        crankTorque:mechanism.annotations.crankTorque===true,
        ...(mechanism.annotations.forceAt!==undefined?{forceAt:mechanism.annotations.forceAt}:{}),
        ...(mechanism.annotations.torqueAt!==undefined?{torqueAt:mechanism.annotations.torqueAt}:{})}}:{})}}:{}),
    ...(actions.length?{actions}:{}),
    ...(cameraKeys?{camera:{...(camera?.path?{path:camera.path}:{}),keyframes:preserveSpanTiming||camera?.path==='continuous'||actions.length?cameraKeys:settleArtworkKeys(cameraKeys)!}}:{}),...(direction?{direction}:{})}};
}

type ArtworkPlan={version:1;validationVersion?:13;keyframeCoalesceVersion?:1;spanDurationVersion?:1;revisionCoordinatesVersion?:2;mediaTransformVersion?:1;v2ReceiptHashes?:Record<string,string>;primaryBatches?:number[];inputHash:string;model:string;scenes:Array<{sceneId:string;artwork:DocumentaryArtwork;artworkSpan?:{endSceneId:string}}>;
  rejected:Array<{sceneId:string;reason:string}>;incomplete?:string};
export const artworkOrphanedRequestMessage='Сохранён незавершённый монтажный запрос прежнего плана. Новая группировка рисунков не разрешает повторную оплату; проверьте журнал AnyModel.';
type RevisionAttempt={version?:number;inputHash?:string;from?:number;inputSha256?:string;analysisKey?:string;requiresRenderCheck?:boolean};
function validV2Attempt(value:RevisionAttempt|undefined,inputHash:string,from:number):boolean{
  return value?.version===1&&value.inputHash===inputHash&&value.from===from
    &&typeof value.inputSha256==='string'&&/^[a-f0-9]{64}$/u.test(value.inputSha256)
    &&typeof value.analysisKey==='string'&&/^[a-f0-9]{64}$/u.test(value.analysisKey);
}
/** Only a complete v2 response bound to this input and batch can trigger local replay. */
async function completedV2RevisionHashes(directory:string,inputHash:string):Promise<Record<string,string>>{
  const hashes:Record<string,string>={};
  const names=await readdir(directory).catch((error:NodeJS.ErrnoException)=>{
    if(error.code==='ENOENT')return [] as string[];throw error;
  });
  for(const name of names.sort()){
    const match=new RegExp(`^${inputHash}-artwork-revision-v2-(\\d+)\\.json$`,'u').exec(name);
    if(!match)continue;
    const from=Number(match[1]),prefix=`${inputHash}-artwork-revision-v2-${from}`;
    const [raw,attemptRaw]=await Promise.all([
      readFile(join(directory,name),'utf8').catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;}),
      readFile(join(directory,`${prefix}.attempt.json`),'utf8').catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;})]);
    if(!raw||!attemptRaw)continue;
    let response:{scenes?:unknown},attempt:RevisionAttempt;
    try{response=JSON.parse(raw) as {scenes?:unknown};attempt=JSON.parse(attemptRaw) as RevisionAttempt;}
    catch(error){if(error instanceof SyntaxError)continue;throw error;}
    if(!Array.isArray(response.scenes)||!validV2Attempt(attempt,inputHash,from))continue;
    hashes[String(from)]=createHash('sha256').update(raw).update('\n').update(attemptRaw).digest('hex');
  }
  return hashes;
}
export function savedMotionArtworkNeedsKeyframeRepair(value:unknown,inputHash:string):boolean{
  const saved=value as Partial<ArtworkPlan>|undefined;
  return saved?.version===1&&saved.validationVersion===13&&saved.inputHash===inputHash
    &&!saved.keyframeCoalesceVersion&&!saved.incomplete&&Array.isArray(saved.rejected)
    &&saved.rejected.some(row=>row.reason==='invalid motion keyframes');
}
function needsMediaTransformRepair(plan:ArtworkPlan):boolean{
  return !plan.mediaTransformVersion&&plan.scenes.some(({artwork})=>{
    const media=artwork.layers.filter(layer=>layer.kind==='media');
    return media.length>1||media.some(layer=>layer.sourceSceneId||layer.sourceVariant||layer.sourceWindow||layer.clip);
  });
}
/** Primary raw receipts are immutable; remember which completed batches a
 * partial aggregate has consumed, so unchanged unknown batches need no rescan. */
async function completedPrimaryBatches(directory:string,inputHash:string):Promise<number[]>{
  const pattern=new RegExp(`^${inputHash}-artwork-(\\d+)\\.json$`,'u');
  return (await readdir(directory)).flatMap(name=>{const match=pattern.exec(name);return match?[Number(match[1])]:[];}).sort((a,b)=>a-b);
}
/** Recover completed batches/rejected drawings locally, without a provider callback. */
export async function repairSavedMotionArtworkPlan(project:Project,root:string,signal?:AbortSignal):Promise<ArtworkPlan|undefined>{
  const inputHash=motionArtworkHash(project),file=join(root,'Documentary','Montage',`${inputHash}-artwork-v1.json`);
  const saved=await readFile(file,'utf8').then(JSON.parse).catch((error:NodeJS.ErrnoException)=>{
    if(error.code==='ENOENT')return undefined;throw error;
  }) as ArtworkPlan|undefined;
  if(!saved||saved.version!==1||saved.validationVersion!==13||saved.inputHash!==inputHash)return undefined;
  const directory=join(root,'Documentary','Montage');
  const names=await readdir(directory);
  const oldRevision=names.some(name=>new RegExp(`^${inputHash}-artwork-revision-\\d+\\.json$`,'u').test(name));
  const needsSpan=!saved.spanDurationVersion&&Array.isArray(saved.rejected)
    &&saved.rejected.some(row=>row.reason==='invalid artwork span');
  const v2Hashes=await completedV2RevisionHashes(directory,inputHash);
  const needsV2=Object.keys(v2Hashes).some(from=>saved.v2ReceiptHashes?.[from]!==v2Hashes[from]);
  const needsPrimary=saved.incomplete&&(await completedPrimaryBatches(directory,inputHash)).some(from=>!saved.primaryBatches?.includes(from));
  if(!needsPrimary&&!savedMotionArtworkNeedsKeyframeRepair(saved,inputHash)&&!needsSpan
    &&!(oldRevision&&!saved.revisionCoordinatesVersion)&&!needsV2&&!needsMediaTransformRepair(saved))return undefined;
  return createMotionArtworkPlan(project,root,async()=>{
    throw new DocumentarySemanticMontageError('[no-retry] Отсутствует сохранённый ответ AI-графики; повторный запрос отключён.');
  },saved!.model,signal,{savedOnly:true});
}
type ArtworkBatchRange={from:number;until:number};
function artworkSpanCoverable(scene:Scene,all:Scene[]):boolean{
  return artworkSceneEditable(scene)&&documentaryExplanationEditable(scene)
    &&scene.documentary?.semanticMontage?.artworkMode!=='photographic'
    &&!scene.documentary?.semanticMontage?.chapter&&!documentaryMontageHasEvidence(scene,all);
}
function artworkBatchCommissionable(batch:Scene[],all:Scene[]):boolean{
  return batch.some(scene=>artworkSceneEditable(scene)&&montageFrames(scene)>=72&&!scene.documentary?.semanticMontage?.chapter)
    ||batch.some((scene,start)=>{
      const endId=scene.documentary?.semanticMontage?.artworkBrief?.endSceneId;
      const end=endId?batch.findIndex(candidate=>candidate.id===endId):-1;
      const span=end>start?batch.slice(start,end+1):[];
      return span.length>1&&span.every(member=>artworkSpanCoverable(member,all))
        &&span.reduce((sum,member)=>sum+montageFrames(member),0)>=72;
    });
}
function artworkBatchRanges(all:Scene[],preserveFixed:boolean):ArtworkBatchRange[]{
  const ranges:ArtworkBatchRange[]=[];
  for(let from=0;from<all.length;){
    let until=Math.min(from+8,all.length);
    if(!preserveFixed){
      // A full-thought brief or automatic explanation must remain in one
      // commission. Each such span is at most four scenes, so cut before its
      // start instead of extending a request beyond the eight-scene budget.
      for(let start=from+1;start<until;start++){
        const direction=all[start]?.documentary?.semanticMontage;
        const endId=direction?.artworkBrief?.endSceneId??direction?.explanation?.endSceneId??direction?.artworkSpan?.endSceneId;
        const end=endId?all.findIndex(scene=>scene.id===endId):start;
        if(end>=until&&end-start<8){until=start;break;}
      }
    }
    ranges.push({from,until});from=until;
  }
  return ranges;
}
async function priorArtworkBatchEvidence(root:string,directory:string,inputHash:string):Promise<boolean>{
  const names=await readdir(directory);
  if(names.some(name=>new RegExp(`^${inputHash}-artwork-\\d+(?:\\.failed)?\\.json$`,'u').test(name)))return true;
  const analysis=join(root,'Documentary','Analysis');
  const checkpoints=await readdir(analysis).catch((error:NodeJS.ErrnoException)=>{
    if(error.code==='ENOENT')return [] as string[];throw error;
  });
  for(const name of checkpoints.filter(name=>/^[a-f0-9]{64}\.json$/u.test(name))){
    let receipt:Record<string,unknown>;
    try{receipt=JSON.parse(await readFile(join(analysis,name),'utf8')) as Record<string,unknown>;}
    catch(error){if(error instanceof SyntaxError)return true;throw error;} // Unattributed history cannot change paid boundaries.
    if(receipt.purpose!=='semantic-montage')continue;
    if(['pending','partial','received','invalid'].includes(String(receipt.state)))return true;
    const result=receipt.result as {scenes?:Array<Record<string,unknown>>}|undefined;
    if(receipt.state==='complete'&&Array.isArray(result?.scenes)
      &&(!result.scenes.length||result.scenes.some(row=>row&&Object.hasOwn(row,'artwork'))))return true;
  }
  return false;
}
export async function createMotionArtworkPlan(project:Project,root:string,complete:(system:string,input:string,onPaidSubmission?:(analysisKey:string)=>Promise<void>)=>Promise<Record<string,unknown>>,model:string,signal?:AbortSignal,options:{resumeUnavailable?:boolean;canResumeUnavailable?:(system:string,input:string)=>Promise<boolean>;canResumeLocalRevision?:(analysisKey:string,inputSha256:string)=>Promise<boolean>;savedOnly?:boolean;revision?:ArtworkRevisionHooks;reviseSavedArtwork?:boolean;feedback?:ArtworkFeedbackInput;
  revalidateCompletedPrimary?:boolean;
  offlinePrimary?:{read:(system:string,input:string,from:number)=>Promise<Record<string,unknown>>}}={}):Promise<ArtworkPlan>{
  if(options.feedback){
    if(!options.revision)throw new DocumentarySemanticMontageError('Предпросмотр доработки AI-графики не подключён.');
    return createArtworkFeedbackPlan(project,root,options.feedback.feedback,options.revision,model,signal,options.feedback.assertCurrent,options.feedback.onPrepared);
  }
  const activeFeedback=await readActiveArtworkFeedback(project,root);
  if(activeFeedback)return activeFeedback;
  // Explicit local validation can recover an all-rejected completed batch,
  // which has no artwork-v1 summary. It must never acquire missing artwork.
  if(options.revalidateCompletedPrimary&&(options.offlinePrimary||options.savedOnly||options.revision||options.reviseSavedArtwork||options.resumeUnavailable||options.canResumeUnavailable||options.canResumeLocalRevision))
    throw new DocumentarySemanticMontageError('[no-retry] Completed-primary revalidation is local and cannot invoke revision or resume modes.');
  if(options.offlinePrimary&&(options.savedOnly||options.revision||options.reviseSavedArtwork||options.resumeUnavailable||options.canResumeUnavailable||options.canResumeLocalRevision))
    throw new DocumentarySemanticMontageError('[no-retry] Offline primary recovery cannot invoke revision or resume modes.');
  const inputHash=motionArtworkHash(project),directory=join(root,'Documentary','Montage'),file=join(directory,`${inputHash}-${options.offlinePrimary?'artwork-pre-revision':'artwork-v1'}.json`);
  const read=async(path:string)=>readFile(path,'utf8').then(JSON.parse).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return undefined;throw e;});
  const cached=options.offlinePrimary?undefined:await read(file) as ArtworkPlan|undefined;
  if(options.revalidateCompletedPrimary&&(cached||(await readdir(directory)).some(name=>name.startsWith(`${inputHash}-artwork-revision-`))))
    throw new DocumentarySemanticMontageError('[no-retry] Completed-primary validation cannot replace a saved artwork plan or revision history.');
  const cachedMatching=cached?.version===1&&cached.validationVersion===13&&cached.inputHash===inputHash;
  if(options.reviseSavedArtwork&&!cachedMatching)
    throw new DocumentarySemanticMontageError('[no-retry] Нет соответствующего сохранённого плана для редактуры. Первичные генерации не отправлялись.');
  // An incomplete plan is a snapshot, not a terminal cache: later untouched
  // batches may still be commissioned without replaying any saved attempt.
  const cachedUsable=cachedMatching&&(!cached.incomplete||Boolean(options.savedOnly));
  // A partial film still contains paid drafts worth repairing. This mode must
  // not fill its missing primary batches with new paid commissions.
  const rerunSaved=Boolean(options.reviseSavedArtwork&&cachedMatching);
  const localMediaRepair=cachedMatching&&needsMediaTransformRepair(cached!);
  if(localMediaRepair&&!options.savedOnly&&!rerunSaved&&!options.revalidateCompletedPrimary)
    return createMotionArtworkPlan(project,root,complete,model,signal,{savedOnly:true});
  const localKeyframeRepair=cachedUsable&&savedMotionArtworkNeedsKeyframeRepair(cached,inputHash);
  const localSpanRepair=cachedMatching&&!cached.spanDurationVersion
    &&Array.isArray(cached.rejected)&&cached.rejected.some(row=>row.reason==='invalid artwork span');
  const localCoordinatesRepair=Boolean(cachedMatching&&!cached.revisionCoordinatesVersion
    &&(await readdir(directory)).some(name=>new RegExp(`^${inputHash}-artwork-revision-\\d+\\.json$`,'u').test(name)));
  const v2ReceiptHashes=await completedV2RevisionHashes(directory,inputHash);
  const localV2Repair=Boolean(cachedMatching&&Object.keys(v2ReceiptHashes)
    .some(from=>cached.v2ReceiptHashes?.[from]!==v2ReceiptHashes[from]));
  const localPrimaryRepair=cachedMatching&&cached.incomplete&&options.savedOnly
    &&(await completedPrimaryBatches(directory,inputHash)).some(from=>!cached.primaryBatches?.includes(from));
  if(options.savedOnly&&!cachedUsable)
    throw new DocumentarySemanticMontageError('[no-retry] Нет сохранённого плана AI-графики для локального пересчёта.');
  if(cachedUsable&&!localPrimaryRepair
    &&!localKeyframeRepair&&!localSpanRepair&&!localCoordinatesRepair&&!localV2Repair&&!localMediaRepair&&!rerunSaved&&!options.revalidateCompletedPrimary)return cached;
  const all=project.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order),result:ArtworkPlan={version:1,validationVersion:13,keyframeCoalesceVersion:1,spanDurationVersion:1,revisionCoordinatesVersion:2,mediaTransformVersion:1,v2ReceiptHashes,inputHash,model,scenes:[],rejected:[]};
  const [outputWidth,outputHeight]=project.aspectRatio.split(':').map(Number),outputAspect=outputWidth!/outputHeight!;
  if(!artworkEnabled(project)||!all.length)return result;
  await mkdir(directory,{recursive:true});
  const manifestPath=join(directory,`${inputHash}-artwork-batches.json`);
  let manifest:{version?:number;inputHash?:string;sceneIds?:string[];ranges?:ArtworkBatchRange[];timelineVersion?:1;motionContextVersion?:1;directionVersion?:1;
    storyContext?:ReturnType<typeof documentaryAiPlanContext>}|undefined;
  try{manifest=await read(manifestPath) as typeof manifest;}
  catch(error){if(!(error instanceof SyntaxError))throw error;
    throw new DocumentarySemanticMontageError('[no-retry] Повреждена схема artwork-батчей. Новая оплата отключена.');}
  if(!manifest){
    if(options.offlinePrimary||options.revalidateCompletedPrimary)throw new DocumentarySemanticMontageError('[no-retry] Local primary validation requires the exact saved batch manifest.');
    const preserveFixed=await priorArtworkBatchEvidence(root,directory,inputHash);
    // Existing paid history keeps byte-identical inputs. Only a new commission
    // opts into film timing; the manifest preserves that choice across resumes.
    const proposed={version:1,inputHash,sceneIds:all.map(scene=>scene.id),ranges:artworkBatchRanges(all,preserveFixed),
      ...(!preserveFixed?{timelineVersion:1 as const,motionContextVersion:1 as const,directionVersion:1 as const,storyContext:documentaryAiPlanContext(project)}:{})};
    await writeFile(manifestPath,JSON.stringify(proposed),{flag:'wx'}).catch((error:NodeJS.ErrnoException)=>{
      if(error.code!=='EEXIST')throw error;
    });
    try{manifest=await read(manifestPath) as typeof proposed;}
    catch(error){if(!(error instanceof SyntaxError))throw error;
      throw new DocumentarySemanticMontageError('[no-retry] Повреждена схема artwork-батчей. Новая оплата отключена.');}
  }
  const ranges=manifest?.ranges;
  if(manifest?.version!==1||manifest.inputHash!==inputHash||JSON.stringify(manifest.sceneIds)!==JSON.stringify(all.map(scene=>scene.id))
    ||manifest.timelineVersion!==undefined&&manifest.timelineVersion!==1||manifest.motionContextVersion!==undefined&&manifest.motionContextVersion!==1
    ||manifest.directionVersion!==undefined&&manifest.directionVersion!==1
    ||manifest.motionContextVersion===1&&(!manifest.storyContext||typeof manifest.storyContext.originalScript!=='string'||!Array.isArray(manifest.storyContext.contextScenes))
    ||!Array.isArray(ranges)||!ranges.length&&all.length||ranges?.some((range,i)=>!Number.isInteger(range.from)||!Number.isInteger(range.until)
      ||range.from!==(i?ranges[i-1]!.until:0)||range.until<=range.from||range.until-range.from>8)
    ||ranges?.at(-1)?.until!==all.length)
    throw new DocumentarySemanticMontageError('[no-retry] Повреждена схема artwork-батчей. Новая оплата отключена.');
  if(options.revalidateCompletedPrimary){
    // Check all required batches before writing any validation/summary. The
    // caller binds these cached JSON bodies to COMPLETE wire receipts.
    for(const {from,until} of ranges){
      if(!artworkBatchCommissionable(all.slice(from,until),all))continue;
      const raw=await read(join(directory,`${inputHash}-artwork-${from}.json`));
      if(!Array.isArray(raw?.scenes))throw new DocumentarySemanticMontageError('[no-retry] Completed primary batch missing or invalid; no request was sent.');
    }
  }
  if(!options.savedOnly&&!rerunSaved&&!localMediaRepair&&(localKeyframeRepair||localSpanRepair||localCoordinatesRepair||localV2Repair)){
    const names=new Set(await readdir(directory));
    if(ranges.some(({from,until})=>artworkBatchCommissionable(all.slice(from,until),all)
      &&!names.has(`${inputHash}-artwork-${from}.json`)))return cached!;
  }
  const revisionIssues:string[]=[];
  const processedPrimary:number[]=[];
  let elapsedFrames=0;
  const timelineStarts=new Map(all.map(scene=>{
    const startSeconds=elapsedFrames/30;elapsedFrames+=montageFrames(scene);
    return [scene.id,startSeconds] as const;
  }));
  for(const {from,until} of ranges){
    signal?.throwIfAborted();
    const batch=all.slice(from,until),eligible=batch.filter(s=>artworkSceneEditable(s)&&montageFrames(s)>=72&&!s.documentary?.semanticMontage?.chapter);
    if(!artworkBatchCommissionable(batch,all))continue;
    const receipt=join(directory,`${inputHash}-artwork-${from}.json`);
    const revisionEligibilityPath=join(directory,`${inputHash}-artwork-${from}.revision-eligible.json`);
    let raw=options.offlinePrimary?undefined:await read(receipt) as Record<string,unknown>|undefined;
    if(!raw){
      if(options.revalidateCompletedPrimary)throw new DocumentarySemanticMontageError('[no-retry] Completed primary batch missing; no request was sent.');
      if(options.savedOnly){
        const ids=new Set(batch.map(scene=>scene.id));
        const retained=cached!.scenes.filter(row=>ids.has(row.sceneId));
        result.scenes.push(...retained);
        result.rejected.push(...cached!.rejected.filter(row=>ids.has(row.sceneId)));
        if(retained.some(row=>needsMediaTransformRepair({...cached!,scenes:[row]})))delete result.mediaTransformVersion;
        result.incomplete=[result.incomplete,`Порция ${from+1}: сохранённый первичный ответ отсутствует; восстановлены только уже полученные рисунки, новые запросы не отправлялись.`].filter(Boolean).join(' ');
        continue;
      }
      if(rerunSaved){
        result.incomplete='Редактируются только сохранённые рисунки; недостающие первичные партии не отправлялись.';
        continue;
      }
      const input=JSON.stringify({version:2,motionArtwork:1,aspect:project.aspectRatio,language:project.language,previous:all[from-1]?.narration,next:all[from+batch.length]?.narration,
        ...(manifest.motionContextVersion===1?{storyContext:manifest.storyContext}:{}),
        previousDesigns:result.scenes.slice(-4).map(({artwork:a})=>{
          const media=a.layers.find(l=>l.kind==='media');
            return {intent:a.intent,layout:a.layout,concept:a.direction?.concept,beats:a.direction?.beats,
              ...(manifest.motionContextVersion===1?{exitState:{camera:a.camera?.keyframes.at(-1),actions:a.actions?.map(action=>({id:action.id,layerId:action.layerId,end:action.end,to:action.to}))}}:{}),
            mediaBox:media?[media.x/a.canvas.width,media.y/a.canvas.height,media.w/a.canvas.width,media.h/a.canvas.height].map(n=>Number(n.toFixed(3))):undefined,
            motion:a.layers.filter(l=>(l.kind==='group'||l.kind==='media')&&l.keyframes?.length).slice(0,3).map(l=>({kind:l.kind,first:l.keyframes![0],last:l.keyframes!.at(-1)}))};
        }),
        scenes:batch.map(s=>({sceneId:s.id,narration:s.narration,seconds:montageFrames(s)/30,
          timelineStartSeconds:manifest.timelineVersion===1?timelineStarts.get(s.id):undefined,
          storyBeat:manifest.timelineVersion===1?s.documentary?.semanticMontage?.beat:undefined,
          ...(manifest.directionVersion===1?{sceneDirection:s.documentary?.semanticMontage?.sceneDirection}:{}),
          editable:eligible.includes(s),spanCoverable:artworkSpanCoverable(s,all),artworkMode:s.documentary?.semanticMontage?.artworkBrief?undefined:s.documentary?.semanticMontage?.artworkMode,artworkBrief:s.documentary?.semanticMontage?.artworkBrief,existingComposition:s.documentary?.semanticMontage?.composition?.kind,existingEmphasis:s.documentary?.semanticMontage?.emphasis,
          sourceMedia:{available:Boolean(s.imagePath||s.videoPath),kind:s.documentary?.selected?.kind,width:s.documentary?.selected?.width,height:s.documentary?.selected?.height}}))});
      const failurePath=join(directory,`${inputHash}-artwork-${from}.failed.json`);
      const artworkSystem=motionArtworkSystem+(project.settings.assembly.documentary?.montage?.graphicsDensity==='sparse'?sparseMotionArtworkDirection:'');
      if(options.offlinePrimary)raw=await options.offlinePrimary.read(artworkSystem,input,from);
      else try{
        const failure=await read(failurePath) as {message:string;safeToResume?:boolean}|undefined;
        // Older failures did not retain the terminal gateway marker. Only the
        // exact underlying Analysis receipt can authorize their explicit resume.
        // An older global guard could save this pre-submission failure for a
        // different batch after a revision stream broke. Recheck Analysis now;
        // its exact and orphan guards still decide whether payment is safe.
        if(failure&&failure.message!==artworkOrphanedRequestMessage
          &&!(options.resumeUnavailable&&(failure.safeToResume||await options.canResumeUnavailable?.(artworkSystem,input))))
          throw new DocumentarySemanticMontageError(failure.message);
        raw=await complete(artworkSystem,input,async analysisKey=>{
          if(!/^[a-f0-9]{64}$/u.test(analysisKey))throw new DocumentarySemanticMontageError('[no-retry] Недопустимый ключ оплаченной генерации.');
          await atomicWrite(revisionEligibilityPath,JSON.stringify({version:1,inputHash,from,analysisKey}));
        });
      }
      catch(error){
        signal?.throwIfAborted();
        if(!(error instanceof DocumentaryAnalysisError||error instanceof DocumentarySemanticMontageError||error instanceof AnyModelModelUnavailableError))throw error;
        if(!(error instanceof DocumentarySemanticMontageError)||!await read(failurePath))
          await atomicWrite(failurePath,JSON.stringify({message:error.message,safeToResume:error instanceof AnyModelModelUnavailableError||error instanceof DocumentaryAnalysisError&&(error.serviceUnavailable||error.completedGatewayError)}));
        result.incomplete=[result.incomplete,`Порция ${from+1}: ${error.message}`].filter(Boolean).join(' ');
        continue; // Other batches are independent; never replay the uncertain paid batch.
      }
      if(!options.offlinePrimary)await atomicWrite(receipt,JSON.stringify(raw));
    }
    processedPrimary.push(from);
    if(!Array.isArray(raw.scenes))throw new DocumentarySemanticMontageError('[no-retry] AI-графика: получен ответ без массива сцен. Ответ сохранён; повторная оплата не выполнена.');
    const acceptedBefore=result.scenes.length;
    const seen=new Set<string>(),claimed=new Set<string>();
    for(const row of raw.scenes as Array<{sceneId:string;artwork:unknown;artworkSpan?:{endSceneId?:unknown}}>){
      const scene=eligible.find(s=>s.id===row?.sceneId)
        ??(row?.artworkSpan?batch.find(s=>s.id===row.sceneId&&artworkSpanCoverable(s,all)):undefined);
      if(!scene||seen.has(scene.id)){result.rejected.push({sceneId:row?.sceneId??'',reason:'unknown, repeated or protected scene'});continue;}
      seen.add(scene.id);
      const index=all.indexOf(scene),endId=typeof row.artworkSpan?.endSceneId==='string'?row.artworkSpan.endSceneId:undefined;
      const end=endId?all.findIndex(s=>s.id===endId):index;
      const range=end>=index?all.slice(index,end+1):[];
      const proposed=row.artwork as Partial<DocumentaryArtwork>|undefined;
      const standalone=proposed?.layout==='full'&&Array.isArray(proposed.layers)
        &&!proposed.layers.some(layer=>layer?.kind==='media');
      const cutsExplanation=all.some((s,start)=>{
        const explanation=s.documentary?.semanticMontage?.explanation;if(!explanation)return false;
        const finish=explanation.endSceneId?all.findIndex(item=>item.id===explanation.endSceneId):start;
        return start<=end&&finish>=index&&(start<index||finish>end);
      });
      const spanFrames=range.reduce((sum,s)=>sum+montageFrames(s),0);
      const span=endId&&end>index&&end<until&&standalone&&!cutsExplanation&&spanFrames>=72
        &&range.every(s=>artworkSpanCoverable(s,all)&&!claimed.has(s.id))
        ?{endSceneId:endId}:undefined;
      if(row.artworkSpan&&!span){result.rejected.push({sceneId:scene.id,reason:'invalid artwork span'});continue;}
      if(claimed.has(scene.id)){result.rejected.push({sceneId:scene.id,reason:'overlapping artwork span'});continue;}
      const context=all.slice(Math.max(0,index-1),Math.min(all.length,(span?end:index)+2)).map(s=>s.narration).join(' ');
      const seconds=all.slice(index,(span?end:index)+1).reduce((sum,s)=>sum+montageFrames(s)/30,0);
      const allowedSources=artworkSourceCandidates(project,scene.id);
      const checked=validateMotionArtwork(row.artwork,context,seconds,Boolean(scene.imagePath||scene.videoPath),outputAspect,
        {...scene.documentary?.selected,contain:scene.documentary?.layout==='contain'||scene.documentary?.layout==='compare',
          mediaAllowed:Boolean(scene.documentary?.semanticMontage?.artworkBrief)||scene.documentary?.semanticMontage?.artworkMode!=='standalone',
          currentSceneId:scene.id,allowedSources},Boolean(span));
      if(!checked.artwork||span&&(checked.artwork.layout!=='full'||checked.artwork.layers.some(l=>l.kind==='media'))){
        result.rejected.push({sceneId:scene.id,reason:checked.issue??'invalid artwork'});continue;
      }
      // Safe, structurally valid drafts reach the editor with their actual
      // weakness. Do not turn a new quality rule into a reason to repurchase
      // primary artwork or silently exclude it from visual repair.
      result.scenes.push({sceneId:scene.id,artwork:checked.artwork,...(span?{artworkSpan:span}:{})});
      (span?range:[scene]).forEach(member=>claimed.add(member.id));
    }
    const finishBatchQuality=()=>{
      // Safe drafts reach review first. Explicit repair preserves an existing
      // paid drawing on failure, but never calls that a successful repair.
      for(let i=result.scenes.length-1;i>=acceptedBefore;i--){
        const row=result.scenes[i]!,quality=assessArtworkReplacement(row.artwork);
        if(quality.allowReplacement)continue;
        if(rerunSaved&&cached?.scenes.some(saved=>saved.sceneId===row.sceneId))
          revisionIssues.push(`${row.sceneId}: исходный оплаченный рисунок сохранён; постановка требует доработки (${quality.reason}).`);
        else {result.rejected.push({sceneId:row.sceneId,reason:quality.reason});result.scenes.splice(i,1);}
      }
      // Diagnostic status, not a new Export approval gate. Keep the paid safe
      // draft and expose failed artistic repair instead of reporting success.
      if(manifest.directionVersion===1)for(const row of result.scenes.slice(acceptedBefore)){
        const directed=all.find(s=>s.id===row.sceneId)?.documentary?.semanticMontage?.sceneDirection;
        const review=reviewArtworkTemporal(row.artwork,directed);
        if(review.findings.length)revisionIssues.push(`${row.sceneId}: постановка требует проверки/доработки: ${review.findings.map(f=>`${f.code} (${f.layers.join(', ')||'scene'})`).join('; ')}.`);
      }
    };
    if(options.offlinePrimary||options.revalidateCompletedPrimary){finishBatchQuality();continue;}
    // Only a newly received commission may start a paid review. A saved review
    // response can be revalidated locally after interruption; old drafts alone cannot.
    const revisionEligibility=await read(revisionEligibilityPath) as {version?:number;inputHash?:string;from?:number;analysisKey?:string}|undefined;
    const revisionAuthorized=rerunSaved&&Boolean(raw)
      ||revisionEligibility?.version===1&&revisionEligibility.inputHash===inputHash
      &&revisionEligibility.from===from&&typeof revisionEligibility.analysisKey==='string'
      &&/^[a-f0-9]{64}$/u.test(revisionEligibility.analysisKey);
    const revisionCandidates=result.scenes.slice(acceptedBefore).flatMap((row,i)=>{
      const media=row.artwork.layers.filter(layer=>layer.kind==='media').length;
      const scene=all.find(member=>member.id===row.sceneId);
      return row.artwork.layout==='full'&&(media===0||media<=3&&!row.artworkSpan
        &&row.artwork.layers.filter(layer=>layer.kind==='media').every(layer=>!layer.parentId)
        &&Boolean(scene?.imagePath||scene?.videoPath))
        ?[{row,index:acceptedBefore+i}]:[];
    });
    const versionedPrefix=`${inputHash}-artwork-revision-v2-${from}`;
    const legacyPrefix=`${inputHash}-artwork-revision-${from}`;
    const useLegacy=!rerunSaved&&Boolean(await read(join(directory,`${legacyPrefix}.json`)))
      &&!await read(join(directory,`${versionedPrefix}.json`))
      &&!await read(join(directory,`${versionedPrefix}.attempt.json`));
    const prefix=useLegacy?legacyPrefix:versionedPrefix;
    const revisionReceipt=join(directory,`${prefix}.json`);
    const failurePath=join(directory,`${prefix}.failed.json`);
    const attemptPath=join(directory,`${prefix}.attempt.json`);
    let savedRevision=await read(revisionReceipt) as Record<string,unknown>|undefined;
    const attempt=await read(attemptPath) as RevisionAttempt|undefined;
    if(!useLegacy&&savedRevision&&!validV2Attempt(attempt,inputHash,from)){
      revisionIssues.push(`Визуальная доработка порции ${from+1}: receipt v2 не соответствует исходному запросу; первичный рисунок сохранён.`);
      finishBatchQuality();
      continue;
    }
    let processedV2=Boolean(!useLegacy&&savedRevision);
    if(!options.savedOnly&&!savedRevision&&attempt?.analysisKey&&(useLegacy||validV2Attempt(attempt,inputHash,from))
      &&/^[a-f0-9]{64}$/u.test(attempt.analysisKey)){
      const checkpoint=await read(join(root,'Documentary','Analysis',`${attempt.analysisKey}.json`)) as
        {state?:string;result?:Record<string,unknown>;raw?:string}|undefined;
      const recovered=checkpoint?.state==='complete'?checkpoint.result
        :checkpoint?.state==='received'&&checkpoint.raw?receivedMotionArtwork(checkpoint.raw):undefined;
      if(recovered&&Array.isArray(recovered.scenes)){
        savedRevision=recovered;
        await atomicWrite(revisionReceipt,JSON.stringify(recovered));
        if(!useLegacy)processedV2=true;
      }
    }
    if(options.savedOnly&&!savedRevision){
      const failure=await read(failurePath) as {message?:string}|undefined;
      if(attempt||failure)revisionIssues.push(`Визуальная доработка порции ${from+1} не завершена: ${failure?.message??'ответ запроса неизвестен; повторная оплата отключена.'}`);
      finishBatchQuality();
      continue;
    }
    if(revisionCandidates.length&&!revisionAuthorized&&!savedRevision){
      const failure=await read(failurePath) as {message?:string}|undefined;
      if(failure||attempt)revisionIssues.push(`Визуальная доработка порции ${from+1} не завершена: ${failure?.message??'ответ запроса неизвестен; повторная оплата отключена.'}`);
    }
    if((revisionAuthorized||savedRevision)&&revisionCandidates.length){
      const originals=revisionCandidates.map(candidate=>candidate.row);
      try{
        let response=savedRevision;
        if(!response){
          if(!options.revision)throw new DocumentarySemanticMontageError('Предпросмотр визуальной доработки не подключён.');
          const failure=await read(failurePath) as {version?:number;inputHash?:string;from?:number}|undefined;
          const hasAttempt=await read(attemptPath)!==undefined;
          // Every v2 submission below awaits its attempt write first. Only an
          // explicit saved revision may retry a bound pre-submission failure;
          // even a malformed/null attempt still blocks a new paid request.
          const resumeLocal=rerunSaved&&!useLegacy&&!hasAttempt&&failure?.version===1&&failure.inputHash===inputHash&&failure.from===from;
          const resumeProvenLocal=rerunSaved&&!useLegacy&&validV2Attempt(attempt,inputHash,from)
            &&Boolean(await options.canResumeLocalRevision?.(attempt!.analysisKey!,attempt!.inputSha256!));
          if(hasAttempt&&!resumeProvenLocal||failure!==undefined&&!resumeLocal&&!resumeProvenLocal)throw new DocumentarySemanticMontageError('[no-retry] Предыдущая доработка не завершена; повторный запрос отключён.');
          if(resumeProvenLocal){
            const archive=join(directory,`${prefix}.local-rejections`);await mkdir(archive,{recursive:true});
            const original=await readFile(attemptPath,'utf8');
            await atomicWrite(join(archive,`${createHash('sha256').update(original).digest('hex')}.attempt.json`),original);
          }
          const previews=await options.revision.preview(originals.map(row=>({sceneId:row.sceneId,
            ...(row.artworkSpan?{endSceneId:row.artworkSpan.endSceneId}:{}),artwork:row.artwork})),signal);
          validateArtworkRevisionPreviews(originals,previews);
          const previewByScene=new Map(previews.map(row=>[row.sceneId,row]));
          const images:string[]=[];
          const rows=[] as Array<{sceneId:string;narration:string[];artworkSpan?:{endSceneId:string};artwork:DocumentaryArtwork;previewImages:Array<{number:number;t:number}>;stagingReview?:string;
            sceneDirection?:DocumentarySceneDirection;
            temporalReview:ReturnType<typeof reviewArtworkTemporal>;
            sourceCatalog?:Array<{sourceSceneId:string;kind:'image'|'video';previewImage:number;previewSeconds:number;previewSha256:string;variants:Array<{name:'original'|'foreground';status:'actual'|'on-request'}>}>}>;
          for(const original of originals){
            const first=all.findIndex(scene=>scene.id===original.sceneId);
            const last=original.artworkSpan?all.findIndex(scene=>scene.id===original.artworkSpan!.endSceneId):first;
            const preview=previewByScene.get(original.sceneId);
            if(!preview)throw new DocumentarySemanticMontageError('Визуальная доработка: отсутствуют кадры сцены.');
            const previewImages=preview.frames.map(frame=>{images.push(frame.image);return {number:images.length,t:frame.t};});
            rows.push({sceneId:original.sceneId,narration:all.slice(first,last+1).map(scene=>scene.narration),
              ...(original.artworkSpan?{artworkSpan:original.artworkSpan}:{}),artwork:artworkForRevision(original.artwork),previewImages,
              ...(all[first]?.documentary?.semanticMontage?.sceneDirection?{sceneDirection:all[first]!.documentary!.semanticMontage!.sceneDirection}:{}),
              temporalReview:reviewArtworkTemporal(original.artwork,all[first]?.documentary?.semanticMontage?.sceneDirection,
                originals[originals.indexOf(original)-1]?.artwork,preview.frames.map(f=>f.t)),
              ...(!assessArtworkReplacement(original.artwork).allowReplacement?{stagingReview:'The layers show no clear change of dominant observation or newly readable detail. Check the actual frames and restage the reveal; another crop or camera drift alone does not resolve this.'}:{})});
          }
          const sourcePreviews=await motionArtworkPreviews(project,JSON.stringify({scenes:rows.map(row=>({sceneId:row.sceneId,editable:true}))}),root,signal);
          const sourceRows=JSON.parse(sourcePreviews.input) as {scenes:Array<{sourceCatalog?:typeof rows[number]['sourceCatalog']}>};
          const imageOffset=images.length;
          rows.forEach((row,i)=>{
            const catalog=sourceRows.scenes[i]?.sourceCatalog;
            if(catalog?.length)row.sourceCatalog=catalog.map(item=>({...item,previewImage:item.previewImage+imageOffset}));
          });
          images.push(...sourcePreviews.images);
          const contextRows=(scenes:Scene[])=>scenes.map(scene=>({sceneId:scene.id,narration:scene.narration}));
          const input=JSON.stringify({version:1,motionArtwork:1,motionArtworkRevision:1,aspect:project.aspectRatio,
            language:project.language,storyContext:{...(manifest.storyContext??documentaryAiPlanContext(project)),brief:project.videoBrief?.prompt?.slice(0,1000),
              preceding:contextRows(all.slice(Math.max(0,from-2),from)),batch:contextRows(batch),
              following:contextRows(all.slice(until,Math.min(all.length,until+2)))},scenes:rows});
          await atomicWrite(attemptPath,JSON.stringify({version:1,inputHash,from,requiresRenderCheck:true,
            inputSha256:createHash('sha256').update(input).digest('hex'),previewCount:images.length,
            analysisKey:documentaryCheckpointKey('semantic-montage',motionArtworkRevisionSystem,input,images)}));
          response=await options.revision.complete(motionArtworkRevisionSystem,input,images);
          await atomicWrite(revisionReceipt,JSON.stringify(response));
          if(!useLegacy)processedV2=true;}
        if(!Array.isArray(response.scenes))throw new DocumentarySemanticMontageError('Визуальная доработка: ответ без массива сцен сохранён.');
        const byId=new Map(revisionCandidates.map(candidate=>[candidate.row.sceneId,candidate]));
        const seen=new Set<string>(),issues:string[]=[];let accepted=0;
        const replacements:Array<{index:number;row:typeof originals[number]}>=[];
        for(const proposal of response.scenes as Array<{sceneId?:string;artwork?:unknown;artworkSpan?:{endSceneId?:string}}>){
          const entry=byId.get(proposal?.sceneId??'');
          if(!entry||seen.has(entry.row.sceneId)){issues.push('неизвестная или повторная сцена');continue;}
          seen.add(entry.row.sceneId);
          if(proposal.artworkSpan&&proposal.artworkSpan.endSceneId!==entry.row.artworkSpan?.endSceneId){
            issues.push(`${entry.row.sceneId}: изменён интервал рисунка`);continue;
          }
          if((proposal.artwork as Partial<DocumentaryArtwork>|undefined)?.motionCoordinates!=='absolute'){
            issues.push(`${entry.row.sceneId}: доработка вернула не абсолютные координаты`);continue;
          }
          const first=all.findIndex(scene=>scene.id===entry.row.sceneId);
          const last=entry.row.artworkSpan?all.findIndex(scene=>scene.id===entry.row.artworkSpan!.endSceneId):first;
          const scene=all[first]!;
          const context=all.slice(Math.max(0,first-1),Math.min(all.length,last+2)).map(member=>member.narration).join(' ');
          const seconds=all.slice(first,last+1).reduce((sum,member)=>sum+montageFrames(member)/30,0);
          const protectedProposal=preserveArtworkManualLayers(entry.row.artwork,proposal.artwork as DocumentaryArtwork);
          if(!protectedProposal){issues.push(`${entry.row.sceneId}: доработка удалила вручную изменённый объект`);continue;}
          const checked=validateMotionArtwork(protectedProposal,context,seconds,Boolean(scene.imagePath||scene.videoPath),outputAspect,
            {...scene.documentary?.selected,contain:scene.documentary?.layout==='contain'||scene.documentary?.layout==='compare',
              mediaAllowed:Boolean(scene.documentary?.semanticMontage?.artworkBrief)||scene.documentary?.semanticMontage?.artworkMode!=='standalone',
              currentSceneId:scene.id,allowedSources:artworkSourceCandidates(project,scene.id)},Boolean(entry.row.artworkSpan));
          if(!checked.artwork||entry.row.artworkSpan&&(checked.artwork.layout!=='full'||checked.artwork.layers.some(layer=>layer.kind==='media'))){
            issues.push(`${entry.row.sceneId}: ${checked.issue??'invalid span artwork'}`);continue;
          }
          const quality=assessArtworkReplacement(checked.artwork);
          if(!quality.allowReplacement){issues.push(`${entry.row.sceneId}: ${quality.reason}`);continue;}
          if(manifest.directionVersion===1){
            const temporal=reviewArtworkTemporal(checked.artwork,scene.documentary?.semanticMontage?.sceneDirection);
            const failures=temporal.findings.filter(f=>['no-object-state-change','invisible-action','missing-beat-object'].includes(f.code));
            if(failures.length){issues.push(`${entry.row.sceneId}: доработка не исправила ${failures.map(f=>`${f.code} [${f.layers.join(', ')}]`).join('; ')}`);continue;}
          }
          replacements.push({index:entry.index,row:{...entry.row,artwork:checked.artwork}});
        }
        for(const original of originals)if(!seen.has(original.sceneId))issues.push(`${original.sceneId}: нет доработки`);
        // The editor saw the originals, not its own replacements. Render the
        // changed result locally before adopting it, without another AI call.
        // Keep this evidence separate from immutable paid responses and bind it
        // to the exact normalized drawings so resume cannot apply a failed edit.
        let renderCheck:'rendered'|'failed'|'unavailable'='unavailable';
        const requiresRenderCheck=attempt?.requiresRenderCheck===true||!savedRevision;
        if(replacements.length){
          const rows=replacements.map(({row})=>({sceneId:row.sceneId,artwork:row.artwork,
            ...(row.artworkSpan?{endSceneId:row.artworkSpan.endSceneId}:{})}));
          const artworkSha256=createHash('sha256').update(JSON.stringify(rows)).digest('hex');
          const checkPath=join(directory,`${useLegacy?`${legacyPrefix}.coordinates-v2`:prefix}.render-check.json`);
          const priorCheck=await read(checkPath) as {artworkSha256?:string;status?:string;message?:string}|undefined;
          if(priorCheck?.artworkSha256===artworkSha256&&priorCheck.status==='rendered')renderCheck='rendered';
          else if(options.revision){
            try{
              const previews=await options.revision.preview(rows,signal);
              validateArtworkRevisionPreviews(rows,previews);
              await atomicWrite(checkPath,JSON.stringify({version:1,inputHash,from,artworkSha256,status:'rendered',
                scope:'technical-temporal-render-not-artistic-verdict',scenes:previews.map(row=>({sceneId:row.sceneId,
                  temporalReview:reviewArtworkTemporal(rows.find(r=>r.sceneId===row.sceneId)!.artwork,
                    all.find(s=>s.id===row.sceneId)?.documentary?.semanticMontage?.sceneDirection,undefined,row.frames.map(f=>f.t)),frames:row.frames.map(frame=>({t:frame.t,
                  sha256:createHash('sha256').update(frame.image).digest('hex')}))}))}));
              renderCheck='rendered';
            }catch(error){
              signal?.throwIfAborted();
              const message=error instanceof Error?error.message:String(error);
              await atomicWrite(checkPath,JSON.stringify({version:1,inputHash,from,artworkSha256,status:'failed',message}));
              renderCheck='failed';issues.push(`исходный рисунок сохранён: техническая проверка новых кадров не пройдена (${message})`);
            }
          }else if(priorCheck?.artworkSha256===artworkSha256&&priorCheck.status==='failed'){
            renderCheck='failed';issues.push(`исходный рисунок сохранён: техническая проверка новых кадров не пройдена (${priorCheck.message??'сохранённый отказ'})`);
          }else if(requiresRenderCheck){
            issues.push('исходный рисунок сохранён: техническая проверка новых кадров ещё не завершена; полученная доработка сохранена для локального восстановления');
          }
          // Old receipts can still be repaired offline without a renderer.
          // Their explicit unavailable status must never be presented as review.
          if(renderCheck==='rendered'||renderCheck==='unavailable'&&!requiresRenderCheck)
            for(const {index,row} of replacements){result.scenes[index]=row;accepted++;}
        }
        await atomicWrite(join(directory,`${useLegacy?`${legacyPrefix}.coordinates-v2`:prefix}.validation.json`),
          JSON.stringify({version:1,inputHash,from,accepted,rejected:issues,renderCheck}));
        if(issues.length)revisionIssues.push(`Визуальная доработка порции ${from+1}: ${issues.slice(0,3).join('; ')}.`);
      }catch(error){
        signal?.throwIfAborted();
        const message=error instanceof Error?error.message:String(error);
        const failedPath=join(directory,`${useLegacy?`${legacyPrefix}.coordinates-v2`:prefix}.failed.json`);
        // Do not turn an invalid/legacy failure into valid resume permission,
        // or replace the original local/paid failure while handling a guard.
        if(await read(failedPath)===undefined)await atomicWrite(failedPath,JSON.stringify({version:1,inputHash,from,message}));
        revisionIssues.push(`Визуальная доработка порции ${from+1} недоступна: ${message}`);
      }
    }
    if(processedV2){
      const digest=(await completedV2RevisionHashes(directory,inputHash))[String(from)];
      if(digest)result.v2ReceiptHashes![String(from)]=digest;
    }
    finishBatchQuality();
  }
  if(options.savedOnly&&!processedPrimary.length)return cached!;
  if(options.offlinePrimary)result.incomplete='PRE-REVISION: восстановлен только завершённый первичный рисунок; визуальная редактура не завершена.';
  if(options.revalidateCompletedPrimary)result.incomplete='PRE-REVISION: завершённый первичный ответ проверен локально; визуальная редактура не завершена.';
  if(revisionIssues.length)result.incomplete=[result.incomplete,...revisionIssues].filter(Boolean).join(' ');
  if(result.incomplete||options.savedOnly)result.primaryBatches=processedPrimary;
  // Keep a small, reviewable failure record beside the immutable raw receipts.
  // Never convert an all-rejected result into a successful cached plan.
  await atomicWrite(join(directory,`${inputHash}-${options.offlinePrimary?'artwork-pre-revision-validation':'artwork-validation'}.json`),JSON.stringify({version:1,inputHash,model,
    rejected:result.rejected,...(result.incomplete?{incomplete:result.incomplete}:{})}));
  if(options.offlinePrimary&&!result.scenes.length&&result.rejected.length)
    throw new DocumentarySemanticMontageError(`${result.incomplete} ${result.rejected.slice(0,3).map(row=>`${row.sceneId}: ${row.reason}`).join('; ')}`);
  if(result.incomplete&&!result.scenes.length)throw new DocumentarySemanticMontageError(result.incomplete);
  if(result.rejected.length&&!result.scenes.length){
    const reasons=result.rejected.slice(0,3).map(({sceneId,reason})=>`${sceneId}: ${reason}`).join('; ');
    throw new DocumentarySemanticMontageError(`[no-retry] AI-графика: все композиции отклонены. Причины: ${reasons}${result.rejected.length>3?`; ещё ${result.rejected.length-3}`:''}. Полученные ответы сохранены.`);
  }
  await atomicWrite(file,JSON.stringify(result));
  return result;
}

export function attachMotionArtwork(plan:DocumentarySemanticMontage,artwork:ArtworkPlan,project?:Project):DocumentarySemanticMontage {
  const rows=new Map(artwork.scenes.map(s=>[s.sceneId,s]));
  const directions=plan.scenes,byScene=new Map(project?.scenes.map(scene=>[scene.id,scene])??[]);
  const explanations=directions.flatMap((direction,start)=>{
    if(!direction.explanation)return [];
    const end=direction.explanation.endSceneId?directions.findIndex(s=>s.sceneId===direction.explanation!.endSceneId):start;
    return [{start,end:Math.max(start,end)}];
  });
  const covered=new Set<number>(),replaced=new Set<number>(),attached=new Map<number,ArtworkPlan['scenes'][number]>();
  for(const [start,direction] of directions.entries()){
    const row=rows.get(direction.sceneId);if(!row||covered.has(start))continue;
    const end=row.artworkSpan?directions.findIndex(s=>s.sceneId===row.artworkSpan!.endSceneId):start;
    if(end<start||directions.slice(start,end+1).some((_,offset)=>covered.has(start+offset)))continue;
    const overlapping=explanations.filter(range=>range.start<=end&&range.end>=start);
    if(overlapping.length){
      // An artwork may supersede automatic icon grammar only as a complete,
      // self-contained standalone explanation of every touched interval.
      if(!project||row.artwork?.version!==1||row.artwork.layout!=='full'||!Array.isArray(row.artwork.layers)
        ||row.artwork.layers.some(layer=>layer.kind==='media')
        ||overlapping.some(range=>range.start<start||range.end>end)
        ||directions.slice(start,end+1).some(candidate=>{
          const scene=byScene.get(candidate.sceneId);
          return !scene||!artworkSceneEditable(scene)||!documentaryExplanationEditable(scene)
            ||candidate.chapter||documentaryMontageHasEvidence(scene,project.scenes);
        }))continue;
      overlapping.forEach(range=>replaced.add(range.start));
    }
    attached.set(start,row);
    for(let i=start;i<=end;i++)covered.add(i);
  }
  return {...plan,scenes:directions.map((direction,index)=>{
    const row=attached.get(index);
    if(row){const {explanation:_old,artwork:_oldArtwork,artworkSpan:_oldSpan,...base}=direction;
      return {...base,artwork:row.artwork,...(row.artworkSpan?{artworkSpan:row.artworkSpan}:{})};}
    if(replaced.has(index)){const {explanation:_old,artwork:_oldArtwork,artworkSpan:_oldSpan,...base}=direction;return base;}
    return direction;
  })};
}
