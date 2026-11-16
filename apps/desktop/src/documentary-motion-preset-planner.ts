import {documentaryMotionPresetsFor,documentaryMaterialUsable,
  type DocumentaryMotionGraphic,type DocumentaryMotionPresetId,type DocumentaryTemplate,type Project,type Scene} from '@gold-work/shared';
import {documentaryDiagram} from './documentary-diagram-plan.js';

const words=(text:string)=>text.trim().split(/\s+/u).filter(Boolean);
const copy=(g:DocumentaryMotionGraphic)=>[g.hideTitle?'':g.title,g.value,...(g.cards??[]).map(c=>[c.label,c.value].filter(Boolean).join(' ')),...(g.items??[])].filter(Boolean).join(' ');
const dataBeat=(g:DocumentaryMotionGraphic)=>['explainer','feature-list','statistic','bar-chart','map-route','map-locator','chapter-number'].includes(g.kind);

/** A preset has a stable narrative job; quiet neighboring phrases need not
 * repeat its full choreography just because they have a similar word count. */
function preferred(g:DocumentaryMotionGraphic,scene:Scene):DocumentaryMotionPresetId {
  const text=copy(g),length=words(g.title).length;
  switch(g.kind){
    case 'chapter-number':return /refusal|choice|deal|отказ|выбор|сделк/iu.test(g.title)?'chapter-dossier'
      :/photograph|camera|picture|фотограф|камер|снимок/iu.test(g.title)?'chapter-aperture'
      :/building|weapon|machine|creation|создани|оружи|машин/iu.test(g.title)?'chapter-marquee':'chapter-signal';
    case 'chronology':return /\b(?:memo|letter|document|signed)\b|документ|письм|подписан/iu.test(scene.narration)?'date-stamp'
      :/^\d{4}$/u.test(g.value??'')?'date-ruler':'date-calendar';
    case 'statistic':return /\b(?:of|out of)\b|(?<!\p{L})из(?!\p{L})|\d\s*[/:]\s*\d/iu.test(g.value??'')?'stat-split'
      :/\p{L}|%/u.test(g.value??'')?'stat-ticket':'stat-monument';
    case 'explainer':case 'feature-list':return g.boardLayout==='compare'?'board-ledger'
      :g.boardLayout==='steps'?'board-staircase':'board-cascade';
    case 'subject-card':return /\b(?:driver|engineer|director|rider)\b|гонщик|инженер|директор/iu.test(scene.narration)?'profile-dossier':'profile-strip';
    default:return graphicPhrasePreset(g,text,length);
  }
}

function graphicPhrasePreset(g:DocumentaryMotionGraphic,text:string,length:number):DocumentaryMotionPresetId {
  if(g.highlight||g.variant==='marker')return 'type-ribbon';
  if(/\b(?:not|never|lose|lost|defeat|defeated|beaten)\b|(?<!\p{L})(?:не|никогда)(?!\p{L})|пораж[её]н|побежд[её]н/iu.test(text))return 'type-echo';
  if(/[,;:—–]/u.test(g.title)||length>6)return 'type-stack';
  return length>4?'type-ribbon':'type-slam';
}

/** Plan only existing sources and literal copy. All timing is an editorial
 * estimate, never a manufactured word/speech track. State resets on every run. */
export function createDocumentaryMotionPresetPlanner(project:Project){
  const settings=project.settings.assembly.documentary,options=settings?.montage;
  const active=Boolean(options?.style==='editorial'&&options.intensity==='rich'&&settings?.montageDensity!=='calm'
    &&settings?.autoMotionGraphics!==false);
  const starts=new Map<string,number>(),positions=new Map<string,number>();let cursor=0,lastAccentEnd=-30;
  for(const scene of [...project.scenes].sort((a,b)=>a.order-b.order)){
    starts.set(scene.id,cursor);
    if(scene.includeInAssembly!==false){positions.set(scene.id,positions.size);cursor+=Math.max(1,scene.documentary?.timing?.durationInFrames??Math.ceil(scene.durationSeconds*30),Math.ceil((scene.durationOverrideSeconds??0)*30))/30;}
  }
  const seen=new Map<string,number>();
  let previousPhrase:{position:number;preferred:DocumentaryMotionPresetId;text:string}|undefined;
  const remember=(graphic:DocumentaryMotionGraphic,start:number)=>{
    lastAccentEnd=start+graphic.startSeconds+graphic.durationSeconds;
    seen.set(graphic.kind+':'+copy(graphic),start+graphic.startSeconds);
  };
  return {
    active,
    observe(graphic:DocumentaryMotionGraphic|undefined,start=0){
      if(active&&graphic?.enabled)remember(graphic,start);
    },
    apply(scene:Scene,graphic:DocumentaryMotionGraphic,seconds:number,literalAnchor?:string):DocumentaryMotionGraphic|undefined{
      if(!active||scene.includeInAssembly===false||scene.documentary?.pinned||scene.documentary?.templateOrigin==='manual'
        ||scene.documentary?.templateMotion?.amountPercent===0||!graphic.enabled||graphic.origin!=='automatic'
        ||graphic.hideTitle&&['key-point','quote','chapter-number','subject-card'].includes(graphic.kind))return graphic;
      if(graphic.artwork){remember(graphic,starts.get(scene.id)??0);return graphic;}
      // A saved automatic short accent is not an authored poster. Normalize
      // the old slam too, so already-built films do not keep flashing titles.
      // Manual origins were excluded above; deliberate posters stay untouched.
      if(graphic.preset){
        const planned=graphic.preset==='type-slam'&&graphic.kind==='key-point'&&graphic.variant!=='poster'
          &&!graphic.argument&&!graphic.diagram&&!graphic.photoMoment&&!graphic.reading&&!graphic.sequenceId
          ?{...graphic,preset:undefined,variant:'clean' as const}:graphic;
        remember(planned,starts.get(scene.id)??0);return planned;
      }
      const choices=documentaryMotionPresetsFor(graphic);
      // Measured speech, multi-scene boards and sequences retain their existing
      // renderer AND timing. A local map is the sole non-preset data operation.
      if(!choices.length&&!(literalAnchor&&graphic.kind.startsWith('map-')))return graphic;
      const sourceCopy=copy(graphic),anchor=literalAnchor??(graphic.value||graphic.title||graphic.cards?.[0]?.label||graphic.items?.[0]||''),at=anchor?scene.narration.indexOf(anchor):-1;
      const total=Math.max(1,words(scene.narration).length),onset=graphic.kind==='chapter-number'?graphic.startSeconds:at>=0?seconds*words(scene.narration.slice(0,at)).length/total:graphic.startSeconds;
      const spoken=at>=0?seconds*words(anchor).length/total:0;
      const reading=words(sourceCopy).length/3.2+.8;
      const minimum=graphic.kind==='chronology'?4:dataBeat(graphic)?3.4:3;
      const hold=graphic.kind==='chapter-number'?Math.max(2.6,Math.min(3.2,reading))
        :Math.max(minimum,Math.min(graphic.kind==='chronology'?6:5.5,Math.max(reading,spoken+.8)));
      const diagram=documentaryDiagram(scene,graphic),totalFrames=Math.max(1,Math.round(seconds*30));
      const anchoredStart=Math.max(0,Math.min(totalFrames-1,Math.round(Math.max(.3,onset-(graphic.kind==='chapter-number'?0:.15))*30)));
      // The onset is an editorial estimate, not measured speech alignment. A
      // late date/quantity must enter before the spoken number if otherwise
      // its readable window would collapse into a few frames at the cut.
      const readableFact=graphic.kind==='chronology'||graphic.kind==='statistic'||Boolean(diagram);
      const lastReadableStart=Math.max(0,totalFrames-Math.min(totalFrames,Math.ceil(minimum*30)));
      const startFrame=readableFact?Math.min(anchoredStart,lastReadableStart):anchoredStart;
      const durationFrames=Math.max(1,Math.min(Math.ceil(hold*30),totalFrames-startFrame));
      const absolute=(starts.get(scene.id)??0)+startFrame/30;
      // Consecutive explanations are allowed: a universal data cooldown used
      // to erase the counterpoint of an actual two-sided argument.
      const repeated=seen.get(graphic.kind+':'+sourceCopy);
      // The semantic editor has already spaced explicit compositions. Do not
      // erase the next deliberate beat using the fallback-caption cooldown.
      const explicit=scene.documentary?.semanticMontage?.composition?.kind===graphic.kind;
      if(graphic.kind!=='chapter-number'&&(literalAnchor&&repeated!==undefined&&absolute-repeated<20
        ||graphic.kind==='key-point'&&absolute-lastAccentEnd<(explicit?0:1.2)))return;
      const id=preferred(graphic,scene),position=positions.get(scene.id)??-1;
      const photoBeat=graphic.kind==='key-point'&&/\bphotographs?\b|(?<!\p{L})(?:фотографи(?:я|и|ю|й|ей|ям|ями|ях)|сним(?:ок|ка|ке|ки|ков|ком|ками))(?!\p{L})/iu.test(graphic.title)&&Boolean(scene.videoPath||scene.imagePath);
      const ordinaryPhrase=graphic.kind==='key-point'&&graphic.variant!=='poster'&&!diagram&&!graphic.argument&&!photoBeat;
      const repeatedStyle=ordinaryPhrase&&(id==='type-slam'||id==='type-ribbon')&&previousPhrase?.position===position-1
        &&previousPhrase.preferred===id&&previousPhrase.text!==sourceCopy;
      let chosen=id,quiet=ordinaryPhrase&&id==='type-slam';
      if(repeatedStyle){
        // A highlighted contrast or a structured sentence may justify another
        // existing treatment. Otherwise keep the exact accent over large footage.
        const meaning=graphicPhrasePreset({...graphic,highlight:undefined,variant:undefined},sourceCopy,words(graphic.title).length);
        if((meaning==='type-echo'||meaning==='type-stack')&&choices.some(p=>p.id===meaning))chosen=meaning;
        else quiet=true;
      }
      // Remember the narrative request even when it is rendered quietly, so a
      // run of routine phrases does not alternate slam/quiet/slam mechanically.
      if(ordinaryPhrase)previousPhrase={position,preferred:id,text:sourceCopy};
      const sourceEmphasis=graphic.kind==='key-point'&&quiet
        &&!diagram&&!graphic.argument&&!graphic.reading&&!graphic.sequenceId&&!photoBeat&&!(graphic.items?.length);
      const preset=sourceEmphasis?'source-emphasis':quiet?undefined:choices.find(p=>p.id===chosen)?.id;
      const planned:DocumentaryMotionGraphic={...graphic,preset,diagram,...(quiet?{variant:'clean' as const}:{}),
        ...(sourceEmphasis?{showSource:documentaryMaterialUsable(scene)&&(graphic.kind!=='statistic'||scene.documentary?.verified===true)}:{}),startSeconds:startFrame/30,durationSeconds:durationFrames/30};
      if(preset==='type-ribbon'&&!planned.highlight)planned.highlight=graphic.title;
      if(photoBeat){
        const consequence=/(?:\b(?:will not|did not|never)\b|(?<!\p{L})не(?!\p{L}))[^.!?]{1,45}/iu.exec(scene.narration)?.[0]?.trim();
        const available=Math.max(1,Math.round(seconds*30)-startFrame);
        planned.durationSeconds=available/30;
        planned.photoMoment={captureFrame:Math.min(18,Math.floor(available*.20)),consequence:consequence&&words(consequence).length<=7?consequence:undefined,
          consequenceFrame:Math.max(36,available-40)};
      }
      remember(planned,starts.get(scene.id)??0);
      return planned;
    },
    photoTemplate(scene:Scene):DocumentaryTemplate|undefined{
      if(!active||project.settings.assembly.kenBurns===false||scene.includeInAssembly===false||scene.documentary?.pinned||scene.documentary?.templateOrigin==='manual'
        ||scene.documentary?.templateMotion?.amountPercent===0||!scene.imagePath||scene.videoPath)return;
      if(scene.kenBurnsDirection&&scene.kenBurnsDirection!=='auto')return scene.documentary?.template;
      const excluded=new Set(settings?.excludedTemplates??[]),aspect=(scene.documentary?.selected?.width??16)/(scene.documentary?.selected?.height??9);
      // Keep the source large. Geometry and actual archive context still win;
      // an ordinary long photograph is not automatically another push-in.
      const archive=/\b(?:archive|archival|newspaper|document|photograph from)\b|архив|газет|документ/iu.test(scene.narration);
      const seconds=Math.max(scene.durationSeconds,(scene.documentary?.timing?.durationInFrames??0)/30);
      const beat=scene.documentary?.semanticMontage?.beat;
      const directed:DocumentaryTemplate=seconds<4?'full':beat==='establish'||beat==='resolve'?'pull'
        :beat==='conflict'||beat==='turn'?'push':'full';
      const template:DocumentaryTemplate=aspect>3.2||aspect<.85?'contain':archive?'archive-dark':directed;
      return excluded.has(template)?'full':template;
    },
  };
}
