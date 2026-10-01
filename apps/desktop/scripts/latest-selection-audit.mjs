import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const profile=join(process.env.APPDATA,'@gold-work/desktop'),projectId='project_mun42rx8_1jcven5';
const root=resolve('captures/montage-speed-20260927/new-production/latest-run-20261001');await mkdir(root,{recursive:true});
const rows=[];
for(const name of (await readdir(join(profile,'logs'))).filter(n=>/^gold-work-studio-log.*\.txt$/.test(n))){
  for(const line of (await readFile(join(profile,'logs',name),'utf8')).split('\n')){
    if(line.slice(0,24)<'2026-09-30T19:00:00.000Z')continue;
    try{const i=line.indexOf('{');rows.push({at:line.slice(0,24),event:line.slice(0,i<0?line.length:i).trim().split(' ').at(-1),data:i<0?{}:JSON.parse(line.slice(i))});}catch{}
  }
}
rows.sort((a,b)=>a.at.localeCompare(b.at));
const sessions={};
for(const row of rows.filter(r=>r.data.projectId===projectId)){
  const s=sessions[row.data.sessionId]??={build:row.data.buildId,first:row.at,last:row.at,reportedRequests:0,input:0,output:0,total:0};s.last=row.at;
  if(row.event==='anymodel.completion.usage'){s.reportedRequests++;s.input+=row.data.inputCount??0;s.output+=row.data.outputCount??0;s.total+=row.data.totalCount??0;}
}
const project=JSON.parse(await readFile(join(profile,'projects.json'),'utf8')).find(p=>p.id===projectId);
const timing=JSON.parse(await readFile('D:/GoldWorkStorage/projects/'+projectId+'/Documentary/production-timing.json','utf8'));
const reasons={};for(const s of project.scenes.filter(s=>!s.documentary?.verified)){const reason=(s.documentary?.autoError??'Не подтверждено').replace(/https?:\/\/\S+/g,'[source]').slice(0,300);reasons[reason]=(reasons[reason]??0)+1;}
const latest=rows.filter(r=>r.at>=timing.startedAt&&r.at<=timing.updatedAt&&r.data.projectId===projectId&&r.event==='anymodel.completion.usage');
const result={at:new Date().toISOString(),projectId,scenes:project.scenes.length,verified:project.scenes.filter(s=>s.documentary?.verified).length,video:project.scenes.filter(s=>s.documentary?.verified&&s.documentary.selected?.kind==='video').length,photo:project.scenes.filter(s=>s.documentary?.verified&&s.documentary.selected?.kind==='image').length,requestedVideoPercent:project.settings.stockVideoPercent,timing,latestUsage:{requests:latest.length,total:latest.reduce((n,r)=>n+(r.data.totalCount??0),0)},sessions,failures:rows.filter(r=>r.event==='renderer.process.gone'||r.event==='renderer.console'&&/out of memory|DataCloneError|Should not already/.test(r.data.message??'')).map(r=>({at:r.at,event:r.event,reason:r.data.reason,message:r.data.message?.replace(/https?:\/\/\S+/g,'[source]'),exitCode:r.data.exitCode})),unverifiedReasons:reasons,note:'Usage is provider-reported tokens, not billed credits. Session intervals describe available logs, not completed production. Read-only snapshot; no paid requests.'};
await writeFile(join(root,'diagnosis.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({root,sessions,latest:result.latestUsage,failures:result.failures}));
