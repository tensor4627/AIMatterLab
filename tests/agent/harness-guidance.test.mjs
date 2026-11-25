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
import {ScientificSkills} from '../../agent/skills/scientific-skills.mjs';
import {fileURLToPath} from 'node:url';

// The shipped 0.2.7 runtime guide, independent of future edits to the current guide.
const runtimeGuide027=[
 '# AIMatterLab runtime',
 '',
 "You are the scientific computing assistant in AIMatterLab. Answer in the user's language. The workbench covers chat and model accounts, structures and results, workflow planning, tool packages, compute environments, terminals and run monitoring.",
 '',
 '## Tool onboarding and configuration',
 '',
 "Onboarding records a versioned definition: input/output ports, runtime requirements, a minimal test, usage and program source. Configuration selects a real environment, checks that definition's case and records the result. For an activated tool, bind the workflow to its verified version and target. Distinguish a listed source, checked definition, native adapter and target test receipt. Report the exact function, environment and observed outputs.",
 '',
 '## Find the relevant skill',
 '',
 'Match the first user message and each change of intent. Use a guide already attached for the current stage. Otherwise look up the relevant function in `scientific_skill_catalog`, call `read_scientific_skill` with that function_id, then fetch only the needed reference by its exact advertised document_id.',
 '',
 '- App pages, buttons, accounts and bugs → `product.workbench`. Use its workbench and source guides. Verify the UI, dispatch or worker behavior at the matching revision in the [AIMatterLab repository](https://github.com/tensor4627/AIMatterLab).',
 '- “查一下 HotHam” or another package → `software.catalog` and `search_software_docs` with its name. Use the returned commit and guide. HotHam learns electronic Hamiltonians. HotPP fits interatomic potentials. A lookup can be answered directly.',
 "- User package or script definition → `tool.onboarding`. Follow the versioned package or source declaration and the desktop's selection. To configure and test an acquired SSH target use `cluster.resource-tools`. For desktop installation and first launch use `installation.readiness`.",
 '- Science → structure/import (`structure.ase`, `structure.materials-project`), inputs/previews (`assets.inspect-register`, `viewer.structure-trajectory`), MD/sampling (`md.pydyn`, `sampling.gpumd`, `pygas.cv`), paths (`neb.gpumd`), training (`training.nep`, `training.hotpp`), and analysis (`analysis.number-density`, `analysis.wtmetad`, `analysis.opes`). Match structure, units, model format and outputs to the requested method.',
 '- Workflow → plan outputs with `workflow.roadmap` and author existing inputs with `workflow.authoring`. Use `compute.queue` for queues, `environment.probe` for runtime evidence and `cluster.lsf-slurm-deployment` for independent jobs. When requested, select restricted setup guidance using 科学资源与技能 → 用于下条消息.',
 '',
 '## Local knowledge',
 '',
 'Follow the AGENTS.md links in `project_skill_catalog({})` for relevant local guidance. `scope="current"` means the bound project or unbound chat. Keep scientific selections and artifact references there. Keep resource/account notes and activation-issued execution skills under `scope="resource"` with the acquired resource ID. Use `read_session_workspace` for the actual run directory. Read and write ordinary skills with `read_project_skill` and `write_project_skill` in the same scope and verify the saved revision.',
 '',
 '## Operating scope',
 '',
 'Ordinary chat can acquire resources, inspect queues, configure environments and submit an explicitly delegated independent job. Prefer planning for reusable workflows. Update existing workflows in place.',
 '',
 'Use list_compute_resources and acquire_compute_resource with one selector. Match a name or a short follow-up to its listed resource ID. Ask if ambiguous. Use access="command" for short SSH work, access="service" for the worker, or access="terminal" for a shell. Call run_compute_command with a stable request_id. Current receipts supersede old handoff advice. Recover the original live SSH session first.',
 '',
 'Attachments supply reference data. Cite evidence with its source, revision and line range. Chat uploads do not register inputs or grant file access.',
 '',
 'Honor draft-only, no-build, no-run and stop requests. Use current project and resource grants. Shell and job-service grants are separate. Humans authenticate. A reply stop leaves submitted jobs under run controls. After a stop or branch, check original run or request IDs. Inspect an unknown operation without replaying it.',
 '',
 '“写到本机工作区” uses `scope="user"` at `project_skill_catalog({"scope":"user"}).directory` (default `user-cache/skills/user/`). For conflicting steps, name both skills and ask the user to choose.'
].join('\n');

test('ACP profiles deliver the same bounded AIMatterLab core and progressive skill routing',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-harness-guidance-'));
 try{
  const document=fs.readFileSync(new URL('../../agent/context/AGENTS.md',import.meta.url),'utf8').replaceAll('\r\n','\n').trim();
  assert.equal(STUDIO_INSTRUCTIONS,document);
  assert(Buffer.byteLength(document)<4608, 'Keep detailed procedures in focused references');
  assert.match(document,/first user message/);assert.match(document,/exact advertised document_id/);
  assert.match(document,/draft-only, no-build, no-run and stop/);assert.match(document,/Shell and job-service grants are separate/);
  assert.match(document,/Inspect an unknown operation without replaying it/);
  assert.match(document,/Ordinary chat can .*independent job/);
  assert.match(document,/acquire_compute_resource with one selector/);
  assert.match(document,/access="command" for short SSH work, access="service" for the worker, or access="terminal" for a shell/);
  assert.match(document,/run_compute_command with a stable request_id/);
  assert.match(document,/a short follow-up.*listed resource ID/);
  assert.match(document,/Current receipts supersede old handoff advice/);
  assert.match(document,/Recover the original live SSH session first/);
  assert.match(document,/user-local third-party tool with `tool\.onboarding` in `scope="user"`/);
  assert.match(document,/Configure and test on the user's real target with `cluster\.resource-tools` in `scope="resource"`/);
  assert.match(document,/A listed source does not mean the tool is configured on the target/);
  assert.match(document,/A single-tool test does not establish group compatibility/);
  assert.match(document,/Report untested state as `not_run` or `blocked`/);
  for (const anchor of ['installation/tool-sources.json', 'contracts/tools/engine-contracts.json', 'contracts/tools/tool-package.schema.json', 'docs/software-specification.md']) {
   assert.ok(document.includes('`'+anchor+'`'), 'Missing runtime source anchor '+anchor);
  }
  const map=JSON.parse(fs.readFileSync(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8'));
  const routes=[...document.matchAll(/`([a-z]+\.[a-z.-]+)`/g)].map(match=>match[1]);
  assert(routes.length>=12);assert(routes.every(id=>map.functions.some(route=>route.id===id)));
  for (const entry of ['product.workbench', 'software.catalog', 'cluster.resource-tools']) assert(routes.includes(entry));
  const kimi=prepareProfile(root,'kimi'),qwen=prepareProfile(root,'qwen');
  assert.equal(fs.readFileSync(path.join(kimi.home,'SYSTEM.md'),'utf8'),STUDIO_INSTRUCTIONS);
  assert.equal(qwen.args[qwen.args.indexOf('--append-system-prompt')+1],STUDIO_INSTRUCTIONS);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('the installed workspace contributes its own short index once and falls back safely',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-workspace-index-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const file=path.join(directory,'AGENTS.md'),read=()=>workspaceAgentInstructions({directory});
 const location=path.join(directory,'研究 $&','user');
 const located=()=>workspaceAgentInstructions({directory},location);
 assert.ok(located().includes(JSON.stringify(location)));
 assert.ok(workspaceAgentInstructions(null,location).includes(JSON.stringify(location)));
 assert.equal(workspaceAgentInstructions(null),STUDIO_INSTRUCTIONS);assert.equal(read(),STUDIO_INSTRUCTIONS);
 fs.writeFileSync(file,STUDIO_INSTRUCTIONS.replaceAll('\n','\r\n')+'\r\n');assert.equal(read(),STUDIO_INSTRUCTIONS);
 const extra='For diffraction lookup the powder-indexing skill.';
 fs.writeFileSync(file,STUDIO_INSTRUCTIONS+'\n'+extra);assert.equal(read(),STUDIO_INSTRUCTIONS+'\n\n## Local workspace AGENTS.md\n\n'+extra);
 const previous=STUDIO_INSTRUCTIONS.slice(0,STUDIO_INSTRUCTIONS.lastIndexOf('\n\n'));
 fs.writeFileSync(file,previous+'\n\n'+extra);
 assert.equal(read(),STUDIO_INSTRUCTIONS+'\n\n## Local workspace AGENTS.md\n\n'+extra);
 fs.writeFileSync(file,runtimeGuide027+'\n');
 assert.equal(read(),STUDIO_INSTRUCTIONS);
 fs.writeFileSync(file,runtimeGuide027.replaceAll('\n','\r\n')+'\r\n\r\n'+extra);
 assert.equal(read(),STUDIO_INSTRUCTIONS+'\n\n## Local workspace AGENTS.md\n\n'+extra);
 const installedGuide=fs.readFileSync(new URL('../../installation/workspace-guide.md',import.meta.url),'utf8').trim();
 fs.writeFileSync(file,installedGuide+'\n');
 assert.equal(read(),STUDIO_INSTRUCTIONS);
 fs.writeFileSync(file,installedGuide.replaceAll('\n','\r\n')+'\r\n\r\n'+extra);
 assert.equal(read(),STUDIO_INSTRUCTIONS+'\n\n## Local workspace AGENTS.md\n\n'+extra);
 assert.match(fs.readFileSync(file,'utf8'),/# AIMatterLab 工作区/);
 fs.writeFileSync(file,installedGuide.replace('AIMatterLab 工作区','My custom guide')+'\n\n'+extra);
 assert.match(read(),/My custom guide/);
 assert.ok(located().includes(JSON.stringify(location)));assert.ok(located().endsWith(extra));
 fs.writeFileSync(file,'x'.repeat(8193));assert.equal(read(),STUDIO_INSTRUCTIONS);
 assert.ok(located().includes(JSON.stringify(location)));
 fs.writeFileSync(file,'private text');fs.linkSync(file,path.join(directory,'other.md'));assert.equal(read(),STUDIO_INSTRUCTIONS);
});

test('Codex login threads receive the same AIMatterLab core through the main-owned instruction path',async()=>{
 const codex=new EventEmitter(),calls=[];codex.process={};codex.close=()=>{};
 codex.request=async(method,params)=>{calls.push({method,params});return {thread:{id:'fixture',turns:[]}};};
 const instructions=STUDIO_INSTRUCTIONS+'\nLocal index';
 const hub=new AgentHub({codex,instructions,root:os.tmpdir(),catalog:{get:()=>null,put:()=>{},list:()=>[]},vault:{get:()=>null},settings:()=>({}),worker:()=>null});
 try{
  await hub.rpc('codex','thread/start');
  assert.equal(calls[0].params.developerInstructions,instructions);
  const moved=workspaceAgentInstructions(null,path.join(os.tmpdir(),'moved cache','user'));
  hub.updateInstructions(moved);await hub.rpc('codex','thread/start');
  assert.equal(calls.at(-1).params.developerInstructions,moved);
 }finally{hub.close();}
});
test('public compute references advertised by selected skills have focused routes without eager bodies or setup bypass',async()=>{
 const map=JSON.parse(fs.readFileSync(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8'));
 let setup=false;const router=new ScientificSkillRouter({map,sourceRoot:source=>source==='studio'?fileURLToPath(new URL('../../agent/builtin-skills',import.meta.url)):undefined,consent:()=>false,setupAllowed:()=>setup});
 const entry=await router.read('compatible','environment.probe');assert.equal(entry.status,'passed');assert.equal(entry.attachments.length,1);assert(entry.document_ids.includes('studio-compute-workflow/references/compute-discovery.md'));assert(!entry.attachments.some(item=>item.name.endsWith('compute-discovery.md')));
 const detail=await router.read('compatible','environment.probe','studio-compute-workflow/references/compute-discovery.md');assert.equal(detail.status,'passed');assert.equal(detail.attachments.length,1);
 const doc='studio-compute-workflow/references/job-service-connection.md';assert.equal((await router.read('deepseek','cluster.connection-setup',doc)).status,'blocked');setup=true;assert.equal((await router.read('deepseek','cluster.connection-setup',doc)).status,'passed');
 await assert.rejects(router.read('deepseek','compute.queue',doc),/exact document_id/);
});

test('compute.queue reads the current leased-resource guidance in ordinary chat',async()=>{
 const map=JSON.parse(fs.readFileSync(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8'));
 const bundledRoot=fileURLToPath(new URL('../../agent/builtin-skills',import.meta.url));
 const service=new ScientificSkills({map,bundledRoot,sources:()=>[],settings:()=>({})});
 const scope={provider:'deepseek'};
 const catalog=await service.call('scientific_skill_catalog',{},scope);
 const queue=catalog.functions.find(route=>route.id==='compute.queue');
 assert.equal(queue.phase,'discovery');
 assert.deepEqual(queue.tools.slice(0,4),['list_compute_resources','acquire_compute_resource','run_compute_command','inspect_compute_service']);
 const args={function_id:queue.id};
 const entry=await service.call('read_scientific_skill',args,scope);
 assert.equal(entry.status,'passed');
 assert.match(entry.text,/using exactly one selector/);
 assert.match(entry.text,/probe_scheduler: true/);
 assert.match(entry.text,/access: "command".*short operations on a hosted SSH resource/);
 assert.match(entry.text,/run_compute_command.*resource_id.*request_id/);
 assert.match(entry.text,/gateway node selection.*selected node's shell.*登录完成，交由 AIMatterLab 管理/);
 assert.match(entry.text,/short follow-up.*resource_id/);
 assert.match(entry.text,/submit an explicitly delegated independent job/);
 assert.doesNotMatch(entry.text,/requires task planning|restores eligible leases for their original conversations/);
 const discovery='studio-compute-workflow/references/compute-discovery.md';
 const recovery='studio-compute-workflow/references/connection-recovery.md';
 assert(entry.document_ids.includes(discovery));
 assert(entry.document_ids.includes(recovery));
 assert(!entry.attachments.some(file=>[discovery,recovery].includes(file.name)));
 const result=await service.call('read_scientific_skill',{...args,document_id:discovery},scope);
 assert.equal(result.status,'passed');
 assert.match(result.text,/bounded read-only scheduler probe in ordinary chat/);
 assert.match(result.text,/commandAvailable.*run_compute_command.*stable.*request_id/);
 assert.match(result.text,/same-resource service retry/);
 assert.match(result.text,/DeepSeek presents eligible .choice_required. candidates in the chat input area/);
 assert.match(result.text,/unanswered .choice_required. candidates, ask which one in this chat/);
 assert.match(result.text,/requires no desktop panel binding/);
 assert.match(result.text,/Include.*resource_id.*profile_id.*for duplicate display names/);
 assert.match(result.text,/Only an acquired terminal with its session receipt establishes a shell/);
 assert.match(result.text,/two-factor prompts in the connection's private terminal/);
 const recoveryResult=await service.call('read_scientific_skill',{...args,document_id:recovery},scope);
 assert.equal(recoveryResult.status,'passed');
 assert.match(recoveryResult.text,/terminal_unavailable.*leaseStatus/);
 assert.match(recoveryResult.text,/live SSH terminal restores the same verified channel/);
 assert.match(recoveryResult.text,/original sign-in is pending, continue that attempt/);
 assert.match(recoveryResult.text,/enter authentication responses only in the private terminal/);
 assert.match(recoveryResult.text,/confirmed lost.*重新登录.*same saved profile/);
 assert.match(recoveryResult.text,/verifies the remote host, account and workspace/);
 assert.match(recoveryResult.text,/restores eligible leases for their original conversations/);
 const deployment=await service.call('read_scientific_skill',{function_id:'cluster.lsf-slurm-deployment'},scope);
 assert.match(deployment.text,/A visual workflow is optional for independent jobs/);
});

test('every compute workflow route advertises and reads the connection recovery reference',async t=>{
 const map=JSON.parse(fs.readFileSync(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8'));
 const bundledRoot=fileURLToPath(new URL('../../agent/builtin-skills',import.meta.url));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-recovery-guidance-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const gpumdSkill=path.join(root,'agents','skills','gpumd-gpu-sampling-wsl');
 fs.mkdirSync(gpumdSkill,{recursive:true});
 fs.writeFileSync(path.join(gpumdSkill,'SKILL.md'),'# GPUMD test guidance\n');
 const scope={provider:'deepseek'};
 const service=new ScientificSkills({map,bundledRoot,sources:()=>[{id:'gpumd',root}],
  settings:()=>({scientificSkillProviders:{gpumd:[scope.provider]}}),setupAllowed:()=>true});
 const document_id='studio-compute-workflow/references/connection-recovery.md';
 const expected=fs.readFileSync(path.join(bundledRoot,document_id),'utf8');
 for(const {id:function_id} of map.functions.filter(route=>route.skills.includes('studio-compute-workflow'))){
  const entry=await service.call('read_scientific_skill',{function_id},scope);
  assert.equal(entry.status,'passed',entry.reason||function_id);
  assert(entry.document_ids.includes(document_id),function_id);
  const focused=await service.call('read_scientific_skill',{function_id,document_id},scope);
  assert.equal(focused.status,'passed',focused.reason||function_id);
  assert.equal(focused.attachments.length,1,function_id);
  assert.equal(focused.attachments[0].name,document_id,function_id);
  assert.equal(focused.text,expected,function_id);
 }
});

test('workflow preparation exposes only the focused authoring and graph receipts for the selected stage',async()=>{
 const map=JSON.parse(fs.readFileSync(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8'));
 const bundledRoot=fileURLToPath(new URL('../../agent/builtin-skills',import.meta.url));
 const service=new ScientificSkills({map,bundledRoot,sources:()=>[],settings:()=>({})});
 const scope={provider:'deepseek'};
 const read=(function_id,document_id)=>service.call('read_scientific_skill',{function_id,...document_id&&{document_id}},scope);
 const graph='studio-workflow-authoring/references/pygas-graphs.md';
 const receipts='studio-workflow-roadmap/references/execution-receipts.md';
 const overview=await read('workflow.orchestrate');
 const author=await read('workflow.authoring');
 const roadmap=await read('workflow.roadmap');
 for(const result of [overview,author,roadmap]) assert.equal(result.status,'passed');
 assert(author.document_ids.includes(graph));
 assert.deepEqual(author.attachments.map(item=>item.name),['studio-workflow-authoring/SKILL.md']);
 assert(roadmap.document_ids.includes(receipts));
 assert.deepEqual(roadmap.attachments.map(item=>item.name),['studio-workflow-roadmap/SKILL.md']);
 await assert.rejects(read('workflow.roadmap',graph),/exact document_id/);
 await assert.rejects(read('workflow.authoring',receipts),/exact document_id/);
 const graphGuide=await read('workflow.authoring',graph);
 const runGuide=await read('workflow.roadmap',receipts);
 assert.match(graphGuide.text,/_node_ports/);
 assert.match(graphGuide.text,/graph.settings.atoms_path/);
 assert.match(runGuide.text,/frozen producer step and port/);
 assert.match(runGuide.text,/SHA-256/);
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
