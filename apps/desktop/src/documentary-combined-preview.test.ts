import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Project,Scene,DocumentaryCandidate} from '@gold-work/shared';
import {effectFfmpeg} from './effect-media.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryPreviewKey} from './documentary-preview.js';
import {AnyModelCompletionUncertainError} from './anymodel-client.js';

test('one preview answers source and scene questions, reuses its answer and protects older unknown submissions',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-combined-preview-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const path=join(root,'sample.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-t','2','-c:v','libx264','-preset','ultrafast',path]);
  const scene={id:'s',order:0,narration:'The named vessel sails.',documentary:{requirement:{text:'The named vessel sails.',queries:['named vessel'],entities:['named vessel'],identities:[{name:'named vessel',aliases:[]}],years:[]}}} as unknown as Scene;
  const project={id:'p',scenes:[scene],videoBrief:{readyScript:scene.narration}} as Project;
  const candidate={id:'youtube:abcdefghijk',provider:'youtube',kind:'video',title:'Vessel',downloadUrl:'https://example.test/original',durationSeconds:200} as DocumentaryCandidate;
  const preview={bytes:1000,segments:[0,1,2].map(i=>({path,start:i*50,end:i*50+2}))};
  let posts=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,_input,images)=>{
    posts++;assert.equal(images?.length,9);return JSON.stringify({selectedIndex:1,confidence:.95,isCameraFootage:true,reason:'Visible vessel'});
  }},()=>join(root,'complete'));
  assert.equal((await service.inspectCombinedPreview(project,scene,candidate,preview)).selectedIndex,1);
  assert.equal((await service.inspectCombinedPreview(project,scene,candidate,preview)).selectedIndex,1);
  assert.equal(posts,1,'A completed combined review never pays twice');
  let unknownPosts=0;
  const unknown=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    unknownPosts++;throw new AnyModelCompletionUncertainError('ECONNRESET');
  }},()=>join(root,'unknown'));
  await assert.rejects(unknown.inspectPreview(project.id,documentaryPreviewKey(candidate),preview));
  await assert.rejects(unknown.inspectCombinedPreview(project,scene,candidate,preview),/Автоповтор отключён/);
  assert.equal(unknownPosts,1,'The new combined format must not bypass an old unknown request');
});
