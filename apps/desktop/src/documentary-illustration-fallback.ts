import type {DocumentaryRequirement,Scene} from '@gold-work/shared';
import {documentaryRequiredVisiblePart} from './documentary-detail-evidence.js';

/** A failed exact search may become labelled B-roll only with a grounded,
 * concrete visual target. Preserve the historical claim separately. */
export function documentaryIllustrationFallback(scene:Scene,row:Record<string,unknown>|undefined):DocumentaryRequirement {
  const requirement=scene.documentary!.requirement;
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
    entities:[],identities:[],years:[],detail:undefined,queries:[query],preferredKind:'video'};
}
