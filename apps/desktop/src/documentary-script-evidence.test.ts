import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryScriptEvidence,documentaryScriptEvidenceIssue} from './documentary-script-evidence.js';
import {discoverDocumentarySourceBatches} from './documentary-discovery.js';
import {documentaryThematicStockProbe} from './documentary-project-service.js';
import type {DocumentaryCandidate} from '@gold-work/shared';

test('the existing final photo/video review checks arbitrary script conditions once and reuses its paid refusal',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-script-'));
  try{for(const kind of ['image','video']){
    const text='A worker lifts a red suitcase with its lid open.';let calls=0;
    const response={status:'rejected',confidence:.98,reason:'The suitcase lid is shut.',nextSearchQueries:['open suitcase lifting','worker carrying open red luggage'],
      scriptEvidence:{version:1,scriptText:text,checks:[
        {kind:'object',scriptQuote:'suitcase',required:'suitcase',match:true,evidence:'A suitcase is visible.'},
        {kind:'object',scriptQuote:'worker',required:'worker',match:true,evidence:'A worker is visible.'},
        {kind:'action',scriptQuote:'lifts',required:'lifting',match:kind==='video'?true:null,evidence:'The worker raises it across the ordered frames.'},
        {kind:'condition',scriptQuote:'red',required:'red colour',match:true,evidence:'The case is red.'},
        {kind:'condition',scriptQuote:'lid open',required:'open lid',match:false,evidence:'The lid is visibly closed.'}]}};
    const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input)=>{
      calls++;assert.match(system,/SAME final pixel review/);assert.equal(JSON.parse(input).originalScript.text,text);
      return JSON.stringify(response);
    }},()=>join(root,kind));
    const context={current:{scene:1,text},preceding:[],following:[],earlierTimeReferences:[]};
    const check=()=> (intel as any).inspection.run({submissions:0,shouldStop:()=>false,progress:()=>{},comparisonSubjects:[],narrativeContext:context},
      ()=> (intel as any).complete('p',kind==='image'?'visual-overview':'visual-range','Inspect actual frames',JSON.stringify({narration:'luggage',mediaKind:kind}),['data:image/jpeg;base64,fixture']));
    for(let i=0;i<2;i++){const result=await check();assert.equal(result.status,'rejected');assert.match(documentaryScriptEvidenceIssue(documentaryScriptEvidence(result,text)!)!,/open lid/);assert.equal(result.nextSearchQueries[0],'open suitcase lifting');}
    assert.equal(calls,1,'A known completed refusal is not paid again');
    assert.equal(documentaryScriptEvidence(response,'Different narration'),undefined);
    assert.equal(documentaryScriptEvidence({...response,scriptEvidence:{...response.scriptEvidence,checks:[{...response.scriptEvidence.checks[0],scriptQuote:'invented garage'}]}},text),undefined);
  }}finally{await rm(root,{recursive:true,force:true});}
});

test('a final refusal triggers targeted discovery; accepting its result avoids later broad queries',async()=>{
  const searched:string[]=[];let feedback:string[]=[];
  const batches=discoverDocumentarySourceBatches({kind:'video',queries:['initial','unused broad'],youtubeQueries:['initial'],stockQueries:[],stopped:()=>false,
    takeRecoveryQueries:()=>{const queries=feedback;feedback=[];return queries;},
    discover:async query=>{searched.push(query);return [{id:query}] as DocumentaryCandidate[];}});
  assert.equal((await batches.next()).value?.[0]?.id,'initial');
  feedback=['open suitcase lifting'];
  assert.equal((await batches.next()).value?.[0]?.id,'open suitcase lifting');
  await batches.return();assert.deepEqual(searched,['initial','open suitcase lifting']);
});

test('metadata recovery retains short decisive words and favours the missing condition over generic background',()=>{
  const requirement={text:'A bus travels past a red cabin.',visualScope:'illustrative',illustrationQuery:'bus travelling road cabin',queries:['bus road cabin'],entities:[],years:[]};
  const pool=['bus road cabin landscape','road green cabin driving bus','road forest cabin bus','red cabins buses passing'].map((title,i)=>({
    id:String(i),title,description:'',kind:'video',provider:'pexels',rights:'licensed',width:1280,height:720,durationSeconds:20})) as DocumentaryCandidate[];
  assert.equal(documentaryThematicStockProbe(pool,requirement as any,['bus red cabin'])?.id,'3');
});

test('a wet traffic approval cannot omit the intersection or replace braking with static brake lights',()=>{
 const text='The car brakes on wet asphalt before an intersection.';
 const evidence={version:1 as const,scriptText:text,checks:[
  {kind:'object' as const,scriptQuote:'car',required:'car',match:true,evidence:'Visible car.'},
  {kind:'condition' as const,scriptQuote:'wet asphalt',required:'wet asphalt',match:true,evidence:'Visible wet road.'},
  {kind:'action' as const,scriptQuote:'brakes',required:'braking',match:true,evidence:'Brake lights are already lit.',temporalEvidence:{startState:'Car stopped with lit lamps.',endState:'Car stopped with lit lamps.',changed:true}}]};
 assert.match(documentaryScriptEvidenceIssue(evidence,true)!,/intersection/);
 evidence.checks.push({kind:'condition',scriptQuote:'before an intersection',required:'before intersection',match:true,evidence:'A road junction is visible.'} as any);
 assert.match(documentaryScriptEvidenceIssue(evidence,true)!,/изменение действия/);
 evidence.checks[2]!.temporalEvidence={startState:'Car approaches the junction.',endState:'Car stops before the junction.',changed:true,sameSubject:true,
  observations:[{seconds:.1,subject:'White hatchback',visible:true,state:'Approaching junction.'},{seconds:2,subject:'Red pickup',visible:true,state:'Red lights on.'},{seconds:4,subject:'White hatchback',visible:false,state:'Outside the frame.'}]} as any;
 assert.match(documentaryScriptEvidenceIssue(evidence,true,[.1,2,4])!,/один и тот же объект/);
 (evidence.checks[2]!.temporalEvidence as any).observations=[{seconds:.1,subject:'White hatchback',visible:true,state:'Approaching junction.'},{seconds:2,subject:'White hatchback',visible:true,state:'Slowing before junction.'},{seconds:4,subject:'White hatchback',visible:true,state:'Stopped before junction.'}];
 const frozen={version:1 as const,scriptText:text,checks:evidence.checks.map((check,index)=>({id:String(index),kind:check.kind,scriptQuote:check.scriptQuote,required:check.required})),nonVisual:[]};
 const locked={...evidence,checks:evidence.checks.map((check,index)=>({...check,requirementId:String(index)}))};
 assert.equal(documentaryScriptEvidenceIssue(locked,true,[.1,2,4],frozen),undefined);
});

test('a literal vertical relation cannot be approved using an explicitly lateral observation',()=>{
 const text='Cars beneath electronic signs.';
 const requirements={version:1 as const,scriptText:text,checks:[
  {id:'r1',kind:'object' as const,scriptQuote:'Cars',required:'cars'},
  {id:'r2',kind:'object' as const,scriptQuote:'electronic signs',required:'electronic signs'},
  {id:'r3',kind:'condition' as const,scriptQuote:'beneath',required:'passing underneath the signs'}],nonVisual:[]};
 const check=(observation:string)=>documentaryScriptEvidenceIssue({version:1,scriptText:text,checks:requirements.checks.map(item=>({
  requirementId:item.id,kind:item.kind,scriptQuote:item.scriptQuote,required:item.required,match:true,
  evidence:item.id==='r3'?observation:'Cars and electronic signs are clearly visible.'}))},false,undefined,requirements);
 for(const observation of ['Cars travel along the highway adjacent to and past the motorway sign installation.',
  'The cars are next to the sign.', 'Cars are not beneath the signs.'])assert.match(check(observation)!,/пространственному/);
 for(const observation of ['The cars pass beneath a gantry; trees stand beside the road.',
  'Overhead electronic signs span the lanes next to a bridge.', 'The cars pass below the signs.',
  'Cars are beside the median and underneath the sign.',
  'Cars pass beneath the gantry; a nearby pedestrian is not beneath it.',
  'A nearby pedestrian is not underneath it, while cars travel below the gantry.',
  'The arrangement is unclear.'])assert.equal(check(observation),undefined,
   'Only an explicit contradiction is rejected; this guard does not infer pixels or reject absent wording');
 const lateral={...requirements,scriptText:'Cars beside electronic signs.',checks:requirements.checks.map(item=>item.id==='r3'
  ?{...item,scriptQuote:'beside',required:'cars beside signs'}:item)};
 const lateralEvidence={version:1 as const,scriptText:lateral.scriptText,checks:lateral.checks.map(item=>({...item,requirementId:item.id,match:true,evidence:'Cars beside the sign.'}))};
 assert.equal(documentaryScriptEvidenceIssue(lateralEvidence,false,undefined,lateral),undefined);
 const upper={...requirements,scriptText:'Cars above electronic signs.',checks:requirements.checks.map(item=>item.id==='r3'
  ?{...item,scriptQuote:'above',required:'cars above signs'}:item)};
 const upperCheck=(observation:string)=>documentaryScriptEvidenceIssue({version:1,scriptText:upper.scriptText,checks:upper.checks.map(item=>({
  ...item,requirementId:item.id,match:true,evidence:item.id==='r3'?observation:'Cars and signs are visible.'}))},false,undefined,upper);
 assert.match(upperCheck('Cars are not above the signs.')!,/пространственному/);
 assert.equal(upperCheck('Cars are above the signs; a nearby pedestrian is not above them.'),undefined);
 const negative={...requirements,scriptText:'Cars not beneath electronic signs.',checks:requirements.checks.map(item=>item.id==='r3'
  ?{...item,scriptQuote:'not beneath',required:'cars not beneath signs'}:item)};
 const negativeEvidence={version:1 as const,scriptText:negative.scriptText,checks:negative.checks.map(item=>({...item,requirementId:item.id,match:true,evidence:'Cars are beside the signs, not beneath them.'}))};
 assert.equal(documentaryScriptEvidenceIssue(negativeEvidence,false,undefined,negative),undefined);
});
