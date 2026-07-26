// Story generation routes — stage1 (chars+locs+props) and stage2 (scenes).
// Async: returns generationId immediately, work runs in background and emits Socket.IO events.

import { Router } from "express";
import { state } from "../store/state.js";
import { runStage1, runStage2 } from "../services/story.js";
import { generateImage } from "../services/imagegen.js";
import { extractUserId } from "../store/keystore.js";
import { emitPhase, emitProgress, emitComplete, emitError } from "../sockets/io.js";
import { fixture } from "../utils/fixtures.js";

const r = Router();

// Resolve a style's promptSuffix from the cached custom-styles catalog.
function styleSuffix(styleId: string): { promptSuffix: string; customVideoPrompt?: string; useCustomVideoPrompt?: boolean } {
  try {
    const all = fixture("story_custom-styles.json");
    const arr = Array.isArray(all) ? all : (all.styles ?? []);
    const hit = arr.find((s: any) => s.id === styleId || s.name === styleId);
    return {
      promptSuffix: hit?.promptSuffix ?? "",
      customVideoPrompt: hit?.customVideoPrompt,
      useCustomVideoPrompt: hit?.useCustomVideoPrompt,
    };
  } catch {
    return { promptSuffix: "" };
  }
}

// POST /api/story/generate-stage1
r.post("/generate-stage1", async (req, res) => {
  const id = state.newGenerationId();
  const projectId = req.body?.projectId;
  const socketId = req.body?.socketId;
  const userId = extractUserId(req.headers.authorization);

  state.generations.set(id, {
    generationId: id,
    generationType: "stage1",
    status: "processing",
    phase: "queued",
    progress: 0,
    message: "Queued",
    storyRequest: req.body,
    characters: [],
    locations: [],
    props: [],
    scenes: [],
    totalDuration: 0,
    totalScenes: req.body?.frameCount ?? 0,
    projectId,
    socketId,
    isRegeneration: false,
    regeneratedCount: 0,
    startedAt: Date.now(),
  });

  res.json({
    status: "processing",
    message: "Generating characters and locations",
    generationId: id,
  });

  // Run async — fire-and-forget.
  (async () => {
    const g = state.generations.get(id)!;
    try {
      const style = styleSuffix(req.body?.style ?? "");

      g.phase = "characters";
      g.message = "Directing story";
      emitPhase(id, "characters", { progress: 5 });

      const out = await runStage1({
        text: req.body?.text ?? "",
        style: req.body?.style ?? "stickman",
        promptSuffix: style.promptSuffix,
        frameCount: req.body?.frameCount ?? 4,
        tempo: req.body?.tempo ?? "balanced",
        cameraPreset: req.body?.cameraPreset ?? "cinematic",
        aspectRatio: req.body?.aspectRatio ?? "16:9",
        storyMode: req.body?.storyMode ?? "characters",
        imageModel: req.body?.imageModel ?? "NARWHAL",
        userId,
      });

      g.characters = out.characters ?? [];
      g.locations = out.locations ?? [];
      g.props = out.props ?? [];
      g.progress = 30;
      g.message = `Generated ${g.characters.length} characters, ${g.locations.length} locations`;
      emitPhase(id, "characters", { progress: 30, generationType: "stage1", characters: g.characters, locations: g.locations, props: g.props });

      // Render character ref images
      g.phase = "characters";
      for (let i = 0; i < g.characters.length; i++) {
        const c = g.characters[i];
        const img = await generateImage({
          prompt: (c.prompt ?? c.description) + (style.promptSuffix ? "\n\n" + style.promptSuffix : ""),
          uiModel: req.body?.imageModel,
          aspectRatio: req.body?.aspectRatio,
          filenamePrefix: `character-${c.id}`,
          userId,
        });
        c.imageUrl = img.imageUrl;
        const p = 30 + Math.round(((i + 1) / g.characters.length) * 20);
        g.progress = p;
        emitProgress(id, {
          progress: p,
          message: `Character ${i + 1}/${g.characters.length}`,
          generationType: "stage1",
          characters: g.characters,
          locations: g.locations,
          props: g.props,
        });
      }

      // Render location plates
      g.phase = "locations";
      emitPhase(id, "locations", { progress: 50, generationType: "stage1", characters: g.characters, locations: g.locations, props: g.props });
      for (let i = 0; i < g.locations.length; i++) {
        const loc = g.locations[i];
        const img = await generateImage({
          prompt: (loc.prompt ?? loc.description) + (style.promptSuffix ? "\n\n" + style.promptSuffix : ""),
          uiModel: req.body?.imageModel,
          aspectRatio: req.body?.aspectRatio,
          filenamePrefix: `location-${loc.id}`,
          userId,
        });
        loc.imageUrl = img.imageUrl;
        const p = 50 + Math.round(((i + 1) / g.locations.length) * 25);
        g.progress = p;
        emitProgress(id, {
          progress: p,
          message: `Location ${i + 1}/${g.locations.length}`,
          generationType: "stage1",
          characters: g.characters,
          locations: g.locations,
          props: g.props,
        });
      }

      // Optional prop images
      g.phase = "scenes";
      for (let i = 0; i < g.props.length; i++) {
        const pr = g.props[i];
        const img = await generateImage({
          prompt: (pr.prompt ?? pr.description) + (style.promptSuffix ? "\n\n" + style.promptSuffix : ""),
          uiModel: req.body?.imageModel,
          aspectRatio: req.body?.aspectRatio,
          filenamePrefix: `prop-${pr.id}`,
          userId,
        });
        pr.imageUrl = img.imageUrl;
      }

      g.phase = "complete";
      g.status = "complete";
      g.progress = 100;
      g.message = "Stage1 complete — awaiting user approval";
      emitComplete(id, {
        generationType: "stage1",
        characters: g.characters,
        locations: g.locations,
        props: g.props,
      });
    } catch (e: any) {
      g.status = "error";
      g.phase = "error";
      g.message = String(e.message ?? e);
      emitError(id, g.message);
    }
  })();
});

// POST /api/story/generate-stage2
r.post("/generate-stage2", async (req, res) => {
  const id = state.newGenerationId();
  const projectId = req.body?.projectId;
  const socketId = req.body?.socketId;

  const totalDuration = req.body?.totalDuration ?? 0;

  state.generations.set(id, {
    generationId: id,
    generationType: "stage2",
    status: "processing",
    phase: "scenes",
    progress: 0,
    message: "Scene generation started",
    storyRequest: req.body?.storyRequest,
    characters: req.body?.characters ?? [],
    locations: req.body?.locations ?? [],
    props: req.body?.props ?? [],
    scenes: [],
    totalDuration,
    totalScenes: (req.body?.preGenScenes ?? []).length,
    projectId,
    socketId,
    isRegeneration: false,
    regeneratedCount: 0,
    startedAt: Date.now(),
  });

  res.json({
    status: "processing",
    message: "Scene generation started",
    generationId: id,
  });

  (async () => {
    const g = state.generations.get(id)!;
    try {
      const style = styleSuffix(req.body?.storyRequest?.style ?? "");

      const stage2 = await runStage2({
        storyRequest: req.body?.storyRequest,
        characters: g.characters,
        locations: g.locations,
        props: g.props,
        preGenScenes: req.body?.preGenScenes ?? [],
        totalDuration,
      });

      g.scenes = stage2.scenes;
      g.progress = 30;
      console.log(`[stage2] generated ${g.scenes.length} scenes for ${id}`);
      emitPhase(id, "scenes", { progress: 30, generationType: "stage2", scenes: g.scenes });

      // Render each scene image
      for (let i = 0; i < g.scenes.length; i++) {
        const s = g.scenes[i];
        try {
          const img = await generateImage({
            prompt: (s.prompt ?? s.sceneText) + (style.promptSuffix ? "\n\n" + style.promptSuffix : ""),
            uiModel: req.body?.storyRequest?.imageModel,
            aspectRatio: req.body?.storyRequest?.aspectRatio,
            filenamePrefix: `scene-${s.sceneNumber}`,
            userId,
          });
          s.imageUrl = img.imageUrl;
          console.log(`[stage2] scene ${i + 1}/${g.scenes.length} rendered: ${s.imageUrl}`);
        } catch (err: any) {
          console.error(`[stage2] scene ${i + 1} failed:`, err.message);
          s.imageUrl = "/uploads/placeholder.jpg";
          s.imageError = String(err.message ?? err);
        }
        const p = 30 + Math.round(((i + 1) / g.scenes.length) * 70);
        g.progress = p;
        g.message = `Frame ${i + 1}/${g.scenes.length}`;
        emitProgress(id, {
          progress: p,
          message: g.message,
          generationType: "stage2",
          scenes: g.scenes,
        });
      }

      g.phase = "complete";
      g.status = "complete";
      g.progress = 100;
      g.message = "Scene generation complete";
      emitComplete(id, { generationType: "stage2", scenes: g.scenes });
    } catch (e: any) {
      g.status = "error";
      g.phase = "error";
      g.message = String(e.message ?? e);
      console.error(`[stage2] FAILED:`, g.message);
      emitError(id, g.message);
    }
  })();
});

export default r;
