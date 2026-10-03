// Explicit user-authorized replacement. Runner reads no-echo stdin; Windows GUI
// Electron receives a short-lived environment value, never argv/files/logs.
import {app} from 'electron';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {VoicerStore} from '../src/voicer-store.js';
import {VoicerClient} from '../src/voicer-client.js';
const profile=join(process.env.APPDATA!,'@gold-work','desktop');
app.setPath('userData',profile);
let incoming=process.env.GWS_CREDENTIAL_UPDATE??'';delete process.env.GWS_CREDENTIAL_UPDATE;
const timeout=setTimeout(()=>{console.error('Credential update/check timeout');app.exit(2);},45000);
let stage='read-input';
app.whenReady().then(async()=>{
  let key=incoming.trim();incoming='';if(!key)throw Error('Empty key');
  stage='read-settings';
  const path=join(profile,'credentials','voicer.json'),store=new VoicerStore(path);
  const before=JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
  stage='save';
  await store.save({apiKey:key});
  stage='verify-other-settings';
  const after=JSON.parse(await readFile(path,'utf8'));
  delete before.encryptedApiKey;delete after.encryptedApiKey;
  if(!isDeepStrictEqual(before,after))throw Error('Other settings changed unexpectedly');
  stage='verify-encryption';
  const restored=await store.apiKey();if(restored!==key)throw Error('Encrypted credential verification failed');
  stage='authenticate';
  const result=await new VoicerClient(store,{requestTimeoutMs:12000,responseBodyTimeoutMs:8000,safeRetryAttempts:1}).test();
  console.log(JSON.stringify({savedEncrypted:true,otherSettingsPreserved:true,authenticated:result.ok,...(!result.ok?{error:result.message.replaceAll(key,'[secret]').replace(/(?:https?):\/\/\S+/g,'[URL]').slice(0,250)}:{})}));
  key='';clearTimeout(timeout);app.exit(result.ok?0:3);
}).catch(error=>{console.error(JSON.stringify({failedStage:stage,errorType:error?.name,code:error?.code}));clearTimeout(timeout);app.exit(1);});
