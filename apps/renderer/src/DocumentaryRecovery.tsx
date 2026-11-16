import {useState} from 'react';
import type {DesktopApi,DocumentaryRecoveryItem} from '@gold-work/shared';

export function DocumentaryRecovery({api,projectId,onContinue,label='Продолжить после ошибки',purpose,disabled=false}:{api:DesktopApi;projectId:string;onContinue:()=>Promise<void>;label?:string;purpose?:string;disabled?:boolean}) {
  const [requests,setRequests]=useState<DocumentaryRecoveryItem[]|null>(null),[selected,setSelected]=useState<Set<string>>(new Set());
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false);
  const inspect=async()=>{if(busy)return;setBusy(true);setError('');try{
    if(!await api.probeDocumentaryConnection())throw Error('Связь с AnyModel пока недоступна. Запросы не повторялись.');
    const items=(await api.getDocumentaryRecovery(projectId)).filter(item=>!purpose||item.purpose===purpose);setRequests(items);setConfirmed(false);setSelected(new Set());
    if(!items.length)await onContinue();
  }catch(e){setError(String(e));}finally{setBusy(false);}};
  const resume=async(retry:boolean)=>{if(busy)return;setBusy(true);setError('');try{
    if(retry){if(!confirmed||!selected.size)return;await api.authorizeDocumentaryRetry(projectId,requests!.filter(r=>selected.has(r.id)));}
    setRequests(null);await onContinue();
  }catch(e){setError(String(e));}finally{setBusy(false);}};
  return <section className="documentary-recovery">
    <button type="button" className="generate-button compact" disabled={busy||disabled} onClick={()=>void inspect()}>{busy?'Проверяю…':label}</button>
    {requests&&requests.length>0&&<div className="documentary-recovery-requests"><strong>Требуют решения: {requests.length} запросов</strong>
      <p>Готовые голоса и материалы сохранятся. Для выбранных запросов возможна повторная оплата; разрешается одна новая отправка каждого.</p>
      <div style={{maxHeight:180,overflowY:'auto'}}>{requests.map(r=><label key={r.id} style={{display:'block'}}><input type="checkbox" disabled={busy} checked={selected.has(r.id)} onChange={e=>setSelected(s=>{const n=new Set(s);e.target.checked?n.add(r.id):n.delete(r.id);return n;})}/>{r.sceneNumber?`Сцена №${r.sceneNumber} · `:''}{r.purpose==='semantic-montage'?'AI-монтаж и музыка':r.purpose} · {r.knownEmpty?'получен пустой ответ':`${r.characters} знаков`}{!r.sceneNumber&&r.narration?` · ${r.narration.slice(0,90)}`:''}</label>)}</div>
      <label><input type="checkbox" disabled={busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Разрешаю один повтор выбранных запросов с возможным списанием</label>
      <div className="documentary-effect-actions"><button type="button" className="outline-button small" disabled={busy||disabled} onClick={()=>void resume(false)}>Продолжить без их повтора</button><button type="button" className="generate-button compact" disabled={busy||disabled||!confirmed||!selected.size} onClick={()=>void resume(true)}>Повторить выбранные ({selected.size}) и продолжить</button></div>
    </div>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
