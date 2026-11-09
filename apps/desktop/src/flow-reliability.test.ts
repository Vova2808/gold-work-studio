import assert from "node:assert/strict";
import test from "node:test";
import { MAX_FLOW_ACCOUNTS, type FlowAccountPublic } from "@gold-work/shared";
import { assertFlowAccountCapacity } from "./flow-account-policy.js";
import { FlowClient, FlowSubmissionUncertainError, type FlowRemoteImageJob } from "./flow-client.js";
import { parseFlowCookies } from "./flow-cookie-import.js";
import { findFlowGeneratedImage, flowRuntimeBlockReason, isAllowedFlowNavigation, shouldHoldLegacyFlowRuntime, shouldReturnToFlowAfterLogin } from "./flow-protocol.js";
import { FlowAccountSerialQueue, FlowTimeoutError, FlowUserActionError, runFlowStep } from "./flow-request-control.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4SIAAAAASUVORK5CYII=", "base64");
const imageInput = { prompt: "A parked blue car beside a brick garage", aspectRatio: "16:9" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("Flow paid POST waits for the checkpoint; a lost response retains uncertainty",async()=>{
  for(const kind of ["image","video"] as const) {
    const events:string[]=[];
    const f=fixture({submit:async()=>{events.push("post");assert.deepEqual(events,["checkpoint","post"]);throw new Error("connection lost");}});
    const lifecycle={onBeforeSubmit:async(id:string)=>{assert.equal(id,"account-0");events.push("checkpoint");},onSubmitRejected:async()=>{events.push("rejected");}};
    await assert.rejects(kind==="image"?f.client.generateImage({...imageInput,...lifecycle}):f.client.generateVideo({...imageInput,durationSeconds:8,...lifecycle}),FlowSubmissionUncertainError);
    assert.deepEqual(events,["checkpoint","post"]);assert.equal(f.counts().submitCalls,1);
    const notSent=fixture();
    const fail={onBeforeSubmit:async()=>{throw new Error("disk unavailable");}};
    await assert.rejects(kind==="image"?notSent.client.generateImage({...imageInput,...fail}):notSent.client.generateVideo({...imageInput,durationSeconds:8,...fail}),/disk unavailable/);
    assert.equal(notSent.counts().submitCalls,0);
  }
});

test("Flow 4xx refusal clears the checkpoint but 5xx or missing receipt cannot fall back",async()=>{
  for(const kind of ["image","video"] as const) {
    for(const status of [403,503,200]) {
      let cleared=0;
      const f=fixture({accountCount:2,submit:async()=>json({error:{message:"request failed"}},status)});
      const lifecycle={onBeforeSubmit:async()=>undefined,onSubmitRejected:async()=>{cleared++;}};
      const generation=kind==="image"?f.client.generateImage({...imageInput,...lifecycle}):f.client.generateVideo({...imageInput,durationSeconds:8,...lifecycle});
      await assert.rejects(generation,status===403?/403/:FlowSubmissionUncertainError);
      assert.equal(cleared,status===403?1:0);assert.equal(f.counts().submitCalls,1,"Do not try another model/account after an ambiguous result");
    }
  }
});

function fixture(options: {
  accountCount?: number;
  modern?: boolean;
  videoEnabled?: boolean;
  submit?: (accountId: string, count: number) => Promise<Response>;
  redirect?: (accountId: string, count: number) => Promise<Response>;
  signed?: () => Promise<Response>;
} = {}) {
  const accounts: FlowAccountPublic[] = Array.from({ length: options.accountCount ?? 1 }, (_, index) => ({
    id: `account-${index}`, enabled: true, videoEnabled: options.videoEnabled ?? true, status: "ready", tier: "PRO",
    tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  }));
  let submitCalls = 0;
  let redirectCalls = 0;
  let refreshCalls = 0;
  const submitAccounts: string[] = [];
  const projectCalls: string[] = [];
  const sessionCalls: Array<{ accountId: string; url: string; init?: RequestInit }> = [];
  const store = {
    list: async () => accounts.map((account) => ({ ...account })),
    secret: async () => options.modern ? { sessionOrigin: "https://flow.google.com" } : { accessToken: "unit-test-token" },
    updateSession: async (id: string, patch: Partial<FlowAccountPublic>) => {
      const account = accounts.find((item) => item.id === id)!;
      Object.assign(account, patch);
      return { ...account };
    },
  };
  const auth = {
    refresh: async (id: string) => { refreshCalls += 1; return { ...accounts.find((item) => item.id === id)! }; },
      prepareRuntime: async () => undefined,
      rpc: async () => [[null, null, null, null, null, [["Nano Banana 2", [["NARWHAL"]]]]]],
    recaptchaToken: async () => "unit-test-recaptcha-token",
    sessionFor: async (accountId: string) => ({
      fetch: async (url: string, init?: RequestInit) => {
        sessionCalls.push({ accountId, url, init });
        if (url.includes("project.createProject")) {
          projectCalls.push(accountId);
          return json({ result: { data: { json: { id: `project-${accountId}` } } } });
        }
        if (/batchGenerateImages|batchAsyncGenerate/u.test(url)) {
          submitAccounts.push(accountId);
          submitCalls += 1;
          return options.submit?.(accountId, submitCalls)
            ?? json({ media: [{ name: `image-${submitCalls}`, image: {} }] });
        }
        if (url.startsWith("https://image.example.test/")) {
          return options.signed?.() ?? new Response(png, { headers: { "content-type": "image/png" } });
        }
        throw new Error("Unexpected test request");
      },
    }),
    requestMediaRedirect: async (accountId: string) => {
      redirectCalls += 1;
      return options.redirect?.(accountId, redirectCalls)
        ?? new Response(null, { status: 302, headers: { location: "https://image.example.test/signed.png" } });
    },
  };
  return {
    client: new FlowClient(store as never, auth as never), accounts, submitAccounts, projectCalls, sessionCalls,
    counts: () => ({ submitCalls, redirectCalls, refreshCalls }),
  };
}

test("Flow modern login check is read-only and distinguishes login from generation support", async () => {
  const f = fixture({ modern: true });
  const result = await f.client.test("account-0");
  assert.equal(result.ok, true);
  assert.match(result.message, /Вход.*подтверждён.*Генератор изображений подключён/);
  assert.deepEqual(f.projectCalls, []);
  assert.deepEqual(f.sessionCalls, []);
  f.accounts[0]!.status = "needs_user_action";
  assert.equal((await f.client.test("account-0")).ok, false, "no false success after access refusal");
});

test("Flow modern Veo rejects an unavailable model before paid submission, preserving login", async () => {
  const f = fixture({ modern: true });
  let checkpoints = 0;
  const lifecycle = { onBeforeSubmit: async () => { checkpoints++; }, onRemoteJob: async () => { checkpoints++; } };
  await assert.rejects(f.client.generateVideo({ ...imageInput, ...lifecycle, durationSeconds: 8 }), /Модель.*отсутствует/);
  assert.equal(f.accounts[0]!.status, "ready");
  assert.equal(checkpoints, 0);
  assert.equal(f.counts().submitCalls, 0);
  assert.deepEqual(f.projectCalls, []);
});

test("Flow images: image-only accounts use isolated project/session and session-proxy redirect", async () => {
  const f = fixture({ videoEnabled: false });
  assert.equal(await f.client.configured("image"), true);
  assert.equal(await f.client.configured("video"), false);
  let job: FlowRemoteImageJob | undefined;
  assert.deepEqual(await f.client.generateImage({ ...imageInput, onRemoteJob: (value) => { job = value; } }), png);
  assert.equal(job?.kind, "image");
  assert.equal(job?.mediaName, "image-1");
  assert.equal(job?.projectId, "project-account-0");
  assert.equal(f.counts().redirectCalls, 1);
  const signed = f.sessionCalls.find((call) => call.url.startsWith("https://image.example.test/"))!;
  assert.equal(signed.accountId, "account-0");
  assert.equal(signed.init?.credentials, "omit");
  assert.equal(new Headers(signed.init?.headers).has("authorization"), false);
});

test("Flow unusual activity: image and video refusals stop retries without rotating accounts", async () => {
  for (const kind of ["image","video"] as const) {
    const f = fixture({accountCount:2,submit:async()=>json({error:{message:"reCAPTCHA evaluation failed: PUBLIC_ERROR_UNUSUAL_ACTIVITY: PERMISSION_DENIED"}},403)});
    const generate = () => kind === "image"
      ? f.client.generateImage({...imageInput,accountId:"account-0"})
      : f.client.generateVideo({...imageInput,durationSeconds:8,accountId:"account-0"});
    await assert.rejects(generate(),/^FlowUserActionError: \[no-retry\].*проверку активности/);
    assert.equal(f.accounts[0]!.status,"needs_user_action");
    assert.equal(f.accounts[1]!.status,"ready");
    await assert.rejects(generate(),/\[no-retry\]/);
    assert.equal(f.counts().submitCalls,1,"do not blindly repeat a rejected submission");
    assert.equal(f.counts().refreshCalls,0,"no automatic reset of Google's action-required state");
    assert.deepEqual(f.submitAccounts,["account-0"]);
    assert.deepEqual(await f.client.generateImage({...imageInput,resumeJob:{provider:"flow",kind:"image",accountId:"account-0",
      projectId:"prior-project",mediaName:"prior-paid-image",modelKey:"GEM_PIX_2",submittedAt:new Date().toISOString()}}),png);
    assert.equal(f.counts().submitCalls,1,"prior paid downloads remain available");
  }
});

test("Flow images: a multi-account pool rotates without shared sessions or projects", async () => {
  const f = fixture({ accountCount: 3 });
  await f.client.generateImage(imageInput);
  await f.client.generateImage(imageInput);
  await f.client.generateImage(imageInput);
  assert.deepEqual(f.submitAccounts, ["account-0", "account-1", "account-2"]);
  assert.deepEqual(f.projectCalls, ["account-0", "account-1", "account-2"]);
  const submissionSessions = f.sessionCalls
    .filter((call) => call.url.includes("batchGenerateImages"))
    .map((call) => call.accountId);
  assert.deepEqual(submissionSessions, ["account-0", "account-1", "account-2"]);
});

test("Flow accounts: a fifth profile is allowed, but a sixth profile is rejected", () => {
  const fiveAccounts = Array.from({ length: MAX_FLOW_ACCOUNTS }, (_, index) => `account-${index}`);
  assert.doesNotThrow(() => assertFlowAccountCapacity(fiveAccounts.slice(0, 4), "account-4"));
  assert.doesNotThrow(() => assertFlowAccountCapacity(fiveAccounts, "account-2"), "an existing profile remains editable");
  assert.throws(
    () => assertFlowAccountCapacity(fiveAccounts, "account-5"),
    /не более 5 Flow-аккаунтов/
  );
});

test("Flow images: five ready accounts run in parallel and serialize overflow per account", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let notifyFiveStarted!: () => void;
  const fiveStarted = new Promise<void>((resolve) => { notifyFiveStarted = resolve; });
  const activeByAccount = new Map<string, number>();
  const maxActiveByAccount = new Map<string, number>();
  let activeTotal = 0;
  let maxActiveTotal = 0;
  const f = fixture({
    accountCount: MAX_FLOW_ACCOUNTS,
    submit: async (accountId, count) => {
      const active = (activeByAccount.get(accountId) ?? 0) + 1;
      activeByAccount.set(accountId, active);
      maxActiveByAccount.set(accountId, Math.max(maxActiveByAccount.get(accountId) ?? 0, active));
      activeTotal += 1;
      maxActiveTotal = Math.max(maxActiveTotal, activeTotal);
      if (activeTotal === MAX_FLOW_ACCOUNTS) notifyFiveStarted();
      await gate;
      activeByAccount.set(accountId, active - 1);
      activeTotal -= 1;
      return json({ media: [{ name: `image-${count}`, image: {} }] });
    },
  });

  const requests = Array.from(
    { length: MAX_FLOW_ACCOUNTS * 2 },
    () => f.client.generateImage(imageInput)
  );
  let timeout: NodeJS.Timeout | undefined;
  await Promise.race([
    fiveStarted,
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("five Flow accounts did not start concurrently")), 2_000);
    }),
  ]).finally(() => clearTimeout(timeout));

  assert.equal(maxActiveTotal, MAX_FLOW_ACCOUNTS);
  assert.deepEqual(new Set(f.submitAccounts.slice(0, MAX_FLOW_ACCOUNTS)), new Set(
    Array.from({ length: MAX_FLOW_ACCOUNTS }, (_, index) => `account-${index}`)
  ));
  assert.ok([...maxActiveByAccount.values()].every((value) => value === 1));
  release();
  await Promise.all(requests);
  assert.equal(f.counts().submitCalls, MAX_FLOW_ACCOUNTS * 2);
  assert.ok([...maxActiveByAccount.values()].every((value) => value === 1));
});

test("Flow images: persistent 401 refreshes once and leaves account needs_login", async () => {
  const f = fixture({ submit: async () => json({ error: { message: "UNAUTHENTICATED" } }, 401) });
  await assert.rejects(f.client.generateImage(imageInput), /\[no-retry\]/);
  assert.deepEqual(f.counts(), { submitCalls: 2, redirectCalls: 0, refreshCalls: 1 });
  assert.equal(f.accounts[0]?.status, "needs_login");
  await assert.rejects(f.client.generateImage(imageInput), /\[no-retry\]/);
  assert.equal(f.counts().submitCalls, 2);
  assert.equal(f.counts().refreshCalls, 1, "automatic retry must not revive a rejected session");
});

test("Flow images: uncertain POST after 401 refresh never rotates to another paid account", async () => {
  const f = fixture({ accountCount: 2, submit: async (_id, count) => {
    if (count === 1) return json({ error: { message: "UNAUTHENTICATED" } }, 401);
    throw new TypeError("connection closed before response");
  } });
  await assert.rejects(f.client.generateImage(imageInput), FlowSubmissionUncertainError);
  assert.deepEqual(f.submitAccounts, ["account-0", "account-0"]);
});

test("Flow images: download failure resumes existing media without another generation", async () => {
  const f = fixture({ redirect: async (_id, count) => count === 1
    ? new Response("temporary failure", { status: 502 })
    : new Response(png, { headers: { "content-type": "image/png" } }) });
  let job: FlowRemoteImageJob | undefined;
  await assert.rejects(f.client.generateImage({ ...imageInput, onRemoteJob: (value) => { job = value; } }), /502/);
  assert.ok(job);
  f.accounts[0]!.cooldownUntil = new Date(Date.now() + 60_000).toISOString();
  f.accounts[0]!.videoEnabled = false;
  assert.deepEqual(await f.client.generateImage({ ...imageInput, resumeJob: job }), png);
  assert.equal(f.counts().submitCalls, 1);
});

test("Flow images: ready URL without mediaId cannot trigger a new paid request after download failure", async () => {
  const f = fixture({ accountCount: 2,
    submit: async () => json({ media: [{ image: { generatedImage: { fifeUrl: "https://image.example.test/ready.png" } } }] }),
    signed: async () => { throw new TypeError("download connection failed"); },
  });
  await assert.rejects(f.client.generateImage(imageInput), FlowSubmissionUncertainError);
  assert.deepEqual(f.submitAccounts, ["account-0"]);
});

test("Flow images: Stop during submitted POST is bounded and does not repeat submission", async () => {
  let notifySubmit!: () => void;
  const submitted = new Promise<void>((resolve) => { notifySubmit = resolve; });
  const controller = new AbortController();
  const f = fixture({ accountCount: 2, submit: async () => {
    notifySubmit();
    return new Promise(() => undefined);
  } });
  const pending = f.client.generateImage({ ...imageInput, signal: controller.signal });
  await submitted;
  controller.abort();
  await assert.rejects(pending, FlowSubmissionUncertainError);
  assert.equal(f.counts().submitCalls, 1);
});

test("Flow images: authentication failure during download cannot resubmit or rotate", async () => {
  const f = fixture({ accountCount: 2, redirect: async () => new Response("unauthorized", { status: 401 }) });
  let job: FlowRemoteImageJob | undefined;
  await assert.rejects(f.client.generateImage({ ...imageInput, onRemoteJob: (value) => { job = value; } }), /401/);
  assert.ok(job);
  assert.deepEqual(f.submitAccounts, ["account-0"]);
});

test("Flow images: unknown successful response blocks uncertain paid retry", async () => {
  const f = fixture({ submit: async () => json({ accepted: true }) });
  await assert.rejects(f.client.generateImage(imageInput), FlowSubmissionUncertainError);
  assert.equal(f.counts().submitCalls, 1);
});

test("Flow images: generatedImage mediaId/fifeUrl and inline base64 are supported", async () => {
  const media = { image: { generatedImage: { mediaId: "nested-id", fifeUrl: "https://image.example.test/ready.png" } } };
  assert.equal(findFlowGeneratedImage({ data: { media: [media] } })?.name, "nested-id");
  const linked = fixture({ submit: async () => json({ media: [media] }) });
  assert.deepEqual(await linked.client.generateImage(imageInput), png);
  assert.equal(linked.counts().redirectCalls, 0);
  const inline = fixture({ submit: async () => json({ media: [{ image: { generatedImage: { encodedImage: png.toString("base64") } } }] }) });
  assert.deepEqual(await inline.client.generateImage(imageInput), png);
  assert.equal(inline.counts().redirectCalls, 0);
});

test("Flow images: content-type alone cannot disguise HTML as an image", async () => {
  const f = fixture({ signed: async () => new Response("<html>login required, this is not a generated image</html>", { headers: { "content-type": "image/png" } }) });
  await assert.rejects(f.client.generateImage(imageInput), /вместо изображения/);
});

test("Flow account queue serializes one account while other accounts remain independent", async () => {
  const queue = new FlowAccountSerialQueue();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const events: string[] = [];
  const first = queue.run("a", undefined, async () => { events.push("a1-start"); await gate; events.push("a1-end"); });
  const second = queue.run("a", undefined, async () => { events.push("a2"); });
  await queue.run("b", undefined, async () => { events.push("b"); });
  assert.deepEqual(events, ["a1-start", "b"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["a1-start", "b", "a1-end", "a2"]);
});

test("Flow account queue gives an overflow task to whichever eligible account becomes free first", async () => {
  const queue = new FlowAccountSerialQueue();
  let releaseA!: () => void;
  let releaseB!: () => void;
  const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
  const gateB = new Promise<void>((resolve) => { releaseB = resolve; });
  let startedA!: () => void;
  let startedB!: () => void;
  const aStarted = new Promise<void>((resolve) => { startedA = resolve; });
  const bStarted = new Promise<void>((resolve) => { startedB = resolve; });
  const first = queue.run("a", undefined, async () => { startedA(); await gateA; });
  const second = queue.run("b", undefined, async () => { startedB(); await gateB; });
  await Promise.all([aStarted, bStarted]);

  let overflowAccount: string | undefined;
  const overflow = queue.runAny([{ id: "a" }, { id: "b" }], undefined, async (account) => {
    overflowAccount = account.id;
  });
  releaseB();
  await Promise.all([second, overflow]);
  assert.equal(overflowAccount, "b", "the overflow must not remain queued behind slower account a");
  releaseA();
  await first;
});

test("Flow account queue cancellation cannot release a still-busy account", async () => {
  const queue = new FlowAccountSerialQueue();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = queue.run("a", undefined, () => gate);
  const controller = new AbortController();
  const cancelled = queue.run("a", controller.signal, async () => { assert.fail("cancelled task executed"); });
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  let thirdStarted = false;
  const third = queue.run("a", undefined, async () => { thirdStarted = true; });
  await Promise.resolve();
  assert.equal(thirdStarted, false);
  release();
  await Promise.all([first, third]);
  assert.equal(thirdStarted, true);
});

test("Flow steps bound stalled requests and propagate abort without waiting for browser promises", async () => {
  let requestSignal: AbortSignal | undefined;
  await assert.rejects(runFlowStep("test", 10, undefined, (signal) => {
    requestSignal = signal;
    return new Promise(() => undefined);
  }), FlowTimeoutError);
  assert.equal(requestSignal?.aborted, true);
  const controller = new AbortController();
  const pending = runFlowStep("test", 60_000, controller.signal, () => new Promise(() => undefined));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("Flow cookies: unrelated domains are not rewritten into the Flow session", () => {
  const cookies = parseFlowCookies(JSON.stringify([
    { name: "__Secure-next-auth.session-token", value: "real-flow", domain: ".labs.google" },
    { name: "__Secure-next-auth.session-token.1", value: "foreign-session", domain: "example.test" },
  ]));
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0]?.value, "real-flow");
  assert.throws(() => parseFlowCookies("example.test\tTRUE\t/\tTRUE\t0\t__Secure-next-auth.session-token\tforeign"), /не содержат/);
});

test("Flow regional refusal: confirmed product URL is actionable, not a transient retry", async () => {
  const reason = flowRuntimeBlockReason("https://flow.google.com/unsupported-country");
  assert.ok(reason);
  assert.match(new FlowUserActionError(reason).message, /^\[no-retry\]/);
  assert.equal(flowRuntimeBlockReason("https://example.test/unsupported-country"), undefined);
  assert.equal(flowRuntimeBlockReason("https://labs.google/fx/tools/flow?next=unsupported-country"), undefined);
  const f = fixture();
  f.accounts[0]!.status = "needs_user_action";
  await assert.rejects(f.client.generateImage(imageInput), /\[no-retry\]/);
  assert.equal(f.counts().refreshCalls, 0);
  assert.equal(f.counts().submitCalls, 0);
});

test("Flow navigation: flow.google.com remains in product instead of redirecting back after login", () => {
  assert.equal(isAllowedFlowNavigation("https://flow.google.com/unsupported-country"), true);
  assert.equal(shouldReturnToFlowAfterLogin("https://flow.google.com/", true, false), false);
  assert.equal(isAllowedFlowNavigation("https://flow.google.com/project/example"), true);
  assert.equal(shouldReturnToFlowAfterLogin("https://flow.google.com/project/example", true, false), false);
  assert.equal(flowRuntimeBlockReason("https://flow.google.com/project/example"), undefined);
  assert.equal(isAllowedFlowNavigation("https://flow.google.com.example.test/"), false);
  assert.equal(shouldReturnToFlowAfterLogin("https://one.google.com/explore-plan", true, false), true);
});

test("Flow runtime: only a loaded legacy tools page identifies the frontend migration", () => {
  assert.equal(shouldHoldLegacyFlowRuntime("https://labs.google/fx/tools/flow", "https://flow.google.com/"), true);
  assert.equal(shouldHoldLegacyFlowRuntime("https://labs.google/fx/ru/tools/flow", "https://flow.google.com/project/example"), true);
  assert.equal(shouldHoldLegacyFlowRuntime("https://labs.google/fx/tools/flow", "https://accounts.google.com/"), false);
  assert.equal(shouldHoldLegacyFlowRuntime("https://flow.google.com/", "https://flow.google.com/project/example"), false);
});
