import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Project,Scene} from '@gold-work/shared';
import {bindMontageComparisonCards,createSemanticMontagePlan,enrichSemanticMontage,montageCompositionSources,montageCutawaySources,validateMontageDirections} from './documentary-semantic-montage.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';

function source(id:string,identity:string,order=0):Scene {
  return {id,order,narration:'Alpha and Beta are two different approaches to the same problem.',durationSeconds:8,imagePath:`${id}.jpg`,
    documentary:{verified:true,checksum:`hash-${id}`,illustrative:false,layout:'full',caption:{enabled:false,text:''},
      selected:{id,kind:'image'},requirement:{text:'',identities:[{name:identity,aliases:[]}],years:[]},
      visualReview:{status:'accepted',identifiedEntity:identity},
      semanticMontage:{sceneId:id,subject:'Alpha and Beta',treatment:'footage',beat:'turn',cutawaySceneIds:[],
        composition:{kind:'explainer',title:'',boardLayout:'compare',cards:[{label:'Alpha'},{label:'Beta'}]}}}} as unknown as Scene;
}
function project(scenes:Scene[]):Project {
  return {id:'comparison-binding',mediaMode:'stock',aspectRatio:'16:9',language:'en',scenes,
    settings:{voice:{enabled:true},music:{enabled:false},assembly:{kenBurns:true,documentary:{version:2,autoMotionGraphics:true,
      montage:{version:1,style:'editorial',intensity:'rich',hookSeconds:16,musicPolicy:'preserve'}}}}} as unknown as Project;
}

test('comparison binds accepted identities and aliases independent of source order; ambiguity needs explicit references',()=>{
  const a=source('a','Alpha'),b=source('b','Beta'),current=source('current','Unrelated');
  a.documentary!.requirement.identities![0]!.aliases=['A'];
  const cards=[{label:'A'},{label:'the Beta'}];
  const expected=[{label:'A',sceneId:'a'},{label:'the Beta',sceneId:'b'}];
  assert.deepEqual(bindMontageComparisonCards(cards,current,[current,b,a]).cards,expected);
  assert.deepEqual(bindMontageComparisonCards(cards,current,[a,b,current]).cards,expected);
  const duplicate=source('another-alpha','Alpha');duplicate.documentary!.requirement.identities![0]!.aliases=['A'];
  assert.equal(bindMontageComparisonCards(cards,current,[a,b,duplicate]).showSource,false);
  assert.deepEqual(bindMontageComparisonCards([{label:'A',sceneId:'a'},{label:'the Beta',sceneId:'b'}],current,[a,b,duplicate]).cards,expected);
});

test('metadata, requested identities and an unresolved side cannot produce a half-labelled image comparison',()=>{
  const a=source('a','Alpha'),b=source('b','Beta'),current=source('current','Unrelated');
  b.documentary!.visualReview!.identifiedEntity=undefined;
  b.documentary!.visualReview!.viewDescription='Unidentified object';
  b.documentary!.selected!.title='Beta';
  const cards=[{label:'Alpha',sceneId:'a'},{label:'Beta',sceneId:'b'}];
  const before=JSON.stringify([a,b,current,cards]);
  assert.deepEqual(bindMontageComparisonCards(cards,current,[a,b,current]),{cards:[{label:'Alpha'},{label:'Beta'}],showSource:false});
  assert.equal(JSON.stringify([a,b,current,cards]),before);
  b.documentary!.visualReview!.fastRelevance={version:1,target:'Beta',relevant:true,evidence:'Reviewed',
    specificEvidence:{subject:'Beta',identityMatch:true,eraMatch:true,actionMatch:true,evidence:'Reviewed identity'}};
  assert.equal(bindMontageComparisonCards(cards,current,[a,b,current]).showSource,undefined);
  b.documentary!.visualReview!.status='rejected';
  assert.equal(bindMontageComparisonCards(cards,current,[a,b,current]).showSource,false);
});

test('final automatic composition explicitly hides an unrelated source when comparison has no accepted identities',()=>{
  const current=source('current','Unrelated');
  const result=enrichSemanticMontage(project([current]))[0]!.documentary!.motionGraphic!;
  assert.equal(result.boardLayout,'compare');assert.equal(result.showSource,false);
  assert.deepEqual(result.cards?.map(card=>card.sceneId),[undefined,undefined]);
});

test('authored source references bind boolean fast-review observations through validation and enrichment, without guessing or changing manual graphics',()=>{
  const rider=source('scene-3','Valentino Rossi'),bike=source('scene-11','Honda'),current=source('scene-5','Unrelated');
  current.narration='Was it Rossi or the Honda that made the difference?';
  const cards=[{label:'Rossi',sceneId:rider.id},{label:'the Honda',sceneId:bike.id}];
  const descriptions=[
    'Valentino Rossi kissing a first-place trophy on a podium while wearing his Repsol Honda racing suit and cap.',
    "Valentino Rossi's 2002 Repsol Honda RC211V race motorcycle with number 46 against a white background.",
  ];
  for(const [index,scene] of [rider,bike].entries()){
    Reflect.deleteProperty(scene.documentary!,'verified'); // Legacy stored fast-review shape.
    scene.documentary!.visualReview={status:'accepted',confidence:0,reason:'Visible subject',quality:'',viewDescription:descriptions[index]!,
      fastRelevance:{version:1,target:scene.documentary!.requirement.identities![0]!.name,relevant:true,evidence:'Visible subject'},
      checkedAt:'2026-10-23',sampleSeconds:[0]};
  }
  const scenes=[current,bike,rider],p=project(scenes);
  const raw={scenes:[{sceneId:current.id,subject:'Rossi',treatment:'footage',beat:'turn',cutawaySceneIds:[],
    composition:{kind:'explainer',title:'',boardLayout:'compare',cards}}]};
  const apply=()=>{
    current.documentary!.semanticMontage=validateMontageDirections(raw,[current],scenes,p)[0];
    return enrichSemanticMontage(p)[0]!.documentary!.motionGraphic!;
  };
  const result=apply();
  assert.deepEqual(result.cards?.map(card=>card.sceneId),[rider.id,bike.id]);
  assert.notEqual(result.showSource,false);
  assert.equal(bindMontageComparisonCards(cards,current,scenes).showSource,false,'a local reference is not an AI-authored assignment');
  assert.equal(bindMontageComparisonCards(cards.map(({label})=>({label})),current,scenes,cards).showSource,false,'no inference from owner names in descriptions');
  assert.equal(bindMontageComparisonCards([{label:'Champion',sceneId:rider.id},cards[1]!],current,scenes,[{label:'Champion',sceneId:rider.id},cards[1]!]).showSource,false,'displayed label must be literal narration');
  const review=bike.documentary!.visualReview!;
  bike.documentary!.visualReview=undefined;
  assert.equal(apply().showSource,false,'both sides need accepted observations');
  bike.documentary!.visualReview={...review,viewDescription:undefined};
  assert.equal(apply().showSource,false,'reason or search metadata cannot stand in for own observation');
  const manual={kind:'explainer' as const,boardLayout:'compare' as const,title:'Manual',cards,origin:'manual' as const,enabled:true,startSeconds:0,durationSeconds:5};
  current.documentary!.motionGraphic=manual;
  assert.deepEqual(enrichSemanticMontage(p)[0]!.documentary!.motionGraphic,manual);
});

test('automatic throttle fragment ending in did not contraction returns to footage; manual copy is preserved',()=>{
  const scene=source('fragment','Unrelated');
  const title="what the rider requested through the throttle didn't";
  scene.narration=`The problem was that ${title} always match what arrived at the rear tyre, especially when grip was low.`;
  scene.documentary!.semanticMontage={sceneId:scene.id,subject:'throttle',treatment:'footage',beat:'explain',emphasis:title,cutawaySceneIds:[],
    composition:{kind:'key-point',title}};
  assert.equal(enrichSemanticMontage(project([scene]))[0]!.documentary!.motionGraphic,undefined);
  scene.documentary!.motionGraphic={kind:'key-point',title,origin:'manual',enabled:true,startSeconds:0,durationSeconds:5};
  assert.equal(enrichSemanticMontage(project([scene]))[0]!.documentary!.motionGraphic!.title,title);
});

test('normal planner exposes observed comparison sources beyond four cutaways and re-enters the exact prior payload receipt',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-comparison-catalog-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const scenes=Array.from({length:11},(_,order)=>source(`scene-${order+1}`,'Valentino Rossi Honda RC211V',order));
  const current=scenes[4]!,rider=scenes[2]!,bike=scenes[10]!;
  current.narration='Was it Rossi or the Honda that made the difference?';
  for(const scene of scenes)scene.documentary!.requirement.years=['2002','2003'];
  for(const [scene,description] of [[rider,'Valentino Rossi kissing a trophy on a podium.'],[bike,"Valentino Rossi's 2002 Repsol Honda RC211V race motorcycle against a white background."]] as const){
    scene.documentary!.visualReview={status:'accepted',confidence:0,reason:'Visible subject',quality:'',viewDescription:description,
      fastRelevance:{version:1,target:'Rossi Honda',relevant:true,evidence:'Visible subject'},checkedAt:'2026-10-23',sampleSeconds:[0]};
  }
  const unrelated=source('unrelated','Engine',12);unrelated.documentary!.visualReview={...bike.documentary!.visualReview!,viewDescription:'An engine.'};
  const wrongEra=source('wrong-era','Honda',13);wrongEra.documentary!.visualReview={...bike.documentary!.visualReview!};wrongEra.documentary!.requirement.years=['2009'];
  const p=project([...scenes,unrelated,wrongEra]);
  assert.equal(montageCutawaySources(current,p.scenes).length,4);
  assert.ok(!montageCutawaySources(current,p.scenes).includes(bike));
  assert.deepEqual(montageCompositionSources(current,p.scenes).map(scene=>scene.id),[rider.id,bike.id]);
  let system='',input='';
  const plan=await createSemanticMontagePlan(p,join(root,'normal'),async(s,i)=>{
    const payload=JSON.parse(i),target=payload.scenes.find((row:{sceneId:string})=>row.sceneId==='s4');
    if(target){
      system=s;input=i;
      assert.deepEqual(target.compositionSources,['s2','s10']);
      assert.ok(!target.allowedSources.includes('s10'));
      assert.ok(payload.sources.some((row:{id:string;observed:string})=>row.id==='s10'&&row.observed.includes('race motorcycle')));
    }
    return {scenes:payload.scenes.map((row:{sceneId:string})=>({sceneId:row.sceneId,subject:'',beat:'turn',treatment:'footage',cutawaySceneIds:[],
      ...(row.sceneId==='s4'?{composition:{kind:'explainer',title:'',boardLayout:'compare',cards:[{label:'Rossi',sceneId:'s2'},{label:'the Honda',sceneId:'s10'}]}}:{})}))};
  },'fixture');
  assert.deepEqual(plan.scenes.find(row=>row.sceneId===current.id)!.composition!.cards!.map(card=>card.sceneId),[rider.id,bike.id]);
  assert.match(system,/Never broaden cutawaySceneIds using compositionSources/);

  // A pending request uses the complete current catalog contract verbatim.
  // Historical prompt strings are retained independently by the planner.
  const priorInput=input,priorSystem=system;
  const directory=join(root,'prior','Documentary','Analysis');await mkdir(directory,{recursive:true});
  const receiptPath=join(directory,`${documentaryCheckpointKey('semantic-montage',priorSystem,priorInput,[])}.json`);
  const receipt=JSON.stringify({state:'pending',purpose:'semantic-montage'});await writeFile(receiptPath,receipt);
  await assert.rejects(createSemanticMontagePlan(p,join(root,'prior'),async(s,i)=>{
    assert.equal(s,priorSystem);assert.equal(i,priorInput);throw Error('prior receipt boundary');
  },'fixture'),/prior receipt boundary/);
  assert.equal(await readFile(receiptPath,'utf8'),receipt);
});
