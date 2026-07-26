// Veo3 video generation via Gemini predictLongRunning API.
// Long-running operation: predict → poll → download.
//
// Veo3 endpoint pattern (Generative Language API):
//   POST /v1beta/models/veo-3.0-generate-001:predictLongRunning
//   GET  /v1beta/{operationName}     (poll)
//   GET  /v1beta/files/{name}:download (fetch resulting mp4)
//
// Inputs: animationPrompt + reference image (scene still). Output: mp4 saved under uploads/.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { getVeоKey } from "../store/keystore.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const UPLOADS = resolve(process.cwd(), "uploads");
mkdirSync(UPLOADS, { recursive: true });

function key(userId?: string): string {
  const k = getVeоKey(userId);
  if (!k) throw new Error("GEMINI_API_KEY not set — add your key in Settings or .env");
  return k;
}

function veoModel(): string {
  return process.env.VEO_MODEL ?? "veo-3.0-generate-001";
}

export interface AnimateOpts {
  prompt: string;
  imageRefPath?: string;        // absolute path to scene still
  aspectRatio?: "16:9" | "9:16" | "1:1";
  durationSeconds?: number;     // 4..8 typically
  filenamePrefix?: string;
  userId?: string;
}

export interface AnimateResult {
  videoUrl: string;             // /uploads/<file>.mp4
  absPath: string;
  model: string;
  operationName: string;
}

// --- low-level helpers ---

async function startOperation(opts: AnimateOpts): Promise<string> {
  const url = `${BASE}/models/${veoModel()}:predictLongRunning`;
  const instance: any = { prompt: opts.prompt };
  if (opts.imageRefPath) {
    const bytes = readFileSync(opts.imageRefPath);
    instance.image = {
      bytesBase64Encoded: bytes.toString("base64"),
      mimeType: opts.imageRefPath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
    };
  }
  const body = {
    instances: [instance],
    parameters: {
      aspectRatio: opts.aspectRatio ?? "16:9",
      durationSeconds: opts.durationSeconds ?? 5,
      sampleCount: 1,
    },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key(opts.userId) },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`Veo predictLongRunning ${r.status}: ${(await r.text()).slice(0, 500)}`);
  }
  const j = await r.json();
  if (!j.name) throw new Error(`Veo: no operation name in response: ${JSON.stringify(j).slice(0, 300)}`);
  return j.name as string;
}

async function pollOperation(name: string, maxMs = 5 * 60_000, userId?: string): Promise<any> {
  const start = Date.now();
  let delay = 3000;
  while (Date.now() - start < maxMs) {
    const r = await fetch(`${BASE}/${name}`, { headers: { "x-goog-api-key": key(userId) } });
    if (!r.ok) throw new Error(`Veo poll ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    if (j.done) {
      if (j.error) throw new Error(`Veo op error: ${JSON.stringify(j.error).slice(0, 300)}`);
      return j;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay + 1500, 10_000);
  }
  throw new Error(`Veo poll timeout after ${maxMs}ms`);
}

async function downloadFile(fileResource: string, userId?: string): Promise<Buffer> {
  // fileResource looks like "files/abcd1234"
  const url = `${BASE}/${fileResource}:download?alt=media`;
  const r = await fetch(url, { headers: { "x-goog-api-key": key(userId) } });
  if (!r.ok) throw new Error(`Veo download ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

// --- public API ---

export async function animateScene(opts: AnimateOpts): Promise<AnimateResult> {
  const opName = await startOperation(opts);
  const result = await pollOperation(opName, 5 * 60_000, opts.userId);

  // Veo response shape varies; handle both inline bytes and file references.
  const videos =
    result?.response?.generateVideoResponse?.generatedSamples ??
    result?.response?.predictResponse?.predictions ??
    result?.response?.videos ??
    [];

  if (!videos.length) {
    throw new Error(`Veo: empty videos in op response: ${JSON.stringify(result).slice(0, 400)}`);
  }

  const sample = videos[0];
  let mp4: Buffer;
  if (sample.video?.uri) {
    // file reference style
    const m = String(sample.video.uri).match(/files\/[^:?]+/);
    if (!m) throw new Error(`Veo: cannot parse file uri ${sample.video.uri}`);
    mp4 = await downloadFile(m[0], opts.userId);
  } else if (sample.bytesBase64Encoded || sample.video?.bytesBase64Encoded) {
    const b64 = sample.bytesBase64Encoded ?? sample.video.bytesBase64Encoded;
    mp4 = Buffer.from(b64, "base64");
  } else {
    throw new Error(`Veo: unknown sample shape: ${Object.keys(sample).join(",")}`);
  }

  const file = `${opts.filenamePrefix ?? "scene"}-${nanoid(12)}.mp4`;
  const abs = resolve(UPLOADS, file);
  writeFileSync(abs, mp4);

  return {
    videoUrl: `/uploads/${file}`,
    absPath: abs,
    model: veoModel(),
    operationName: opName,
  };
}
