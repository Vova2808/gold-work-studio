/** Stable editorial families, not random flicker between frames or rebuilds. */
export function documentaryAccent(seed:string):string{
  let hash=2166136261;for(const char of seed.toLocaleLowerCase().normalize('NFKC'))hash=Math.imul(hash^char.codePointAt(0)!,16777619);
  return ['#55d6c2','#ffc857','#9a9cff','#ff7390','#57c7ff','#dd9ef8','#a8d872','#ffab70'][hash>>>0&7]!;
}
