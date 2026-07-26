// Animation phase — animates approved stage2 scenes via Veo3.
//
// We don't have a captured /api/animation/* contract from session_01 (animation
// phase wasn't reached). We expose two routes that match the most likely shape:
//
//   POST /api/animation/start
//     in:  { generationId | scenes[], style?, aspectRatio?, durationSeconds?, projectId?, socketId? }
//     out: { generationId, status: "processing", message }
//
//   GET /api/animation/status?id=<generationId>
//     out: same shape as story/generation-status
//
// Scene.videoUrl gets populated as each clip lands. Socket.IO events are emitted.

import { Router } from "express";
import { resolve } from "node:path";
import { state } from "../store/state.js";
import { animateScene } from "../services/veo.js";
import { emitPhase, emitProgress, emitComplete, emitError } from "../sockets/io.js";

const r = Router();

r.post("/start", async (req, res) => {
  const id = state.newGenerationId();
  const projectId = req.body?.projectId;
  const socketId = req.body?.socketId;

  // Resolve scenes: either passed inline or pulled from a previous generation.
  let scenes: any[] = req.body?.scenes ?? [];
  if (!scenes.length && req.body?.generationId) {
    const prev = state.generations.get(req.body.generationId);
    if (prev) scenes = prev.scenes;
  }
  if (!scenes.length) {
    return res.status(400).json({ error: "no scenes to animate" });
  }

  state.generations.set(id, {
    generationId: id,
    generationType: "animation",
    status: "processing",
    phase: "animations",
    progress: 0,
    message: "Animation queue starting",
    storyRequest: req.body?.storyRequest,
    characters: req.body?.characters ?? [],
    locations: req.body?.locations ?? [],
    props: req.body?.props ?? [],
    scenes,
    totalDuration: scenes.reduce((s, x) => s + (x.duration ?? 5), 0),
    totalScenes: scenes.length,
    projectId,
    socketId,
    isRegeneration: false,
    regeneratedCount: 0,
    startedAt: Date.now(),
  });

  res.json({
    status: "processing",
    message: "Animation generation started",
    generationId: id,
  });

  (async () => {
    const g = state.generations.get(id)!;
    try {
      const aspectRatio = req.body?.aspectRatio ?? "16:9";
      emitPhase(id, "animations", { progress: 0, scenes: g.scenes });

      for (let i = 0; i < g.scenes.length; i++) {
        const s = g.scenes[i];
        const refPath = s.imageUrl?.startsWith("/uploads/")
          ? resolve(process.cwd(), "." + s.imageUrl)
          : undefined;
        const out = await animateScene({
          prompt: s.animationPrompt ?? s.prompt,
          imageRefPath: refPath,
          aspectRatio,
          durationSeconds: Math.round(s.duration ?? 5),
          filenamePrefix: `scene-${s.sceneNumber}`,
        });
        s.videoUrl = out.videoUrl;
        const p = Math.round(((i + 1) / g.scenes.length) * 100);
        g.progress = p;
        g.message = `Animating ${i + 1}/${g.scenes.length}`;
        emitProgress(id, { progress: p, message: g.message, scenes: g.scenes });
      }

      g.phase = "complete";
      g.status = "complete";
      g.progress = 100;
      g.message = "Animation complete";
      emitComplete(id, { scenes: g.scenes });
    } catch (e: any) {
      g.status = "error";
      g.phase = "error";
      g.message = String(e.message ?? e);
      emitError(id, g.message);
    }
  })();
});

r.get("/status", (req, res) => {
  const id = String(req.query.id ?? "");
  const g = state.generations.get(id);
  if (!g) return res.status(404).json({ error: "not found" });
  res.json(g);
});

export default r;
