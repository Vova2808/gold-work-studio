import {app} from 'electron';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {AnyModelClient} from '../src/anymodel-client.js';
import {AnyModelStore} from '../src/anymodel-store.js';
import {proxyFetch} from '../src/proxy-utils.js';

// A single short text response distinguishes payload size from a broken
// completion route. Same saved model/provider/proxy; no image/video generation.
assert.ok(process.argv.includes('--paid-one'));
const out=resolve('captures/montage-speed-20260927/new-production');
const path=join(out,'one-short-completion.json');
app.setPath('userData','C:/Users/rosup/AppData/Roaming/@gold-work/desktop');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  await mkdir(out,{recursive:true});
  const began=Date.now(),report:Record<string,unknown>={startedAt:new Date().toISOString(),state:'pending',purpose:'One short response to diagnose repeated terminal plan timeouts',maxRequests:1};
  await writeFile(path,JSON.stringify(report,null,2),{flag:'wx'});
  const store=new AnyModelStore('C:/Users/rosup/AppData/Roaming/@gold-work/desktop/credentials/anymodel.json');
  const settings=await store.publicSettings();report.model=settings.textModel;report.proxyConfigured=settings.proxyConfigured;
  let requests=0;
  const client=new AnyModelClient(store,async(url,init,proxy)=>{
    assert.equal(++requests,1,'This probe cannot submit twice');
    const response=await proxyFetch(url,init,proxy);
    report.httpStatus=response.status;report.headersAfterMs=Date.now()-began;
    report.contentType=response.headers.get('content-type');report.requestId=response.headers.get('x-request-id');
    await writeFile(path,JSON.stringify(report,null,2));return response;
  });
  try{
    const raw=await Reflect.get(client,'chatOnce').call(client,settings.textModel,
      [{role:'system',content:'Return only this JSON object: {"ok":true}'},{role:'user',content:'API response check. Reply now.'}],
      64,'medium',undefined,120000,{idleTimeoutMs:90000});
    report.state='complete';report.response=raw;
  }catch(error){
    report.state='error';report.errorName=error instanceof Error?error.name:'Unknown';
    report.error=error instanceof Error?error.message.replace(/(?:https?|socks5h?):\/\/\S+/g,'[URL]').replace(/(?:Bearer\s+|sk-)[\w.-]+/g,'[hidden]'):String(error);
  }
  report.requests=requests;report.elapsedMs=Date.now()-began;report.finishedAt=new Date().toISOString();
  await writeFile(path,JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(report.state==='complete'?0:1);
}).catch(error=>{console.error(error instanceof Error?error.message:'Probe failed');app.exit(1);});
