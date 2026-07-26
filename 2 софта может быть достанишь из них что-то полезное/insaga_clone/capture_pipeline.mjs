/**
 * capture_pipeline.mjs — Full insaga.net pipeline capture via Chrome DevTools Protocol.
 *
 * WHAT IT DOES:
 *   Attaches to a running Chrome (--remote-debugging-port=9222) and records
 *   ALL network traffic to insaga.net, including:
 *   - Every API request + response body (POST/PUT/DELETE especially)
 *   - Socket.IO events (captured from WebSocket frames)
 *   - Image/video uploads and downloads
 *
 * OUTPUT:
 *   D:/insaga_clone/captures/ directory with:
 *   - requests.json     — all captured request/response pairs
 *   - socket_events.json — all Socket.IO events
 *   - summary.json      — endpoint summary
 *   - files/            — downloaded binary files (images, videos)
 *
 * USAGE:
 *   1. Open Chrome with:  chrome.exe --remote-debugging-port=9222
 *   2. Go to insaga.net, log in
 *   3. Run: node capture_pipeline.mjs
 *   4. Use insaga normally — create story, generate scenes, animate, etc.
 *   5. Press Ctrl+C to stop — data is saved automatically
 *
 * REQUIRES: ws (npm install ws)
 */

import { WebSocket } from "ws";
import { mkdirSync, writeFileSync, existsSync, createWriteStream } from "node:fs";
import { resolve, join } from "node:path";

// --- Config ---
const CDP_URL = "http://localhost:9222/json";
const CAPTURE_DIR = resolve("captures");
const FILES_DIR = join(CAPTURE_DIR, "files");
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB max per response body

mkdirSync(CAPTURE_DIR, { recursive: true });
mkdirSync(FILES_DIR, { recursive: true });

// --- State ---
let ws;
let cdpId = 0;
const requests = [];       // captured request/response pairs
const socketEvents = [];   // captured Socket.IO events
const inflight = new Map(); // requestId -> request info
let fileCounter = 0;

// --- Helpers ---
function timestamp() {
  return new Date().toISOString();
}

function saveData() {
  writeFileSync(join(CAPTURE_DIR, "requests.json"), JSON.stringify(requests, null, 2));
  writeFileSync(join(CAPTURE_DIR, "socket_events.json"), JSON.stringify(socketEvents, null, 2));

  // Build summary
  const summary = {};
  for (const r of requests) {
    const key = `${r.method} ${r.url.replace(/\?.*$/, "")}`;
    if (!summary[key]) {
      summary[key] = { count: 0, statuses: [], sampleRequest: null, sampleResponse: null };
    }
    summary[key].count++;
    if (r.status && !summary[key].statuses.includes(r.status)) {
      summary[key].statuses.push(r.status);
    }
    if (!summary[key].sampleRequest && r.requestBody) {
      summary[key].sampleRequest = r.requestBody;
    }
    if (!summary[key].sampleResponse && r.responseBody) {
      summary[key].sampleResponse = r.responseBody;
    }
  }
  writeFileSync(join(CAPTURE_DIR, "summary.json"), JSON.stringify(summary, null, 2));

  console.log(`\n[capture] Saved: ${requests.length} requests, ${socketEvents.length} socket events`);
  console.log(`[capture] Files saved to: ${CAPTURE_DIR}`);
}

function send(method, params = {}) {
  ws.send(JSON.stringify({ id: ++cdpId, method, params }));
}

function isInsagaRequest(url) {
  return url.includes("insaga.net") || url.includes("localhost:3000");
}

function isApiRequest(url) {
  return url.includes("/api/") || url.includes("/supabase-stub/") || url.includes("/montaz/");
}

function tryParseJSON(str) {
  try { return JSON.parse(str); } catch { return str; }
}

function isBinaryContentType(ct) {
  if (!ct) return false;
  return ct.includes("image/") || ct.includes("video/") || ct.includes("audio/") ||
         ct.includes("application/octet-stream") || ct.includes("font/");
}

// --- CDP Handlers ---
async function handleRequest(params) {
  const { requestId, request: req } = params;
  if (!isInsagaRequest(req.url)) return;

  const info = {
    requestId,
    url: req.url,
    method: req.method,
    headers: req.headers,
    requestBody: null,
    t0: Date.now(),
  };

  // Capture request body
  if (req.postData) {
    info.requestBody = tryParseJSON(req.postData);
  }

  inflight.set(requestId, info);

  const isApi = isApiRequest(req.url);
  const marker = isApi ? "📡" : "🌐";
  console.log(`${marker} ${req.method} ${req.url.substring(0, 120)}`);
}

async function handleResponse(params) {
  const { requestId, response: resp } = params;
  const info = inflight.get(requestId);
  if (!info) return;

  info.status = resp.status;
  info.contentType = resp.mimeType || resp.headers?.["content-type"] || "";
  info.duration = Date.now() - info.t0;

  // Try to get response body
  try {
    const bodyResult = await new Promise((resolve, reject) => {
      const bodyId = ++cdpId;
      const handler = (msg) => {
        if (msg.id === bodyId) {
          ws.removeListener("message", handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
      ws.on("message", handler);
      send("Network.getResponseBody", { requestId });
      setTimeout(() => {
        ws.removeListener("message", handler);
        reject(new Error("timeout"));
      }, 5000);
    });

    if (bodyResult) {
      if (bodyResult.base64Encoded) {
        // Binary data — save to file
        if (isBinaryContentType(info.contentType)) {
          fileCounter++;
          const ext = info.contentType.split("/")[1]?.split(";")[0] || "bin";
          const filename = `file_${fileCounter}.${ext}`;
          const buf = Buffer.from(bodyResult.body, "base64");
          if (buf.length < MAX_BODY_SIZE) {
            writeFileSync(join(FILES_DIR, filename), buf);
            info.responseFile = filename;
            info.responseSize = buf.length;
            console.log(`  💾 Saved binary: ${filename} (${(buf.length / 1024).toFixed(1)}KB)`);
          }
        } else {
          // Base64-encoded text (rare)
          info.responseBody = tryParseJSON(Buffer.from(bodyResult.body, "base64").toString("utf-8"));
        }
      } else {
        // Text response
        const bodyStr = bodyResult.body;
        if (bodyStr.length < MAX_BODY_SIZE) {
          info.responseBody = tryParseJSON(bodyStr);
        } else {
          info.responseTruncated = true;
          info.responseSize = bodyStr.length;
        }
      }
    }
  } catch (e) {
    // Body might not be available (e.g., redirects, cached)
    info.responseBodyError = e.message;
  }

  // Store and log
  requests.push(info);
  inflight.delete(requestId);

  const statusIcon = info.status < 400 ? "✅" : "❌";
  console.log(`  ${statusIcon} ${info.status} (${info.duration}ms) ${info.contentType.split(";")[0]}`);
}

// --- WebSocket / Socket.IO capture ---
function handleWebSocketCreated(params) {
  const { requestId, url } = params;
  if (!isInsagaRequest(url)) return;

  console.log(`🔌 WebSocket created: ${url}`);

  // Enable WebSocket framing to capture messages
  send("Network.enable", {});
}

function handleWebSocketFrame(params) {
  const { requestId, timestamp, response } = params;

  // Try to parse Socket.IO frames
  if (response?.payloadData) {
    const data = response.payloadData;

    // Socket.IO protocol: type + data
    // 4 = MESSAGE, 2 = PING, 3 = PONG
    if (data.startsWith("4")) {
      // Socket.IO message
      const payload = data.substring(1);
      try {
        // Could be event: 42["eventName", data]
        const eventMatch = payload.match(/^2\["([^"]+)",(.+)\]$/);
        if (eventMatch) {
          const event = {
            capturedAt: new Date().toISOString(),
            type: "socket_event",
            eventName: eventMatch[1],
            data: tryParseJSON(eventMatch[2]),
          };
          socketEvents.push(event);
          console.log(`  📡 Socket.IO event: ${eventMatch[1]}`);
        } else {
          socketEvents.push({
            capturedAt: new Date().toISOString(),
            type: "socket_raw",
            data: tryParseJSON(payload),
          });
        }
      } catch {
        socketEvents.push({
          timestamp: timestamp(),
          type: "socket_raw",
          data: data.substring(0, 500),
        });
      }
    }
  }
}

// --- Main ---
async function main() {
  console.log("[capture] Connecting to Chrome CDP...");

  let tabs;
  try {
    const resp = await fetch(CDP_URL);
    tabs = await resp.json();
  } catch (e) {
    console.error(`[capture] Cannot reach Chrome at ${CDP_URL}`);
    console.error("[capture] Start Chrome with: chrome.exe --remote-debugging-port=9222");
    process.exit(1);
  }

  // Find insaga tab or use first tab
  const tab = tabs.find(t => t.url.includes("insaga") || t.url.includes("localhost:3000"))
    || tabs.find(t => t.type === "page")
    || tabs[0];

  if (!tab?.webSocketDebuggerUrl) {
    console.error("[capture] No suitable tab found");
    process.exit(1);
  }

  console.log(`[capture] Attaching to: ${tab.url}`);
  console.log(`[capture] Capture directory: ${CAPTURE_DIR}`);
  console.log("[capture] Use insaga.net normally. Press Ctrl+C to stop and save.\n");

  ws = new WebSocket(tab.webSocketDebuggerUrl);

  ws.on("open", () => {
    console.log("[capture] Connected! Enabling network capture...\n");
    send("Network.enable");
    send("Network.enableReportingApi");
    send("Runtime.enable");
    send("Page.enable");
    console.log("[capture] Ready. Start using insaga.net!\n");
    console.log("─".repeat(60));
  });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg.method) return;

    switch (msg.method) {
      case "Network.requestWillBeSent":
        handleRequest(msg.params);
        break;
      case "Network.responseReceived":
        handleResponse(msg.params);
        break;
      case "Network.webSocketCreated":
        handleWebSocketCreated(msg.params);
        break;
      case "Network.webSocketFrameReceived":
        handleWebSocketFrame(msg.params);
        break;
      case "Network.webSocketFrameSent":
        // Could track outgoing socket frames too
        break;
    }
  });

  ws.on("error", (e) => {
    console.error("[capture] WebSocket error:", e.message);
  });

  ws.on("close", () => {
    console.log("\n[capture] Connection closed");
    saveData();
    process.exit(0);
  });

  // Save periodically (every 30s)
  setInterval(() => {
    if (requests.length > 0) {
      saveData();
    }
  }, 30_000);
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[capture] Ctrl+C — saving data...");
  saveData();
  process.exit(0);
});

process.on("SIGTERM", () => {
  saveData();
  process.exit(0);
});

main().catch(e => {
  console.error("[capture] Fatal:", e.message);
  process.exit(1);
});
