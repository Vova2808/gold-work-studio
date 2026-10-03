// Local HTTP/HLS check: real yt-dlp, identical media, controlled network latency.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { downloadWithYtDlp } from '../src/documentary-youtube.js';
import { effectFfmpeg } from '../src/effect-media.js';

const root = resolve('captures/stock-stall-20260927/download-check');
await mkdir(root, {recursive:true});
await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=320x180:r=12:d=8','-an','-c:v','libx264','-threads','1','-g','12','-sc_threshold','0','-hls_time','1','-hls_list_size','0','-hls_segment_filename',join(root,'segment-%02d.ts'),join(root,'source.m3u8')]);
let active=0, peak=0;
const server=createServer(async(req,res)=>{
  const file=basename(req.url??'');
  if(file!=='source.m3u8'&&!/^segment-\d+\.ts$/.test(file)){res.writeHead(404).end();return;}
  if(file.endsWith('.ts')){active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,350));}
  try{res.setHeader('Content-Type',file.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t');res.end(await readFile(join(root,file)));}
  finally{if(file.endsWith('.ts'))active--;}
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();assert.ok(address&&typeof address!=='string');
const results=[];let expected:string|undefined;
try{
  for(const concurrency of [1,4]){
    peak=0;const started=Date.now(),output=join(root,`download-${concurrency}.ts`);
    await downloadWithYtDlp(['--ignore-config','--force-overwrites','--no-part','--no-progress','--concurrent-fragments',String(concurrency),'-o',output,'--',`http://127.0.0.1:${address.port}/source.m3u8`],output);
    const seconds=(Date.now()-started)/1000;
    const digestPath=join(root,`frames-${concurrency}.md5`);
    await effectFfmpeg(['-y','-v','error','-i',output,'-map','0:v:0','-f','framemd5',digestPath]);
    const digest=await readFile(digestPath,'utf8');
    const frames=digest.split('\n').filter(line=>/^0,/.test(line)).join('\n');
    assert.equal(frames.split('\n').length,96);
    if(expected)assert.equal(frames,expected,'Parallel download preserves every decoded frame');else expected=frames;
    assert.equal(peak,concurrency);
    results.push({concurrency,peak,seconds,frames:96});
  }
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
const result={localOnly:true,identicalDecodedFrames:true,results};
await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
