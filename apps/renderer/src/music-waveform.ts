export interface MusicWaveform { durationSeconds:number; peaks:number[] }
const cache=new Map<string,Promise<MusicWaveform>>();
let pending:Promise<unknown>=Promise.resolve();

/** Decode one source at a time. Keep only small real peak arrays, not PCM buffers. */
export function loadMusicWaveform(url:string):Promise<MusicWaveform> {
  const cached=cache.get(url);if(cached)return cached;
  const task=pending.catch(()=>undefined).then(async()=>{
    const response=await fetch(url);
    if(!response.ok)throw Error('Аудиофайл недоступен');
    const bytes=await response.arrayBuffer();
    const context=new OfflineAudioContext(1,1,12000);
    const audio=await context.decodeAudioData(bytes);
    const count=Math.min(8192,Math.max(64,Math.ceil(audio.duration*24)));
    const peaks=new Array<number>(count).fill(0);
    for(let channel=0;channel<audio.numberOfChannels;channel++){
      const samples=audio.getChannelData(channel);
      for(let bin=0;bin<count;bin++){
        const start=Math.floor(bin*samples.length/count),end=Math.floor((bin+1)*samples.length/count);
        let peak=peaks[bin]!;
        for(let i=start;i<end;i++)peak=Math.max(peak,Math.abs(samples[i]!));
        peaks[bin]=peak;
      }
    }
    return {durationSeconds:audio.duration,peaks};
  });
  cache.set(url,task);pending=task;
  if(cache.size>32)cache.delete(cache.keys().next().value!);
  void task.catch(()=>{if(cache.get(url)===task)cache.delete(url);});
  return task;
}
