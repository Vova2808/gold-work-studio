import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {documentaryAiPlanContext,type DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryProjectService,documentarySimpleCandidatePriority,selectSimpleDocumentaryCandidates} from './documentary-project-service.js';
import {documentaryMaterialMetadataIssue} from './documentary-material-metadata.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {documentaryIllustrationApproval} from './documentary-context-approval.js';
import {effectFfmpeg} from './effect-media.js';

test('failed physical task merges fresh focused discovery before paying to inspect generic saved cards',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-focused-resume-'));t.after(()=>rm(root,{recursive:true,force:true}));
 t.mock.method(globalThis,'fetch',async()=>assert.fail('No live requests in orchestration fixture'));
 const file=join(root,'fixture.png');await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720','-frames:v','1',file]);
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let p=await projects.create({title:'A vessel',topic:'A vessel',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 const narration='Aurora carried a wide spread of red sails.';
 p.videoBrief={...p.videoBrief!,creationMode:'script',readyScript:narration};
 p.settings.stockVideoPercent=0;p.settings.voice.enabled=false;p.settings.assembly.documentary!.autoMotionGraphics=false;
 p.scenes=[prepareDocumentaryScript(p)[0]!];const scene=p.scenes[0]!,doc=scene.documentary!;
 scene.durationSeconds=4;scene.audioPath='saved-paid-voice.wav';
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const inputHash=hash({version:1,model:'fixture',context:documentaryAiPlanContext(p)});
 doc.requirement={...doc.requirement,text:narration,entities:['Aurora'],identities:[{name:'Aurora',aliases:[]}],years:[],queries:['Aurora red sails'],
  aiSearchPlan:{version:1,inputHash:hash({inputHash,sceneId:scene.id}),model:'fixture',subject:'Aurora',visualTarget:'Aurora red sails',
   years:[],visualScope:'illustrative',preferredKind:'image',imageQueries:['Aurora red sails'],videoQueries:[],fallbackVideoQueries:[],fallbackVisualTarget:'',
   grounding:{version:1,mandatory:[{kind:'identity',required:'Aurora',scriptQuote:narration},{kind:'condition',required:'red sails',scriptQuote:narration}],
    illustrations:['Aurora with red sails'],optionalDetails:[]}}};
 const candidate=(id:string,title:string):DocumentaryCandidate=>({id,provider:'commons',kind:'image',title,description:title,
  width:1280,height:720,localPath:file,downloadUrl:'https://example.test/'+id+'.png',pageUrl:'https://example.test/'+id,
  author:'Fixture',license:'public domain',licenseUrl:'',rights:'public-domain',attribution:'Fixture',query:'Aurora',retrievedAt:'now',match:'unverified',concerns:[]});
 const stale=candidate('stale','Aurora at a museum'),fresh=candidate('fresh','Aurora under red sails');
 assert.equal(documentaryMaterialMetadataIssue(scene,fresh),undefined);
 assert.equal(selectSimpleDocumentaryCandidates([stale,fresh],documentarySimpleCandidatePriority(p,scene,'image'))[0]?.id,'fresh');
 doc.candidates=[stale];doc.autoError='Previous search did not find the visible condition.';
 p=await projects.mutate(p.id,()=>p);let commonsQueries=0;const inspected:string[]=[];const trace:string[]=[];
 const search=new DocumentarySearch();search.search=async input=>{
  trace.push(`search:${input.providers?.join(',')}`);
  if(input.providers?.includes('commons')){
   commonsQueries++;assert.deepEqual(input.visualConstraints,['red sails']);
   await new Promise(resolve=>setTimeout(resolve,20));trace.push('fresh returned');return {candidates:[fresh],sources:[]};
  }
  return {candidates:input.providers?.includes('local')?[stale]:[],sources:[]};
 };
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),
  {download:async()=>assert.fail('Local fixture image needs no transport')},()=>{},
  {simpleSelection:true,available:async()=>true,plan:async()=>new Map([[scene.id,doc.requirement]]),inspect:async()=>assert.fail('Use one image review'),
   inspectForSelection:async(project,current)=>{
    inspected.push(current.documentary!.selected!.id);trace.push(`inspect:${current.documentary!.selected!.id}`);
    const review={status:'accepted' as const,confidence:1,reason:'Mock orchestration verdict, not a live visual check',quality:'',sampleSeconds:[0],checkedAt:'now',
     fastRelevance:{version:1 as const,target:'Aurora red sails',relevant:true,evidence:'Fixture'}};
    return {usedNewAnalysis:true,review:{...review,illustrationApproval:documentaryIllustrationApproval(project,{...current,documentary:{...current.documentary!,visualReview:review}})}};
   }});
 Reflect.set(service,'selectionResources',async()=>({workers:1}));
 const result=await service.autoSelect(p.id,{sceneIds:[scene.id]});
 assert.ok(commonsQueries>0);assert.deepEqual(inspected,['fresh'],`Fresh feature-specific source competes before generic retained cards: ${trace.join('; ')}`);
 assert.equal(result.project.scenes[0]!.documentary!.verified,true);
 assert.equal(result.project.scenes[0]!.audioPath,'saved-paid-voice.wav');
});
