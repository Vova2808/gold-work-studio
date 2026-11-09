import type {DocumentaryCandidate,DocumentaryRequirement,Scene} from '@gold-work/shared';
import {documentaryThematicReserveIssue} from '@gold-work/shared';
import {documentaryRequiredVisiblePart} from './documentary-detail-evidence.js';

/** A thematic search must not quietly become an exact-person/model search. */
export function documentaryThematicQueryAllowed(requirement:DocumentaryRequirement,query:string):boolean {
  const normalized=(text:string)=>` ${text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()} `;
  const names=(requirement.narrativeIdentities??requirement.identities??[]).flatMap(identity=>[identity.name,...identity.aliases]);
  return query.trim().length>=8&&query.length<=100&&!/\b(?:1[0-9]|20)\d{2}\b/.test(query)
    &&!names.some(name=>name.trim().length>=4&&normalized(query).includes(normalized(name)));
}

/** Remove planner-invented staging from an already labelled illustration.
 * This changes discovery only; named/literal evidence is never relaxed. */
export function documentaryGroundedThematicQuery(narration:string,query:string):string {
  const literalPart=Boolean(documentaryRequiredVisiblePart(narration));
  let result=query;
  const invented:Array<[RegExp,RegExp]>=[
    [/\b(?:in (?:the |a )?)?(?:garage|pitbox|paddock)(?: setup)?\b/gi,/garage|pitbox|paddock|гараж|бокс|паддок/iu],
    [/\b(?:preparation|preparing|setup|working on)\b/gi,/prepar|setup|working on|подгот|работ\p{L}* над/iu],
    [/\b(?:holding )?(?:championship )?trophy\b/gi,/trophy|трофе|кубок/iu],
    [/\b(?:exposed|internal components|internals|mechanical details|cutaway)\b/gi,/exposed|internals|cutaway|внутрен|в разрезе/iu],
  ];
  for(const [index,[phrase,grounding]] of invented.entries())
    if(!grounding.test(narration)&&!(literalPart&&index===3))result=result.replace(phrase,' ');
  // Displacement/cylinder count is a spoken specification. Labelled B-roll
  // needs the vehicle category, not a rare exposed view proving every number.
  const vehicle=result.match(/\b(?:racing motorcycle|motorcycle|automobile|car|aircraft|airplane|ship|train)\b/i)?.[0];
  if(!literalPart&&vehicle&&/\b(?:V\d|cc|cylinders?|displacement|inline[ -]?four|horsepower)\b|объ[её]м|кубическ|рядн\p{L}* четв[её]р|лошадин\p{L}* сил/iu.test(narration))
    result=vehicle;
  result=result.replace(/\s+/g,' ').trim();
  return result;
}

/** Cheap exclusions preserve the episode's visible sport, without approving
 * a title as proof of any person, model or event. */
export function documentaryThematicMetadataIssue(requirement:DocumentaryRequirement,candidate:DocumentaryCandidate,script:string):string|undefined {
  if(requirement.visualScope!=='illustrative')return;
  const hints=[script,...requirement.narrativeQueries??[]].join(' ');
  if(/MotoGP|Grand Prix|Гран-при/iu.test(hints)&&!/motocross|enduro|мотокросс|эндуро/iu.test(hints)
    &&/motocross|enduro|dirt bike|off[ -]?road/iu.test(candidate.title))return 'Мотокросс не соответствует дорожным гонкам этого рассказа.';
}

/** A failed exact search may become labelled B-roll only with a grounded,
 * concrete visual target. Preserve the historical claim separately. */
export function documentaryIllustrationFallback(scene:Scene,row:Record<string,unknown>|undefined):DocumentaryRequirement {
  const requirement=scene.documentary!.requirement;
  if(documentaryThematicReserveIssue(requirement.aiSearchPlan))return requirement;
  const unchanged={...requirement,illustrationFallbackVersion:1 as const};
  const quote=typeof row?.quote==='string'?row.quote.trim().replace(/\s+/g,' '):'';
  const query=typeof row?.query==='string'?row.query.trim().replace(/\s+/g,' '):'';
  const original=scene.narration.replace(/\[(?:music|музыка)\]/giu,' ').replace(/\s+/g,' ');
  const namedTerms=(requirement.identities??[]).flatMap(identity=>[identity.name,...identity.aliases]);
  const normalizedQuery=` ${query.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()} `;
  const containsName=namedTerms.some(name=>{
    const normalized=name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    return normalized.length>=4&&normalizedQuery.includes(` ${normalized} `);
  });
  if(row?.safe!==true||quote.length<8||quote.length>120||!original.includes(quote)
    ||query.length<8||query.length>100||containsName||/\b(?:1[0-9]|20)\d{2}\b/.test(query)
    ||documentaryRequiredVisiblePart(scene.narration))return unchanged;
  return {...unchanged,visualScope:'illustrative',visualScopeVersion:3,visualScopeQuote:quote,illustrationQuery:query,
    narrativeEntities:requirement.narrativeEntities??requirement.entities,
    narrativeIdentities:requirement.narrativeIdentities??requirement.identities,
    narrativeYears:requirement.narrativeYears??requirement.years,
    narrativeDetail:requirement.narrativeDetail??requirement.detail,
    narrativeQueries:requirement.narrativeQueries??requirement.queries,
    entities:[],identities:[],years:[],detail:undefined,queries:[query],preferredKind:'video',searchRefined:false};
}
