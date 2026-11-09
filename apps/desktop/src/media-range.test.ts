import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMediaFileResponse } from "./media-range.js";

test("long media is read in bounded chunks and cancellation does not require loading its tail", async t => {
  const root = await mkdtemp(join(tmpdir(), "gws-media-stream-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "long.mp4"), size = 64 * 1024 * 1024;
  const file = await open(path, "w");
  await file.truncate(size); await file.write(Buffer.from("TAIL"), 0, 4, size - 4); await file.close();
  const response = await createMediaFileResponse(path, "bytes=0-");
  assert.equal(response.status, 206); assert.equal(response.headers.get("content-length"), String(size));
  assert.equal(response.headers.get("content-range"), `bytes 0-${size - 1}/${size}`);
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.ok(first.value!.length > 0 && first.value!.length <= 64 * 1024, "A range response must not buffer the whole movie");
  await reader.cancel(); reader.releaseLock();
  const next = await createMediaFileResponse(path, `bytes=${4 * 1024 * 1024}-`);
  assert.equal(next.headers.get("content-range"), `bytes ${4 * 1024 * 1024}-${size - 1}/${size}`);
  await next.body!.cancel();
  const tail = await createMediaFileResponse(path, "bytes=-4");
  assert.equal(await tail.text(), "TAIL");
  assert.equal(tail.headers.get("content-range"), `bytes ${size - 4}-${size - 1}/${size}`);
});
