import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {documentaryAiPlanContext,type DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {setDiagnosticSink} from './diagnostics.js';

test('normal selection rejects the saved museum metadata before any download or paid inspection',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-source-exclusions-'));t.after(()=>rm(root,{recursive:true,force:true}));
 t.mock.method(globalThis,'fetch',async()=>assert.fail('No live requests in this fixture'));
 const refusals:Array<Record<string,unknown>>=[];
 setDiagnosticSink((_level,event,details)=>{if(event==='documentary.selection.metadata-rejected')refusals.push(details);});
 t.after(()=>setDiagnosticSink());
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'A historic vessel',topic:'A historic vessel',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 const narration='Cutty Sark was an extreme clipper. Her construction combined iron frames with wooden planking.';
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};
 project.settings.stockVideoPercent=100;project.settings.voice.enabled=false;
 project.settings.assembly.documentary!.autoMotionGraphics=false;project.settings.assembly.documentary!.autoEffects=false;
 project.scenes=[prepareDocumentaryScript(project)[0]!];const scene=project.scenes[0]!,doc=scene.documentary!;
 scene.narration=narration;scene.durationSeconds=4;scene.audioPath='preserved-paid-voice.wav';
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const inputHash=hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)});
 doc.requirement={...doc.requirement,text:narration,entities:['Cutty Sark'],identities:[{name:'Cutty Sark',aliases:[]}],years:[],
  preferredKind:'video',queries:['Cutty Sark hull construction'],aiSearchPlan:{version:1,inputHash:hash({inputHash,sceneId:scene.id}),model:'fixture',
   subject:'Cutty Sark hull construction',visualTarget:'Cutty Sark iron frames with wooden planking',years:[],visualScope:'illustrative',preferredKind:'video',
   imageQueries:['Cutty Sark hull photograph'],videoQueries:['Cutty Sark hull construction'],fallbackVideoQueries:[],fallbackVisualTarget:'',
   grounding:{version:1,mandatory:[{kind:'identity',required:'Cutty Sark',scriptQuote:'Cutty Sark was an extreme clipper.'},
    {kind:'condition',required:'iron frames with wooden planking',scriptQuote:'Her construction combined iron frames with wooden planking.'}],
    illustrations:['A view of the same ship showing its hull construction.'],optionalDetails:[]}}};
 const candidate:DocumentaryCandidate={id:'youtube:WCarSkSnci0',provider:'youtube',kind:'video',
  title:'Exploring the National Maritime Museum in Greenwich, England',
  description:'When we took a Thames River Cruise from London to Greenwich to see the Royal Meridien, we discovered the National Maritime Museum, one of a quartet of the Royal Museums in Greenwich. The others are the Royal Observatory Greenwich, where the Meridien resides, and two others that will have to wait till next time: the historic ship Cutty Sark and the Queen\'s House.',
  // A short eligible clip isolates the metadata gate from long-source budgets.
  width:1920,height:1080,durationSeconds:7.74,videoDefinition:'hd',downloadUrl:'https://www.youtube.com/watch?v=WCarSkSnci0',
  pageUrl:'https://www.youtube.com/watch?v=WCarSkSnci0',author:'Fixture',license:'CC BY',licenseUrl:'',rights:'licensed',
  attribution:'Fixture',query:'Cutty Sark hull construction',retrievedAt:'now',match:'unverified',concerns:[]};
 doc.candidates=[candidate];project=await projects.mutate(project.id,()=>project);
 let searches=0,downloads=0,inspections=0;
 const search=new DocumentarySearch();search.search=async()=>{searches++;return {candidates:[candidate],sources:[]};};
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),
  {download:async()=>{downloads++;throw new Error('Fixture stopped before transport');}},()=>{},
  {simpleSelection:true,available:async()=>true,plan:async current=>new Map([[scene.id,current.scenes[0]!.documentary!.requirement]]),
   inspect:async()=>assert.fail('Use selection review'),inspectForSelection:async()=>{inspections++;throw new Error('Fixture must not pay for excluded metadata');}},
  undefined,undefined,{plan:async(_current,scenes)=>new Map(scenes.map(value=>[value.id,value.documentary!.requirement]))});
 Reflect.set(service,'selectionResources',async()=>({workers:1}));service.localCandidates=async()=>[];
 const result=await service.autoSelect(project.id,{sceneIds:[scene.id]});
 assert.ok(searches>0,'The actual selection path discovered the saved card');
 assert.ok(refusals.some(value=>value.candidateId===candidate.id&&/отложен|не показан/iu.test(String(value.reason))),
  'The actual pre-analysis callsite must identify the explicit exclusion, not another downstream gate');
 assert.equal(downloads,0,'An explicit source exclusion must stop before download');
 assert.equal(inspections,0,'No paid inspection may start for this source');
 assert.equal(result.project.scenes[0]!.documentary!.verified,false);
 assert.equal(result.project.scenes[0]!.audioPath,'preserved-paid-voice.wav');
});
