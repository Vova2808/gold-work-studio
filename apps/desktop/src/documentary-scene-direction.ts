import type {DocumentarySceneDirection} from '@gold-work/shared';

/** Preserve a complete model decision, or omit it visibly; never synthesize a
 * creative answer for a missing response. Legacy plans remain usable. */
export function validateSceneDirection(value:unknown):DocumentarySceneDirection|undefined {
  if(!value||typeof value!=='object')return;
  const v=value as DocumentarySceneDirection;
  const text=(s:unknown):s is string=>typeof s==='string'&&s.trim().length>0&&s.length<=360;
  const alternatives=v.alternatives;
  if(!Array.isArray(alternatives)||alternatives.length<3||alternatives.length>5
    ||alternatives.some(a=>!a||![a.id,a.idea,a.action,a.staging].every(text))
    ||new Set(alternatives.map(a=>a.id)).size!==alternatives.length
    ||new Set(alternatives.map(a=>`${a.action.trim().toLowerCase()}|${a.staging.trim().toLowerCase()}`)).size!==alternatives.length
    ||!alternatives.some(a=>a.id===v.selectedId)||!text(v.reason))return;
  const s=v.storyboard;
  if(!s||![s.entry,s.focus,s.exit,s.join,s.camera?.purpose,s.depth?.purpose,s.typography?.purpose].every(text)
    ||!['hold','follow','reveal'].includes(s.camera.mode)||!['flat','layered'].includes(s.depth.mode)
    ||!['none','label','action'].includes(s.typography.mode)||!['none','click','transition'].includes(s.sound)
    ||!Array.isArray(s.states)||s.states.length<3||s.states.length>5
    ||s.states.some((state,i)=>!state||!Number.isFinite(state.at)||state.at<0||state.at>.8
      ||i>0&&state.at<=s.states[i-1]!.at||!text(state.object)||!text(state.change)))return;
  return {alternatives:alternatives.map(a=>({id:a.id,idea:a.idea,action:a.action,staging:a.staging})),selectedId:v.selectedId,reason:v.reason,
    storyboard:{entry:s.entry,focus:s.focus,states:s.states.map(state=>({...state})),camera:{...s.camera},depth:{...s.depth},
      typography:{...s.typography},exit:s.exit,join:s.join,sound:s.sound}};
}

/** Include direction in the actual response shape; retain old prompt bytes for receipt lookup. */
export function directedMontageSystem(system:string):string {
  return system.replace('Return compact JSON ', 'Every scene, including quiet footage, must include sceneDirection; never return only the older montage fields. Return compact JSON ')
    .replace('cutawaySceneIds:[]', 'cutawaySceneIds:[],sceneDirection:{alternatives:[{id,idea,action,staging},...],selectedId,reason,storyboard:{entry,focus,states:[{at:0,object,change},{at:0.35,object,change},{at:0.7,object,change}],camera:{mode,purpose},depth:{mode,purpose},typography:{mode,purpose},exit,join,sound}}')
    +documentarySceneDirectionSystem;
}

export const documentarySceneDirectionSystem=`
FULL-STORY DIRECTION — CURRENT ORDINARY EDIT
Read storyContext.originalScript and every contextScene, including outside this batch. Each output scene carries sceneDirection. Produce 3–5 materially different feasible alternatives per scene, then select one for the film, not for a standalone card. Keep each string short. Schema:
sceneDirection:{alternatives:[{id,idea,action,staging},...],selectedId,reason,storyboard:{entry,focus,states:[{at:0,object,change},{at:0.35,object,change},{at:0.7,object,change}],camera:{mode:"hold"|"follow"|"reveal",purpose},depth:{mode:"flat"|"layered",purpose},typography:{mode:"none"|"label"|"action",purpose},exit,join,sound:"none"|"click"|"transition"}}.
Alternatives differ in object/state change, spatial composition or causal transition, never only color, label or zoom direction. Choose by supported meaning, available source, seconds, previous and next thought and previousDirections, avoiding repeated shot/action sequences. states describe what the viewer actually sees change, not adjectives. entry and exit describe visible states; join names the specific idea/object/direction inherited by the next shot, or an honest motivated cut. Do not claim a geometric match cut that the existing renderer cannot enact.
Set actual existing treatment/composition/cutawaySceneIds/artworkBrief fields to enact the selected choice. sceneDirection is not itself a visual effect. Native photos remain whole; use the approved native compositions/cuts for them, never request photo fragments. Independent artwork is for a supported unseen relationship: commission objects that transfer, accumulate, connect, unfold, displace, contrast sequential states or react to a cause. A static chart plus fades or a camera zoom is insufficient for that commission. Preserve factual uncertainty; do not invent events, anatomy, quantities, source identities or extra assets. Quiet footage can deliberately hold; do not force action, parallax, graphics or SFX into every shot. Use layered depth only when relative spatial motion develops the chosen idea, and typography action only when exact words participate in that action. Contact/reveal sound is selective, not a whoosh on every cut. Full measured narration and reading windows have priority over beat grids. Complete state changes by .76 and hold the result. This extends the same semantic request; no additional concept service call.`;
