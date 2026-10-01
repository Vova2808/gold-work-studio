import {app} from 'electron';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {AnyModelStore} from '../src/anymodel-store.js';
import {AnyModelClient} from '../src/anymodel-client.js';
import {DocumentaryIntelligence} from '../src/documentary-intelligence.js';
import {EffectLibrary} from '../src/effect-library.js';
app.setPath('userData','C:/Users/rosup/AppData/Roaming/@gold-work/desktop');

async function run(){
  const root=resolve('captures/motion-library-review-20260926'); await mkdir(root,{recursive:true});
  const library=new EffectLibrary('D:/GoldWorkStorage/Library');
  const client=new AnyModelClient(new AnyModelStore('C:/Users/rosup/AppData/Roaming/@gold-work/desktop/credentials/anymodel.json'));
  const intelligence=new DocumentaryIntelligence(client,()=>library.rootPath);
  const snapshot=await library.snapshot();
  const previous=await readFile(join(root,'result.json'),'utf8').then(t=>JSON.parse(t).report as Array<{id:string;error?:string}>,()=>[]);
  const uncertain=new Set(previous.filter(r=>r.error?.includes('Результат запроса неизвестен')).map(r=>r.id));
  // A bounded, diverse useful subset, not hundreds of paid checks at once.
  const chosen=snapshot.assets.filter(a=>(!process.argv.includes('--audio-only')||a.kind==='audio')&&!uncertain.has(a.id)&&!a.deletedAt&&!a.automatic&&a.state==='ready'&&a.review==='pending'&&(
    a.kind==='audio'&&['transition','ding','impact','keyboard'].includes(a.category)&&(a.metadata?.durationSeconds??99)<=4
    || a.kind==='video'&&['review','light-leak'].includes(a.category)&&(a.metadata?.durationSeconds??99)<=1.2)).slice(0,52);
  let cursor=0,failures=0;
  const report:unknown[]=[...previous.filter(r=>!r.error||uncertain.has(r.id))];
  const worker=async()=>{while(cursor<chosen.length&&failures<3){const asset=chosen[cursor++]!;
    try{
      const review=await intelligence.inspectEffect(asset,library.rootPath);
      failures=0;
      report.push({id:asset.id,name:asset.name,...review});
      if(review.suitable&&process.argv.includes('--apply')){
        const path=join(library.rootPath,'Catalog/Assets',asset.id+'.json');
        await copyFile(path,join(root,asset.id+'.before.json'));
        const input={...asset,review:'approved' as const,automatic:true,rights:'user-confirmed' as const,
          rightsNote:'Пользователь предоставил пак и прямо поручил использовать его в монтаже 26.09.2026. Это не независимая проверка лицензии.',
          tags:[...asset.tags,'motion-20260926',review.description.slice(0,60)],
          category:asset.kind==='video'?'transition' as const:asset.category,
          defaults:{...asset.defaults,...asset.kind==='audio'?{volume:65,fadeInSeconds:.02,fadeOutSeconds:Math.min(.12,(asset.metadata?.durationSeconds??1)/4)}:{blend:'screen' as const,opacity:65}}};
        await library.update(asset.id,input);
      }
      console.log(JSON.stringify({name:asset.name,suitable:review.suitable,done:report.length,total:chosen.length}));
    }catch(error){failures++; report.push({id:asset.id,name:asset.name,error:String(error)});console.log(JSON.stringify({name:asset.name,failed:true,failures}));}
    await writeFile(join(root,'result.json'),JSON.stringify({chosen:chosen.length,report},null,2));
  }};
  await Promise.all([worker(),worker()]);
  console.log(JSON.stringify({root,reviewed:report.length,failures}));
}
void app.whenReady().then(run).then(()=>app.exit(0),e=>{console.error(e.message);app.exit(1);});
