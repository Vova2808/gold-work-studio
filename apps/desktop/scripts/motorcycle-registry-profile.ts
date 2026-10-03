/** One isolated production-sized repository mutation; no provider calls or user writes. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {copyFile,mkdir,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {freemem} from 'node:os';
import {FileProjectRepository} from '../src/file-project-repository.js';

const projectId='project_mun42rx8_1jcven5';
const source=join(process.env.APPDATA!, '@gold-work', 'desktop', 'projects.json');
const output=resolve('captures/montage-speed-20260927/new-production/motorcycle-live-20261001/registry-profile');
const isolated=join(output,'registry.json');
const hash=async(path:string)=>{
  const digest=createHash('sha256');
  for await(const chunk of createReadStream(path))digest.update(chunk);
  return digest.digest('hex');
};

await mkdir(output,{recursive:true});
const before=await hash(source);
await copyFile(source,isolated);
const repository=new FileProjectRepository(isolated);
let peakRss=process.memoryUsage().rss,minFree=freemem();
const sample=setInterval(()=>{
  peakRss=Math.max(peakRss,process.memoryUsage().rss);
  minFree=Math.min(minFree,freemem());
},20);
try{
  const readStarted=performance.now();
  const project=await repository.get(projectId);
  const readSeconds=(performance.now()-readStarted)/1000;
  assert.ok(project?.scenes.length);
  const included=project.scenes.filter(scene=>scene.includeInAssembly!==false);
  const verified=included.filter(scene=>scene.documentary?.verified);
  const empty=included.filter(scene=>!scene.documentary?.verified);
  const highestVerified=verified.length?Math.max(...verified.map(scene=>scene.order+1)):0;
  const highestAutoError=empty.filter(scene=>scene.documentary?.autoError).length;
  const target=project.scenes[0]!.id;
  const writeStarted=performance.now();
  await repository.mutate(projectId,current=>({scenes:current.scenes.map(scene=>scene.id===target
    ?{...scene,documentary:{...scene.documentary!,autoError:'Isolated registry timing '+Date.now()}}:scene)}),
    {candidateSceneIds:[target]});
  const mutateSeconds=(performance.now()-writeStarted)/1000;
  const result={at:new Date().toISOString(),projectId,sceneCount:project.scenes.length,
    includedScenes:included.length,verifiedScenes:verified.length,emptyScenes:empty.length,
    highestVerifiedSceneNumber:highestVerified,emptyScenesWithAutoError:highestAutoError,
    registryBytes:(await stat(isolated)).size,readSeconds,mutateSeconds,
    peakRssMB:peakRss/1048576,minFreeMB:minFree/1048576,
    productionRegistryPreserved:before===await hash(source)};
  await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}finally{clearInterval(sample);}
