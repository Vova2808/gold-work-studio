import {setImmediate} from 'node:timers/promises';
import type {Project} from '@gold-work/shared';

/** Preserve the existing JSON format without a second registry-sized string
 * and UTF-8 buffer. A long documentary can contain thousands of candidates. */
function* projectParts(project: Project): Generator<string> {
  yield '{';
  let separator = '';
  for (const [key, value] of Object.entries(project)) {
    if (key === 'scenes' && Array.isArray(value)) {
      yield `${separator}"scenes":[`;
      for (let i = 0; i < value.length; i++) {
        if (i) yield ',';
        yield JSON.stringify(value[i]) ?? 'null';
      }
      yield ']';
    } else {
      const json = JSON.stringify(value);
      if (json === undefined) continue;
      yield `${separator}${JSON.stringify(key)}:${json}`;
    }
    separator = ',';
  }
  yield '}';
}

function* registryParts(projects: Project[]): Generator<string> {
  yield '[';
  for (let i = 0; i < projects.length; i++) {
    if (i) yield ',';
    yield* projectParts(projects[i]!);
  }
  yield ']';
}

async function* boundedChunks(parts: Iterable<string>): AsyncGenerator<string> {
  let chunk = '';
  for (const part of parts) {
    chunk += part;
    if (chunk.length < 128 * 1024) continue;
    yield chunk;
    chunk = '';
    // Allow queued network/progress/cancel callbacks between serialization batches.
    await setImmediate();
  }
  if (chunk) yield chunk;
}

export const projectJsonChunks = (project: Project) => boundedChunks(projectParts(project));
export const registryJsonChunks = (projects: Project[]) => boundedChunks(registryParts(projects));
