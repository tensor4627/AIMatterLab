import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {STUDIO_INSTRUCTIONS,workspaceAgentInstructions} from '../../agent/context/agent-settings.mjs';
import {prepareProfile} from '../../desktop/platform/provider-runtime.mjs';
import {AgentHub} from '../../agent/providers/agent-hub.mjs';
import {ScientificSkillRouter} from '../../agent/skills/scientific-skill-router.mjs';
import {fileURLToPath} from 'node:url';

test('ACP profiles deliver the same bounded AIMatterLab core and progressive skill routing',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-harness-guidance-'));
 try{
  const document=fs.readFileSync(new URL('../../agent/context/AGENTS.md',import.meta.url),'utf8').replaceAll('\r\n','\n').trim();
  assert.equal(STUDIO_INSTRUCTIONS,document);
  assert(Buffer.byteLength(document)<2500);
  assert.match(document,/first user message/);assert.match(document,/exact advertised document_id/);
  assert.match(document,/draft-only, no-build, no-run and stop/);assert.match(document,/Shell and job-service grants are separate/);
  assert.match(document,/Inspect an unknown operation without replaying it/);
  const map=JSON.parse(fs.readFileSync(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8'));
  const routes=[...document.matchAll(/`([a-z]+\.[a-z.-]+)`/g)].map(match=>match[1]);
  assert(routes.length>=12);assert(routes.every(id=>map.functions.some(route=>route.id===id)));
  const kimi=prepareProfile(root,'kimi'),qwen=prepareProfile(root,'qwen');
  assert.equal(fs.readFileSync(path.join(kimi.home,'SYSTEM.md'),'utf8'),STUDIO_INSTRUCTIONS);
  assert.equal(qwen.args[qwen.args.indexOf('--append-system-prompt')+1],STUDIO_INSTRUCTIONS);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('the installed workspace contributes its own short index once and falls back safely',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-workspace-index-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const file=path.join(directory,'AGENTS.md'),read=()=>workspaceAgentInstructions({directory});
 assert.equal(workspaceAgentInstructions(null),STUDIO_INSTRUCTIONS);assert.equal(read(),STUDIO_INSTRUCTIONS);
 fs.writeFileSync(file,STUDIO_INSTRUCTIONS.replaceAll('\n','\r\n')+'\r\n');assert.equal(read(),STUDIO_INSTRUCTIONS);
 const extra='For diffraction lookup the powder-indexing skill.';
 fs.writeFileSync(file,STUDIO_INSTRUCTIONS+'\n'+extra);assert.equal(read(),STUDIO_INSTRUCTIONS+'\n\n## Local workspace AGENTS.md\n\n'+extra);
 fs.writeFileSync(file,'x'.repeat(8193));assert.equal(read(),STUDIO_INSTRUCTIONS);
 fs.writeFileSync(file,'private text');fs.linkSync(file,path.join(directory,'other.md'));assert.equal(read(),STUDIO_INSTRUCTIONS);
});

test('Codex login threads receive the same AIMatterLab core through the main-owned instruction path',async()=>{
 const codex=new EventEmitter(),calls=[];codex.process={};codex.close=()=>{};
 codex.request=async(method,params)=>{calls.push({method,params});return {thread:{id:'fixture',turns:[]}};};
 const instructions=STUDIO_INSTRUCTIONS+'\nLocal index';
 const hub=new AgentHub({codex,instructions,root:os.tmpdir(),catalog:{get:()=>null,put:()=>{},list:()=>[]},vault:{get:()=>null},settings:()=>({}),worker:()=>null});
 try{await hub.rpc('codex','thread/start');assert.equal(calls[0].params.developerInstructions,instructions);}finally{hub.close();}
});
test('public compute references advertised by selected skills have focused routes without eager bodies or setup bypass',async()=>{
 const map=JSON.parse(fs.readFileSync(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8'));
 let setup=false;const router=new ScientificSkillRouter({map,sourceRoot:source=>source==='studio'?fileURLToPath(new URL('../../agent/builtin-skills',import.meta.url)):undefined,consent:()=>false,setupAllowed:()=>setup});
 const entry=await router.read('compatible','environment.probe');assert.equal(entry.status,'passed');assert.equal(entry.attachments.length,1);assert(entry.document_ids.includes('studio-compute-workflow/references/compute-discovery.md'));assert(!entry.attachments.some(item=>item.name.endsWith('compute-discovery.md')));
 const detail=await router.read('compatible','environment.probe','studio-compute-workflow/references/compute-discovery.md');assert.equal(detail.status,'passed');assert.equal(detail.attachments.length,1);
 const doc='studio-compute-workflow/references/job-service-connection.md';assert.equal((await router.read('deepseek','cluster.connection-setup',doc)).status,'blocked');setup=true;assert.equal((await router.read('deepseek','cluster.connection-setup',doc)).status,'passed');
 await assert.rejects(router.read('deepseek','compute.queue',doc),/exact document_id/);
});

test('project skill guidance reaches generated Kimi/Qwen/DSH profiles and DSH chat policy',async t=>{
 const {prepareDshProfile}=await import('../../desktop/platform/dsh-runtime.mjs');
 const {dshToolAllowed}=await import('../../agent/providers/dsh-policy.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-project-skill-profiles-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const name of ['project_skill_catalog','read_project_skill','write_project_skill'])assert.match(STUDIO_INSTRUCTIONS,new RegExp(name));
 assert.match(STUDIO_INSTRUCTIONS,/user-cache\/skills\/user/);
 assert.match(STUDIO_INSTRUCTIONS,/read_project_skill/);
 assert(!STUDIO_INSTRUCTIONS.includes('expected_sha256'),'Write mechanics belong to the tool schema');
 const kimi=prepareProfile(root,'kimi'),qwen=prepareProfile(root,'qwen');
 assert.match(fs.readFileSync(path.join(kimi.home,'SYSTEM.md'),'utf8'),/project_skill_catalog/);
 assert.match(qwen.args[qwen.args.indexOf('--append-system-prompt')+1],/write_project_skill/);
 const dsh=prepareDshProfile(root,{mcpModule:'file:///fixture/mcp.mjs',toolsModule:'file:///fixture/tools.mjs'},null,STUDIO_INSTRUCTIONS);
 const profile=JSON.parse(fs.readFileSync(path.join(dsh.home,'profiles','studio','cordis.patch.yml'),'utf8'));
 assert.equal(profile[0].insert.find(entry=>entry.id==='studio-policy').config.instructions,STUDIO_INSTRUCTIONS);
 for(const name of ['project_skill_catalog','read_project_skill','write_project_skill'])assert.equal(dshToolAllowed(name,false),true);
 assert.equal(dshToolAllowed('submit_run',false),false);
});
