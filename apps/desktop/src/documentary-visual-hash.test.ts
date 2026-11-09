import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,utimes,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {documentaryVisualHash} from './documentary-visual-hash.js';

test('real poster hash reuses concurrent checks and invalidates a replaced same-size image',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-poster-hash-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'poster.ppm');
  const poster=(reverse:boolean)=>Buffer.concat([Buffer.from('P6\n9 8\n255\n'),Buffer.from(
    Array.from({length:9*8*3},(_,i)=>{const x=Math.floor(i/3)%9;return (reverse?8-x:x)*30;}))]);
  await writeFile(file,poster(false));
  const started=performance.now();
  const hashes=await Promise.all([documentaryVisualHash(file),documentaryVisualHash(file)]);
  const firstMs=performance.now()-started;
  assert.equal(hashes[0],hashes[1]);
  const cachedAt=performance.now();assert.equal(await documentaryVisualHash(file),hashes[0]);
  t.diagnostic(JSON.stringify({firstMs,cachedMs:performance.now()-cachedAt}));
  await writeFile(file,poster(true));
  const changed=new Date(Date.now()+2000);await utimes(file,changed,changed);
  assert.notEqual(await documentaryVisualHash(file),hashes[0]);
});
