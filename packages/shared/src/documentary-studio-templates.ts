/** Single-source editorial scenes. Each has its own geometry/entrance; a
 * second source is never invented to fill a comparison. */
export const documentaryStudioTemplates = [
  ['portrait-stage','Портрет · световая сцена'],
  ['portrait-arch','Портрет · арочное окно'],
  ['studio-hexagon','Техника · шестигранная апертура'],
  ['studio-diamond','Геометрия · ромб и линии'],
  ['studio-panorama','Панорама · горизонтальное раскрытие'],
  ['studio-diagonal','Косое раскрытие · полный кадр'],
  ['studio-blinds','Жалюзи · горизонтальные полосы'],
  ['studio-radial','Радиальное раскрытие · сектор'],
  ['studio-torn-paper','Бумага · рваные края'],
  ['studio-pinned','Доска · приколотый снимок'],
  ['studio-lightbox','Лайтбокс · подсветка слайда'],
  ['studio-gallery-wall','Галерея · перспектива стены'],
  ['studio-spotlight','Прожектор · проявление из тени'],
  ['studio-scan','Сканер · цветовое проявление'],
  ['studio-page-peel','Страница · отгибающийся угол'],
  ['studio-curtain','Сцена · раскрытие занавеса'],
  ['studio-lift','Постер · подъём из цветных блоков'],
] as const;
export const isDocumentaryStudioTemplate=(id:string)=>documentaryStudioTemplates.some(t=>t[0]===id);
