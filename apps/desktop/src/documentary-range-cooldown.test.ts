import assert from 'node:assert/strict';
import test from 'node:test';
import {requestDocumentaryMedia,DocumentaryMediaRateLimitError} from './documentary-download.js';
import {withDocumentaryPreviewRelay} from './documentary-preview.js';

const authorize=async(value:string)=>new URL(value);
const decoderFailure=async(url:string)=>{
  const response=await fetch(url);
  await response.body?.cancel();
  if(!response.ok)throw Error(`Decoder HTTP ${response.status}`);
};

test('a decoder retry after origin 429 never sends another origin request',async()=>{
  let calls=0;
  const transport:typeof fetch=async()=>{calls++;return new Response('limited',{status:429,headers:{'retry-after':'30'}});};
  await assert.rejects(withDocumentaryPreviewRelay('https://range-retry.example/a.webm',undefined,async url=>{
    await decoderFailure(url).catch(()=>{});
    await decoderFailure(url);
  },authorize,transport),/HTTP 429/);
  assert.equal(calls,1,'FFmpeg/decoder retries must stay inside the local relay during the origin cooldown');
});

test('a range 429 blocks another scene and full-file downloads on the same host, not other hosts',async()=>{
  let calls=0;
  const limited:typeof fetch=async()=>{calls++;return new Response('limited',{status:429,headers:{'retry-after':'120'}});};
  await assert.rejects(withDocumentaryPreviewRelay('https://range-scenes.example/a.webm',undefined,decoderFailure,authorize,limited),/HTTP 429/);
  await assert.rejects(withDocumentaryPreviewRelay('https://range-scenes.example/b.webm',undefined,decoderFailure,authorize,limited),/HTTP 429/);
  await assert.rejects(requestDocumentaryMedia(new URL('https://range-scenes.example/c.jpg'),undefined,undefined,
    {fetcher:limited,availabilityWaitMs:0}),DocumentaryMediaRateLimitError);
  assert.equal(calls,1,'Different scenes and media paths share the existing host deadline');
  await withDocumentaryPreviewRelay('https://range-other.example/a.webm',undefined,async url=>{
    assert.equal(await (await fetch(url)).text(),'video');
  },authorize,async()=>{calls++;return new Response('video');});
  assert.equal(calls,2);
});

test('a full-file 429 also blocks the range relay until the actual Retry-After deadline',async t=>{
  let now=1000,calls=0;
  t.mock.method(Date,'now',()=>now);
  const limited:typeof fetch=async()=>{calls++;return new Response('limited',{status:429,headers:{'retry-after':'30'}});};
  await assert.rejects(requestDocumentaryMedia(new URL('https://file-to-range.example/a.jpg'),undefined,undefined,
    {fetcher:limited,availabilityWaitMs:0}),DocumentaryMediaRateLimitError);
  now=30_999;
  await assert.rejects(withDocumentaryPreviewRelay('https://file-to-range.example/b.webm',undefined,decoderFailure,authorize,limited),/HTTP 429/);
  assert.equal(calls,1);
  now=31_000;
  await withDocumentaryPreviewRelay('https://file-to-range.example/b.webm',undefined,async url=>{
    assert.equal(await (await fetch(url)).text(),'video');
  },authorize,async()=>{calls++;return new Response('video');});
  assert.equal(calls,2,'The same route is available after cooldown; no route fallback is introduced');
});
