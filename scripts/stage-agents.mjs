import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {stageDshRuntime} from './stage-dsh-runtime.mjs';
export function stageCoreRuntimes({root=process.cwd(),platform=process.platform,arch=process.arch,dshProfile}={}){
root=fs.realpathSync(root);
if(!['aimatterlab','gpu-sampling-studio'].includes(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).name))throw Error('Native runtime staging requires an AIMatterLab checkout');
const target=path.resolve(root,'.studio','agent-runtimes'),modules=path.join(target,'node_modules'),sourceModules=path.join(root,'node_modules');
const contained=(base,file)=>{const relative=path.relative(base,file);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
if(!contained(root,target)||path.relative(root,target)!==path.join('.studio','agent-runtimes'))throw Error('Unsafe runtime staging target');
for(let parent=target;contained(root,parent);parent=path.dirname(parent))if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())throw Error('Linked runtime staging target');
// Rebuild the native core without recopying the independently audited DSH tree.
// Check every owned deletion target before touching any existing output.
const nativeTargets=['node_modules','manifest.json'].map(name=>path.join(target,name));
for(const file of nativeTargets)if(fs.existsSync(file)&&(fs.lstatSync(file).isSymbolicLink()||!contained(target,fs.realpathSync(file))))throw Error('Linked native runtime staging target');
for(const file of nativeTargets)fs.rmSync(file,{recursive:true,force:true});
fs.mkdirSync(modules,{recursive:true});
const copied=new Map();
function stage(name,from=root){
 const require=createRequire(path.join(from,'package.json'));
 let manifest;
 try{manifest=require.resolve(name+'/package.json');}
 catch{let directory=path.dirname(require.resolve(name));while(!fs.existsSync(path.join(directory,'package.json'))){const parent=path.dirname(directory);if(parent===directory)throw Error('Cannot find '+name);directory=parent;}manifest=path.join(directory,'package.json');}
 const source=fs.realpathSync(path.dirname(manifest)),pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));
 if(!contained(sourceModules,source)||pkg.name!==name)throw Error('Runtime dependency must resolve inside this checkout: '+name);
 if(copied.has(name)){if(copied.get(name)!==pkg.version)throw Error('Runtime dependency conflict: '+name);return source;}
 copied.set(name,pkg.version);
 const destination=path.join(modules,name);
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 fs.cpSync(source,destination,{recursive:true,dereference:true,filter:file=>!path.relative(source,file).split(path.sep).includes('node_modules')&&!/\.(?:pdb|map)$/i.test(file)});
 for(const dependency of Object.keys(pkg.dependencies||{}))stage(dependency,source);
 return source;
}
const wrapper=stage('@lydell/node-pty');
// pnpm keeps the native optional dependency beside its wrapper in the virtual store.
stage('@lydell/node-pty-'+platform+'-'+arch,wrapper);
const manifest={scope:'This manifest audits native PTY; the pinned DSH closure has its own dsh/runtime.json. Other provider CLIs are discovered locally or installed with explicit user consent.',packages:Object.fromEntries(copied)};
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2));
if(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).devDependencies?.['@deepseek-ai/dsh'])stageDshRuntime({root,platform,arch,...dshProfile?{profile:dshProfile}:{}});
return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const manifest=stageCoreRuntimes();console.log('Staged '+Object.keys(manifest.packages).length+' native terminal runtime packages'+(JSON.parse(fs.readFileSync('package.json','utf8')).devDependencies?.['@deepseek-ai/dsh']?' and the pinned DSH closure':''));}
