import { app } from "electron";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { FlowAccountStore } from "../src/flow-account-store.js";
import { FlowAuthService } from "../src/flow-auth-service.js";
import { flowLoginLocation, FLOW_READ_SESSION_SCRIPT, parseFlowBrowserSession } from "../src/flow-browser-session.js";
const root = process.env.GWS_FLOW_PROBE_ROOT!;
app.setPath("userData", root);
app.on("window-all-closed", () => undefined);
const deadline = setTimeout(() => { console.error("Flow session probe exceeded 60s"); app.exit(2); }, 60_000);
app.whenReady().then(async () => {
  const store = new FlowAccountStore(join(root, "accounts.json"));
  const account = (await store.list())[0]!;
  const auth = new FlowAuthService(store, () => undefined, () => undefined);
  const browser = await auth.sessionFor(account.id);
  const cookies = await browser.cookies.get({});
  console.log(JSON.stringify({ cookieNames: cookies.filter(c => /google$|google\.com$/.test(c.domain ?? "")).map(c => `${c.domain}:${c.name}`) }));
  const window = (auth as any).createAuthWindow(account.id, await store.partition(account.id), false);
  await window.loadURL("about:blank");
  window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Network.enable");
  const rpcRequests = new Map<string, string>();
  const shape = (value: any, depth = 0): any => {
    if (depth > 6) return "[nested]";
    if (typeof value === "string") return value.length > 160 ? `[string:${value.length}]` : "[string]";
    if (Array.isArray(value)) return value.length > 14 ? { length: value.length, first: value.slice(0, 5).map(v => shape(v, depth + 1)) } : value.map(v => shape(v, depth + 1));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, shape(v, depth + 1)]));
    return value;
  };
  window.webContents.debugger.on("message", (_event: unknown, method: string, params: any) => {
    if (method === "Network.requestWillBeSent" && params.request.url.startsWith("https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute")) {
      const rpc = new URL(params.request.url).searchParams.get("rpcids") ?? "";
      if (!["nzlxg", "KV2T2d", "Yizz8d", "UpteDb"].includes(rpc)) return;
      rpcRequests.set(params.requestId, rpc);
      try {
        const request = JSON.parse(new URLSearchParams(params.request.postData).get("f.req") ?? "null");
        const payload = JSON.parse(request[0][0][1]);
        console.log(JSON.stringify({rpc, requestShape:shape(payload)}));
      } catch { /* no payload printed */ }
    }
    if (method === "Network.loadingFinished" && rpcRequests.has(params.requestId)) {
      const rpc = rpcRequests.get(params.requestId)!; rpcRequests.delete(params.requestId);
      void window.webContents.debugger.sendCommand("Network.getResponseBody", { requestId: params.requestId }).then((result:any) => {
        for (const line of result.body.split("\n")) {
          if (!line.startsWith("[[")) continue;
          try { for (const row of JSON.parse(line)) if (row[0] === "wrb.fr" && row[1] === rpc) console.log(JSON.stringify({rpc,responseShape:shape(typeof row[2] === "string" ? JSON.parse(row[2]) : row)})); } catch { /* raw data omitted */ }
        }
      }).catch(() => undefined);
    }
  });
  const seen = new Set<string>();
  const scripts: string[] = [];
  // Observe native network completion. Attaching CDP before a newly created
  // hidden window has a renderer can wait indefinitely for Network.enable.
  browser.webRequest.onCompleted({ urls: ["https://flow.google.com/*", "https://aisandbox-pa.googleapis.com/*", "https://www.gstatic.com/*"] }, details => {
    const url = new URL(details.url);
    if (details.resourceType === "script" && url.hostname === "www.gstatic.com" && url.pathname.includes("boq-labs")) scripts.push(url.href);
    if (url.hostname !== "flow.google.com" && url.hostname !== "aisandbox-pa.googleapis.com") return;
    const rpc = url.searchParams.get("rpcids");
    const path = url.pathname.startsWith("/asb/") ? "/asb/[media]" : url.pathname.includes("project/") ? "/project/[id]" : url.pathname;
    const key = `${url.hostname}${path}:${rpc && /^[\w,]+$/.test(rpc) ? rpc : ""}:${details.statusCode}`;
    if (!seen.has(key) && seen.size < 40) { seen.add(key); console.log(key); }
  });
  console.log("Loading the signed-in Flow page (read-only)");
  await window.loadURL("https://flow.google.com/");
  await new Promise(resolve => setTimeout(resolve, 12_000));
  console.log(JSON.stringify(await window.webContents.executeJavaScript(`(() => {
    const data = window.WIZ_global_data || {};
    return { bootstrapKeys: Object.keys(data), emailKeys: Object.entries(data).filter(([k,v]) => typeof v === 'string' && /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(v)).map(([k]) => k), csrfPresent: typeof data.SNlM0e === 'string' };
  })()`)));
  const verified = parseFlowBrowserSession(await window.webContents.executeJavaScript(FLOW_READ_SESSION_SCRIPT));
  console.log(JSON.stringify({ sessionVerified: true, hasEmail: !!verified.email, credits: verified.credits, tier: verified.tier }));
  console.log(JSON.stringify({ location: flowLoginLocation(window.webContents.getURL()), scripts: [...new Set(scripts)] }));
  // Public code only, never save page HTML, response bodies, session tokens or account identity.
  await writeFile(join(root, "public-scripts.json"), JSON.stringify([...new Set(scripts)]));
  console.log(`PROBE_ROOT=${root}`);
  window.destroy();
  await auth.closeAll();
  clearTimeout(deadline); app.quit();
}).catch(error => { console.error(error.message); clearTimeout(deadline); app.exit(1); });
