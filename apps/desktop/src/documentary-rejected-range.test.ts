import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MemoryProjectRepository,MockDirectorProvider,ProjectService} from '@gold-work/core';
import {createVoiceCalibration,type DocumentaryCandidate} from '@gold-work/shared';
import {DocumentaryProjectService} from './documentary-project-service.js';
import {DocumentarySearch} from './documentary-search.js';
import {LocalProjectStorage} from './local-project-storage.js';
import {prepareDocumentaryScript} from './documentary-plan.js';
import {effectFfmpeg} from './effect-media.js';

for(const failure of ['action','cut'] as const)test(`${failure} refusal tries a new interval instead of replaying the cached bad excerpt, within three attempts`,async t=>{
  const root=await mkdtemp(join(tmpdir(),'gws-rejected-range-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'fixture.mp4');
  await effectFfmpeg(['-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=5','-t','35','-c:v','libx264','-preset','ultrafast','-threads','1',file]);
  const projects=new ProjectService(new MemoryProjectRepository(),new MockDirectorProvider());
  let project=await projects.create({title:'Range orchestration fixture',topic:'Worker',mediaMode:'stock',mode:'standard',language:'en',aspectRatio:'16:9'});
  const text='A worker raises a hand beside an open door.';
  project.videoBrief={...project.videoBrief!,creationMode:'script',readyScript:text};
  const scene=prepareDocumentaryScript(project,createVoiceCalibration({provider:'elevenlabs',voice:'fixture',language:'en',sampleText:text,audioDurationSeconds:4}))[0]!;
  scene.audioPath=join(root,'existing-voice.mp3');
  scene.documentary!.requirement={...scene.documentary!.requirement,text,entities:[],identities:[],years:[],queries:['worker raises hand'],preferredKind:'video',plannedBy:'semantic',identityContextVersion:3,
    visualScope:'illustrative',visualScopeVersion:3,visualScopeQuote:text,illustrationQuery:'worker raises hand'};
  scene.documentary!.searchRecovery={reason:'An earlier excerpt did not show the hand being raised.',queries:['worker raises hand'],rejectedRanges:[],
    scriptEvidence:{version:1,scriptText:text,checks:[{kind:'action',scriptQuote:'raises a hand',required:'raises hand',match:false,evidence:'No hand being raised in that excerpt.'}]}};
  project=await projects.update(project.id,{scenes:[scene],settings:{...project.settings,stockVideoPercent:100}});
  const candidate={id:'pexels:worker',provider:'pexels',kind:'video',title:'worker raises hand',description:'Synthetic test pattern: orchestration evidence only',query:'worker raises hand',
    width:1280,height:720,durationSeconds:35,rights:'licensed',pageUrl:'https://example.test/worker',downloadUrl:'https://example.test/worker.mp4',author:'Fixture',license:'Fixture',licenseUrl:'',attribution:'Fixture',retrievedAt:'now',match:'exact-metadata',concerns:[]} as DocumentaryCandidate;
  const searcher=new DocumentarySearch();searcher.search=async()=>({candidates:[candidate],sources:[]});
  const transfers:Array<{start:number;end:number}>=[],checks:number[]=[];let recoveryRankings=0;
  const service=new DocumentaryProjectService(projects,new LocalProjectStorage(join(root,'projects')),searcher,join(root,'Materials'),{
    download:async()=>assert.fail('The automatic range test must not download the full original'),
    downloadRangeToFile:async(_asset,destination,range)=>{
      transfers.push(range);await effectFfmpeg(['-y','-ss',String(range.start),'-i',file,'-t',String(range.end-range.start),'-c:v','libx264','-preset','ultrafast','-threads','1',destination+'.mp4']);
      const {rename,stat}=await import('node:fs/promises');await rename(destination+'.mp4',destination);return {bytes:(await stat(destination)).size,downloadedBytes:1};
    }},()=>{}, {available:async()=>true,plan:async(_project,scenes)=>new Map(scenes.map(scene=>[scene.id,scene.documentary!.requirement])),
      rankCandidates:async(_project,current,pool)=>{recoveryRankings++;assert.ok(current.documentary?.searchRecovery?.scriptEvidence);return pool;},
      inspect:async(_project,current)=>{
        checks.push(current.documentary!.selected!.excerpt!.startSeconds);const accepted=checks.length===2;
        return {status:accepted?'accepted':'rejected',rangeIssue:!accepted&&failure==='cut'?'cut':undefined,
          confidence:.99,reason:'Mock interval vote; no semantic or live-provider claim',checkedAt:'now',quality:'fixture',sampleSeconds:[.1,2,3.9],trimStartSeconds:0,trimEndSeconds:4,
          scriptEvidence:{version:1,scriptText:text,checks:[
            {kind:'object',scriptQuote:'worker',required:'worker',match:true,evidence:'Mock visible worker.'},
            {kind:'condition',scriptQuote:'beside an open door',required:'beside open door',match:true,evidence:'Mock visible open door.'},
            ...(failure==='action'?[{kind:'action' as const,scriptQuote:'raises a hand',required:'raises hand',match:accepted,evidence:'Mock action evidence.',temporalEvidence:{startState:'Hand down.',endState:accepted?'Hand raised.':'Hand down.',changed:accepted}}]:[])]}};
      }});
  const result=await service.autoSelect(project.id);
  assert.equal(result.selected,1,JSON.stringify(result.failures));assert.equal(checks.length,2);assert.equal(transfers.length,2);
  assert.ok(recoveryRankings>0,'An exact title cannot bypass recovery ranking after a real action refusal');
  assert.notEqual(checks[0],checks[1],'A cached rejected excerpt is not new evidence');
  assert.equal(result.project.scenes[0]!.audioPath,scene.audioPath);
});
