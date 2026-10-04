import {createHash} from 'node:crypto';
import type {DocumentaryScene,Project,Scene} from '@gold-work/shared';
import {documentarySceneContext,documentaryNarrativeEvidenceIssue} from './documentary-scene-context.js';
import {documentaryContradictoryModelYear} from './documentary-model-year.js';

type Review=NonNullable<DocumentaryScene['visualReview']>;
type Approval=NonNullable<Review['contextApproval']>;
const sourceEvidence=(scene:Scene)=>({title:scene.documentary?.selected?.title,description:scene.documentary?.selected?.description});

/** Only semantic inputs belong here: changing search query/order or a preview
 * filename does not require paying to inspect the same approved pixels again. */
function fingerprint(project:Project,scene:Scene):string {
  const doc=scene.documentary!,req=doc.requirement,source=doc.selected;
  return createHash('sha256').update(JSON.stringify({version:1,
    context:documentarySceneContext(project,scene),
    requirement:{text:req.text,entities:req.entities,identities:req.identities,years:req.years,detail:req.detail},
    source:{id:source?.id,provider:source?.provider,kind:source?.kind,...sourceEvidence(scene)},
    checksum:doc.checksum,diagramWhite:scene.imagePath?.endsWith('-diagram.png')===true,
    interval:source?.kind==='video'?[scene.trimStartSeconds??0,scene.trimEndSeconds??null]:null,
  })).digest('hex');
}

/** Called only on the actual-frame verdict. Missing old evidence must never
 * acquire a current proof merely because its old status says accepted. */
export function documentaryContextApproval(project:Project,scene:Scene,value:Record<string,unknown>):Approval|undefined {
  if(value.status!=='accepted'||!scene.documentary?.checksum||!scene.documentary.selected
    ||documentaryContradictoryModelYear(scene.documentary.selected,scene.documentary.requirement,documentarySceneContext(project,scene))
    ||documentaryNarrativeEvidenceIssue(value,sourceEvidence(scene),documentarySceneContext(project,scene)))return;
  const evidence=value.narrativeEvidence as Record<string,unknown>;
  return {version:1,fingerprint:fingerprint(project,scene),evidence:{
    subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:String(evidence.requiredEra),
    observedEra:String(evidence.observedEra??''),evidence:String(evidence.evidence),
    ...(typeof evidence.eraEvidenceQuote==='string'?{eraEvidenceQuote:evidence.eraEvidenceQuote}:{}),
  }};
}

export function documentarySavedContextIssue(project:Project,scene:Scene):string|undefined {
  const doc=scene.documentary;
  if(!doc?.verified||doc.pinned)return;
  if(doc.selected&&documentaryContradictoryModelYear(doc.selected,doc.requirement,documentarySceneContext(project,scene)))
    return 'Год модели в заголовке выбранного материала противоречит году той же модели в исходном сценарии. Нужен другой источник; исходник и озвучка сохранены.';
  const review=doc.visualReview,approval=review?.contextApproval;
  if(review?.status!=='accepted'||approval?.version!==1||!doc.checksum||!doc.selected)
    return 'Старое автоматическое одобрение не подтверждает человека, эпоху и деталь по текущим правилам. Нужна проверка сохранённого материала; исходник и озвучка сохранены.';
  if(approval.fingerprint!==fingerprint(project,scene))
    return 'После автоматической проверки изменился сценарий, объект или выбранный фрагмент. Нужна повторная проверка соответствия; исходник и озвучка сохранены.';
  return documentaryNarrativeEvidenceIssue({narrativeEvidence:approval.evidence},sourceEvidence(scene),documentarySceneContext(project,scene));
}

export function revalidateDocumentaryContext(project:Project,sceneIds?:string[]):Scene[] {
  return project.scenes.map(scene=>{
    if(sceneIds&&!sceneIds.includes(scene.id))return scene;
    const issue=documentarySavedContextIssue(project,scene);
    return issue?{...scene,documentary:{...scene.documentary!,verified:false,autoError:issue,reviewNote:issue}}:scene;
  });
}
