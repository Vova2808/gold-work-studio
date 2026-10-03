import type {DocumentaryTimeline} from './documentary-timeline.js';

/** Merge adjacent speech into envelopes: music must not pump at every edit. */
export function documentarySpeechRanges(timeline:DocumentaryTimeline):Array<[number,number]> {
  const ranges:Array<[number,number]>=[];
  for(const scene of timeline.scenes){
    if(!scene.narrationEnabled||!scene.documentary?.timing?.audioPath||(scene.narrationVolume??100)<=0)continue;
    const start=scene.fromFrame/timeline.fps;
    const end=start+Math.min(scene.durationInFrames/timeline.fps,scene.documentary.timing.speechSeconds);
    if(end<=start)continue;
    const previous=ranges.at(-1);
    if(previous&&start-previous[1]<=.6)previous[1]=Math.max(previous[1],end);
    else ranges.push([start,end]);
  }
  return ranges;
}

const clamp=(value:number)=>Math.max(0,Math.min(1,value));
export function documentaryMusicGain(timeline:DocumentaryTimeline,seconds:number,ranges=documentarySpeechRanges(timeline)) {
  const music=timeline.music;if(!music)return 0;
  const duration=timeline.durationInFrames/timeline.fps;
  const fade=Math.min(music.fadeInSeconds?clamp(seconds/music.fadeInSeconds):1,music.fadeOutSeconds?clamp((duration-seconds)/music.fadeOutSeconds):1);
  let speech=0;
  if(music.ducking)for(const [start,end] of ranges)speech=Math.max(speech,Math.min(clamp((seconds-start+.18)/.18),clamp((end+.6-seconds)/.6)));
  return music.volume/100*fade*(1-.7*speech);
}

/** Same global-time envelope as preview; filter scripts avoid command limits. */
export function documentaryMusicGainExpression(timeline:DocumentaryTimeline) {
  const music=timeline.music;if(!music)return '0';
  const duration=timeline.durationInFrames/timeline.fps;
  const fadeIn=music.fadeInSeconds?`min(1,max(0,t/${music.fadeInSeconds}))`:'1';
  const fadeOut=music.fadeOutSeconds?`min(1,max(0,(${duration}-t)/${music.fadeOutSeconds}))`:'1';
  const ranges=music.ducking?documentarySpeechRanges(timeline):[];
  const speech=ranges.map(([a,b])=>`min(min(1,max(0,(t-${a}+.18)/.18)),min(1,max(0,(${b}+.6-t)/.6)))`).reduce((a,b)=>`max(${a},${b})`,'0');
  return `${music.volume/100}*min(${fadeIn},${fadeOut})*(1-.7*${speech})`;
}
