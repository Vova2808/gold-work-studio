import {createHash} from 'node:crypto';
import type {DocumentaryAiSearchPlan,Project,Scene} from '@gold-work/shared';
import {documentaryAiPlanContext} from '@gold-work/shared';
export {documentaryAiPlanContext} from '@gold-work/shared';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

type ScenePlanContext={language:unknown;contextScenes:Array<{sceneId:string;narration:string}>;visualPolicy?:{mode:unknown}};
/** Only the editing slice and its immediate reference context affect currency.
 * Provider/model and unrelated script edits do not invalidate a paid plan. */
export function documentaryAiScenePlanContextHash(context:ScenePlanContext,sceneId:string):string|undefined {
  const index=context.contextScenes.findIndex(item=>item.sceneId===sceneId);
  if(index<0)return;
  return hash({version:1,sceneId,language:context.language,mode:context.visualPolicy?.mode??'subject-illustration',
    narration:context.contextScenes[index]!.narration,
    preceding:context.contextScenes[index-1]?.narration,following:context.contextScenes[index+1]?.narration});
}
export function documentaryAiScenePlanHash(project:Project,scene:Scene):string {
  const scenes=new Map(project.scenes.map(item=>[item.id,item]));scenes.set(scene.id,scene);
  const current={...project,scenes:[...scenes.values()]};
  return documentaryAiScenePlanContextHash(documentaryAiPlanContext(current),scene.id)!;
}

export function currentDocumentaryAiSearchPlan(project:Project,scene:Scene):DocumentaryAiSearchPlan|undefined {
  const requirement=scene.documentary?.requirement,plan=requirement?.aiSearchPlan;
  if(!plan||plan.version!==1||requirement?.text!==scene.narration)return;
  if(plan.sceneInputHash)return plan.sceneInputHash===documentaryAiScenePlanHash(project,scene)?plan:undefined;
  const inputHash=hash({version:1,model:plan.model,context:documentaryAiPlanContext(project)});
  return plan.inputHash===hash({inputHash,sceneId:scene.id})?plan:undefined;
}
