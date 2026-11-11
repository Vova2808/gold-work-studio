import type {DocumentaryCandidate,Scene} from '@gold-work/shared';
import {documentaryCandidateSubjectIssue} from './documentary-named-search.js';

const words=(value:string)=>value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const hasName=(text:string,name:string)=>(' '+words(text)+' ').includes(' '+words(name)+' ');
const cleanIdentity=(value:string)=>value.replace(/^(?:the\s+)?(?:ship|vessel|clipper|aircraft|locomotive|shipowner|captain|scientist|inventor)\s+/i,'')
  .replace(/\s+(?:(?:clipper|sailing|steam|preserved|historic)\s+)*(?:ship|vessel|sails|rigging|hull|portrait|aircraft|locomotive)$/i,'').trim();

/** Original source titles can disprove identity; neither a matching name nor
 * an unknown title proves what is actually visible in the media. */
function identityMetadataIssue(scene:Scene,source:DocumentaryCandidate):string|undefined{
  const requirement=scene.documentary?.requirement;
  if(!requirement)return;
  const mandatory=requirement.aiSearchPlan?.grounding?.mandatory;
  if(!mandatory?.some(check=>check.kind==='identity')&&(requirement.footageFallback||requirement.fastSourcePolicy==='background'))return;
  const identities=(Array.isArray(mandatory)?mandatory.filter(check=>check?.kind==='identity'||check?.kind==='geography'):undefined)
    ?.map(check=>({name:check.required,aliases:check.aliases??[]}))??requirement.identities??[];
  const subject=requirement.aiSearchPlan?.subject;
  const names=[...new Set(identities.flatMap(identity=>[identity.name,...identity.aliases,
    ...(subject&&hasName(identity.name,subject)?[subject]:[])]).map(cleanIdentity).filter(Boolean))];
  if(!names.length)return;
  const title=source.title.replace(/\.(?:jpe?g|png|tiff?|webp)$/i,'');
  const contains=(text:string)=>names.some(name=>hasName(text,name));
  const refusal=(detail:string)=>'Исходный заголовок противоречит идентичности объекта сцены: '+detail;
  const roles='captain|owner|scientist|inventor|artist|composer|writer|admiral|president|king|queen|капитан|владелец|учёный|ученый|изобретатель|художник|писатель';
  const target=mandatory?.some(check=>check.kind==='identity')?requirement.aiSearchPlan!.visualTarget:requirement.detail??requirement.aiSearchPlan?.visualTarget??'';
  const personTarget=/\bportrait\b|портрет/iu.test(target)||names.some(name=>{
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp('(?:'+roles+')[,\\s]+(?:the\\s+)?'+escaped+'\\b|'+escaped+'[,\\s]+(?:(?:became|was|is|the|a|an)\\s+){0,3}(?:'+roles+')\\b','iu').test(scene.narration+' '+target);
  });
  const primaryTitle=title.split(/[,;]|\s+[—–]\s+/u)[0]??title;
  const vehicleCue=/\b(?:ships?|vessels?|clippers?|sailboats?|yachts?|warships?|aircraft|locomotives?)\b|корабл|судн|парусник|самол[её]т|локомотив/iu;
  const beverageCue=/\b(?:whisk(?:y|ey)|bourbon|cocktail|juice|beer|vodka|liqueur)\b|виски|коктейл|водк|пив[оа]|ジュース|果汁/iu;
  if(vehicleCue.test(target+' '+identities.map(identity=>identity.name).join(' '))&&!beverageCue.test(target)
    &&beverageCue.test(primaryTitle)&&!vehicleCue.test(primaryTitle))
    return refusal('источник описывает напиток с совпадающим названием, а не требуемый транспортный объект.');
  // Stock keyword lists may include "portrait" or "owner" while naming only
  // an animal. An explicit human/animal scene remains undecided for pixels.
  if(personTarget&&!contains(title)&&/\b(?:pupp(?:y|ies)|dogs?|kittens?|cats?|horses?|birds?|lions?)\b|щенок|щенки|котёнок|котенок|собак/iu.test(primaryTitle)
    &&!/\b(?:man|woman|child|boy|girl|people|person|couple|holding|petting)\b|\bwith\s+(?:(?:its|their|the|an?)\s+)?owner\b|человек|женщин|мужчин|ребён|ребен/iu.test(primaryTitle))
    return refusal('основной предмет источника — животное, а требуется конкретный человек.');
  if(personTarget&&!contains(primaryTitle)&&/\b(?:ships?|vessels?|clippers?|steamships?|ship scale models|aircraft|airplanes?|locomotives?|engines?|hull|rigging|deck)\b|корабл|судн|самол[её]т|локомотив/iu.test(primaryTitle)
    &&!/\b(?:portraits?|headshots?|captain|owner|crew|man|woman|person)\b|портрет|капитан|владелец|экипаж/iu.test(primaryTitle))
    return refusal('основной предмет источника — объект или его деталь, а требуется конкретный человек.');
  if(personTarget&&!contains(title)&&/\b(?:skyline|cityscape|skyscraper)\b/iu.test(title)
    &&!/\b(?:portrait|man|woman|person)\b/iu.test(title))
    return refusal('название описывает городской пейзаж, а не требуемого человека.');
  const visibleSubject=target+' '+identities.map(identity=>identity.name).join(' ');
  if(/\b(?:ship|vessel|clipper|sails?|rigging|hull|portrait)\b|корабл|судн|парус|портрет/iu.test(visibleSubject)
    &&/\b(?:bedroom\s+apartment|apartment\s+for\s+(?:sale|rent)|property\s+tour|real\s+estate|villa\s+for\s+sale)\b|квартир\p{L}*\s+(?:на\s+)?продаж/iu.test(title))
    return refusal('источник является показом недвижимости, а не требуемого объекта.');
  // A named grave/monument is a different depicted object from its namesake.
  if(contains(title)&&/\b(?:grave|tomb|gravestone|headstone|tombstone|memorial|monument)\b|могил|надгроб|памятник/iu.test(title)
    && !/\b(?:grave|tomb|memorial|monument)\b|могил|надгроб|памятник/iu.test(requirement.detail??requirement.aiSearchPlan?.visualTarget??''))
    return refusal('изображено захоронение или памятник, а не сам человек/объект.');
  // The camera platform and an author/credit are not the depicted subject.
  const viewpoint=/\b(?:taken|view|seen|photographed|shot)\s+(?:\w+\s+){0,3}from\s+(?:the\s+)?(?:deck|board|aboard|cockpit|bridge)\s+(?:of\s+)?|\b(?:from\s+(?:the\s+)?deck\s+of|photograph(?:ed)?\s+by|painted\s+by|drawn\s+by|photo\s+by|caption(?:ed)?\s+by)\s+|\s+by\s+/iu.exec(title);
  if(viewpoint&&contains(title.slice(viewpoint.index))&&!contains(title.slice(0,viewpoint.index)))
    return refusal('нужное имя указано только как точка съёмки, автор или подпись.');
  // A source description can explicitly distinguish its photographed subject
  // from the camera platform, even when its filename omits the platform name.
  const description=source.description??'';
  const describedViewpoint=/\b(?:taken|view|seen|photographed|shot)\s+(?:\w+\s+){0,3}from\s+(?:the\s+)?(?:deck|board|aboard|cockpit|bridge)\s+(?:of\s+)?/iu.exec(description);
  if(describedViewpoint&&!contains(title)&&contains(description.slice(describedViewpoint.index))
    &&!contains(description.slice(0,describedViewpoint.index)))
    return refusal('описание относит нужное имя к точке съёмки, а не к изображённому объекту.');
  if(!contains(title)&&contains(source.author??'')){
    // Archive filenames sometimes append the photographer's surname after a
    // different named subject. A bare surname by itself remains ambiguous.
    for(const name of names){
      const surname=words(name).split(' ').at(-1);
      const tokens=title.trim().split(/[\s_]+/);
      if(surname&&tokens.length>=3&&/^[A-Z][\p{L}’-]+$/u.test(tokens[0]!)
        &&words(tokens[0]!)!==surname&&words(tokens[1]!)===surname&&/^\d{4}\b/.test(tokens[2]!))
        return refusal('источник называет другой объект; нужный человек указан в авторстве снимка.');
    }
  }
  if(contains(title)){
    // A shared prefix is not the same person: John Smith Jones != John Smith.
    for(const name of personTarget?names.filter(name=>name.split(/\s+/).length>=2):[]){
      const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const extended=new RegExp('(?:^|[^\\p{L}])'+escaped+'\\s+([A-Z][\\p{L}’\'-]+)(?=$|[\\s,.(])','u').exec(title);
      if(extended&&!/^(?:Portrait|Ship|Clipper|Sailing|Captain|Museum|Owner|At|In|The|And|With|View|Photo|Painting|Drawing|Under|Sails|Hull|Rigging|January|February|March|April|May|June|July|August|September|October|November|December)$/.test(extended[1]!)
        &&!names.some(alias=>hasName(alias, name+' '+extended[1])))return refusal('источник называет другое полное имя: '+extended[0].trim()+'.');
    }
    return;
  }
  const named=/(?:\b(?:[Ss]hip|[Vv]essel|[Cc]lipper|[Aa]ircraft|[Ll]ocomotive|[Cc]anal|[Bb]ridge|[Pp]ortrait\s+of|[Cc]aptain)\s+)[‘'“"]([^’'”"]+)[’'”"]|[‘'“"]([^’'”"]+)[’'”"]\s*\((?:ship|aircraft|locomotive|canal|bridge)\)|\b(?:[Ss]hip|[Vv]essel|[Cc]lipper|[Aa]ircraft|[Ll]ocomotive)\s+(?:named\s+)?([A-Z][\p{L}-]+(?:\s+[A-Z][\p{L}-]+){0,3})/u.exec(title);
  const sailing=/^(?:The\s+)?([A-Z][\p{L}’'-]+(?:\s+[A-Z][\p{L}’'-]+){0,3})\s+\([^)]*\)\s+(?:Sets?\s+Sail|Under\s+Sail)/u.exec(title);
  const namedBeforeClass=/^(?:The\s+)?([A-Z][\p{L}’'-]+(?:\s+(?:[A-Z][\p{L}’'-]+|\d+)){0,3})\s+(?:ferry|steamship|ocean liner|clipper|warship|locomotive|aircraft)\b/u.exec(title);
  const quotedVessel=/\b(?:sailboat|yacht|velero|voilier|segelschiff|яхта|парусник)\s+[‘'“"]([^’'”"]+)[’'”"]/iu.exec(title);
  const place=names.some(name=>/\b(?:canal|bridge|palace|cathedral|ocean|sea|river|gulf|cape)\b/i.test(name))
    ?/\b([A-Z][\p{L}-]+(?:\s+[A-Z][\p{L}-]+){0,2}\s+(?:Canal|Bridge|Palace|Cathedral|Ocean|Sea|River|Stream)|(?:Cape|Gulf)\s+(?:of\s+)?[A-Z][\p{L}-]+(?:\s+[A-Z][\p{L}-]+)?)\b/u.exec(title):undefined;
  const declared=named?.[1]??named?.[2]??named?.[3]??sailing?.[1]??namedBeforeClass?.[1]??quotedVessel?.[1]??place?.[1];
  const genericSubject=/^(?:(?:at|in|on|the|a|an|sea|ocean|harbour|harbor|port|sailing|sail|under|steam|full|four|masted|deck|view|historic|historical|archival|museum|unknown|unidentified)\s*)+$/i;
  if(declared&&!genericSubject.test(declared)&&!names.some(name=>hasName(declared, name)||hasName(name,declared)))return refusal('источник явно называет другой объект: '+declared+'.');
  if(personTarget){
    const portrait=/^(?:(?:Portrait|Photograph|Photo)\s+of\s+)?((?:(?:[A-Z][\p{L}’'-]+)\s+){1,3}[A-Z][\p{L}’'-]+)(?=$|[,.\s])/u.exec(title)?.[1];
    const generic=/\b(?:The|A|An|Unknown|Historic|Historical|Victorian|Museum|Portrait|Photo|Photograph|Captain|Owner|Sailing|Ship|Clipper|Deck|View|Steam|Four|Masted|StateLibQld)\b/u;
    if(portrait&&!generic.test(portrait)&&!names.some(name=>hasName(portrait,name)||hasName(name,portrait)))
      return refusal('источник явно называет другого человека: '+portrait+'.');
  }
}

type Material='aluminium'|'steel';
const mentionsBoth=(value:string)=>/\b(?:aluminium|aluminum)\b|алюминиев\p{L}*/iu.test(value)
  &&/\bsteel\b|стальн\p{L}*/iu.test(value);
function workpieceMaterials(value:string):Set<Material>{
  const materials=new Set<Material>();
  const patterns:Array<[Material,RegExp]>=[
    ['aluminium',/\b(?:aluminium|aluminum)\s+(?:(?:body|automotive|car|thin|rolled|metal)\s+){0,3}(?:components?|panels?|plates?|sheets?|samples?)\b|алюминиев\p{L}*\s+(?:кузовн\p{L}*\s+)?(?:детал|панел|пластин|лист|образц|образец)\p{L}*/giu],
    ['steel',/\bsteel\s+(?:(?:body|automotive|car|thin|rolled|metal)\s+){0,3}(?:components?|panels?|plates?|sheets?|samples?)\b|стальн\p{L}*\s+(?:кузовн\p{L}*\s+)?(?:детал|панел|пластин|лист|образц|образец)\p{L}*/giu]
  ];
  for(const [material,pattern]of patterns)for(const match of value.matchAll(pattern)){
    const prefix=value.slice(Math.max(0,match.index!-24),match.index);
    if(!/\b(?:not|non|without)[\s\-\u2010-\u2015]+(?:an?\s+)?$|не[\s\-\u2010-\u2015]*$/iu.test(prefix))materials.add(material);
  }
  return materials;
}

/** An explicitly contradictory original title is a discovery refusal, never
 * proof that a generic metal image has the required composition or use. */
export function documentaryMaterialMetadataIssue(scene:Scene,source:DocumentaryCandidate):string|undefined{
  const requirement=scene.documentary?.requirement;
  if(requirement){
    const grounded=requirement.aiSearchPlan?.grounding?.mandatory.some(check=>check.kind==='identity');
    const subjectRequirement=grounded&&requirement.footageFallback
      ?{...requirement,footageFallback:undefined,detail:requirement.aiSearchPlan!.visualTarget}:requirement;
    const subjectIssue=documentaryCandidateSubjectIssue(source,subjectRequirement,scene.narration);
    if(subjectIssue)return subjectIssue;
  }
  const target=scene.documentary?.requirement.aiSearchPlan?.visualTarget??scene.documentary?.requirement.detail??'';
  if(/\b(?:route|map|canal)\b|маршрут|карт[аыуе]/iu.test(target)
    &&/\b(?:toy\s+car|origami|paper\s+boat|rolled\s+(?:up\s+)?maps?|decorative\s+maps?)\b|игрушечн|оригами|бумажн\p{L}*\s+кораблик/iu.test(source.title))
    return 'Источник изображает декоративную карту или игрушку, а не географическую схему требуемого маршрута.';
  const identityIssue=identityMetadataIssue(scene,source);
  if(identityIssue)return identityIssue;
  const requirements=scene.documentary?.requirement.scriptRequirements;
  if(!requirements||requirements.mode==='thematic')return;
  const quotes=requirements.checks.filter(check=>check.kind==='object'
    &&scene.narration.includes(check.scriptQuote)).map(check=>check.scriptQuote);
  // Comparisons and titles naming several materials do not bind one specific
  // workpiece. Leave them to the existing actual-frame review.
  if(mentionsBoth(quotes.join(' '))||mentionsBoth(source.title))return;
  const demanded=new Set(quotes.flatMap(quote=>[...workpieceMaterials(quote)]));
  if(demanded.size!==1)return;
  // Generated descriptions, search queries and review hints have no authority.
  const declared=workpieceMaterials(source.title);
  const expected=[...demanded][0]!;
  if(declared.size===1&&!declared.has(expected))return 'Материал заготовки в исходном заголовке противоречит сценарию: '
    +(expected==='aluminium'?'требуется алюминиевая деталь, источник явно называет стальную.':'требуется стальная деталь, источник явно называет алюминиевую.');
}
