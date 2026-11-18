import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {DshBridge} from '../../agent/providers/dsh.mjs';
import {dshRuntime} from '../../desktop/platform/dsh-runtime.mjs';
import {ProjectSkills} from '../../agent/skills/project-skills.mjs';
import {fileURLToPath} from 'node:url';
import {ScientificSkills} from '../../agent/skills/scientific-skills.mjs';
import {workspaceAgentInstructions} from '../../agent/context/agent-settings.mjs';
import {TerminalMcp} from '../../agent/tools/terminal-mcp.mjs';

test('official DSH creates, reads and updates a personal skill in chat without a project, shell or worker', {timeout:60000}, async t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-dsh-local-skill-'));
 const saved = new Map(), children = [];
 let current = {provider:'deepseek',threadId:null,projectId:null};
 const cache = path.join(root,'user-cache');
 const store = new ProjectSkills({root:cache,current:()=>current});
 const bundledRoot=fileURLToPath(new URL('../../agent/builtin-skills/',import.meta.url));
 const map=JSON.parse(fs.readFileSync(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8'));
 const scientificSkills=new ScientificSkills({map,bundledRoot,sources:()=>[],settings:()=>({}),setupAllowed:()=>false});
 fs.writeFileSync(path.join(root,'AGENTS.md'),'Consult the local-analysis skill for this workspace.');
 const instructions=workspaceAgentInstructions({directory:root});
 const endpoint = new TerminalMcp({terminal:{tools:()=>[]},projectSkills:store,scientificSkills});
 await endpoint.start();

 const name = 'local-analysis';
 const body = '---\nname: local-analysis\ndescription: Local skills regression\n---\nCheck the selected data.\n';
 const sha256 = value => createHash('sha256').update(value).digest('hex');
 const scope = {scope:'user'};
 const steps = [
  ['project_skill_catalog',scope],
  ['write_project_skill',{...scope,name,body,expected_sha256:null}],
  ['read_project_skill',{...scope,name}],
  ['write_project_skill',{...scope,name,body:body+'Verify.\n',expected_sha256:sha256(body)}],
  ['read_project_skill',{...scope,name}],
  ['scientific_skill_catalog',{}],
  ['read_scientific_skill',{function_id:'environment.probe'}],
 ];
 const packets = [];
 const model = createServer(async (req,res) => {
  let data=''; for await (const chunk of req) data+=chunk;
  const index=packets.length;
  packets.push(JSON.parse(data));
  const step=steps[index];
  const events=[
   {type:'message_start',message:{id:'reply-'+index,type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:12,output_tokens:0}}},
   {type:'content_block_start',index:0,content_block:step?{type:'tool_use',id:'skill-'+index,name:'mcp__gpusampling__'+step[0],input:{}}:{type:'text',text:''}},
   {type:'content_block_delta',index:0,delta:step?{type:'input_json_delta',partial_json:JSON.stringify(step[1])}:{type:'text_delta',text:'Local skill checked'}},
   {type:'content_block_stop',index:0},
   {type:'message_delta',delta:{stop_reason:step?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:3}},
   {type:'message_stop'},
  ];
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.end(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''));
 });
 await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
 const bridge=new DshBridge({
  root,instructions,catalog:{get:(k,id)=>saved.get(k+':'+id),put:(k,id,v)=>saved.set(k+':'+id,structuredClone(v))},
  credential:()=>({apiKey:'local-test'}),worker:()=>endpoint.providerConnection('deepseek'),
  fetchApi:async()=>Response.json({data:[{id:'deepseek-flash'}]}),
  host:{...dshRuntime,prepare(...args){
   const profile=dshRuntime.prepare(...args);
   profile.env.DEEPSEEK_BASE_URL='http://127.0.0.1:'+model.address().port;
   return profile;
  },spawn(...args){const child=dshRuntime.spawn(...args);children.push(child);return child;}},
 });
 t.after(async()=>{
  bridge.close();
  await Promise.all(children.map(child=>child.exitCode!==null||child.signalCode!==null?null:new Promise(resolve=>child.once('close',resolve))));
  model.closeAllConnections();await new Promise(resolve=>model.close(resolve));endpoint.close();
  fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 });
 await bridge.start();
 const started=await bridge.request('thread/start');
 current={...current,threadId:started.thread.id};
 endpoint.bindProviderContext('deepseek',{threadId:current.threadId});
 const done=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('DSH skill turn timed out')),25000);
  const listener=e=>{if(e.method==='turn/completed'){clearTimeout(timer);bridge.off('event',listener);resolve(e.params.turn);}};
  bridge.on('event',listener);t.after(()=>{clearTimeout(timer);bridge.off('event',listener);});
 });
 await bridge.request('turn/start',{threadId:current.threadId,input:[{type:'text',text:'Save the local skill, check its revision, then find the public guide for inspecting my compute environment.'}]});
 assert.equal((await done).status,'completed');
 assert.equal(packets.length,steps.length+1);
 const first=packets[0],system=Array.isArray(first.system)?first.system.map(block=>block.text).join('\n'):first.system;
 assert(system.includes(instructions),'First DeepSeek system packet must carry the packaged core and the workspace index');
 assert.match(system,/写到本机工作区.*scope="user"/);
 const tools=first.tools.map(tool=>tool.name.replace(/^mcp__gpusampling__/, ''));
 for(const name of ['project_skill_catalog','read_project_skill','write_project_skill','scientific_skill_catalog','read_scientific_skill'])assert(tools.includes(name),name);
 assert(!tools.includes('submit_run'));
 const entry='studio-compute-workflow/SKILL.md';
 const heading=fs.readFileSync(path.join(bundledRoot,entry),'utf8').split(/\r?\n/).find(line=>line.startsWith('# '));
 assert(heading);assert(!JSON.stringify(first).includes(heading),'A new chat starts from the index');
 const result=JSON.stringify(packets.at(-1).messages.at(-1));
 assert(result.includes(heading));assert(result.includes(entry));assert(result.includes('passed'));
 const items=bridge.session(current.threadId).turns[0].items.filter(item=>item.type==='mcpToolCall');
 assert.equal(items.length,steps.length);
 for(const item of items){assert.equal(item.status,'completed');assert.equal(item.result.isError,false);}
 for(const [index,expected] of [[2,body],[3,body],[4,body+'Verify.\n'],[5,body+'Verify.\n']]){
  assert(JSON.stringify(packets[index].messages.at(-1)).includes(sha256(expected)));
 }
 const file=path.join(cache,'user',name,'SKILL.md');
 assert.equal(JSON.parse(items[0].result.content[0].text).directory,path.dirname(path.dirname(file)));
 for(const item of items.slice(1,5))assert.equal(JSON.parse(item.result.content[0].text).path,file);
 assert.equal(fs.readFileSync(file,'utf8'),body+'Verify.\n');
});
