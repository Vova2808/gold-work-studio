import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,stat,utimes,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createDefaultProjectSettings,createDocumentarySettings,documentaryAiPlanContext,type Project,type Scene} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';
import {AnyModelOutputFormatError} from './anymodel-client.js';
import {documentaryVisualVerdictKey} from './documentary-checkpoint-key.js';
import {readDocumentaryRequestJournal} from './documentary-request-journal.js';
import {listDocumentaryRecovery,DocumentaryRetryPermissions,readDocumentarySelectionRetryGrant,documentarySelectionRetry} from './documentary-retry.js';

const hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const rejected={suitable:false,targetVisible:false,description:'No bird is visible.',reason:'The required bird is absent.',sourceText:{kind:'none',text:''}};
async function fixture(t:test.TestContext){
  const root=await mkdtemp(join(tmpdir(),'gws-review-journal-'));t.after(()=>rm(root,{recursive:true,force:true}));
  t.mock.method(globalThis,'fetch',async()=>assert.fail('Offline regression: no network'));
  const file=join(root,'source.jpg');await writeFile(file,'immutable source bytes');
  const checksum=hash('immutable source bytes'),narration='A bird rests in the tree.';
  const scene={id:'s3',order:3,title:'Bird',narration,durationSeconds:4,imagePath:file,
    documentary:{version:2,pinned:false,verified:false,illustrative:false,reviewNote:'',candidates:[],effects:[],layout:'full',caption:{enabled:false,text:''},checksum,
      requirement:{text:narration,entities:[],years:[],queries:['bird'],preferredKind:'image',detail:'A bird in a tree'},
      selected:{id:'bird',provider:'local',kind:'image',localPath:file,width:1280,height:720,title:'Bird in a tree',description:'Bird on a branch.',rights:'user-confirmed'}}} as unknown as Scene;
  const scenes=Array.from({length:7},(_,i)=>i===3?scene:{id:'s'+i,order:i,title:'Scene',narration:`Original neighbouring line ${i}.`,durationSeconds:4} as Scene);
  const project={id:'p',title:'Bird',topic:'Bird',language:'en',mediaMode:'stock',settings:createDefaultProjectSettings(),scenes,videoBrief:{readyScript:scenes.map(s=>s.narration).join('\n')}} as Project;
  project.settings.assembly.documentary=createDocumentarySettings();
  const refreshPlan=()=>{
    scene.documentary!.requirement.aiSearchPlan={version:1,model:'fixture',inputHash:hash({inputHash:hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)}),sceneId:scene.id}),
      subject:'bird',visualTarget:scene.documentary!.requirement.detail!,visualScope:'illustrative',preferredKind:'image',years:[],imageQueries:['bird'],videoQueries:[],fallbackVisualTarget:'',fallbackVideoQueries:[]};
  };
  const prepareFrames=async()=>{
    const info=await stat(file,{bigint:true}),revision={size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)};
    const frames=join(root,'Documentary','Frames',checksum+'-white-v2-'+hash(revision));
    await mkdir(frames,{recursive:true});await writeFile(join(frames,'0.000.jpg'),'mocked frame bytes');
  };
  refreshPlan();await prepareFrames();
  const directory=join(root,'Documentary','Analysis');await mkdir(directory,{recursive:true});
  return {root,directory,project,scene,checksum,file,refreshPlan,prepareFrames};
}

test('verdict identity ignores transport and remote script edits but retains range and visual constraints',()=>{
  const input={singleReview:true,checksum:'a'.repeat(64),startSeconds:1,endSeconds:5,visualTarget:'A bird',narration:'The bird rests.',
    narrativeContext:{preceding:[{text:'A remote line.'},{text:'Near one.'},{text:'Near two.'}],following:[{text:'After.'}]}};
  const key=documentaryVisualVerdictKey(input);
  assert.equal(key,documentaryVisualVerdictKey({...input,fullScript:'changed',fileRevision:{mtimeNs:'2'},analysisModel:'different',singleReviewVersion:999,
    narrativeContext:{...input.narrativeContext,preceding:[{text:'Changed remote line.'},{text:'Near one.'},{text:'Near two.'}]}}));
  for(const change of [{endSeconds:6},{visualTarget:'A fish'},{requiredYears:['1945']},{narration:'The bird flies.'}])
    assert.notEqual(key,documentaryVisualVerdictKey({...input,...change}));
});

test('foreign unbound/corrupt receipts do not own a candidate; its actual unknown receipt still blocks replay',async t=>{
  const f=await fixture(t),foreign=join(f.directory,'a'.repeat(64)+'.json'),corrupt=join(f.directory,'b'.repeat(64)+'.json');
  await writeFile(foreign,JSON.stringify({state:'pending',purpose:'visual-overview'}));await writeFile(corrupt,'{"broken":');
  let calls=0;
  const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryAnalysisModel:async()=>'fixture',documentaryCompletion:async()=>{calls++;return JSON.stringify(rejected);}},()=>f.root);
  assert.equal((await intel.inspectForSelection(f.project,f.scene)).review.status,'rejected');assert.equal(calls,1);
  const journal=await readDocumentaryRequestJournal(f.directory),own=journal.find(row=>row.receipt?.singleReviewBinding?.checksum===f.checksum)!;
  await writeFile(join(f.directory,own.key+'.json'),JSON.stringify({...own.receipt,state:'pending',result:undefined}));
  await assert.rejects(intel.inspectForSelection(f.project,f.scene),error=>error instanceof DocumentaryAnalysisError&&error.kind==='pending'&&error.requestSent&&error.requestKey===own.key);
  assert.equal(calls,1);assert.equal(await readFile(corrupt,'utf8'),'{"broken":');
  assert.equal(journal.find(row=>row.key==='b'.repeat(64))?.corrupt,true);
});

test('same source verdict survives mtime, model and unrelated script edits; new target is a new question',async t=>{
  const f=await fixture(t);let calls=0,model='first';const inputs:any[]=[];
  const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryAnalysisModel:async()=>model,documentaryCompletion:async(_system,input)=>{calls++;inputs.push(JSON.parse(input));return JSON.stringify(rejected);}},()=>f.root);
  await intel.inspectForSelection(f.project,f.scene);
  assert.equal(inputs[0].fullScript,undefined);assert.equal(inputs[0].narrativeContext.preceding.length,2);
  assert.ok(!JSON.stringify(inputs[0]).includes('Original neighbouring line 0.'));
  const first=(await readDocumentaryRequestJournal(f.directory)).find(row=>row.receipt?.singleReviewBinding)!;
  const original=await readFile(join(f.directory,first.key+'.json'),'utf8');
  model='second';f.project.title='Edited title';f.project.scenes[0]!.narration='An unrelated changed introduction.';
  f.project.videoBrief!.readyScript=f.project.scenes.map(s=>s.narration).join('\n');f.refreshPlan();
  const info=await stat(f.file);await utimes(f.file,info.atime,new Date(info.mtimeMs+3000));await f.prepareFrames();
  assert.equal((await intel.inspectForSelection(f.project,f.scene)).review.status,'rejected');assert.equal(calls,1);
  assert.equal(await readFile(join(f.directory,first.key+'.json'),'utf8'),original);
  // Pre-index receipts are migrated by reading their explicit source/question
  // binding. They are never discarded or overwritten to make a cache hit.
  const legacy={...first.receipt,singleReviewBinding:{...first.receipt!.singleReviewBinding,verdictKey:undefined}};
  await writeFile(join(f.directory,first.key+'.json'),JSON.stringify(legacy));
  await intel.inspectForSelection(f.project,f.scene);assert.equal(calls,1);
  f.scene.documentary!.requirement.detail='A flying bird';f.refreshPlan();
  await intel.inspectForSelection(f.project,f.scene);assert.equal(calls,2);
});

test('legacy approval needs its full old task proof; changed years cannot inherit a short-target approval',async t=>{
  const f=await fixture(t);let calls=0;
  const client={configured:async()=>true,documentaryAnalysisModel:async()=>'fixture',documentaryCompletion:async()=>{
    calls++;return JSON.stringify({suitable:true,targetVisible:true,description:'A bird sitting on a branch.',reason:'The bird is visible.',
      targetEvidence:'The bird and its tree branch are clearly visible.',sourceText:{kind:'none',text:''}});
  }};
  const original=new DocumentaryIntelligence(client,()=>f.root),complete=Reflect.get(original,'complete').bind(original);
  Reflect.set(original,'complete',(...args:any[])=>{
    const legacy=args[5].find((request:any)=>request.system===args[2]&&JSON.parse(request.input).fullScript&&JSON.parse(request.input).singleReviewVersion===5);
    assert.ok(legacy);return complete(args[0],args[1],legacy.system,legacy.input,args[4]);
  });
  assert.equal((await original.inspectForSelection(f.project,f.scene)).review.status,'accepted');
  const entry=(await readDocumentaryRequestJournal(f.directory)).find(row=>row.receipt?.singleReviewBinding)!;
  const legacy={...entry.receipt,singleReviewBinding:{...entry.receipt!.singleReviewBinding,verdictKey:undefined}};
  const path=join(f.directory,entry.key+'.json'),bytes=JSON.stringify(legacy);await writeFile(path,bytes);
  const resumed=new DocumentaryIntelligence(client,()=>f.root);
  assert.equal((await resumed.inspectForSelection(f.project,f.scene)).review.status,'accepted');assert.equal(calls,1);
  f.scene.documentary!.requirement.aiSearchPlan!.years=['1950'];
  const changed=await resumed.inspectForSelection(f.project,f.scene);
  assert.equal(changed.review.status,'uncertain');assert.equal(changed.review.illustrationApproval,undefined);
  assert.equal(calls,1,'Ambiguous legacy evidence never buys a second vote automatically');assert.equal(await readFile(path,'utf8'),bytes);
});

for(const automatic of [true,false])test(`known empty has an actionable single retry with larger output allowance (automatic=${automatic})`,async t=>{
  const f=await fixture(t);f.project.settings.assembly.documentary!.retryEmptyVisualResponse=automatic;
  const tokens:number[]=[];
  const client:any={configured:async()=>true,documentaryAnalysisModel:async()=>'fixture',documentaryCompletion:async(_system:unknown,_input:unknown,_images:unknown,_signal:unknown,_partial:unknown,_model:unknown,maxTokens:number,_compact:unknown,options:any)=>{
    tokens.push(maxTokens);options.onTerminal({finishReason:'stop',terminalKind:'finish_reason',outputLimit:maxTokens,receivedCharacters:0});
    throw new AnyModelOutputFormatError('Empty terminal response',true,'');
  }};
  const intel=new DocumentaryIntelligence(client,()=>f.root);
  await assert.rejects(intel.inspectForSelection(f.project,f.scene),error=>error instanceof DocumentaryAnalysisError&&error.kind==='empty');
  assert.deepEqual(tokens,automatic?[1200,5600]:[1200]);
  if(!automatic){
    const items=await listDocumentaryRecovery(f.root);assert.equal(items[0]?.state,'empty');assert.equal(items[0]?.sceneId,f.scene.id);
    await new DocumentaryRetryPermissions().authorize(f.root,items);
    const grant=(await readDocumentarySelectionRetryGrant(f.directory,items[0]!.id))!;assert.equal(grant.priorState,'empty');
    await assert.rejects(documentarySelectionRetry.run({grant,probe:false},()=>intel.inspectForSelection(f.project,f.scene)),error=>error instanceof DocumentaryAnalysisError&&error.kind==='empty');
    assert.deepEqual(tokens,[1200,5600]);
  }
  await assert.rejects(new DocumentaryIntelligence(client,()=>f.root).inspectForSelection(f.project,f.scene));
  assert.equal(tokens.length,2,'Restart cannot create a third automatic payment');
  const entries=await readDocumentaryRequestJournal(f.directory);assert.ok(entries.some(row=>row.receipt?.rejection==='empty-response'));
});
