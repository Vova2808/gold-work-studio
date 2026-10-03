import {readFile,writeFile} from 'node:fs/promises';
import {dirname,basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import type {Project,EffectAsset} from '@gold-work/shared';
import {prepareDocumentaryDiagram} from '../src/documentary-media-cache.js';
import {probeEffectMedia} from '../src/effect-media.js';

// Local derivative check only. Never writes the project, selects a source,
// changes narration, or sends a paid request.
const [projectFile,sceneNumber,reportFile]=process.argv.slice(2);
assert.ok(projectFile&&sceneNumber&&reportFile,'Pass saved QA project.json, scene number and output report path');
const project=JSON.parse(await readFile(projectFile,'utf8')) as Project;
const scene=project.scenes.find(scene=>scene.order+1===Number(sceneNumber));
const doc=scene?.documentary,source=doc?.selected;
assert.ok(doc?.verified&&doc.checksum&&source?.localPath&&source.provider==='commons'&&source.title.endsWith('.svg'));
const original=await readFile(source.localPath),root=dirname(source.localPath);
const prepared=await prepareDocumentaryDiagram(root,{id:doc.checksum,file:basename(source.localPath),kind:'image'} as EffectAsset,source,
  {metadata:await probeEffectMedia(source.localPath)});
assert.deepEqual(await readFile(source.localPath),original);
const result={scene:Number(sceneNumber),paidRequests:0,originalPreserved:true,originalSha256:createHash('sha256').update(original).digest('hex'),
  proxy:join(root,prepared.proxy!),poster:join(root,prepared.poster!),metadata:prepared.metadata};
await writeFile(reportFile,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
