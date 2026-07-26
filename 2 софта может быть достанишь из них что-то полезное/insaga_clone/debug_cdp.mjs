// Hooks into running Chrome (--remote-debugging-port=9222) and watches the
// insaga workspace tab: prints every fetch/XHR + every console error.
// Usage: node debug_cdp.mjs   (run for ~60s, then Ctrl+C)

import { WebSocket } from "ws";

const TAB_LIST = "http://localhost:9222/json";

const tabs = await fetch(TAB_LIST).then(r => r.json());
const tab = tabs.find(t => t.url.includes("localhost:3000"));
if (!tab) {
  console.error("[debug_cdp] no localhost:3000 tab found in Chrome");
  process.exit(1);
}
console.log(`[debug_cdp] attaching to: ${tab.url}`);
console.log(`[debug_cdp] tab id: ${tab.id}`);

const ws = new WebSocket(tab.webSocketDebuggerUrl);

let id = 0;
const inflight = new Map(); // requestId -> { url, method, t0 }
const finished = new Map(); // requestId -> { url, status, durMs }

function send(method, params = {}) {
  ws.send(JSON.stringify({ id: ++id, method, params }));
}

ws.on("open", () => {
  console.log("[debug_cdp] connected, enabling Network + Runtime + Log");
  send("Network.enable");
  send("Runtime.enable");
  send("Log.enable");
  send("Page.enable");
  console.log("[debug_cdp] now go to the browser and click Generate. Watching for 60s...");
});

ws.on("message", (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (!msg.method) return;

  if (msg.method === "Network.requestWillBeSent") {
    const r = msg.params;
    if (!r.request.url.includes("localhost:3000")) return;
    inflight.set(r.requestId, {
      url: r.request.url,
      method: r.request.method,
      t0: Date.now(),
      postData: r.request.postData,
    });
    console.log(`>> ${r.request.method} ${r.request.url}`);
  }

  if (msg.method === "Network.responseReceived") {
    const r = msg.params;
    const f = inflight.get(r.requestId);
    if (!f) return;
    const dur = Date.now() - f.t0;
    finished.set(r.requestId, { ...f, status: r.response.status, durMs: dur });
    console.log(`<< ${r.response.status} ${f.url}  (${dur}ms)`);
    inflight.delete(r.requestId);
  }

  if (msg.method === "Network.loadingFailed") {
    const r = msg.params;
    const f = inflight.get(r.requestId);
    if (!f) return;
    console.log(`!! FAILED ${f.url}  reason=${r.errorText}`);
    inflight.delete(r.requestId);
  }

  if (msg.method === "Runtime.consoleAPICalled") {
    const c = msg.params;
    if (c.type === "error" || c.type === "warning") {
      const txt = c.args.map(a => a.value ?? a.description ?? JSON.stringify(a)).join(" ");
      console.log(`[console.${c.type}] ${txt}`);
    }
  }

  if (msg.method === "Runtime.exceptionThrown") {
    const e = msg.params.exceptionDetails;
    console.log(`[js-exception] ${e.text}: ${e.exception?.description ?? ""}`);
  }

  if (msg.method === "Log.entryAdded") {
    const e = msg.params.entry;
    if (e.level === "error" || e.level === "warning") {
      console.log(`[log.${e.level}] ${e.text}  src=${e.source}  url=${e.url ?? ""}`);
    }
  }
});

ws.on("close", () => {
  console.log("[debug_cdp] socket closed");
});

ws.on("error", (e) => {
  console.error("[debug_cdp] ws error:", e.message);
});

// After 60 seconds — print summary of stuck (still inflight) requests.
setTimeout(() => {
  console.log("\n========== SUMMARY ==========");
  console.log(`Inflight (STUCK) requests: ${inflight.size}`);
  for (const [rid, f] of inflight) {
    console.log(`  STUCK ${f.method} ${f.url}  (open ${Date.now() - f.t0}ms)`);
    if (f.postData) console.log(`    body: ${f.postData.slice(0, 400)}`);
  }
  console.log(`Finished requests: ${finished.size}`);
  // Show non-2xx finished
  for (const [rid, f] of finished) {
    if (f.status >= 400) {
      console.log(`  ERROR ${f.status} ${f.method} ${f.url}`);
    }
  }
  process.exit(0);
}, 60_000);
