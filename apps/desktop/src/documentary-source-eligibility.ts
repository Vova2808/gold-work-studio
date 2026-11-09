import type {Scene} from '@gold-work/shared';
import {assessArtworkReplacement} from './documentary-artwork-quality.js';
import {documentarySourcePreservingFallbackReady} from './documentary-native-fallback.js';

/** Negative metadata evidence only. A title never establishes a positive match.
 * Reviewed/user-confirmed choices retain their existing acceptance contract. */
export function documentarySourceFootageIssue(scene:Scene):string|undefined {
  const doc=scene.documentary,source=doc?.selected;
  if(!doc||!source||doc.verified||doc.pinned)return;
  const families=(text:string)=>{
    const result=new Set<string>();
    const patterns:Array<[string,RegExp]>=[
      ['motorcycle',/\b(?:motorcycles?|motorbikes?|moto[ -]?gp)\b|мотоцикл\p{L}*|мотогон\p{L}*/giu],
      ['car',/\b(?:cars?|automobiles?|f[ -]?1|formula[ -]?(?:1|one))\b|автомобил\p{L}*|формул\p{L}*\s*1/giu],
    ];
    for(const [family,pattern] of patterns)for(const match of text.matchAll(pattern)){
      if(!/\b(?:not|without)\s+(?:an?\s+)?$|не\s*$/iu.test(text.slice(Math.max(0,match.index!-20),match.index)))result.add(family);
    }
    return result;
  };
  const requested=families([scene.narration,doc.requirement.detail,...doc.requirement.identities?.map(i=>i.name)??[]].filter(Boolean).join(' '));
  const declared=families(source.title??'');
  if(requested.size===1&&declared.size===1&&![...requested].some(family=>declared.has(family)))
    return 'Тип объекта в исходном заголовке противоречит сценарию: '+(requested.has('motorcycle')
      ?'нужен мотоцикл, источник явно называет автомобиль.':'нужен автомобиль, источник явно называет мотоцикл.');
}

/** The renderer hides the underlying material for a full no-media artwork.
 * A partial insert/overlay or a semantic intention cannot provide this proof. */
export function documentaryStandaloneArtworkReady(scene:Scene):boolean {
  if(documentarySourcePreservingFallbackReady(scene))return true;
  const graphic=scene.documentary?.motionGraphic,artwork=graphic?.artwork;
  const seconds=Math.max((scene.documentary?.timing?.durationInFrames??Math.ceil(scene.durationSeconds*30))/30,scene.durationOverrideSeconds??0);
  return Boolean(graphic?.enabled&&artwork?.layout==='full'&&artwork.layers.length
    &&!artwork.layers.some(layer=>layer.kind==='media')&&graphic.startSeconds===0&&artwork.startSeconds===0
    &&Number.isFinite(graphic.durationSeconds)&&graphic.durationSeconds>=seconds
    &&Number.isFinite(artwork.durationSeconds)&&artwork.durationSeconds>=seconds
    &&(graphic.origin!=='automatic'||assessArtworkReplacement(artwork).allowReplacement));
}

/** Inspect the material actually shown, independently of semantic treatment. */
export function documentaryVisualSourceIssue(scene:Scene,all:Scene[]):string|undefined {
  if(documentaryStandaloneArtworkReady(scene))return;
  const cuts=scene.documentary?.cuts??[];
  for(const cut of cuts){
    const source=cut.sourceSceneId?all.find(item=>item.id===cut.sourceSceneId):scene;
    const issue=source&&documentarySourceFootageIssue(source);
    if(issue)return issue;
  }
  const frames=Math.max(scene.documentary?.timing?.durationInFrames??Math.ceil(scene.durationSeconds*30),Math.ceil((scene.durationOverrideSeconds??0)*30));
  let end=0;
  const replaced=cuts.length>0&&cuts.every(cut=>{
    const start=end;end=cut.fromFrame+cut.durationInFrames;
    return cut.fromFrame===start&&cut.durationInFrames>0&&Boolean(cut.sourceSceneId&&all.some(s=>s.id===cut.sourceSceneId));
  })&&end===frames;
  return replaced?undefined:documentarySourceFootageIssue(scene);
}
