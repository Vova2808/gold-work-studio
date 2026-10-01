import assert from "node:assert/strict";
import test from "node:test";
import { AnyModelClient } from "./anymodel-client.js";
import { StockClient } from "./stock-client.js";
import { VoicerClient } from "./voicer-client.js";
import type { ProxyConfig, ProxyResponse } from "./proxy-utils.js";
import { createDefaultProjectSettings, type Project } from "@gold-work/shared";

function proxyResponse(bodyValue: unknown, status = 200): ProxyResponse {
  const body = Buffer.isBuffer(bodyValue)
    ? bodyValue
    : Buffer.from(typeof bodyValue === "string" ? bodyValue : JSON.stringify(bodyValue), "utf8");
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {},
    body,
    text: () => body.toString("utf8"),
    json: <T,>() => JSON.parse(body.toString("utf8")) as T,
  };
}

test("AnyModel connection check uses its configured proxy and keeps destination authorization", async () => {
  const seen: Array<{ url: string; proxy?: ProxyConfig; authorization: string | null }> = [];
  const store = {
    publicSettings: async () => ({
      configured: true,
      proxyConfigured: true,
      proxyDisplayName: "socks5://127.0.0.1:1101",
      baseUrl: "https://anymodel.test/v1",
      textModel: "test-model",
      imageModel: "test-image",
      videoModel: "test-video",
      ttsModel: "test-tts",
      imageRefModel: "test-image-ref",
      transcriptionModel: "test-transcription",
    }),
    apiKey: async () => "anymodel-api-key",
    proxyUrl: async () => "socks5://proxy-user:proxy-pass@127.0.0.1:1101",
  } as unknown as ConstructorParameters<typeof AnyModelClient>[0];
  const client = new AnyModelClient(store, (async (input, init, proxy) => {
    seen.push({
      url: String(input),
      proxy,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as ConstructorParameters<typeof AnyModelClient>[1]);

  assert.deepEqual(await client.test(), { ok: true, message: "AnyModel: ключ принят. Доступность выбранной модели и генерация ещё не проверены." });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.url, "https://anymodel.test/v1/models");
  assert.deepEqual(seen[0]?.proxy, {
    host: "127.0.0.1",
    port: 1101,
    user: "proxy-user",
    password: "proxy-pass",
  });
  assert.equal(seen[0]?.authorization, "Bearer anymodel-api-key");
});

test("character reference description respects the selected style and the portrait prompt forbids labels", async () => {
  const store = {
    publicSettings: async () => ({configured:true,proxyConfigured:false,baseUrl:"https://anymodel.test/v1",textModel:"qa-model"}),
    apiKey: async () => "qa-key",
    proxyUrl: async () => undefined,
  } as unknown as ConstructorParameters<typeof AnyModelClient>[0];
  const requests: Array<{messages:Array<{content:string}>}> = [];
  const client = new AnyModelClient(store,(async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({name:"Максим",prompt:"white round head, gray coat and a red scarf"})}}]}),{status:200});
  }) as ConstructorParameters<typeof AnyModelClient>[1]);
  const project: Project = {id:"character-test",title:"Test",topic:"A traveller returns home",language:"Русский",aspectRatio:"16:9",mode:"standard",mediaMode:"ai",status:"ready",createdAt:"",updatedAt:"",scenes:[],settings:createDefaultProjectSettings()};
  project.settings.image.style = "Watercolor ink illustration, flat 2D, no photorealism";
  let imagePrompt = "";
  const result = await client.characterReference(project,undefined,async prompt => {imagePrompt=prompt;return Buffer.from("test-image");},"Keep the red scarf");
  assert.equal(requests.length,1);
  assert.ok(requests[0]!.messages.some(message=>message.content.includes(project.settings.image.style) && message.content.includes("Keep the red scarf")));
  assert.ok(imagePrompt.startsWith("One single character, full body portrait in one pose"));
  assert.ok(imagePrompt.includes(project.settings.image.style));
  assert.match(imagePrompt,/No text, labels, name, age/);
  assert.equal(result.name,"Максим");
});

test("AnyModel proxied completion requests SSE and rebuilds a fragmented response", async () => {
  let completionCalls = 0;
  const store = {
    publicSettings: async () => ({
      configured: true,
      proxyConfigured: true,
      proxyDisplayName: "socks5://127.0.0.1:1101",
      baseUrl: "https://anymodel.test/v1",
      textModel: "test-model",
      imageModel: "test-image",
      videoModel: "test-video",
      ttsModel: "test-tts",
      imageRefModel: "test-image-ref",
      transcriptionModel: "test-transcription",
    }),
    apiKey: async () => "anymodel-api-key",
    proxyUrl: async () => "socks5://proxy-user:proxy-pass@127.0.0.1:1101",
  } as unknown as ConstructorParameters<typeof AnyModelClient>[0];
  const encoder = new TextEncoder();
  const client = new AnyModelClient(store, (async (input, init, proxy) => {
    assert.equal(proxy?.port, 1101);
    const url = String(input);
    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    completionCalls += 1;
    const request = JSON.parse(String(init?.body)) as { stream?: boolean };
    assert.equal(request.stream, true, "a proxied long job must not wait idly for one final JSON body");
    assert.equal(new Headers(init?.headers).get("accept"), "text/event-stream");
    const fragments = [
      "data: {\"choices\":[{\"delta\":{\"con",
      "tent\":\"первая \"},\"finish_reason\":null}]}\n\n",
      "data: {\"choices\":[{\"delta\":{\"content\":\"часть\"},\"finish_reason\":\"stop\"}]}\n\n",
      "data: [DONE]\n\n",
    ];
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (const fragment of fragments) controller.enqueue(encoder.encode(fragment));
        controller.close();
      },
    }), { status: 200 });
  }) as ConstructorParameters<typeof AnyModelClient>[1]);

  assert.deepEqual(await client.test(), { ok: true, message: "AnyModel: ключ принят. Доступность выбранной модели и генерация ещё не проверены." });
  assert.equal(await client.chatMessage([{ role: "user", content: "Тест" }]), "первая часть");
  assert.equal(completionCalls, 1);
});

test("AnyModel does not replay a proxied completion whose SSE stream ended without a final event", async () => {
  let completionCalls = 0;
  const store = {
    publicSettings: async () => ({
      configured: true,
      proxyConfigured: true,
      baseUrl: "https://anymodel.test/v1",
      textModel: "test-model",
    }),
    apiKey: async () => "anymodel-api-key",
    proxyUrl: async () => "socks5://127.0.0.1:1101",
  } as unknown as ConstructorParameters<typeof AnyModelClient>[0];
  const client = new AnyModelClient(store, (async () => {
    completionCalls += 1;
    return new Response("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"},\"finish_reason\":null}]}\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as ConstructorParameters<typeof AnyModelClient>[1]);

  await assert.rejects(
    () => client.chatMessage([{ role: "user", content: "Тест" }]),
    /Поток ответа AnyModel оборвался.*автоматический повтор completion отключён/
  );
  assert.equal(completionCalls, 1);
});

test("AnyModel error envelopes in HTTP 200 are not repaired as malformed scenario JSON", async () => {
  for (const streaming of [false,true]) {
    let calls=0;
    const store={publicSettings:async()=>({configured:true,baseUrl:'https://anymodel.test/v1',textModel:'test'}),apiKey:async()=>"key",proxyUrl:async()=>streaming?'socks5://127.0.0.1:1101':undefined};
    const client=new AnyModelClient(store as never,async()=>{
      calls++;
      const payload=JSON.stringify({error:{message:'The selected model is temporarily unavailable'}});
      return new Response(streaming?`data: ${payload}\n\ndata: [DONE]\n\n`:payload,{headers:{'content-type':streaming?'text/event-stream':'application/json'}});
    });
    await assert.rejects(client.chatMessage([{role:'user',content:'Тест'}]), error=>error instanceof Error
      && error.name==='AnyModelModelUnavailableError' && /явно отклонил запрос/u.test(error.message));
    assert.equal(calls,1);
  }
});

test("AnyModel finishes on DONE even when the SSE connection remains open", async () => {
  let cancelled=false;
  const store={publicSettings:async()=>({configured:true,baseUrl:'https://anymodel.test/v1',textModel:'test'}),apiKey:async()=>"key"};
  const client=new AnyModelClient(store as never,async()=>new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Готово"}}]}\n\ndata: [DONE]\n\n')); },
    cancel() { cancelled=true; },
  }),{headers:{'content-type':'text/event-stream'}}));
  assert.equal(await client.streamChatMessage([{role:'user',content:'Тест'}],()=>{}),'Готово');
  assert.equal(cancelled,true);
});

test("AnyModel keeps a completed response when the connection fails after finish_reason", async () => {
  let calls=0;
  const store={publicSettings:async()=>({configured:true,baseUrl:'https://anymodel.test/v1',textModel:'test'}),apiKey:async()=>"key"};
  const client=new AnyModelClient(store as never,async()=>{
    calls++;
    let sent=false;
    return new Response(new ReadableStream({
      pull(controller) {
        if (!sent) {
          sent=true;
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Готовый ответ"},"finish_reason":"stop"}]}\n\n'));
        } else controller.error(Object.assign(new Error("socket closed"),{code:"ECONNRESET"}));
      },
    }),{headers:{'content-type':'text/event-stream'}});
  });
  assert.equal(await client.chatMessage([{role:'user',content:'Тест'}]),'Готовый ответ');
  assert.equal(calls,1,'A complete answer must not require a new paid request');
});

test("AnyModel reports a real stream reset without exposing response text or replaying it", async () => {
  let calls=0;
  const store={publicSettings:async()=>({configured:true,baseUrl:'https://anymodel.test/v1',textModel:'test'}),apiKey:async()=>"key"};
  const client=new AnyModelClient(store as never,async()=>{
    calls++;
    let sent=false;
    return new Response(new ReadableStream({
      pull(controller) {
        if (!sent) {
          sent=true;
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"PRIVATE_TEXT"}}]}\n\n'));
        } else controller.error(Object.assign(new Error("private proxy endpoint"),{code:"ECONNRESET"}));
      },
    }),{headers:{'content-type':'text/event-stream'}});
  });
  await assert.rejects(client.chatMessage([{role:'user',content:'Тест'}]),error=>{
    assert.ok(error instanceof Error);
    assert.equal(error.name,'AnyModelCompletionUncertainError');
    assert.match(error.message,/ECONNRESET/);
    assert.match(error.message,/получено 12 знаков/);
    assert.doesNotMatch(error.message,/PRIVATE_TEXT|private proxy endpoint/);
    return true;
  });
  assert.equal(calls,1);
});

test("AnyModel retries one explicit short model rejection, but not an ambiguous failure", async () => {
  const refusal=JSON.stringify({error:{code:"model_not_found",message:"The selected model is temporarily unavailable",retry_after_seconds:0.001}});
  const cases=[
    {body:refusal,headers:{"retry-after":"0.001"},expected:2},
    {body:refusal,headers:{"retry-after":"3600"},expected:1},
    {body:"provider busy",headers:{"retry-after":"0.001"},expected:1},
    {body:JSON.stringify({error:{message:"The selected model is temporarily unavailable"},usage:{completion_tokens:50}}),headers:{"retry-after":"0.001"},expected:1},
  ];
  for (const fixture of cases) {
    let calls=0;
    const bodies:string[]=[];
    const store={publicSettings:async()=>({configured:true,baseUrl:'https://anymodel.test/v1',textModel:'chosen-model'}),apiKey:async()=>"key"};
    const client=new AnyModelClient(store as never,async(_input,init)=>{
      calls++;bodies.push(String(init?.body));
      if(calls===1) return new Response(fixture.body,{status:503,headers:{"content-type":"application/json",...fixture.headers}});
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"Complete reply"}}]}),{headers:{"content-type":"application/json"}});
    });
    if(fixture.expected===2) assert.equal(await client.chatMessage([{role:'user',content:'Тест'}]),"Complete reply");
    else await assert.rejects(client.chatMessage([{role:'user',content:'Тест'}]));
    assert.equal(calls,fixture.expected);
    if(calls===2) assert.equal(bodies[0],bodies[1],"Do not switch model or regenerate earlier scenes");
  }
});

test("AnyModel stops after two explicit refusals without batch splitting or losing 120 saved scenes", async () => {
  let calls=0,checkpoints=0;
  const store={publicSettings:async()=>({configured:true,baseUrl:'https://anymodel.test/v1',textModel:'chosen-model'}),apiKey:async()=>"key"};
  const client=new AnyModelClient(store as never,async()=>{
    calls++;
    return new Response(JSON.stringify({error:{code:"model_not_found",message:"The selected model is temporarily unavailable"}}),
      {status:503,headers:{"content-type":"application/json","retry-after":"0.001"}});
  });
  const scenes=Array.from({length:120},(_,order)=>({id:`saved-${order}`,order,title:`Scene ${order+1}`,narration:`Saved narration ${order+1}`,
    imagePrompt:"Same host in the workshop",animationPrompt:"Slow push in",durationSeconds:5,status:"draft"}));
  const original=JSON.stringify(scenes);
  const plan={title:"Services",promise:"Seven-day plan",tone:"Practical",visualBible:"Comic",continuityRules:[],requiredBeats:[],endingResolution:"Conclusion",
    sections:[{title:"Services",goal:"Explain",keyPoints:[],transition:"End"}]};
  await assert.rejects((client as unknown as {buildScenes:(...args:unknown[])=>Promise<unknown>}).buildScenes(
    plan,Array(156).fill(5),"Русский","chosen-model",undefined,undefined,undefined,undefined,()=>{checkpoints++;},scenes),error=>{
      assert.ok(error instanceof Error);
      assert.equal(error.name,"AnyModelModelUnavailableError");
      assert.match(error.message,/Сохранено 120 из 156/);
      assert.match(error.message,/блок сцен 121–135/);
      assert.doesNotMatch(error.message,/Результат запроса неизвестен/);
      return true;
    });
  assert.equal(calls,2,"The writer must not turn a refused request into three retries or smaller paid batches");
  assert.equal(checkpoints,0);
  assert.equal(JSON.stringify(scenes),original);
});

test("AnyModel fallback resumes block 121 on a reserve model and keeps it for subsequent blocks", async () => {
  const primary = "cc/claude-opus-5", reserve = "ag/claude-sonnet-4-6";
  const requests: Array<Record<string, unknown>> = [];
  const notices: string[] = [];
  let nextScene = 121;
  const client = new AnyModelClient({
    publicSettings: async () => ({ configured: true, baseUrl: "https://anymodel.test/v1", textModel: primary }),
    apiKey: async () => "key"
  } as never, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    if (body.model === primary) return new Response(JSON.stringify({ error: { code: "provider_pool_retry_suppressed" } }), { status: 503 });
    const count = Math.min(15, 157 - nextScene);
    const output = Array.from({ length: count }, () => ({ title: `Scene ${nextScene}`, narration: `Новая сцена ${nextScene++}.`,
      imagePrompt: "Same host in the workshop", animationPrompt: "Slow push in" }));
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] }),
      { headers: { "content-type": "application/json" } });
  });
  const scenes = Array.from({ length: 120 }, (_, order) => ({ id: `saved-${order}`, order, title: `Scene ${order + 1}`,
    narration: `Saved narration ${order + 1}`, imagePrompt: "Same host in the workshop", animationPrompt: "Slow push in", durationSeconds: 5, status: "draft" }));
  const original = JSON.stringify(scenes);
  const plan = { title: "Services", promise: "Seven-day plan", tone: "Practical", visualBible: "Comic", continuityRules: [], requiredBeats: [],
    endingResolution: "Conclusion", sections: [{ title: "Services", goal: "Explain", keyPoints: [], transition: "End" }] };
  const checkpoints: number[] = [];
  const result = await client.withTextModelFallback(() => (client as unknown as {
    buildScenes: (...args: unknown[]) => Promise<typeof scenes>
  }).buildScenes(plan, Array(156).fill(5), "Русский", primary, undefined, undefined, undefined, undefined,
    (saved: typeof scenes) => checkpoints.push(saved.length), scenes), change => notices.push(change.message));
  assert.deepEqual(requests.map(request => request.model), [primary, reserve, reserve, reserve]);
  assert.deepEqual({ ...requests[0], model: reserve }, requests[1], "Only the model changes, not the unfinished block or its context/token budget");
  assert.deepEqual(checkpoints, [135, 150, 156]);
  assert.equal(JSON.stringify(scenes), original);
  assert.deepEqual(result.slice(0, 120), scenes);
  assert.equal(notices.length, 1);
  assert.match(notices[0]!, /claude-opus-5.*claude-sonnet-4-6/);
});

test("AnyModel fallback recognizes explicit HTTP, JSON and initial SSE model limits", async () => {
  const refusal = { error: { code: "model_rate_limit_exceeded", message: "Selected model limit reached" } };
  for (const format of ["http", "json", "sse"]) {
    let calls = 0;
    const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "cc/claude-opus-5", baseUrl: "https://anymodel.test/v1" }), apiKey: async () => "key" } as never,
      async () => {
        calls++;
        if (calls === 1) return new Response(format === "sse" ? `data: ${JSON.stringify(refusal)}\n\n` : JSON.stringify(refusal),
          { status: format === "http" ? 429 : 200, headers: { "content-type": format === "sse" ? "text/event-stream" : "application/json" } });
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "Готово" } }] }), { headers: { "content-type": "application/json" } });
      });
    assert.equal(await client.withTextModelFallback(() => client.chatMessage([{ role: "user", content: "Тест" }])), "Готово");
    assert.equal(calls, 2, format);
  }
});

test("Stock text and frame analysis use the bounded model reserve, while audio keeps its capable model", async () => {
  const models: string[] = [], switches: string[] = [];
  const client = new AnyModelClient({ publicSettings: async () => ({ configured: true, textModel: "cc/claude-sonnet-5", transcriptionModel: "audio-fixture", baseUrl: "https://anymodel.test/v1" }), apiKey: async () => "key" } as never,
    async (_input, init) => {
      const body = JSON.parse(String(init?.body)); models.push(body.model);
      return body.model === "cc/claude-sonnet-5" || body.model === "audio-fixture"
        ? Response.json({ error: { code: "model_unavailable" } }, { status: 503 })
        : Response.json({ choices: [{ message: { content: '{"ids":[]}' }, finish_reason: "stop" }] });
    });
  assert.equal(await client.withTextModelFallback(() => client.documentaryCompletion("Inspect", "Scene", ["data:image/jpeg;base64,fixture"]), change => switches.push(change.to)), '{"ids":[]}');
  assert.deepEqual(models, ["cc/claude-sonnet-5", "ag/claude-sonnet-4-6"]); assert.equal(switches.length, 1);
  await assert.rejects(client.withTextModelFallback(() => client.documentaryCompletion("Align", "Text", ["data:audio/mpeg;base64,fixture"])), /ограничена|недоступна/);
  assert.equal(models.length, 3); assert.equal(models.at(-1), "audio-fixture");
});

test("AnyModel fallback never switches on uncertain output, billing failures or cancellation", async () => {
  const refusal = { error: { code: "model_unavailable" } };
  const fixtures = [
    () => { throw new TypeError("fetch failed"); },
    () => new Response("busy", { status: 503 }),
    () => new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "Account quota exceeded" } }), { status: 429 }),
    () => new Response(JSON.stringify({ ...refusal, usage: { completion_tokens: 5 } }), { status: 503 }),
    () => new Response(JSON.stringify({ ...refusal, choices: [{ message: { content: "partial" } }] }), { status: 503 }),
    () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\ndata: ${JSON.stringify(refusal)}\n\n`, { headers: { "content-type": "text/event-stream" } }),
    () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', { headers: { "content-type": "text/event-stream" } })
  ];
  for (const fixture of fixtures) {
    let calls = 0, switches = 0;
    const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "cc/claude-opus-5", baseUrl: "https://anymodel.test/v1" }), apiKey: async () => "key" } as never,
      async () => { calls++; return fixture(); });
    await assert.rejects(client.withTextModelFallback(() => client.chatMessage([{ role: "user", content: "Тест" }]), () => { switches++; }));
    assert.equal(calls, 1);
    assert.equal(switches, 0);
  }
  let calls = 0;
  const controller = new AbortController();
  const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "cc/claude-opus-5", baseUrl: "https://anymodel.test/v1" }), apiKey: async () => "key" } as never,
    async () => { calls++; return new Response(JSON.stringify(refusal), { status: 503 }); });
  await assert.rejects(client.withTextModelFallback(() => client.streamChatMessage([{ role: "user", content: "Тест" }], () => {}, undefined, controller.signal),
    () => controller.abort(new Error("Cancelled by user"))), /Cancelled by user/);
  assert.equal(calls, 1);
});

test("AnyModel fallback is bounded and isolated between concurrent jobs", async () => {
  const calls: Array<{ job: string; model: string }> = [];
  const client = new AnyModelClient({ publicSettings: async () => ({ textModel: "cc/claude-opus-5", baseUrl: "https://anymodel.test/v1" }), apiKey: async () => "key" } as never,
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const job = body.messages.at(-1).content;
      calls.push({ job, model: body.model });
      if (job === "limited" || job === "resumable" && body.model === "cc/claude-opus-5") {
        return new Response(JSON.stringify({ error: { code: "model_quota_exceeded" } }), { status: 429 });
      }
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: job } }] }), { headers: { "content-type": "application/json" } });
    });
  await Promise.all([
    assert.rejects(client.withTextModelFallback(() => client.chatMessage([{ role: "user", content: "limited" }])), /резерв исчерпан/),
    client.withTextModelFallback(async () => {
      for (let i = 0; i < 2; i++) assert.equal(await client.chatMessage([{ role: "user", content: "resumable" }]), "resumable");
    }),
    client.withTextModelFallback(async () => assert.equal(await client.chatMessage([{ role: "user", content: "unlimited" }]), "unlimited"))
  ]);
  assert.equal(calls.filter(call => call.job === "limited").length, 3);
  assert.deepEqual(calls.filter(call => call.job === "resumable").map(call => call.model), ["cc/claude-opus-5", "ag/claude-sonnet-4-6", "ag/claude-sonnet-4-6"]);
  assert.deepEqual(calls.filter(call => call.job === "unlimited").map(call => call.model), ["cc/claude-opus-5"]);
  assert.equal(client.textModelFallbackNotice, undefined);
});

test("AnyModel UI chat preserves partial SSE without blind restart or paid continuation", async () => {
  for (const partial of ['', 'Полученная часть ответа']) {
    let calls=0;
    const chunks:string[]=[];
    const store={publicSettings:async()=>({configured:true,baseUrl:'https://anymodel.test/v1',textModel:'test'}),apiKey:async()=>"key"};
    const client=new AnyModelClient(store as never,async()=>{
      calls++;
      return new Response(partial?`data: ${JSON.stringify({choices:[{delta:{content:partial}}]})}\n\n`:'',
        {headers:{'content-type':'text/event-stream'}});
    });
    const request=client.streamChatMessage([{role:'user',content:'Тест'}],chunk=>chunks.push(chunk));
    if(partial) {
      const result=await request;
      assert.ok(result.startsWith(partial));
      assert.match(result,/Ответ получен не полностью/u);
      assert.equal(chunks.join(''),result);
    } else {
      await assert.rejects(request,/автоматический повтор completion отключён/u);
    }
    assert.equal(calls,1,'A dropped stream must never create another paid request');
  }
});

test("Lumean routes order, storage link and completed audio download through one service proxy", async () => {
  const calls: Array<{ url: string; method?: string; proxy?: ProxyConfig }> = [];
  const store = {
    publicSettings: async () => ({
      configured: true,
      proxyConfigured: true,
      proxyDisplayName: "http://127.0.0.1:2202",
      baseUrl: "https://api.lumean.test/api/public",
    }),
    apiKey: async () => "lumean-api-key",
    proxyUrl: async () => "http://proxy-user:proxy-pass@127.0.0.1:2202",
  } as unknown as ConstructorParameters<typeof VoicerClient>[0];
  const client = new VoicerClient(store, {
    pollIntervalMs: 0,
    safeRetryAttempts: 1,
    fetchImpl: async () => { throw new Error("direct fetch must not be used"); },
    proxyRequestImpl: async (url, init, proxy) => {
      calls.push({ url, method: init.method, proxy });
      if (url.endsWith("/orders")) {
        return proxyResponse({ success: true, data: { id: "order-1", status: "completed", result: { files: ["audio/result.mp3"] } } });
      }
      if (url.endsWith("/storage/url")) {
        return proxyResponse({ success: true, data: { url: "https://files.lumean.test/result.mp3" } });
      }
      return proxyResponse(Buffer.from([0x49, 0x44, 0x33, 0x04]));
    },
  });

  const audio = await client.tts("Тестовая фраза", "template-1");
  assert.deepEqual(audio, Buffer.from([0x49, 0x44, 0x33, 0x04]));
  assert.deepEqual(calls.map((call) => [call.url, call.method]), [
    ["https://api.lumean.test/api/public/orders", "POST"],
    ["https://api.lumean.test/api/public/storage/url", "POST"],
    ["https://files.lumean.test/result.mp3", undefined],
  ]);
  assert.ok(calls.every((call) => call.proxy?.protocol === "http" && call.proxy.port === 2202));
});

test("Pexels and Pixabay use independent proxies for API search and selected-file download", async () => {
  const proxyCalls: Array<{ url: string; proxy?: ProxyConfig }> = [];
  const store = {
    apiKey: async (provider: "pexels" | "pixabay") => `${provider}-api-key`,
    proxyUrl: async (provider: "pexels" | "pixabay") => provider === "pexels"
      ? "socks5://pexels-user:pexels-pass@127.0.0.1:3303"
      : "http://pixabay-user:pixabay-pass@127.0.0.1:4404",
  };
  const client = new StockClient(
    store,
    async () => { throw new Error("direct fetch must not be used"); },
    undefined,
    Date.now,
    async () => undefined,
    async (input, _init, proxy) => {
      const url = String(input);
      proxyCalls.push({ url, proxy });
      if (url.includes("api.pexels.com")) {
        return new Response(JSON.stringify({
          page: 1,
          per_page: 3,
          total_results: 1,
          photos: [{
            id: 7,
            width: 1920,
            height: 1080,
            url: "https://www.pexels.com/photo/test-7/",
            photographer: "Tester",
            photographer_url: "https://www.pexels.com/@tester/",
            src: {
              medium: "https://images.pexels.com/photos/7/medium.jpeg",
              original: "https://images.pexels.com/photos/7/original.jpeg",
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("pixabay.com/api/")) {
        return new Response(JSON.stringify({
          total: 1,
          totalHits: 1,
          hits: [{
            id: 8,
            pageURL: "https://pixabay.com/photos/test-8/",
            user: "Tester",
            imageWidth: 1920,
            imageHeight: 1080,
            webformatURL: "https://cdn.pixabay.com/photo/8-preview.jpg",
            largeImageURL: "https://cdn.pixabay.com/photo/8.jpg",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(Buffer.from([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    },
  );

  const pexels = await client.search({ provider: "pexels", mediaType: "image", query: "city", perPage: 3 });
  await client.search({ provider: "pixabay", mediaType: "image", query: "forest", perPage: 3 });
  await client.download(pexels.items[0]!);

  assert.equal(proxyCalls.length, 3);
  assert.equal(proxyCalls[0]?.proxy?.port, 3303);
  assert.equal(proxyCalls[1]?.proxy?.port, 4404);
  assert.equal(proxyCalls[1]?.proxy?.protocol, "http");
  assert.equal(proxyCalls[2]?.proxy?.port, 3303);
});
