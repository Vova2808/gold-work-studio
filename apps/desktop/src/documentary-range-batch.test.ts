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
import {documentaryAvailabilityIllustration,documentaryAvailabilitySearchHints,documentaryDistraction} from './documentary-visual-relevance.js';

test('product availability allows an exact-model outdoor view while a literal showroom event stays literal',()=>{
  assert.equal(documentaryAvailabilityIllustration({narration:'The road bike ended up in showrooms.'} as Scene),true);
  assert.equal(documentaryAvailabilityIllustration({narration:'The aircraft came to market.'} as Scene),true);
  assert.equal(documentaryAvailabilityIllustration({narration:'A customer walked into the showroom and bought the bike.'} as Scene),false);
  assert.equal(documentaryAvailabilityIllustration({narration:'The engineer opened the engine inside the showroom.'} as Scene),false);
  const scene={narration:'The road bike ended up in showrooms.',documentary:{requirement:{
    detail:'road-going sportbike on showroom floor',queries:['Yamaha bike showroom'],entities:['Yamaha YZF-R1'],
    identities:[{name:'Yamaha YZF-R1',aliases:[]}]}}} as unknown as Scene;
  assert.deepEqual(documentaryAvailabilitySearchHints(scene),{detail:'road-going sportbike',queries:['Yamaha YZF-R1'],availabilityClaim:true});
  assert.match(documentaryDistraction(scene,'Rider POV looking down at tank, handlebars and street')!,/вид от первого лица/);
  assert.equal(documentaryDistraction(scene,'Wide side profile of the Yamaha sport motorcycle outdoors'),undefined);
});

test('new availability policy does not repay an unknown old range review',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-availability-pending-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'moving.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=640x360:r=8:d=4','-an','-c:v','libx264',file]);
  let posts=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    posts++;throw new AnyModelCompletionUncertainError('disconnected','');
  }},()=>root);
  const oldRequest={narration:'The road bike ended up in showrooms.',searchHints:{detail:'road bike on showroom floor'}};
  const run=(availabilityIllustration:boolean)=>Reflect.get(intelligence,'inspection').run({submissions:0,shouldStop:()=>false},
    ()=>inspectDocumentaryRangeBatch({file,root:join(root,'frames'),request:availabilityIllustration
      ?{narration:oldRequest.narration,searchHints:{detail:'road bike',availabilityClaim:true}}:oldRequest,
      legacyRequest:oldRequest,
      identities:[{name:'Yamaha YZF-R1',aliases:[]}],regions:[{id:0,startSeconds:0,endSeconds:3}],availabilityIllustration,
      complete:(purpose,system,input,images,previous)=>Reflect.get(intelligence,'complete').call(intelligence,'project',purpose,system,input,images,previous)}));
  await assert.rejects(run(false));
  await assert.rejects(run(true),/неизвестный результат/);
  assert.equal(posts,1,'A changed editorial interpretation cannot bypass an uncertain paid checkpoint');
});

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
  scene.documentary!.requirement.scriptRequirements={version:1,scriptText:scene.narration,checks:[
    {id:'subject',kind:'object',scriptQuote:'Panama Canal',required:'Panama Canal'},
    {id:'context',kind:'condition',scriptQuote:'stretches across the isthmus',required:'through the isthmus'}],nonVisual:[]};
  async function prepare(directory:string){
    const catalog=join(directory,"Documentary","VideoCatalog","source");await mkdir(catalog,{recursive:true});
    const windows=[0,1,2].map(id=>({id,start:id*8,end:(id+1)*8,sample:id*8+4}));
    await writeFile(join(catalog,"catalog-v1.json"),JSON.stringify({version:1,checksum:"source",duration:60,windows,
      segments:windows.map(window=>({...window,description:"Wide canal waterway",camera:true,usable:true,entities:["Panama Canal"]}))}));
  }
  await prepare(root);let calls=0,motionCalls=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input,images)=>{
    if(_system.startsWith('Classify ONLY the motion')){
      motionCalls++;assert.doesNotMatch(_system+input,/Panama/);
      return JSON.stringify({motionType:'live-footage',confidence:.99,cameraMoves:false,subjectMoves:true,globalTransformOnly:false,
        subjectMotionEvidence:'Generated pattern changes relative to background.',evidence:'Mock changing video pattern: orchestration evidence only.'});
    }
    calls++;const data=JSON.parse(input);assert.equal(data.groups.length,3);assert.equal(images?.length,15);
    assert.equal(data.originalScript.text,scene.narration);assert.match(_system,/inside EACH reviews member/);
    return JSON.stringify({reviews:[
      {...data.groups[0],status:"accepted",confidence:.99,isCameraFootage:true,identityMatch:true,identifiedEntity:"Wrong canal",mediaType:"camera",presentation:"clean",reason:"Wrong named subject"},
      {...data.groups[1],status:"accepted",confidence:.99,isCameraFootage:true,identityMatch:true,identifiedEntity:"Panama Canal",mediaType:"camera",presentation:"clean",reason:"Mock identity contract",technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'HD fixture'},
        sourceText:{kind:'none',text:''},
        scriptEvidence:{version:1,scriptText:scene.narration,checks:[{requirementId:'subject',kind:'object',scriptQuote:'Panama Canal',required:'Panama Canal',match:true,evidence:'Mock identified canal.'},{requirementId:'context',kind:'condition',scriptQuote:'stretches across the isthmus',required:'through the isthmus',match:true,evidence:'Mock visible waterway.'}]},
        narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'none',evidence:'Visible canal waterway through the isthmus.',eraEvidenceQuote:''}},
      {...data.groups[2],status:"uncertain",confidence:.4,reason:"Unclear"}]});
  }},()=>root);
  const accepted=await intelligence.inspect(project,scene);
  assert.equal(accepted.status,"accepted",accepted.reason);assert.ok(accepted.trimStartSeconds!>=8&&accepted.trimEndSeconds!<16);
  await intelligence.inspect(project,scene);assert.equal(calls,1,"No text-only selector, repeated final call or repayment");
  assert.ok(motionCalls<=1,'Conditional motion evidence is reused');
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
    return JSON.stringify({reviews:data.groups.map((group:{id:number})=>({...group,status:'rejected',confidence:.99,isCameraFootage:true,identityMatch:true,identifiedEntity:'Panama Canal',mediaType:'camera',presentation:'clean',reason:'Narrated machinery is not visible'}))});
  }},()=>root);
  const review=await intelligence.inspect(project,scene);
  assert.equal(review.status,'rejected');assert.match(review.reason,/machinery is not visible/);
  assert.equal(catalogCalls,1,'One expansion may look for new details');
  assert.equal(reviewCalls,1,'Different neighboring catalogue rows are not new source pixels');
});

test('known internal cuts reject a complete batch before paying for any pixel vote',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-cut-before-paid-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'source.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','color=c=red:s=1280x720:r=10:d=12','-vf',"negate=enable='gte(mod(t,4),2)'",'-c:v','libx264','-preset','ultrafast',file]);
  const scene={id:'one',order:0,narration:'The Panama Canal machinery.',durationSeconds:2,videoPath:file,
    documentary:{checksum:'source',requirement:{text:'Canal machinery',entities:['Panama Canal'],identities:[{name:'Panama Canal',aliases:[]}],years:[],queries:['precise sluice gates'],detail:'precise sluice gates'},
      selected:{kind:'video',title:'Panama Canal',durationSeconds:50,width:1280,height:720}}} as unknown as Scene;
  const project={id:'cuts',scenes:[scene]} as Project;
  const catalog=join(root,'Documentary','VideoCatalog','source');await mkdir(catalog,{recursive:true});
  const windows=[0,1,2].map(id=>({id,start:id*4,end:(id+1)*4,sample:id*4+2}));
  await writeFile(join(catalog,'catalog-v1.json'),JSON.stringify({version:1,checksum:'source',duration:50,windows,
    segments:windows.map(w=>({...w,description:'Close up precise sluice gates',camera:true,usable:true,entities:['Panama Canal']}))}));
  let posts=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{posts++;throw Error('A cut interval must not reach the model');}},()=>root);
  const review=await intelligence.inspect(project,scene);
  assert.equal(review.status,'rejected');assert.equal(review.rangeIssue,'cut');assert.equal(posts,0);
});
