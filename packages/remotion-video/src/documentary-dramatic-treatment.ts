import {documentaryEase} from './documentary-design.js';

/** Sparse AI direction only. Ordinary scenes stay fully coloured and unshaded. */
export function documentaryDramaticTreatment(direction:{vignette?:boolean;monochrome?:boolean;monochromeStartSeconds?:number}|undefined,frame:number,frames:number,fps=30,accentStartSeconds=.25) {
  const exit=documentaryEase((frames-1-frame)/(fps*.3));
  const vignette=direction?.vignette?documentaryEase(frame/(fps*.6))*exit*.7:0;
  // First retain the actual colour, then visibly drain it through the emphasis.
  const start=direction?.monochromeStartSeconds??accentStartSeconds;
  const onset=Math.max(0,Math.min(frames-1,Number.isFinite(start)?start*fps:fps*.25));
  const monochrome=direction?.monochrome?documentaryEase((frame-onset)/Math.max(1,Math.min(fps*.85,(frames-1-onset)*.6))):0;
  return {vignette,filter:monochrome>0?`grayscale(${monochrome})`:undefined};
}
