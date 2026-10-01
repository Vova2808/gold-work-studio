import assert from 'node:assert/strict';
import {app} from 'electron';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {Project} from '@gold-work/shared';
import {AnyModelStore} from '../src/anymodel-store.js';
import {AnyModelClient} from '../src/anymodel-client.js';
import {DocumentaryIntelligence} from '../src/documentary-intelligence.js';
import {setDiagnosticSink} from '../src/diagnostics.js';
assert.ok(process.argv.includes('--paid'));
const profile=join(process.env.APPDATA!,'@gold-work/desktop');
const root=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001');
const out=join(root,'speed-detail-check');mkdirSync(out,{recursive:true});
assert.ok(!existsSync(join(out,'started.json')),'Read the saved result; never repeat an unknown check');
const isolated=join(out,'electron-profile');mkdirSync(isolated,{recursive:true});copyFileSync(join(profile,'Local State'),join(isolated,'Local State'));
app.setPath('userData',isolated);app.on('window-all-closed',()=>undefined);
app.whenReady().then(async()=>{
  const digest=async()=>createHash('sha256').update(await readFile(join(profile,'projects.json'))).digest('hex');
  const before=await digest(),started=Date.now();let calls=0,tokens=0;
  const project=JSON.parse(await readFile(join(root,'speed-five/project.json'),'utf8')) as Project;
  const client=new AnyModelClient(new AnyModelStore(join(profile,'credentials/anymodel.json')));
  const transport=Reflect.get(client,'request').bind(client);
  Reflect.set(client,'request',async(path:string,init:RequestInit={},attempt=0)=>{
    if(init.method==='POST'&&path.includes('/chat/completions')){assert.ok(calls<2,'Only two new checks');calls++;}
    return transport(path,init,attempt);
  });
  setDiagnosticSink((_level,event,data)=>{if(event==='anymodel.completion.usage')tokens+=Number(data.totalCount)||0;});
  const intelligence=new DocumentaryIntelligence(client,id=>join('D:/GoldWorkStorage/projects',id));
  writeFileSync(join(out,'started.json'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,maximumCalls:2,before}));
  const results=[];
  for(const number of [139,155]){
    const scene=project.scenes.find(scene=>scene.order+1===number)!;
    assert.equal(scene.documentary?.verified,true);
    const start=Date.now();
    try{const result=await intelligence.inspectForSelection(project,scene);results.push({number,seconds:(Date.now()-start)/1000,review:result.review});}
    catch(error){results.push({number,seconds:(Date.now()-start)/1000,error:String(error)});}
  }
  const report={at:new Date().toISOString(),seconds:(Date.now()-started)/1000,calls,tokens,registryPreserved:before===await digest(),results};
  writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(0);
}).catch(error=>{console.error(String(error));app.exit(1);});
