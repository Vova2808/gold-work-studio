import type {DocumentaryCandidate,DocumentaryRequirement} from '@gold-work/shared';
import type {DocumentarySceneContext} from './documentary-scene-context.js';

const years=(text:string)=>[...new Set(text.match(/(?<!\d)(?:1[89]|20)\d{2}(?!\d)/g)??[])];
const compact=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
const modelCodes=(requirement:DocumentaryRequirement)=>requirement.identities?.length===1
  ?[requirement.identities[0]!.name,...requirement.identities[0]!.aliases]
    .flatMap(name=>name.match(/\b[A-Za-z]{2,8}[- ]?[A-Za-z]?\d{1,4}[A-Za-z0-9-]*\b/g)??[])
    .map(compact).filter(code=>code.length>=4):[];

/** A nearby year applies only when the original script explicitly connects
 * this one named model to the immediately following sentence. */
export function documentaryContinuityModelYear(requirement:DocumentaryRequirement,context:DocumentarySceneContext):string|undefined{
  const codes=modelCodes(requirement);
  if(!codes.length)return;
  const current=requirement.years.length===1?requirement.years:requirement.years.length?[]:years(context.current.text);
  if(current.length===1)return current[0];
  if(requirement.years.length||!/(?:\bthis\b|\bthat\b|\bsame\b|\bit\b|\bits\b)/i.test(context.current.text))return;
  const next=context.following[0],nextYears=next?years(next.text):[];
  return next?.scene===context.current.scene+1&&nextYears.length===1
    &&codes.some(code=>compact(next.text).includes(code))?nextYears[0]:undefined;
}

/** Reject an explicitly different model year before downloading or approving
 * the source. A multi-year archive can still be checked frame by frame; a
 * manually imported source remains under the user's control. */
export function documentaryContradictoryModelYear(candidate:DocumentaryCandidate,requirement:DocumentaryRequirement,context:DocumentarySceneContext):boolean{
  if(candidate.id?.startsWith('manual:'))return false;
  const required=documentaryContinuityModelYear(requirement,context),codes=modelCodes(requirement);
  const namedTitle=codes.some(code=>compact(candidate.title).includes(code));
  const namedDescription=codes.some(code=>compact(candidate.description).includes(code));
  if(!required||!namedTitle&&!namedDescription)return false;
  const titled=years(candidate.title);
  const described=years(candidate.description);
  const wrong=namedTitle&&titled.length===1&&titled[0]!==required
    ||titled.length===0&&namedDescription&&described.length===1&&described[0]!==required;
  if(!wrong)return false;
  return candidate.kind!=='video'||(candidate.durationSeconds??0)<=120||!described.includes(required);
}
