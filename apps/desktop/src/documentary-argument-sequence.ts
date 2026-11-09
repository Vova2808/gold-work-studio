import type {DocumentaryArgument,Project,Scene} from '@gold-work/shared';
import {localMontageAccent} from './documentary-local-montage.js';

const words=(s:string)=>s.trim().split(/\s+/u).filter(Boolean);
const frames=(s:Scene)=>Math.max(s.documentary?.timing?.durationInFrames??Math.ceil(s.durationSeconds*30),Math.ceil((s.durationOverrideSeconds??0)*30));
const editable=(s:Scene)=>Boolean(s.documentary&&!s.documentary.pinned&&s.documentary.templateOrigin!=='manual'
  &&s.documentary.motionGraphic?.origin!=='manual'&&s.documentary.templateMotion?.amountPercent!==0
  &&!s.documentary.semanticMontage&&!s.documentary.motionGraphic?.reading
  &&!(s.documentary.cuts?.length&&s.documentary.cutsOrigin!=='automatic')&&(s.imagePath||s.videoPath));

/** Only the explicit pattern A has [items], B has [items], A-versus-B is
 * connected. Adjacency alone is never used to label images or invent a claim. */
export function planDocumentaryArgumentSequences(project:Project):Scene[]{
  const settings=project.settings.assembly.documentary;
  if(settings?.montage?.style!=='editorial'||settings.montage.intensity!=='rich'
    ||settings.montageDensity==='calm'||settings.autoMotionGraphics===false)return project.scenes;
  const included=project.scenes.filter(s=>s.includeInAssembly!==false).sort((a,b)=>a.order-b.order);
  const changes=new Map<string,Scene>();
  for(let i=2;i<included.length;i++){
    const shots=included.slice(i-2,i+1);
    if(shots.some(s=>!editable(s)||changes.has(s.id)))continue;
    const accents=shots.map(localMontageAccent),last=accents[2]?.graphic;
    if(last?.boardLayout!=='compare'||last.cards?.length!==2||shots.some(s=>frames(s)<66))continue;
    const headers=shots.slice(0,2).map(s=>/^\s*([^.!?:]{1,45}?)\s+(?:had|has|have|includes|contains|consists of|включает|содержит|состоит из)\s+/iu.exec(s.narration)?.[1]?.trim());
    if(headers.some(h=>!h||words(h).length>4)||headers[0]===headers[1])continue;
    if(accents.slice(0,2).some(a=>a?.graphic.boardLayout!=='parts'||!a.graphic.cards?.length))continue;
    // A short comparison sentence is the conclusion, not a clause in a new topic.
    const contrast=/^\s*.+?\s+(?:versus|vs\.?|against|whereas|while|rather than|против|тогда как|вместо)\s+.+?[.!?]?\s*$/iu.test(shots[2]!.narration);
    if(!contrast||words(shots[2]!.narration).length>16)continue;
    const groups=accents.slice(0,2).map((a,j)=>({title:headers[j]!,items:a!.graphic.cards!.map(c=>c.label),summary:last.cards![j]!.label})) as DocumentaryArgument['groups'];
    const sequenceId=`argument:${shots.map(s=>s.id).join(':')}`;
    shots.forEach((s,j)=>{
      const total=frames(s),labels=j<2?groups[j]!.items:groups.map(g=>g.summary);
      const itemFrames=labels.map(label=>{
        const at=s.narration.indexOf(label);
        const onset=at<0?0:words(s.narration.slice(0,at)).length/Math.max(1,words(s.narration).length)*total;
        return Math.max(0,Math.min(total-18,Math.round(onset)-3));
      });
      const base=accents[j]!.graphic;
      changes.set(s.id,{...s,documentary:{...s.documentary!,template:'full',templateOrigin:'automatic',
        motionGraphic:{...base,enabled:true,origin:'automatic',preset:j===2?'board-ledger':'board-cascade',sequenceId,
          argument:{stage:j as 0|1|2,groups,itemFrames},startSeconds:0,durationSeconds:total/30}}});
    });
  }
  return project.scenes.map(s=>changes.get(s.id)??s);
}
