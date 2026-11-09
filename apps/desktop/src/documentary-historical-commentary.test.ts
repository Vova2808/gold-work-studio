import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DocumentaryRequirement,Project,Scene} from '@gold-work/shared';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryHistoricalIllustration,documentarySceneContext,documentaryNarrativeEvidenceIssue} from './documentary-scene-context.js';
import {filterDocumentaryRankingEra} from './documentary-ranking-era.js';
import {documentaryScriptRequirements,documentaryScriptEvidence,documentaryScriptEvidenceIssue} from './documentary-script-evidence.js';
import {documentarySourceText,enforceDocumentaryTechnicalQuality} from './documentary-source-quality.js';
import {documentaryNamedDiscoveryQueries,documentaryNamedMetadataShortlist} from './documentary-named-search.js';

function fixture(text='В 1913 году Ford внедрил движущийся конвейер.') {
  const date='В 1913 году';
  const checks=[{id:'company',kind:'object' as const,scriptQuote:'Ford',required:'Ford factory'},
    {id:'line',kind:'object' as const,scriptQuote:'движущийся конвейер',required:'moving assembly line'}];
  const nonVisual=[{scriptQuote:date,reason:'Historical event date, not a demanded capture date'},
    {scriptQuote:text.includes('внедрил')?'внедрил':'ввёл',reason:'Introduction is historical commentary, not an action reenactment'}];
  const scriptRequirements={version:1 as const,scriptText:text,checks,nonVisual};
  const historicalIllustration={scriptQuote:text,eventYear:1913,startYear:1910,endYear:1920};
  const requirement:DocumentaryRequirement={text,entities:['Ford'],identities:[{name:'Ford',aliases:['Ford Motor Company']}],years:['1913'],queries:['Ford assembly line archive'],scriptRequirements,historicalIllustration};
  const scene={id:'s',order:0,narration:text,documentary:{requirement}} as Scene;
  const project={id:'p',language:'Russian',scenes:[scene],videoBrief:{readyScript:text}} as Project;
  return {scene,project,requirement,historicalIllustration,scriptRequirements};
}

test('native commentary plan retains company, event date and frozen objects without an extra planning stage',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-historical-plan-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let calls=0;
  const client={configured:async()=>true,documentaryCompletion:async(system:string,input:string)=>{
    calls++;assert.match(system,/historicalIllustration/);
    return JSON.stringify({scenes:JSON.parse(input).scenes.map((s:Scene)=>({id:s.id,...fixture(s.narration).requirement}))});
  }};
  const service=new DocumentaryIntelligence(client,()=>root);
  const f=fixture();const planned=(await service.plan(f.project,[f.scene])).get('s')!;
  assert.deepEqual(planned.historicalIllustration,f.historicalIllustration);
  assert.equal(planned.visualScope,'exact');assert.deepEqual(planned.years,['1913']);
  assert.equal(planned.scriptRequirements!.checks.some(c=>c.kind==='action'),false);
  await service.plan(f.project,[f.scene]);assert.equal(calls,1,'same saved plan costs no additional completion');
});

test('Russian short wording is commentary; explicit 1913 footage and frozen workers action are exact',()=>{
  for(const text of ['В 1913 году Ford внедрил движущийся конвейер.','В 1913 году Ford ввёл движущийся конвейер.']){
    const f=fixture(text);assert.ok(documentaryScriptRequirements(f.scriptRequirements,text));
    assert.ok(documentaryHistoricalIllustration(f.historicalIllustration,text,f.scriptRequirements,f.requirement.identities));
  }
  const f=fixture();
  for(const text of ['В 1913 году Ford внедрил движущийся конвейер. Нужна архивная съёмка 1913 года.',
    'Ford introduced the line in 1913. Show footage recorded in 1913.'])
    assert.equal(documentaryHistoricalIllustration({...f.historicalIllustration,scriptQuote:text},text,f.scriptRequirements,f.requirement.identities),undefined);
  assert.equal(documentaryHistoricalIllustration(f.historicalIllustration,f.scene.narration,{...f.scriptRequirements,
    checks:[...f.scriptRequirements.checks,{id:'literal',kind:'action',scriptQuote:'внедрил',required:'workers assembling cars in 1913'}]},f.requirement.identities),undefined);
  assert.equal(documentaryHistoricalIllustration({...f.historicalIllustration,startYear:1900,endYear:1930},f.scene.narration,f.scriptRequirements,f.requirement.identities),undefined);
});

test('malformed nonvisual quotations retain source-blind commentary classification through the existing repair',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-historical-repair-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const f=fixture();let calls=0;
  const service=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    calls++;const data=JSON.parse(input);
    if(calls===1)return JSON.stringify({scenes:[{id:'s',...f.requirement,years:[1913],
      scriptRequirements:{...f.scriptRequirements,nonVisual:[{scriptQuote:'В 1913 году ... внедрил',reason:'Event commentary'}]}}]});
    assert.deepEqual(data.scenes[0].historicalIllustration,f.historicalIllustration);
    return JSON.stringify({scenes:[{id:'s',scriptRequirements:f.scriptRequirements}]});
  }},()=>root);
  f.scene.documentary!.requirement=(await service.plan(f.project,[f.scene])).get('s')!;
  assert.equal(f.scene.documentary!.requirement.scriptRequirements,undefined,'do not accept the invalid quotation');
  assert.deepEqual(f.scene.documentary!.requirement.historicalIllustration,f.historicalIllustration);
  assert.deepEqual(f.scene.documentary!.requirement.years,['1913']);
  await service.resolveScriptRequirements(f.project,[f.scene],async plan=>{f.scene.documentary!.requirement=plan.get('s')!;});
  assert.deepEqual(documentarySceneContext(f.project,f.scene).historicalIllustration,f.historicalIllustration);
  assert.equal(calls,2,'only the existing deterministic-error repair is used');
});

test('an explicit capture-year request stays exact in either word order despite mistaken nonVisual classification',()=>{
  for(const request of ['Покажи снятую в 1913 году архивную видеосъёмку.',
    'Покажи архивную видеосъёмку, снятую в 1913 году.',
    'Нужна фотография 1913 года.','Покажи снимок, сделанный в 1913 году.',
    'Покажи архивные кадры 1913 года.',
    'Show 1913 archival footage.','Show archival footage recorded in 1913.',
    'Show1913 archival footage.','Show a 1913 photograph.']){
    const f=fixture();const text=f.scene.narration+' '+request;
    const requirements={...f.scriptRequirements,scriptText:text,
      nonVisual:[...f.scriptRequirements.nonVisual,{scriptQuote:request,reason:'Mistakenly classified as nonvisual'}]};
    assert.ok(documentaryScriptRequirements(requirements,text),'model payload is otherwise valid');
    assert.equal(documentaryHistoricalIllustration(f.historicalIllustration,text,requirements,f.requirement.identities),undefined,request);
    f.scene.narration=text;f.requirement.text=text;f.requirement.scriptRequirements=requirements;
    const context=documentarySceneContext(f.project,f.scene);
    assert.equal(context.historicalIllustration,undefined,request);
    assert.ok(documentaryNarrativeEvidenceIssue({narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,
      requiredEra:'1913',observedEra:'1919',eraEvidenceQuote:'1919',evidence:'Authentic Ford assembly line film recorded in 1919.'}},
    {title:'Ford assembly line (1919)'},context),'1919 must not pass an explicit 1913 capture request');
  }
  const f=fixture();assert.ok(documentarySceneContext(f.project,f.scene).historicalIllustration,'event commentary remains illustrative');
});

test('historical metadata ranking accepts true 1916 source dates without substituting late factories or upload dates',()=>{
  const f=fixture(),context=documentarySceneContext(f.project,f.scene);
  const candidates=[{id:'archive',title:'Ford factory film (1916)',description:'Archive film'},
    {id:'late',title:'Ford factory (1985)',description:'Modern assembly'},
    {id:'unknown',title:'Ford factory',description:'Historical archive, date unknown'}];
  const response={era:{years:['1913'],scriptQuote:'В 1913 году'},sourceQuotes:{archive:'1916',late:'1985',unknown:'1913'}};
  assert.deepEqual(filterDocumentaryRankingEra(response,context,candidates,candidates.map(c=>c.id)),['archive']);
  const exact={...context};delete exact.historicalIllustration;
  assert.deepEqual(filterDocumentaryRankingEra(response,exact,candidates,candidates.map(c=>c.id)),[]);
});

test('historical discovery preserves production queries ahead of the ambiguous brand and event year',()=>{
  const f=fixture();f.requirement.queries=['Ford assembly line historical photograph','Ford factory production archive'];
  assert.deepEqual(documentaryNamedDiscoveryQueries(f.requirement,['Ford 1913'],f.scene.narration).slice(0,2),f.requirement.queries);
  delete f.requirement.historicalIllustration;
  assert.match(documentaryNamedDiscoveryQueries(f.requirement,['Ford 1913'],f.scene.narration)[0]!,/1913$/,'literal dated discovery retains its year');
});

test('historic shortcut cannot spend the photo vote on an undated building ahead of actual period production',()=>{
  const f=fixture();
  const base={provider:'commons',kind:'image',rights:'public-domain',description:'',width:3916,height:2826};
  const candidates=[{...base,id:'building',title:'Ford Motor Company Long Beach Assembly Building'},
    {...base,id:'archive',title:'Ford assembly line - 1913.jpg',description:'Конвейерная линия Генри Форда (фото 1913 года).'},
    {...base,id:'late',title:'Ford assembly line 1985'}] as never;
  const result=documentaryNamedMetadataShortlist(candidates,f.requirement,f.scene.narration);
  assert.deepEqual(result.map(c=>c.id),['archive']);
});

test('pixel-era approval retains real date and cannot silently accept missing provenance or era none',()=>{
  const f=fixture(),context=documentarySceneContext(f.project,f.scene);
  const evidence={subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'1910–1920',observedEra:'1916',eraEvidenceQuote:'Ford factory film (1916)',evidence:'Authentic historical illustration of Ford production, captured in 1916.'};
  const source={title:'Ford factory film (1916)',description:'Archive film'};
  assert.equal(documentaryNarrativeEvidenceIssue({narrativeEvidence:evidence},source,context),undefined);
  for(const changed of [{observedEra:'1985'},{requiredEra:'none'},{requiredEra:'1913'},{eraEvidenceQuote:'1913'},{observedEra:'unknown'}])
    assert.ok(documentaryNarrativeEvidenceIssue({narrativeEvidence:{...evidence,...changed}},source,context));
  assert.ok(documentaryNarrativeEvidenceIssue({narrativeEvidence:evidence},{title:'Undated archive',date:'1916'},context));
});

test('retained actual Ford response: empty ancillary caption stays explicitly unknown, mandatory evidence remains strict',async()=>{
  // The old checkpoint retained the full parsed model payload, but overwrote
  // status/reason during validation. This is a replay of that retained payload,
  // not a claim that the original wire raw was preserved.
  const receipt=JSON.parse((await readFile(new URL('./fixtures/ford2020-empty-caption.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
  assert.deepEqual(receipt.result.sourceText,{kind:'caption',text:''});
  const payload={...receipt.result,status:'accepted'};
  const accepted=enforceDocumentaryTechnicalQuality(payload,true,false,false);
  assert.equal(accepted.status,'accepted');
  assert.equal(documentarySourceText(accepted)!.kind,'uncertain');
  assert.match(String(accepted.quality),/не подтверждены/);
  assert.equal(enforceDocumentaryTechnicalQuality(payload,true,false,true).status,'uncertain','explicit visible text requirement remains blocking');
  assert.equal(enforceDocumentaryTechnicalQuality({...payload,sourceText:{kind:'promotion',text:'Subscribe'}},true,false,false).status,'rejected');
  const requirements=receipt.requirements;
  const evidence=documentaryScriptEvidence(accepted,requirements.scriptText)!;
  assert.equal(documentaryScriptEvidenceIssue(evidence,true,receipt.result.sampleChecks.map((s:{seconds:number})=>s.seconds),requirements),undefined);
  assert.ok(documentaryScriptEvidenceIssue({...evidence,checks:evidence.checks.map(c=>({...c,match:false}))},true,[3.1,3.75,4.5,5.25,5.85],requirements));
  assert.equal(enforceDocumentaryTechnicalQuality({...payload,technicalQuality:undefined},true,false,false).status,'uncertain');
});
