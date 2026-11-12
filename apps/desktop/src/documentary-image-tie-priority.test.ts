import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {documentaryAiPlanContext,type DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryProjectService,documentarySimpleCandidatePriority,documentaryCandidatePriorityScore,selectSimpleDocumentaryCandidates} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {documentaryIllustrationApproval} from './documentary-context-approval.js';
import {DocumentaryCachedAnalysisMissing} from './documentary-intelligence.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {claimDocumentaryThematicRecovery,documentaryThematicDiscoveryRequirement} from './documentary-automatic-thematic-recovery.js';
import {effectFfmpeg} from './effect-media.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function fixture(subject='Cutty Sark',biography=false,narrationOverride?:string){
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 const project=await projects.create({title:'Image priority',topic:'Documentary',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 const narration=narrationOverride??(biography?`${subject} wore round spectacles.`:'With all her sails set, she carried around 32,000 square feet of canvas.');
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:narration};
 project.settings.stockVideoPercent=60;project.settings.voice.enabled=false;
 project.settings.assembly.documentary!.autoMotionGraphics=false;project.settings.assembly.documentary!.autoEffects=false;
 project.scenes=[prepareDocumentaryScript(project)[0]!];
 const scene=project.scenes[0]!,doc=scene.documentary!;
 scene.durationSeconds=4;scene.audioPath='preserved-paid-voice.wav';
 const queries=biography?[`${subject} round spectacles portrait`]:[`${subject} full sails set archival photograph`,`${subject} clipper ship all canvas spread painting`];
 const target=biography?`${subject} wearing round spectacles`:`${subject} with all sails set showing full spread of canvas`;
 const inputHash=hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)});
 doc.requirement={...doc.requirement,text:narration,entities:[subject],identities:[{name:subject,aliases:[]}],years:[],preferredKind:'image',queries,
  detail:target,visualScope:'illustrative',aiSearchPlan:{version:1,inputHash:hash({inputHash,sceneId:scene.id}),model:'fixture',subject,visualTarget:target,
   years:[],visualScope:'illustrative',preferredKind:'image',reservePolicy:'thematic',imageQueries:queries,videoQueries:[`${subject} sails footage`],
   fallbackVideoQueries:[`${subject} ship footage`,`${subject} clipper at sea`],fallbackVisualTarget:`${subject} clipper ship (preserved vessel or archival image)`,
   grounding:{version:1,mandatory:[{kind:'identity',required:subject,scriptQuote:narration},
    {kind:'condition',required:biography?'round spectacles':'all sails set, full spread of canvas visible',scriptQuote:narration}],
    illustrations:[target],optionalDetails:[]}}};
 doc.selectionPlan={kind:'video',videoPercent:60};doc.autoError='Previous search did not find the visible physical feature.';
 return {projects,project,scene};
}

const source=(id:string,title:string,description:string,extra:Partial<DocumentaryCandidate>={}):DocumentaryCandidate=>({id,provider:'commons',kind:'image',title,description,
 // Literal TEST-NET address avoids external DNS; transport is always mocked.
 downloadUrl:`https://203.0.113.1/${encodeURIComponent(id)}.png`,pageUrl:`https://203.0.113.1/${encodeURIComponent(id)}`,author:'Archive credit',license:'Public domain',
 licenseUrl:'',rights:'public-domain',attribution:'Archive credit',query:'retrieval',retrievedAt:'fixture',match:'unverified',concerns:[],...extra});

// Saved run's actual source names and descriptive sentences. Page navigation,
// licensing boilerplate and profile data are deliberately not fixture content.
const actualPool=()=>[
 source('web:fd22728261982f248f1222dc','File:Northeast View of the Cutty Sark in Greenwich.jpg - Wikimedia Commons',
  'A view of the Cutty Sark in Greenwich from the north-east',{provider:'web'}),
 source('web:a5e8d1fb2567db0a4f6408b1','File:Cutty sark detail.jpg - Wikimedia Commons','Cutty Sark Detail. Source: Jan van der Crabben (Photographer)',{provider:'web'}),
 source('local:rrs','RRS Sir David Attenborough in Greenwich (1) - 2022-10-30.jpg',
  'Two generations of ship: the Cutty Sark, and the recently built British Antarctic Survey research vessel RRS Sir David Attenborough. Greenwich, London, in October 2021.',
  {provider:'local',localPath:'saved-rrs.png',width:1920,height:1080}),
 source('commons:15663715','Cutty Sark (ship, 1869) - SLV H99.220-2364.jpg',
  '„CUTTY SARK“ London. 963 Tons. Built at Dumbarton. 1869. (composite). This ship has made a better advertisement for Australia.',{width:1280,height:1462})
];

test('actual equal-score cards prefer a titled detailed source, without approving its content or losing alternatives',async()=>{
 const {project,scene}=await fixture(),pool=actualPool(),priority=documentarySimpleCandidatePriority(project,scene,'image');
 assert.equal(new Set(pool.map(c=>documentaryCandidatePriorityScore(c,priority))).size,1,'The observed failure was an exact active-task-score tie');
 const before=JSON.stringify(pool),ranked=selectSimpleDocumentaryCandidates(pool,priority);
 assert.equal(ranked[0]!.id,'commons:15663715');
 assert.deepEqual(ranked.map(c=>c.id).sort(),pool.map(c=>c.id).sort());
 assert.equal(JSON.stringify(pool),before);assert.equal(ranked[0]!.match,'unverified');
});

test('the tie rule is name-independent and applies to a mandatory biographical subject',async()=>{
 for(const [subject,biography] of [['Aurora',false],['Ada Lovelace',true]] as const){
  const {project,scene}=await fixture(subject,biography),priority=documentarySimpleCandidatePriority(project,scene,'image');
  const pool=[source('web',subject,'',{provider:'web'}),source('local','Another subject',subject,{provider:'local',localPath:'saved.png',width:1920,height:1080}),
   source('native',subject,'',{width:1280,height:1462})];
  assert.equal(new Set(pool.map(c=>documentaryCandidatePriorityScore(c,priority))).size,1);
  assert.equal(selectSimpleDocumentaryCandidates(pool,priority)[0]!.id,'native');
 }
});

test('one grounded sentence identity lends its existing canonical name to image ties without rewriting the plan',async()=>{
 for(const [subject,required,quote,name] of [
  ['Cutty Sark','the ship Cutty Sark','Cutty Sark left the tea trade.','Cutty Sark'],
  ['Cutty Sark (clipper ship)','the ship is Cutty Sark, later renamed Ferreira under Portuguese ownership','Cutty Sark was sold and renamed Ferreira.','Cutty Sark'],
  ['Marie Curie','the scientist Marie Curie','Marie Curie continued her research.','Marie Curie']
 ] as const){
  const {project,scene}=await fixture(name,false,quote),plan=scene.documentary!.requirement.aiSearchPlan!;
  plan.subject=subject;plan.grounding!.mandatory[0]!.required=required;
  const before=JSON.stringify(plan),priority=documentarySimpleCandidatePriority(project,scene,'image');
  const pool=[source('unknown',name,'',{provider:'web'}),source('detailed',name,'',{width:1280,height:1462})];
  assert.equal(documentaryCandidatePriorityScore(pool[0]!,priority),documentaryCandidatePriorityScore(pool[1]!,priority));
  assert.equal(selectSimpleDocumentaryCandidates(pool,priority)[0]!.id,'detailed',required);
  assert.equal(JSON.stringify(plan),before,'Canonical discovery only supplements tie evidence, never the saved required text or quote');
 }
});

test('duplicate grounded descriptions of the same object retain their primary weights and detailed image tie',async()=>{
 for(const [name,alias] of [['Cutty Sark','Ferreira'],['Aurora','Horizon']] as const){
  const narration=`${name} was sold and renamed ${alias}; the famous clipper became a general cargo carrier.`;
  const {project,scene}=await fixture(name,false,narration),plan=scene.documentary!.requirement.aiSearchPlan!;
  plan.subject=`${name} (renamed ${alias}) clipper ship`;
  plan.grounding!.mandatory=[
   {kind:'identity',required:`${name}, also named ${alias}`,aliases:[alias],scriptQuote:`${name} was sold and renamed ${alias}`},
   {kind:'identity',required:`${name} as the famous tea clipper`,scriptQuote:'the famous clipper became a general cargo carrier.'}
  ];
  const before=JSON.stringify(scene),priority=documentarySimpleCandidatePriority(project,scene,'image');
  const pool=[source('web',name,'',{provider:'web'}),source('archive',`${name} (ship).jpg`,'',{width:1920,height:1280})];
  assert.deepEqual(priority.subjects,[plan.subject],'Do not reweight primary physical/query conditions');
  assert.equal(priority.imageTieBreak?.(pool[1]!),true,'The existing canonical helper proves these checks describe one object');
  assert.equal(selectSimpleDocumentaryCandidates(pool,priority)[0]!.id,'archive');
  assert.equal(JSON.stringify(scene),before);
  assert.equal(pool[1]!.match,'unverified','Ordering is not visual acceptance');
  scene.documentary!.requirement.footageFallback={version:1,target:plan.fallbackVisualTarget,queries:[...plan.fallbackVideoQueries],
   reason:'Primary sources exhausted',narration:scene.narration,originalTarget:plan.visualTarget,kind:'image'};
  const reserve=documentarySimpleCandidatePriority(project,scene,'image');
  assert.deepEqual(reserve.subjects,[name]);
  assert.deepEqual(reserve.queries,plan.fallbackVideoQueries);
  assert.equal(reserve.imageTieBreak?.(pool[1]!),true);
 }
});

test('grounded reserve keeps the mandatory name weighted without importing primary queries or dropping physical conditions',async()=>{
 const {project,scene}=await fixture('Aurora',false,'Aurora showed iron frames and wooden planking.'),plan=scene.documentary!.requirement.aiSearchPlan!;
 plan.grounding!.mandatory[1]!.required='iron frames and wooden planking visible together';
 plan.fallbackVisualTarget='Aurora hull interior with iron frames and wooden planking';
 plan.fallbackVideoQueries=['Aurora hull iron frames wooden planking','Aurora composite hull interior'];
 scene.documentary!.requirement.footageFallback={version:1,target:plan.fallbackVisualTarget,queries:[...plan.fallbackVideoQueries],
  reason:'Primary sources exhausted',narration:scene.narration,originalTarget:plan.visualTarget};
 const before=JSON.stringify(scene),task=documentarySimpleCandidatePriority(project,scene,'video');
 assert.deepEqual(task.subjects,['Aurora']);
 assert.deepEqual(task.queries,plan.fallbackVideoQueries);
 assert.equal(task.visualTarget,plan.fallbackVisualTarget);
 const named=source('named','Aurora','',{kind:'video'}),generic=source('generic','Hull interior','',{kind:'video'});
 assert.ok(documentaryCandidatePriorityScore(named,task)>documentaryCandidatePriorityScore(generic,task),'Generic category words must not outweigh the grounded identity');
 const physical=source('physical','Aurora iron frames wooden planking','',{kind:'video'});
 assert.equal(selectSimpleDocumentaryCandidates([named,physical],task)[0]!.id,'physical');
 assert.equal(JSON.stringify(scene),before);
});

test('reserve priority never coalesces different identities, an owner, or a shortened model',async()=>{
 for(const [subject,checks,quote] of [
  ['Aurora',[{required:'Aurora'},{required:'Horizon'}],'Aurora met Horizon.'],
  ['Aurora',[{required:'the owner of Aurora'}],'The owner of Aurora commissioned the voyage.'],
  ['Airbus A320',[{required:'Airbus A320 (neo)'}],'Airbus A320 (neo) entered service.'],
  ['Canon EOS R5',[{required:'Canon EOS R5 (Mark II)'}],'Canon EOS R5 (Mark II) was used.']
 ] as const){
  const {project,scene}=await fixture(subject,false,quote),plan=scene.documentary!.requirement.aiSearchPlan!;
  plan.grounding!.mandatory=checks.map(check=>({kind:'identity' as const,required:check.required,scriptQuote:quote}));
  scene.documentary!.requirement.footageFallback={version:1,target:plan.fallbackVisualTarget,queries:[...plan.fallbackVideoQueries],
   reason:'Primary sources exhausted',narration:scene.narration,originalTarget:plan.visualTarget};
  assert.deepEqual(documentarySimpleCandidatePriority(project,scene,'video').subjects,[],subject);
  assert.equal(documentarySimpleCandidatePriority(project,scene,'image').imageTieBreak,undefined,subject);
 }
});

test('sentence tie evidence never substitutes the owner, model family or a name absent from the original quote',async()=>{
 for(const [subject,required,quote] of [
  ['Cutty Sark','John Willis, owner of Cutty Sark','John Willis owned Cutty Sark.'],
  ['Airbus','the aircraft Airbus A320','The Airbus A320 entered service.'],
  ['Airbus A320','the aircraft Airbus A320-200','The Airbus A320-200 entered service.'],
  ['Nikon D850','the camera Nikon D850','An unidentified camera was used.']
 ] as const){
  const {project,scene}=await fixture(subject,false,quote),plan=scene.documentary!.requirement.aiSearchPlan!;
  plan.grounding!.mandatory[0]!.required=required;
  const priority=documentarySimpleCandidatePriority(project,scene,'image');
  const pool=[source('unknown',subject,'',{provider:'web'}),source('detailed',subject,'',{width:1280,height:1462})];
  assert.equal(documentaryCandidatePriorityScore(pool[0]!,priority),documentaryCandidatePriorityScore(pool[1]!,priority));
  assert.equal(selectSimpleDocumentaryCandidates(pool,priority)[0]!.id,'unknown',required);
 }
});

test('stronger active conditions win; unknown geometry, low resolution, wrong title and localPath alone grant no tie preference',async()=>{
 const {project,scene}=await fixture(),priority=documentarySimpleCandidatePriority(project,scene,'image');
 const detailed=actualPool()[3]!;
 const strong=source('strong','Cutty Sark full sails set','',{provider:'web'});
 assert.ok(documentaryCandidatePriorityScore(strong,priority)>documentaryCandidatePriorityScore(detailed,priority));
 assert.equal(selectSimpleDocumentaryCandidates([detailed,strong],priority)[0]!.id,'strong');
 const unknown=source('unknown','Cutty Sark','',{provider:'web'});
 for(const change of [{width:640,height:360},{width:NaN,height:1462},{width:undefined},{title:'Different ship'},
  {provider:'web' as const},{provider:'local' as const,localPath:'saved.png',width:undefined,height:undefined}]){
  const candidate={...source('candidate','Cutty Sark','Cutty Sark',{width:1280,height:1462}),...change};
  assert.equal(documentaryCandidatePriorityScore(unknown,priority),documentaryCandidatePriorityScore(candidate,priority));
  assert.equal(selectSimpleDocumentaryCandidates([unknown,candidate],priority)[0]!.id,'unknown',JSON.stringify(change));
 }
 const videos=[{...unknown,kind:'video' as const},{...detailed,kind:'video' as const}];
 assert.equal(selectSimpleDocumentaryCandidates(videos,priority)[0]!.id,unknown.id);
 const noIdentity=structuredClone(scene);noIdentity.documentary!.requirement.aiSearchPlan!.grounding!.mandatory=
  noIdentity.documentary!.requirement.aiSearchPlan!.grounding!.mandatory.filter(check=>check.kind!=='identity');
 assert.equal(selectSimpleDocumentaryCandidates([unknown,detailed],documentarySimpleCandidatePriority(project,noIdentity,'image'))[0]!.id,unknown.id);
 const verticalScene=structuredClone(scene),vertical={...project,aspectRatio:'9:16' as const,scenes:[verticalScene]},landscape={...detailed,width:1920,height:1080};
 verticalScene.documentary!.requirement.aiSearchPlan!.inputHash=hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(vertical)}),sceneId:scene.id});
 const verticalPriority=documentarySimpleCandidatePriority(vertical,verticalScene,'image');
 assert.ok(verticalPriority.imageTieBreak,'The vertical plan must remain current');
 assert.equal(selectSimpleDocumentaryCandidates([unknown,landscape],verticalPriority)[0]!.id,unknown.id,'Use the actual output aspect, not a copied size threshold');
});

for(const outcome of ['accepted','rejected','pending','duplicate-grounded'] as const)test(`one-photo reserve inspects the detailed titled source first; strict mock outcome=${outcome}`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'gws-image-tie-'));
 t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('gws-image-tie-'));await rm(root,{recursive:true,force:true});});
 t.mock.method(globalThis,'fetch',async()=>assert.fail('Live API is forbidden'));
 const picture=join(root,'fixture.png');await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x1462','-frames:v','1',picture]);
 const {projects,project,scene}=await fixture('Cutty Sark',false,outcome==='duplicate-grounded'?'Cutty Sark sailed with all sails set.':undefined),pool=actualPool();pool[2]!.localPath=picture;
 // Origin cooldown is process-wide: one fixture's mocked 429 must not block
 // another scenario. Every address is TEST-NET and every transfer is mocked.
 const host=`203.0.113.${['accepted','rejected','pending','duplicate-grounded'].indexOf(outcome)+1}`;
 for(const candidate of pool)candidate.downloadUrl=candidate.downloadUrl.replace('203.0.113.1',host);
 if(outcome==='duplicate-grounded'){
  const plan=scene.documentary!.requirement.aiSearchPlan!;
  plan.subject='Cutty Sark (clipper ship)';
  plan.grounding!.mandatory[0]!.required='the ship Cutty Sark';
  plan.grounding!.mandatory.push({kind:'identity',required:'Cutty Sark as the famous tea clipper',scriptQuote:scene.narration});
 }
 scene.documentary!.candidates=[];await projects.mutate(project.id,()=>project);
 const downloads:string[]=[],inspections:string[]=[];
 const search=new DocumentarySearch();search.search=async input=>({candidates:input.kind==='image'?pool:[],sources:[]});
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),
  {download:async()=>assert.fail('No video download is expected')},()=>{},
  {simpleSelection:true,available:async()=>true,plan:async current=>new Map([[scene.id,current.scenes[0]!.documentary!.requirement]]),
   inspect:async()=>assert.fail('Use selection review'),inspectForSelection:async(current,selected,_progress,_stop,cacheOnly)=>{
    if(cacheOnly)throw new DocumentaryCachedAnalysisMissing();
    const id=selected.documentary!.selected!.id;inspections.push(id);
    assert.equal(selected.documentary!.requirement.footageFallback,undefined);
    assert.equal(selected.documentary!.requirement.aiSearchPlan!.grounding!.mandatory[1]!.required,'all sails set, full spread of canvas visible');
    if(outcome==='pending')throw new DocumentaryAnalysisError('Unknown paid image response','pending');
    // Strict orchestration mock: wrong sources fail even if the ranking picked
    // them. No synthetic pattern is claimed to prove real sails or identity.
    const accepted=id==='commons:15663715'&&(outcome==='accepted'||outcome==='duplicate-grounded');
    const review={status:accepted?'accepted' as const:'rejected' as const,confidence:1,reason:accepted?'Mock visible required sails':'Mock missing required sails',
     quality:'',sampleSeconds:[0],checkedAt:'fixture',fastRelevance:{version:1 as const,target:selected.documentary!.requirement.aiSearchPlan!.visualTarget,relevant:accepted,evidence:'Mock content verdict'}};
    return {usedNewAnalysis:true,review:{...review,...(accepted?{illustrationApproval:documentaryIllustrationApproval(current,{...selected,documentary:{...selected.documentary!,visualReview:review}})}:{})}};
   }},undefined,undefined,{plan:async(_current,scenes)=>new Map(scenes.map(s=>[s.id,s.documentary!.requirement]))},undefined,async url=>{
    downloads.push(String(url));
    if(String(url)!==pool[3]!.downloadUrl)return new Response('',{status:429,headers:{'retry-after':'120'}});
    return new Response(new Uint8Array(await readFile(picture)),{headers:{'content-type':'image/png'}});
   });
 Reflect.set(service,'selectionResources',async()=>({workers:1}));service.localCandidates=async()=>[];
 await service.planSearch(project.id,[scene.id]);
 const planned=(await projects.get(project.id))!;
 await projects.mutate(project.id,()=>({scenes:[claimDocumentaryThematicRecovery(planned,planned.scenes[0]!)]}));
 const claimed=(await projects.get(project.id))!;assert.ok(documentaryThematicDiscoveryRequirement(claimed,claimed.scenes[0]!));
 const result=await service.autoSelect(project.id,{sceneIds:[scene.id]});
 assert.deepEqual(inspections,['commons:15663715'],JSON.stringify({downloads,failures:result.failures,reason:result.project.scenes[0]!.documentary!.autoError}));
 assert.deepEqual(downloads,[pool[3]!.downloadUrl],'Unknown web originals must not consume the reserve first');
 const saved=result.project.scenes[0]!;
 assert.equal(saved.documentary!.verified,outcome==='accepted'||outcome==='duplicate-grounded');assert.equal(saved.audioPath,'preserved-paid-voice.wav');
 assert.equal(result.project.settings.stockVideoPercent,60);assert.deepEqual(saved.documentary!.selectionPlan,{kind:'video',videoPercent:60});
 if(outcome==='pending'){
  await service.autoSelect(project.id,{sceneIds:[scene.id]});
  assert.equal(inspections.filter(id=>id==='commons:15663715').length,1,'Ordering must not resend an unknown paid request');
  assert.equal(downloads.filter(url=>url===pool[3]!.downloadUrl).length,1,'A pending source must not download again to discover the same uncertainty');
 }
});
