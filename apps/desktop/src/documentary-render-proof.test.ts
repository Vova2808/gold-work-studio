import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDefaultProjectSettings, createDocumentarySettings, type Project, type Scene} from '@gold-work/shared';
import {documentaryContextApproval, documentarySavedContextIssue} from './documentary-context-approval.js';
import {renderDocumentary} from './documentary-renderer.js';

test('export refuses stale automatic proof and a thematic proof in exact mode, preserving the previous Final', async t => {
  const root=await mkdtemp(join(tmpdir(),'gws-export-proof-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const settings=createDefaultProjectSettings();
  settings.voice.enabled=false;
  settings.assembly.documentary={...createDocumentarySettings(),matchMode:'thematic'};
  const narration='A passenger train travels between cities.';
  const scene={id:'s',order:0,narration,durationSeconds:4,status:'ready',imagePrompt:'',animationPrompt:'',imagePath:'fixture.jpg',
    documentary:{version:2,verified:true,pinned:false,checksum:'fixture',candidates:[],effects:[],caption:{enabled:false},
      requirement:{text:narration,entities:[],years:[],queries:['passenger train'],visualScope:'illustrative',illustrationQuery:'passenger train',
        scriptRequirements:{version:1,mode:'thematic',scriptText:narration,checks:[{id:'theme',kind:'object',scriptQuote:narration,required:'passenger train'}],nonVisual:[]}},
      selected:{id:'source',provider:'pexels',kind:'image',title:'Train',description:'',width:1920,height:1080},
      visualReview:{status:'accepted',confidence:1,reason:'Real train',checkedAt:'now',quality:'clear',sampleSeconds:[],
        scriptEvidence:{version:1,scriptText:narration,checks:[{requirementId:'theme',kind:'object',scriptQuote:narration,required:'passenger train',match:true,evidence:'A real passenger train is visible.'}]}}}} as unknown as Scene;
  const project={id:'p',mediaMode:'stock',aspectRatio:'16:9',settings,scenes:[scene]} as Project;
  scene.documentary!.visualReview!.contextApproval=documentaryContextApproval(project,scene,{status:'accepted',narrativeEvidence:{
    subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'none',observedEra:'none',evidence:'A real passenger train is visible.'}});
  assert.equal(documentarySavedContextIssue(project,scene),undefined);
  const outputPath=join(root,'Final.mp4');
  await writeFile(outputPath,'previous completed export');
  for(const edit of ['script','exact','promotion'] as const){
    const changed=structuredClone(project);
    if(edit==='script')changed.scenes[0]!.narration='A car travels between cities.';
    else if(edit==='exact')changed.settings.assembly.documentary!.matchMode='literal';
    else changed.scenes[0]!.documentary!.visualReview!.sourceText={version:1,kind:'promotion',text:'Please Subscribe'};
    await assert.rejects(renderDocumentary({project:changed,clips:[],audioMasterPath:'',outputPath},
      {projectDirectory:root,entryPoint:'unused'}),edit==='script'?/изменился сценарий/:edit==='exact'?/Тематическая иллюстрация/:/Please Subscribe/);
    assert.equal(await readFile(outputPath,'utf8'),'previous completed export');
    assert.equal(changed.scenes[0]!.documentary!.verified,true,'The export guard does not rewrite user data');
  }
});
