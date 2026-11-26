// Build-time, offline staging only. Never consults DSH user profiles or starts a CLI.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire,isBuiltin} from 'node:module';
import {pathToFileURL} from 'node:url';
import {DSH_RUNTIME_LAYOUT} from '../contracts/agent/dsh-runtime-layout.mjs';

// Resolve transitive build tools through their declaring packages, including pnpm's isolated layout.
const require=createRequire(import.meta.url);
const electronBuilderRequire=createRequire(require.resolve('electron-builder/package.json'));
const semver=createRequire(electronBuilderRequire.resolve('app-builder-lib/package.json'))('semver');
const ROOTS=['@deepseek-ai/dsh','@deepseek-ai/dsh-sdk-minimal','@deepseek-ai/dsh-mcp-client','@deepseek-ai/dsh-llm-pi-ai'];
const {schemaVersion:STAGE_SCHEMA,studioProfile:STUDIO_PROFILE,cliEntry:ENTRY,bundledEntry:BUNDLED_ENTRY}=DSH_RUNTIME_LAYOUT;
const CORE_BUNDLE='bundles/core.mjs',BUNDLE_TARGET='node24';
// Dependencies used by the official CLI to boot the AIMatterLab profile.
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
const developmentDirectories=new Set(['.github','__tests__','test','tests','docs','examples','benchmark','benchmarks','coverage']);
const declaration=/\.d\.(?:ts|mts|cts)$/i,typescript=/\.(?:ts|mts|cts|tsx)$/i;
const notice=/^(?:licen[cs]es?|notices?|copying|copyright|patents|third[-_ ]party[-_ ]notices?)(?:$|[._ -])/i;
const relativeImport=(from,to)=>{const specifier=relative(path.dirname(from),to);return specifier.startsWith('.')?specifier:'./'+specifier;};

function nodeTargets(entry,loader){
 if(typeof entry==='string')return [entry];
 if(Array.isArray(entry))return entry.flatMap(value=>nodeTargets(value,loader));
 if(!entry||typeof entry!=='object')return [];
 const conditions=Object.entries(entry);
 if(conditions.every(([key])=>key.startsWith('.')))return conditions.flatMap(([,value])=>nodeTargets(value,loader));
 const selected=conditions.find(([key])=>['node','node-addons','module-sync','default',loader].includes(key));
 return selected?nodeTargets(selected[1],loader):[];
}

export function runtimePackageFilter(pkg,source,platform,arch){
 const rootNotice=fs.readdirSync(source).some(name=>notice.test(name));
 const targets=[pkg.main,...typeof pkg.bin==='string'?[pkg.bin]:Object.values(pkg.bin??{}),...nodeTargets(pkg.exports,'import'),...nodeTargets(pkg.exports,'require')].filter(value=>typeof value==='string');
 const needsTypeScript=targets.some(value=>typescript.test(value)&&!declaration.test(value));
 const targetIn=directory=>targets.some(value=>value.replace(/^\.\//,'').startsWith(directory+'/'));
 // In Node, the AWS/Smithy exports prefer their "node" distribution, and
 // yaml selects its Node entry before the fallback web distribution.
 const dropAwsEsm=/^@(aws-sdk|smithy)\//.test(pkg.name)&&!targetIn('dist-es');
 const dropYamlBrowser=pkg.name==='yaml'&&!targetIn('browser');
 return name=>{
  const parts=name.split('/'),base=parts.at(-1);
  if(/\.(?:map|pdb|tsbuildinfo)$/i.test(base)||declaration.test(base))return false;
  if(parts.some(part=>notice.test(part)))return true;
  if(parts.some(part=>developmentDirectories.has(part.toLowerCase())))return false;
  if(typescript.test(base)&&!needsTypeScript)return false;
  if(parts.length===1&&/^(?:changelog|history|contributing)(?:$|[._ -])/i.test(base))return false;
  if(parts.length===1&&rootNotice&&/^readme(?:$|[._ -])/i.test(base))return false;
  if(dropAwsEsm&&parts[0]==='dist-es'||dropYamlBrowser&&parts[0]==='browser')return false;
  const pty=pkg.name==='node-pty'||pkg.name.startsWith('@lydell/node-pty-');
  if(pty&&parts[0]==='prebuilds')return parts[1]===platform+'-'+arch;
  if(pty&&['src','scripts'].includes(parts[0]))return false;
  if(pkg.name==='sharp'&&['src','install'].includes(parts[0]))return false;
  return true;
 };
}

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
function noLinkedParents(root,target,message='Linked DSH staging target'){for(let parent=target;contained(root,parent);parent=path.dirname(parent))if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())throw Error(message);}
export function agentRuntimeOutput(root,stagingRoot=path.join(root,'.studio','agent-runtimes')){
 const target=path.resolve(root,stagingRoot);
 if(!contained(path.join(root,'.studio'),target)||path.basename(target)!=='agent-runtimes')throw Error('Unsafe runtime staging target');
 noLinkedParents(root,target,'Linked runtime staging target');
 return target;
}
function lockIdentity(root){const file=path.join(root,'pnpm-lock.yaml');if(!fs.existsSync(file))return null;const info=fs.lstatSync(file);if(info.isSymbolicLink()||!info.isFile()||info.size>32*1024*1024)throw Error('Invalid DSH source lockfile');return hash(fs.readFileSync(file));}

// Keep the pinned resolution of every dependency. Place the most widely shared
// source at the root so one SDK with a newer peer cannot multiply the other copy.
function collectSourceGraph(roots,sourceModules,profile,platform,arch,bound){
 const edgesBySource=new Map(),requests=new Map();
 function collect({source,pkg},depth=0){
  if(edgesBySource.has(source))return;
  if(depth>bound.maxDepth||edgesBySource.size>=bound.maxPackages)throw Error('DSH source dependency graph exceeds staging bound');
  const edges=[];
  edgesBySource.set(source,edges);
  for(const dependency of runtimeDependencies(pkg,profile)){
   const found=findPackage(source,dependency.name,sourceModules);
   if(found)checkPackage(found.pkg,dependency.name,dependency.range);
   const reason=!found?'missing':!availableFor(found.pkg,platform,arch)?'platform':null;
   if(reason){
    if(!dependency.optional)throw Error(reason==='missing'?'Missing required DSH dependency: '+pkg.name+' -> '+dependency.name:'Required DSH dependency does not support target platform: '+dependency.name);
    edges.push({dependency,reason});
    continue;
   }
   const candidates=requests.get(dependency.name)??new Map();
   candidates.set(found.source,(candidates.get(found.source)??0)+1);
   requests.set(dependency.name,candidates);
   edges.push({dependency,found});
   collect(found,depth+1);
  }
 }
 for(const root of roots)collect(root);
 const preferred=new Map();
 for(const [name,candidates] of requests){
  let highest=0;
  for(const [source,count] of candidates){
   if(count>highest){preferred.set(name,source);highest=count;}
  }
 }
 for(const root of roots)preferred.set(root.name,root.source);
 return {edgesBySource,preferred};
}

const coreEntries=[
 ['cordis','@deepseek-ai/cordis','lib/index.js'],
 ['schema','@deepseek-ai/schemastery','lib/index.mjs'],
 ['cosmokit','@deepseek-ai/cosmokit','lib/index.js'],
 ['commander','commander','index.js'],
];
const bundledZodVersions=new Set(['4.4.3','4.6.7']);
const zodOutput=(version,extension)=>'bundles/zod-'+version+'.'+extension;

function zodEntries(pkg,root,loader,extension){
 const entries=new Set();
 for(const [specifier,values] of Object.entries(pkg.exports)){
  for(const target of nodeTargets(values,loader)){
   if(target.endsWith(extension))entries.add(target.slice(2));
   if(specifier==='./v4/locales/*'&&target==='./v4/locales/*'){
    for(const name of fs.readdirSync(path.join(root,'v4/locales')).sort()){
     if(name.endsWith(extension))entries.add('v4/locales/'+name);
    }
   }
  }
 }
 // The opt-in compile entry installs global behavior when imported. Preserve
 // that file's lazy evaluation and link it to the same bundled internals.
 if(entries.delete('compile'+extension))entries.add('v4/core/compile'+extension);
 return [...entries].sort();
}

function validateBundleImports(directory,output,externals){
 for(const specifier of externals){
  if(isBuiltin(specifier))continue;
  const resolved=specifier.startsWith('.')?path.resolve(path.dirname(output),specifier):createRequire(output).resolve(specifier);
  if(!contained(directory,resolved)||!fs.lstatSync(resolved).isFile())throw Error('DSH bundle import escapes the staged runtime: '+specifier);
 }
}

function bundleStudioRuntime(directory,installed){
 const {buildSync,version}=require('esbuild');
 const bundleDirectory=path.join(directory,'bundles');
 fs.mkdirSync(bundleDirectory);
 const common={absWorkingDir:directory,platform:'node',target:BUNDLE_TARGET,format:'esm',bundle:true,write:false,metafile:true,keepNames:true,logLevel:'error'};
 const outputs=[];
 function writeBundle(name,result,acceptInput){
  const metadata=result.metafile.outputs[name],inputs=Object.keys(result.metafile.inputs).sort();
  if(inputs.some(input=>!acceptInput(pathWithin(directory,input))))throw Error('DSH bundle incorporated a dependency outside its audited build inputs: '+name);
  const externals=[...new Set(metadata.imports.map(value=>value.path))].sort();
  const output=pathWithin(directory,name);
  validateBundleImports(directory,output,externals);
  fs.writeFileSync(output,result.outputFiles[0].contents);
  outputs.push({path:name,inputs,externals});
  return {metadata,output,inputs};
 }
 function bundleEsmEntries(name,entries,acceptInput){
  const shapes=buildSync({...common,entryPoints:Object.fromEntries(entries.map(({id,input})=>[id,input])),outdir:path.join(bundleDirectory,'exports'),packages:'external'});
  const source=[],shims=new Map();
  const output=pathWithin(directory,name);
  for(const {id,input} of entries){
   const names=shapes.metafile.outputs['bundles/exports/'+id+'.js'].exports;
   if(!names.length||names.some(name=>!/^[A-Za-z_$][\w$]*$/.test(name)))throw Error('Unexpected DSH package exports: '+input);
   const bundleExports=names.map(name=>name+' as '+id+'_'+name).join(', ');
   const shimExports=names.map(name=>id+'_'+name+' as '+name).join(', ');
   source.push('export {'+bundleExports+'} from '+JSON.stringify('./'+relative(directory,input))+';');
   shims.set(input,entry=>'export {'+shimExports+'} from '+JSON.stringify(relativeImport(entry,output))+';\n');
  }
  const sourcefile=path.basename(name,'.mjs')+'-entry.mjs';
  const result=buildSync({...common,stdin:{contents:source.join('\n'),resolveDir:directory,sourcefile},outfile:output});
  return {...writeBundle(name,result,input=>input===path.join(directory,sourcefile)||acceptInput(input)),shims};
 }

 const cli=pathWithin(directory,ENTRY),out=pathWithin(directory,BUNDLED_ENTRY);
 // Other launcher modes and profile boot resolve their own location, assets,
 // and native loader. Keep those paths and the official SDK plugin entries.
 const siblings=fs.readdirSync(path.dirname(cli)).map(name=>path.join(path.dirname(cli),name)).filter(file=>file!==cli);
 const cliResult=buildSync({...common,entryPoints:[cli],outfile:out,packages:'external',external:siblings.map(file=>'./'+relative(directory,file))});
 const {metadata}=writeBundle(BUNDLED_ENTRY,cliResult,input=>input===cli);
 const cliImport=JSON.stringify(relativeImport(cli,out));
 const launch=metadata.exports.includes('runCli')?'import {runCli} from '+cliImport+';\nif (import.meta.main) await runCli();\n':'';
 fs.writeFileSync(cli,'#!/usr/bin/env node\n'+launch+'export * from '+cliImport+';\n');

 // These libraries share exports and state with the lazily loaded Cordis
 // plugins. Re-export the same bindings at their original package entrypoints.
 const entries=coreEntries.flatMap(([id,name,entry])=>{
  const root=path.join(directory,'node_modules',name),packageInfo=installed.get(root)?.pkg;
  const input=path.join(root,entry);
  return packageInfo?.type==='module'&&fs.existsSync(input)?[{id,root,input}]:[];
 });
 if(entries.length){
  const core=bundleEsmEntries(CORE_BUNDLE,entries,input=>entries.some(entry=>contained(entry.root,input)));
  const commander=entries.find(entry=>entry.id==='commander');
  if(commander){
   // Commander only exports its root. Its internal implementation is in the core bundle.
   for(const input of core.inputs){
    const file=pathWithin(directory,input);
    if(contained(path.join(commander.root,'lib'),file))fs.unlinkSync(file);
   }
  }
  for(const [entry,shim] of core.shims)fs.writeFileSync(entry,shim(entry));
 }

 // pnpm shares one source for each Zod version. Keep its original public
 // ESM/CJS subpath and locale resolution at every staged package location
 // while sharing the private implementation within each version.
 const zodPackages=new Map();
 for(const [root,{pkg,source}] of installed){
  if(pkg.name!=='zod'||!bundledZodVersions.has(pkg.version))continue;
  const entry=zodPackages.get(pkg.version)??{pkg,source,roots:[],shared:true};
  if(entry.source!==source)entry.shared=false;
  entry.roots.push(root);
  zodPackages.set(pkg.version,entry);
 }
 for(const [version,{pkg,roots,shared}] of zodPackages){
  if(!shared)continue;
  const root=roots[0],esmPaths=zodEntries(pkg,root,'import','.js'),cjsPaths=zodEntries(pkg,root,'require','.cjs');
  const esm=bundleEsmEntries(zodOutput(version,'mjs'),esmPaths.map((name,index)=>({id:'z'+index,input:path.join(root,name)})),input=>contained(root,input));
  const cjsName=zodOutput(version,'cjs'),cjsOutput=pathWithin(directory,cjsName);
  const sourcefile=path.basename(cjsName,'.cjs')+'-entry.cjs';
  const source=cjsPaths.map((name,index)=>'exports.z'+index+'=require('+JSON.stringify('./'+relative(directory,path.join(root,name)))+');').join('\n');
  const cjs=buildSync({...common,format:'cjs',stdin:{contents:source,resolveDir:directory,sourcefile},outfile:cjsOutput});
  writeBundle(cjsName,cjs,input=>input===path.join(directory,sourcefile)||contained(root,input));
  // Node discovers CommonJS named exports from the source text for an ESM
  // import of a .cjs locale subpath. Preserve these names in its stub.
  const cjsExports=cjsPaths.map(name=>{
   const source=fs.readFileSync(path.join(root,name),'utf8');
   const names=new Set(Array.from(source.matchAll(/\bexports\.([A-Za-z_$][\w$]*)\s*=(?!=)/g),match=>match[1]));
   return [...names].map(name=>'exports.'+name+'=void 0;\n').join('');
  });
  const publicPaths=new Set([...esmPaths,...cjsPaths,'compile.js','compile.cjs']);
  for(const copy of roots){
   for(const entry of fs.readdirSync(copy,{recursive:true,withFileTypes:true})){
    const file=path.join(entry.parentPath,entry.name),own=relative(copy,file);
    if(entry.isFile()&&/\.[cm]?js$/.test(entry.name)&&!publicPaths.has(own)&&!own.startsWith('node_modules/'))fs.unlinkSync(file);
   }
   for(const name of esmPaths){
    const shim=esm.shims.get(path.join(root,name)),entry=path.join(copy,name);
    fs.writeFileSync(entry,shim(entry));
   }
   for(const [index,name] of cjsPaths.entries()){
    const entry=path.join(copy,name),specifier=JSON.stringify(relativeImport(entry,cjsOutput));
    fs.writeFileSync(entry,cjsExports[index]+'module.exports=require('+specifier+').z'+index+';\n');
   }
  }
 }
 return {target:BUNDLE_TARGET,esbuildVersion:version,outputs};
}

function stagedFiles(directory,bound){
 const files=new Map();
 let bytes=0;
 function walk(current,depth=0){
  if(depth>bound.maxDepth*2)throw Error('Staged DSH file depth exceeds bound');
  for(const entry of fs.readdirSync(current,{withFileTypes:true})){
   const item=path.join(current,entry.name);
   if(entry.isSymbolicLink())throw Error('Linked file in staged DSH runtime');
   if(entry.isDirectory())walk(item,depth+1);
   else if(entry.isFile()){
    const name=relative(directory,item);
    if(name==='runtime.json')continue;
    if(/\.(?:map|pdb|tsbuildinfo)$/i.test(entry.name)||declaration.test(entry.name))throw Error('Excluded file in staged DSH runtime');
    const size=fs.statSync(item).size;
    bytes+=size;
    if(files.size>=bound.maxFiles||bytes>bound.maxBytes)throw Error('Staged DSH runtime exceeds file/byte bound');
    const data=fs.readFileSync(item);
    files.set(name,{size:data.length,sha256:hash(data)});
   }else throw Error('Unsupported staged DSH file type');
  }
 }
 walk(directory);
 return {files,bytes};
}

export function stageDshRuntime({root=process.cwd(),stagingRoot,platform=process.platform,arch=process.arch,force=false,profile=STUDIO_PROFILE,...options}={}){
 if(![STUDIO_PROFILE,'full'].includes(profile))throw Error('Invalid DSH runtime profile');
 if(typeof force!=='boolean')throw Error('Invalid DSH staging force option');
 root=fs.realpathSync(root);const app=readJson(path.join(root,'package.json'));
 if(!['aimatterlab','gpu-sampling-studio'].includes(app.name))throw Error('DSH runtime staging requires an AIMatterLab checkout');
 const version=app.devDependencies?.[ROOTS[0]];
 if(!semver.valid(version)||ROOTS.some(name=>app.devDependencies?.[name]!==version))throw Error('All official DSH roots must have the same exact version pin');
 const bound={...limits,...options};for(const key of Object.keys(limits))if(!Number.isSafeInteger(bound[key])||bound[key]<1)throw Error('Invalid DSH staging bound');
 const sourceModules=fs.realpathSync(path.join(root,'node_modules')),target=path.join(agentRuntimeOutput(root,stagingRoot),'dsh');
 if(!contained(root,sourceModules)||!contained(root,target))throw Error('Unsafe DSH runtime staging root');noLinkedParents(root,target);fs.mkdirSync(path.dirname(target),{recursive:true});
 const sourceLockSha256=lockIdentity(root),rootPins=Object.fromEntries(ROOTS.map(name=>[name,version])),rootPackages=ROOTS.map(name=>{const found=findPackage(root,name,sourceModules);if(!found)throw Error('Missing required DSH root: '+name);checkPackage(found.pkg,name,version);if(!availableFor(found.pkg,platform,arch))throw Error('Required DSH root does not support target platform');return {name,...found};});
 if(!force&&sourceLockSha256&&fs.existsSync(path.join(target,'runtime.json'))){
  let cached;try{cached=readJson(path.join(target,'runtime.json'));}catch{throw Error('Cached DSH runtime manifest is unreadable; rebuild with force after inspecting the staged runtime');}
  if(cached.schemaVersion===STAGE_SCHEMA&&cached.profile===profile&&cached.sourceLockSha256===sourceLockSha256&&JSON.stringify(cached.rootPins)===JSON.stringify(rootPins)&&cached.version===version&&cached.platform===platform&&cached.arch===arch){validateStagedDshRuntime(target,{expectedVersion:version,platform,arch,...bound});if(lockIdentity(root)!==sourceLockSha256||ROOTS.some(name=>readJson(path.join(root,'package.json')).devDependencies?.[name]!==version))throw Error('DSH source lock or root pins changed while verifying cache');return cached;}
 }
 const {edgesBySource,preferred}=collectSourceGraph(rootPackages,sourceModules,profile,platform,arch,bound);
 const staging=path.join(path.dirname(target),'dsh-staging-'+randomUUID()),modules=path.join(staging,'node_modules'),installed=new Map(),packages=[],resolutions=[],skippedOptional=[];
 let copiedBytes=0,copiedFiles=0;
 fs.mkdirSync(modules,{recursive:true});
 function copyOwn(source,destination,include,current=source,ancestry=new Set(),depth=0){
  if(depth>bound.maxDepth)throw Error('DSH package file depth exceeds staging bound');
  const actual=fs.realpathSync(current);if(actual!==source&&!contained(source,actual))throw Error('DSH package file link escapes its package');
  const info=fs.statSync(current);if(info.isDirectory()){
   if(ancestry.has(actual))throw Error('Cyclic DSH package file link');const next=new Set(ancestry);next.add(actual);
   for(const name of fs.readdirSync(current).sort()){if(name==='node_modules')continue;copyOwn(source,path.join(destination,name),include,path.join(current,name),next,depth+1);}
  }else if(info.isFile()){
   if(!include(relative(source,current)))return;
   copiedBytes+=info.size;
   if(++copiedFiles>bound.maxFiles||copiedBytes>bound.maxBytes)throw Error('DSH runtime exceeds staging file/byte bound');
   fs.mkdirSync(path.dirname(destination),{recursive:true});
   fs.copyFileSync(current,destination);
  }else throw Error('Unsupported DSH package file type');
 }
 function register(source,pkg,destination){
  if(installed.size>=bound.maxPackages)throw Error('DSH package closure exceeds staging bound');
  installed.set(destination,{source,pkg});copyOwn(source,destination,runtimePackageFilter(pkg,source,platform,arch));packages.push({path:relative(staging,destination),name:pkg.name,version:pkg.version});
 }
 const pending=[];
 try{
  for(const found of rootPackages){const destination=path.join(modules,found.name);register(found.source,found.pkg,destination);pending.push({source:found.source,pkg:found.pkg,destination,ancestors:[]});}
  function stageDependencies(item,depth=0){
   if(depth>bound.maxDepth)throw Error('DSH dependency depth exceeds staging bound');
   const {source,destination,ancestors}=item;
   for(const {dependency,found,reason} of edgesBySource.get(source)){
    const from=relative(staging,destination);
    if(reason){skippedOptional.push({from,name:dependency.name,range:dependency.range,kind:dependency.kind,reason});continue;}
    const visible=findPackage(destination,dependency.name,staging);let child=visible?.source;
    if(!child||installed.get(child)?.source!==found.source){
     const hoisted=path.join(modules,dependency.name);
     child=!visible&&!installed.has(hoisted)&&preferred.get(dependency.name)===found.source?hoisted:path.join(destination,'node_modules',dependency.name);
     if(installed.has(child))throw Error('Conflicting DSH package placement: '+dependency.name);
     if(ancestors.includes(found.source)||source===found.source)throw Error('DSH dependency cycle cannot be represented without links: '+dependency.name);
     register(found.source,found.pkg,child);stageDependencies({source:found.source,pkg:found.pkg,destination:child,ancestors:[...ancestors,source]},depth+1);
    }
    resolutions.push({from,...dependency,to:relative(staging,child)});
   }
  }
  for(const item of pending)stageDependencies(item);
  const bundle=profile===STUDIO_PROFILE?bundleStudioRuntime(staging,installed):undefined;
  const files=Array.from(stagedFiles(staging,bound).files,([name,receipt])=>({path:name,...receipt}));
  const manifest={schemaVersion:STAGE_SCHEMA,profile,version,entry:bundle?BUNDLED_ENTRY:ENTRY,platform,arch,sourceLockSha256,rootPins,...bundle?{bundle}:{},packages:packages.sort((a,b)=>a.path.localeCompare(b.path)),resolutions:resolutions.sort((a,b)=>(a.from+'/'+a.name).localeCompare(b.from+'/'+b.name)),skippedOptional:skippedOptional.sort((a,b)=>(a.from+'/'+a.name).localeCompare(b.from+'/'+b.name)),files:files.sort((a,b)=>a.path.localeCompare(b.path))};
  fs.writeFileSync(path.join(staging,'runtime.json'),JSON.stringify(manifest,null,2));validateStagedDshRuntime(staging,{expectedVersion:version,platform,arch,...bound});
  if(lockIdentity(root)!==sourceLockSha256||ROOTS.some(name=>readJson(path.join(root,'package.json')).devDependencies?.[name]!==version))throw Error('DSH source lock or root pins changed during staging');
  noLinkedParents(root,target);const backup=path.join(path.dirname(target),'dsh-backup-'+randomUUID());let moved=false;
  if(fs.existsSync(target)){fs.renameSync(target,backup);moved=true;}
  try{fs.renameSync(staging,target);}catch(error){if(moved)fs.renameSync(backup,target);throw error;}
  if(moved&&contained(path.dirname(target),backup)&&path.basename(backup).startsWith('dsh-backup-'))fs.rmSync(backup,{recursive:true,force:true});return manifest;
 }catch(error){if(contained(path.dirname(target),staging)&&path.basename(staging).startsWith('dsh-staging-'))fs.rmSync(staging,{recursive:true,force:true});throw error;}
}

export function validateStagedDshRuntime(directory,{expectedVersion,expectedEsbuildVersion,requireBundle=false,platform=process.platform,arch=process.arch,...options}={}){
 directory=path.resolve(directory);const bound={...limits,...options};
 for(const key of Object.keys(limits))if(!Number.isSafeInteger(bound[key])||bound[key]<1)throw Error('Invalid DSH staging bound');
 if(fs.lstatSync(directory).isSymbolicLink())throw Error('Linked staged DSH runtime');
 const manifestFile=path.join(directory,'runtime.json');if(fs.lstatSync(manifestFile).isSymbolicLink()||!fs.statSync(manifestFile).isFile()||fs.statSync(manifestFile).size>64*1024*1024)throw Error('Invalid staged DSH manifest');
 const manifest=readJson(manifestFile);
 const profile=manifest.profile;
 if(![STUDIO_PROFILE,'full'].includes(profile)||requireBundle&&profile!==STUDIO_PROFILE)throw Error('Invalid staged DSH profile');
 const bundled=profile===STUDIO_PROFILE,entry=bundled?BUNDLED_ENTRY:ENTRY;
 if(manifest.sourceLockSha256!==undefined&&manifest.sourceLockSha256!==null&&!/^[a-f0-9]{64}$/.test(manifest.sourceLockSha256)||manifest.rootPins!==undefined&&(!manifest.rootPins||typeof manifest.rootPins!=='object'||Array.isArray(manifest.rootPins)||Object.keys(manifest.rootPins).length!==ROOTS.length||ROOTS.some(name=>manifest.rootPins[name]!==manifest.version)))throw Error('Invalid staged DSH source identity');
 if(manifest.schemaVersion!==STAGE_SCHEMA||!semver.valid(manifest.version)||expectedVersion!==undefined&&manifest.version!==expectedVersion||manifest.entry!==entry||manifest.platform!==platform||manifest.arch!==arch||!Array.isArray(manifest.packages)||!manifest.packages.length||manifest.packages.length>bound.maxPackages||!Array.isArray(manifest.files)||manifest.files.length>bound.maxFiles||!Array.isArray(manifest.resolutions)||!Array.isArray(manifest.skippedOptional))throw Error('Invalid staged DSH runtime manifest');
 const {files:diskFiles,bytes}=stagedFiles(directory,bound);
 const recordedFiles=new Set();for(const receipt of manifest.files){pathWithin(directory,receipt.path);if(recordedFiles.has(receipt.path))throw Error('Duplicate staged DSH file receipt');recordedFiles.add(receipt.path);const actual=diskFiles.get(receipt.path);if(!actual||actual.size!==receipt.size||actual.sha256!==receipt.sha256)throw Error('Staged DSH file differs from integrity receipt: '+receipt.path);}
 if(recordedFiles.size!==diskFiles.size)throw Error('Unrecorded files in staged DSH runtime');
 const packages=new Map();
 for(const receipt of manifest.packages){const packageRoot=pathWithin(directory,receipt.path),pkg=readJson(path.join(packageRoot,'package.json'));if(packages.has(receipt.path)||!packageName(receipt.name)||pkg.name!==receipt.name||pkg.version!==receipt.version||!semver.valid(pkg.version)||!availableFor(pkg,platform,arch))throw Error('Invalid staged DSH package receipt');packages.set(receipt.path,{pkg,root:packageRoot});}
 for(const name of ROOTS){const pkg=packages.get('node_modules/'+name)?.pkg;if(!pkg||pkg.name!==name||pkg.version!==manifest.version)throw Error('Missing pinned official DSH root: '+name);}
 if(!recordedFiles.has(entry)||!recordedFiles.has(ENTRY))throw Error('Staged DSH CLI entry missing');
 if(bundled){
  const bundle=manifest.bundle,hasCore=coreEntries.some(([,name,input])=>packages.get('node_modules/'+name)?.pkg.type==='module'&&recordedFiles.has('node_modules/'+name+'/'+input));
  const expected=new Set(hasCore?[BUNDLED_ENTRY,CORE_BUNDLE]:[BUNDLED_ENTRY]);
  for(const {pkg} of packages.values()){
   if(pkg.name!=='zod'||!bundledZodVersions.has(pkg.version))continue;
   for(const extension of ['mjs','cjs']){
    const name=zodOutput(pkg.version,extension);
    if(recordedFiles.has(name))expected.add(name);
   }
   if(expected.has(zodOutput(pkg.version,'mjs'))!==expected.has(zodOutput(pkg.version,'cjs')))throw Error('Incomplete staged Zod bundle: '+pkg.version);
  }
  if(requireBundle&&!hasCore||bundle?.target!==BUNDLE_TARGET||!semver.valid(bundle.esbuildVersion)||expectedEsbuildVersion!==undefined&&bundle.esbuildVersion!==expectedEsbuildVersion||!Array.isArray(bundle.outputs)||bundle.outputs.length!==expected.size)throw Error('Invalid staged DSH bundle manifest');
  for(const output of bundle.outputs){
   if(!expected.delete(output?.path)||!recordedFiles.has(output.path)||!Array.isArray(output.inputs)||!output.inputs.length||!Array.isArray(output.externals)||output.externals.some(value=>typeof value!=='string'||!value))throw Error('Invalid staged DSH bundle receipt');
   for(const input of output.inputs)pathWithin(directory,input);
   validateBundleImports(directory,pathWithin(directory,output.path),output.externals);
  }
 }else if(manifest.bundle)throw Error('Unexpected bundle in full DSH runtime');
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
 return {version:manifest.version,profile,packages:packages.size,files:diskFiles.size,bytes,entry:pathWithin(directory,entry),bundles:manifest.bundle?.outputs.map(output=>output.path)??[]};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const args=process.argv.slice(2);if(args.some(value=>value!=='--force')||args.length>1)throw Error('Usage: node scripts/stage-dsh-runtime.mjs [--force]');const manifest=stageDshRuntime({force:args.includes('--force')});console.log('Staged DSH '+manifest.version+' ('+manifest.packages.length+' packages, '+manifest.files.length+' files)');}
