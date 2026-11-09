import test from 'node:test';
import assert from 'node:assert/strict';
import type {Project} from '@gold-work/shared';
import {documentaryEditErrors} from './documentary-validation.js';
import {missingAssemblyInputs} from './assembly-readiness.js';

test('final edit validation accepts selected authored media and still rejects an outside source',()=>{
  const project={mediaMode:'stock',aspectRatio:'16:9',settings:{assembly:{documentary:{version:2}}},scenes:[{
    id:'cells',order:0,narration:'Several cells form a module.',durationSeconds:6,imagePath:'cells.jpg',
    documentary:{verified:true,checksum:'cells',layout:'full',effects:[],caption:{enabled:false,text:''},
      selected:{id:'cells-photo',kind:'image',width:1920,height:1080},requirement:{text:'Several cells form a module.'},
      semanticMontage:{sceneId:'cells',subject:'cells',beat:'explain',treatment:'footage',cutawaySceneIds:[]},
      motionGraphic:{enabled:true,origin:'automatic',kind:'keypoint',startSeconds:0,durationSeconds:6,artwork:{
        version:1,motionCoordinates:'absolute',layout:'full',canvas:{width:1000,height:562},startSeconds:0,durationSeconds:6,
        palette:{background:'#101820',ink:'#ffffff',accent:'#ffc050',secondary:'#407090'},layers:[
          {id:'photo',kind:'media',x:0,y:0,w:1000,h:562,sourceSceneId:'cells',sourceVariant:'original'},
          {id:'label',kind:'text',x:60,y:450,w:550,h:60,text:'Several cells',fontSize:44,fill:'ink'},
          {id:'accent',kind:'rect',x:60,y:430,w:140,h:5,fill:'accent'}]}}}
  }]} as unknown as Project;
  assert.deepEqual(documentaryEditErrors(project),[]);
  const media=project.scenes[0]!.documentary!.motionGraphic!.artwork!.layers[0]!;
  media.sourceSceneId='not-selected';
  assert.ok(documentaryEditErrors(project).some(e=>e.includes('outside selected allowlist')));
  media.sourceSceneId='cells';project.scenes[0]!.documentary!.verified=false;
  assert.ok(documentaryEditErrors(project).some(e=>e.includes('outside selected allowlist')));
});

function explanationProject():Project {
  return {id:'explanation-readiness',mediaMode:'stock',aspectRatio:'16:9',settings:{
    assembly:{documentary:{version:2}},video:{enabled:false},voice:{enabled:false},
  },scenes:[{id:'rider',order:0,narration:'The rider compares a motorcycle and a machine.',durationSeconds:6,imagePath:'rider.jpg',
    documentary:{verified:true,pinned:true,checksum:'rider',layout:'full',effects:[],caption:{enabled:false,text:''},
      selected:{id:'rider-photo',kind:'image',width:1920,height:1080},requirement:{text:'The rider compares a motorcycle and a machine.'},
      motionGraphic:{enabled:true,origin:'automatic',kind:'keypoint',startSeconds:0,durationSeconds:6,explanation:{
        kind:'contrast',nodes:[{id:'rider',label:'rider',symbol:'person'},
          {id:'vehicle',label:'motorcycle',symbol:'motorcycle',objectType:'motorcycle'}],
      }}}}]} as unknown as Project;
}

const readinessChecks=[documentaryEditErrors,(project:Project)=>missingAssemblyInputs(project,[],()=>true)];

test('explicit motorcycle passes saved edits and assembly readiness without changing the project',()=>{
  const project=explanationProject(),before=structuredClone(project);
  for(const check of readinessChecks)assert.deepEqual(check(project),[]);
  assert.deepEqual(project,before);
});

test('legacy explanation symbols without objectType remain ready, including manual graphics',()=>{
  for(const symbol of ['person','team','machine','motorcycle','signal','energy','document','place','time','generic'] as const){
    const project=explanationProject(),graphic=project.scenes[0]!.documentary!.motionGraphic!;
    graphic.origin='manual';
    graphic.explanation!.nodes[1]={id:'legacy',label:'machine',symbol};
    for(const check of readinessChecks)assert.deepEqual(check(project),[],symbol);
  }
});

test('saved edits and assembly readiness reject malformed explanation nodes and metadata',()=>{
  type Explanation=NonNullable<NonNullable<Project['scenes'][number]['documentary']>['motionGraphic']>['explanation'];
  const cases:Array<[string,(value:NonNullable<Explanation>)=>void]>=[
    ['declared motorcycle with machine symbol',e=>{e.nodes[1]!.symbol='machine';}],
    ['declared motorcycle with person symbol',e=>{e.nodes[1]!.symbol='person';}],
    ['unknown declared type',e=>{Object.assign(e.nodes[1]!,{objectType:'car'});}],
    ['unknown symbol',e=>{Object.assign(e.nodes[1]!,{symbol:'car'});delete e.nodes[1]!.objectType;}],
    ['nonliteral label',e=>{e.nodes[1]!.label='invented vehicle';}],
    ['empty label',e=>{e.nodes[1]!.label='';}],
    ['label over 60 characters',e=>{e.nodes[1]!.label='rider '.repeat(11);}],
    ['duplicate labels',e=>{e.nodes[1]!.label='RIDER';}],
    ['duplicate IDs',e=>{e.nodes[1]!.id='rider';}],
    ['empty ID',e=>{e.nodes[1]!.id='';}],
    ['ID over 30 characters',e=>{e.nodes[1]!.id='x'.repeat(31);}],
    ['one node',e=>{e.nodes.pop();}],
    ['five nodes',e=>{e.nodes.push(e.nodes[0]!,e.nodes[0]!,e.nodes[0]!);}],
    ['exchange requires two nodes',e=>{e.kind='exchange';e.nodes.push({id:'third',label:'machine',symbol:'machine'});}],
    ['branch requires three nodes',e=>{e.kind='branch';}],
    ['merge requires three nodes',e=>{e.kind='merge';}],
    ['unknown kind',e=>{Object.assign(e,{kind:'invented'});}],
    ['nonliteral emphasis',e=>{e.emphasis='invented';}],
    ['unknown signal',e=>{Object.assign(e,{signal:'invented'});}],
  ];
  for(const [name,mutate] of cases){
    const project=explanationProject();mutate(project.scenes[0]!.documentary!.motionGraphic!.explanation!);
    for(const check of readinessChecks)assert.deepEqual(check(project),['сцена 1: проверьте узлы, подписи и тип объяснения'],name);
  }
});

test('saved explanation readiness retains manual timing and sequence continuity guards',()=>{
  const project=explanationProject(),graphic=project.scenes[0]!.documentary!.motionGraphic!;
  graphic.origin='manual';graphic.durationSeconds=7;
  for(const check of readinessChecks)assert.deepEqual(check(project),['сцена 1: motion-графика выходит за границы сцены']);
  graphic.durationSeconds=6;graphic.explanation!.sequence={id:'span',offsetFrames:1,durationInFrames:180};
  for(const check of readinessChecks)assert.deepEqual(check(project),['сцена 1: нарушена непрерывность объяснения между сценами']);
});
