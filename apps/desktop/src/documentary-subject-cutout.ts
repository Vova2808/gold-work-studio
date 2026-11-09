import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,rename,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import ffmpeg from 'ffmpeg-static';
import {InferenceSession,Tensor} from 'onnxruntime-node';
import {effectFfmpeg,probeEffectMedia} from './effect-media.js';
import {connectedSubjectMask} from './documentary-subject-mask.js';

// Local DIS/IS-Net segmentation, never image generation or a paid API.
// Preprocessing/checksum: rembg v2.0.67 sessions/dis_general_use.py (MIT).
const MODEL_URL='https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx';
const MODEL_MD5='fc16ebd8b0c10d971d3513d564d01e29';
const modelRoot=join(process.env.LOCALAPPDATA??homedir(),'GoldWorkStudio','Models');
let modelDownload:Promise<string>|undefined;
async function hash(path:string,algorithm:string){const digest=createHash(algorithm);for await(const chunk of createReadStream(path))digest.update(chunk);return digest.digest('hex');}
/** Artwork preparation may reuse installed weights, never initiate a download. */
export async function subjectMattingModelAvailable():Promise<boolean>{
  const path=join(modelRoot,'isnet-general-use.onnx');
  return await stat(path).then(()=>true,()=>false)&&await hash(path,'md5')===MODEL_MD5;
}
export async function ensureSubjectMattingModel(notice:(s:string)=>void=()=>{},signal?:AbortSignal):Promise<string>{
  if(modelDownload)return modelDownload;
  modelDownload=(async()=>{
    await mkdir(modelRoot,{recursive:true});const path=join(modelRoot,'isnet-general-use.onnx');
    if(await stat(path).then(()=>true,()=>false)&&await hash(path,'md5')===MODEL_MD5)return path;
    notice('Загружаю локальный модуль отделения предмета от фона…');
    const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(600000)]):AbortSignal.timeout(600000);
    const response=await fetch(MODEL_URL,{signal:combined});if(!response.ok||!response.body)throw Error(`Загрузка модуля: HTTP ${response.status}`);
    const partial=path+'.partial';
    try{await pipeline(Readable.fromWeb(response.body as never),createWriteStream(partial),{signal:combined});
      if(await hash(partial,'md5')!==MODEL_MD5)throw Error('Не совпала контрольная сумма модуля отделения фона');
      await rename(partial,path);return path;
    }finally{await rm(partial,{force:true});}
  })().catch(error=>{modelDownload=undefined;throw error;});
  return modelDownload;
}
async function rgb(path:string,signal?:AbortSignal):Promise<Buffer>{
  return new Promise((resolve,reject)=>{
    const child=spawn(ffmpeg!.replace('app.asar','app.asar.unpacked'),['-hide_banner','-nostdin','-v','error','-i',path,'-frames:v','1','-vf','scale=1024:1024:flags=lanczos','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const buffers:Buffer[]=[];let error='';const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,45000);
    child.stdout.on('data',b=>buffers.push(b));child.stderr.on('data',b=>error=(error+b).slice(-500));child.on('error',reject);
    child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(signal?.aborted)return reject(signal.reason);if(code!==0)return reject(Error(`Не удалось прочитать изображение: ${error}`));resolve(Buffer.concat(buffers));});
  });
}
let queue:Promise<unknown>=Promise.resolve();
export async function documentarySubjectCutout(source:string,directory:string,crop:boolean,anchors:Array<{x:number;y:number}>=[],signal?:AbortSignal,notice:(s:string)=>void=()=>{}):Promise<string>{
  const job=queue.catch(()=>{}).then(async()=>{
    signal?.throwIfAborted();await mkdir(directory,{recursive:true});
    // Full-canvas annotations also validate the visible subject's size. Keep
    // cropped portrait caches, but recheck older annotation masks once.
    const version=crop?'isnet-v4':'isnet-v3';
    const key=createHash('sha256').update(`${version}:${await hash(source,'sha256')}:${crop}:${JSON.stringify(anchors)}`).digest('hex');
    const output=join(directory,`${key}.png`);
    if(await stat(output).then(s=>s.size>0,()=>false))return output;
    const model=await ensureSubjectMattingModel(notice,signal);notice('Отделяю предмет от фона локально…');
    const input=await rgb(source,signal),size=1024*1024;if(input.length!==size*3)throw Error('Неполные пиксели для отделения фона');
    let maximum=1;for(const n of input)maximum=Math.max(maximum,n);
    const data=new Float32Array(size*3);for(let i=0;i<size;i++)for(let c=0;c<3;c++)data[c*size+i]=input[i*3+c]!/maximum-.5;
    const session=await InferenceSession.create(model,{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1});
    let prediction:Float32Array;
    try{const result=await session.run({[session.inputNames[0]!]:new Tensor('float32',data,[1,3,1024,1024])});prediction=result[session.outputNames[0]!]!.data as Float32Array;}
    finally{await session.release();}
    signal?.throwIfAborted();let min=Infinity,max=-Infinity;for(const v of prediction){min=Math.min(min,v);max=Math.max(max,v);}
    if(!Number.isFinite(max)||max-min<.01)throw Error('Не удалось уверенно отделить предмет; сохранён полный исходник');
    const rawMask=new Uint8Array(size);for(let i=0;i<size;i++)rawMask[i]=Math.round(Math.max(0,Math.min(1,(prediction[i]!-min)/(max-min)))*255);
    // Isolated hero cards need a confident silhouette: weak bridges can attach
    // background spectators to a vehicle. Annotation masks retain their anchors.
    const mask=Buffer.from(connectedSubjectMask(rawMask,1024,1024,anchors,crop?160:80));let count=0,left=1024,top=1024,right=0,bottom=0;
    for(let i=0;i<size;i++)if(mask[i]!>160){count++;left=Math.min(left,i%1024);right=Math.max(right,i%1024);top=Math.min(top,Math.floor(i/1024));bottom=Math.max(bottom,Math.floor(i/1024));}
    if(count<size*.025||count>size*.92)throw Error('Контур предмета ненадёжен; сохранён полный исходник');
    if(!crop&&right-left+1<1024*.55&&bottom-top+1<1024*.65)throw Error('Вырезанный предмет слишком мал для кадра с выносками; сохранён полный исходник');
    for(const a of anchors)if(mask[Math.min(size-1,Math.round(a.y*10.23)*1024+Math.round(a.x*10.23))]!<100)throw Error('Вырезка скрывает подписанную деталь; сохранён полный исходник');
    const metadata=await probeEffectMedia(source,signal),w=metadata.width!,h=metadata.height!;
    const maskPath=join(directory,`${key}.pgm`),partial=join(directory,`${key}.partial.png`);
    await writeFile(maskPath,Buffer.concat([Buffer.from('P5\n1024 1024\n255\n'),mask]));
    const x=Math.max(0,Math.floor((left-12)/1024*w)),y=Math.max(0,Math.floor((top-12)/1024*h));
    const cw=Math.min(w-x,Math.ceil((right-left+25)/1024*w)),ch=Math.min(h-y,Math.ceil((bottom-top+25)/1024*h));
    try{await effectFfmpeg(['-y','-i',source,'-i',maskPath,'-filter_complex',`[1:v]scale=${w}:${h}:flags=lanczos[mask];[0:v][mask]alphamerge${crop?`,crop=${cw}:${ch}:${x}:${y}`:''}`,'-frames:v','1',partial],signal);await rename(partial,output);}
    finally{await rm(maskPath,{force:true});await rm(partial,{force:true});}
    return output;
  });queue=job;return job;
}
