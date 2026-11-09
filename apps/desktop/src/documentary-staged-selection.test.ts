import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type DocumentaryCandidate,type DocumentarySearchInput} from '@gold-work/shared';
import {DocumentaryProjectService,documentaryCacheableVisualRejection} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {effectFfmpeg} from './effect-media.js';
import {documentaryPreviewKey} from './documentary-preview.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {documentaryContextApproval,documentarySavedContextIssue} from './documentary-context-approval.js';
import {documentaryScriptRequirements} from './documentary-script-evidence.js';

test('ordinary 35-second stock goes straight to final pixels; a saved uncertain preview keeps its guard',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-short-stock-preview-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'source.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=10','-t','35','-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p',file]);
  for(const [savedPreview,local] of [[false,false],[true,false],[false,true]]){
    const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
    let p=await projects.create({title:'Ordinary',topic:'City traffic',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
    p.videoBrief={...p.videoBrief!,creationMode:'script',readyScript:'Cars move along a city street.'};
    const calibration=createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:p.videoBrief.readyScript!,audioDurationSeconds:5});
    const scene=prepareDocumentaryScript(p,calibration)[0]!;
    scene.documentary!.requirement={...scene.documentary!.requirement,text:scene.narration,entities:[],identities:[],years:[],queries:['city traffic'],preferredKind:'video',plannedBy:'semantic',identityContextVersion:3,
      visualScope:'illustrative',visualScopeVersion:3,visualScopeQuote:scene.narration,illustrationQuery:'city traffic'};
    p=await projects.update(p.id,{settings:{...p.settings,stockVideoPercent:100},scenes:[scene]});
    const candidate:DocumentaryCandidate={id:'pexels:traffic',provider:'pexels',kind:'video',title:'city traffic',description:'Metadata does not approve pixels',
      width:1280,height:720,durationSeconds:35,query:'city traffic',pageUrl:'https://example.test/traffic',downloadUrl:'https://example.test/traffic.mp4',
      author:'Fixture',license:'Fixture',licenseUrl:'',attribution:'Fixture',rights:'licensed',retrievedAt:'now',match:'unverified',concerns:[]};
    const materials=join(root,`${savedPreview}-${local}`,'Materials');
    if(savedPreview){
      const previewRoot=join(materials,'Previews',documentaryPreviewKey(candidate));await mkdir(previewRoot,{recursive:true});
      const segments=[];
      for(let i=0;i<3;i++){const path=join(previewRoot,`sample-${i}.mp4`);await copyFile(file,path);segments.push({start:i*8,end:i*8+3,path});}
      await writeFile(join(previewRoot,'preview.json'),JSON.stringify({segments,bytes:1}));
    }
    let downloads=0,previews=0,pixelChecks=0;
    const searcher=new DocumentarySearch();searcher.search=async()=>({candidates:[candidate],sources:[]});
    const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,String(savedPreview),'projects')),searcher,materials,
      {download:async()=>{downloads++;return {data:await readFile(file),extension:'.mp4',contentType:'video/mp4'};},
        downloadRangeToFile:async()=>{throw Error('A small stock original must not spend time seeking through the CDN');}},()=>{},
      {available:async()=>true,plan:async(_p,scenes)=>new Map(scenes.map(s=>[s.id,s.documentary!.requirement])),
        inspectPreview:async()=>{previews++;throw new DocumentaryAnalysisError('Unknown prior paid preview','pending','visual-source-preview');},
        inspect:async(_p,current)=>{pixelChecks++;assert.ok(current.videoPath);return {status:'accepted',confidence:.99,reason:'Mock pixel verdict; orchestration only',checkedAt:'now',sampleSeconds:[.1,2,4],trimStartSeconds:0,trimEndSeconds:5,quality:'1280x720'};}});
    if(local){
      service.localCandidates=async()=>[{...candidate,id:'local:saved',provider:'local',localPath:file}];
      searcher.search=async()=>{throw Error('A saved matching original must precede remote discovery');};
    }
    const result=await service.autoSelect(p.id,{sceneIds:[scene.id]});
    assert.equal(previews,savedPreview?1:0);
    assert.equal(downloads,savedPreview||local?0:1);assert.equal(pixelChecks,savedPreview?0:1);
    assert.equal(Boolean(result.project.scenes[0]!.documentary!.verified),!savedPreview);
  }
});

for(const rejectFirst of [false,true])test(`staged selection ${rejectFirst?'continues after rejection':'accepts precise material before archive queries'} without touching another scene`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-staged-selection-'));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Motorcycle',topic:'Honda RC211V',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'The Honda RC211V is a racing motorcycle.'};
  const calibration=createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:'The Honda RC211V is a racing motorcycle.',audioDurationSeconds:4});
  const scene=prepareDocumentaryScript(project,calibration)[0]!;
  scene.audioPath=join(root,'paid-voice-preserved.mp3');
  scene.documentary!.requirement={...scene.documentary!.requirement,entities:['Honda RC211V'],identities:[{name:'Honda RC211V',aliases:[]}],years:[],queries:['Honda RC211V'],preferredKind:'image',plannedBy:'semantic',identityContextVersion:3};
  project=await projects.update(project.id,{settings:{...project.settings,stockVideoPercent:0},scenes:[scene,{...structuredClone(scene),id:'untouched',order:1}]});
  const untouched=structuredClone(project.scenes[1]);
  const candidates:DocumentaryCandidate[]=[];
  for(const [index,color] of ['red','blue'].entries()){
    const file=join(root,`source-${index}.png`);
    await effectFfmpeg(['-y','-f','lavfi','-i',`color=c=${color}:s=1280x720`,'-frames:v','1',file]);
    candidates.push({id:`source-${index}`,provider:'commons',kind:'image',title:'Honda RC211V',description:'Synthetic local test fixture, not provider or semantic evidence',
      localPath:file,width:1280,height:720,pageUrl:`https://example.test/source-${index}`,downloadUrl:'',author:'test',license:'Own fixture',licenseUrl:'',rights:'user-confirmed',attribution:'test',query:'Honda RC211V',retrievedAt:'now',match:'exact-metadata',concerns:[]});
  }
  const calls:string[]=[],inspected:string[]=[],queries:string[]=[];
  const searcher=new DocumentarySearch();
  searcher.search=async(input:DocumentarySearchInput)=>{
    queries.push(input.query);
    const precise=input.kind==='image'&&input.providers?.length===1&&input.providers[0]==='commons';
    if(!precise)assert.ok(inspected.length>0,'Broader providers must not precede actual-frame inspection of precise results');
    calls.push(precise?'precise':'broad');
    return {candidates:precise?[candidates[0]!]:candidates,sources:[]};
  };
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),searcher,join(root,'Materials'),
    {download:async()=>{throw new Error('No remote media in this regression test');}},()=>{},{
      available:async()=>true,
      plan:async(_project,scenes)=>new Map(scenes.map(s=>[s.id,s.documentary!.requirement])),
      rankCandidates:async(_project,_scene,pool)=>pool,
      inspect:async(_project,current)=>{
        const id=current.documentary!.selected!.id;inspected.push(id);
        assert.equal((await projects.get(project.id))!.scenes[0]!.documentary!.verified,false,'Unreviewed pixels cannot be committed');
        return {status:rejectFirst&&id==='source-0'?'rejected':'accepted',confidence:.99,reason:'Stub semantic result for orchestration only',checkedAt:'now',sampleSeconds:[],quality:'1280x720',
          ...(rejectFirst&&id==='source-0'?{nextSearchQueries:['Honda RC211V race track']}: {})};
      },
    });
  const result=await service.autoSelect(project.id,{sceneIds:[scene.id]});
  assert.equal(result.selected,1,JSON.stringify(result.failures));
  assert.deepEqual(inspected,rejectFirst?['source-0','source-1']:['source-0']);
  assert.equal(calls.includes('broad'),rejectFirst);
  if(rejectFirst)assert.ok(queries.includes('Honda RC211V race track'),'Completed visual refusal supplies targeted discovery within the same run');
  assert.equal(result.project.scenes[0]!.documentary!.selected!.id,rejectFirst?'source-1':'source-0');
  assert.equal(result.project.scenes[0]!.audioPath,scene.audioPath);
  assert.deepEqual(result.project.scenes[1],untouched);
  if(!rejectFirst){
    const replaced=await service.autoSelect(project.id,{sceneIds:[scene.id],force:true});
    assert.equal(replaced.project.scenes[0]!.documentary!.selected!.id,'source-1');
    assert.deepEqual(inspected,['source-0','source-1'],'Force replacement must not pay to approve the same original again');
    assert.equal(replaced.project.scenes[0]!.audioPath,scene.audioPath);
    assert.deepEqual(replaced.project.scenes[1],untouched);
  }
});

test('actual video discovery retains the planned rival and event in the second YouTube query',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gws-rival-discovery-'));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let p=await projects.create({title:'Race',topic:'Rossi and Biaggi',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 p.videoBrief={...p.videoBrief!,creationMode:'script',readyScript:'Rossi faced Max Biaggi at the 2004 opening race.'};
 const calibration=createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:p.videoBrief.readyScript!,audioDurationSeconds:5});
 const scene=prepareDocumentaryScript(p,calibration)[0]!;
 const queries=['Max Biaggi Honda RC211V 2004 South Africa','Biaggi MotoGP season opener 2004','Max Biaggi pit box Welkom'];
 scene.documentary!.requirement={...scene.documentary!.requirement,entities:['Max Biaggi'],identities:[{name:'Valentino Rossi',aliases:[]},{name:'Max Biaggi',aliases:['Biaggi']}],years:[],queries,preferredKind:'video',plannedBy:'semantic',identityContextVersion:3};
 p=await projects.update(p.id,{settings:{...p.settings,stockVideoPercent:100},scenes:[scene]});
 const seen:string[]=[];
 const searcher=new DocumentarySearch();searcher.search=async(input)=>{
   if(input.kind==='video'&&input.providers?.length===1&&input.providers[0]==='youtube')seen.push(input.query);
   return {candidates:[],sources:[]};
 };
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(root),searcher,join(root,'Materials'),
   {download:async()=>{throw Error('No media in this test');}},()=>{},{available:async()=>true,
     plan:async(_p,scenes)=>new Map(scenes.map(s=>[s.id,s.documentary!.requirement])),inspect:async()=>{throw Error('No candidates');}},
   undefined,{download:async()=>{throw Error('No candidates');}});
 const result=await service.autoSelect(p.id,{sceneIds:[scene.id]});
 assert.equal(result.selected,0);
 assert.deepEqual([...new Set(seen)],queries.slice(0,2));
 assert.ok(!seen.includes('Valentino Rossi'),'The second request must not silently change to the other participant');
});

test('named candidates go to bytes after broad discovery without an extra metadata vote',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-video-pool-'));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Motorcycle',topic:'Honda RC211V',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'The Honda RC211V entered the new four-stroke MotoGP class in 2002.'};
 const calibration=createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:project.videoBrief.readyScript!,audioDurationSeconds:5});
 const scene=prepareDocumentaryScript(project,calibration)[0]!;
 scene.audioPath=join(root,'preserved-voice.mp3');
 scene.documentary!.requirement={...scene.documentary!.requirement,entities:['Honda RC211V'],identities:[{name:'Honda RC211V',aliases:[]}],years:['2002'],
   queries:['Honda RC211V 2002 four-stroke MotoGP'],detail:'four-stroke MotoGP regulations',preferredKind:'video',plannedBy:'semantic',identityContextVersion:3};
 project=await projects.update(project.id,{settings:{...project.settings,stockVideoPercent:100},scenes:[scene]});
 const make=(id:string,title:string,durationSeconds:number):DocumentaryCandidate=>({id,provider:id.startsWith('youtube:')?'youtube':'commons',kind:'video',title,description:'Archive',
   pageUrl:`https://example.test/${id.replace(':','-')}`,downloadUrl:`https://example.test/${id.replace(':','-')}.mp4`,author:'Fixture',license:'CC BY',licenseUrl:'https://example.test/license',
   rights:'licensed',attribution:'Fixture',query:'Honda RC211V 2002',retrievedAt:'now',match:'unverified',concerns:[],durationSeconds});
 const weak=make('youtube:abcdefghijk','Honda RC211V 2002 race archive',600);
 const broad=make('commons:race','Honda RC211V 2002 four-stroke MotoGP',30);
 broad.provider='pexels';broad.id='pexels:race';
 const searcher=new DocumentarySearch();
 searcher.search=async input=>({candidates:input.kind!=='video'?[]:input.providers?.length===1&&input.providers[0]==='youtube'?[weak]:input.providers?.includes('commons')?[broad]:[],sources:[]});
 const ranked:string[][]=[];
 const downloaded:string[]=[];
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),searcher,join(root,'Materials'),
   {download:async asset=>{downloaded.push(asset.downloadUrl!);throw Error('Fixture transfer failure');}},()=>{},
   {available:async()=>true,plan:async(_p,scenes)=>new Map(scenes.map(item=>[item.id,item.documentary!.requirement])),
     rankCandidates:async(_p,_s,pool)=>{ranked.push(pool.map(item=>item.id));return [];},inspect:async()=>{throw Error('No inspection expected');}},
   undefined,{download:async candidate=>{downloaded.push(candidate.downloadUrl);throw Error('Fixture transfer failure');}});
 const result=await service.autoSelect(project.id,{sceneIds:[scene.id]});
 assert.equal(result.selected,0);
 assert.equal(ranked.length,0,'Plausible named metadata is only a download hint, without a paid opinion');
 assert.equal(downloaded[0],broad.downloadUrl,'The precise short archive result precedes a long weak clip');
 assert.ok(downloaded.length<=3,'Failed originals stay within the shared attempt budget');
 assert.equal(result.project.scenes[0]!.audioPath,scene.audioPath);
});

test('an invalid saved ready flag cannot bypass current model/era checks',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-invalid-ready-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let p=await projects.create({title:'Camera',topic:'Canon EOS550D',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  const text='In 2010 Canon EOS550D arrived.';p.videoBrief={...p.videoBrief!,creationMode:'script',readyScript:text};
  const scene=prepareDocumentaryScript(p,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:text,audioDurationSeconds:4}))[0]!;
  const path=join(root,'wrong.jpg');await writeFile(path,'existing file');scene.imagePath=path;scene.audioPath='paid-voice.mp3';
  scene.documentary!.requirement={...scene.documentary!.requirement,text,entities:['Canon EOS550D'],identities:[{name:'Canon EOS550D',aliases:[]}],years:['2010'],queries:['Canon EOS550D 2010'],plannedBy:'semantic',identityContextVersion:3,visualScope:'exact',visualScopeVersion:3};
  scene.documentary!.verified=true;scene.documentary!.checksum='a'.repeat(64);
  scene.documentary!.selected={id:'commons:wrong',provider:'commons',kind:'image',title:'Canon EOS550D 2024 version',description:'',localPath:path,downloadUrl:'https://example.test/wrong.jpg',pageUrl:'https://example.test/wrong',width:1920,height:1080,rights:'licensed',license:'CC BY',licenseUrl:'',author:'Author',attribution:'Author',retrievedAt:'now',query:'camera',match:'unverified',concerns:[]};
  scene.documentary!.visualReview={status:'accepted',confidence:.99,identifiedEntity:'Canon EOS550D',reason:'Old approval',quality:'sharp',sampleSeconds:[0],checkedAt:'now'};
  p=await projects.update(p.id,{scenes:[scene],settings:{...p.settings,stockVideoPercent:0}});
  let searches=0;const searcher=new DocumentarySearch();searcher.search=async()=>{searches++;return {candidates:[],sources:[]};};
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(root),searcher,join(root,'Materials'),{download:async()=>{throw Error('No candidate');}},()=>{},
    {available:async()=>true,plan:async(_p,scenes)=>new Map(scenes.map(s=>[s.id,s.documentary!.requirement])),inspect:async()=>{throw Error('No candidate');}});
  const result=await service.autoSelect(p.id,{sceneIds:[scene.id]});
  assert.ok(searches>0);assert.equal(result.project.scenes[0]!.documentary!.verified,false);
  assert.equal(result.project.scenes[0]!.audioPath,'paid-voice.mp3');assert.equal(result.project.status,'failed');
  for(const status of ['ready','complete'] as const){
    await projects.update(p.id,{status});
    searcher.search=async()=>{
      assert.equal((await projects.get(p.id))!.status,'failed','Readiness is persisted before a later provider failure');
      throw new DocumentaryAnalysisError('Interrupted provider after revocation','unavailable','candidate-relevance');
    };
    await assert.rejects(service.autoSelect(p.id,{sceneIds:[scene.id]}),/Interrupted provider after revocation/);
    assert.equal((await projects.get(p.id))!.status,'failed');
    assert.equal((await projects.get(p.id))!.scenes[0]!.audioPath,'paid-voice.mp3');
  }
});

test('a completed visual rejection of the same still is not reinspected on resume',async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-rejected-still-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Race',topic:'Motorcycle',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'The motorcycle raced.'};
 const calibration=createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:project.videoBrief.readyScript!,audioDurationSeconds:4});
 const scene=prepareDocumentaryScript(project,calibration)[0]!;
 scene.documentary!.requirement={...scene.documentary!.requirement,entities:['motorcycle'],identities:[],years:[],queries:['red motorcycle race'],preferredKind:'image'};
 project=await projects.update(project.id,{settings:{...project.settings,stockVideoPercent:0},scenes:[scene]});
 const file=join(root,'source.png');await effectFfmpeg(['-y','-f','lavfi','-i','color=c=red:s=1280x720','-frames:v','1',file]);
 const source:DocumentaryCandidate={id:'commons:red',provider:'commons',kind:'image',title:'Red motorcycle race',description:'Fixture',localPath:file,
   width:1280,height:720,pageUrl:'https://example.test/red',downloadUrl:'',author:'Fixture',license:'Owned',licenseUrl:'',rights:'user-confirmed',
   attribution:'Fixture',query:'red motorcycle race',retrievedAt:'now',match:'exact-metadata',concerns:[]};
 let inspections=0;
 const searcher=new DocumentarySearch();searcher.search=async()=>({candidates:[source],sources:[]});
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),searcher,join(root,'Materials'),
   {download:async()=>{throw Error('No remote download expected');}},()=>{},
   {available:async()=>true,plan:async(_p,items)=>new Map(items.map(item=>[item.id,item.documentary!.requirement])),
     rankCandidates:async(_p,_s,pool)=>pool,inspect:async()=>{inspections++;return {status:'rejected',confidence:.99,reason:'Wrong subject in actual frame',checkedAt:'now',sampleSeconds:[],quality:'clear'};}});
 await service.autoSelect(project.id,{sceneIds:[scene.id]});
 await service.autoSelect(project.id,{sceneIds:[scene.id]});
 assert.equal(inspections,1,'The completed rejection must not consume the next bounded inspection slot');
 assert.equal(documentaryCacheableVisualRejection({...source,kind:'video',durationSeconds:600}),false,'Long videos may have other ranges');
 assert.equal(documentaryCacheableVisualRejection({...source,kind:'video',durationSeconds:9}),true);
});

for(const terminal of [false,true])test(`failed thematic fallback retries its exact referent first and ${terminal?'survives a terminal failure':'then reuses its classified fallback'}`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-exact-resume-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let p=await projects.create({title:'Camera',topic:'Nikon D850',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  const text='Nikon D850 introduced a higher resolution sensor.';p.videoBrief={...p.videoBrief!,creationMode:'script',readyScript:text};
  const scene=prepareDocumentaryScript(p,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:text,audioDurationSeconds:4}))[0]!;
  scene.audioPath='existing-paid-voice.mp3';
  const requirements={version:1 as const,scriptText:text,checks:[
    {id:'camera',kind:'object' as const,scriptQuote:'Nikon D850',required:'Nikon D850 camera'}],
    nonVisual:[{scriptQuote:'introduced a higher resolution sensor.',reason:'Abstract specification history needs no visible resolution measurement.'}]};
  assert.ok(documentaryScriptRequirements(requirements,text));
  const fallback={...scene.documentary!.requirement,text,entities:[],identities:[],years:[],queries:['camera close up'],preferredKind:'image' as const,
    scriptRequirements:requirements,
    plannedBy:'semantic' as const,identityContextVersion:3 as const,visualScope:'illustrative' as const,visualScopeVersion:3 as const,
    illustrationFallbackVersion:1 as const,illustrationQuery:'camera close up',visualScopeQuote:'higher resolution sensor',
    narrativeEntities:['Nikon D850'],narrativeIdentities:[{name:'Nikon D850',aliases:[]}],narrativeYears:['2020'],narrativeQueries:['Nikon D850 2020'],narrativeDetail:'Camera exterior'};
  scene.documentary!.requirement=fallback;
  const untouched={...structuredClone(scene),id:'manual-scene',order:1,documentary:{...structuredClone(scene.documentary!),verified:true,pinned:true}};
  p=await projects.update(p.id,{scenes:[scene,untouched],settings:{...p.settings,stockVideoPercent:0}});
  const file=join(root,'source.png');await effectFfmpeg(['-y','-f','lavfi','-i','color=c=red:s=1280x720','-frames:v','1',file]);
  const candidate:DocumentaryCandidate={id:'commons:illustration',provider:'commons',kind:'image',title:'Camera close up',description:'Local orchestration fixture only',localPath:file,
    width:1280,height:720,pageUrl:'https://example.test/camera',downloadUrl:'',author:'Fixture',license:'Owned',licenseUrl:'',rights:'user-confirmed',attribution:'Fixture',query:'camera close up',retrievedAt:'now',match:'unverified',concerns:[]};
  const queries:DocumentarySearchInput[]=[];
  const searcher=new DocumentarySearch();searcher.search=async input=>{queries.push(input);return {candidates:input.entities?.includes('Nikon D850')?[]:[candidate],sources:[]};};
  let fallbackCalls=0;
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),searcher,join(root,'Materials'),
    {download:async()=>{throw Error('No remote download');}},()=>{},
    {available:async()=>{if(terminal)throw Error('Fixture terminal failure');return true;},
      plan:async(_p,items)=>new Map(items.map(item=>[item.id,item.documentary!.requirement])),
      resolveIllustrationFallbacks:async()=>{fallbackCalls++;throw Error('Already classified fallback must not be paid again');},
      refineQueries:async(_p,items)=>{
        assert.ok(items.every(item=>item.documentary!.requirement.visualScope==='illustrative'));
        return new Map(items.map(item=>[item.id,['camera manufacturing']]));
      },
      rankCandidates:async(_p,_s,pool)=>pool,
      inspect:async(project,current)=>{
        assert.deepEqual(current.documentary!.requirement.scriptRequirements,requirements);
        const evidence={status:'accepted',narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'none',observedEra:'none',eraEvidenceQuote:'',
          evidence:'Mock camera exterior illustrates the abstract specification without claiming an event date.'}};
        const contextApproval=documentaryContextApproval(project,current,evidence);
        assert.ok(contextApproval,'Approval must be produced by the current context contract');
        return {status:'accepted',confidence:.99,reason:'Mock model markings on camera exterior; orchestration only',checkedAt:'now',sampleSeconds:[0],quality:'1280x720',
          contextApproval,scriptEvidence:{version:1,scriptText:text,checks:[{requirementId:'camera',kind:'object',scriptQuote:'Nikon D850',required:'Nikon D850 camera',
            match:true,evidence:'Mock pixels show Nikon D850 markings on the camera exterior.'}]}};
      }});
  if(terminal)await assert.rejects(service.autoSelect(p.id,{sceneIds:[scene.id],force:true}),/Fixture terminal failure/);
  else {
    const result=await service.autoSelect(p.id,{sceneIds:[scene.id],force:true});
    assert.equal(result.selected,1,JSON.stringify(result.failures));
    assert.equal(result.project.scenes[0]!.documentary!.verified,true);
    assert.equal(documentarySavedContextIssue(result.project,result.project.scenes[0]!),undefined);
    assert.ok(queries[0]!.entities?.includes('Nikon D850'));
    assert.ok(queries.some(input=>!input.entities?.length&&input.query==='camera manufacturing'));
  }
  const updated=(await projects.get(p.id))!;
  assert.deepEqual(updated.scenes[0]!.documentary!.requirement,terminal?fallback:{...fallback,
    queries:['camera manufacturing'],illustrationQuery:'camera manufacturing',searchRefined:true});
  assert.equal(updated.scenes[0]!.audioPath,scene.audioPath);
  assert.deepEqual(updated.scenes[1],untouched);assert.equal(fallbackCalls,0);
});
