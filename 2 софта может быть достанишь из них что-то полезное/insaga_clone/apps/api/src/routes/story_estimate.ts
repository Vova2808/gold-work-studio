// POST /api/story/estimate
// POST /api/story/recommend-frames
// Pure deterministic logic — no LLM, no external calls.

import { Router } from "express";

const r = Router();

const WORDS_PER_MINUTE = 150;

function countWords(text: string): number {
  return (text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function countSentences(text: string): number {
  return (text ?? "")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

function totalChars(text: string): number {
  return (text ?? "").length;
}

// POST /api/story/estimate
//   in:  { text }
//   out: { totalSeconds, totalMinutes }
r.post("/estimate", (req, res) => {
  const text = String(req.body?.text ?? "");
  const words = countWords(text);
  const totalSeconds = Math.round((words / WORDS_PER_MINUTE) * 60);
  const totalMinutes = +(totalSeconds / 60).toFixed(2);
  res.json({ totalSeconds, totalMinutes });
});

// POST /api/story/recommend-frames
//   in:  { text, cameraPreset, tempo }
//   out: { totalSentences, totalCharacters, minFrames, maxFrames,
//          recommended, sentencesPerFrame: { atMin, atMax, atRecommended } }
r.post("/recommend-frames", (req, res) => {
  const text = String(req.body?.text ?? "");
  const tempo = String(req.body?.tempo ?? "normal"); // slow|normal|fast

  const totalSentences = Math.max(1, countSentences(text));
  const totalCharacters = totalChars(text);

  // Frame density tuned to match observed ranges from session_01.
  // tempo: slow → fewer frames per sentence, fast → more.
  const tempoMul: Record<string, number> = { slow: 0.6, normal: 1.0, fast: 1.5 };
  const k = tempoMul[tempo] ?? 1.0;

  const minFrames = Math.max(1, Math.round(totalSentences * 0.5 * k));
  const maxFrames = Math.max(minFrames + 1, Math.round(totalSentences * 1.5 * k));
  const recommended = Math.max(minFrames, Math.round(totalSentences * 1.0 * k));

  res.json({
    totalSentences,
    totalCharacters,
    minFrames,
    maxFrames,
    recommended,
    sentencesPerFrame: {
      atMin: +(totalSentences / minFrames).toFixed(2),
      atMax: +(totalSentences / maxFrames).toFixed(2),
      atRecommended: +(totalSentences / recommended).toFixed(2),
    },
  });
});

export default r;
