import type {DocumentarySemanticMontage, Project} from '@gold-work/shared';

type Chapter = NonNullable<DocumentarySemanticMontage['scenes'][number]['chapter']>;
interface Heading { title: string; number?: string; scriptOffset: number; end: number }
const words = (text: string) => [...text.matchAll(/[\p{L}\p{N}]+/gu)].map(match => ({text: match[0].toLocaleLowerCase(), at: match.index!}));

/** Only explicit standalone headings; ordinary paragraphs never become chapters. */
export function explicitScriptChapters(script: string): Heading[] {
  const headings: Heading[] = [];
  const label = /^(?:chapter|cap[ií]tulo|kapitel|глава|часть|part|parte|chapitre|capitolo)\s+([\p{N}]+|[ivxlcdm]+)(?:\s*[:.\-–—]\s*(.*))?$/iu;
  for (const match of script.matchAll(/^([^\r\n]*)(?:\r?\n|$)/gm)) {
    const raw = match[1]!.trim(), markdown = /^#{1,6}\s+(.+?)(?:\s+#+)?$/.exec(raw);
    const text = (markdown?.[1] ?? raw).replace(/^\*\*(.*?)\*\*$/, '$1').trim();
    if (!text || text.length > 180) continue;
    const numbered = label.exec(text) ?? (markdown ? /^(\d+|[IVXLCDM]+)[.)]\s+(.+)$/u.exec(text) : null);
    // A bare sentence starting "Chapter 2 ..." is not a heading unless short
    // and separated from prose. Markdown is already an explicit heading marker.
    if (!markdown && (!numbered || /[.!?]["'”»]?$/.test(text) || text.split(/\s+/).length > 16)) continue;
    headings.push({title: numbered?.[2]?.trim() || text, number: numbered?.[1], scriptOffset: match.index!, end: match.index! + match[0].length});
  }
  return headings;
}

/** Match narration to the complete source, in order. No guessed scene zero. */
export function mapScriptChapters(project: Project): Map<string, Chapter> {
  const script = project.videoBrief?.readyScript;
  const result = new Map<string, Chapter>();
  if (!script) return result;
  const headings = explicitScriptChapters(script), tokens = words(script);
  const scenes = project.scenes.filter(scene => scene.includeInAssembly !== false).sort((a, b) => a.order - b.order);
  const withoutHeadings = tokens.filter(word => !headings.some(h => word.at >= h.scriptOffset && word.at < h.end));
  let cursor = 0;
  const anchored = scenes.flatMap(scene => {
    const spoken = words(scene.narration);
    if (!spoken.length) return [];
    // Full narration must match; heading removal is the only allowed omission.
    let matched: typeof tokens | undefined;
    for(const source of [tokens,withoutHeadings]){
      const found=source.findIndex((word,i)=>word.at>=cursor&&spoken.every((spokenWord,n)=>source[i+n]?.text===spokenWord.text));
      if(found>=0){matched=source.slice(found,found+spoken.length);break;}
    }
    if (!matched) return [];
    cursor = matched.at(-1)!.at + matched.at(-1)!.text.length;
    return [{scene, matched, start: matched[0]!.at, end: matched.at(-1)!.at + matched.at(-1)!.text.length}];
  });
  for (const heading of headings) {
    const nextHeading = headings.find(h => h.scriptOffset > heading.scriptOffset)?.scriptOffset ?? script.length;
    const anchor = anchored.find(row => row.end > heading.scriptOffset && row.start < nextHeading);
    if (!anchor || result.has(anchor.scene.id)) continue;
    // Require the heading itself or the first following narration words. If a
    // section's opening is absent from the cut, don't move its heading later.
    const firstAfter = tokens.find(word => word.at >= heading.end);
    if (anchor.start >= heading.end && anchor.start !== firstAfter?.at) continue;
    const preceding = anchor.matched.filter(word => word.at < heading.scriptOffset).length;
    const duration = Math.max(1 / 30, anchor.scene.documentary?.timing?.speechSeconds ?? anchor.scene.durationSeconds);
    const startSeconds = Math.round(preceding / anchor.matched.length * duration * 30) / 30;
    result.set(anchor.scene.id, {title: heading.title, number: heading.number, scriptOffset: heading.scriptOffset, startSeconds});
  }
  return result;
}
