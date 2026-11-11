import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root=process.cwd();
// Include new local docs before staging; ignored runtime evidence stays excluded.
const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','--','*.md'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))].filter(file=>fs.existsSync(path.join(root,file))).sort();
const broken=[];
const pattern=/\]\(([^)\s]+)\)/g;
for(const file of files){
 let text=fs.readFileSync(path.join(root,file),'utf8');
 // Ignore markdown examples inside fenced blocks and inline code spans.
 text=text.replace(/```[\s\S]*?```/g,'').replace(/`[^`\n]*`/g,'');
 for(const match of text.matchAll(pattern)){
  const raw=match[1];
  if(!raw||/^(?:[a-z]+:|#|\/)/i.test(raw))continue;
  const target=decodeURIComponent(raw.split('#')[0].split('?')[0]);
  if(!target.endsWith('.md'))continue;
  const resolved=path.resolve(root,path.dirname(file),target);
  if(!fs.existsSync(resolved))broken.push({file,target});
 }
}
if(broken.length){
 console.error('Broken local markdown links: '+broken.length);
 for(const item of broken)console.error(item.file+' -> '+item.target);
 process.exit(1);
}
console.log('DOC_LINKS_OK files='+files.length);
