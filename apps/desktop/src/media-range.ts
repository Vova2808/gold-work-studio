import { open, stat } from "node:fs/promises";
import { extname } from "node:path";

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

export async function createMediaFileResponse(filePath: string, rangeHeader: string | null): Promise<Response> {
  const info = await stat(filePath);
  const range = parseMediaByteRange(rangeHeader, info.size);
  if (range === null) {
    return new Response(null, {
      status: 416,
      headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${info.size}` }
    });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? info.size - 1;
  const size = end - start + 1;
  const mime = ({
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp"
  } as Record<string, string>)[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const body = new Uint8Array(size);
  const handle = await open(filePath, "r");
  let offset = 0;
  try {
    while (offset < size) {
      const { bytesRead } = await handle.read(body, offset, size - offset, start + offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return new Response(offset === size ? body : body.slice(0, offset), {
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
