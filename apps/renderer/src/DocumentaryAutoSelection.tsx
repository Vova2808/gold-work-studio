import {useEffect,useState} from 'react';
import type {AutoStockProgress,DesktopApi,Project} from '@gold-work/shared';

/** The same IPC/service as production, without starting the render queue. */
export function DocumentaryAutoSelection({api,project,disabled,onSelected}:{
  api:DesktopApi;project:Project;disabled:boolean;onSelected:(project:Project)=>Promise<void>;
}){
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState<AutoStockProgress|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>api.onAutoStockProgress(value=>{
    if(value.projectId===project.id)setProgress(value);
  }),[api,project.id]);
  const run=async()=>{
    setBusy(true);setError('');setProgress(null);
    try{
      const result=await api.autoSelectStock(project.id);
      await onSelected(result.project);
      if(result.failed)setError(result.failures.map(f=>`№${f.sceneNumber}: ${f.message}`).join('\n'));
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{setBusy(false);}
  };
  return <div className="documentary-auto-selection">
    <button className="outline-button small" disabled={disabled||busy} onClick={()=>void run()}>
      {busy?'Подбираю материалы…':'Автоподобрать недостающие материалы'}
    </button>
    {progress&&<p role="status">{progress.message}</p>}
    {error&&<p role="alert" className="documentary-error">{error}</p>}
  </div>;
}
