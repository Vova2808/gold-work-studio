import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";

export interface MediaByteRange {
  start: number;
  end: number;
}

/** undefined means a full response; null means an invalid or unsatisfiable range. */
export function parseMediaByteRange(value: string | null, size: number): MediaByteRange | null | undefined {
  if (!value) return undefined;
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (match[1]) {
    const start = Number(match[1]);
    if (!Number.isSafeInteger(start) || start < 0 || start >= size) return null;
    const requestedEnd = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;
    return { start, end: Math.min(size - 1, requestedEnd) };
  }

  const suffixLength = Number(match[2]);
  if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
  return { start: Math.max(0, size - suffixLength), end: size - 1 };
}

export async function createMediaFileResponse(filePath: string, rangeHeader: string | null, signal?: AbortSignal): Promise<Response> {
  const info = await stat(filePath);
  const range = parseMediaByteRange(rangeHeader, info.size);
  if (range === null) {
    return new Response(null, {
      status: 416,
      headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${info.size}` }
    });
  }
  const start = range?.start ?? 0;
  // Honor the requested range completely. Chromium's custom-protocol decoder
  // can report readyState=4 yet display black after an artificially shortened
  // open-ended range. Backpressure limits memory, not truncating the response.
  const end = range?.end ?? info.size - 1;
  const size = end - start + 1;
  const mime = ({
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml"
  } as Record<string, string>)[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  // Chromium often asks for bytes=0- of a long source. Stream with BYTE-based
  // backpressure instead of allocating the whole movie (and copying it again
  // into Response). Cancelling a player also closes this file stream.
  const body = size > 0 ? Readable.toWeb(createReadStream(filePath, { start, end, highWaterMark: 64 * 1024, signal }), {
    strategy: { highWaterMark: 128 * 1024, size: chunk => chunk.byteLength }
  }) as ReadableStream<Uint8Array> : null;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Length": String(size),
      "Content-Type": mime,
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {})
    }
  });
}
