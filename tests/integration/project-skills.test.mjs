import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProjectSkills} from '../../agent/skills/project-skills.mjs';
import {TerminalMcp} from '../../agent/tools/terminal-mcp.mjs';
const body='---\nname: local-analysis\ndescription: User project analysis instructions\n---\nUse the selected project data only.\n';

test('editable project prompts link personal and project skills without crossing projects, including after relocation',t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-project-prompt-'));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 let selected={provider:'codex',threadId:'one',projectId:'alpha'};
 const lease=()=>({...selected,checkCurrent:()=>true}),store=new ProjectSkills({root:path.join(temp,'skills'),current:()=>selected});
 const catalog=()=>store.call('project_skill_catalog',{},lease());
 const first=catalog().instructions;
 assert.equal(first.document,'AGENTS.md');assert.ok(first.body.includes('alpha'));
 assert.equal(path.resolve(store.root,first.relativePath),path.join(store.directory(lease()).target,'AGENTS.md'));
 const file=path.join(store.directory(lease()).target,'AGENTS.md');
 fs.writeFileSync(file,'# My own project instructions\n');
 for(const scope of ['user','current']){
  const result=store.call('write_project_skill',{scope,name:'local-analysis',body,expected_sha256:null},lease());
  assert.equal(result.instructionsWarning,undefined);
 }
 const instructions=catalog().instructions.body;
 assert.ok(instructions.startsWith('# My own project instructions'));
 for(const relative of ['../user/local-analysis/SKILL.md','./local-analysis/SKILL.md']){
  assert.ok(instructions.includes(']('+relative+')'));assert.equal(fs.readFileSync(path.resolve(path.dirname(file),relative),'utf8'),body);
 }
 assert.equal(store.call('project_skill_catalog',{scope:'user'},lease()).instructions,undefined);
 store.root=store.prepareRoot(path.join(temp,'moved'));assert.equal(catalog().instructions.body,instructions);
 selected={...selected,projectId:'beta'};assert.doesNotMatch(catalog().instructions.body,/My own project|local-analysis/);
 selected={...selected,projectId:null};assert.equal(catalog().instructions,undefined);
});

test('relocation rejects conflicting project prompts and a linked document cannot receive a skill link',t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-prompt-conflict-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const scope={provider:'codex',projectId:'alpha',threadId:'a',checkCurrent:()=>true};
 const store=new ProjectSkills({root:path.join(temp,'original'),current:()=>scope}),other=new ProjectSkills({root:path.join(temp,'other'),current:()=>scope});
 const catalog=()=>store.call('project_skill_catalog',{},scope);
 const doc=path.join(store.root,catalog().instructions.relativePath);
 fs.writeFileSync(path.join(other.directory(scope).target,'AGENTS.md'),'Handwritten destination prompt');
 assert.throws(()=>store.prepareRoot(other.root),/Conflicting project AGENTS/);
 fs.unlinkSync(doc);const outside=path.join(temp,'outside');fs.writeFileSync(outside,'Outside');fs.linkSync(outside,doc);
 assert.throws(catalog,/Unsafe/);
 const saved=store.call('write_project_skill',{scope:'user',name:'local-analysis',body,expected_sha256:null},scope);
 assert.equal(saved.body,body);assert.match(saved.instructionsWarning,/Skill saved/);assert.equal(fs.readFileSync(outside,'utf8'),'Outside');
});

test('personal and scoped skills survive cache relocation and conflicting files keep their original revisions',t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-skill-cache-'));
 t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const root=path.join(tmp,'original'),next=path.join(tmp,'moved'),conflict=path.join(tmp,'conflict');
 let current={provider:'deepseek',threadId:'chat-a',projectId:null};
 const lease=()=>({...current,checkCurrent:()=>true});
 const store=new ProjectSkills({root,current:()=>current});
 const args={name:'local-analysis',body,expected_sha256:null};
 const personal=store.call('write_project_skill',{...args,scope:'user'},lease());
 const privateBody=body+'Private to this chat.\n';
 store.call('write_project_skill',{...args,body:privateBody},lease());
 const personalFile=dir=>path.join(dir,'user','local-analysis','SKILL.md');
 const read=(library='current')=>store.call('read_project_skill',{name:args.name,scope:library},lease());
 assert.throws(()=>store.prepareRoot(path.join(root,'inside')),/independent/);
 assert.throws(()=>store.prepareRoot(path.dirname(root)),/independent/);
 const other=new ProjectSkills({root:conflict,current:()=>current});
 other.call('write_project_skill',{...args,scope:'user',body:body+'Different.\n'},lease());
 assert.throws(()=>store.prepareRoot(conflict),/Conflicting/);
 assert.equal(store.root,root);
 assert.equal(fs.readFileSync(personalFile(conflict),'utf8'),body+'Different.\n');
 assert.equal(store.prepareRoot(next),next);
 assert.equal(store.prepareRoot(next),next,'same files can be retried');
 assert.equal(store.root,root,'only the settings transaction commits the new location');
 assert.equal(fs.readFileSync(personalFile(root),'utf8'),body);
 store.root=next;
 assert.equal(read().body,privateBody);
 assert.equal(read('user').sha256,personal.sha256);
 current={provider:'codex',threadId:'chat-b',projectId:'another-project'};
 assert.equal(read('user').body,body);
 assert.deepEqual(store.call('project_skill_catalog',{},lease()).skills,[]);
 assert.throws(()=>store.call('write_project_skill',{...args,scope:'user',expected_sha256:'wrong'},lease()),/revision/);
 assert.throws(()=>store.call('read_project_skill',{name:args.name,scope:'user'},{...lease(),checkCurrent:()=>false}),/changed/);
 store.call('write_project_skill',{...args,scope:'user',body:body+'Updated.\n',expected_sha256:personal.sha256},lease());
 assert.equal(fs.readFileSync(personalFile(next),'utf8'),body+'Updated.\n');
 assert.equal(fs.readFileSync(personalFile(root),'utf8'),body);
});
test('real provider MCP writes, refreshes, reloads and isolates project skills without worker or terminal grant',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-project-skills-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let current={provider:'codex',threadId:'chat-a',projectId:'project-a',taskId:null,environmentId:null,inputRoot:null};let store=new ProjectSkills({root:path.join(root,'config','project-skills'),current:()=>current});
 const server=new TerminalMcp({terminal:{tools:()=>[],callTool:()=>{throw Error('No shell grant');}},projectSkills:store});await server.start();t.after(()=>server.close());
 async function bind(){server.bindProviderContext('codex',Object.fromEntries(['threadId','projectId','taskId','environmentId','inputRoot'].map(k=>[k,current[k]])));return server.providerConnection('codex');}let connection=await bind();
 async function rpc(method,params){const r=await fetch(connection.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+connection.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});assert.equal(r.status,200);return (await r.json()).result;}
 async function call(name,args={}){const result=await rpc('tools/call',{name,arguments:args});assert.equal(result.isError,false,JSON.stringify(result));return JSON.parse(result.content[0].text);}
 assert.deepEqual((await rpc('tools/list')).tools.map(x=>x.name),['project_skill_catalog','read_project_skill','write_project_skill']);assert.deepEqual((await call('project_skill_catalog')).skills,[]);
 const saved=await call('write_project_skill',{name:'local-analysis',body,expected_sha256:null});assert.equal(saved.body,body);assert.equal((await call('project_skill_catalog')).skills[0].sha256,saved.sha256);assert.equal((await call('read_project_skill',{name:'local-analysis'})).body,body);
 store=new ProjectSkills({root:path.join(root,'config','project-skills'),current:()=>current});server.projectSkills=store;assert.equal((await call('read_project_skill',{name:'local-analysis'})).body,body);
 const updated=await call('write_project_skill',{name:'local-analysis',body:body+'Refreshed instructions.\n',expected_sha256:saved.sha256});assert.notEqual(updated.sha256,saved.sha256);
 let failure=await rpc('tools/call',{name:'write_project_skill',arguments:{name:'local-analysis',body,expected_sha256:saved.sha256}});assert.equal(failure.isError,true);
 current={...current,threadId:'chat-b',projectId:'project-b'};connection=await bind();assert.deepEqual((await call('project_skill_catalog')).skills,[]);
 for(const name of ['../escape','C:\\credentials','../../project-a']){failure=await rpc('tools/call',{name:'read_project_skill',arguments:{name}});assert.equal(failure.isError,true);}
 current={...current,threadId:'chat-c',projectId:'project-a'};connection=await bind();assert.equal((await call('read_project_skill',{name:'local-analysis'})).body,updated.body);
 const scope={...current,checkCurrent:()=>true};assert.throws(()=>store.call('project_skill_catalog',{project_id:'project-b'},scope),/arguments/);assert.throws(()=>store.call('project_skill_catalog',{}, {...scope,threadId:'stale'}),/changed/);
 const file=path.join(store.directory(scope).target,'local-analysis','SKILL.md');fs.linkSync(file,path.join(root,'outside.md'));assert.throws(()=>store.call('read_project_skill',{name:'local-analysis'},scope),/Unsafe/);
});

test('worker proxy registers the same desktop tools for model providers without remote resource permission',async t=>{
 const {WorkerClient}=await import('../../agent/tools/worker-client.mjs');const root=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-worker-skills-'));const worker=new WorkerClient();worker.identity={kind:'ssh',version:3,connectionId:'fixture'};worker.connection={tokens:{mcp:'fixture-base'},transport:'fixture'};worker.setResourceUseGuard(()=>false);worker.setAuthoringGuard({before(){throw Error('Remote scientific access denied');}});
 let current;worker.setProjectSkills(new ProjectSkills({root,current:()=>current}));await worker.exposeTools({});t.after(()=>{worker.close();fs.rmSync(root,{recursive:true,force:true});});
 for(const provider of ['codex','kimi','qwen','deepseek','compatible']){current={provider,threadId:'chat',projectId:'owned-project',taskId:null,environmentId:null,inputRoot:null};worker.bindProviderContext(provider,Object.fromEntries(['threadId','projectId','taskId','environmentId','inputRoot'].map(k=>[k,current[k]])));const connection=worker.providerConnection(provider);const result=await fetch(connection.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+connection.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'project_skill_catalog',arguments:{}}})});assert.equal(result.status,200);assert.equal((await result.json()).result.isError,false);}
});

test('real junction escape is rejected and unbound conversations remain isolated',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-skill-boundary-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let current={provider:'codex',threadId:'one',projectId:null};const store=new ProjectSkills({root:path.join(root,'owned'),current:()=>current});let scope={...current,checkCurrent:()=>true};store.call('write_project_skill',{name:'local-analysis',body,expected_sha256:null},scope);current={...current,threadId:'two'};scope={...current,checkCurrent:()=>true};assert.deepEqual(store.call('project_skill_catalog',{},scope).skills,[]);const outside=path.join(root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'SKILL.md'),'PRIVATE');fs.symlinkSync(outside,path.join(store.directory(scope).target,'escape'),process.platform==='win32'?'junction':'dir');assert.throws(()=>store.call('read_project_skill',{name:'escape'},scope),/Unsafe/);assert.equal(fs.readFileSync(path.join(outside,'SKILL.md'),'utf8'),'PRIVATE');
});

test('failed new saves and interrupted legacy folders do not poison discovery',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-skill-recovery-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const current={provider:'codex',threadId:'chat',projectId:'project'};
 const scope={...current,checkCurrent:()=>true};
 const store=new ProjectSkills({root,current:()=>current});
 const target=store.directory(scope).target;
 assert.throws(()=>store.call('write_project_skill',{name:'local-analysis',body,expected_sha256:'a'.repeat(64)},scope),/revision/);
 assert.equal(fs.existsSync(path.join(target,'local-analysis')),false);
 fs.mkdirSync(path.join(target,'interrupted'));
 store.call('write_project_skill',{name:'local-analysis',body,expected_sha256:null},scope);
 assert.deepEqual(store.call('project_skill_catalog',{},scope).skills.map(entry=>entry.name),['local-analysis']);
 const repaired=body.replace('name: local-analysis','name: interrupted');
 store.call('write_project_skill',{name:'interrupted',body:repaired,expected_sha256:null},scope);
 assert.equal(store.call('project_skill_catalog',{},scope).skills.length,2);
});

test('metadata comes only from opening frontmatter and target name must agree',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-skill-metadata-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const current={provider:'codex',threadId:'chat',projectId:'project'};
 const scope={...current,checkCurrent:()=>true};
 const store=new ProjectSkills({root,current:()=>current});
 for(const invalid of [
  '---\nname: local-analysis\n---\ndescription: forged in body\n',
  '---\ndescription: valid description\n---\nname: local-analysis\n',
  'prefix\n'+body,
  body.replace('name: local-analysis','name: wrong'),
  body.replace('name: local-analysis','name: local-analysis\nname: local-analysis'),
 ]) assert.throws(()=>store.call('write_project_skill',{name:'local-analysis',body:invalid,expected_sha256:null},scope),/frontmatter/);
 assert.deepEqual(store.call('project_skill_catalog',{},scope).skills,[]);
 store.call('write_project_skill',{name:'local-analysis',body:body+'description: BODY SPOOF\n',expected_sha256:null},scope);
 assert.equal(store.call('project_skill_catalog',{},scope).skills[0].description,'User project analysis instructions');
});

test('all five providers can discover and read project skills in ordinary chat without worker or shell',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-skill-chat-'));
 let current;
 const store=new ProjectSkills({root,current:()=>current});
 const server=new TerminalMcp({terminal:{tools:()=>[],callTool(){throw Error('No shell');}},projectSkills:store});
 await server.start();
 t.after(()=>{server.close();fs.rmSync(root,{recursive:true,force:true});});
 for(const provider of ['codex','kimi','qwen','deepseek','compatible']){
  current={provider,threadId:'chat-'+provider,projectId:'same-project',taskId:null,environmentId:null,inputRoot:null};
  server.bindProviderContext(provider,Object.fromEntries(['threadId','projectId','taskId','environmentId','inputRoot'].map(key=>[key,current[key]])));
  const connection=server.providerConnection(provider);
  const rpc=async(method,params)=>{
   const response=await fetch(connection.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+connection.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
   assert.equal(response.status,200);
   return (await response.json()).result;
  };
  const inventory=await rpc('tools/list');
  assert.deepEqual(inventory.tools.map(tool=>tool.name),store.tools().map(tool=>tool.name));
  if(provider==='codex')assert.equal((await rpc('tools/call',{name:'write_project_skill',arguments:{name:'local-analysis',body,expected_sha256:null}})).isError,false);
  const read=await rpc('tools/call',{name:'read_project_skill',arguments:{name:'local-analysis'}});
  assert.equal(JSON.parse(read.content[0].text).body,body);
 }
});
