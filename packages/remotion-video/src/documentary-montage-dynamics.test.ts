import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {createElement, type ReactNode} from 'react';
import type {DocumentaryArtwork as Artwork, DocumentaryArtworkLayer} from '@gold-work/shared';
import {artworkLayerState, artworkTrajectoryFit, DocumentaryArtwork} from './DocumentaryArtwork.js';
import {DocumentaryMotionPreset} from './DocumentaryMotionPreset.js';
import type {DocumentaryMotionGraphic} from './documentary-timeline.js';
import {automaticBoardRevealWindows} from './documentary-board-reveal.js';

const {renderToStaticMarkup} = createRequire(import.meta.url)('react-dom/server') as {renderToStaticMarkup: (node: ReactNode) => string};
const drawing: Artwork = {version: 1, intent: 'Visible relation', layout: 'full', startSeconds: 0, durationSeconds: 6,
  canvas: {width: 1000, height: 600}, palette: {background: '#14191d', ink: '#eeeade', accent: '#ec612d', secondary: '#5a6a77'},
  layers: [{id: 'subject', kind: 'rect', x: 160, y: 120, w: 350, h: 340, fill: 'accent'}]};

test('hidden alternatives and hidden group children do not shrink the visible composition or reappear at Motion zero', () => {
  const hidden: DocumentaryArtworkLayer = {id: 'unused', kind: 'rect', x: 1900, y: -900, w: 600, h: 800,
    keyframes: [{t: 0, opacity: 0}, {t: 1, opacity: 0}]};
  const staged: Artwork = {...drawing, layers: [...drawing.layers, hidden,
    {id: 'hidden-group', kind: 'group', x: 0, y: 0, w: 500, h: 500, keyframes: [{t: 0, draw: 0}]},
    {id: 'hidden-child', kind: 'ellipse', parentId: 'hidden-group', x: -5000, y: 0, w: 400, h: 400},
    {id: 'entering', kind: 'text', x: 570, y: 140, w: 300, h: 80, text: 'The next observation',
      keyframes: [{t: 0, x: 2000, opacity: 0}, {t: .35, x: 0, opacity: 0}, {t: .5, opacity: 1}]}]};
  const original = structuredClone(staged);
  assert.deepEqual(artworkTrajectoryFit(staged), {scale: 1, x: 0, y: 0});
  assert.equal(artworkLayerState(hidden, .7, false).opacity, 0);
  assert.equal(artworkLayerState(staged.layers[2]!, .7, false).opacity, 0);
  const html = renderToStaticMarkup(createElement(DocumentaryArtwork,
    {artwork: staged, frame: 0, frames: 180, moving: false, width: 1920, height: 1080, material: null}));
  assert.match(html, /data-artwork-layer="hidden-group" opacity="0"/u);
  assert.match(html, /data-artwork-layer="entering" opacity="1"/u, 'a real entrance still has a readable final state');
  assert.deepEqual(staged, original, 'rendering does not rewrite paid artwork');
});

test('Motion zero keeps the authored subdued context and palette behind the conclusion', () => {
  const context: DocumentaryArtworkLayer = {id: 'context', kind: 'text', text: 'Earlier observation', fill: 'ink',
    x: 570, y: 100, w: 320, h: 80, keyframes: [{t: 0, opacity: 0}, {t: .1, opacity: 1}, {t: .6, opacity: .45}, {t: 1, opacity: .45}]};
  assert.equal(artworkLayerState(context, 0, false).opacity, .45);
  const html = renderToStaticMarkup(createElement(DocumentaryArtwork,
    {artwork: {...drawing, layers: [...drawing.layers, context]}, frame: 0, frames: 180, moving: false, width: 1920, height: 1080, material: null}));
  assert.match(html, /data-artwork-layer="context" opacity="0.45"/u);
  assert.match(html, /color:#eeeade/u);
  assert.match(html, /fill="#ec612d"/u);
});

test('a repeated authored action retains its ease and hold while implicit rotation stays continuous', () => {
  const action: DocumentaryArtworkLayer = {...drawing.layers[0]!, repeat: 2,
    keyframes: [{t: 0, x: 0}, {t: .5, x: 100, ease: 'out'}, {t: 1, x: 100}]};
  assert.equal(artworkLayerState(action, .125).x, 87.5);
  assert.equal(artworkLayerState(action, .625).x, 87.5);
  assert.equal(artworkLayerState(action, .4).x, 100, 'a deliberate hold remains a hold');
  const rotor = {...action, keyframes: [{t: 0, rotation: 0}, {t: 1, rotation: 360}]};
  assert.equal(artworkLayerState(rotor, .125).rotation, 90);
  assert.equal(artworkLayerState(rotor, .375).rotation, 270);
});

const board = (overrides: Partial<DocumentaryMotionGraphic> = {}): DocumentaryMotionGraphic => ({kind: 'explainer', origin: 'automatic',
  preset: 'board-staircase', boardLayout: 'steps', enabled: true, startSeconds: 0, durationSeconds: 8,
  title: 'A manuscript becomes a printed book', cards: [{label: 'Set the type'}, {label: 'Apply the ink'}, {label: 'Press the paper'}], ...overrides});
const boardMarkup = (graphic: DocumentaryMotionGraphic, frame: number, stageAutomaticBoards = true, motionEnabled = true) => renderToStaticMarkup(createElement(DocumentaryMotionPreset,
  {graphic, frame, frames: 240, stageAutomaticBoards, motionEnabled, material: createElement('div', {'data-existing-source': true}),
    width: 1920, height: 1080, mediaAspect: 16 / 9, isVideo: true, accent: '#417a80', customBackground: true}));
const progresses = (html: string) => [...html.matchAll(/data-board-item="\d+" data-board-progress="([^"]+)"/gu)].map(match => Number(match[1]));

test('automatic steps and comparisons develop within the existing window and leave a complete reading hold', () => {
  for (const graphic of [board(), board({preset: 'board-ledger', boardLayout: 'compare', title: 'Two engineering choices', showSource: false,
    cards: [{label: 'More peak power'}, {label: 'A predictable response'}]})]) {
    const original = structuredClone(graphic);
    const early = progresses(boardMarkup(graphic, 60));
    assert.equal(early[0], 1);
    assert.equal(early.at(-1), 0, 'the counterpoint is not dumped into the opening');
    const hold = progresses(boardMarkup(graphic, 180));
    assert.ok(hold.every(value => value === 1), 'all literal text is readable for the final quarter');
    assert.deepEqual(progresses(boardMarkup(graphic, 239)), hold);
    assert.ok(progresses(boardMarkup(graphic, 0, true, false)).every(value => value === 1));
    const html = boardMarkup(graphic, 180);
    assert.ok(html.includes(graphic.title));
    for (const card of graphic.cards!) assert.ok(html.includes(card.label));
    assert.ok(html.includes('background:transparent'), 'the selected custom background remains exposed');
    if (graphic.showSource !== false) assert.equal((html.match(/data-existing-source=/gu) ?? []).length, 1);
    assert.deepEqual(graphic, original);
  }
});

test('manual, pinned opt-out, linked, measured and short boards retain their previous timing', () => {
  const automatic = board();
  for (const graphic of [board({origin: 'manual'}), board({sequenceId: 'existing-sequence'}), board({activeIndex: 1}),
    board({reading: {text: 'Measured words', words: [{text: 'Measured', startSeconds: 2, endSeconds: 3}]}})]) {
    assert.equal(automaticBoardRevealWindows(graphic, 240), undefined);
    assert.deepEqual(progresses(boardMarkup(graphic, 60)), [1, 1, 1]);
  }
  assert.equal(automaticBoardRevealWindows(automatic, 75), undefined);
  assert.equal(automaticBoardRevealWindows(board({boardLayout: 'parts'}), 240), undefined, 'reference overviews keep an early readable hold');
  assert.deepEqual(progresses(boardMarkup(automatic, 60, false)), [1, 1, 1]);
  assert.equal((boardMarkup(automatic, 60).match(/data-existing-source=/gu) ?? []).length, 1);
});
