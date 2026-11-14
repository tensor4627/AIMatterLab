import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {stageDshRuntime} from './stage-dsh-runtime.mjs';

// Keep matching native DLLs in place: Windows can lock them while an existing
// terminal is running. Only files owned by this physical staging root are writable.
function syncNativeModules(root,sources){
 const directories=new Set([root]),files=new Map();
 function collect(source,dest,packageRoot){
  if(!fs.realpathSync(source).startsWith(packageRoot+path.sep))throw Error('Native package file outside source');
  const stat=fs.lstatSync(source);
  if(stat.isSymbolicLink())throw Error('Linked native package input');
  if(stat.isDirectory()){
   directories.add(dest);
   for(const name of fs.readdirSync(source)){
    if(name!=='node_modules'&&!/\.(?:pdb|map)$/i.test(name))collect(path.join(source,name),path.join(dest,name),packageRoot);
   }
  }else if(stat.isFile())files.set(dest,source);
  else throw Error('Unsupported native package input');
 }
 for(const [name,source] of sources){
  const dest=path.join(root,name);
  directories.add(path.dirname(dest));directories.add(dest);
  for(const entry of fs.readdirSync(source)){
   if(entry!=='node_modules'&&!/\.(?:pdb|map)$/i.test(entry))collect(path.join(source,entry),path.join(dest,entry),source);
  }
 }
 const stale=[];
 function inspect(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   const dest=path.join(dir,entry.name);
   if(entry.isSymbolicLink()||!fs.realpathSync(dest).startsWith(root+path.sep))throw Error('Linked native runtime staging target');
   if(entry.isDirectory()){inspect(dest);if(!directories.has(dest))stale.push(dest);}
   else if(!entry.isFile())throw Error('Unsupported native runtime staging target');
   else if(!files.has(dest))stale.push(dest);
  }
 }
 fs.mkdirSync(root,{recursive:true});
 inspect(root);
 for(const dir of directories)fs.mkdirSync(dir,{recursive:true});
 for(const [dest,source] of files){
  if(fs.existsSync(dest)&&fs.readFileSync(dest).equals(fs.readFileSync(source)))continue;
  fs.copyFileSync(source,dest);
 }
 for(const dest of stale){
  if(fs.statSync(dest).isDirectory())fs.rmdirSync(dest);else fs.unlinkSync(dest);
 }
}

export function stageCoreRuntimes({root=process.cwd(),platform=process.platform,arch=process.arch,dshProfile}={}){
root=fs.realpathSync(root);
if(!['aimatterlab','gpu-sampling-studio'].includes(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).name))throw Error('Native runtime staging requires an AIMatterLab checkout');
const target=path.resolve(root,'.studio','agent-runtimes'),modules=path.join(target,'node_modules'),sourceModules=path.join(root,'node_modules');
const contained=(base,file)=>{const relative=path.relative(base,file);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
if(!contained(root,target)||path.relative(root,target)!==path.join('.studio','agent-runtimes'))throw Error('Unsafe runtime staging target');
for(let parent=target;contained(root,parent);parent=path.dirname(parent))if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())throw Error('Linked runtime staging target');
const nativeTargets=['node_modules','manifest.json'].map(name=>path.join(target,name));
for(const file of nativeTargets)if(fs.existsSync(file)&&(fs.lstatSync(file).isSymbolicLink()||!contained(target,fs.realpathSync(file))))throw Error('Linked native runtime staging target');
const copied=new Map(),sources=new Map();
function stage(name,from=root){
 const require=createRequire(path.join(from,'package.json'));
 let manifest;
 try{manifest=require.resolve(name+'/package.json');}
 catch{let directory=path.dirname(require.resolve(name));while(!fs.existsSync(path.join(directory,'package.json'))){const parent=path.dirname(directory);if(parent===directory)throw Error('Cannot find '+name);directory=parent;}manifest=path.join(directory,'package.json');}
 const source=fs.realpathSync(path.dirname(manifest)),pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));
 if(!contained(sourceModules,source)||pkg.name!==name)throw Error('Runtime dependency must resolve inside this checkout: '+name);
 if(copied.has(name)){if(copied.get(name)!==pkg.version)throw Error('Runtime dependency conflict: '+name);return source;}
 copied.set(name,pkg.version);
 sources.set(name,source);
 for(const dependency of Object.keys(pkg.dependencies||{}))stage(dependency,source);
 return source;
}
const wrapper=stage('@lydell/node-pty');
// pnpm keeps the native optional dependency beside its wrapper in the virtual store.
stage('@lydell/node-pty-'+platform+'-'+arch,wrapper);
syncNativeModules(modules,sources);
const manifest={scope:'This manifest audits native PTY; the pinned DSH closure has its own dsh/runtime.json. Other provider CLIs are discovered locally or installed with explicit user consent.',packages:Object.fromEntries(copied)};
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2));
if(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).devDependencies?.['@deepseek-ai/dsh'])stageDshRuntime({root,platform,arch,...dshProfile?{profile:dshProfile}:{}});
return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const manifest=stageCoreRuntimes();console.log('Staged '+Object.keys(manifest.packages).length+' native terminal runtime packages'+(JSON.parse(fs.readFileSync('package.json','utf8')).devDependencies?.['@deepseek-ai/dsh']?' and the pinned DSH closure':''));}
