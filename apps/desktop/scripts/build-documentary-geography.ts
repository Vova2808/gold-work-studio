// Refresh public-domain, offline assets. No map network calls during editing/export.
import { writeFile } from 'node:fs/promises';
const base = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
async function geo(name: string) {
  const response = await fetch(base + name + '.geojson');
  if (!response.ok) throw new Error(`Natural Earth ${response.status}`);
  return await response.json() as {features: Array<{properties: Record<string, unknown>; geometry:{type:string; coordinates: any}}>};
}
const places = await geo('ne_10m_populated_places');
const rows = places.features.map(({properties:p, geometry:g}) => ({id:String(p.NE_ID), name:String(p.NAME), country:String(p.ADM0NAME), countryCode:String(p.ISO_A2),
  aliases:[...new Set([p.NAME,p.NAMEASCII,p.NAME_EN,p.NAME_RU,p.NAME_UK,p.NAME_DE,p.NAME_FR,p.NAME_ES,p.NAMEALT].filter(v=>typeof v==='string'&&v).flatMap(v=>String(v).split('|')))],
  latitude:g.coordinates[1], longitude:g.coordinates[0]}));
await writeFile('../../packages/shared/src/documentary-places-data.ts', '// Generated from Natural Earth 1:10m populated places; public domain. See GEOGRAPHY_LICENSE.md.\nexport const documentaryPlaces = '+JSON.stringify(rows)+';\n');
if (process.argv.includes('--places-only')) {
  console.log(JSON.stringify({ places: rows.length }));
  process.exit(0);
}
const land = await geo('ne_50m_land');
const point = ([lon,lat]:number[]) => `${((lon!+180)*4).toFixed(1)},${((90-lat!)*4).toFixed(1)}`;
const paths = land.features.map(({geometry:g}) => (g.type==='MultiPolygon'?g.coordinates:[g.coordinates]).map((polygon:number[][][])=>polygon.map(ring=>'M'+ring.map(point).join('L')+'Z').join('')).join(''));
await writeFile('../../packages/remotion-video/src/documentary-land-data.ts', '// Natural Earth 1:50m land; public domain. Equirectangular 1440x720.\nexport const documentaryLandPath = '+JSON.stringify(paths.join(''))+';\n');
console.log(JSON.stringify({places:rows.length,landPaths:paths.length,landBytes:paths.join('').length}));
