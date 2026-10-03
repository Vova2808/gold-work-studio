/** Explicit bounded live AnyModel check; never synthesizes audio/images or edits user projects/settings. */
import assert from "node:assert/strict";
import {app} from "electron";
import {copyFileSync, mkdtempSync} from "node:fs";
import {readFile, mkdir, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {allocateAiStorySceneDurations, countNarrationCharacters, createNarrationTimingBudget, voiceCalibrationMatches, type ChannelProfile, type Project, type Scene, type ReferenceAnalysis} from "@gold-work/shared";
import {AnyModelStore} from "../src/anymodel-store.js";
import {AnyModelClient} from "../src/anymodel-client.js";
import {proxyFetch} from "../src/proxy-utils.js";

const sourceProfile=join(process.env.APPDATA!,"@gold-work","desktop");
const temporaryProfile=mkdtempSync(join(tmpdir(),"gws-live-script-"));
copyFileSync(join(sourceProfile,"Local State"),join(temporaryProfile,"Local State"));
app.setPath("userData",temporaryProfile);
app.on("window-all-closed",()=>undefined);
const fromPrompt=process.argv.includes("--prompt");
const planOnly=process.argv.includes("--plan-only");
const fallbackOnly=process.argv.includes("--fallback-only");
const narrationFirst=process.argv.includes("--narration-first");
const authoredReady=process.argv.includes("--authored-ready");
const maximumSubmissions=fallbackOnly?2:narrationFirst?18:authoredReady?7:planOnly?1:fromPrompt?12:3;
const output=resolve("captures",authoredReady?"authored-ready-live":narrationFirst?"narration-first-live":fallbackOnly?"anymodel-fallback-live":planOnly?"scenario-plan-live":fromPrompt?"prompt-script-live":"ready-script-live",String(Date.now()));
let submissions=0;
let checkpoint:Scene[]=[];
const controller=new AbortController();
const deadline=setTimeout(()=>controller.abort(new Error("Bounded live test deadline reached")),fromPrompt||narrationFirst||authoredReady?600_000:180_000);
const clean=(error:unknown)=>String(error instanceof Error?error.message:error)
  .replace(/(?:https?|socks5h?):\/\/[^\s]+/gi,"[URL]").slice(0,700);
app.whenReady().then(async()=>{
  if(fallbackOnly) {
    const switches:Array<{from:string;to:string}>=[];
    const models:string[]=[];
    const primary="cc/claude-opus-5";
    const client=new AnyModelClient(new AnyModelStore(join(sourceProfile,"credentials","anymodel.json")),async(input,init={},proxy)=>{
      assert.equal(new URL(input instanceof Request?input.url:input.toString()).pathname,"/v1/chat/completions");
      const request=JSON.parse(String(init.body));
      if(request.model===primary) return new Response(JSON.stringify({error:{code:"model_unavailable"}}),{status:503});
      assert.ok(["ag/claude-sonnet-4-6","cc/claude-opus-4-8"].includes(request.model));
      assert.ok(submissions<maximumSubmissions,"Live fallback submission cap reached");
      assert.equal(request.max_tokens,128);
      submissions++;models.push(request.model);
      return proxyFetch(input,init,proxy);
    });
    const response=await client.withTextModelFallback(()=>(client as unknown as {chat:(...args:unknown[])=>Promise<string>}).chat(
      primary,[{role:"user",content:'Return exactly this JSON and nothing else: {"ok":true}'}],128,"low",controller.signal,120_000),
      change=>switches.push({from:change.from,to:change.to}));
    assert.deepEqual(JSON.parse(response.replace(/^```json\s*|```$/g,"")),{ok:true});
    await mkdir(output,{recursive:true});
    await writeFile(join(output,"result.json"),JSON.stringify({simulatedPrimaryRefusal:true,liveReserveResponse:true,submissions,models,switches,
      userProjectsModified:false,providerSettingsModified:false},null,2));
    console.log(`[anymodel-fallback-live] PASS: simulated primary refusal, ${submissions} real reserve completion(s). ${output}`);
    return;
  }
  assert.ok(process.env.GW_PROJECT_JSON || process.env.GW_PROJECT_ID,"Set an existing calibration project");
  const project:Project=process.env.GW_PROJECT_ID
    ? JSON.parse(await readFile(join(sourceProfile,"projects.json"),"utf8")).find((item:Project)=>item.id===process.env.GW_PROJECT_ID)
    : JSON.parse(await readFile(process.env.GW_PROJECT_JSON!,"utf8"));
  const calibration=project.settings.voice.calibration;
  assert.ok(voiceCalibrationMatches(calibration,project.settings.voice.provider,project.settings.voice.voice,project.language),
    "Do not fabricate calibration or run a new TTS order for this test");
  const transport:typeof proxyFetch=async(input,init={},proxy)=>{
    const url=new URL(input instanceof Request?input.url:input.toString());
    if(init.method?.toUpperCase()==="POST") {
      assert.match(url.pathname,/\/chat\/completions$/u,"Only text completion is authorized by this test");
      if(submissions>=maximumSubmissions) throw new Error("Live test submission cap reached; no further requests sent");
      submissions+=1;
      console.log(`[ready-script-live] completion ${submissions}/${maximumSubmissions}`);
    }
    return proxyFetch(input,init,proxy);
  };
  const client=new AnyModelClient(new AnyModelStore(join(sourceProfile,"credentials","anymodel.json")),transport);
  if(narrationFirst) {
    const original=await readFile(join(sourceProfile,"projects.json"),"utf8");
    const profiles=JSON.parse(await readFile(join(sourceProfile,"database","channel-profiles.json"),"utf8")) as ChannelProfile[];
    const profile=profiles.find(item=>item.id===project.channelProfileId);
    const seed:ReferenceAnalysis={...project.referenceAnalysis!,scenes:[],scenarioQuality:undefined,narrationDraft:undefined,
      instructions:[profile?.masterPrompt,project.videoBrief?.prompt,`Выбранный визуальный стиль: ${project.settings.image.style}`].filter(Boolean).join("\n\n"),
      language:project.language};
    const target=180;
    await mkdir(output,{recursive:true});
    const saved=process.env.GW_NARRATION_CHECKPOINT
      ? JSON.parse(await readFile(process.env.GW_NARRATION_CHECKPOINT,"utf8")) : undefined;
    const full=await client.withTextModelFallback(()=>client.regenerateScenes(seed,target,
      (_done,_total,stage)=>console.log(`[narration-first-live] ${stage}`),undefined,controller.signal,"local",
      async scenes=>{checkpoint=scenes;await writeFile(join(output,"visuals.json"),JSON.stringify(scenes,null,2));},
      createNarrationTimingBudget(calibration,target),undefined,"ai-story",{
        narrationState:saved,
        onNarrationCheckpoint:async state=>writeFile(join(output,"narration.json"),JSON.stringify(state,null,2))
      }),change=>console.log(change.message));
    assert.equal(full.scenarioQuality?.complete,true);
    assert.ok(full.scenes.every(scene=>scene.durationSeconds<=9&&scene.narration.trim()&&scene.imagePrompt.trim()));
    assert.equal(await readFile(join(sourceProfile,"projects.json"),"utf8"),original);
    await writeFile(join(output,"result.json"),JSON.stringify({sourceProject:project.id,submissions,target,full},null,2));
    await writeFile(join(output,"narration.txt"),full.scenes.map(scene=>scene.narration).join(""));
    console.log(`[narration-first-live] PASS ${full.scenes.length} frames. ${output}`);
    return;
  }
  if(planOnly) {
    const sourceBytes=await readFile(process.env.GW_PROJECT_JSON!,"utf8");
    const profiles=JSON.parse(await readFile(join(sourceProfile,"database","channel-profiles.json"),"utf8")) as ChannelProfile[];
    const profile=profiles.find(item=>item.id===project.channelProfileId);
    const db=new DatabaseSync(join(sourceProfile,"database","gold-work-studio.sqlite"),{readOnly:true});
    let topic:{title:string;model_id:string}; let messages:Array<{role:string;content:string}>;
    try {
      topic=db.prepare("SELECT title,model_id FROM chat_topics WHERE id=?").get(project.chatTopicId!) as typeof topic;
      messages=db.prepare("SELECT role,content FROM chat_messages WHERE topic_id=? ORDER BY id").all(project.chatTopicId!) as typeof messages;
    } finally { db.close(); }
    assert.ok(topic?.model_id,"Use the user's actual selected model");
    const excerpt=(text:string,max:number)=>text.trim().length<=max?text.trim():`${text.trim().slice(0,Math.floor(max*.6))}\n\n[…контекст сокращён…]\n\n${text.trim().slice(-Math.ceil(max*.4))}`;
    const history=messages.filter(item=>!/^Ошибка AI-провайдера:/i.test(item.content)).map(item=>`${item.role}: ${item.content}`).join("\n\n");
    const first=messages.find(item=>item.role==="user")?.content??topic.title;
    const instructions=[profile?.masterPrompt?`MASTER PROMPT КАНАЛА:\n${excerpt(profile.masterPrompt,10000)}`:"",
      project.videoBrief?.prompt?`ЗАДАЧА ЭТОГО РОЛИКА:\n${project.videoBrief.prompt}`:"",
      project.settings.image.style.trim()?`ЕДИНЫЙ ВИЗУАЛЬНЫЙ СТИЛЬ:\n${excerpt(project.settings.image.style,2000)}\nУчитывай его только в названиях кадров и визуальных промптах; текст озвучки должен оставаться естественным.`:"",
      `Сохранённый диалог (сокращён до релевантного контекста):\n${excerpt(history,12000)}`].filter(Boolean).join("\n\n");
    const targetSeconds=Math.max(30,Math.round((project.settings.durationMinutes||1)*60));
    const source={title:topic.title,angle:first,projectBrief:instructions,
      hook:[...messages].reverse().find(item=>item.role==="assistant")?.content.slice(0,500)||first,
      niche:"Определи из диалога",audience:"Определи из диалога",structure:[],improvements:[],audienceComments:[]};
    const plan=await (client as unknown as {createScenarioPlan:(...args:unknown[])=>Promise<{sections:unknown[];requiredBeats:string[];endingResolution:string}>})
      .createScenarioPlan(source,allocateAiStorySceneDurations(targetSeconds),project.language,topic.model_id,controller.signal,createNarrationTimingBudget(calibration,targetSeconds));
    assert.ok(plan.sections.length&&plan.requiredBeats.length&&plan.endingResolution.trim());
    assert.equal(await readFile(process.env.GW_PROJECT_JSON!,"utf8"),sourceBytes,"User project must remain untouched");
    await mkdir(output,{recursive:true});
    await writeFile(join(output,"result.json"),JSON.stringify({sourceProject:project.id,targetSeconds,model:topic.model_id,submissions,userProjectUnchanged:true,plan},null,2));
    console.log(`[ready-script-live] PASS actual project plan, ${plan.sections.length} sections, ${submissions} completion. ${output}`);
    return;
  }
  const script=authoredReady ? await readFile(resolve("scripts/fixtures/ready-story-maksim.txt"),"utf8")
    : "  Никита нашёл у двери мокрого котёнка.\r\n  Он завернул его в шарф и отнёс домой.\nУтром котёнок сам подошёл к миске.  На коробке Никита написал: «ДОМ».\nТеперь у найденыша было тёплое место.  ";
  const seed:ReferenceAnalysis={sourceUrl:"qa://ready-script",sourceTitle:"Локальный тест готового текста",niche:"AI Story",
    targetAudience:"Зрители коротких историй",hook:"Котёнок у двери",structure:[],strengths:[],improvements:[],
    suggestedAngle:"Один добрый поступок",suggestedTitle:"Тёплое место",recommendedDurationSeconds:20,language:"Русский",
    scenes:[],provider:"live-qa",instructions:"AI Story. Soft watercolor illustration, not 3D or photorealism. Nikita is an adult man in a blue coat; the same small ginger kitten appears throughout. No infographic or montage overlays. Visible text only when the narration explicitly requires it: Russian ДОМ on the box. Preserve the narration exactly."};
  if(authoredReady) {
    const profiles=JSON.parse(await readFile(join(sourceProfile,"database","channel-profiles.json"),"utf8")) as ChannelProfile[];
    seed.suggestedTitle="Почему занятый мастер остаётся без денег — тест готового сценария";
    seed.suggestedAngle="Условный пример Максима: сравнить деньги после расходов и затраченное время";
    seed.hook=script.slice(0,160);
    seed.targetAudience="Зрители объясняющего канала о бытовой экономике";
    seed.instructions=[profiles.find(profile=>profile.id===project.channelProfileId)?.masterPrompt,
      `Визуальный стиль: ${project.settings.image.style}. Готовый narration нельзя менять. Это иллюстративный рассказ Максима; никаких котят и иных прежних тестовых сюжетов. Без текста, цифр, инфографики и коллажей внутри изображения. Длительность определяется ТОЛЬКО готовым narration.`].filter(Boolean).join("\n\n");
  }
  await mkdir(output,{recursive:true});
  const progress=(_done:number,_total:number,stage?:string)=>{
    if(stage) console.log(`[ready-script-live] ${stage}`);
  };
  const saveCheckpoint=async(scenes:Scene[])=>{
    checkpoint=scenes;
    await writeFile(join(output,"checkpoint.json"),JSON.stringify(scenes,null,2));
  };
  const savedDraft=fromPrompt && process.env.GW_RESUME_DRAFT
    ? JSON.parse(await readFile(process.env.GW_RESUME_DRAFT,"utf8")) : undefined;
  const previousReady=authoredReady && process.env.GW_READY_RESULT
    ? JSON.parse(await readFile(process.env.GW_READY_RESULT,"utf8")) : undefined;
  if(previousReady) assert.equal(previousReady.originalScript,script,"Do not reuse prompts belonging to another script");
  const result=previousReady ? {...previousReady.result,scenes:await client.withTextModelFallback(()=>client.repairVisualCompositions(
    previousReady.result.scenes,seed.instructions!,undefined,controller.signal),change=>console.log(change.message))} : fromPrompt
    ? await client.regenerateScenes({...seed,instructions:seed.instructions+" Write an original complete 30-second Russian story: Nikita finds a wet ginger kitten at his door, warms it in a scarf, feeds it the next morning and keeps it. End with the kitten asleep in a box marked ДОМ. Clear hook, linear chronology and concrete resolved ending. No other subplot."},30,
      progress,undefined,controller.signal,"local",saveCheckpoint,createNarrationTimingBudget(calibration,30),savedDraft?.result?.scenes ?? savedDraft,"ai-story")
    : await client.withTextModelFallback(()=>client.prepareReadyScript(seed,script,calibration,progress,undefined,controller.signal,"local",saveCheckpoint,5),change=>console.log(change.message));
  if(fromPrompt) {
    assert.equal(result.scenarioQuality?.complete,true);
    assert.equal(result.scenarioQuality?.endingResolved,true);
    assert.ok(Math.abs(result.recommendedDurationSeconds-30)<=1.5);
    const estimated=result.scenes.reduce((sum,scene)=>sum+countNarrationCharacters(scene.narration),0)/calibration.charactersPerSecond;
    assert.ok(Math.abs(estimated-30)<=1.5,`Calibrated narration estimate ${estimated}s is outside ±5%`);
  } else assert.equal(result.scenes.map(scene=>scene.narration).join(""),script);
  assert.ok(result.scenes.every(scene=>scene.durationSeconds<=9&&scene.imagePrompt.trim()&&scene.animationPrompt.trim()));
  await writeFile(join(output,"result.json"),JSON.stringify({sourceCalibrationProject:project.id,submissions,
    ...(fromPrompt?{targetSeconds:30}:{originalScript:script}),actualCalibrationReused:true,result},null,2));
  console.log(`[ready-script-live] PASS ${fromPrompt?"generated story with completeness audit":"exact narration"}, ${result.scenes.length} visual frames, ${submissions} live completions. ${output}`);
}).catch(async error=>{
  await mkdir(output,{recursive:true});
  await writeFile(join(output,"failure.json"),JSON.stringify({submissions,checkpointScenes:checkpoint.length,error:clean(error)},null,2));
  console.error(`[ready-script-live] STOP ${clean(error)}; no automatic rerun. ${output}`);
  process.exitCode=1;
}).finally(()=>{clearTimeout(deadline);app.exit(process.exitCode??0);});
