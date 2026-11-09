import {documentaryManualReviewReady,type DocumentaryCandidate,type Scene} from '@gold-work/shared';

export const documentaryProviderLabels:Record<DocumentaryCandidate['provider'],string>={
  commons:'Wikimedia Commons','internet-archive':'Internet Archive',loc:'Library of Congress',youtube:'YouTube',pexels:'Pexels API',pixabay:'Pixabay API',local:'Мои материалы',web:'Веб-поиск'
};

/** Older fallback notes contained the previous candidate's refusal. Read the bound verdict. */
export function documentaryMaterialReviewNote(scene:Scene):string{
  const doc=scene.documentary;
  if(!doc?.manualReview||doc.verified||doc.pinned)return doc?.reviewNote??'';
  const reason=documentaryManualReviewReady(scene)?doc.manualReview.analysis?.reason:undefined;
  return reason?`Проверить вручную. ${reason}`:'Проверить вручную.';
}
