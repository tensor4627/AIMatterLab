/** Local CLI discovery and explicitly requested, integrity-pinned private installs. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnCli as nativeSpawnCli,prepareProfile,providerRuntime} from '../../../desktop/platform/provider-runtime.mjs';
import {AcpBridge} from '../../../agent/providers/acp.mjs';

const PROVIDERS=['kimi','qwen'];
const DEFAULT_LOCK=fileURLToPath(new URL('../../../contracts/agent/cli-runtime-lock.json',import.meta.url));
const validProvider=value=>{if(!PROVIDERS.includes(value))throw Error('cli_runtime_invalid_provider');return value;};
const inside=(root,file)=>{const rel=path.relative(root,file);return rel!==''&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys,required=keys)=>{if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key))||required.some(key=>!(key in value)))throw Error('cli_runtime_invalid_request');};
const readable=file=>{try{return fs.statSync(file).isFile();}catch{return false;}};
const cancelled=()=>Object.assign(Error('CLI runtime preparation cancelled'),{code:'CLI_RUNTIME_CANCELLED'});
const sha=value=>createHash('sha256').update(value).digest('hex');

/** Historical automatic paths only; a live or manually chosen path is never rewritten. */
export function isStaleBundledCliPath(provider,value){
 validProvider(provider);if(typeof value!=='string')return false;
 const suffix=provider==='kimi'?'@moonshot-ai/kimi-code/dist/main.mjs':'@qwen-code/qwen-code/cli-entry.js';
 return value.replaceAll('\\','/').toLowerCase().endsWith('/resources/agent-runtimes/node_modules/'+suffix)&&!readable(value);
}

export function migrateBundledCliPaths(settings){
 let next=settings;
 for(const provider of PROVIDERS)if(isStaleBundledCliPath(provider,settings?.[provider+'Path']))next={...next,[provider+'Path']:''};
 return next;
}

function unlinkedParents(file){
 for(let item=path.resolve(file);;item=path.dirname(item)){
  if(fs.existsSync(item)){const stat=fs.lstatSync(item);if(stat.isSymbolicLink()||item!==file&&!stat.isDirectory())throw Error('cli_runtime_unsafe_directory');}
  if(path.dirname(item)===item)break;
 }
}
async function shimEntry(file,record){
 const folder=path.dirname(file),bases=[path.join(folder,'node_modules',record.package),path.join(folder,'..',record.package)];
 for(const base of bases)try{
  const pkg=JSON.parse(await fs.promises.readFile(path.join(base,'package.json'),'utf8'));
  const bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.[record.package.split('/').at(-1)==='qwen-code'?'qwen':'kimi'];
  if(pkg.name!==record.package||bin!==record.entry)continue;
  const entry=path.resolve(base,bin);if(inside(path.resolve(base),entry)&&(await fs.promises.stat(entry)).isFile())return fs.promises.realpath(entry);
 }catch{}
 return null;
}

async function normalizeCandidate(file,record){
 if(typeof file!=='string'||!file.trim()||/[\x00-\x1f\x7f]/.test(file)||!path.isAbsolute(file))return null;
 try{if(!(await fs.promises.stat(file)).isFile())return null;}catch{return null;}
 if(/\.(?:cmd|bat|ps1)$/i.test(file))return shimEntry(file,record);
 if(!/\.(?:exe|mjs|cjs|js)$/i.test(file))return null;
 return fs.promises.realpath(file);
}

const environmentValue=(env,key,platform)=>env[key]??(platform==='win32'?Object.entries(env).find(([name])=>name.toLowerCase()===key.toLowerCase())?.[1]:undefined);
async function* pathCandidates(command,env,platform){
 const directories=String(environmentValue(env,'PATH',platform)||'').split(platform==='win32'?';':':').map(value=>value.trim().replace(/^"(.*)"$/,'$1')).filter(Boolean).slice(0,256);
 const supported=['.exe','.cmd','.bat','.ps1','.mjs','.js','.cjs'];
 const extensions=[...new Set([...String(environmentValue(env,'PATHEXT',platform)||'').split(';').map(value=>value.trim().toLowerCase()).filter(value=>supported.includes(value)),...supported])];
 const names=/\.[a-z0-9]+$/i.test(command)?[command]:platform==='win32'?extensions.map(extension=>command+extension):[command,command+'.mjs',command+'.js'];
 for(const folder of directories){
  if(!path.isAbsolute(folder))continue;
  const matches=await Promise.all(names.map(async name=>{const file=path.join(folder,name);try{return (await fs.promises.stat(file)).isFile()?file:null;}catch{return null;}}));
  for(const file of matches)if(file)yield file;
 }
}

export function validateCliRuntimeLock(lock){
 if(!plain(lock)||lock.schema_version!==1||!plain(lock.providers)||!plain(lock.packages))throw Error('cli_runtime_invalid_lock');
 for(const provider of PROVIDERS){
  const record=lock.providers[provider];
  if(!plain(record)||!Array.isArray(record.packages)||!record.packages.length||!record.packages.includes(record.package)||typeof record.version!=='string'||typeof record.entry!=='string'||record.entry.startsWith('/')||record.entry.split('/').some(v=>!v||v==='.'||v==='..'||/[\\:\x00-\x1f]/.test(v)))throw Error('cli_runtime_invalid_lock');
  for(const name of record.packages){
   const pkg=lock.packages[name];if(!plain(pkg)||pkg.name!==name||!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name)||typeof pkg.version!=='string'||!/^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.integrity)||!plain(pkg.dependencies))throw Error('cli_runtime_invalid_lock');
   const url=new URL(pkg.url);if(url.protocol!=='https:'||url.hostname!=='registry.npmjs.org'||url.username||url.password||url.search||url.hash||url.port||url.pathname!=='/'+name+'/-/'+name.split('/').at(-1)+'-'+pkg.version+'.tgz')throw Error('cli_runtime_invalid_lock');
   for(const [dependency,version]of Object.entries(pkg.dependencies))if(!record.packages.includes(dependency)||lock.packages[dependency]?.version!==version)throw Error('cli_runtime_invalid_lock');
  }
  if(lock.packages[record.package].version!==record.version)throw Error('cli_runtime_invalid_lock');
 }
 return lock;
}

async function treeReceipt(root,{maxFiles=16000,maxBytes=512*1024*1024}={}){
 const files=[];let total=0;
 async function visit(directory,prefix=''){
  unlinkedParents(directory);
  for(const entry of await fs.promises.readdir(directory,{withFileTypes:true})){
   if(entry.isSymbolicLink())throw Error('cli_runtime_link_refused');
   const relative=prefix+entry.name,file=path.join(directory,entry.name);
   if(entry.isDirectory())await visit(file,relative+'/');
   else if(entry.isFile()&&relative!=='runtime.json'){
    const stat=await fs.promises.stat(file);if((total+=stat.size)>maxBytes||files.length>=maxFiles)throw Error('cli_runtime_size_limit');
    const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);
    files.push({path:relative,size:stat.size,sha256:hash.digest('hex')});
   }else if(!entry.isFile())throw Error('cli_runtime_special_file');
  }
 }
 await visit(root);return files.sort((a,b)=>a.path.localeCompare(b.path));
}

export function createCliRuntimeManager({root,settings=()=>({}),fetchApi=globalThis.fetch,publish=()=>{},env=process.env,spawnCli=nativeSpawnCli,platform=process.platform,arch=process.arch,lock=JSON.parse(fs.readFileSync(DEFAULT_LOCK,'utf8')),extractArchive,dependencyRoot,probeTimeoutMs=15000,interfaceTimeoutMs=30000}={}){
 if(typeof root!=='string'||!path.isAbsolute(root)||typeof settings!=='function'||typeof fetchApi!=='function'||typeof publish!=='function')throw Error('cli_runtime_invalid_configuration');
 root=path.resolve(root);validateCliRuntimeLock(lock);const lockHash=sha(JSON.stringify(lock)),active=new Map(),probes=new Map();
 const selectionFile=provider=>path.join(root,'selections',provider+'.json');
 const configured=provider=>String(settings()?.[provider+'Path']||'').trim();
 const manual=provider=>{const value=configured(provider);return value&&value!==provider&&!isStaleBundledCliPath(provider,value)?value:null;};
 const status=(provider,state,extra={})=>({provider,status:state,expectedVersion:lock.providers[provider].version,...extra});
 const readSelection=provider=>{try{const file=selectionFile(provider);unlinkedParents(file);if(fs.statSync(file).size>16384)return null;const saved=JSON.parse(fs.readFileSync(file,'utf8'));return saved.lockHash===lockHash&&/^[a-f0-9-]{36}$/.test(saved.generation)?saved:null;}catch{return null;}};
 const managedDirectory=(provider,saved)=>path.join(root,provider,saved.generation);
 async function probe(provider,executable,source,signal){
  signal?.throwIfAborted();
  const before=await fs.promises.stat(executable),key=provider+'|'+executable+'|'+before.size+'|'+before.mtimeMs+'|'+before.ctimeMs;
  let pending=probes.get(key);
  if(!pending){
   pending=(async()=>{
    const home=path.join(root,'probes',provider);unlinkedParents(home);await fs.promises.mkdir(home,{recursive:true});
    return new Promise(resolve=>{
     let output='',settled=false,timer,child;
     const abort=()=>{finish({status:'failed',message:'CLI version check cancelled'});try{child?.kill();}catch{}};
     const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(value);};
     try{child=spawnCli(executable,['--version'],{provider,env:provider==='kimi'?{KIMI_CODE_HOME:home,KIMI_API_KEY:'',KIMI_BASE_URL:''}:{QWEN_HOME:home,OPENAI_API_KEY:'',STUDIO_QWEN_API_KEY:'',OPENAI_BASE_URL:'',QWEN_API_KEY:''}});}catch(error){finish({status:'failed',message:error.message});return;}
     timer=setTimeout(()=>{finish({status:'failed',message:'CLI version check timed out'});try{child.kill();}catch{}},probeTimeoutMs);
     signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
     child.stdout?.on('data',data=>{if(settled)return;output+=data.toString();if(Buffer.byteLength(output)>65536){finish({status:'failed',message:'CLI version output exceeded limit'});try{child.kill();}catch{}}});
     child.on('error',()=>finish({status:'failed',message:'CLI could not be started'}));
     child.on('exit',code=>{const version=output.trim().split(/\s+/).at(-1);finish(code===0?{status:version===lock.providers[provider].version?'ready':'incompatible',version,message:version===lock.providers[provider].version?'CLI is ready':'Installed CLI version is not supported by this Studio version'}:{status:'failed',message:'CLI version check failed'});});
    });
   })();probes.set(key,pending);
  }
  const value=await pending;if(value.status==='failed')probes.delete(key);
  return status(provider,value.status,{...value,executable,source});
 }
 async function candidate(provider,value,source,signal){
  let executable;
  try{executable=await normalizeCandidate(value,lock.providers[provider]);}catch{}
  return executable?probe(provider,executable,source,signal):status(provider,'invalid',{source,message:'The configured CLI path is missing or its launcher cannot be resolved safely'});
 }
 async function managed(provider){
  const saved=readSelection(provider);if(!saved)return null;
  try{
   const directory=managedDirectory(provider,saved);unlinkedParents(directory);
   const receiptFile=path.join(directory,'runtime.json');unlinkedParents(receiptFile);if((await fs.promises.stat(receiptFile)).size>8*1024*1024)throw Error();
   const receipt=JSON.parse(await fs.promises.readFile(receiptFile,'utf8'));
   if(receipt.lockHash!==lockHash||receipt.provider!==provider||receipt.platform!==platform||receipt.arch!==arch||receipt.compatibility?.protocolVersion!==1||JSON.stringify(await treeReceipt(directory))!==JSON.stringify(receipt.files))throw Error();
   return candidate(provider,path.join(directory,'node_modules',lock.providers[provider].package,lock.providers[provider].entry),'managed');
  }catch{return status(provider,'failed',{source:'managed',message:'The private CLI runtime is incomplete or changed; download it again'});}
 }
 async function inspect(request){
  exact(request,['provider','executable'],['provider']);const provider=validProvider(request.provider);
  if(request.executable!==undefined)return candidate(provider,request.executable,'manual');
  const value=manual(provider);
  if(value){
   const choices=[];if(path.isAbsolute(value))choices.push(value);else for await(const file of pathCandidates(value,env,platform)){choices.push(file);break;}
   const result=choices.length?await candidate(provider,choices[0],'manual'):status(provider,'invalid',{source:'manual',message:'The configured CLI path was not found'});
   if(result.status==='ready')return result;
   // Only an explicit install action may choose a managed fallback for a manual path.
   if(readSelection(provider)?.manualPath===value){const cached=await managed(provider);if(cached?.status==='ready')return cached;}
   return result;
  }
  const environment=environmentValue(env,'STUDIO_'+provider.toUpperCase()+'_CLI',platform),seen=new Set();let failure;
  async function* choices(){if(environment)yield {value:environment,source:'environment'};for await(const value of pathCandidates(provider,env,platform))yield {value,source:'path'};}
  for await(const choice of choices()){
   if(seen.has(choice.value.toLowerCase()))continue;seen.add(choice.value.toLowerCase());
   const result=await candidate(provider,choice.value,choice.source);if(result.status==='ready')return result;failure??=result;
  }
  const cached=await managed(provider);if(cached?.status==='ready')return cached;
  return failure||cached||status(provider,'missing',{message:'No local CLI was found. Download is available when you choose it.'});
 }
 async function resolve(provider){const readiness=await inspect({provider});if(readiness.status!=='ready')throw Object.assign(Error(readiness.message),{code:'CLI_RUNTIME_'+readiness.status.toUpperCase(),readiness});return readiness.executable;}
 async function select(provider,generation){
  const file=selectionFile(provider);unlinkedParents(file);await fs.promises.mkdir(path.dirname(file),{recursive:true});
  const temporary=file+'.'+randomUUID()+'.tmp';await fs.promises.writeFile(temporary,JSON.stringify({schema_version:1,lockHash,generation,manualPath:manual(provider)})+'\n',{flag:'wx'});await fs.promises.rename(temporary,file);
 }
 async function checkInterface(provider,executable,profileRoot,signal){
  signal.throwIfAborted();
  const owned=[];
  const interfaceSpawn=(...args)=>{const child=spawnCli(...args),closed=new Promise(resolve=>child.once('close',resolve));owned.push(closed);return child;};
  const profile=prepareProfile(profileRoot,provider),bridge=new AcpBridge(provider,{host:{...providerRuntime,spawnCli:interfaceSpawn},probeTimeoutMs});
  let timer,rejectCancelled;
  const interrupted=new Promise((resolve,reject)=>{rejectCancelled=reject;timer=setTimeout(()=>{reject(Error('CLI ACP initialization timed out'));bridge.close();},interfaceTimeoutMs);});
  const abort=()=>{rejectCancelled(cancelled());bridge.close();};signal.addEventListener('abort',abort,{once:true});
  try{
   const info=await Promise.race([bridge.start(executable,profile,null),interrupted]);signal.throwIfAborted();
   return {protocolVersion:info.protocolVersion,agentVersion:info.agentInfo?.version||null,scope:'Unauthenticated ACP initialize only; no account, model, tools or scientific request'};
  }finally{
   clearTimeout(timer);signal.removeEventListener('abort',abort);bridge.close();
   // Child exit/stdio closure precedes deleting the private compatibility profile.
   await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('CLI interface process did not close')),2000);Promise.all(owned).then(()=>{clearTimeout(timeout);resolve();},error=>{clearTimeout(timeout);reject(error);});});
  }
 }
 async function install(request){
  exact(request,['provider','requestId']);const provider=validProvider(request.provider),{requestId}=request;
  if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(requestId))throw Error('cli_runtime_invalid_request');
  if(active.has(provider)){const existing=active.get(provider);if(existing.requestId!==requestId)throw Error('cli_runtime_install_in_progress');return existing.promise;}
  const controller=new AbortController(),signal=controller.signal,operation={requestId,controller,promise:null};
  let progressState={receivedBytes:0,packageIndex:0,packageCount:lock.providers[provider].packages.length};
  const progress=(phase,extra={})=>{progressState={...progressState,...extra};try{publish({provider,requestId,phase,...progressState});}catch{}};
  const promise=(async()=>{
   let staging;try{
    if(platform!=='win32'||!['x64','arm64'].includes(arch))throw Error('cli_runtime_platform_unsupported');
    const cached=await managed(provider),saved=readSelection(provider);
    if(cached?.status==='ready'&&saved){await select(provider,saved.generation);progress('completed',{message:'Existing verified CLI is ready'});return cached;}
    signal.throwIfAborted();unlinkedParents(root);await fs.promises.mkdir(root,{recursive:true});
    const stagingRoot=path.join(root,'staging');unlinkedParents(stagingRoot);await fs.promises.mkdir(stagingRoot,{recursive:true});
    staging=path.join(stagingRoot,randomUUID());await fs.promises.mkdir(staging);const runtime=path.join(staging,'runtime');await fs.promises.mkdir(runtime);
    const record=lock.providers[provider],packages=record.packages;let received=0,completed=0;
    const download=async(name,index)=>{
     const pkg=lock.packages[name],archive=path.join(staging,index+'.tgz'),response=await fetchApi(pkg.url,{redirect:'error',signal});
     if(!response.ok||!response.body)throw Error('cli_runtime_download_failed');
     if(response.url){const url=new URL(response.url);if(url.protocol!=='https:'||url.hostname!=='registry.npmjs.org')throw Error('cli_runtime_download_source_changed');}
     const length=Number(response.headers?.get?.('content-length'))||undefined;if(length&&(!Number.isSafeInteger(length)||length>128*1024*1024))throw Error('cli_runtime_download_size_limit');
     const handle=await fs.promises.open(archive,'wx'),hash=createHash('sha512');let size=0,last=0;
     try{
      for await(const part of response.body){signal.throwIfAborted();const bytes=Buffer.from(part);size+=bytes.length;received+=bytes.length;if(size>128*1024*1024||received>512*1024*1024)throw Error('cli_runtime_download_size_limit');hash.update(bytes);await handle.write(bytes);if(Date.now()-last>100){last=Date.now();progress('downloading',{receivedBytes:received,packageReceivedBytes:size,packageTotalBytes:length,packageIndex:completed,packageCount:packages.length});}}
     }finally{await handle.close();}
     signal.throwIfAborted();progress('verifying',{receivedBytes:received,packageIndex:completed,packageCount:packages.length});
     if(length&&size!==length||'sha512-'+hash.digest('base64')!==pkg.integrity)throw Error('cli_runtime_integrity_failed');
     progress('extracting',{receivedBytes:received,packageIndex:completed,packageCount:packages.length});
     const extract=extractArchive??(await import('../../../dist/cli-installer/archive.mjs')).extractNpmArchive;
     const directory=path.join(runtime,'node_modules',name);await extract({file:archive,directory,maxBytes:256*1024*1024,maxFiles:12000,signal});
     const actual=JSON.parse(await fs.promises.readFile(path.join(directory,'package.json'),'utf8'));if(actual.name!==name||actual.version!==pkg.version)throw Error('cli_runtime_package_identity_failed');
     for(const dep of Object.keys(actual.dependencies||{}))if(!Object.hasOwn(pkg.dependencies,dep))throw Error('cli_runtime_dependency_lock_incomplete');
     completed++;progress('downloading',{receivedBytes:received,packageIndex:completed,packageCount:packages.length});
    };
    // Bound concurrency; each package extracts into a distinct owned directory.
    for(let index=0;index<packages.length;index+=3){const settled=await Promise.allSettled(packages.slice(index,index+3).map((name,offset)=>download(name,index+offset)));const failed=settled.find(value=>value.status==='rejected');if(failed)throw failed.reason;}
    signal.throwIfAborted();
    if(provider==='qwen'&&dependencyRoot){
     for(const name of ['@lydell/node-pty','@lydell/node-pty-'+platform+'-'+arch]){
      const source=path.join(dependencyRoot,'node_modules',name);unlinkedParents(source);
      const pkg=JSON.parse(await fs.promises.readFile(path.join(source,'package.json'),'utf8'));if(pkg.name!==name||pkg.version!=='1.2.0-beta.10')throw Error('cli_runtime_pty_incompatible');
      await fs.promises.cp(source,path.join(runtime,'node_modules',name),{recursive:true,filter:source=>!source.endsWith('.pdb')&&!source.endsWith('.map')});
     }
    }
    progress('checking',{receivedBytes:received,packageIndex:completed,packageCount:packages.length});
    const executable=path.join(runtime,'node_modules',record.package,record.entry),readiness=await candidate(provider,executable,'managed',signal);signal.throwIfAborted();if(readiness.status!=='ready')throw Object.assign(Error(readiness.message),{readiness});
    const compatibility=await checkInterface(provider,executable,path.join(staging,'compatibility-profile'),signal);
    const files=await treeReceipt(runtime);signal.throwIfAborted();
    await fs.promises.writeFile(path.join(runtime,'runtime.json'),JSON.stringify({schema_version:1,provider,lockHash,platform,arch,compatibility,files})+'\n',{flag:'wx'});
    const generation=randomUUID(),destination=path.join(root,provider,generation);unlinkedParents(destination);await fs.promises.mkdir(path.dirname(destination),{recursive:true});
    await fs.promises.rename(runtime,destination);await select(provider,generation);
    progress('completed',{receivedBytes:received,packageIndex:completed,packageCount:packages.length});
    return {...readiness,executable:path.join(destination,'node_modules',record.package,record.entry)};
   }catch(error){
    if(signal.aborted){progress('cancelled');throw cancelled();}progress('failed',{message:error.message});throw error;
   }finally{
    if(staging){const base=path.join(root,'staging'),resolved=path.resolve(staging);if(!inside(base,resolved))throw Error('cli_runtime_unsafe_cleanup');unlinkedParents(resolved);await fs.promises.rm(resolved,{recursive:true,force:true});}
   }
  })();operation.promise=promise;active.set(provider,operation);
  try{return await promise;}finally{if(active.get(provider)===operation)active.delete(provider);}
 }
 function cancel(request){exact(request,['provider','requestId']);const provider=validProvider(request.provider),current=active.get(provider);if(!current||current.requestId!==request.requestId)return {cancelled:false};current.controller.abort(cancelled());return {cancelled:true};}
 return {inspect,resolve,install,cancel};
}
