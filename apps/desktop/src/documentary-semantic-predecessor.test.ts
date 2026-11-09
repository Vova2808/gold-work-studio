import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import type {Project} from '@gold-work/shared';
import {AnyModelClient} from './anymodel-client.js';
import {DocumentaryIntelligence} from './documentary-intelligence.js';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {createSemanticMontagePlan,enrichSemanticMontage,montageCutawaySources,semanticMontageHash} from './documentary-semantic-montage.js';
import {documentaryEditErrors} from './documentary-validation.js';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
function fixture():Project {
  const narration="His destination was Yamaha, a team that hadn't won a single race all year.";
  const p={id:'eligibility-review',mediaMode:'stock',aspectRatio:'16:9',language:'en',settings:{voice:{enabled:true},video:{enabled:true},music:{enabled:false},
    assembly:{documentary:{version:2,autoMotionGraphics:true,montage:{version:1,style:'editorial',intensity:'rich'}}}},
    scenes:[{id:'yamaha',order:0,narration,durationSeconds:128/30,imagePath:'poster.jpg',videoPath:'selected.mp4',audioPath:'voice.mp3',
      documentary:{verified:false,illustrative:true,layout:'full',effects:[],caption:{enabled:false,text:''},checksum:'selected-hash',
        requirement:{text:narration,identities:[{name:'Yamaha factory team'}],years:['2003'],detail:'Yamaha motorcycle'},
        selected:{id:'pexels:16605635',provider:'pexels',kind:'video',title:'motorcycle at Yamaha garage',rights:'pexels',localPath:'selected.mp4',width:1920,height:1080,durationSeconds:12},
        manualReview:{version:1,status:'pending',provider:'pexels',kind:'video',candidateId:'pexels:16605635',checksum:'selected-hash',mediaPath:'selected.mp4',narration,reason:'Approximate; manual review pending'},
        timing:{sourceKey:'voice',durationInFrames:128,speechSeconds:4.03669,audioPath:'voice.mp3'},
        semanticMontage:{sceneId:'yamaha',subject:'Yamaha',beat:'conflict',treatment:'footage',cutawaySceneIds:[]}}}]} as unknown as Project;
  const bad=structuredClone(p.scenes[0]!);bad.id='bad';bad.order=1;bad.imagePath='bad.jpg';bad.videoPath='bad.mp4';
  bad.documentary!.checksum='bad-checksum';bad.documentary!.selected={...bad.documentary!.selected!,id:'bad-source',title:'F1 car',localPath:'bad.mp4'};
  bad.documentary!.manualReview={...bad.documentary!.manualReview!,candidateId:'bad-source',checksum:'bad-checksum',mediaPath:'bad.mp4'};
  p.scenes.push(bad);return p;
}

test('before-generated uncertain receipts re-enter their exact old keys, complete reuses, and fresh authoring still excludes the donor',async t=>{
  const temp=await mkdtemp(join(tmpdir(),'semantic-predecessor-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const baselinePath=join(root,'work/release-roadmap-20261026/stage-5-source-eligibility-baseline/apps/desktop/src/documentary-semantic-montage.ts');
  const baselineBytes=await readFile(baselinePath);
  const manifest=JSON.parse(await readFile(join(root,'work/release-roadmap-20261026/stage-5-source-eligibility-manifest.json'),'utf8'));
  assert.equal(sha(baselineBytes),manifest.files.find((entry:{path:string})=>entry.path==='apps/desktop/src/documentary-semantic-montage.ts').before.sha256);
  // Execute the exact before module, rewriting import locations only. This is
  // independent request generation, not a copy of the new serializer logic.
  const baselineText=baselineBytes.toString().replace(/from '(@gold-work\/shared|\.\/[^']+)'/gu,(_all,name:string)=>{
    const target=name==='@gold-work/shared'?join(root,'packages/shared/dist/index.js'):join(root,'apps/desktop/src',name.slice(2).replace(/\.js$/u,'.ts'));
    return `from '${pathToFileURL(target).href}'`;
  });
  const modulePath=join(temp,'baseline-semantic.ts');await writeFile(modulePath,baselineText);
  const baseline=await import(pathToFileURL(modulePath).href) as typeof import('./documentary-semantic-montage.js');
  const p=fixture(),before=structuredClone(p),captureRoot=join(temp,'before-capture');
  assert.equal(baseline.montageCutawaySources(p.scenes[0]!,p.scenes).length,1);
  assert.equal(montageCutawaySources(p.scenes[0]!,p.scenes).length,0);
  let oldSystem='',oldInput='';
  await assert.rejects(baseline.createSemanticMontagePlan(p,captureRoot,async(system,input)=>{
    oldSystem=system;oldInput=input;throw Error('before request captured');
  },'offline'),/before request captured/u);
  const oldKey=documentaryCheckpointKey('semantic-montage',oldSystem,oldInput,[]),oldPayload=JSON.parse(oldInput);
  assert.equal(oldKey,'768430b9598a312eb1c07ba7e9f9adae4af24242c7f53f7cbbeca6e562de8349','same independent-review causal chain');
  assert.deepEqual(oldPayload.scenes.map((row:{allowedSources:string[]})=>row.allowedSources),[['s1'],['s0']]);
  const manifestName=semanticMontageHash(p)+'-batches.json';
  const batches=await readFile(join(captureRoot,'Documentary','Montage',manifestName));
  const completed={scenes:oldPayload.scenes.map((row:{sceneId:string;allowedSources:string[]})=>({sceneId:row.sceneId,subject:'Yamaha',beat:'conflict',treatment:'footage',cutawaySceneIds:row.allowedSources}))};
  const store={publicSettings:async()=>({configured:true,baseUrl:'https://anymodel.org/v1'}),apiKey:async()=>'offline-placeholder'} as never;
  for(const state of ['pending','partial','received','complete'] as const){
    await t.test(state,async()=>{
      const directory=join(temp,state),analysis=join(directory,'Documentary','Analysis'),montage=join(directory,'Documentary','Montage');
      await mkdir(analysis,{recursive:true});await mkdir(montage,{recursive:true});await writeFile(join(montage,manifestName),batches);
      const receiptPath=join(analysis,oldKey+'.json'),receipt=JSON.stringify({purpose:'semantic-montage',state,
        ...(state==='complete'?{result:completed}:state==='pending'?{}:{raw:'{"scenes":['})});
      await writeFile(receiptPath,receipt);let fakeDispatch=0;
      const intelligence=new DocumentaryIntelligence(new AnyModelClient(store,async()=>{
        fakeDispatch++;throw Error('unexpected fresh fake dispatch');
      }),()=>directory);
      if(state==='complete'){
        const plan=await intelligence.planSemanticMontage(p);
        assert.deepEqual(plan.scenes[0]!.cutawaySceneIds,[],'reused answer is constrained by new final authoring policy');
        const applied={...p,scenes:enrichSemanticMontage({...p,scenes:p.scenes.map(scene=>({...scene,documentary:{...scene.documentary!,semanticMontage:plan.scenes.find(row=>row.sceneId===scene.id)}}))})};
        assert.ok(documentaryEditErrors(applied).some(issue=>issue.includes('противоречит')));
        await intelligence.planSemanticMontage(p); // Saved completed plan also reuses without dispatch.
      }else await assert.rejects(intelligence.planSemanticMontage(p),/неизвест|не сохранён|повтор|незаверш/u);
      assert.equal(fakeDispatch,0,`${state} must enter the old receipt rather than submit a new key`);
      assert.equal(await readFile(receiptPath,'utf8'),receipt,'old receipt remains byte-identical');
      assert.deepEqual(await readdir(analysis),[oldKey+'.json'],'no new Analysis key was created');
    });
  }
  await t.test('fresh request',async()=>{
    let calls=0;
    await createSemanticMontagePlan(p,join(temp,'fresh'),async(system,input)=>{
      calls++;assert.match(system,/SOURCE ELIGIBILITY/u);const payload=JSON.parse(input);
      assert.deepEqual(payload.scenes.map((row:{allowedSources:string[]})=>row.allowedSources),[[],['s0']]);
      assert.ok(payload.sources.find((row:{id:string})=>row.id==='s1').footageIssue);
      return {scenes:payload.scenes.map((row:{sceneId:string})=>({sceneId:row.sceneId,beat:'evidence',treatment:'footage',cutawaySceneIds:[]}))};
    },'offline');assert.equal(calls,1);
  });
  assert.deepEqual(p,before,'input project, narration, audio paths and material statuses unchanged');
});
