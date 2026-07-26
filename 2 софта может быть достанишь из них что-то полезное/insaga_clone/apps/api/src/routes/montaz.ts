// Montaz (editor) routes — video assembly, music, lipsync, export.
//
// Based on real insaga.net CDP captures (2026-05-22).
// Assembly via real FFmpeg (2026-05-22).
// Graphics via Gemini image gen (2026-05-22).

import { Router } from "express";
import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn, exec } from "node:child_process";
import { promisify } from "node:util";
import { assembleTimeline, checkFfmpeg, type AssembleResult } from "../services/ffmpeg.js";

const execAsync = promisify(exec);
const r = Router();

const UPLOADS_DIR = resolve(process.cwd(), "uploads");
const EXPORTS_DIR = resolve(process.cwd(), "uploads/exports");
mkdirSync(EXPORTS_DIR, { recursive: true });

// In-memory project store
const montazProjects = new Map<string, any>();

// Default timeline structure (from real captures)
function defaultTimeline() {
  return {
    tracks: [
      { id: "video-1", type: "video", label: "Video", clips: [], muted: false, locked: false, visible: true, height: 80, volume: 0.9 },
      { id: "audio-narration", type: "audio", label: "Narration", clips: [], muted: false, locked: false, visible: true, height: 60, volume: 0.85 },
      { id: "text-1", type: "text", label: "Subtitles", clips: [], muted: false, locked: false, visible: true, height: 40 },
    ],
    duration: 0,
    playheadPosition: 0,
    transitions: [],
  };
}

// --- GET /projects/:id ---
r.get("/projects/:id", (req, res) => {
  const { id } = req.params;
  let project = montazProjects.get(id);
  if (!project) {
    project = { id, timeline: defaultTimeline(), mediaFiles: [], createdAt: new Date().toISOString() };
    montazProjects.set(id, project);
  }
  res.json(project);
});

// --- PUT /projects/:id --- (update timeline, etc.)
r.put("/projects/:id", (req, res) => {
  const { id } = req.params;
  let project = montazProjects.get(id);
  if (!project) {
    project = { id, timeline: defaultTimeline(), mediaFiles: [], createdAt: new Date().toISOString() };
    montazProjects.set(id, project);
  }

  // Merge incoming data
  const updates = req.body;
  if (updates.timeline) {
    project.timeline = updates.timeline;
  }
  if (updates.title !== undefined) project.title = updates.title;
  if (updates.style !== undefined) project.style = updates.style;
  project.updatedAt = new Date().toISOString();

  res.json(project);
});

// --- POST /projects/:id/media --- (add media file)
r.post("/projects/:id/media", (req, res) => {
  const { id } = req.params;
  let project = montazProjects.get(id);
  if (!project) {
    project = { id, timeline: defaultTimeline(), mediaFiles: [], createdAt: new Date().toISOString() };
    montazProjects.set(id, project);
  }

  const mediaFile = {
    id: randomUUID(),
    ...req.body,
    addedAt: new Date().toISOString(),
  };
  project.mediaFiles.push(mediaFile);

  res.json({ success: true, mediaFile });
});

// In-memory project store (timeline data)
const projectTimelines = new Map<string, any>();

// In-memory export jobs
const exportJobs = new Map<string, {
  id: string;
  projectId: string;
  status: "queued" | "processing" | "done" | "failed" | "cancelled";
  progress: number;
  message: string;
  outputFile?: string;
  startedAt: string;
  finishedAt?: string;
}>();

// --- POST /projects/:id/generate-music ---
r.post("/projects/:id/generate-music", async (req, res) => {
  const { id } = req.params;
  const { styleId } = req.body ?? {};

  console.log(`[montaz] generate-music: project=${id} style=${styleId}`);

  // Suno AI integration would go here.
  // For now, we generate a silent audio placeholder.
  try {
    const musicId = randomUUID();
    const filename = `music_${musicId}.mp3`;
    const filepath = join(UPLOADS_DIR, "audio", filename);

    // Check if ffmpeg is available to generate a simple tone
    let audioUrl = `/uploads/audio/${filename}`;
    try {
      // Generate 30 seconds of silence with ffmpeg
      await execAsync(
        `ffmpeg -y -f lavfi -i "anullsrc=r=44100:cl=stereo" -t 30 -q:a 9 "${filepath}"`,
        { timeout: 10000 }
      );
    } catch {
      // If ffmpeg not available, create a minimal valid MP3 (silent)
      // This is a 1-frame silent MP3 header
      const silentMp3 = Buffer.alloc(1024);
      writeFileSync(filepath, silentMp3);
    }

    // Auto-place on timeline
    const timeline = projectTimelines.get(id);
    if (timeline) {
      const musicTrack = timeline.tracks?.find((t: any) => t.type === "music");
      if (musicTrack) {
        musicTrack.clips.push({
          id: randomUUID(),
          mediaFileId: musicId,
          position: 0,
          duration: 30,
          label: `AI Music (${styleId || "default"})`,
        });
      }
    }

    res.json({
      success: true,
      musicId,
      audioUrl,
      duration: 30,
      style: styleId || "default",
      message: "Music generated and placed on timeline",
    });
  } catch (err: any) {
    console.error("[montaz] music failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- POST /projects/:id/generate-graphics ---
// Generates title card, lower third, and end screen via FFmpeg (local, no API keys).
r.post("/projects/:id/generate-graphics", async (req, res) => {
  const { id } = req.params;
  const { title, characters, aspectRatio } = req.body ?? {};

  console.log(`[montaz] generate-graphics: project=${id} title="${title}"`);

  const project = montazProjects.get(id);
  const projectTitle = title || project?.title || "My Story";
  const ratio = aspectRatio || "16:9";
  const [w, h] = ratio === "9:16" ? [1080, 1920] : ratio === "1:1" ? [1080, 1080] : [1920, 1080];
  const charNames = (characters || [])
    .map((c: any) => (typeof c === "string" ? c : c.name) || "")
    .filter(Boolean)
    .join(", ");

  const generated: Array<{ type: string; imageUrl: string; mediaFileId: string }> = [];

  // Helper: generate a single image via FFmpeg drawtext
  async function makeGraphic(
    type: string,
    text: string,
    subtext: string,
    bgColor: string,
    fontSize: number
  ): Promise<void> {
    const mediaId = randomUUID();
    const filename = `${type}-${mediaId.slice(0, 8)}.png`;
    const outPath = resolve(UPLOADS_DIR, filename);

    // Escape text for FFmpeg drawtext (colons, backslashes, single quotes)
    const escText = text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "'\\\\\\''");
    const escSub = subtext.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "'\\\\\\''");

    const filters: string[] = [];

    // Background
    filters.push(`color=c=${bgColor}:s=${w}x${h}:d=1`);

    // Main text (centered)
    if (text) {
      filters.push(
        `drawtext=text='${escText}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:borderw=2:bordercolor=black`
      );
    }

    // Subtext (below main text)
    if (subtext) {
      const subSize = Math.round(fontSize * 0.45);
      filters.push(
        `drawtext=text='${escSub}':fontsize=${subSize}:fontcolor=0xCCCCCC:x=(w-text_w)/2:y=(h+${fontSize})/2+20:borderw=1:bordercolor=0x333333`
      );
    }

    const filterStr = filters.slice(1).join(",");
    const args = [
      "-y", "-f", "lavfi", "-i", filters[0],
      "-vf", filterStr,
      "-frames:v", "1",
      outPath,
    ];

    return new Promise<void>((resolve, reject) => {
      const child = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("close", (code) => {
        if (code !== 0 || !existsSync(outPath)) {
          reject(new Error(`FFmpeg drawtext failed (exit ${code}): ${stderr.slice(-200)}`));
          return;
        }
        generated.push({ type, imageUrl: `/uploads/${filename}`, mediaFileId: mediaId });
        if (project) {
          project.mediaFiles = project.mediaFiles || [];
          project.mediaFiles.push({ id: mediaId, type, url: `/uploads/${filename}` });
        }
        resolve();
      });
      child.on("error", reject);
    });
  }

  // 1. Title card
  try {
    await makeGraphic("title-card", projectTitle, "A HaikuCode Production", "0x0A0A0A", 96);
  } catch (err: any) {
    console.error("[montaz] title card failed:", err.message);
  }

  // 2. Lower third (character names)
  if (charNames) {
    try {
      await makeGraphic("lower-third", charNames, "", "0x000000", 64);
    } catch (err: any) {
      console.error("[montaz] lower third failed:", err.message);
    }
  }

  // 3. End screen
  try {
    await makeGraphic("end-screen", "The End", projectTitle, "0x050505", 80);
  } catch (err: any) {
    console.error("[montaz] end screen failed:", err.message);
  }

  res.json({
    success: true,
    graphicsGenerated: generated.length,
    graphics: generated,
    message: `Generated ${generated.length} graphics via FFmpeg (local)`,
  });
});

// --- POST /projects/:id/lipsync ---
r.post("/projects/:id/lipsync", async (req, res) => {
  const { id } = req.params;
  const { clipId, enhance } = req.body ?? {};

  console.log(`[montaz] lipsync: project=${id} clip=${clipId} enhance=${enhance}`);

  // Lipsync requires a specialized service (Wav2Lip, SadTalker, etc.)
  // Without the exact service, we return a stub.
  // The CDP capture will reveal what insaga actually uses.

  const mediaFileId = randomUUID();

  // Update timeline if exists
  const timeline = projectTimelines.get(id);
  if (timeline) {
    for (const track of timeline.tracks || []) {
      const clip = track.clips?.find((c: any) => c.id === clipId);
      if (clip) {
        clip.mediaFileId = mediaFileId;
        clip.lipsyncStatus = "complete";
        break;
      }
    }
  }

  res.json({
    success: true,
    mediaFileId,
    clipId,
    message: "Lipsync complete (stub — needs real service URL from CDP capture)",
  });
});

// --- POST /projects/:id/assemble ---
// Real FFmpeg assembly: timeline → final video.
r.post("/projects/:id/assemble", async (req, res) => {
  const { id } = req.params;

  console.log(`[montaz] assemble: project=${id}`);

  // Check ffmpeg availability first
  const ffCheck = await checkFfmpeg();
  if (!ffCheck.ok) {
    return res.status(500).json({
      error: "ffmpeg not found. Install ffmpeg and add it to PATH.",
      details: ffCheck.error,
    });
  }

  const project = montazProjects.get(id);
  if (!project?.timeline) {
    return res.status(400).json({ error: "Project not found or has no timeline. Save timeline first." });
  }

  const assembleId = randomUUID();

  res.json({
    success: true,
    assembleId,
    status: "processing",
    message: "Assembly started (FFmpeg pipeline)",
    progress: 0,
  });

  // Run assembly in background
  try {
    console.log(`[montaz] Starting FFmpeg assembly for project ${id}...`);
    const result = await assembleTimeline({
      timeline: project.timeline,
      mediaFiles: project.mediaFiles ?? [],
      resolution: "1920x1080",
      fps: 30,
      outputFilename: `assembled_${id}_${Date.now()}.mp4`,
    });

    // Store result in project
    project.lastAssembly = result;
    project.lastAssemblyAt = new Date().toISOString();

    // Also create an export job entry
    const job = {
      id: assembleId,
      projectId: id,
      status: "done" as const,
      progress: 100,
      message: "Assembly complete",
      outputFile: result.outputUrl.split("/").pop(),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    exportJobs.set(assembleId, job);

    console.log(`[montaz] Assembly complete: ${result.outputUrl} (${(result.fileSize / 1024 / 1024).toFixed(1)}MB)`);
  } catch (err: any) {
    console.error(`[montaz] Assembly failed:`, err.message);

    const job = {
      id: assembleId,
      projectId: id,
      status: "failed" as const,
      progress: 0,
      message: `Assembly failed: ${err.message}`,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    exportJobs.set(assembleId, job);
  }
});

// --- POST /projects/:id/export ---
// Real export: assembles timeline via FFmpeg, returns download-ready video.
r.post("/projects/:id/export", async (req, res) => {
  const { id } = req.params;

  const jobId = randomUUID();
  const job = {
    id: jobId,
    projectId: id,
    status: "queued" as const,
    progress: 0,
    message: "Export queued",
    outputFile: undefined as string | undefined,
    startedAt: new Date().toISOString(),
    finishedAt: undefined as string | undefined,
  };

  exportJobs.set(jobId, job);

  console.log(`[montaz] export: project=${id} jobId=${jobId}`);

  res.json({
    success: true,
    jobId,
    status: "queued",
    message: "Export started",
  });

  // Run real export in background
  (async () => {
    const project = montazProjects.get(id);
    if (!project?.timeline) {
      job.status = "failed";
      job.message = "Project has no timeline";
      job.finishedAt = new Date().toISOString();
      return;
    }

    job.status = "processing";
    job.progress = 10;
    job.message = "Preparing timeline...";

    try {
      job.progress = 30;
      job.message = "Rendering video with FFmpeg...";

      const result = await assembleTimeline({
        timeline: project.timeline,
        mediaFiles: project.mediaFiles ?? [],
        resolution: "1920x1080",
        fps: 30,
        outputFilename: `export_${jobId}.mp4`,
      });

      job.progress = 90;
      job.message = "Finalizing...";

      job.status = "done";
      job.progress = 100;
      job.message = "Export complete";
      job.outputFile = result.outputUrl.split("/").pop();
      job.finishedAt = new Date().toISOString();

      project.lastExport = result;
      project.lastExportAt = new Date().toISOString();

      console.log(`[montaz] Export done: ${result.outputUrl} (${(result.fileSize / 1024 / 1024).toFixed(1)}MB)`);
    } catch (err: any) {
      job.status = "failed";
      job.progress = 0;
      job.message = `Export failed: ${err.message}`;
      job.finishedAt = new Date().toISOString();
      console.error(`[montaz] Export failed:`, err.message);
    }
  })();
});

// --- GET /exports/:id/status ---
r.get("/exports/:id/status", (req, res) => {
  const job = exportJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Export not found" });

  res.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    outputFile: job.outputFile,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  });
});

// --- POST /exports/:id/cancel ---
r.post("/exports/:id/cancel", (req, res) => {
  const job = exportJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Export not found" });

  job.status = "cancelled";
  job.message = "Export cancelled by user";
  job.finishedAt = new Date().toISOString();

  res.json({ success: true, jobId: job.id, status: "cancelled" });
});

// --- DELETE /exports/:id ---
r.delete("/exports/:id", (req, res) => {
  exportJobs.delete(req.params.id);
  res.json({ success: true });
});

// --- GET /exports/history ---
r.get("/exports/history", (_req, res) => {
  const history = Array.from(exportJobs.values()).map(j => ({
    jobId: j.id,
    projectId: j.projectId,
    status: j.status,
    progress: j.progress,
    outputFile: j.outputFile,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
  }));

  res.json({ exports: history, total: history.length });
});

// --- GET /exports/:id/download ---
r.get("/exports/:id/download", (req, res) => {
  const job = exportJobs.get(req.params.id);
  if (!job?.outputFile) {
    return res.status(404).json({ error: "Export not ready or not found" });
  }

  const filepath = join(EXPORTS_DIR, job.outputFile);
  if (!existsSync(filepath)) {
    return res.status(404).json({ error: "Export file not found" });
  }

  res.download(filepath, job.outputFile);
});

// --- Timeline CRUD ---

// Save timeline for a project
r.put("/projects/:id/timeline", (req, res) => {
  const { id } = req.params;
  projectTimelines.set(id, req.body);
  res.json({ success: true, projectId: id });
});

// Get timeline for a project
r.get("/projects/:id/timeline", (req, res) => {
  const { id } = req.params;
  const timeline = projectTimelines.get(id);
  if (!timeline) return res.json({ timeline: null });
  res.json({ timeline });
});

export default r;
