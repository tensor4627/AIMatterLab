// Build-only dependency. The resulting self-contained helper ships in dist.
import fs from 'node:fs';
import path from 'node:path';
import {extract} from 'tar/x';

export async function extractNpmArchive({file,directory,maxBytes=256*1024*1024,maxFiles=12000,signal}){
 const root=path.resolve(directory),seen=new Set();let bytes=0;
 signal?.throwIfAborted();
 await fs.promises.mkdir(root,{recursive:true});
 await extract({file,cwd:root,strip:1,strict:true,preservePaths:false,noChmod:true,noMtime:true,
  filter(name,entry){
   try{
   signal?.throwIfAborted();
   const parts=name.replace(/\/$/,'').split('/');
   if(parts[0]!=='package'||parts.some(part=>!part||part==='.'||part==='..'||/[\\:\x00-\x1f\x7f]/.test(part)||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw Error('cli_archive_invalid_path');
   if(!['File','Directory','OldFile','ContiguousFile'].includes(entry.type))throw Error('cli_archive_links_refused');
   if(parts.length===1)return entry.type==='Directory';
   const relative=parts.slice(1).join('/'),folded=relative.toLowerCase();
   if(seen.has(folded))throw Error('cli_archive_duplicate_path');seen.add(folded);
   if(seen.size>maxFiles||!Number.isSafeInteger(entry.size)||entry.size<0||(bytes+=entry.size)>maxBytes)throw Error('cli_archive_size_limit');
   return true;
   }catch(error){this.abort(error);return false;}
  }
 });
 signal?.throwIfAborted();
 return {files:seen.size,bytes};
}
