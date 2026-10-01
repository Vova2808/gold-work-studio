import {app} from 'electron';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {AnyModelClient} from '../src/anymodel-client.js';
import {AnyModelStore} from '../src/anymodel-store.js';

// Read-only catalogue request over the application's configured transport.
// No completion, TTS, provider setting mutation, or production restart.
const out=resolve('captures/montage-speed-20260927/new-production');
app.setPath('userData','C:/Users/rosup/AppData/Roaming/@gold-work/desktop');
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  const store=new AnyModelStore('C:/Users/rosup/AppData/Roaming/@gold-work/desktop/credentials/anymodel.json');
  const settings=await store.publicSettings(),client=new AnyModelClient(store);
  const began=Date.now();
  const response=await Reflect.get(client,'request').call(client,'/v1/models',{method:'GET',signal:AbortSignal.timeout(30000)}) as Response;
  if(!response.ok)throw new Error(`Catalogue HTTP ${response.status}`);
  const body=await response.json() as {data?:Array<{id:string}>};
  const ids=(body.data??[]).map(model=>model.id);
  const base=settings.textModel.split('/').at(-1)!;
  const report={checkedAt:new Date().toISOString(),endpoint:'GET /v1/models',httpStatus:response.status,elapsedMs:Date.now()-began,
    configuredModel:settings.textModel,exactModelListed:ids.includes(settings.textModel),matchingIds:ids.filter(id=>id===base||id.endsWith('/'+base)),
    proxyConfigured:settings.proxyConfigured,paidRequests:0,completionAvailabilityProven:false};
  await mkdir(out,{recursive:true});await writeFile(join(out,'provider-readonly.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));app.exit(0);
}).catch(error=>{console.error(error instanceof Error?error.message.replace(/https?:\/\/\S+/g,'[URL]'):'Read-only check failed');app.exit(1);});
