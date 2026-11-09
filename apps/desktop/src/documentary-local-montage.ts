import {groundedDocumentaryMotion, type DocumentaryMotionGraphic, type Scene} from '@gold-work/shared';

export interface LocalMontageAccent {graphic:DocumentaryMotionGraphic;anchor:string;priority:number}
const words=(s:string)=>s.trim().split(/\s+/u).filter(Boolean);
const trim=(s:string)=>s.trim().replace(/^[,;:\s]+|[.!?;:,\s]+$/gu,'');
const clause=(s:string,max=70)=>Boolean(s&&s.length<=max&&words(s).length<=8);
const relative=/^(?:which|that|because|when|if|котор\p{L}*|если|потому|когда)\s/iu;
const separators=/,\s*(?:(?:and|и)\s+)?|\s+(?:and|и)\s+/iu;
const months='January|February|March|April|May|June|July|August|September|October|November|December';
const number='(?:\\d+(?:[.,]\\d+)?|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundred|thousand|million|billion|один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|двадцать|сорок|сто|тысяч[аи]?|миллион[аов]*)';
const qualifier='(?:(?:only|about|around|nearly|over|under|at least|at most|up to|less than|more than|no more than|not|только|около|почти|до|не более|не менее|более|менее|не)\\s+)?';
const units='(?:%|percent|hours?|minutes?|seconds?|inches|metres?|meters?|kilometres?|km|litres?|liters?|horsepower|hp|kW|tonnes?|tons?|million|billion|dollars?|час[аов]*|минут[аы]*|секунд[аы]*|метр[аов]*|тонн[аы]*|процент[аов]*)';
const quantity=new RegExp(`(?<![\\p{L}\\p{N}])${qualifier}${number}(?:[ -]${units})(?![\\p{L}\\p{N}])`,'iu');
const ratio=new RegExp(`(?<![\\p{L}\\p{N}])${qualifier}${number}\\s+(?:of|out of|из)\\s+${number}(?![\\p{L}\\p{N}])`,'iu');

/** One editorial event per scene, never a transcript or an identity inferred
 * from stock footage. All visible strings are untouched narration substrings. */
export function localMontageAccent(scene:Scene):LocalMontageAccent|undefined {
  const text=scene.narration,seconds=(scene.documentary?.timing?.durationInFrames??Math.ceil(scene.durationSeconds*30))/30;
  if(seconds<2.2)return;
  const event=(suggestion:unknown,anchor:string,priority:number):LocalMontageAccent|undefined=>{
    const graphic=groundedDocumentaryMotion(suggestion,text,text);
    return graphic?{graphic,anchor,priority}:undefined;
  };
  const quoted=/«([^»]{5,240})»|“([^”]{5,240})”|"([^"\n]{5,240})"/u.exec(text);
  if(quoted){
    const title=quoted[1]??quoted[2]??quoted[3]!;
    if(words(title).length<=26&&seconds>=Math.max(2.5,words(title).length*.25+1)){
      const accent=event({kind:'quote',title},title,95);
      if(accent)accent.graphic.quoteMode='phrase';
      return accent;
    }
  }
  // Explicit label/value pairs only; years never become comparison bars.
  const rows=[...text.matchAll(/(?:^|;\s*)([\p{L}][\p{L}\p{N}\s-]{1,46}?)\s*[—–:]\s*(\d+(?:[.,]\d+)?\s*(?:%|km|hp|kW|tons|dollars|км|тонн|процентов))(?=\s*(?:;|[.!?]?$))/giu)];
  if(rows.length>=2&&rows.length<=4&&seconds>=3.5)
    return event({kind:'bar-chart',cards:rows.map(r=>({label:r[1]!.trim(),value:r[2]!.trim()}))},rows[0]![1]!.trim(),92);
  const date=new RegExp(`\\b(?:${months})\\s+(?:\\d{1,2}(?:,)?\\s+)?(?:18|19|20)\\d{2}\\b`,'iu').exec(text)
    ??/(?<!\p{L})\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(?:18|19|20)\d{2}(?!\d)/iu.exec(text);
  if(date)return event({kind:'chronology',variant:'date',value:date[0]},date[0],90);
  const monthYear=new RegExp(`(?<!\\p{L})(?:${months}|январ[ьяе]|феврал[ьяе]|март[ае]?|апрел[ьяе]|ма[йяе]|июн[ьяе]|июл[ьяе]|август[ае]?|сентябр[ьяе]|октябр[ьяе]|ноябр[ьяе]|декабр[ьяе])\\s+(?:18|19|20)\\d{2}(?!\\d)`,'iu').exec(text);
  if(monthYear)return event({kind:'chronology',variant:'date',value:monthYear[0]},monthYear[0],90);
  const amount=ratio.exec(text)??quantity.exec(text);
  const counted=amount??/(?<![\p{L}\p{N}])\d+\s+(?:consecutive\s+)?(?:[\p{Lu}][\p{L}]*\s+){0,3}(?:races|wins|victories)(?!\p{L})/u.exec(text);
  if(counted){
    const accent=event({kind:'statistic',value:counted[0]},counted[0],88);
    // A quantity is a statement from the script, not evidence about this image.
    if(accent)accent.graphic={...accent.graphic,showSource:false,hideTitle:true,variant:'poster'};
    return accent;
  }
  // Geography requires explicit geographic narration and the existing local
  // gazetteer. A race/death merely occurring in a city is not a map request.
  const places=/(?:places|cities|locations|места|города|точки|маршрут)\s*:\s*([^.!?]+)/iu.exec(text);
  if(places){
    const route=places[1]!.split(separators).map(trim).filter(Boolean);
    if(route.length>=2&&route.length<=5){
      const map=event({kind:'map-route',route},route[0]!,90);
      if(map)return map;
    }
  }
  const location=/(?:located in|situated in|находится в|расположен[ао]? в)\s+([\p{L}][\p{L} -]{1,45})(?=[,.!?]|$)/iu.exec(text);
  if(location){const map=event({kind:'map-locator',place:location[1]!.trim()},location[1]!.trim(),85);if(map)return map;}
  const board=(labels:string[],layout:'parts'|'compare'|'steps',title=''):LocalMontageAccent|undefined=>{
    if(labels.length<2||labels.length>4||labels.some(s=>!clause(s)||relative.test(s))
      ||seconds<Math.max(2.3,labels.reduce((sum,s)=>sum+words(s).length,0)*.23+.8))return;
    return {graphic:{kind:'explainer',enabled:true,title,hideTitle:!title,cards:labels.map(label=>({label})),
      boardLayout:layout,variant:layout==='compare'?'poster':'collage',theme:layout==='compare'?'dark':'paper',
      background:layout==='compare'?'grid-dark':'grid-light',origin:'automatic',startSeconds:0,durationSeconds:seconds},anchor:title||labels[0]!,priority:85};
  };
  for(const sentence of text.split(/(?<=[.!?])\s+/u)){
    const contrast=/^(.+?)\s+(?:versus|vs\.?|against|whereas|while|rather than|против|тогда как|вместо)\s+(.+?)[.!?]?$/iu.exec(sentence.trim());
    // "fight against exhaustion" is an action, not a two-sided comparison.
    if(contrast&&!/\b(?:fight|fought|battle|struggle)\s+against\b/iu.test(sentence)){
      const accent=board([trim(contrast[1]!),trim(contrast[2]!)],'compare');if(accent)return accent;
    }
    const choice=/(?:choice|выбор)\s*:\s*(.+?)\s+(?:or|или)\s+(.+?)[.!?]?$/iu.exec(sentence.trim());
    if(choice){const accent=board([trim(choice[1]!),trim(choice[2]!)],'compare');if(accent)return accent;}
    const list=/^(.{3,75}?)(?::|\s+(?:had|includes|contains|consists of|включает|содержит|состоит из)\s+)\s*(.+?)[.!?]\s*$/iu.exec(sentence.trim());
    if(list){
      const labels=list[2]!.split(separators).map(trim).filter(Boolean);
      // A conjunction between two people or a date range is not an itemized
      // list: "Bruce McLaren and Chris Amon win" must remain one statement.
      const predicate=/\b(?:is|are|was|were|has|had|have|will|would|won|win|reach|finished)\b|^(?:from|through|after|before|since|из|после|до)\s/iu;
      const introduction=list[0].slice(0,list[0].indexOf(list[2]!));
      const listContext=/\b(?:includes|contains|consists of|priorities|components|parts|steps|items|features|options|list|roles)\b|(?<!\p{L})(?:включает|содержит|состоит из|приоритет\p{L}*|компонент\p{L}*|детал\p{L}*|этап\p{L}*|пункт\p{L}*|список)(?!\p{L})/iu.test(introduction);
      if((list[2]!.includes(',')||listContext)&&!labels.some(label=>predicate.test(label))){
        const accent=board(labels,'parts');if(accent)return accent;
      }
    }
  }
  const years=/(?<!\d)(?:18|19|20)\d{2}\s+(?:and|to|through|и|по|—|–)\s+(?:18|19|20)\d{2}(?!\d)/iu.exec(text);
  if(years)return event({kind:'chronology',variant:'date',value:years[0]},years[0],80);
  const year=/(?:^|[.!?]\s+|\b(?:in|for|by)\s+|(?<!\p{L})в\s+)((?:18|19|20)\d{2})(?!\d)/iu.exec(text);
  if(year)return event({kind:'chronology',value:year[1]},year[1]!,80);
  const candidates=text.split(/(?<=[.!?])\s+|[;:]\s*/u).map(trim).filter(s=>clause(s,80)&&s.length<text.trim().length*.7&&words(s).length>=2&&!relative.test(s));
  // Prefer a complete consequential clause over the first arbitrary N words.
  const consequence=/\b(?:not|never|win|won|lose|lost|defeat|failed|missing|died|survive|control|victory)\b|(?<!\p{L})(?:не|никогда|побед\p{L}*|поражен\p{L}*|умер\p{L}*|контрол\p{L}*)(?!\p{L})/iu;
  let title=candidates.find(s=>consequence.test(s))??candidates.find(s=>words(s).length>=3);
  if(!title){
    const relativeClause=/(?:\b(?:that|which|who)\s+|(?<!\p{L})котор[а-яё]+\s+)([^.!?;:]+)[.!?]?\s*$/iu.exec(text.trim());
    const fragment=relativeClause&&trim(relativeClause[1]!);
    if(fragment&&clause(fragment,75)&&/\b(?:not|never|no|\w+n't)\b|(?<!\p{L})(?:не|никогда)(?!\p{L})/iu.test(fragment))title=fragment;
  }
  if(!title){
    const predicate=/(?:\b(?:has been|had become|became|become|was|were|is|are|will|would|helped)\s+|(?<!\p{L})(?:стал[аои]?|был[аои]?|будет)\s+)([^.!?;:]+)[.!?]?\s*$/iu.exec(text.trim());
    // Keep negation/qualification inside the extracted phrase.
    const fragment=predicate&&trim(predicate[1]!);
    if(fragment&&clause(fragment,75)&&words(fragment).length>=2&&fragment.length<text.trim().length*.6)title=fragment;
  }
  if(title)return event({kind:'key-point',title},title,55);
  return;
}

/** Editorial onset estimated from the literal position; this is never stored
 * as measured speech/word alignment. A later real reading can replace it. */
export function localAccentTiming(accent:LocalMontageAccent,scene:Scene,seconds:number):{startSeconds:number;durationSeconds:number}{
  const g=accent.graphic,copy=g.kind==='quote'?g.title:g.value||g.title||g.cards?.map(c=>c.label).join(' ')||accent.anchor;
  const duration=Math.min(seconds,Math.max(g.kind==='explainer'||g.kind.startsWith('map-')?3:2.2,Math.min(g.kind==='quote'?9:6,words(copy).length*.3+1.2)));
  const at=Math.max(0,scene.narration.indexOf(accent.anchor)),before=words(scene.narration.slice(0,at)).length,total=Math.max(1,words(scene.narration).length);
  const start=Math.min(seconds-duration,Math.max(0,seconds*before/total-.3));
  const startFrame=Math.max(0,Math.floor(start*30)),frames=Math.min(Math.ceil(duration*30),Math.round(seconds*30)-startFrame);
  return {startSeconds:startFrame/30,durationSeconds:frames/30};
}
