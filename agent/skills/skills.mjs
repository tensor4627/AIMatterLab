import rawFs from 'node:fs';
import {createReadPolicy,legacyGuidanceFacts} from './read-policy.mjs';
import {policyIo} from './policy-io.mjs';
import path from 'node:path';
export function localSkills(roots,{policy=createReadPolicy(legacyGuidanceFacts())}={}){
 policy.assertCurrent();
 const fs=policyIo(rawFs,policy);
 const skills=[],seen=new Set();
 function visit(directory,depth=0){
  if(depth>4||!policy.allowsPath(directory)||!fs.existsSync(directory))return;
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   if(entry.isSymbolicLink())continue;
   const target=path.join(directory,entry.name);
   if(entry.isDirectory()&&!['.git','node_modules','__pycache__'].includes(entry.name))visit(target,depth+1);
   else if(entry.name==='SKILL.md'&&entry.isFile()&&policy.allowsPath(target)&&fs.statSync(target).size<256*1024&&!seen.has(target)){
    seen.add(target);const source=fs.readFileSync(target,'utf8');
    const field=name=>source.match(new RegExp('^'+name+':\\s*(.+)$','m'))?.[1]?.replace(/^["']|["']$/g,'');
    skills.push({name:field('name')||path.basename(directory),description:field('description')||source.split('\n').find(x=>x.startsWith('# '))||'Local scientific skill',path:target,source:'local registry',enabled:true});
   }
  }
 }
 for(const root of roots){
  if(typeof root!=='string'||!path.isAbsolute(root))throw Error('Skill roots must be absolute local directories');
  visit(root);
 }
 const execution=policy.catalogEntry();if(execution)skills.unshift(execution);policy.assertReadsCurrent();return skills;
}
