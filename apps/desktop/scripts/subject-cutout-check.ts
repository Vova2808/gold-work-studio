import {documentarySubjectCutout} from '../src/documentary-subject-cutout.js';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve('captures/vidrush-reference-20260928/cutouts');await mkdir(root,{recursive:true});
const source=process.argv[2]??'C:/Users/rosup/AppData/Local/Temp/codex-clipboard-8ec5c4ba-6c56-4304-a966-cc7e0b0f04ef.png';
const started=Date.now();const output=await documentarySubjectCutout(source,root,true,[],undefined,console.log);const coldSeconds=(Date.now()-started)/1000;
const warm=Date.now();const cached=await documentarySubjectCutout(source,root,true);
const result={source,output,coldSeconds,warmSeconds:(Date.now()-warm)/1000,reused:output===cached};
await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
