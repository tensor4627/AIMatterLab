/** Stable, content-addressed Electron-as-Node and PTY resources. No credentials or sessions. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {prepareResourcesOffThread} from './preparation-worker-client.mjs';
export function prepareTerminalRuntimeAsync(options){return prepareResourcesOffThread('terminal',options);}

export const TERMINAL_RUNTIME_SCHEMA='studio-terminal-runtime-v1';
const schema=TERMINAL_RUNTIME_SCHEMA;
const MAX_FILES=2048,MAX_BYTES=1024*1024*1024,MAX_FILE_BYTES=512*1024*1024;
const supportFiles=['chrome_100_percent.pak','chrome_200_percent.pak','d3dcompiler_47.dll','dxcompiler.dll','dxil.dll','ffmpeg.dll','icudtl.dat','resources.pak','snapshot_blob.bin','v8_context_snapshot.bin','vk_swiftshader_icd.json','vk_swiftshader.dll','vulkan-1.dll','LICENSE.electron.txt','LICENSES.chromium.html','version'];
const active=new Map(),planning=new Map();
const execute=promisify(execFile);
// This fixed child prints only a mandatory integrity RID, never group names,
// account identifiers, authentication data, or its inherited environment.
const executionProbe='const{execFileSync}=require("node:child_process");const path=require("node:path");const out=execFileSync(path.win32.join(process.env.SystemRoot||"C:\\\\Windows","System32","whoami.exe"),["/groups","/fo","csv","/nh"],{encoding:"utf8",windowsHide:true,timeout:5000,maxBuffer:262144});const ids=[...out.matchAll(/S-1-16-([0-9]+)/g)];if(ids.length!==1)process.exit(2);process.stdout.write(JSON.stringify({schemaVersion:1,integrityRid:Number(ids[0][1])}));';
const fail=code=>{throw Error(code);};
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&!/[\0\r\n]/.test(value);
const inside=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const signature=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');

/** Observe the actual executable token; content hashes do not include Windows MIC labels. */
export async function probeWindowsTerminalRuntimeExecution(executable,{run=execute,env=process.env}={}){
 const childEnv=Object.fromEntries(['SystemRoot','WINDIR','ComSpec','PATH','PATHEXT','TEMP','TMP','USERPROFILE'].filter(key=>typeof env[key]==='string').map(key=>[key,env[key]]));
 let value;try{const result=await run(executable,['-e',executionProbe],{windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:4096,env:{...childEnv,ELECTRON_RUN_AS_NODE:'1'}});value=JSON.parse(result.stdout);}catch{fail('terminal_runtime_execution_unavailable');}
 if(value?.schemaVersion!==1||!Number.isSafeInteger(value.integrityRid)||value.integrityRid<0||value.integrityRid>16384)fail('terminal_runtime_execution_unavailable');
 if(value.integrityRid<8192)fail('terminal_runtime_low_integrity');
 return {integrity:'medium_or_higher'};
}

function unlinked(file,directory=false){
 for(let current=path.resolve(file);;current=path.dirname(current)){
  const stat=fs.lstatSync(current);
  if(stat.isSymbolicLink()||(current!==file||directory)&&!stat.isDirectory())fail('terminal_runtime_invalid_source');
  if(path.dirname(current)===current)break;
 }
 if(!samePath(fs.realpathSync(file),path.resolve(file)))fail('terminal_runtime_invalid_source');
}

async function fingerprint(file){
 unlinked(file);
 const before=fs.lstatSync(file);
 if(!before.isFile()||before.size>MAX_FILE_BYTES)fail('terminal_runtime_invalid_source');
 const handle=await fs.promises.open(file,'r');
 try{
  const opened=await handle.stat();
  if(signature(before)!==signature(opened))fail('terminal_runtime_source_changed');
  const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let size=0;
  for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;size+=bytesRead;if(size>MAX_FILE_BYTES)fail('terminal_runtime_invalid_source');hash.update(buffer.subarray(0,bytesRead));}
  unlinked(file);
  if(size!==before.size||signature(before)!==signature(await handle.stat())||signature(before)!==signature(fs.lstatSync(file)))fail('terminal_runtime_source_changed');
  return {size,sha256:hash.digest('hex')};
 }finally{await handle.close();}
}

function packageRoot(entry,name,dependencyRoot){
 let current=path.dirname(fs.realpathSync(entry));
 const modules=path.join(dependencyRoot,'node_modules');
 if(!inside(modules,current))fail('terminal_runtime_invalid_source');
 for(let depth=0;depth<8&&inside(modules,current);depth++,current=path.dirname(current)){
  const manifest=path.join(current,'package.json');
  if(fs.existsSync(manifest)){
   unlinked(manifest);const value=JSON.parse(fs.readFileSync(manifest,'utf8'));
   if(value.name===name)return {root:current,manifest:value};
  }
 }
 fail('terminal_runtime_invalid_source');
}

async function sourcePlan({nodeExecutable,servicePath,dependencyRoot,platform,arch}){
 if(platform!=='win32'||!['x64','arm64'].includes(arch))fail('terminal_runtime_platform_unsupported');
 for(const file of [nodeExecutable,servicePath])unlinked(file);
 unlinked(dependencyRoot,true);
 if(path.basename(servicePath)!=='broker.mjs')fail('terminal_runtime_invalid_source');
 const entries=[];let bytes=0;
 async function add(source,relative){
  const value=await fingerprint(source);bytes+=value.size;
  if(entries.length>=MAX_FILES||bytes>MAX_BYTES)fail('terminal_runtime_invalid_source');
  entries.push({source,path:relative,...value});
 }
 async function tree(source,target,depth=0){
  if(depth>16)fail('terminal_runtime_invalid_source');unlinked(source,true);
  for(const entry of fs.readdirSync(source,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   if(entry.isSymbolicLink()||entry.name==='node_modules'||entry.name==='.config'||entry.name==='.env'||entry.name==='broker.bin')fail('terminal_runtime_invalid_source');
   const file=path.join(source,entry.name),relative=target+'/'+entry.name;
   if(entry.isDirectory())await tree(file,relative,depth+1);
   else if(entry.isFile())await add(file,relative);
   else fail('terminal_runtime_invalid_source');
  }
 }
 const executableName=path.basename(nodeExecutable),binaryRoot=path.dirname(nodeExecutable);
 await add(nodeExecutable,'node/'+executableName);
 for(const name of supportFiles){const file=path.join(binaryRoot,name);if(fs.existsSync(file))await add(file,'node/'+name);}
 for(const name of ['broker.mjs','session.mjs'])await add(path.join(path.dirname(servicePath),name),'service/'+name);
 const codec=path.join(path.dirname(servicePath),'response-codec.mjs');if(fs.existsSync(codec))await add(codec,'service/response-codec.mjs');
 const launcher=path.join(path.dirname(servicePath),'service-launch.mjs');if(fs.existsSync(launcher))await add(launcher,'service/service-launch.mjs');
 for(const name of ['ssh-connection.mjs','ssh-multiplex-helper.py','shared-shell-service.mjs']){const file=path.join(path.dirname(servicePath),name);if(fs.existsSync(file))await add(file,'service/'+name);}
 const resolver=createRequire(path.join(dependencyRoot,'runtime.cjs'));
 const wrapperEntry=resolver.resolve('@lydell/node-pty'),wrapper=packageRoot(wrapperEntry,'@lydell/node-pty',dependencyRoot);
 const nativeName='@lydell/node-pty-'+platform+'-'+arch;
 const native=packageRoot(createRequire(wrapperEntry).resolve(nativeName),nativeName,dependencyRoot);
 if(typeof wrapper.manifest.version!=='string'||native.manifest.version!==wrapper.manifest.optionalDependencies?.[nativeName])fail('terminal_runtime_invalid_source');
 await tree(wrapper.root,'dependencies/node_modules/@lydell/node-pty');
 await tree(native.root,'dependencies/node_modules/'+nativeName);
 const required=['lib/index.js','lib/windowsTerminal.js','lib/windowsPtyAgent.js','lib/windowsConoutConnection.js','lib/worker/conoutSocketWorker.js','lib/conpty_console_list_agent.js',`prebuilds/${platform}-${arch}/conpty.node`,`prebuilds/${platform}-${arch}/conpty_console_list.node`,`prebuilds/${platform}-${arch}/conpty/conpty.dll`,`prebuilds/${platform}-${arch}/conpty/OpenConsole.exe`];
 const names=new Set(entries.map(row=>row.path));
 if(required.some(name=>!names.has('dependencies/node_modules/'+nativeName+'/'+name)))fail('terminal_runtime_invalid_source');
 entries.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
 const receipt={schema,platform,arch,executable:'node/'+executableName,service:'service/broker.mjs',dependencyRoot:'dependencies',ptyVersion:wrapper.manifest.version,files:entries.map(({source,...row})=>row)};
 return {entries,receipt,id:createHash('sha256').update(JSON.stringify(receipt)).digest('hex')};
}

async function verify(directory,receipt,id){
 unlinked(directory,true);
 const manifest=path.join(directory,'runtime.json');unlinked(manifest);
 if(fs.statSync(manifest).size>1024*1024)fail('terminal_runtime_integrity_failed');
 const saved=JSON.parse(fs.readFileSync(manifest,'utf8'));
 if(saved.id!==id||JSON.stringify(saved.receipt)!==JSON.stringify(receipt))fail('terminal_runtime_integrity_failed');
 const actual=[];
 function walk(folder,relative=''){
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
   if(entry.isSymbolicLink())fail('terminal_runtime_integrity_failed');
   const name=relative?relative+'/'+entry.name:entry.name;
   if(entry.isDirectory())walk(path.join(folder,entry.name),name);
   else if(entry.isFile()&&name!=='runtime.json')actual.push(name);
   else if(!entry.isFile())fail('terminal_runtime_integrity_failed');
  }
 }
 walk(directory);
 if(JSON.stringify(actual.sort())!==JSON.stringify(receipt.files.map(row=>row.path).sort()))fail('terminal_runtime_integrity_failed');
 for(const entry of receipt.files){const observed=await fingerprint(path.join(directory,entry.path));if(observed.sha256!==entry.sha256||observed.size!==entry.size)fail('terminal_runtime_integrity_failed');}
}

function result(directory,plan){
 return {nodeExecutable:path.join(directory,plan.receipt.executable),servicePath:path.join(directory,plan.receipt.service),dependencyRoot:path.join(directory,plan.receipt.dependencyRoot),directory,receipt:{schema,id:plan.id,platform:plan.receipt.platform,arch:plan.receipt.arch,files:plan.receipt.files.length,bytes:plan.receipt.files.reduce((sum,row)=>sum+row.size,0),ptyVersion:plan.receipt.ptyVersion,scope:'Content-verified executable/support, broker and PTY closure; no credential, session, connection or scientific state copied'}};
}

/** Publish only a complete checked closure. Existing generations are never removed or overwritten. */
export function prepareTerminalRuntime(options){
 const key=JSON.stringify(options);if(planning.has(key))return planning.get(key);
 const promise=prepareTerminalRuntimeOnce(options);planning.set(key,promise);promise.finally(()=>{if(planning.get(key)===promise)planning.delete(key);}).catch(()=>{});return promise;
}
async function prepareTerminalRuntimeOnce({runtimeRoot,nodeExecutable,servicePath,dependencyRoot,platform=process.platform,arch=process.arch,probeExecution=probeWindowsTerminalRuntimeExecution}){
 if(![runtimeRoot,nodeExecutable,servicePath,dependencyRoot].every(absolute))fail('terminal_runtime_invalid_source');
 const options={runtimeRoot:path.resolve(runtimeRoot),nodeExecutable:path.resolve(nodeExecutable),servicePath:path.resolve(servicePath),dependencyRoot:path.resolve(dependencyRoot),platform,arch};
 for(let current=options.runtimeRoot;;current=path.dirname(current)){
  if(fs.existsSync(current)){unlinked(current,true);break;}
  if(path.dirname(current)===current)fail('terminal_runtime_invalid_source');
 }
 const plan=await sourcePlan(options),key=options.runtimeRoot+'|'+plan.id;
 if(typeof probeExecution!=='function')fail('terminal_runtime_invalid_source');
 await probeExecution(options.nodeExecutable);
 if(active.has(key))return active.get(key);
 const promise=(async()=>{
  await fs.promises.mkdir(options.runtimeRoot,{recursive:true,mode:0o700});unlinked(options.runtimeRoot,true);
  const directory=path.join(options.runtimeRoot,plan.id);
  if(fs.existsSync(directory)){await verify(directory,plan.receipt,plan.id);await probeExecution(path.join(directory,plan.receipt.executable));return result(directory,plan);}
  const temporary=path.join(options.runtimeRoot,'staging-'+randomUUID());
  await fs.promises.mkdir(temporary,{mode:0o700});
  try{
   for(const entry of plan.entries){
    const target=path.join(temporary,entry.path);await fs.promises.mkdir(path.dirname(target),{recursive:true,mode:0o700});
    await fs.promises.copyFile(entry.source,target,fs.constants.COPYFILE_EXCL);
    await fs.promises.chmod(target,entry.path===plan.receipt.executable?0o700:0o600);
   }
   const after=await sourcePlan(options);if(after.id!==plan.id)fail('terminal_runtime_source_changed');
   await fs.promises.writeFile(path.join(temporary,'runtime.json'),JSON.stringify({id:plan.id,receipt:plan.receipt}),{flag:'wx',mode:0o600});
   await verify(temporary,plan.receipt,plan.id);
   await probeExecution(path.join(temporary,plan.receipt.executable));
   try{await fs.promises.rename(temporary,directory);}catch(error){if(!['EEXIST','ENOTEMPTY','EPERM'].includes(error.code)||!fs.existsSync(directory))throw error;await verify(directory,plan.receipt,plan.id);await probeExecution(path.join(directory,plan.receipt.executable));}
   return result(directory,plan);
  }finally{
   // Only this call's fresh staging directory is disposable. Published runtimes
   // may still serve live detached terminals and must outlive the desktop.
   if(inside(options.runtimeRoot,temporary)&&fs.existsSync(temporary))await fs.promises.rm(temporary,{recursive:true,force:true});
  }
 })();
 active.set(key,promise);try{return await promise;}finally{if(active.get(key)===promise)active.delete(key);}
}
