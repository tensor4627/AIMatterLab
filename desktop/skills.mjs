import fs from 'node:fs';
import path from 'node:path';
export function localSkills(roots){
 const skills=[],seen=new Set();
 function visit(directory,depth=0){
  if(depth>4||!fs.existsSync(directory))return;
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   if(entry.isSymbolicLink())continue;
   const target=path.join(directory,entry.name);
   if(entry.isDirectory()&&!['.git','node_modules','__pycache__'].includes(entry.name))visit(target,depth+1);
   else if(entry.name==='SKILL.md'&&entry.isFile()&&fs.statSync(target).size<256*1024&&!seen.has(target)){
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
 return skills;
}
