import {createHash} from 'node:crypto';
const imageJson=new WeakMap<readonly string[],Array<{raw:string;json:string}>>();

/** Identical to hashing JSON.stringify([2,purpose,system,input,images]), but
 * without copying all base64 frames for every legacy checkpoint variant. */
export function documentaryCheckpointKey(purpose:string,system:string,input:string,images:readonly string[]):string {
  const hash=createHash('sha256');
  hash.update(`[2,${JSON.stringify(purpose)},${JSON.stringify(system)},${JSON.stringify(input)},[`);
  let encoded=imageJson.get(images);
  if(!encoded){encoded=[];imageJson.set(images,encoded);}
  encoded.length=images.length;
  for(let i=0;i<images.length;i++){
    if(i)hash.update(',');
    const raw=images[i]!;
    if(encoded[i]?.raw!==raw)encoded[i]={raw,json:JSON.stringify(raw)};
    hash.update(encoded[i]!.json);
  }
  return hash.update(']]').digest('hex');
}
