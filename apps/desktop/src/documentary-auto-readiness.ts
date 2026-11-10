import {documentaryMaterialUsable,type Scene} from '@gold-work/shared';
import {stat} from 'node:fs/promises';

export const documentaryMissingSelectedMaterialMessage='Локальный файл выбранного материала отсутствует или пуст.';

/** Prepared manual-review media remains editable, but automatic production
 * requires approval. Verified native scenes need no selected footage. This
 * deliberately matches the existing strict automatic-export guard. */
export function documentaryAutomaticMaterialReady(scene:Scene):boolean {
  return Boolean(scene.documentary?.verified&&documentaryMaterialUsable(scene));
}

export async function documentarySelectedMaterialMissing(scene:Scene):Promise<boolean> {
  const source=scene.documentary?.selected;
  if(!source)return false;
  const path=source.kind==='video'?scene.videoPath:scene.imagePath;
  if(!path)return true;
  try {
    const file=await stat(path);
    return !file.isFile()||file.size===0;
  } catch(error) {
    if(['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))return true;
    throw error;
  }
}
