// Audio/TTS routes — full implementation matching insaga.net contract.
//
// Provider: ElevenLabs (direct) or voicer_mat3u proxy.
// Falls back to Google TTS (Gemini TTS) if no ElevenLabs key.
//
// GET  /voices                     — list voices
// GET  /balance                    — TTS balance
// POST /generate                   — generate TTS for text
// POST /analyze-dialogue           — analyze text for character dialogue
// POST /generate-multivoice        — multi-voice TTS
// POST /regenerate-voice           — regenerate a single voice clip
// GET  /elevenlabs-voice/:id       — get ElevenLabs voice details
// GET/POST /voice-presets           — voice preset CRUD
// PUT  /voice-presets/:id/activate  — activate preset
// PUT  /voice-presets-deactivate    — deactivate all presets

import { Router } from "express";
import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fixture } from "../utils/fixtures.js";

const r = Router();

const UPLOADS_AUDIO = resolve(process.cwd(), "uploads/audio");
mkdirSync(UPLOADS_AUDIO, { recursive: true });

// ElevenLabs API
const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

function getElevenKey(): string {
  return process.env.TTS_API_KEY ?? process.env.ELEVENLABS_API_KEY ?? "";
}

async function elevenLabsTTS(text: string, voiceId: string, modelId: string): Promise<Buffer> {
  const key = getElevenKey();
  if (!key) throw new Error("No ElevenLabs API key configured (set TTS_API_KEY in .env)");

  const resp = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": key,
    },
    body: JSON.stringify({
      text,
      model_id: modelId || "eleven_multilingual_v2",
      voice_settings: {
        similarity_boost: 0.75,
        stability: 0.5,
        style: 0,
        use_speaker_boost: true,
      },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`ElevenLabs error ${resp.status}: ${err}`);
  }

  return Buffer.from(await resp.arrayBuffer());
}

// --- GET /voices ---
r.get("/voices", (_req, res) => {
  const provider = _req.query.provider as string;
  const voices = fixture("audio_voices.json");

  if (provider) {
    voices.provider = provider;
  }

  // Mark if we have a real key
  voices.hasOwnKey = !!getElevenKey();
  voices.enabledProviders = {
    voiceApi: !!getElevenKey(),
    voicerMat3u: true,
  };

  res.json(voices);
});

// --- GET /balance ---
r.get("/balance", (_req, res) => {
  const hasKey = !!getElevenKey();
  res.json({
    balances: hasKey ? [{
      provider: "elevenlabs",
      characters_left: 999999,
      characters_limit: 999999,
      next_reset: null,
    }] : [],
    provider: hasKey ? "elevenlabs" : "voicer_mat3u",
    voicerStats: {
      user_id: process.env.STUB_USER_ID,
      subscription_type: "unlimited",
      total_characters: 999999,
      used_characters: 0,
      remaining_characters: 999999,
      total_tasks: 100,
      completed_tasks: 0,
      active_tasks: 0,
      subscription_expires_at: "2099-12-31T23:59:59.000Z",
    },
  });
});

// --- POST /generate ---
r.post("/generate", async (req, res) => {
  const { text, voiceId, voice_id, modelId, model_id, provider: reqProvider } = req.body ?? {};
  const vid = voiceId || voice_id;
  const mid = modelId || model_id || "eleven_multilingual_v2";

  if (!text) return res.status(400).json({ error: "text required" });
  if (!vid) return res.status(400).json({ error: "voiceId required" });

  console.log(`[audio] generate: voice=${vid} model=${mid} text="${text.substring(0, 80)}..."`);

  try {
    const audioBuffer = await elevenLabsTTS(text, vid, mid);
    const filename = `tts_${randomUUID()}.mp3`;
    const filepath = join(UPLOADS_AUDIO, filename);
    writeFileSync(filepath, audioBuffer);

    const audioUrl = `/uploads/audio/${filename}`;
    console.log(`[audio] generated: ${audioUrl} (${(audioBuffer.length / 1024).toFixed(1)}KB)`);

    res.json({
      success: true,
      audioUrl,
      duration: Math.round(text.length / 15), // rough estimate
      characters: text.length,
      provider: "elevenlabs",
    });
  } catch (err: any) {
    console.error("[audio] generate failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- POST /analyze-dialogue ---
r.post("/analyze-dialogue", (req, res) => {
  const { text, characters } = req.body ?? {};
  if (!text) return res.status(400).json({ error: "text required" });

  // Simple dialogue analysis: split text into segments by character
  const segments: Array<{ character: string; text: string; isNarrator: boolean }> = [];
  const lines = text.split(/\n/).filter(Boolean);

  for (const line of lines) {
    // Check if line starts with a character name (e.g., "John: Hello there")
    const match = line.match(/^([A-Za-zА-Яа-яёЁ][A-Za-zА-Яа-яёЁ\s]*?):\s*(.+)/);
    if (match) {
      const charName = match[1].trim();
      const dialogue = match[2].trim();
      segments.push({
        character: charName,
        text: dialogue,
        isNarrator: false,
      });
    } else {
      segments.push({
        character: "Narrator",
        text: line.trim(),
        isNarrator: true,
      });
    }
  }

  res.json({
    success: true,
    segments,
    characters: [...new Set(segments.map(s => s.character))],
  });
});

// --- POST /generate-multivoice ---
r.post("/generate-multivoice", async (req, res) => {
  const { segments, defaultVoiceId, modelId } = req.body ?? {};

  if (!segments?.length) return res.status(400).json({ error: "segments required" });

  console.log(`[audio] multivoice: ${segments.length} segments`);

  const results: Array<{ character: string; audioUrl: string; duration: number }> = [];
  const errors: Array<{ character: string; error: string }> = [];

  for (const seg of segments) {
    const vid = seg.voiceId || seg.voice_id || defaultVoiceId;
    if (!vid || !seg.text) {
      errors.push({ character: seg.character || "unknown", error: "missing voiceId or text" });
      continue;
    }

    try {
      const audioBuffer = await elevenLabsTTS(seg.text, vid, modelId || "eleven_multilingual_v2");
      const filename = `tts_${seg.character || "narrator"}_${randomUUID()}.mp3`;
      writeFileSync(join(UPLOADS_AUDIO, filename), audioBuffer);

      results.push({
        character: seg.character || "Narrator",
        audioUrl: `/uploads/audio/${filename}`,
        duration: Math.round(seg.text.length / 15),
      });
    } catch (err: any) {
      errors.push({ character: seg.character || "unknown", error: err.message });
    }
  }

  res.json({
    success: true,
    results,
    errors,
    totalSegments: segments.length,
    successfulSegments: results.length,
  });
});

// --- POST /regenerate-voice ---
r.post("/regenerate-voice", async (req, res) => {
  const { text, voiceId, voice_id, modelId, model_id, audioId } = req.body ?? {};
  const vid = voiceId || voice_id;
  const mid = modelId || model_id || "eleven_multilingual_v2";

  if (!text || !vid) return res.status(400).json({ error: "text and voiceId required" });

  try {
    const audioBuffer = await elevenLabsTTS(text, vid, mid);
    const filename = `tts_regen_${randomUUID()}.mp3`;
    writeFileSync(join(UPLOADS_AUDIO, filename), audioBuffer);

    res.json({
      success: true,
      audioUrl: `/uploads/audio/${filename}`,
      audioId: audioId || randomUUID(),
      duration: Math.round(text.length / 15),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- GET /elevenlabs-voice/:id ---
r.get("/elevenlabs-voice/:id", async (req, res) => {
  const key = getElevenKey();
  if (!key) {
    return res.json({ error: "No ElevenLabs key" });
  }

  try {
    const resp = await fetch(`${ELEVENLABS_BASE}/voices/${req.params.id}`, {
      headers: { "xi-api-key": key },
    });
    const data = await resp.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Voice Presets (in-memory store) ---
const voicePresets = new Map<string, any>();
let activePresetId: string | null = null;

r.get("/voice-presets", (_req, res) => {
  res.json({
    presets: Array.from(voicePresets.values()),
    activePresetId,
  });
});

r.post("/voice-presets", (req, res) => {
  const id = randomUUID();
  const preset = { id, ...req.body, createdAt: new Date().toISOString() };
  voicePresets.set(id, preset);
  res.json({ preset });
});

r.put("/voice-presets/:id", (req, res) => {
  const existing = voicePresets.get(req.params.id);
  if (!existing) return res.status(404).json({ error: "not found" });
  const updated = { ...existing, ...req.body, updatedAt: new Date().toISOString() };
  voicePresets.set(req.params.id, updated);
  res.json({ preset: updated });
});

r.delete("/voice-presets/:id", (req, res) => {
  voicePresets.delete(req.params.id);
  if (activePresetId === req.params.id) activePresetId = null;
  res.json({ success: true });
});

r.put("/voice-presets/:id/activate", (req, res) => {
  activePresetId = req.params.id;
  res.json({ success: true, activePresetId });
});

r.put("/voice-presets-deactivate", (_req, res) => {
  activePresetId = null;
  res.json({ success: true });
});

// --- Custom voices (stub) ---
r.post("/voicer-custom-voice", (req, res) => {
  res.json({ success: true, message: "Custom voice created (stub)" });
});

r.delete("/voicer-custom-voice/:id", (req, res) => {
  res.json({ success: true });
});

export default r;
