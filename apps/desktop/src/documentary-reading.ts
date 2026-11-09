import {createHash} from 'node:crypto';
import {mkdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {Project,Scene} from '@gold-work/shared';
import {matchDocumentaryReading} from '@gold-work/shared';
import {localSpeechWords} from './local-speech-recognition.js';
import {runFfmpeg} from './standard-renderer.js';

/** Prepare only requested reading overlays. Original narration/audio are immutable. */
export async function prepareDocumentaryReading(project:Project,directory:string,notice:(message:string)=>void,signal?:AbortSignal):Promise<{scenes:Scene[];warnings:string[]}>{
  const scenes:Scene[]=[],warnings:string[]=[];
  for(const scene of project.scenes){
    const graphic=scene.documentary?.motionGraphic;
    if(scene.includeInAssembly===false||!graphic?.enabled||graphic.kind!=='quote'||graphic.quoteMode==='phrase'){scenes.push(scene);continue;}
    const next=structuredClone(scene),g=next.documentary!.motionGraphic!;g.reading=undefined;g.readingError=undefined;
    try{
      const timing=scene.documentary?.timing,audio=timing?.audioPath;
      if(!project.settings.voice.enabled||!audio)throw Error('Для выделения по словам нужна готовая озвучка');
      const info=await stat(audio),start=timing.audioStartSeconds??0,end=timing.audioEndSeconds??timing.speechSeconds;
      const key=createHash('sha256').update(JSON.stringify([audio,info.size,info.mtimeMs,start,end])).digest('hex');
      await mkdir(directory,{recursive:true});const wav=join(directory,`${key}.wav`);
      if(!await stat(wav).then(s=>s.size>0,()=>false))await runFfmpeg(['-y','-ss',String(start),'-i',audio,'-t',String(end-start),'-ar','16000','-ac','1','-c:a','pcm_s16le',wav],undefined,signal);
      const words=await localSpeechWords(wav,directory,notice,signal),matched=matchDocumentaryReading(g.title,words);
      if(!matched)throw Error('Распознанная речь не совпала с полным текстом плашки; равномерные выдуманные тайминги не применены');
      g.reading={text:g.title,sourceKey:timing.sourceKey,words:matched.map(w=>({...w,startSeconds:w.startSeconds-g.startSeconds,endSeconds:w.endSeconds-g.startSeconds}))};
    }catch(error){signal?.throwIfAborted();g.readingError=error instanceof Error?error.message:String(error);warnings.push(`Сцена ${scene.order+1}: ${g.readingError}. Текст сохранён без выделения по речи.`);notice(warnings.at(-1)!);}
    scenes.push(next);
  }
  return {scenes,warnings};
}
