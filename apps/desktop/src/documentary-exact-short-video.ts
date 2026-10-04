import type {DocumentaryCandidate,DocumentaryRequirement} from '@gold-work/shared';
import {documentaryRequiredVisiblePart} from './documentary-detail-evidence.js';
import {documentaryGeneralActionIssue,documentaryProjectionIssue} from './documentary-visual-relevance.js';

/** A download hint for a single named subject, never an approval of its frames. */
export function documentaryExactNamedShortVideoProbe(candidates:DocumentaryCandidate[],requirement:DocumentaryRequirement,narration:string):DocumentaryCandidate|undefined{
  const identity=requirement.identities?.length===1?requirement.identities[0]:undefined;
  if(!identity||requirement.years.length||documentaryRequiredVisiblePart(narration)||documentaryGeneralActionIssue({narration}))return;
  const normalize=(value:string)=>` ${value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()} `;
  const name=normalize(identity.name);
  if(name.trim().split(' ').length<2)return;
  return candidates.find(candidate=>candidate.kind==='video'&&candidate.rights!=='unknown'
    &&(candidate.durationSeconds??0)>=8&&(candidate.durationSeconds??Infinity)<=90
    &&candidate.videoDefinition!=='sd'&&normalize(candidate.title).includes(name)
    &&!documentaryProjectionIssue(candidate));
}
