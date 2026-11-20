import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourceName='contracts/tools/engine-contracts.json';
const targetName='backend/worker/studio_worker/engine_contracts.json';
const resources=[
 {source:sourceName,resource:targetName,validate:value=>value?.schema_version===1&&typeof value.scope==='string'&&value.engines&&!Array.isArray(value.engines)&&typeof value.engines==='object'&&Object.keys(value.engines).length},
 {source:sourceName,resource:'developer/skills/studio-tool-integration/references/engine-contracts.json',validate:value=>value?.schema_version===1&&typeof value.scope==='string'&&value.engines&&!Array.isArray(value.engines)&&typeof value.engines==='object'&&Object.keys(value.engines).length},
 {source:'contracts/tools/tool-package.schema.json',resource:'backend/worker/studio_worker/tool_package.schema.json',validate:value=>value?.$id==='studio.tool-package/1'&&value.type==='object'&&value.additionalProperties===false},
 {source:'contracts/tools/tool-package.schema.json',resource:'developer/skills/studio-tool-integration/references/tool-package.schema.json',validate:value=>value?.$id==='studio.tool-package/1'&&value.type==='object'},
 {source:'contracts/tools/tool-package.mjs',resource:'developer/skills/studio-tool-integration/references/tool-package.mjs',text:true,validate:value=>value.includes('export function validateToolPackage(')&&value.includes("from './tool-package.schema.json'")},
 {source:'contracts/tools/aimlab-tools.mjs',resource:'developer/skills/studio-tool-integration/references/aimlab-tools.mjs',text:true,validate:value=>value.includes('export function validateAimlabTools(')&&value.includes("from './tool-package.mjs'")},
 {source:'installation/examples/worker-smoke.py',resource:'developer/skills/studio-tool-integration/assets/worker-smoke.py',text:true,validate:value=>value.trim().length>0},
 {source:'contracts/workflows/task-draft.schema.json',resource:'backend/worker/studio_worker/transport/task_draft_schema.py',
  validate:value=>value?.type==='object'&&value.required.includes('task_id')&&value.additionalProperties===false,
  render:source=>Buffer.from("# Generated from contracts/workflows/task-draft.schema.json by sync-tool-contracts.mjs.\nimport json\n\nTASK_DRAFT_SCHEMA = json.loads(r'''"+source.toString('utf8').replaceAll('\r\n','\n').trimEnd()+"''')\n")},
 {source:'contracts/workflows/roadmap.schema.json',resource:'backend/worker/studio_worker/transport/roadmap_schema.py',
  validate:value=>value?.$id==='studio.workflow-roadmap/1'&&value.additionalProperties===false,
  render:source=>Buffer.from("# Generated from contracts/workflows/roadmap.schema.json by sync-tool-contracts.mjs.\nimport json\n\nROADMAP_SCHEMA = json.loads(r'''"+source.toString('utf8').replaceAll('\r\n','\n').trimEnd()+"''')\n")}
];
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
export function syncToolContracts({root=defaultRoot,check=false}={},{rename=fs.renameSync}={}){
 root=fs.realpathSync(path.resolve(root));
 // Validate every canonical source before changing any generated file.
 const plans=resources.map(item=>{
  const source=path.join(root,item.source),target=path.join(root,item.resource);
  ownedParent(source,root);ownedParent(target,root);
  const bytes=regularFile(source),value=item.text?new TextDecoder('utf-8',{fatal:true}).decode(bytes):JSON.parse(bytes.toString('utf8'));
  if(!item.validate(value))throw Error('Unsupported canonical tool contract: '+item.source);
  const current=fs.existsSync(target)?regularFile(target):null;
  const output=item.render?item.render(bytes):bytes;
  return {...item,target,bytes:output,matches:current?.equals(output)===true};
 });
 if(check&&plans.some(item=>!item.matches))throw Error('Generated tool contract or developer resource is stale; run node scripts/sync-tool-contracts.mjs');
 // Stage every changed file first, then rename them together; a failed rename restores
 // the files already replaced so a multi-resource update never stays half-applied.
 const staged=[];
 try{
  for(const item of plans.filter(plan=>!plan.matches)){
   fs.mkdirSync(path.dirname(item.target),{recursive:true});
   const temporary=item.target+'.'+randomUUID()+'.tmp';
   fs.writeFileSync(temporary,item.bytes,{flag:'wx'});
   staged.push({...item,temporary,previous:fs.existsSync(item.target)?regularFile(item.target):null,renamed:false});
  }
  for(const item of staged){rename(item.temporary,item.target);item.renamed=true;}
 }catch(error){
  for(const item of staged){
   try{
    if(item.renamed){
     if(item.previous===null)fs.unlinkSync(item.target);
     else{
      const restore=item.target+'.'+randomUUID()+'.restore';
      fs.writeFileSync(restore,item.previous,{flag:'wx'});fs.renameSync(restore,item.target);
     }
    }
   }catch{}
   try{if(fs.existsSync(item.temporary))fs.unlinkSync(item.temporary);}catch{}
  }
  throw error;
 }
 const receipts=plans.map(item=>({status:item.matches?'current':'updated',source:item.source,resource:item.resource,sha256:createHash('sha256').update(item.bytes).digest('hex')}));
 return {...receipts[0],status:plans.every(item=>item.matches)?'current':'updated',resources:receipts};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2);if(args.length>1||args.length===1&&args[0]!=='--check')throw Error('Usage: node scripts/sync-tool-contracts.mjs [--check]');
  console.log(JSON.stringify(syncToolContracts({check:args.includes('--check')})));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
