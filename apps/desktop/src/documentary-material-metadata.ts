import type {DocumentaryCandidate,Scene} from '@gold-work/shared';

type Material='aluminium'|'steel';
const mentionsBoth=(value:string)=>/\b(?:aluminium|aluminum)\b|алюминиев\p{L}*/iu.test(value)
  &&/\bsteel\b|стальн\p{L}*/iu.test(value);
function workpieceMaterials(value:string):Set<Material>{
  const materials=new Set<Material>();
  const patterns:Array<[Material,RegExp]>=[
    ['aluminium',/\b(?:aluminium|aluminum)\s+(?:(?:body|automotive|car|thin|rolled|metal)\s+){0,3}(?:components?|panels?|plates?|sheets?|samples?)\b|алюминиев\p{L}*\s+(?:кузовн\p{L}*\s+)?(?:детал|панел|пластин|лист|образц|образец)\p{L}*/giu],
    ['steel',/\bsteel\s+(?:(?:body|automotive|car|thin|rolled|metal)\s+){0,3}(?:components?|panels?|plates?|sheets?|samples?)\b|стальн\p{L}*\s+(?:кузовн\p{L}*\s+)?(?:детал|панел|пластин|лист|образц|образец)\p{L}*/giu]
  ];
  for(const [material,pattern]of patterns)for(const match of value.matchAll(pattern)){
    const prefix=value.slice(Math.max(0,match.index!-24),match.index);
    if(!/\b(?:not|non|without)[\s\-\u2010-\u2015]+(?:an?\s+)?$|не[\s\-\u2010-\u2015]*$/iu.test(prefix))materials.add(material);
  }
  return materials;
}

/** An explicitly contradictory original title is a discovery refusal, never
 * proof that a generic metal image has the required composition or use. */
export function documentaryMaterialMetadataIssue(scene:Scene,source:DocumentaryCandidate):string|undefined{
  const requirements=scene.documentary?.requirement.scriptRequirements;
  if(!requirements||requirements.mode==='thematic')return;
  const quotes=requirements.checks.filter(check=>check.kind==='object'
    &&scene.narration.includes(check.scriptQuote)).map(check=>check.scriptQuote);
  // Comparisons and titles naming several materials do not bind one specific
  // workpiece. Leave them to the existing actual-frame review.
  if(mentionsBoth(quotes.join(' '))||mentionsBoth(source.title))return;
  const demanded=new Set(quotes.flatMap(quote=>[...workpieceMaterials(quote)]));
  if(demanded.size!==1)return;
  // Generated descriptions, search queries and review hints have no authority.
  const declared=workpieceMaterials(source.title);
  const expected=[...demanded][0]!;
  if(declared.size===1&&!declared.has(expected))return 'Материал заготовки в исходном заголовке противоречит сценарию: '
    +(expected==='aluminium'?'требуется алюминиевая деталь, источник явно называет стальную.':'требуется стальная деталь, источник явно называет алюминиевую.');
}
