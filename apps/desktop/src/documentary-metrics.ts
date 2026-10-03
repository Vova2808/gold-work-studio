import { randomUUID } from "node:crypto";
import { recordDiagnosticEvent } from "./diagnostics.js";
import {join} from 'node:path';
import {atomicWrite} from './fs-utils.js';

type Stage={calls:number;failed:number;requestMs:number;intervals:Array<[number,number]>};
type Run={projectId:string;id:string;directory:string;started:number;mode:'production'|'export';stages:Map<string,Stage>;lastWrite:number;writing?:Promise<void>};
const runs=new Map<string,Run>();
export function documentaryIntervalUnion(intervals:Array<[number,number]>):Array<[number,number]>{
  const result:Array<[number,number]>=[];
  for(const [start,end] of [...intervals].sort((a,b)=>a[0]-b[0])){
    const last=result.at(-1);if(last&&start<=last[1])last[1]=Math.max(last[1],end);else result.push([start,end]);
  }
  return result;
}
async function saveRun(run:Run,status='running'){
  const stages=Object.fromEntries([...run.stages].map(([name,s])=>[name,{calls:s.calls,failed:s.failed,requestSeconds:s.requestMs/1000,
    activeSeconds:s.intervals.reduce((sum,[start,end])=>sum+end-start,0)/1000}]));
  const report={version:1,runId:run.id,projectId:run.projectId,mode:run.mode,status,startedAt:new Date(run.started).toISOString(),updatedAt:new Date().toISOString(),elapsedSeconds:(Date.now()-run.started)/1000,
    note:'Этапы перекрываются: activeSeconds нельзя складывать. calls включает обращения к кешу и не означает число оплаченных запросов.',stages};
  await atomicWrite(join(run.directory,'Documentary','production-timing.json'),JSON.stringify(report,null,2));
  const duration=(seconds:number)=>{const rounded=Math.round(seconds);return `${Math.floor(rounded/60)} мин ${rounded%60} с`;};
  const labels:Record<string,string>={planning:'Подготовка плана',narration:'Озвучка',search:'Поиск материалов',download:'Загрузка материалов',analysis:'Проверка содержания', 'media-preparation':'Подготовка медиа',render:'Экспорт видео'};
  const lines=['Gold Work Studio — время сборки',`Режим: ${run.mode==='production'?'полное производство':'экспорт готового проекта'}`,
    `Состояние: ${{running:'в работе',complete:'готово',failed:'остановлено с ошибкой',cancelled:'остановлено пользователем'}[status]??status}`,
    `Общее время с запуска: ${duration(report.elapsedSeconds)}`,'',...Object.entries(stages).map(([name,s])=>`${labels[name]??name}: ${duration(s.activeSeconds)}`),'',
    'Этапы выполняются параллельно. Их длительности нельзя складывать: общее ожидание указано отдельно.','Количество платных запросов здесь не оценивается.'];
  await atomicWrite(join(run.directory,'Documentary','production-timing.txt'),lines.join('\r\n'));
}
export async function startDocumentaryMetrics(projectId:string,directory:string,mode:Run['mode']='production'){
  if(runs.has(projectId))return;
  const run:Run={projectId,id:randomUUID(),directory,mode,started:Date.now(),stages:new Map(),lastWrite:Date.now()};runs.set(projectId,run);
  await saveRun(run).catch(()=>{});
}
export function addDocumentaryInterval(projectId:string,stage:string,start:number,end:number,success=true){
  const run=runs.get(projectId);if(!run||start<run.started)return;
  const value=run.stages.get(stage)??{calls:0,failed:0,requestMs:0,intervals:[]};
  value.calls++;value.failed+=Number(!success);value.requestMs+=end-start;value.intervals=documentaryIntervalUnion([...value.intervals,[start,end]]);run.stages.set(stage,value);
  if(!run.writing&&Date.now()-run.lastWrite>=2000){run.lastWrite=Date.now();run.writing=saveRun(run).catch(()=>{}).finally(()=>{run.writing=undefined;});}
}
export async function finishDocumentaryMetrics(projectId:string,status:'complete'|'failed'|'cancelled'){
  const run=runs.get(projectId);if(!run)return;
  await run.writing;await saveRun(run,status).catch(()=>{});
  const {readFile}=await import('node:fs/promises');
  await readFile(join(run.directory,'Documentary','production-timing.json'),'utf8')
    .then(raw=>atomicWrite(join(run.directory,'Documentary','Timing',`${run.id}.json`),raw)).catch(()=>{});
  if(runs.get(projectId)===run)runs.delete(projectId);
}

/** Absolute intervals permit wall-time unions across overlapping workers.
 * Never present the sum of request durations as production elapsed time. */
export async function measureDocumentaryStage<T>(stage: string, details: Record<string, unknown>, work: () => Promise<T>): Promise<T> {
  const started = Date.now(), intervalId = randomUUID();
  let success = false;
  recordDiagnosticEvent("info", "documentary.stage.started", { ...details, stage, intervalId, startedAt: new Date(started).toISOString() });
  try { const value = await work(); success = true; return value; }
  finally {
    if(typeof details.projectId==='string')addDocumentaryInterval(details.projectId,stage,started,Date.now(),success);
    recordDiagnosticEvent("info", "documentary.stage.finished", { ...details, stage, intervalId, startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started, success });
  }
}
