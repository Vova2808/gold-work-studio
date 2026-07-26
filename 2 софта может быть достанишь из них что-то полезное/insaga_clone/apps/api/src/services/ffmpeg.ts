// FFmpeg assembly service — timeline → final video.
//
// Takes a montaz timeline (tracks, clips, transitions) and produces
// a single mp4 by concatenating video clips, mixing audio, and
// burning subtitles.
//
// Requirements: ffmpeg must be installed and on PATH.

import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";

const UPLOADS = resolve(process.cwd(), "uploads");
const EXPORTS = resolve(process.cwd(), "uploads/exports");
mkdirSync(EXPORTS, { recursive: true });

// ─── Types ───────────────────────────────────────────────────────────

export interface TimelineClip {
  id: string;
  trackId: string;
  mediaFileId: string;
  position: number;
  duration: number;
  trimStart?: number;
  trimEnd?: number;
  sourceDuration?: number;
  status?: string;
  motion?: string;
  label?: string;
  text?: string;
}

export interface TimelineTrack {
  id: string;
  type: "video" | "audio" | "text" | "overlay" | "music";
  label: string;
  clips: TimelineClip[];
  volume?: number;
  muted?: boolean;
  locked?: boolean;
  visible?: boolean;
  height?: number;
  blendMode?: string;
  opacity?: number;
}

export interface Transition {
  id: string;
  fromClipId: string;
  toClipId: string;
  type: string;
  duration: number;
}

export interface AssembleInput {
  timeline: {
    tracks: TimelineTrack[];
    transitions: Transition[];
    duration?: number;
  };
  mediaFiles?: Array<{ id: string; url?: string; audioUrl?: string; videoUrl?: string; [k: string]: any }>;
  resolution?: string;
  fps?: number;
  outputFilename?: string;
}

export interface AssembleResult {
  outputPath: string;
  outputUrl: string;
  duration: number;
  fileSize: number;
  command: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Check if ffmpeg is available. */
export async function checkFfmpeg(): Promise<{ ok: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-version"], { timeout: 5000 });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("close", () => {
      const first = out.split("\n")[0] ?? "unknown";
      resolve({ ok: true, version: first });
    });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
  });
}

/** Convert Windows backslash path to forward-slash (FFmpeg-safe). */
function ffPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Resolve a mediaFileId to an absolute file path.
 */
function resolveMediaFile(
  mediaFileId: string,
  projectMediaFiles: AssembleInput["mediaFiles"] = []
): string | null {
  if (!mediaFileId) return null;

  // 1. Direct URL path
  if (mediaFileId.startsWith("/uploads/") || mediaFileId.startsWith("uploads/")) {
    const abs = resolve(process.cwd(), mediaFileId.replace(/^\//, ""));
    if (existsSync(abs)) return abs;
  }

  // 2. Project mediaFiles lookup
  const mf = projectMediaFiles.find((m) => m.id === mediaFileId);
  if (mf) {
    const url = mf.videoUrl || mf.audioUrl || mf.url || "";
    if (url) {
      const abs = resolve(process.cwd(), url.replace(/^\//, ""));
      if (existsSync(abs)) return abs;
    }
  }

  // 3. Fuzzy search in uploads/ (recursively, filename contains the id)
  try {
    const searchDir = (dir: string, depth: number = 0): string | null => {
      if (!existsSync(dir) || depth > 3) return null;
      for (const f of readdirSync(dir)) {
        const full = join(dir, f);
        if (statSync(full).isDirectory()) {
          const found = searchDir(full, depth + 1);
          if (found) return found;
        } else if (f.includes(mediaFileId)) {
          return full;
        }
      }
      return null;
    };
    const found = searchDir(UPLOADS);
    if (found) return found;
  } catch {}

  // 4. Bare filename in uploads/
  const bare = resolve(UPLOADS, mediaFileId);
  if (existsSync(bare)) return bare;

  return null;
}

/** Map transition type names to FFmpeg xfade names. */
function xfadeType(type: string): string {
  const map: Record<string, string> = {
    fade: "fade",
    slidedown: "slideup",
    slideup: "slideup",
    slideleft: "slideleft",
    slideright: "slideright",
    smoothleft: "smoothleft",
    smoothright: "smoothright",
    circleopen: "circleopen",
    circleclose: "circleclose",
    dissolve: "dissolve",
    pixelize: "pixelize",
    wipeleft: "wipeleft",
    wiperight: "wiperight",
  };
  return map[type.toLowerCase()] ?? "fade";
}

/** Generate SRT subtitle file from text clips. */
function generateSrt(clips: TimelineClip[]): { path: string; count: number } {
  const srtLines: string[] = [];
  let idx = 1;

  for (const clip of clips) {
    if (!clip.text) continue;
    const start = clip.position;
    const end = clip.position + clip.duration;
    srtLines.push(String(idx));
    srtLines.push(`${formatSrtTime(start)} --> ${formatSrtTime(end)}`);
    srtLines.push(clip.text);
    srtLines.push("");
    idx++;
  }

  if (srtLines.length === 0) return { path: "", count: 0 };

  const srtPath = resolve(EXPORTS, `subs_${randomUUID().slice(0, 8)}.srt`);
  writeFileSync(srtPath, srtLines.join("\n"), "utf-8");
  return { path: srtPath, count: idx - 1 };
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// ─── Core assembly ───────────────────────────────────────────────────

export async function assembleTimeline(input: AssembleInput): Promise<AssembleResult> {
  const { timeline, mediaFiles = [] } = input;
  const resolution = input.resolution ?? "1920x1080";
  const fps = input.fps ?? 30;
  const [w, h] = resolution.split("x").map(Number);

  // Check ffmpeg
  const ff = await checkFfmpeg();
  if (!ff.ok) throw new Error("ffmpeg not found on PATH. Install ffmpeg and try again.");

  // Separate tracks by type
  const videoTracks = timeline.tracks.filter((t) => t.type === "video" && !t.muted);
  const audioTracks = timeline.tracks.filter(
    (t) => (t.type === "audio" || t.type === "music") && !t.muted
  );
  const textTracks = timeline.tracks.filter((t) => t.type === "text");
  const transitions = timeline.transitions ?? [];

  // Collect video clips sorted by position
  const videoClips: TimelineClip[] = [];
  for (const track of videoTracks) {
    for (const clip of track.clips) {
      videoClips.push(clip);
    }
  }
  videoClips.sort((a, b) => a.position - b.position);

  if (videoClips.length === 0) {
    throw new Error("No video clips in timeline — nothing to assemble.");
  }

  // Resolve video file paths
  const resolvedClips: Array<{ clip: TimelineClip; path: string }> = [];
  for (const clip of videoClips) {
    const path = resolveMediaFile(clip.mediaFileId, mediaFiles);
    if (path) {
      resolvedClips.push({ clip, path });
    } else {
      console.warn(`[ffmpeg] Cannot resolve mediaFileId "${clip.mediaFileId}" for clip ${clip.id}, skipping.`);
    }
  }

  if (resolvedClips.length === 0) {
    throw new Error("No video files could be resolved from timeline clips.");
  }

  // Collect audio clips
  const audioClips: Array<{ clip: TimelineClip; path: string; volume: number }> = [];
  for (const track of audioTracks) {
    const vol = track.volume ?? 0.85;
    for (const clip of track.clips) {
      const path = resolveMediaFile(clip.mediaFileId, mediaFiles);
      if (path) {
        audioClips.push({ clip, path, volume: vol });
      }
    }
  }

  // Collect subtitle clips
  const subtitleClips: TimelineClip[] = [];
  for (const track of textTracks) {
    for (const clip of track.clips) {
      if (clip.text) subtitleClips.push(clip);
    }
  }

  // Generate SRT if we have subtitles
  const srt = generateSrt(subtitleClips);
  const tempFiles: string[] = [];
  if (srt.path) tempFiles.push(srt.path);

  // ─── Build FFmpeg args ──────────────────────────────────────────

  const outputFilename = input.outputFilename ?? `export_${randomUUID().slice(0, 8)}.mp4`;
  const outputPath = resolve(EXPORTS, outputFilename);

  // Build args array (no shell escaping needed — spawn passes directly)
  const args: string[] = ["-y"];

  // Input files
  for (const rc of resolvedClips) {
    args.push("-i", ffPath(rc.path));
  }
  for (const ac of audioClips) {
    args.push("-i", ffPath(ac.path));
  }

  const videoInputCount = resolvedClips.length;
  let totalInputs = videoInputCount + audioClips.length;

  // If no audio clips, add a silent audio input NOW (before any output options)
  const needsSilentAudio = audioClips.length === 0;
  if (needsSilentAudio) {
    args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
    totalInputs++; // the silent input is now at index totalInputs
  }

  // Build filter_complex lines
  const filters: string[] = [];

  // Transition map
  const transMap = new Map<string, Transition>();
  for (const t of transitions) {
    transMap.set(t.fromClipId, t);
  }

  // Scale + trim each video input
  for (let i = 0; i < resolvedClips.length; i++) {
    const { clip } = resolvedClips[i];
    const trimStart = clip.trimStart ?? 0;
    const trimEnd = clip.trimEnd;
    const trimExpr = trimEnd
      ? `trim=start=${trimStart}:end=${trimEnd}`
      : `trim=start=${trimStart}`;
    filters.push(
      `[${i}:v]${trimExpr},setpts=PTS-STARTPTS,` +
        `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`
    );
  }

  // Concatenation or xfade
  let videoOutputLabel: string;

  if (transitions.length === 0 || resolvedClips.length === 1) {
    const labels = resolvedClips.map((_, i) => `[v${i}]`).join("");
    const outLabel = "vconcat";
    filters.push(`${labels}concat=n=${resolvedClips.length}:v=1:a=0[${outLabel}]`);
    videoOutputLabel = outLabel;
  } else {
    let cumulativeOffset = 0;
    let prevLabel = "v0";

    for (let i = 1; i < resolvedClips.length; i++) {
      const prevClip = resolvedClips[i - 1].clip;
      const prevDuration = prevClip.duration - (prevClip.trimStart ?? 0);
      const trans = transMap.get(prevClip.id);
      const transDuration = trans?.duration ?? 0.5;
      const transType = trans ? xfadeType(trans.type) : "fade";

      cumulativeOffset += prevDuration - transDuration;

      const nextLabel = `v${i}`;
      const outLabel = i === resolvedClips.length - 1 ? "vxfade" : `xf${i}`;

      filters.push(
        `[${prevLabel}][${nextLabel}]xfade=transition=${transType}:duration=${transDuration}:offset=${cumulativeOffset.toFixed(3)}[${outLabel}]`
      );
      prevLabel = outLabel;
    }
    videoOutputLabel = "vxfade";
  }

  // Audio processing
  let audioOutputLabel = "";

  if (audioClips.length > 0) {
    const audioLabels: string[] = [];

    for (let i = 0; i < audioClips.length; i++) {
      const { clip, volume } = audioClips[i];
      const inputIdx = videoInputCount + i;
      const trimStart = clip.trimStart ?? 0;
      const label = `a${i}`;
      const delayMs = Math.round(clip.position * 1000);
      filters.push(
        `[${inputIdx}:a]atrim=start=${trimStart},asetpts=PTS-STARTPTS,` +
          `volume=${volume},adelay=${delayMs}|${delayMs}[${label}]`
      );
      audioLabels.push(`[${label}]`);
    }

    if (audioLabels.length === 1) {
      audioOutputLabel = audioLabels[0].slice(1, -1); // strip [ ]
    } else {
      const outLabel = "amixed";
      filters.push(
        `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=2[${outLabel}]`
      );
      audioOutputLabel = outLabel;
    }
  }

  // Subtitles — append subtitle filter
  let subtitleOutputLabel = "";
  if (srt.path) {
    const srtFwd = ffPath(srt.path).replace(/:/g, "\\:");
    filters.push(
      `[${videoOutputLabel}]subtitles='${srtFwd}':force_style='FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,MarginV=30'[vsub]`
    );
    subtitleOutputLabel = "vsub";
  }

  const filterComplex = filters.join(";\n");

  // Write filter_complex to temp file (avoids all shell escaping issues on Windows)
  const filterPath = resolve(EXPORTS, `filter_${randomUUID().slice(0, 8)}.txt`);
  writeFileSync(filterPath, filterComplex, "utf-8");
  tempFiles.push(filterPath);

  args.push("-filter_complex_script", ffPath(filterPath));

  // Map video output
  const finalVideoLabel = subtitleOutputLabel || videoOutputLabel;
  args.push("-map", `[${finalVideoLabel}]`);

  // Map audio
  if (audioOutputLabel) {
    args.push("-map", `[${audioOutputLabel}]`);
  } else if (needsSilentAudio) {
    // Silent audio input was already added above
    args.push("-map", `${totalInputs - 1}:a`);
    args.push("-shortest");
  }

  // Encoding
  args.push("-c:v", "libx264", "-preset", "medium", "-crf", "23");
  args.push("-c:a", "aac", "-b:a", "192k");
  args.push("-r", String(fps));
  args.push("-movflags", "+faststart");
  args.push(ffPath(outputPath));

  const cmdStr = `ffmpeg ${args.join(" ")}`;

  // Run
  return runAssembly(args, outputPath, outputFilename, tempFiles, cmdStr);
}

// ─── Spawn runner ────────────────────────────────────────────────────

async function runAssembly(
  args: string[],
  outputPath: string,
  outputFilename: string,
  tempFiles: string[],
  cmdStr: string
): Promise<AssembleResult> {
  console.log(`[ffmpeg] Starting assembly...`);
  console.log(`[ffmpeg] Args: ${args.slice(0, 10).join(" ")}...`);

  return new Promise<AssembleResult>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });

    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      // Log progress lines (FFmpeg prints to stderr)
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        if (line.includes("frame=") || line.includes("time=") || line.includes("error")) {
          console.log(`[ffmpeg] ${line.trim()}`);
        }
      }
    });

    child.on("close", (code) => {
      // Cleanup temp files
      for (const f of tempFiles) {
        try { if (existsSync(f)) unlinkSync(f); } catch {}
      }

      if (code !== 0) {
        const lastLines = stderr.split("\n").filter(Boolean).slice(-5).join("\n");
        console.error(`[ffmpeg] Failed (exit ${code}):`, lastLines);
        reject(new Error(`FFmpeg exited with code ${code}: ${lastLines}`));
        return;
      }

      if (!existsSync(outputPath)) {
        reject(new Error("FFmpeg finished but output file was not created."));
        return;
      }

      const stat = statSync(outputPath);
      console.log(`[ffmpeg] Done: ${outputPath} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);

      resolve({
        outputPath,
        outputUrl: `/uploads/exports/${outputFilename}`,
        duration: 0,
        fileSize: stat.size,
        command: cmdStr,
      });
    });

    child.on("error", (err) => {
      for (const f of tempFiles) {
        try { if (existsSync(f)) unlinkSync(f); } catch {}
      }
      reject(new Error(`FFmpeg spawn failed: ${err.message}`));
    });
  });
}

// ─── Convenience: assemble from project state ───────────────────────

export async function assembleProject(
  projectId: string,
  projectStore: Map<string, any>
): Promise<AssembleResult> {
  const project = projectStore.get(projectId);
  if (!project) throw new Error(`Project ${projectId} not found.`);

  const timeline = project.timeline;
  if (!timeline?.tracks?.length) throw new Error("Project has no timeline data.");

  return assembleTimeline({
    timeline,
    mediaFiles: project.mediaFiles ?? [],
    resolution: "1920x1080",
    fps: 30,
  });
}
