import type {DocumentaryRequirement} from '@gold-work/shared';
import type {DocumentarySceneContext} from './documentary-scene-context.js';

const normalized=(text:string)=>` ${text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()} `;
const universal=/\b(?:inside|within|in) (?:every|any) [\p{L}]+|\b(?:inside|within|in) an? (?:[\p{L}-]+\s+){0,5}(?:engine|motor|mechanism|machine|turbine|vehicle|aircraft|ship)\b|(?:внутри каждого|в каждом|в любом) [\p{L}]+/iu;

/** A short, explicit general explanation may use a schematic. This is only
 * permission to inspect a diagram, never permission to relabel real footage.
 * Stop at dates, named subjects, or a return to a particular object's parts. */
export function documentaryGeneralDiagramScope(context:DocumentarySceneContext,identities:DocumentaryRequirement['identities']) {
  const lines=[...context.preceding.slice(-3),context.current];
  let start=-1;
  lines.forEach((line,index)=>{if(universal.test(line.text))start=index;});
  if(start<0)return;
  const passage=lines.slice(start).map(line=>line.text).join(' ');
  if(/\b(?:1[0-9]|20)\d{2}\b|\b(?:its|his|her|their)\b|(?:его|её|этого|данного)\s/iu.test(passage))return;
  if(/\b(?:he|she|they|people|person|driver|rider|race|races|season|event)\b|(?<![\p{L}\p{N}])(?:он|она|они|люди|человек|гонщик|гонке|гонки|сезоне)(?![\p{L}\p{N}])/iu.test(passage))return;
  const names=(identities??[]).flatMap(identity=>[identity.name,...identity.aliases])
    .flatMap(name=>[normalized(name),...name.match(/\p{L}{4,}/gu)?.map(normalized)??[]]);
  if(names.some(name=>normalized(passage).includes(name)))return;
  return {scriptQuote:lines[start]!.text,fromScene:lines[start]!.scene,throughScene:context.current.scene};
}

export const documentaryGeneralDiagramPolicy=' General-diagram exception: generalDiagramScope quotes an explicit universal explanation from the ORIGINAL script. For this passage only, a clearly schematic still illustration of the actual narrated mechanism/detail may explain that shared principle without being a photograph of the inherited named model. This exception does NOT apply to photographs of real objects, people, actual events, historical/model-specific constructions, or video. Do not invent provenance or label a generic diagram as the named model. Whole-object pictures without the literal part remain unsuitable. Candidate ranking may shortlist a plausible diagram; only actual pixels can establish that it is a schematic and shows the required part. For a visual approval under this exception additionally return generalDiagram:{isDiagram:true,illustrationOnly:true,scriptQuote:the exact supplied quote,detailEvidence:concrete visible parts and their relation}; identityMatch must be false and identifiedEntity empty. narrativeEvidence must still prove subject/detail relevance and use requiredEra:"none" only for the universal explanation. A return to a named object, specific design or event must use the ordinary identity/era checks. Missing or uncertain evidence is not approval.';

export function documentaryGeneralDiagramVerified(value:Record<string,unknown>,context:DocumentarySceneContext,identities:DocumentaryRequirement['identities']):boolean {
  const scope=documentaryGeneralDiagramScope(context,identities);
  const diagram=value.generalDiagram as Record<string,unknown>|undefined;
  const narrative=value.narrativeEvidence as Record<string,unknown>|undefined;
  // Scene splitting leaves trailing/inter-word whitespace in the original
  // sentence. Its formatting is not a different quotation or visual verdict.
  const quote=(text:string)=>text.normalize('NFC').replace(/\s+/gu,' ').trim();
  return Boolean(scope&&diagram?.isDiagram===true&&diagram.illustrationOnly===true
    &&typeof diagram.scriptQuote==='string'&&quote(diagram.scriptQuote)===quote(scope.scriptQuote)&&typeof diagram.detailEvidence==='string'&&diagram.detailEvidence.trim().length>=20
    &&value.identityMatch===false&&!value.identifiedEntity
    &&narrative?.subjectMatch===true&&narrative.detailMatch===true&&narrative.eraMatch===true&&narrative.requiredEra==='none');
}
