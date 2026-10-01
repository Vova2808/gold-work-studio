import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {EffectLibrary} from '../src/effect-library.js';
// Only this explicitly supplied pack. The contact sheet and multiple frames
// of its neutral grid loops were reviewed locally, without paid services.
const library=new EffectLibrary('D:/GoldWorkStorage/Library');
const snapshot=await library.snapshot();
const selected=snapshot.assets.filter(a=>a.origins.some(o=>o.originalPath.includes('фоны горизонтальные')));
if(selected.length!==22)throw Error(`Expected 22 imported backgrounds, found ${selected.length}`);
const results=[];
for(const asset of selected){
  const index=Number(asset.name.match(/_(\d+)/u)?.[1]??1);
  const suitable=[1,5,6,10,13].includes(index)&&(asset.metadata?.width??0)>=1280;
  const tag=index===6?'editorial-light':'editorial-dark';
  const updated=await library.update(asset.id,{...asset,category:'background',automatic:suitable,review:suitable?'approved':'rejected',rights:'user-confirmed',rightsNote:'Пак предоставлен пользователем 28.09.2026 с прямым поручением добавить и использовать в роликах. Независимая проверка лицензии не проводилась.',tags:[...asset.tags,'user-background-pack',...(suitable?[tag]:[])],defaults:{...asset.defaults,opacity:100,volume:0,sourceAudio:false,fadeInSeconds:0,fadeOutSeconds:0}});
  results.push({id:updated.id,name:updated.name,width:updated.metadata?.width,height:updated.metadata?.height,automatic:updated.automatic});
}
await writeFile(resolve('captures/vidrush-reference-20260928/backgrounds/review.json'),JSON.stringify({reviewedAt:new Date().toISOString(),results},null,2));
console.log(JSON.stringify(results));
