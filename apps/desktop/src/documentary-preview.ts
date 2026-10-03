import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir,readFile,stat} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {DocumentaryCandidate} from '@gold-work/shared';
import {atomicWrite} from './fs-utils.js';
import {effectFfmpeg,probeEffectMedia} from './effect-media.js';
import {publicMediaUrl} from './documentary-download.js';
import {withDocumentaryFrameSlot} from './documentary-resources.js';

export type DocumentaryPreviewSegment={path:string;start:number;end:number};
export type DocumentaryPreview={segments:DocumentaryPreviewSegment[];bytes:number;downloadedBytes?:number};

/** These samples are a rejection screen, never the production source or proof
 * of absence throughout an entire video. Keep beginning/middle/end separate. */
export function documentaryPreviewRanges(duration:number):Array<{start:number;end:number}> {
  if(!Number.isFinite(duration)||duration<6)return [];
  const length=Math.min(4,duration/5);
  return [.08,.48,.86].map(fraction=>{
    const start=Math.round(Math.min(duration-length,Math.max(0,duration*fraction))*1000)/1000;
    return {start,end:Math.round((start+length)*1000)/1000};
  });
}

export function documentaryPreviewKey(candidate:DocumentaryCandidate) {
  return createHash('sha256').update(JSON.stringify([1,candidate.provider,candidate.id,candidate.downloadUrl,candidate.durationSeconds])).digest('hex');
}

export async function readDocumentaryPreview(directory:string):Promise<DocumentaryPreview|undefined> {
  try {
    const value=JSON.parse(await readFile(join(directory,'preview.json'),'utf8')) as DocumentaryPreview;
    if(!Array.isArray(value.segments)||value.segments.length!==3)return;
    for(const segment of value.segments){
      if(resolve(dirname(segment.path))!==resolve(directory)||!(segment.end>segment.start))return;
      if(!(await stat(segment.path)).size)return;
    }
    return value;
  } catch {return;}
}

export async function saveDocumentaryPreview(directory:string,segments:DocumentaryPreviewSegment[],signal?:AbortSignal,downloadedBytes?:number):Promise<DocumentaryPreview> {
  let bytes=0;
  for(const segment of segments){
    const info=await stat(segment.path);bytes+=info.size;
    const media=await probeEffectMedia(segment.path,signal);
    if(!media.videoCodec||!media.durationSeconds||media.durationSeconds<Math.min(.5,(segment.end-segment.start)/2))throw Error('Пробный видеофрагмент пуст или повреждён');
  }
  const preview={segments,bytes,downloadedBytes};
  await atomicWrite(join(directory,'preview.json'),JSON.stringify(preview));
  return preview;
}

/** A short-lived range relay preserves URL/redirect checks and imposes a total
 * transfer ceiling even if an origin ignores Range. No source URL in FFmpeg
 * logs, no complete original in memory and no persistent local service. */
export async function withDocumentaryPreviewRelay<T>(value:string,signal:AbortSignal|undefined,
  work:(url:string)=>Promise<T>,authorize:(value:string)=>Promise<URL>=publicMediaUrl):Promise<{result:T;bytes:number}> {
  const original=await authorize(value),controller=new AbortController();
  const combined=AbortSignal.any([controller.signal,...(signal?[signal]:[])]);
  let bytes=0;
  const maximum=32*1024*1024;
  const server=createServer(async(req,res)=>{
    if(req.url!=='/preview'||!['GET','HEAD'].includes(req.method??'')){res.writeHead(404).end();return;}
    const range=req.headers.range;
    if(range&&!/^bytes=\d+-\d*$/.test(range)){res.writeHead(400).end();return;}
    const requestController=new AbortController();
    res.on('close',()=>requestController.abort());
    try {
      let url=original,response:Response|undefined;
      for(let redirects=0;redirects<=4;redirects++){
        response=await fetch(url,{method:req.method,redirect:'manual',headers:{'User-Agent':'GoldWorkStudio/0.2',...(range?{Range:range}:{})},signal:AbortSignal.any([combined,requestController.signal])});
        if(response.status>=300&&response.status<400){
          const location=response.headers.get('location');await response.body?.cancel();
          if(!location||redirects===4)throw Error('Не удалось открыть пробный фрагмент');
          url=await authorize(new URL(location,url).toString());continue;
        }
        break;
      }
      if(!response?.ok)throw Error(`Источник пробного фрагмента недоступен (HTTP ${response?.status})`);
      const headers:Record<string,string>={};
      for(const name of ['content-type','content-length','content-range','accept-ranges']){const item=response.headers.get(name);if(item)headers[name]=item;}
      res.writeHead(response.status,headers);
      if(req.method==='HEAD'||!response.body){res.end();return;}
      const meter=new Transform({transform(chunk:Buffer,_encoding,done){
        bytes+=chunk.length;
        if(bytes>maximum){controller.abort();done(Error('Лимит передачи пробных фрагментов'));}else done(null,chunk);
      }});
      await pipeline(Readable.fromWeb(response.body as never),meter,res);
    } catch {if(!res.headersSent)res.writeHead(502);res.end();}
  });
  await new Promise<void>((ready,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);ready();});});
  try {
    const address=server.address();if(!address||typeof address==='string')throw Error('Не удалось открыть поток проверки');
    return {result:await work(`http://127.0.0.1:${address.port}/preview`),bytes};
  } finally {controller.abort();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
}

export async function downloadDirectDocumentaryPreview(candidate:DocumentaryCandidate,directory:string,signal?:AbortSignal):Promise<DocumentaryPreview> {
  const ranges=documentaryPreviewRanges(candidate.durationSeconds??0);
  if(!ranges.length)throw Error('Для пробной загрузки нужна длительность источника');
  await mkdir(directory,{recursive:true});
  const cached=await readDocumentaryPreview(directory);if(cached)return cached;
  const transfer=await withDocumentaryPreviewRelay(candidate.downloadUrl,signal,url=>renderDirectDocumentaryPreviewSegments(url,directory,ranges,signal));
  return saveDocumentaryPreview(directory,transfer.result,signal,transfer.bytes);
}

/** Independent seeks share the existing memory-aware decoder queue. Wait for
 * every started FFmpeg job before closing the short-lived range relay. */
export async function renderDirectDocumentaryPreviewSegments(url:string,directory:string,ranges:readonly {start:number;end:number}[],signal?:AbortSignal):Promise<DocumentaryPreviewSegment[]> {
  const settled=await Promise.allSettled(ranges.map(async(range,index)=>{
    signal?.throwIfAborted();const path=join(directory,`sample-${index}.mp4`);
    // The aspect-preserving scale can round 16:9 to 853x480. H.264 needs
    // even dimensions; an invalid preview used to trigger a full download.
    await withDocumentaryFrameSlot(()=>effectFfmpeg(['-y','-ss',String(range.start),'-i',url,'-t',String(range.end-range.start),'-map','0:v:0','-an','-vf','scale=854:480:force_original_aspect_ratio=decrease:force_divisible_by=2','-c:v','libx264','-preset','ultrafast','-crf','28','-movflags','+faststart',path],signal));
    return {path,...range};
  }));
  const failure=settled.find((item):item is PromiseRejectedResult=>item.status==='rejected');
  if(failure)throw failure.reason;
  return settled.map(item=>(item as PromiseFulfilledResult<DocumentaryPreviewSegment>).value);
}

/** A glimpse cannot prove a named person/detail is absent from unseen parts.
 * Reject only consistent, explicit non-documentary content across all samples. */
export function documentaryPreviewRejection(result:Record<string,unknown>):string|undefined {
  const rows=result.samples;
  if(!Array.isArray(rows)||rows.length!==3)return;
  if(rows.every((row,index)=>row&&row.index===index&&row.kind==='gameplay'&&row.confidence>=.94&&typeof row.evidence==='string'&&row.evidence.length>=12))
    return 'Во всех трёх пробных участках обнаружена запись видеоигры. Полный исходник не загружен.';
  if(rows.every((row,index)=>row&&row.index===index&&['unrelated-screen','title-card'].includes(row.kind)&&row.confidence>=.96&&typeof row.evidence==='string'&&row.evidence.length>=12))
    return 'Все три пробных участка показывают заставки или посторонний экран вместо натурного видео. Полный исходник не загружен.';
}
