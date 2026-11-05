/** Fixed bundled worker source resources. The host supplies its exact dev or unpacked root. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const defaultWorkerResourceSource=fileURLToPath(new URL('../../worker',import.meta.url));
const allowed=new Set(['studio_worker/engine_contracts.json','studio_worker/tools/derivatives.py','studio_worker/tools/derivative_selection.py']);
const identity=value=>process.platform==='win32'?value.toLowerCase():value;
export function createWorkerResourceReader(worker={}){
 const declared=Object.hasOwn(worker,'resourceSource')?worker.resourceSource:defaultWorkerResourceSource;
 if(typeof declared!=='string'||!declared||!path.isAbsolute(declared)||/[\0\r\n]/.test(declared))throw Error('Worker resource source must be an explicit absolute directory');
 const source=path.resolve(declared);
 function check(){
  if(Object.hasOwn(worker,'resourceSource')&&worker.resourceSource!==declared)throw Error('Worker resource source changed');
  let stat;try{stat=fs.lstatSync(source);}catch(error){throw Error('Worker resource source unavailable',{cause:error});}if(!stat.isDirectory()||stat.isSymbolicLink()||identity(fs.realpathSync(source))!==identity(source))throw Error('Worker resource source is not a regular unlinked directory');
 }
 check();
 return relative=>{
  if(!allowed.has(relative))throw Error('Worker resource is outside the fixed evidence inventory');check();
  let current=source;for(const segment of relative.split('/')){current=path.join(current,segment);const stat=fs.lstatSync(current);if(stat.isSymbolicLink()||current!==path.join(source,relative)&&!stat.isDirectory())throw Error('Worker resource path is linked or malformed');}
  const stat=fs.lstatSync(current);if(!stat.isFile()||stat.size>2*1024*1024||identity(fs.realpathSync(current))!==identity(current))throw Error('Worker resource is not a bounded regular source file');
  const content=fs.readFileSync(current,'utf8');check();return content;
 };
}
