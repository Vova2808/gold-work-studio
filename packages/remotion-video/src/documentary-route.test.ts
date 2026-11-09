import test from 'node:test';
import assert from 'node:assert/strict';
import {documentaryRouteBounds,documentaryRouteGeometry,documentaryRouteLabels} from './documentary-route.js';

test('satellite route fits stops, reaches each waypoint and rejects unsupported geography',()=>{
  const places=[{name:'Paris',latitude:48.8566,longitude:2.3522},{name:'Lyon',latitude:45.764,longitude:4.8357},{name:'Marseille',latitude:43.2965,longitude:5.3698}];
  const bounds=documentaryRouteBounds(places),geometry=documentaryRouteGeometry(places,bounds,0);
  assert.ok(geometry.points.every(p=>p.x>200&&p.x<1720&&p.y>200&&p.y<880));
  for(const [index,arrival] of geometry.arrivals.entries()){
    const frame=documentaryRouteGeometry(places,bounds,arrival);
    assert.ok(Math.hypot(frame.marker.x-geometry.points[index]!.x,frame.marker.y-geometry.points[index]!.y)<.00001);
  }
  assert.throws(()=>documentaryRouteBounds([places[0]!,places[0]!]));
  assert.throws(()=>documentaryRouteBounds([{name:'A',latitude:10,longitude:-179},{name:'B',latitude:10,longitude:179}]));
});
test('eight close route stops have distinct readable labels inside the safe area',()=>{
  const places=Array.from({length:8},(_,i)=>({name:`Длинное название города ${i}`,latitude:45+i*.001,longitude:5+i*.001}));
  const geometry=documentaryRouteGeometry(places,documentaryRouteBounds(places),1);
  const labels=documentaryRouteLabels(geometry.points,places);
  labels.forEach((a,i)=>{
    assert.ok(a.x>=70&&a.x+a.width<=1850&&a.y>=145&&a.y+a.height<=900);
    for(const b of labels.slice(i+1))assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
  });
});
