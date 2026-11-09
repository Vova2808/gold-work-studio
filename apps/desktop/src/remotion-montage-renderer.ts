import { copyFile, link, mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import {
  UNIVERSAL_COMPOSITION_ID,
  normalizeUniversalTimeline,
  selectProjectDocumentaryPalette,
  type TimelineMedia,
  type TimelineText,
  type UniversalTimeline,
  type UniversalVisualBeat
} from "@gold-work/remotion-video";
import type { Project, Scene, VisualBeat } from "@gold-work/shared";
import { createLocalMontagePlan } from "./montage-planner.js";
import { renderDocumentary } from "./documentary-renderer.js";
import { remotionBinariesDirectory } from "./remotion-binaries.js";
import {
  mediaDurationSeconds,
  runFfmpeg,
  type MontageRenderInput,
  type MontageRenderer,
  type MontageRenderResult,
  type StandardRendererEventSink
} from "./standard-renderer.js";

const FPS = 30 as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function cleanText(value: string, maximum = 220): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maximum);
}

function sentences(value: string): string[] {
  return (value.match(/[^.!?…]+[.!?…]*/g) ?? [value])
    .map((part) => cleanText(part, 220))
    .filter(Boolean);
}

function quoteFrom(value: string): string | undefined {
  const quoted = /[«“"]([^»”"]{4,120})[»”"]/.exec(value)?.[1];
  return quoted ? cleanText(quoted, 120) : undefined;
}

function factValue(value: string): string | undefined {
  const match = value.match(/(?:[$€₽£]\s*)?\b\d[\d\s.,:/-]{0,18}(?:%|\s*(?:лет|года?|дней|час(?:а|ов)?|минут(?:ы)?|seconds?|minutes?|years?))?/iu)?.[0];
  return match ? cleanText(match, 48) : undefined;
}

function compareParts(value: string): [string, string] {
  const parts = value.split(/\s+(?:но|однако|зато|вместо|тогда как|but|however|instead|while|versus|vs\.?)\s+/iu);
  if (parts.length >= 2) return [cleanText(parts[0]!, 70), cleanText(parts.slice(1).join(" "), 70)];
  const chunks = sentences(value);
  return [cleanText(chunks[0] ?? "A", 70), cleanText(chunks[1] ?? chunks[0] ?? "B", 70)];
}

function textForBeat(scene: Scene, beat: VisualBeat): TimelineText | undefined {
  const chunks = sentences(scene.narration);
  const first = chunks[0] ?? cleanText(scene.narration, 180);
  const second = chunks[1];
  const title = cleanText(scene.title || first, 100);
  const quote = quoteFrom(scene.narration);
  const fact = factValue(scene.narration);

  if (beat.template === "chapter-card") {
    return {
      eyebrow: scene.order === 0 ? "Главная тема" : `Глава ${scene.order + 1}`,
      headline: title,
      body: first
    };
  }
  if (beat.template === "quote-card") {
    return { eyebrow: title, headline: quote ?? first, body: quote ? second : undefined, align: "left" };
  }
  if (beat.template === "checklist-grid") {
    return {
      eyebrow: title,
      headline: fact ?? title,
      items: chunks.slice(0, 4).map((item, index) => ({ label: cleanText(item, 64), value: String(index + 1) }))
    };
  }

  if (beat.template === "compare-split") {
    const [left, right] = compareParts(scene.narration);
    return { eyebrow: title, headline: fact ?? title, leftLabel: left, rightLabel: right };
  }
  if (beat.template === "timeline-links") {
    return {
      eyebrow: title,
      headline: fact ?? title,
      items: chunks.slice(0, 5).map((item, index) => ({ label: item, value: String(index + 1) }))
    };
  }
  if (beat.template === "stat-callout") {
    return { eyebrow: title, headline: fact ?? title, body: first };
  }
  if (beat.template === "editorial-panel") {
    return { eyebrow: fact, headline: title, body: first };
  }
  if (beat.template === "fact-card") {
    return { eyebrow: title, headline: fact ?? first, body: fact ? first : second };
  }
  if (beat.template === "evidence-card") {
    return { eyebrow: fact, headline: title, body: first };
  }
  if (beat.template === "focus-text") {
    return { eyebrow: title, headline: quote ?? fact ?? first, body: second, align: "left" };
  }
  if (beat.overlay === "none") return undefined;
  return {
    eyebrow: beat.overlay === "quote" ? title : undefined,
    headline: beat.overlay === "quote" ? quote ?? first : beat.overlay === "fact" ? fact ?? first : title,
    body: beat.overlay === "title" ? first : undefined
  };
}

function motionFor(beat: VisualBeat): NonNullable<UniversalVisualBeat["motion"]> {
  const kind = beat.motion === "push-in"
    ? "zoom-in"
    : beat.motion === "pull-out"
      ? "zoom-out"
      : beat.motion === "pan-left" || beat.motion === "pan-right"
        ? beat.motion
        : "static";
  return { kind, strength: beat.role === "emphasize" ? 0.7 : 0.48 };
}

function transitionFor(beat: VisualBeat): NonNullable<UniversalVisualBeat["transition"]> {
  if (beat.transition === "mix") return { kind: "crossfade", durationSeconds: 0.16 };
  if (beat.transition === "fade") return { kind: "dip-black", durationSeconds: 0.17 };
  return { kind: "cut", durationSeconds: 0 };
}

function dimFor(beat: VisualBeat): number {
  return beat.dimming === "strong" ? 0.58 : beat.dimming === "soft" ? 0.28 : 0;
}

function dimensions(project: Project): Pick<UniversalTimeline, "width" | "height"> {
  if (project.aspectRatio === "9:16") return { width: 720, height: 1280 };
  if (project.aspectRatio === "1:1") return { width: 900, height: 900 };
  return { width: 1280, height: 720 };
}

function allocateFrames(weights: number[], totalFrames: number): number[] {
  if (weights.length === 0) return [];
  const safeTotal = weights.reduce((sum, value) => sum + Math.max(0, value), 0) || weights.length;
  const result: number[] = [];
  let allocated = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const remainingItems = weights.length - index;
    const remainingFrames = totalFrames - allocated;
    const frames = index === weights.length - 1
      ? remainingFrames
      : clamp(Math.round(totalFrames * Math.max(0, weights[index] ?? 1) / safeTotal), 1, remainingFrames - (remainingItems - 1));
    result.push(Math.max(1, frames));
    allocated += Math.max(1, frames);
  }
  return result;
}

function existingAiProposals(scene: Scene): readonly unknown[] | undefined {
  return scene.visualBeats?.map((beat) => ({
    role: beat.role,
    template: beat.template,
    overlay: beat.overlay,
    dimming: beat.dimming,
    motion: beat.motion,
    transition: beat.transition
  }));
}

async function stageFile(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await link(source, target).catch(async () => copyFile(source, target));
}

interface StagedSceneMedia {
  media: TimelineMedia;
  /** Video already starts at the scene timeline and has the scene's exact duration. */
  timelineAligned: boolean;
  durationInFrames?: number;
  stockKind?: "image" | "video";
}

async function normalizeAlternateForRemotion(
  sourcePath: string,
  targetPath: string,
  kind: TimelineMedia["kind"],
  project: Project,
  durationSeconds: number
): Promise<void> {
  const { width, height } = dimensions(project);
  const fit = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;
  if (kind === "image") {
    await runFfmpeg([
      "-y",
      "-i", sourcePath,
      "-map", "0:v:0",
      "-vf", fit,
      "-frames:v", "1",
      "-update", "1",
      "-compression_level", "3",
      targetPath
    ]);
    return;
  }
  // Optional stock must not be allowed to crash the whole Remotion pass. Decode
  // it once into a known H.264 timeline clip; short sources loop, long sources
  // start at zero so preview and final keep the same semantic moment.
  await runFfmpeg([
    "-y",
    "-stream_loop", "-1",
    "-i", sourcePath,
    "-t", String(Math.max(0.1, durationSeconds)),
    "-map", "0:v:0",
    "-an",
    "-vf", `${fit},fps=${FPS}`,
    "-r", String(FPS),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    targetPath
  ]);
}

function materializeBeatMedia(
  source: StagedSceneMedia,
  sceneIndex: number,
  beatIndex: number,
  localFromFrame: number,
  durationInFrames: number
): TimelineMedia {
  if (source.media.kind === "image") {
    return { ...source.media, id: `${source.media.id}-beat-${beatIndex + 1}` };
  }
  if (source.timelineAligned) {
    return {
      ...source.media,
      id: `${source.media.id}-beat-${beatIndex + 1}`,
      startFromFrame: localFromFrame,
      endAtFrame: localFromFrame + durationInFrames
    };
  }
  const maximumStart = Math.max(0, (source.durationInFrames ?? durationInFrames) - durationInFrames);
  // A stable offset avoids restarting every alternate at frame zero while
  // keeping preview/final deterministic and inside the downloaded clip.
  const startFromFrame = maximumStart > 0
    ? (sceneIndex * 97 + beatIndex * 53) % (maximumStart + 1)
    : 0;
  return {
    ...source.media,
    id: `${source.media.id}-beat-${beatIndex + 1}`,
    startFromFrame,
    endAtFrame: startFromFrame + durationInFrames
  };
}

function browserExecutable(): string | undefined {
  const candidates = [
    process.env.GW_CHROME_PATH,
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe") : undefined,
    process.env["PROGRAMFILES(X86)"] ? join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : undefined
  ].filter((value): value is string => Boolean(value));
  return candidates.find(existsSync);
}

function remotionEntryPath(): string {
  const reference = typeof __filename === "string" ? __filename : import.meta.url;
  const resolved = createRequire(reference).resolve("@gold-work/remotion-video/entry");
  const unpacked = resolved.replace("app.asar", "app.asar.unpacked");
  return existsSync(unpacked) ? unpacked : resolved;
}

function safeRenderDirectory(projectDirectory: string, renderDirectory: string): boolean {
  return dirname(renderDirectory) === projectDirectory && basename(renderDirectory).startsWith("remotion-render-");
}

function formatEta(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "считаю оставшееся время";
  const seconds = Math.max(1, Math.ceil(milliseconds / 1_000));
  if (seconds < 60) return `осталось примерно ${seconds} с`;
  const minutes = Math.ceil(seconds / 60);
  return `осталось примерно ${minutes} мин`;
}

export interface RemotionMontageRendererOptions {
  eventSink?: StandardRendererEventSink;
  prepareDocumentary?: (projectId:string,signal?:AbortSignal)=>Promise<MontageRenderInput['project']>;
}

/** Реальный Remotion render + финальный mux проверенной FFmpeg-аудиодорожки. */
export class RemotionMontageRenderer implements MontageRenderer {
  private readonly eventSink: StandardRendererEventSink;

  constructor(private readonly projectDirectory: (projectId: string) => string, private readonly options: RemotionMontageRendererOptions = {}) {
    this.eventSink = options.eventSink ?? (() => undefined);
  }

  async render(input: MontageRenderInput): Promise<MontageRenderResult> {
    if (input.project.mediaMode === "stock" && input.project.settings.assembly.documentary?.version === 2) {
      if(this.options.prepareDocumentary){
        const project=await this.options.prepareDocumentary(input.project.id,input.signal);
        input={...input,project};
      }
      return renderDocumentary(input, { projectDirectory: this.projectDirectory(input.project.id), entryPoint: remotionEntryPath(), browserExecutable: browserExecutable() });
    }
    if (input.project.settings.assembly.montage?.enabled === false) {
      await copyFile(input.audioMasterPath, input.outputPath);
      return { outputPath: input.outputPath, visualBeatCount: 0, templates: [] };
    }
    const projectDirectory = this.projectDirectory(input.project.id);
    await mkdir(projectDirectory, { recursive: true });
    const renderDirectory = await mkdtemp(join(projectDirectory, "remotion-render-"));
    const publicDirectory = join(renderDirectory, "public");
    const mediaDirectory = join(publicDirectory, "media");
    const bundleDirectory = join(renderDirectory, "bundle");
    const visualPath = join(renderDirectory, "visual.mp4");
    await mkdir(mediaDirectory, { recursive: true });

    try {
      const stagedMedia: StagedSceneMedia[][] = [];
      for (let index = 0; index < input.clips.length; index += 1) {
        const relative = `media/scene-${String(index + 1).padStart(3, "0")}.mp4`;
        await stageFile(input.clips[index]!.path, join(publicDirectory, ...relative.split("/")));
        const sceneMedia: StagedSceneMedia[] = [{
          media: { id: `scene-${index + 1}-primary`, src: relative, kind: "video", muted: true },
          timelineAligned: true,
          durationInFrames: Math.max(1, Math.round(input.clips[index]!.durationSeconds * FPS)),
          stockKind: input.clips[index]!.scene.stockSource?.mediaType
        }];
        const alternates = input.clips[index]!.scene.stockAlternates ?? [];
        for (let alternateIndex = 0; alternateIndex < alternates.length; alternateIndex += 1) {
          const alternate = alternates[alternateIndex]!;
          const videoPath = alternate.videoPath && existsSync(alternate.videoPath) ? alternate.videoPath : undefined;
          const imagePath = alternate.imagePath && existsSync(alternate.imagePath) ? alternate.imagePath : undefined;
          const sourcePath = videoPath ?? imagePath;
          if (!sourcePath) continue;
          const kind: TimelineMedia["kind"] = videoPath ? "video" : "image";
          const extension = kind === "video" ? ".mp4" : ".png";
          const alternateRelative = `media/scene-${String(index + 1).padStart(3, "0")}-alt-${String(alternateIndex + 1).padStart(2, "0")}${extension}`;
          const alternateTarget = join(publicDirectory, ...alternateRelative.split("/"));
          try {
            await normalizeAlternateForRemotion(
              sourcePath,
              alternateTarget,
              kind,
              input.project,
              input.clips[index]!.durationSeconds
            );
          } catch (error) {
            this.eventSink("warn", "render.remotion.alternate_skipped", {
              projectId: input.project.id,
              sceneId: input.clips[index]!.scene.id,
              sourcePath,
              error: error instanceof Error ? error.message : String(error)
            });
            continue;
          }
          sceneMedia.push({
            media: {
              id: `scene-${index + 1}-alternate-${alternateIndex + 1}`,
              src: alternateRelative,
              kind,
              muted: true,
              attribution: alternate.stockSource.attribution
            },
            timelineAligned: kind === "video",
            durationInFrames: kind === "video"
              ? Math.max(1, Math.round(input.clips[index]!.durationSeconds * FPS))
              : undefined,
            stockKind: kind
          });
        }
        stagedMedia.push(sceneMedia);
      }

      const exactScenes = input.clips.map(({ scene, durationSeconds }) => ({
        ...scene,
        durationOverrideSeconds: durationSeconds
      }));
      const montage = input.project.settings.assembly.montage;
      const aiProposals = montage?.planner === "local"
        ? undefined
        : Object.fromEntries(exactScenes.flatMap((scene) => {
            const proposals = existingAiProposals(scene);
            return proposals ? [[scene.id, proposals] as const] : [];
          }));
      const plan = createLocalMontagePlan(exactScenes, {
        density: montage?.density,
        graphicBeatPercent: montage?.graphicBeatPercent,
        hardCutPercent: montage?.hardCutPercent,
        aiProposals
      });
      const palette = selectProjectDocumentaryPalette(input.project.id, input.project.title);

      const audioSeconds = await mediaDurationSeconds(input.audioMasterPath);
      const totalFrames = Math.max(1, Math.round((audioSeconds || input.clips.reduce((sum, clip) => sum + clip.durationSeconds, 0)) * FPS));
      const sceneFrames = allocateFrames(input.clips.map((clip) => clip.durationSeconds), totalFrames);
      const universalBeats: UniversalVisualBeat[] = [];
      let sceneFromFrame = 0;
      for (let sceneIndex = 0; sceneIndex < exactScenes.length; sceneIndex += 1) {
        const scene = exactScenes[sceneIndex]!;
        const sources = stagedMedia[sceneIndex]!;
        const sceneBeatPlan = plan.beatsByScene[scene.id] ?? [];
        const frames = allocateFrames(sceneBeatPlan.map((beat) => beat.durationSeconds), sceneFrames[sceneIndex]!);
        let localFromFrame = 0;
        for (let beatIndex = 0; beatIndex < sceneBeatPlan.length; beatIndex += 1) {
          const beat = sceneBeatPlan[beatIndex]!;
          const durationInFrames = frames[beatIndex]!;
          const usableSources = sources.filter((source) =>
            source.timelineAligned || source.media.kind === "image" || (source.durationInFrames ?? 0) >= durationInFrames
          );
          const selectedIndex = beatIndex % Math.max(1, usableSources.length);
          const selectedSource = usableSources[selectedIndex] ?? sources[0]!;
          const currentMedia = materializeBeatMedia(selectedSource, sceneIndex, beatIndex, localFromFrame, durationInFrames);
          const media = beat.template === "compare-split" || beat.template === "quick-montage"
            ? [
                currentMedia,
                ...usableSources
                  .filter((source) => source !== selectedSource)
                  .slice(0, beat.template === "quick-montage" ? 2 : 1)
                  .map((source) => materializeBeatMedia(source, sceneIndex, beatIndex, localFromFrame, durationInFrames))
              ]
            : [currentMedia];
          universalBeats.push({
            id: beat.id,
            sceneId: beat.sceneId,
            fromFrame: sceneFromFrame + localFromFrame,
            durationInFrames,
            template: beat.template,
            media,
            text: textForBeat(scene, beat),
            motion: motionFor(beat),
            transition: transitionFor(beat),
            dim: dimFor(beat),
            accentColor: palette.accentColor
          });
          localFromFrame += durationInFrames;
        }
        sceneFromFrame += sceneFrames[sceneIndex]!;
      }

      const timeline = normalizeUniversalTimeline({
        version: 1,
        fps: FPS,
        ...dimensions(input.project),
        durationInFrames: totalFrames,
        beats: universalBeats,
        backgroundColor: palette.backgroundColor,
        foregroundColor: palette.foregroundColor,
        accentColor: palette.accentColor,
        surfaceColor: palette.surfaceColor,
        surfaceForegroundColor: palette.surfaceForegroundColor,
        mutedColor: palette.mutedColor,
        fontFamily: "system"
      });
      this.eventSink("info", "render.remotion.plan", {
        projectId: input.project.id,
        scenes: input.clips.length,
        mediaSources: stagedMedia.reduce((sum, sceneMedia) => sum + sceneMedia.length, 0),
        beats: timeline.beats.length,
        graphics: plan.stats.graphicBeatCount,
        hardCuts: plan.stats.hardCutCount,
        issues: plan.issues.length
      });

      const serveUrl = await bundle({
        entryPoint: remotionEntryPath(),
        publicDir: publicDirectory,
        outDir: bundleDirectory,
        enableCaching: true,
        onProgress: (() => {
          let lastReportedPercent = -1;
          let lastLoggedPercent = -10;
          return (progress: number) => {
            // Bundler v4 reports 0..100, while older signatures/examples used 0..1.
            const normalized = progress > 1 ? progress / 100 : progress;
            const percent = Math.round(normalized * 100);
            if (percent !== lastReportedPercent) {
              lastReportedPercent = percent;
              input.onProgress?.(`Remotion: подготавливаю шаблоны · ${percent}%`, 42 + Math.round(normalized * 8));
            }
            if (percent < lastLoggedPercent + 10 && percent !== 100) return;
            lastLoggedPercent = percent;
            this.eventSink("info", "render.remotion.bundle_progress", { projectId: input.project.id, progress: percent });
          };
        })()
      });
      const executable = browserExecutable();
      const browserOptions = executable ? { browserExecutable: executable, chromeMode: "chrome-for-testing" as const } : {};
      const binariesDirectory = remotionBinariesDirectory();
      const composition = await selectComposition({
        serveUrl,
        binariesDirectory,
        id: UNIVERSAL_COMPOSITION_ID,
        inputProps: timeline,
        logLevel: "warn",
        ...browserOptions
      });
      await renderMedia({
        serveUrl,
        binariesDirectory,
        composition,
        inputProps: timeline,
        codec: "h264",
        pixelFormat: "yuv420p",
        crf: input.project.settings.assembly.quality === "high" ? 18 : input.project.settings.assembly.quality === "preview" ? 28 : 22,
        outputLocation: visualPath,
        overwrite: true,
        muted: true,
        concurrency: 2,
        logLevel: "warn",
        ...browserOptions,
        onProgress: (() => {
          let lastReportedPercent = -1;
          let lastLoggedPercent = -5;
          return ({ progress, renderEstimatedTime }: { progress: number; renderEstimatedTime: number }) => {
            const percent = Math.round(progress * 100);
            if (percent !== lastReportedPercent) {
              lastReportedPercent = percent;
              input.onProgress?.(
                `Remotion: монтаж ${percent}% · ${formatEta(renderEstimatedTime)}`,
                50 + Math.round(progress * 47)
              );
            }
            if (percent < lastLoggedPercent + 5 && percent !== 100) return;
            lastLoggedPercent = percent;
            this.eventSink("info", "render.remotion.render_progress", {
              projectId: input.project.id,
              progress: percent,
              estimatedMilliseconds: Math.max(0, Math.round(renderEstimatedTime)),
              beats: timeline.beats.length
            });
          };
        })()
      });
      input.onProgress?.("FFmpeg: добавляю непрерывную озвучку в Remotion-видео", 98);
      await runFfmpeg([
        "-y",
        "-i", visualPath,
        "-i", input.audioMasterPath,
        "-map", "0:v:0",
        "-map", "1:a:0?",
        "-c:v", "copy",
        "-c:a", "copy",
        "-shortest",
        "-movflags", "+faststart",
        input.outputPath
      ]);
      const hasSavedBeats = exactScenes.some((scene) => (scene.visualBeats?.length ?? 0) > 0);
      return {
        outputPath: input.outputPath,
        requestedPlanner: montage?.planner,
        plannerUsed: input.project.montagePlan?.usedPlanner
          ?? (montage?.planner === "local" ? "local" : hasSavedBeats ? "local-fallback" : "local-fallback"),
        visualBeatCount: plan.beats.length,
        templates: [...new Set(plan.beats.map((beat) => beat.template))],
        stockVideoCount: stagedMedia.flat().filter((source) => source.stockKind === "video").length,
        stockImageCount: stagedMedia.flat().filter((source) => source.stockKind === "image").length
      };
    } finally {
      if (safeRenderDirectory(projectDirectory, renderDirectory)) {
        await rm(renderDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
}
