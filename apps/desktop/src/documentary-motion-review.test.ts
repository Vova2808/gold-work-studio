import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Project,Scene} from '@gold-work/shared';
import {DocumentaryIntelligence,documentaryMotionEvidenceIssue,documentaryLegacyMotionRefusals} from './documentary-intelligence.js';
import {effectFfmpeg} from './effect-media.js';

test('a moving subject filmed by a tripod is live footage; zoomed photographs and malformed motion answers are not',()=>{
  const moving={motionType:'live-footage',confidence:.98,cameraMoves:false,subjectMoves:true,globalTransformOnly:false,
    subjectMotionEvidence:'The train advances relative to fixed rails and platform.',evidence:'The train moves while the camera stays fixed.'};
  assert.equal(documentaryMotionEvidenceIssue(moving),undefined);
  for(const invalid of [{...moving,subjectMoves:'false'},{...moving,confidence:'0.98'},{...moving,globalTransformOnly:true},
    {...moving,subjectMoves:false},{...moving,subjectMotionEvidence:13},{...moving,motionType:'static'},
    {...moving,motionType:'camera-motion'}])assert.ok(documentaryMotionEvidenceIssue(invalid));
  assert.equal(documentaryMotionEvidenceIssue({motionType:'camera-motion',confidence:.98,evidence:'Legacy physical motion.'},true),undefined);
  assert.match(documentaryMotionEvidenceIssue({motionType:'photo-animation',confidence:.98,evidence:'Only the complete image enlarges.'})!,/статичный/);
});

test('suspicious old archive video gets one source-blind motion verdict, reused on resume',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-motion-'));
  try{
    const videoPath=join(root,'still.mp4');
    await effectFfmpeg(['-y','-f','lavfi','-i','color=c=blue:s=640x360:r=30:d=3','-an','-c:v','libx264',videoPath]);
    const scene={id:'s',order:0,narration:'The first flight of Boeing 747 was in 1969.',videoPath,documentary:{verified:true,checksum:'still-fixture',
      requirement:{text:'The first flight of Boeing 747 was in 1969.',entities:['Boeing 747'],queries:['Boeing 747 1969 first flight'],identities:[{name:'Boeing 747',aliases:[]}],years:['1969']},
      visualReview:{sampleSeconds:[.2,1,2],contextApproval:{evidence:{requiredEra:'1969'}}}}} as unknown as Scene;
    const project={id:'p',scenes:[scene]} as Project;let calls=0;
    const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input)=>{
      calls++;assert.match(system,/motion/);assert.doesNotMatch(system+input,/Boeing|1969/);
      return JSON.stringify({motionType:'static',confidence:.99,evidence:'All samples retain the identical subject and background.'});
    }},()=>root);
    assert.match((await intelligence.savedMotionIssue(project,scene))!,/статичный/);
    assert.match((await intelligence.savedMotionIssue(project,scene))!,/статичный/);
    assert.equal(calls,1,'Completed paid motion verdict must not be repeated');
    assert.equal(await intelligence.savedMotionIssue(project,{...scene,documentary:{...scene.documentary!,verified:false}}),undefined);
    assert.equal(calls,1);
    const checks=[{id:'subject',kind:'object' as const,scriptQuote:'Boeing 747',required:'Boeing 747'},
      {id:'event',kind:'condition' as const,scriptQuote:'first flight',required:'first flight event'},
      {id:'era',kind:'condition' as const,scriptQuote:'1969',required:'1969'}];
    scene.documentary!.requirement.scriptRequirements={version:1,scriptText:scene.narration,checks,nonVisual:[]};
    const scriptEvidence={version:1,scriptText:scene.narration,checks:checks.map(check=>({...check,requirementId:check.id,match:true,evidence:'Prior mocked identity evidence; motion is independently unproven.'}))};
    (intelligence as any).inspect=async()=>({status:'accepted',confidence:.99,reason:'An old cached identity vote',annotations:[],scriptEvidence,
      sampleSeconds:[.2,1,2],checkedAt:'now',quality:'clear',contextApproval:{evidence:{requiredEra:'1969'}}});
    const resumed=await intelligence.inspectForSelection(project,scene);
    assert.equal(resumed.review.status,'rejected','A cached identity vote must not revive a rejected motion range');
    assert.equal(resumed.review.contextApproval,undefined);
    assert.equal(calls,1,'Motion evidence is already paid and must be reused at the final boundary');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('only a completed legacy motion refusal is reconsidered once; unknown and subject refusals stay protected',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-motion-policy-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const checksum='a'.repeat(64),scene={id:'s',documentary:{searchRecovery:{rejectedRanges:[{checksum,start:0,end:3}]}}} as unknown as Scene;
  const directory=join(root,'Documentary','s');await mkdir(directory,{recursive:true});
  const path=join(directory,checksum+'.review.json');
  const saved={review:{status:'rejected',reason:'Отрезок показывает статичный снимок или его приближение.',scriptEvidence:{checks:[{match:true}]}}};
  await writeFile(path,JSON.stringify(saved));assert.deepEqual([...await documentaryLegacyMotionRefusals(root,scene)],[checksum]);
  for(const protectedReceipt of [{...saved,motionPolicyVersion:2},{review:{...saved.review,status:'uncertain'}},
    {review:{...saved.review,reason:'Wrong train type'}},{review:{...saved.review,scriptEvidence:{checks:[{match:'true'}]}}}]){
    await writeFile(path,JSON.stringify(protectedReceipt));assert.equal((await documentaryLegacyMotionRefusals(root,scene)).size,0);
  }
});

test('legacy publisher overlays are checked once from source pixels without changing other saved shots',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-source-text-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const videoPath=join(root,'source.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','color=c=blue:s=640x360:r=30:d=3','-an','-c:v','libx264',videoPath]);
  const scene={id:'s',narration:'Cars drive along a road.',videoPath,trimStartSeconds:0,trimEndSeconds:3,documentary:{verified:true,checksum:'source-text-fixture',
    selected:{provider:'local',pageUrl:'https://www.youtube.com/watch?v=fixture'},requirement:{entities:[],identities:[],years:[]},
    visualReview:{sampleSeconds:[.1,1.5,2.85]}}} as unknown as Scene;
  const project={id:'p',scenes:[scene]} as Project;let calls=0;
  const intelligence=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input,images)=>{
    calls++;assert.match(system,/Please Subscribe/);assert.doesNotMatch(input,/Cars|fixture|youtube/);assert.equal(images?.length,3);
    return JSON.stringify({sourceText:{kind:'promotion',text:'Please Subscribe'}});
  }},()=>root);
  for(let pass=0;pass<2;pass++)assert.match((await intelligence.savedMotionIssue(project,scene))!,/Please Subscribe/);
  assert.equal(calls,1,'A completed source-text verdict is reused');
  assert.equal(scene.documentary!.verified,true,'Read-only inspection preserves the saved scene until selection applies its verdict');
  const check={id:'theme',kind:'object' as const,scriptQuote:scene.narration,required:'cars on road'};
  scene.documentary!.requirement.scriptRequirements={version:1,mode:'thematic',scriptText:scene.narration,checks:[check],nonVisual:[]};
  (intelligence as any).inspect=async()=>({status:'accepted',confidence:.99,reason:'Old cached camera approval',sampleSeconds:[.1,1.5,2.85],
    trimStartSeconds:0,trimEndSeconds:3,quality:'clear',checkedAt:'now',contextApproval:{evidence:{requiredEra:'none'}},
    scriptEvidence:{version:1,scriptText:scene.narration,checks:[{...check,requirementId:'theme',match:true,evidence:'Cars visible in old mocked proof.'}]}});
  const resumed=await intelligence.inspectForSelection(project,scene);assert.equal(resumed.review.status,'rejected');
  assert.match(resumed.review.reason,/Please Subscribe/);assert.equal(calls,1,'An old cached camera approval cannot revive a rejected publisher overlay');
  assert.equal(await intelligence.savedMotionIssue(project,{...scene,documentary:{...scene.documentary!,pinned:true}}),undefined);
  assert.equal(await intelligence.savedMotionIssue(project,{...scene,documentary:{...scene.documentary!,visualReview:{...scene.documentary!.visualReview!,sourceText:{version:1,kind:'none',text:''}}}}),undefined);
  assert.equal(calls,1);
});

test('a coarse cached approval without original-script evidence cannot approve a wet scene',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gws-condition-'));
  try{
    const videoPath=join(root,'dry.mp4');
    await effectFfmpeg(['-y','-f','lavfi','-i','color=c=gray:s=640x360:r=30:d=3','-an','-c:v','libx264',videoPath]);
    const scene={id:'s',order:0,narration:'A car brakes on wet asphalt before the intersection.',videoPath,documentary:{verified:true,
      requirement:{text:'A car brakes on wet asphalt before the intersection.',visualScope:'illustrative',entities:[],identities:[],years:[],queries:['car braking wet intersection']},
      visualReview:{sampleSeconds:[.2,1,2],contextApproval:{evidence:{requiredEra:'none'}}}}} as unknown as Scene;
    const project={id:'p',scenes:[scene]} as Project;let calls=0;
    const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>{
      calls++;assert.fail('The boundary does not launch a mandatory second condition analysis');
    }},()=>root);
    (intel as any).inspect=async()=>({status:'accepted',confidence:.95,reason:'Cars at an intersection',annotations:[],sampleSeconds:[.2,1,2],contextApproval:{evidence:{requiredEra:'none'}}});
    assert.equal((await intel.inspectForSelection(project,scene)).review.status,'uncertain');
    assert.equal(calls,0,'No mandatory second analysis');
  }finally{await rm(root,{recursive:true,force:true});}
});
