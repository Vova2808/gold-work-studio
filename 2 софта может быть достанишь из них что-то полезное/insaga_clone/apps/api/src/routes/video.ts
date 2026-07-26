// Video animation route — matches the real insaga.net API contract.
//
// POST /api/video/animate        — animate a single scene via Veo3
// POST /api/video/animate-bulk   — animate multiple scenes
//
// The frontend calls these with scene details. We start Veo3 generation,
// return 202 immediately, process in background, and emit Socket.IO events.

import { Router } from "express";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { state } from "../store/state.js";
import { animateScene } from "../services/veo.js";
import { emitPhase, emitProgress, emitComplete, emitError } from "../sockets/io.js";

const r = Router();

// POST /api/video/animate — single scene animation
r.post("/animate", async (req, res) => {
  const {
    sceneId,
    imageUrl,
    animationPrompt,
    style,
    projectId,
    scenePrompt,
    genre,
    isCustomPrompt,
    aspectRatio,
    seamlessMode,
    prevSceneId,
    nextSceneId,
  } = req.body ?? {};

  if (!sceneId || !animationPrompt) {
    return res.status(400).json({ error: "sceneId and animationPrompt required" });
  }

  const generationId = state.newGenerationId();

  // Return 202 immediately — work happens in background
  res.status(202).json({
    status: "processing",
    generationId,
    sceneId,
    message: "Animation started",
  });

  // Background processing
  try {
    // Resolve the reference image path
    let imageRefPath: string | undefined;
    if (imageUrl) {
      // imageUrl is like "/uploads/scene-1-xxx.jpg"
      const absPath = resolve(process.cwd(), imageUrl.replace(/^\//, ""));
      if (existsSync(absPath)) {
        imageRefPath = absPath;
      }
    }

    const defaultDuration = 5;
    const aspect = (aspectRatio as "16:9" | "9:16" | "1:1") ?? "16:9";

    emitProgress(generationId, {
      generationType: "animation",
      phase: "animations",
      progress: 0,
      message: "Starting Veo3 animation...",
      sceneId,
    });

    const result = await animateScene({
      prompt: animationPrompt,
      imageRefPath,
      aspectRatio: aspect,
      durationSeconds: defaultDuration,
      filenamePrefix: `anim-${sceneId}`,
    });

    // Update the scene in any project that contains it
    for (const [, project] of state.projects) {
      const scene = project.scenes?.find((s: any) => s.id === sceneId);
      if (scene) {
        scene.videoUrl = result.videoUrl;
        scene.animationStatus = "complete";
        break;
      }
    }

    // Also update in generations state
    for (const [, gen] of state.generations) {
      const scene = gen.scenes?.find((s: any) => s.id === sceneId);
      if (scene) {
        scene.videoUrl = result.videoUrl;
        scene.animationStatus = "complete";
        break;
      }
    }

    emitComplete(generationId, {
      generationType: "animation",
      sceneId,
      videoUrl: result.videoUrl,
      model: result.model,
      message: "Animation complete",
    });

    console.log(`[video] scene ${sceneId} animated → ${result.videoUrl}`);
  } catch (err: any) {
    console.error(`[video] animate failed for scene ${sceneId}:`, err.message);
    emitError(generationId, `Animation failed: ${err.message}`);
  }
});

// POST /api/video/animate-bulk — animate multiple scenes
r.post("/animate-bulk", async (req, res) => {
  const { projectId, sceneIds, style, genre, aspectRatio } = req.body ?? {};

  if (!sceneIds?.length) {
    return res.status(400).json({ error: "sceneIds required" });
  }

  const generationId = state.newGenerationId();

  res.status(202).json({
    status: "processing",
    generationId,
    sceneIds,
    message: `Bulk animation started for ${sceneIds.length} scenes`,
  });

  // Process scenes sequentially in background
  const aspect = (aspectRatio as "16:9" | "9:16" | "1:1") ?? "16:9";

  for (let i = 0; i < sceneIds.length; i++) {
    const sceneId = sceneIds[i];
    try {
      // Find the scene data
      let sceneData: any = null;
      for (const [, project] of state.projects) {
        sceneData = project.scenes?.find((s: any) => s.id === sceneId);
        if (sceneData) break;
      }
      if (!sceneData) {
        for (const [, gen] of state.generations) {
          sceneData = gen.scenes?.find((s: any) => s.id === sceneId);
          if (sceneData) break;
        }
      }

      if (!sceneData) {
        console.warn(`[video] scene ${sceneId} not found, skipping`);
        continue;
      }

      const progress = Math.round(((i) / sceneIds.length) * 100);
      emitProgress(generationId, {
        generationType: "animation",
        phase: "animations",
        progress,
        message: `Animating scene ${i + 1}/${sceneIds.length}`,
        sceneId,
      });

      let imageRefPath: string | undefined;
      if (sceneData.imageUrl) {
        const absPath = resolve(process.cwd(), sceneData.imageUrl.replace(/^\//, ""));
        if (existsSync(absPath)) {
          imageRefPath = absPath;
        }
      }

      const result = await animateScene({
        prompt: sceneData.animationPrompt || sceneData.prompt || "",
        imageRefPath,
        aspectRatio: aspect,
        durationSeconds: sceneData.duration ?? 5,
        filenamePrefix: `anim-${sceneId}`,
      });

      // Update scene
      sceneData.videoUrl = result.videoUrl;
      sceneData.animationStatus = "complete";

      console.log(`[video] bulk scene ${sceneId} → ${result.videoUrl}`);
    } catch (err: any) {
      console.error(`[video] bulk animate failed for ${sceneId}:`, err.message);
      emitError(generationId, `Scene ${sceneId}: ${err.message}`);
    }
  }

  emitComplete(generationId, {
    generationType: "animation",
    message: `Bulk animation complete for ${sceneIds.length} scenes`,
  });
});

export default r;
