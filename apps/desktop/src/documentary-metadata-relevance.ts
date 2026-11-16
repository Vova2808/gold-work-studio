import type {DocumentaryCandidate} from '@gold-work/shared';

export interface DocumentaryMetadataTarget {
  subject?:string;
  visualTarget?:string;
  queries?:readonly string[];
  objectClass?:string;
  excludedClasses?:readonly string[];
}
type MetadataCandidate=Pick<DocumentaryCandidate,'title'|'description'>&Partial<Pick<DocumentaryCandidate,'provider'>>;
const ignored=new Set('a an the and or of in on at to for from by with as is are was were be this that these those its their image photo photograph footage video archival archive historical historic modern view visible showing depicts depicted file jpg jpeg png mp4 webm'.split(' '));
const words=(text:string)=>[...new Set((text.normalize('NFKC').toLowerCase().replace(/\b([a-z]+\d+)[ -]+([a-z])\b/g,'$1$2').match(/[\p{L}\p{N}]+/gu)??[])
  .filter(word=>word.length>1&&!ignored.has(word)).map(word=>/^[a-z]{5,}s$/.test(word)&&!word.endsWith('ss')?word.slice(0,-1):word))];

/** Keep source provenance intact; only this short caption participates in discovery. */
export function documentaryShortMetadata(candidate:MetadataCandidate):{title:string;description:string} {
  const title=candidate.title.replace(/^File:/iu,'').replace(/_/g,' ').slice(0,200);
  const body=candidate.description.replace(/<[^>]*>/g,' ').replace(/\r\n?/g,'\n');
  const field=/(?:^|\n)Description[ \t]*(?:\n|:)/iu.exec(body);
  const caption=(field?body.slice(field.index+field[0].length):body)
    .split(/\n(?:Date|Source|Author|Licensing|File history|File usage|Metadata|Categories|Hidden categories)\b/iu)[0]??'';
  return {title,description:caption.trim().slice(0,300).split(/(?<=[.!?])\s|\n/)[0]??''};
}
const coverage=(target:string,metadata:Set<string>)=>{
  const required=words(target);
  return required.length?required.filter(word=>metadata.has(word)).length/required.length:0;
};
const similarity=(target:string,metadata:Set<string>)=>{
  const required=words(target);
  return required.length&&metadata.size?required.filter(word=>metadata.has(word)).length/Math.sqrt(required.length*metadata.size):0;
};
function excludedClass(candidate:MetadataCandidate,target:DocumentaryMetadataTarget):string|undefined {
  const title=new Set(words(documentaryShortMetadata(candidate).title));
  const requestedClass=Boolean(target.objectClass&&coverage(target.objectClass,title)===1);
  return requestedClass?undefined:target.excludedClasses?.find(value=>words(value).length>0&&coverage(value,title)===1);
}

/** One bounded lexical signal for discovery, never an approval of actual pixels. */
export function documentaryMetadataRelevance(candidate:MetadataCandidate,target:DocumentaryMetadataTarget):number {
  if(excludedClass(candidate,target))return 0;
  const caption=documentaryShortMetadata(candidate),title=new Set(words(caption.title)),description=new Set(words(caption.description));
  const goal=target.visualTarget||target.subject||target.queries?.[0]||'';
  const titleScore=Math.max(similarity(goal,title),target.subject?similarity(target.subject,title)*.9:0);
  // Pixabay has no independent title: its adapter uses the tag list as title.
  // Count that once, at tag weight, retaining concise useful labels.
  if(candidate.provider==='pixabay'&&words(caption.title).join(' ')===words(caption.description.slice(0,200)).join(' '))return titleScore*.35;
  // A tag list or a passing mention cannot outweigh a real title match.
  const bonus=candidate.provider==='pixabay'?.12:.2;
  return Math.min(1,titleScore*.8+similarity(goal,description)*bonus);
}

export const documentaryMetadataRelevanceThreshold=.18;
export function documentaryMetadataRelevanceIssue(candidate:MetadataCandidate,target:DocumentaryMetadataTarget):string|undefined {
  const caption=documentaryShortMetadata(candidate);
  // Classes come from the scene's AI plan, with no topic-specific taxonomy here.
  const excluded=excludedClass(candidate,target);
  if(excluded)return `В заголовке указан исключённый AI-планом класс «${excluded}».`;
  if(!words(target.visualTarget||target.subject||target.queries?.[0]||'').length)return;
  // An uncatalogued local file or a sparse archival record remains available for pixels.
  if(candidate.provider==='local')return;
  const stock=candidate.provider==='pexels'||candidate.provider==='pixabay'||candidate.provider==='web';
  if(!stock&&words(`${caption.title} ${caption.description}`).length<3)return;
  if(documentaryMetadataRelevance(candidate,target)<documentaryMetadataRelevanceThreshold)
    return 'Короткая подпись источника не подтверждает предмет визуальной задачи; платная проверка пропущена.';
}
