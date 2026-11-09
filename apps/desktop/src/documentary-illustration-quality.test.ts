import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {createDefaultProjectSettings,documentaryAiPlanContext,documentaryMaterialUsable,type Project,type Scene} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {documentarySavedContextIssue,revalidateDocumentaryContext,documentaryIllustrationApproval} from './documentary-context-approval.js';
import {documentarySavedQualityIssue,documentarySourceText} from './documentary-source-quality.js';
import {documentaryIllustrationQualityIssue,documentaryLegacyIllustrationRisk,documentaryInternalPartIssue,documentaryIllustrationQualityInstruction,documentaryIllustrationResponseInstruction,documentaryIllustrationQualityInstructionV1,documentaryIllustrationQualityInstructionV2} from './documentary-illustration-quality.js';
import {effectFfmpeg} from './effect-media.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean={description:'A steamship with a hull, deck and smokestack.',suitable:true,reason:'Visible steamship illustrates steam transport.',
 targetVisible:true,targetEvidence:'Hull, deck and smoking funnel are visible.',sourceText:{kind:'none',text:''}};
const portrait={description:'A pencil portrait drawing of a captain in uniform with a cap, bearing handwritten captions including his name.',suitable:true,reason:'The portrait matches the captain.'};
const wake={description:'Footage showing water churning beside a moving vessel with overlay text about an operating steam-driven ship.',suitable:true,
 reason:'Shows a steamship-related wake, illustrating the rise of steam power matching the narration.'};
const vicinity={description:'Footage shows the exterior area near the preserved clipper, featuring a glass dome entrance and modern surroundings.',suitable:true,
 reason:'Modern view of the area where the ship is exhibited.'};
const internalTarget='Preserved ship iron frame interior, cargo hold space';
const museumFrame={...clean,description:'An interior view looking upward through modern geometric glass framing and structural elements of the preserved ship museum, with reflections showing parts of the wooden hull and sky.',
 reason:'Modern illustration of the preserved ship, fitting the narration about iron framing.',
 targetEvidence:'The geometric glass and steel framing reflecting the interior museum setup and sections of the preserved ship hull.'};

async function fixture(t:test.TestContext,target='steamship at sea'){
 const root=await mkdtemp(join(tmpdir(),'gws-illustration-quality-'));assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=join(root,'source.jpg');await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=s=1280x720:r=1','-frames:v','1',file]);
 const narration='Steam transport grew during the nineteenth century.';
 const scene={id:'quality',order:0,narration,durationSeconds:4,imagePath:file,documentary:{verified:false,
  checksum:createHash('sha256').update(await readFile(file)).digest('hex'),
  selected:{id:'local:source',provider:'local',kind:'image',title:'Steam transport',description:'Historical illustration',pageUrl:'https://example.test/source',localPath:file,
   downloadUrl:'',rights:'user-confirmed',author:'fixture',license:'user',licenseUrl:'',attribution:'fixture',retrievedAt:'now',query:'steamship',match:'unverified',concerns:[]},
  requirement:{text:narration,entities:[],identities:[],years:[],queries:['steamship'],detail:target,visualScope:'illustrative',plannedBy:'semantic',
   aiSearchPlan:{version:1,model:'fixture',inputHash:'',subject:'Steam transport',visualTarget:target,visualScope:'illustrative',preferredKind:'image',years:[],
    imageQueries:['steamship'],videoQueries:['steamship'],fallbackVisualTarget:'steam transport',fallbackVideoQueries:['steamship']}}}} as unknown as Scene;
 const project={id:'quality-project',title:'History',topic:'History',language:'en',aspectRatio:'16:9',mediaMode:'stock',settings:createDefaultProjectSettings(),scenes:[scene],videoBrief:{readyScript:narration}} as Project;
 scene.documentary!.requirement.aiSearchPlan!.inputHash=hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)}),sceneId:scene.id});
 const receipts=async()=>{const dir=join(root,'Documentary','Analysis');return Promise.all((await readdir(dir)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).map(async name=>({path:join(dir,name),bytes:await readFile(join(dir,name),'utf8')})));};
 return {root,project,scene,receipts};
}

test('visible target and text relevance are independent gates, including ordinary physical markings',()=>{
 const check=(value:Record<string,unknown>,target='steamship at sea')=>documentaryIllustrationQualityIssue(target,value,true);
 assert.equal(check(clean),undefined);
 assert.equal(check({...clean,targetVisible:false,targetEvidence:'Only churning water is visible.'})?.status,'rejected');
 assert.equal(check({...clean,targetEvidence:undefined})?.status,'uncertain');
 assert.equal(check({...clean,sourceText:undefined})?.status,'uncertain');
 assert.equal(check({...clean,sourceText:{kind:'physical',text:'SS Example'}}),undefined);
 assert.equal(check({...clean,sourceText:{kind:'caption',text:'Steam transport',relevant:true,evidence:'The caption labels the narrated subject.'}}),undefined);
 assert.equal(check({...clean,sourceText:{kind:'caption',text:'Well done! Mr. Baggins!',relevant:false,evidence:'An unrelated fictional reference.'}})?.status,'rejected');
 assert.equal(check({...clean,sourceText:{kind:'caption',text:'Unidentified title'}})?.status,'uncertain');
 assert.equal(check({...clean,sourceText:{kind:'caption',text:'Steam transport',relevant:true}})?.status,'uncertain');
 assert.equal(check({...clean,sourceText:{kind:'promotion',text:'Please subscribe'}})?.status,'rejected');
 const wakeProof={...clean,description:'Only the wake is visible.',targetEvidence:'Churning foam in the wake.'};
 assert.equal(check(wakeProof,'wake behind a moving vessel'),undefined);
 assert.equal(check(wakeProof)?.status,'uncertain','An internally contradictory whole-object approval stays unusable');
 assert.equal(documentaryLegacyIllustrationRisk('captain portrait',portrait)?.includes('надписи'),true);
 assert.ok(documentaryLegacyIllustrationRisk('steamship at sea',{...wake,sourceText:{kind:'caption',text:'Steam transport',relevant:true}}));
 assert.equal(documentaryLegacyIllustrationRisk('steamship at sea',{description:'A ship with a nameplate and a wake.',reason:'Modern sailors in modern clothes are visible.'}),undefined);
 assert.equal(documentaryLegacyIllustrationRisk('steamship at sea',{description:'A steamship is visible. No captions or overlay text.'}),undefined);
 assert.ok(documentaryLegacyIllustrationRisk('preserved clipper ship',vicinity));
 for(const description of ['A ship near a harbour, with its hull and rigging visible.',
  'Footage shows the exterior of the preserved ship and its glass dry dock structure.',
  'Close-up of the bowsprit, figurehead and rigging.',
  'Footage shows the exterior area near the ship; the ship itself is clearly visible.'])
  assert.equal(documentaryLegacyIllustrationRisk('preserved clipper ship',{description}),undefined,description);
 assert.equal(documentaryLegacyIllustrationRisk('the exterior area near a museum ship',vicinity),undefined);
 assert.equal(documentaryLegacyIllustrationRisk('preserved clipper ship',{...vicinity,targetVisible:true,targetEvidence:'The hull and masts are visible behind the dome.'}),undefined);
});

test('a completed visual response with explicit no source text does not require an empty placeholder',()=>{
 // Installed v22 small control, scene 34, receipt 250a6dff. Preserve the omitted field from the model response.
 const result={description:'Close-up of a woodworker using a hand saw to cut into a rectangular wooden beam resting on a workbench with wood shavings.',
  suitable:true,reason:'The footage visibly depicts a carpenter sawing a wooden beam with a hand saw, satisfying the illustrative target and supporting the action in the script.',
  targetVisible:true,targetEvidence:'A woodworker holds and pulls a hand saw cutting through a rectangular wooden beam on a workshop table.',
  sourceText:{kind:'none'},footageOrigin:'camera'};
 const check=(value:Record<string,unknown>)=>documentaryIllustrationQualityIssue('carpenter sawing wooden beam',value,true);
 assert.deepEqual(documentarySourceText(result),{version:1,kind:'none',text:''});
 assert.equal(check(result),undefined);
 for(const sourceText of [undefined,{},...['physical','caption','promotion','uncertain'].map(kind=>({kind})),
  ...[undefined,null,12,'Subscribe'].map(text=>({kind:'none',text}))]){
  assert.equal(check({...result,sourceText})?.status,'uncertain');
 }
});

test('an internal frame must belong to the object, while museum context and real object parts remain permitted',()=>{
 assert.ok(documentaryInternalPartIssue(internalTarget,museumFrame));
 assert.equal(documentaryIllustrationQualityIssue(internalTarget,museumFrame,true)?.status,'uncertain','A true visibility flag cannot override explicitly described display framing');
 assert.ok(documentaryInternalPartIssue(internalTarget,{description:museumFrame.description}),'Old description alone identifies the substitution');
 for(const target of ['The preserved ship, modern view as illustration of the historical vessel',
  'The ship as a public museum attraction today, with visitors','Museum interior around the ship'])
  assert.equal(documentaryInternalPartIssue(target,museumFrame),undefined,target);
 assert.equal(documentaryInternalPartIssue('Interior of a preserved train',museumFrame),undefined,'Do not impose a structural-detail contract on an unspecified interior');
 assert.ok(documentaryInternalPartIssue(internalTarget,{...museumFrame,targetEvidence:'No iron frames inside the ship are visible; only the museum glass enclosure is shown.'}));
 for(const targetEvidence of ['The ship\'s original iron frames are visible inside the hold, with museum glass beyond.',
  'Iron ribs inside the ship are riveted to its hull, beside a museum display support.',
  'Riveted iron frames inside the cargo hold show the original structure; the museum roof is outside.'])
  assert.equal(documentaryInternalPartIssue(internalTarget,{...museumFrame,targetEvidence}),undefined,targetEvidence);
 assert.equal(documentaryInternalPartIssue(internalTarget,{...clean,description:'A museum view of iron frames inside the ship.',targetEvidence:'Iron frames inside the ship connect to the hull.'}),undefined,'Museum capture era/location alone is allowed');
});

test('uncertain empty incidental text does not veto a confirmed visible subject, while observed captions and promotion remain blocked',()=>{
 const check=(value:Record<string,unknown>,target='steamship at sea')=>documentaryIllustrationQualityIssue(target,value,true);
 const incidental={...clean,footageOrigin:'camera',sourceText:{kind:'uncertain',text:''}};
 assert.equal(check(incidental),undefined);
 assert.equal(check({...incidental,suitable:undefined})?.status,'uncertain');
 assert.equal(check({...incidental,targetVisible:false})?.status,'rejected');
 assert.equal(check(incidental,'steamship nameplate inscription')?.status,'uncertain');
 assert.equal(check({...incidental,sourceText:{kind:'caption',text:''}})?.status,'uncertain','An observed unreadable caption is not incidental text');
 assert.equal(check({...incidental,sourceText:{kind:'uncertain',text:'Unrelated movie title'}})?.status,'uncertain');
 assert.equal(check({...incidental,description:'A ship with an unreadable overlay caption.'})?.status,'uncertain');
 assert.equal(check({...incidental,description:'A ship with large unreadable burned-in subtitles.'})?.status,'uncertain');
 assert.equal(check({...incidental,description:'A ship with an unreadable watermark.'})?.status,'uncertain');
 assert.equal(check({...incidental,description:'A ship without subtitles or overlay text.'}),undefined);
 assert.equal(check({...incidental,sourceText:{kind:'caption',text:'Unrelated movie title',relevant:false}})?.status,'rejected');
 assert.equal(check({...incidental,sourceText:{kind:'promotion',text:'Subscribe to channel'}})?.status,'rejected');
});

test('an existing positive review with unreadable incidental text replays without another request and retains its source-text evidence',async t=>{
 const {root,project,scene,receipts}=await fixture(t);let calls=0;
 const client={configured:async()=>true,documentaryCompletion:async()=>{calls++;return JSON.stringify({...clean,sourceText:{kind:'uncertain',text:''}});}};
 const old=new DocumentaryIntelligence(client,()=>root);
 await old.inspectForSelection(project,scene);const before=await receipts();
 const result=await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene);
 assert.equal(result.review.status,'accepted');assert.equal(result.usedNewAnalysis,false);assert.equal(calls,1);
 assert.equal(result.review.sourceText?.kind,'uncertain');assert.equal(result.review.sourceText?.text,'');
 scene.documentary!.visualReview=result.review;scene.documentary!.verified=true;
 assert.equal(documentarySavedContextIssue(project,scene),undefined);assert.deepEqual(await receipts(),before);
});

for(const blocked of [false,true])test(`exact previous qualityV1 prompt receives one current-contract review and preserves unknown guards (${blocked?'display frame':'valid object'})`,async t=>{
 const {root,project,scene,receipts}=await fixture(t,blocked?internalTarget:'steamship at sea');let calls=0;
 const client={configured:async()=>true,documentaryCompletion:async(system:string)=>{
  calls++;assert.ok(calls===1?system.endsWith(documentaryIllustrationQualityInstructionV1):system===documentaryIllustrationResponseInstruction);
  return JSON.stringify(blocked?museumFrame:clean);
 }};
 const old=new DocumentaryIntelligence(client,()=>root),complete=Reflect.get(old,'complete').bind(old);
 Reflect.set(old,'complete',(...args:unknown[])=>{
  const prior=(args[5] as Array<{system:string;input:string}>).find(request=>JSON.parse(request.input).illustrationQualityVersion===1
    &&request.system.endsWith(documentaryIllustrationQualityInstructionV1))!;
  assert.ok(prior,'Keep the exact former system with its unchanged version-1 input');
  return complete(args[0],args[1],prior.system,prior.input,args[4],[]);
 });
 const first=await old.inspectForSelection(project,scene),doc=scene.documentary!;
 // Simulate the saved acceptance made by that former prompt. The current
 // local policy must revoke only the contradictory object-part evidence.
 doc.verified=true;doc.visualReview={...first.review,status:'accepted',
  fastRelevance:{version:1,target:blocked?internalTarget:'steamship at sea',relevant:true,evidence:'Former positive model decision'}};
 doc.visualReview.illustrationApproval=documentaryIllustrationApproval(project,scene);
 assert.equal(Boolean(documentarySavedContextIssue(project,scene)),blocked);
 assert.equal(revalidateDocumentaryContext(project)[0]!.documentary!.verified,!blocked);
 const before=await receipts(),replayed=await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene);
 assert.equal(replayed.review.status,blocked?'uncertain':'accepted');assert.equal(replayed.usedNewAnalysis,true);assert.equal(calls,2);assert.equal(await readFile(before[0]!.path,'utf8'),before[0]!.bytes);
 doc.selected!.description='Later discovery metadata';assert.equal((await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene)).review.status,'uncertain');assert.equal(calls,2);
 // Unknown predecessor alone must block a new contract, even after restart.
 doc.selected!.description='Historical illustration';
 for(const row of await receipts())if(!before.some(old=>old.path===row.path))await rm(row.path);
 const saved=before[0]!,receipt=JSON.parse(saved.bytes);
 for(const state of ['pending','partial','received']){
  const bytes=JSON.stringify({...receipt,state,result:undefined});await writeFile(saved.path,bytes);
  await assert.rejects(new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene),DocumentaryAnalysisError);
  assert.equal(calls,2);assert.equal(await readFile(saved.path,'utf8'),bytes);
 }
});

test('new incomplete proof stays uncertain across restart and metadata drift without rewriting or repaying COMPLETE',async t=>{
 const {root,project,scene,receipts}=await fixture(t);let calls=0;
 const client={configured:async()=>true,documentaryCompletion:async(system:string,input:string)=>{
  calls++;assert.match(system,/"targetVisible":false/);assert.match(system,/sourceText/);assert.match(system,/generic target with no historical condition may use modern material/);
  assert.equal(JSON.parse(input).illustrationQualityVersion,1);return JSON.stringify({...clean,targetEvidence:undefined});
 }};
 const first=await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene);
 assert.equal(first.review.status,'uncertain');assert.equal(first.review.illustrationQualityVersion,1);assert.equal(first.review.illustrationApproval,undefined);
 const before=await receipts();assert.equal(before.length,1);
 for(const changed of [false,true]){
  if(changed)scene.documentary!.selected!.description='Later search metadata';
  const resumed=await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene);
  assert.equal(resumed.review.status,'uncertain');assert.equal(resumed.usedNewAnalysis,false);assert.equal(calls,1);assert.deepEqual(await receipts(),before);
 }
});

test('new verified evidence survives resume and changes to its proof revoke approval locally',async t=>{
 const {root,project,scene,receipts}=await fixture(t);let calls=0;
 const client={configured:async()=>true,documentaryCompletion:async()=>{calls++;return JSON.stringify(clean);}};
 const first=await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene);
 assert.equal(first.review.status,'accepted');scene.documentary!.visualReview=first.review;scene.documentary!.verified=true;
 assert.equal(documentarySavedContextIssue(project,scene),undefined);const before=await receipts();
 const resumed=await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene);
 assert.equal(resumed.review.status,'accepted');assert.equal(calls,1);assert.deepEqual(resumed.review.illustrationApproval,first.review.illustrationApproval);assert.deepEqual(await receipts(),before);
 first.review.sourceText={version:1,kind:'caption',text:'Unrelated title',relevant:false};assert.ok(documentarySavedContextIssue(project,scene));
});

test('known low-resolution saved illustration loses verified before resume can skip it, without another POST',async t=>{
 const {root,project,scene,receipts}=await fixture(t);let calls=0;
 const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;return JSON.stringify(clean);}},()=>root);
 const result=await intel.inspectForSelection(project,scene);assert.equal(result.review.status,'accepted');
 const doc=scene.documentary!;doc.verified=true;doc.visualReview=result.review;
 // A legacy approval lacked the geometry guard; keep its receipt unchanged.
 doc.selected!.width=640;doc.selected!.height=360;const before=await receipts();
 assert.match(documentarySavedQualityIssue(project,scene)!,/слишком мал/,'autoSelect revalidation calls this before its verified skip');
 assert.match(documentarySavedContextIssue(project,scene)!,/слишком мал/);
 assert.match((await intel.savedMotionIssue(project,scene))!,/слишком мал/);
 const resumed=revalidateDocumentaryContext(project)[0]!;
 assert.equal(resumed.documentary!.verified,false);assert.equal(documentaryMaterialUsable(resumed),false);
 assert.equal(calls,1);assert.deepEqual(await receipts(),before);
 doc.pinned=true;
 assert.equal(documentarySavedQualityIssue(project,scene),undefined);assert.equal(documentarySavedContextIssue(project,scene),undefined);
 assert.equal(await intel.savedMotionIssue(project,scene),undefined);assert.equal(revalidateDocumentaryContext(project)[0]!.documentary!.verified,true);
});

for(const [label,answer,target] of [['portrait',portrait,'captain portrait'],['wake',wake,'steamship at sea'],['vicinity',vicinity,'preserved clipper ship'],['clean',clean,'steamship at sea']] as const)
test(`legacy ${label}: new contract reviews once and same-model unknown receipts remain guarded`,async t=>{
 const {root,project,scene,receipts}=await fixture(t,target);let calls=0;
 const legacyAnswer={...answer} as Record<string,unknown>;delete legacyAnswer.targetVisible;delete legacyAnswer.targetEvidence;delete legacyAnswer.sourceText;
 const client={configured:async()=>true,documentaryCompletion:async()=>{calls++;return JSON.stringify(legacyAnswer);}};
 const old=new DocumentaryIntelligence(client,()=>root),complete=Reflect.get(old,'complete').bind(old);
 Reflect.set(old,'complete',(...args:unknown[])=>{
  const prior=(args[5] as Array<{system:string;input:string}>).slice().reverse().find(request=>!JSON.parse(request.input).illustrationQualityVersion)!;
  return complete(args[0],args[1],prior.system,prior.input,args[4],[]);
 });
 const first=await old.inspectForSelection(project,scene),doc=scene.documentary!;
 doc.verified=true;doc.visualReview={...first.review,status:'accepted',illustrationQualityVersion:undefined,
  fastRelevance:{version:1,target,relevant:true,evidence:String(legacyAnswer.reason)}};
 // Reconstruct the genuine old fingerprint, not a new approval on bad evidence.
 doc.visualReview.illustrationApproval={version:1,fingerprint:hash({version:1,narration:scene.narration,
  source:{id:doc.selected!.id,provider:doc.selected!.provider,kind:doc.selected!.kind},checksum:doc.checksum,interval:null,localReview:first.review.localReview})};
 assert.equal(Boolean(documentarySavedContextIssue(project,scene)),label!=='clean');
 const before=await receipts(),replayed=await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene);
 assert.equal(replayed.review.status,'uncertain');assert.equal(calls,2);assert.equal(replayed.usedNewAnalysis,true);assert.equal(await readFile(before[0]!.path,'utf8'),before[0]!.bytes);
 if(label!=='clean'){
  doc.selected!.description='Changed discovery metadata';
  assert.equal((await new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene)).review.status,'uncertain');assert.equal(calls,2);
 }
 // Unknown predecessor alone must block a new contract, even after restart.
 doc.selected!.description='Historical illustration';
 for(const row of await receipts())if(!before.some(old=>old.path===row.path))await rm(row.path);
 const saved=before[0]!,receipt=JSON.parse(saved.bytes);
 for(const state of ['pending','partial','received']){
  const bytes=JSON.stringify({...receipt,state,result:undefined});await writeFile(saved.path,bytes);
  await assert.rejects(new DocumentaryIntelligence(client,()=>root).inspectForSelection(project,scene),DocumentaryAnalysisError);
  assert.equal(calls,2);assert.equal(await readFile(saved.path,'utf8'),bytes);
 }
});
