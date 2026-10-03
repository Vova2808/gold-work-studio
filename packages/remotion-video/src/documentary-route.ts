export type RoutePlace = { name: string; latitude: number; longitude: number };
const radius = 6378137;
export function documentaryMercator(place: RoutePlace) {
  return { x: radius * place.longitude * Math.PI / 180, y: radius * Math.log(Math.tan(Math.PI / 4 + place.latitude * Math.PI / 360)) };
}
export function documentaryRouteKey(places: RoutePlace[]): string {
  return JSON.stringify(places.map(place => [place.latitude, place.longitude]));
}
export function documentaryRouteBounds(places: RoutePlace[]): [number, number, number, number] {
  if (places.length < 2 || places.length > 8 || places.some(p => !p.name.trim() || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude) > 80 || Math.abs(p.longitude) > 180)) throw new Error('Укажите 2–8 мест с проверенными координатами между 80° ю. ш. и 80° с. ш.');
  if (Math.max(...places.map(p => p.longitude)) - Math.min(...places.map(p => p.longitude)) > 180) throw new Error('Спутниковый маршрут через линию перемены дат пока не поддерживается.');
  const points = places.map(documentaryMercator);
  if(points.every(p=>Math.hypot(p.x-points[0]!.x,p.y-points[0]!.y)<1))throw new Error('Маршруту нужны хотя бы две разные точки.');
  const xmin = Math.min(...points.map(p => p.x)), xmax = Math.max(...points.map(p => p.x));
  const ymin = Math.min(...points.map(p => p.y)), ymax = Math.max(...points.map(p => p.y));
  const minimum = 70000 / Math.cos(places.reduce((sum, p) => sum + p.latitude, 0) / places.length * Math.PI / 180);
  // Generous padding keeps labels and all stops visible at the maximum 8% zoom.
  const width = Math.max(minimum, (xmax - xmin) * 1.65, (ymax - ymin) * 1.9 * 16 / 9);
  const height = width * 9 / 16;
  const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
  const edge = radius * Math.PI;
  if (width > edge * 2 || Math.abs(cy) + height / 2 > edge) throw new Error('Маршрут слишком широк для спутниковой карты в этой проекции.');
  const centerX = Math.max(-edge + width / 2, Math.min(edge - width / 2, cx));
  return [centerX - width / 2, cy - height / 2, centerX + width / 2, cy + height / 2];
}
export function documentaryRouteGeometry(places: RoutePlace[], bounds: [number, number, number, number], progress: number) {
  const points = places.map(place => {
    const p = documentaryMercator(place);
    return { x: (p.x - bounds[0]) / (bounds[2] - bounds[0]) * 1920, y: (bounds[3] - p.y) / (bounds[3] - bounds[1]) * 1080 };
  });
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  const total = lengths.reduce((sum, n) => sum + n, 0);
  const distance = Math.max(0, Math.min(1, progress)) * total;
  let traversed = 0, marker = points[0] ?? { x: 960, y: 540 };
  const arrivals = [0];
  lengths.forEach((length, index) => {
    if (distance >= traversed) {
      const fraction = length ? Math.min(1, (distance - traversed) / length) : 1;
      const a = points[index]!, b = points[index + 1]!;
      marker = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
    }
    traversed += length; arrivals.push(total ? traversed / total : 0);
  });
  return { points, marker, arrivals, path: points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') };
}

/** Deterministic label placement uses the same geometry in preview and export. */
export function documentaryRouteLabels(points: Array<{x:number;y:number}>, places: RoutePlace[]) {
  const boxes: Array<{x:number;y:number;width:number;height:number}> = [];
  for (const [index, p] of points.entries()) {
    const width = Math.min(440, Math.max(150, places[index]!.name.length * 19 + 36)), height = 58;
    const positions = [[24,-82],[-width-24,-82],[24,26],[-width-24,26],[24,-162],[-width-24,106],[24,-242],[-width-24,186]];
    const candidates = positions.map(([dx,dy]) => ({ x: Math.max(70,Math.min(1850-width,p.x+dx!)), y: Math.max(145,Math.min(900-height,p.y+dy!)), width, height }));
    // Dense city clusters still need separate labels: search the safe area and
    // prefer the closest collision-free box instead of overlapping names.
    for(let y=145;y<=830;y+=74)for(let x=70;x<=1850-width;x+=80)candidates.push({x,y,width,height});
    const overlap = (a: typeof candidates[number]) => boxes.reduce((sum,b) => sum + Math.max(0,Math.min(a.x+a.width,b.x+b.width+12)-Math.max(a.x,b.x-12))*Math.max(0,Math.min(a.y+a.height,b.y+b.height+12)-Math.max(a.y,b.y-12)),0);
    const distance=(a:typeof candidates[number])=>Math.hypot(a.x+a.width/2-p.x,a.y+a.height/2-p.y);
    boxes.push(candidates.sort((a,b)=>overlap(a)-overlap(b)||distance(a)-distance(b))[0]!);
  }
  return boxes;
}
