/** Literal physical explanations need a visible part, not its enclosing vehicle.
 * Abstract specifications remain illustrative; this does not claim a photo can
 * prove torque, firing timing, speed or a historical event. */
export function documentaryRequiredVisiblePart(narration:string):string|undefined {
  const parts:Array<[RegExp,string]>=[
    [/\bcrankshaft\b|колен(?:чат\p{L}*\s+вал|вал)/iu,'crankshaft'],
    [/\bconnecting rods?\b|шатун/iu,'connecting-rod'],
    [/\bpistons?\b|поршн/iu,'piston'],
    [/\bcamshafts?\b|распред(?:елительн\p{L}*\s+вал|вал)/iu,'camshaft'],
    [/\bvalves?\b|клапан/iu,'valve'],
    [/firing (?:order|interval)|поряд\p{L}*\s+(?:работ\p{L}*|зажига\p{L}*)|big bang engine/iu,'exposed-engine'],
  ];
  return parts.find(([pattern])=>pattern.test(narration))?.[1];
}
export function documentaryDetailEvidenceIssue(part:string,inventory:Record<string,unknown>):string|undefined {
  if(inventory.prominentParts&&Array.isArray(inventory.prominentParts)&&inventory.prominentParts.includes(part)&&typeof inventory.evidence==='string'&&inventory.evidence.trim().length>=12)return;
  return `В реальном кадре не подтверждена явно видимая деталь «${part}». Общий вид транспорта или закрытый корпус не заменяет изображение внутреннего механизма.`;
}

/** Rivalry can be illustrated by the current scene's named member. This is
 * not an instruction to render a new comparison layout or infer both faces. */
export function documentaryRivalryTarget(input:Record<string,any>,identities:Array<{name:string;aliases:string[]}>):string|undefined {
  if(identities.length!==2||!/(?:\bagainst\b|\bversus\b|\brival\w*\b|\bvs\.?\b|против|соперни)/iu.test([input.narration,input.narrationContext,input.voiceOverContext,input.searchHints?.detail].join(' ')))return;
  const entities=input.detailEntities??input.entities;
  if(!Array.isArray(entities))return;
  const matching=identities.filter(identity=>entities.some(entity=>typeof entity==='string'&&[identity.name,...identity.aliases].some(name=>name.toLowerCase()===entity.toLowerCase())));
  return matching.length===1?matching[0]!.name:undefined;
}
