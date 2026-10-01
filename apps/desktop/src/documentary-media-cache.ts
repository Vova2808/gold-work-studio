import { mkdir, readFile, stat, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EffectAsset, Scene } from "@gold-work/shared";
import { effectFfmpeg, prepareEffectMedia, probeEffectMedia } from "./effect-media.js";
import { atomicWrite } from "./fs-utils.js";
import { copyImmutableDocumentaryFile } from "./documentary-storage.js";
import { documentaryVisualHash } from "./documentary-visual-hash.js";
import { createHash, randomUUID } from "node:crypto";

/** A range poster is distinct from the immutable source's common cover. */
export async function prepareDocumentaryRangePoster(root: string, scene: Scene): Promise<Scene> {
  const doc = scene.documentary;
  if (!scene.videoPath || doc?.selected?.kind !== "video" || !doc.checksum) return scene;
  const start = scene.trimStartSeconds ?? 0;
  const end = scene.trimEndSeconds ?? start + (doc.timing?.durationInFrames ?? scene.durationSeconds * 30) / 30;
  const time = Math.max(start, Math.min((doc.selected.durationSeconds ?? end) - .05, (start + end) / 2));
  const key = createHash("sha256").update(JSON.stringify([doc.checksum, scene.videoPath, time])).digest("hex");
  const directory = join(root, "Documentary", "RangePosters"), output = join(directory, `${key}.jpg`);
  const posterExists = await stat(output).then(info => info.size > 0, () => false);
  if (posterExists && scene.imagePath === output && (!doc.visualReview || doc.visualReview.frameHash)) return scene;
  if (!posterExists) {
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `${key}-${randomUUID()}.part.jpg`);
    await effectFfmpeg(["-y", "-ss", String(time), "-i", scene.videoPath, "-frames:v", "1", "-vf", "scale=768:768:force_original_aspect_ratio=decrease", "-q:v", "4", temporary]);
    await rename(temporary, output);
  }
  const frameHash = doc.visualReview ? await documentaryVisualHash(output) : undefined;
  return { ...scene, imagePath: output, documentary: { ...doc, ...(doc.visualReview ? { visualReview: { ...doc.visualReview, frameHash } } : {}) } };
}

/** Keep playable source videos intact; the documentary reviewer checks the chosen footage separately. */
export async function prepareDocumentaryMedia(root: string, asset: EffectAsset, materialRoot: string, previous: Scene[], projectCacheRoot?: string): Promise<Partial<EffectAsset>> {
  // Keep one copy per project volume. A shared library on D: must not cause a
  // separate physical C: copy of the same proxy for every scene.
  const sharedCache = join(materialRoot, "Prepared", asset.checksum);
  const cache = projectCacheRoot ? join(projectCacheRoot, "Prepared", asset.checksum) : sharedCache;
  const paths = (prepared: Partial<EffectAsset>) => [...new Set([prepared.poster, prepared.proxy, prepared.preview].filter((path): path is string => Boolean(path)))];
  const valid = async (from: string, prepared: Partial<EffectAsset>) => prepared.state === "ready" && prepared.metadata
    && (asset.kind !== "video" || prepared.poster && prepared.metadata.videoCodec) && await Promise.all(paths(prepared).map(path => /^(?:Proxies|Previews)\/[a-f0-9]{64}\.(?:jpg|png|mp4)$/.test(path) && stat(join(from, path)).then(info => info.size > 0, () => false))).then(found => found.every(Boolean));
  const copy = async (from: string, to: string, prepared: Partial<EffectAsset>) => {
    for (const path of paths(prepared)) { await mkdir(dirname(join(to, path)), { recursive: true }); await copyImmutableDocumentaryFile(join(from, path), join(to, path)); }
  };
  const cached = await readFile(join(cache, "prepared.json"), "utf8").then(text => JSON.parse(text) as Partial<EffectAsset>, () => undefined);
  if (cached && await valid(cache, cached)) { await copy(cache, root, cached); return cached; }
  if (cache !== sharedCache) {
    const shared = await readFile(join(sharedCache, "prepared.json"), "utf8").then(text => JSON.parse(text) as Partial<EffectAsset>, () => undefined);
    if (shared && await valid(sharedCache, shared)) {
      await mkdir(cache, { recursive: true }); await copy(sharedCache, cache, shared);
      await atomicWrite(join(cache, "prepared.json"), JSON.stringify(shared));
      await copy(cache, root, shared); return shared;
    }
  }
  let prepared: Partial<EffectAsset> | undefined;
  // Recover derivatives made by the previous version without transcoding the same large video again.
  for (const scene of previous.filter(scene => scene.documentary?.checksum === asset.checksum && scene.documentary.selected?.localPath)) {
    const from = dirname(scene.documentary!.selected!.localPath!);
    const source = await readFile(join(from, `${asset.checksum}.source.json`), "utf8").then(text => JSON.parse(text) as { metadata?: EffectAsset["metadata"] }, () => undefined);
    const result: Partial<EffectAsset> = { state: "ready", metadata: source?.metadata, poster: `Previews/${asset.id}.jpg`, ...(asset.kind === "video" ? { proxy: `Proxies/${asset.id}.mp4`, preview: `Proxies/${asset.id}.mp4` } : !/\.(?:png|jpe?g|webp)$/i.test(asset.file) ? { proxy: `Proxies/${asset.id}.png`, preview: `Proxies/${asset.id}.png` } : {}) };
    if (await valid(from, result)) { await copy(from, root, result); prepared = result; break; }
  }
  if (!prepared && asset.kind === "video" && /\.(?:mp4|webm)$/i.test(asset.file)) {
    const source = join(root, asset.file), metadata = await probeEffectMedia(source);
    if (metadata.durationSeconds <= 0) throw new Error("Не удалось определить длительность видео");
    if (["h264", "av1", "vp8", "vp9"].includes(metadata.videoCodec ?? "")) {
      const poster = `Previews/${asset.id}.jpg`;
      await mkdir(join(root, "Previews"), { recursive: true });
      await effectFfmpeg(["-y", "-ss", String(Math.min(2, metadata.durationSeconds * .35)), "-i", source, "-frames:v", "1", "-vf", "scale=640:640:force_original_aspect_ratio=decrease", join(root, poster)]);
      prepared = { state: "ready", metadata, poster };
    }
  }
  prepared ??= await prepareEffectMedia(root, asset);
  await mkdir(cache, { recursive: true });
  await copy(root, cache, prepared);
  await atomicWrite(join(cache, "prepared.json"), JSON.stringify(prepared));
  if (cache !== sharedCache) {
    await mkdir(sharedCache, { recursive: true }); await copy(cache, sharedCache, prepared);
    await atomicWrite(join(sharedCache, "prepared.json"), JSON.stringify(prepared));
  }
  return prepared;
}

/** Large archive photos overwhelm the editor; retain originals and use a 4K working copy. */
export async function prepareDocumentaryImages(root: string, scenes: Scene[]): Promise<Scene[]> {
  const directory = join(root, "Documentary", "Playback");
  const result: Scene[] = [];
  for (const scene of scenes) {
    const doc = scene.documentary;
    if (scene.videoPath && doc?.selected?.kind === "video") {
      result.push(await prepareDocumentaryRangePoster(root, scene)); continue;
    }
    if (!scene.imagePath || !doc?.checksum || doc.selected?.kind !== "image"
      || Math.max(doc.selected.width ?? 0, doc.selected.height ?? 0) <= 3840) {
      result.push(scene); continue;
    }
    const output = join(directory, `${doc.checksum}-3840.png`);
    if (!await stat(output).then(info => info.size > 0, () => false)) {
      await mkdir(directory, { recursive: true });
      const temporary = join(directory, `${doc.checksum}-3840.part.png`);
      const source = dirname(scene.imagePath) === directory ? doc.selected.localPath : scene.imagePath;
      if (!source || source === output) throw new Error("Не найден оригинал фотографии для восстановления предпросмотра");
      await effectFfmpeg(["-y", "-i", source, "-frames:v", "1", "-vf", "scale=3840:3840:force_original_aspect_ratio=decrease", temporary]);
      await rename(temporary, output);
    }
    result.push({ ...scene, imagePath: output });
  }
  return result;
}
