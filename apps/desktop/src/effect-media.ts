import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { EffectAsset } from "@gold-work/shared";

/** Bounded output, no shell and no ffprobe dependency in portable builds. */
export function effectFfmpeg(args: string[], signal?: AbortSignal, inspect = false, outputLimit = 16000): Promise<string> {
  const executable = ffmpegPath?.replace("app.asar", "app.asar.unpacked");
  if (!executable) throw new Error("FFmpeg не найден");
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-hide_banner", "-nostdin", "-threads", "2", "-filter_threads", "2", ...args], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let output = "";
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 20 * 60_000);
    const abort = () => child.kill();
    signal?.addEventListener("abort", abort, { once: true });
    const clean = () => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); };
    child.stderr.on("data", (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-outputLimit); });
    child.once("error", error => { clean(); reject(error); });
    child.once("close", code => {
      clean();
      if (signal?.aborted) reject(new Error("Импорт отменён"));
      else if (timedOut) reject(new Error("Превышено время проверки медиа"));
      else if (code === 0 || (inspect && /Stream #.*(?:Video|Audio):/.test(output))) resolve(output);
      else reject(new Error(`FFmpeg: ${output.slice(-1400)}`));
    });
  });
}

export async function probeEffectMedia(source: string, signal?: AbortSignal): Promise<NonNullable<EffectAsset["metadata"]>> {
  const info = await effectFfmpeg(["-i", source], signal, true);
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(info);
  const video = info.split(/\r?\n/).find(line => /Stream #.*Video:/.test(line)) ?? "";
  const audio = info.split(/\r?\n/).find(line => /Stream #.*Audio:/.test(line)) ?? "";
  const size = /\b(\d{2,5})x(\d{2,5})\b/.exec(video);
  return {
    durationSeconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : 0,
    hasAudio: Boolean(audio), hasAlpha: /\b(?:yuva\w*|rgba|bgra|argb|abgr|gbrap\w*)\b/.test(video),
    ...(size ? { width: Number(size[1]), height: Number(size[2]) } : {}),
    ...(video ? { videoCodec: /Video:\s*([^ ,]+)/.exec(video)?.[1], fps: Number(/([\d.]+) fps/.exec(video)?.[1]) || undefined } : {}),
    ...(audio ? { audioCodec: /Audio:\s*([^ ,]+)/.exec(audio)?.[1] } : {})
  };
}

export async function measureEffectAccent(source:string, signal?:AbortSignal):Promise<number> {
  const output=await effectFfmpeg(['-i',source,'-t','12','-vn','-af','aresample=48000,asetnsamples=n=2400:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level','-f','null','-'],signal,false,100000);
  const windows=[...output.matchAll(/pts_time:([\d.]+)[\s\S]*?lavfi\.astats\.Overall\.RMS_level=([-\d.]+)/g)].map(m=>({at:Number(m[1]),db:Number(m[2])})).filter(w=>Number.isFinite(w.db));
  const maximum=Math.max(...windows.map(w=>w.db));
  return windows.find(w=>w.db>=maximum-1)?.at??0;
}

export async function prepareEffectMedia(root: string, asset: EffectAsset, signal?: AbortSignal): Promise<Partial<EffectAsset>> {
  const source = join(root, asset.file);
  const metadata = await probeEffectMedia(source, signal);
  if (asset.kind !== "image" && metadata.durationSeconds <= 0) throw new Error("Не удалось определить длительность медиа");
  await mkdir(join(root, "Previews"), { recursive: true });
  await mkdir(join(root, "Proxies"), { recursive: true });
  // Full decoding detects a broken tail; an imported asset is not ready on a header alone.
  const decoded = await effectFfmpeg(["-v", "info", "-xerror", "-i", source,
    "-map", "0:v:0?", "-map", "0:a:0?", ...(metadata.hasAudio ? ["-af", "volumedetect"] : []), "-f", "null", "-"], signal);
  if (metadata.hasAudio) {
    metadata.peakDb = Number(/max_volume:\s*(-?[\d.]+) dB/.exec(decoded)?.[1]);
    metadata.meanDb = Number(/mean_volume:\s*(-?[\d.]+) dB/.exec(decoded)?.[1]);
    if (!Number.isFinite(metadata.peakDb)) delete metadata.peakDb;
    if (!Number.isFinite(metadata.meanDb)) delete metadata.meanDb;
  }
  const result: Partial<EffectAsset> = { metadata, state: "ready", error: undefined };
  if (asset.kind === "audio") {
    if(metadata.durationSeconds<=12)metadata.accentSeconds=await measureEffectAccent(source,signal);
    result.waveform = `Previews/${asset.id}-wave.png`;
    result.proxy = `Proxies/${asset.id}.mp3`;
    result.preview = result.proxy;
    await effectFfmpeg(["-y", "-i", source, "-filter_complex", "aformat=channel_layouts=mono,showwavespic=s=640x100:colors=0x81b5c9", "-frames:v", "1", join(root, result.waveform)], signal);
    await effectFfmpeg(["-y", "-i", source, "-vn", "-ac", "2", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "160k", join(root, result.proxy)], signal);
  } else {
    result.poster = `Previews/${asset.id}.jpg`;
    const seek = asset.kind === "video" ? ["-ss", String(Math.min(2, metadata.durationSeconds * 0.35))] : [];
    await effectFfmpeg(["-y", ...seek, "-i", source, "-frames:v", "1", "-vf", "scale=640:640:force_original_aspect_ratio=decrease", join(root, result.poster)], signal);
    if (asset.kind === "image" && !/\.(?:png|jpe?g|webp)$/i.test(asset.file)) {
      result.proxy = `Proxies/${asset.id}.png`;
      result.preview = result.proxy;
      await effectFfmpeg(["-y", "-i", source, "-frames:v", "1", join(root, result.proxy)], signal);
    }
    if (asset.kind === "video") {
      result.proxy = `Proxies/${asset.id}.mp4`;
      result.preview = result.proxy;
      await effectFfmpeg(["-y", "-i", source, ...(metadata.hasAudio ? ["-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000"] : ["-an"]), "-vf", "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(root, result.proxy)], signal);
    }
  }
  return result;
}
