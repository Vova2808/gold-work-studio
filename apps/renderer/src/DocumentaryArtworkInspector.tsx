import {useState} from 'react';
import type {DocumentaryArtwork, DocumentaryArtworkLayer} from '@gold-work/shared';
import {updateArtworkLayer} from './documentary-artwork-edit';

const names = {path:'Контур',rect:'Прямоугольник',ellipse:'Эллипс',text:'Текст',group:'Группа',media:'Материал'};

function ArtworkColor({label,value,palette,onChange}: {label:string;value:string;palette:DocumentaryArtwork['palette'];onChange:(value:string)=>void}) {
  const resolved = value in palette ? palette[value as keyof typeof palette] : value;
  const hex = /^#[\da-f]{6}$/iu.test(resolved) ? resolved : /^#[\da-f]{3}$/iu.test(resolved)
    ? '#'+resolved.slice(1).split('').map(c=>c+c).join('') : '#000000';
  return <div className="timeline-two-fields"><label>{label}<select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>
    <option value="none">Без цвета</option>{Object.keys(palette).map(key=><option key={key} value={key}>{({background:'Фон',ink:'Основной',accent:'Акцент',secondary:'Дополнительный'} as const)[key as keyof typeof palette]}</option>)}
    {!(value in palette)&&value!=='none'&&<option value={value}>Свой цвет · {value}</option>}
  </select></label><label>Свой цвет<input type="color" aria-label={`${label}: свой цвет`} value={hex} onChange={e=>onChange(e.target.value)}/></label></div>;
}

export function DocumentaryArtworkInspector({artwork,onChange}: {artwork:DocumentaryArtwork;onChange:(artwork:DocumentaryArtwork)=>void}) {
  const [selectedId,setSelectedId] = useState(artwork.layers[0]?.id ?? '');
  const layer = artwork.layers.find(item=>item.id===selectedId) ?? artwork.layers[0];
  if (!layer) return null;
  const patch = (values: Partial<DocumentaryArtworkLayer>) => onChange(updateArtworkLayer(artwork,layer.id,values));
  const edit = layer.editTransform ?? {x:0,y:0,scale:1,rotation:0};
  const number = (raw:number,apply:(value:number)=>void) => {if(Number.isFinite(raw)) apply(raw);};
  const transform = (values:Partial<typeof edit>) => patch({editTransform:{...edit,...values}});
  return <fieldset className="artwork-object-inspector"><legend>Объекты Opus / artwork</legend>
    <label>Объект<select aria-label="Объект artwork" value={layer.id} onChange={e=>setSelectedId(e.target.value)}>
      {artwork.layers.map(item=><option key={item.id} value={item.id}>{item.parentId?'↳ ':''}{names[item.kind]} · {item.text?.slice(0,40)||item.id}</option>)}
    </select></label>
    <small>Положение в координатах холста {artwork.canvas.width} × {artwork.canvas.height}. Масштаб и поворот — вокруг исходного центра. Анимация перемещается вместе с объектом; группа включает дочерние объекты.</small>
    <div className="timeline-two-fields">
      <label>X<input aria-label="Объект X" type="number" step={1} value={layer.x+edit.x} onChange={e=>number(e.currentTarget.valueAsNumber,value=>transform({x:value-layer.x}))}/></label>
      <label>Y<input aria-label="Объект Y" type="number" step={1} value={layer.y+edit.y} onChange={e=>number(e.currentTarget.valueAsNumber,value=>transform({y:value-layer.y}))}/></label>
      <label>Масштаб, %<input aria-label="Масштаб объекта" type="number" min={1} max={1000} step={1} value={Number((edit.scale*100).toFixed(4))} onChange={e=>number(e.currentTarget.valueAsNumber,value=>transform({scale:Math.max(.01,Math.min(10,value/100))}))}/></label>
      <label>Поворот, °<input aria-label="Поворот объекта" type="number" step={1} value={edit.rotation} onChange={e=>number(e.currentTarget.valueAsNumber,value=>transform({rotation:value}))}/></label>
    </div>
    <button type="button" disabled={!layer.editTransform} onClick={()=>{const {editTransform:_,...original}=layer;onChange({...artwork,layers:artwork.layers.map(item=>item.id===layer.id?original:item)});}}>Сбросить положение, масштаб и поворот</button>
    {layer.kind==='text'&&<><label>Текст объекта<textarea aria-label="Текст объекта" value={layer.text??''} onChange={e=>patch({text:e.target.value})}/></label>
      <label>Размер шрифта<input aria-label="Размер шрифта объекта" type="number" min={18} max={160} value={layer.fontSize??44} onChange={e=>number(e.currentTarget.valueAsNumber,value=>patch({fontSize:Math.max(18,Math.min(160,value))}))}/></label>
      <label>Выравнивание<select aria-label="Выравнивание текста объекта" value={layer.align??'left'} onChange={e=>patch({align:e.target.value as DocumentaryArtworkLayer['align']})}><option value="left">Слева</option><option value="center">По центру</option><option value="right">Справа</option></select></label></>}
    {['path','rect','ellipse','text'].includes(layer.kind)&&<ArtworkColor label="Заливка объекта" palette={artwork.palette} value={layer.fill??(layer.kind==='text'?'ink':layer.kind==='rect'?'secondary':'none')} onChange={fill=>patch({fill})}/>}
    {['path','rect','ellipse','media'].includes(layer.kind)&&<><ArtworkColor label="Обводка объекта" palette={artwork.palette} value={layer.stroke??(['path','ellipse'].includes(layer.kind)?'ink':'none')} onChange={stroke=>patch({stroke})}/>
      <label>Толщина обводки<input aria-label="Толщина обводки объекта" type="number" min={0} step={.5} value={layer.strokeWidth??2} onChange={e=>number(e.currentTarget.valueAsNumber,value=>patch({strokeWidth:Math.max(0,value)}))}/></label></>}
  </fieldset>;
}
