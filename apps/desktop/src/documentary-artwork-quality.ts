import type {DocumentaryArtwork, DocumentaryArtworkLayer as Layer} from '@gold-work/shared';

export interface ArtworkReplacementDecision {
  allowReplacement: boolean;
  reason: 'single-source-annotation' | 'static-media-board' | 'no-illustrated-subject' | 'outside-simple-annotation-pattern';
}

/** Structural evidence of a reveal, not a claim that the crop has the right
 * identity or meaning. That requires the visual editor's actual source frames.
 * Inspect authored states: simply moving/fading one picture, or adding another
 * equally readable crop, cannot win by increasing the number of media layers. */
function mediaReveal(artwork:DocumentaryArtwork,media:Layer[]):boolean{
  const phases=[...new Set([0,1,...media.flatMap(layer=>(layer.keyframes??[]).map(key=>key.t))])].sort((a,b)=>a-b);
  const window=(layer:Layer)=>layer.sourceWindow??{x:0,y:0,w:1,h:1};
  const source=(layer:Layer)=>layer.sourceSceneId??'current';
  const distinct=(a:Layer,b:Layer)=>source(a)!==source(b)||JSON.stringify(window(a))!==JSON.stringify(window(b));
  const states=phases.map(t=>media.map(layer=>{
    let x=0,y=0,scale=1,opacity=1;
    for(const key of layer.keyframes??[]){
      if(key.t>t)break;
      if(key.x!==undefined)x=key.x-(artwork.motionCoordinates==='absolute'?layer.x:0);
      if(key.y!==undefined)y=key.y-(artwork.motionCoordinates==='absolute'?layer.y:0);
      scale=key.scale??scale;opacity=key.opacity??opacity;
    }
    const w=layer.w*scale,h=layer.h*scale,left=layer.x+x+(layer.w-w)/2,top=layer.y+y+(layer.h-h)/2;
    const area=Math.max(0,Math.min(artwork.canvas.width,left+w)-Math.max(0,left))
      *Math.max(0,Math.min(artwork.canvas.height,top+h)-Math.max(0,top))*opacity;
    return {area,density:w*h/(window(layer).w*window(layer).h),opacity};
  }));
  const substantial=artwork.canvas.width*artwork.canvas.height*.12;
  const dominant=(state:typeof states[number],i:number)=>state[i]!.area>=substantial
    &&state[i]!.area>=state.reduce((sum,item)=>sum+item.area,0)*.7;
  for(let before=0;before<phases.length;before++)for(let after=before+1;after<phases.length;after++){
    if(phases[after]!-phases[before]!<.12)continue;
    const start=states[before]!,end=states[after]!;
    for(let a=0;a<media.length;a++)for(let b=0;b<media.length;b++){
      if(a===b||!distinct(media[a]!,media[b]!)||!dominant(start,a)||end[b]!.area<substantial)continue;
      // A different observed view takes over; equal side-by-side panels alone
      // do not establish this change of focus.
      if(dominant(end,b)&&!dominant(start,b))return true;
      // A legible detail newly appears at >=2x linear magnification while the
      // whole stays visible. A changing crop number alone is insufficient.
      const whole=window(media[a]!),detail=window(media[b]!);
      if(source(media[a]!)===source(media[b]!)&&(media[b]!.sourceVariant??'original')==='original'
        &&detail.x>=whole.x&&detail.y>=whole.y&&detail.x+detail.w<=whole.x+whole.w+1e-6
        &&detail.y+detail.h<=whole.y+whole.h+1e-6&&start[b]!.opacity<=.1&&end[b]!.opacity>=.9
        &&end[a]!.area>=substantial&&end[b]!.density>=start[a]!.density*4)return true;
    }
  }
  return false;
}

/**
 * A narrow regression guard for choosing automatic final graphics, not artistic
 * validation. An annotated source is useful in its own right, but must not
 * displace an already available native editorial composition. Keep the authored
 * artwork/paid receipt intact; manual selection is outside this policy.
 * Passing means only that this particular failure pattern was not recognized.
 */
export function assessArtworkReplacement(artwork: DocumentaryArtwork): ArtworkReplacementDecision {
  const pass: ArtworkReplacementDecision = {allowReplacement: true, reason: 'outside-simple-annotation-pattern'};
  const media = artwork.layers.filter(layer => layer.kind === 'media');
  const {width, height} = artwork.canvas;
  const shortSide = Math.min(width, height);
  const texts = artwork.layers.filter(layer => layer.kind === 'text' && layer.text?.trim());
  const contains = (outer: Layer, inner: Layer, tolerance = shortSide * .015) =>
    outer.x <= inner.x + tolerance && outer.y <= inner.y + tolerance
    && outer.x + outer.w >= inner.x + inner.w - tolerance
    && outer.y + outer.h >= inner.y + inner.h - tolerance;
  const annotationPart = (layer: Layer): boolean => {
    if (layer.kind === 'media' || layer.kind === 'text' || layer.kind === 'group') return true;
    if (layer.kind === 'rect') {
      const rule = Math.min(layer.w, layer.h) <= shortSide * .015;
      const textSurface = texts.some(text => text.parentId === layer.parentId && contains(layer, text));
      const sourceFrame = media.length === 1 && contains(layer, media[0]!) && contains(media[0]!, layer);
      const canvasBackground = layer.x <= 1 && layer.y <= 1 && layer.w >= width - 1 && layer.h >= height - 1;
      return rule || textSurface || sourceFrame || canvasBackground;
    }
    if (layer.kind === 'ellipse') return Math.max(layer.w, layer.h) <= shortSide * .035;
    if (layer.kind === 'path') {
      // Inspect path commands, not its declared bounding box: a diagonal line
      // can claim the entire canvas. Closed drawings are not simple connectors.
      const commands = layer.path?.match(/[a-df-z]/giu) ?? [];
      return !commands.some(command => command.toLowerCase() === 'z')
        && commands.filter(command => command.toLowerCase() !== 'm').length <= 3;
    }
    return false;
  };
  // A standalone board assembled only from captions, text plates, rules and
  // connector strokes adds no pictured subject. Linked geometry is rendered
  // separately and does not appear in the layer list.
  if (media.length === 0) return artwork.linkedMechanism || !artwork.layers.every(annotationPart)
    ? pass : {allowReplacement: false, reason: 'no-illustrated-subject'};
  if(!artwork.layers.every(annotationPart)||mediaReveal(artwork,media))return pass;
  return {allowReplacement:false,reason:media.length===1?'single-source-annotation':'static-media-board'};
}
