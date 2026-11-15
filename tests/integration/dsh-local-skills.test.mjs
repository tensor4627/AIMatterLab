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
import {TerminalMcp} from '../../agent/tools/terminal-mcp.mjs';

test('official DSH creates, reads and updates a personal skill in chat without a project, shell or worker', {timeout:60000}, async t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-dsh-local-skill-'));
 const saved = new Map(), children = [];
 let current = {provider:'deepseek',threadId:null,projectId:null};
 const cache = path.join(root,'user-cache');
 const store = new ProjectSkills({root:cache,current:()=>current});
 const endpoint = new TerminalMcp({terminal:{tools:()=>[]},projectSkills:store});
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
  root,catalog:{get:(k,id)=>saved.get(k+':'+id),put:(k,id,v)=>saved.set(k+':'+id,structuredClone(v))},
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
 await bridge.request('turn/start',{threadId:current.threadId,input:[{type:'text',text:'Save the local skill and check its revision.'}]});
 assert.equal((await done).status,'completed');
 assert.equal(packets.length,steps.length+1);
 const items=bridge.session(current.threadId).turns[0].items.filter(item=>item.type==='mcpToolCall');
 assert.equal(items.length,steps.length);
 for(const item of items){assert.equal(item.status,'completed');assert.equal(item.result.isError,false);}
 for(const [index,expected] of [[2,body],[3,body],[4,body+'Verify.\n'],[5,body+'Verify.\n']]){
  assert(JSON.stringify(packets[index].messages.at(-1)).includes(sha256(expected)));
 }
 const file=path.join(cache,'user',name,'SKILL.md');
 assert.equal(fs.readFileSync(file,'utf8'),body+'Verify.\n');
});
