// Build-time, offline staging only. Never consults DSH user profiles or starts a CLI.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

// Resolve transitive build tools through their declaring packages, including pnpm's isolated layout.
const require=createRequire(import.meta.url);
const electronBuilderRequire=createRequire(require.resolve('electron-builder/package.json'));
const semver=createRequire(electronBuilderRequire.resolve('app-builder-lib/package.json'))('semver');
const ROOTS=['@deepseek-ai/dsh','@deepseek-ai/dsh-sdk-minimal','@deepseek-ai/dsh-mcp-client','@deepseek-ai/dsh-llm-pi-ai'];
const ENTRY='node_modules/@deepseek-ai/dsh/lib/bin.js';
// Dependencies used by the official CLI to boot the AIMatterLab profile.
const STUDIO_PROFILE='studio-sdk-v2';
const studioCarrierDependencies=new Set([
 '@deepseek-ai/cordis','@deepseek-ai/cordis-plugin-include','@deepseek-ai/cordis-plugin-loader',
 '@deepseek-ai/cordis-plugin-timer','@deepseek-ai/dsh-hmr','@deepseek-ai/dsh-app-boot',
 '@deepseek-ai/dsh-home-paths','@deepseek-ai/dsh-official-bundles','@deepseek-ai/dsh-http-proxy',
 '@deepseek-ai/dsh-launch-environment','@deepseek-ai/dsh-cmdline','commander',
]);
const studioStartupDependencies=new Set([
 '@deepseek-ai/dsh-cmdline','@deepseek-ai/dsh-sdk-jsonrpc-server','@deepseek-ai/schemastery','commander',
]);
function runtimeDependencies(pkg,profile){
 const declared=dependencies(pkg);
 if(profile!==STUDIO_PROFILE||!['@deepseek-ai/dsh','@deepseek-ai/dsh-sdk-app'].includes(pkg.name))return declared;
 if(pkg.version!=='0.2.2-rc.1')throw Error('AIMatterLab DSH profile projection requires a new dependency audit for '+pkg.version);
 const selected=pkg.name==='@deepseek-ai/dsh'?studioCarrierDependencies:studioStartupDependencies;
 // Required peers still describe the plugin implementation, not bundle inserts.
 return declared.filter(dependency=>dependency.kind==='peer'||selected.has(dependency.name));
}
const limits={maxFiles:100000,maxBytes:1024*1024*1024,maxPackages:4096,maxDepth:64};
const relative=(root,file)=>path.relative(root,file).split(path.sep).join('/');
const contained=(root,file)=>{const rel=path.relative(root,file);return rel!==''&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const packageName=name=>typeof name==='string'&&/^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/.test(name)&&!name.split('/').some(part=>part==='.'||part==='..');
function pathWithin(root,name){if(typeof name!=='string'||!name||name.includes('\\')||path.posix.normalize(name)!==name||path.posix.isAbsolute(name))throw Error('Invalid staged DSH path');const file=path.resolve(root,name);if(!contained(root,file))throw Error('Staged DSH path escapes runtime');return file;}
function specFor(name,range){
 if(!packageName(name)||typeof range!=='string')throw Error('Invalid DSH dependency declaration');
 if(range.startsWith('npm:')){const alias=/^npm:((?:@[^/]+\/)?[^@]+)@(.+)$/.exec(range);if(!alias||!packageName(alias[1])||!semver.validRange(alias[2]))throw Error('Unsupported DSH dependency alias: '+name);return {name:alias[1],range:alias[2]};}
 if(!semver.validRange(range))throw Error('Unsupported DSH dependency range: '+name);return {name,range};
}
function dependencies(pkg){
 const all=new Map();
 for(const [kind,values]of [['peer',pkg.peerDependencies],['dependency',pkg.dependencies],['optional',pkg.optionalDependencies]]){
  if(values===undefined)continue;if(!values||typeof values!=='object'||Array.isArray(values))throw Error('Invalid DSH package dependencies');
  for(const [name,range]of Object.entries(values)){specFor(name,range);if(kind==='peer'&&all.has(name))continue;all.set(name,{name,range,kind:kind==='peer'?'peer':'dependency',optional:kind==='optional'||kind==='peer'&&pkg.peerDependenciesMeta?.[name]?.optional===true});}
 }
 return [...all.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
function availableFor(pkg,platform,arch){
 const admits=(values,value)=>{if(values===undefined)return true;if(!Array.isArray(values)||values.some(item=>typeof item!=='string'))throw Error('Invalid DSH platform constraint');return !values.includes('!'+value)&&(!values.some(item=>!item.startsWith('!'))||values.includes(value)||values.includes('any'));};
 return admits(pkg.os,platform)&&admits(pkg.cpu,arch);
}
function findPackage(from,name,boundary){
 if(!packageName(name))throw Error('Invalid runtime package name');
 const floor=path.basename(boundary)==='node_modules'?path.dirname(boundary):boundary;
 for(let directory=from;;directory=path.dirname(directory)){
  if(path.basename(directory)!=='node_modules'){
   const candidate=path.join(directory,'node_modules',name),manifest=path.join(candidate,'package.json');
   if(fs.existsSync(manifest)){
    const actual=fs.realpathSync(candidate);if(!contained(boundary,actual))throw Error('DSH dependency resolves outside this checkout/runtime: '+name);
    const info=fs.lstatSync(path.join(actual,'package.json'));if(!info.isFile()||info.isSymbolicLink())throw Error('Invalid DSH package manifest: '+name);
    return {source:actual,pkg:readJson(path.join(actual,'package.json'))};
   }
  }
  const parent=path.dirname(directory);if(directory===floor||parent===directory||!contained(floor,parent)&&parent!==floor)break;
 }
 return null;
}
function checkPackage(pkg,name,range){const spec=specFor(name,range);if(pkg.name!==spec.name||!semver.valid(pkg.version)||!semver.satisfies(pkg.version,spec.range))throw Error('DSH dependency version/name mismatch: '+name+' ('+range+')');}
function noLinkedParents(root,target){for(let parent=target;contained(root,parent);parent=path.dirname(parent))if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())throw Error('Linked DSH staging target');}
function lockIdentity(root){const file=path.join(root,'pnpm-lock.yaml');if(!fs.existsSync(file))return null;const info=fs.lstatSync(file);if(info.isSymbolicLink()||!info.isFile()||info.size>32*1024*1024)throw Error('Invalid DSH source lockfile');return hash(fs.readFileSync(file));}

export function stageDshRuntime({root=process.cwd(),platform=process.platform,arch=process.arch,force=false,profile=STUDIO_PROFILE,...options}={}){
 if(![STUDIO_PROFILE,'full'].includes(profile))throw Error('Invalid DSH runtime profile');
 if(typeof force!=='boolean')throw Error('Invalid DSH staging force option');
 root=fs.realpathSync(root);const app=readJson(path.join(root,'package.json'));
 if(!['aimatterlab','gpu-sampling-studio'].includes(app.name))throw Error('DSH runtime staging requires an AIMatterLab checkout');
 const version=app.devDependencies?.[ROOTS[0]];
 if(!semver.valid(version)||ROOTS.some(name=>app.devDependencies?.[name]!==version))throw Error('All official DSH roots must have the same exact version pin');
 const bound={...limits,...options};for(const key of Object.keys(limits))if(!Number.isSafeInteger(bound[key])||bound[key]<1)throw Error('Invalid DSH staging bound');
 const sourceModules=fs.realpathSync(path.join(root,'node_modules')),target=path.join(root,'.studio','agent-runtimes','dsh');
 if(!contained(root,sourceModules)||!contained(root,target))throw Error('Unsafe DSH runtime staging root');noLinkedParents(root,target);fs.mkdirSync(path.dirname(target),{recursive:true});
 const sourceLockSha256=lockIdentity(root),rootPins=Object.fromEntries(ROOTS.map(name=>[name,version])),rootPackages=ROOTS.map(name=>{const found=findPackage(root,name,sourceModules);if(!found)throw Error('Missing required DSH root: '+name);checkPackage(found.pkg,name,version);if(!availableFor(found.pkg,platform,arch))throw Error('Required DSH root does not support target platform');return {name,...found};});
 if(!force&&sourceLockSha256&&fs.existsSync(path.join(target,'runtime.json'))){
  let cached;try{cached=readJson(path.join(target,'runtime.json'));}catch{throw Error('Cached DSH runtime manifest is unreadable; rebuild with force after inspecting the staged runtime');}
  if(cached.profile===profile&&cached.sourceLockSha256===sourceLockSha256&&JSON.stringify(cached.rootPins)===JSON.stringify(rootPins)&&cached.version===version&&cached.platform===platform&&cached.arch===arch){validateStagedDshRuntime(target,{expectedVersion:version,platform,arch,...bound});if(lockIdentity(root)!==sourceLockSha256||ROOTS.some(name=>readJson(path.join(root,'package.json')).devDependencies?.[name]!==version))throw Error('DSH source lock or root pins changed while verifying cache');return cached;}
 }
 const staging=path.join(path.dirname(target),'dsh-staging-'+randomUUID()),modules=path.join(staging,'node_modules'),installed=new Map(),packages=[],resolutions=[],skippedOptional=[],files=[];let bytes=0,packageCount=0;
 fs.mkdirSync(modules,{recursive:true});
 function copyOwn(source,destination,current=source,ancestry=new Set(),depth=0){
  if(depth>bound.maxDepth)throw Error('DSH package file depth exceeds staging bound');
  const actual=fs.realpathSync(current);if(actual!==source&&!contained(source,actual))throw Error('DSH package file link escapes its package');
  const info=fs.statSync(current);if(info.isDirectory()){
   if(ancestry.has(actual))throw Error('Cyclic DSH package file link');const next=new Set(ancestry);next.add(actual);fs.mkdirSync(destination,{recursive:true});
   for(const name of fs.readdirSync(current).sort()){if(name==='node_modules'||/\.(?:map|pdb)$/i.test(name))continue;copyOwn(source,path.join(destination,name),path.join(current,name),next,depth+1);}
  }else if(info.isFile()){
   if(files.length>=bound.maxFiles||bytes+info.size>bound.maxBytes)throw Error('DSH runtime exceeds staging file/byte bound');
   fs.copyFileSync(current,destination);const data=fs.readFileSync(destination);bytes+=data.length;files.push({path:relative(staging,destination),size:data.length,sha256:hash(data)});
  }else throw Error('Unsupported DSH package file type');
 }
 function register(source,pkg,destination){
  if(++packageCount>bound.maxPackages)throw Error('DSH package closure exceeds staging bound');
  installed.set(destination,{source,pkg});copyOwn(source,destination);packages.push({path:relative(staging,destination),name:pkg.name,version:pkg.version});
 }
 const pending=[];
 try{
  for(const found of rootPackages){const destination=path.join(modules,found.name);register(found.source,found.pkg,destination);pending.push({source:found.source,pkg:found.pkg,destination,ancestors:[]});}
  function stageDependencies(item,depth=0){
   if(depth>bound.maxDepth)throw Error('DSH dependency depth exceeds staging bound');
   const {source,pkg,destination,ancestors}=item;
   for(const dependency of runtimeDependencies(pkg,profile)){
    const from=relative(staging,destination),found=findPackage(source,dependency.name,sourceModules);
    if(!found){if(dependency.optional){skippedOptional.push({from,name:dependency.name,range:dependency.range,kind:dependency.kind,reason:'missing'});continue;}throw Error('Missing required DSH dependency: '+pkg.name+' -> '+dependency.name);}
    checkPackage(found.pkg,dependency.name,dependency.range);
    if(!availableFor(found.pkg,platform,arch)){if(dependency.optional){skippedOptional.push({from,name:dependency.name,range:dependency.range,kind:dependency.kind,reason:'platform'});continue;}throw Error('Required DSH dependency does not support target platform: '+dependency.name);}
    const visible=findPackage(destination,dependency.name,staging);let child=visible?.source;
    if(!child||installed.get(child)?.source!==found.source){
     const hoisted=path.join(modules,dependency.name);child=installed.has(hoisted)?path.join(destination,'node_modules',dependency.name):hoisted;
     if(installed.has(child))throw Error('Conflicting DSH package placement: '+dependency.name);
     if(ancestors.includes(found.source)||source===found.source)throw Error('DSH dependency cycle cannot be represented without links: '+dependency.name);
     register(found.source,found.pkg,child);stageDependencies({source:found.source,pkg:found.pkg,destination:child,ancestors:[...ancestors,source]},depth+1);
    }
    resolutions.push({from,...dependency,to:relative(staging,child)});
   }
  }
  for(const item of pending)stageDependencies(item);
  const manifest={schemaVersion:1,profile,version,entry:ENTRY,platform,arch,sourceLockSha256,rootPins,packages:packages.sort((a,b)=>a.path.localeCompare(b.path)),resolutions:resolutions.sort((a,b)=>(a.from+'/'+a.name).localeCompare(b.from+'/'+b.name)),skippedOptional:skippedOptional.sort((a,b)=>(a.from+'/'+a.name).localeCompare(b.from+'/'+b.name)),files:files.sort((a,b)=>a.path.localeCompare(b.path))};
  fs.writeFileSync(path.join(staging,'runtime.json'),JSON.stringify(manifest,null,2));validateStagedDshRuntime(staging,{expectedVersion:version,platform,arch,...bound});
  if(lockIdentity(root)!==sourceLockSha256||ROOTS.some(name=>readJson(path.join(root,'package.json')).devDependencies?.[name]!==version))throw Error('DSH source lock or root pins changed during staging');
  noLinkedParents(root,target);const backup=path.join(path.dirname(target),'dsh-backup-'+randomUUID());let moved=false;
  if(fs.existsSync(target)){fs.renameSync(target,backup);moved=true;}
  try{fs.renameSync(staging,target);}catch(error){if(moved)fs.renameSync(backup,target);throw error;}
  if(moved&&contained(path.dirname(target),backup)&&path.basename(backup).startsWith('dsh-backup-'))fs.rmSync(backup,{recursive:true,force:true});return manifest;
 }catch(error){if(contained(path.dirname(target),staging)&&path.basename(staging).startsWith('dsh-staging-'))fs.rmSync(staging,{recursive:true,force:true});throw error;}
}

export function validateStagedDshRuntime(directory,{expectedVersion,platform=process.platform,arch=process.arch,...options}={}){
 directory=path.resolve(directory);const bound={...limits,...options};
 for(const key of Object.keys(limits))if(!Number.isSafeInteger(bound[key])||bound[key]<1)throw Error('Invalid DSH staging bound');
 if(fs.lstatSync(directory).isSymbolicLink())throw Error('Linked staged DSH runtime');
 const manifestFile=path.join(directory,'runtime.json');if(fs.lstatSync(manifestFile).isSymbolicLink()||!fs.statSync(manifestFile).isFile()||fs.statSync(manifestFile).size>64*1024*1024)throw Error('Invalid staged DSH manifest');
 const manifest=readJson(manifestFile);
 const profile=manifest.profile??'full';if(![STUDIO_PROFILE,'full'].includes(profile))throw Error('Invalid staged DSH profile');
 if(manifest.sourceLockSha256!==undefined&&manifest.sourceLockSha256!==null&&!/^[a-f0-9]{64}$/.test(manifest.sourceLockSha256)||manifest.rootPins!==undefined&&(!manifest.rootPins||typeof manifest.rootPins!=='object'||Array.isArray(manifest.rootPins)||Object.keys(manifest.rootPins).length!==ROOTS.length||ROOTS.some(name=>manifest.rootPins[name]!==manifest.version)))throw Error('Invalid staged DSH source identity');
 if(manifest.schemaVersion!==1||!semver.valid(manifest.version)||expectedVersion!==undefined&&manifest.version!==expectedVersion||manifest.entry!==ENTRY||manifest.platform!==platform||manifest.arch!==arch||!Array.isArray(manifest.packages)||!manifest.packages.length||manifest.packages.length>bound.maxPackages||!Array.isArray(manifest.files)||manifest.files.length>bound.maxFiles||!Array.isArray(manifest.resolutions)||!Array.isArray(manifest.skippedOptional))throw Error('Invalid staged DSH runtime manifest');
 const diskFiles=new Map();let bytes=0;
 function walk(current,depth=0){if(depth>bound.maxDepth*2)throw Error('Staged DSH file depth exceeds bound');for(const entry of fs.readdirSync(current,{withFileTypes:true})){const item=path.join(current,entry.name);if(entry.isSymbolicLink())throw Error('Linked file in staged DSH runtime');if(entry.isDirectory())walk(item,depth+1);else if(entry.isFile()){if(item===manifestFile)continue;if(/\.(?:map|pdb)$/i.test(entry.name))throw Error('Excluded file in staged DSH runtime');const data=fs.readFileSync(item);bytes+=data.length;if(diskFiles.size>=bound.maxFiles||bytes>bound.maxBytes)throw Error('Staged DSH runtime exceeds file/byte bound');diskFiles.set(relative(directory,item),{size:data.length,sha256:hash(data)});}else throw Error('Unsupported staged DSH file type');}}
 walk(directory);
 const recordedFiles=new Set();for(const receipt of manifest.files){pathWithin(directory,receipt.path);if(recordedFiles.has(receipt.path))throw Error('Duplicate staged DSH file receipt');recordedFiles.add(receipt.path);const actual=diskFiles.get(receipt.path);if(!actual||actual.size!==receipt.size||actual.sha256!==receipt.sha256)throw Error('Staged DSH file differs from integrity receipt: '+receipt.path);}
 if(recordedFiles.size!==diskFiles.size)throw Error('Unrecorded files in staged DSH runtime');
 const packages=new Map();
 for(const receipt of manifest.packages){const packageRoot=pathWithin(directory,receipt.path),pkg=readJson(path.join(packageRoot,'package.json'));if(packages.has(receipt.path)||!packageName(receipt.name)||pkg.name!==receipt.name||pkg.version!==receipt.version||!semver.valid(pkg.version)||!availableFor(pkg,platform,arch))throw Error('Invalid staged DSH package receipt');packages.set(receipt.path,{pkg,root:packageRoot});}
 for(const name of ROOTS){const pkg=packages.get('node_modules/'+name)?.pkg;if(!pkg||pkg.name!==name||pkg.version!==manifest.version)throw Error('Missing pinned official DSH root: '+name);}
 if(!recordedFiles.has(ENTRY))throw Error('Staged DSH CLI entry missing');
 const links=new Map(),skips=new Map();for(const link of manifest.resolutions){const key=link.from+'\0'+link.name;if(links.has(key)||!packages.has(link.from)||!packages.has(link.to))throw Error('Invalid DSH dependency resolution receipt');links.set(key,link);}for(const skip of manifest.skippedOptional){const key=skip.from+'\0'+skip.name;if(skips.has(key)||links.has(key)||!packages.has(skip.from)||!['missing','platform'].includes(skip.reason))throw Error('Invalid DSH optional dependency receipt');skips.set(key,skip);}
 const usedLinks=new Set(),usedSkips=new Set();
 for(const [from,{pkg,root}]of packages)for(const dependency of runtimeDependencies(pkg,profile)){
  const key=from+'\0'+dependency.name,link=links.get(key),skip=skips.get(key);
  if(!link){if(!dependency.optional||!skip||skip.range!==dependency.range||skip.kind!==dependency.kind)throw Error('Missing staged DSH dependency resolution: '+from+' -> '+dependency.name);if(findPackage(root,dependency.name,directory))throw Error('Skipped optional DSH dependency became visible: '+dependency.name);usedSkips.add(key);continue;}
  if(link.range!==dependency.range||link.kind!==dependency.kind||link.optional!==dependency.optional)throw Error('DSH dependency receipt differs from declaration');
  const resolved=findPackage(root,dependency.name,directory);if(!resolved||relative(directory,resolved.source)!==link.to)throw Error('Staged DSH dependency resolves to the wrong package: '+dependency.name);checkPackage(resolved.pkg,dependency.name,dependency.range);usedLinks.add(key);
 }
 if(usedLinks.size!==links.size||usedSkips.size!==skips.size)throw Error('Extraneous DSH dependency receipts');
 const reachable=new Set(),visit=name=>{if(reachable.has(name))return;reachable.add(name);for(const link of manifest.resolutions)if(link.from===name)visit(link.to);};for(const name of ROOTS)visit('node_modules/'+name);if(reachable.size!==packages.size)throw Error('Staged DSH runtime contains packages outside the required closure');
 return {version:manifest.version,profile,packages:packages.size,files:diskFiles.size,bytes,entry:pathWithin(directory,ENTRY)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const args=process.argv.slice(2);if(args.some(value=>value!=='--force')||args.length>1)throw Error('Usage: node scripts/stage-dsh-runtime.mjs [--force]');const manifest=stageDshRuntime({force:args.includes('--force')});console.log('Staged DSH '+manifest.version+' ('+manifest.packages.length+' packages, '+manifest.files.length+' files)');}
