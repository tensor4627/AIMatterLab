import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {desktopRoot,requireLaunchContext,launchDesktop,childExitCode,reportLaunchFailure} from './desktop-launch.mjs';

const inputs=['frontend','desktop','backend','agent','contracts','scripts','installation','index.html','package.json','pnpm-lock.yaml','vite.config.ts','tsconfig.json','pnpm-workspace.yaml','.npmrc'];
export function sourceFingerprint(root){
 const hash=createHash('sha256');
 function add(relative){const file=path.join(root,relative);if(!fs.existsSync(file))return;const stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error('Linked source input: '+relative);if(stat.isDirectory()){for(const entry of fs.readdirSync(file).sort())if(!['__pycache__','node_modules','.pytest_cache'].includes(entry))add(path.join(relative,entry));}else if(stat.isFile()){hash.update(relative.replaceAll('\\','/')+'\0');hash.update(fs.readFileSync(file));}}
 for(const entry of inputs)add(entry);return hash.digest('hex');
}
const dependencyFields=[
 'name','type','dependencies','devDependencies','optionalDependencies','peerDependencies',
 'peerDependenciesMeta','dependenciesMeta','bundledDependencies','bundleDependencies',
 'packageManager','pnpm','overrides','resolutions','engines','devEngines','os','cpu','libc','workspaces',
];
const installHooks=['preinstall','install','postinstall','prepublish','prepare','preprepare','postprepare','pnpm:devPreinstall'];
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
export function dependencyFingerprint(root){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 const relevant=Object.fromEntries(dependencyFields.filter(key=>key in manifest).map(key=>[key,manifest[key]]));
 relevant.scripts=Object.fromEntries(installHooks.filter(key=>key in (manifest.scripts||{})).map(key=>[key,manifest.scripts[key]]));
 const hash=createHash('sha256').update(process.platform+' '+process.arch+' '+process.versions.node+'\0');
 hash.update(JSON.stringify(canonical(relevant)));
 for(const name of ['pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc']){
  hash.update('\0'+name+'\0');
  if(fs.existsSync(path.join(root,name)))hash.update(fs.readFileSync(path.join(root,name)));
 }
 return hash.digest('hex');
}
// The visible lock always points to a complete owner record. A crash before the
// exclusive hard-link publication leaves only an unreferenced temporary file.
export function publishSourceOwner(file,owner){
 const temp=file+'.'+randomUUID()+'.owner';
 try{
  fs.writeFileSync(temp,JSON.stringify(owner),{flag:'wx'});
  fs.linkSync(temp,file);
 }finally{
  fs.rmSync(temp,{force:true});
 }
}
function read(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function write(file,value){const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,file);}
function alive(pid){if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
function runCommand(command,argv,{root,env}){return new Promise((resolve,reject)=>{const child=spawn(command,argv,{cwd:root,env,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(Error(command+' failed ('+(code??signal)+')')));});}
export function runPnpm(args,{root,env}){
 // Only fixed install/build arguments enter cmd; profile paths and caller flags never do.
 const command=process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','cmd.exe'):'pnpm';
 const argv=process.platform==='win32'?['/d','/s','/c','pnpm '+args.join(' ')]:args;
 return runCommand(command,argv,{root,env});
}
export function sourceOptions(args,root,env){
 let profile=env.STUDIO_PROFILE_DIR?path.resolve(env.STUDIO_PROFILE_DIR):path.join(root,'.config');
 for(let i=0;i<args.length;i++){if(args[i]!=='--profile'||!args[i+1]||args[i+1].startsWith('--'))throw Error('Usage: node scripts/source-start.mjs [--profile <directory>]');profile=path.resolve(args[++i]);}
 return {profile,env:{...env,STUDIO_PROFILE_DIR:profile,STUDIO_DEV_URL:''}};
}
export async function startSource({
 root=desktopRoot,args=process.argv.slice(2),env=process.env,
 preflight=requireLaunchContext,run=runPnpm,
 installElectron=({root,env})=>runCommand(process.execPath,[path.join(root,'node_modules','electron','install.js')],{root,env}),
 launch=launchDesktop,writeLog=console.log,
 wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),isAlive=alive,
}={}){
 const options=sourceOptions(args,root,env);
 preflight();
 const cache=path.join(root,'.studio','source-entry');
 fs.mkdirSync(cache,{recursive:true});
 const lock=path.join(cache,'launch.lock'),stateFile=path.join(cache,'state.json');
 let owned=false;
 for(let attempt=0;attempt<600;attempt++){
  try{
   publishSourceOwner(lock,{pid:process.pid,phase:'preparing',profile:options.profile});
   owned=true;
   break;
  }catch(error){
   if(error.code!=='EEXIST')throw error;
   const owner=read(lock);
   if(owner&&!isAlive(owner.pid)){
    let reclaim=false;
    try{
     publishSourceOwner(lock+'.reclaim',{pid:process.pid});
     reclaim=true;
     const current=read(lock);
     if(current&&!isAlive(current.pid))fs.unlinkSync(lock);
    }catch(error){
     if(!['EEXIST','ENOENT'].includes(error.code))throw error;
    }finally{
     if(reclaim)fs.unlinkSync(lock+'.reclaim');
    }
    continue;
   }
   if(owner?.phase==='ready'){
    if(path.resolve(owner.profile).toLowerCase()!==options.profile.toLowerCase()){
     throw Error('This source checkout is already running with another profile. Close it before switching profiles.');
    }
    writeLog('AIMatterLab 已在运行；复用原窗口。Close the existing window before applying source updates.');
    const child=await launch({preflight:()=>{},cwd:root,env:options.env,args:[]});
    return {child,reused:true,release:()=>{}};
   }
   if(attempt===0)writeLog('等待同一源码目录准备完成… Waiting for source preparation…');
   await wait(200);
  }
 }
 if(!owned)throw Error('Another source launcher is still preparing this checkout. Retry after it finishes.');
 const release=()=>{
  if(read(lock)?.pid!==process.pid)return;
  try{fs.unlinkSync(lock);}catch(error){if(error.code!=='ENOENT')throw error;}
 };
 try{
  const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
  writeLog('AIMatterLab '+version+' · 配置与缓存 / Profile: '+options.profile);
  const state=read(stateFile)||{},dependencies=dependencyFingerprint(root);
  const electron=path.join(root,'node_modules','electron','dist',process.platform==='win32'?'electron.exe':'electron');
  const vite=path.join(root,'node_modules','vite','bin','vite.js');
  const install=state.dependencies!==dependencies||!fs.existsSync(electron)||!fs.existsSync(vite);
  if(install){
   fs.rmSync(stateFile,{force:true});
   writeLog('安装锁定依赖… Installing locked dependencies…');
   await run(['install','--frozen-lockfile'],{root,env:options.env});
   if(!fs.existsSync(electron)){
    writeLog('准备 Electron 桌面运行时… Preparing Electron runtime…');
    await installElectron({root,env:options.env});
   }
   if(!fs.existsSync(electron))throw Error('Electron runtime is missing after dependency installation.');
  }
  const source=sourceFingerprint(root);
  const build=install||state.source!==source||!fs.existsSync(path.join(root,'dist','index.html'))
   ||!fs.existsSync(path.join(root,'.studio','agent-runtimes','manifest.json'));
  if(build){
   fs.rmSync(stateFile,{force:true});
   writeLog('构建当前源码… Building current source…');
   await run(['run','build'],{root,env:options.env});
  }
  // Build generators can update tracked contracts. Record successful final inputs.
  write(stateFile,{version:1,dependencies:dependencyFingerprint(root),source:sourceFingerprint(root)});
  writeLog(build?'准备完成，启动桌面。Starting desktop.':'源码未变，直接启动。Source unchanged; starting desktop.');
  const child=await launch({preflight:()=>{},cwd:root,env:options.env,args:[]});
  write(lock,{pid:process.pid,phase:'ready',profile:options.profile});
  child.once('exit',release);
  child.once('error',release);
  return {child,release,installed:install,built:build,profile:options.profile};
 }catch(error){
  release();
  throw error;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const {child,release}=await startSource();child.once('error',reportLaunchFailure);child.once('exit',(code,signal)=>{release();process.exitCode=childExitCode(code,signal);});for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));}catch(error){reportLaunchFailure(error);}
}
