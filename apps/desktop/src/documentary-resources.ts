import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { availableParallelism, freemem } from "node:os";

const execFileAsync = promisify(execFile);
export const DOCUMENTARY_MEMORY_RESERVE = 1024 ** 3;
/** Match the provider and analysis lanes so extra scenes do not queue up
 * searches and paid reviews while holding their own candidate pools in RAM. */
export function documentarySelectionWorkers(cores:number,physicalBytes:number,commitBytes:number):number {
  const headroom=Math.min(physicalBytes,commitBytes);
  if(![cores,headroom].every(Number.isFinite))return 4;
  if(headroom<1.25*1024**3)return 1;
  return Math.max(2,Math.min(4,Math.max(2,cores),Math.floor((headroom-.75*1024**3)/(.4*1024**3))));
}

/** Re-evaluate memory after each completed scene. Existing paid work drains;
 * a reduced limit only prevents another scene from starting alongside it. */
export async function runDocumentarySelectionQueue<T>(items:readonly T[],work:(item:T)=>Promise<void>,capacity:()=>Promise<number>,stopped:()=>boolean):Promise<void>{
  let cursor=0;
  let failure:unknown;
  const active=new Set<Promise<void>>();
  try {
    while(cursor<items.length&&!stopped()&&!failure){
      const limit=Math.max(1,Math.min(8,await capacity()));
      while(active.size<limit&&cursor<items.length&&!stopped()){
        const item=items[cursor++]!;
        const job=Promise.resolve().then(()=>work(item)).catch(error=>{failure??=error;}).finally(()=>active.delete(job));
        active.add(job);
      }
      if(active.size)await Promise.race(active);
    }
  } finally { await Promise.allSettled(active); }
  if(failure)throw failure;
}
export async function documentarySelectionResources():Promise<{workers:number;physicalBytes:number;commitBytes:number}> {
  const physicalBytes=freemem(),commitBytes=await documentaryAvailableMemory();
  return {workers:documentarySelectionWorkers(availableParallelism(),physicalBytes,commitBytes),physicalBytes,commitBytes};
}

/** Physical pressure can cause heavy paging even with commit space available.
 * Keep one decoder running so a waiting selection can still make progress. */
export function documentaryFrameWorkers(cores:number,physicalBytes:number):number {
  const cpuLimit=Math.max(1,Math.min(3,Math.floor(cores/4)));
  if(!Number.isFinite(cpuLimit)||!Number.isFinite(physicalBytes))return 1;
  const memoryLimit=physicalBytes<2*1024**3?1:physicalBytes<3.5*1024**3?2:3;
  return Math.min(cpuLimit,memoryLimit);
}

/** Recheck pressure before each queued decoder; never interrupt active work. */
export function createDocumentaryFrameQueue(capacity:()=>number) {
  let active=0;
  const waiting:Array<()=>void>=[];
  const drain=()=>{
    while(waiting.length){
      const measured=capacity();
      const limit=Number.isFinite(measured)?Math.max(1,Math.min(3,measured)):1;
      if(active>=limit)return;
      active++;waiting.shift()!();
    }
  };
  return <T>(work:()=>Promise<T>):Promise<T>=>new Promise<T>((resolve,reject)=>{
    waiting.push(()=>{
      Promise.resolve().then(work).then(resolve,reject).finally(()=>{active--;drain();});
    });
    drain();
  });
}

/** More network jobs must not start a separate decoder pool for every scene.
 * The cheap physical-memory sample avoids spawning PowerShell per JPEG. */
export const withDocumentaryFrameSlot=createDocumentaryFrameQueue(
  ()=>documentaryFrameWorkers(availableParallelism(),freemem()));
/** Leave RAM for Electron/Windows and cap decoding pressure on modest machines. */
export function documentaryRenderWorkers(cores:number,physicalBytes:number,commitBytes:number):number {
  if(![cores,physicalBytes,commitBytes].every(Number.isFinite))return 2;
  if(Math.min(physicalBytes,commitBytes)<2*1024**3)return 1;
  const memoryWorkers=Math.floor((Math.min(physicalBytes,commitBytes)-1.25*1024**3)/(512*1024**2));
  // The local A/B check showed that falling from two workers to one at 3 GB
  // free slows rendering by ~40%; retain the established pair outside pressure.
  // A measured 1080p photo/card segment took 27.43 s with three pages and
  // 24.42 s with six. Permit that headroom only when CPU and memory allow it;
  // the previous 2/3-page limits remain at 2.5/3.2 GB available.
  return Math.max(1,Math.min(6,Math.max(1,Math.floor(cores/2)),Math.max(2,memoryWorkers)));
}
export async function documentaryRenderResources(){
  const physicalBytes=freemem(),cores=availableParallelism();
  try {
    const commitBytes=await documentaryAvailableMemory();
    return {cores,physicalBytes,commitBytes,workers:documentaryRenderWorkers(cores,physicalBytes,commitBytes)};
  } catch { return {cores,physicalBytes,workers:2}; }
}
export class DocumentaryMemoryUnavailableError extends Error {}

/** Windows can exhaust its commit limit while physical RAM still appears free. */
let memorySample:{at:number;job:Promise<number>}|undefined;
export async function documentaryAvailableMemory(): Promise<number> {
  if(memorySample&&Date.now()-memorySample.at<2000)return memorySample.job;
  const job=probeDocumentaryMemory();memorySample={at:Date.now(),job};
  try{return await job;}catch(error){if(memorySample?.job===job)memorySample=undefined;throw error;}
}
async function probeDocumentaryMemory(): Promise<number> {
  if (process.platform !== "win32") return freemem();
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "[Console]::Write((Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory)"],
  { windowsHide: true, timeout: 10000, maxBuffer: 16384 });
  const kib = Number(stdout.trim());
  if (!Number.isFinite(kib) || kib <= 0) throw new Error("Не удалось проверить запас памяти Windows; новый платный анализ не отправлен");
  return kib * 1024;
}

export async function ensureDocumentaryMemory(probe: () => Promise<number> = documentaryAvailableMemory): Promise<void> {
  const available = await probe();
  if (!Number.isFinite(available) || available < DOCUMENTARY_MEMORY_RESERVE) {
    throw new DocumentaryMemoryUnavailableError(`Недостаточно памяти для анализа Stock: доступно ${Number.isFinite(available) ? Math.max(0, Math.floor(available / 1024 ** 2)) : 0} МБ. Освободите память, закрыв ненужные приложения; новый платный запрос не отправлен. Проверенные материалы сохранены.`);
  }
}
