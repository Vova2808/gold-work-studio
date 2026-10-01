import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const root=resolve(process.argv[2]??'captures/stock-successor-warm-20260926');
const profile='C:/Users/rosup/AppData/Roaming/@gold-work/desktop';
const events=(await readFile(join(root,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
const begin=events.find(e=>e.stage==='started'),end=events.findLast(e=>e.stage==='failed'||e.stage==='complete');
const logRoot=join(profile,'logs');
const logFiles=(await readdir(logRoot)).filter(name=>/^gold-work-studio-log(?:-previous(?:-\d+)?)?\.txt$/.test(name));
// A long live run can rotate the current 5 MiB log. Its archived intervals
// remain part of this measurement; current-file-only totals undercount them.
const all=(await Promise.all(logFiles.map(name=>readFile(join(logRoot,name),'utf8')))).join('\n').split('\n').flatMap(line=>{
  const match=/\] (documentary\.[\w.-]+) (\{.*\})$/.exec(line);
  if(!match)return [];try{return [{at:line.slice(0,24),event:match[1],...JSON.parse(match[2])}];}catch{return [];}
}).filter(e=>e.buildId===begin.build&&e.projectId===begin.projectId
  && Date.parse(e.at)>=Date.parse(begin.at) && Date.parse(e.at)<=Date.parse(end.at));
const intervals=all.filter(e=>e.event==='documentary.stage.finished');
const union=rows=>{
  let end=-Infinity,total=0;
  for(const r of rows.map(r=>[Date.parse(r.startedAt),Date.parse(r.finishedAt)]).sort((a,b)=>a[0]-b[0])){
    total+=Math.max(0,r[1]-Math.max(end,r[0]));end=Math.max(end,r[1]);
  }return total/1000;
};
const stages=Object.fromEntries([...new Set(intervals.map(e=>e.stage))].map(stage=>{
  const rows=intervals.filter(e=>e.stage===stage);
  return [stage,{count:rows.length,failed:rows.filter(e=>!e.success).length,wallUnionSeconds:union(rows),requestSumSeconds:rows.reduce((n,e)=>n+e.elapsedMs,0)/1000}];
}));
const analysisRoot=join('D:/GoldWorkStorage/projects',begin.projectId,'Documentary/Analysis');
const checkpoints=await Promise.all((await readdir(analysisRoot)).filter(n=>n.endsWith('.json')).map(async n=>JSON.parse(await readFile(join(analysisRoot,n),'utf8'))));
const states=Object.fromEntries([...new Set(checkpoints.map(e=>e.state))].map(state=>[state,checkpoints.filter(e=>e.state===state).length]));
const snapshot=JSON.parse(await readFile(join(root,'project-snapshot.json'),'utf8'));
const report={mode:'warm recovery, not a new TTS benchmark',build:begin.build,projectId:begin.projectId,start:begin.at,end:end.at,elapsedSeconds:(Date.parse(end.at)-Date.parse(begin.at))/1000,
  selected:snapshot.scenes.filter(s=>s.documentary?.verified).length,scenes:snapshot.scenes.length,reusedVoices:114,newTtsOrders:0,final:end.stage==='complete',
  stages,cacheHits:all.filter(e=>e.event==='documentary.analysis.cache').reduce((out,e)=>({...out,[e.cache]:(out[e.cache]??0)+1}),{}),
  mediaCacheHits:intervals.filter(e=>e.stage==='media-preparation'&&e.sourceCacheHit).length,downloads:intervals.filter(e=>e.stage==='download'&&e.success).length,
  analysisCheckpoints:states,analysisCheckpointsObservedAt:new Date().toISOString(),logFiles,limitation:end.stage==='complete'?'Warm run only; not a new TTS benchmark.':end.message,
  stopRequest:await readFile(join(root,'stop.request'),'utf8').catch(()=>undefined),
  timingNote:'Overlapping stage unions also overlap each other; do not sum them into user elapsed.'};
await writeFile(join(root,'metrics.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
