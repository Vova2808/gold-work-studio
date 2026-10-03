import {documentaryLayoutPresets} from './documentary-layout-presets.js';
import {documentaryStudioTemplates} from './documentary-studio-templates.js';
export {documentaryStudioTemplates,isDocumentaryStudioTemplate} from './documentary-studio-templates.js';
export {documentaryLayoutPresets,documentaryLayoutPreset,type DocumentaryLayoutPreset} from './documentary-layout-presets.js';
/** Curated layouts; media and authored captions remain editable, never generated here. */
export const documentaryTemplates = [
  ["full", "Чистый полный кадр"], ["contain", "Целиком · размытый фон"],
  ["push", "Медленное приближение"], ["pull", "Медленное отдаление"],
  ["pan-left", "Панорама влево"], ["pan-right", "Панорама вправо"],
  ["detail-scan", "Крупная деталь · обзор источника"],
  ["editorial-shutters", "Раскрытие кадра · четыре шторки"], ["editorial-orbit", "Перспектива · орбитальная сцена"],
  ["editorial-film-gate", "Киноплёнка · движущееся окно"], ["editorial-iris", "Диафрагма · круговое раскрытие"],
  ["broadcast-crt", "Архив · телевизионный экран"], ["paper-grid", "Бумага · анимированная сетка"],
  ['broadcast-scanlines','Телевизор · эффект на весь кадр'],
  ...documentaryStudioTemplates,
  ["dark-grid", "Тёмная сетка · материал"], ["diagonal-card", "Полосы · крупный материал"],
  ["contour-card", "Контурные линии · материал"],
  ["compare-grid", "Сравнение · две фотографии на сетке"], ["compare-dossier", "Сравнение · досье и деталь"],
  ["compare-diagonal", "Сравнение · бумажная пара"],
  ["compare-reveal", "Сравнение · раскрытие двух сторон"], ["compare-filmstrip", "Сравнение · плёночные кадры"],
  ["blueprint-board", "Технический разбор · чертёжный стол"], ["archive-slide", "Архив · слайд на бумаге"],
  ["archive", "Архив · светлая рамка"], ["archive-dark", "Архив · тёмная рамка"], ["gallery", "Галерея · плавающая карточка"],
  ["inset-left", "Карточка слева"], ["inset-right", "Карточка справа"],
  ["editorial-left", "Текст слева · материал справа"], ["editorial-right", "Текст справа · материал слева"],
  ["chapter", "Заголовок раздела"], ["chapter-line", "Заголовок · линия"],
  ["chapter-push", "Глава · плавный наезд"], ["chapter-pull", "Глава · плавный отъезд"],
  ["chapter-breathe", "Глава · наезд и отъезд"], ["chapter-focus", "Глава · проявление из размытия"],
  ["chapter-wipe", "Глава · раскрытие заголовка"],
  ["fact", "Факт · нижняя плашка"], ["fact-large", "Крупный факт"],
  ["compare-clean", "Сравнение · две половины"], ["compare-cards", "Сравнение · две карточки"], ["compare-stack", "Сравнение · сверху и снизу"],
  ...documentaryLayoutPresets.map(p=>[p.id,p.label] as const)
] as const;
export type DocumentaryTemplate = typeof documentaryTemplates[number][0];
