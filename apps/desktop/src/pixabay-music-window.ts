import {BrowserWindow,type DownloadItem,type Event,type WebContents} from 'electron';
import {randomUUID} from 'node:crypto';
import {mkdir,rm} from 'node:fs/promises';
import {extname,join} from 'node:path';
import {importDocumentaryMusic} from './documentary-music-import.js';
import {atomicWrite} from './fs-utils.js';
type Selection={path:string;name:string;sourcePage:string};
let active:Promise<Selection|undefined>|undefined;
const pixabayPage=(value:string)=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='pixabay.com'||u.hostname==='www.pixabay.com');}catch{return false;}};

/** Pixabay exposes music through its website, not its image/video API. Let
 * the user search/listen/download there; import that download into the editor. */
export function choosePixabayMusic(directory:string,query:string):Promise<Selection|undefined>{
  if(active)return active;
  active=open(directory,query).finally(()=>{active=undefined;});return active;
}
async function open(directory:string,query:string):Promise<Selection|undefined>{
  const downloads=join(directory,'Downloads');await mkdir(downloads,{recursive:true});
  const window=new BrowserWindow({width:1180,height:820,title:'Музыка Pixabay — выберите трек и нажмите Download',autoHideMenuBar:true,
    webPreferences:{partition:'persist:gws-pixabay-music',nodeIntegration:false,contextIsolation:true,sandbox:true}});
  const url=`https://pixabay.com/music/search/${encodeURIComponent(query.trim().slice(0,100)||'documentary')}/`;
  const musicSession=window.webContents.session;
  return new Promise((resolve,reject)=>{
    let settled=false,downloading=false,currentDownload:DownloadItem|undefined;
    const finish=(selection?:Selection,error?:unknown)=>{if(settled)return;settled=true;musicSession.removeListener('will-download',download);if(!window.isDestroyed())window.close();error?reject(error):resolve(selection);};
    const download=(event:Event,item:DownloadItem,contents:WebContents)=>{
      if(contents.id!==window.webContents.id)return;
      const extension=extname(item.getFilename()).toLowerCase();
      if(downloading||!['.mp3','.wav','.ogg','.m4a','.aac','.flac'].includes(extension)||!pixabayPage(contents.getURL())){event.preventDefault();return;}
      downloading=true;currentDownload=item;const name=item.getFilename(),path=join(downloads,`${randomUUID()}${extension}`);
      const page=new URL(contents.getURL());page.search='';page.hash='';const sourcePage=page.toString();
      item.setSavePath(path);
      item.on('updated',()=>{if(item.getReceivedBytes()>256*1024**2)item.cancel();});
      item.once('done',(_event,state)=>{void(async()=>{
        try{
          if(state!=='completed')throw Error('Загрузка музыки не завершена. Попробуйте другой трек или импортируйте локальный файл.');
          const imported=await importDocumentaryMusic(path,directory,{name,tags:[query.slice(0,100)],provenance:{provider:'pixabay',sourcePage,license:'Pixabay Content License',licenseUrl:'https://pixabay.com/service/license-summary/'}});
          await atomicWrite(`${imported}.source.json`,JSON.stringify({provider:'pixabay',name,sourcePage,query:query.slice(0,100),licensePage:'https://pixabay.com/service/license-summary/',downloadedAt:new Date().toISOString()},null,2));
          finish({path:imported,name,sourcePage});
        }catch(error){finish(undefined,error);}finally{await rm(path,{force:true}).catch(()=>{});}
      })();});
    };
    musicSession.on('will-download',download);
    window.webContents.setWindowOpenHandler(({url:next})=>{if(pixabayPage(next))void window.loadURL(next);return {action:'deny'};});
    window.webContents.on('will-navigate',(event,next)=>{if(!pixabayPage(next))event.preventDefault();});
    window.once('closed',()=>{musicSession.removeListener('will-download',download);if(!settled){settled=true;currentDownload?.cancel();resolve(undefined);}});
    void window.loadURL(url).catch(error=>finish(undefined,error));
  });
}
