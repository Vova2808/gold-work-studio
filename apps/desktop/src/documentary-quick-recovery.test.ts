import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,readFile,writeFile,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {effectFfmpeg} from './effect-media.js';
import {DocumentaryYouTube} from './documentary-youtube.js';

test('a quick pixel refusal inspects targeted stock before YouTube without resetting its budget',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-quick-feedback-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'People',topic:'City',language:'en',aspectRatio:'16:9',mode:'standard',mediaMode:'stock'});
 const text='People walk along a city street.';
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:text};
 const scene=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:text,audioDurationSeconds:4}))[0]!;
 scene.documentary!.requirement={...scene.documentary!.requirement,plannedBy:'semantic',identityContextVersion:3,visualScope:'illustrative',visualScopeVersion:3,
  visualScopeQuote:text,illustrationQuery:'people city street',entities:[],identities:[],years:[],queries:['people city street'],preferredKind:'video',
  scriptRequirements:{version:1,mode:'thematic',scriptText:text,checks:[{id:'theme',kind:'object',scriptQuote:text,required:'people city street'}],nonVisual:[]}};
 project.settings.voice.enabled=false;project.settings.stockVideoPercent=100;project.settings.assembly.documentary!.matchMode='thematic';
 project=await projects.update(project.id,{scenes:[scene],settings:project.settings});
 const files=[join(root,'empty.mp4'),join(root,'people.mp4')];
 for(const [index,file] of files.entries())await effectFfmpeg(['-y','-f','lavfi','-i',`testsrc2=size=1280x720:rate=10:duration=6,negate=${index?'enable=1':'enable=0'}`,'-c:v','libx264','-preset','ultrafast','-threads','1',file]);
 const candidates=files.map((file,index)=>({id:`pexels:${index}`,provider:'pexels',kind:'video',title:'people city street',description:'Orchestration fixture',query:'people city street',
  width:1280,height:720,durationSeconds:6,rights:'licensed',match:'unverified',concerns:[],pageUrl:`https://example.test/${index}`,downloadUrl:`https://example.test/${index}.mp4`,license:'Fixture',
  author:'Fixture',licenseUrl:'',attribution:'Fixture',retrievedAt:'now'} as DocumentaryCandidate));
 const queries:string[]=[];
 const search=new DocumentarySearch();search.search=async input=>{
  queries.push(input.query);assert.ok(!input.providers?.includes('youtube'),'Targeted stock must be exhausted before archive discovery');
  return {candidates:[input.query==='pedestrians city sidewalk'?candidates[1]!:candidates[0]!],sources:[]};
 };
 let checks=0;const progress:string[]=[];
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),{
  download:async asset=>({data:await readFile(files[asset.id.endsWith(':0')||asset.id==='0'?0:1]!),extension:'.mp4',contentType:'video/mp4'}),
 },event=>{progress.push(event.message);}, {available:async()=>true,plan:async(_p,scenes)=>new Map(scenes.map(s=>[s.id,s.documentary!.requirement])),
  inspect:async(_p,current)=>{checks++;return {status:current.documentary!.selected!.id==='pexels:0'?'rejected':'accepted',confidence:1,
   reason:'Mock frame verdict for orchestration',checkedAt:'now',sampleSeconds:[.1,2,3.8],trimStartSeconds:0,trimEndSeconds:4,quality:'1280x720',
   nextSearchQueries:['pedestrians city sidewalk'],scriptEvidence:{version:1,scriptText:text,checks:[{requirementId:'theme',kind:'object',scriptQuote:text,
    required:'people city street',match:current.documentary!.selected!.id!=='pexels:0',evidence:'Mock topic refusal triggers the next stock query.'}]}};},
  rankCandidates:async()=>{assert.fail('An actual completed thematic refusal does not require paid metadata reranking');},
 });
 const result=await service.autoSelect(project.id);
 assert.equal(result.failed,0,JSON.stringify({failures:result.failures,queries,checks,progress,error:result.project.scenes[0]?.documentary?.autoError}));assert.equal(result.selected,1);assert.equal(checks,2);
 assert.ok(queries.includes('pedestrians city sidewalk'));
 const budget=JSON.parse(await readFile(join(root,'projects',project.id,'Documentary','selection-budget.json'),'utf8'));
 assert.equal(budget.scenes[0].attempts,2,'Recovery shares the original three-attempt cap');
});

test('translated unavailable YouTube formats do not exhaust content checks',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-format-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'People',topic:'City',language:'en',aspectRatio:'16:9',mode:'standard',mediaMode:'stock'});
 const text='People walk along a city street.';
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:text};
 const scene=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:text,audioDurationSeconds:4}))[0]!;
 scene.documentary!.requirement={...scene.documentary!.requirement,plannedBy:'semantic',identityContextVersion:3,visualScope:'illustrative',visualScopeVersion:3,
  visualScopeQuote:text,illustrationQuery:'people city street',entities:[],identities:[],years:[],queries:['people city street'],preferredKind:'video',
  scriptRequirements:{version:1,mode:'thematic',scriptText:text,checks:[{id:'theme',kind:'object',scriptQuote:text,required:'people city street'}],nonVisual:[]}};
 project.settings.voice.enabled=false;project.settings.stockVideoPercent=100;project.settings.assembly.documentary!.matchMode='thematic';
 project=await projects.update(project.id,{scenes:[scene],settings:project.settings});
 const file=join(root,'people.mp4');
 await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=10:duration=6','-c:v','libx264','-preset','ultrafast','-threads','1',file]);
 const ids=['abcdefghij0','abcdefghij1','abcdefghij2','abcdefghij3'];
 const candidates=ids.map(id=>({id:`youtube:${id}`,provider:'youtube',kind:'video',title:'people city street',description:'Orchestration fixture',query:'people city street',
  width:1280,height:720,durationSeconds:6,rights:'licensed',match:'unverified',concerns:[],pageUrl:`https://www.youtube.com/watch?v=${id}`,downloadUrl:`https://www.youtube.com/watch?v=${id}`,
  license:'Creative Commons',author:'Fixture',licenseUrl:'',attribution:'Fixture',retrievedAt:'now'} as DocumentaryCandidate));
 const downloads:string[]=[];
 const youtube=new DocumentaryYouTube({apiKey:async()=> 'fixture',resolveValidatedCookies:async()=>undefined},async input=>{
  const id=new URL(String(input)).searchParams.get('id')!;
  return Response.json({items:[{id,snippet:{title:'people city street'},status:{license:'creativeCommon',privacyStatus:'public'},contentDetails:{duration:'PT6S',definition:'hd'}}]});
 },async(args,_destination,_signal,_progress,directory)=>{
  const id=new URL(args.at(-1)!).searchParams.get('v')!;downloads.push(id);
  if(id!==ids[3])throw Error('Requested format is not available');
  const output=join(directory!,'source.mp4');await copyFile(file,output);
  await writeFile(join(directory!,'complete.json'),JSON.stringify(output)+'\n');
 });
 const search=new DocumentarySearch();search.search=async()=>({candidates,sources:[]});
 let checks=0;
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),{download:async()=>{throw Error('Unexpected stock download');}},()=>{},
  {available:async()=>true,plan:async(_p,scenes)=>new Map(scenes.map(s=>[s.id,s.documentary!.requirement])),rankCandidates:async(_p,_s,pool)=>pool,
   inspect:async()=>{checks++;return {status:'accepted',confidence:1,reason:'Mock pixel verdict',checkedAt:'now',sampleSeconds:[.1,2,3.8],trimStartSeconds:0,trimEndSeconds:4,quality:'1280x720',
    scriptEvidence:{version:1,scriptText:text,checks:[{requirementId:'theme',kind:'object',scriptQuote:text,required:'people city street',match:true,evidence:'Mock topic confirmation'}]}};}},
  undefined,{download:youtube.download.bind(youtube)});
 const result=await service.autoSelect(project.id);
 assert.equal(result.failed,0,JSON.stringify(result.failures));assert.equal(result.selected,1);assert.equal(checks,1);
 assert.deepEqual(downloads,ids,'Known rejected formats are not downloaded again during discovery');
 const budget=JSON.parse(await readFile(join(root,'projects',project.id,'Documentary','selection-budget.json'),'utf8'));
 assert.equal(budget.scenes[0].attempts,1);
 const cache=JSON.parse(await readFile(join(root,'projects',project.id,'Documentary',scene.id,'unavailable-formats.json'),'utf8'));
 assert.equal(cache.keys.length,3);
});
