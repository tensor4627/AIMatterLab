import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import ts from 'typescript';
import {CodexBridge,PROTOCOL_VERSION} from '../agent/providers/codex.mjs';
import {AgentHub} from '../agent/providers/agent-hub.mjs';
import {CLI_VERSIONS} from '../agent/providers/contracts.mjs';
import {providerRuntime} from '../desktop/platform/provider-runtime.mjs';
import {codexRuntime} from '../desktop/platform/codex-runtime.mjs';

const entries=[
  ['agent-hub','agent/providers/agent-hub'],['codex','agent/providers/codex'],
  ['acp','agent/providers/acp'],['deepseek','agent/providers/deepseek'],
  ['compatible-api','agent/providers/compatible-api'],['agent-settings','agent/context/agent-settings'],
  ['agent-workflow-context','agent/sessions/workflow-context'],['mcp-provider-scope','agent/tools/provider-scope'],
  ['private-definition-scope','agent/tools/definition-scope'],
];

test('legacy Agent entries expose the same live classes, functions and constants as their new owners',async()=>{
  for(const [old,owner]of entries){
    const legacy=await import('../desktop/'+old+'.mjs'),current=await import('../'+owner+'.mjs');
    assert.deepEqual(Object.keys(legacy),Object.keys(current));
    for(const name of Object.keys(current))assert.equal(legacy[name],current[name],old+':'+name);
  }
  const legacy=await import('../desktop/providers.mjs');
  for(const owner of ['agent/providers/contracts','desktop/platform/credential-vault','desktop/platform/provider-runtime']){
    const current=await import('../'+owner+'.mjs');
    for(const name of Object.keys(current).filter(name=>name!=='providerRuntime'))assert.equal(legacy[name],current[name],name);
  }
});

async function actualMainImports(){
  const source=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8'),parsed=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),result=new Map();
  for(const node of parsed.statements){
    if(!ts.isImportDeclaration(node)||!node.moduleSpecifier.text.startsWith('../agent/')&&!node.moduleSpecifier.text.startsWith('./platform/'))continue;
    const namespace=await import(new URL(node.moduleSpecifier.text,new URL('../desktop/main.mjs',import.meta.url)));
    for(const binding of node.importClause?.namedBindings?.elements||[])result.set(binding.name.text,namespace[binding.propertyName?.text||binding.name.text]);
  }
  return result;
}

test('actual main imports resolve the new Agent and vault owners and can operate the imported protocol bridge',async()=>{
  const bindings=await actualMainImports();
  for(const [name,owner]of [
    ['AgentHub','agent/providers/agent-hub'],['CodexBridge','agent/providers/codex'],
    ['createAgentWorkflowContext','agent/sessions/workflow-context'],['agentConfig','agent/context/agent-settings'],
    ['definitionReply','agent/tools/definition-scope'],['providerId','agent/providers/contracts'],
    ['CredentialVault','desktop/platform/credential-vault'],
  ])assert.equal(bindings.get(name),(await import('../'+owner+'.mjs'))[name],name);
  const bridge=new (bindings.get('CodexBridge'))(),sent=[];
  bridge.process={stdin:{destroyed:false,write:value=>sent.push(JSON.parse(value))},kill:()=>{}};
  const response=bridge.rawRequest('account/read',{refreshToken:false});
  bridge.receive({id:sent[0].id,result:{account:{type:'synthetic'}}});
  assert.deepEqual(await response,{account:{type:'synthetic'}});bridge.close();
});

function childProcess(reply){
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  child.stdin={destroyed:false,write:raw=>{const message=JSON.parse(raw);if(message.id!==undefined)queueMicrotask(()=>child.stdout.write(JSON.stringify({id:message.id,result:reply(message)})+'\n'));}};
  return child;
}

test('Codex native launch and version capabilities are supplied by an explicit host without spawning a real process',async()=>{
  const calls=[],host={...codexRuntime,version:'synthetic-host-version',execute:async(executable,args)=>{calls.push({executable,args});return {stdout:'codex-cli '+PROTOCOL_VERSION};},spawnProcess:(executable,args,options)=>{
    calls.push({executable,args,options});return childProcess(message=>{assert.equal(message.method,'initialize');assert.equal(message.params.clientInfo.version,'synthetic-host-version');return {userAgent:'synthetic'};});
  }};
  const bridge=new CodexBridge({host});
  try{assert.equal((await bridge.start('host-owned-cli')).userAgent,'synthetic');assert.equal(calls.length,2);assert.deepEqual(calls[0],{executable:'host-owned-cli',args:['--version']});assert.equal(calls[1].options.windowsHide,true);}finally{bridge.close();}
});

test('AgentHub supplies its host to ACP profile creation, version probe, process launch and RPC validation',async()=>{
  const calls=[],codex=new EventEmitter();codex.close=()=>{};
  const profile={cwd:'/synthetic/cwd',home:'/synthetic/home',args:['--acp'],env:{}};
  const host={...providerRuntime,version:'synthetic-host-version',prepareProfile:(...args)=>{calls.push(['profile',...args]);return profile;},spawnCli:(executable,args,options)=>{
    calls.push(['spawn',executable,args,options]);
    if(args[0]==='--version'){
      const probe=childProcess(()=>({}));queueMicrotask(()=>{probe.stdout.write('qwen '+CLI_VERSIONS.qwen);probe.emit('exit',0);});return probe;
    }
    return childProcess(message=>{assert.equal(message.method,'initialize');assert.equal(message.params.clientInfo.version,'synthetic-host-version');return {protocolVersion:1};});
  },assertRpc:method=>{calls.push(['rpc',method]);throw Error('host policy rejected');}};
  const hub=new AgentHub({codex,root:'/synthetic/profiles',catalog:{get:()=>null,list:()=>[]},vault:{get:()=>null},settings:()=>({qwenPath:'host-qwen'}),worker:()=>null,host});
  try{
    assert.equal((await hub.connect('qwen')).protocolVersion,1);assert.equal(hub.bridge('qwen').host,host);
    assert.deepEqual(calls[0],['profile','/synthetic/profiles','qwen',null]);assert.equal(calls.filter(call=>call[0]==='spawn').length,2);
    await assert.rejects(hub.rpc('qwen','account/read'),/host policy rejected/);assert.deepEqual(calls.at(-1),['rpc','account/read']);
  }finally{hub.close();}
});
