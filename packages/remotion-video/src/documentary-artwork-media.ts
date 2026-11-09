type Box = {x: number; y: number; w: number; h: number};
type Canvas = {width: number; height: number};

/** Literal window in original-source coordinates; fitting never stretches or invents detail. */
export function artworkViewportGeometry(box:Pick<Box,'w'|'h'>,aspect:number,window={x:0,y:0,w:1,h:1}){
  const cropAspect=aspect*window.w/window.h;
  const w=Math.min(box.w,box.h*cropAspect),h=w/cropAspect;
  return {frame:{x:(box.w-w)/2,y:(box.h-h)/2,w,h},
    source:{x:-window.x*w/window.w,y:-window.y*h/window.h,w:w/window.w,h:h/window.h}};
}

/** One fixed layout correction: fit the actual contained source, never a second film-shaped box. */
export function artworkMediaFraming(box: Box, canvas: Canvas, outputAspect: number, sourceAspect?: number,
  sourceFit: 'contain' | 'cover' = 'cover') {
  const output = Number.isFinite(outputAspect) && outputAspect > 0 ? outputAspect : 16 / 9;
  const aspect = sourceFit === 'contain' && Number.isFinite(sourceAspect) && sourceAspect! > 0 ? sourceAspect! : output;
  const fit = (padding: number) => Math.min((output - 2 * padding) / canvas.width, (1 - 2 * padding) / canvas.height);
  const visible = (w: number, h: number) => {
    const width = Math.min(w, h * aspect);
    return width * width / aspect;
  };
  const fullArea = visible(canvas.width, canvas.height);
  const target = Math.min(.4, fullArea * fit(0) ** 2 / output);
  let padding = .035 * Math.min(output, 1);
  // A portrait may already fill the canvas height. Relax only the outer safe
  // inset before asking for impossible extra height or cropping its subject.
  if (fullArea * fit(padding) ** 2 / output < target) {
    const requiredFit = Math.sqrt(target * output / fullArea);
    padding = Math.max(0, Math.min(padding, (output - canvas.width * requiredFit) / 2,
      (1 - canvas.height * requiredFit) / 2));
  }
  const scale = fit(padding), area = target * output / (scale * scale);
  const w = Math.min(canvas.width, Math.max(box.w, Math.sqrt(area * aspect)));
  const h = Math.min(canvas.height, Math.max(box.h, Math.sqrt(area / aspect)));
  const framed = {x: Math.max(0, Math.min(canvas.width - w, box.x - (w - box.w) / 2)),
    y: Math.max(0, Math.min(canvas.height - h, box.y - (h - box.h) / 2)), w, h};
  return {box: framed, aspect, paddingFraction: padding / Math.min(output, 1),
    visibleFraction: visible(w, h) * scale * scale / output, maximumFraction: fullArea * fit(0) ** 2 / output};
}
