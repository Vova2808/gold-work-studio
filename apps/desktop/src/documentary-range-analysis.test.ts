import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {effectFfmpeg} from './effect-media.js';
import {documentaryVideoCuts,documentaryFrozenVideoRange,documentaryVideoRangeAnalysis} from './documentary-video-catalog.js';

// An independent oracle keeps the exact former commands/time parsing; it does
// not call the shared implementation or a provider.
async function formerChecks(file:string,start:number,end:number){
  const duration=end-start;
  const cutsLog=await effectFfmpeg(['-ss',String(start),'-i',file,'-t',String(duration),'-an',
    '-vf',"scale=320:-2,fps=30,select='gt(scene,0.32)',showinfo",'-f','null','-'],AbortSignal.timeout(20_000),false,100000);
  const freezeLog=await effectFfmpeg(['-loglevel','info','-ss',String(start),'-i',file,'-t',String(duration),'-an',
    '-vf','scale=160:90,format=gray,freezedetect=n=-40dB:d=0.75','-f','null','-'],undefined,false,12000);
  const cuts=[...cutsLog.matchAll(/pts_time:([\d.]+)/g)].map(m=>start+Number(m[1])).filter(at=>at>start+.04&&at<end-.04);
  let freezeStart:number|undefined,longest=0;
  for(const m of freezeLog.matchAll(/lavfi\.freezedetect\.freeze_(start|end):\s*([\d.]+)/g)){
    const at=Number(m[2]);if(!Number.isFinite(at))continue;
    if(m[1]==='start')freezeStart=at;
    else if(freezeStart!==undefined){longest=Math.max(longest,at-freezeStart);freezeStart=undefined;}
  }
  if(freezeStart!==undefined)longest=Math.max(longest,duration-freezeStart);
  return {cuts,frozen:duration>=1.5&&longest>=duration*.8};
}

test('one interval decode matches former static/moving/cuts/VFR/offset guards and recovers after failure',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-range-parity-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const staticFile=join(root,'static.mp4'),moving=join(root,'moving.mp4'),cuts=join(root,'cuts.mp4'),vfr=join(root,'vfr.mp4'),offset=join(root,'offset.ts');
  await effectFfmpeg(['-y','-f','lavfi','-i','color=c=navy:s=320x180:r=30:d=5','-an','-c:v','libx264',staticFile]);
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=320x180:r=30:d=5','-an','-c:v','libx264',moving]);
  await effectFfmpeg(['-y','-f','lavfi','-i','color=c=black:s=320x180:r=30:d=2','-f','lavfi','-i','color=c=white:s=320x180:r=30:d=3',
    '-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-an','-c:v','libx264',cuts]);
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=320x180:r=30:d=5','-vf',"select='not(mod(n,5))+eq(mod(n,7),1)'",'-fps_mode','vfr','-an','-c:v','libx264',vfr]);
  await effectFfmpeg(['-y','-i',cuts,'-c','copy','-output_ts_offset','7',offset]);
  for(const [file,start,end] of [[staticFile,0,4],[staticFile,.7,4.2],[moving,0,4],[cuts,.4,4.4],[vfr,.37,4.37],[offset,.4,4.4]] as const){
    const expected=await formerChecks(file,start,end);
    const results=await Promise.all(Array.from({length:4},()=>documentaryVideoRangeAnalysis(file,start,end)));
    for(const result of results)assert.deepEqual(result,expected,`${file}, ${start}–${end}`);
    results[0]!.cuts.push(999);
    assert.deepEqual(await documentaryVideoRangeAnalysis(file,start,end),expected,'Caller changes do not contaminate cached cuts');
    assert.deepEqual(await documentaryVideoCuts(file,start,end),expected.cuts);
    assert.equal(await documentaryFrozenVideoRange(file,start,end),expected.frozen);
  }
  assert.equal((await documentaryVideoRangeAnalysis(staticFile,0,1)).frozen,false,'Former short-range exemption stays unchanged');
  const invalid=join(root,'invalid.mp4');await writeFile(invalid,'invalid video');
  await assert.rejects(documentaryVideoRangeAnalysis(invalid,0,3),/FFmpeg/);
  await effectFfmpeg(['-y','-i',moving,'-c','copy',invalid]);
  assert.deepEqual(await documentaryVideoRangeAnalysis(invalid,0,3),await formerChecks(invalid,0,3),'Failed work and replaced file are rechecked');
});
