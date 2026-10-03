import type {FileHandle} from 'node:fs/promises';
import type {Project} from '@gold-work/shared';
import {projectForDisplay} from './project-display.js';

export interface ProjectRegistryEntry {
  display: Project;
  start: number;
  end: number; // Exclusive byte offset, not a UTF-16 character offset.
}

/** Index the existing JSON array one project at a time. Only display metadata
 * stays in memory; full candidate evidence remains in the unchanged JSON file. */
export async function indexProjectRegistry(file: FileHandle): Promise<ProjectRegistryEntry[]> {
  const entries: ProjectRegistryEntry[] = [];
  let state: 'array' | 'first' | 'project' | 'separator' | 'done' = 'array';
  let position = 0, start = 0, depth = 0, quoted = false, escaped = false;
  let parts: Buffer[] = [];
  const stream = file.createReadStream({autoClose: false, start: 0, highWaterMark: 256 * 1024});
  for await (const buffer of stream) {
    const chunk = buffer as Buffer;
    let partStart = depth ? 0 : -1;
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i]!;
      if (depth) {
        if (quoted) {
          if (escaped) escaped = false;
          else if (byte === 92) escaped = true;
          else if (byte === 34) quoted = false;
        } else if (byte === 34) quoted = true;
        else if (byte === 123 || byte === 91) depth++;
        else if (byte === 125 || byte === 93) {
          depth--;
          if (!depth) {
            parts.push(chunk.subarray(partStart, i + 1));
            const project = JSON.parse(Buffer.concat(parts).toString('utf8')) as Project;
            if (!project || typeof project.id !== 'string' || !Array.isArray(project.scenes)) {
              throw new SyntaxError('Некорректная запись проекта в реестре');
            }
            entries.push({display: projectForDisplay(project), start, end: position + i + 1});
            parts = [];
            partStart = -1;
            state = 'separator';
          }
        }
        continue;
      }
      if (byte === 32 || byte === 10 || byte === 13 || byte === 9) continue;
      if (state === 'array' && byte === 91) { state = 'first'; continue; }
      if ((state === 'first' || state === 'separator') && byte === 93) { state = 'done'; continue; }
      if (state === 'separator' && byte === 44) { state = 'project'; continue; }
      if ((state === 'first' || state === 'project') && byte === 123) {
        start = position + i;
        partStart = i;
        depth = 1;
        continue;
      }
      throw new SyntaxError('Некорректный JSON реестра проектов');
    }
    if (partStart >= 0) parts.push(chunk.subarray(partStart));
    position += chunk.length;
  }
  if (state !== 'done' || depth) throw new SyntaxError('Реестр проектов обрезан');
  return entries.sort((a, b) => (b.display.updatedAt ?? '').localeCompare(a.display.updatedAt ?? ''));
}

export async function readRegistryProject(file: FileHandle, entry: ProjectRegistryEntry): Promise<Project> {
  const chunks: Buffer[] = [];
  for await (const chunk of registryProjectBytes(file, entry)) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Project;
}

/** Positional reads stay attached to this snapshot even when an atomic save
 * replaces projects.json while another reader is using its old offsets. */
export async function* registryProjectBytes(file: FileHandle, entry: ProjectRegistryEntry): AsyncGenerator<Buffer> {
  let position = entry.start;
  while (position < entry.end) {
    const buffer = Buffer.allocUnsafe(Math.min(256 * 1024, entry.end - position));
    const {bytesRead} = await file.read(buffer, 0, buffer.length, position);
    if (!bytesRead) throw new Error('Реестр проектов изменился во время чтения');
    position += bytesRead;
    yield buffer.subarray(0, bytesRead);
  }
}
