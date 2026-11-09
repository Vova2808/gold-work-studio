import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {effectFfmpeg} from './effect-media.js';
import {documentaryFrozenVideoRange,readVideoFrames} from './documentary-video-catalog.js';
import {documentaryPreviewFramesRoot} from './documentary-preview.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {AnyModelCompletionUncertainError} from './anymodel-client.js';
import {inspectDocumentaryRangeBatch,documentaryRangeKey} from './documentary-range-batch.js';
import {matchPreviewHistory} from './documentary-preview-history.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';

const video=(file:string,color:string)=>effectFfmpeg(['-y','-f','lavfi','-i',`color=c=${color}:s=640x360:r=10:d=3`,'-c:v','libx264','-preset','ultrafast',file]);
const preview=(path:string)=>({bytes:1000,segments:[0,1,2].map(i=>({path,start:i*10,end:i*10+3}))});
const camera=()=>JSON.stringify({samples:[0,1,2].map(index=>({index,kind:'camera',confidence:.99,evidence:'Actual test pixels: orchestration only.'}))});

test('permuted source indices cannot transfer approval to another video interval',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-range-owner-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'source.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=640x360:r=10:d=10','-c:v','libx264','-preset','ultrafast',file]);
  const regions=[{id:2,startSeconds:0,endSeconds:2},{id:0,startSeconds:3,endSeconds:5},{id:1,startSeconds:6,endSeconds:8}];
  const options={file,root:join(root,'frames'),request:{neighboringViews:regions.map(r=>({id:r.id,views:[r.id]}))},identities:[],regions};
  const result=await inspectDocumentaryRangeBatch({...options,complete:async(_purpose,_system,input)=>{
    const data=JSON.parse(input);assert.deepEqual(data.groups.map((g:any)=>g.id),[0,1,2]);
    assert.deepEqual(data.neighboringViews.map((g:any)=>g.views),[[2],[0],[1]]);
    return {reviews:data.groups.map((g:any)=>({...g,status:g.id===1?'rejected':'accepted'}))};
  }});
  assert.equal(result.get(documentaryRangeKey(3,5))?.status,'rejected');
  for(const malformed of ['extra','missing','duplicate','swapped-range']){
    const invalid=await inspectDocumentaryRangeBatch({...options,complete:async(_p,_s,input)=>{
      const groups=JSON.parse(input).groups;
      let rows=groups.map((g:any)=>({...g,status:'accepted'}));
      if(malformed==='extra')rows.push({...rows[0],id:9});
      if(malformed==='missing')rows.pop();
      if(malformed==='duplicate')rows[1]=rows[0];
      if(malformed==='swapped-range'){rows[1].startSeconds=rows[0].startSeconds;rows[1].endSeconds=rows[0].endSeconds;}
      return {reviews:rows};
    }});
    assert.equal(invalid.get(documentaryRangeKey(3,5))?.status,'uncertain',malformed);
  }
  let old:{system:string;input:string;images:string[]}|undefined;
  await inspectDocumentaryRangeBatch({...options,complete:async(_p,_s,input,images,previous)=>{
    const request=previous!.find(p=>JSON.parse(p.input).groups[0].id===2)!;
    old={...request,images};return {reviews:JSON.parse(input).groups.map((g:any)=>({...g,status:'rejected'}))};
  }});
  let posts=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{posts++;throw new AnyModelCompletionUncertainError('interrupted');}},()=>join(root,'checkpoints'));
  const complete=Reflect.get(intelligence,'complete').bind(intelligence);
  await assert.rejects(complete('p','catalog-range-batch',old!.system,old!.input,old!.images));
  await assert.rejects(inspectDocumentaryRangeBatch({...options,complete:(...args)=>complete('p',...args)}));
  assert.equal(posts,1,'New grouped contract cannot repay an unknown old request');
});

test('freeze checks share exact ranges, invalidate replaced bytes and recover after a failed decode',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-freeze-revision-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'source.mp4');await video(file,'red');
  const spawn=childProcess.spawn;let decodes=0;
  childProcess.spawn=((exe:string,args:string[],...rest:unknown[])=>{
    if(args.some(arg=>arg.includes('freezedetect')))decodes++;
    return Reflect.apply(spawn,childProcess,[exe,args,...rest]);
  }) as typeof spawn;syncBuiltinESMExports();
  t.after(()=>{childProcess.spawn=spawn;syncBuiltinESMExports();});
  assert.deepEqual(await Promise.all([documentaryFrozenVideoRange(file,0,3),documentaryFrozenVideoRange(file,0,3)]),[true,true]);
  assert.equal(decodes,1);
  await documentaryFrozenVideoRange(file,.5,3);assert.equal(decodes,2,'Different range needs its own check');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=640x360:r=10:d=3','-c:v','libx264','-preset','ultrafast',file]);
  assert.equal(await documentaryFrozenVideoRange(file,0,3),false);assert.equal(decodes,3);
  await writeFile(file,'invalid media');
  await assert.rejects(documentaryFrozenVideoRange(file,0,3));
  await assert.rejects(documentaryFrozenVideoRange(file,0,3));
  assert.equal(decodes,5,'Failed check is not cached');
});

test('recovered preview checks decode the current pixels and reuse only unchanged completed reviews',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-preview-revision-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'sample.mp4');await video(file,'red');
  const firstRoot=await documentaryPreviewFramesRoot(file);
  const red=await readVideoFrames(file,firstRoot,[.15]);let posts=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{posts++;return camera();}},()=>root);
  await intelligence.inspectPreview('p','source',preview(file));
  await intelligence.inspectPreview('p','source',preview(file));assert.equal(posts,1);
  await video(file,'blue');
  const secondRoot=await documentaryPreviewFramesRoot(file);assert.notEqual(secondRoot,firstRoot);
  const blue=await readVideoFrames(file,secondRoot,[.15]);assert.notDeepEqual(blue,red);
  await intelligence.inspectPreview('p','source',preview(file));assert.equal(posts,2,'Changed pixels need a new verdict');
});

for(const partial of ['', '{"samples":'])test(`unknown ${partial?'partial':'pending'} preview survives file recovery, restart and alternate preview purpose`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-preview-pending-revision-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'sample.mp4');await video(file,'red');let posts=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{posts++;throw new AnyModelCompletionUncertainError('interrupted',partial);}},()=>root);
  await assert.rejects(intelligence.inspectPreview('p','source',preview(file)));
  await video(file,'blue');
  const restarted=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{posts++;return camera();}},()=>root);
  await assert.rejects(restarted.inspectPreview('p','source',preview(file)),/незавершённая проверка/);assert.equal(posts,1);
  await restarted.inspectPreview('p','other-source',preview(file));assert.equal(posts,2,'Another scoped source is still eligible');
  const directory=join(root,'Documentary','Analysis');
  for(const name of await readdir(directory)){
    const receipt=JSON.parse(await readFile(join(directory,name),'utf8'));
    if(receipt.previewSourceKey==='source'){delete receipt.previewSourceKey;await writeFile(join(directory,name),JSON.stringify(receipt));}
  }
  // A is opened first: reconstruct its old request before any B request.
  await assert.rejects(restarted.inspectPreview('p','source',preview(file)),/незавершённая проверка/);
  await restarted.inspectPreview('p','new-source',preview(file));
  assert.equal(posts,3,'Migrated A cannot block another source');
});

test('legacy pending A migrates before B, while recovered A remains protected after another restart',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-legacy-owner-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const material=join(root,'Materials'),aKey='a'.repeat(64),bKey='b'.repeat(64);
  const aFile=join(material,'Previews',aKey,'sample.mp4'),bFile=join(material,'Previews',bKey,'sample.mp4');
  await mkdir(join(material,'Previews',aKey),{recursive:true});await mkdir(join(material,'Previews',bKey),{recursive:true});
  await video(aFile,'red');await video(bFile,'blue');
  await writeFile(join(material,'Previews',aKey,'preview.json'),JSON.stringify(preview(aFile)));
  let posts=0;
  const initial=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{posts++;throw new AnyModelCompletionUncertainError('interrupted');}},()=>root,undefined,join(material,'VideoCatalog'));
  await assert.rejects(initial.inspectPreview('p',aKey,preview(aFile)));
  const directory=join(root,'Documentary','Analysis'),name=(await readdir(directory)).find(n=>/^[a-f0-9]{64}\.json$/.test(n))!;
  const receipt=JSON.parse(await readFile(join(directory,name),'utf8'));delete receipt.previewSourceKey;
  const legacy=JSON.stringify(receipt);await writeFile(join(directory,name),legacy);
  await video(aFile,'green');
  const client={configured:async()=>true,documentaryCompletion:async()=>{posts++;return camera();}};
  const restarted=new DocumentaryIntelligence(client,()=>root,undefined,join(material,'VideoCatalog'));
  await restarted.inspectPreview('p',bKey,preview(bFile));assert.equal(posts,2);
  assert.equal(await readFile(join(directory,name),'utf8'),legacy,'Migration must preserve raw receipt and state');
  const again=new DocumentaryIntelligence(client,()=>root,undefined,join(material,'VideoCatalog'));
  await assert.rejects(again.inspectPreview('p',aKey,preview(aFile)),/незавершённая проверка/);assert.equal(posts,2);
});

test('history reconstruction includes independently recovered segments and is bounded',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-history-tuples-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const segments=[0,1,2].map(i=>({path:join(root,`s${i}.mp4`),start:i*10,end:i*10+3}));
  const request={purpose:'visual-preview-combined',system:'exact old system',input:'exact old input'};
  const images:string[]=[];
  for(const [i,segment] of segments.entries()){
    const base=`${segment.path}-frames`;
    for(const version of ['a'.repeat(64),'b'.repeat(64)]){
      await mkdir(join(base,version),{recursive:true});
      for(const time of [.15,1.5,2.75])await writeFile(join(base,version,`${time.toFixed(3)}.jpg`),`${i}:${version}:${time}`);
    }
    const version=(i===1?'b':'a').repeat(64);
    for(const time of [.15,1.5,2.75])images.push(`data:image/jpeg;base64,${Buffer.from(`${i}:${version}:${time}`).toString('base64')}`);
  }
  const key=documentaryCheckpointKey(request.purpose,request.system,request.input,images);
  const recovered=await matchPreviewHistory({segments,bytes:0},[request],new Set([key]));
  assert.deepEqual(recovered.matches,[key]);assert.equal(recovered.incomplete,false);
  for(let v=0;v<5;v++)for(const [i,segment] of segments.entries()){
    const directory=join(`${segment.path}-frames`,String(v).repeat(64));await mkdir(directory,{recursive:true});
    for(const time of [.15,1.5,2.75])await writeFile(join(directory,`${time.toFixed(3)}.jpg`),`${i}:${v}:${time}`);
  }
  assert.equal((await matchPreviewHistory({segments,bytes:0},[request],new Set(['unknown']))).incomplete,true);
});

test('combined legacy recovery and identical-owner aliases never repay the original A',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-combined-alias-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const aFile=join(root,'a.mp4'),bFile=join(root,'b.mp4');await video(aFile,'red');await video(bFile,'red');
  const requirement={text:'A ship.',entities:[],identities:[],years:[],queries:['ship']};
  const scene={id:'scene',order:0,narration:'A ship.',documentary:{requirement}} as any;
  const project={id:'p',scenes:[scene]} as any;
  const a={id:'A',provider:'youtube',kind:'video',title:'same title',downloadUrl:'https://example.test/a.mp4',durationSeconds:300} as any;
  const b={...a,id:'B',downloadUrl:'https://example.test/b.mp4'};
  let posts=0;
  const initial=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{posts++;throw new AnyModelCompletionUncertainError('interrupted');}},()=>root);
  await assert.rejects(initial.inspectCombinedPreview(project,scene,a,preview(aFile)));
  const directory=join(root,'Documentary','Analysis'),name=(await readdir(directory)).find(n=>/^[a-f0-9]{64}\.json$/.test(n))!;
  const receipt=JSON.parse(await readFile(join(directory,name),'utf8'));assert.equal(receipt.purpose,'visual-preview-combined');
  delete receipt.previewSourceKey;await writeFile(join(directory,name),JSON.stringify(receipt));
  // Retain B's original matching JPEGs without creating a second paid receipt.
  await readVideoFrames(bFile,await documentaryPreviewFramesRoot(bFile),[.15,1.5,2.75]);
  await video(aFile,'blue');await video(bFile,'blue');
  const client={configured:async()=>true,documentaryCompletion:async()=>{posts++;return JSON.stringify({selectedIndex:0,confidence:.99,isCameraFootage:true});}};
  const firstB=new DocumentaryIntelligence(client,()=>root);
  await assert.rejects(firstB.inspectCombinedPreview(project,scene,b,preview(bFile)),/незавершённая проверка/);
  assert.equal(posts,1);
  const againA=new DocumentaryIntelligence(client,()=>root);
  await assert.rejects(againA.inspectCombinedPreview(project,scene,a,preview(aFile)),/незавершённая проверка/);
  assert.equal(posts,1,'A remains protected when the first reconstructed alias was B');
  assert.equal((await readdir(directory)).filter(n=>n.includes('.preview-owner-')).length,2);
});

test('different revisions of one preview owner cannot race into two paid requests',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-preview-race-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const a=join(root,'a.mp4'),b=join(root,'b.mp4');await video(a,'red');await video(b,'blue');
  let started!:()=>void,release!:()=>void,posts=0;
  const sent=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>release=r);
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{posts++;started();await gate;throw new AnyModelCompletionUncertainError('interrupted');}},()=>root);
  const first=intelligence.inspectPreview('p','same-source',preview(a));const firstResult=first.catch(e=>e);
  await sent;const second=intelligence.inspectPreview('p','same-source',preview(b));const secondResult=second.catch(e=>e);
  release();await Promise.all([firstResult,secondResult]);assert.equal(posts,1);
});
