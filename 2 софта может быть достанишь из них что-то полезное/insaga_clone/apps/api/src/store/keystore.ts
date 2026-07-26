/**
 * BYOK (Bring Your Own Key) keystore.
 * Stores per-user API keys in memory.
 * Falls back to .env keys if user hasn't set their own.
 */

// userId → { gemini, elevenlabs, openai }
const store = new Map<string, {
  gemini?: string;
  elevenlabs?: string;
  openai?: string;
}>();

export function setUserKey(userId: string, provider: string, key: string) {
  const existing = store.get(userId) || {};
  (existing as any)[provider] = key;
  store.set(userId, existing);
}

export function getUserKey(userId: string, provider: string): string | undefined {
  return (store.get(userId) || {})[provider as keyof typeof store extends Map<string, infer V> ? never : never] as string | undefined;
}

export function getGeminiKey(userId?: string): string {
  // 1. Per-user key
  if (userId) {
    const userKeys = store.get(userId);
    if (userKeys?.gemini) return userKeys.gemini;
  }
  // 2. Fallback to .env
  return process.env.GEMINI_API_KEY ?? "";
}

export function getVeоKey(userId?: string): string {
  if (userId) {
    const userKeys = store.get(userId);
    if (userKeys?.gemini) return userKeys.gemini; // Veo uses same key as Gemini
  }
  return process.env.VEO_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
}

export function getElevenLabsKey(userId?: string): string {
  if (userId) {
    const userKeys = store.get(userId);
    if (userKeys?.elevenlabs) return userKeys.elevenlabs;
  }
  return process.env.TTS_API_KEY ?? process.env.ELEVENLABS_API_KEY ?? "";
}

export function getOpenAIKey(userId?: string): string {
  if (userId) {
    const userKeys = store.get(userId);
    if (userKeys?.openai) return userKeys.openai;
  }
  return process.env.OPENAI_API_KEY ?? "";
}

export function getUserKeyStatus(userId?: string) {
  const keys = userId ? store.get(userId) : undefined;
  return {
    gemini: !!(keys?.gemini || process.env.GEMINI_API_KEY),
    elevenlabs: !!(keys?.elevenlabs || process.env.TTS_API_KEY || process.env.ELEVENLABS_API_KEY),
    openai: !!(keys?.openai || process.env.OPENAI_API_KEY),
    source: {
      gemini: keys?.gemini ? "user" : (process.env.GEMINI_API_KEY ? "env" : "none"),
      elevenlabs: keys?.elevenlabs ? "user" : ((process.env.TTS_API_KEY || process.env.ELEVENLABS_API_KEY) ? "env" : "none"),
      openai: keys?.openai ? "user" : (process.env.OPENAI_API_KEY ? "env" : "none"),
    },
  };
}

// Extract userId from auth header (Supabase JWT)
export function extractUserId(authHeader?: string): string | undefined {
  if (!authHeader) return undefined;
  try {
    const token = authHeader.replace("Bearer ", "");
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
    return payload.sub;
  } catch {
    return undefined;
  }
}
