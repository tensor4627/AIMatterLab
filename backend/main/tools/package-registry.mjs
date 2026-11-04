/** Explicit definition registration. It never installs, executes tests, fetches or changes source repositories. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {validateToolPackage,toolPackageResources,toolGuidanceResources,packageIdentityText} from '../../../contracts/tools/tool-package.mjs';

const PACKAGE='tool-package',VERSION='tool-package-version',SCHEMA=1,MAX_FILES=100000;
const gitPlatformOptions=process.platform==='win32'?['-c','core.longpaths=true']:[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>structuredClone(value);
const fail=message=>{throw Error('tool_package_'+message);};
const inside=(root,value)=>{const relative=path.relative(root,value);return !relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const compare=(a,b)=>Buffer.compare(Buffer.from(a.path,'utf8'),Buffer.from(b.path,'utf8'));
function exact(value,allowed,required=[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))fail('invalid_request');}
function portable(value){
 if(typeof value!=='string'||!value||value.length>512||/[\\<>:"|?*\x00-\x1f\x7f]/.test(value)||value.startsWith('/')||value.split('/').some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))fail('nonportable_path');
 return value;
}
function noLinkedParents(target){for(let current=path.resolve(target);;current=path.dirname(current)){try{if(fs.lstatSync(current).isSymbolicLink())fail('linked_store');}catch(error){if(error.code!=='ENOENT')throw error;}if(path.dirname(current)===current)break;}}
function fileHash(file){
 const fd=fs.openSync(file,'r'),digest=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let size=0;
 try{const before=fs.fstatSync(fd);if(!before.isFile())fail('resource_not_regular');for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;digest.update(buffer.subarray(0,count));size+=count;}const after=fs.fstatSync(fd),current=fs.statSync(file);if(before.size!==size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==current.ino||before.size!==current.size||before.mtimeMs!==current.mtimeMs)fail('source_changed');return {size,sha256:digest.digest('hex')};}finally{fs.closeSync(fd);}
}
function deliverySkill(file){
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size<1||stat.size>256*1024)fail('delivery_skill_size');const bytes=fs.readFileSync(file),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),front=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
 if(!front||!text.slice(front[0].length).trim())fail('delivery_skill_frontmatter');const lines=front[1].split(/\r?\n/);
 function field(name){const found=lines.map((line,index)=>({match:new RegExp('^'+name+':[ \\t]*(.*)$').exec(line),index})).filter(item=>item.match);if(found.length!==1)fail('delivery_skill_'+name);const {match,index}=found[0],value=match[1].trim();
  if(/^[|>][+-]?$/.test(value)){if(name==='name')fail('delivery_skill_name');const block=[];for(let i=index+1;i<lines.length;i++){if(lines[i]&&!/^[ \t]/.test(lines[i]))break;block.push(lines[i]);}const populated=block.filter(line=>line.trim());if(!populated.length)fail('delivery_skill_'+name);const indent=Math.min(...populated.map(line=>line.match(/^[ \t]*/)[0].length)),parts=block.map(line=>line.slice(indent));return (value[0]==='>'?parts.join(' ').replace(/ +/g,' '):parts.join('\n')).trim();}
  if(name==='name'&&value.includes('\\'))fail('delivery_skill_name');
  if(value.startsWith('"')){try{return JSON.parse(value);}catch{fail('delivery_skill_'+name);}}
  if(value.startsWith("'")){if(!value.endsWith("'"))fail('delivery_skill_'+name);return value.slice(1,-1).replaceAll("''","'");}
  if(!value||/^[!&*[{]/.test(value))fail('delivery_skill_'+name);return value.replace(/\s+#.*$/,'').trim();
 }
 const name=field('name'),description=field('description');if(typeof name!=='string'||name.length>64||! /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)||typeof description!=='string'||!description.trim()||description.length>4096)fail('delivery_skill_metadata');
 return {name,description,path:'SKILL.md',sha256:hash(bytes)};
}
function gitEnvironment(){
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')&&key!=='NODE_OPTIONS'));
 return {...env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_ATTR_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_NO_LAZY_FETCH:'1',GIT_PROTOCOL_FROM_USER:'0'};
}
function git(repo,args,extra=[]){
 const options=[...gitPlatformOptions,'--no-optional-locks','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','core.hooksPath='+(process.platform==='win32'?'NUL':'/dev/null'),'-c','core.attributesFile='+(process.platform==='win32'?'NUL':'/dev/null'),...extra,'-C',repo,...args];
 try{return execFileSync('git',options,{env:gitEnvironment(),stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:30000,maxBuffer:32*1024*1024});}catch{fail('git_check_failed');}
}
function disabledFilters(repo){
 let output;try{output=execFileSync('git',[...gitPlatformOptions,'--no-optional-locks','-C',repo,'config','--null','--name-only','--get-regexp','^filter\\.'],{env:gitEnvironment(),stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:10000,maxBuffer:1024*1024});}catch(error){if(error.status===1)return [];fail('git_configuration_unavailable');}
 const names=new Set(output.toString('utf8').split('\0').filter(Boolean).map(key=>key.replace(/\.(?:clean|smudge|process|required)$/i,'')));
 return [...names].flatMap(name=>['clean','smudge','process','required'].flatMap(field=>['-c',name+'.'+field+'='+(field==='required'?'false':'')]));
}
function rejectPartialClone(repo){
 try{const found=execFileSync('git',[...gitPlatformOptions,'--no-optional-locks','-C',repo,'config','--get-regexp','^(extensions\\.partialclone|remote\\..*\\.promisor)$'],{env:gitEnvironment(),stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:10000,maxBuffer:1024*1024});if(found.length)fail('external_or_partial_git_storage');}catch(error){if(error.status!==1)throw error;}
}
function repository(root,relative,expected){
 const repo=path.join(root,...relative.split('/')),administration=path.join(repo,'.git');
 if(!fs.lstatSync(administration).isDirectory()||fs.lstatSync(administration).isSymbolicLink())fail('standalone_git_required');
 for(const file of ['objects/info/alternates','commondir','shallow'])if(fs.existsSync(path.join(administration,file))&&fs.statSync(path.join(administration,file)).size)fail('external_or_partial_git_storage');
 function administrationTree(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isSymbolicLink())fail('linked_git_administration');if(entry.name.endsWith('.promisor'))fail('external_or_partial_git_storage');if(entry.isDirectory())administrationTree(file);}}
 administrationTree(administration);
 rejectPartialClone(repo);
 const top=git(repo,['rev-parse','--show-toplevel']).toString('utf8').trim();if(fs.realpathSync(top)!==fs.realpathSync(repo))fail('repository_root_mismatch');
 const head=git(repo,['rev-parse','--verify','HEAD']).toString('utf8').trim();if(head!==expected)fail('commit_mismatch');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(git(repo,['ls-tree','-r','-z','--full-tree','HEAD'])),tracked=new Map();
 for(const item of text.split('\0').filter(Boolean)){
  const match=/^(100644|100755|120000) blob ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/.exec(item);if(!match)fail('unsupported_git_entry');
  const name=portable(relative+'/'+match[3]);tracked.set(name,{mode:match[1],object:match[2]});if(tracked.size>MAX_FILES)fail('too_many_files');
 }
 const filters=disabledFilters(repo);if(git(repo,['status','--porcelain=v1','-z','--untracked-files=all','--ignore-submodules=all'],filters).length)fail('repository_dirty');
 if(git(repo,['ls-files','-v','-z']).toString('utf8').split('\0').filter(Boolean).some(row=>row[0]!=='H'))fail('hidden_working_tree_changes');
 if(!tracked.size)fail('empty_repository');return {repo,head,tracked,filters};
}

function inspectPackage(packageRoot){
 if(typeof packageRoot!=='string'||!path.isAbsolute(packageRoot))fail('absolute_root_required');
 const root=path.resolve(packageRoot);if(fs.lstatSync(root).isSymbolicLink()||!fs.statSync(root).isDirectory())fail('package_root_invalid');
 const entries=new Map(),directories=new Set(),expanded=new Set(),folded=new Map();let repositoryPath;
 function add(row){
  const key=row.path.toLowerCase(),previous=folded.get(key);if(previous&&previous!==row.path)fail('case_colliding_paths');folded.set(key,row.path);
  const old=entries.get(row.path);if(old&&JSON.stringify(old)!==JSON.stringify(row))fail('source_changed');entries.set(row.path,row);if(entries.size>MAX_FILES)fail('too_many_files');
 }
 function resolve(relative,links=new Set()){
  portable(relative);const pieces=relative.split('/');
  for(let index=0;index<pieces.length;index++){
   const prefix=pieces.slice(0,index+1).join('/'),file=path.join(root,...pieces.slice(0,index+1));let stat;try{stat=fs.lstatSync(file);}catch{fail('resource_missing');}
   if(!stat.isSymbolicLink())continue;
   const target=fs.readlinkSync(file);if(!target||/[\\\r\n\0]/.test(target)||path.posix.isAbsolute(target)||/^[A-Za-z]:/.test(target))fail('nonportable_link');
   const destination=path.posix.normalize(path.posix.join(path.posix.dirname(prefix),target));if(destination==='..'||destination.startsWith('../')||destination==='.'||path.posix.isAbsolute(destination))fail('link_escape');portable(destination);
   if(links.has(prefix))fail('link_cycle');const next=new Set(links);next.add(prefix);
   add({path:prefix,kind:'symlink',target,size:Buffer.byteLength(target,'utf8'),sha256:hash(Buffer.from(target,'utf8'))});
   const resolved=resolve(destination,next);if(!inside(root,resolved))fail('link_escape');
   const remainder=pieces.slice(index+1).join('/');return remainder?resolve(destination+'/'+remainder,next):resolved;
  }
  const real=fs.realpathSync(path.join(root,...pieces));if(!inside(root,real))fail('resource_escape');return real;
 }
 function visit(relative,stack=new Set()){
  portable(relative);const file=resolve(relative),stat=fs.statSync(file),realRelative=path.relative(root,file).replaceAll('\\','/');
  const parts=relative.split('/');for(let i=1;i<=parts.length;i++){const logical=parts.slice(0,i).join('/'),location=path.join(root,...parts.slice(0,i));if(fs.lstatSync(location).isSymbolicLink()){const target=fs.readlinkSync(location);add({path:logical,kind:'symlink',target,size:Buffer.byteLength(target,'utf8'),sha256:hash(Buffer.from(target,'utf8'))});}}
  if(repositoryPath&&[relative,realRelative].some(name=>name===repositoryPath+'/.git'||name.startsWith(repositoryPath+'/.git/')))fail('git_admin_resource');
  if(stat.isDirectory()){
   if(stack.has(file))fail('link_cycle');directories.add(relative);
   if(expanded.has(relative))return;expanded.add(relative);const next=new Set(stack);next.add(file);
   for(const name of fs.readdirSync(file)){const child=relative+'/'+name;if(child!==repositoryPath+'/.git')visit(child,next);}
  }else if(stat.isFile()){
   if(!entries.has(relative)||entries.get(relative).kind!=='symlink')add({path:relative,kind:'file',target:null,...fileHash(file)});
  }else fail('resource_not_regular');
  if(realRelative!==relative&&!expanded.has('target:'+realRelative)){expanded.add('target:'+realRelative);visit(realRelative);}
 }
 const manifestPath=resolve('tool.json');if(fs.statSync(manifestPath).size>512*1024)fail('manifest_too_large');
 const rawManifest=fs.readFileSync(manifestPath),manifest=validateToolPackage(JSON.parse(rawManifest.toString('utf8')));
 if(path.basename(root)!==manifest.id+'-package')fail('package_directory_name');repositoryPath=manifest.repository.path;
 deliverySkill(resolve(manifest.guidance.delivery)); // Bound the explicit body read before enumerating resource bytes.
 const repoResolved=resolve(repositoryPath);if(repoResolved!==path.join(root,...repositoryPath.split('/')))fail('linked_repository_root');
 const source=repository(root,repositoryPath,manifest.repository.commit);
 for(const name of source.tracked.keys())visit(name);
 for(const name of toolPackageResources(manifest))visit(name);
 visit(manifest.tests.directory);
 // Original programs remain pinned to Git; generated test wrappers are package-versioned.
 const testsRoot=resolve(manifest.tests.directory);
 for(const name of [...manifest.functions.map(item=>item.entrypoint),...manifest.tests.cases.map(item=>item.entrypoint)]){
  const actual=resolve(name),canonical=path.relative(root,actual).replaceAll('\\','/');if(!fs.statSync(actual).isFile())fail('program_entrypoint_not_file');
  if(inside(source.repo,actual)){if(!source.tracked.has(canonical))fail('program_not_in_source_revision');}
  else if(!inside(testsRoot,actual))fail('program_wrapper_outside_tests');
 }
 for(const [name,item]of source.tracked){
  const row=entries.get(name);if(item.mode==='120000'&&row?.kind!=='symlink'||item.mode!=='120000'&&row?.kind!=='file')fail('working_tree_type_changed');
 }
 const final=repository(root,repositoryPath,manifest.repository.commit);if(final.head!==source.head)fail('source_changed');
 const files=[...entries.values()].sort(compare),manifestSha256=hash(rawManifest),packageVersion=hash(Buffer.from(packageIdentityText({id:manifest.id,commit:source.head,manifestSha256,files}),'utf8'));
 const observedContent=name=>entries.get(path.relative(root,resolve(name)).replaceAll('\\','/'))?.sha256;
 const delivery=deliverySkill(resolve(manifest.guidance.delivery));if(delivery.sha256!==observedContent(manifest.guidance.delivery)||manifestSha256!==observedContent('tool.json'))fail('source_changed');
 const guidance=toolGuidanceResources(manifest).map(item=>{const sha256=fileHash(resolve(item.path)).sha256;if(sha256!==observedContent(item.path))fail('source_changed');return {...item,sha256};});
 return {root,source,manifest,files,directories:[...directories],manifestSha256,packageVersion,deliverySkill:delivery,guidance};
}

function metadata(value){return {schema_version:SCHEMA,package_id:value.manifest.id,package_version:value.packageVersion,source_commit:value.source.head,manifest_sha256:value.manifestSha256,manifest:clone(value.manifest),files:clone(value.files),guidance:clone(value.guidance),delivery_skill:clone(value.deliverySkill),scope:'definition_checked',installation:{status:'not_run'},tests:{status:'not_run'}};}
function versionId(id,version){return hash(Buffer.from(id+'\0'+version,'utf8'));}

export function createToolPackageRegistry({catalog,storeRoot,now=Date.now}={}){
 if(!catalog||!['get','put','list','transaction'].every(name=>typeof catalog[name]==='function')||typeof storeRoot!=='string'||!path.isAbsolute(storeRoot))fail('registry_unavailable');
 const store=path.resolve(storeRoot);
 function read(request){
  exact(request,['package_id','package_version'],['package_id']);if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(request.package_id)||request.package_version!==undefined&&!/^[a-f0-9]{64}$/.test(request.package_version))fail('invalid_request');
  const current=catalog.get(PACKAGE,request.package_id);if(!current||current.schema_version!==SCHEMA)fail('unavailable');
  const version=request.package_version||current.package_version,record=catalog.get(VERSION,versionId(request.package_id,version));
  if(!record||record.schema_version!==SCHEMA||record.package_id!==request.package_id||record.package_version!==version)fail('version_unavailable');return clone({...record,revision:current.revision,package_root:current.package_root,package_roots:current.package_roots||[current.package_root],versions:current.versions});
 }
 function list(request={}){exact(request,[]);return catalog.list(PACKAGE).map(value=>{if(value.schema_version!==SCHEMA)fail('stored_schema');return clone({...value,package_roots:value.package_roots||[value.package_root]});});}
 function inspect(request){exact(request,['package_root'],['package_root']);return metadata(inspectPackage(request.package_root));}
 function ownedStore(){
  noLinkedParents(store);fs.mkdirSync(store,{recursive:true});const marker=path.join(store,'registry.json');
  if(fs.existsSync(marker)){if(fs.lstatSync(marker).isSymbolicLink()||!fs.statSync(marker).isFile())fail('store_not_owned');const value=JSON.parse(fs.readFileSync(marker,'utf8'));if(value.schema_version!==SCHEMA||value.kind!==PACKAGE)fail('store_not_owned');}
  else{if(fs.readdirSync(store).length)fail('store_not_owned');fs.writeFileSync(marker,JSON.stringify({schema_version:SCHEMA,kind:PACKAGE})+'\n',{flag:'wx'});}
 }
 function snapshot(value){
  if(inside(value.root,store)||inside(store,value.root))fail('overlapping_store');ownedStore();
  const versions=path.join(store,'versions',value.manifest.id),destination=path.join(versions,value.packageVersion,value.manifest.id+'-package');noLinkedParents(destination);
  if(fs.existsSync(destination)){
   const existing=inspectPackage(destination);if(existing.packageVersion!==value.packageVersion)fail('snapshot_changed');return destination;
  }
  const stagingRoot=path.join(store,'staging');noLinkedParents(stagingRoot);fs.mkdirSync(stagingRoot,{recursive:true});const stage=path.join(stagingRoot,randomUUID()),temporary=path.join(stage,value.manifest.id+'-package'),template=path.join(stage,'empty-template');fs.mkdirSync(template,{recursive:true});fs.mkdirSync(temporary);
  try{
   const repo=path.join(temporary,...value.manifest.repository.path.split('/'));fs.mkdirSync(path.dirname(repo),{recursive:true});
   git(value.source.repo,['clone','--local','--no-hardlinks','--no-checkout','--template='+template,'--',value.source.repo,repo],['-c','protocol.file.allow=always']);
   if(git(repo,['rev-parse','HEAD']).toString('utf8').trim()!==value.source.head)fail('source_changed');
   const administration=path.join(repo,'.git'),format=value.source.head.length===64?'1':'0';
   let nativeOptions='';for(const key of ['autocrlf','eol','filemode','symlinks']){try{const setting=execFileSync('git',[...gitPlatformOptions,'--no-optional-locks','-C',value.source.repo,'config','--get','core.'+key],{env:gitEnvironment(),stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:5000}).toString('utf8').trim();if(['true','false','input','lf','crlf','native'].includes(setting))nativeOptions+=key+' = '+setting+'\n';}catch(error){if(error.status!==1)fail('git_configuration_unavailable');}}
   fs.writeFileSync(path.join(administration,'config'),'[core]\nrepositoryformatversion = '+format+'\nbare = false\nlogallrefupdates = true\n'+nativeOptions+(format==='1'?'[extensions]\nobjectFormat = sha256\n':''));
   fs.writeFileSync(path.join(administration,'HEAD'),value.source.head+'\n');
   const linkPaths=value.files.filter(item=>item.kind==='symlink').map(item=>item.path),throughLink=name=>linkPaths.some(link=>name.startsWith(link+'/'));
   for(const directory of value.directories)if(!throughLink(directory)&&!linkPaths.includes(directory))fs.mkdirSync(path.join(temporary,...directory.split('/')),{recursive:true});
   for(const item of value.files.filter(item=>item.kind==='file'&&!throughLink(item.path))){const target=path.join(temporary,...item.path.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(value.root,...item.path.split('/')),target);const source=fs.statSync(path.join(value.root,...item.path.split('/')));fs.chmodSync(target,source.mode&0o777);}
   for(const item of value.files.filter(item=>item.kind==='symlink'&&!throughLink(item.path))){const target=path.join(temporary,...item.path.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.symlinkSync(item.target,target,fs.statSync(path.join(value.root,...item.path.split('/'))).isDirectory()?'dir':'file');}
   // clone --no-checkout has no populated index; read-tree only records blobs and never runs filters.
   git(repo,['read-tree',value.source.head]);
   const verified=inspectPackage(temporary),original=inspectPackage(value.root);if(verified.packageVersion!==value.packageVersion||original.packageVersion!==value.packageVersion)fail('source_changed');
   function freeze(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())freeze(file);else fs.chmodSync(file,(fs.statSync(file).mode&0o111)|0o444);}fs.chmodSync(directory,0o555);}
   freeze(temporary);fs.chmodSync(temporary,0o755);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.renameSync(temporary,destination);fs.chmodSync(destination,0o555);return destination;
  }finally{const resolved=path.resolve(stage);noLinkedParents(resolved);if(!inside(stagingRoot,resolved)||resolved===stagingRoot||fs.lstatSync(resolved).isSymbolicLink())fail('unsafe_staging_cleanup');function writable(directory){fs.chmodSync(directory,0o700);for(const item of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isSymbolicLink())continue;if(item.isDirectory())writable(file);else fs.chmodSync(file,0o600);}}writable(resolved);fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3});}
 }
 function change(request,mode){
  exact(request,mode==='register'?['package_root']:['package_id','package_root','expected_revision'],mode==='register'?['package_root']:['package_id','package_root','expected_revision']);
  if(mode!=='register'&&(!Number.isSafeInteger(request.expected_revision)||request.expected_revision<1))fail('invalid_request');
  const value=inspectPackage(request.package_root),id=value.manifest.id,previous=catalog.get(PACKAGE,id);
  if(mode!=='register'&&(request.package_id!==id||!previous||request.expected_revision!==previous.revision))fail('revision_changed');
  if(mode==='register'&&previous){if(previous.package_root===value.root&&previous.package_version===value.packageVersion)return read({package_id:id});fail('already_registered');}
  if(mode==='relocate'&&previous.package_version!==value.packageVersion)fail('relocation_version_changed');
  const root=snapshot(value),recordId=versionId(id,value.packageVersion),record={...metadata(value),record_id:recordId,snapshot_root:root,immutable:true,registered_at:now()};
  return catalog.transaction(()=>{
   const fresh=catalog.get(PACKAGE,id);if(previous?.revision!==fresh?.revision)fail('revision_changed');
   const oldVersion=catalog.get(VERSION,recordId);if(!oldVersion)catalog.put(VERSION,recordId,record);
   const current={schema_version:SCHEMA,package_id:id,name:value.manifest.name,revision:(previous?.revision||0)+1,package_version:value.packageVersion,source_commit:value.source.head,manifest_sha256:value.manifestSha256,package_root:value.root,package_roots:[...new Set([...(previous?.package_roots||(previous?[previous.package_root]:[])),value.root])],snapshot_root:root,versions:[...new Set([...(previous?.versions||[]),value.packageVersion])],delivery_skill:clone(value.deliverySkill),scope:'definition_checked',installation:{status:'not_run'},tests:{status:'not_run'},updated_at:now()};
   catalog.put(PACKAGE,id,current);return read({package_id:id});
  });
 }
 return {inspect,register:request=>change(request,'register'),update:request=>change(request,'update'),relocate:request=>change(request,'relocate'),list,read};
}
