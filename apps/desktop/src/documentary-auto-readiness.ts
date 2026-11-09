import {documentaryMaterialUsable,type Scene} from '@gold-work/shared';

/** Prepared manual-review media remains editable, but automatic production
 * requires approval. Verified native scenes need no selected footage. This
 * deliberately matches the existing strict automatic-export guard. */
export function documentaryAutomaticMaterialReady(scene:Scene):boolean {
  return Boolean(scene.documentary?.verified&&documentaryMaterialUsable(scene));
}
