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
    [/\b(?:exposed|opened|cutaway) engine\b|двигател\p{L}*\s+в\s+разрезе|вскрыт\p{L}*\s+двигател/iu,'exposed-engine'],
  ];
  return parts.find(([pattern])=>pattern.test(narration))?.[1];
}
/** Metadata can justify inspecting a physical detail, never approve its pixels.
 * Short multilingual part names occur in otherwise useful archive captions. */
export function documentaryVisiblePartInMetadata(part:string,metadata:string):boolean {
  const patterns:Record<string,RegExp>={
    'crankshaft':/\bcrank[ -]?shaft\b|\bvilebrequin\b|колен(?:вал|чат\p{L}*\s+вал)/iu,
    'connecting-rod':/\bconnecting[ -]?rods?\b|\bconrods?\b|\bbielles?\b|шатун/iu,
    'piston':/\bpistons?\b|поршн/iu,
    'camshaft':/\bcam[ -]?shafts?\b|\barbre[s]?\s+[àa]\s+cames\b|распред/iu,
    'valve':/\bvalves?\b|\bsoupapes?\b|клапан/iu,
    'exposed-engine':/\b(?:engine|motor)\s+(?:cutaway|cross[ -]?section|internals?)\b|\binternal\s+combustion\s+engine\b|двигател\p{L}*\s+в\s+разрезе/iu,
  };
  return Boolean(patterns[part]?.test(metadata));
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
