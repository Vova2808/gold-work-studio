import {useState,useRef} from 'react';
import {documentaryMotionKinds, documentaryRoutePlaces, searchDocumentaryPlaces, validDocumentaryPlace, type DocumentaryMotionGraphic, type DocumentaryPlace, type DesktopApi} from '@gold-work/shared';

function PlacePicker({label,value,onChange}:{label:string;value?:DocumentaryPlace;onChange:(p:DocumentaryPlace)=>void}) {
  const [query,setQuery]=useState('');
  const found=searchDocumentaryPlaces(query);
  return <fieldset><legend>{label}</legend>
    <input aria-label={`${label}: поиск`} placeholder="Название города: Denver, Денвер…" value={query} onChange={e=>setQuery(e.target.value)}/>
    {query.length>=2&&<div className="motion-place-results">{found.map(p=><button type="button" key={p.id} onClick={()=>{onChange({name:p.aliases.find(a=>a.toLowerCase()===query.trim().toLowerCase())??p.name,country:p.country,latitude:p.latitude,longitude:p.longitude,source:'Natural Earth 1:50m'});setQuery('');}}>{p.name} · {p.country}</button>)}{!found.length&&<small>Нет в локальном справочнике. Можно ввести проверенные координаты ниже.</small>}</div>}
    <label>Подпись места<input value={value?.name??''} maxLength={80} onChange={e=>onChange({...value??{latitude:0,longitude:0},name:e.target.value})}/></label>
    <div className="timeline-two-fields"><label>Широта<input type="number" step={.001} min={-90} max={90} value={value?.latitude??''} onChange={e=>onChange({...value??{name:'',longitude:0},latitude:Number(e.target.value),source:'manual'})}/></label>
      <label>Долгота<input type="number" step={.001} min={-180} max={180} value={value?.longitude??''} onChange={e=>onChange({...value??{name:'',latitude:0},longitude:Number(e.target.value),source:'manual'})}/></label></div>
    {value&&<small>{value.country} · {value.source==='manual'?'Ручные координаты':value.source}</small>}
  </fieldset>;
}
export function DocumentaryMotionInspector({api,projectId,sceneId,materials,graphic,duration,title,onChange}:{api:DesktopApi;projectId:string;sceneId:string;materials:Array<{id:string;title:string}>;graphic?:DocumentaryMotionGraphic;duration:number;title:string;onChange:(g:DocumentaryMotionGraphic)=>void}) {
  const [busy,setBusy]=useState(false),[mapError,setMapError]=useState('');
  const latest=useRef({graphic,onChange});latest.current={graphic,onChange};
  const patch=(p:Partial<DocumentaryMotionGraphic>)=>graphic&&onChange({...graphic,...p,reading:p.title!==undefined||p.startSeconds!==undefined?undefined:graphic.reading,readingError:undefined,cutoutPath:undefined,sequenceId:undefined,origin:'manual'});
  const route=graphic?documentaryRoutePlaces(graphic):[];
  const changeRoute=(places:DocumentaryPlace[])=>patch({route:places,fromPlace:places[0],place:places.at(-1),detail:undefined,detailError:undefined});
  const loadMap=async()=>{if(!graphic?.place)return;const place=graphic.place;setBusy(true);setMapError('');
    const radius=graphic.mapRadiusKm??35;
    const requestedRoute=graphic.kind==='map-route'?route:undefined;
    try{const detail=await api.prepareDocumentaryMap(projectId,place,radius,requestedRoute);
      const current=latest.current.graphic;
      if(current?.kind===graphic.kind&&current.place?.latitude===place.latitude&&current.place.longitude===place.longitude&&(current.mapRadiusKm??35)===radius&&(!requestedRoute||JSON.stringify(documentaryRoutePlaces(current))===JSON.stringify(requestedRoute)))latest.current.onChange({...current,detail,detailError:undefined,cityDetail:true,origin:'manual'});
    }catch(e){setMapError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  return <section className="documentary-inspector motion-inspector"><small>MOTION-ГРАФИКА</small>
    <label>Анимация<select aria-label="Motion-графика" value={graphic?.enabled?graphic.kind:'none'} onChange={e=>{
      if(e.target.value==='none'){if(graphic)patch({enabled:false});return;}
      const kind=e.target.value as DocumentaryMotionGraphic['kind'];
      onChange({...graphic,kind,enabled:true,title:graphic?.title??title,startSeconds:graphic?.startSeconds??0,durationSeconds:graphic?.durationSeconds??duration,sequenceId:undefined,origin:'manual',
        ...(kind==='explainer'?{theme:'paper',boardLayout:'parts',cards:graphic?.cards??(graphic?.items??['','']).map(label=>({label}))}:{}),
        ...(kind==='subject-card'?{isolateSubject:true,background:'spotlight',variant:'clean'}:{}),
        ...(kind==='bar-chart'?{background:'grid-dark',cards:graphic?.cards??[{label:'',value:''},{label:'',value:''}]}:{}),
        ...(kind==='annotations'?{annotations:graphic?.annotations??[{label:'',points:[{seconds:0,x:50,y:50}]}]}:{})});
    }}><option value="none">Без motion-графики</option>{documentaryMotionKinds.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    {graphic?.enabled&&<>
      <small>Живой слой поверх исходного материала. Не переписывает речь и не запекается в исходник.</small>
      {['subject-card','bar-chart','explainer'].includes(graphic.kind)&&<label>Фон композиции<select aria-label="Фон композиции" value={graphic.background??'grid-light'} onChange={e=>patch({background:e.target.value as DocumentaryMotionGraphic['background']})}><option value="grid-light">Белая сетка</option><option value="grid-dark">Тёмная сетка</option><option value="diagonal">Диагональные полосы</option><option value="contours">Контурные волны</option><option value="spotlight">Цветовой круг</option></select></label>}
      {['subject-card','quote','annotations'].includes(graphic.kind)&&<label>Стиль композиции<select aria-label="Стиль композиции" value={graphic.variant??(graphic.kind==='annotations'?'technical':'clean')} onChange={e=>patch({variant:e.target.value as DocumentaryMotionGraphic['variant']})}><option value="clean">Чистая типографика</option>{graphic.kind!=='annotations'&&<option value="collage">Бумажный коллаж / маркер</option>}{graphic.kind==='subject-card'&&<option value="poster">Постер · цветная рамка</option>}{graphic.kind==='annotations'&&<option value="technical">Светящиеся выноски</option>}</select></label>}
      <label>Цвет акцента<input aria-label="Цвет акцента" type="color" value={graphic.accentColor??'#57c7ff'} onChange={e=>patch({accentColor:e.target.value})}/></label>
      {['subject-card','annotations'].includes(graphic.kind)&&<div><label><input type="checkbox" checked={graphic.isolateSubject??false} onChange={e=>patch({isolateSubject:e.target.checked})}/>Отделить предмет от фона при сборке</label><small>Для фотографий: локальная обработка с кэшем. Если контур ненадёжен, останется полный исходник и появится сообщение.</small></div>}
      {graphic.kind==='quote'&&<><label>Выделение<select aria-label="Режим выделения" value={graphic.quoteMode??'speech'} onChange={e=>patch({quoteMode:e.target.value as 'speech'|'phrase'})}><option value="speech">По словам за диктором</option><option value="phrase">Постоянная фраза</option></select></label>{graphic.quoteMode==='phrase'?<label>Выделяемая фраза<input aria-label="Выделяемая фраза" maxLength={70} value={graphic.highlight??''} onChange={e=>patch({highlight:e.target.value||undefined})}/></label>:<small>{graphic.readingError??(graphic.reading?'Слова синхронизированы с готовой озвучкой.':'При сборке слова будут сопоставлены с готовой озвучкой локально. До синхронизации показан текст без выделения.')}</small>}</>}
      {['feature-list','statistic','explainer'].includes(graphic.kind)&&<label>Оформление<select value={graphic.theme??'dark'} onChange={e=>patch({theme:e.target.value as 'paper'|'dark'})}><option value="paper">Светлое · сетка и карточки</option><option value="dark">Тёмное · документальное</option></select></label>}
      {['explainer','bar-chart'].includes(graphic.kind)&&<>
        {graphic.kind==='explainer'&&<label>Схема разбора<select aria-label="Схема разбора" value={graphic.boardLayout??'parts'} onChange={e=>patch({boardLayout:e.target.value as 'parts'|'steps'|'compare'})}><option value="parts">Состав · связи с объектом</option><option value="steps">Этапы · последовательность</option><option value="compare">Сравнение · материалы рядом</option></select></label>}
        {(graphic.cards??[]).map((card,index)=><fieldset key={index}><legend>Карточка {index+1}</legend>
          <label>Подпись<input aria-label={`Текст карточки ${index+1}`} maxLength={70} value={card.label} onChange={e=>patch({cards:graphic.cards!.map((c,i)=>i===index?{...c,label:e.target.value}:c)})}/></label>
          <label>Значение / цена<input aria-label={`Значение карточки ${index+1}`} maxLength={48} value={card.value??''} onChange={e=>patch({cards:graphic.cards!.map((c,i)=>i===index?{...c,value:e.target.value}:c)})}/></label>
          {graphic.kind==='explainer'&&<label>Материал<select aria-label={`Материал карточки ${index+1}`} value={card.sceneId??''} onChange={e=>patch({cards:graphic.cards!.map((c,i)=>i===index?{...c,sceneId:e.target.value||undefined}:c)})}><option value="">Без отдельного материала</option>{materials.map(m=><option key={m.id} value={m.id}>{m.title}</option>)}</select></label>}
          <button type="button" disabled={!index} onClick={()=>{const cards=[...graphic.cards!];[cards[index-1],cards[index]]=[cards[index]!,cards[index-1]!];patch({cards});}}>Выше</button>
          <button type="button" disabled={(graphic.cards?.length??0)<=2} onClick={()=>patch({cards:graphic.cards!.filter((_,i)=>i!==index)})}>Удалить карточку</button>
        </fieldset>)}
        <button type="button" disabled={(graphic.cards?.length??0)>=5} onClick={()=>patch({cards:[...graphic.cards??[],{label:''}]})}>Добавить карточку</button>
      </>}
      {graphic.kind==='annotations'&&<>
        <small>Точки относятся к исходному изображению без обрезки. Для движения детали добавьте положения в разные моменты; между ними линия перемещается плавно.</small>
        {(graphic.annotations??[]).map((annotation,index)=><fieldset key={index}><legend>Выноска {index+1}</legend>
          <label>Деталь<input aria-label={`Подпись детали ${index+1}`} maxLength={48} value={annotation.label} onChange={e=>patch({annotations:graphic.annotations!.map((a,i)=>i===index?{...a,label:e.target.value}:a)})}/></label>
          {annotation.points.map((point,p)=><div key={p} className="timeline-two-fields">{(['seconds','x','y'] as const).map(key=><label key={key}>{key==='seconds'?'Время, с':`${key.toUpperCase()}, %`}<input aria-label={`Выноска ${index+1} точка ${p+1} ${key}`} type="number" min={0} max={key==='seconds'?graphic.durationSeconds:100} step={.1} value={point[key]} onChange={e=>patch({annotations:graphic.annotations!.map((a,i)=>i===index?{...a,points:a.points.map((item,j)=>j===p?{...item,[key]:Number(e.target.value)}:item)}:a)})}/></label>)}
            <button type="button" disabled={annotation.points.length<=1} onClick={()=>patch({annotations:graphic.annotations!.map((a,i)=>i===index?{...a,points:a.points.filter((_,j)=>j!==p)}:a)})}>Удалить точку</button>
          </div>)}
          <button type="button" disabled={annotation.points.at(-1)!.seconds>=graphic.durationSeconds} onClick={()=>patch({annotations:graphic.annotations!.map((a,i)=>i===index?{...a,points:[...a.points,{...a.points.at(-1)!,seconds:Math.min(graphic.durationSeconds,a.points.at(-1)!.seconds+1)}]}:a)})}>Добавить положение</button>
          <button type="button" onClick={()=>patch({annotations:graphic.annotations!.filter((_,i)=>i!==index)})}>Удалить выноску</button>
        </fieldset>)}
        <button type="button" disabled={(graphic.annotations?.length??0)>=3} onClick={()=>patch({annotations:[...graphic.annotations??[],{label:'',points:[{seconds:0,x:50,y:50}]}]})}>Добавить выноску</button>
      </>}
      {graphic.sequenceId&&<small>Связанная серия: оформление продолжается на соседних кадрах. Ручное изменение отделит этот кадр от серии.</small>}
      {graphic.kind==='feature-list'&&<>
        <label>Композиция<select aria-label="Композиция списка" value={graphic.presentation??'list'} onChange={e=>{
          const presentation=e.target.value as 'list'|'panels',activeIndex=graphic.activeIndex!==undefined&&graphic.activeIndex<3?graphic.activeIndex:0;
          const alternatives=materials.filter(m=>m.id!==sceneId);
          patch({presentation,...(presentation==='panels'?{activeIndex,panels:Array.from({length:3},(_,i)=>({sceneId:i===activeIndex?sceneId:graphic.panels?.[i]?.sceneId??alternatives[i<activeIndex?i:i-1]?.id??sceneId,label:graphic.items?.[i]??graphic.panels?.[i]?.label??''}))}:{items:graphic.panels?.map(p=>p.label)??graphic.items})});
        }}><option value="list">Список и материал</option><option value="panels" disabled={materials.length<3}>Три панели · фокус</option></select></label>
        {graphic.presentation==='panels'&&<><small>Выделенная панель показывает видео/фото текущего кадра. Остальные сохраняют выбранные постеры.</small>{graphic.panels?.map((panel,index)=><fieldset key={index}><legend>Панель {index+1}</legend>
          <label>Подпись<input aria-label={`Подпись панели ${index+1}`} maxLength={70} value={panel.label} onChange={e=>patch({panels:graphic.panels!.map((p,i)=>i===index?{...p,label:e.target.value}:p)})}/></label>
          <label>Постер<select disabled={index===graphic.activeIndex} value={index===graphic.activeIndex?sceneId:panel.sceneId} onChange={e=>patch({panels:graphic.panels!.map((p,i)=>i===index?{...p,sceneId:e.target.value}:p)})}>{materials.map(m=><option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
        </fieldset>)}</>}
      </>}
      {!graphic.kind.startsWith('map-')&&<label>Заголовок / текст<textarea aria-label="Текст motion-графики" rows={2} maxLength={graphic.kind==='quote'?320:180} value={graphic.title} onChange={e=>patch({title:e.target.value})}/></label>}
      <label>Надзаголовок<input maxLength={60} value={graphic.kicker??''} onChange={e=>patch({kicker:e.target.value})}/></label>
      {['chapter-number','statistic','chronology'].includes(graphic.kind)&&<label>{graphic.kind==='chronology'?'Год':graphic.kind==='chapter-number'?'Номер главы':'Число с единицей, как в сценарии'}<input aria-label="Значение motion-графики" maxLength={48} value={graphic.value??''} onChange={e=>patch({value:e.target.value})}/></label>}
      {graphic.kind==='feature-list'&&<>{graphic.presentation!=='panels'&&<label>Пункты · по одному в строке<textarea rows={5} value={graphic.items?.join('\n')??''} onChange={e=>patch({items:e.target.value.split('\n').slice(0,5).map(s=>s.slice(0,70))})}/></label>}<label>Выделенный пункт<select aria-label="Выделенный пункт" value={graphic.activeIndex??'all'} onChange={e=>{const activeIndex=e.target.value==='all'?undefined:Number(e.target.value);patch({activeIndex,...(graphic.presentation==='panels'?{panels:graphic.panels?.map((p,i)=>i===activeIndex?{...p,sceneId}:p)}:{})});}}>{graphic.presentation!=='panels'&&<option value="all">Все · обзор списка</option>}{(graphic.presentation==='panels'?graphic.panels?.map(p=>p.label):graphic.items)?.map((item,index)=><option key={index} value={index}>{index+1}. {item}</option>)}</select></label></>}
      {graphic.kind.startsWith('map-')&&<>
        <label>Карта<select value={graphic.mapStyle??'full'} onChange={e=>patch({mapStyle:e.target.value as 'full'|'inset'})}><option value="full">На весь экран</option><option value="inset">Окно поверх футажа</option></select></label>
        {graphic.kind==='map-route'?<>
          {(route.length?route:[{name:'',latitude:0,longitude:0},{name:'',latitude:0,longitude:0}]).map((place,index,places)=><div key={index}>
            <PlacePicker label={`Точка ${index+1}`} value={place} onChange={next=>changeRoute(places.map((p,i)=>i===index?next:p))}/>
            <button type="button" disabled={index===0} onClick={()=>{const next=[...places];[next[index-1],next[index]]=[next[index]!,next[index-1]!];changeRoute(next);}}>Выше</button>
            <button type="button" disabled={places.length<=2} onClick={()=>changeRoute(places.filter((_,i)=>i!==index))}>Удалить точку</button>
          </div>)}
          <button type="button" disabled={route.length>=8||route.length<2} onClick={()=>changeRoute([...route,{name:'',latitude:0,longitude:0}])}>Добавить точку маршрута</button>
        </>:<PlacePicker label="Место" value={graphic.place} onChange={place=>patch({place,detail:undefined,detailError:undefined})}/>}
        {(!validDocumentaryPlace(graphic.place)||graphic.kind==='map-route'&&(route.length<2||route.some(p=>!validDocumentaryPlace(p))))&&<p role="alert">Выберите реальные места для карты. Пока координаты не заданы, сборка попросит их уточнить.</p>}
        {graphic.kind==='map-locator'&&<>
          <label>Охват города и окрестностей · {(graphic.mapRadiusKm??35)*2} км<input aria-label="Охват спутниковой карты" type="range" min={15} max={150} step={5} value={graphic.mapRadiusKm??35} onChange={e=>patch({mapRadiusKm:Number(e.target.value),detail:undefined,detailError:undefined,cityDetail:true})}/></label>
        </>}
        <label>Плавное приближение · {Math.round(((graphic.cameraZoom??1.04)-1)*100)}%<input type="range" min={1} max={graphic.kind==='map-route'?1.08:1.2} step={.01} value={graphic.cameraZoom??1.04} onChange={e=>patch({cameraZoom:Number(e.target.value)})}/></label>
        <label>Выделить окрестности · радиус {graphic.regionRadiusKm??0} км<input aria-label="Выделение окрестностей" type="range" min={0} max={50} step={5} value={graphic.regionRadiusKm??0} onChange={e=>patch({regionRadiusKm:Number(e.target.value)})}/></label>
        {!!graphic.regionRadiusKm&&<small>Круг показывает расстояние от точки, а не административную границу региона.</small>}
        <button type="button" disabled={busy||!validDocumentaryPlace(graphic.place)||graphic.kind==='map-route'&&(route.length<2||route.some(p=>!validDocumentaryPlace(p)))} onClick={()=>void loadMap()}>{busy?'Загружаю спутниковый снимок…':graphic.detail?.kind==='satellite'?'Проверить сохранённый снимок':'Загрузить спутниковый снимок'}</button>
        {graphic.detail?.kind==='satellite'&&<small>Спутниковый снимок сохранён · {graphic.kind==='map-route'?`${route.length} точек маршрута`:`охват ${graphic.detail.radiusKm*2} км`} · Sentinel‑2, архив {graphic.detail.imageryDate}. Повторный рендер без сети.</small>}
        {(mapError||graphic.detailError)&&<p role="alert">{mapError||graphic.detailError} Схема вместо снимка не подставляется.</p>}
        <small>Реальная спутниковая мозаика Sentinel‑2 / EOX, слой 2016 (CC BY 4.0). Общий план, без приближения к отдельным домам. Первый снимок требует сети.</small>
      </>}
      {graphic.kind==='callout'&&<div className="timeline-two-fields">{(['anchorX','anchorY'] as const).map((key,i)=><label key={key}>Точка {i?'Y':'X'}, %<input type="range" min={5} max={95} value={graphic[key]??(i?58:60)} onChange={e=>patch({[key]:Number(e.target.value)})}/></label>)}</div>}
      <div className="timeline-two-fields"><label>Начало, с<input type="number" min={0} max={Math.max(0,duration-.3)} step={.1} value={graphic.startSeconds} onChange={e=>{const startSeconds=Math.max(0,Math.min(duration-.3,Number(e.target.value)));patch({startSeconds,durationSeconds:Math.min(graphic.durationSeconds,duration-startSeconds)});}}/></label>
        <label>Длительность, с<input type="number" min={.3} max={duration-graphic.startSeconds} step={.1} value={graphic.durationSeconds} onChange={e=>patch({durationSeconds:Math.max(.3,Math.min(duration-graphic.startSeconds,Number(e.target.value)))})}/></label></div>
    </>}
  </section>;
}
