import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {STUDIO_INSTRUCTIONS} from '../../agent/context/agent-settings.mjs';
import {prepareProfile} from '../../desktop/platform/provider-runtime.mjs';
import {AgentHub} from '../../agent/providers/agent-hub.mjs';
import {ScientificSkillRouter} from '../../agent/skills/scientific-skill-router.mjs';
import {fileURLToPath} from 'node:url';

test('ACP profiles deliver the same bounded AIMatterLab core and progressive skill routing',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-harness-guidance-'));
 try{
  // The independent SSH channels need a provider-neutral permission paragraph;
  // procedures still belong in progressively loaded skills, not this kernel.
  assert(Buffer.byteLength(STUDIO_INSTRUCTIONS)<6000);
  assert.match(STUDIO_INSTRUCTIONS,/scientific_skill_catalog/);
  assert.match(STUDIO_INSTRUCTIONS,/exact advertised document_id/);
  assert.match(STUDIO_INSTRUCTIONS,/One delegation can cover editing.*repairing dependencies.*running/);
  assert.match(STUDIO_INSTRUCTIONS,/Honor explicit draft-only, no-build, no-run and stop requests/);
  assert.doesNotMatch(STUDIO_INSTRUCTIONS,/STOP.*Confirm and Execute|Never validate, build, train, launch or submit/);
  assert.match(STUDIO_INSTRUCTIONS,/independent shell and job-service channels/);
  assert.match(STUDIO_INSTRUCTIONS,/Their Agent grants are separate/);
  assert.match(STUDIO_INSTRUCTIONS,/returning one grant does not close the other channel or cancel jobs/);
  assert.match(STUDIO_INSTRUCTIONS,/inspect_compute_resource with probe_scheduler:true/);
  assert.match(STUDIO_INSTRUCTIONS,/never automatically reconnect, update the service or replay unknown requests/);
  const kimi=prepareProfile(root,'kimi'),qwen=prepareProfile(root,'qwen');
  assert.equal(fs.readFileSync(path.join(kimi.home,'SYSTEM.md'),'utf8'),STUDIO_INSTRUCTIONS);
  assert.equal(qwen.args[qwen.args.indexOf('--append-system-prompt')+1],STUDIO_INSTRUCTIONS);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Codex login threads receive the same AIMatterLab core through the main-owned instruction path',async()=>{
 const codex=new EventEmitter(),calls=[];codex.process={};codex.close=()=>{};
 codex.request=async(method,params)=>{calls.push({method,params});return {thread:{id:'fixture',turns:[]}};};
 const hub=new AgentHub({codex,root:os.tmpdir(),catalog:{get:()=>null,put:()=>{},list:()=>[]},vault:{get:()=>null},settings:()=>({}),worker:()=>null});
 try{await hub.rpc('codex','thread/start');assert.equal(calls[0].params.developerInstructions,STUDIO_INSTRUCTIONS);}finally{hub.close();}
});
test('public compute references advertised by selected skills have focused routes without eager bodies or setup bypass',async()=>{
 const map=JSON.parse(fs.readFileSync(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8'));
 let setup=false;const router=new ScientificSkillRouter({map,sourceRoot:source=>source==='studio'?fileURLToPath(new URL('../../agent/builtin-skills',import.meta.url)):undefined,consent:()=>false,setupAllowed:()=>setup});
 const entry=await router.read('compatible','environment.probe');assert.equal(entry.status,'passed');assert.equal(entry.attachments.length,1);assert(entry.document_ids.includes('studio-compute-workflow/references/compute-discovery.md'));assert(!entry.attachments.some(item=>item.name.endsWith('compute-discovery.md')));
 const detail=await router.read('compatible','environment.probe','studio-compute-workflow/references/compute-discovery.md');assert.equal(detail.status,'passed');assert.equal(detail.attachments.length,1);
 const doc='studio-compute-workflow/references/job-service-connection.md';assert.equal((await router.read('deepseek','cluster.connection-setup',doc)).status,'blocked');setup=true;assert.equal((await router.read('deepseek','cluster.connection-setup',doc)).status,'passed');
 await assert.rejects(router.read('deepseek','compute.queue',doc),/exact document_id/);
});
