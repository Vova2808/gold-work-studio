import {useId, useMemo, type ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import type {DocumentaryArtwork as Artwork, DocumentaryArtworkLayer, DocumentaryLinkedMechanism} from '@gold-work/shared';
import {fitDocumentaryText} from './documentary-typography.js';
import {artworkMediaFraming,artworkViewportGeometry} from './documentary-artwork-media.js';
import {sliderCrankBounds, sliderCrankPose} from './documentary-linked-mechanism.js';

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smooth = (value: number) => value * value * (3 - 2 * value);
const stateKeys = ['x', 'y', 'rotation', 'scale', 'opacity', 'draw'] as const;
type LayerState = Record<(typeof stateKeys)[number], number>;
const initialState: LayerState = {x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, draw: 1};

/** Sparse keys carry their previous values. Geometry and typography never reflow. */
export function artworkLayerState(layer: DocumentaryArtworkLayer, progress: number, moving = true): LayerState {
  let prior = {...initialState};
  const keys = [...(layer.keyframes ?? [])].sort((a, b) => a.t - b.t).map(key => {
    const state = {...prior};
    for (const name of stateKeys) {
      const value = key[name];
      if (typeof value === 'number' && Number.isFinite(value)) state[name] = value;
    }
    prior = state;
    return {t: clamp(key.t), state, ease: key.ease};
  });
  if (!keys.length) return {...initialState};
  if (!moving) {
    // A disabled-motion preview must not freeze on an invisible exit key.
    const visible = [...keys].reverse().find(key => key.state.opacity > 0 && key.state.scale > 0 && key.state.draw > 0);
    // A deliberately hidden layer stays hidden; subdued context keeps its
    // authored opacity instead of competing with the conclusion at Motion 0.
    return visible ? {...visible.state, draw: 1} : {...keys[keys.length - 1]!.state, opacity: 0};
  }
  if (keys[0]!.t > 0) keys.unshift({t: 0, state: {...keys[0]!.state}, ease: keys[0]!.ease});
  const repeats = Math.round(clamp(layer.repeat ?? 1, 1, 8));
  const normalized = clamp(progress);
  const t = normalized === 1 ? 1 : repeats > 1 ? (normalized * repeats) % 1 : normalized;
  let left = keys[0]!;
  let right = keys[keys.length - 1]!;
  for (const key of keys) {
    if (key.t <= t) left = key;
    if (key.t >= t) {right = key; break;}
  }
  const fraction = right.t > left.t ? clamp((t - left.t) / (right.t - left.t)) : 0;
  // Unmarked periodic rotation stays steady; explicit easing still owns its segment.
  const amount = right.ease === 'linear' || repeats > 1 && !right.ease ? fraction
    : right.ease === 'out' ? 1 - (1 - fraction) ** 3 : smooth(fraction);
  const state = {...initialState};
  for (const name of stateKeys) state[name] = left.state[name] + (right.state[name] - left.state[name]) * amount;
  state.opacity = clamp(state.opacity);
  state.draw = clamp(state.draw);
  state.scale = Math.max(0, state.scale);
  return state;
}

function manualTransform(layer: DocumentaryArtworkLayer) {
  const finite = (value: number | undefined, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const edit = layer.editTransform;
  return {x: finite(edit?.x, 0), y: finite(edit?.y, 0), rotation: finite(edit?.rotation, 0),
    scale: edit && Number.isFinite(edit.scale) && edit.scale > 0 ? edit.scale : 1};
}

/** Manual affine transform outside the unchanged animation, including its path. */
function applyManualTransform(layer: DocumentaryArtworkLayer, state: LayerState): LayerState {
  if (!layer.editTransform) return state;
  const edit = manualTransform(layer), angle = edit.rotation * Math.PI / 180;
  return {...state, x: edit.x + edit.scale * (state.x * Math.cos(angle) - state.y * Math.sin(angle)),
    y: edit.y + edit.scale * (state.x * Math.sin(angle) + state.y * Math.cos(angle)),
    rotation: state.rotation + edit.rotation, scale: state.scale * edit.scale};
}

function manualSvgTransform(layer: DocumentaryArtworkLayer) {
  if (!layer.editTransform) return '';
  const edit = manualTransform(layer), cx = layer.x + layer.w / 2, cy = layer.y + layer.h / 2;
  return `translate(${edit.x} ${edit.y}) translate(${cx} ${cy}) rotate(${edit.rotation}) scale(${edit.scale}) translate(${-cx} ${-cy}) `;
}

export function artworkCameraState(artwork: Artwork, progress: number, moving = true):{x:number;y:number;scale:number;rotation?:number} {
  const fallback = {x: artwork.canvas.width / 2, y: artwork.canvas.height / 2, scale: 1};
  const keys = [...(artwork.camera?.keyframes ?? [])].sort((a, b) => a.t - b.t);
  if (!keys.length) return fallback;
  const continuous = artwork.camera?.path === 'continuous';
  const pose = (key: typeof keys[number]) => ({x:key.x,y:key.y,scale:clamp(key.scale,continuous ? .65 : 1,continuous?2.4:1.18),...(continuous?{rotation:clamp(key.rotation??0,-20,20)}:{})});
  const t = clamp(progress);
  if (!moving || t >= keys[keys.length - 1]!.t) {
    const last = keys[keys.length - 1]!;
    return pose(last);
  }
  let left = keys[0]!, right = keys[0]!;
  for (const key of keys) {
    if (key.t <= t) left = key;
    if (key.t >= t) {right = key; break;}
  }
  const amount = right.t > left.t ? smooth(clamp((t - left.t) / (right.t - left.t))) : 0;
  if (continuous) {
    const li=keys.indexOf(left),ri=keys.indexOf(right),dt=right.t-left.t;
    if(dt<=0)return pose(left);
    const u=clamp((t-left.t)/dt),u2=u*u,u3=u2*u;
    const tangent=(index:number,name:'x'|'y'|'scale'|'rotation')=>{
      const key=keys[index]!,explicit=key.velocity?.[name];
      if(explicit!==undefined)return explicit;
      const before=keys[Math.max(0,index-1)]!,after=keys[Math.min(keys.length-1,index+1)]!;
      return after.t>before.t?((after[name]??0)-(before[name]??0))/(after.t-before.t):0;
    };
    const value=(name:'x'|'y'|'scale'|'rotation')=>(2*u3-3*u2+1)*(left[name]??0)+(u3-2*u2+u)*dt*tangent(li,name)
      +(-2*u3+3*u2)*(right[name]??0)+(u3-u2)*dt*tangent(ri,name);
    return {x:clamp(value('x'),0,artwork.canvas.width),y:clamp(value('y'),0,artwork.canvas.height),
      scale:clamp(value('scale'),.65,2.4),rotation:clamp(value('rotation'),-20,20)};
  }
  return {x: left.x + (right.x - left.x) * amount, y: left.y + (right.y - left.y) * amount,
    scale: clamp(left.scale + (right.scale - left.scale) * amount, 1, 1.18)};
}

/** Actions are sparse transforms on the existing normalized clock, before edits. */
export function artworkObjectState(artwork:Artwork,layer:DocumentaryArtworkLayer,progress:number,moving=true):LayerState {
  const state=artworkLayerState(layer,progress,moving);
  for(const action of artwork.actions??[]){
    if(action.layerId!==layer.id)continue;
    const hiddenExit=!moving&&(['opacity','scale','draw'] as const).some(name=>action.to[name]===0);
    const u=moving?clamp((progress-action.start)/(action.end-action.start)):hiddenExit?0:1;
    const amount=action.ease==='linear'?u:action.ease==='out'?1-(1-u)**3:smooth(u);
    for(const name of stateKeys){
      const from=action.from[name],to=action.to[name];
      if(from===undefined||to===undefined)continue;
      // Future actions must not overwrite the earlier action's held result.
      if(progress<action.start&&moving&&(artwork.actions??[]).some(a=>a.layerId===layer.id&&a.end<=action.start&&a.to[name]!==undefined))continue;
      state[name]=from+(to-from)*amount;
    }
  }
  const depth=clamp(layer.depth??0,-1,1);
  if(depth){const camera=artworkCameraState(artwork,progress,moving);
    state.x+=(artwork.canvas.width/2-camera.x)*depth*.18;state.y+=(artwork.canvas.height/2-camera.y)*depth*.18;
    state.scale*=Math.max(.8,1+(camera.scale-1)*depth*.12);}
  return state;
}

function artworkTree(layers: Artwork['layers'], canvas: Artwork['canvas']) {
  const groups = new Set(layers.filter(layer => layer.kind === 'group').map(layer => layer.id));
  const roots: DocumentaryArtworkLayer[] = [];
  const children = new Map<string, DocumentaryArtworkLayer[]>();
  for (const layer of layers) {
    if (layer.parentId && layer.parentId !== layer.id && groups.has(layer.parentId)) {
      const siblings = children.get(layer.parentId) ?? [];
      siblings.push(layer);
      children.set(layer.parentId, siblings);
    } else roots.push(layer);
  }
  for (const [parent, siblings] of children) children.set(parent, orderTextBackplates(siblings, canvas));
  return {roots: orderTextBackplates(roots, canvas), children};
}

function backgroundLayer(layer: DocumentaryArtworkLayer, canvas: Artwork['canvas']) {
  return layer.kind === 'rect' && !layer.parentId && layer.x <= canvas.width * .04 && layer.y <= canvas.height * .04
    && layer.x + layer.w >= canvas.width * .96 && layer.y + layer.h >= canvas.height * .96;
}

function contentBounds(artwork: Artwork, progress: number, moving: boolean, visibleOnly = false, includeEdits = true) {
  const visible = artwork.layers.filter(layer => !backgroundLayer(layer, artwork.canvas) && layer.kind !== 'group');
  if (!visible.length && !artwork.linkedMechanism) return {x: artwork.canvas.width * .2, y: artwork.canvas.height * .2,
    w: artwork.canvas.width * .6, h: artwork.canvas.height * .6};
  const byId = new Map(artwork.layers.map(layer => [layer.id, layer]));
  const states = new Map(artwork.layers.map(layer => {
    const state = artworkObjectState(artwork, layer, progress, moving);
    return [layer.id, includeEdits ? applyManualTransform(layer, state) : state];
  }));
  const points = visible.flatMap(layer => {
    const strokeBounds = !includeEdits && layer.framingBeforeEdit ? layer.framingBeforeEdit : layer;
    const stroked = strokeBounds.stroke !== 'none' && (strokeBounds.stroke !== undefined || layer.kind === 'path' || layer.kind === 'ellipse');
    const edge = stroked ? (strokeBounds.strokeWidth ?? 2) / 2 : 0;
    let corners = [{x: layer.x - edge, y: layer.y - edge}, {x: layer.x + layer.w + edge, y: layer.y - edge},
      {x: layer.x - edge, y: layer.y + layer.h + edge}, {x: layer.x + layer.w + edge, y: layer.y + layer.h + edge}];
    let current: DocumentaryArtworkLayer | undefined = layer;
    const visited = new Set<string>();
    while (current && !visited.has(current.id) && visited.size < 5) {
      visited.add(current.id);
      const state = states.get(current.id)!;
      // Hidden alternatives and invisible entrance/exit poses cannot shrink
      // the whole composition. Check ancestors too: their opacity/draw is
      // inherited by all children, even when a child's own keys are visible.
      if (visibleOnly && (state.opacity <= 0 || state.scale <= 0 || state.draw <= 0)) return [];
      const cx = current.x + current.w / 2, cy = current.y + current.h / 2;
      const radians = state.rotation * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
      corners = corners.map(point => {
        const x = (point.x - cx) * state.scale, y = (point.y - cy) * state.scale;
        return {x: cx + x * cosine - y * sine + state.x, y: cy + x * sine + y * cosine + state.y};
      });
      const parent: DocumentaryArtworkLayer | undefined = current.parentId ? byId.get(current.parentId) : undefined;
      current = parent?.kind === 'group' ? parent : undefined;
    }
    return corners;
  });
  if (artwork.linkedMechanism) {
    const box = sliderCrankBounds(artwork.linkedMechanism);
    points.push({x: box.x, y: box.y}, {x: box.x + box.w, y: box.y + box.h});
  }
  if (!points.length) return {x: 0, y: 0, w: 0, h: 0};
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
  return {x, y, w: Math.max(...points.map(point => point.x)) - x, h: Math.max(...points.map(point => point.y)) - y};
}

/** One scene-wide correction, outside the camera, keeps connected parts together. */
export function artworkTrajectoryFit(artwork: Artwork) {
  const {width, height} = artwork.canvas;
  const phases = new Set<number>(Array.from({length: 257}, (_, index) => index / 256));
  const keyPhases = new Set<number>();
  for (const layer of artwork.layers) {
    const repeats = Math.round(clamp(layer.repeat ?? 1, 1, 8));
    for (const key of layer.keyframes ?? []) {
      for (let cycle = 0; cycle < repeats; cycle++) {
        const phase = clamp((cycle + key.t) / repeats);
        keyPhases.add(phase);
        // A loop's outgoing pose is distinct from its reset pose at the same time.
        if (repeats > 1 && phase > 0) keyPhases.add(Math.max(0, phase - 1e-7));
      }
    }
  }
  for (const key of artwork.camera?.keyframes ?? []) keyPhases.add(clamp(key.t));
  for (const action of artwork.actions ?? []) {keyPhases.add(action.start);keyPhases.add(action.end);}
  const ordered = [...keyPhases].sort((a, b) => a - b);
  // Bound the work even for 96-layer drawings with independently repeated parts.
  if (ordered.length <= 256) for (const phase of ordered) phases.add(phase);
  else for (let index = 0; index < 256; index++) phases.add(ordered[Math.round(index * (ordered.length - 1) / 255)]!);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const include = (progress: number, moving: boolean) => {
    // Keep authored framing fixed: manual transforms or stroke edits must not
    // be cancelled by a new scene-wide fit or displace every other object.
    const bounds = contentBounds(artwork, progress, moving, true, false);
    if (!bounds.w || !bounds.h) return;
    const camera = artworkCameraState(artwork, progress, moving);
    const angle=-(camera.rotation??0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    for(const point of [{x:bounds.x,y:bounds.y},{x:bounds.x+bounds.w,y:bounds.y},{x:bounds.x,y:bounds.y+bounds.h},{x:bounds.x+bounds.w,y:bounds.y+bounds.h}]){
      const dx=(point.x-camera.x)*camera.scale,dy=(point.y-camera.y)*camera.scale;
      const x=width/2+dx*c-dy*s,y=height/2+dx*s+dy*c;
      left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
    }
  };
  for (const phase of phases) include(phase, true);
  // Motion zero can combine the last visible poses of different objects.
  include(1, false);
  if (!Number.isFinite(left)) return {scale: 1, x: 0, y: 0};
  const scale = Math.min(1, width / Math.max(1, right - left), height / Math.max(1, bottom - top));
  // Existing region padding is the safe area; do not add another arbitrary inset.
  return {scale, x: clamp(0, -left * scale, width - right * scale),
    y: clamp(0, -top * scale, height - bottom * scale)};
}

function color(value: string | undefined, palette: Artwork['palette'], fallback: string): string {
  if (value === 'none') return 'none';
  if (value && /^#[\da-f]{3,8}$/iu.test(value)) return value;
  if (value && Object.hasOwn(palette, value)) return palette[value as keyof Artwork['palette']];
  return fallback;
}

function rgb(value: string): number[] | undefined {
  const hex = value.replace(/^#/u, '');
  const expanded = hex.length === 3 ? [...hex].map(part => part + part).join('') : hex;
  if (!/^[\da-f]{6}$/iu.test(expanded)) return undefined;
  return [0, 2, 4].map(offset => parseInt(expanded.slice(offset, offset + 2), 16));
}

function shade(value: string, amount: number) {
  const channels = rgb(value);
  if (!channels) return value;
  return `#${channels.map(channel => Math.round(channel + ((amount > 0 ? 255 : 0) - channel) * Math.abs(amount)).toString(16).padStart(2, '0')).join('')}`;
}

function translucent(value: string, opacity: number) {
  const channels = rgb(value) ?? [16, 24, 32];
  return `rgba(${channels.join(',')},${opacity})`;
}

function luminance(value: string): number | undefined {
  const hex = value.replace(/^#/u, '');
  const expanded = hex.length === 3 ? [...hex].map(part => part + part).join('') : hex;
  if (!/^[\da-f]{6}$/iu.test(expanded)) return undefined;
  const channels = [0, 2, 4].map(offset => {
    const channel = parseInt(expanded.slice(offset, offset + 2), 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
}

type TextBackdrop = {colors: string[]; uncertain: boolean} | undefined;

function layerCorners(layer: DocumentaryArtworkLayer, state: LayerState) {
  const cx = layer.x + layer.w / 2, cy = layer.y + layer.h / 2;
  const angle = state.rotation * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
  return [[layer.x, layer.y], [layer.x + layer.w, layer.y],
    [layer.x, layer.y + layer.h], [layer.x + layer.w, layer.y + layer.h]].map(([px, py]) => {
    const x = (px! - cx) * state.scale, y = (py! - cy) * state.scale;
    return {x: cx + x * cosine - y * sine + state.x, y: cy + x * sine + y * cosine + state.y};
  });
}

function coversLayer(plate: DocumentaryArtworkLayer, plateState: LayerState, layer: DocumentaryArtworkLayer, state: LayerState) {
  if (plateState.scale <= 0) return false;
  const cx = plate.x + plate.w / 2, cy = plate.y + plate.h / 2;
  const angle = -plateState.rotation * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
  const radius = clamp(plate.radius ?? 0, 0, Math.min(plate.w, plate.h) / 2);
  return layerCorners(layer, state).every(point => {
    const dx = point.x - cx - plateState.x, dy = point.y - cy - plateState.y;
    const x = cx + (dx * cosine - dy * sine) / plateState.scale;
    const y = cy + (dx * sine + dy * cosine) / plateState.scale;
    if (x < plate.x - 1e-6 || x > plate.x + plate.w + 1e-6 || y < plate.y - 1e-6 || y > plate.y + plate.h + 1e-6) return false;
    const cornerX = x - clamp(x, plate.x + radius, plate.x + plate.w - radius);
    const cornerY = y - clamp(y, plate.y + radius, plate.y + plate.h - radius);
    return cornerX * cornerX + cornerY * cornerY <= radius * radius + 1e-6;
  });
}

function textPlateLabels(layer: DocumentaryArtworkLayer, siblings: DocumentaryArtworkLayer[], canvas: Artwork['canvas']) {
  if (layer.kind !== 'rect' || layer.fill === 'none' || layer.w * layer.h > canvas.width * canvas.height * .35) return [];
  const contained = siblings.filter(candidate => candidate !== layer && coversLayer(layer, applyManualTransform(layer, initialState), candidate, applyManualTransform(candidate, initialState)));
  return contained.some(candidate => candidate.kind !== 'text') ? [] : contained.filter(candidate => candidate.kind === 'text');
}

/** Repair only an unambiguous text plate painted after its own label. All other
 * siblings retain their relative paint order, including media and subject parts. */
function orderTextBackplates(siblings: DocumentaryArtworkLayer[], canvas: Artwork['canvas']) {
  const before = new Map<string, DocumentaryArtworkLayer[]>(), moved = new Set<string>();
  for (const layer of siblings) {
    const first = textPlateLabels(layer, siblings, canvas)[0];
    if (!first || siblings.indexOf(first) > siblings.indexOf(layer)) continue;
    const plates = before.get(first.id) ?? [];
    plates.push(layer); before.set(first.id, plates); moved.add(layer.id);
  }
  return siblings.flatMap(layer => [...(before.get(layer.id) ?? []), ...(moved.has(layer.id) ? [] : [layer])]);
}

/** Only a small, text-only backplate follows its labels; object geometry keeps its own choreography. */
function textPlateOpacity(layer: DocumentaryArtworkLayer, siblings: DocumentaryArtworkLayer[], states: Map<string, LayerState>, canvas: Artwork['canvas']) {
  const opacity = states.get(layer.id)!.opacity;
  const labels = textPlateLabels(layer, siblings, canvas);
  return labels.length ? opacity * Math.max(...labels.map(label => states.get(label.id)!.opacity)) : opacity;
}

/** Evaluate only earlier siblings: a common parent transform applies equally to label and plate. */
function localTextBackdrop(layer: DocumentaryArtworkLayer, siblings: DocumentaryArtworkLayer[], states: Map<string, LayerState>,
  palette: Artwork['palette'], canvas: Artwork['canvas'], inherited: TextBackdrop, inheritedDraw: number): TextBackdrop {
  let backdrop = inherited;
  const state = states.get(layer.id)!;
  const corners = layerCorners(layer, state);
  for (const candidate of siblings) {
    if (candidate === layer) break;
    const candidateState = states.get(candidate.id)!;
    if (candidate.kind === 'media') {
      const media = layerCorners(candidate, candidateState);
      if (Math.min(...corners.map(point => point.x)) < Math.max(...media.map(point => point.x))
        && Math.max(...corners.map(point => point.x)) > Math.min(...media.map(point => point.x))
        && Math.min(...corners.map(point => point.y)) < Math.max(...media.map(point => point.y))
        && Math.max(...corners.map(point => point.y)) > Math.min(...media.map(point => point.y))) backdrop = undefined;
      continue;
    }
    if (candidate.kind !== 'rect') continue;
    const foreground = rgb(color(candidate.fill, palette, palette.secondary));
    const alpha = textPlateOpacity(candidate, siblings, states, canvas) * candidateState.draw * inheritedDraw;
    if (!foreground || alpha <= 0) continue;
    if (!coversLayer(candidate, candidateState, layer, state)) {
      // A rounded plate may cover the glyphs but not the empty corners of their
      // layout box. Partial coverage cannot justify recoloring against the canvas.
      const plate = layerCorners(candidate, candidateState);
      if (Math.min(...corners.map(point => point.x)) < Math.max(...plate.map(point => point.x))
        && Math.max(...corners.map(point => point.x)) > Math.min(...plate.map(point => point.x))
        && Math.min(...corners.map(point => point.y)) < Math.max(...plate.map(point => point.y))
        && Math.max(...corners.map(point => point.y)) > Math.min(...plate.map(point => point.y))) backdrop = undefined;
      continue;
    }
    const backgrounds = backdrop?.colors ?? ['#000000', '#ffffff'];
    backdrop = {uncertain: alpha < .999 && (backdrop?.uncertain ?? true), colors: backgrounds.map(background => {
      const channels = rgb(background) ?? [0, 0, 0];
      return `#${foreground.map((channel, index) => Math.round(channel * alpha + channels[index]! * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`;
    })};
  }
  return backdrop;
}

/** Unknown source pixels cannot justify recoloring authored labels against the outer canvas. */
function readableTextColor(fill: string, palette: Artwork['palette'], backdrop: TextBackdrop): string {
  if (!backdrop || fill === 'none') return fill;
  const backgrounds = backdrop.colors.map(luminance).filter((value): value is number => value !== undefined);
  if (!backgrounds.length) return fill;
  const contrast = (candidate: string) => {
    const light = luminance(candidate);
    return light === undefined ? 1 : Math.min(...backgrounds.map(background => (Math.max(light, background) + .05) / (Math.min(light, background) + .05)));
  };
  if (contrast(fill) >= 4.5) return fill;
  const best = [palette.ink, '#ffffff', '#111111'].reduce((best, candidate) => contrast(candidate) > contrast(best) ? candidate : best, fill);
  // During a translucent entrance, keep the authored polarity unless a replacement
  // is demonstrably readable over every possible source color.
  return backdrop.uncertain && contrast(best) < 4.5 ? fill : best;
}

function ArtworkText({layer, fill}: {layer: DocumentaryArtworkLayer; fill: string}) {
  const text = layer.text ?? '';
  const weight = layer.weight ?? 500;
  const {fontSize, lines} = useMemo(() => {
    const size = Math.max(18, fitDocumentaryText(text, Math.max(18, layer.fontSize ?? 44),
      Math.max(1, layer.w - 4), Math.max(1, layer.h - 4), weight));
    return {fontSize: size, lines: Math.max(1, Math.floor((layer.h - 4) / (size * 1.15)))};
  }, [text, layer.fontSize, layer.w, layer.h, weight]);
  return <foreignObject x={layer.x} y={layer.y} width={layer.w} height={layer.h} overflow="hidden">
    <div style={{width: '100%', height: '100%', boxSizing: 'border-box', padding: 2, overflow: 'hidden',
      display: 'flex', alignItems: 'center', fontFamily: 'Arial, sans-serif', fontSize, fontWeight: weight,
      lineHeight: 1.15, color: fill === 'none' ? 'transparent' : fill, textAlign: layer.align ?? 'left'}}>
      <div style={{width: '100%', minWidth: 0, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines,
        maxHeight: lines * fontSize * 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{text}</div>
    </div>
  </foreignObject>;
}

function ArtworkLayer({layer, palette, canvas, states, siblings, backdrop, children, inheritedDraw = 1, inheritedShading = false, depth = 0}: {
  layer: DocumentaryArtworkLayer; palette: Artwork['palette']; canvas: Artwork['canvas']; states: Map<string, LayerState>;
  siblings: DocumentaryArtworkLayer[]; backdrop: TextBackdrop;
  children: Map<string, DocumentaryArtworkLayer[]>; inheritedDraw?: number; inheritedShading?: boolean; depth?: number;
}) {
  const id = useId().replace(/[^\w-]/gu, '');
  const clipId = `artwork-path-${id}`, gradientId = `artwork-shading-${id}`, shadowId = `artwork-shadow-${id}`;
  const state = states.get(layer.id)!;
  const draw = inheritedDraw * state.draw;
  const shading = layer.shading === 'soft' || inheritedShading;
  const authoredFill = color(layer.fill, palette, layer.kind === 'text' ? palette.ink : layer.kind === 'rect' ? palette.secondary : 'none');
  const localBackdrop = layer.kind === 'text' || layer.kind === 'group'
    ? localTextBackdrop(layer, siblings, states, palette, canvas, backdrop, inheritedDraw) : backdrop;
  const fill = layer.kind === 'text' && layer.fillOrigin !== 'manual' ? readableTextColor(authoredFill, palette, localBackdrop) : authoredFill;
  const shaded = shading && layer.kind !== 'text' && layer.kind !== 'group' && fill !== 'none';
  const stroke = color(layer.stroke, palette, layer.kind === 'path' || layer.kind === 'ellipse' ? palette.ink : 'none');
  const cx = layer.x + layer.w / 2;
  const cy = layer.y + layer.h / 2;
  const strokeWidth = layer.strokeWidth ?? 2;
  const shadowSize = clamp(Math.min(layer.w, layer.h) * .014, 1.5, 5);
  const shapeProps = {fill: shaded ? `url(#${gradientId})` : fill, stroke, strokeWidth,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    ...(draw > 0 && draw < .999 ? {pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - draw} : {}),
    strokeOpacity: draw <= 0 ? 0 : 1, fillOpacity: draw};
  return <g data-artwork-layer={layer.id} opacity={textPlateOpacity(layer, siblings, states, canvas)}
    filter={layer.shadow ? `url(#${shadowId})` : undefined}
    transform={`translate(${state.x} ${state.y}) translate(${cx} ${cy}) rotate(${state.rotation}) scale(${state.scale}) translate(${-cx} ${-cy})`}>
    {(shaded || layer.shadow) && <defs>
      {shaded && <linearGradient id={gradientId} x1="0%" y1="0%" x2="65%" y2="100%">
        <stop offset="0%" stopColor={shade(fill, .13)}/><stop offset="48%" stopColor={fill}/><stop offset="100%" stopColor={shade(fill, -.16)}/>
      </linearGradient>}
      {layer.shadow && <filter id={shadowId} x="-25%" y="-25%" width="150%" height="155%" colorInterpolationFilters="sRGB">
        <feDropShadow dx={0} dy={shadowSize} stdDeviation={shadowSize * .65} floodColor="#000000" floodOpacity={.18}/>
      </filter>}
    </defs>}
    {layer.kind === 'path' && <g transform={`translate(${layer.x} ${layer.y})`}>
      <defs><clipPath id={clipId}><rect x={-strokeWidth} y={-strokeWidth} width={layer.w + strokeWidth * 2} height={layer.h + strokeWidth * 2}/></clipPath></defs>
      <path {...shapeProps} d={layer.path} clipPath={`url(#${clipId})`}/>
    </g>}
    {layer.kind === 'rect' && <rect {...shapeProps} x={layer.x} y={layer.y} width={layer.w} height={layer.h}
      rx={Math.min(layer.radius ?? 0, layer.w / 2, layer.h / 2)}/>}
    {layer.kind === 'ellipse' && <ellipse {...shapeProps} cx={cx} cy={cy} rx={layer.w / 2} ry={layer.h / 2}/>}
    {layer.kind === 'text' && <g opacity={draw}><ArtworkText layer={layer} fill={fill}/></g>}
    {layer.kind === 'group' && depth < 4 && children.get(layer.id)?.map(child => <ArtworkLayer key={child.id} layer={child}
      palette={palette} canvas={canvas} states={states} siblings={children.get(layer.id)!} backdrop={localBackdrop}
      children={children} inheritedDraw={draw} inheritedShading={shading} depth={depth + 1}/>)}
  </g>;
}

/** Keep one mounted source while its box moves between the film and the authored composition. */
function ArtworkMedia({layer, palette, material, progress, moving, stage, fullBox, cameraTransform, sourceAspect,authoredViewport=false,actualVariant='original'}: {
  layer: DocumentaryArtworkLayer; palette: Artwork['palette']; material: ReactNode;
  progress: number; moving: boolean; stage: number;
  fullBox: {x: number; y: number; w: number; h: number};
  cameraTransform: {x: number; y: number; scale: number};
  sourceAspect: number;
  authoredViewport?:boolean;actualVariant?:'original'|'foreground';
}) {
  const id = useId().replace(/[^\w-]/gu, '');
  const state = artworkLayerState(layer, progress, moving);
  const blend = (from: number, to: number) => from + (to - from) * stage;
  // Invert the shared camera/fit only for the full-frame endpoint. The middle pose
  // uses the same canvas, camera and keyframes as the surrounding illustration.
  const box = authoredViewport?{x:layer.x,y:layer.y,w:layer.w,h:layer.h}:{x: blend((fullBox.x - cameraTransform.x) / cameraTransform.scale, layer.x),
    y: blend((fullBox.y - cameraTransform.y) / cameraTransform.scale, layer.y),
    w: blend(fullBox.w / cameraTransform.scale, layer.w), h: blend(fullBox.h / cameraTransform.scale, layer.h)};
  // Preserve the current scene's framing. A differently shaped authored box must
  // not introduce another crop through the source's existing cover/contain fit.
  const sourceWidth = Math.min(box.w, box.h * sourceAspect), sourceHeight = sourceWidth / sourceAspect;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const radius = Math.min(layer.radius ?? 0, box.w / 2, box.h / 2) * stage;
  const stroke = color(layer.stroke, palette, 'none');
  const shadowId = `artwork-media-shadow-${id}`;
  const shadowSize = clamp(Math.min(layer.w, layer.h) * .014, 1.5, 5);
  const viewport=artworkViewportGeometry(box,sourceAspect,actualVariant==='original'?layer.sourceWindow:undefined);
  return <g data-artwork-layer={layer.id} data-artwork-media="visible" data-artwork-variant={authoredViewport?actualVariant:undefined} opacity={authoredViewport?state.opacity:1}
    transform={`${manualSvgTransform(layer)}translate(${state.x * stage} ${state.y * stage}) translate(${cx} ${cy}) rotate(${state.rotation * stage}) scale(${blend(1, state.scale)}) translate(${-cx} ${-cy})`}>
    {layer.shadow && <defs><filter id={shadowId} x="-25%" y="-25%" width="150%" height="155%" colorInterpolationFilters="sRGB">
      <feDropShadow dx={0} dy={shadowSize} stdDeviation={shadowSize * .65} floodColor="#000000" floodOpacity={.18 * stage}/>
    </filter></defs>}
    <g filter={layer.shadow ? `url(#${shadowId})` : undefined}>
      <foreignObject data-artwork-source-box="true" x={box.x} y={box.y} width={box.w} height={box.h} overflow="hidden">
        <div data-artwork-material="authored-media" style={{position: 'relative', width: '100%', height: '100%',
          overflow: 'hidden', borderRadius: layer.clip==='ellipse'?'50%':radius, backgroundColor: actualVariant==='foreground'?'transparent':palette.background}}>
          {authoredViewport?<div data-artwork-source-window={layer.sourceWindow?'detail':'whole'} style={{position:'absolute',left:viewport.frame.x,top:viewport.frame.y,width:viewport.frame.w,height:viewport.frame.h,overflow:'hidden'}}>
            <div style={{position:'absolute',left:viewport.source.x,top:viewport.source.y,width:viewport.source.w,height:viewport.source.h}}>{material}</div>
          </div>:<div data-artwork-source-frame="uncropped" style={{position: 'absolute', left: (box.w - sourceWidth) / 2,
            top: (box.h - sourceHeight) / 2, width: sourceWidth, height: sourceHeight, overflow: 'hidden'}}>{material}</div>}
        </div>
      </foreignObject>
      {layer.clip==='ellipse'?<ellipse cx={cx} cy={cy} rx={box.w/2} ry={box.h/2} fill="none" stroke={stroke} strokeWidth={layer.strokeWidth??2} strokeOpacity={stage*state.draw}/>
        :<rect x={box.x} y={box.y} width={box.w} height={box.h} rx={radius} fill="none" stroke={stroke}
          strokeWidth={layer.strokeWidth ?? 2} strokeOpacity={stage * state.draw} pointerEvents="none"/>}
    </g>
  </g>;
}

function LinkedMechanism({mechanism, palette, progress, moving}: {
  mechanism: DocumentaryLinkedMechanism; palette: Artwork['palette']; progress: number; moving: boolean;
}) {
  const pose = sliderCrankPose(mechanism, progress, moving);
  const {center, crankPin, wristPin, piston} = pose;
  const side = mechanism.pistonWidth / 2 + 20;
  const top = center.y - mechanism.crankRadius - mechanism.rodLength - mechanism.pistonHeight * .58 - 24;
  const bottom = center.y + mechanism.crankRadius - mechanism.rodLength + mechanism.pistonHeight * .42 + 24;
  const flywheelRadius = mechanism.crankRadius + 18;
  const forceX = center.x + side + 31;
  const forceOpacity = moving ? smooth(clamp((progress - (mechanism.annotations?.forceAt ?? .18)) / .17)) : 1;
  const torqueOpacity = moving ? smooth(clamp((progress - (mechanism.annotations?.torqueAt ?? .52)) / .17)) : 1;
  const torqueRadius = flywheelRadius + 25;
  return <g data-artwork-mechanism="slider-crank" data-wrist-pin={`${wristPin.x},${wristPin.y}`}
    data-crank-pin={`${crankPin.x},${crankPin.y}`} strokeLinecap="round" strokeLinejoin="round">
    <path d={`M ${center.x-side} ${bottom} V ${top+15} Q ${center.x-side} ${top} ${center.x-side+15} ${top}
      H ${center.x+side-15} Q ${center.x+side} ${top} ${center.x+side} ${top+15} V ${bottom}`}
      fill="none" stroke={palette.secondary} strokeWidth={12}/>
    <path d={`M ${center.x-side+12} ${top+12} V ${bottom-9} M ${center.x+side-12} ${top+12} V ${bottom-9}`}
      fill="none" stroke={palette.ink} strokeOpacity={.28} strokeWidth={2}/>
    <circle cx={center.x} cy={center.y} r={flywheelRadius} fill={palette.background} stroke={palette.secondary} strokeWidth={10}/>
    <circle cx={center.x} cy={center.y} r={mechanism.crankRadius} fill="none" stroke={palette.ink} strokeOpacity={.28} strokeWidth={2}/>
    <path d={`M ${center.x} ${center.y} L ${crankPin.x} ${crankPin.y}`} stroke={palette.accent} strokeWidth={20}/>
    <path d={`M ${wristPin.x} ${wristPin.y} L ${crankPin.x} ${crankPin.y}`}
      stroke={palette.ink} strokeWidth={27}/>
    <path d={`M ${wristPin.x} ${wristPin.y} L ${crankPin.x} ${crankPin.y}`}
      stroke={palette.secondary} strokeWidth={14}/>
    <rect x={piston.x} y={piston.y} width={piston.width} height={piston.height} rx={9}
      fill={palette.secondary} stroke={palette.ink} strokeWidth={4}/>
    <path d={`M ${piston.x+5} ${piston.y+13} H ${piston.x+piston.width-5}
      M ${piston.x+5} ${piston.y+22} H ${piston.x+piston.width-5}`}
      stroke={palette.ink} strokeWidth={3}/>
    <circle cx={wristPin.x} cy={wristPin.y} r={12} fill={palette.background} stroke={palette.ink} strokeWidth={5}/>
    <circle cx={crankPin.x} cy={crankPin.y} r={13} fill={palette.background} stroke={palette.ink} strokeWidth={5}/>
    <circle cx={center.x} cy={center.y} r={13} fill={palette.background} stroke={palette.ink} strokeWidth={5}/>
    {mechanism.annotations?.reciprocatingForce && <g data-mechanism-annotation="reciprocating-force"
      data-force-anchor={`${forceX},${wristPin.y}`} opacity={forceOpacity} fill="none" stroke={palette.secondary} strokeWidth={5}>
      <path d={`M ${forceX} ${wristPin.y-38} V ${wristPin.y+38}`}/>
      <path d={`M ${forceX-9} ${wristPin.y-27} L ${forceX} ${wristPin.y-39} L ${forceX+9} ${wristPin.y-27}
        M ${forceX-9} ${wristPin.y+27} L ${forceX} ${wristPin.y+39} L ${forceX+9} ${wristPin.y+27}`}/>
    </g>}
    {mechanism.annotations?.crankTorque && <g data-mechanism-annotation="crank-torque"
      data-torque-anchor={`${center.x},${center.y}`} opacity={torqueOpacity} fill="none" stroke={palette.accent} strokeWidth={5}>
      <path d={`M ${center.x} ${center.y-torqueRadius} A ${torqueRadius} ${torqueRadius} 0 0 1
        ${center.x+torqueRadius} ${center.y}`}/>
      <path d={`M ${center.x+torqueRadius-10} ${center.y-16} L ${center.x+torqueRadius} ${center.y}
        L ${center.x+torqueRadius+10} ${center.y-16}`}/>
    </g>}
  </g>;
}

export interface DocumentaryArtworkProps {
  artwork: Artwork;
  frame: number;
  frames: number;
  material: ReactNode;
  materials?:Record<string,{material:ReactNode;sourceAspect:number;actualVariant:'original'|'foreground'}>;
  moving: boolean;
  width: number;
  height: number;
  sourceAspect?: number;
  sourceFit?: 'contain' | 'cover';
  /** Keep one shared artwork clock visible across scene boundaries. */
  skipEdgeFade?: boolean;
}

/** Model-authored choreography, with one large original source in or behind the artwork. */
export function DocumentaryArtwork({artwork: authored, frame, frames, material,materials, moving, width, height, sourceAspect, sourceFit = 'cover', skipEdgeFade = false}: DocumentaryArtworkProps) {
  const mediaLayers=authored.layers.filter(layer=>layer.kind==='media');
  const authoredViewports=mediaLayers.length>1||mediaLayers.some(layer=>layer.sourceSceneId||layer.sourceVariant||layer.sourceWindow||layer.clip);
  const sourceLayer = authored.layout === 'full' ? authored.layers.find(layer => layer.kind === 'media' && !layer.parentId) : undefined;
  const framing = useMemo(() => !authoredViewports&&sourceLayer && Number.isFinite(sourceAspect) && sourceAspect! > 0
    ? artworkMediaFraming(sourceLayer, authored.canvas, width / height, sourceAspect, sourceFit) : undefined,
    [authoredViewports,sourceLayer, authored.canvas, width, height, sourceAspect, sourceFit]);
  const artwork = useMemo(() => framing && sourceLayer ? {...authored,
    layers: authored.layers.map(layer => layer === sourceLayer ? {...layer, ...framing.box} : layer)} : authored, [authored, sourceLayer, framing]);
  const tree = useMemo(() => artworkTree(artwork.layers, artwork.canvas), [artwork.layers, artwork.canvas]);
  const mediaLayer = artwork.layout === 'full' ? tree.roots.find(layer => layer.kind === 'media') : undefined;
  const roots = useMemo(() => {
    if (!mediaLayer) return tree.roots.filter(layer => artwork.layout === 'full' || !backgroundLayer(layer, artwork.canvas));
    if(authoredViewports)return [...tree.roots.filter(layer=>backgroundLayer(layer,artwork.canvas)),...tree.roots.filter(layer=>!backgroundLayer(layer,artwork.canvas))];
    const sourceBackdropBox = sourceLayer ?? mediaLayer;
    const backplate = (layer: DocumentaryArtworkLayer) => backgroundLayer(layer, artwork.canvas)
      || layer.kind === 'rect' && layer.fill !== 'none' && layer.x <= sourceBackdropBox.x && layer.y <= sourceBackdropBox.y
        && layer.x + layer.w >= sourceBackdropBox.x + sourceBackdropBox.w && layer.y + layer.h >= sourceBackdropBox.y + sourceBackdropBox.h;
    // Model JSON order must not bury evidence under its backdrop or bury labels
    // under the single opaque source. Preserve order within the editorial layers.
    return [...tree.roots.filter(layer => backgroundLayer(layer, artwork.canvas)),
      ...tree.roots.filter(layer => backplate(layer) && !backgroundLayer(layer, artwork.canvas)), mediaLayer,
      ...tree.roots.filter(layer => layer !== mediaLayer && !backplate(layer))];
  }, [tree, mediaLayer, sourceLayer, artwork.layout, artwork.canvas,authoredViewports]);
  const trajectory = useMemo(() => artworkTrajectoryFit(artwork), [artwork]);
  const progress = clamp(frame / Math.max(1, frames - 1));
  const states = useMemo(() => new Map(artwork.layers.map(layer => [layer.id, applyManualTransform(layer, artworkObjectState(artwork,layer, progress, moving))])), [artwork, progress, moving]);
  const bounds = useMemo(() => contentBounds(artwork, progress, moving), [artwork, progress, moving]);
  if (frame < 0 || frame >= frames) return null;
  if(authoredViewports&&mediaLayers.some(layer=>!materials?.[layer.id]))throw Error('Artwork media asset не подготовлен.');
  const camera = artworkCameraState(artwork, progress, moving);
  const side = artwork.layout === 'left' || artwork.layout === 'right';
  const portrait = height > width;
  const region = side
    ? portrait ? {x: 0, y: height * .48, width, height: height * .52}
      : {x: artwork.layout === 'left' ? 0 : width * .48, y: 0, width: width * .52, height}
    : {x: 0, y: 0, width, height};
  const padding = Math.min(region.width, region.height) * (framing?.paddingFraction ?? .035);
  const innerWidth = region.width - 2 * padding;
  const innerHeight = region.height - 2 * padding;
  const fitScale = Math.min(innerWidth / artwork.canvas.width, innerHeight / artwork.canvas.height);
  const offsetX = padding + (innerWidth - artwork.canvas.width * fitScale) / 2;
  const offsetY = padding + (innerHeight - artwork.canvas.height * fitScale) / 2;
  const cameraTransform = {scale: trajectory.scale * camera.scale,
    x: trajectory.x + trajectory.scale * (artwork.canvas.width / 2 - camera.x * camera.scale),
    y: trajectory.y + trajectory.scale * (artwork.canvas.height / 2 - camera.y * camera.scale)};
  const scrimWidth = Math.max(bounds.w * 1.4, artwork.canvas.width * .35) * fitScale * camera.scale * trajectory.scale;
  const scrimHeight = Math.max(bounds.h * 1.5, artwork.canvas.height * .35) * fitScale * camera.scale * trajectory.scale;
  const scrimX = offsetX + (trajectory.x + (artwork.canvas.width / 2 + (bounds.x + bounds.w / 2 - camera.x) * camera.scale) * trajectory.scale) * fitScale - scrimWidth / 2;
  const scrimY = offsetY + (trajectory.y + (artwork.canvas.height / 2 + (bounds.y + bounds.h / 2 - camera.y) * camera.scale) * trajectory.scale) * fitScale - scrimHeight / 2;
  const background = artwork.palette.background;
  // A standalone illustration replaces the shot. Fading its entire contents
  // leaves only its opaque backdrop at the cut; its authored layer keys already
  // control entrances and exits without introducing an empty frame.
  const standalone = artwork.layout === 'full' && !artwork.layers.some(layer => layer.kind === 'media');
  const edgeFade = moving && !skipEdgeFade && !standalone&&!authoredViewports;
  const enter = edgeFade ? smooth(clamp(frame / Math.min(8, Math.max(1, frames * .08)))) : 1;
  const leave = edgeFade ? smooth(clamp((frames - 1 - frame) / Math.min(6, Math.max(1, frames * .06)))) : 1;
  const opacity = Math.min(enter, leave);
  return <AbsoluteFill style={{overflow: 'hidden', backgroundColor: mediaLayer ? background : undefined}}>
    {!mediaLayer && <AbsoluteFill data-artwork-material="full-frame">{material}</AbsoluteFill>}
    <div data-artwork-region={artwork.layout} style={{position: 'absolute', left: region.x, top: region.y,
      width: region.width, height: region.height, opacity: mediaLayer ? 1 : opacity, overflow: 'hidden'}}>
      {artwork.layout === 'overlay'
        ? <div data-artwork-scrim="local" style={{position: 'absolute', left: scrimX, top: scrimY, width: scrimWidth, height: scrimHeight,
          background: `radial-gradient(ellipse at center, ${translucent(background, .64)} 0%, ${translucent(background, .52)} 45%, ${translucent(background, 0)} 74%)`}}/>
        : <AbsoluteFill style={side
          ? {background: `linear-gradient(${portrait ? '0deg' : artwork.layout === 'left' ? '90deg' : '270deg'}, ${background} 0%, ${background} 86%, ${translucent(background, 0)} 100%)`}
          : {backgroundColor: background}}/>}
      <svg width={innerWidth} height={innerHeight} viewBox={`0 0 ${artwork.canvas.width} ${artwork.canvas.height}`}
        preserveAspectRatio="xMidYMid meet" aria-hidden="true" style={{position: 'absolute', left: padding, top: padding, overflow: mediaLayer ? 'visible' : 'hidden'}}>
        <g data-artwork-trajectory="fixed" transform={`translate(${trajectory.x} ${trajectory.y}) scale(${trajectory.scale})`}>
          <g data-artwork-camera="true" transform={`translate(${artwork.canvas.width / 2} ${artwork.canvas.height / 2}) ${camera.rotation?`rotate(${-camera.rotation}) `:''}scale(${camera.scale}) translate(${-camera.x} ${-camera.y})`}>
            {roots.map(layer =>
              layer.kind==='media'
                ? <ArtworkMedia key={layer.id} layer={layer} palette={artwork.palette} material={authoredViewports?materials![layer.id]!.material:material} progress={progress} moving={moving}
                  stage={opacity} cameraTransform={cameraTransform} sourceAspect={authoredViewports?materials![layer.id]!.sourceAspect:framing?.aspect ?? width / height}
                  authoredViewport={authoredViewports} actualVariant={materials?.[layer.id]?.actualVariant}
                  fullBox={{x: -offsetX / fitScale, y: -offsetY / fitScale, w: width / fitScale, h: height / fitScale}}/>
                : <g key={layer.id} opacity={mediaLayer ? opacity : 1}>
                  <ArtworkLayer layer={layer} palette={artwork.palette} canvas={artwork.canvas} states={states} siblings={roots}
                    backdrop={artwork.layout === 'overlay' ? undefined : {colors: [background], uncertain: false}} children={tree.children}/>
                </g>)}
            {artwork.linkedMechanism && <LinkedMechanism mechanism={artwork.linkedMechanism} palette={artwork.palette}
              progress={progress} moving={moving}/>}
          </g>
        </g>
      </svg>
    </div>
  </AbsoluteFill>;
}
