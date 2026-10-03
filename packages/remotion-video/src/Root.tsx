import { Composition, Img, type AnyZodObject } from "remotion";
import { UniversalVideo } from "./UniversalVideo.js";
import { DocumentaryVideo } from "./DocumentaryVideo.js";
import { DEFAULT_DOCUMENTARY_TIMELINE, type DocumentaryTimeline } from "./documentary-timeline.js";
import {
  DEFAULT_TIMELINE,
  getTimelineDimensions,
  getTimelineDurationInFrames,
  normalizeUniversalTimeline,
} from "./timeline.js";
import type { UniversalTimeline } from "./types.js";

export const UNIVERSAL_COMPOSITION_ID = "GoldWorkUniversal";
export const DOCUMENTARY_COMPOSITION_ID = "GoldWorkDocumentaryV2";
const CityMapRaster=({source}:{source:string})=><Img src={source} style={{width:'100%',height:'100%'}}/>;

export const RemotionRoot = () => (
  <>
  <Composition<AnyZodObject,{source:string}> id="GoldWorkMapRaster" component={CityMapRaster} defaultProps={{source:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E'}} width={2400} height={2400} fps={30} durationInFrames={1}/>
  <Composition<AnyZodObject, UniversalTimeline>
    id={UNIVERSAL_COMPOSITION_ID}
    component={UniversalVideo}
    defaultProps={DEFAULT_TIMELINE}
    durationInFrames={DEFAULT_TIMELINE.durationInFrames}
    fps={DEFAULT_TIMELINE.fps}
    width={DEFAULT_TIMELINE.width}
    height={DEFAULT_TIMELINE.height}
    calculateMetadata={({ props }) => {
      const timeline = normalizeUniversalTimeline(props);
      const dimensions = getTimelineDimensions(timeline);
      return {
        durationInFrames: getTimelineDurationInFrames(timeline),
        fps: timeline.fps,
        width: dimensions.width,
        height: dimensions.height,
        props: timeline,
      };
    }}
  />
  <Composition<AnyZodObject, DocumentaryTimeline> id={DOCUMENTARY_COMPOSITION_ID} component={DocumentaryVideo} defaultProps={DEFAULT_DOCUMENTARY_TIMELINE}
    fps={30} width={1920} height={1080} durationInFrames={30}
    calculateMetadata={({ props }) => ({ fps: props.fps, width: props.width, height: props.height, durationInFrames: props.durationInFrames })} />
  </>
);
