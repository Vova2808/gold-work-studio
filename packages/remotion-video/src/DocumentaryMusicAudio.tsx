import {useMemo} from 'react';
import {Audio,Sequence,useCurrentFrame} from 'remotion';
import type {DocumentaryTimeline} from './documentary-timeline.js';
import {documentaryMusicClipGain,documentarySpeechRanges} from './documentary-music.js';
import {resolveMediaSource} from './MediaSurface.js';

export function DocumentaryMusicAudio({timeline}:{timeline:DocumentaryTimeline}) {
  const frame=useCurrentFrame();
  const speech=useMemo(()=>documentarySpeechRanges(timeline),[timeline.scenes]);
  if(!timeline.music || timeline.music.volume<=0)return null;
  return <>{timeline.music.clips.filter(clip=>clip.enabled&&clip.status==='ready'&&clip.path&&clip.volume>0).map(clip=>
    <Sequence key={clip.id} from={Math.round(clip.startSeconds*timeline.fps)} durationInFrames={Math.max(1,Math.round(clip.durationSeconds*timeline.fps))} layout="none">
      {/* Shift the full source rather than trimming its head: loops must wrap to source zero after a split. */}
      <Sequence from={-Math.round(clip.sourceOffsetSeconds*timeline.fps)} layout="none">
        <Audio src={resolveMediaSource(clip.path!)} loop={clip.loop===true}
          volume={()=>documentaryMusicClipGain(timeline,clip,frame/timeline.fps,speech)} />
      </Sequence>
    </Sequence>)}</>;
}
