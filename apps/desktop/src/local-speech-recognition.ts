import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,readFile,rename,rm,stat,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export interface SpeechWord {text:string;startSeconds:number;endSeconds:number}
const root=join(process.env.LOCALAPPDATA??homedir(),'GoldWorkStudio','Models','whisper-1.8.2');
const binaryHash='b1514ebc099765e39fa37eb780b92a140a94c86bb0b3b3d98226b38825979732';
const modelHash='60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe';
async function hash(path:string){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');}
async function processFile(exe:string,args:string[],signal?:AbortSignal,env?:NodeJS.ProcessEnv){
  signal?.throwIfAborted();
  await new Promise<void>((resolve,reject)=>{const child=spawn(exe,args,{windowsHide:true,env:env??process.env,stdio:['ignore','ignore','pipe']});let error='';
    const abort=()=>child.kill(),timer=setTimeout(abort,180000);signal?.addEventListener('abort',abort,{once:true});
    child.stderr.on('data',b=>{error=(error+String(b)).slice(-1500);});
    child.on('error',reject);child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(signal?.aborted)reject(signal.reason);else if(code!==0)reject(Error(`Локальная синхронизация: код ${code}. ${error}`));else resolve();});
  });
}
async function download(url:string,path:string,sha:string,signal?:AbortSignal){
  if(await stat(path).then(()=>true,()=>false)&&await hash(path)===sha)return;
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(600000)]):AbortSignal.timeout(600000);
  const res=await fetch(url,{signal:combined});if(!res.ok||!res.body)throw Error(`Модуль синхронизации: HTTP ${res.status}`);
  const partial=path+'.partial';
  try{await pipeline(Readable.fromWeb(res.body as never),createWriteStream(partial),{signal:combined});if(await hash(partial)!==sha)throw Error('Не совпала контрольная сумма модуля синхронизации');await rename(partial,path);}
  finally{await rm(partial,{force:true});}
}
let runtime:Promise<{exe:string;model:string}>|undefined;
async function ensureRuntime(notice:(s:string)=>void,signal?:AbortSignal){
  if(runtime)return runtime;
  runtime=(async()=>{
    if(process.platform!=='win32'||process.arch!=='x64')throw Error('Локальная синхронизация сейчас поддерживает Windows x64');
    await mkdir(root,{recursive:true});
    const zip=join(root,'whisper-bin-x64.zip'),model=join(root,'ggml-base.bin');
    notice('Подготавливаю локальную синхронизацию слов с голосом…');
    await download('https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-x64.zip',zip,binaryHash,signal);
    const files=await readdir(root,{recursive:true});
    let binary=files.find(p=>p.endsWith('whisper-cli.exe'));
    if(!binary){await processFile('powershell.exe',['-NoProfile','-NonInteractive','-Command','Expand-Archive -LiteralPath $env:GWS_SPEECH_ZIP -DestinationPath $env:GWS_SPEECH_DIR -Force'],signal,{...process.env,GWS_SPEECH_ZIP:zip,GWS_SPEECH_DIR:root});binary=(await readdir(root,{recursive:true})).find(p=>p.endsWith('whisper-cli.exe'));}
    if(!binary)throw Error('В модуле синхронизации отсутствует whisper-cli');
    await download('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',model,modelHash,signal);
    return {exe:join(root,binary),model};
  })().catch(e=>{runtime=undefined;throw e;});return runtime;
}
let queue:Promise<unknown>=Promise.resolve();
/** Actual local audio recognition, cached by PCM bytes. Never synthesizes a voice. */
export async function localSpeechWords(wav:string,directory:string,notice:(s:string)=>void=()=>{},signal?:AbortSignal):Promise<SpeechWord[]>{
  const job=queue.catch(()=>{}).then(async()=>{
    signal?.throwIfAborted();await mkdir(directory,{recursive:true});
    const key=await hash(wav),path=join(directory,`${key}-base-v1.json`);
    const saved=await readFile(path,'utf8').then(s=>JSON.parse(s) as SpeechWord[],()=>undefined);if(saved)return saved;
    const {exe,model}=await ensureRuntime(notice,signal),output=join(directory,`${key}-recognition`);
    notice('Сопоставляю слова с готовой озвучкой локально…');
    await processFile(exe,['-m',model,'-f',wav,'-l','auto','-t','4','-bs','1','-bo','1','-ml','1','-sow','-ojf','-of',output,'-np'],signal);
    const result=JSON.parse(await readFile(output+'.json','utf8')) as {transcription:Array<{text:string;offsets:{from:number;to:number}}>};
    const words=result.transcription.map(row=>({text:row.text.trim(),startSeconds:row.offsets.from/1000,endSeconds:row.offsets.to/1000})).filter(w=>/[\p{L}\p{N}]/u.test(w.text)&&w.endSeconds>w.startSeconds);
    if(!words.length)throw Error('Не удалось распознать слова озвучки');
    await writeFile(path,JSON.stringify(words));return words;
  });queue=job;return job;
}
