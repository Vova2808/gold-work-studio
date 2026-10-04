import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm,mkdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {Project,Scene} from "@gold-work/shared";
import {DocumentaryIntelligence} from "./documentary-intelligence.js";
import {AnyModelCompletionUncertainError} from "./anymodel-client.js";
import {effectFfmpeg} from "./effect-media.js";
import {documentaryFrozenVideoRange} from './documentary-video-catalog.js';
import {inspectDocumentaryRangeBatch} from './documentary-range-batch.js';

test('a static image inside MP4 is rejected before paid range review; moving footage remains eligible',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-static-video-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const still=join(root,'still.mp4'),moving=join(root,'moving.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','color=c=red:s=640x360:r=25:d=5','-an','-c:v','libx264',still]);
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=640x360:r=25:d=5','-an','-c:v','libx264',moving]);
  assert.equal(await documentaryFrozenVideoRange(still,0,5),true);
  assert.equal(await documentaryFrozenVideoRange(moving,0,5),false);
  const reviewed=await inspectDocumentaryRangeBatch({file:still,root:join(root,'frames'),request:{},identities:[],
    regions:[{id:0,startSeconds:0,endSeconds:5}],complete:async()=>{throw Error('Static footage must not buy a model review');}});
  assert.equal(reviewed.get('0.000:5.000')?.status,'rejected');
  assert.equal(reviewed.get('0.000:5.000')?.mediaType,'still');
});

test("grouped range review keeps identities separate and persists unknown submissions",async t=>{
  const root=await mkdtemp(join(tmpdir(),"gws-range-batch-"));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,"source.mp4");
  await effectFfmpeg(["-y","-f","lavfi","-i","testsrc2=s=1280x720:r=2:d=60","-an","-c:v","libx264",file]);
  assert.equal(await documentaryFrozenVideoRange(file,11,13),false,'Moving fixture must pass local motion check');
  const scene={id:"one",order:0,narration:"The Panama Canal stretches across the isthmus.",durationSeconds:2,videoPath:file,
    documentary:{checksum:"source",requirement:{text:"The Panama Canal",entities:["Panama Canal"],identities:[{name:"Panama Canal",aliases:[]}],years:[],queries:["Panama Canal waterway"]},
      selected:{kind:"video",title:"Panama Canal",durationSeconds:60,width:1280,height:720}}} as unknown as Scene;
  const project={id:"batch",scenes:[scene]} as Project;
  async function prepare(directory:string){
    const catalog=join(directory,"Documentary","VideoCatalog","source");await mkdir(catalog,{recursive:true});
    const windows=[0,1,2].map(id=>({id,start:id*8,end:(id+1)*8,sample:id*8+4}));
    await writeFile(join(catalog,"catalog-v1.json"),JSON.stringify({version:1,checksum:"source",duration:60,windows,
      segments:windows.map(window=>({...window,description:"Wide canal waterway",camera:true,usable:true,entities:["Panama Canal"]}))}));
  }
  await prepare(root);let calls=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input,images)=>{
    calls++;const data=JSON.parse(input);assert.equal(data.groups.length,3);assert.equal(images?.length,15);
    return JSON.stringify({reviews:[
      {id:data.groups[0].id,status:"accepted",confidence:.99,isCameraFootage:true,identityMatch:true,identifiedEntity:"Wrong canal",mediaType:"camera",presentation:"clean",reason:"Wrong named subject"},
      {id:data.groups[1].id,status:"accepted",confidence:.99,isCameraFootage:true,identityMatch:true,identifiedEntity:"Panama Canal",mediaType:"camera",presentation:"clean",reason:"Mock identity contract",technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'HD fixture'},
        narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'none',evidence:'Visible canal waterway through the isthmus.',eraEvidenceQuote:''}},
      {id:data.groups[2].id,status:"uncertain",confidence:.4,reason:"Unclear"}]});
  }},()=>root);
  const accepted=await intelligence.inspect(project,scene);
  assert.equal(accepted.status,"accepted",accepted.reason);assert.ok(accepted.trimStartSeconds!>=8&&accepted.trimEndSeconds!<16);
  await intelligence.inspect(project,scene);assert.equal(calls,1,"No text-only selector, repeated final call or repayment");
  const unknown=join(root,"unknown");await prepare(unknown);let submits=0;
  const interrupted=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{submits++;throw new AnyModelCompletionUncertainError("disconnected","");}},()=>unknown);
  await assert.rejects(interrupted.inspect(project,scene));await assert.rejects(interrupted.inspect(project,scene));
  assert.equal(submits,1,"Unknown grouped response cannot be resubmitted or replaced with individual paid checks");
});

test('extending a catalog does not pay to inspect the same rejected intervals again',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-stagnant-ranges-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'source.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=2:d=50','-an','-c:v','libx264',file]);
  const scene={id:'one',order:0,narration:'The Panama Canal machinery.',durationSeconds:2,videoPath:file,
    documentary:{checksum:'source',requirement:{text:'Canal machinery',entities:['Panama Canal'],identities:[{name:'Panama Canal',aliases:[]}],years:[],queries:['precise sluice gates'],detail:'precise sluice gates'},
      selected:{kind:'video',title:'Panama Canal',durationSeconds:50,width:1280,height:720}}} as unknown as Scene;
  const project={id:'batch',scenes:[scene]} as Project;
  const catalog=join(root,'Documentary','VideoCatalog','source');await mkdir(catalog,{recursive:true});
  const windows=Array.from({length:12},(_,id)=>({id,start:id*4,end:(id+1)*4,sample:id*4+2}));
  await writeFile(join(catalog,'catalog-v1.json'),JSON.stringify({version:1,checksum:'source',duration:50,windows,
    segments:windows.slice(0,3).map(window=>({...window,description:'Close up precise sluice gates',camera:true,usable:true,entities:['Panama Canal']}))}));
  let catalogCalls=0,reviewCalls=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    const data=JSON.parse(input);
    if(data.frames){catalogCalls++;return JSON.stringify({segments:data.frames.map((frame:{id:number})=>({id:frame.id,description:'Wide canal landscape',camera:true,usable:true,entities:['Panama Canal']}))});}
    reviewCalls++;assert.equal(data.groups.length,3);
    return JSON.stringify({reviews:data.groups.map((group:{id:number})=>({id:group.id,status:'rejected',confidence:.99,isCameraFootage:true,identityMatch:true,identifiedEntity:'Panama Canal',mediaType:'camera',presentation:'clean',reason:'Narrated machinery is not visible'}))});
  }},()=>root);
  const review=await intelligence.inspect(project,scene);
  assert.equal(review.status,'rejected');assert.match(review.reason,/machinery is not visible/);
  assert.equal(catalogCalls,1,'One expansion may look for new details');
  assert.equal(reviewCalls,1,'Different neighboring catalogue rows are not new source pixels');
});
