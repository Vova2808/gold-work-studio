import {app} from 'electron';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {AnyModelClient,AnyModelCompletionUncertainError} from '../src/anymodel-client.js';
import {AnyModelModelUnavailableError} from '../src/anymodel-text-fallback.js';
import {AnyModelStore} from '../src/anymodel-store.js';
import assert from 'node:assert/strict';
assert.ok(process.argv.includes('--paid'));
const profile='C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
app.setPath('userData',profile);
app.whenReady().then(async()=>{
  const attempt=process.argv.find(value=>value.startsWith('--attempt='))?.split('=')[1] ?? (process.argv.includes('--after-cooldown-fix')?'2':'1');
  assert.match(attempt,/^[1-9]\d*$/);
  const root=resolve('captures/stock-successor-warm-20260926'),path=join(root,`availability-probe-${attempt}.json`);
  if(attempt==='2')assert.equal(JSON.parse(await readFile(join(root,'availability-probe-1.json'),'utf8')).state,'rejected','Previous probe must be explicitly rejected, not uncertain');
  await mkdir(root,{recursive:true});
  assert.equal(await stat(path).then(()=>true,()=>false),false,'This bounded probe already ran; never repeat an uncertain submission');
  const projects=JSON.parse(await readFile(join(profile,'projects.json'),'utf8'));
  const project=projects.find((p:{id:string})=>p.id==='project_muihr14p_xsah7wf');
  const image=await readFile(project.scenes[5].imagePath);
  const client=new AnyModelClient(new AnyModelStore(join(profile,'credentials/anymodel.json')));
  const startedAt=new Date().toISOString();
  await writeFile(path,JSON.stringify({state:'pending',startedAt,purpose:'one-image availability check, no model switch'}));
  try{
    const raw=await client.documentaryCompletion('Describe the main visible subject in at most 20 words. Return JSON only: {"description":"..."}. Do not infer names or locations.','One real frame to check whether the configured visual analysis service has recovered.',[`data:image/jpeg;base64,${image.toString('base64')}`],AbortSignal.timeout(90_000));
    await writeFile(path,JSON.stringify({state:'complete',startedAt,finishedAt:new Date().toISOString(),raw},null,2));
    console.log(JSON.stringify({state:'complete',elapsedSeconds:(Date.now()-Date.parse(startedAt))/1000}));
  }catch(error){
    const state=error instanceof AnyModelModelUnavailableError?'rejected':error instanceof AnyModelCompletionUncertainError?'partial':'uncertain';
    await writeFile(path,JSON.stringify({state,startedAt,finishedAt:new Date().toISOString(),error:String(error).replace(/https?:\/\/\S+/g,'[URL]'),...(error instanceof AnyModelCompletionUncertainError?{raw:error.partial}:{})},null,2));
    console.log(JSON.stringify({state,elapsedSeconds:(Date.now()-Date.parse(startedAt))/1000}));process.exitCode=1;
  }
}).then(()=>app.exit(process.exitCode??0),error=>{console.error(error.message);app.exit(1);});
