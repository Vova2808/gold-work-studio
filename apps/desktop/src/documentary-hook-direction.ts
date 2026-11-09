// The previous suffix is byte-exact: unfinished paid requests must keep their key.
const previousSparseInstructions=`
CURRENT USER EDITING CHOICE — SPARSE EXPLANATORY GRAPHICS
This overrides the earlier dense-hook/coverage instructions. Real photographs and footage carry the story, including the opening. Use occasional 2D graphics only when a visible comparison, quantity or causal relationship adds understanding. Prefer one coherent explanation over several cards. A 30-second passage normally needs zero or one main explanatory insert; this is a pacing guide, never a quota. Leave ordinary footage without emphasis, composition, artworkBrief or a decorative storyboard text cue. A date, name or mention of a film does not by itself require a caption or television effect. Choose an overlay or an independent insert by meaning. Do not duplicate the same explanation in artwork and native graphics. Keep the available speech duration and deliberate reading holds.`;

export function sparseMontageDirection(system:string,previous=false):string {
  if(previous)return system+previousSparseInstructions;
  return system+previousSparseInstructions.replace('This overrides the earlier dense-hook/coverage instructions.','This limits graphic density, independently of the opening editing rhythm.')+`
OPENING PRIORITY
Keep the hookSeconds opening purposeful and visually active: establish the narrated stakes or contradiction immediately, develop it with suitable approved cutaways, then hold the narrated question or promise. Use only allowedSources whose observed content supports the current line; omit unsupported beats. Prefer distinct sources and readable shots around 1.4–3 seconds when available, not flashing fragments or repeated copies of the same frame. A single short exact phrase or consequential date may emphasize the strongest opening beat; omit subtitles and decorative labels. In the body, keep longer footage holds and only consequential dates, quantities or explanations. Sparse graphics must not turn the hook into a series of static cards. Preserve all narration and the existing voice timing.`;
}
