import type {Scene} from '@gold-work/shared';
import type {DocumentaryLocationEvidence,DocumentarySourceEvidence} from './documentary-source-evidence.js';

const normalized=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const has=(text:string,phrase:string)=>` ${normalized(text)} `.includes(` ${normalized(phrase)} `);

/** The current visible task owns geography. A historical place elsewhere in
 * narration must not disqualify a permitted modern view of a named object. */
export function documentaryRequiredLocation(scene:Scene):string|undefined {
  const req=scene.documentary?.requirement;
  const target=req?.footageFallback?.target??req?.aiSearchPlan?.visualTarget??req?.detail??'';
  const word=String.raw`\p{Lu}[\p{L}'’-]*`;
  const name=`${word}(?:\\s+(?:(?:of|the|de|la)\\s+)?${word}){0,3}`;
  const patterns=[
    new RegExp(`\\b(${name}\\s+(?:Canal|River|Sea|Ocean|Bay|Harbour|Harbor|Strait|City))\\b`,'u'),
    new RegExp(`\\b((?:Cape|Lake|Mount|Gulf|Bay|Strait)\\s+(?:of\\s+)?${name})\\b`,'u'),
    new RegExp(`\\b(?:city|town|port|harbor|harbour|skyline|streets)\\s+(?:of|in)\\s+(${name})\\b`,'u'),
    new RegExp(`\\b(${name})\\s+(?:city|skyline|harbor|harbour|streets)\\b`,'u'),
  ];
  // Articles/editorial modifiers describe the view, not a different place.
  // Retain the proper name after them, but never promote a bare "Canal".
  return patterns.map(pattern=>target.match(pattern)?.[1]
    ?.replace(/^(?:(?:A|An|The|Modern|Historic|Historical)(?:\s+|$))+/u,''))
    .find(place=>place&&!/^(?:Canal|River|Sea|Ocean|Bay|Harbour|Harbor|Strait|City|Cape|Lake|Mount|Gulf)$/u.test(place));
}

/** A newly exposed URL attribution is weak, but an old generic suitable:true
 * did not resolve it. Keep the paid receipt; do not assert that its city is
 * factual. Existing source attribution actually discussed by the saved review
 * remains valid, including a nearby location illustrating a larger route. */
export function documentaryUnresolvedLocationHint(scene:Scene,source:DocumentarySourceEvidence,reviewText:string,validatedLocation?:DocumentaryLocationEvidence):string|undefined {
  const required=documentaryRequiredLocation(scene);
  if(!required||!source.urlSlug)return;
  // A checked source citation from this same review owns the new contract.
  // URL-only support (hint), unspecified and legacy answers still need recovery.
  if(validatedLocation?.status==='supported'&&validatedLocation.strength==='source'
    &&validatedLocation.sourceFingerprint===source.fingerprint&&validatedLocation.requiredLocation===required)return;
  const attribution=[source.title,source.description,source.location??''].join('\n');
  // Preserve a legacy approval that already discussed the required named place
  // actually attributed by the source. A weak "in motion" slug is not stronger
  // than that proof; neutral metadata plus the model's own claim is insufficient.
  if(has(attribution,required)&&has(reviewText,required))return;
  const slug=normalized(source.urlSlug).replace(/\s+\d+$/u,'');
  const prefixes=[...slug.matchAll(/\b(?:in|at|near)\s+/gu)];
  const last=prefixes.at(-1);if(!last)return;
  const hint=slug.slice(last.index!+last[0].length).trim();
  if(!hint||hint.split(' ').length>5||/^(?:sea|ocean|port|harbor|harbour|city|town|sunset|sunrise|night|dusk|dawn|daylight)$/u.test(hint))return;
  if(has(required,hint))return;
  if(has(attribution,hint)&&has(reviewText,hint))return;
  return 'Публичная страница содержит неучтённую подсказку о другом месте. Прежнее общее одобрение не разрешает эту географическую неопределённость; нужен другой подтверждённый материал.';
}
