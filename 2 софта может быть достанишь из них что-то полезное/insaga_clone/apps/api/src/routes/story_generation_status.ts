// GET /api/story/generation-status — polling endpoint that returns
// the latest active generation snapshot for the (stub) user.
// Real frontend polls this when sockets are unavailable.

import { Router } from "express";
import { state } from "../store/state.js";

const r = Router();

r.get("/generation-status", (_req, res) => {
  // Pick the most recent non-complete generation, else the most recent of any.
  const all = Array.from(state.generations.values()).sort(
    (a, b) => b.startedAt - a.startedAt
  );
  const active = all.find((g) => g.status === "processing") ?? all[0];

  if (!active) {
    return res.json({ status: "idle" });
  }

  res.json({
    status: active.status,
    generationId: active.generationId,
    generationType: active.generationType,
    scenes: active.scenes,
    characters: active.characters,
    locations: active.locations,
    totalDuration: active.totalDuration,
    totalScenes: active.totalScenes,
    progress: active.progress,
    message: active.message,
    phase: active.phase,
    storyRequest: active.storyRequest,
    projectId: active.projectId,
    isRegeneration: active.isRegeneration,
    regeneratedCount: active.regeneratedCount,
  });
});

export default r;
