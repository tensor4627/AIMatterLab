import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';

export function generateCliRuntimeLock(root){
 const lock=fs.readFileSync(path.join(root,'pnpm-lock.yaml'),'utf8'),packages={};
 const integrity=new Map([...lock.matchAll(/^  ['"]?([^\r\n]+?)['"]?:\r?\n    resolution: \{integrity: (sha512-[A-Za-z0-9+/=]+)\}/gm)].map(match=>[match[1].replace(/^['"]|['"]$/g,''),match[2]]));
 function stage(name,from=root){
  const require=createRequire(path.join(from,'package.json'));let manifest;
  try{manifest=require.resolve(name+'/package.json');}catch{let folder=path.dirname(require.resolve(name));while(!fs.existsSync(path.join(folder,'package.json'))){const parent=path.dirname(folder);if(parent===folder)throw Error('Cannot find runtime '+name);folder=parent;}manifest=path.join(folder,'package.json');}
  const pkg=JSON.parse(fs.readFileSync(manifest,'utf8')),sum=integrity.get(pkg.name+'@'+pkg.version);
  if(!sum)throw Error('Missing locked integrity '+pkg.name+'@'+pkg.version);
  if(packages[name]){if(packages[name].version!==pkg.version)throw Error('CLI runtime dependency conflict '+name);return;}
  const plain=name.split('/').at(-1);
  packages[name]={name,version:pkg.version,url:'https://registry.npmjs.org/'+name+'/-/'+plain+'-'+pkg.version+'.tgz',integrity:sum,dependencies:{}};
  for(const dependency of Object.keys(pkg.dependencies||{}).sort()){stage(dependency,path.dirname(manifest));packages[name].dependencies[dependency]=packages[dependency].version;}
 }
 const providers={};
 for(const [provider,name,entry]of [['kimi','@moonshot-ai/kimi-code','dist/main.mjs'],['qwen','@qwen-code/qwen-code','cli-entry.js']]){
  stage(name);const closure=new Set();function visit(id){if(closure.has(id))return;closure.add(id);for(const child of Object.keys(packages[id].dependencies))visit(child);}visit(name);
  providers[provider]={package:name,version:packages[name].version,entry,packages:[...closure].sort()};
 }
 return {schema_version:1,scope:'Pinned official npm packages; explicit user download only; no lifecycle scripts',providers,packages:Object.fromEntries(Object.entries(packages).sort(([a],[b])=>a.localeCompare(b)))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const root=fileURLToPath(new URL('..',import.meta.url)),file=path.join(root,'contracts/agent/cli-runtime-lock.json'),content=JSON.stringify(generateCliRuntimeLock(root),null,2)+'\n';
 if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==content)throw Error('CLI runtime lock is stale');}
 else fs.writeFileSync(file,content);
}
