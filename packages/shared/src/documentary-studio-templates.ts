/** Single-source editorial scenes. Each has its own geometry/entrance; a
 * second source is never invented to fill a comparison. */
export const documentaryStudioTemplates = [
  ['portrait-stage','Портрет · световая сцена'],
  ['studio-hexagon','Техника · чистая рамка'],
  ['studio-diamond','Объект · чистое окно'],
  ['studio-panorama','Панорама · широкий кадр'],
  ['studio-diagonal','Полный кадр · спокойная подача'],
  ['studio-blinds','Полный кадр · без маски'],
  ['studio-radial','Полный кадр · без раскрытия'],
  ['studio-torn-paper','Бумага · ровная рамка'],
  ['studio-pinned','Фотография · светлое поле'],
  ['studio-lightbox','Слайд · светлая рамка'],
  ['studio-gallery-wall','Галерея · ровное окно'],
  ['studio-spotlight','Экспозиция · тёмное поле'],
  ['studio-scan','Исходник · чистый цвет'],
  ['studio-page-peel','Исходник · полный кадр'],
  ['studio-curtain','Сцена · чистый кадр'],
  ['studio-lift','Постер · мягкое появление'],
] as const;
// Old projects keep their saved ID, rendered as an ordinary rectangular portrait.
export const isDocumentaryStudioTemplate=(id:string)=>id==='portrait-arch'||documentaryStudioTemplates.some(t=>t[0]===id);
