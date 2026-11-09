import type {Scene} from '@gold-work/shared';

/** Bound new response size by scenes, narration and running time. A long
 * single scene remains intact; its narration and voice are never truncated. */
export function compactMontageBatches(scenes:Scene[]):Scene[][] {
  const batches:Scene[][]=[];
  let batch:Scene[]=[],characters=0,seconds=0;
  for(const scene of scenes){
    const duration=(scene.documentary?.timing?.durationInFrames??Math.ceil(scene.durationSeconds*30))/30;
    if(batch.length&&(batch.length>=8||characters+scene.narration.length>1800||seconds+duration>55)){
      batches.push(batch);batch=[];characters=0;seconds=0;
    }
    batch.push(scene);characters+=scene.narration.length;seconds+=duration;
  }
  if(batch.length)batches.push(batch);
  return batches;
}
