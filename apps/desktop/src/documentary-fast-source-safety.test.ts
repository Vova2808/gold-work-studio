import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {Project,Scene} from '@gold-work/shared';
import {documentaryAiPlanContext} from './documentary-ai-plan-state.js';
import {documentaryIllustrationApproval,documentarySavedContextIssue} from './documentary-context-approval.js';
import {fastDocumentaryIllustrationVerdict,fastDocumentarySpecificIssue,planFastDocumentaryScene} from './documentary-fast-plan.js';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(target='Valentino Rossi helmet or racing suit',years=['2002','2003']){
 const scene={id:'scene',order:0,narration:'Was it Rossi, or was it the Honda?',durationSeconds:6,videoPath:'source.mp4',trimStartSeconds:0,trimEndSeconds:6,
  documentary:{version:2,verified:true,pinned:false,checksum:'same-source',illustrative:true,layout:'full',effects:[],
   requirement:{text:'Was it Rossi, or was it the Honda?',entities:[],years:[],queries:[]},
   selected:{id:'source',provider:'youtube',kind:'video',title:'Valentino Rossi is watching Yamaha GP Philippines video!',description:'Stage event',width:1920,height:1080,durationSeconds:20},
   visualReview:{status:'accepted',confidence:0,quality:'',sampleSeconds:[.18,3,5.82],checkedAt:'now',
    viewDescription:'A large display screen shows footage of Valentino Rossi wearing a helmet and racing suit at a stage event.',
    reason:"Valentino Rossi's helmet and racing suit are clearly visible on the screen.",
    fastRelevance:{version:1,target,relevant:true,evidence:"Valentino Rossi's helmet and racing suit are clearly visible on the screen."}}}} as unknown as Scene;
 const project={id:'project',title:'Rossi',topic:'Honda and Yamaha',language:'en',aspectRatio:'16:9',scenes:[scene],videoBrief:{readyScript:scene.narration},settings:{stockVideoPercent:60,assembly:{documentary:{version:2}},voice:{enabled:true}}} as unknown as Project;
 const inputHash=hash({version:1,model:'fixture',context:documentaryAiPlanContext(project)});
 scene.documentary!.requirement.aiSearchPlan={version:1,inputHash:hash({inputHash,sceneId:scene.id}),model:'fixture',visualTarget:target,subject:'Valentino Rossi',years,visualScope:'illustrative',preferredKind:'video',imageQueries:[],videoQueries:['Valentino Rossi MotoGP'],fallbackVisualTarget:'MotoGP motorcycles on track',fallbackVideoQueries:['MotoGP motorcycle racing']};
 scene.documentary!.visualReview!.illustrationApproval=documentaryIllustrationApproval(project,scene);
 return {project,scene};
}
test('actual filmed event-screen description cannot pass fresh or saved automatic relevance',()=>{
 const {project,scene}=fixture(),review=scene.documentary!.visualReview!;
 assert.equal(fastDocumentaryIllustrationVerdict({description:review.viewDescription,target:review.fastRelevance!.target,relevant:true,evidence:review.reason},review.fastRelevance!.target).status,'rejected');
 assert.match(documentarySavedContextIssue(project,scene)??'',/экран/);
 scene.documentary!.pinned=true;assert.equal(documentarySavedContextIssue(project,scene),undefined,'Manual selection is preserved');
});
test('explicit screen subject and incidental monitor beside a direct subject remain allowed',()=>{
 const positive={relevant:true,description:'A large display screen shows racing footage at a stage event.',evidence:'A physical display and stage audience are visible.'};
 assert.equal(fastDocumentaryIllustrationVerdict({...positive,target:'stage presentation showing racing videos',filmedScreen:true},'stage presentation showing racing videos').status,'accepted');
 assert.equal(fastDocumentaryIllustrationVerdict({relevant:true,target:'motorcycle rider',description:'An actual rider stands beside a monitor showing racing footage.',evidence:'The real rider is directly filmed next to the monitor.'},'motorcycle rider').status,'accepted');
 assert.equal(fastDocumentaryIllustrationVerdict({relevant:true,target:'motorcycle rider',description:'A rider fills the screen.',evidence:'The motorcycle and rider are visible.'},'motorcycle rider').status,'accepted');
});
test('illustrative AI primary retains its explicit era and does not accept 2006 as 2003',()=>{
 const {project,scene}=fixture('Honda RC211V in pit or on track',['2003']);const plan=planFastDocumentaryScene(project,scene);
 assert.equal(plan.namedSubject,undefined);assert.deepEqual(plan.requiredYears,['2003']);
 const source={title:'GPValencia 2006 Classic (Nicky Hayden world champion)',description:''};
 assert.ok(fastDocumentarySpecificIssue(plan,{relevant:true},source));
 assert.ok(fastDocumentarySpecificIssue(plan,{specificEvidence:{eraMatch:true,eraEvidenceQuote:'GPValencia 2003'}},source));
 assert.equal(fastDocumentarySpecificIssue(plan,{specificEvidence:{eraMatch:true,eraEvidenceQuote:'Valencia 2003'}},{title:'GP Valencia 2003',description:''}),undefined);
 scene.documentary!.visualReview!.viewDescription='Riders and motorcycles on track.';
 scene.documentary!.visualReview!.reason='A Repsol Honda RC211V number 69 is visible.';
 scene.documentary!.selected!.title=source.title;scene.documentary!.selected!.description='';
 scene.documentary!.visualReview!.fastRelevance!.evidence=scene.documentary!.visualReview!.reason;
 scene.documentary!.visualReview!.illustrationApproval=documentaryIllustrationApproval(project,scene);
 assert.ok(documentarySavedContextIssue(project,scene),'Saved relevance must also enforce the requested era');
});
test('a different directly filmed host cannot stand in for the target on screen; a directly filmed named target is allowed',()=>{
 const target='Valentino Rossi helmet or racing suit';
 assert.equal(fastDocumentaryIllustrationVerdict({target,relevant:true,description:'An actual person stands beside a large display screen showing Valentino Rossi wearing a helmet.',evidence:'Valentino Rossi is visible only on the screen; the host stands beside it.'},target).status,'rejected');
 assert.equal(fastDocumentaryIllustrationVerdict({target,relevant:true,description:'Valentino Rossi wears a racing suit beside a large screen showing racing footage.',evidence:'Valentino Rossi is directly filmed in the foreground; the screen is incidental in the background.'},target).status,'accepted');
});
test('generic AI fallback has no inherited date while an explicitly dated fallback keeps its dates',()=>{
 for(const [target,expected] of [['MotoGP motorcycles on track',[]],['MotoGP motorcycle dominance 2002-2003',['2002','2003']]] as const){
  const {project,scene}=fixture();const ai=scene.documentary!.requirement.aiSearchPlan!;ai.fallbackVisualTarget=target;
  scene.documentary!.requirement.footageFallback={version:1,narration:scene.narration,target,queries:[...ai.fallbackVideoQueries],originalTarget:ai.visualTarget,reason:'Exact discovery failed'};
  const plan=planFastDocumentaryScene(project,scene);assert.equal(plan.namedSubject,undefined);assert.deepEqual(plan.requiredYears,expected);
  assert.equal(Boolean(fastDocumentarySpecificIssue(plan,{}, {title:'Race 2006',description:''})),expected.length>0);
 }
});
