import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Project, Scene, DocumentaryCandidate } from "@gold-work/shared";
import { atomicWrite } from "./fs-utils.js";
import { checksumFile } from "./effect-library.js";
import { effectFfmpeg, probeEffectMedia } from "./effect-media.js";
import { copyImmutableDocumentaryFile, ensureDocumentarySpace } from "./documentary-storage.js";
import { documentaryContextApproval, documentaryIllustrationApproval, documentarySavedContextIssue } from './documentary-context-approval.js';

type Excerpt = { file: string; checksum: string; start: number; end: number; duration: number; width: number; height: number; bytes: number };
const downloaded = new Set(["youtube", "commons", "internet-archive", "loc", "pexels", "pixabay", "web"]);
const seconds = (scene: Scene) => Math.max((scene.documentary?.timing?.durationInFrames ?? Math.ceil(scene.durationSeconds * 30)) / 30, scene.durationOverrideSeconds ?? 0);

/** Rebase only evidence whose original subject, script and interval still match. */
async function rebaseExcerptReview(project:Project,original:Scene,excerpt:Scene,offset:number):Promise<Scene> {
  const review=original.documentary?.visualReview;
  if(!review||!review.contextApproval&&!review.illustrationApproval||documentarySavedContextIssue(project,original))return excerpt;
  // Only this deterministic conversion of the already approved interval can
  // inherit its evidence. Handles outside that interval are never approved.
  if(!original.videoPath||!excerpt.videoPath||original.trimEndSeconds===undefined||excerpt.trimEndSeconds===undefined
    ||Math.abs((excerpt.trimStartSeconds??0)+offset-(original.trimStartSeconds??0))>1e-6
    ||Math.abs(excerpt.trimEndSeconds+offset-original.trimEndSeconds)>1e-6
    ||await checksumFile(original.videoPath)!==original.documentary!.checksum
    ||await checksumFile(excerpt.videoPath)!==excerpt.documentary!.checksum)return excerpt;
  const info=await stat(excerpt.videoPath,{bigint:true});
  const shifted:NonNullable<NonNullable<Scene['documentary']>['visualReview']>={...review,trimStartSeconds:excerpt.trimStartSeconds,trimEndSeconds:excerpt.trimEndSeconds,
    localReview:{version:1 as const,size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)},
    sampleSeconds:review.sampleSeconds.map(time=>time-offset),
    scriptEvidence:review.scriptEvidence?{...review.scriptEvidence,checks:review.scriptEvidence.checks.map(check=>({...check,
      ...(check.temporalEvidence?{temporalEvidence:{...check.temporalEvidence,observations:check.temporalEvidence.observations?.map(row=>({...row,seconds:row.seconds-offset}))}}:{})}))}:undefined,
    contextApproval:undefined,illustrationApproval:undefined};
  const rebased={...excerpt,documentary:{...excerpt.documentary!,visualReview:shifted}};
  if(review.contextApproval)shifted.contextApproval=documentaryContextApproval(project,rebased,{status:'accepted',narrativeEvidence:review.contextApproval.evidence});
  if(review.illustrationApproval)shifted.illustrationApproval=documentaryIllustrationApproval(project,rebased);
  return rebased;
}

/** Repair app-created excerpts saved by older builds with an original-file proof.
 * Validate the original proof, the generated clip index and immutable bytes;
 * user edits or missing provenance remain unconfirmed. No provider calls. */
export async function restoreDocumentaryExcerptReviews(project:Project,root:string):Promise<Scene[]> {
  return Promise.all(project.scenes.map(async scene=>{
    const doc=scene.documentary,source=doc?.selected,range=source?.excerpt;
    if(!doc?.verified||doc.pinned||!range||!doc.visualReview||!doc.visualReview.contextApproval&&!doc.visualReview.illustrationApproval
      ||source?.id!==`excerpt:${doc.checksum}`||!documentarySavedContextIssue(project,scene)
      ||!/^[a-f0-9]{64}$/.test(range.sourceChecksum)||!/^[a-f0-9]{64}$/.test(doc.checksum??''))return scene;
    const directory=join(root,'Documentary','Excerpts');
    if(scene.videoPath!==join(directory,`${doc.checksum}.mp4`))return scene;
    try{
      const width=project.aspectRatio==='9:16'?1080:1920,height=project.aspectRatio==='9:16'?1920:1080;
      const key=createHash('sha256').update(JSON.stringify([1,range.sourceChecksum,{start:range.startSeconds,end:range.endSeconds},width,height,30,18])).digest('hex');
      const clip=JSON.parse(await readFile(join(directory,`${key}.json`),'utf8')) as Excerpt;
      if(clip.checksum!==doc.checksum||clip.file!==`${doc.checksum}.mp4`||clip.start!==range.startSeconds||clip.end!==range.endSeconds)return scene;
      const originalSource=JSON.parse(await readFile(join(root,'Documentary',scene.id.replace(/[^a-zA-Z0-9_-]/g,'_'),`${range.sourceChecksum}.source.json`),'utf8')) as DocumentaryCandidate;
      const original={...scene,videoPath:originalSource.localPath,trimStartSeconds:(scene.trimStartSeconds??0)+clip.start,
        trimEndSeconds:scene.trimEndSeconds===undefined?undefined:scene.trimEndSeconds+clip.start,
        documentary:{...doc,checksum:range.sourceChecksum,selected:originalSource,
          visualReview:{...doc.visualReview,sampleSeconds:doc.visualReview.sampleSeconds.map(time=>time+clip.start)}}};
      if(documentarySavedContextIssue(project,original)||await checksumFile(scene.videoPath!)!==doc.checksum)return scene;
      // Old compaction already shifted sampleSeconds but left temporal observations
      // in the original coordinate system. Restore samples before one full rebase.
      return await rebaseExcerptReview(project,original,scene,clip.start);
    }catch{return scene;}
  }));
}

/** Retain all time used by this material, including other scenes' cuts/comparisons. */
export function documentaryExcerptBounds(project: Project, source: Scene): { start: number; end: number } {
  const ranges: Array<{ start: number; end: number }> = [];
  const add = (start: number, end: number | undefined, duration: number, rate: number) => {
    ranges.push({ start, end: Math.min(end ?? Infinity, start + duration * rate) });
  };
  add(source.trimStartSeconds ?? 0, source.trimEndSeconds, seconds(source), source.playbackRate ?? 1);
  for (const scene of project.scenes) {
    for (const cut of scene.documentary?.cuts ?? []) if ((cut.sourceSceneId ?? scene.id) === source.id) {
      add(cut.trimStartSeconds, cut.trimEndSeconds, cut.durationInFrames / 30, cut.playbackRate);
    }
    if (scene.documentary?.comparison?.sceneId === source.id) add(source.trimStartSeconds ?? 0, source.trimEndSeconds, seconds(scene), source.playbackRate ?? 1);
  }
  // Half a second of editable handles, aligned to the composition's 30 fps.
  return { start: Math.max(0, Math.floor((Math.min(...ranges.map(range => range.start)) - .5) * 30) / 30),
    end: Math.min(source.documentary!.selected!.durationSeconds!, Math.ceil((Math.max(...ranges.map(range => range.end)) + .5) * 30) / 30) };
}

/** Produces checked raw clips and a new snapshot. Never deletes or commits source data. */
export async function prepareDocumentaryExcerpts(project: Project, root: string, progress: (done: number, total: number) => void = () => {}, signal?: AbortSignal, materialRoot?: string): Promise<{ scenes: Scene[]; count: number }> {
  const directory = join(root, "Documentary", "Excerpts");
  const candidates = project.scenes.filter(scene => scene.videoPath && scene.documentary?.verified && !scene.documentary.pinned
    && scene.documentary.selected?.kind === "video" && !scene.documentary.selected.excerpt && !scene.documentary.selected.id.startsWith("manual:")
    && (downloaded.has(scene.documentary.selected.provider) || scene.documentary.selected.provider === "local") && (scene.documentary.selected.durationSeconds ?? 0) > 45);
  if (!candidates.length) return { scenes: project.scenes, count: 0 };
  await mkdir(directory, { recursive: true });
  const edits = new Map<string, Excerpt>(), origins = new Map<string, DocumentaryCandidate>(), jobs = new Map<string, Promise<Excerpt>>();
  const width = project.aspectRatio === "9:16" ? 1080 : 1920, height = project.aspectRatio === "9:16" ? 1920 : 1080;
  let next = 0, done = 0;
  const worker = async () => { for (;;) {
    const scene = candidates[next++]; if (!scene) return;
    signal?.throwIfAborted();
    const doc = scene.documentary!;
    let source = doc.selected!;
    if (source.provider === "local") {
      const origin: DocumentaryCandidate | undefined = materialRoot && /^[a-f0-9]{64}$/.test(doc.checksum ?? "")
        ? await readFile(join(materialRoot, "Catalog", `${doc.checksum}.json`), "utf8").then(JSON.parse, error => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw error;
        }) : undefined;
      if (!origin || origin.id.startsWith("manual:") || !downloaded.has(origin.provider)) { progress(++done, candidates.length); continue; }
      source = { ...source, id: origin.id, provider: origin.provider };
    }
    origins.set(scene.id, source);
    const range = documentaryExcerptBounds(project, scene);
    const length = range.end - range.start;
    // A heavily edited material may span most of its source; keep that source.
    if (!doc.checksum || !Number.isFinite(length) || length <= 0 || length >= source.durationSeconds! * .75) { progress(++done, candidates.length); continue; }
    const key = createHash("sha256").update(JSON.stringify([1, doc.checksum, range, width, height, 30, 18])).digest("hex");
    let job = jobs.get(key);
    if (!job) {
      job = (async () => {
        const index = join(directory, `${key}.json`);
        const saved: Excerpt | undefined = await readFile(index, "utf8").then(JSON.parse, error => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw error;
        });
        if (saved && await stat(join(directory, saved.file)).then(info => info.size === saved.bytes && info.size > 0, () => false)) return saved;
        await ensureDocumentarySpace(directory, 32 * 1024 * 1024);
        const temporary = join(directory, `${randomUUID()}.part.mp4`);
        try {
          await effectFfmpeg(["-y", "-threads", "2", "-ss", String(range.start), "-i", scene.videoPath!, "-t", String(length),
            "-map", "0:v:0", "-map", "0:a:0?", "-vf", `fps=30,scale=w='min(iw,${width})':h='min(ih,${height})':force_original_aspect_ratio=decrease:force_divisible_by=2`,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", temporary], signal);
          const media = await probeEffectMedia(temporary, signal);
          if (!media.videoCodec || !media.width || !media.height || Math.abs(media.durationSeconds - length) > .09) throw new Error("Сохранённый фрагмент не прошёл проверку длительности/видео; исходник оставлен");
          const checksum = await checksumFile(temporary), file = `${checksum}.mp4`, target = join(directory, file);
          if (!await stat(target).then(info => info.size > 0, () => false)) await rename(temporary, target);
          const result = { file, checksum, start: range.start, end: range.end, duration: media.durationSeconds, width: media.width, height: media.height, bytes: (await stat(target)).size };
          const selected: DocumentaryCandidate = { ...source, id: `excerpt:${checksum}`, localPath: target, width: media.width, height: media.height, durationSeconds: result.duration, bytes: result.bytes,
            excerpt: { sourceChecksum: doc.checksum!, startSeconds: range.start, endSeconds: range.end, sourceDurationSeconds: source.durationSeconds! } };
          await atomicWrite(join(directory, `${checksum}.source.json`), JSON.stringify(selected, null, 2));
          await atomicWrite(index, JSON.stringify(result));
          return result;
        } finally { await rm(temporary, { force: true }).catch(() => undefined); }
      })();
      jobs.set(key, job);
    }
    const clip = await job;
    if (materialRoot) {
      await mkdir(join(materialRoot, "Files"), { recursive: true });
      await mkdir(join(materialRoot, "Catalog"), { recursive: true });
      const localPath = join(materialRoot, "Files", clip.file);
      await copyImmutableDocumentaryFile(join(directory, clip.file), localPath);
      await atomicWrite(join(materialRoot, "Catalog", `${clip.checksum}.json`), JSON.stringify({ ...source, id: `excerpt:${clip.checksum}`, localPath,
        description: [doc.visualReview?.viewDescription, doc.visualReview?.actionMatch && doc.visualReview.actionEvidence ? `Verified action in previous frame review: ${doc.visualReview.actionEvidence}` : undefined, source.description].filter(Boolean).join("\n").slice(0, 2400),
        width: clip.width, height: clip.height, durationSeconds: clip.duration, bytes: clip.bytes,
        excerpt: { sourceChecksum: doc.checksum!, startSeconds: clip.start, endSeconds: clip.end, sourceDurationSeconds: source.durationSeconds! } }));
    }
    edits.set(scene.id, clip); progress(++done, candidates.length);
  } };
  const settled = await Promise.allSettled([worker(), worker()]);
  const failed = settled.find(item => item.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  const scenes = await Promise.all(project.scenes.map(async scene => {
    const clip = edits.get(scene.id), doc = scene.documentary;
    if (!doc) return scene;
    const cuts = doc.cuts?.map(cut => {
      const edited = edits.get(cut.sourceSceneId ?? scene.id);
      return edited ? { ...cut, trimStartSeconds: Math.max(0, cut.trimStartSeconds - edited.start), trimEndSeconds: cut.trimEndSeconds === undefined ? undefined : Math.max(0, cut.trimEndSeconds - edited.start) } : cut;
    });
    if (!clip) return cuts ? { ...scene, documentary: { ...doc, cuts } } : scene;
    const source = origins.get(scene.id)!, videoPath = join(directory, clip.file);
    const start = Math.max(0, (scene.trimStartSeconds ?? 0) - clip.start), end = scene.trimEndSeconds === undefined ? undefined : Math.min(clip.duration, scene.trimEndSeconds - clip.start);
    const excerpt:Scene={ ...scene, videoPath, trimStartSeconds: start, trimEndSeconds: end, documentary: { ...doc, cuts, checksum: clip.checksum,
      selected: { ...source, id: `excerpt:${clip.checksum}`, localPath: videoPath, width: clip.width, height: clip.height, durationSeconds: clip.duration, bytes: clip.bytes,
        excerpt: { sourceChecksum: doc.checksum!, startSeconds: clip.start, endSeconds: clip.end, sourceDurationSeconds: source.durationSeconds! } },
      visualReview: doc.visualReview ? { ...doc.visualReview, trimStartSeconds: start, trimEndSeconds: end,
        sampleSeconds: doc.visualReview.sampleSeconds.map(time => time - clip.start).filter(time => time >= 0 && time <= clip.duration) } : undefined } };
    return rebaseExcerptReview(project,scene,excerpt,clip.start);
  }));
  // No old absolute paths here: URL/checksum/time suffice for provenance without
  // making the unused original look like a live material reference to cleanup.
  if (edits.size) await atomicWrite(join(directory, "fragments.json"), JSON.stringify({ version: 1, projectId: project.id, fragments: scenes.filter(scene => scene.documentary?.selected?.excerpt).map(scene => ({ sceneId: scene.id, scene: scene.order + 1,
    file: scene.videoPath?.split(/[\\/]/).at(-1), title: scene.documentary!.selected!.title, sourceUrl: scene.documentary!.selected!.pageUrl,
    license: scene.documentary!.selected!.license, attribution: scene.documentary!.selected!.attribution, ...scene.documentary!.selected!.excerpt })) }, null, 2));
  return { scenes, count: edits.size };
}
