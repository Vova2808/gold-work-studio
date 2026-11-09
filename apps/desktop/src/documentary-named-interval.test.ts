import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type DocumentaryCandidate} from '@gold-work/shared';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {effectFfmpeg} from './effect-media.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {DocumentaryAnalysisError} from './documentary-analysis-error.js';

test('a new short named interval has one strict pixel request; a subject switch and old unknown overview stay unapproved',async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-named-range-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const video=join(root,'moving.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=10','-t','8','-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p',video]);
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Camera',topic:'Canon EOS550D',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  const text='The Canon EOS550D is a camera.';
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:text};
  const scene=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:text,audioDurationSeconds:4}))[0]!;
  scene.videoPath=video;scene.documentary!.checksum=createHash('sha256').update(await readFile(video)).digest('hex');
  scene.documentary!.requirement={...scene.documentary!.requirement,text,entities:['Canon EOS550D'],identities:[{name:'Canon EOS550D',aliases:[]}],years:[],queries:['Canon EOS550D'],plannedBy:'semantic',identityContextVersion:3,visualScope:'exact',visualScopeVersion:3};
  scene.documentary!.requirement.scriptRequirements={version:1,scriptText:text,checks:[
    {id:'camera',kind:'object',scriptQuote:'Canon EOS550D is a camera',required:'Canon EOS550D camera'}],nonVisual:[]};
  scene.documentary!.selected={id:'commons:camera',provider:'commons',kind:'video',title:'Canon EOS550D',description:'Camera demonstration',localPath:video,width:1280,height:720,durationSeconds:8,rights:'licensed',pageUrl:'https://example.test/camera',downloadUrl:'https://example.test/camera.mp4',author:'Fixture',license:'CC BY',licenseUrl:'',attribution:'Fixture',retrievedAt:'now',query:'camera',match:'unverified',concerns:[]} satisfies DocumentaryCandidate;
  project.scenes=[scene];
  for(const switched of [false,true,'malformed']){
    let requests=0;
    const intel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input,images)=>{
      requests++;const data=JSON.parse(input);assert.equal(data.singleReview,true);assert.equal(images?.length,5);
      assert.deepEqual(data.originalScript.requirements,scene.documentary!.requirement.scriptRequirements);
      assert.match(system,/ONLY full review/);
      assert.equal(data.completedResponseRepair,undefined);
      const malformed=switched==='malformed';
      return JSON.stringify({status:malformed?'accept':'accepted',confidence:.95,reason:'Mock verdict, orchestration only',identityMatch:true,identifiedEntity:'Canon EOS550D',isCameraFootage:true,mediaType:malformed?'video':'camera',presentation:malformed?'full-screen':'clean',cameraEvidence:'Moving camera view',
        sourceText:{kind:'none',text:''},
        motion:{motionType:'live-footage',confidence:.98,cameraMoves:false,subjectMoves:true,globalTransformOnly:false,
          subjectMotionEvidence:'The subject moves relative to two fixed background features.',evidence:'Mock orchestration evidence only.'},
        scriptEvidence:{version:1,scriptText:text,checks:[{requirementId:'camera',kind:'object',scriptQuote:'Canon EOS550D is a camera',required:'Canon EOS550D camera',match:true,evidence:'The visible camera is identified by its model markings.'}]},
        startSeconds:data.startSeconds,endSeconds:data.endSeconds,narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'none',observedEra:'none',eraEvidenceQuote:'',evidence:'A camera illustrates the specified model'},
        technicalQuality:{detail:'clear',compression:'clean',pixelated:false,evidence:'Usable moving view',orientation:'upright',continuousShot:true},
        sampleChecks:data.sampleSeconds.map((seconds:number,index:number)=>({seconds,identityMatch:!(switched===true&&index===2),identifiedEntity:'Canon EOS550D',eraMatch:true,evidence:'Visible identified camera'}))});
    }},()=>join(root,String(switched)));
    const result=await intel.inspectForSelection(project,scene);
    assert.equal(requests,1,JSON.stringify(result.review));assert.equal(result.review.status,switched===false?'accepted':'uncertain',JSON.stringify(result.review));
    assert.equal((await intel.inspectForSelection(project,scene)).review.status,result.review.status);
    assert.equal(requests,1,'Accepted, switched-subject and malformed answers are reused without repair or supplemental requests');
  }
  const listed={...scene,narration:'The named people are listed: Curie, ',documentary:{...scene.documentary!,requirement:{...scene.documentary!.requirement,
    text:'The named people are listed: Curie, ',identities:[{name:'Marie Curie',aliases:[]},{name:'Albert Einstein',aliases:[]}],entities:['Marie Curie','Albert Einstein'],detail:undefined}}};
  const listProject={...project,scenes:[listed,{...scene,id:'following',order:1,narration:'Einstein and their work.'}]};
  const listIntel=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async(system,input)=>{
    const data=JSON.parse(input);assert.equal(data.listedNamedSubjects,true,'Complete sentence survives a mid-list editing cut');
    assert.match(system,/ONE of those listed subjects/);
    assert.deepEqual(data.requiredIdentities.map((row:{name:string})=>row.name),['Marie Curie','Albert Einstein']);
    return JSON.stringify({status:'uncertain',reason:'Unidentified test pattern',identityMatch:false});
  }},()=>join(root,'list'));
  assert.notEqual((await listIntel.inspectForSelection(listProject,listed)).review.status,'accepted');
  const pending=new DocumentaryIntelligence({configured:async()=>true,documentaryCompletion:async()=>assert.fail('No new paid request')},()=>join(root,'pending'));
  const original=(pending as any).complete.bind(pending);
  (pending as any).complete=(id:string,purpose:string,...args:unknown[])=>purpose==='visual-overview'
    ?Promise.reject(new DocumentaryAnalysisError('Old unknown paid overview','pending',purpose)):original(id,purpose,...args);
  await assert.rejects(pending.inspectForSelection(project,scene),/Old unknown paid overview/);
});
