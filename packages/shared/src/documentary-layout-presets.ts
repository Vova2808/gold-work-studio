/** Geometry is shared by the catalogue preview and the actual composition.
 * Presets change layout/animation, never create facts or select another source. */
export type DocumentaryPresetBox = readonly [number,number,number,number];
export type DocumentaryLayoutPreset = {
  id:string;label:string;group:'photo'|'compare'|'chapter'|'fact';
  main:DocumentaryPresetBox;second?:DocumentaryPresetBox;text:DocumentaryPresetBox;
  decor:'mat'|'film'|'paper'|'grid'|'rail'|'glass'|'circle'|'brackets'|'ribbon'|'lines';
  enter:'rise'|'slide'|'wipe'|'iris'|'settle';paper?:boolean;
};
const preset=<I extends string>(id:I,label:string,group:DocumentaryLayoutPreset['group'],main:DocumentaryPresetBox,text:DocumentaryPresetBox,decor:DocumentaryLayoutPreset['decor'],enter:DocumentaryLayoutPreset['enter'],paper=false,second?:DocumentaryPresetBox)=>({id,label,group,main,text,decor,enter,paper,second});
export const documentaryLayoutPresets=[
  preset('museum-mat','Музей · фотография и этикетка','photo',[5,4,90,78],[7,84,86,12],'mat','rise'),
  preset('film-negative','Негатив · перфорация плёнки','photo',[5,9,90,82],[8,78,84,14],'film','slide'),
  preset('polaroid-stack','Моментальный снимок · бумажная стопка','photo',[7,4,86,78],[12,84,76,11],'paper','settle',true),
  preset('photo-corners','Фотография · угловые крепления','photo',[6,7,88,86],[8,78,84,14],'brackets','iris'),
  preset('magazine-cover','Журнал · обложка и вертикальная рубрика','photo',[12,3,85,94],[15,65,70,28],'rail','wipe'),
  preset('news-window','Репортаж · окно и нижняя строка','photo',[3,3,94,75],[5,81,90,16],'ribbon','rise'),
  preset('blueprint-panel','Чертёж · поле и боковая шкала','photo',[10,6,84,84],[14,79,74,16],'grid','wipe'),
  preset('spotlight-photo','Экспозиция · световой круг','photo',[4,5,92,90],[12,75,76,18],'circle','iris'),
  preset('postcard','Открытка · фото на бумаге','photo',[4,4,92,80],[10,85,80,11],'paper','slide',true),
  preset('glass-window','Стекло · плавающая рамка','photo',[4,4,92,92],[8,73,84,20],'glass','rise'),
  preset('cinema-letterbox','Кино · широкий экран и титр','photo',[0,12,100,76],[10,82,80,14],'lines','wipe'),
  preset('exhibit-rail','Экспонат · боковой акцент','photo',[4,5,92,90],[10,8,70,18],'rail','settle'),
  preset('compare-equal','Диптих · равные окна','compare',[3,16,45,77],[5,2,90,12],'mat','rise',false,[52,16,45,77]),
  preset('compare-offset','Диптих · смещённые карточки','compare',[3,6,45,73],[5,87,90,11],'paper','settle',true,[52,16,45,68]),
  preset('compare-ledger','Сопоставление · журнальная таблица','compare',[3,18,45,76],[6,2,88,13],'grid','wipe',true,[52,18,45,76]),
  preset('compare-bridge','Сопоставление · связующая линия','compare',[3,18,44,76],[8,2,84,13],'lines','slide',false,[53,18,44,76]),
  preset('compare-wide-stack','Два широких плана · разделитель','compare',[3,3,94,41],[8,44,84,12],'ribbon','wipe',false,[3,56,94,41]),
  preset('compare-portrait-pair','Два портрета · круговой акцент','compare',[9,17,37,77],[5,2,90,14],'circle','iris',false,[54,17,37,77]),
  preset('compare-archive-fold','Архив · разворот папки','compare',[4,12,43,78],[8,1,84,10],'paper','slide',true,[53,12,43,78]),
  preset('compare-monitor','Два монитора · техническая рамка','compare',[3,14,45,75],[10,88,80,10],'brackets','settle',false,[52,14,45,75]),
  preset('chapter-split','Раздел · материал и боковой заголовок','chapter',[2,4,65,92],[68,15,29,70],'rail','slide'),
  preset('chapter-banner','Раздел · центральная лента','chapter',[0,0,100,100],[8,33,84,34],'ribbon','wipe'),
  preset('chapter-outline','Раздел · заголовок в контуре','chapter',[0,0,100,100],[10,24,80,52],'brackets','rise'),
  preset('chapter-steps','Раздел · ступенчатое раскрытие','chapter',[3,4,94,92],[9,43,82,46],'lines','wipe'),
  preset('chapter-side-rail','Раздел · вертикальная рубрика','chapter',[0,0,100,100],[9,12,60,75],'rail','rise'),
  preset('chapter-orbit','Раздел · кольцо вокруг заголовка','chapter',[0,0,100,100],[18,25,64,50],'circle','iris'),
  preset('chapter-paper-panel','Раздел · бумажная нижняя панель','chapter',[3,3,94,70],[6,74,88,22],'paper','slide',true),
  preset('chapter-scanline','Раздел · проявление по линиям','chapter',[2,3,96,94],[8,30,84,40],'grid','wipe'),
  preset('chapter-aperture','Раздел · рамка видоискателя','chapter',[6,6,88,88],[16,29,68,42],'mat','iris'),
  preset('chapter-floating','Раздел · плавающий заголовок','chapter',[0,0,100,100],[7,51,68,38],'glass','settle'),
  preset('fact-ticket','Факт · билет в нижнем углу','fact',[0,0,100,100],[5,65,65,29],'paper','slide',true),
  preset('fact-side-rail','Факт · боковая колонка','fact',[27,3,70,94],[3,18,25,64],'rail','rise'),
  preset('fact-scoreboard','Число · табло','fact',[0,0,100,100],[48,6,47,30],'brackets','settle'),
  preset('fact-underline','Факт · подчёркнутый титр','fact',[0,0,100,100],[8,67,84,26],'lines','wipe'),
  preset('fact-glass','Факт · стеклянная карточка','fact',[0,0,100,100],[6,7,61,32],'glass','rise'),
  preset('fact-stamp','Факт · печать на бумаге','fact',[4,4,92,92],[49,67,45,28],'paper','settle',true),
  preset('fact-ribbon','Факт · широкая информационная лента','fact',[0,0,100,100],[0,73,100,22],'ribbon','slide'),
  preset('fact-margin','Факт · заметка под изображением','fact',[3,3,94,69],[6,75,88,21],'mat','rise')
] as const;
export const documentaryLayoutPreset=(id:string)=>documentaryLayoutPresets.find(p=>p.id===id);
