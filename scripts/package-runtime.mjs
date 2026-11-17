import fs from 'node:fs';
import path from 'node:path';
import {createRequire,isBuiltin} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {validateCliRuntimeLock} from '../backend/main/compute/cli-runtime.mjs';
import {validateStagedDshRuntime} from './stage-dsh-runtime.mjs';

const buildRequire=createRequire(import.meta.url);
// app-builder-lib belongs to electron-builder, not the application root.
const electronBuilderRequire=createRequire(buildRequire.resolve('electron-builder/package.json'));
const builderRequire=createRequire(electronBuilderRequire.resolve('app-builder-lib/package.json'));
const semver=builderRequire('semver');
const RUNTIME_ENTRIES=new Map([
 ['@lydell/node-pty','index.js'],
]);
const relative=(root,file)=>path.relative(root,file).split(path.sep).join('/');
function contained(root,file){const rel=path.relative(root,file);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);}
function file(root,name){
 const target=path.resolve(root,name);
 if(!contained(root,target)||!fs.existsSync(target)||!fs.statSync(target).isFile()||fs.statSync(target).size===0||!contained(fs.realpathSync(root),fs.realpathSync(target)))throw Error('Package runtime file missing or outside its root: '+name);
 return target;
}
function json(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function walk(root){
 const result=[];
 for(const entry of fs.readdirSync(root,{withFileTypes:true})){
  if(['builtin-skills','node_modules','__pycache__'].includes(entry.name))continue;
  const item=path.join(root,entry.name);
  if(entry.isSymbolicLink())throw Error('Linked application module input cannot be audited: '+item);
  if(entry.isDirectory())result.push(...walk(item));
  else if(entry.isFile())result.push(item);
 }
 return result;
}

/** Audit only application modules; build tooling and independently staged CLI modules have different roots. */
export function validateApplicationImports(appDir){
 let sourceFiles=0;
 const sources=['desktop','backend/main','agent','contracts'].flatMap(directory=>walk(path.join(appDir,directory)));
 sources.push(...['scripts/localize-skill.mjs','scripts/cluster-reconcile.mjs'].map(name=>file(appDir,name)));
  for(const source of sources.filter(p=>/\.[cm]?js$/.test(p))){
   const name=relative(appDir,source),text=fs.readFileSync(source,'utf8');
   const tree=ts.createSourceFile(source,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
   if(tree.parseDiagnostics.length)throw Error('Cannot audit package module: '+name);
   const requireCreators=new Set(['createRequire']),requires=new Set(['require']),moduleNamespaces=new Set(),declarations=new Map();
   for(const statement of tree.statements)if(ts.isImportDeclaration(statement)&&['node:module','module'].includes(statement.moduleSpecifier.text)){
    if(statement.importClause?.name)moduleNamespaces.add(statement.importClause.name.text);
    const bindings=statement.importClause?.namedBindings;if(bindings&&ts.isNamespaceImport(bindings))moduleNamespaces.add(bindings.name.text);
    if(bindings&&ts.isNamedImports(bindings))for(const binding of bindings.elements)if((binding.propertyName?.text??binding.name.text)==='createRequire')requireCreators.add(binding.name.text);
   }
   const member=(expression,name)=>ts.isPropertyAccessExpression(expression)&&expression.name.text===name||ts.isElementAccessExpression(expression)&&ts.isStringLiteralLike(expression.argumentExpression)&&expression.argumentExpression.text===name;
   const creator=expression=>ts.isIdentifier(expression)&&requireCreators.has(expression.text)||member(expression,'createRequire')&&ts.isIdentifier(expression.expression)&&moduleNamespaces.has(expression.expression.text);
   const loader=expression=>ts.isIdentifier(expression)&&requires.has(expression.text)||ts.isCallExpression(expression)&&creator(expression.expression);
   function findAliases(node){
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer){declarations.set(node.name.text,declarations.has(node.name.text)?null:node.initializer);if(creator(node.initializer))requireCreators.add(node.name.text);else if(loader(node.initializer))requires.add(node.name.text);}
    ts.forEachChild(node,findAliases);
   }
   findAliases(tree);
   function stagedTerminalResolution(source,args){
    // This main-only module locates files to copy from the independently staged
    // PTY resource root; it never imports that package into app.asar. Prove the
    // exact resolver chain instead of granting a general bare-import exception.
    if(name!=='backend/main/compute/terminal-runtime.mjs'||args.length!==1)return false;
    const value=ts.isIdentifier(source)?declarations.get(source.text):source;
    if(!value||!ts.isCallExpression(value)||!creator(value.expression)||value.arguments.length!==1)return false;
    const base=value.arguments[0],specifier=args[0];
    if(ts.isCallExpression(base)&&member(base.expression,'join')&&ts.isIdentifier(base.expression.expression)&&base.expression.expression.text==='path'&&base.arguments.length===2&&ts.isIdentifier(base.arguments[0])&&base.arguments[0].text==='dependencyRoot'&&ts.isStringLiteralLike(base.arguments[1])&&base.arguments[1].text==='runtime.cjs')return ts.isStringLiteralLike(specifier)&&specifier.text==='@lydell/node-pty';
    if(!ts.isIdentifier(base)||base.text!=='wrapperEntry'||!ts.isIdentifier(specifier)||specifier.text!=='nativeName')return false;
    const wrapper=declarations.get('wrapperEntry'),native=declarations.get('nativeName');
    if(!wrapper||!native||!ts.isCallExpression(wrapper)||!member(wrapper.expression,'resolve')||!stagedTerminalResolution(wrapper.expression.expression,wrapper.arguments))return false;
    return ts.isBinaryExpression(native)&&native.operatorToken.kind===ts.SyntaxKind.PlusToken&&ts.isIdentifier(native.right)&&native.right.text==='arch'&&ts.isBinaryExpression(native.left)&&native.left.operatorToken.kind===ts.SyntaxKind.PlusToken&&ts.isStringLiteralLike(native.left.right)&&native.left.right.text==='-'&&ts.isBinaryExpression(native.left.left)&&native.left.left.operatorToken.kind===ts.SyntaxKind.PlusToken&&ts.isStringLiteralLike(native.left.left.left)&&native.left.left.left.text==='@lydell/node-pty-'&&ts.isIdentifier(native.left.left.right)&&native.left.left.right.text==='platform';
   }
   function check(specifier,externalPty=false){
    if(specifier.startsWith('.')||specifier.startsWith('file:')||isBuiltin(specifier)||specifier==='electron')return;
    if(externalPty&&specifier==='@lydell/node-pty'&&name==='desktop/platform/terminal-service/broker.mjs')return;
    throw Error('Application package requires unstaged bare module '+specifier+' in '+name);
   }
   function checkDynamic(node){
    if(ts.isStringLiteralLike(node)){check(node.text);return;}
    if(ts.isConditionalExpression(node)){checkDynamic(node.whenTrue);checkDynamic(node.whenFalse);return;}
    // Existing private-skill validator is loaded from the separately packaged studio-tools directory.
    if(name==='agent/sessions/requests.mjs'&&node.getText(tree)==='pathToFileURL(validator).href')return;
    // The isolated official DSH child loads these two positive-listed module
    // URLs from the separately staged, integrity-audited DSH dependency tree.
    if(name==='agent/providers/dsh-policy.mjs'&&['config.mcpModule','config.toolsModule'].includes(node.getText(tree)))return;
    // The account adapter loads only the main-owned, pinned DSH module from that same audited tree.
    if(name==='agent/providers/dsh-account-adapter.mjs'&&node.getText(tree)==='pathToFileURL(config.module).href')return;
    throw Error('Cannot audit dynamic package import in '+name);
   }
   function inspect(node){
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier)check(node.moduleSpecifier.text);
    if(ts.isCallExpression(node)){
     if(node.expression.kind===ts.SyntaxKind.ImportKeyword){if(node.arguments.length!==1)throw Error('Cannot audit dynamic package import in '+name);checkDynamic(node.arguments[0]);}
     const direct=loader(node.expression);
     const resolver=member(node.expression,'resolve')&&loader(node.expression.expression);
     if(direct||resolver){
      if(resolver&&stagedTerminalResolution(node.expression.expression,node.arguments)){ts.forEachChild(node,inspect);return;}
      if(resolver&&name==='desktop/platform/dsh-runtime.mjs'&&node.expression.expression.getText(tree)==='createRequire(fs.realpathSync(mcpModule))'&&node.arguments.length===1&&ts.isStringLiteralLike(node.arguments[0])&&node.arguments[0].text==='@deepseek-ai/dsh-tools'){ts.forEachChild(node,inspect);return;}
      if(node.arguments.length!==1||!ts.isStringLiteralLike(node.arguments[0]))throw Error('Cannot audit package require in '+name);
      const source=direct?node.expression:node.expression.expression;
      check(node.arguments[0].text,!(ts.isIdentifier(source)&&source.text==='require'));
     }
    }
    ts.forEachChild(node,inspect);
   }
   inspect(tree);sourceFiles++;
  }
 return sourceFiles;
}

function resolveStagedManifest(name,from,modules){
 const require=createRequire(from);
 let manifest;
 try{manifest=require.resolve(name+'/package.json');}
 catch{
  let directory=path.dirname(require.resolve(name));
  while(true){
   const candidate=path.join(directory,'package.json');
   if(fs.existsSync(candidate)&&json(candidate).name===name){manifest=candidate;break;}
   const parent=path.dirname(directory);if(parent===directory)throw Error('Missing staged dependency: '+name);directory=parent;
  }
 }
 if(!contained(fs.realpathSync(modules),fs.realpathSync(manifest)))throw Error('Dependency resolves outside staged runtime: '+name);
 return manifest;
}

function validateDeclaredEntries(pkg,root){
 const entries=[];
 if(typeof pkg.main==='string')entries.push(pkg.main);
 if(typeof pkg.module==='string')entries.push(pkg.module);
 function exported(value){
  if(typeof value==='string'){if(!value.includes('*'))entries.push(value);}
  else if(value&&typeof value==='object')for(const child of Object.values(value))exported(child);
 }
 exported(pkg.exports);
 for(const entry of entries){
  let resolved;
  try{resolved=buildRequire.resolve(path.resolve(root,entry));}
  catch{throw Error('Staged package entry missing: '+pkg.name+' -> '+entry);}
  file(root,path.relative(root,resolved));
 }
}

export function validatePackageRuntime({appDir,platform,arch}={}){
 if(!appDir||!path.isAbsolute(appDir))throw Error('Package appDir must be absolute');
 platform=platform?.nodeName??platform??process.platform;arch=arch??process.arch;
 if(!['win32','linux','darwin'].includes(platform)||!['x64','arm64'].includes(arch))throw Error('Unsupported staged runtime target');
 const app=json(file(appDir,'package.json')),release=validateReleaseMetadata(appDir,app),dist=path.join(appDir,'dist'),index=fs.readFileSync(file(dist,'index.html'),'utf8');
 const electronVersion=fs.readFileSync(file(appDir,'node_modules/electron/dist/version'),'utf8').trim();
 if(!semver.valid(electronVersion)||electronVersion!==app.devDependencies?.electron)throw Error('Installed Electron distribution version does not match the pinned package version');
 let distAssets=0;
 for(const match of index.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)){
  const value=match[1];if(value.startsWith('#')||value.startsWith('data:'))continue;
  if(/^[a-z][a-z\d+.-]*:|^\/\//i.test(value))throw Error('Renderer package uses an external asset: '+value);
  file(dist,value.split(/[?#]/)[0]);distAssets++;
 }
 if(!distAssets)throw Error('Renderer build has no packaged assets');
 file(dist,'cli-installer/archive.mjs');
 const cliLock=validateCliRuntimeLock(json(file(appDir,'contracts/agent/cli-runtime-lock.json')));
 for(const [provider,record]of Object.entries(cliLock.providers))if(app.devDependencies?.[record.package]!==record.version)throw Error('Pinned downloadable CLI version mismatch: '+provider);
 const runtime=path.join(appDir,'.studio','agent-runtimes'),modules=path.join(runtime,'node_modules'),manifest=json(file(runtime,'manifest.json'));
 if(!manifest.packages||typeof manifest.packages!=='object'||Array.isArray(manifest.packages)||Object.keys(manifest.packages).length===0)throw Error('Invalid staged runtime manifest');
 const packages=new Map();
 for(const [name,version] of Object.entries(manifest.packages)){
  if(!/^(?:@[a-z\d._-]+\/)?[a-z\d._-]+$/i.test(name)||typeof version!=='string')throw Error('Invalid staged package identity');
  const source=file(modules,path.join(name,'package.json')),pkg=json(source);
  if(pkg.name!==name||pkg.version!==version)throw Error('Staged package identity mismatch: '+name);
  validateDeclaredEntries(pkg,path.dirname(source));
  packages.set(name,{pkg,source});
 }
 for(const [name,entry] of RUNTIME_ENTRIES){
  const record=packages.get(name),declared=app.devDependencies?.[name]??app.dependencies?.[name];
  if(!record||!declared||!semver.satisfies(record.pkg.version,declared))throw Error('Required staged runtime missing or version mismatch: '+name);
  file(path.dirname(record.source),entry);
 }
 for(const name of ['@moonshot-ai/kimi-code','@qwen-code/qwen-code'])if(packages.has(name)||fs.existsSync(path.join(modules,name)))throw Error('Provider CLI must not be bundled in the base portable package: '+name);
 const native='@lydell/node-pty-'+platform+'-'+arch,nativeRecord=packages.get(native),pty=packages.get('@lydell/node-pty').pkg;
 if(!nativeRecord||nativeRecord.pkg.version!==pty.version||!nativeRecord.pkg.os?.includes(platform)||!nativeRecord.pkg.cpu?.includes(arch))throw Error('Staged PTY platform package missing or incompatible: '+native);
 const nativeRoot=path.dirname(nativeRecord.source);file(nativeRoot,'lib/index.js');
 const prebuild=path.join('prebuilds',platform+'-'+arch);
 if(platform==='win32'){
  for(const name of ['conpty.node','conpty_console_list.node','conpty/conpty.dll','conpty/OpenConsole.exe'])file(nativeRoot,path.join(prebuild,name));
  for(const name of ['lib/windowsTerminal.js','lib/windowsPtyAgent.js','lib/windowsConoutConnection.js','lib/worker/conoutSocketWorker.js','lib/conpty_console_list_agent.js'])file(nativeRoot,name);
 }
 else file(nativeRoot,path.join(prebuild,'pty.node'));
 let dependencyEdges=0,omittedOptional=0;
 for(const [name,{pkg,source}]of packages){
  for(const [dependency,range]of Object.entries(pkg.dependencies??{})){
   const target=packages.get(dependency);
   if(!target||!semver.satisfies(target.pkg.version,range))throw Error('Required staged dependency missing or version mismatch: '+name+' -> '+dependency);
   if(fs.realpathSync(resolveStagedManifest(dependency,source,modules))!==fs.realpathSync(target.source))throw Error('Staged dependency identity differs from manifest: '+dependency);
   dependencyEdges++;
  }
  for(const [dependency,range]of Object.entries(pkg.optionalDependencies??{})){
   if(!packages.has(dependency)){omittedOptional++;continue;}
   const target=packages.get(dependency);
   if(!semver.satisfies(target.pkg.version,range))throw Error('Optional staged dependency version mismatch: '+dependency);
   if(fs.realpathSync(resolveStagedManifest(dependency,source,modules))!==fs.realpathSync(target.source))throw Error('Optional staged dependency identity mismatch: '+dependency);
  }
 }
 const sourceFiles=validateApplicationImports(appDir);
 const dshVersion=app.devDependencies?.['@deepseek-ai/dsh'];let dsh;
 if(dshVersion){
  if(['@deepseek-ai/dsh-sdk-minimal','@deepseek-ai/dsh-mcp-client'].some(name=>app.devDependencies?.[name]!==dshVersion))throw Error('Official DSH runtime versions disagree');
  dsh=validateStagedDshRuntime(path.join(appDir,'.studio','agent-runtimes','dsh'),{expectedVersion:dshVersion,platform,arch});
  file(appDir,'agent/providers/dsh-policy.mjs');
 }
 return {...release,electronVersion,platform,arch,runtimePackages:packages.size,dependencyEdges,omittedOptional,distAssets,sourceFiles,nativePackage:native,...dsh?{dsh}: {}};
}

/** Release labels must agree before validation can describe one concrete package. */
export function validateReleaseMetadata(appDir,app=json(file(appDir,'package.json'))){
 const manifest=json(file(appDir,'installation/manifest.json'));
 if(typeof app.version!=='string'||!semver.valid(app.version)||manifest.version!==app.version||manifest.release_revision!=='v'+app.version)throw Error('Package and installation release versions disagree');
 return {packageVersion:app.version,releaseRevision:manifest.release_revision};
}

/** Read-only entry point; never stages, builds, installs, or loads native binaries. */
export function packageRuntimeCLI(args,{cwd=process.cwd()}={}){
 if(args[0]!=='--validate')throw Error('Usage: node scripts/package-runtime.mjs --validate [--app-dir PATH] [--platform win32|linux|darwin] [--arch x64|arm64]');
 const options={appDir:path.resolve(cwd)},seen=new Set();
 for(let i=1;i<args.length;i+=2){const key={'--app-dir':'appDir','--platform':'platform','--arch':'arch'}[args[i]],value=args[i+1];if(!key||seen.has(key)||!value||value.startsWith('--'))throw Error('Invalid package runtime validation option: '+args[i]);seen.add(key);options[key]=key==='appDir'?path.resolve(cwd,value):value;}
 return validatePackageRuntime(options);
}

/** Public electron-builder hook: staged runtimes are validated before declaring node_modules externally handled. */
export default function beforeBuild(context){
 const result=validatePackageRuntime(context);
 console.log('Validated externally staged package runtimes: '+JSON.stringify(result));
 return false;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{console.log(JSON.stringify(packageRuntimeCLI(process.argv.slice(2)),null,2));}catch(error){console.error('Package runtime validation failed: '+error.message);process.exitCode=1;}
}
