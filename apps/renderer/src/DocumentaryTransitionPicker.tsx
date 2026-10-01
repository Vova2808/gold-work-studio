import {useEffect,useRef,useState} from 'react';
import {documentarySceneTransition,documentaryTransitionPair,type DesktopApi,type EffectAsset,type Project,type Scene} from '@gold-work/shared';

export function DocumentaryTransitionPicker({api,project,left,right,busy,onApply,onClose}:{api:DesktopApi;project:Project;left:Scene;right:Scene;busy:boolean;
  onApply:(changes:Map<string,Partial<Scene>>)=>void;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const boundary=left.documentary?.effects.find(e=>e.boundary?.from===left.id&&e.boundary.to===right.id);
  const resolved=documentarySceneTransition(left,project.settings.assembly);
  const automatic=documentarySceneTransition({...left,transition:undefined,transitionDurationSeconds:undefined},project.settings.assembly);
  const seconds=(scene:Scene)=>Math.max((scene.documentary?.timing?.durationInFrames??Math.ceil(scene.durationSeconds*30))/30,scene.durationOverrideSeconds??0);
  const maximum=Math.max(.1,Math.min(1.5,seconds(left)/3,seconds(right)/3));
  const [kind,setKind]=useState<'auto'|'none'|'mix'|'fade'|'blur'|'library'>(boundary?'library':left.transition==='mix'&&left.documentary?.transitionStyle==='blur'?'blur':left.transition??'auto');
  const [duration,setDuration]=useState(Math.min(maximum,resolved.durationSeconds||.35));
  const [assets,setAssets]=useState<EffectAsset[]>([]),[assetId,setAssetId]=useState(boundary?.assetId??'');
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let live=true;dialog.current?.showModal();void api.getEffectLibrary().then(snapshot=>{
    if(live)setAssets(snapshot.assets.filter(a=>!a.deletedAt&&a.state==='ready'&&a.kind!=='audio'&&['transition','light-leak'].includes(a.category)));
  }).catch(e=>{if(live)setError(String(e));});return()=>{live=false;};},[api]);
  const clear=(scene:Scene)=>scene.documentary!.effects.filter(e=>!(e.boundary?.from===left.id&&e.boundary.to===right.id));
  const apply=async()=>{
    if(busy||saving)return;setSaving(true);setError('');
    try{
      let leftEffects=clear(left),rightEffects=clear(right);
      if(kind==='library'){
        if(!assetId)throw new Error('Выберите переход из библиотеки.');
        const asset=assets.find(a=>a.id===assetId);if(!asset)throw new Error('Этот переход больше не доступен. Выберите другой.');
        if([leftEffects,rightEffects].some(effects=>effects.filter(e=>e.kind!=='audio'&&e.role!=='background').length>=2))throw new Error('В одном из кадров уже два визуальных эффекта. Удалите лишний эффект или выберите обычное растворение.');
        const effect=await api.prepareDocumentaryEffect(project.id,assetId);
        effect.durationSeconds=Math.max(.1,(asset.defaults.trimEndSeconds??asset.metadata?.durationSeconds??effect.durationSeconds)-asset.defaults.trimStartSeconds);
        const [outgoing,incoming]=documentaryTransitionPair(left,right,effect,'manual');
        leftEffects=[...leftEffects,outgoing!];rightEffects=[...rightEffects,incoming!];
      }
      onApply(new Map<string,Partial<Scene>>([
        [left.id,{transition:kind==='auto'?undefined:kind==='library'?'none':kind==='blur'?'mix':kind,transitionDurationSeconds:kind==='auto'?undefined:kind==='none'||kind==='library'?0:duration,
          documentary:{...left.documentary!,effects:leftEffects,transitionStyle:kind==='auto'?undefined:kind==='blur'?'blur':'clean'}}],
        [right.id,{documentary:{...right.documentary!,effects:rightEffects}}],
      ]));onClose();
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setSaving(false);}
  };
  const chosen=assets.find(a=>a.id===assetId);
  return <dialog ref={dialog} className="documentary-transition-picker" onCancel={e=>{e.preventDefault();if(!saving)onClose();}}>
    <header><div><small>СТЫК КАДРОВ</small><h3>{left.order+1} → {right.order+1}</h3></div><button disabled={saving} onClick={onClose} aria-label="Закрыть выбор перехода">×</button></header>
    <p>{left.title} → {right.title}</p>
    <label>Переход<select disabled={busy||saving} value={kind} onChange={e=>setKind(e.target.value as typeof kind)}>
      <option value="auto">Автоматически по монтажному плану</option><option value="none">Обычная склейка</option>
      <option value="mix">Растворение / наложение кадров</option><option value="fade">Через чёрный</option><option value="blur">Плавное размытие</option><option value="library">Визуальный переход из библиотеки</option>
    </select></label>
    {(kind==='mix'||kind==='fade'||kind==='blur')&&<label>Длительность · {duration.toFixed(2)} с<input disabled={busy||saving} type="range" min="0.1" max={maximum} step="0.05" value={duration} onChange={e=>setDuration(Number(e.target.value))}/></label>}
    {kind==='library'&&<><label>Эффект<select disabled={busy||saving} value={assetId} onChange={e=>setAssetId(e.target.value)}><option value="">Выберите визуальный переход</option>{assets.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      {chosen&&<small>Переход целиком пересекает стык двух кадров. Собственный звук эффекта выключен.</small>}
      {!assets.length&&<p>В библиотеке пока нет готовых визуальных переходов. Можно выбрать обычное растворение или добавить свой эффект в библиотеку.</p>}</>}
    {kind==='auto'&&<p>Сейчас по плану: {automatic.kind==='mix'?'растворение':automatic.kind==='fade'?'через чёрный':'склейка'}. Приложение уточнит план при сборке.</p>}
    <small>Меняется только этот стык. Озвучка и длительность ролика сохраняются. Сохраните правки кнопкой «Применить» в редакторе.</small>
    {error&&<p role="alert" className="error">{error}</p>}
    <footer><button disabled={saving} onClick={onClose}>Отмена</button><button className="generate-button compact" disabled={busy||saving} onClick={()=>void apply()}>{saving?'Подготавливаю…':'Выбрать переход'}</button></footer>
  </dialog>;
}
