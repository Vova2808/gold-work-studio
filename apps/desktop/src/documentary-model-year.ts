import type {DocumentaryCandidate,DocumentaryRequirement} from '@gold-work/shared';
import type {DocumentarySceneContext} from './documentary-scene-context.js';

const years=(text:string)=>[...new Set(text.match(/(?<!\d)(?:1[89]|20)\d{2}(?!\d)/g)??[])];
const compact=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
const modelCodes=(requirement:DocumentaryRequirement)=>requirement.identities?.length===1
  ?[requirement.identities[0]!.name,...requirement.identities[0]!.aliases]
    .flatMap(name=>name.match(/\b[A-Za-z]{2,8}[- ]?[A-Za-z]?\d{1,4}[A-Za-z0-9-]*\b/g)??[])
    .map(compact).filter(code=>code.length>=4):[];

/** Only a year grammatically attached to the named model is a model year.
 * "In 2020 the Porsche 911 won" dates the event, not the car's manufacture. */
export function documentaryExplicitModelYear(requirement:DocumentaryRequirement,text:string):string|undefined{
  if(requirement.identities?.length!==1)return;
  const normalized=(value:string)=>` ${value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()} `;
  const names=[requirement.identities[0]!.name,...requirement.identities[0]!.aliases].filter(name=>name.trim().split(/\s+/).length>=2||modelCodes(requirement).length);
  // Remove temporal adjuncts before punctuation is normalized: "In 2020,
  // Porsche 911 won" must not become the model phrase "2020 Porsche 911".
  const source=normalized(text.replace(/(?<!\p{L})(?:in|during|в|во)\s+(?:1[89]|20)\d{2}(?:\s*(?:году|г\.|year))?\s*,?/giu,' '));
  const matches=years(text).filter(year=>names.some(name=>source.includes(normalized(`${year} ${name}`))
    ||source.includes(normalized(`${name} ${year}`))||source.includes(normalized(`${name} model year ${year}`))
    ||source.includes(normalized(`${year} model ${name}`))));
  return matches.length===1?matches[0]:undefined;
}

/** A nearby year applies only when the original script explicitly connects
 * this one named model to the immediately following sentence. */
export function documentaryContinuityModelYear(requirement:DocumentaryRequirement,context:DocumentarySceneContext):string|undefined{
  const explicit=documentaryExplicitModelYear(requirement,context.current.text);
  if(explicit)return explicit;
  const codes=modelCodes(requirement);
  if(!codes.length)return;
  // A dated introduction of a brand followed by this exact model's specs is
  // still that story's period. A later version of the same model must not
  // pass as era-independent merely because the editing slice omits the year.
  // Explicit previous/later/flashback wording makes this inference unsafe.
  if(!requirement.years.length&&!/\b(?:previous|former|earlier|later|before|after)\b|прежн|предыдущ|позднее|раньше|до этого|после/iu.test(context.current.text)){
    const dated=[...context.preceding].reverse().find(line=>years(line.text).length>0);
    const anchored=dated&&documentaryExplicitModelYear(requirement,dated.text);
    if(anchored)return anchored;
  }
  if(requirement.years.length||!/(?:\bthis\b|\bthat\b|\bsame\b|\bit\b|\bits\b)/i.test(context.current.text))return;
  const next=context.following[0],nextYears=next?years(next.text):[];
  return next?.scene===context.current.scene+1&&nextYears.length===1
    &&codes.some(code=>compact(next.text).includes(code))
    &&(documentaryExplicitModelYear(requirement,next.text)||/\b(?:introduced|redesigned|unveiled|put\b.{0,70}\binto)\b|представил|выпустил/iu.test(next.text))?nextYears[0]:undefined;
}

/** Reject an explicitly different model year before downloading or approving
 * the source. A multi-year archive can still be checked frame by frame; a
 * manually imported source remains under the user's control. */
export function documentaryContradictoryModelYear(candidate:DocumentaryCandidate,requirement:DocumentaryRequirement,context:DocumentarySceneContext):boolean{
  if(candidate.id?.startsWith('manual:'))return false;
  const required=documentaryContinuityModelYear(requirement,context);
  if(!required)return false;
  // Many exact models have names without numeric codes (Ford Mustang, etc.).
  // Their explicit single year is still a constraint. Match the whole name so
  // a broad company such as Ford does not turn every publication year into a
  // claimed model year. Long mixed archives retain their frame-level path.
  if(requirement.identities?.length===1){
    const names=[requirement.identities[0]!.name,...requirement.identities[0]!.aliases].filter(name=>name.trim().split(/\s+/).length>=2);
    const normalized=(text:string)=>` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()} `;
    const titled=years(candidate.title),described=years(candidate.description);
    const title=normalized(candidate.title);
    const adjacent=names.some(name=>titled.some(year=>title.includes(normalized(`${year} ${name}`))||title.includes(normalized(`${name} ${year}`))));
    if(adjacent&&titled.length===1
      &&titled[0]!==required
      &&!described.includes(required))return true;
  }
  const codes=modelCodes(requirement);
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
