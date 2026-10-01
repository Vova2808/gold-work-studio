import { app, BrowserWindow, crashReporter } from 'electron';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// User-authorized control run through the production main/preload API; never a mock.
const mode = process.argv[2] ?? 'inspect';
const out = resolve('captures/documentary-control'); await mkdir(out, {recursive:true});
const crashDumps = resolve(out, 'crash-dumps'); await mkdir(crashDumps, {recursive:true});
app.setPath('crashDumps', crashDumps);
crashReporter.start({ uploadToServer: false });
setInterval(() => {
  const memory = process.memoryUsage();
  console.log('CONTROL_MEMORY ' + JSON.stringify({ rssMiB: Math.round(memory.rss / 1024 ** 2), heapMiB: Math.round(memory.heapUsed / 1024 ** 2), externalMiB: Math.round(memory.external / 1024 ** 2) }));
}, 30000).unref();
const statePath = resolve(out, 'state.json');
let state = await readFile(statePath,'utf8').then(JSON.parse,()=>({}));
const checkpoint = async input => { state={...state,...input,updatedAt:new Date().toISOString()};await writeFile(statePath,JSON.stringify(state,null,2)); };
app.setPath('userData', 'C:\\Users\\rosup\\AppData\\Roaming\\@gold-work\\desktop');
delete process.env.PORTABLE_EXECUTABLE_DIR;
createRequire(import.meta.url)(resolve('dist/main/index.cjs'));
app.whenReady().then(run).catch(e=>{console.error(String(e));app.exit(1);});
async function run() {
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  try {
    let win;
    for(let i=0;i<180;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await wait(100);}
    assert.ok(win);win.hide();win.webContents.setBackgroundThrottling(false);
    const evaluate=source=>win.webContents.executeJavaScript(`(async()=>{${source}})()`,true);
    for(let i=0;i<100;i++){if(await evaluate('return Boolean(window.goldWork?.getVoicerSettings)'))break;await wait(100);}
    const api=async(method,...args)=>evaluate(`return window.goldWork[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
    if(mode==='health'){
      const voice=await api('getVoicerSettings'), ai=await api('getAnyModelSettings');
      console.log(JSON.stringify({lumeanConfigured:voice.configured,lumeanProxy:voice.proxyConfigured,anyModelConfigured:ai.configured,anyModelModel:ai.textModel,anyModelProxy:ai.proxyConfigured}));
      const test=await api('testAnyModelConnection');console.log(JSON.stringify({anyModel:test}));
    } else if(mode==='curate') {
      const choices=JSON.parse(await readFile(resolve(out,'curated-effects.json'),'utf8'));
      const reports=[];
      for(const choice of choices){
        const asset=(await api('getEffectLibrary')).assets.find(asset=>asset.id===choice.id);assert.ok(asset);
        if(asset.automatic&&asset.review==='approved'){console.log(`Keep curated: ${asset.name}`);continue;}
        const review=await api('analyzeEffect',asset.id);reports.push({id:asset.id,name:asset.name,...review});
        await writeFile(resolve(out,'effect-reviews.json'),JSON.stringify(reports,null,2));
        console.log(JSON.stringify({name:asset.name,...review}));
        if(review.suitable)await api('updateEffect',asset.id,{...asset,category:choice.category??asset.category,automatic:true,review:'approved',rights:'user-confirmed',rightsNote:'Предоставлено владельцем для использования в монтаже; прямой запрос 2026-09-15. Анализ образца: '+review.description,tags:[...new Set([...asset.tags,'documentary','популярные'])],defaults:{...asset.defaults,...choice.defaults,sourceAudio:false}});
      }
    } else if(mode==='extend') {
      let project=await api('getProject',state.projectId);assert.ok(project);
      const previous=await readFile(resolve(out,'script-en.txt'),'utf8');
      const script=await readFile(resolve(out,'script-en-5min.txt'),'utf8');
      assert.ok(project.videoBrief.readyScript===previous || project.videoBrief.readyScript===script);
      if(project.videoBrief.readyScript!==script){
        await writeFile(resolve(out,'project-before-5min.json'),JSON.stringify(project,null,2));
        project=await api('updateProject',project.id,{videoBrief:{...project.videoBrief,readyScript:script}});
      }
      project=await api('prepareProjectScript',project.id);
      await checkpoint({scriptFile:'script-en-5min.txt',scenes:project.scenes.length,semanticPlanned:project.scenes.filter(scene=>scene.documentary?.requirement.plannedBy==='semantic').length});
      console.log(JSON.stringify({scenes:project.scenes.length,planned:state.semanticPlanned,estimatedSeconds:project.scenes.reduce((sum,scene)=>sum+scene.durationSeconds,0)}));
    } else if(mode==='replan') {
      let project=await api('getProject',state.projectId);assert.ok(project);
      project=await api('updateProject',project.id,{settings:{...project.settings,assembly:{...project.settings.assembly,documentary:{...project.settings.assembly.documentary,pace:'dynamic',autoEffects:true}}}});
      project=await api('prepareProjectScript',project.id);
      await checkpoint({scenes:project.scenes.length,semanticPlanned:project.scenes.filter(scene=>scene.documentary?.requirement.plannedBy==='semantic').length});
      console.log(JSON.stringify({scenes:project.scenes.length,planned:state.semanticPlanned,estimatedSeconds:project.scenes.reduce((sum,scene)=>sum+scene.durationSeconds,0)}));
    } else if(mode==='automatic') {
      let project=await api('getProject',state.projectId);assert.ok(project);
      const build=await api('getAppInfo');
      const expected=(await readFile(resolve('src/generated-build-identity.ts'),'utf8')).match(/APP_BUILD_ID = "([^"]+)"/)[1];
      assert.equal(build.buildId,expected);console.log(`Production build verified: ${build.buildId}`);
      await evaluate(`window.goldWork.onAutoStockProgress(progress=>console.log('STOCK_PROGRESS '+JSON.stringify({phase:progress.phase,completed:progress.completed,total:progress.total,selected:progress.selected,failed:progress.failed,message:progress.message})))`);
      win.webContents.on('console-message',(_event,_level,message)=>{if(message.startsWith('STOCK_PROGRESS '))console.log(message);});
      await checkpoint({automaticStartedAt:new Date().toISOString(),lastError:null,failedStep:null,reviewedMaterials:project.scenes.filter(scene=>scene.documentary?.verified).length,remainingMaterials:project.scenes.filter(scene=>!scene.documentary?.verified).length,buildId:build.buildId});
      const selectedOrders=process.argv.find(arg=>arg.startsWith('--scenes='))?.slice(9).split(',').map(Number);
      if(selectedOrders)assert.ok(selectedOrders.every(order=>Number.isInteger(order)&&project.scenes.some(scene=>scene.order===order)));
      if(process.argv.includes('--recheck')) {
        assert.ok(selectedOrders?.length,'Recheck must name a bounded set of scenes');
        await writeFile(resolve(out,`before-recheck-${Date.now()}.json`),JSON.stringify(project.scenes.filter(scene=>selectedOrders.includes(scene.order)),null,2));
        project=await api('updateProject',project.id,{scenes:project.scenes.map(scene=>selectedOrders.includes(scene.order)?{...scene,documentary:{...scene.documentary,verified:false,autoError:'Нужна повторная автоматическая проверка материала'}}:scene)});
      }
      const options={force:process.argv.includes('--force'),...(selectedOrders?{sceneIds:project.scenes.filter(scene=>selectedOrders.includes(scene.order)).map(scene=>scene.id)}:{})};
      const result=await api('autoSelectStock',project.id,options);
      await checkpoint({automaticSelected:result.selected,automaticFailed:result.failed,automaticSkipped:result.skipped,reviewedMaterials:result.project.scenes.filter(scene=>scene.documentary?.verified).length,remainingMaterials:result.project.scenes.filter(scene=>!scene.documentary?.verified).length,verifiedVideos:result.project.scenes.filter(scene=>scene.documentary?.verified&&scene.videoPath).length});
      await writeFile(resolve(out,'automatic-results.json'),JSON.stringify(result,null,2));
      console.log(JSON.stringify({selected:result.selected,failed:result.failed,skipped:result.skipped,videos:result.project.scenes.filter(scene=>scene.videoPath).length}));
    } else if(mode==='reject-wrong-range') {
      const project=await api('getProject',state.projectId);const scene=project.scenes.find(item=>item.order===57);assert.ok(scene);
      assert.equal(scene.documentary.checksum,'16091d5828db011d1a2c233579de4e534e72a279426737fbebdb7aff3331e4c4');
      assert.equal(scene.trimStartSeconds,86);
      await writeFile(resolve(out,'project-before-identity-review.json'),JSON.stringify(project,null,2));
      const updated=await api('reviewDocumentaryMaterial',project.id,scene.id,{verified:false,illustrative:false,rightsConfirmed:false,note:'Проверка кадров 86–89,78 с: видна красная труба с эмблемой Carnival, а не Icon of the Seas. Название общего видео с двумя судами не подтверждает личность судна в выбранном участке. Требуется другой фрагмент или материал.'});
      await checkpoint({identityReviewRejectedOrder:57,reviewedMaterials:updated.scenes.filter(s=>s.documentary?.verified).length});
      console.log(JSON.stringify({verified:updated.scenes.find(s=>s.id===scene.id).documentary.verified,retainedOriginal:true}));
    } else if(mode==='narrate'||mode==='resume-narration') {
      const build=await api('getAppInfo');
      const expected=(await readFile(resolve('src/generated-build-identity.ts'),'utf8')).match(/APP_BUILD_ID = "([^"]+)"/)[1];
      assert.equal(build.buildId,expected);console.log(`Production build verified: ${build.buildId}`);
      let project=await api('getProject',state.projectId);assert.ok(project);
      assert.equal(project.settings.voice.voice,state.voice.uuid);assert.equal(project.settings.voice.singleTrack,true);
      assert.equal(project.scenes.filter(scene=>scene.includeInAssembly!==false).sort((a,b)=>a.order-b.order).map(scene=>scene.narration).join(''),await readFile(resolve(out,'script-en-5min.txt'),'utf8'));
      const prior=(await api('getQueue')).filter(task=>task.projectId===project.id);
      let tasks;
      if(mode==='resume-narration') {
        assert.equal(prior.length,1);const task=prior[0];assert.equal(task.kind,'speech');assert.equal(task.status,'failed');
        assert.ok(task.lumeanOrder?.orderId&&!task.pendingSubmission&&!task.retryBlockedReason);
        await checkpoint({narrationDownloadResumedAt:new Date().toISOString(),resumedTaskId:task.id});
        tasks=[await api('retryTask',task.id)];
      } else {
        if(prior.some(task=>task.status!=='done'))throw new Error('Проверить прежнюю очередь и сохранённые заказы перед озвучкой');
        if(state.narrationRequested&&!project.scenes.every(scene=>scene.audioPath))throw new Error('Запрос озвучки уже отмечен; проверить сохранённую очередь');
        await checkpoint({narrationRequested:true,narrationRequestedAt:new Date().toISOString()});
        tasks=await api('startGeneration',project.id,'narration');
      }
      assert.ok(tasks.every(task=>task.kind==='speech'));
      const ids=new Set(tasks.map(task=>task.id));
      for(;;){
        const current=(await api('getQueue')).filter(task=>ids.has(task.id));
        if(current.some(task=>['failed','paused','blocked','cancelled'].includes(task.status)))throw new Error('Озвучка требует внимания; сохранённый заказ не повторять');
        if(current.every(task=>task.status==='done'))break;
        await wait(1500);
      }
      project=await api('getProject',project.id);
      assert.ok(project.scenes.every(scene=>scene.includeInAssembly===false||scene.audioPath&&scene.narrationSlice));
      const audioPath=project.scenes[0].audioPath;
      await checkpoint({narrationCompletedAt:new Date().toISOString(),audioPath});
      console.log(JSON.stringify({audioPath,scenes:project.scenes.length,alignment:project.scenes[0].documentary.narrationAlignment}));
    } else if(mode==='produce') {
      let project=await api('getProject',state.projectId);assert.ok(project);
      assert.ok(project.scenes.every(scene=>scene.includeInAssembly===false||scene.documentary?.verified),'Finish material checks before ordering voice');
      assert.equal(project.settings.voice.voice,state.voice.uuid);assert.equal(project.settings.voice.singleTrack,true);
      const tasks=(await api('getQueue')).filter(task=>task.projectId===project.id);
      if(tasks.some(task=>task.status!=='done'))throw new Error('Есть незавершённые задания: сначала проверить их checkpoints и продолжить прежнюю очередь');
      if(project.outputPath){console.log(JSON.stringify({existingOutput:project.outputPath}));app.exit(0);return;}
      const voices=await api('listVoicerTemplates');assert.ok(voices.some(voice=>voice.uuid===state.voice.uuid));
      if(state.productionRequested)throw new Error('Запуск уже запрашивался: проверить очередь перед любым новым заказом');
      await checkpoint({productionRequested:true,productionRequestedAt:new Date().toISOString()});
      await api('startGeneration',project.id);
      for(;;){
        await wait(1500);project=await api('getProject',project.id);
        const current=(await api('getQueue')).filter(task=>task.projectId===project.id);
        if(current.some(task=>['failed','paused'].includes(task.status)))throw new Error('Производство требует внимания; сохранённые задания не повторять вслепую');
        if(project.outputPath&&current.every(task=>task.status==='done'))break;
      }
      await checkpoint({outputPath:project.outputPath,productionCompletedAt:new Date().toISOString()});
      console.log(JSON.stringify({outputPath:project.outputPath,scenes:project.scenes.length}));
    } else if(mode==='inspect'){
      const configured=await api('getVoicerSettings');
      const templates=configured.configured?await api('listVoicerTemplates'):[];
      const voice=templates.find(item=>item.name==='1234');
      await checkpoint({configured:configured.configured,voice:voice?{uuid:voice.uuid,name:voice.name}:null});
      console.log(JSON.stringify({configured:configured.configured,voiceFound:Boolean(voice),voiceName:voice?.name}));
    } else if(mode==='create') {
      if(!state.voice?.uuid){
        const channels=await api('listChannelProfiles');
        const saved=channels.find(channel=>channel.lumeanTemplateName==='1234'&&channel.lumeanTemplateUuid);
        if(!saved)throw new Error('Не найден сохранённый выбор голоса 1234');
        await checkpoint({voice:{uuid:saved.lumeanTemplateUuid,name:saved.lumeanTemplateName},voiceSource:'existing channel record; live API unavailable'});
      }
      const script=await readFile(resolve(out,'script-en.txt'),'utf8');
      let project=state.projectId?await api('getProject',state.projectId):null;
      if(!project){
        const channels=await api('listChannelProfiles');
        let channel=channels.find(c=>c.name==='Maritime Documentary · Stock test'&&c.defaultMediaMode==='stock');
        if(!channel)channel=await api('createChannelProfile',{name:'Maritime Documentary · Stock test',countryCode:'US',languageCode:'en',languageLabel:'English',direction:'stock-documentary',defaultMediaMode:'stock',masterPrompt:'Documentary comparison using independently sourced real materials.',lumeanTemplateUuid:state.voice.uuid,lumeanTemplateName:state.voice.name,defaultDurationMinutes:5});
        project=await api('createProject',{title:'SS United States vs Icon of the Seas · Documentary',topic:'Two ships, two missions',language:'English',aspectRatio:'16:9',mode:'standard',mediaMode:'stock',channelProfileId:channel.id,videoBrief:{prompt:'Fact-checked comparison',creationMode:'script',readyScript:script,competitorTranscripts:[]}});
        await checkpoint({projectId:project.id,channelId:channel.id});
        const existing=(await api('listProjects')).find(item=>item.id!==project.id&&item.settings.voice.calibration?.voice===state.voice.uuid&&item.settings.voice.calibration.languageCode==='en');
        project=await api('updateProject',project.id,{settings:{...project.settings,durationMinutes:5,voice:{...project.settings.voice,enabled:true,provider:'elevenlabs',voice:state.voice.uuid,singleTrack:true,calibration:existing?.settings.voice.calibration},assembly:{...project.settings.assembly,audioNormalize:true,quality:'standard'}}});
        if(existing)await checkpoint({calibrationComplete:true,calibrationSource:existing.id});
      }
      assert.equal(project.videoBrief.readyScript,script,'Do not silently replace an existing control script');
      if(!project.settings.voice.calibration){
        if(state.calibrationRequested)throw new Error('Калибровка уже запрашивалась: сначала проверьте сохранённый результат/заказ, автоматического повтора нет');
        await checkpoint({calibrationRequested:true});
        const result=await api('calibrateProjectVoice',project.id);
        project=await api('getProject',project.id);
        if(result.sampleAudioBase64)await writeFile(resolve(out,'voice-1234-sample.mp3'),Buffer.from(result.sampleAudioBase64,'base64'));
        await checkpoint({calibrationComplete:true});
      }
      if(!project.scenes.length)project=await api('prepareProjectScript',project.id);
      await checkpoint({scenes:project.scenes.length,scriptPrepared:true});
      console.log(JSON.stringify({projectId:project.id,scenes:project.scenes.length,estimatedSeconds:project.scenes.reduce((sum,s)=>sum+s.durationSeconds,0),voice:state.voice.name}));
    } else if(mode==='review') {
      let project=await api('getProject',state.projectId);
      const reviews=[
        {id:'commons:40771483',caption:'SS United States · Maiden voyage, 1952',note:'Manually inspected: SS United States photographed from Portsmouth on its return maiden voyage to New York, summer 1952. Wikimedia Commons marks this photograph public domain.',illustrative:false},
        {id:'commons:5988259',caption:'SS United States · Philadelphia, 2009',note:'Manually inspected: SS United States docked at Philadelphia, 18 February 2009. Public domain photograph by Rickyar (Richard R.). Used to show the ship’s profile; this is not footage of its 1952 voyage.',illustrative:true},
        {id:'commons:146960639',caption:'Icon of the Seas · Sea trials, 2023',note:'Manually inspected: Icon of the Seas on first sea trials near Turku, 19 June 2023. Chakie2, cropped by Ahecht, CC BY-SA 4.0. Credit is preserved in source metadata and export credits. This is not its January 2024 maiden voyage.',illustrative:false},
      ];
      for(let index=0;index<reviews.length;index++){
        const review=reviews[index],scene=project.scenes[index];
        assert.equal(scene.documentary?.selected?.id,review.id,'Review only the exact image inspected in this task');
        project=await api('reviewDocumentaryMaterial',project.id,scene.id,{verified:true,illustrative:review.illustrative,note:review.note,rightsConfirmed:true});
      }
      const scenes=project.scenes.map((scene,index)=>index<reviews.length?{...scene,documentary:{...scene.documentary,caption:{...scene.documentary.caption,enabled:index>0,text:reviews[index].caption,fontSize:44},...(index===0?{layout:'compare',comparison:{sceneId:project.scenes[2].id,leftLabel:'SS United States · 1952',rightLabel:'Icon of the Seas · 2023'}}:{})}}:scene);
      project=await api('updateProject',project.id,{scenes});
      await checkpoint({reviewedMaterials:3,remainingMaterials:project.scenes.filter(scene=>!scene.documentary?.verified).length});
      console.log(JSON.stringify({reviewed:3,remaining:state.remainingMaterials,readyForFinal:false}));
    } else if(mode==='search') {
      const project=await api('getProject',state.projectId);if(!project?.scenes.length)throw new Error('Prepare the control project first');
      const queries=JSON.parse(await readFile(resolve(out,'queries.json'),'utf8'));
      const results=[];
      for(const query of queries){
        const {result}=await api('searchDocumentary',project.id,project.scenes[0].id,query);
        results.push({query,...result});
        await writeFile(resolve(out,'search-results.json'),JSON.stringify(results,null,2));
        console.log(JSON.stringify({query:query.query,kind:query.kind,sources:result.sources,count:result.candidates.length}));
      }
    } else if(mode==='import') {
      const project=await api('getProject',state.projectId);if(!project?.scenes.length)throw new Error('Prepare the control project first');
      const selections=JSON.parse(await readFile(resolve(out,'material-imports.json'),'utf8'));
      const results=JSON.parse(await readFile(resolve(out,'search-results.json'),'utf8'));
      for(const selection of selections){
        const scene=project.scenes[selection.order];if(!scene)throw new Error('Unknown scene');
        const latest=await api('getProject',project.id);
        if(latest.scenes.find(item=>item.id===scene.id)?.documentary?.selected?.id===selection.candidateId){console.log(`Keep scene ${selection.order+1}`);continue;}
        const group=results.find(group=>group.candidates.some(candidate=>candidate.id===selection.candidateId));
        if(!group)throw new Error(`Unknown candidate ${selection.candidateId}`);
        await api('searchDocumentary',project.id,scene.id,group.query);
        const updated=await api('applyDocumentaryCandidate',project.id,scene.id,selection.candidateId);
        const current=updated.scenes.find(item=>item.id===scene.id);
        await writeFile(resolve(out,`material-${selection.order+1}.json`),JSON.stringify({sceneId:scene.id,order:selection.order,narration:scene.narration,imagePath:current.imagePath,videoPath:current.videoPath,selected:current.documentary.selected},null,2));
        console.log(`Imported for review: scene ${selection.order+1} ${current.documentary.selected.title}`);
        await wait(2000);
      }
    } else throw new Error('Unknown control step');
    app.exit(0);
  } catch(e){await checkpoint({lastError:String(e).slice(0,1200),failedStep:mode});console.error(String(e));app.exit(1);}
}
