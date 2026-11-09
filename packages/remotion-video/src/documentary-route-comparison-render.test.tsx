import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import type {DocumentaryRouteComparison} from '@gold-work/shared';
import {DocumentaryMotionGraphic} from './DocumentaryMotionGraphic.js';
const {renderToStaticMarkup}=createRequire(import.meta.url)('react-dom/server') as {renderToStaticMarkup:(node:import('react').ReactElement)=>string};

function comparisonFixture():DocumentaryRouteComparison {
  const place=(name:string,longitude:number,latitude:number)=>({name,longitude,latitude,quote:'fixture'});
  const start=place('A',-40,10),end=place('B',-20,10);
  const comparison:DocumentaryRouteComparison={version:1,origin:'generated-route-schematic',contextHash:'fixture',sceneNarration:'fixture',visualTarget:'fixture',title:'CANONICAL SOURCE TITLE',comparisonQuotes:['fixture'],model:'fixture',disclaimer:'Test schematic',routes:[
    {label:'a much shorter passage',quote:'fixture',places:[start,place('Suez Canal',-30,15),end],points:[start,place('Suez Canal',-30,15),end]},
    {label:'southern end of Africa',quote:'fixture',places:[start,place('Cape of Good Hope',-30,5),end],points:[start,place('Cape of Good Hope',-30,5),end]},
  ]};return comparison;
}

test('route maps render the normal edited Motion title and Motion0 holds both routes at every frame',()=>{
  const comparison=comparisonFixture();
  const graphic={kind:'map-route' as const,enabled:true,title:'EDITOR TITLE CHECK',startSeconds:0,durationSeconds:5,routeComparison:comparison};
  const render=(frame:number,motionEnabled:boolean)=>renderToStaticMarkup(<DocumentaryMotionGraphic graphic={graphic} frame={frame} frames={150} accent="#fff" textColor="#fff" motionEnabled={motionEnabled}/>);
  const first=render(0,false);
  assert.ok(first.includes('EDITOR TITLE CHECK'));assert.ok(!first.includes('CANONICAL SOURCE TITLE'));
  assert.equal(first,render(149,false),'Motion0 must retain a fully visible stable map');
  assert.notEqual(first,render(0,true));
  assert.ok(!first.includes('stroke-dashoffset'),'A comparison reveals whole paths without suggesting a voyage direction');
  assert.equal(comparison.title,'CANONICAL SOURCE TITLE','Editing a displayed header must not change geographic provenance');
});

test('automatic route headers and legends name the geographic alternatives without directed endpoints',()=>{
  const comparison=comparisonFixture(),before=JSON.stringify(comparison);
  const graphic={kind:'map-route' as const,origin:'automatic' as const,enabled:true,title:comparison.title,startSeconds:0,durationSeconds:5,routeComparison:comparison};
  const html=renderToStaticMarkup(<DocumentaryMotionGraphic graphic={graphic} frame={149} frames={150} accent="#fff" textColor="#fff"/>);
  assert.ok(html.includes('Suez Canal / Cape of Good Hope'));
  assert.ok(!html.includes(comparison.title));assert.ok(!html.includes('a much shorter passage'));
  assert.ok(html.includes('A · B'));assert.ok(!html.includes('→'));
  assert.equal(JSON.stringify(comparison),before,'Rendering must preserve every source quote, point and title');
});

test('a full manual header is retained even when it equals the canonical title',()=>{
  const comparison=comparisonFixture();
  const title='Compare the passage through the canal with the route around the cape, keeping every word of this complete manually edited title visible on the map without an unfinished ending.';
  comparison.title=title;
  const graphic={kind:'map-route' as const,origin:'manual' as const,enabled:true,title,startSeconds:0,durationSeconds:5,routeComparison:comparison};
  const html=renderToStaticMarkup(<DocumentaryMotionGraphic graphic={graphic} frame={149} frames={150} accent="#fff" textColor="#fff"/>);
  assert.ok(html.includes(title));assert.ok(!html.includes('Suez Canal / Cape of Good Hope'));
  assert.equal(comparison.title,title);
});
