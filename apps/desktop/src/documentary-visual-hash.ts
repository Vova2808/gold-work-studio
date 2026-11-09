import { readFile, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { effectFfmpeg } from "./effect-media.js";
import {withDocumentaryFrameSlot} from './documentary-resources.js';
const hashes=new Map<string,Promise<string>>();

/** Perceptual dHash flags recrops/resizes for review; it is not object recognition. */
export async function documentaryVisualHash(poster: string): Promise<string> {
  const info=await stat(poster),key=JSON.stringify([poster,info.size,info.mtimeMs]);
  const saved=hashes.get(key);if(saved)return saved;
  const pending=calculateVisualHash(poster);
  hashes.set(key,pending);
  if(hashes.size>256)hashes.delete(hashes.keys().next().value!);
  try{return await pending;}catch(error){hashes.delete(key);throw error;}
}
async function calculateVisualHash(poster:string):Promise<string>{
  const target = join(dirname(poster), `${randomUUID()}.gray`);
  try {
    await withDocumentaryFrameSlot(()=>effectFfmpeg(["-y", "-i", poster, "-vf", "scale=9:8,format=gray", "-frames:v", "1", "-f", "rawvideo", target]));
    const pixels = await readFile(target);
    if (pixels.length !== 72) throw new Error("Не удалось проверить сходство кадра");
    let value = 0n;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) value = (value << 1n) | (pixels[y * 9 + x]! > pixels[y * 9 + x + 1]! ? 1n : 0n);
    return value.toString(16).padStart(16, "0");
  } finally { await rm(target, { force: true }).catch(() => {}); }
}
export function visualHashDistance(a: string, b: string): number {
  if (!/^[a-f0-9]{16}$/.test(a) || !/^[a-f0-9]{16}$/.test(b)) return 64;
  let bits = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), distance = 0;
  while (bits) { bits &= bits - 1n; distance++; }
  return distance;
}
