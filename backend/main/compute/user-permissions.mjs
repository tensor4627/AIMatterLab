import path from 'node:path';
import {createHash} from 'node:crypto';

const kind='conversation-operation-approvals';
const owner=scope=>JSON.stringify([scope?.provider,scope?.threadId]);
const actions=new Set(['read','write','execute']);
const within=(paths,root,file)=>{
 if(!root||typeof file!=='string'||!paths.isAbsolute(file))return false;
 const relative=paths.relative(root,file);
 return !paths.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+paths.sep);
};

/** The catalog and installed root are owned by the current desktop profile. */
export function createUserPermissions({catalog,desktopRoot,changed=()=>{},now=Date.now}){
 const normalized=file=>process.platform==='win32'?path.normalize(file).toLowerCase():path.normalize(file);
 const root=normalized(desktopRoot);
 function desktopKey(action,file){
  return createHash('sha256').update(JSON.stringify([root,action,normalized(file)])).digest('hex');
 }
 function history(scope){return catalog.get(kind,owner(scope))||{receipts:[],desktopReads:{}};}
 function record(scope,{id,operation,resource,paths=[],desktopRead}){
  if(!scope?.provider||!scope.threadId)return;
  catalog.transaction(()=>{
   const stored=history(scope);
   if(stored.receipts.some(row=>row.id===id))return;
   const receipt={id,operation,resource,paths:paths.slice(0,24),approvedAt:now(),lifetime:desktopRead?'conversation':'operation'};
   if(desktopRead)stored.desktopReads[desktopKey(desktopRead.action,desktopRead.file)]=id;
   stored.receipts.push(receipt);
   catalog.put(kind,owner(scope),stored);
  });
  changed({provider:scope.provider,threadId:scope.threadId});
 }
 return {
  desktop(action,file){return actions.has(action)&&within(path,root,normalized(file));},
  compute(action,workspace,file){return actions.has(action)&&typeof file==='string'&&(action==='read'?(path.posix.isAbsolute(file)||file==='~'||file.startsWith('~/')):within(path.posix,workspace,file));},
  allowsDesktopRead(scope,action,file){return Object.hasOwn(history(scope).desktopReads,desktopKey(action,file));},
  record,
  list(scope){return history(scope).receipts.slice(-100).reverse();},
  clear(scope){catalog.remove(kind,owner(scope));},
  revoke(scope,id){
   return catalog.transaction(()=>{
    const stored=history(scope);
    const key=Object.keys(stored.desktopReads).find(key=>stored.desktopReads[key]===id);
    if(!key)return false;
    delete stored.desktopReads[key];
    const receipt=stored.receipts.find(row=>row.id===id);
    if(receipt)receipt.revokedAt=now();
    catalog.put(kind,owner(scope),stored);
    return true;
   });
  },
 };
}
