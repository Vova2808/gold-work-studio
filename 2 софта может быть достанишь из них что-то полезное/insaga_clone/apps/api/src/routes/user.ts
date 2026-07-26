import { Router } from "express";
import { state } from "../store/state.js";

const r = Router();

// GET /api/user/me — current user profile (frontend polls this on boot)
r.get("/me", (_req, res) => {
  res.json({
    id: process.env.STUB_USER_ID ?? "stub-user",
    email: process.env.STUB_USER_EMAIL ?? "user@local",
    name: process.env.STUB_USER_NAME ?? "Local User",
    avatarUrl: null,
    plan: "studio",
    studioTier: "unlimited",
    isAdmin: false,
    createdAt: new Date(0).toISOString(),
    locale: "ru",
  });
});

// GET /api/user/profile — alias some builds use
r.get("/profile", (_req, res) => {
  res.json({
    id: process.env.STUB_USER_ID ?? "stub-user",
    email: process.env.STUB_USER_EMAIL ?? "user@local",
    name: process.env.STUB_USER_NAME ?? "Local User",
    plan: "studio",
  });
});

// GET /api/user/generations — list user projects
r.get("/generations", (_req, res) => {
  const generations = Array.from(state.projects.values()).map((p) => ({
    id: p.id,
    userId: p.userId,
    title: p.title,
    style: p.style,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    frameCount: p.frameCount,
    charactersCount: p.charactersCount,
    locationsCount: p.locationsCount,
    scenesCount: p.scenesCount,
    hasScenes: p.hasScenes,
    previewImage: p.previewImage,
    coverPreviewImage: p.coverPreviewImage,
    coverHistoryCount: p.coverHistoryCount,
    imageModel: p.imageModel,
    cameraPreset: p.cameraPreset,
    storyMode: p.storyMode,
    aspectRatio: p.aspectRatio,
    projectType: p.projectType,
  }));
  res.json({
    success: true,
    generations,
    count: generations.length,
    total: generations.length,
  });
});

// GET /api/user/generations/:id — load a single project (auto-restore on workspace boot).
// Frontend calls this with id from localStorage; if id is unknown we still return a
// minimally-valid empty project so the workspace doesn't crash with HTTP 404.
r.get("/generations/:id", (req, res) => {
  const id = req.params.id;
  const p = state.projects.get(id);
  if (p) {
    return res.json({ success: true, generation: p, project: p });
  }
  // Empty stub — keeps auto-restore happy; frontend will start a fresh project.
  res.json({
    success: true,
    generation: {
      id,
      userId: process.env.STUB_USER_ID,
      title: "Untitled",
      style: "stickman",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      frameCount: 0,
      charactersCount: 0,
      locationsCount: 0,
      scenesCount: 0,
      hasScenes: false,
      previewImage: null,
      coverPreviewImage: null,
      coverHistoryCount: 0,
      imageModel: "NARWHAL",
      cameraPreset: "cinematic",
      storyMode: "characters",
      aspectRatio: "16:9",
      characters: [],
      locations: [],
      scenes: [],
    },
  });
});

// POST /api/user/generations — create project shell
r.post("/generations", (req, res) => {
  const id = state.newProjectId();
  const userId = process.env.STUB_USER_ID!;
  const now = new Date().toISOString();
  const {
    title = "Untitled",
    style = "stickman",
    characters = [],
    locations = [],
    scenes = [],
    coverHistory = [],
    projectType,
  } = req.body ?? {};

  state.projects.set(id, {
    id,
    userId,
    title,
    style,
    createdAt: now,
    updatedAt: now,
    frameCount: scenes.length,
    charactersCount: characters.length,
    locationsCount: locations.length,
    scenesCount: scenes.length,
    hasScenes: scenes.length > 0,
    previewImage: null,
    coverPreviewImage: null,
    coverHistoryCount: coverHistory.length,
    imageModel: "NARWHAL",
    cameraPreset: "cinematic",
    storyMode: "characters",
    aspectRatio: "16:9",
    projectType,
    characters,
    locations,
    scenes,
  });

  res.json({ success: true, projectId: id });
});

export default r;
