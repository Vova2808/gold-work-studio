import {constants, createReadStream} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {copyFile, open, readFile, readdir, stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {Project} from '@gold-work/shared';
import {FileProjectRepository, ProjectRegistryCorruptError} from './file-project-repository.js';
import {atomicWrite} from './fs-utils.js';
import {projectForDisplay} from './project-display.js';

export interface ProjectRegistryRecovery {
  backupPath: string;
  reportPath: string;
  recoveredIds: string[];
  skipped: {path: string; reason: string}[];
  excludedDeletedIds: string[];
}

async function revision(path: string): Promise<string> {
  const info = await stat(path, {bigint: true});
  return `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
}

async function checksum(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Only called before startup migrations or workers can write projects. A valid
 * registry is never rebuilt; damaged bytes and all source snapshots are retained. */
export async function recoverProjectRegistry(registryPath: string, projectsRoot: string): Promise<ProjectRegistryRecovery | undefined> {
  try {
    await new FileProjectRepository(registryPath).list({omitCandidates: true});
    return undefined;
  } catch (error) {
    if (!(error instanceof ProjectRegistryCorruptError)) throw error;
  }
  const originalRevision = await revision(registryPath);
  const deletedIds = new Set<string>();
  try {
    const trash: unknown = JSON.parse(await readFile(`${registryPath}.trash`, 'utf8'));
    if (!Array.isArray(trash)) throw new Error('Некорректная корзина проектов; автоматическое восстановление остановлено.');
    for (const entry of trash) {
      if (typeof entry?.project?.id === 'string') deletedIds.add(entry.project.id);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const skipped: ProjectRegistryRecovery['skipped'] = [];
  const excludedDeletedIds: string[] = [];
  const recovered: {project: Project; bytes: Buffer}[] = [];
  for (const directory of await readdir(projectsRoot, {withFileTypes: true})) {
    if (!directory.isDirectory() || directory.name.startsWith('.')) continue;
    const path = join(projectsRoot, directory.name, 'project.json');
    let bytes: Buffer;
    try { bytes = await readFile(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      continue;
    }
    try {
      const project = JSON.parse(bytes.toString('utf8')) as Project;
      if (!project || project.id !== directory.name || !Array.isArray(project.scenes)
        || typeof project.title !== 'string' || !project.settings || typeof project.settings !== 'object'
        || project.scenes.some(scene => !scene || typeof scene.id !== 'string')) {
        throw new Error('Неполная запись проекта или ID не совпадает с папкой.');
      }
      // The recovered record must also be readable by the startup/UI index.
      projectForDisplay(project);
      if (deletedIds.has(project.id)) { excludedDeletedIds.push(project.id); continue; }
      recovered.push({project, bytes});
    } catch (error) {
      skipped.push({path, reason: error instanceof Error ? error.message : String(error)});
    }
  }
  if (!recovered.length) throw new Error('Не найдены целые файлы проектов для восстановления. Повреждённый реестр сохранён; запись остановлена.');
  recovered.sort((a, b) => (b.project.updatedAt ?? '').localeCompare(a.project.updatedAt ?? ''));
  const backupPath = `${registryPath}.corrupt-${Date.now()}-${randomUUID()}`;
  await copyFile(registryPath, backupPath, constants.COPYFILE_EXCL);
  const backup = await open(backupPath, 'r+');
  try { await backup.sync(); } finally { await backup.close(); }
  if (await checksum(backupPath) !== await checksum(registryPath) || await revision(registryPath) !== originalRevision) {
    throw new Error('Реестр изменился во время восстановления. Исходные файлы сохранены; запись отменена.');
  }
  const result: ProjectRegistryRecovery = {backupPath, reportPath: `${backupPath}.recovery.json`,
    recoveredIds: recovered.map(({project}) => project.id), skipped, excludedDeletedIds};
  // The recovery plan is durable before replacement, even if Windows interrupts it.
  await atomicWrite(result.reportPath, JSON.stringify({...result, phase: 'prepared'}, null, 2), {allowCopyFallback: false, durable: true});
  async function* chunks(): AsyncGenerator<string | Buffer> {
    yield '[';
    for (let index = 0; index < recovered.length; index++) {
      if (index) yield ',';
      yield recovered[index]!.bytes;
    }
    yield ']';
    if (await revision(registryPath) !== originalRevision) throw new Error('Реестр изменился; восстановление отменено.');
  }
  await atomicWrite(registryPath, chunks(), {allowCopyFallback: false, durable: true});
  await new FileProjectRepository(registryPath).list({omitCandidates: true});
  await atomicWrite(result.reportPath, JSON.stringify({...result, phase: 'completed'}, null, 2), {allowCopyFallback: false, durable: true});
  return result;
}
