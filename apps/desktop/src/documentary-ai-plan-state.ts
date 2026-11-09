import {createHash} from 'node:crypto';
import type {DocumentaryAiSearchPlan,Project,Scene} from '@gold-work/shared';
import {documentaryAiPlanContext} from '@gold-work/shared';
export {documentaryAiPlanContext} from '@gold-work/shared';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function currentDocumentaryAiSearchPlan(project:Project,scene:Scene):DocumentaryAiSearchPlan|undefined {
  const requirement=scene.documentary?.requirement,plan=requirement?.aiSearchPlan;
  if(!plan||plan.version!==1||requirement?.text!==scene.narration)return;
  const inputHash=hash({version:1,model:plan.model,context:documentaryAiPlanContext(project)});
  return plan.inputHash===hash({inputHash,sceneId:scene.id})?plan:undefined;
}
