import type {DocumentaryMotionGraphic, DocumentaryMotionKind} from './documentary-motion.js';

/** Layouts share semantic inputs, but have separate staging and geometry. */
export const documentaryMotionPresets = [
  {id:'source-emphasis',label:'Акцент · текст на затемнённом кадре',family:'type',kinds:['key-point','chronology','statistic']},
  {id:'type-slam',label:'Фраза · крупный въезд',family:'type',kinds:['key-point','quote']},
  {id:'type-ribbon',label:'Фраза · диагональные ленты',family:'type',kinds:['key-point','quote']},
  {id:'type-echo',label:'Фраза · типографический фон',family:'type',kinds:['key-point','quote']},
  {id:'type-stack',label:'Фраза · ступени слов',family:'type',kinds:['key-point','quote']},
  {id:'chapter-signal',label:'Глава · сигнальные углы',family:'chapter',kinds:['chapter-number']},
  {id:'chapter-marquee',label:'Глава · крупный фон и заголовок',family:'chapter',kinds:['chapter-number']},
  {id:'chapter-dossier',label:'Глава · папка досье',family:'chapter',kinds:['chapter-number']},
  {id:'chapter-aperture',label:'Глава · раскрытие диафрагмы',family:'chapter',kinds:['chapter-number']},
  {id:'date-stamp',label:'Дата · архивный штамп',family:'date',kinds:['chronology']},
  {id:'date-ruler',label:'Дата · движущаяся шкала',family:'date',kinds:['chronology']},
  {id:'date-calendar',label:'Дата · отрывная карточка',family:'date',kinds:['chronology']},
  {id:'date-orbit',label:'Дата · круг и отметка',family:'date',kinds:['chronology']},
  {id:'stat-monument',label:'Число · монументальная типографика',family:'stat',kinds:['statistic']},
  {id:'stat-ticket',label:'Число · билет и перфорация',family:'stat',kinds:['statistic']},
  {id:'stat-window',label:'Число · раскрывающиеся панели',family:'stat',kinds:['statistic']},
  {id:'stat-split',label:'Число · разделённый экран',family:'stat',kinds:['statistic']},
  {id:'board-cascade',label:'Карточки · каскад',family:'board',kinds:['explainer','feature-list']},
  {id:'board-staircase',label:'Карточки · последовательные ступени',family:'board',kinds:['explainer','feature-list']},
  {id:'board-orbit',label:'Карточки · связи вокруг материала',family:'board',kinds:['explainer','feature-list']},
  {id:'board-ledger',label:'Карточки · редакционная таблица',family:'board',kinds:['explainer','feature-list']},
  {id:'profile-dossier',label:'Герой · личное дело',family:'profile',kinds:['subject-card']},
  {id:'profile-halo',label:'Герой · цветной круг',family:'profile',kinds:['subject-card']},
  {id:'profile-strip',label:'Герой · горизонтальная полоса',family:'profile',kinds:['subject-card']},
  {id:'profile-postcard',label:'Герой · фотокарточка',family:'profile',kinds:['subject-card']},
] as const satisfies ReadonlyArray<{id:string;label:string;family:string;kinds:ReadonlyArray<DocumentaryMotionKind>}>;

export type DocumentaryMotionPresetId = typeof documentaryMotionPresets[number]['id'];
export type DocumentaryMotionPreset = typeof documentaryMotionPresets[number];

type PresetInput = Pick<DocumentaryMotionGraphic,'kind'|'preset'|'quoteMode'|'reading'|'sequenceId'|'cards'|'panels'|'presentation'|'items'>;

/** Keep measured speech, continuous sequences and source-linked boards on their
 * dedicated renderers. A layout must never discard these authored semantics. */
export function documentaryMotionPresetsFor(graphic: PresetInput): DocumentaryMotionPreset[] {
  if(graphic.sequenceId || graphic.reading || graphic.kind==='quote'&&graphic.quoteMode!=='phrase'
    || graphic.panels?.length || graphic.presentation==='panels' || graphic.cards?.some(card=>card.sceneId)
    || graphic.kind==='chronology'&&(graphic.items?.length??0)>1) return [];
  return documentaryMotionPresets.filter(preset=>(preset.kinds as readonly DocumentaryMotionKind[]).includes(graphic.kind));
}

export function documentaryMotionPresetFor(graphic: PresetInput): DocumentaryMotionPreset | undefined {
  return documentaryMotionPresetsFor(graphic).find(preset=>preset.id===graphic.preset);
}
