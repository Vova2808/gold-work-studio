import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,copyFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DocumentaryYouTube,documentaryYouTubeFormatSelector,youtubeDocumentaryCandidates} from './documentary-youtube.js';
import {effectFfmpeg,probeEffectMedia} from './effect-media.js';

test('automatic short HD ranges prefer usable landscape 720p; full sources retain their selector',()=>{
  assert.ok(documentaryYouTubeFormatSelector(true,true).startsWith('bestvideo[ext=mp4][height=720][width>=1280]/'));
  assert.ok(documentaryYouTubeFormatSelector(true,true).endsWith(documentaryYouTubeFormatSelector(true)));
  assert.equal(documentaryYouTubeFormatSelector(false,true),documentaryYouTubeFormatSelector(false));
});

for(const duration of [100,500])test(`YouTube ${duration}s preview transfers once, cuts real local samples and recovers without retransferring`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-youtube-small-preview-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const fixture=join(root,'fixture.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=160x90:r=5','-t','100','-c:v','libx264','-preset','ultrafast','-an',fixture]);
  const video={id:'abcdefghijk',snippet:{title:'Named actual camera video'},status:{license:'creativeCommon',privacyStatus:'public'},contentDetails:{duration:`PT${duration}S`,definition:'hd' as const}};
  const candidate=youtubeDocumentaryCandidates([video],'named action')[0]!;
  let transfers=0;
  const youtube=new DocumentaryYouTube({apiKey:async()=> 'fixture',resolveValidatedCookies:async()=>undefined},
    async()=>Response.json({items:[video]}),async(args,destination,_signal,_progress,directory,maxBytes)=>{
      transfers++;assert.equal(args.filter(arg=>arg==='--download-sections').length,duration>300?1:0);assert.equal(maxBytes,32*1024*1024);
      if(duration>300)assert.equal(args[args.indexOf('--download-sections')+1],'*240-252');
      assert.ok(args[args.indexOf('-f')+1]!.startsWith('best[protocol=https][ext=mp4][height<=360]/'));
      await copyFile(fixture,destination);await writeFile(join(directory!,'complete.json'),JSON.stringify(resolve(destination)));
    });
  const directory=join(root,'preview'),preview=await youtube.preview(candidate,directory,undefined,true);
  assert.equal(transfers,1);assert.equal(preview.segments.length,3);
  assert.equal(preview.downloadedBytes,(await stat(fixture)).size);
  for(const sample of preview.segments){const media=await probeEffectMedia(sample.path);assert.ok(media.videoCodec);assert.ok(media.durationSeconds>=3.9);}
  await rm(join(directory,'preview.json'));
  const recovered=await youtube.preview(candidate,directory,undefined,true);
  assert.equal(transfers,1);assert.deepEqual(recovered.segments,preview.segments);
  assert.equal(await stat(join(directory,duration>300?'preview-window-mid.mp4':'preview-original.mp4')).then(s=>s.size),(await stat(fixture)).size);
  if(duration>300)assert.deepEqual(preview.segments.map(s=>s.start),[240,244,248]);
});
