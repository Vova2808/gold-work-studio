import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {effectFfmpeg,probeEffectMedia} from './effect-media.js';
import {DocumentaryMediaRateLimitError} from './documentary-download.js';
import {documentaryPreviewRanges,documentaryPreviewDownloadRange,documentaryPreviewRejection,withDocumentaryPreviewRelay,downloadDirectDocumentaryRange} from './documentary-preview.js';
import {documentarySceneContext,documentaryNarrativeEvidenceIssue} from './documentary-scene-context.js';
import type {Project,Scene} from '@gold-work/shared';

test('relay preserves the upstream failure instead of reporting only loopback 502',async()=>{
 await assert.rejects(withDocumentaryPreviewRelay('https://example.test/video',undefined,async url=>{
  const response=await fetch(url);if(!response.ok)throw Error(`FFmpeg HTTP ${response.status}`);
 },async value=>new URL(value),async()=>new Response('unavailable',{status:503})),
 error=>error instanceof Error&&/HTTP 503/.test(error.message)&&error.cause instanceof AggregateError);
});

test('a WebM seek limited by the origin reports HTTP 429 even when FFmpeg writes an empty MP4',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-range-limited-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const source=join(root,'source.webm');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=640x360:r=24:d=15','-c:v','libvpx-vp9',
    '-cpu-used','7','-g','24','-crf','25','-b:v','0','-cluster_time_limit','1000',source]);
  const data=await readFile(source);
  let requests=0;
  const transport:typeof fetch=async(_input,init)=>{
    if(++requests>2)return new Response('limited',{status:429,headers:{'retry-after':'30'}});
    const start=Number(new Headers(init?.headers).get('Range')?.match(/^bytes=(\d+)-/)?.[1]??0);
    let position=start;
    const body=new ReadableStream<Uint8Array>({async pull(controller){
      // Leave enough bytes unread to make FFmpeg seek via a new range request.
      await new Promise<void>(resolve=>setTimeout(resolve,4));
      if(init?.signal?.aborted){controller.close();return;}
      const end=Math.min(data.length,position+4096);
      controller.enqueue(data.subarray(position,end));
      position=end;
      if(position===data.length)controller.close();
    }});
    return new Response(body,{status:206,headers:{'content-type':'video/webm','accept-ranges':'bytes',
      'content-length':String(data.length-start),'content-range':`bytes ${start}-${data.length-1}/${data.length}`}});
  };
  await assert.rejects(downloadDirectDocumentaryRange('https://range-limited-webm.example/source.webm',join(root,'empty.mp4'),
    {start:8,end:12},AbortSignal.timeout(15_000),transport,async value=>new URL(value)),DocumentaryMediaRateLimitError);
  assert.equal(requests,3);
});

test('separated samples cover beginning, middle and end without crossing the source',()=>{
  for(const duration of [6,12,60,1800]){
    const ranges=documentaryPreviewRanges(duration);assert.equal(ranges.length,3);
    assert.ok(ranges.every((range,index)=>range.start>=0&&range.end<=duration&&range.end-range.start<=4.001&&(!index||range.start>ranges[index-1]!.end)));
  }
  assert.deepEqual(documentaryPreviewRanges(NaN),[]);
});

test('a scene-confirmed long-video sample downloads only a short editable HD range',()=>{
  const preview={segments:[{path:'a',start:23,end:27},{path:'b',start:138,end:142},{path:'c',start:248,end:252}],bytes:1000};
  assert.deepEqual(documentaryPreviewDownloadRange(preview,0,288,7),{start:20,end:30});
  assert.deepEqual(documentaryPreviewDownloadRange(preview,2,288,16),{start:241,end:259});
  assert.equal(documentaryPreviewDownloadRange(preview,-1,288,7),undefined);
  assert.equal(documentaryPreviewDownloadRange(preview,0,90,7),undefined);
  const medium={...preview,segments:[{path:'a',start:10,end:14},{path:'b',start:53,end:57},{path:'c',start:97,end:101}]};
  assert.deepEqual(documentaryPreviewDownloadRange(medium,1,110,3),{start:50,end:60},'A scene-confirmed medium source also needs only the editable interval');
});

test('preview never approves footage and rejects gameplay only with consistent confident evidence',()=>{
  const samples=[0,1,2].map(index=>({index,kind:'gameplay',confidence:.99,evidence:'Game rendering and a vehicle selection HUD are visible'}));
  assert.match(documentaryPreviewRejection({samples})!,/видеоигры/);
  assert.equal(documentaryPreviewRejection({samples:[...samples.slice(0,2),{...samples[2],kind:'camera'}]}),undefined);
  assert.equal(documentaryPreviewRejection({samples:samples.map(sample=>({...sample,kind:'uncertain'}))}),undefined);
  assert.equal(documentaryPreviewRejection({samples:samples.slice(0,2)}),undefined);
});

test('continuity preserves the active year and historical comparison as separate original phrases',()=>{
  const scenes=['In October 2004 he won the title.','The last winner had been in 1992.','He had eight wins that season.'].map((narration,order)=>({id:String(order),order,narration})) as Scene[];
  const context=documentarySceneContext({scenes} as Project,scenes[2]!);
  assert.match(context.preceding[0]!.text,/2004/);assert.match(context.preceding[1]!.text,/1992/);
  assert.ok(documentaryNarrativeEvidenceIssue({status:'accepted',narrativeEvidence:{subjectMatch:true,eraMatch:false,detailMatch:true,evidence:'The source documents 2015, while the narrative event is in 2004.'}}));
  assert.ok(documentaryNarrativeEvidenceIssue({status:'accepted'}));
  const evidence={subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'2004',evidence:'Original period and visible identity agree.'};
  assert.ok(documentaryNarrativeEvidenceIssue({narrativeEvidence:evidence},{title:'Rossi Yamaha race'}),'Colours and a familiar rider are not a dated event');
  assert.ok(documentaryNarrativeEvidenceIssue({narrativeEvidence:{...evidence,eraEvidenceQuote:'Rossi 2004'}},{title:'Rossi 2015'}),'A fabricated source quotation cannot ground the era');
  assert.equal(documentaryNarrativeEvidenceIssue({narrativeEvidence:{...evidence,eraEvidenceQuote:'Rossi 2004'}},{title:'Rossi 2004 race'}),undefined);
  assert.equal(documentaryNarrativeEvidenceIssue({narrativeEvidence:{...evidence,requiredEra:'none'}}),undefined);
});

test('real FFmpeg preview seeks through HTTP Range instead of receiving the whole original',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-preview-range-')),source=join(root,'source.mp4'),output=join(root,'sample.mp4');
  t.after(()=>rm(root,{recursive:true,force:true}));
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=24:d=40','-f','lavfi','-i','sine=frequency=440:duration=40','-c:a','aac','-c:v','libx264','-preset','ultrafast','-crf','18','-movflags','+faststart',source]);
  const data=await readFile(source),requests:number[]=[];
  const server=createServer((req,res)=>{
    const start=Number(req.headers.range?.match(/^bytes=(\d+)-/)?.[1]??0);requests.push(start);
    res.writeHead(req.headers.range?206:200,{'Content-Type':'video/mp4','Content-Length':data.length-start,'Accept-Ranges':'bytes',...(req.headers.range?{'Content-Range':`bytes ${start}-${data.length-1}/${data.length}`}:{})});
    if(req.method==='HEAD'){res.end();return;}
    let at=start;
    const timer=setInterval(()=>{const end=Math.min(at+32768,data.length);res.write(data.subarray(at,end));at=end;if(at===data.length){clearInterval(timer);res.end();}},1);
    res.on('close',()=>clearInterval(timer));
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  t.after(()=>{server.closeAllConnections();server.close();});
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const {bytes}=await withDocumentaryPreviewRelay(`http://127.0.0.1:${address.port}/source.mp4`,AbortSignal.timeout(30000),url=>
    effectFfmpeg(['-y','-ss','28','-i',url,'-t','3','-an','-vf','scale=640:360','-c:v','libx264','-preset','ultrafast',output]),async value=>new URL(value));
  const media=await probeEffectMedia(output);
  assert.ok(requests.some(offset=>offset>data.length/2),JSON.stringify(requests));
  assert.ok(bytes<data.length/2,`${bytes} of ${data.length} transferred`);
  assert.ok(Math.abs(media.durationSeconds!-3)<.1);
  assert.ok((await stat(output)).size>0);
  const final=join(root,'final.download');let transported=0;
  const range=await downloadDirectDocumentaryRange(`http://127.0.0.1:${address.port}/source.mp4`,final,{start:28,end:32},AbortSignal.timeout(30000),
    (input,init)=>{transported++;return fetch(input,init);},async value=>new URL(value));
  const hd=await probeEffectMedia(final);
  assert.equal(hd.width,1280);assert.equal(hd.height,720);assert.equal(hd.hasAudio,true);
  assert.ok(Math.abs(hd.durationSeconds!-4)<.1);
  assert.ok(range.downloadedBytes<data.length/2,`${range.downloadedBytes} of ${data.length} transferred`);
  assert.ok(transported>0,'The provided provider/proxy transport must handle every remote request');
  await assert.rejects(downloadDirectDocumentaryRange(`http://127.0.0.1:${address.port}/source.mp4`,join(root,'empty.mp4'),
    {start:45,end:49},AbortSignal.timeout(30000),fetch,async value=>new URL(value)),/пуст или повреждён/);
});
