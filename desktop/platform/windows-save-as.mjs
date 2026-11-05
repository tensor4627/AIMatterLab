import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Save As always selects a destination now. An earlier open-file grant is never
// an implicit write target; only publish the new grant after a successful write.
export function createWindowsSaveAs({choose,write,grants,uuid=randomUUID}){
 return async function saveAs({content,name}={}){
  if(typeof content!=='string'||content.length>2*1024*1024)throw Error('Text source exceeds 2 MiB');
  if(name!==undefined&&typeof name!=='string')throw Error('Invalid text file name');
  const response=await choose({defaultPath:name||'workflow.py'});
  if(response.canceled)return null;
  const file=response.filePath;
  if(typeof file!=='string'||!file)throw Error('No save destination was selected');
  await write(file,content);
  const id=uuid();grants.set(id,file);
  return {id,path:file,name:path.basename(file)};
 };
}
