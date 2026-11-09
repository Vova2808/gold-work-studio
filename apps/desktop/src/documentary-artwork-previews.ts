import {createHash} from 'node:crypto';
import {mkdir,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {Project} from '@gold-work/shared';
import {effectFfmpeg} from './effect-media.js';
import {withDocumentaryFrameSlot} from './documentary-resources.js';
import {recordDiagnosticEvent} from './diagnostics.js';
import {allowedArtworkMediaSources,artworkForegroundAllowed} from './documentary-artwork-source-allowlist.js';
import {documentarySourceFootageIssue} from './documentary-source-eligibility.js';

export type ArtworkSourceCandidate={sceneId:string;kind:'image'|'video';file:string;title?:string;observedContent?:string;
  width?:number;height?:number;identityStatus:'verified'|'editorial';
  variants:Array<{name:'original'|'foreground';status:'actual'|'on-request'}>};
/** Only already selected material may become an authored media viewport. */
export function artworkSourceCandidates(project:Project,sceneId:string):ArtworkSourceCandidate[]{
  const sources=allowedArtworkMediaSources(project,sceneId);
  const candidate=(source:Project['scenes'][number]):ArtworkSourceCandidate|undefined=>{
    const file=source.videoPath||source.imagePath,selected=source.documentary?.selected;
    if(!file||!selected)return undefined;
    const kind=source.videoPath?'video':'image';
    return {sceneId:source.id,kind,file,title:selected.title?.slice(0,400),
      observedContent:source.documentary?.visualReview?.viewDescription?.slice(0,600),
      width:selected.width,height:selected.height,identityStatus:source.documentary?.verified===true?'verified':'editorial',
      variants:[{name:'original',status:'actual'},...(artworkForegroundAllowed(source)?[{name:'foreground' as const,status:'on-request' as const}]:[])]};
  };
  return sources.map(candidate).filter((item):item is ArtworkSourceCandidate=>Boolean(item));
}

/** Small samples of already accepted material, in the SAME design request. No search or review. */
export async function motionArtworkPreviews(project:Project,input:string,root:string,signal?:AbortSignal,includeStandalone=false,legacy=false) {
  const payload=JSON.parse(input) as {scenes:Array<{sceneId:string;editable:boolean;artworkMode?:string;artworkBrief?:unknown;sourcePreviewImage?:number;sourcePreviewSeconds?:number;sourcePreviewSha256?:string;sourceDescription?:string;sourceObservedContent?:string;preciseSourceAnchorsAvailable?:boolean;
    sourceCatalog?:Array<{sourceSceneId:string;kind:'image'|'video';previewImage:number;previewSeconds:number;previewSha256:string;title?:string;observedContent?:string;width?:number;height?:number;identityStatus:'verified'|'editorial';variants:ArtworkSourceCandidate['variants']}>}>};
  const images:string[]=[];
  const directory=join(root,'Documentary','Montage','Previews');
  for(const row of payload.scenes){
    signal?.throwIfAborted();
    const scene=project.scenes.find(s=>s.id===row.sceneId);
    if(!row.editable||!scene)continue;
    // Legacy reconstruction above the dispatch boundary must stay byte exact.
    // New authoring receives the contradiction even when no preview is allowed.
    const footageIssue=!legacy&&documentarySourceFootageIssue(scene);
    if(footageIssue)Object.assign(row,{footageIssue,sourceMedia:{available:false},
      sourceTitle:scene.documentary?.selected?.title,sourceObservedContent:scene.documentary?.visualReview?.viewDescription});
    // A standalone schematic is explicitly forbidden from using the source.
    // Sending its unrelated photograph both biases the design toward captions
    // and needlessly routes the request through a vision provider.
    if(row.artworkMode==='standalone'&&!row.artworkBrief&&!includeStandalone)continue;
    // The predecessor sent the current file even before source verification.
    // Reconstruct it only for checkpoint lookup; new authoring uses the strict
    // selected-source allowlist shared with render preparation.
    const legacyFile=scene.videoPath||scene.imagePath;
    const candidates=legacy&&legacyFile?[{sceneId:scene.id,kind:scene.videoPath?'video' as const:'image' as const,
      file:legacyFile,title:scene.documentary?.selected?.title?.slice(0,400),
      observedContent:scene.documentary?.visualReview?.viewDescription?.slice(0,600),
      width:scene.documentary?.selected?.width,height:scene.documentary?.selected?.height,
      identityStatus:scene.documentary?.verified===true?'verified' as const:'editorial' as const,
      variants:[] as ArtworkSourceCandidate['variants']}]:artworkSourceCandidates(project,scene.id);
    for(const source of candidates){
      const selected=project.scenes.find(item=>item.id===source.sceneId)!;
      // A video frame is a sample, never a promise of a stable tracked object.
      const at=source.kind==='video'?(selected.trimStartSeconds??0)+Math.min(.5,selected.durationSeconds*.15):0;
      try{
      const file=source.file;
      const info=await stat(file);
      const key=createHash('sha256').update(JSON.stringify([file,info.size,info.mtimeMs,at,640])).digest('hex');
      const path=join(directory,key+'.jpg');
      let bytes=await readFile(path).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});
      if(!bytes){
        await mkdir(directory,{recursive:true});
        await withDocumentaryFrameSlot(()=>effectFfmpeg(['-y',...(source.kind==='video'?['-ss',String(at)]:[]),'-i',file,'-frames:v','1','-vf','scale=640:640:force_original_aspect_ratio=decrease','-q:v','5',path],signal));
        bytes=await readFile(path);
      }
      const previewImage=images.length+1,previewSha256=createHash('sha256').update(bytes).digest('hex');
      if(source.sceneId===scene.id){
        row.sourcePreviewImage=previewImage;row.sourcePreviewSeconds=at;row.sourcePreviewSha256=previewSha256;
        row.sourceDescription=source.title;row.sourceObservedContent=source.observedContent;
      }
      if(!legacy)(row.sourceCatalog??=[]).push({sourceSceneId:source.sceneId,kind:source.kind,
        previewImage,previewSeconds:at,previewSha256,title:source.title,observedContent:source.observedContent,
        width:source.width,height:source.height,identityStatus:source.identityStatus,variants:source.variants});
      // A small preview supports layout, not calibrated coordinates or tracking.
      // Existing native callouts keep their separately verified anchor path.
      row.preciseSourceAnchorsAvailable=false;
      images.push('data:image/jpeg;base64,'+bytes.toString('base64'));
    }catch(error){
      signal?.throwIfAborted();
      if(['ENOSPC','EIO','EACCES','EPERM','EROFS'].includes((error as NodeJS.ErrnoException).code??''))throw error;
      recordDiagnosticEvent('warn','documentary.artwork.preview-unavailable',{sceneId:scene.id});
    }
    }
  }
  return {input:JSON.stringify(payload),images};
}
