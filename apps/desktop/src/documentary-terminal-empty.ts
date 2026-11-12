import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {DocumentaryCandidate,Scene} from '@gold-work/shared';
import {checksumFile} from './effect-library.js';
export type DocumentaryTerminalEmptySource=DocumentaryCandidate&{checksum:string};

/** A settled empty answer permits work on OTHER sources, never another
 * payment for these bytes. Read only; preserve the receipt and quarantine. */
export async function documentaryTerminalEmptySources(root:string,model:string,scenes:Scene[]):Promise<Map<string,DocumentaryTerminalEmptySource[]>>{
  const result=new Map<string,DocumentaryTerminalEmptySource[]>();
  const directory=join(root,'Documentary','Analysis');
  const files=await readdir(directory).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;});
  const inspected=new Map<string,DocumentaryTerminalEmptySource|undefined>();
  for(const name of files){
    if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
    const receipt=JSON.parse(await readFile(join(directory,name),'utf8'));
    const legacy=receipt?.state==='complete'&&receipt.result?.status==='uncertain';
    if(receipt?.purpose!=='visual-illustration'||receipt.model!==model
      ||!(receipt.state==='rejected'&&receipt.rejection==='empty-response'||legacy)
      ||receipt.raw!==''||receipt.completion?.disposition!=='empty'||receipt.completion.receivedCharacters!==0
      ||typeof receipt.completedAt!=='string'||!Number.isFinite(Date.parse(receipt.completedAt)))continue;
    const binding=receipt.singleReviewBinding;
    if(!/^[a-f0-9]{64}$/.test(binding?.checksum??'')||binding?.quality?.version!==1
      ||typeof binding.quality.narration!=='string'||!binding.quality.narration.trim()
      ||!Number.isFinite(binding.start)||!Number.isFinite(binding.end)||binding.start<0||binding.end<binding.start)continue;
    for(const scene of scenes){
      if(scene.narration!==binding.quality.narration)continue;
      const key=scene.id+':'+binding.checksum;
      if(!inspected.has(key)){
        const path=join(root,'Documentary',scene.id.replace(/[^a-zA-Z0-9_-]/g,'_'),binding.checksum+'.source.json');
        const source=await readFile(path,'utf8').then(text=>JSON.parse(text) as DocumentaryTerminalEmptySource,
          (error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return;throw error;});
        inspected.set(key,source&&source.checksum===binding.checksum&&typeof source.localPath==='string'
          &&typeof source.id==='string'&&typeof source.provider==='string'&&(source.kind==='image'||source.kind==='video')
          &&await checksumFile(source.localPath).catch(()=>undefined)===binding.checksum?source:undefined);
      }
      const source=inspected.get(key);
      if(source){const sources=result.get(scene.id)??[];if(!sources.includes(source))sources.push(source);result.set(scene.id,sources);}
    }
  }
  return result;
}
