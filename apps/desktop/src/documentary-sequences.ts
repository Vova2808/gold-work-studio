import type {DocumentaryMotionGraphic, Scene} from '@gold-work/shared';

const words=(s:string)=>` ${s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()} `;
export const documentarySceneSeconds=(s:Scene)=>Math.max((s.documentary?.timing?.durationInFrames??Math.ceil(s.durationSeconds*30))/30,s.durationOverrideSeconds??0);
export const acceptsAutomaticGraphic=(s:Scene,prepare=false)=>Boolean(s.includeInAssembly!==false&&s.documentary&&(prepare||s.documentary.verified)&&!s.documentary.pinned&&!s.documentary.template&&!s.documentary.motionGraphic&&!s.documentary.cuts?.length&&!s.documentary.texts?.length&&s.documentary.layout!=='compare');

/** Connect a literal list only to consecutive shots that name exactly one item.
 * Ambiguous matches, manual edits and unrelated narration end the sequence. */
export function documentaryListSequence(scenes:Scene[],index:number,graphic:DocumentaryMotionGraphic,prepare=false):Array<{scene:Scene;graphic:DocumentaryMotionGraphic}>{
  const first=scenes[index]!;
  const single=[{scene:first,graphic}];
  if(graphic.kind!=='feature-list'||!graphic.items||graphic.items.length<2)return single;
  const members:Array<{scene:Scene;activeIndex?:number}>=[{scene:first}],active=new Set<number>();
  let seconds=documentarySceneSeconds(first);
  let introduction=!/[.!?]\s*$/u.test(first.narration);
  for(const scene of scenes.slice(index+1,index+15)){
    if(!acceptsAutomaticGraphic(scene,prepare)||documentarySceneSeconds(scene)<1/30||seconds+documentarySceneSeconds(scene)>45)break;
    if(introduction){
      members.push({scene});seconds+=documentarySceneSeconds(scene);introduction=!/[.!?]\s*$/u.test(scene.narration);continue;
    }
    const matches=graphic.items.flatMap((item,i)=>words(scene.narration).includes(words(item))?[i]:[]);
    const previous=members.at(-1)!;
    if(!matches.length&&previous.activeIndex!==undefined&&!/[.!?]\s*$/u.test(previous.scene.narration))matches.push(previous.activeIndex);
    if(matches.length!==1)break;
    members.push({scene,activeIndex:matches[0]});active.add(matches[0]!);seconds+=documentarySceneSeconds(scene);
  }
  if(active.size<2)return single;
  const panels=graphic.items.length===3&&active.size===3?graphic.items.map((label,index)=>({label,sceneId:members.find(m=>m.activeIndex===index)!.scene.id})):undefined;
  const canUsePanels=panels?.every(panel=>scenes.find(scene=>scene.id===panel.sceneId)?.imagePath);
  return members.map(({scene,activeIndex})=>({scene,graphic:{...graphic,sequenceId:`list-${first.id}`,theme:'paper',activeIndex,
    ...(canUsePanels&&activeIndex!==undefined?{presentation:'panels',panels}:{}),
  }}));
}
