import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {AcpBridge,toolResult,toolName} from '../desktop/acp.mjs';
import {CredentialVault,prepareProfile,qwenCredentials,providerId,cliCommand,redact} from '../desktop/providers.mjs';
import {loginUrl,AgentHub} from '../desktop/agent-hub.mjs';
function bridge(provider='kimi'){const b=new AcpBridge(provider),sent=[],events=[];b.process={stdin:{write:value=>sent.push(JSON.parse(value))},kill(){}};b.on('event',event=>events.push(event));return {b,sent,events};}
function temporary(){return fs.mkdtempSync(path.join(os.tmpdir(),'studio-providers-'));}
test('Provider identifiers, endpoints and CLI paths are bounded',()=>{
 assert.throws(()=>providerId('shell'));assert.throws(()=>cliCommand('qwen.cmd'));assert.throws(()=>cliCommand('x\npowershell'));
 assert.deepEqual(cliCommand('kimi',['acp']).args,['acp']);
 assert.throws(()=>qwenCredentials({plan:'http://evil',apiKey:'sk-placeholder',model:'x'}));
 assert.throws(()=>qwenCredentials({plan:'coding-cn',apiKey:'sk-placeholder',model:'x'}));
 assert.throws(()=>qwenCredentials({plan:'api-cn',apiKey:'sk-placeholder',model:'$(exec)'}));
 assert.equal(qwenCredentials({plan:'coding-cn',apiKey:'sk-sp-placeholder',model:'qwen3-coder-plus'}).baseUrl,'https://coding.dashscope.aliyuncs.com/v1');
});
test('Provider browser login cannot open untrusted URLs',()=>{
 assert.equal(loginUrl('kimi','https://auth.kimi.com/path'),'https://auth.kimi.com/path');
 for(const url of ['http://kimi.com','https://kimi.com.evil.test','https://evil.kimi.ai.attacker.test','https://user:pw@kimi.com'])assert.throws(()=>loginUrl('kimi',url));
 assert.throws(()=>loginUrl('codex','https://kimi.com'));
});
test('Credentials are encrypted and never written to provider settings or command arguments',()=>{
 const root=temporary(),key='sk-test-secret-value';try{
  const encryption={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).map(v=>v^127),decryptString:b=>Buffer.from(b.map(v=>v^127)).toString()};
  const vault=new CredentialVault(root,encryption);const credential=qwenCredentials({plan:'api-cn',apiKey:key,model:'qwen3-coder-plus'});
  vault.put('qwen',credential);assert.equal(vault.get('qwen').apiKey,key);assert(!fs.readFileSync(vault.file('qwen')).includes(Buffer.from(key)));
  const profile=prepareProfile(root,'qwen',credential);assert(!fs.readFileSync(path.join(profile.home,'settings.json'),'utf8').includes(key));assert(!profile.args.join(' ').includes(key));assert.equal(profile.env.OPENAI_API_KEY,key);
  assert.throws(()=>new CredentialVault(root,{isEncryptionAvailable:()=>false}).put('kimi',{}));
  vault.remove('qwen');assert.equal(vault.get('qwen'),null);assert(!redact('Bearer token '+key,[key]).includes(key));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Private profiles preserve Kimi OAuth config while enforcing MCP-only tools',()=>{
 const root=temporary();try{
  let profile=prepareProfile(root,'kimi');const file=path.join(profile.home,'config.toml');fs.appendFileSync(file,'\n[providers.kimi]\ntype = "kimi"\n');
  profile=prepareProfile(root,'kimi');const config=fs.readFileSync(file,'utf8');
  assert.equal((config.match(/\[tools\]/g)||[]).length,1);assert.match(config,/enabled = \["mcp__gpusampling__\*", "AskUserQuestion"\]/);assert.match(config,/\[providers.kimi\]/);assert.equal(profile.env.KIMI_CODE_HOME,profile.home);
  const q=prepareProfile(root,'qwen');assert(q.args.includes('--bare'));assert(q.args.includes('--exclude-tools'));assert.equal(q.env.QWEN_HOME,q.home);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('ACP responses, errors and disconnect are distinct',async()=>{
 const {b,sent}=bridge();try{
  const pending=b.raw('initialize');b.receive({id:sent[0].id,result:{protocolVersion:1}});assert.deepEqual(await pending,{protocolVersion:1});
  const denied=b.raw('session/new');b.receive({id:sent[1].id,error:{code:-32000,message:'Authentication required'}});await assert.rejects(denied,e=>e.code===-32000);
  const lost=b.raw('session/prompt');b.disconnect(Error('connection lost'));await assert.rejects(lost,/connection lost/);
 }finally{b.close();}
});
test('ACP filesystem and shell requests always fail, including forged permissions',()=>{
 const {b,sent,events}=bridge();try{
  b.receive({id:10,method:'fs/write_text_file',params:{path:'upstream'}});
  assert.equal(sent.at(-1).error.code,-32601);
  b.receive({id:11,method:'session/request_permission',params:{sessionId:'s',toolCall:{title:'Bash',kind:'execute'},options:[{optionId:'yes',kind:'allow_once'}]}});
  assert.equal(sent.at(-1).result.outcome.outcome,'cancelled');assert(events.some(e=>e.method==='studio/policyDenied'));
  assert.throws(()=>b.respond(11,{optionId:'yes'}));
  b.receive({id:12,method:'session/request_permission',params:{sessionId:'s',toolCall:{title:'mcp__gpusampling__prepare_run',kind:'other'},options:[{optionId:'once',kind:'allow_once'}]}});
  assert.equal(sent.at(-1).result.outcome.optionId,'once');
 }finally{b.close();}
});
test('ACP tool completion preserves real draft data for module routing',()=>{
 const {b,events}=bridge('qwen');try{
  const draft={id:'draft-1',engine:'pydyn.md',status:'draft',parameters:{temperature:300}};
  b.receive({method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'tool_call',toolCallId:'tc',title:'mcp__gpusampling__prepare_run',status:'in_progress'}}});
  b.receive({method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'tool_call_update',toolCallId:'tc',status:'completed',rawOutput:{content:[{type:'text',text:JSON.stringify(draft)}]}}}});
  const completed=events.find(e=>e.method==='item/completed');assert.equal(completed.provider,'qwen');assert.equal(completed.params.item.tool,'prepare_run');assert.deepEqual(JSON.parse(completed.params.item.result.content[0].text),draft);
  assert.equal(toolName('mcp__gpusampling__read_run'),'read_run');
  assert.match(toolResult({rawOutput:'actual log'}).content[0].text,/actual log/);
 }finally{b.close();}
});
test('Model and thinking selectors expose only negotiated options, no invented context',async()=>{
 const {b,sent,events}=bridge();try{
  b.sessions.set('s',{id:'s',turns:[],tools:new Map(),models:{},configOptions:[{id:'model',category:'model',currentValue:'model-a',options:[{value:'model-a',name:'A'}]},{id:'thinking',category:'thought_level',currentValue:'off',options:[{value:'off',name:'Off'},{value:'on',name:'On'}]}]});b.current='s';
  const catalog=await b.request('model/list');assert.deepEqual(catalog.data[0].supportedReasoningEfforts.map(v=>v.reasoningEffort),['off','on']);
  await assert.rejects(b.setChoice(b.session('s'),'thought_level','ultra'),/does not support/);
  b.update({sessionId:'s',update:{sessionUpdate:'usage_update',used:320,size:65536}});assert.equal(events.at(-1).params.tokenUsage.modelContextWindow,65536);
  assert(!sent.length);
 }finally{b.close();}
});
test('Provider sessions and responses cannot cross the selected provider',async()=>{
 const catalog={list:()=>[],put:()=>{}},codex={close(){},respond(){throw Error('wrong backend')}};
 const hub=new AgentHub({codex,root:'.',catalog,vault:{get:()=>null},settings:()=>({}),worker:()=>null});
 await assert.rejects(hub.rpc('qwen','model/list'),/selected provider/);assert.throws(()=>hub.respond('kimi',1,{}),/Provider switched/);
});

test('Qwen MCP readiness uses official state and never starts with disconnected scientific tools',async()=>{
 const {b}=bridge('qwen');b.worker={url:'http://fixture'};
 let i=0;b.raw=async method=>{assert.equal(method,'qwen/status/session/resources');return {mcp:{discoveryState:++i===1?'in_progress':'completed',servers:[{name:'gpusampling',mcpStatus:'connected',disabled:false}]}};};
 await b.waitMcp({id:'s'});assert.equal(i,2);
 b.raw=async()=>({mcp:{discoveryState:'completed',servers:[{name:'gpusampling',mcpStatus:'disconnected'}]}});
 await assert.rejects(b.waitMcp({id:'s'}),/no turn was started/);b.close();
});
