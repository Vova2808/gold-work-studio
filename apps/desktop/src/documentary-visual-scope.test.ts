import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Project,Scene,DocumentaryRequirement,DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryIntelligence,documentaryMetadataShortlist} from './documentary-intelligence.js';
import {documentaryGeneralIllustration,documentaryVisualReviewContext} from './documentary-scene-context.js';
import {documentarySearchQueries,documentaryThematicStockProbe} from './documentary-project-service.js';
import {applyDocumentaryRequirement} from './documentary-visual-relevance.js';
import {documentaryContextApproval,documentarySavedContextIssue} from './documentary-context-approval.js';

test('only a grounded abstract slice becomes a thematic stock shot; exact and invalid decisions stay strict',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-visual-scope-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const lines=[
    'In 2004, Valentino Rossi rode for Yamaha.',
    'The pressure behind every corner kept rising.',
    'Valentino Rossi raced at Phillip Island.',
    'Its crankshaft turned inside the engine.',
    'A single mistake could change everything.',
    'Each lap was a gamble.',
  ];
  const scene=(narration:string,order:number):Scene=>({id:`s${order}`,order,narration,
    documentary:{verified:false,pinned:false,requirement:{text:narration,entities:['Valentino Rossi'],
      identities:[{name:'Valentino Rossi',aliases:['Rossi']}],identityContextVersion:3,
      years:order===0?['2004']:[],queries:['Valentino Rossi MotoGP race'],plannedBy:'semantic'}}} as unknown as Scene);
  const scenes=lines.map(scene);
  const project={id:'fixture-scope',scenes} as Project;
  let calls=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(_system,input)=>{
    calls++;
    const ids=(JSON.parse(input).scenes as Array<{id:string}>).map(item=>item.id);
    assert.deepEqual(ids,['s1','s4','s5']);
    return JSON.stringify({scenes:[
      {id:'s1',scope:'illustrative',quote:lines[1],query:'motorcycle racing corner onboard'},
      {id:'s4',scope:'illustrative',quote:'words absent from original',query:'motorcycle racing mistake'},
      {id:'s5',scope:'illustrative',quote:lines[5],query:'Valentino Rossi racing onboard'},
    ]});
  }},()=>root);
  const saved=new Map<string,DocumentaryRequirement>();
  await intelligence.resolveVisualScopes(project,scenes,async batch=>{for(const [id,value] of batch)saved.set(id,value);});
  assert.equal(calls,1);
  assert.equal(saved.get('s0')?.visualScope,'exact');
  assert.equal(saved.get('s2')?.visualScope,'exact');
  assert.equal(saved.get('s3')?.visualScope,'exact');
  assert.equal(saved.get('s4')?.visualScope,'exact');
  assert.equal(saved.get('s5')?.visualScope,'exact');
  const generic=saved.get('s1')!;
  assert.equal(generic.visualScope,'illustrative');
  assert.deepEqual(generic.identities,[]);
  assert.equal(generic.narrativeIdentities?.[0]?.name,'Valentino Rossi');
  assert.equal(documentarySearchQueries(generic,'video')[0],'motorcycle racing corner onboard');
  assert.equal(documentaryGeneralIllustration(applyDocumentaryRequirement(scenes[1]!,generic)),true);
  assert.deepEqual(documentaryVisualReviewContext(project,applyDocumentaryRequirement(scenes[1]!,generic)).preceding,[]);
  assert.ok(documentaryVisualReviewContext(project,scenes[2]!).preceding.length>0);
  assert.equal(documentaryGeneralIllustration({...applyDocumentaryRequirement(scenes[1]!,generic),narration:'Different words.'}),false);
});

test('a short thematic stock video found by a concise query reaches pixel review without a long metadata ranking',()=>{
  const requirement={text:'Racing shows how rider and machine work together.',visualScope:'illustrative',
    entities:[],identities:[],years:[],queries:['motorcycle racing rider skill versus machine performance']} as DocumentaryRequirement;
  const scene={narration:requirement.text,documentary:{requirement}} as Scene;
  const stock={id:'pexels:short',provider:'pexels',kind:'video',title:'Motorcycle racing on a track',
    description:'Camera follows racing bikes',query:'motorcycle racing rider',durationSeconds:12,rights:'allowed'} as unknown as DocumentaryCandidate;
  assert.deepEqual(documentaryMetadataShortlist(scene,[stock]),[stock]);
  assert.deepEqual(documentaryMetadataShortlist({...scene,documentary:{...scene.documentary!,requirement:{...requirement,visualScope:'exact'}}},[stock]),[]);
  const sparse={...stock,title:'Riders at sunset',width:1280,height:720};
  assert.deepEqual(documentaryMetadataShortlist(scene,[sparse]),[]);
  assert.equal(documentaryThematicStockProbe([sparse],requirement),sparse);
  assert.equal(documentaryThematicStockProbe([sparse],{...requirement,visualScope:'exact'}),undefined);
  assert.equal(documentaryThematicStockProbe([{...sparse,width:640}],requirement),undefined);
});

test('an explicit maker name keeps its inherited motorcycle model exact',async()=>{
  const narration="Honda's stated concept for the whole bike was ease of riding.";
  const requirement={text:narration,entities:['Honda RC211V'],identities:[{name:'Honda RC211V',aliases:['RC211V']}],
    identityContextVersion:3,years:[],queries:['Honda RC211V riding'],plannedBy:'semantic'} as DocumentaryRequirement;
  const scene={id:'honda',order:0,narration,documentary:{verified:false,pinned:false,requirement}} as Scene;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
    throw Error('Explicit subject must not need paid scope classification');
  }},()=>'.');
  let result:DocumentaryRequirement|undefined;
  await intelligence.resolveVisualScopes({id:'fixture-honda',scenes:[scene]} as Project,[scene],async batch=>{result=batch.get(scene.id);});
  assert.equal(result?.visualScope,'exact');
  assert.equal(result?.identities?.[0]?.name,'Honda RC211V');
});

test('changing an approved thematic visual target revokes only that saved approval',()=>{
  const requirement={text:'Racing became a test of skill.',entities:[],identities:[],years:[],
    queries:['motorcycle racing track'],visualScope:'illustrative',visualScopeQuote:'test of skill',
    illustrationQuery:'motorcycle racing track'} as DocumentaryRequirement;
  const scene={id:'approval',order:0,narration:requirement.text,imagePath:'frame.jpg',documentary:{verified:true,
    checksum:'pixels',selected:{id:'pexels:1',provider:'pexels',kind:'image',title:'Motorcycles racing',description:'Track'},requirement}} as unknown as Scene;
  const project={id:'approval',scenes:[scene]} as Project;
  const value={status:'accepted',narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,
    requiredEra:'none',observedEra:'modern',evidence:'Visible motorcycles race around a real track.'}};
  const approval=documentaryContextApproval(project,scene,value);
  assert.ok(approval);
  const saved={...scene,documentary:{...scene.documentary!,visualReview:{status:'accepted',contextApproval:approval}}} as Scene;
  assert.equal(documentarySavedContextIssue({...project,scenes:[saved]},saved),undefined);
  const changed={...saved,documentary:{...saved.documentary!,requirement:{...requirement,illustrationQuery:'motorcycle garage'}}};
  assert.match(documentarySavedContextIssue({...project,scenes:[changed]},changed)!,/изменился/);
});
