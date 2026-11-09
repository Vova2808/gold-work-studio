import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { masterDocumentaryAudio } from './documentary-audio-master.js';

function ffmpeg(args: string[]): Promise<string> {
  const executable=ffmpegPath?.replace('app.asar','app.asar.unpacked');
  assert.ok(executable,'FFmpeg binary is available');
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{windowsHide:true});let stderr='';
    child.stderr.on('data',chunk=>{stderr+=chunk.toString('utf8');});
    child.once('error',reject);child.once('close',code=>code===0?resolve(stderr):reject(new Error(stderr)));
  });
}

test('documentary master brings a synthetic mix near -16 LUFS, keeps true peak below -1.5 dBTP and preserves duration',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'gws-audio-master-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const source=join(directory,'source.wav'),output=join(directory,'master.wav');
  await ffmpeg(['-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=8','-af','volume=0.04','-ar','48000','-ac','2','-c:a','pcm_s16le',source]);
  const result=await masterDocumentaryAudio(source,output);
  assert.equal(result.silent,false);
  const measured=await ffmpeg(['-hide_banner','-nostats','-i',output,'-af','loudnorm=I=-16:TP=-2:LRA=11:print_format=json','-f','null',process.platform==='win32'?'NUL':'/dev/null']);
  const json=[...measured.matchAll(/\{[^{}]*"input_i"[^{}]*\}/gs)].at(-1)?.[0];
  assert.ok(json,'FFmpeg returned integrated loudness and true peak');
  const stats=JSON.parse(json) as {input_i:string;input_tp:string};
  assert.ok(Math.abs(Number(stats.input_i)+16)<0.6,`integrated loudness ${stats.input_i} LUFS`);
  assert.ok(Number(stats.input_tp)<=-1.5,`true peak ${stats.input_tp} dBTP`);
  const bytes=(await stat(output)).size,header=await readFile(output);
  const seconds=(bytes-44)/(48000*2*2);
  assert.ok(Math.abs(seconds-8)<0.03,`duration ${seconds} seconds`);
  assert.equal(header.toString('ascii',0,4),'RIFF');
});

test('documentary master leaves a silent mix unchanged',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'gws-audio-silent-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const source=join(directory,'source.wav'),output=join(directory,'master.wav');
  await ffmpeg(['-y','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','2','-c:a','pcm_s16le',source]);
  assert.deepEqual(await masterDocumentaryAudio(source,output),{silent:true});
  assert.deepEqual(await readFile(output),await readFile(source));
});
