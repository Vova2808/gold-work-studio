import {documentaryRatioGroupsMatch,type DocumentaryMotionGraphic,type DocumentaryRatioGroup,type Scene} from '@gold-work/shared';

const literal=(s:string)=>s.toLocaleLowerCase().replace(/\s+/gu,' ').trim();
const countWords:Record<string,number>={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
  eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,
  thirty:30,forty:40,fifty:50,sixty:60,ноль:0,один:1,одна:1,одно:1,два:2,две:2,три:3,четыре:4,пять:5,шесть:6,семь:7,
  восемь:8,девять:9,десять:10,одиннадцать:11,двенадцать:12,тринадцать:13,четырнадцать:14,пятнадцать:15,шестнадцать:16,
  семнадцать:17,восемнадцать:18,девятнадцать:19,двадцать:20,тридцать:30,сорок:40,пятьдесят:50,шестьдесят:60};
const quotedCounts=(text:string)=>{
  const tokens=literal(text).match(/\d+(?:[.,]\d+)?|\p{L}+/gu)??[],counts:number[]=[];
  for(let i=0;i<tokens.length;i++){
    const token=tokens[i]!,value=countWords[token]??(/^\d/u.test(token)?Number(token.replace(',','.')):undefined);
    if(value===undefined)continue;
    const next=countWords[tokens[i+1]??''];
    if(value>=20&&value%10===0&&next!==undefined&&next>0&&next<10){counts.push(value+next);i++;}
    else counts.push(value);
  }
  return counts;
};

/** Quotes are exact narration, never external evidence. A single unnamed
 * numerator remainder may be derived only after another part is explicit. */
export function groundedDocumentaryRatioGroups(value:unknown,narration:string,amount:number,total:number,ratioLabel:string):DocumentaryRatioGroup[]|undefined{
  if(!documentaryRatioGroupsMatch(value,amount,total))return;
  const text=literal(narration);
  if(value.some(g=>!text.includes(literal(g.sourceQuote))||!text.includes(literal(g.label))))return;
  const parts=value.slice(0,-1),anchored=parts.map(g=>quotedCounts(g.sourceQuote).includes(g.amount));
  if(!anchored.some(Boolean)||parts.some((g,i)=>!anchored[i]&&quotedCounts(g.sourceQuote).length>0))return;
  const rest=value.at(-1)!;
  if(!quotedCounts(rest.sourceQuote).includes(rest.amount)&&!literal(rest.sourceQuote).includes(literal(ratioLabel)))return;
  return value.map(g=>({amount:g.amount,label:g.label.trim(),sourceQuote:g.sourceQuote.trim()}));
}

/** Exact numerical statements only. This never inspects, selects or labels a
 * point in the footage. The drawing is a schematic of the narrated fact. */
export function documentaryDiagram(scene:Scene,graphic:DocumentaryMotionGraphic):DocumentaryMotionGraphic['diagram'] {
  if(!['statistic','key-point'].includes(graphic.kind)||graphic.origin!=='automatic')return;
  const value=graphic.value||(graphic.kind==='key-point'?graphic.title:''),text=scene.narration;
  if(!value||!literal(text).includes(literal(value)))return;
  // Keep the model's literal unit/context (e.g. "14 of 16 races"). A bare
  // anchored pair is not the only way an exact proportion is narrated.
  const ratio=/^(?:only\s+|just\s+|только\s+|всего\s+)?(\d+)\s*(?:out of|of|из|\/)\s*(?:(?:the\s+)?(?:previous\s+|last\s+|first\s+|remaining\s+)?)?(\d+)(?:\s+[\p{L}][\p{L}\s-]{0,70})?$/iu.exec(value.trim());
  if(ratio){
    const amount=Number(ratio[1]),total=Number(ratio[2]);
    if(total>=2&&total<=60&&amount>=0&&amount<=total){
      const supplied=graphic.ratioGroups??scene.documentary?.semanticMontage?.composition?.ratioGroups;
      const groups=groundedDocumentaryRatioGroups(supplied,text,amount,total,value);
      return {kind:'ratio',amount,total,label:value,object:/\b(?:cars?|fords?|vehicles?)\b|автомобил|машин/iu.test(text)?'car':undefined,...(groups?{groups}:{})};
    }
  }
  if(graphic.kind!=='statistic')return;
  const interval=/^(?:(?:only|just|more than|less than|over|under|только|всего|больше|меньше|более|менее)\s+)?(\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|одну|одна|две|три|четыре|пять|шесть|семь|восемь|девять|десять)\s*(seconds?|milliseconds?|секунд(?:а|ы|у)?|миллисекунд(?:а|ы|у)?)$/iu.exec(value.trim());
  const gap=/\b(?:win|won|lost|lose|faster|slower|ahead|behind|difference|gap|margin|earlier|later)\b|разниц|отставан|оперед|быстрее|медленнее|раньше|позже|выиграл|победил/iu.test(text);
  const literalNumbers:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,одну:1,одна:1,две:2,три:3,четыре:4,пять:5,шесть:6,семь:7,восемь:8,девять:9,десять:10};
  const intervalAmount=interval?(literalNumbers[interval[1]!.toLocaleLowerCase()]??Number(interval[1]!.replace(',','.'))):NaN;
  if(interval&&gap&&intervalAmount>0){
    const amount=intervalAmount*(/^milli|^милли/iu.test(interval[2]!)?.001:1);
    return {kind:'time-gap',amount,label:value};
  }
  const hours=/^(?:all\s+|only\s+|все\s+|только\s+)?(\d+(?:[.,]\d+)?)\s*(?:hours?|час(?:а|ов)?)$/iu.exec(value.trim());
  if(hours&&Number(hours[1])>0&&Number(hours[1])<=24)return {kind:'duration',amount:Number(hours[1]),label:value};
  const measure=/^(?:only\s+|just\s+|только\s+|всего\s+)?(\d+(?:[.,]\d+)?)\s*(inches|metres?|meters?|метр(?:а|ов)?)$/iu.exec(value.trim());
  if(measure&&/\bheight\b|высот/iu.test(text))return {kind:'measure',amount:Number(measure[1]!.replace(',','.')),unit:measure[2],label:value};
  const capacity=/(\d+(?:[.,]\d+)?)[ -]?(?:litres?|liters?|литр\p{L}*|cc|cm[³3]|см[³3])(?=$|[^\p{L}\p{N}])/iu.exec(value);
  const cylinders=/\bV([2-9]|1[02])\b/iu.exec(text);
  if(capacity&&cylinders)return {kind:'engine',amount:Number(capacity[1]!.replace(',','.')),total:Number(cylinders[1]),label:value,unit:cylinders[0]};
  const period=/(\d+)\s+(?:consecutive\s+)?(?:[\p{Lu}][\p{L}]*\s+){0,3}(?:races|wins|victories)[^.]*?\bfrom\s+(\d{4})\s+(?:through|to)\s+(\d{4})/u.exec(text)
    ??/\b(?:answered|responded)\s+with\s+(\d+),?\s+from\s+(\d{4})\s+(?:through|to)\s+(\d{4})/iu.exec(text);
  if(period&&Number(/^\d+/u.exec(value)?.[0])===Number(period[1])&&Number(period[3])-Number(period[2])+1===Number(period[1])&&Number(period[1])<=12)
    return {kind:'period',amount:Number(period[1]),fromYear:Number(period[2]),toYear:Number(period[3]),label:graphic.title||/^([\p{L}][\p{L} -]{0,40})\s+(?:answered|responded)\b/iu.exec(text)?.[1]||value};
  return;
}
