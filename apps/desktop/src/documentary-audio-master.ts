import { copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export const DOCUMENTARY_MASTER_TARGET_LUFS = -16;
export const DOCUMENTARY_MASTER_TRUE_PEAK_DBTP = -2;

interface LoudnessMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

function run(executable: string, args: string[], signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stderr = '';
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-16000); });
    child.once('error', reject);
    child.once('close', code => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(signal.reason);
      else if (code === 0) resolve(stderr);
      else reject(new Error(`FFmpeg loudness master failed (${code}): ${stderr.trim()}`));
    });
  });
}

function parseMeasurement(stderr: string): LoudnessMeasurement | undefined {
  const match = [...stderr.matchAll(/\{[^{}]*"input_i"[^{}]*\}/gs)].at(-1)?.[0];
  if (!match) return;
  try {
    const value = JSON.parse(match) as LoudnessMeasurement;
    if (['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'].every(key => typeof value[key as keyof LoudnessMeasurement] === 'string')) return value;
  } catch { /* FFmpeg can omit JSON for an empty input. */ }
}

/** Measure and master the completed mix once. An all-silent mix is copied unchanged. */
export async function masterDocumentaryAudio(input: string, output: string, signal?: AbortSignal): Promise<{ silent: boolean }> {
  const executable = ffmpegPath?.replace('app.asar', 'app.asar.unpacked');
  if (!executable) throw new Error('FFmpeg не найден');
  const measured = await run(executable, ['-hide_banner', '-nostats', '-i', input,
    '-af', `loudnorm=I=${DOCUMENTARY_MASTER_TARGET_LUFS}:TP=${DOCUMENTARY_MASTER_TRUE_PEAK_DBTP}:LRA=11:print_format=json`,
    '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'], signal);
  const stats = parseMeasurement(measured);
  const inputI = Number(stats?.input_i);
  if (!stats || !Number.isFinite(inputI)) {
    await copyFile(input, output);
    return { silent: true };
  }
  const filter = `loudnorm=I=${DOCUMENTARY_MASTER_TARGET_LUFS}:TP=${DOCUMENTARY_MASTER_TRUE_PEAK_DBTP}:LRA=11:`
    + `measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:`
    + `measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true:print_format=summary`;
  await run(executable, ['-y', '-hide_banner', '-nostats', '-i', input, '-af', filter, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', output], signal);
  return { silent: false };
}
