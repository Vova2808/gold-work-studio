import assert from 'node:assert/strict';
import {app, BrowserWindow} from 'electron';
import {createRequire} from 'node:module';
import {mkdtempSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createServer} from 'node:http';
import {createVoiceCalibration,voiceCalibrationSampleText} from '@gold-work/shared';

// Real compiled main + preload + disk repository. Only AnyModel HTTP is a local fixture.
// Separate userData: never reads or changes the user's accounts, keys or projects.
const root=mkdtempSync(join(tmpdir(),'gws-ready-ipc-'));
app.setPath('userData',root);delete process.env.PORTABLE_EXECUTABLE_DIR;
let visualRequests=0;const unexpected=[];
const server=createServer(async(req,res)=>{
  try {
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);const prompt=body.messages?.at(-1)?.content??'';
    const count=Number(/Верни ровно (\d+) объектов/u.exec(prompt)?.[1]??0);
    if(!count) { unexpected.push(prompt.slice(0,120));res.writeHead(400);res.end('Unexpected fixture request');return; }
    visualRequests++;
    const content=JSON.stringify(Array.from({length:count},()=>({title:'Visual frame',imagePrompt:'A traveller walks along a quiet forest path, one coherent location.',stockQuery:'traveller forest path',animationPrompt:'Slow camera push-in',narration:'THIS MUST NEVER REPLACE THE READY TEXT'})));
    if(body.stream) {
      res.writeHead(200,{'content-type':'text/event-stream'});
      res.end(`data: ${JSON.stringify({choices:[{delta:{content},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
    } else {res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));}
  } catch(error) {res.writeHead(500);res.end(String(error));}
});
server.listen(0,'127.0.0.1');
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
app.whenReady().then(run).catch(error=>{console.error(error);app.exit(1);});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run() {
try {
  console.log('IPC_APP_READY');
  const baseUrl=`http://127.0.0.1:${server.address().port}/v1`;
  let win;
  for(let i=0;i<150;i++) {win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await wait(100);}
  assert.ok(win);win.hide();
  const evaluate=source=>win.webContents.executeJavaScript(`(async()=>{${source}})()`,true);
  for(let i=0;i<50;i++) {if(await evaluate('return Boolean(window.goldWork?.prepareProjectScript)'))break;await wait(100);}
  const script='  The traveller found a key beside the old workshop.\n\nShe asked a neighbour who owned it.  He recognised the blue key ring and took her to the clockmaker. The clockmaker thanked her and opened the door. Nothing was missing.\n';
  const calibration=createVoiceCalibration({provider:'edge-tts',voice:'edge-tts/en-US-GuyNeural',language:'en',sampleText:voiceCalibrationSampleText('en'),audioDurationSeconds:14,calibratedAt:new Date().toISOString()});
  const result=await evaluate(`
    const api=window.goldWork;
    if('createChatTopic' in api || 'chatWithAnyModel' in api || 'improveScene' in api)throw Error('Retired API still exposed');
    const defaults=await api.getAnyModelSettings();await api.saveAnyModelSettings({...defaults,baseUrl:${JSON.stringify(baseUrl)},apiKey:'local-fixture-only',textModel:'fixture-model'});
    const p=await api.createProject({title:'READY IPC QA',topic:'Ready text only',language:'English',aspectRatio:'16:9',mediaMode:'ai',mode:'standard',videoBrief:{creationMode:'script',readyScript:${JSON.stringify(script)},prompt:'',competitorTranscripts:[]}});
    p.settings.voice={...p.settings.voice,enabled:true,provider:'edge-tts',voice:'edge-tts/en-US-GuyNeural',calibration:${JSON.stringify(calibration)}};
    p.settings.assembly.montage={...p.settings.assembly.montage,enabled:false,planner:'local'};
    await api.updateProject(p.id,{settings:p.settings});
    const prepared=await api.prepareProjectScript(p.id);
    const requestsBefore=prepared.scenes.map(s=>s.id);
    const resumed=await api.prepareProjectScript(p.id);
    await api.updateProject(p.id,{videoBrief:{...p.videoBrief,creationMode:'prompt',readyScript:undefined}});
    let rejection;try{await api.prepareProjectScript(p.id)}catch(e){rejection=String(e)}
    const legacy=await api.getProject(p.id);
    return {id:p.id,prepared,resumed,rejection,legacySceneIds:legacy.scenes.map(s=>s.id),requestsBefore};
  `);
  assert.equal(result.prepared.scenes.map(scene=>scene.narration).join(''),script);
  assert.equal(result.prepared.videoBrief.readyScript,script);assert.equal(result.prepared.chatTopicId,undefined);
  assert.ok(result.prepared.scenes.every(scene=>scene.imagePrompt&&scene.animationPrompt&&scene.durationSeconds<=9));
  assert.equal(result.prepared.status,'ready');assert.equal(result.prepared.referenceAnalysis.scenarioQuality.complete,true);
  assert.deepEqual(result.resumed.scenes.map(scene=>scene.id),result.requestsBefore);
  assert.deepEqual(result.legacySceneIds,result.requestsBefore);assert.match(result.rejection,/Написание сценариев отключено/);
  assert.equal(visualRequests,1,'Ready checkpoint resume must reuse visual prompts');assert.deepEqual(unexpected,[]);
  const stored=JSON.parse(await readFile(join(root,'projects.json'),'utf8')).find(project=>project.id===result.id);
  assert.deepEqual(stored.scenes.map(scene=>scene.id),result.requestsBefore);
  assert.equal(stored.scenes.map(scene=>scene.narration).join(''),script);
  console.log('READY_SCRIPT_IPC_OK',JSON.stringify({exactText:true,scenes:result.prepared.scenes.length,visualRequests,checkpointReused:true,legacyScenesPreserved:true,isolatedData:root}));
  app.exit(0);
} catch(error) {console.error(error);app.exit(1);} finally {server.close();}
}
