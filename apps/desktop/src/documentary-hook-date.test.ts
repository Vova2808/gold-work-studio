import test from 'node:test';
import assert from 'node:assert/strict';
import type {Project} from '@gold-work/shared';
import {validateMontageDirections} from './documentary-semantic-montage.js';
import {planDocumentaryMontage} from './documentary-montage.js';

const date='November 22, 1869';
function project():Project{
  return {id:'hook-date',mediaMode:'stock',aspectRatio:'16:9',language:'en',
    settings:{voice:{enabled:true},music:{enabled:false},assembly:{kenBurns:true,documentary:{version:2,autoMotionGraphics:true,
      montage:{version:1,style:'editorial',intensity:'rich',graphicsDensity:'sparse',hookSeconds:30,musicPolicy:'preserve'}}}},
    scenes:[{id:'opening',order:0,narration:'On November 22, 1869, Cutty Sark slid into the water at Dumbarton, Scotland. ',
      durationSeconds:178/30,imagePath:'museum.jpg',audioPath:'existing.wav',
      documentary:{verified:true,layout:'full',effects:[],caption:{enabled:false,text:''},
        timing:{sourceKey:'voice',durationInFrames:178,speechSeconds:5.9},selected:{id:'museum',kind:'image',width:1440,height:1080},
        requirement:{text:'Cutty Sark launch',identities:[{name:'Cutty Sark'}],years:['1869'],accent:'none'}}}]} as unknown as Project;
}

function validate(p:Project,composition:unknown){
  return validateMontageDirections({scenes:[{sceneId:'opening',subject:'Cutty Sark',beat:'establish',treatment:'footage',cutawaySceneIds:[],composition}]},p.scenes,p.scenes,p)[0]!;
}

test('a single literal date card becomes a sparse-hook key-point without changing sources or narration',()=>{
  const p=project(),before=JSON.stringify(p);
  const direction=validate(p,{kind:'key-point',cards:[{label:date,sceneId:undefined}]});
  assert.equal(direction.composition?.kind,'key-point');assert.equal(direction.composition?.title,date);
  const input={...p,scenes:p.scenes.map(s=>({...s,documentary:{...s.documentary!,semanticMontage:direction}}))};
  const mounted=planDocumentaryMontage(input),graphic=mounted[0]!.documentary!.motionGraphic;
  assert.equal(graphic?.enabled,true);assert.equal(graphic?.title,date);assert.ok(graphic!.durationSeconds>=2);
  assert.deepEqual(mounted.map(s=>[s.narration,s.audioPath,s.imagePath,s.documentary!.selected,s.documentary!.timing]),
    p.scenes.map(s=>[s.narration,s.audioPath,s.imagePath,s.documentary!.selected,s.documentary!.timing]));
  assert.deepEqual(direction.cutawaySceneIds,[]);assert.equal(JSON.stringify(p),before);
});

test('date-card compatibility never promotes unsupported, ambiguous, source-bound or invalid explicit content',()=>{
  const p=project();
  for(const composition of [
    {kind:'key-point',cards:[{label:'November 23, 1869'}]},
    {kind:'key-point',cards:[{label:'Cutty Sark'}]},
    {kind:'key-point',cards:[{label:date},{label:date}]},
    {kind:'key-point',cards:[{label:date,sceneId:'another-source'}]},
    {kind:'key-point',cards:[{label:date,value:'another fact'}]},
    {kind:'key-point',title:'Not in narration',cards:[{label:date}]},
    {kind:'key-point',kicker:'Not in narration',cards:[{label:date}]},
    {kind:'key-point',value:'Not in narration',cards:[{label:date}]},
  ])assert.equal(validate(p,composition).composition,undefined,JSON.stringify(composition));
  assert.equal(validate(p,{kind:'key-point',title:date}).composition?.title,date,'existing explicit literal titles still work');
});
