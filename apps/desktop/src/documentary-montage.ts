import type { DocumentaryArtwork, DocumentaryTemplate, Project, Scene } from "@gold-work/shared";
import {documentaryVideoCoverage,documentaryAccent,groundedDocumentaryMotion} from '@gold-work/shared';
import {planDocumentaryGraphics,documentaryListClause,documentaryStatisticValue,documentaryEditorialSuggestion} from './documentary-editorial.js';
import {planDocumentaryTransitions} from './documentary-transitions.js';
import {enrichSemanticMontage} from './documentary-semantic-montage.js';
import {planDocumentaryArgumentSequences} from './documentary-argument-sequence.js';
import {planDocumentaryArtworkSpans} from './documentary-artwork-span.js';
import {explainDocumentaryGraphic,documentaryDetailAnnotations} from './documentary-explainer.js';

/** Select built-in designs on semantic events, not an overlay on every shot. */
export function planDocumentaryMontage(project: Project, prepare = false, refreshLegacy = false,
  editorPreviewDrafts?:ReadonlyMap<string,DocumentaryArtwork>): Scene[] {
  const stock=project.mediaMode==='stock';
  // Explicit "refresh montage" also renews layouts saved before origins were
  // recorded. Ordinary resume never guesses whether an unmarked edit is manual.
  if (refreshLegacy) project={...project,scenes:project.scenes.map(scene=>{
    const doc=scene.documentary;
    if(doc?.motionGraphic?.routeComparison)return scene;
    if(!doc?.verified||doc.pinned||doc.templateMotion?.amountPercent===0||doc.templateOrigin==='manual'||doc.motionGraphic&&doc.motionGraphic.origin!=='automatic'
      ||!scene.imagePath&&!scene.videoPath&&doc.motionGraphic?.enabled
      ||doc.cuts?.length||doc.texts?.length||scene.includeInAssembly===false)return scene;
    const automaticChapter=doc.template?.startsWith('chapter')&&doc.caption.text===doc.requirement.sectionTitle;
    return {...scene,documentary:{...doc,template:undefined,templateOrigin:undefined,templateMotion:undefined,motionGraphic:undefined,
      caption:automaticChapter?{...doc.caption,enabled:false}:doc.caption}};
  })};
  if(project.settings.assembly.documentary?.montage&&!prepare)
    return planDocumentaryArtworkSpans({...project,scenes:planDocumentaryTransitions({...project,scenes:enrichSemanticMontage(project,editorPreviewDrafts)})});
  // Old unmarked templates may be authored. Reconsider only our own choices;
  // new source geometry or a newly available comparison can change the layout.
  project={...project,scenes:project.scenes.map(scene=>{
    const doc=scene.documentary;if(!doc||doc.motionGraphic?.routeComparison||doc.pinned||doc.templateMotion?.amountPercent===0||scene.includeInAssembly===false)return scene;
    if(stock&&doc.motionGraphic?.origin==='automatic'&&doc.templateOrigin!=='manual'
      &&(scene.videoPath||scene.imagePath)&&!doc.cuts?.length&&!doc.texts?.length)
      return {...scene,documentary:{...doc,motionGraphic:undefined,template:doc.templateOrigin==='automatic'?undefined:doc.template,
        templateOrigin:doc.templateOrigin==='automatic'?undefined:doc.templateOrigin}};
    if(doc.comparison&&doc.layout==='compare'&&doc.motionGraphic?.origin==='automatic'&&doc.motionGraphic.kind==='key-point'&&doc.templateOrigin!=='manual')
      return {...scene,documentary:{...doc,motionGraphic:undefined,template:undefined,templateOrigin:undefined}};
    return doc.templateOrigin==='automatic'&&!doc.motionGraphic&&(stock||!doc.caption.enabled&&!doc.template?.startsWith('chapter'))
      ? {...scene,documentary:{...doc,template:undefined,templateOrigin:undefined}} : scene;
  })};
  let cursor = 0, lastChapter = -40, chapter = 0, photo = 0, comparison = 0;
  // Variety comes from the material and composition, not an opening effect on
  // every photograph. Saved/manual layouts remain editable and compatible.
  const chapters: DocumentaryTemplate[] = ["chapter-line", "chapter-split", "chapter-paper-panel"];
  const density=project.settings.assembly.documentary?.montageDensity;
  const excluded=new Set(project.settings.assembly.documentary?.excludedTemplates??[]);
  const palette: DocumentaryTemplate[] = density==='calm'&&project.settings.assembly.kenBurns!==true?["full","contain"]
    :density==='calm'?["archive-dark","contain","push","pull","museum-mat"]:["push", "contain", "pull", "archive-dark", "museum-mat"];
  const photos=palette.filter(template=>!excluded.has(template));if(!photos.length)photos.push('full');
  const comparisons: DocumentaryTemplate[] = ["compare-equal", "compare-clean", "compare-cards", "compare-stack", "compare-portrait-pair"];
  const titles = new Set<string>();
  const graphics = planDocumentaryGraphics(project,prepare);
  const coverage=documentaryVideoCoverage(project.scenes);
  let mapBudget=Math.max(0,coverage.videoSeconds-coverage.totalSeconds*(project.settings.stockVideoPercent??0)/100);
  const planned = [...project.scenes].sort((a, b) => a.order - b.order).map<Scene>(scene => {
    const start = cursor, doc = scene.documentary;
    const duration = Math.max((doc?.timing?.durationInFrames ?? Math.ceil(scene.durationSeconds * 30)) / 30, scene.durationOverrideSeconds ?? 0);
    if (scene.includeInAssembly !== false) cursor += duration;
    if (doc?.template?.startsWith("chapter")) lastChapter = start;
    if(!stock&&doc?.motionGraphic?.origin==='automatic'&&!doc.pinned&&scene.includeInAssembly!==false){
      const graphic={...doc.motionGraphic,accentColor:doc.motionGraphic.accentColor??documentaryAccent(doc.requirement.sectionTitle||doc.requirement.identities?.[0]?.name||doc.motionGraphic.title||doc.requirement.text)};
      // Before source selection an introduction can only have a generic text
      // event. Upgrade that automatic event once the named subject is verified.
      if(!prepare&&graphic.kind==='key-point'&&doc.verified){
        const suggestion=groundedDocumentaryMotion(documentaryEditorialSuggestion(scene,project.scenes.filter(s=>s.order<scene.order).map(s=>s.narration).join(' ')),scene.narration,project.videoBrief?.readyScript??scene.narration);
        if(suggestion?.kind==='subject-card')return {...scene,documentary:{...doc,motionGraphic:{...suggestion,accentColor:graphic.accentColor,origin:'automatic',durationSeconds:duration,startSeconds:0,variant:'clean',isolateSubject:false}}};
      }
      const visibleDetails=documentaryDetailAnnotations(scene);
      if(visibleDetails&&['feature-list','explainer','callout','annotations'].includes(graphic.kind))
        return {...scene,documentary:{...doc,motionGraphic:{...visibleDetails,accentColor:graphic.accentColor}}};
      if(graphic.kind==='annotations'){
        const updated=documentaryDetailAnnotations(scene);
        return {...scene,documentary:{...doc,motionGraphic:updated?{...updated,accentColor:graphic.accentColor}:{...graphic,enabled:false}}};
      }
      if(graphic.enabled&&graphic.kind==='feature-list'&&!graphic.sequenceId&&!doc.requirement.motionGraphic&&graphic.items?.some(documentaryListClause)){
        return {...scene,documentary:{...doc,motionGraphic:{...graphic,enabled:false}}};
      }
      const members=['feature-list','explainer'].includes(graphic.kind)&&graphic.sequenceId&&graphic.items?.length===3
        ?project.scenes.filter(s=>s.documentary?.motionGraphic?.sequenceId===graphic.sequenceId):[];
      const panels=graphic.items?.map((label,index)=>({label,sceneId:members.find(s=>s.documentary?.motionGraphic?.activeIndex===index&&s.documentary.verified&&s.imagePath)?.id}));
      const canUsePanels=members.length&&panels?.every(p=>p.sceneId)&&graphic.activeIndex!==undefined;
      const value=graphic.kind==='statistic'&&graphic.value?documentaryStatisticValue(
        graphic.sequenceId?project.scenes.filter(s=>s.documentary?.motionGraphic?.sequenceId===graphic.sequenceId).sort((a,b)=>a.order-b.order).map(s=>s.narration).join(''):scene.narration,graphic.value):graphic.value;
      return {...scene,documentary:{...doc,motionGraphic:explainDocumentaryGraphic({...graphic,durationSeconds:duration,
        value,
        ...(canUsePanels?{kind:'feature-list',presentation:'panels',panels:panels as Array<{label:string;sceneId:string}>,cards:undefined,boardLayout:undefined}:{})})}};
    }
    if (!doc || (!doc.verified&&!prepare) || doc.pinned || doc.template || doc.motionGraphic || doc.cuts?.length || doc.texts?.length || scene.includeInAssembly === false) return scene;
    let graphic = graphics.get(scene.id);
    // A full chart replaces footage. Preserve the requested moving-video mix.
    if(graphic?.kind==='bar-chart'&&scene.videoPath){if(prepare||duration>mapBudget)graphic=undefined;else mapBudget-=duration;}
    if (project.settings.assembly.documentary?.autoMotionGraphics !== false && graphic && (duration >= 2.5 || graphic.sequenceId) && doc.layout !== 'compare') {
      // Full maps are not moving stock footage. When the selected video ratio
      // has no room, retain the real video with an inset map instead.
      const map=graphic.kind.startsWith('map-'),moving=Boolean(scene.videoPath&&doc.selected?.kind==='video');
      // An explicit geographic beat is the composition, not an incidental
      // locator over footage. Keep inset behaviour for ordinary place accents.
      const geographicBeat=map&&doc.semanticMontage?.composition?.kind===graphic.kind;
      const mapStyle=!geographicBeat&&map&&(prepare||moving&&duration>mapBudget)?'inset':'full';
      if(map&&moving&&mapStyle==='full')mapBudget-=duration;
      return {...scene,documentary:{...doc,template:'full',templateOrigin:'automatic',motionGraphic:{...graphic,mapStyle:map?mapStyle:undefined,
        value:graphic.kind==='chapter-number'?String(++chapter).padStart(2,'0'):graphic.value,
        durationSeconds:duration,startSeconds:0,origin:'automatic'}}};
    }
    if(!doc.verified)return scene;
    if (doc.layout === "compare" && doc.comparison) {
      const leftAspect=(doc.selected?.width??16)/(doc.selected?.height??9);
      const rightSource=project.scenes.find(s=>s.id===doc.comparison?.sceneId)?.documentary?.selected;
      const rightAspect=(rightSource?.width??16)/(rightSource?.height??9);
      const eligible=comparisons.filter(id=>id==='compare-portrait-pair'?leftAspect<1.1&&rightAspect<1.1:id==='compare-wide-stack'||id==='compare-stack'?leftAspect>2&&rightAspect>2:true);
      return { ...scene, documentary: { ...doc, template:eligible[comparison++ % eligible.length],templateOrigin:'automatic' } };
    }
    const title = doc.requirement.sectionTitle?.trim();
    // Authored titles/captions win, and one short scene is not a chapter card.
    if (!stock && title && project.settings.assembly.documentary?.captionsEnabled && duration >= 2.5 && start - lastChapter >= 35
      && !titles.has(title.toLowerCase()) && (!doc.caption.enabled || doc.caption.text === doc.requirement.caption)) {
      titles.add(title.toLowerCase()); lastChapter = start;
      return { ...scene, documentary: { ...doc, template: chapters[chapter++ % chapters.length],templateOrigin:'automatic', templateMotion: { amountPercent: 18, curve: "smooth" },
        caption: { ...doc.caption, enabled: true, text: title, position: "center", animation: "fade", fontSize:Math.max(80,doc.caption.fontSize) } } };
    }
    if (doc.caption.enabled) {
      const facts:DocumentaryTemplate[]=doc.caption.text.length>75?['fact-margin','fact-large']:['fact','fact-underline'];
      return { ...scene, documentary: { ...doc, template:facts[scene.order%facts.length],templateOrigin:'automatic' } };
    }
    if (doc.selected?.kind === "image") {
      const aspect=(doc.selected.width??16)/(doc.selected.height??9);
      const geometry:DocumentaryTemplate|undefined=aspect<.85?'portrait-stage':doc.layout==='contain'?'contain':aspect>3.2?'detail-scan':undefined;
      return { ...scene, documentary: { ...doc, template:geometry&&!excluded.has(geometry)?geometry:photos[photo++ % photos.length],templateOrigin:'automatic' } };
    }
    return scene;
  });
  const allowed=planned.map(scene=>scene.documentary?.templateOrigin==='automatic'&&scene.documentary.template&&excluded.has(scene.documentary.template)&&!scene.documentary.pinned
    ?{...scene,documentary:{...scene.documentary,template:'full' as const}}:scene);
  const enriched=enrichSemanticMontage({...project,scenes:allowed});
  return planDocumentaryArtworkSpans({...project,scenes:planDocumentaryTransitions({...project,scenes:planDocumentaryArgumentSequences({...project,scenes:enriched})})});
}
