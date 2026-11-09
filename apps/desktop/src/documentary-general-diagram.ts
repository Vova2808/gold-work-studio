import type {DocumentaryRequirement} from '@gold-work/shared';
import type {DocumentarySceneContext} from './documentary-scene-context.js';

const normalized=(text:string)=>` ${text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()} `;
const universal=/\b(?:inside|within|in) (?:every|any) [\p{L}]+|\b(?:inside|within|in) an? (?:[\p{L}-]+\s+){0,5}(?:engine|motor|mechanism|machine|turbine|vehicle|aircraft|ship)\b|(?:внутри каждого|в каждом|в любом) [\p{L}]+/iu;

/** A short, explicit general explanation may use a schematic. This is only
 * permission to inspect a diagram, never permission to relabel real footage.
 * Stop at dates, named subjects, or a return to a particular object's parts. */
export function documentaryGeneralDiagramScope(context:DocumentarySceneContext,identities:DocumentaryRequirement['identities']) {
  const current=context.current.text;
  // Use a technical term actually spoken in this clause, not a topic whitelist.
  const principle=/[\p{Script=Cyrillic}]/u.test(current)
    ?current.match(/\b[A-Za-z][A-Za-z0-9-]{2,}\b/g)?.[0]
    :current.match(/\b(?:principle|design|construction) of (?:the |an? )?([A-Za-z][A-Za-z0-9-]{2,})\b/i)?.[1];
  const named=(identities??[]).flatMap(identity=>[identity.name,...identity.aliases])
    .flatMap(name=>[normalized(name),...name.match(/[\p{L}\p{N}-]{4,}|\p{L}+\p{N}+/gu)?.map(normalized)??[]]);
  // An explicitly explained principle can use a labelled schematic, without
  // claiming that the diagram is the inherited named object's hardware.
  // A model/year, possessive reference or actual-event view stays exact.
  if(principle&&/design|construction|principle|improv|explain|конструкц|принцип|улучш|объясн/iu.test(current)
    &&!/\b(?:1[0-9]|20)\d{2}\b|\b(?:its|his|her|their|actual)\b|(?<![\p{L}\p{N}])(?:его|её|этого|данного)\s/iu.test(current)
    &&!named.some(name=>normalized(current).includes(name)))
    return {scriptQuote:current,fromScene:context.current.scene,throughScene:context.current.scene,principle};
  const lines=[...context.preceding.slice(-3),context.current];
  let start=-1;
  lines.forEach((line,index)=>{if(universal.test(line.text))start=index;});
  if(start<0)return;
  const passage=lines.slice(start).map(line=>line.text).join(' ');
  if(/\b(?:1[0-9]|20)\d{2}\b|\b(?:its|his|her|their)\b|(?<![\p{L}\p{N}])(?:его|её|этого|данного)\s/iu.test(passage))return;
  if(/\b(?:he|she|they|people|person|driver|rider|race|races|season|event)\b|(?<![\p{L}\p{N}])(?:он|она|они|люди|человек|гонщик|гонке|гонки|сезоне)(?![\p{L}\p{N}])/iu.test(passage))return;
  const names=(identities??[]).flatMap(identity=>[identity.name,...identity.aliases])
    .flatMap(name=>[normalized(name),...name.match(/\p{L}{4,}/gu)?.map(normalized)??[]]);
  if(names.some(name=>normalized(passage).includes(name)))return;
  return {scriptQuote:lines[start]!.text,fromScene:lines[start]!.scene,throughScene:context.current.scene};
}

export const documentaryGeneralDiagramPolicy=' General-diagram exception: generalDiagramScope quotes an explicit universal explanation from the ORIGINAL script. For this passage only, a clearly schematic still illustration of the actual narrated mechanism/detail may explain that shared principle without being a photograph of the inherited named model. This exception does NOT apply to photographs of real objects, people, actual events, historical/model-specific constructions, or video. Do not invent provenance or label a generic diagram as the named model. Whole-object pictures without the literal part remain unsuitable. Candidate ranking may shortlist a plausible diagram; only actual pixels can establish that it is a schematic and shows the required part. For a visual approval under this exception additionally return generalDiagram:{isDiagram:true,illustrationOnly:true,scriptQuote:the exact supplied quote,detailEvidence:concrete visible parts and their relation}; identityMatch must be false and identifiedEntity empty. narrativeEvidence must still prove subject/detail relevance and use requiredEra:"none" only for the universal explanation. A return to a named object, specific design or event must use the ordinary identity/era checks. Missing or uncertain evidence is not approval.';

// Kept only to guard/read paid checkpoints written before the topic-neutral policy.
export const documentaryPreviousNamedMechanismDiagramPolicy=' When generalDiagramScope.principle names a crank geometry, the supplied original clause explains that geometry. A clearly labelled generic still schematic may show its actual crank throws and counterweights; it does not depict the inherited named vehicle or dated event. Establish the specific geometry from visible pixels, not the filename. Use the same generalDiagram evidence contract, identityMatch:false, identifiedEntity empty and requiredEra:"none". A physical photograph, another geometry, or a model/event-specific claim cannot use this exception.';
export const documentaryNamedMechanismDiagramPolicy=' When generalDiagramScope.principle names a term actually spoken in an explanatory original clause, a clearly labelled generic still schematic may explain that principle. Establish the narrated mechanism and its actual parts/relationships from visible pixels, not the filename. It does not depict the inherited named object or dated event. Use the same generalDiagram evidence contract, identityMatch:false, identifiedEntity empty and requiredEra:"none". A physical photograph, another mechanism, or a model/event-specific claim cannot use this exception.';

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
