import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourceName='contracts/tools/engine-contracts.json';
const targetName='worker/studio_worker/engine_contracts.json';
function regularFile(file){
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('Tool contracts require regular files');
 return fs.readFileSync(file);
}
function samePath(a,b){return process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;}
function ownedParent(file,root){
 let current=path.dirname(file);
 while(!samePath(current,root)){
  if(fs.existsSync(current)&&(!fs.lstatSync(current).isDirectory()||fs.lstatSync(current).isSymbolicLink()||!samePath(fs.realpathSync(current),current)))throw Error('Linked tool contract directory refused');
  const parent=path.dirname(current);if(parent===current)throw Error('Tool contract escaped its root');current=parent;
 }
}
/** Copy the canonical bytes; never serialize or change engine parameter semantics. */
export function syncToolContracts({root=defaultRoot,check=false}={}){
 root=fs.realpathSync(path.resolve(root));
 const source=path.join(root,sourceName),target=path.join(root,targetName);
 ownedParent(source,root);ownedParent(target,root);
 const bytes=regularFile(source),contract=JSON.parse(bytes.toString('utf8'));
 if(contract?.schema_version!==1||typeof contract.scope!=='string'||!contract.engines||Array.isArray(contract.engines)||typeof contract.engines!=='object'||!Object.keys(contract.engines).length)throw Error('Unsupported canonical tool contract');
 const current=fs.existsSync(target)?regularFile(target):null;
 const matches=current?.equals(bytes)===true;
 if(!matches&&check)throw Error('Generated worker tool contract is stale; run node scripts/sync-tool-contracts.mjs');
 if(!matches){
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const temporary=target+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(temporary,bytes,{flag:'wx'});fs.renameSync(temporary,target);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
 }
 return {status:matches?'current':'updated',source:sourceName,resource:targetName,sha256:createHash('sha256').update(bytes).digest('hex')};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2);if(args.length>1||args.length===1&&args[0]!=='--check')throw Error('Usage: node scripts/sync-tool-contracts.mjs [--check]');
  console.log(JSON.stringify(syncToolContracts({check:args.includes('--check')})));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
