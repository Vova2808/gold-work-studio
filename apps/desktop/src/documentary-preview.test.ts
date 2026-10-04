import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {effectFfmpeg,probeEffectMedia} from './effect-media.js';
import {documentaryPreviewRanges,documentaryPreviewDownloadRange,documentaryPreviewRejection,withDocumentaryPreviewRelay} from './documentary-preview.js';
import {documentarySceneContext,documentaryNarrativeEvidenceIssue} from './documentary-scene-context.js';
import type {Project,Scene} from '@gold-work/shared';

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
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=24:d=40','-an','-c:v','libx264','-preset','ultrafast','-crf','18','-movflags','+faststart',source]);
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
});
