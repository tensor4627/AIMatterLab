import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=process.cwd(),target=path.join(root,'.studio','agent-runtimes'),modules=path.join(target,'node_modules');
fs.mkdirSync(modules,{recursive:true});
const copied=new Map();
function stage(name,from=root){
 const require=createRequire(path.join(from,'package.json'));
 let manifest;
 try{manifest=require.resolve(name+'/package.json');}
 catch{let directory=path.dirname(require.resolve(name));while(!fs.existsSync(path.join(directory,'package.json'))){const parent=path.dirname(directory);if(parent===directory)throw Error('Cannot find '+name);directory=parent;}manifest=path.join(directory,'package.json');}
 const source=path.dirname(manifest),pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));
 if(copied.has(name)){if(copied.get(name)!==pkg.version)throw Error('Runtime dependency conflict: '+name);return;}
 copied.set(name,pkg.version);
 const destination=path.join(modules,name);
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 fs.cpSync(source,destination,{recursive:true,dereference:true,filter:file=>!path.relative(source,file).split(path.sep).includes('node_modules')});
 for(const dependency of Object.keys(pkg.dependencies||{}))stage(dependency,source);
}
stage('@moonshot-ai/kimi-code');stage('@qwen-code/qwen-code');
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify({scope:'Official ACP CLI runtimes; no user credentials or sessions',packages:Object.fromEntries(copied)},null,2));
console.log('Staged '+copied.size+' official runtime packages');
