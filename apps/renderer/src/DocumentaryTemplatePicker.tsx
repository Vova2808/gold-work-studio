import {useEffect,useState} from 'react';
import {documentaryTemplates,documentaryLayoutPreset,isDocumentaryStudioTemplate,type DocumentaryTemplate} from '@gold-work/shared';

const groupOf=(id:string)=>documentaryLayoutPreset(id)?.group??(id.startsWith('compare-')?'compare':id.startsWith('chapter')?'chapter':id.startsWith('fact')||['editorial-left','editorial-right'].includes(id)?'fact':'photo');
const descriptions: Record<string,string> = {
  full:'Материал на весь экран', contain:'Материал целиком поверх размытого фона',
  push:'Плавное приближение материала', pull:'Плавное отдаление материала',
  'pan-left':'Медленная панорама влево', 'pan-right':'Медленная панорама вправо',
  'archive-dark':'Материал целиком в тёмной рамке', 'museum-mat':'Фото с местом для подписи снизу',
  'chapter-split':'Материал слева, заголовок раздела справа',
};
export function DocumentaryTemplateIllustration({id,label}:{id:DocumentaryTemplate;label:string}) {
  const preset=documentaryLayoutPreset(id),kind=groupOf(id);
  const full=['full','push','pull','pan-left','pan-right'].includes(id);
  const main=preset?.main??(full?[0,0,100,100]:id==='contain'?[16,0,68,100]:id==='archive-dark'?[3,3,94,94]:kind==='compare'?[3,15,45,78]:[4,5,92,90]);
  const second=preset?.second??(kind==='compare'?[52,15,45,78]:undefined),text=preset?.text??[8,70,84,23];
  return <svg viewBox="0 0 160 90" role="img" aria-label={`Схема: ${label}`}>
    <rect width="160" height="90" fill={preset?.paper?'#e7e1d6':id==='contain'?'#30433f':'#12212b'}/>
    {[main,second].filter(Boolean).map((box,i)=><svg key={i} x={box![0]!*1.6} y={box![1]!*.9} width={box![2]!*1.6} height={box![3]!*.9} viewBox="0 0 160 90" preserveAspectRatio="none">
      <rect width="160" height="90" fill={i?'#4d7483':'#38605d'}/><path d="M0 90V69L40 28L69 58L111 18L160 72V90Z" fill="#254349"/><circle cx="123" cy="24" r="9" fill="#c0d4b8"/>
      {id==='archive-dark'&&<rect x="1" y="1" width="158" height="88" rx="3" fill="none" stroke="#b6c4c4" strokeWidth="1"/>}
    </svg>)}
    {kind!=='photo'&&<><rect x={text[0]!*1.6} y={text[1]!*.9} width={text[2]!*1.6} height={text[3]!*.9} fill={preset?.paper?'#faf5eadd':'#07111dda'}/><text x={(text[0]!+3)*1.6} y={(text[1]!+text[3]!*.5)*.9} fontSize={id==='chapter-split'?5:8} fill={preset?.paper?'#192d32':'#fff'} fontWeight="700">Заголовок</text></>}
    <SpecialPreview id={id}/>
  </svg>;
}
/** Catalogue diagrams follow the current clean layouts, including saved IDs. */
function SpecialPreview({id}:{id:string}) {
  if(!isDocumentaryStudioTemplate(id)&&!['editorial-shutters','editorial-orbit','editorial-film-gate','editorial-iris','broadcast-crt','broadcast-scanlines'].includes(id))return null;
  const portrait=id.startsWith('portrait-'),light=['studio-torn-paper','studio-pinned','studio-lightbox','editorial-shutters','editorial-iris'].includes(id);
  const full=['studio-diagonal','studio-blinds','studio-radial','studio-scan','studio-page-peel','studio-curtain','editorial-shutters','editorial-iris','broadcast-scanlines','broadcast-crt'].includes(id);
  const x=full?0:portrait?43:8,y=full?0:8,w=full?160:portrait?74:144,h=full?90:74;
  return <g>
    <rect width="160" height="90" fill={light?'#f1f0eb':'#10161c'}/>
    <rect x={x} y={y} width={w} height={h} rx={1} fill="#416661" stroke="#ffffff30" strokeWidth=".7"/>
    <path d={portrait?'M52 74L61 44L76 36L97 43L106 74Z':'M30 68L55 33L80 54L112 24L137 67Z'} fill="#24434a"/>
    <circle cx={portrait?80:112} cy="27" r={portrait?10:7} fill="#b9cbaa"/>
    {id.startsWith('broadcast-')&&Array.from({length:18},(_,i)=><path key={i} d={`M${x} ${y+i*h/18}H${x+w}`} stroke="#06111b" opacity=".45"/>)}
  </g>;
}
export function DocumentaryTemplatePicker({value,onChoose,onClose}:{value?:DocumentaryTemplate;onChoose:(id:DocumentaryTemplate)=>void;onClose:()=>void}){
  const [query,setQuery]=useState(''),[group,setGroup]=useState('all');
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();onClose();}};document.addEventListener('keydown',key,true);return()=>document.removeEventListener('keydown',key,true);},[onClose]);
  const items=documentaryTemplates.filter(([id,label])=>(group==='all'||groupOf(id)===group)&&`${id} ${label}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="documentary-template-picker" role="dialog" aria-modal="true" aria-label="Каталог шаблонов монтажа">
    <header><div><strong>Композиции монтажа</strong><small>{documentaryTemplates.length} шаблонов · схемы расположения, не видеопревью</small></div><button type="button" onClick={onClose} aria-label="Закрыть каталог шаблонов">✕</button></header>
    <div className="documentary-template-filters"><input autoFocus aria-label="Поиск шаблона" placeholder="Фото, плёнка, сравнение…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Категория шаблонов" value={group} onChange={e=>setGroup(e.target.value)}><option value="all">Все композиции</option><option value="photo">Фото и видео</option><option value="compare">Сравнения</option><option value="chapter">Главы</option><option value="fact">Факты и подписи</option></select></div>
    <div className="documentary-template-grid">{items.map(([id,label])=>{
      const kind=groupOf(id);
      return <button type="button" key={id} aria-pressed={id===value} onClick={()=>onChoose(id)} title={label}>
        <DocumentaryTemplateIllustration id={id} label={label}/>
        <span>{label}</span><small>{descriptions[id]??(kind==='compare'?'Два материала рядом для сравнения':kind==='chapter'?'Материал и заголовок раздела':kind==='fact'?'Материал и добавленная подпись':'Композиция для фото или видео')}</small>
      </button>;
    })}</div>{!items.length&&<p>По этому запросу шаблонов нет.</p>}
    <footer>Для сравнения нужны два подтверждённых материала. Изменения видны в предпросмотре; Ctrl+Z отменяет выбор.</footer>
  </div>;
}
