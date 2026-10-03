import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,readFile,rename,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir,freemem} from 'node:os';
import {createRequire} from 'node:module';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {Worker} from 'node:worker_threads';
import {Tokenizer} from '@huggingface/tokenizers';
import {effectFfmpeg} from './effect-media.js';
import {documentaryAvailableMemory,withDocumentaryFrameSlot} from './documentary-resources.js';

const revision='d15189d7028b43f1d3e65039190477f6af591c2a';
const base=`https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/${revision}`;
const modelHash='0898a3facfdb27f0a041e57649b4989cfd094e4a0040d6ae75ed69917dfc7328';
const modelRoot=join(process.env.LOCALAPPDATA??homedir(),'GoldWorkStudio','Models','clip-vit-b32-q8');
const require=createRequire(typeof __filename==='string'?__filename:import.meta.url);
let prepared:Promise<string>|undefined;

/** Optional local shortlist only: cosine similarity is never identity, era,
 * technical-quality or final-range evidence. No paid service/settings change. */
export async function ensureDocumentaryLocalVision(notice:(text:string)=>void=()=>{}):Promise<string>{
  if(prepared)return prepared;
  prepared=(async()=>{
    await mkdir(modelRoot,{recursive:true});
    for(const name of ['model_quantized.onnx','tokenizer.json','tokenizer_config.json']){
      const target=join(modelRoot,name);
      let valid=await stat(target).then(s=>s.size>0,()=>false);
      if(valid&&name.endsWith('.onnx')){
        const hash=createHash('sha256');for await(const chunk of createReadStream(target))hash.update(chunk);
        valid=hash.digest('hex')===modelHash;
      }
      if(valid)continue;
      notice('Подготавливаю локальный предварительный отбор изображений (модель 147 МБ)…');
      const response=await fetch(`${base}/${name.endsWith('.onnx')?'onnx/':''}${name}`,{signal:AbortSignal.timeout(180000)});
      if(!response.ok||!response.body)throw Error(`Локальная модель: HTTP ${response.status}`);
      const partial=`${target}.partial`;
      try{
        await pipeline(Readable.fromWeb(response.body as any),createWriteStream(partial));
        if(name.endsWith('.onnx')){
          const hash=createHash('sha256');for await(const chunk of createReadStream(partial))hash.update(chunk);
          if(hash.digest('hex')!==modelHash)throw Error('Не совпала контрольная сумма локальной модели');
        }else JSON.parse(await readFile(partial,'utf8'));
        await rename(partial,target);
      }finally{await rm(partial,{force:true});}
    }
    return modelRoot;
  })().catch(error=>{prepared=undefined;throw error;});
  return prepared;
}

// Native inference lives in a disposable worker, not Electron's UI/main event
// loop. Termination releases the model, ORT arena and tokenizer after the job.
const workerCode=`
const {parentPort,workerData:d}=require('node:worker_threads');
const {InferenceSession,Tensor}=require(d.runtime);
(async()=>{
 const session=await InferenceSession.create(d.model,{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1,enableCpuMemArena:false});
 try{
  const scores=[];
  for(const pixels of d.images){
   const size=224*224,data=new Float32Array(size*3),mean=[.48145466,.4578275,.40821073],std=[.26862954,.26130258,.27577711];
   for(let i=0;i<size;i++)for(let c=0;c<3;c++)data[c*size+i]=(pixels[i*3+c]/255-mean[c])/std[c];
   const ids=new Tensor('int64',BigInt64Array.from(d.ids,BigInt),[d.count,d.length]);
   const mask=new Tensor('int64',BigInt64Array.from(d.mask,BigInt),[d.count,d.length]);
   const feeds={input_ids:ids,pixel_values:new Tensor('float32',data,[1,3,224,224])};
   if(session.inputNames.includes('attention_mask'))feeds.attention_mask=mask;
   const result=await session.run(feeds),image=result.image_embeds,text=result.text_embeds;
   if(!image||!text)throw Error('Local CLIP embeddings unavailable');
   const a=image.data,values=[];
   for(let q=0;q<d.count;q++){
    let dot=0,aa=0,bb=0;
    for(let i=0;i<a.length;i++){const b=text.data[q*a.length+i];dot+=a[i]*b;aa+=a[i]*a[i];bb+=b*b;}
    values.push(dot/Math.sqrt(aa*bb));
   }
   scores.push(values);
  }
  parentPort.postMessage({scores,rss:process.memoryUsage().rss});
 }finally{await session.release();}
})().catch(error=>parentPort.postMessage({error:String(error)}));`;

let queue:Promise<unknown>=Promise.resolve();
export async function rankDocumentaryLocalImages(files:string[],queries:string[],cacheRoot:string,notice:(text:string)=>void=()=>{}):Promise<{scores:number[][];seconds:number;rss:number}|undefined>{
  const job=queue.catch(()=>{}).then(async()=>{
    // Keep Windows/Electron headroom. Optional ranking can always fall back
    // to the existing remote shortlist without approving or dropping a source.
    if(!files.length||files.length>10||!queries.length||queries.length>8)return;
    if(Math.min(freemem(),await documentaryAvailableMemory())<1.75*1024**3)return;
    const root=await ensureDocumentaryLocalVision(notice),started=performance.now();
    await mkdir(cacheRoot,{recursive:true});
    const tokenizer=new Tokenizer(JSON.parse(await readFile(join(root,'tokenizer.json'),'utf8')),JSON.parse(await readFile(join(root,'tokenizer_config.json'),'utf8')));
    const encoded=queries.map(text=>{const ids=tokenizer.encode(text).ids;return ids.length<=77?ids:[...ids.slice(0,76),49407];});
    const length=Math.max(...encoded.map(ids=>ids.length));
    const ids=encoded.flatMap(row=>Array.from({length},(_,i)=>row[i]??49407));
    const mask=encoded.flatMap(row=>Array.from({length},(_,i)=>i<row.length?1:0));
    const images:Buffer[]=[];
    for(const file of files){
      const info=await stat(file),key=createHash('sha256').update(JSON.stringify([file,info.size,info.mtimeMs,'clip-rgb-v1'])).digest('hex');
      const path=join(cacheRoot,`${key}.rgb`);
      let pixels=await readFile(path).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
      if(!pixels){
        const partial=`${path}.partial`;
        try{
          await withDocumentaryFrameSlot(()=>effectFfmpeg(['-y','-i',file,'-frames:v','1','-vf','scale=224:224:force_original_aspect_ratio=increase:flags=bicubic,crop=224:224','-pix_fmt','rgb24','-f','rawvideo',partial],AbortSignal.timeout(15000)));
          pixels=await readFile(partial);await rename(partial,path);
        }finally{await rm(partial,{force:true});}
      }
      if(pixels.length!==224*224*3)throw Error('Неполные пиксели локального предварительного отбора');
      images.push(pixels);
    }
    if(Math.min(freemem(),await documentaryAvailableMemory())<1.75*1024**3)return;
    const worker=new Worker(workerCode,{eval:true,workerData:{runtime:require.resolve('onnxruntime-node'),model:join(root,'model_quantized.onnx'),images,ids,mask,count:queries.length,length},resourceLimits:{maxOldGenerationSizeMb:128}});
    try{
      const result=await new Promise<{scores:number[][];rss:number}>((resolve,reject)=>{
        const timeout=setTimeout(()=>{void worker.terminate();reject(Error('Локальный отбор превысил 30 секунд'));},30000);
        worker.once('message',result=>{clearTimeout(timeout);result.error?reject(Error(result.error)):resolve(result);});
        worker.once('error',error=>{clearTimeout(timeout);reject(error);});
        // Even a clean premature exit must settle the queue. Rejecting after
        // a successful message is harmless because the promise is settled.
        worker.once('exit',code=>{clearTimeout(timeout);reject(Error(`Local vision worker exited before returning a result (${code})`));});
      });
      return {...result,seconds:(performance.now()-started)/1000};
    }finally{await worker.terminate();}
  });queue=job;return job;
}
