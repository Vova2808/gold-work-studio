import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,documentaryAiPlanContext,type DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryProjectService,documentaryVisualRejectionKeys} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {effectFfmpeg} from './effect-media.js';

test('fast autoSelect skips gameplay and game release trailers before downloading an ordinary documentary trailer',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-gameplay-selection-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  t.mock.method(globalThis,'fetch',async()=>assert.fail('No live network'));
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Steamship launch',topic:'Steamships',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  const narration='A steamship leaves the shipyard.';
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};
  project.settings.voice.enabled=false;
  project.settings.stockVideoPercent=100;
  const scene=prepareDocumentaryScript(project)[0]!;
  scene.durationSeconds=3;
  scene.documentary!.requirement={...scene.documentary!.requirement,preferredKind:'video',identities:[],entities:[],years:[],
    detail:'Steamship launch',queries:['steamship launch'],plannedBy:'semantic'};
  project=await projects.update(project.id,{videoBrief:project.videoBrief,settings:project.settings,scenes:[scene]});
  const source=(id:string,title:string,description:string):DocumentaryCandidate=>({
    id:`pexels:${id}`,provider:'pexels',kind:'video',title,description,width:1280,height:720,durationSeconds:8,
    pageUrl:`https://example.test/${id}`,downloadUrl:`https://example.test/${id}.mp4`,
    author:'Fixture',license:'Fixture',licenseUrl:'',rights:'licensed',attribution:'',
    query:'steamship launch',retrievedAt:'now',match:'unverified',concerns:[],
  });
  const candidates=[
    source('gameplay','Steamship launch gameplay','In-game footage of the harbour'),
    source('game-trailer','Steamship launch trailer','The premium edition includes the original game and additional DLC content.'),
    source('documentary','Steamship launch trailer','Documentary film trailer showing a real ship leaving the shipyard.'),
  ];
  const search=new DocumentarySearch();
  search.search=async input=>({candidates:input.kind==='video'&&input.providers?.includes('pexels')?candidates:[],sources:[]});
  const transfers:string[]=[];
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'materials'),
    {download:async asset=>{transfers.push(asset.id);throw new Error('Fixture transfer observed');}},()=>{},{
      simpleSelection:true,available:async()=>true,plan:async(_project,scenes)=>new Map(scenes.map(s=>[s.id,s.documentary!.requirement])),
      inspect:async()=>assert.fail('This test stops at the download boundary'),
    });
  await service.autoSelect(project.id,{sceneIds:[scene.id]});
  assert.deepEqual(transfers,['documentary']);
});

test('fast autoSelect reaches Pexels after one Commons 429 and skips other cooled ranges',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-cooldown-selection-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  t.mock.method(globalThis,'fetch',async()=>assert.fail('No live network'));
  const video=join(root,'source.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=12:d=4','-c:v','libx264','-preset','ultrafast','-threads','1',video]);
  const bytes=await readFile(video);
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Cape of Good Hope',topic:'Cape Point',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  const narration='They sailed around the Cape of Good Hope.';
  const query='Cape Point South Africa ocean';
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};
  project.settings.voice.enabled=false;
  project.settings.stockVideoPercent=100;
  const scene=prepareDocumentaryScript(project)[0]!;
  scene.durationSeconds=3;
  scene.documentary!.requirement={...scene.documentary!.requirement,preferredKind:'video',identities:[],entities:[],years:[],
    detail:'Cape Point cliffs and ocean',queries:[query],plannedBy:'semantic'};
  project=await projects.update(project.id,{videoBrief:project.videoBrief,settings:project.settings,scenes:[scene]});
  const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const model='offline-fixture',inputHash=hash({version:1,model,context:documentaryAiPlanContext(project)});
  scene.documentary!.requirement.aiSearchPlan={version:1,model,inputHash:hash({inputHash,sceneId:scene.id}),
    visualTarget:'Cape Point cliffs and ocean at the Cape of Good Hope',subject:'Cape Point',visualScope:'illustrative',
    preferredKind:'video',years:[],videoQueries:[query],imageQueries:[],fallbackVideoQueries:[],fallbackVisualTarget:''};
  await projects.update(project.id,{scenes:[scene]});
  const origin='https://192.0.2.18';
  const source=(provider:'commons'|'pexels',id:string,title:string,downloadUrl:string):DocumentaryCandidate=>({
    id:`${provider}:${id}`,provider,kind:'video',title,description:title,width:1280,height:720,durationSeconds:8,
    pageUrl:downloadUrl,downloadUrl,author:'Fixture',license:'Fixture',licenseUrl:'',rights:'licensed',attribution:'',
    query,retrievedAt:'now',match:'unverified',concerns:[],
  });
  // Higher metadata matches fill the original three-attempt window.
  const commons=[1,2,3].map(id=>source('commons',String(id),`${query} ${id}`,`${origin}/${id}.webm`));
  const pexels=source('pexels','34232461','Aerial view of Cape of Good Hope','https://example.test/cape.mp4');
  const search=new DocumentarySearch();
  search.search=async input=>({sources:[],candidates:input.kind!=='video'?[]:input.providers?.includes('commons')?commons:
    input.providers?.includes('pexels')?[pexels]:[]});
  const calls:string[]=[];
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'materials'),
    {download:async asset=>{calls.push(`download:${asset.id}`);return {data:bytes,extension:'.mp4',contentType:'video/mp4'};}},()=>{},{
      simpleSelection:true,available:async()=>true,plan:async()=>assert.fail('Fixture has a current plan'),
      inspect:async(_project,prepared)=>{
        calls.push(`inspect:${prepared.documentary!.selected!.id}`);
        assert.ok(prepared.videoPath);
        return {status:'rejected',confidence:1,reason:'Offline review fixture',quality:'',sampleSeconds:[0],checkedAt:'now'};
      },
    },undefined,undefined,undefined,undefined,async input=>{
      const url=new URL(String(input));
      assert.equal(url.origin,origin);
      calls.push(`GET:${url.pathname}`);
      return new Response('rate limited',{status:429,headers:{'retry-after':'30'}});
    });
  const result=await service.autoSelect(project.id,{sceneIds:[scene.id]});
  assert.deepEqual(calls,['GET:/1.webm','download:34232461','inspect:pexels:34232461'],JSON.stringify(result.failures));
});

for(const matches of [0,1,2])test(`named YouTube discovery with ${matches} distinct matches fills the two review slots`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-named-video-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'museum.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=12:d=4','-c:v','libx264','-preset','ultrafast','-threads','1',file]);
  const firstFile=join(root,'first.mp4');
  if(matches)await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=12:d=4','-vf','hflip','-c:v','libx264','-preset','ultrafast','-threads','1',firstFile]);
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Cutty Sark',topic:'Cutty Sark',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  const narration='She sailed across oceans carrying Chinese tea.';
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};
  const scene=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:narration,audioDurationSeconds:3}))[0]!;
  scene.durationSeconds=3;
  const subject='Cutty Sark clipper ship',queries=['Cutty Sark ship rigging sails','clipper ship under full sail'];
  scene.documentary!.requirement={...scene.documentary!.requirement,entities:[subject],identities:[{name:subject,aliases:[]}],queries,years:[],preferredKind:'video',plannedBy:'semantic'};
  project=await projects.update(project.id,{videoBrief:project.videoBrief,settings:{...project.settings,stockVideoPercent:100},scenes:[scene]});
  const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const model='offline-fixture',inputHash=hash({version:1,model,context:documentaryAiPlanContext(project)});
  scene.documentary!.requirement.aiSearchPlan={version:1,model,inputHash:hash({inputHash,sceneId:scene.id}),visualTarget:queries[0]!,subject,years:[],visualScope:'illustrative',preferredKind:'video',videoQueries:queries,imageQueries:[],fallbackVideoQueries:[],fallbackVisualTarget:''};
  await projects.update(project.id,{scenes:[scene]});
  const museum:DocumentaryCandidate={id:'youtube:museum',provider:'youtube',kind:'video',title:'The Cutty Sark',description:'Museum visit',localPath:file,durationSeconds:4,width:1280,height:720,
    pageUrl:'https://example.test/museum',downloadUrl:'https://example.test/museum.mp4',author:'Fixture',license:'CC BY',licenseUrl:'',rights:'licensed',attribution:'Fixture',query:'Cutty Sark',retrievedAt:'now',match:'unverified',concerns:[]};
  const first={...museum,id:'youtube:first',title:'Cutty Sark clipper ship',query:queries[0]!,localPath:firstFile,pageUrl:'https://example.test/first',downloadUrl:'https://example.test/first.mp4'};
  const initial:DocumentaryCandidate[]=[{...museum,id:'youtube:other',title:'An unrelated sailing yacht',downloadUrl:'https://example.test/other.mp4'}];
  if(matches)initial.push(first,{...first},{...first,id:'youtube:short',durationSeconds:1,downloadUrl:'https://example.test/short.mp4'});
  if(matches===2)initial.push(museum);
  const calls:string[]=[],reviews:string[]=[];
  const search=new DocumentarySearch();
  search.search=async input=>{
    if(input.providers?.[0]!=='youtube')return {candidates:[],sources:[]};
    calls.push(input.query);
    return {sources:[],candidates:input.query==='Cutty Sark'?[museum]:initial};
  };
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'materials'),
    {download:async()=>{throw Error('Local file fixture only');}},()=>{},{
      simpleSelection:true,available:async()=>true,plan:async(_project,rows)=>new Map(rows.map(s=>[s.id,s.documentary!.requirement])),
      inspect:async(_project,staged)=>{
        const id=staged.documentary!.selected!.id;
        reviews.push(id);
        return {status:id===museum.id?'accepted':'rejected',confidence:.99,reason:'Fixture',quality:'clear',checkedAt:'now',sampleSeconds:[0,1,2],viewDescription:id===museum.id?'Museum rigging':'No ship visible'};
      },
    });
  // Revised searches use the default two-slot pass. The initial public
  // autoSelect pass reserves fallback time and allows three video reviews.
  const selectTwoSlotPass=Reflect.get(service,'selectAll').bind(service) as typeof service.autoSelect;
  const result=await selectTwoSlotPass(project.id,{sceneIds:[scene.id]});
  assert.deepEqual(calls,matches===2?[queries[0]]:[queries[0],'Cutty Sark']);
  assert.deepEqual(reviews,matches?[first.id,museum.id]:[museum.id]);
  assert.equal(result.selected,1,JSON.stringify(result.failures));
});

for(const readyAt of ['during-review','after-review','before-review','saved-empty-video-lane'] as const){
  test(`simple selection consumes ready Commons ${readyAt} within the existing review limit`,async t=>{
    const root=await mkdtemp(join(tmpdir(),'gws-ready-source-'));
    assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));
    t.after(()=>rm(root,{recursive:true,force:true}));
    const files=[0,1,2].map(i=>join(root,`${i}.png`));
    for(const [i,path] of files.entries())await effectFfmpeg(['-y','-f','lavfi','-i',`testsrc2=s=1280x720,${['null','hflip','negate'][i]}`,'-frames:v','1',path]);
    const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
    let project=await projects.create({title:'Cutty Sark',topic:'Cutty Sark',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
    project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:'Cutty Sark was launched in Dumbarton in 1869.'};
    const scene=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:project.videoBrief.readyScript!,audioDurationSeconds:3}))[0]!;
    scene.audioPath='preserved-paid-voice.mp3';
    const query='Cutty Sark launch Dumbarton 1869';
    const stockFirst=readyAt==='during-review'||readyAt==='after-review';
    const subject=readyAt==='after-review'?'Cutty Sark clipper ship':'Cutty Sark';
    scene.documentary!.requirement={...scene.documentary!.requirement,text:scene.narration,entities:[subject],identities:[{name:subject,aliases:[]}],years:['1869'],queries:[query],preferredKind:'image',plannedBy:'semantic',identityContextVersion:3};
    const videoPercent=readyAt==='saved-empty-video-lane'?60:0;
    if(readyAt==='saved-empty-video-lane')scene.documentary!.selectionPlan={kind:'video',videoPercent};
    project=await projects.update(project.id,{videoBrief:project.videoBrief,settings:{...project.settings,stockVideoPercent:videoPercent},scenes:[scene]});
    const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const model='offline-fixture',inputHash=hash({version:1,model,context:documentaryAiPlanContext(project)});
    // The stock-first cases require both provider lanes. An exact named
    // plan omits stock providers, so no stock review can release Commons.
    scene.documentary!.requirement.aiSearchPlan={version:1,model,inputHash:hash({inputHash,sceneId:scene.id}),visualTarget:query,subject,years:['1869'],visualScope:stockFirst?'illustrative':'exact',preferredKind:'image',imageQueries:[query],videoQueries:[],fallbackVideoQueries:[],fallbackVisualTarget:''};
    project=await projects.update(project.id,{scenes:[scene]});
    const base:DocumentaryCandidate={id:'stock-first',provider:'pexels',kind:'image',title:'SS Great Britain',description:'A different ship',
      pageUrl:'https://example.test/first',downloadUrl:'',localPath:files[0],width:1280,height:720,author:'Fixture',license:'CC0',licenseUrl:'',rights:'public-domain',attribution:'Fixture',query,retrievedAt:'now',match:'unverified',concerns:[]};
    const stock=[base,{...base,id:'stock-second',title:'Adelaide Central Market',pageUrl:'https://example.test/second',localPath:files[1]}];
    const commons={...base,id:'commons-cutty',provider:'commons' as const,title:'SS Cutty Sark (1869)',description:'Cutty Sark sailing ship',pageUrl:'https://example.test/cutty',localPath:files[2]};
    let releaseCommons!:()=>void;
    const commonsReady=new Promise<void>(resolve=>{releaseCommons=resolve;});
    if(readyAt==='before-review'||readyAt==='saved-empty-video-lane')releaseCommons();
    const searches:Array<{provider:string;query:string;kind?:string}>=[],reviews:string[]=[];
    const search=new DocumentarySearch();
    search.search=async input=>{
      const provider=input.providers![0]!;searches.push({provider,query:input.query,kind:input.kind});
      if(provider==='commons'){await commonsReady;return {candidates:[commons],sources:[]};}
      return {candidates:provider==='pexels'?stock:[],sources:[]};
    };
    const storage=new LocalProjectStorage(join(root,'projects'));
    const service=new DocumentaryProjectService(projects,storage,search,join(root,'materials'),
      {download:async()=>{throw Error('Local fixtures only');}},()=>{},
      {simpleSelection:true,available:async()=>true,plan:async(_p,rows)=>new Map(rows.map(s=>[s.id,s.documentary!.requirement])),
        inspect:async(_p,current)=>{
          const id=current.documentary!.selected!.id;reviews.push(id);
          if(readyAt==='after-review')setTimeout(releaseCommons,250);
          else releaseCommons();
          await nextTurn();
          return {status:id===commons.id?'accepted':'rejected',confidence:.99,reason:'Offline orchestration fixture',quality:'clear',checkedAt:'now',sampleSeconds:[0],viewDescription:id===commons.id?'Cutty Sark sailing ship':'Different subject'};
        }});
    const result=await service.autoSelect(project.id,{sceneIds:[scene.id]});
    assert.deepEqual(reviews,stockFirst?['stock-first','commons-cutty']:['commons-cutty']);
    assert.equal(result.selected,1,JSON.stringify(result.failures));assert.equal(result.failed,0);
    assert.equal(result.project.scenes[0]!.documentary!.selected!.id,commons.id);
    assert.equal(result.project.scenes[0]!.audioPath,scene.audioPath);
    assert.equal(result.project.scenes[0]!.narration,scene.narration);
    assert.ok(searches.some(s=>s.provider==='commons'));
    assert.ok(searches.every(s=>s.kind==='image'&&s.query===query),'Source queries remain exactly as planned');
    assert.equal(result.project.scenes[0]!.documentary!.selectionPlan?.kind,'image');
    if(readyAt==='during-review'){
      const rejection=await readFile(join(storage.projectDirectory(project.id),'Documentary',scene.id,'rejected-candidates.json'),'utf8');
      assert.ok(documentaryVisualRejectionKeys(base).some(key=>rejection.includes(key)),
        'A completed rejection survives selection of the later source');
    }
  });
}
