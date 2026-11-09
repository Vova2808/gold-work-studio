import {groundedDocumentaryMotion,documentaryAccent,type DocumentaryMotionGraphic,type Project,type Scene} from "@gold-work/shared";
import {acceptsAutomaticGraphic,documentaryListSequence,documentarySceneSeconds} from './documentary-sequences.js';
import {explainDocumentaryGraphic,documentaryDetailAnnotations} from './documentary-explainer.js';

const normalize=(text:string)=>text.toLocaleLowerCase().replace(/\s+/gu," ").trim();
const amounts=/(?:(?:не более|не менее|около|примерно|более|почти|до|about|around|over|nearly|at least|up to)\s+(?:(?:на|в)\s+)?)?(?:[$€£]\s*)?\d+(?:[.,]\d+)?(?:[ \u00a0]\d{3})*\s*(?:%|процент[а-я]*|percent(?:age)?|километр[а-я]*|метр[а-я]*|тонн[а-я]*|(?:миллион[а-я]*|тысяч[а-я]*)(?:\s+(?:рубл[а-я]*|доллар[а-я]*|евро))?|рубл[а-я]*|доллар[а-я]*|евро|₽|dollars?|euros?|kilometers?|metres?|meters?|tonnes?|(?:million|thousand)(?:\s+(?:dollars?|euros?))?|кВт|л\.\s*с\.|киловатт[а-я]*)(?=$|[^\p{L}])/giu;
export function documentaryStatisticValue(text:string,value:string):string {
  const standalone=(s:string)=>s.replace(/^((?:около|примерно|более|почти|до)\s+)(?:на|в)\s+/iu,'$1');
  const key=(s:string)=>normalize(standalone(s)).replace(/процент[а-я]*|percent(?:age)?/giu,'%').replace(/^(?:около|примерно|более|почти|до|about|around|over|nearly)\s+/iu,'').replace(/\s+/gu,'');
  const amount=text.match(amounts)?.find(item=>key(item)===key(value));
  return amount?standalone(amount).replace(/\s*(?:процент[а-я]*|percent(?:age)?)/iu,'%'):value;
}
// A relative/conditional clause after a comma is not another list member.
export const documentaryListClause = (text: string) => /^(?:котор\p{L}*|как|что|если|чтобы|когда|потому|хотя|which|that|how|because|when|if)\s/iu.test(text.trim());
const phrase=(text:string,max=120)=>{
  const sentence=text.trim().split(/(?<=[.!?])\s+/u)[0]??'';
  // Never cut a thought at an arbitrary character count ("Не по рельсам…").
  const whole=sentence.length<=max?sentence:sentence.split(/[,;:]\s+/u)[0]??'';
  return whole.length<=max?whole.replace(/[.!?:;]+$/u,''):'';
};

/** Literal, niche-independent editorial events. Never infer a person's role,
 * price or a quotation from a source caption or from a filename. */
export function documentaryEditorialSuggestion(scene:Scene,previousText:string):unknown{
  const text=scene.narration,doc=scene.documentary;
  const quote=/(?:«([^»]{18,320})»|“([^”]{18,320})”|"([^"\n]{18,320})")/u.exec(text);
  if(quote)return {kind:'quote',title:quote[1]??quote[2]??quote[3]};
  const rows=[...text.matchAll(/(?:^|;\s*)([\p{L}\p{N}][\p{L}\p{N}\s-]{1,48}?)\s+[—–:]\s*(\d+(?:[.,]\d+)?\s*(?:%|кВт|kW|hp|км|km|тонн|tons|рублей|dollars|евро|euros))(?=\s*(?:;|[.!?]?$))/giu)];
  if(rows.length>=2&&rows.length<=5)return {kind:'bar-chart',title:'',cards:rows.map(r=>({label:r[1]!.trim(),value:r[2]!.trim()}))};
  if(!doc?.verified||doc.illustrative||!scene.imagePath||scene.videoPath)return undefined;
  const names=doc.requirement.identities?.flatMap(identity=>[identity.name,...identity.aliases])??[];
  const own=` ${normalize(text).replace(/[^\p{L}\p{N}]+/gu,' ')} `;
  const name=names.find(n=>n.length>=3&&own.includes(` ${normalize(n)} `)&&!normalize(previousText).includes(normalize(n)));
  return name?{kind:'subject-card',title:name}:undefined;
}

/** Editorial events are grounded in the original words, without another paid
 * planning pass. Maps already have resolved coordinates in the semantic plan. */
export function planDocumentaryGraphics(project:Project,prepare=false):Map<string,DocumentaryMotionGraphic>{
  // Stock follows the supplied narration; dates and numbers are not requests
  // for an overlay. Authored graphics are retained by the montage planner.
  if(project.mediaMode==='stock')return new Map();
  const scenes=[...project.scenes].sort((a,b)=>a.order-b.order), script=project.videoBrief?.readyScript??scenes.map(s=>s.narration).join("");
  const entries:Array<{scene:Scene;at:number;end:number;members:Array<{scene:Scene;graphic:DocumentaryMotionGraphic}>;priority:number}>=[];
  const reserved:Array<[number,number]>=[];let cursor=0;
  const context=(index:number)=>{
    let first=index,last=index;
    while(first>0&&!/[.!?]\s*$/u.test(scenes[first-1]!.narration))first--;
    while(last+1<scenes.length&&!/[.!?]\s*$/u.test(scenes[last]!.narration))last++;
    const members=scenes.slice(first,last+1);
    return {first,members,text:members.map(s=>s.narration).join("").trim()};
  };
  for(const [index,scene] of scenes.entries()){
    const at=cursor,doc=scene.documentary;
    const duration=Math.max((doc?.timing?.durationInFrames??scene.durationSeconds*30)/30,scene.durationOverrideSeconds??0);
    if(scene.includeInAssembly===false)continue;cursor+=duration;
    if(doc?.motionGraphic?.enabled)reserved.push([at,at]);
    if(!acceptsAutomaticGraphic(scene,prepare)||!doc)continue;
    const sentenceContext=context(index),sentence=sentenceContext.text,own=scene.narration;
    const wholeSentence=sentenceContext.first===index&&sentenceContext.members.every(s=>acceptsAutomaticGraphic(s,prepare));
    if(duration<2.5&&(!wholeSentence||sentenceContext.members.reduce((sum,s)=>sum+documentarySceneSeconds(s),0)<2.5))continue;
    let graphic=documentaryDetailAnnotations(scene)??doc.requirement.motionGraphic??(wholeSentence?sentenceContext.members.find(s=>s.documentary?.requirement.motionGraphic)?.documentary?.requirement.motionGraphic:undefined);
    const amount=sentence.match(amounts)?.[0];
    if(graphic?.kind==='statistic'&&graphic.value)graphic={...graphic,value:documentaryStatisticValue(sentence,graphic.value)};
    if(graphic&&!graphic.title&&['statistic','chronology'].includes(graphic.kind)){
      const factSentence=sentence.split(/(?<=[.!?])\s+/u).find(part=>graphic!.value&&normalize(part).includes(normalize(graphic!.value)))??sentence;
      graphic={...graphic,title:phrase(factSentence)};
    }
    if(!graphic){
      const title=doc.requirement.sectionTitle?.trim();
      const year=/\b(?:18|19|20)\d{2}\b/u.exec(wholeSentence?sentence:own)?.[0];
      const list=sentence.match(/^(.{6,85}?)(?::|\s—\s|\s(?:состоит из|включает(?: в себя)?|содержит|consists of|includes|contains)\s)\s*(.+?)[.!?]?$/iu);
      const items=list?.[2]?.replace(/[.!?]+$/u,"").split(/,\s*|\s+(?:и|and)\s+/iu).map(s=>s.trim()).filter(Boolean);
      const paragraphStart=index===0||/\n\s*\n\s*$/u.test(scenes[index-1]!.narration);
      const editorial=documentaryEditorialSuggestion(scene,scenes.slice(0,index).map(s=>s.narration).join(' '));
      const suggestion=editorial??(title&&normalize(script).includes(normalize(title))?{kind:"chapter-number",title}
        :year?{kind:"chronology",value:year,title:phrase(sentence)}
        :amount&&(wholeSentence||normalize(own).includes(normalize(amount)))?{kind:"statistic",value:documentaryStatisticValue(sentence,amount),title:phrase(sentence)}
        :items&&items.length>=2&&items.length<=5&&items.every(s=>s.length<=55&&!documentaryListClause(s))?{kind:"feature-list",title:list![1],items}
        :paragraphStart&&!title?index>0&&own.trim().length>=80&&own.trim().length<=210?{kind:'quote',title:own.trim()}:{kind:"key-point",title:phrase(sentence,76)}:undefined);
      graphic=groundedDocumentaryMotion(suggestion,sentence,script);
      if(graphic?.kind==="feature-list")graphic={...graphic,activeIndex:undefined};
    }
    if(!graphic)continue;
    graphic={...graphic,accentColor:graphic.accentColor??documentaryAccent(doc.requirement.sectionTitle||doc.requirement.identities?.[0]?.name||graphic.title||doc.requirement.text)};
    if(!graphic.kicker&&/[а-яё]/iu.test(script))graphic={...graphic,kicker:graphic.kind.startsWith("map-")?graphic.kind==="map-route"?"СХЕМА МАРШРУТА":"НА КАРТЕ":graphic.kind==="chapter-number"?"ГЛАВА":graphic.kind==="statistic"?"В ЦИФРАХ":undefined};
    if(graphic.kind==='subject-card')graphic={...graphic,variant:'clean',isolateSubject:false};
    const priority=graphic.kind==='annotations'?95:graphic.kind==="map-route"?100:graphic.kind==="map-locator"?90:graphic.kind==='quote'?88:graphic.kind==='bar-chart'?87:graphic.kind==='subject-card'?86:graphic.kind==="feature-list"?85:graphic.kind==="statistic"?80:graphic.kind==="chronology"?75:graphic.kind==="chapter-number"?65:30;
    if(['feature-list','statistic'].includes(graphic.kind))graphic={...graphic,theme:graphic.theme??'paper'};
    const listMembers=documentaryListSequence(scenes,index,graphic,prepare);
    const members=listMembers.length>1?listMembers:wholeSentence&&sentenceContext.members.length>1&&['statistic','chronology','key-point','map-route','map-locator','feature-list'].includes(graphic.kind)
      ?sentenceContext.members.map(s=>({scene:s,graphic:{...graphic!,sequenceId:`sentence-${scene.id}`}}))
      :documentaryListSequence(scenes,index,graphic,prepare);
    const end=at+members.slice(0,-1).reduce((sum,m)=>sum+documentarySceneSeconds(m.scene),0);
    entries.push({scene,at,end,members:members.map(m=>({...m,graphic:explainDocumentaryGraphic(m.graphic)})),priority});
  }
  const gap=project.settings.assembly.documentary?.pace==="dynamic"?8:12;
  const chosen=new Map<string,DocumentaryMotionGraphic>();
  for(const entry of entries.sort((a,b)=>b.priority-a.priority||a.at-b.at)){
    if(reserved.some(([start,end])=>entry.at<end+gap&&entry.end>start-gap))continue;
    reserved.push([entry.at,entry.end]);
    for(const member of entry.members)chosen.set(member.scene.id,member.graphic);
  }
  return chosen;
}
