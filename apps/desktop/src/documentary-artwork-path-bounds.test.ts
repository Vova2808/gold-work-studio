import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeArtworkPathBounds} from './documentary-artwork-path-bounds.js';

const fixture = () => ({canvas: {width: 1000, height: 562}, motionCoordinates: 'absolute', layers: [
  {id: 'angle-1', kind: 'path', x: 160, y: 281, w: 90, h: 90,
    path: 'M 0 0 L 0 -90 A 90 90 0 0 1 90 0 Z',
    keyframes: [{t: 0, x: 160, y: 281, draw: 0}, {t: 1, x: 175, y: 289, draw: 1}]},
]});

test('negative angle endpoint expands its clip box while preserving world geometry and absolute movement', () => {
  const input = fixture(), before = structuredClone(input);
  const result = normalizeArtworkPathBounds(input) as ReturnType<typeof fixture>;
  const layer = result.layers[0]!;
  assert.deepEqual([layer.x, layer.y, layer.w, layer.h], [160, 191, 90, 180]);
  assert.equal(layer.path, 'M 0 90 L 0 0 A 90 90 0 0 1 90 90 Z');
  assert.deepEqual(layer.keyframes, [{t: 0, x: 160, y: 191, draw: 0}, {t: 1, x: 175, y: 199, draw: 1}]);
  assert.deepEqual([layer.x, layer.y + 90, layer.y, layer.x + 90], [160, 281, 191, 250]);
  assert.equal(layer.keyframes[1]!.y - layer.y, before.layers[0]!.keyframes[1]!.y - before.layers[0]!.y);
  assert.deepEqual(input, before);
  assert.strictEqual(normalizeArtworkPathBounds(result), result, 'revalidation is idempotent');
});

test('absolute control points and H/V endpoints rebase without changing arc radii, flags or implicit M lines', () => {
  const input = fixture();
  input.layers[0]!.path = 'M 0 0 10 10 H -20 V -30 Q -10 -40 20 20 C -5 -50 100 100 120 80 A 300 400 270 1 0 130 0 Z';
  const layer = (normalizeArtworkPathBounds(input) as ReturnType<typeof fixture>).layers[0]!;
  assert.deepEqual([layer.x, layer.y, layer.w, layer.h], [140, 231, 150, 150]);
  assert.equal(layer.path, 'M 20 50 L 30 60 H 0 V 20 Q 10 10 40 70 C 15 0 120 150 140 130 A 300 400 270 1 0 150 50 Z');
  const arcOnly = fixture();arcOnly.layers[0]!.path = 'M0 0 A300 400 270 1 0 90 0';
  assert.strictEqual(normalizeArtworkPathBounds(arcOnly), arcOnly, 'radius and angle are not endpoint bounds');
});

test('relative offsets stay intact and inferred absolute coordinates follow the moved origin', () => {
  const relative = fixture();relative.motionCoordinates = 'relative';
  relative.layers[0]!.keyframes = [{t: 0, x: 0, y: 0, draw: 0}, {t: 1, x: 15, y: 8, draw: 1}];
  assert.deepEqual((normalizeArtworkPathBounds(relative) as ReturnType<typeof fixture>).layers[0]!.keyframes, relative.layers[0]!.keyframes);
  const {motionCoordinates: _, ...inferred} = fixture();
  assert.deepEqual((normalizeArtworkPathBounds(inferred) as ReturnType<typeof fixture>).layers[0]!.keyframes,
    [{t: 0, x: 160, y: 191, draw: 0}, {t: 1, x: 175, y: 199, draw: 1}]);
});

test('ambiguous, malformed, transformed and off-canvas paths are left unchanged', () => {
  for (const path of ['M0 0 l0 -90', 'm0 0 L0 -90', 'M0 0 S0 -90 90 0', 'M0 0 A90 90 0 0 2 90 -90', 'M0 0 L0', 'M0 0 L0 -90 trailing']) {
    const input = fixture();input.layers[0]!.path = path;
    assert.strictEqual(normalizeArtworkPathBounds(input), input, path);
  }
  for (const transform of [{rotation: 15}, {scale: .95}]) {
    const input = fixture();Object.assign(input.layers[0]!.keyframes[0]!, transform);
    assert.strictEqual(normalizeArtworkPathBounds(input), input);
  }
  const offCanvas = fixture();offCanvas.layers[0]!.y = 20;
  assert.strictEqual(normalizeArtworkPathBounds(offCanvas), offCanvas);
});
