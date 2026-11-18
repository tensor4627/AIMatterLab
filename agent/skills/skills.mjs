import rawFs from 'node:fs';
import {createReadPolicy,legacyGuidanceFacts} from './read-policy.mjs';
import {policyIo} from './policy-io.mjs';
import path from 'node:path';
export function localSkills(roots,{policy=createReadPolicy(legacyGuidanceFacts()),projectSkills,bundledRoot}={}){
 policy.assertCurrent();
 const fs=policyIo(rawFs,policy);
 const skills=[],seen=new Set();
 function visit(directory,physicalDirectory,depth=0){
  // Explicit search roots may also contain the desktop's personal or scoped libraries.
  if(projectSkills?.ownsDirectory(directory) || (physicalDirectory!==directory && projectSkills?.ownsDirectory(physicalDirectory)))return;
  if(depth>4||!policy.allowsPath(directory)||!fs.existsSync(directory))return;
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   if(entry.isSymbolicLink())continue;
   const target=path.join(directory,entry.name);
   if(entry.isDirectory()&&!['.git','node_modules','__pycache__'].includes(entry.name))visit(target,path.join(physicalDirectory,entry.name),depth+1);
   else if(entry.name==='SKILL.md'&&entry.isFile()&&policy.allowsPath(target)&&fs.statSync(target).size<256*1024&&!seen.has(target)){
    seen.add(target);const body=fs.readFileSync(target,'utf8');
    const field=name=>body.match(new RegExp('^'+name+':\\s*(.+)$','m'))?.[1]?.replace(/^["']|["']$/g,'');
    const relative=bundledRoot&&path.relative(bundledRoot,target);
    const source=relative&&!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep)?'studio':'local registry';
    skills.push({name:field('name')||path.basename(directory),description:field('description')||body.split('\n').find(x=>x.startsWith('# '))||'Local scientific skill',path:target,source,enabled:true});
   }
  }
 }
 for(const root of roots){
  if(typeof root!=='string'||!path.isAbsolute(root))throw Error('Skill roots must be absolute local directories');
  if(projectSkills?.ownsDirectory(root)||!policy.allowsPath(root)||!fs.existsSync(root))continue;
  visit(root,projectSkills?fs.realpathSync(root):root);
 }
 const execution=policy.catalogEntry();if(execution)skills.unshift(execution);policy.assertReadsCurrent();return skills;
}
