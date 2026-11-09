import test from 'node:test';
import assert from 'node:assert/strict';
import type {Project} from '@gold-work/shared';
import {createSemanticMontagePlan,enrichSemanticMontage,semanticMontageHash} from './documentary-semantic-montage.js';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {artworkEnabled} from './documentary-artwork-plan.js';

function film():Project{
 const lines=['In 2003 the team won 29 of 32 races.','The documentary follows the riders.','The rider then joined another team.'];
 return {id:'sparse-regression',mediaMode:'stock',language:'en',aspectRatio:'16:9',
  settings:{voice:{enabled:false},music:{enabled:false,volume:0},assembly:{kenBurns:true,documentary:{version:2,autoMotionGraphics:true,
   montageDensity:'rich',montage:{version:1,style:'editorial',intensity:'rich',graphicsDensity:'sparse',hookSeconds:30}}}},
  scenes:lines.map((narration,order)=>({id:`s${order}`,order,narration,durationSeconds:8,imagePath:`source-${order}.jpg`,
   documentary:{verified:true,checksum:`file-${order}`,layout:'full',effects:[],caption:{enabled:false,text:''},
    timing:{sourceKey:`audio-${order}`,durationInFrames:240,speechSeconds:7.8},
    selected:{id:`source-${order}`,kind:'image',width:1920,height:1080},requirement:{text:narration,entities:[],identities:[],years:[],queries:[]},
    semanticMontage:{sceneId:`s${order}`,subject:'The team',beat:'evidence',treatment:'footage',cutawaySceneIds:[]}}}))} as unknown as Project;
}

test('sparse montage respects plain-footage direction despite dates, statistics and film mentions',()=>{
 const p=film(),before=structuredClone(p),scenes=enrichSemanticMontage(p);
 assert.ok(scenes.every(s=>!s.documentary?.motionGraphic?.enabled));
 assert.ok(scenes.every(s=>['full','contain'].includes(s.documentary!.template!)));
 assert.deepEqual(scenes.map(s=>[s.narration,s.audioPath,s.imagePath,s.durationSeconds]),p.scenes.map(s=>[s.narration,s.audioPath,s.imagePath,s.durationSeconds]));
 assert.deepEqual(p,before);
 assert.equal(artworkEnabled(p),true,'rare graphics must not disable Opus authoring');
});

test('sparse montage keeps an explicit useful comparison and a manual overlay',()=>{
 const p=film();
 p.scenes[0]!.documentary!.semanticMontage!.composition={kind:'statistic',title:'',value:'29 of 32',ratioGroups:undefined};
 const manual={kind:'key-point' as const,title:'My caption',enabled:true,origin:'manual' as const,startSeconds:0,durationSeconds:4};
 p.scenes[2]!.documentary!.motionGraphic=manual;
 const scenes=enrichSemanticMontage(p);
 assert.equal(scenes[0]!.documentary!.motionGraphic?.kind,'statistic');
 assert.deepEqual(scenes[2]!.documentary!.motionGraphic,manual);
});

test('an explicit density change invalidates the plan while absent legacy density stays stable',()=>{
 const p=film(),sparse=semanticMontageHash(p);
 delete p.settings.assembly.documentary!.montage!.graphicsDensity;
 const legacy=semanticMontageHash(p);
 assert.notEqual(sparse,legacy);
 assert.equal(semanticMontageHash(structuredClone(p)),legacy);
 p.settings.assembly.documentary!.montage!.graphicsDensity='rich';
 assert.notEqual(semanticMontageHash(p),sparse);
});

test('sparse opening direction keeps the hook active and resumes its previous pending request',async t=>{
 const p=film(),root=await mkdtemp(join(tmpdir(),'gws-sparse-hook-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 let system='',input='';
 await assert.rejects(createSemanticMontagePlan(p,root,async(s,i)=>{system=s;input=i;throw Error('capture');},'fixture'),/capture/);
 assert.match(system,/OPENING PRIORITY/u);
 assert.match(system,/independently of the opening editing rhythm/u);
 assert.match(system,/Preserve all narration and the existing voice timing/u);
 const previous=system.split('\nOPENING PRIORITY')[0]!.replace('This limits graphic density, independently of the opening editing rhythm.','This overrides the earlier dense-hook/coverage instructions.');
 const key=documentaryCheckpointKey('semantic-montage',previous,input,[]),dir=join(root,'Documentary','Analysis');
 await mkdir(dir,{recursive:true});
 const receipt=JSON.stringify({state:'pending',purpose:'semantic-montage'});
 await writeFile(join(dir,`${key}.json`),receipt);
 await assert.rejects(createSemanticMontagePlan(p,root,async(s,i)=>{
  assert.equal(s,previous);assert.equal(i,input);throw Error('existing pending request');
 },'fixture'),/existing pending request/);
 assert.equal(await readFile(join(dir,`${key}.json`),'utf8'),receipt);
});
