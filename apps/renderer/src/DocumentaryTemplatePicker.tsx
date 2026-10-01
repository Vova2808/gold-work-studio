import {useEffect,useState} from 'react';
import {documentaryTemplates,documentaryLayoutPreset,isDocumentaryStudioTemplate,type DocumentaryTemplate} from '@gold-work/shared';

const groupOf=(id:string)=>documentaryLayoutPreset(id)?.group??(id.startsWith('compare-')?'compare':id.startsWith('chapter')?'chapter':id.startsWith('fact')||['editorial-left','editorial-right'].includes(id)?'fact':'photo');
function SpecialPreview({id}:{id:string}) {
  if(isDocumentaryStudioTemplate(id)||id==='broadcast-scanlines')return <StudioPreview id={id}/>;
  if(!['editorial-shutters','editorial-orbit','editorial-film-gate','editorial-iris','broadcast-crt'].includes(id))return null;
  const dark=id==='editorial-orbit'||id==='broadcast-crt';
  return <g><rect width="160" height="90" fill={dark?'#0a1118':'#eeeede'}/>
    {id==='editorial-orbit'&&[0,1,2].map(i=><ellipse key={i} cx="90" cy="45" rx={60-i*9} ry="42" fill="none" stroke="#81bac588" transform={`rotate(${i*26-25} 90 45)`}/>)}
    {id==='editorial-iris'?<><circle cx="80" cy="45" r="32" fill="#38605d"/><circle cx="80" cy="45" r="34" stroke="#b89b41" fill="none" strokeDasharray="7 3"/></>:<g transform={id==='editorial-orbit'?'translate(6 1) skewY(-4)':undefined}><rect x="9" y="10" width="142" height="70" rx={id==='broadcast-crt'?10:1} fill="#38605d" stroke={dark?'#77958c':'#b4b8b0'}/><path d="M10 69L45 35L78 62L110 28L150 69" fill="#224247"/><circle cx="115" cy="30" r="8" fill="#bad6bb"/></g>}
    {id==='editorial-shutters'&&[0,1,2,3].map(i=><rect key={i} x={9+i*35.5} y={i%2?55:10} width="35.5" height={i%2?25:36} fill={i%2?'#e8eade':'#172327'}/>)}
    {id==='editorial-film-gate'&&[0,1].map(side=><g key={side}><rect x="9" y={side?72:10} width="142" height="9" fill="#10161c"/>{Array.from({length:15},(_,i)=><rect key={i} x={12+i*9} y={side?75:13} width="5" height="3" fill="#eeedda"/>)}</g>)}
    {id==='broadcast-crt'&&Array.from({length:17},(_,i)=><line key={i} x1="11" x2="148" y1={13+i*4} y2={13+i*4} stroke="#020709" opacity=".45"/>)}
  </g>;
}
function StudioPreview({id}:{id:string}){
  const portrait=id.startsWith('portrait-'),is=(s:string)=>id===`studio-${s}`;
  const paper=is('torn-paper')||is('pinned')||is('page-peel');
  const path=id==='portrait-arch'?'M48 84V35A32 32 0 0 1 112 35V84Z':portrait?'M50 6H110V82H50Z':is('diamond')?'M80 4L150 45L80 86L10 45Z':is('hexagon')?'M28 8H132L156 45L132 82H28L4 45Z':is('panorama')?'M4 23H156V67H4Z':is('diagonal')?'M0 0H150L85 90H0Z':is('torn-paper')?'M8 10L33 7L62 11L92 8L150 10L148 40L152 80L117 83L83 79L51 84L8 81L11 51Z':is('gallery-wall')?'M15 14L143 4L143 86L15 76Z':'M8 8H152V82H8Z';
  return <g><rect width="160" height="90" fill={paper?'#eee9dd':'#0c1722'}/>
    {is('lift')&&[0,1,2].map(i=><rect key={i} x={i*54} y={58-i*20} width="54" height={32+i*20} fill="#7f9c72" opacity=".4"/>)}
    <path d={path} fill="#416661" stroke={paper?'#faffef':'#7cafa5'} strokeWidth={is('lightbox')?6:1}/>
    <path d={portrait?'M56 74L61 44L76 36L97 43L106 74Z':'M30 68L55 33L80 54L112 24L137 67Z'} fill="#24434a"/><circle cx={portrait?80:112} cy={portrait?27:27} r={portrait?10:7} fill="#b9cbaa"/>
    {is('blinds')&&[0,1,2,3,4].map(i=><rect key={i} x="8" y={10+i*15} width="144" height="8" fill="#172a36"/>)}
    {is('radial')&&<path d="M80 45L80 0H160V90H80Z" fill="#0c1722"/>}
    {is('spotlight')&&<><rect width="25" height="90" fill="#0c1722"/><rect x="135" width="25" height="90" fill="#0c1722"/><ellipse cx="80" cy="45" rx="60" ry="37" fill="none" stroke="#d6ce7844" strokeWidth="9"/></>}
    {is('pinned')&&<><circle cx="18" cy="11" r="4" fill="#c66a56"/><circle cx="142" cy="11" r="4" fill="#c66a56"/><rect x="8" y="73" width="144" height="9" fill="#f7efdd"/></>}
    {is('page-peel')&&<path d="M76 0H160V84Z" fill="#f4eddb" stroke="#aaa99e" strokeWidth="3"/>}
    {is('curtain')&&[0,1].map(i=><path key={i} d={i?'M160 0H126Q120 48 146 90H160Z':'M0 0H34Q40 48 14 90H0Z'} fill="#7a6566"/>)}
    {is('scan')&&<path d="M77 0V90" stroke="#bcdfa5" strokeWidth="6"/>}
    {id==='broadcast-scanlines'&&<><rect width="160" height="90" fill="#32584d"/>{Array.from({length:23},(_,i)=><path key={i} d={`M0 ${i*4}H160`} stroke="#06111b" opacity=".45"/>)}</>}
  </g>;
}
export function DocumentaryTemplatePicker({value,onChoose,onClose}:{value?:DocumentaryTemplate;onChoose:(id:DocumentaryTemplate)=>void;onClose:()=>void}){
  const [query,setQuery]=useState(''),[group,setGroup]=useState('all');
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();onClose();}};document.addEventListener('keydown',key,true);return()=>document.removeEventListener('keydown',key,true);},[onClose]);
  const items=documentaryTemplates.filter(([id,label])=>(group==='all'||groupOf(id)===group)&&`${id} ${label}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="documentary-template-picker" role="dialog" aria-modal="true" aria-label="Каталог шаблонов монтажа">
    <header><div><strong>Композиции монтажа</strong><small>{documentaryTemplates.length} шаблонов · настройте текст и материалы после выбора</small></div><button type="button" onClick={onClose} aria-label="Закрыть каталог шаблонов">✕</button></header>
    <div className="documentary-template-filters"><input autoFocus aria-label="Поиск шаблона" placeholder="Фото, плёнка, сравнение…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Категория шаблонов" value={group} onChange={e=>setGroup(e.target.value)}><option value="all">Все композиции</option><option value="photo">Фото и видео</option><option value="compare">Сравнения</option><option value="chapter">Главы</option><option value="fact">Факты и подписи</option></select></div>
    <div className="documentary-template-grid">{items.map(([id,label])=>{
      const preset=documentaryLayoutPreset(id),kind=groupOf(id),main=preset?.main??(kind==='compare'?[3,15,45,78]:[4,5,92,90]),second=preset?.second??(kind==='compare'?[52,15,45,78]:undefined),text=preset?.text??[8,70,84,23];
      return <button type="button" key={id} aria-pressed={id===value} onClick={()=>onChoose(id)} title={label}>
        <svg viewBox="0 0 160 90" role="img" aria-label={`Схема: ${label}`}><rect width="160" height="90" fill={preset?.paper?'#e7e1d6':'#12212b'}/>{[main,second].filter(Boolean).map((box,i)=><g key={i}><rect x={box![0]!*1.6} y={box![1]!*.9} width={box![2]!*1.6} height={box![3]!*.9} rx="2" fill={i?'#4d7483':'#38605d'} stroke="#d3dfd2" strokeWidth=".8"/><circle cx={(box![0]!+box![2]!*.5)*1.6} cy={(box![1]!+box![3]!*.5)*.9} r="7" fill="#b2ceaf88"/></g>)}{kind!=='photo'&&<><rect x={text[0]!*1.6} y={text[1]!*.9} width={text[2]!*1.6} height={text[3]!*.9} fill={preset?.paper?'#faf5eadd':'#07111dda'}/><text x={(text[0]!+3)*1.6} y={(text[1]!+text[3]!*.68)*.9} fontSize={kind==='chapter'?12:8} fill={preset?.paper?'#192d32':'#fff'} fontWeight="700">Aa · Заголовок</text></>}<SpecialPreview id={id}/><path d="M4 6H25M4 6V18" stroke="#d2b94c" fill="none"/></svg>
        <span>{label}</span><small>{preset?'Новая композиция':kind==='compare'?'Два материала':'Материал и текст'}</small>
      </button>;
    })}</div>{!items.length&&<p>По этому запросу шаблонов нет.</p>}
    <footer>Для сравнения нужны два подтверждённых материала. Изменения видны в предпросмотре; Ctrl+Z отменяет выбор.</footer>
  </div>;
}
