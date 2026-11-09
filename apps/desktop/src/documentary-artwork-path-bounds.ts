type RecordValue = Record<string, unknown>;
type Command = 'M' | 'L' | 'H' | 'V' | 'Q' | 'C' | 'A' | 'Z';
type Segment = {command: Command; values: number[]};
const record = (value: unknown): value is RecordValue => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const arity: Record<Command, number> = {M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, A: 7, Z: 0};

/** Deliberately excludes relative, shorthand and malformed SVG instructions. */
function absoluteSegments(path: string): Segment[] | undefined {
  if (path.length > 3200) return;
  const tokens: Array<string | number> = [];
  const token = /[A-Za-z]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/gu;
  let end = 0;
  for (const match of path.matchAll(token)) {
    if (!/^[\s,]*$/u.test(path.slice(end, match.index))) return;
    const raw = match[0];
    tokens.push(/^[A-Za-z]$/u.test(raw) ? raw : Number(raw));
    end = match.index + raw.length;
  }
  if (!/^[\s,]*$/u.test(path.slice(end)) || tokens[0] !== 'M') return;
  const segments: Segment[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index++];
    if (typeof token !== 'string' || !Object.hasOwn(arity, token)) return;
    const command = token as Command, size = arity[command];
    if (!size) {segments.push({command, values: []}); continue;}
    let count = 0;
    while (typeof tokens[index] === 'number') {
      const values = tokens.slice(index, index + size);
      if (values.length !== size || !values.every(finite)) return;
      if (command === 'A' && (values[0]! < 0 || values[1]! < 0
        || ![0, 1].includes(values[3]!) || ![0, 1].includes(values[4]!))) return;
      // Additional coordinate pairs after M are implicit L, not new subpaths.
      segments.push({command: command === 'M' && count ? 'L' : command, values});
      index += size; count++;
    }
    if (!count) return;
  }
  return segments;
}

function coordinateIndices(command: Command): Array<{index: number; axis: 'x' | 'y'}> {
  if (command === 'Z') return [];
  if (command === 'H') return [{index: 0, axis: 'x'}];
  if (command === 'V') return [{index: 0, axis: 'y'}];
  if (command === 'A') return [{index: 5, axis: 'x'}, {index: 6, axis: 'y'}];
  return Array.from({length: arity[command]}, (_, index) => ({index, axis: index % 2 ? 'y' : 'x'}));
}

/** Enlarge an SVG clip box without moving its world-space path or replaying AI. */
export function normalizeArtworkPathBounds(value: unknown): unknown {
  if (!record(value) || !record(value.canvas) || !finite(value.canvas.width) || !finite(value.canvas.height)
    || value.canvas.width <= 0 || value.canvas.height <= 0 || !Array.isArray(value.layers)) return value;
  const canvas = {width: value.canvas.width, height: value.canvas.height};
  let changed = false;
  const layers = value.layers.map((layer: unknown) => {
    if (!record(layer) || layer.kind !== 'path' || typeof layer.path !== 'string'
      || !finite(layer.x) || !finite(layer.y) || !finite(layer.w) || !finite(layer.h) || layer.w <= 0 || layer.h <= 0
      || layer.scale !== undefined && layer.scale !== 1 || layer.rotation !== undefined && layer.rotation !== 0) return layer;
    const keys = layer.keyframes;
    if (keys !== undefined && (!Array.isArray(keys) || keys.some(key => !record(key)
      || key.scale !== undefined && key.scale !== 1 || key.rotation !== undefined && key.rotation !== 0
      || key.x !== undefined && !finite(key.x) || key.y !== undefined && !finite(key.y)))) return layer;
    const segments = absoluteSegments(layer.path);
    if (!segments?.length) return layer;
    // Retain the original box: it may contain intentional space used by labels,
    // camera fitting or the other half of a staged mechanism.
    let minX = 0, minY = 0, maxX = layer.w, maxY = layer.h;
    for (const segment of segments) for (const {index, axis} of coordinateIndices(segment.command)) {
      const coordinate = segment.values[index]!;
      if (axis === 'x') {minX = Math.min(minX, coordinate); maxX = Math.max(maxX, coordinate);}
      else {minY = Math.min(minY, coordinate); maxY = Math.max(maxY, coordinate);}
    }
    if (minX === 0 && minY === 0 && maxX === layer.w && maxY === layer.h) return layer;
    const x = layer.x + minX, y = layer.y + minY, w = maxX - minX, h = maxY - minY;
    if (![x, y, w, h].every(finite) || x < 0 || y < 0 || x + w > canvas.width || y + h > canvas.height) return layer;
    const path = segments.map(segment => {
      const values = [...segment.values];
      for (const {index, axis} of coordinateIndices(segment.command)) values[index] = values[index]! - (axis === 'x' ? minX : minY);
      return `${segment.command}${values.length ? ` ${values.join(' ')}` : ''}`;
    }).join(' ');
    if (path.length > 3200) return layer;
    const absolute = (axis: 'x' | 'y') => value.motionCoordinates === 'absolute'
      || value.motionCoordinates !== 'relative' && layer[axis] !== 0 && keys?.some((key: RecordValue) => key[axis] === layer[axis]);
    const keyframes = keys?.map((key: RecordValue) => ({...key,
      ...(finite(key.x) && absolute('x') ? {x: key.x + minX} : {}),
      ...(finite(key.y) && absolute('y') ? {y: key.y + minY} : {})}));
    changed = true;
    return {...layer, x, y, w, h, path, ...(keyframes ? {keyframes} : {})};
  });
  return changed ? {...value, layers} : value;
}
