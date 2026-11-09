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
  // One person appears in unrelated years, teams and even sports. A title
  // containing only the person's name must not bypass semantic ranking: the
  // live Rossi/Yamaha scene otherwise downloaded a Ferrari F1 test video.
  const personLike=/^\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){1,3}$/u.test(identity.name);
  const ignored=new Set(['the','and','for','with','from','this','that','video','footage','photo','photos','rider','race','racing',
    'season','wins','winner','most','ever','record','highlights','compilation','history','documentary','previous','about']);
  const nameWords=new Set(name.trim().split(' '));
  const contextWords=personLike?[...new Set([...requirement.queries,narration].flatMap(value=>normalize(value).trim().split(' '))
    .filter(word=>word.length>=4&&!nameWords.has(word)&&!ignored.has(word)&&!/^\d+$/.test(word)))]:[];
  return candidates.find(candidate=>candidate.kind==='video'&&candidate.rights!=='unknown'
    &&(candidate.durationSeconds??0)>=8&&(candidate.durationSeconds??Infinity)<=90
    &&candidate.videoDefinition!=='sd'&&normalize(candidate.title).includes(name)
    &&(!personLike||contextWords.length>0&&contextWords.some(word=>normalize(candidate.title).includes(` ${word} `)))
    &&!documentaryProjectionIssue(candidate));
}
