import {readFile,readdir,writeFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {FileProjectRepository} from '../src/file-project-repository.js';
import {planDocumentaryCleanup,executeDocumentaryCleanup} from '../src/documentary-cleanup.js';
import {documentaryIntervalUnion} from '../src/documentary-metrics.js';
import assert from 'node:assert/strict';

const profile=join(process.env.APPDATA!,'@gold-work/desktop'),projectId='project_mukba0q1_0cubga6';
const output=resolve('captures/montage-speed-20260927/new-production');
const root='D:/GoldWorkStorage',registry=join(profile,'projects.json');
const repo=new FileProjectRepository(registry),projects=await repo.list();
const current=projects.find(p=>p.id===projectId)!;
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
if(process.argv.includes('--cleanup')){
  const queue=JSON.parse(await readFile(join(profile,'queue.json'),'utf8'));
  assert.ok(!queue.some((t:any)=>['pending','running','retry_wait'].includes(t.status)),'Production must be idle');
  assert.ok(!projects.some(p=>p.status==='generating'),'A project is running');
  const before=sha(await readFile(registry));
  const voices=await Promise.all(current.scenes.filter(s=>s.audioPath).map(async s=>({id:s.id,path:s.audioPath!,sha256:sha(await readFile(s.audioPath!))})));
  const unknown=[];
  const analysis=join(root,'projects',projectId,'Documentary','Analysis');
  for(const file of await readdir(analysis)){if(!file.endsWith('.json'))continue;const path=join(analysis,file),raw=await readFile(path);const data=JSON.parse(raw.toString());if(['pending','partial'].includes(data.state))unknown.push({path,sha256:sha(raw)});}
  const plan=await planDocumentaryCleanup({materialRoot:join(root,'Materials'),projects:[...projects,...(await repo.listTrash()).map(t=>t.project)],projectDirectory:id=>join(root,'projects',id)});
  await writeFile(join(output,'cleanup-plan-20260928.json'),JSON.stringify(plan,null,2));
  console.log(JSON.stringify({candidates:plan.files.length,reclaimableGiB:plan.reclaimableBytes/2**30}));
  if(process.argv.includes('--execute')){
    assert.equal(sha(await readFile(registry)),before,'Registry changed during planning');
    const result=await executeDocumentaryCleanup(plan);
    assert.equal(sha(await readFile(registry)),before,'Registry changed during cleanup');
    for(const item of [...voices,...unknown])assert.equal(sha(await readFile(item.path)),item.sha256,item.path);
    const report={at:new Date().toISOString(),...result,freedGiB:result.bytes/2**30,projectsPreserved:projects.length,voicesPreserved:voices.length,unknownCheckpointsPreserved:unknown.length};
    await writeFile(join(output,'cleanup-result-20260928.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }
}else{
  const start='2026-09-28T17:04:22.238Z',end='2026-09-28T18:57:27.440Z';
  const records=(await readFile(join(profile,'logs/gold-work-studio-log.txt'),'utf8')).split('\n').filter(l=>l.includes('documentary.stage.finished')).flatMap(l=>{try{return [JSON.parse(l.slice(l.indexOf('{')))];}catch{return [];}}).filter(r=>r.projectId===projectId&&r.startedAt>=start&&r.finishedAt<=end);
  const groups=new Map<string,any[]>();
  for(const r of records){const key=r.stage+(r.purpose?':'+r.purpose:'');const list=groups.get(key)??[];list.push(r);groups.set(key,list);}
  const stages=Object.fromEntries([...groups].map(([key,rs])=>[key,{operations:rs.length,failed:rs.filter(r=>!r.success).length,activeSeconds:documentaryIntervalUnion(rs.map(r=>[Date.parse(r.startedAt),Date.parse(r.finishedAt)])).reduce((s,[a,b])=>s+b-a,0)/1000,requestSeconds:rs.reduce((s,r)=>s+r.elapsedMs,0)/1000}]));
  const checkpoints:Record<string,number>={};
  const analysis=join(root,'projects',projectId,'Documentary','Analysis');
  for(const file of await readdir(analysis)){if(!file.endsWith('.json'))continue;const data=JSON.parse(await readFile(join(analysis,file),'utf8'));if(data.createdAt>=start&&data.createdAt<=end){const key=data.purpose+':'+data.state;checkpoints[key]=(checkpoints[key]??0)+1;}}
  const report={projectId,start,end,elapsedSeconds:(Date.parse(end)-Date.parse(start))/1000,stages,checkpoints,tokenUsage:null,tokenNote:'Исторические ответы не сохраняли usage; точный расход токенов восстановить нельзя. Operations включают кеш. Интервалы разных стадий перекрываются, не складывать.',current:{status:current.status,verified:current.scenes.filter(s=>s.documentary?.verified).length,total:current.scenes.length,unverified:current.scenes.filter(s=>!s.documentary?.verified).map(s=>({number:s.order+1,id:s.id,error:s.documentary?.autoError}))}};
  await writeFile(join(output,'selection-audit-20260928.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
