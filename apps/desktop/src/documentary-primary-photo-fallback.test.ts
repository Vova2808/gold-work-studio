import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile,stat,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {type Project,type Scene,type DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {documentaryAiPlanContext} from './documentary-ai-plan-state.js';
import {documentaryIllustrationApproval,documentarySavedContextIssue} from './documentary-context-approval.js';
import {documentaryCheckedVideoCoverage} from './documentary-automatic-native-recovery.js';
import {planFastDocumentaryScene} from './documentary-fast-plan.js';
import {prepareDocumentaryProduction} from './documentary-production.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {documentaryThematicDiscoveryRequirement,documentaryThematicRecoveryBinding} from './documentary-automatic-thematic-recovery.js';
import {effectFfmpeg} from './effect-media.js';
import {DocumentaryMediaRateLimitError,rememberDocumentaryMediaRateLimit} from './documentary-download.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reserveScenes=[
 {number:7,narration:'Her owner, John Willis, was betting on speed.',subject:'John Willis',target:'John Willis, shipowner of Cutty Sark',
  image:['John Willis Cutty Sark owner portrait','John Willis shipowner photograph'],video:['John Willis Cutty Sark owner'],
  reserve:'historic square-rigged clipper sailing fast under full canvas',reserveQueries:['tall ship under full sail','square rigger sailing ocean']},
 {number:12,narration:'Cross the ocean quickly.\n\nHer construction combined iron frames with wooden planking.',subject:'Cutty Sark hull',
  target:'Cutty Sark hull structure showing iron frames with wooden planking',
  image:['Cutty Sark composite hull iron frames wooden planking','Cutty Sark hull interior iron framing'],video:['Cutty Sark hull interior iron frames','Cutty Sark wooden planking close up'],
  reserve:'interior of a historic sailing ship hull showing frames and planking',reserveQueries:['Cutty Sark hull Greenwich','historic tall ship hull interior']},
 {number:15,narration:'With all her sails set, she carried around 32,000 square feet of canvas.',subject:'Cutty Sark sails',
  target:'Cutty Sark with full sails set or her full sail plan',image:['Cutty Sark under full sail photograph','Cutty Sark sail plan'],
  video:['Cutty Sark masts and rigging','Cutty Sark Greenwich rigging'],reserve:"Cutty Sark's masts, yards and rigging at Greenwich",
  reserveQueries:['Cutty Sark Greenwich','Cutty Sark clipper ship']},
 {number:27,narration:'Two ships, two crews and the same destination.',subject:'Cutty Sark and Thermopylae clipper ships',
  target:'Cutty Sark and Thermopylae as two rival sailing ships',image:['Cutty Sark and Thermopylae painting','Thermopylae clipper ship painting'],
  video:['Cutty Sark Thermopylae clipper race','Cutty Sark clipper ship'],reserve:'two square-rigged tall ships under sail at sea',
  reserveQueries:['two square rigged tall ships','tall ships race square sails']},
 {number:51,narration:'Under his command, Cutty Sark completed a passage from Sydney to London in just 73 days.',subject:'Cutty Sark',
  target:'Cutty Sark under full sail',image:['Cutty Sark under full sail painting','Cutty Sark clipper Sydney London voyage'],
  video:['Cutty Sark clipper ship Greenwich','Cutty Sark masts rigging'],reserve:'three-masted square-rigged clipper under full sail at sea',
  reserveQueries:['three masted square rigger sailing','clipper ship full sail']},
];
// v23 saved first attempted Commons photo and an independent returned card.
const photoTransfers=[
 {number:7,commons:['22522845','John Willis Menard.jpg','"John Willis"','Portrait of John Willism Menard'],
  alternate:['pixabay','1850276','puppy sleeping pet owner adorable animal canine cute nature dog sleep sleeping puppy asleep portrait'],getCount:1},
 {number:15,commons:['181782405',"'Cutty Sark' at East Circular Quay, Sydney, NSW, c.1885",'"Cutty Sark" under full sail photograph',
   "The composite ship 'Cutty Sark', 921 tons, in Sydney, at east side of Circular Quay."],
  alternate:['pexels','2655976','A stunning white sailing ship with full sails glides across the calm ocean under a clear blue sky.'],getCount:1},
 {number:27,commons:['47879218','Thermopylaeclipperpainting.jpg','Thermopylae clipper ship painting','Painting of clipper ship "Thermopylae . 1 photographic print: b&w.'],
  secondCommons:['62516710','F. I. Sorensen - The tea clipper Thermopylae.jpg','"Cutty Sark" and Thermopylae painting','‚Cutty Sark‘ (left in the background) races ‚Thermopylae‘'],
  alternate:['pexels','35562475','The Galaxy Clipper ferry cruising the Thames in London, with passengers aboard and cityscape in view.'],getCount:0},
 {number:51,commons:['14491631','StateLibQld 1 145047 Cutty Sark (ship).jpg','"Cutty Sark" under full sail painting',
   'Cutty Sark in full sails. Black and white photograph of a painting.'],
  secondCommons:['14491633','StateLibQld 1 145051 Cutty Sark (ship).jpg','"Cutty Sark" under full sail painting',
   'Cutty Sark in full sails. Black and white photograph of a painting.'],
  alternate:['pexels','2655976','A stunning white sailing ship with full sails glides across the calm ocean under a clear blue sky.'],getCount:0},
] as const;
const reserveCases=[
 ...reserveScenes.slice(0,3).map(plan=>({plan,mode:'photo-accepted' as const})),
 ...(['video-accepted','video-only','video-pending','budget','photo-rejected','photo-pending','photo-rejected-then-pending','photo-rejected-then-network'] as const)
   .map(mode=>({plan:reserveScenes[1]!,mode})),
 ...(['photo-local-duplicates','photo-remote-duplicates'] as const).map(mode=>({plan:reserveScenes[2]!,mode})),
 ...photoTransfers.map(transfer=>({plan:reserveScenes.find(plan=>plan.number===transfer.number)!,mode:'photo-transfer' as const,transfer})),
 {plan:reserveScenes[2]!,mode:'photo-transfer-budget' as const,transfer:photoTransfers[1]},
];
for(const scenario of reserveCases)test(`active reserve scene ${scenario.plan.number} with ${scenario.mode} keeps the primary photo task and budget`,async t=>{
 const {plan,mode}=scenario;
 const transfer='transfer' in scenario?scenario.transfer:undefined;
 const afterCachedRejection=mode==='photo-rejected-then-pending'||mode==='photo-rejected-then-network';
 const photoRejection='The image shows the exterior of the Cutty Sark; the internal hull structure showing iron frames with wooden planking is not visible.';
 const pendingReason='Анализ материала не завершён: fixture pending checkpoint';
 const networkError=new DocumentaryMediaRateLimitError(120_000);
 const localDuplicates=mode==='photo-local-duplicates',remoteDuplicates=mode==='photo-remote-duplicates';
 const root=await mkdtemp(join(tmpdir(),'gws-reserve-primary-photo-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 t.mock.method(globalThis,'fetch',async()=>assert.fail('Offline fixture only'));
 let now=Date.now();
 if(mode==='budget')t.mock.method(Date,'now',()=>now);
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Cutty Sark',topic:'Historic clipper',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:plan.narration};
 project.settings.voice.enabled=false;
 project.settings.stockVideoPercent=mode==='video-only'?100:60;
 project.scenes=prepareDocumentaryScript(project).slice(0,1);
 const scene=project.scenes[0]!,doc=scene.documentary!;
 scene.narration=plan.narration;scene.durationSeconds=4;
 scene.audioPath=join(root,'retained.mp3');await writeFile(scene.audioPath,'Retained voice');
 doc.selectionPlan={kind:'video',videoPercent:project.settings.stockVideoPercent};
 const identities=[{name:plan.subject,aliases:[]}];
 doc.requirement={text:scene.narration,entities:[plan.subject],identities,years:[],queries:plan.video,preferredKind:'video',detail:plan.target,
   aiSearchPlan:{version:1,inputHash:'',model:'fixture',subject:plan.subject,visualTarget:plan.target,visualScope:transfer?'illustrative':'exact',
     preferredKind:'video',years:[],imageQueries:plan.image,videoQueries:plan.video,fallbackVideoQueries:plan.reserveQueries,fallbackVisualTarget:plan.reserve}};
 let duplicateBytes:Buffer|undefined,alternateBytes:Buffer|undefined;
 const duplicateOrigin='https://192.0.2.118';
 if(localDuplicates||remoteDuplicates){
   const file=join(root,'retained-photo.png'),alternate=join(root,'independent-photo.png');
   await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720','-frames:v','1','-threads','1',file]);
   await effectFfmpeg(['-y','-f','lavfi','-i','smptebars=s=1280x720','-frames:v','1','-threads','1',alternate]);
   duplicateBytes=await readFile(file);alternateBytes=await readFile(alternate);
   const checksum=createHash('sha256').update(duplicateBytes).digest('hex');
   project.scenes.push({...scene,id:'retained-photo',order:1,imagePath:file,documentary:{...doc,checksum,verified:true,pinned:true,
     selected:{id:`local:${checksum}`,provider:'local',kind:'image',title:'Retained photo',description:'Saved photo fixture',localPath:file,
       pageUrl:'https://example.test/retained-photo',downloadUrl:'https://example.test/retained-photo',rights:'licensed',license:'fixture',
       licenseUrl:'',author:'',attribution:'',query:'',retrievedAt:'now',match:'unverified',concerns:[]}}});
 }
 doc.requirement.aiSearchPlan!.inputHash=hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)}),sceneId:scene.id});
 doc.requirement.footageFallback={version:1,target:plan.reserve,queries:plan.reserveQueries,originalTarget:plan.target,narration:scene.narration,
   reason:'Retained reserve',kind:'video',automaticRecovery:{version:1,binding:documentaryThematicRecoveryBinding(project,scene),
     startedAt:'2026-11-09T00:00:00Z',blockedSourceKeys:[]}};
 const originalRequirement=structuredClone(doc.requirement);
 project=await projects.mutate(project.id,()=>project);
 assert.ok(documentaryThematicDiscoveryRequirement(project,project.scenes[0]!), 'Fixture reserve binding is current');
 const sources:DocumentaryCandidate[]=[];
 for(const kind of ['video','image'] as const)for(let i=0;i<(kind==='video'?3:transfer?0:duplicateBytes?4:2);i++){
   const id=`${kind}-${i}`,acceptedVideo=mode==='video-accepted'&&kind==='video'&&i===0;
   const fixturePhoto=kind==='image'&&duplicateBytes;
   const file=join(root,id+(acceptedVideo?'.mp4':fixturePhoto?'.png':'.bin'));
   if(acceptedVideo)await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=320x180:r=6:d=5','-c:v','libx264','-threads','1',file]);
   else if(fixturePhoto&&localDuplicates)await writeFile(file,i<2?fixturePhoto:alternateBytes!);
   else await writeFile(file,id);
   const candidate:DocumentaryCandidate={id:`commons:${id}`,provider:'commons',kind,title:kind==='video'?plan.reserveQueries[0]!:plan.image[0]!,
     description:'Offline fixture',localPath:fixturePhoto&&(remoteDuplicates||i===0)?undefined:file,
     downloadUrl:fixturePhoto?`${duplicateOrigin}/${id}.png`:`https://example.test/${id}`,pageUrl:`https://example.test/${id}`,
     rights:'licensed',license:'fixture',licenseUrl:'',author:'',attribution:'',query:kind==='video'?plan.reserveQueries[0]!:plan.image[0]!,
     retrievedAt:'now',match:'unverified',concerns:[],width:1280,height:720,durationSeconds:kind==='video'?8:undefined};
   sources.push(candidate);
   if(fixturePhoto&&localDuplicates&&i===0){
     // The search card has no localPath. Only apply's catalogue lookup can prove a cache hit.
     const catalog=join(root,'Materials','Catalog');await mkdir(catalog,{recursive:true});
     await writeFile(join(catalog,`${createHash('sha256').update(fixturePhoto).digest('hex')}.json`),JSON.stringify({...candidate,localPath:file}));
   }
 }
 let photoBytes:Buffer|undefined;
 const origin=`https://192.0.2.${mode==='photo-transfer-budget'?115:plan.number}`;
 const secondOrigin='https://192.0.2.116';
 const limited=()=>new Response('limited',{status:429,headers:{'retry-after':'120'}});
 if(transfer){
   const photoFile=join(root,'alternative.png');
   await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720','-frames:v','1','-threads','1',photoFile]);
   photoBytes=await readFile(photoFile);
   const [id,title,query,description]=transfer.commons;
   const image:DocumentaryCandidate={...sources[0]!,id:`commons:${id}`,kind:'image',title,query,
     description,downloadUrl:`${origin}/${id}.jpg`,pageUrl:`${origin}/${id}.jpg`,localPath:undefined,durationSeconds:undefined};
   const [provider,alternateId,alternateTitle]=transfer.alternate;
   sources.push(image,{...image,id:`${provider}:${alternateId}`,provider,title:alternateTitle,description:alternateTitle,
     query:plan.image[0]!,downloadUrl:`https://example.test/${alternateId}.png`,pageUrl:`https://example.test/${alternateId}`});
   if('secondCommons' in transfer){
     const [id,title,query,description]=transfer.secondCommons;
     sources.splice(sources.length-1,0,{...image,id:`commons:${id}`,title,query,description,
       downloadUrl:`${origin}/${id}.jpg`,pageUrl:`${origin}/${id}.jpg`});
   }
   if(mode==='photo-transfer-budget')sources.splice(sources.length-1,0,{...image,id:'commons:1062610',
     title:'Cutty-sark.png',downloadUrl:`${secondOrigin}/1062610.png`,pageUrl:`${secondOrigin}/1062610.png`});
   if(!transfer.getCount)rememberDocumentaryMediaRateLimit(new URL(origin),limited());
 }
 const searched:{kind:string;query:string;entities?:string[]}[]=[];
 const search=new DocumentarySearch();
 search.search=async input=>{
   const searchErrors=(mode==='photo-rejected'||afterCachedRejection)&&input.kind==='video'&&input.providers?.includes('pixabay')
     ?[{provider:'pixabay' as const,count:0,error:'HTTP 429'}]:[];
   if(!input.providers?.some(provider=>sources.some(source=>source.provider===provider)))return {sources:searchErrors,candidates:[]};
   searched.push({kind:input.kind,query:input.query,entities:input.entities});
   return {sources:searchErrors,candidates:sources.filter(source=>source.kind===input.kind&&input.providers?.includes(source.provider))};
 };
 const reviews:string[]=[];
 const reviewedSources:string[]=[];
 const prepared:DocumentaryCandidate[]=[];
 const originGets:string[]=[];
 const duplicateGets:string[]=[];
 const stockDownloads:string[]=[];
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),
   {download:async asset=>{
     assert.ok(photoBytes&&transfer);
     stockDownloads.push(`${asset.provider}:${asset.id}`);
     return {data:photoBytes,extension:'.png',contentType:'image/png'};
   }},()=>{},{
     simpleSelection:true,available:async()=>true,plan:async()=>assert.fail('No replanning'),inspect:async()=>assert.fail('Use selection review'),
     selectionReviewIdentity:async()=>({model:'fixture',contract:'fixture'}),
     inspectForSelection:async(p,staged)=>{
       const source=staged.documentary!.selected!,kind=source.kind, target=kind==='video'?plan.reserve:plan.target;
       reviews.push(kind);
       reviewedSources.push(source.id);
       assert.equal(planFastDocumentaryScene(p,staged,kind).visualTarget,target);
       assert.equal(staged.narration,scene.narration);
       assert.deepEqual(staged.documentary!.requirement.identities,identities);
       assert.equal(Boolean(staged.documentary!.requirement.footageFallback),kind==='video');
       if(mode===`${kind}-pending`||kind==='image'&&(mode==='photo-pending'||mode==='photo-rejected-then-pending'&&reviews.filter(kind=>kind==='image').length===2))
         throw new DocumentaryAnalysisError(pendingReason,'pending','visual-illustration');
       if(mode==='budget'&&reviews.length===2)now+=151_000;
       const status=kind==='image'&&mode==='photo-accepted'||kind==='video'&&mode==='video-accepted'?'accepted':'rejected';
       const info=await stat(source.localPath!,{bigint:true});
       const review:NonNullable<Scene['documentary']>['visualReview']={status,confidence:1,
         reason:kind==='video'?'Reserve video verdict':mode==='photo-rejected'||afterCachedRejection?photoRejection:'Primary photo verdict',
         viewDescription:'Offline fixture view',quality:'',sampleSeconds:[0],checkedAt:'now',
         fastRelevance:{version:1,target,relevant:status==='accepted',evidence:'Fixture'},illustrationQualityVersion:1,
         targetVisibility:{version:1,target,visible:status==='accepted',evidence:'Fixture'},sourceText:{version:1,kind:'none',text:''},
         localReview:{version:1,size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)},
         ...(kind==='video'?{trimStartSeconds:0,trimEndSeconds:4,footageOrigin:'camera' as const}:{})};
       if(status==='accepted')review.illustrationApproval=documentaryIllustrationApproval(p,{...staged,trimStartSeconds:review.trimStartSeconds??0,
         trimEndSeconds:review.trimEndSeconds,documentary:{...staged.documentary!,visualReview:review}});
       return {review,usedNewAnalysis:!(kind==='image'&&afterCachedRejection)};
     },
   },undefined,undefined,{plan:async(_project,scenes)=>new Map(scenes.map(s=>[s.id,s.documentary!.requirement]))},undefined,async (input,init)=>{
     const url=new URL(String(input));
     if(url.origin===duplicateOrigin){
       assert.equal(init?.method??'GET','GET');
       duplicateGets.push(url.pathname);
       const data=Number(url.pathname.match(/image-(\d+)/)?.[1])<2?duplicateBytes:alternateBytes;
       assert.ok(data);
       return new Response(new Uint8Array(data),{headers:{'content-type':'image/png'}});
     }
     assert.ok(transfer&&(url.origin===origin||url.origin===secondOrigin));
     originGets.push(url.origin);
     return limited();
   });
 Reflect.set(service,'selectionResources',async()=>({workers:1}));
 if(duplicateBytes)service.localCandidates=async()=>[];
 const apply=Reflect.get(service,'apply').bind(service) as (...args:[string,string,DocumentaryCandidate,...unknown[]])=>Promise<Project>;
 Reflect.set(service,'apply',async(...args:Parameters<typeof apply>)=>{
   const [,id,candidate]=args;
   prepared.push(candidate);
   if(mode==='photo-rejected-then-network'&&candidate.kind==='image'&&prepared.filter(item=>item.kind==='image').length===2)throw networkError;
   if((transfer||duplicateBytes)&&candidate.kind==='image')return apply(...args);
   const p=(await projects.get(project.id))!;
   return {...p,scenes:p.scenes.map(s=>s.id===id?{...s,imagePath:candidate.kind==='image'?candidate.localPath:undefined,
     videoPath:candidate.kind==='video'?candidate.localPath:undefined,documentary:{...s.documentary!,selected:candidate,
       checksum:hash(candidate.id),verified:false,visualReview:undefined}}:s)};
 });
 const result=await service.autoSelect(project.id,{sceneIds:[scene.id]});
 const final=result.project.scenes[0]!,finalDoc=final.documentary!;
 const photoTried=mode==='photo-accepted'||mode==='photo-rejected'||mode==='photo-pending'||afterCachedRejection||Boolean(transfer||duplicateBytes);
 const expected=mode==='video-accepted'?['video']:mode==='video-only'?['video','video','video']
   :['video','video',...(photoTried&&mode!=='photo-transfer-budget'&&!remoteDuplicates?['image']:[]),...(mode==='photo-rejected-then-pending'?['image']:[])];
 const transferAttempts=transfer&&'secondCommons' in transfer?['image','image','image']:['image','image'];
 const expectedPreparations=transfer?['video','video',...transferAttempts]:duplicateBytes
   ?['video','video','image','image',...(localDuplicates?['image']:[])]:mode==='photo-rejected-then-network'?[...expected,'image']:expected;
 assert.deepEqual(prepared.map(candidate=>candidate.kind),expectedPreparations,JSON.stringify(result.failures));
 assert.deepEqual(reviews,expected);
 if(duplicateBytes){
   assert.deepEqual(duplicateGets,remoteDuplicates?['/image-0.png','/image-1.png']:[]);
   assert.deepEqual(prepared.filter(candidate=>candidate.kind==='image').map(candidate=>candidate.id),
     remoteDuplicates?['commons:image-0','commons:image-1']:['commons:image-0','commons:image-1','commons:image-2']);
   assert.deepEqual(reviewedSources.filter(id=>id.startsWith('commons:image-')),remoteDuplicates?[]:['commons:image-2']);
   assert.equal(result.project.scenes[1]!.documentary!.verified,true);
 }
 if(transfer){
   assert.deepEqual(originGets,mode==='photo-transfer-budget'?[origin,secondOrigin]:transfer.getCount?[origin]:[]);
   const [provider,id]=transfer.alternate;
   assert.deepEqual(stockDownloads,mode==='photo-transfer-budget'?[]:[`${provider}:${id}`]);
   assert.deepEqual(reviewedSources.filter(id=>id.startsWith('pexels:')||id.startsWith('pixabay:')),stockDownloads);
 }
 assert.ok(searched.filter(q=>q.kind==='video').every(q=>plan.reserveQueries.includes(q.query)));
 const photos=searched.filter(q=>q.kind==='image');
 assert.equal(Boolean(photos.length),photoTried);
 assert.ok(photos.every(q=>plan.image.includes(q.query)));
 assert.deepEqual(finalDoc.requirement,mode==='photo-accepted'?{...originalRequirement,footageFallback:undefined}:originalRequirement);
 assert.equal(final.audioPath,scene.audioPath);
 assert.equal(final.narration,scene.narration);
 if(mode==='video-accepted'){
   assert.equal(result.selected,1);
   assert.equal(finalDoc.selected?.kind,'video');
 }
 if(mode==='photo-accepted'){
   assert.equal(finalDoc.verified,true);
   assert.equal(finalDoc.selected?.kind,'image');
   assert.equal(documentarySavedContextIssue(result.project,final),undefined);
   assert.equal(documentaryCheckedVideoCoverage(result.project).videoSeconds,0);
 }
 if(mode==='photo-rejected'||afterCachedRejection){
   assert.equal(finalDoc.searchRecovery?.reason,'Reserve video verdict');
   assert.match(finalDoc.searchError??'',/HTTP 429/);
   const [category,message]=mode==='photo-rejected'?['content-rejected',photoRejection]
     :mode==='photo-rejected-then-pending'?['analysis',pendingReason]:['provider-temporary',networkError.message];
   assert.deepEqual(result.failures,[{sceneId:scene.id,sceneNumber:scene.order+1,category,message}]);
 }
 if(mode==='photo-pending'){
   const pendingPath=join(root,'projects',project.id,'Documentary',scene.id,'primary-photo-uncertain-candidates.json');
   assert.ok(JSON.parse(await readFile(pendingPath,'utf8')).keys.length);
   const pendingSource=reviewedSources.find(id=>id.startsWith('commons:image-'))!;
   await service.autoSelect(project.id,{sceneIds:[scene.id]});
   assert.equal(reviewedSources.filter(id=>id===pendingSource).length,1,'The same pending photo is not submitted again');
 }
});

const actual=[
 {narration:'On November 22, 1869, Cutty Sark slid into the water at Dumbarton, Scotland.',subject:'Cutty Sark launch at Dumbarton, Scotland, 1869',
 target:'Preserved Cutty Sark hull and bow at Greenwich shown as a modern view of the same ship, illustrating the 1869 launch rather than recording it',
 video:['Cutty Sark Greenwich hull bow exterior','Cutty Sark clipper ship Greenwich drone'],image:['Cutty Sark launch 1869 Dumbarton Scott & Linton','Cutty Sark 1869 historic illustration']},
 {narration:'She had been built to race across oceans and bring Chinese tea home before her rivals.',subject:'Cutty Sark tea clipper',
 target:'Preserved Cutty Sark under full rigging at Greenwich, illustrating the tea clipper built for ocean racing, framed as a modern view of the same ship',
 video:['Cutty Sark Greenwich masts rigging','Cutty Sark tea clipper ship exterior'],image:['Cutty Sark tea clipper painting','Cutty Sark China tea trade clipper']},
];
for(const [index,plan] of actual.entries())for(const verdict of ['accepted','rejected','no-image-queries'] as const)test(`actual scene ${index+1}: failed video then ${verdict} primary photo, bounded and without replanning`,async t=>{
 const acceptedPhoto=verdict==='accepted',allowPhoto=verdict!=='no-image-queries';
 const root=await mkdtemp(join(tmpdir(),'gws-primary-photo-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
 let project=await projects.create({title:'Cutty Sark',topic:'Historic clipper',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
 project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:plan.narration};
 project.settings.voice.enabled=false;project.settings.stockVideoPercent=60;
 project.settings.assembly.documentary!.autoMotionGraphics=false;project.settings.assembly.documentary!.autoEffects=false;
 project.scenes=prepareDocumentaryScript(project).slice(0,1);const scene=project.scenes[0]!;scene.durationSeconds=4;
 scene.audioPath=join(root,'saved-voice.mp3');
 await writeFile(scene.audioPath,'Saved voice fixture');
 scene.documentary!.selectionPlan={kind:'video',videoPercent:60};
 scene.documentary!.requirement={text:scene.narration,entities:[plan.subject],identities:[{name:plan.subject,aliases:[]}],years:[],queries:[...plan.video,...plan.image],preferredKind:'video',detail:plan.target,
  aiSearchPlan:{version:1,inputHash:'',model:'fixture',subject:plan.subject,visualTarget:plan.target,visualScope:'illustrative',preferredKind:'video',years:[],
   imageQueries:allowPhoto?plan.image:[],videoQueries:plan.video,fallbackVideoQueries:[],fallbackVisualTarget:''}};
 scene.documentary!.requirement.aiSearchPlan!.inputHash=hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)}),sceneId:scene.id});
 project=await projects.mutate(project.id,()=>project);
 const videoFile=join(root,'video.bin'),photoFile=join(root,'photo.bin');await writeFile(videoFile,'Video fixture');await writeFile(photoFile,'Saved photo fixture');
 const source=(kind:'image'|'video'):DocumentaryCandidate=>({id:kind==='image'?'commons:157506747':'pixabay:21472',provider:'commons',kind,
  title:kind==='image'?'Cutty Sark (January 2024) 02.jpg':'Greenwich colonnades',description:'Saved source metadata',localPath:kind==='image'?photoFile:videoFile,
  pageUrl:'https://example.test/'+kind,downloadUrl:'https://example.test/'+kind,rights:'licensed',license:'fixture',licenseUrl:'',author:'',attribution:'',
  query:kind==='image'?plan.image[0]!:plan.video[0]!,retrievedAt:'now',match:'unverified',concerns:[],width:1280,height:720,durationSeconds:4});
 const searched:string[]=[];
 const search=new DocumentarySearch();search.search=async input=>{searched.push(input.kind+':'+input.query);return {candidates:[source(input.kind)],sources:[]};};
 const reviews:string[]=[];let prepared=0;
 const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),search,join(root,'Materials'),{download:async()=>assert.fail('No network')},()=>{},
  {simpleSelection:true,available:async()=>true,plan:async()=>assert.fail('No replanning'),inspect:async()=>assert.fail('Use bound selection review'),
   withSelectionBudget:async(_budget,work)=>work(),
   inspectForSelection:async(p,s,_progress,_stop,cacheOnly)=>{
    const kind=s.documentary!.selected!.kind;if(!cacheOnly)reviews.push(kind);
    assert.equal(planFastDocumentaryScene(p,s).visualTarget,plan.target,'Photo review must retain the primary target');
    const info=await stat(kind==='image'?photoFile:videoFile,{bigint:true});
    const review:NonNullable<Scene['documentary']>['visualReview']={status:kind==='image'&&acceptedPhoto?'accepted':'rejected',confidence:1,reason:'Offline orchestration verdict, not a pixel-quality claim',viewDescription:'Fixture visible subject description',quality:'',sampleSeconds:[0],checkedAt:'now',
     fastRelevance:{version:1,target:plan.target,relevant:kind==='image'&&acceptedPhoto,evidence:'Fixture'},illustrationQualityVersion:1,
     targetVisibility:{version:1,target:plan.target,visible:kind==='image'&&acceptedPhoto,evidence:'Fixture'},sourceText:{version:1,kind:'none',text:''},
     localReview:{version:1,size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)}};
    if(review.status==='accepted')review.illustrationApproval=documentaryIllustrationApproval(p,{...s,documentary:{...s.documentary!,visualReview:review}});
    return {review,usedNewAnalysis:!cacheOnly};
   }});
 Reflect.set(service,'selectionResources',async()=>({workers:1}));service.localCandidates=async()=>[];
 // Source decoding is isolated; the real selector, rejection ledger, review
 // binding, commit and coverage calculation execute normally.
 Reflect.set(service,'apply',async(_id:string,id:string,c:DocumentaryCandidate)=>{
  prepared++;const p=(await projects.get(project.id))!;return {...p,scenes:p.scenes.map(s=>s.id===id?{...s,imagePath:c.kind==='image'?photoFile:undefined,videoPath:c.kind==='video'?videoFile:undefined,
   documentary:{...s.documentary!,selected:c,checksum:hash(c.id),verified:false}}:s)};
 });
 const result=await service.autoSelect(project.id,{sceneIds:[scene.id]});
 assert.deepEqual(reviews,allowPhoto?['video','image']:['video'],JSON.stringify({searched,failures:result.failures,error:result.project.scenes[0]!.documentary!.autoError}));assert.equal(prepared,allowPhoto?2:1);
 assert.equal(result.project.scenes[0]!.documentary!.verified,acceptedPhoto);
 assert.equal(result.selected,acceptedPhoto?1:0);
 assert.equal(result.project.settings.stockVideoPercent,60);
 assert.equal(documentaryCheckedVideoCoverage(result.project).videoSeconds,0,'A photo never counts toward the 60% video quota');
 const budget=JSON.parse(await readFile(join(root,'projects',project.id,'Documentary','selection-budget.json'),'utf8'));
 assert.ok(budget.scenes.every((row:{key:string;attempts:number})=>row.attempts<=budget.limits[row.key.endsWith(':video')?'video':'image'].attempts));
 if(acceptedPhoto){
  assert.equal(documentarySavedContextIssue(result.project,result.project.scenes[0]!),undefined);
 }
 const searchesBeforeResume=[...searched],preparationsBeforeResume=prepared;
 await service.autoSelect(project.id,{sceneIds:[scene.id]});
 assert.equal(reviews.length,allowPhoto?2:1,'A saved refusal or approved photo is not paid for again on resume');
 if(allowPhoto&&!acceptedPhoto){
  const fallback=await service.completeWithNativeFallback(project.id,undefined,undefined,true);
  await service.completeWithVideoQuota(fallback,new AbortController().signal);
  assert.equal(reviews.filter(kind=>kind==='image').length,1,'Thematic/native and quota recovery must not resubmit the refused primary photo');
 }
 if(acceptedPhoto){
  let montageCalls=0;
  const production=await prepareDocumentaryProduction(project.id,{projects,signal:new AbortController().signal,startNarration:async()=>async()=>{},
   documentary:{planSearch:async()=>result.project,autoSelect:async()=>result,automaticVideoQuotaRequired:true,completeWithVideoQuota:async p=>p,
    prepareMontage:async id=>{montageCalls++;return (await projects.get(id))!;}}});
  assert.equal(montageCalls,1,'The mixed search target permits montage with an approved photo');
  const preparedScene=production.project.scenes[0]!;
  assert.equal(preparedScene.imagePath,photoFile);
  assert.equal(preparedScene.documentary!.selected!.kind,'image');
  assert.equal(preparedScene.audioPath,scene.audioPath);
  assert.equal(await readFile(preparedScene.audioPath!,'utf8'),'Saved voice fixture');
  assert.equal(production.project.settings.stockVideoPercent,60);
  assert.deepEqual(searched,searchesBeforeResume);
  assert.equal(prepared,preparationsBeforeResume);
 }
});
