import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, statfs } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { EFFECT_CATEGORIES, type EffectAsset, type EffectCategory, type EffectImportProgress, type EffectLibrarySnapshot, type UpdateEffectInput } from "@gold-work/shared";
import { atomicWrite } from "./fs-utils.js";
import { prepareEffectMedia } from "./effect-media.js";

const EXTENSIONS: Record<string, EffectAsset["kind"]> = Object.fromEntries([
  ...[".mp4", ".mov", ".wmv", ".mkv", ".webm", ".avi", ".m4v"].map(ext => [ext, "video"]),
  ...[".jpg", ".jpeg", ".png", ".webp"].map(ext => [ext, "image"]),
  ...[".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"].map(ext => [ext, "audio"])
]);
const FOLDERS: Record<EffectCategory, string> = {
  background: "Visual/Backgrounds", particles: "Visual/Overlays/Particles", smoke: "Visual/Overlays/Smoke",
  "light-leak": "Visual/Overlays/LightLeaks", transition: "Visual/Transitions", riser: "Audio/Risers",
  impact: "Audio/Impacts", subdrop: "Audio/Subdrops", glitch: "Audio/GlitchVhsNoise", keyboard: "Audio/UI/Keyboard",
  click: "Audio/UI/Clicks", ding: "Audio/UI/Dings", dramatic: "Audio/Dramatic", review: "Review"
};
export function classifyEffect(path: string, kind: EffectAsset["kind"]): { category: EffectCategory; tags: string[] } {
  const text = path.toLowerCase();
  const tags = /популярн/.test(text) ? ["популярные"] : [];
  let category: EffectCategory = "review";
  if (kind === "audio") {
    if (/keyboard|клавиатур/.test(text)) { category = "keyboard"; tags.push("популярные"); }
    else if (/mouse|click|щелч|мыш/.test(text)) category = "click";
    else if (/ding|bell|звон/.test(text)) category = "ding";
    else if (/subdrop/.test(text)) category = "subdrop";
    else if (/переход|whoosh|swoosh/.test(text)) category = "transition";
    else if (/waterphone|awkward|anime|heartbeat|dramatic|suspense/.test(basename(text))) category = "dramatic";
    else if (/glit[hсc]*|vhs|noise/.test(text)) category = "glitch";
    else if (/riser/.test(basename(text))) category = "riser";
    else if (/impact|hit/.test(basename(text))) category = "impact";
  } else {
    if (/background|(?:^|[\\/\s])фоны?(?:[\\/\s_]|$)/u.test(text)) category = "background";
    else if (/particles/.test(text)) category = "particles";
    else if (/smoke/.test(text)) category = "smoke";
    else if (/glare/.test(text)) category = "light-leak";
    // Unreviewed transition packs contain portraits, text and standalone compositions.
    else if (/transition/.test(text)) { category = "review"; tags.push("переход", "проверить композицию"); }
  }
  return { category, tags: [...new Set(tags)] };
}
export async function checksumFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..\\`) && !rel.startsWith("../"));
}
function safeId(id: string): void {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Некорректный ID эффекта");
}
function normalizedInput(input: UpdateEffectInput, asset: EffectAsset): UpdateEffectInput {
  if (!input || typeof input.name !== "string" || !input.name.trim()) throw new Error("Введите название эффекта");
  if (!EFFECT_CATEGORIES.includes(input.category)) throw new Error("Неизвестная категория");
  if (!["pending", "approved", "rejected"].includes(input.review) || !["unknown", "user-confirmed"].includes(input.rights)) throw new Error("Некорректный статус проверки");
  if (!Array.isArray(input.tags) || input.tags.some(tag => typeof tag !== "string")) throw new Error("Некорректные теги");
  if (!input.defaults || !["normal", "screen", "add", "multiply"].includes(input.defaults.blend)) throw new Error("Некорректное смешивание");
  const d = input.defaults;
  const finite = (value: number, min: number, max: number) => {
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Значение должно быть от ${min} до ${max}`);
    return value;
  };
  finite(d.opacity, 0, 100); finite(d.volume, 0, 100);
  finite(d.trimStartSeconds, 0, asset.metadata?.durationSeconds || 86400);
  if (d.trimEndSeconds !== undefined) {
    finite(d.trimEndSeconds, d.trimStartSeconds, asset.metadata?.durationSeconds || 86400);
    if (d.trimEndSeconds <= d.trimStartSeconds) throw new Error("Конец фрагмента должен быть позже начала");
  }
  finite(d.fadeInSeconds, 0, 30); finite(d.fadeOutSeconds, 0, 30);
  if (input.automatic && (input.review !== "approved" || input.rights !== "user-confirmed" || asset.state !== "ready" || asset.deletedAt)) {
    throw new Error("Для автоподбора сначала проверьте эффект и подтвердите условия использования");
  }
  return {
    name: input.name.trim().slice(0, 200), category: input.category,
    tags: [...new Set(input.tags.map(tag => tag.trim().slice(0, 60)).filter(Boolean))].slice(0, 30),
    favorite: Boolean(input.favorite), automatic: Boolean(input.automatic), review: input.review, rights: input.rights,
    rightsNote: String(input.rightsNote ?? "").slice(0, 2000), defaults: { blend: d.blend, opacity: d.opacity, volume: d.volume,
      sourceAudio: Boolean(d.sourceAudio), trimStartSeconds: d.trimStartSeconds, trimEndSeconds: d.trimEndSeconds,
      fadeInSeconds: d.fadeInSeconds, fadeOutSeconds: d.fadeOutSeconds }
  };
}

type PrepareMedia = typeof prepareEffectMedia;
export class EffectLibrary {
  private controller?: AbortController;
  private active?: Promise<void>;
  private mutation: Promise<unknown> = Promise.resolve();
  private progress?: EffectImportProgress;
  constructor(readonly rootPath: string, private readonly publish: (progress: EffectImportProgress) => void = () => {},
    private readonly prepare: PrepareMedia = prepareEffectMedia) {}

  async snapshot(): Promise<EffectLibrarySnapshot> {
    await mkdir(join(this.rootPath, "Catalog", "Assets"), { recursive: true });
    const names = await readdir(join(this.rootPath, "Catalog", "Assets"));
    const assets: EffectAsset[] = [];
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      // Corruption is an actionable error, never an empty successful library.
      assets.push(JSON.parse(await readFile(join(this.rootPath, "Catalog", "Assets", name), "utf8")) as EffectAsset);
    }
    let progress = this.progress;
    if (!progress) {
      try { progress = JSON.parse(await readFile(join(this.rootPath, "Catalog", "import.json"), "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (progress && ["scanning", "importing"].includes(progress.status)) {
        let alive = false;
        try {
          const pid = Number(await readFile(join(this.rootPath, "Catalog", "import.lock"), "utf8"));
          if (Number.isSafeInteger(pid) && pid > 0) { process.kill(pid, 0); alive = true; }
        } catch { /* Interrupted import can be resumed from its persisted roots. */ }
        if (!alive) progress = { ...progress, status: "cancelled", current: "Импорт прерван. Продолжите с сохранённых папок." };
      }
    }
    return { rootPath: this.rootPath, assets: assets.sort((a, b) => a.name.localeCompare(b.name)), importProgress: progress };
  }
  async startImport(roots: string[], options: { category?: "background" } = {}): Promise<EffectImportProgress> {
    if (this.active) throw new Error("Импорт уже выполняется");
    if (!Array.isArray(roots) || !roots.length || roots.some(root => typeof root !== "string" || !isAbsolute(root))) throw new Error("Выберите папку с медиа");
    const unique = [...new Set(roots.map(root => resolve(root)))];
    const selected = unique.filter(root => !unique.some(other => other !== root && inside(other, root)));
    for (const root of selected) {
      if (inside(this.rootPath, root) || inside(root, this.rootPath)) throw new Error("Нельзя импортировать Library в саму себя");
      const info = await stat(root);
      if (!info.isDirectory() && !(options.category === "background" && info.isFile() && ["image", "video"].includes(EXTENSIONS[extname(root).toLowerCase()] ?? ""))) {
        throw new Error(options.category === "background" ? "Выберите изображение, видео или папку с фонами" : `Папка недоступна: ${root}`);
      }
    }
    await mkdir(join(this.rootPath, "Catalog"), { recursive: true });
    const lockPath = join(this.rootPath, "Catalog", "import.lock");
    try {
      const pid = Number(await readFile(lockPath, "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Не удалось прочитать блокировку импорта");
      let alive = true;
      try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false; }
      if (alive) throw new Error("Библиотека уже импортируется другим процессом");
      await rm(lockPath);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const lock = await open(lockPath, "wx");
    await lock.writeFile(String(process.pid)); await lock.close();
    this.controller = new AbortController();
    this.progress = { id: randomUUID(), status: "scanning", roots: selected, total: 0, processed: 0, added: 0, duplicates: 0,
      ignored: 0, bytes: 0, errors: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await this.saveProgress();
    this.active = this.runImport(selected, this.controller.signal, options.category).catch(async error => {
      this.progress!.status = this.controller?.signal.aborted ? "cancelled" : "error";
      if (!this.controller?.signal.aborted) this.progress!.errors.push({ path: this.progress!.current ?? "", message: String(error instanceof Error ? error.message : error) });
      await this.saveProgress();
    }).finally(async () => { await rm(lockPath, { force: true }); this.active = undefined; this.controller = undefined; });
    // Keep async background errors observable through waitForImport and the persisted progress.
    void this.active.catch(() => {});
    return structuredClone(this.progress);
  }
  async waitForImport(): Promise<EffectLibrarySnapshot> { await this.active; return this.snapshot(); }
  cancel(): void { this.controller?.abort(); }
  async update(id: string, input: UpdateEffectInput): Promise<EffectAsset> {
    return this.edit(id, asset => ({ ...asset, ...normalizedInput(input, asset) }));
  }
  async trash(id: string, deleted: boolean): Promise<EffectAsset> {
    // Soft delete keeps bytes and IDs usable by all saved project snapshots.
    return this.edit(id, asset => ({ ...asset, deletedAt: deleted ? new Date().toISOString() : undefined, automatic: false }));
  }
  private async edit(id: string, change: (asset: EffectAsset) => EffectAsset): Promise<EffectAsset> {
    safeId(id);
    const work = this.mutation.then(async () => {
      const path = join(this.rootPath, "Catalog", "Assets", `${id}.json`);
      const asset = change(JSON.parse(await readFile(path, "utf8")) as EffectAsset);
      asset.updatedAt = new Date().toISOString();
      await atomicWrite(path, JSON.stringify(asset, null, 2));
      return asset;
    });
    this.mutation = work.catch(() => {});
    return work;
  }
  private async saveProgress(): Promise<void> {
    this.progress!.updatedAt = new Date().toISOString();
    await atomicWrite(join(this.rootPath, "Catalog", "import.json"), JSON.stringify(this.progress, null, 2));
    this.publish(structuredClone(this.progress!));
  }
  private async runImport(roots: string[], signal: AbortSignal, category?: "background"): Promise<void> {
    const files: { path: string; pack: string; bytes: number }[] = [];
    const scan = async (path: string, pack: string): Promise<void> => {
      signal.throwIfAborted();
      if ((await stat(path)).isFile()) { files.push({ path, pack, bytes: (await stat(path)).size }); return; }
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const full = join(path, entry.name);
        if (entry.isSymbolicLink()) { this.progress!.ignored++; continue; }
        if (entry.isDirectory()) await scan(full, pack);
        else if (entry.isFile() && EXTENSIONS[extname(entry.name).toLowerCase()] && !(category === "background" && EXTENSIONS[extname(entry.name).toLowerCase()] === "audio")) files.push({ path: full, pack, bytes: (await stat(full)).size });
        else this.progress!.ignored++;
      }
    };
    for (const root of roots) await scan(root, basename(root));
    this.progress!.total = files.length;
    this.progress!.bytes = files.reduce((sum, file) => sum + file.bytes, 0);
    this.progress!.status = "importing";
    await this.saveProgress();
    for (const file of files) {
      signal.throwIfAborted();
      this.progress!.current = file.path;
      await this.saveProgress();
      try {
        const checksum = await checksumFile(file.path);
        signal.throwIfAborted();
        const catalogPath = join(this.rootPath, "Catalog", "Assets", `${checksum}.json`);
        let asset: EffectAsset | undefined;
        try { asset = JSON.parse(await readFile(catalogPath, "utf8")); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (asset) {
          const classification = classifyEffect(file.path, asset.kind);
          asset = await this.edit(checksum, current => ({ ...current, tags: [...new Set([...current.tags, ...classification.tags])], origins: current.origins.some(origin => origin.originalPath === file.path)
            ? current.origins : [...current.origins, { originalPath: file.path, pack: file.pack }] }));
          const exists = await stat(join(this.rootPath, asset.file)).then(info => info.size === asset!.bytes, () => false);
          if (asset.state === "ready" && exists && (!asset.proxy || await stat(join(this.rootPath, asset.proxy)).then(() => true, () => false))) {
            this.progress!.duplicates++;
            this.progress!.processed++;
            await this.saveProgress();
            continue;
          }
        }
        const disk = await statfs(this.rootPath);
        if (disk.bavail * disk.bsize < file.bytes * 3 + 128 * 1024 * 1024) throw new Error("Недостаточно места для оригинала и прокси");
        if (!asset) {
          const kind = EXTENSIONS[extname(file.path).toLowerCase()]!;
          const classification = classifyEffect(file.path, kind);
          if (category) classification.category = category;
          const folder = kind === "audio" && classification.category === "transition" ? "Audio/Transitions" : FOLDERS[classification.category];
          asset = { id: checksum, checksum, version: 1, name: basename(file.path, extname(file.path)), kind, ...classification,
            file: `${folder}/${checksum}${extname(file.path).toLowerCase()}`, origins: [{ originalPath: file.path, pack: file.pack }],
            bytes: file.bytes, favorite: false, automatic: false, review: "pending", rights: "unknown", rightsNote: "",
            state: "copied", defaults: { blend: kind === "audio" || classification.category === "review" || classification.category === "background" ? "normal" : "screen",
              opacity: kind === "audio" || classification.category === "background" ? 100 : 25, volume: 20, sourceAudio: false, trimStartSeconds: 0, fadeInSeconds: 0.1, fadeOutSeconds: 0.2 },
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        }
        const destination = join(this.rootPath, asset.file);
        if (!inside(this.rootPath, destination)) throw new Error("Некорректный путь Library");
        await mkdir(dirname(destination), { recursive: true });
        const temporary = `${destination}.importing`;
        await copyFile(file.path, temporary);
        if (await checksumFile(temporary) !== checksum) throw new Error("Файл изменился во время копирования; повторите импорт");
        await rename(temporary, destination);
        await atomicWrite(catalogPath, JSON.stringify(asset, null, 2));
        try {
          const prepared = await this.prepare(this.rootPath, asset, signal);
          signal.throwIfAborted();
          await this.edit(checksum, current => ({ ...current, ...prepared }));
          this.progress!.added++;
        } catch (error) {
          if (!signal.aborted) await this.edit(checksum, current => ({ ...current, state: "error", automatic: false, error: error instanceof Error ? error.message : String(error) }));
          throw error;
        }
      } catch (error) {
        if (signal.aborted) throw error;
        this.progress!.errors.push({ path: file.path, message: error instanceof Error ? error.message : String(error) });
      }
      this.progress!.processed++;
      await this.saveProgress();
    }
    this.progress!.status = "complete";
    this.progress!.current = undefined;
    await this.saveProgress();
  }
}
