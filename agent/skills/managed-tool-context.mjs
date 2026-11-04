/** Version-bound, bounded delivery guidance. No package program is ever executed. */
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const DEFAULT_LIMITS={maxFiles:12,maxFileBytes:256*1024,maxTotalBytes:512*1024};
const sha=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fail=code=>{throw Error('Managed tool context is incomplete ('+code+')');};
function relative(value){
 if(typeof value!=='string'||!value||value.length>512||/[\\<>:"|?*\x00-\x1f\x7f]/.test(value)||value.startsWith('/')||value.split('/').some(part=>!part||part==='.'||part==='..'||part.toLowerCase()==='.git'))fail('nonportable_resource');
 return value;
}
function contained(value){if(value==='.'||value==='..'||value.startsWith('../')||path.posix.isAbsolute(value))fail('reference_outside_package');return relative(value);}
function inlineLinks(source){
 const targets=[],opening=/(?<!!)\[[^\]\n]*\]\(/g;let match;
 while((match=opening.exec(source))){
  const start=opening.lastIndex;let depth=1,angle=false,quote='',end=start;
  for(;end<source.length;end++){
   const char=source[end];if(char==='\n'||char==='\r')break;
   if(char==='\\'){if(end+1>=source.length)break;end++;continue;}
   if(angle){if(char==='>')angle=false;continue;}
   if(quote){if(char===quote)quote='';continue;}
   if(char==='<'&&end===start){angle=true;continue;}
   if((char==='"'||char==="'")&&/\s/.test(source[end-1]||'')){quote=char;continue;}
   if(char==='(')depth++;else if(char===')'&&--depth===0)break;
  }
  if(depth!==0||angle||quote)fail('invalid_markdown_destination');targets.push(source.slice(start,end));opening.lastIndex=end+1;
 }
 return targets;
}
function links(text){
 // Fenced examples and inline code do not request guidance attachments.
 let source=text.replace(/```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~/g,'').replace(/`[^`\n]*`/g,'');const targets=[],definitions=new Map();
 for(const match of source.matchAll(/^ {0,3}\[([^\]\n]+)\]:\s*(<[^>\n]+>|\S+)(?:\s+.*)?$/gm))definitions.set(match[1].trim().toLowerCase(),match[2]);
 source=source.replace(/^ {0,3}\[[^\]\n]+\]:.*$/gm,'');
 targets.push(...inlineLinks(source));
 for(const match of source.matchAll(/\[([^\]\n]+)\]\[([^\]\n]*)\]/g)){const value=definitions.get((match[2]||match[1]).trim().toLowerCase());if(value)targets.push(value);}
 for(const match of source.matchAll(/\[([^\]\n]+)\](?![\[(])/g)){const value=definitions.get(match[1].trim().toLowerCase());if(value)targets.push(value);}
 return targets;
}
function reference(target,base){
 let value=target.trim().replace(/\s+["'][^\n]*["']\s*$/,'');if(value.startsWith('<')&&value.endsWith('>'))value=value.slice(1,-1);
 value=value.replace(/\\(.)/g,(escaped,char)=>char.charCodeAt(0)>=33&&char.charCodeAt(0)<=126&&!/[A-Za-z0-9]/.test(char)?char:escaped);
 if(/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)||value.startsWith('//')||value.startsWith('#'))return null;
 try{value=decodeURIComponent(value.split(/[?#]/,1)[0]);}catch{fail('invalid_reference_encoding');}
 if(!/\.(md|json)$/i.test(value))return null; // Code, models and other file types remain path references only.
 if(value.startsWith('/')||value.includes('\\'))fail('reference_outside_package');
 return contained(path.posix.normalize(path.posix.join(path.posix.dirname(base),value)));
}
const identity=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs];
const identical=(left,right)=>identity(left).every((value,index)=>value===identity(right)[index]);

export async function managedToolSkillContext({selection,record,policy,scope,limits={}}={}){
 if(!policy||!['assertCurrent','assertReadable','revalidate'].every(key=>typeof policy[key]==='function'))fail('guidance_policy_required');
 if(!plain(record)||typeof record.snapshot_root!=='string'||!path.isAbsolute(record.snapshot_root)||!plain(record.delivery_skill)||record.delivery_skill.path!=='SKILL.md'||!Array.isArray(record.files)||record.files.length>100000)fail('invalid_registered_metadata');
 const root=path.resolve(record.snapshot_root),delivery=structuredClone(record.delivery_skill),expected=path.join(root,delivery.path);if(typeof delivery.name!=='string'||!delivery.name||!/^[a-f0-9]{64}$/.test(delivery.sha256))fail('invalid_registered_delivery');
 if(!plain(selection)||selection.name!==delivery.name||selection.path!==expected)fail('unregistered_selection');
 if(!plain(limits)||Object.keys(limits).some(key=>!Object.hasOwn(DEFAULT_LIMITS,key)))fail('invalid_context_limits');const bounds={...DEFAULT_LIMITS,...limits};
 for(const [key,max]of [['maxFiles',16],['maxFileBytes',256*1024],['maxTotalBytes',1024*1024]])if(!Number.isSafeInteger(bounds[key])||bounds[key]<1||bounds[key]>max)fail('invalid_context_limits');
 const rows=new Map();
 for(const value of record.files){
  const row=structuredClone(value);relative(row.path);if(rows.has(row.path)||!['file','symlink'].includes(row.kind)||!Number.isSafeInteger(row.size)||row.size<0||!/^[a-f0-9]{64}$/.test(row.sha256)||row.kind==='file'&&row.target!==null)fail('invalid_registered_file');
  if(row.kind==='symlink'&&(typeof row.target!=='string'||!row.target||/[\\\r\n\0]/.test(row.target)||path.posix.isAbsolute(row.target)||/^[A-Za-z]:/.test(row.target)||Buffer.byteLength(row.target)!==row.size||sha(row.target)!==row.sha256))fail('invalid_registered_link');rows.set(row.path,row);
 }
 const absolute=value=>path.join(root,...value.split('/'));
 function current(){policy.assertCurrent();if(scope?.checkCurrent&&scope.checkCurrent()!==true)fail('scope_changed');}
 function guard(paths){current();for(const file of paths)policy.assertReadable(file);current();}
 async function checked(paths,operation){await policy.revalidate();guard(paths);const result=await operation();await policy.revalidate();guard(paths);return result;}
 function resolve(logical){
  relative(logical);const paths=[absolute(logical)],redirects=[];guard(paths);if(!rows.has(logical))fail('resource_not_in_version');let canonical=logical;const seen=new Set();
  for(;;){
   const pieces=canonical.split('/');let redirected=false;
   for(let i=1;i<=pieces.length;i++){
    const prefix=pieces.slice(0,i).join('/'),row=rows.get(prefix);if(row?.kind!=='symlink')continue;
    if(seen.has(prefix)||seen.size>=32)fail('link_cycle');seen.add(prefix);const destination=contained(path.posix.normalize(path.posix.join(path.posix.dirname(prefix),row.target))),next=contained(path.posix.join(destination,...pieces.slice(i)));
    paths.push(absolute(prefix),absolute(destination),absolute(next));guard(paths);redirects.push({path:prefix,target:row.target});canonical=next;redirected=true;break;
   }
   if(!redirected)break;
  }
  const row=rows.get(canonical);if(!row||row.kind!=='file')fail('resource_not_in_version');paths.push(absolute(canonical));guard(paths);return {logical,canonical,row,paths:[...new Set(paths)],redirects};
 }
 async function locations(spec){
  const observedRoot=await checked(spec.paths,()=>fs.realpath(root));if(!same(observedRoot,root))fail('snapshot_root_changed');
  const inspected=new Set();for(const candidate of [spec.logical,...spec.redirects.map(link=>link.path),spec.canonical]){
   const parts=candidate.split('/');for(let i=1;i<=parts.length;i++){
    const relative=parts.slice(0,i).join('/');if(inspected.has(relative))continue;inspected.add(relative);const file=absolute(relative),paths=[...spec.paths,file],stat=await checked(paths,()=>fs.lstat(file)),registered=rows.get(relative);
    if(registered?.kind==='symlink'){if(!stat.isSymbolicLink()||await checked(paths,()=>fs.readlink(file))!==registered.target)fail('link_mapping_changed');}
    else if(stat.isSymbolicLink())fail('undeclared_redirect');
   }
  }
  const actual=await checked(spec.paths,()=>fs.realpath(absolute(spec.logical)));if(!same(actual,absolute(spec.canonical)))fail('resource_redirect_changed');
  const physical=await checked(spec.paths,()=>fs.realpath(absolute(spec.canonical)));if(!same(physical,absolute(spec.canonical)))fail('resource_redirect_changed');
 }
 let total=0;const seen=new Map(),attachments=[],queue=[],omitted=[];
 async function read(logical,{entry=false}={}){
  const spec=resolve(logical);if(seen.has(spec.canonical))return seen.get(spec.canonical);
  if(spec.row.size>bounds.maxFileBytes){if(entry)fail('context_byte_limit');omitted.push(logical);return null;}
  if(seen.size>=bounds.maxFiles||spec.row.size>bounds.maxTotalBytes-total)fail('context_byte_limit');
  await locations(spec);const file=absolute(spec.canonical),before=await checked(spec.paths,()=>fs.lstat(file,{bigint:true}));
  if(before.isSymbolicLink()||!before.isFile()||before.size!==BigInt(spec.row.size))fail('registered_file_changed');
  let handle;
  try{
   await checked(spec.paths,async()=>{handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));});const opened=await checked(spec.paths,()=>handle.stat({bigint:true}));if(!identical(before,opened))fail('registered_file_changed');
   const bytes=Buffer.alloc(spec.row.size+1);let count=0;
   for(;;){const result=await checked(spec.paths,()=>handle.read(bytes,count,bytes.length-count,null));count+=result.bytesRead;if(!result.bytesRead||count===bytes.length)break;}
   const after=await checked(spec.paths,()=>handle.stat({bigint:true}));if(!identical(before,after)||count!==spec.row.size)fail('registered_file_changed');await locations(spec);const final=await checked(spec.paths,()=>fs.lstat(file,{bigint:true}));if(!identical(before,final))fail('registered_file_changed');
   const data=bytes.subarray(0,count),digest=sha(data);if(digest!==spec.row.sha256||entry&&digest!==delivery.sha256)fail('registered_hash_changed');
   const text=new TextDecoder('utf-8',{fatal:true}).decode(data);if(text.includes('\0'))fail('binary_guidance');
   const value={label:logical,kind:!entry&&/\.json$/i.test(logical)?'reference-data':'instructions',sha256:digest,bytes:count,text,canonical:spec.canonical};seen.set(spec.canonical,value);attachments.push(value);total+=count;if(entry||/\.md$/i.test(logical))queue.push(value);return value;
  }finally{if(handle)await handle.close();}
 }
 await policy.revalidate();const entry=await read(delivery.path,{entry:true});
 while(queue.length){const source=queue.shift();for(const target of links(source.text)){const file=reference(target,source.canonical);if(file)await read(file);}}
 let text='[Selected skill: '+selection.name+']\n'+entry.text;
 for(const attachment of attachments.slice(1))text+='\n\n[Studio skill attachment: '+attachment.label+'; '+attachment.kind+']\n'+attachment.text;
 for(const file of [...new Set(omitted)])text+='\n\n[Reference not expanded: '+file+'; exceeds the bounded guidance file size. The path remains a reference only.]';
 if(Buffer.byteLength(text)>bounds.maxTotalBytes)fail('context_byte_limit');await policy.revalidate();current();
 return {text,attachments:attachments.map(({label,kind,sha256,bytes})=>({label,kind,sha256,bytes})),totalBytes:Buffer.byteLength(text)};
}
