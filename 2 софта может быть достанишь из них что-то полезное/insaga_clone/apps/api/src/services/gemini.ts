// Gemini Generative Language API client.
// Uses REST directly (no SDK) — fewer deps, easier to swap.
//
// Model mapping (insaga's UI value → real Gemini model):
//   GEM_PIX    → gemini-2.5-flash-image          ("Nano Banana")
//   GEM_PIX_2  → nano-banana-pro-preview         ("Nano Banana Pro")
//   NARWHAL    → gemini-3-pro-image-preview      ("Nano Banana 2")
//
// Story directing model: gemini-2.5-pro (or gemini-3.1-pro-preview when stable).

const BASE = "https://generativelanguage.googleapis.com/v1beta";

import { getGeminiKey } from "../store/keystore.js";

function key(userId?: string): string {
  const k = getGeminiKey(userId);
  if (!k) throw new Error("GEMINI_API_KEY not set — add your key in Settings or .env");
  return k;
}

export type GenContentRequest = {
  contents: Array<{
    role: "user" | "model";
    parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
  }>;
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    responseMimeType?: "application/json" | "text/plain";
    responseSchema?: any;
  };
  safetySettings?: any[];
};

export async function generateContent(
  model: string,
  req: GenContentRequest,
  userId?: string
): Promise<any> {
  const url = `${BASE}/models/${model}:generateContent`;
  const t0 = Date.now();
  console.log(`[gemini] -> ${model} (req size ${JSON.stringify(req).length}b)`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000); // 2 min hard cap
  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key(userId),
      },
      body: JSON.stringify(req),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    console.error(`[gemini] !! ${model} fetch failed after ${Date.now()-t0}ms:`, e.message);
    throw new Error(`Gemini ${model} network: ${e.message}`);
  }
  clearTimeout(timer);
  if (!r.ok) {
    const t = await r.text();
    console.error(`[gemini] !! ${model} ${r.status} after ${Date.now()-t0}ms: ${t.slice(0,300)}`);
    throw new Error(`Gemini ${model} ${r.status}: ${t.slice(0, 500)}`);
  }
  const j = await r.json();
  console.log(`[gemini] <- ${model} OK in ${Date.now()-t0}ms`);
  return j;
}

// Convenience: extract first text part from a generateContent response.
export function firstText(resp: any): string {
  return resp?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// Convenience: extract first inlineData (image/audio bytes).
export function firstInlineData(resp: any): { mimeType: string; data: string } | null {
  const parts = resp?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    if (p.inlineData?.data) return p.inlineData;
  }
  return null;
}

// Map UI image model id → real Gemini model.
export function imageModelFor(uiValue: string): string {
  switch (uiValue) {
    case "GEM_PIX":
      return "gemini-2.5-flash-image";
    case "GEM_PIX_2":
      return "nano-banana-pro-preview";
    case "NARWHAL":
      return "gemini-3-pro-image-preview";
    default:
      return "gemini-2.5-flash-image";
  }
}
