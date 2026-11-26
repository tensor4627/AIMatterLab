import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertTaskWorker} from '../../../contracts/compute/task-worker-binding.mjs';
import {openPublicSoftware, publicSoftwareUrl} from '../tools/public-software-docs.mjs';

const FILE_LIMIT = 512 * 1024 * 1024;
const CHUNK_SIZE = 1024 * 1024;
const uploadRoute = '/api/studio-workspace/upload-input';
const fileExtensions = new Set(['.xyz', '.extxyz', '.cif', '.pdb', '.vasp', '.txt', '.pt', '.pt2', '.pth', '.ckpt', '.yaml', '.yml', '.json', '.in', '.py', '.toml', '.dat', '.cfg', '.out', '.h5', '.hdf5', '.npz', '.traj']);
const fileNames = new Set(['POSCAR', 'INCAR', 'KPOINTS', 'OPES_COLVAR']);
const privateParts = new Set(['.ssh', '.aws', '.azure', '.gnupg', '.kube', '.codex', '.git', 'custom-cv-library']);
const checksum = /^[a-f0-9]{64}$/;
const win = process.platform === 'win32';
const canonical = value => win ? value.replaceAll('\\', '/').toLowerCase() : value;
const identity = value => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs, value.nlink].join(':');

const boundedPath = {type:'string', minLength:1, maxLength:4096};
export const workflowInputSourceTools = [
 {name:'find_local_input_files', description:'List candidate scientific files beneath a directory explicitly supplied by the user on the desktop machine. Returns bounded relative filenames. Refine by filename or use import_workflow_input for an exact result.',
  inputSchema:{type:'object', properties:{project_id:boundedPath, directory:boundedPath, name_contains:{type:'string', maxLength:120}}, required:['project_id','directory'], additionalProperties:false}, annotations:{readOnlyHint:true}},
 {name:'import_workflow_input', description:'Copy an exact desktop file supplied by the user or found by find_local_input_files, or download a public HTTPS data file, into the current workflow. Supply exactly one of local_file and url. An optional name supplies the actual input basename, without changing the format. Returns a verified path for the specific file field and parameters.files. Use copy_project_inputs for files already on the selected SSH resource.',
  inputSchema:{type:'object', properties:{project_id:boundedPath, local_file:boundedPath, url:boundedPath, name:{type:'string', maxLength:200}, sha256:{type:'string', pattern:'^[a-f0-9]{64}$'}}, required:['project_id'], additionalProperties:false}, annotations:{readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:true}},
];

function assertDataPath(value){
 const parts = value.split(/[\\/]/).map(part => part.toLowerCase());
 const name = parts.at(-1);
 if(parts.some(part => privateParts.has(part)) || /^(?:credentials|secrets?|tokens?)(?:\.|$)|^\.env(?:\.|$)|^id_(?:rsa|ed25519|ecdsa)|\.(?:pem|key)$|^materials-project\.bin$/.test(name))throw Error('Choose a scientific input outside private account or application state');
}

function inputName(value){
 if(typeof value!=='string'||!value||value.length>200||value==='.'||value==='..'||/[\\/:<>"|?*\x00-\x1f]/.test(value))throw Error('Use an exact scientific input basename');
 assertDataPath(value);
 return value;
}

function nativePath(value, protectedRoots){
 if(typeof value!=='string'||value.length>4096||!path.isAbsolute(value)||/^[\\/]{2}|[\x00-\x1f]/.test(value)||value.split(/[\\/]/).some(part=>part==='.'||part==='..')||win&&(!/^[a-z]:[\\/]/i.test(value)||/[<>"|?*:]/.test(value.slice(2))))throw Error('Enter an absolute path on the desktop machine');
 const file=path.resolve(value);
 assertDataPath(file);
 if(protectedRoots.some(root=>{
  const relative=path.relative(canonical(root),canonical(file));
  return !relative||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);
 }))throw Error('Choose a path outside application and account settings');
 return file;
}

async function nativeStat(file){
 const [info, resolved]=await Promise.all([fs.lstat(file,{bigint:true}),fs.realpath(file)]);
 if(info.isSymbolicLink()||canonical(file)!==canonical(resolved))throw Error('Choose a real desktop path without links or junctions');
 return info;
}

// Only an exact path token in a human message supplies desktop read scope.
function mentioned(text, value){
 const message=canonical(text||''), target=canonical(value);
 const quotes={'"':'"',"'":"'",'`':'`','“':'”','‘':'’'};
 for(let start=message.indexOf(target);start>=0;start=message.indexOf(target,start+target.length)){
  const before=message[start-1]||'', after=message[start+target.length]||'';
  if(/[\w:/\\]/.test(before)||Object.hasOwn(quotes,before)&&quotes[before]!==after||after&&!/[\s"'`”’,;，；。！？）】]/.test(after))continue;
  const clause=message.slice(Math.max(0,start-80),start).split(/[\n。；;，,]/).at(-1);
  if(!/不要|禁止|勿|(?:do not|don't|never)\b/i.test(clause))return true;
 }
 return false;
}

async function publishFile(worker, owner, file, name, source, expectedSha){
 const before=await nativeStat(file);
 if(!before.isFile()||before.nlink!==1n||before.size>BigInt(FILE_LIMIT))throw Error('Select a regular file no larger than 512 MiB');
 const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{
  const size=Number(before.size), buffer=Buffer.allocUnsafe(CHUNK_SIZE), digest=createHash('sha256');
  const checkSource=async()=>{
   owner.guard();
   if(identity(await handle.stat({bigint:true}))!==identity(before)||identity(await nativeStat(file))!==identity(before))throw Error('Selected file changed during transfer');
   owner.guard();
  };
  const read=async offset=>{
   const {bytesRead}=await handle.read(buffer,0,Math.min(CHUNK_SIZE,size-offset),offset);
   if(!bytesRead)throw Error('Selected file ended during transfer');
   return buffer.subarray(0,bytesRead);
  };
  await checkSource();
  for(let offset=0;offset<size;){const block=await read(offset);digest.update(block);offset+=block.length;}
  const sha256=digest.digest('hex');
  if(expectedSha&&expectedSha!==sha256)throw Error('Input differs from its expected SHA-256');
  await checkSource();
  const ticket={project_id:owner.projectId,name,size,sha256};
  const request=async(action,extra={})=>{
   owner.guard();
   let reply;
   try{reply=await worker.request('POST',uploadRoute,{...ticket,action,...extra});}
   catch(error){if(error?.message==='Unknown route')throw Error('The current worker lacks workflow input upload. Update that worker and retry this input.');throw error;}
   owner.guard();
   return reply;
  };
  let reply=await request('status');
  if(reply?.status!=='passed'){
   let offset=reply?.offset;
   if(!Number.isSafeInteger(offset)||offset<0||offset>size)throw Error('The worker did not confirm an upload position');
   while(offset<size){
    const block=await read(offset),received=await request('chunk',{offset,chunk:block.toString('base64')});
    const end=offset+block.length;
    if(received?.offset!==end&&!(received?.status==='passed'&&received.offset===size))throw Error('The worker did not confirm these input bytes');
    offset=received.offset;
   }
   await checkSource();
   reply=await request('finish');
  }
  const key=createHash('sha256').update(name+'\0'+sha256).digest('hex');
  if(reply?.status!=='passed'||reply.project_id!==owner.projectId||reply.path!==owner.inputRoot+'/import-'+key+'/'+name||reply.sha256!==sha256||reply.size!==size||reply.asset_id!=='upload-'+owner.projectId+'-'+key||!['input','structure'].includes(reply.kind))throw Error('The worker did not confirm the input in the original workflow');
  await checkSource();
  return {name,path:reply.path,sha256,size,source,asset_id:reply.asset_id,kind:reply.kind,mode:'copy',status:'passed'};
 }finally{await handle.close();}
}

export function stageLocalWorkflowInput(worker, owner, file, {name, expectedSha, protectedRoots=[]}={}){
 const selected=nativePath(file,protectedRoots);
 return publishFile(worker,owner,selected,inputName(name??path.basename(selected)),pathToFileURL(selected).href,expectedSha);
}

async function stagePublicWorkflowInput(worker, owner, args, open){
 const url=publicSoftwareUrl(args.url);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'aimatterlab-input-')),temporary=path.join(directory,'download');
 let response;
 try{
  const opened=await open(url,{signal:AbortSignal.timeout(180000)});
  response=opened.response;
  owner.guard();
  const final=publicSoftwareUrl(opened.url);
  const name=inputName(args.name??decodeURIComponent(final.pathname.split('/').at(-1)));
  if(/^(?:text\/html|application\/xhtml\+xml)(?:[;\s]|$)/i.test(response.headers['content-type']||''))throw Error('Use the public file download URL');
  if(Number(response.headers['content-length'])>FILE_LIMIT)throw Error('Public file exceeds 512 MiB');
  const file=await fs.open(temporary,'wx',0o600);
  try{
   let size=0;
   for await(const block of response){
    owner.guard();
    size+=block.length;
    if(size>FILE_LIMIT)throw Error('Public file exceeds 512 MiB');
    await file.writeFile(block);
   }
  }finally{await file.close();}
  return await publishFile(worker,owner,temporary,name,final.href,args.sha256);
 }finally{
  response?.destroy?.();
  await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  await fs.rmdir(directory);
 }
}

export function createWorkflowInputSources({worker, current, userRequest, protectedRoots=[], open=openPublicSoftware}){
 const candidates=new Map();
 return async(name,args,scope)=>{
  const task=current(scope), authoring=task.authoring, connection=worker.connection,epoch=worker.connectionEpoch;
  const owner={projectId:authoring?.projectId,inputRoot:authoring?.inputRoot,guard(){
   const latest=current(scope);
   if(latest.id!==task.id||!connection||worker.connection!==connection||worker.connectionEpoch!==epoch||!owner.inputRoot||owner.projectId!==args.project_id||latest.authoring?.projectId!==owner.projectId||latest.authoring?.inputRoot!==owner.inputRoot)throw Error('Restore the original workflow authoring service to use this input');
   assertTaskWorker(latest,worker);
  }};
  owner.guard();
  const request=userRequest(scope)||task.request;
  const supplied=value=>mentioned(request,value)||mentioned(request,value+path.sep);
  if(name==='find_local_input_files'){
   if(Object.keys(args).some(key=>!['project_id','directory','name_contains'].includes(key))||args.name_contains!==undefined&&(typeof args.name_contains!=='string'||args.name_contains.length>120))throw Error('Use an explicit desktop directory and optional filename filter');
   const root=nativePath(args.directory,protectedRoots);
   if(!supplied(args.directory))throw Error('Use the desktop directory explicitly named in the current user request');
   if(!(await nativeStat(root)).isDirectory())throw Error('The desktop input path is not a directory');
   const found=[],pending=[{directory:root,depth:0}];let visited=0,truncated=false;
   const filter=args.name_contains?.toLowerCase();
   while(pending.length&&visited<4096&&found.length<64){
    const {directory,depth}=pending.shift();owner.guard();
    if(!(await nativeStat(directory)).isDirectory())continue;
    for await(const entry of await fs.opendir(directory)){
     if(++visited>4096||found.length>=64){truncated=true;break;}
     if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
     const file=path.join(directory,entry.name);
     try{nativePath(file,protectedRoots);}catch{continue;}
     if(entry.isDirectory()&&depth<3)pending.push({directory:file,depth:depth+1});
     if(entry.isFile()&&(filter?entry.name.toLowerCase().includes(filter):fileNames.has(entry.name)||fileExtensions.has(path.extname(entry.name).toLowerCase())))found.push({name:entry.name,relative_file:path.relative(root,file)});
    }
   }
   owner.guard();
   const prior=candidates.get(task.id), files=prior?.projectId===owner.projectId?prior.files:new Set();
   for(const entry of found)files.add(canonical(path.join(root,entry.relative_file)));
   candidates.delete(task.id);candidates.set(task.id,{projectId:owner.projectId,files:new Set([...files].slice(-128))});
   if(candidates.size>128)candidates.delete(candidates.keys().next().value);
   return {status:'listed',entries:found,truncated:truncated||pending.length>0};
  }
  if(name!=='import_workflow_input'||Object.keys(args).some(key=>!['project_id','local_file','url','name','sha256'].includes(key))||Object.hasOwn(args,'local_file')===Object.hasOwn(args,'url')||args.sha256!==undefined&&(typeof args.sha256!=='string'||!checksum.test(args.sha256)))throw Error('Choose exactly one desktop file or public file URL');
  let file;
  if(Object.hasOwn(args,'local_file')){
   const selected=nativePath(args.local_file,protectedRoots), prior=candidates.get(task.id);
   if(!supplied(args.local_file)&&!(prior?.projectId===owner.projectId&&prior.files.has(canonical(selected))))throw Error('Choose a desktop file supplied by the user or returned by the authorized directory search');
   file=await stageLocalWorkflowInput(worker,owner,selected,{name:args.name,expectedSha:args.sha256,protectedRoots});
  }else{
   if(typeof args.url!=='string'||args.url.length>4096)throw Error('Use an exact public HTTPS file URL');
   file=await stagePublicWorkflowInput(worker,owner,args,open);
  }
  owner.guard();
  return {project_id:owner.projectId,files:[file]};
 };
}
