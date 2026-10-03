import {readFile,mkdir,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {EffectLibrary} from '../src/effect-library.js';
import {measureEffectAccent} from '../src/effect-media.js';
import {atomicWrite} from '../src/fs-utils.js';
const root=resolve('captures/motion-library-review-20260926'),library=new EffectLibrary('D:/GoldWorkStorage/Library');
const result=JSON.parse(await readFile(join(root,'result.json'),'utf8')) as {report:Array<{id:string;suitable?:boolean}>};
const approved=new Set(result.report.filter(r=>r.suitable).map(r=>r.id));
const assets=(await library.snapshot()).assets.filter(a=>approved.has(a.id)&&a.automatic&&a.tags.includes('motion-20260926'));
await mkdir(join(root,'tune-backup'),{recursive:true});
for(const asset of assets){
  await copyFile(join(library.rootPath,'Catalog/Assets',asset.id+'.json'),join(root,'tune-backup',asset.id+'.json'));
  const updated=await library.update(asset.id,{...asset,defaults:{...asset.defaults,...asset.kind==='audio'?{volume:65,fadeInSeconds:.02,fadeOutSeconds:Math.min(.12,(asset.metadata?.durationSeconds??1)/4)}:{blend:'screen',opacity:65}}});
  if(asset.kind==='audio'&&asset.metadata){
    const accentSeconds=await measureEffectAccent(join(library.rootPath,asset.file));
    await atomicWrite(join(library.rootPath,'Catalog/Assets',asset.id+'.json'),JSON.stringify({...updated,metadata:{...asset.metadata,accentSeconds}},null,2));
  }
}
console.log(JSON.stringify({tuned:assets.length,audio:assets.filter(a=>a.kind==='audio').length,visual:assets.filter(a=>a.kind!=='audio').length}));
