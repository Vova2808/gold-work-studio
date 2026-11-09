import {effectFfmpeg} from './effect-media.js';

/** Read packet timestamps from one stream, without decoding or trusting the
 * container duration (a full audio track can hide a truncated video track). */
export async function assertDocumentaryStreamDuration(path:string,kind:'video'|'audio',seconds:number,signal?:AbortSignal):Promise<void>{
  const output=await effectFfmpeg(['-v','error','-nostats','-progress','pipe:2','-i',path,
    '-map',kind==='video'?'0:v:0':'0:a:0','-c','copy','-f','null','-'],signal);
  const timestamps=[...output.matchAll(/out_time_us=(-?\d+)/g)];
  const actual=Number(timestamps.at(-1)?.[1])/1_000_000;
  // H.264 B-frame DTS trails presentation time by up to three 30fps frames.
  if(!Number.isFinite(actual)||Math.abs(actual-seconds)>.15){
    throw new Error(`Неверная длительность ${kind==='video'?'видеоряда':'аудиодорожки'}: ${actual.toFixed(3)} с вместо ${seconds.toFixed(3)} с. Пересоберите фрагмент.`);
  }
}
