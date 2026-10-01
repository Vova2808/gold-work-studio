import assert from 'node:assert/strict';
import {app} from 'electron';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Project,DocumentaryCandidate} from '@gold-work/shared';
import {AnyModelStore} from '../src/anymodel-store.js';
import {AnyModelClient} from '../src/anymodel-client.js';
import {YouTubeStore} from '../src/youtube-store.js';
import {DocumentaryYouTube} from '../src/documentary-youtube.js';
import {DocumentaryIntelligence} from '../src/documentary-intelligence.js';
import {documentaryPreviewKey} from '../src/documentary-preview.js';
import {setDiagnosticSink} from '../src/diagnostics.js';

assert.ok(process.argv.includes('--paid'));
const profile=join(process.env.APPDATA!,'@gold-work/desktop');
const root=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001');
const round=process.argv.find(a=>a.startsWith('--round='))?.slice(8)??'preview-pilot';
assert.match(round,/^[a-z0-9-]+$/);
const out=join(root,round);mkdirSync(out,{recursive:true});
assert.ok(!existsSync(join(out,'started.json')),'Read saved checkpoints; never repeat unknown paid checks');
const isolated=join(out,'electron-profile');mkdirSync(isolated,{recursive:true});copyFileSync(join(profile,'Local State'),join(isolated,'Local State'));
app.setPath('userData',isolated);app.on('window-all-closed',()=>undefined);
app.whenReady().then(async()=>{
  const digest=async()=>createHash('sha256').update(await readFile(join(profile,'projects.json'))).digest('hex');
  const before=await digest(),started=Date.now();let calls=0,tokens=0;
  const project=JSON.parse(await readFile(join(root,'speed-five/project.json'),'utf8')) as Project;
  const game=JSON.parse(await readFile('D:/GoldWorkStorage/Materials/Catalog/626f44fc99eb6ad10afdffadc340d71c38fae87ca53f3923d730f388b1f3f595.json','utf8')) as DocumentaryCandidate;
  const samples=[{name:'known-game-source',candidate:game},...[3,12].map(number=>({name:`saved-real-source-${number}`,candidate:project.scenes.find(scene=>scene.order+1===number)!.documentary!.selected!}))];
  const client=new AnyModelClient(new AnyModelStore(join(profile,'credentials/anymodel.json')));
  const youtube=new DocumentaryYouTube(new YouTubeStore(join(profile,'credentials/youtube.json')));
  const transport=Reflect.get(client,'request').bind(client);
  Reflect.set(client,'request',async(path:string,init:RequestInit={},attempt=0)=>{
    if(init.method==='POST'&&path.includes('/chat/completions')){assert.ok(calls<6,'Six actual POST maximum, including refusals');calls++;}
    return transport(path,init,attempt);
  });
  setDiagnosticSink((_level,event,data)=>{if(event==='anymodel.completion.usage')tokens+=Number(data.totalCount)||0;});
  const intelligence=new DocumentaryIntelligence(client,id=>join('D:/GoldWorkStorage/projects',id));
  writeFileSync(join(out,'started.json'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,maximumCalls:6,before,sources:samples.map(sample=>({name:sample.name,id:sample.candidate.id}))},null,2));
  const results=[];
  for(const {name,candidate} of samples){
    const start=Date.now(),key=documentaryPreviewKey(candidate),directory=join('D:/GoldWorkStorage/Materials/Previews',key);
    try {
      const preview=await youtube.preview(candidate,directory,AbortSignal.timeout(45000));
      const downloadSeconds=(Date.now()-start)/1000;
      const review=await intelligence.inspectPreview(project.id,key,preview);
      const originalBytes=candidate.localPath?await stat(candidate.localPath).then(info=>info.size,()=>undefined):undefined;
      results.push({name,id:candidate.id,downloadSeconds,seconds:(Date.now()-start)/1000,preview,originalBytes,review});
    }catch(error){results.push({name,id:candidate.id,seconds:(Date.now()-start)/1000,error:String(error).replace(/https?:\/\/\S+/g,'[source]')});}
    console.log(JSON.stringify(results.at(-1)));
    writeFileSync(join(out,'partial-results.json'),JSON.stringify(results,null,2));
  }
  const report={at:new Date().toISOString(),seconds:(Date.now()-started)/1000,calls,tokens,registryPreserved:before===await digest(),results,note:'Three known originals test preview transfer/classification only, not new selected scenes or a full-film speed claim.'};
  writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,results:undefined}));app.exit(0);
}).catch(error=>{console.error(String(error));app.exit(1);});
