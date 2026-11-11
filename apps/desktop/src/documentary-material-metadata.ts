import type {DocumentaryCandidate,Scene} from '@gold-work/shared';

const words=(value:string)=>value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const hasName=(text:string,name:string)=>(' '+words(text)+' ').includes(' '+words(name)+' ');
const cleanIdentity=(value:string)=>value.replace(/\s+(?:(?:clipper|sailing|steam|preserved|historic)\s+)*(?:ship|vessel|sails|rigging|hull|portrait|aircraft|locomotive)$/i,'').trim();

/** Original source titles can disprove identity; neither a matching name nor
 * an unknown title proves what is actually visible in the media. */
function identityMetadataIssue(scene:Scene,source:DocumentaryCandidate):string|undefined{
  const requirement=scene.documentary?.requirement;
  if(!requirement||requirement.footageFallback||requirement.fastSourcePolicy==='background')return;
  const mandatory=requirement.aiSearchPlan?.grounding?.mandatory;
  const identities=(Array.isArray(mandatory)?mandatory.filter(check=>check?.kind==='identity'):undefined)
    ?.map(check=>({name:check.required,aliases:check.aliases??[]}))??requirement.identities??[];
  const names=[...new Set(identities.flatMap(identity=>[identity.name,...identity.aliases]).map(cleanIdentity).filter(Boolean))];
  if(!names.length)return;
  const title=source.title.replace(/\.(?:jpe?g|png|tiff?|webp)$/i,'');
  const contains=(text:string)=>names.some(name=>hasName(text,name));
  const refusal=(detail:string)=>'Исходный заголовок противоречит идентичности объекта сцены: '+detail;
  const personTarget=/\b(?:portrait|captain|owner|scientist|inventor|artist|composer|writer|admiral|president|king|queen|born)\b|портрет|капитан|владелец|уч[её]ный|изобретател|художник|композитор|писател/iu
    .test(scene.narration+' '+(requirement.detail??requirement.aiSearchPlan?.visualTarget??''));
  // A named grave/monument is a different depicted object from its namesake.
  if(contains(title)&&/\b(?:grave|tomb|gravestone|headstone|tombstone|memorial|monument)\b|могил|надгроб|памятник/iu.test(title)
    && !/\b(?:grave|tomb|memorial|monument)\b|могил|надгроб|памятник/iu.test(requirement.detail??requirement.aiSearchPlan?.visualTarget??''))
    return refusal('изображено захоронение или памятник, а не сам человек/объект.');
  // The camera platform and an author/credit are not the depicted subject.
  const viewpoint=/\b(?:taken|view|seen|photographed|shot)\s+(?:\w+\s+){0,3}from\s+(?:the\s+)?(?:deck|board|aboard|cockpit|bridge)\s+(?:of\s+)?|\b(?:from\s+(?:the\s+)?deck\s+of|photograph(?:ed)?\s+by|painted\s+by|drawn\s+by|photo\s+by|caption(?:ed)?\s+by)\s+|\s+by\s+/iu.exec(title);
  if(viewpoint&&contains(title.slice(viewpoint.index))&&!contains(title.slice(0,viewpoint.index)))
    return refusal('нужное имя указано только как точка съёмки, автор или подпись.');
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
  const place=names.some(name=>/\b(?:canal|bridge|palace|cathedral)\b/i.test(name))
    ?/\b([A-Z][\p{L}-]+(?:\s+[A-Z][\p{L}-]+){0,2}\s+(?:Canal|Bridge|Palace|Cathedral))\b/u.exec(title):undefined;
  const declared=named?.[1]??named?.[2]??named?.[3]??sailing?.[1]??place?.[1];
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
