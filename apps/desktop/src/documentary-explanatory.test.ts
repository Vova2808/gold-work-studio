import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryGeneralActionIssue} from './documentary-visual-relevance.js';
import type {Project,DocumentaryCandidate} from '@gold-work/shared';
type Call=(project:string,purpose:string,system:string,input:string,images:string[])=>Promise<Record<string,unknown>>;
test('explanatory inspection keeps an exact old pending/partial request blocked before provider submission',async()=>{
  for(const state of ['pending','partial'])for(const narrationContext of ['Это показывает развитие инженерии за десятилетия.','Старую и новую инфраструктуру полезно рассматривать рядом.']){
    const root=await mkdtemp(join(tmpdir(),'gws-explanatory-')),purpose='catalog-range-batch',system='Original batch review';
    const input=JSON.stringify({narrationContext,requiredIdentities:[{name:'Panama Canal'},{name:'Cocoli Locks'}]}),images=['same actual frame bytes'];
    const key=createHash('sha256').update(JSON.stringify([2,purpose,system,input,images])).digest('hex');
    await mkdir(join(root,'Documentary/Analysis'),{recursive:true});await writeFile(join(root,'Documentary/Analysis',key+'.json'),JSON.stringify({state,purpose,raw:state==='partial'?'incomplete':undefined}));
    let calls=0;const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{calls++;return '{}';}},()=>root);
    const inspect=()=> (Reflect.get(service,'complete') as Call).call(service,'project',purpose,system,input,images);
    await assert.rejects(inspect(),/неизвестный результат/);
    const context={submissions:0,shouldStop:()=>false,comparisonSubjects:[],identities:undefined,graphic:{enabled:true,kind:'map-route',route:[{name:'Colón',latitude:9.3,longitude:-79.9},{name:'Panama City',latitude:9,longitude:-79.5}]}};
    await assert.rejects(Reflect.get(service,'inspection').run(context,inspect),/неизвестный результат/);
    assert.equal(calls,0);
  }
});
test('engineering context is explanatory while gate motion keeps its strict operation requirement',async()=>{
  const sent:string[]=[];
  const root=await mkdtemp(join(tmpdir(),'gws-explanatory-policy-'));
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system)=>{sent.push(system);return '{"reviews":[]}';}},()=>root);
  const complete=(Reflect.get(service,'complete') as Call).bind(service);
  await complete('project','catalog-range-batch','Original',JSON.stringify({narration:'Развитие инженерии меняет масштаб канала.'}),['frames']);
  assert.match(sent[0]!,/not itself a physical action/);assert.match(sent[0]!,/EXACT required subject/);
  await complete('project','catalog-range-batch','Original',JSON.stringify({narration:'Инженерные механизмы закрывают ворота.'}),['other frames']);
  assert.equal(sent[1],'Original');
  assert.equal(documentaryGeneralActionIssue({narration:'Если показывать только крупные корабли и открывающиеся ворота, возникает иллюзия.'}),undefined);
  assert.ok(documentaryGeneralActionIssue({narration:'Ворота открываются, пропуская судно.'}));
});

test('map-aware ranking cannot bypass the previous short-ID pending request',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-map-ranking-'));let calls=0,savedSystem='',savedInput='';
  const scene={id:'scene',order:0,narration:'Маршрут от Колона к Панаме.',documentary:{requirement:{text:'Маршрут от Колона к Панаме.',entities:['Колон','Панама'],years:[],queries:[],identities:[{name:'Колон',aliases:['Colon']},{name:'Панама',aliases:['Panama City']}]}}};
  const project={id:'project',scenes:[scene]} as unknown as Project;
  const candidate={id:'one',provider:'commons',kind:'image',title:'Panama City skyline',description:'Real view',pageUrl:'https://example.test/one',downloadUrl:'https://example.test/one.jpg'} as DocumentaryCandidate;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input)=>{calls++;savedSystem=system;savedInput=input;return JSON.stringify({ids:[JSON.parse(input).candidates[0].id]});}},()=>root);
  await service.rankCandidates(project,project.scenes[0]!,[candidate]);
  const key=createHash('sha256').update(JSON.stringify([2,'candidate-relevance',savedSystem,savedInput,[]])).digest('hex');
  await writeFile(join(root,'Documentary/Analysis',key+'.json'),JSON.stringify({state:'pending',purpose:'candidate-relevance'}));
  project.scenes[0]!.documentary!.motionGraphic={enabled:true,kind:'map-route',title:'',startSeconds:0,durationSeconds:4,route:[{name:'Колон',latitude:9.3,longitude:-79.9},{name:'Панама',latitude:9,longitude:-79.5}]};
  await assert.rejects(service.rankCandidates(project,project.scenes[0]!,[candidate]),/неизвестный результат/);assert.equal(calls,1);
});
