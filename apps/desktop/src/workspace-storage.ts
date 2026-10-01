import { constants, createReadStream } from "node:fs";
import { copyFile, link, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, statfs, symlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { WorkspaceStorageInfo } from "@gold-work/shared";
import { atomicWrite } from "./fs-utils.js";
import { setTimeout as delay } from "node:timers/promises";

type ChildSwitch = { source: string; backup: string; target: string };
type Location = { activePath?: string; retainedPath?: string; pendingPath?: string; error?: string; switching?: { source: string; backup: string }; childSwitch?: ChildSwitch[] };
const markerName = ".goldwork-storage.json";
const locationFile = (profile: string) => join(profile, "storage-location.json");
const inside = (root: string, target: string) => { const r = relative(root, target); return r === "" || r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r); };
async function location(profile: string): Promise<Location> {
  try { return JSON.parse(await readFile(locationFile(profile), "utf8")) as Location; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
}
async function checksum(file: string): Promise<string> {
  const hash = createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest("hex");
}
export async function workspaceStorageInfo(profile: string): Promise<WorkspaceStorageInfo> {
  const logical = join(profile, "workspace"); await mkdir(logical, { recursive: true });
  const { activePath, retainedPath, pendingPath, error } = await location(profile);
  const path = await realpath(activePath ?? logical), disk = await statfs(path);
  return { path, freeBytes: disk.bavail * disk.bsize, retainedPath, pendingPath, error };
}
async function validateTarget(profile: string, target: string): Promise<string> {
  if (!isAbsolute(target)) throw new Error("Выберите абсолютный путь к пустой папке хранения");
  const path = await realpath(target), source = await realpath((await location(profile)).activePath ?? join(profile, "workspace"));
  if (path === dirname(path) || inside(source, path) || inside(path, source) || inside(path, resolve(profile))) throw new Error("Нельзя переносить данные в корень диска, внутрь текущего хранилища или в его родительскую папку");
  const names = await readdir(path);
  if (names.length) {
    const marker = await readFile(join(path, markerName), "utf8").then(text => JSON.parse(text), () => undefined);
    if (marker?.workspace !== resolve(profile, "workspace") || marker?.state !== "copying") throw new Error("Выберите пустую папку: чужие или существующие данные не перезаписываются");
    const checkLinks = async (directory: string): Promise<void> => {
      for (const name of await readdir(directory)) {
        const child = join(directory, name), info = await lstat(child);
        if (info.isSymbolicLink()) throw new Error("В папке назначения обнаружена ссылка; выберите другую пустую папку");
        if (info.isDirectory()) await checkLinks(child);
      }
    };
    await checkLinks(path);
  }
  return path;
}
export async function scheduleWorkspaceMove(profile: string, target?: string): Promise<WorkspaceStorageInfo> {
  const saved = await location(profile);
  if (saved.switching || saved.childSwitch) throw new Error("Сначала завершите восстановление начатого переноса при запуске приложения");
  if (saved.retainedPath && target) throw new Error("Сначала завершите перенос прежнего хранилища: Windows удерживает его папку, исходная копия сохранена");
  const pendingPath = target ? await validateTarget(profile, target) : undefined;
  await atomicWrite(locationFile(profile), JSON.stringify({ activePath: saved.activePath, retainedPath: saved.retainedPath, pendingPath }));
  return workspaceStorageInfo(profile);
}

/** A directory handle may lock only the workspace container. Switch its checked
 * children instead; the original root stays in place, with no ACL changes. */
async function recoverChildSwitch(profile: string, saved: Location): Promise<void> {
  const logical = resolve(profile, "workspace"), target = saved.pendingPath!;
  const owner = JSON.parse(await readFile(join(target, markerName), "utf8"));
  if (owner.workspace !== logical) throw new Error("Не подтверждена папка назначения переноса");
  const entries = saved.childSwitch!;
  for (const entry of entries) {
    if (dirname(entry.source) !== logical || entry.target !== join(target, basename(entry.source))
      || dirname(entry.backup) !== dirname(logical) || !basename(entry.backup).startsWith(`${basename(logical)}.gws-child-`)) throw new Error("Некорректная запись переключения папок");
  }
  if (saved.activePath === target) {
    // Commit was durable before removing any source copy.
    for (const entry of entries) {
      if (!await lstat(entry.source).then(info => info.isSymbolicLink(), () => false)
        || await realpath(entry.source) !== await realpath(entry.target)) throw new Error("Изменена ссылка хранилища; прежние копии сохранены");
    }
    for (const entry of entries) await rm(entry.backup, { recursive: true, force: true });
    await atomicWrite(locationFile(profile), JSON.stringify({ activePath: target }));
    return;
  }
  // Interrupted before commit: restore the old directories. Only our exact new
  // junctions may be unlinked; pre-existing external junction targets survive.
  for (const entry of [...entries].reverse()) {
    if (!await lstat(entry.backup).catch(() => undefined)) continue;
    const source = await lstat(entry.source).catch(() => undefined);
    if (source) {
      if (!source.isSymbolicLink() || await realpath(entry.source) !== await realpath(entry.target)) throw new Error("Папка изменена после прерывания переноса; обе копии сохранены");
      await rm(entry.source, { recursive: true });
    }
    await rename(entry.backup, entry.source);
  }
  await atomicWrite(join(target, markerName), JSON.stringify({ workspace: logical, state: "copying" }));
  await atomicWrite(locationFile(profile), JSON.stringify({ activePath: saved.activePath, pendingPath: target }));
}

async function switchWorkspaceChildren(profile: string, target: string, progress: (message: string) => void): Promise<void> {
  const logical = resolve(profile, "workspace"), names = (await readdir(logical)).filter(name => name !== markerName);
  if (!names.length) throw new Error("Нет папок для переключения хранилища");
  const entries: ChildSwitch[] = [];
  for (const name of names) {
    const source = join(logical, name);
    if (!(await stat(source)).isDirectory()) throw new Error("Контейнер хранилища занят; автоматическое переключение отдельного файла не поддерживается");
    entries.push({ source, target: join(target, name), backup: join(dirname(logical), `${basename(logical)}.gws-child-${randomUUID()}-${name}`) });
  }
  const journal: Location = { pendingPath: target, childSwitch: entries };
  await atomicWrite(locationFile(profile), JSON.stringify(journal));
  progress("Переключаю проверенные внутренние папки; контейнер workspace остаётся на месте…");
  try {
    for (const entry of entries) { await rename(entry.source, entry.backup); await symlink(entry.target, entry.source, "junction"); }
    await atomicWrite(join(target, markerName), JSON.stringify({ workspace: logical, state: "ready" }));
    await atomicWrite(locationFile(profile), JSON.stringify({ ...journal, activePath: target }));
  } catch (error) {
    await recoverChildSwitch(profile, journal);
    throw error;
  }
  progress("Ссылки переключены. Освобождаю проверенные прежние копии…");
  await recoverChildSwitch(profile, { ...journal, activePath: target });
}

/** Runs BEFORE repositories, providers or queue start. Old absolute paths keep
 * working through a junction; migration never rewrites scripts or paid IDs. */
export async function moveWorkspaceOnStartup(profile: string, progress: (message: string) => void): Promise<void> {
  const saved = await location(profile), pending = saved.pendingPath;
  if (!pending) return;
  const logical = resolve(profile, "workspace");
  let switched = false;
  let backupPath: string | undefined;
  try {
    if (saved.childSwitch) {
      await recoverChildSwitch(profile, saved);
      if (saved.activePath === pending) return;
    }
    // The journal closes the rename -> junction crash window. Restore the old
    // directory before retrying, or finish cleanup after a completed switch.
    if (saved.switching) {
      const { source, backup } = saved.switching;
      if (dirname(backup) !== dirname(source) || !basename(backup).startsWith(`${basename(source)}.gws-move-`) || source === dirname(source)) throw new Error("Некорректная запись переноса; исходные файлы не изменены");
      const exists = await lstat(backup).catch(() => undefined);
      const owner = await readFile(join(exists ? backup : pending, markerName), "utf8").then(text => JSON.parse(text), () => undefined);
      if (source !== logical && owner?.workspace !== logical) throw new Error("Не подтверждена резервная папка переноса");
      if (!await lstat(source).catch(() => undefined)) await rename(backup, source);
      else if (await realpath(source) === await realpath(pending)) {
        switched = true; backupPath = backup;
        await rm(backup, { recursive: true, force: true });
        await atomicWrite(locationFile(profile), JSON.stringify({ activePath: pending })); return;
      }
    }
    const source = await realpath(saved.activePath ?? logical);
    // A crash after the verified switch only needs to clear the pending flag.
    if (source === await realpath(pending)) { await atomicWrite(locationFile(profile), JSON.stringify({ activePath: pending })); return; }
    const target = await validateTarget(profile, pending);
    const owner = await readFile(join(source, markerName), "utf8").then(text => JSON.parse(text), () => undefined);
    if (source !== logical && owner?.workspace !== logical) throw new Error("Текущая внешняя папка не была создана переносом GoldWork; автоматическое удаление её содержимого запрещено");
    let files: Array<{ path: string; relative: string; bytes: number; modified: number; inode: string }> = [];
    const walk = async (directory: string, ancestors: Set<string>) => {
      const physical = await realpath(directory);
      if (ancestors.has(physical)) throw new Error("Обнаружена циклическая ссылка в хранилище");
      const next = new Set(ancestors).add(physical);
      for (const name of await readdir(directory)) {
        if (directory === source && name === markerName) continue;
        const path = join(directory, name), info = await stat(path);
        if (info.isDirectory()) await walk(path, next);
        else if (info.isFile()) files.push({ path, relative: relative(source, path), bytes: info.size, modified: info.mtimeMs, inode: `${info.dev}:${info.ino}` });
      }
    };
    progress("Проверяю файлы и свободное место…"); await walk(source, new Set());
    const isImmutable = (path: string) => /^[a-f0-9]{64}\.(?:mp4|mov|webm|mkv|png|jpg|jpeg|webp|wav|mp3)$/i.test(basename(path));
    // Only immutable media keep hard links. Mutable aliases are copied separately.
    const missingCopies = new Map<string, number>();
    for (const file of files) {
      const present = await stat(resolve(target, file.relative)).catch(() => undefined);
      // An interrupted transfer already occupies space on the target. Hashes
      // are verified below; a bad copy must pass the per-copy budget as well.
      if (present?.size !== file.bytes) missingCopies.set(isImmutable(file.path) ? file.inode : file.relative, file.bytes);
    }
    const uniqueBytes = [...missingCopies.values()].reduce((n, bytes) => n + bytes, 0);
    const disk = await statfs(target);
    if (disk.bavail * disk.bsize < uniqueBytes + 1024 ** 3) throw new Error(`На выбранном диске нужно не менее ${Math.ceil(uniqueBytes / 1024 ** 3) + 1} ГБ свободного места`);
    await atomicWrite(join(target, markerName), JSON.stringify({ workspace: logical, state: "copying" }));
    const contentCopies = new Map<string, string>();
    const sourceHashes = new Map<string, string>();
    const destinationHashes = new Map<string, string>();
    let done = 0;
    for (const file of files) {
      const output = resolve(target, file.relative);
      if (!inside(target, output) || output === target) throw new Error("Путь файла вышел за папку назначения");
      await mkdir(dirname(output), { recursive: true });
      const revision = `${file.inode}:${file.bytes}:${file.modified}`;
      const hash = sourceHashes.get(revision) ?? await checksum(file.path), key = `${hash}:${file.bytes}`;
      if (!file.inode.endsWith(":0")) sourceHashes.set(revision, hash);
      const immutable = isImmutable(file.path);
      const first = immutable ? contentCopies.get(key) : undefined;
      const present = await stat(output).catch(() => undefined);
      let destinationHash: string | undefined;
      if (present?.size === file.bytes) {
        const revision = `${present.dev}:${present.ino}:${present.size}:${present.mtimeMs}`;
        destinationHash = destinationHashes.get(revision) ?? await checksum(output);
        if (present.ino !== 0) destinationHashes.set(revision, destinationHash);
      }
      if (destinationHash !== hash) {
        const temporary = output + `.copy-${randomUUID()}`;
        try {
          const copy = async () => {
            const available = await statfs(target);
            if (available.bavail * available.bsize < file.bytes + 1024 ** 3) throw new Error("На выбранном диске недостаточно места для следующего файла; исходники сохранены");
            await copyFile(file.path, temporary, constants.COPYFILE_EXCL);
          };
          if (first) await link(first, temporary).catch(copy);
          else await copy();
          if (await checksum(temporary) !== hash) throw new Error(`Не совпала копия: ${file.relative}`);
          await rename(temporary, output);
        } finally { await rm(temporary, { force: true }).catch(() => {}); }
      }
      if (immutable) contentCopies.set(key, first ?? output);
      done++; progress(`Перенос и проверка: ${done} из ${files.length} файлов`);
    }
    const snapshot = files; files = []; await walk(source, new Set());
    const unchanged = new Map(files.map(file => [file.relative, file]));
    if (snapshot.length !== files.length || snapshot.some(file => { const now = unchanged.get(file.relative); return !now || now.bytes !== file.bytes || now.modified !== file.modified; })) throw new Error("Исходные данные изменились во время переноса; старое хранилище сохранено");
    const backup = join(dirname(source), `${basename(source)}.gws-move-${randomUUID()}`);
    if (source === dirname(source) || !inside(dirname(source), backup) || backup === source) throw new Error("Небезопасный путь резервной папки");
    backupPath = backup;
    await atomicWrite(locationFile(profile), JSON.stringify({ activePath: saved.activePath, pendingPath: target, switching: { source, backup } }));
    // Windows thumbnail/antivirus readers can briefly hold the directory after
    // verification. Retry only this local, uncommitted rename; never delete it.
    for (let attempt = 0; ; attempt++) {
      try { await rename(source, backup); break; }
      catch (error) {
        if (!["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        if (attempt >= 4) {
          if (source !== logical || saved.activePath) throw error;
          try { await switchWorkspaceChildren(profile, target, progress); }
          catch (childError) {
            const recovered = await location(profile);
            if (recovered.childSwitch || !["EPERM", "EBUSY", "EACCES"].includes((childError as NodeJS.ErrnoException).code ?? "")) throw childError;
            // A descendant may itself be held as another process's directory.
            // The verified copy is usable: direct new writes there, retaining
            // every old path/file until a later unlocked cleanup. No deletion.
            await atomicWrite(join(target, markerName), JSON.stringify({ workspace: logical, state: "ready" }));
            await atomicWrite(locationFile(profile), JSON.stringify({ activePath: target, retainedPath: logical }));
            progress("Новое хранилище активно. Windows удерживает старую папку: исходная копия пока сохранена полностью.");
          }
          return;
        }
        await delay(250 * (attempt + 1));
      }
    }
    try { await symlink(target, source, "junction"); }
    catch (error) { await rename(backup, source); throw error; }
    switched = true;
    await atomicWrite(join(target, markerName), JSON.stringify({ workspace: logical, state: "ready" }));
    // Every ordinary file was copied and hashed. rm removes nested junctions,
    // not their external targets; those pre-existing external copies stay intact.
    progress("Копии проверены. Освобождаю прежнюю папку…");
    await rm(backup, { recursive: true });
    await atomicWrite(locationFile(profile), JSON.stringify({ activePath: target }));
  } catch (error) {
    const usable = await stat(logical).then(info => info.isDirectory(), () => false);
    const journal = await location(profile);
    await atomicWrite(locationFile(profile), JSON.stringify({ ...(!usable || switched || journal.childSwitch ? journal : { activePath: saved.activePath }), error: `${switched || journal.activePath === pending ? `Перенос выполнен, но очистка старой папки не завершена (${backupPath ?? "проверенные копии"})` : "Перенос не выполнен; исходные файлы сохранены"}: ${error instanceof Error ? error.message : String(error)}` }));
    if (!usable || journal.childSwitch && journal.activePath !== pending) throw error;
  }
}
