// Story regeneration + edit endpoints.
//
// These handle individual scene/character/location regeneration and editing.
// They're called from the scene review UI when the user wants to regenerate
// a specific element.
//
// POST /story/regenerate-missing    — regenerate all incomplete scenes
// POST /story/regenerate-scene      — regenerate a single scene image
// GET  /story/regenerate-character  — regenerate a character image
// GET  /story/regenerate-location   — regenerate a location image
// GET  /story/regenerate-prop       — regenerate a prop image
// POST /story/cancel-generation     — cancel an in-progress generation
// GET  /story/edit-character        — edit character prompt
// GET  /story/edit-location         — edit location prompt
// GET  /story/edit-scene            — edit scene prompt
// POST /story/replace-character-photo — replace character photo
// GET  /story/download-zip          — download all assets as ZIP
// POST /story/genres                — get genre suggestions
// POST /story/youtube-screenshots   — extract screenshots from YouTube
// POST /story/create-custom-style   — create a custom art style
// GET  /story/custom-style/:id/privacy — get style privacy
// GET  /story/custom-style/:id/video-prompt — get video prompt for style
// DELETE /story/custom-style/:id    — delete custom style

import { Router } from "express";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { state } from "../store/state.js";
import { generateImage } from "../services/imagegen.js";
import { emitProgress, emitComplete, emitError } from "../sockets/io.js";

const r = Router();

// --- POST /story/cancel-generation ---
r.post("/cancel-generation", (req, res) => {
  const { generationId } = req.body ?? {};
  if (generationId) {
    const gen = state.generations.get(generationId);
    if (gen) {
      gen.status = "cancelled";
      emitError(generationId, "Generation cancelled by user");
    }
  }
  res.json({ success: true, generationId });
});

// --- POST /story/regenerate-scene ---
r.post("/regenerate-scene", async (req, res) => {
  const { sceneId, prompt, referenceImages, style, characters, locations, sceneNumber, projectId, imageModel } = req.body ?? {};

  if (!sceneId || !prompt) {
    return res.status(400).json({ error: "sceneId and prompt required" });
  }

  console.log(`[story] regenerate-scene: ${sceneId} prompt="${prompt.substring(0, 60)}..."`);

  try {
    const imageUrl = await generateImage({
      prompt: `${prompt}, ${style || "cinematic"} style`,
      aspectRatio: "16:9",
      filenamePrefix: `scene-regen-${sceneId}`,
    });

    // Update the scene in the project
    for (const [, project] of state.projects) {
      const scene = project.scenes?.find((s: any) => s.id === sceneId);
      if (scene) {
        scene.imageUrl = imageUrl;
        scene.prompt = prompt;
        break;
      }
    }

    res.json({ success: true, sceneId, imageUrl });
  } catch (err: any) {
    console.error("[story] regenerate-scene failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- POST /story/regenerate-missing ---
r.post("/regenerate-missing", async (req, res) => {
  const { projectId, scenes, characters, locations, style, imageModel, generationId, sceneIds } = req.body ?? {};

  console.log(`[story] regenerate-missing: project=${projectId} scenes=${scenes?.length || 0}`);

  res.json({
    success: true,
    message: "Regeneration started",
    generationId: generationId || state.newGenerationId(),
  });

  // Background regeneration of missing images
  // This would iterate through scenes/characters/locations that lack images
  // and generate them. For now, we acknowledge the request.
});

// --- GET /story/regenerate-character ---
r.get("/regenerate-character", async (req, res) => {
  const { characterId, prompt, style, variation } = req.query as any;

  if (!characterId || !prompt) {
    return res.status(400).json({ error: "characterId and prompt required" });
  }

  console.log(`[story] regenerate-character: ${characterId}`);

  try {
    const imageUrl = await generateImage({
      prompt: `${prompt}, ${style || ""} style`,
      aspectRatio: "1:1",
      filenamePrefix: `char-regen-${characterId}`,
    });

    res.json({ success: true, characterId, imageUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- GET /story/regenerate-location ---
r.get("/regenerate-location", async (req, res) => {
  const { locationId, prompt, style } = req.query as any;

  if (!locationId || !prompt) {
    return res.status(400).json({ error: "locationId and prompt required" });
  }

  console.log(`[story] regenerate-location: ${locationId}`);

  try {
    const imageUrl = await generateImage({
      prompt: `${prompt}, ${style || ""} style`,
      aspectRatio: "16:9",
      filenamePrefix: `loc-regen-${locationId}`,
    });

    res.json({ success: true, locationId, imageUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- GET /story/regenerate-prop ---
r.get("/regenerate-prop", async (req, res) => {
  const { propId, prompt, style } = req.query as any;

  if (!propId || !prompt) {
    return res.status(400).json({ error: "propId and prompt required" });
  }

  console.log(`[story] regenerate-prop: ${propId}`);

  try {
    const imageUrl = await generateImage({
      prompt: `${prompt}, ${style || ""} style`,
      aspectRatio: "1:1",
      filenamePrefix: `prop-regen-${propId}`,
    });

    res.json({ success: true, propId, imageUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- GET /story/edit-character ---
r.get("/edit-character", (req, res) => {
  const { characterId, prompt } = req.query as any;
  console.log(`[story] edit-character: ${characterId}`);
  res.json({ success: true, characterId, prompt, message: "Edit accepted" });
});

// --- GET /story/edit-location ---
r.get("/edit-location", (req, res) => {
  const { locationId, prompt } = req.query as any;
  console.log(`[story] edit-location: ${locationId}`);
  res.json({ success: true, locationId, prompt, message: "Edit accepted" });
});

// --- GET /story/edit-scene ---
r.get("/edit-scene", (req, res) => {
  const { sceneId, prompt } = req.query as any;
  console.log(`[story] edit-scene: ${sceneId}`);
  res.json({ success: true, sceneId, prompt, message: "Edit accepted" });
});

// --- POST /story/replace-character-photo ---
r.post("/replace-character-photo", async (req, res) => {
  const { characterId, imageUrl } = req.body ?? {};
  console.log(`[story] replace-character-photo: ${characterId}`);
  res.json({ success: true, characterId, imageUrl });
});

// --- GET /story/download-zip ---
r.get("/download-zip", (req, res) => {
  const { projectId } = req.query as any;
  console.log(`[story] download-zip: project=${projectId}`);
  res.status(501).json({ error: "ZIP download not implemented — use CDP capture to get real endpoint" });
});

// --- POST /story/genres ---
r.post("/genres", (req, res) => {
  const { text } = req.body ?? {};
  // Return common genres
  res.json({
    genres: [
      { id: "fantasy", name: "Fantasy", confidence: 0.8 },
      { id: "scifi", name: "Sci-Fi", confidence: 0.6 },
      { id: "romance", name: "Romance", confidence: 0.5 },
      { id: "horror", name: "Horror", confidence: 0.4 },
      { id: "comedy", name: "Comedy", confidence: 0.3 },
    ],
  });
});

// --- POST /story/youtube-screenshots ---
r.post("/youtube-screenshots", (req, res) => {
  const { url } = req.body ?? {};
  console.log(`[story] youtube-screenshots: ${url}`);
  res.json({ screenshots: [], message: "YouTube screenshots not implemented locally" });
});

// --- POST /story/create-custom-style ---
r.post("/create-custom-style", (req, res) => {
  const { images, isPublic, userComment, genre, sourceUrl } = req.body ?? {};
  const styleId = state.newProjectId();
  console.log(`[story] create-custom-style: ${styleId}`);
  res.json({ success: true, styleId, message: "Custom style created" });
});

// --- GET /story/custom-style/:id/privacy ---
r.get("/custom-style/:id/privacy", (req, res) => {
  res.json({ isPublic: false, ownerId: process.env.STUB_USER_ID });
});

// --- GET /story/custom-style/:id/video-prompt ---
r.get("/custom-style/:id/video-prompt", (req, res) => {
  res.json({
    prompt: "Smooth cinematic camera movement, subtle zoom, character animation",
    style: req.params.id,
  });
});

// --- DELETE /story/custom-style/:id ---
r.delete("/custom-style/:id", (req, res) => {
  console.log(`[story] delete custom-style: ${req.params.id}`);
  res.json({ success: true });
});

export default r;
