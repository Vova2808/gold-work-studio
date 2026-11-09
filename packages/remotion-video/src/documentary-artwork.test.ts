import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {createElement, type ReactNode} from 'react';
import type {DocumentaryArtwork as Artwork, DocumentaryArtworkLayer} from '@gold-work/shared';
import {artworkCameraState, artworkLayerState, artworkTrajectoryFit, DocumentaryArtwork} from './DocumentaryArtwork.js';
import {artworkMediaFraming,artworkViewportGeometry} from './documentary-artwork-media.js';
import {sliderCrankPose} from './documentary-linked-mechanism.js';

const {renderToStaticMarkup} = createRequire(import.meta.url)('react-dom/server') as {renderToStaticMarkup: (node: ReactNode) => string};
test('prepared source viewports keep authored geometry, transparent foreground and a literal original detail window',()=>{
  const art:Artwork={version:1,intent:'Visible original and detail',layout:'full',canvas:{width:1000,height:600},startSeconds:0,durationSeconds:4,
    palette:{background:'#eeeeee',ink:'#222222',accent:'#aa4433',secondary:'#336677'},layers:[
      {id:'original',kind:'media',sourceSceneId:'current',x:0,y:0,w:620,h:580},
      {id:'foreground',kind:'media',sourceSceneId:'peer',sourceVariant:'foreground',x:650,y:20,w:330,h:350,
        keyframes:[{t:0,x:0},{t:1,x:20}]},
      {id:'detail',kind:'media',sourceSceneId:'current',sourceWindow:{x:.25,y:.2,w:.5,h:.4},clip:'ellipse',x:660,y:400,w:280,h:160}]};
  const materials={original:{material:createElement('img',{'data-selected-source':'original',src:'/original.png'}),sourceAspect:2,actualVariant:'original' as const},
    foreground:{material:createElement('img',{'data-selected-source':'foreground',src:'/real-alpha.png'}),sourceAspect:.5,actualVariant:'foreground' as const},
    detail:{material:createElement('img',{'data-selected-source':'detail',src:'/original.png'}),sourceAspect:2,actualVariant:'original' as const}};
  const snapshot=(frame:number,moving=true)=>renderToStaticMarkup(createElement(DocumentaryArtwork,{artwork:art,frame,frames:120,width:1920,height:1080,moving,
    material:createElement('div',{'data-unprepared-fallback':'wrong source'}),materials}));
  const html=snapshot(60);
  assert.equal((html.match(/data-selected-source=/gu)??[]).length,3);
  assert.ok(!html.includes('data-unprepared-fallback'));
  assert.match(html,/data-artwork-source-box="true" x="650" y="20" width="330" height="350"/u,'foreground is not expanded into an automatic photo frame');
  assert.match(html,/data-artwork-variant="foreground"/u);assert.ok(html.includes('background-color:transparent'));
  assert.match(html,/data-artwork-source-window="detail"/u);assert.ok(html.includes('border-radius:50%'));
  const geometry=artworkViewportGeometry({w:280,h:160},2,art.layers[2]!.sourceWindow);
  assert.deepEqual(geometry.frame,{x:0,y:24,w:280,h:112});
  assert.equal(geometry.source.x,-140);assert.ok(Math.abs(geometry.source.y+56)<1e-9);
  assert.equal(geometry.source.w,560);assert.equal(geometry.source.h,280);
  assert.equal(geometry.source.w/geometry.source.h,2,'the crop preserves original pixel aspect');
  assert.equal(snapshot(0,false),snapshot(119,false),'Motion0 keeps the authored held state');
  assert.throws(()=>renderToStaticMarkup(createElement(DocumentaryArtwork,{artwork:art,frame:60,frames:120,width:1920,height:1080,moving:true,material:null})),/не подготовлен/);
});

const rotor: DocumentaryArtworkLayer = {id: 'rotor', kind: 'path', x: 80, y: 120, w: 280, h: 280,
  path: 'M 0 140 L 280 140 M 140 0 L 140 280', stroke: 'accent', fill: 'none',
  keyframes: [{t: 0, rotation: 0, draw: 0}, {t: .5, draw: 1, x: 40}, {t: 1, rotation: 360}], repeat: 1};

test('linked slider-crank keeps both rod joints attached through reversal', () => {
  const mechanism = {kind: 'slider-crank' as const, centerX: 400, centerY: 440, crankRadius: 70,
    rodLength: 180, pistonWidth: 135, pistonHeight: 65, turns: 1};
  const top = sliderCrankPose(mechanism, 0);
  const bottom = sliderCrankPose(mechanism, .5);
  assert.equal(top.wristPin.y, 190);
  assert.equal(bottom.wristPin.y, 330);
  for (const t of [0, .125, .25, .375, .5, .625, .75, .875, 1]) {
    const pose = sliderCrankPose(mechanism, t);
    assert.ok(Math.abs(Math.hypot(pose.wristPin.x - pose.crankPin.x,
      pose.wristPin.y - pose.crankPin.y) - mechanism.rodLength) < 1e-8);
    assert.equal(pose.wristPin.x, mechanism.centerX);
  }
});

test('force annotation follows the piston while torque stays at the shaft', () => {
  const mechanism = {kind: 'slider-crank' as const, centerX: 400, centerY: 440, crankRadius: 70,
    rodLength: 180, pistonWidth: 135, pistonHeight: 65, turns: 1,
    annotations: {reciprocatingForce: true, crankTorque: true}};
  const drawing: Artwork = {version: 1, intent: 'connected mechanism', layout: 'full', canvas: {width: 1000, height: 562},
    palette: {background: '#101820', ink: '#ffffff', accent: '#ffd166', secondary: '#6c7a89'},
    startSeconds: 0, durationSeconds: 4, layers: [{id: 'ground', kind: 'rect', x: 0, y: 0, w: 1000, h: 562, fill: 'background'}],
    linkedMechanism: mechanism};
  const markup = (frame: number) => renderToStaticMarkup(createElement(DocumentaryArtwork,
    {artwork: drawing, frame, frames: 101, width: 1000, height: 562, moving: true, material: null}));
  assert.match(markup(0), /data-force-anchor="518\.5,190"/u);
  assert.match(markup(50), /data-force-anchor="518\.5,330"/u);
  assert.match(markup(0), /data-torque-anchor="400,440"/u);
  assert.match(markup(50), /data-torque-anchor="400,440"/u);
  assert.match(markup(50), /A 113 113 0 0 1\s+513 440/u, 'torque cue follows the crank clockwise');
  const raised: Artwork = {...drawing, linkedMechanism: {...mechanism, centerX: 500, centerY: 320,
    crankRadius: 80, rodLength: 220, pistonWidth: 90, pistonHeight: 60}};
  const fit = artworkTrajectoryFit(raised);
  assert.equal(fit.scale, 1);
  assert.ok(fit.y > 38 && fit.y < 40, 'all authored layers and the full piston stroke share one upward-overflow correction');
});

test('sparse artwork keys preserve prior values and interpolate offsets and drawing', () => {
  assert.deepEqual(artworkLayerState(rotor, .25), {x: 20, y: 0, rotation: 0, scale: 1, opacity: 1, draw: .5});
  assert.deepEqual(artworkLayerState(rotor, .75), {x: 40, y: 0, rotation: 180, scale: 1, opacity: 1, draw: 1});
  assert.equal(artworkLayerState({...rotor, keyframes: [{t: .5, opacity: .5}]}, 1).opacity, .5);
});

test('periodic mechanisms keep continuous rotation while motion zero retains a visible result', () => {
  const loop = {...rotor, repeat: 3, keyframes: [{t: 0, rotation: 0}, {t: 1, rotation: 360}]};
  assert.equal(artworkLayerState(loop, .25).rotation, 270);
  assert.ok(Math.abs(artworkLayerState(loop, .5).rotation - 180) < .001);
  const exit = {...rotor, keyframes: [{t: 0, opacity: 0, draw: 0}, {t: .6, x: 40, opacity: 1, draw: .8}, {t: 1, opacity: 0}]};
  assert.deepEqual(artworkLayerState(exit, .98, false), {x: 40, y: 0, rotation: 0, scale: 1, opacity: 1, draw: 1});
});

const artwork: Artwork = {version: 1, intent: 'Editorial metadata must not become a title', layout: 'right',
  canvas: {width: 700, height: 900}, palette: {background: '#101820', ink: '#ffffff', accent: '#ffd166', secondary: '#6c7a89'},
  startSeconds: 0, durationSeconds: 4, layers: [rotor,
    {id: 'label', kind: 'text', x: 60, y: 540, w: 580, h: 160, text: '990cc\nV5', fontSize: 54,
      keyframes: [{t: 0, y: 20, opacity: 0}, {t: .2, y: 0, opacity: 1}, {t: 1, opacity: 1}]}]};
const render = (frame: number, moving = true, layout = artwork.layout) => renderToStaticMarkup(createElement(DocumentaryArtwork,
  {artwork: {...artwork, layout}, frame, frames: 120, width: 1920, height: 1080, moving,
    material: createElement('video', {'data-original-material': 'true', style: {width: '100%', height: '100%', objectFit: 'cover'}})}));

test('artwork preserves full-frame material, a bounded panel and stable text geometry', () => {
  const early = render(20);
  const late = render(95);
  assert.ok(early.includes('data-artwork-material="full-frame"'));
  assert.equal((early.match(/data-original-material/g) ?? []).length, 1);
  assert.match(early, /data-artwork-region="right" style="[^"]*left:921\.5999999999999px;top:0;width:998\.4000000000001px;height:1080px/u);
  assert.ok(early.includes('preserveAspectRatio="xMidYMid meet"'));
  assert.ok(early.includes('M 0 140 L 280 140 M 140 0 L 140 280'));
  assert.match(early, /<g transform="translate\(80 120\)"><defs><clipPath[^>]*><rect x="-2" y="-2" width="284" height="284"/u);
  assert.match(early, /d="M 0 140 L 280 140 M 140 0 L 140 280" clip-path="url\(#artwork-path-/u);
  assert.ok(!early.includes('scale(2.8 2.8)'), 'local canvas coordinates must not be scaled a second time');
  assert.ok(!early.includes(artwork.intent));
  const text = (html: string) => html.match(/<foreignObject[\s\S]*?<\/foreignObject>/u)?.[0];
  assert.equal(text(early), text(late));
  assert.ok(text(early)?.includes('font-size:54px'));
  assert.ok(text(early)?.includes('width="580" height="160" overflow="hidden"'));
});

test('motion zero is readable at the first and last frame; overlay keeps translucent material', () => {
  assert.equal(render(0, false), render(119, false));
  assert.match(render(60, true, 'overlay'), /data-artwork-scrim="local"[^>]*radial-gradient/u);
  assert.ok(!render(60, true, 'overlay').includes('opacity:0.76'));
  assert.equal(render(-1), '');
  assert.equal(render(120), '');
});

test('continuous artwork can omit only its local edge fade', () => {
  const ordinary = render(0);
  const continuous = renderToStaticMarkup(createElement(DocumentaryArtwork,
    {artwork, frame: 0, frames: 120, width: 1920, height: 1080, moving: true, skipEdgeFade: true, material: null}));
  assert.match(ordinary, /data-artwork-region="right" style="[^"]*opacity:0/u);
  assert.match(continuous, /data-artwork-region="right" style="[^"]*opacity:1/u);
  assert.match(continuous, /rotate\(0\)/u);
});

test('standalone illustrations retain their subjects at adjacent cuts without rewriting authored motion', () => {
  const illustration: Artwork = {...artwork, layout: 'full', canvas: {width: 1000, height: 562}, layers: [
    {id: 'fragment', kind: 'rect', x: 200, y: 100, w: 300, h: 240, fill: 'accent',
      keyframes: [{t: 0, x: 0}, {t: 1, x: 140}]},
    {id: 'delayed-label', kind: 'text', x: 100, y: 400, w: 800, h: 80, text: 'Comparing evidence',
      keyframes: [{t: 0, opacity: 0}, {t: .7, opacity: 1}, {t: 1, opacity: 1}]},
  ]};
  const before = structuredClone(illustration);
  const snapshot = (frame: number, frames: number, drawing = illustration) => renderToStaticMarkup(createElement(DocumentaryArtwork,
    {artwork: drawing, frame, frames, width: 1920, height: 1080, moving: true, material: null}));
  // The outgoing last frame and incoming first frame used to have global
  // opacity zero, even though both contain a visible authored subject.
  for (const html of [snapshot(156, 157), snapshot(0, 161), snapshot(160, 161)]) {
    assert.match(html, /data-artwork-region="full" style="[^"]*opacity:1/u);
    assert.match(html, /data-artwork-layer="fragment" opacity="1"/u);
    assert.match(html, /<rect[^>]*fill="#ffd166"/u);
  }
  assert.match(snapshot(0, 161), /data-artwork-layer="delayed-label" opacity="0"/u);
  assert.match(snapshot(160, 161), /data-artwork-layer="delayed-label" opacity="1"/u);
  assert.match(snapshot(156, 157), /translate\(140 0\)/u);
  assert.deepEqual(illustration, before);
});

test('one shared slider-crank clock stays visible and continuous across a scene boundary', () => {
  const shared: Artwork = {...artwork, layout: 'full', linkedMechanism: {kind: 'slider-crank', centerX: 420,
    centerY: 440, crankRadius: 70, rodLength: 180, pistonWidth: 154, pistonHeight: 70, turns: 2,
    annotations: {reciprocatingForce: true, crankTorque: true, forceAt: .52, torqueAt: .7}}};
  const snapshot = (frame: number) => renderToStaticMarkup(createElement(DocumentaryArtwork,
    {artwork: shared, frame, frames: 343, width: 1920, height: 1080, moving: true, skipEdgeFade: true, material: null}));
  const before = snapshot(171), after = snapshot(172);
  const wristY = (html: string) => Number(html.match(/data-wrist-pin="420,([^"]+)"/u)?.[1]);
  assert.ok(Math.abs(wristY(after) - wristY(before)) < 2);
  assert.match(before, /data-artwork-region="full" style="[^"]*opacity:1/u);
  assert.match(after, /data-artwork-region="full" style="[^"]*opacity:1/u);
  assert.match(before, /data-mechanism-annotation="reciprocating-force"[^>]*opacity="0"/u);
  assert.match(after, /data-mechanism-annotation="reciprocating-force"[^>]*opacity="0"/u);
});

test('small labels retain a fixed readable font and clamp at complete lines', () => {
  const label: Artwork = {...artwork, layers: [{id: 'long-label', kind: 'text', x: 50, y: 50, w: 130, h: 48,
    fontSize: 18, text: 'Before the printing press, a manuscript had to be copied by hand',
    keyframes: [{t: 0, opacity: 0}, {t: .5, opacity: 1}]}]};
  const snapshot = (frame: number) => renderToStaticMarkup(createElement(DocumentaryArtwork,
    {artwork: label, frame, frames: 120, width: 1920, height: 1080, moving: true, material: null}));
  const text = (html: string) => html.match(/<foreignObject[\s\S]*?<\/foreignObject>/u)?.[0];
  const early = text(snapshot(20));
  assert.equal(early, text(snapshot(95)), 'opacity animation cannot resize or reflow the label');
  assert.ok(early?.includes('font-size:18px'));
  assert.ok(early?.includes('-webkit-line-clamp:2'));
  assert.ok(early?.includes('text-overflow:ellipsis'));
});

test('completed outlines are solid, delayed keys hold, and text contrast changes only rendering', () => {
  const delayed = {...rotor, keyframes: [{t: .4, opacity: 0, y: 20}, {t: .7, opacity: 1, y: 0}]};
  assert.equal(artworkLayerState(delayed, .2).opacity, 0, 'the first entrance must not start with a visible flash');
  assert.equal(artworkLayerState(delayed, .2).y, 20);
  assert.ok(Math.abs(artworkLayerState(delayed, .55).opacity - .5) < 1e-9, 'model-authored opacity timing remains intact');
  const staged: Artwork = {...artwork, palette: {...artwork.palette, ink: '#253044'}, layers: [
    {...rotor, strokeWidth: 4},
    {id: 'closed-rect', kind: 'rect', x: 100, y: 400, w: 120, h: 80, stroke: 'accent'},
    {id: 'closed-ellipse', kind: 'ellipse', x: 300, y: 400, w: 120, h: 80, stroke: 'ink'},
    {id: 'low-contrast', kind: 'text', x: 50, y: 650, w: 580, h: 120, text: 'Water', fill: '#1f2937'},
  ]};
  const before = JSON.stringify(staged);
  const snapshot = (frame: number, drawing = staged) => renderToStaticMarkup(createElement(DocumentaryArtwork,
    {artwork: drawing, frame, frames: 101, width: 960, height: 540, moving: true, material: null}));
  const completed = snapshot(75), partial = snapshot(25), hidden = snapshot(0);
  assert.ok(!completed.includes('stroke-dash'), 'completed paths, rectangles and ellipses must have uninterrupted outlines');
  assert.match(partial, /stroke-width="4"[^>]*pathLength="1" stroke-dasharray="1" stroke-dashoffset="0.5"/u);
  assert.ok(!partial.includes('vector-effect'), 'stroke and dash use the same canvas coordinate system');
  assert.match(hidden, /<path[^>]*stroke-opacity="0"/u);
  assert.ok(completed.includes('color:#ffffff'));
  const light = {...staged, palette: {...staged.palette, background: '#ffffff', ink: '#dddddd'}};
  light.layers = staged.layers.map(layer => layer.kind === 'text' ? {...layer, fill: '#eeeeee'} : layer);
  assert.ok(snapshot(75, light).includes('color:#111111'));
  const sufficient = {...staged, layers: staged.layers.map(layer => layer.kind === 'text' ? {...layer, fill: '#ffd166'} : layer)};
  assert.ok(snapshot(75, sufficient).includes('color:#ffd166'), 'already readable authored accents stay unchanged');
  assert.equal(JSON.stringify(staged), before, 'rendering never rewrites the saved artwork');
});

test('rounded moving label preserves its authored contrast when its box extends into transparent corners', () => {
  const drawing: Artwork={...artwork,layout:'full',canvas:{width:1000,height:562},
    palette:{background:'#14161A',ink:'#F2EEE6',accent:'#E8541E',secondary:'#3A66D6'},layers:[
      {id:'token',kind:'group',x:774,y:196,w:110,h:44,keyframes:[{t:0,y:0},{t:1,y:140}]},
      {id:'pill',kind:'rect',parentId:'token',x:774,y:196,w:110,h:44,radius:22,fill:'ink'},
      {id:'name',kind:'text',parentId:'token',x:774,y:202,w:110,h:32,text:'Rossi',fontSize:28,weight:700,align:'center',fill:'background'}]};
  const before=JSON.stringify(drawing);
  for(const frame of [0,50,100]){
    const html=renderToStaticMarkup(createElement(DocumentaryArtwork,{artwork:drawing,frame,frames:101,width:1920,height:1080,moving:true,material:null}));
    assert.equal(html.match(/data-artwork-layer="name"[\s\S]*?color:([^;"]+)/u)?.[1],'#14161A');
  }
  assert.equal(JSON.stringify(drawing),before);
});

test('local text plates govern contrast and appear with their labels instead of leaving an empty banner', () => {
  const source: DocumentaryArtworkLayer = {id: 'source', kind: 'media', x: 0, y: 0, w: 1000, h: 562};
  const plate: DocumentaryArtworkLayer = {id: 'sky-overlay', kind: 'rect', x: 0, y: 0, w: 1000, h: 166, fill: '#0D0D0D',
    keyframes: [{t: 0, opacity: 0}, {t: .27, opacity: 0}, {t: .38, opacity: .62}, {t: 1, opacity: .62}]};
  const label: DocumentaryArtworkLayer = {id: 'question', kind: 'text', x: 60, y: 26, w: 880, h: 60,
    text: 'was it Rossi,', fill: '#F2EDE4', fontSize: 46,
    keyframes: [{t: 0, opacity: 0}, {t: .65, opacity: 0}, {t: .75, opacity: 1}, {t: 1, opacity: 1}]};
  const drawing: Artwork = {...artwork, layout: 'full', canvas: {width: 1000, height: 562},
    palette: {background: '#F2EDE4', ink: '#1E1E1E', accent: '#C4421A', secondary: '#3B6FAB'}, layers: [source, plate, label]};
  const before = JSON.stringify(drawing);
  const snapshot = (scene = drawing, frame = 80, moving = true) => renderToStaticMarkup(createElement(DocumentaryArtwork,
    {artwork: scene, frame, frames: 101, width: 1920, height: 1080, moving, material: createElement('video')}));
  const textColor = (html: string) => html.match(/data-artwork-layer="question"[\s\S]*?color:([^;"]+)/u)?.[1];
  assert.equal(textColor(snapshot()), '#F2EDE4', 'white text stays white on the real translucent dark plate above media');
  assert.match(snapshot(drawing, 50), /data-artwork-layer="sky-overlay" opacity="0"/u, 'no empty early banner');
  const entering = snapshot(drawing, 70);
  const enteringOpacity = Number(entering.match(/data-artwork-layer="sky-overlay" opacity="([^"]+)"/u)?.[1]);
  assert.ok(Math.abs(enteringOpacity - .31) < 1e-9, 'the plate retains its own opacity and follows the label entrance');
  assert.equal(textColor(entering), '#F2EDE4', 'a correctly authored color does not flash black during the fade');
  assert.equal(textColor(snapshot(drawing, 0, false)), '#F2EDE4', 'Motion 0 retains the completed readable composition');

  const reverse: Artwork = {...drawing, palette: {...drawing.palette, background: '#111111'},
    layers: [source, {...plate, fill: '#ffffff', keyframes: undefined}, {...label, fill: '#111111'}]};
  assert.equal(textColor(snapshot(reverse)), '#111111', 'a local white plate overrides a dark outer canvas');
  assert.equal(textColor(snapshot({...drawing, layers: [source, label]})), '#F2EDE4', 'unknown source pixels do not justify recoloring authored text');
  assert.equal(textColor(snapshot({...drawing, layers: [source, label, plate]})), '#F2EDE4', 'a later unambiguous text plate is placed below its label');
  assert.equal(textColor(snapshot({...drawing, layers: [{...label, fill: '#eeeeee'}]})), '#111111', 'standalone text keeps the global contrast safeguard');
  const darkLabel = {...label, fill: '#111111'};
  assert.equal(textColor(snapshot({...drawing, layers: [source, plate, darkLabel]})), '#ffffff', 'a genuinely unreadable local color is corrected');
  assert.equal(textColor(snapshot({...drawing, layers: [source, {...plate, keyframes: [{t: 0, x: 1000, opacity: 1}]}, darkLabel]})),
    '#111111', 'a translated plate no longer covering the label cannot govern its color');

  const group: DocumentaryArtworkLayer = {id: 'question-group', kind: 'group', x: 0, y: 0, w: 1000, h: 166,
    keyframes: [{t: 0, x: 40, rotation: 3, draw: .7}, {t: 1, x: 40, rotation: 3, draw: .7}]};
  const grouped: Artwork = {...drawing, layers: [source, group, {...plate, parentId: group.id, keyframes: undefined}, {...label, parentId: group.id}]};
  assert.equal(textColor(snapshot(grouped)), '#F2EDE4', 'common group transforms preserve local plate coverage');
  assert.match(snapshot(grouped), /fill-opacity="0.7"/u, 'inherited draw remains intact');
  const illustration: DocumentaryArtworkLayer = {id: 'subject', kind: 'ellipse', x: 10, y: 10, w: 20, h: 20, fill: 'accent'};
  assert.match(snapshot({...drawing, layers: [source, plate, illustration, label]}, 50),
    /data-artwork-layer="sky-overlay" opacity="0.62"/u, 'a plate containing an illustration retains its independent timing');
  assert.equal(JSON.stringify(drawing), before, 'the saved model plan is never rewritten');
});

test('late text-only plates move below their labels without reordering media, subjects or grouped choreography', () => {
  const media: DocumentaryArtworkLayer = {id: 'media', kind: 'media', x: 0, y: 0, w: 1000, h: 562};
  const label: DocumentaryArtworkLayer = {id: 'label-came-with', kind: 'text', x: 50, y: 440, w: 280, h: 60,
    text: 'came with him', fill: '#2a2520', keyframes: [{t: .25, opacity: 0}, {t: .35, opacity: 1}]};
  const plate: DocumentaryArtworkLayer = {id: 'label-bg', kind: 'rect', x: 48, y: 435, w: 285, h: 70, fill: '#f5f1ed'};
  const rule: DocumentaryArtworkLayer = {id: 'rule', kind: 'path', x: 400, y: 100, w: 100, h: 20, path: 'M0 0 L100 20', stroke: 'accent'};
  const subject: DocumentaryArtworkLayer = {id: 'subject', kind: 'ellipse', x: 650, y: 250, w: 140, h: 140, fill: 'secondary'};
  const drawing: Artwork = {...artwork, layout: 'full', canvas: {width: 1000, height: 562}, layers: [media, label, rule, plate, subject]};
  const snapshot = (scene = drawing, frame = 80) => renderToStaticMarkup(createElement(DocumentaryArtwork,
    {artwork: scene, frame, frames: 101, width: 1920, height: 1080, moving: true, material: createElement('video')}));
  const order = (html: string) => [...html.matchAll(/data-artwork-layer="([^"]+)"/gu)].map(match => match[1]);
  const original = JSON.stringify(drawing);
  assert.deepEqual(order(snapshot()), ['media', 'label-bg', 'label-came-with', 'rule', 'subject']);
  assert.match(snapshot(drawing, 10), /data-artwork-layer="label-bg" opacity="0"/u, 'the reordered plate still waits for its label');
  const group: DocumentaryArtworkLayer = {id: 'unit', kind: 'group', x: 0, y: 400, w: 400, h: 150,
    keyframes: [{t: 0, x: 20, opacity: .8, draw: .7}, {t: 1, x: 20, opacity: .8, draw: .7}]};
  const grouped: Artwork = {...drawing, layers: [media, group, {...label, parentId: 'unit'}, {...plate, parentId: 'unit'}, subject]};
  const html = snapshot(grouped);
  assert.deepEqual(order(html), ['media', 'unit', 'label-bg', 'label-came-with', 'subject']);
  assert.match(html, /data-artwork-layer="unit" opacity="0.8"[^>]*translate\(20 0\)/u);
  assert.match(html, /fill-opacity="0.7"/u);
  const inside = {...subject, x: 100, y: 450, w: 30, h: 30};
  assert.deepEqual(order(snapshot({...drawing, layers: [media, label, inside, plate]})),
    ['media', 'label-came-with', 'subject', 'label-bg'], 'a plate containing subject geometry keeps its authored order');
  assert.deepEqual(order(snapshot({...drawing, layers: [media, label, {...plate, x: 0, y: 200, w: 1000, h: 362}]})),
    ['media', 'label-came-with', 'label-bg'], 'large composition backgrounds are not inferred to be text plates');
  assert.equal(JSON.stringify(drawing), original);
});

test('groups inherit coherent transforms, opacity and draw without duplicate children or added box offsets', () => {
  const grouped: Artwork = {...artwork, layout: 'full', layers: [
    {id: 'vehicle', kind: 'group', x: 100, y: 100, w: 300, h: 300, shading: 'soft', shadow: true,
      keyframes: [{t: 0, x: 0, opacity: .5, draw: .4}, {t: 1, x: 80, opacity: 1, draw: 1, ease: 'linear'}]},
    {id: 'body', parentId: 'vehicle', kind: 'rect', x: 110, y: 120, w: 80, h: 40, fill: 'accent'},
    {id: 'axle', parentId: 'vehicle', kind: 'group', x: 200, y: 150, w: 100, h: 100,
      keyframes: [{t: 0, rotation: 0}, {t: 1, rotation: 90, ease: 'linear'}]},
    {id: 'wheel', parentId: 'axle', kind: 'ellipse', x: 210, y: 210, w: 40, h: 40, fill: 'secondary'},
  ]};
  const html = renderToStaticMarkup(createElement(DocumentaryArtwork,
    {artwork: grouped, frame: 50, frames: 101, width: 1920, height: 1080, moving: true, material: null}));
  for (const id of ['vehicle', 'body', 'axle', 'wheel']) assert.equal((html.match(new RegExp(`data-artwork-layer="${id}"`, 'gu')) ?? []).length, 1);
  assert.match(html, /data-artwork-layer="vehicle" opacity="0.75"[^>]*transform="translate\(40 0\) translate\(250 250\)/u);
  assert.match(html, /data-artwork-layer="axle"[^>]*rotate\(45\)/u);
  assert.match(html, /fill-opacity="0.7" x="110" y="120" width="80" height="40"/u);
  assert.ok(html.includes('cx="230" cy="230"'), 'child coordinates are already in the common canvas');
  assert.equal((html.match(/<feDropShadow/g) ?? []).length, 1, 'group depth is applied once, not to the source or every descendant');
  assert.equal((html.match(/<linearGradient/g) ?? []).length, 2, 'soft shading reaches both filled object parts');
});

test('right-key easing controls staging and repeats; an unmarked mechanism remains linear', () => {
  const base = {...rotor, repeat: 1, keyframes: [{t: 0, x: 0}, {t: 1, x: 100, ease: 'linear' as const}]};
  assert.equal(artworkLayerState(base, .25).x, 25);
  const eased = {...base, keyframes: [{t: 0, x: 0}, {t: 1, x: 100, ease: 'out' as const}]};
  assert.equal(artworkLayerState(eased, .25).x, 57.8125);
  // The artwork contract applies explicit easing to the arriving segment,
  // including repeats. Only an unmarked repeated segment defaults to linear.
  assert.equal(artworkLayerState({...eased, repeat: 2}, .125).x, 57.8125);
  assert.equal(artworkLayerState({...base, repeat: 2, keyframes: [{t: 0, x: 0}, {t: 1, x: 100}]}, .125).x, 25);
});

test('artwork camera holds its final composition at Motion zero and leaves source full-frame', () => {
  const cameraArt: Artwork = {...artwork, layout: 'overlay', camera: {keyframes: [
    {t: 0, x: 350, y: 450, scale: 1}, {t: 1, x: 400, y: 420, scale: 1.16}]},
    direction: {concept: 'Review metadata only', alternatives: ['Do not render this'], beats: [{at: .5, action: 'Object focus'}]},
    layers: [{id: 'backdrop', kind: 'rect', x: 0, y: 0, w: 700, h: 900, fill: 'background'}, ...artwork.layers]};
  assert.deepEqual(artworkCameraState(cameraArt, .5), {x: 375, y: 435, scale: 1.08});
  assert.deepEqual(artworkCameraState(cameraArt, 0, false), {x: 400, y: 420, scale: 1.16});
  const snapshot = (frame: number) => renderToStaticMarkup(createElement(DocumentaryArtwork, {
    artwork: cameraArt, frame, frames: 120, moving: false, width: 1920, height: 1080,
    material: createElement('video', {'data-camera-source': 'unchanged', style: {width: '100%', height: '100%'}})}));
  const html = snapshot(0);
  assert.equal(html, snapshot(119));
  assert.match(html, /data-artwork-camera="true" transform="translate\(350 450\) scale\(1.16\) translate\(-400 -420\)"/u);
  assert.equal((html.match(/data-camera-source/g) ?? []).length, 1);
  assert.ok(html.indexOf('data-camera-source') < html.indexOf('data-artwork-camera'));
  assert.ok(!html.includes('data-artwork-layer="backdrop"'), 'overlay cannot hide material with an opaque full-canvas model background');
  assert.ok(!html.includes('Review metadata only'));
  assert.match(html, /data-artwork-scrim="local"[^>]*radial-gradient/u);
});

test('one stable trajectory fit contains inherited motion and camera without scaling the source', () => {
  const crossing: Artwork = {...artwork, layout: 'full', canvas: {width: 1000, height: 600},
    camera: {keyframes: [{t: 0, x: 500, y: 300, scale: 1}, {t: 1, x: 500, y: 300, scale: 1.12}]},
    layers: [
      {id: 'object', kind: 'group', x: 600, y: 200, w: 300, h: 200, keyframes: [{t: 0, x: 0}, {t: 1, x: 100}]},
      {id: 'moving-part', parentId: 'object', kind: 'rect', x: 800, y: 200, w: 80, h: 80,
        keyframes: [{t: 0, x: 0}, {t: 1, x: 100}]},
      {id: 'attached-part', parentId: 'object', kind: 'rect', x: 610, y: 300, w: 80, h: 80},
      {id: 'fixed-context', kind: 'rect', x: 40, y: 100, w: 80, h: 80},
    ]};
  const fit = artworkTrajectoryFit(crossing);
  assert.ok(fit.scale > .8 && fit.scale < 1, 'only the real overshoot reduces the drawing, without an extra safe-area inset');
  const verify = (progress: number, moving: boolean) => {
    const camera = artworkCameraState(crossing, progress, moving);
    const parent = artworkLayerState(crossing.layers[0]!, progress, moving);
    for (const layer of crossing.layers.slice(1)) {
      const own = artworkLayerState(layer, progress, moving);
      const dx = own.x + (layer.parentId ? parent.x : 0), dy = own.y + (layer.parentId ? parent.y : 0);
      for (const x of [layer.x + dx, layer.x + dx + layer.w]) {
        const displayed = fit.x + (500 + (x - camera.x) * camera.scale) * fit.scale;
        assert.ok(displayed >= -1e-7 && displayed <= 1000 + 1e-7, `horizontal clipping at ${progress}`);
      }
      for (const y of [layer.y + dy, layer.y + dy + layer.h]) {
        const displayed = fit.y + (300 + (y - camera.y) * camera.scale) * fit.scale;
        assert.ok(displayed >= -1e-7 && displayed <= 600 + 1e-7, `vertical clipping at ${progress}`);
      }
    }
  };
  for (let index = 0; index <= 100; index++) verify(index / 100, true);
  verify(1, false);
  const snapshot = (frame: number, moving = true) => renderToStaticMarkup(createElement(DocumentaryArtwork, {
    artwork: crossing, frame, frames: 101, width: 1920, height: 1080, moving,
    material: createElement('video', {'data-fit-source': 'unchanged', style: {width: '100%', height: '100%'}})}));
  const transform = (html: string) => html.match(/data-artwork-trajectory="fixed" transform="([^"]+)"/u)?.[1];
  const first = snapshot(0);
  assert.equal(transform(first), transform(snapshot(50)));
  assert.equal(transform(first), transform(snapshot(100)));
  assert.equal(transform(first), transform(snapshot(0, false)), 'Motion zero shares the same stable framing');
  assert.ok(first.indexOf('data-fit-source') < first.indexOf('data-artwork-trajectory'));
  assert.equal((first.match(/data-fit-source/g) ?? []).length, 1);
  assert.deepEqual(artworkTrajectoryFit(artwork), {scale: 1, x: 0, y: 0}, 'already safe scenes keep their authored size and position');
});

test('authored media mounts one large source, fills both endpoints, and stays readable at Motion zero', () => {
  const mediaArt: Artwork = {...artwork, layout: 'full', canvas: {width: 1000, height: 600},
    camera: {keyframes: [{t: 0, x: 500, y: 300, scale: 1}, {t: 1, x: 510, y: 300, scale: 1.12}]},
    layers: [
      {id: 'evidence', kind: 'media', x: 70, y: 100, w: 650, h: 420, radius: 12, stroke: 'ink', strokeWidth: 3, shadow: true,
        keyframes: [{t: 0, x: 0, opacity: 0, draw: 0}, {t: .5, x: 20, opacity: 1, draw: 1}, {t: 1, x: 40, opacity: 0}]},
      {id: 'evidence-label', kind: 'text', x: 770, y: 150, w: 180, h: 100, text: 'Water', fontSize: 44},
      {id: 'detail', kind: 'rect', x: 950, y: 300, w: 40, h: 160, fill: 'accent'},
    ]};
  const snapshot = (frame: number, moving = true) => renderToStaticMarkup(createElement(DocumentaryArtwork, {
    artwork: mediaArt, frame, frames: 101, width: 1920, height: 1080, moving,
    material: createElement('video', {'data-single-source': 'true', style: {width: '100%', height: '100%', objectFit: 'cover'}})}));
  const sourceBox = (html: string) => {
    const match = html.match(/data-artwork-source-box="true" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/u);
    assert.ok(match);
    return match.slice(1).map(Number) as [number, number, number, number];
  };
  const first = snapshot(0), middle = snapshot(50), last = snapshot(100), still = snapshot(0, false);
  for (const html of [first, middle, last, still]) {
    assert.equal((html.match(/data-single-source/g) ?? []).length, 1, 'no second decoder behind the authored media');
    assert.ok(!html.includes('data-artwork-material="full-frame"'));
    assert.match(html, /data-artwork-media="visible" opacity="1"/u);
    assert.match(html, /data-artwork-region="full" style="[^"]*opacity:1;/u);
    assert.ok(html.includes('object-fit:cover'), 'the current source fit is preserved');
  }
  assert.deepEqual(sourceBox(middle), [70, 100, 650, 420]);
  assert.ok(sourceBox(middle)[2] * sourceBox(middle)[3] >= 1000 * 600 * .35);
  assert.deepEqual(sourceBox(still), [70, 100, 650, 420]);
  assert.equal(still, snapshot(100, false));
  const fit = artworkTrajectoryFit(mediaArt), pixelScale = (1080 - 2 * 1080 * .035) / 600;
  const offsetX = (1920 - 1000 * pixelScale) / 2, offsetY = (1080 - 600 * pixelScale) / 2;
  for (const [progress, html] of [[0, first], [1, last]] as const) {
    const camera = artworkCameraState(mediaArt, progress);
    const [x, y, w, h] = sourceBox(html);
    const projectX = (value: number) => offsetX + (fit.x + fit.scale * (500 + (value - camera.x) * camera.scale)) * pixelScale;
    const projectY = (value: number) => offsetY + (fit.y + fit.scale * (300 + (value - camera.y) * camera.scale)) * pixelScale;
    assert.ok(Math.abs(projectX(x)) < 1e-7 && Math.abs(projectY(y)) < 1e-7, 'source starts at the actual viewport edge');
    assert.ok(Math.abs(projectX(x + w) - 1920) < 1e-7 && Math.abs(projectY(y + h) - 1080) < 1e-7,
      'camera and safe framing cannot leave blank bands at the first or last frame');
    assert.match(html, /data-artwork-media="visible" opacity="1" transform="translate\(0 0\)[^"]*rotate\(0\) scale\(1\)/u);
    assert.match(html, /<g opacity="0"><g data-artwork-layer="evidence-label"/u, 'only editorial marks fade at the endpoints');
  }
});

test('media preserves source framing and places quiet editorial labels above evidence', () => {
  const composition: Artwork = {...artwork, layout: 'full', canvas: {width: 1000, height: 600}, layers: [
    {id: 'caption', kind: 'text', x: 90, y: 70, w: 600, h: 70, text: 'Water', fontSize: 44},
    {id: 'accent-caption', kind: 'text', x: 720, y: 350, w: 250, h: 80, text: 'Clouds', fontSize: 44, weight: 800},
    {id: 'evidence', kind: 'media', x: 60, y: 120, w: 650, h: 420},
    {id: 'source-backplate', kind: 'rect', x: 50, y: 110, w: 670, h: 440, fill: 'secondary'},
    {id: 'background', kind: 'rect', x: 0, y: 0, w: 1000, h: 600, fill: 'background'},
  ]};
  const snapshot = (frame: number) => renderToStaticMarkup(createElement(DocumentaryArtwork, {
    artwork: composition, frame, frames: 101, width: 1920, height: 1080, moving: true,
    material: createElement('video', {'data-framing-source': 'true', style: {width: '100%', height: '100%', objectFit: 'cover'}})}));
  const html = snapshot(30), later = snapshot(70);
  const order = (id: string) => html.indexOf(`data-artwork-layer="${id}"`);
  assert.ok(order('background') < order('source-backplate'), 'the full backdrop cannot bury the source frame');
  assert.ok(order('source-backplate') < order('evidence') && order('background') < order('evidence'));
  assert.ok(order('evidence') < order('caption') && order('caption') < order('accent-caption'), 'source cannot bury foreground annotations');
  assert.equal((html.match(/data-framing-source/g) ?? []).length, 1);
  const frame = html.match(/data-artwork-source-frame="uncropped" style="position:absolute;left:0;top:([\d.]+)px;width:([\d.]+)px;height:([\d.]+)px;overflow:hidden"/u);
  assert.ok(frame);
  assert.ok(Math.abs(Number(frame[1]) - 27.1875) < 1e-7);
  assert.equal(Number(frame[2]), 650);
  assert.ok(Math.abs(Number(frame[2]) / Number(frame[3]) - 16 / 9) < 1e-7);
  assert.ok(html.includes('object-fit:cover'), 'source settings survive while the frame retains its original 16:9 aspect');
  const label = (markup: string, id: string) => markup.slice(markup.indexOf(`data-artwork-layer="${id}"`)).match(/<foreignObject[\s\S]*?<\/foreignObject>/u)?.[0];
  assert.match(label(html, 'caption')!, /font-size:44px;font-weight:500;line-height:1.15;color:#ffffff/u);
  assert.match(label(html, 'accent-caption')!, /font-size:44px;font-weight:800/u);
  assert.equal(label(html, 'caption'), label(later, 'caption'), 'typographic metrics are fixed through the action');
});

test('portrait evidence is contained once at a large size without sacrificing artwork or endpoint framing', () => {
  const composition: Artwork = {...artwork, layout: 'full', canvas: {width: 1000, height: 562}, layers: [
    {id: 'evidence', kind: 'media', x: 100, y: 0, w: 800, h: 562},
    {id: 'caption', kind: 'text', x: 40, y: 50, w: 220, h: 60, text: 'Water', fontSize: 40},
    {id: 'detail', kind: 'path', x: 60, y: 200, w: 90, h: 90, path: 'M0 45 L90 45', stroke: 'accent'},
  ]};
  const before = structuredClone(composition);
  const snapshot = (frame: number, moving = true) => renderToStaticMarkup(createElement(DocumentaryArtwork, {
    artwork: composition, frame, frames: 101, width: 1920, height: 1080, moving, sourceAspect: 1536 / 2048, sourceFit: 'contain',
    material: createElement('img', {'data-portrait-source': 'true', style: {width: '100%', height: '100%', objectFit: 'contain'}})}));
  const measure = (html: string) => {
    const source = html.match(/data-artwork-source-frame="uncropped" style="[^"]*width:([\d.]+)px;height:([\d.]+)px/u);
    const svg = html.match(/<svg width="([\d.]+)" height="([\d.]+)" viewBox="0 0 1000 562"/u);
    assert.ok(source && svg);
    const [w, h] = source.slice(1).map(Number) as [number, number];
    const scale = Math.min(Number(svg[1]) / 1000, Number(svg[2]) / 562);
    return {aspect: w / h, area: w * h * scale * scale / (1920 * 1080)};
  };
  const first = snapshot(0), middle = snapshot(50), last = snapshot(100), still = snapshot(0, false);
  for (const html of [first, middle, last, still]) {
    assert.equal((html.match(/data-portrait-source/g) ?? []).length, 1);
    assert.ok(Math.abs(measure(html).aspect - .75) < 1e-8, 'the inner frame uses photo dimensions, not output dimensions');
    assert.ok(measure(html).area >= .4 - 1e-8, 'actual photo pixels, not its empty frame, occupy at least 40%');
    assert.match(html, /object-fit:contain/u);
    assert.ok(html.indexOf('data-artwork-layer="evidence"') < html.indexOf('data-artwork-layer="caption"'));
    assert.match(html, /data-artwork-layer="detail"/u);
  }
  assert.ok(Math.abs(measure(first).area - .75 / (16 / 9)) < 1e-8, 'entry retains the complete full-height photo');
  assert.deepEqual(measure(first), measure(last));
  assert.equal(still, snapshot(100, false), 'Motion zero keeps one stable readable composition');
  assert.deepEqual(composition, before);
  const tall = artworkMediaFraming(composition.layers[0]!, composition.canvas, 16 / 9, .3, 'contain');
  assert.ok(Math.abs(tall.visibleFraction - tall.maximumFraction) < 1e-8);
  assert.ok(tall.visibleFraction < .4, 'a physically impossible area target never requires cropping the subject');
  const landscape = {x: 50, y: 60, w: 900, h: 500};
  assert.deepEqual(artworkMediaFraming(landscape, composition.canvas, 16 / 9, 16 / 9, 'cover').box, landscape,
    'already large sources retain their authored framing');
});
