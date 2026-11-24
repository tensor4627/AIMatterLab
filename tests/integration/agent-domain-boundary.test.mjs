import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import ts from 'typescript';
import {CodexBridge,PROTOCOL_VERSION} from "../../agent/providers/codex.mjs";
import {AgentHub} from "../../agent/providers/agent-hub.mjs";
import {CLI_VERSIONS} from "../../agent/providers/contracts.mjs";
import {providerRuntime} from "../../desktop/platform/provider-runtime.mjs";
import {codexRuntime} from "../../desktop/platform/codex-runtime.mjs";
import vm from 'node:vm';
import {WorkerClient} from "../../agent/tools/worker-client.mjs";
import {WorkerClient as ComputeWorkerClient} from "../../backend/main/compute/worker.mjs";

const entries=[
  ['agent-hub','agent/providers/agent-hub'],['codex','agent/providers/codex'],
  ['acp','agent/providers/acp'],['dsh','agent/providers/dsh'],
  ['compatible-api','agent/providers/compatible-api'],['agent-settings','agent/context/agent-settings'],
  ['agent-workflow-context','agent/sessions/workflow-context'],['mcp-provider-scope','agent/tools/provider-scope'],
  ['private-definition-scope','agent/tools/definition-scope'],
];

test('Agent domains are imported directly and disposable legacy facades are removed',async()=>{
 for(const [old,owner]of entries){assert.equal(fs.existsSync(new URL("../../desktop/"+old+'.mjs',import.meta.url)),false);assert(Object.keys(await import('../../'+owner+'.mjs')).length>0);}
 assert.equal(fs.existsSync(new URL("../../desktop/providers.mjs",import.meta.url)),false);
});

async function actualMainImports(){
  const source=fs.readFileSync(new URL("../../desktop/main.mjs",import.meta.url),'utf8'),parsed=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),result=new Map();
  for(const node of parsed.statements){
    if(!ts.isImportDeclaration(node)||!node.moduleSpecifier.text.startsWith('../agent/')&&!node.moduleSpecifier.text.startsWith('./platform/'))continue;
    const namespace=await import(new URL(node.moduleSpecifier.text,new URL("../../desktop/main.mjs",import.meta.url)));
    for(const binding of node.importClause?.namedBindings?.elements||[])result.set(binding.name.text,namespace[binding.propertyName?.text||binding.name.text]);
  }
  return result;
}

test('actual main imports resolve the new Agent and vault owners and can operate the imported protocol bridge',async()=>{
  const bindings=await actualMainImports();
  for(const [name,owner]of [
    ['ConversationAgentHub','agent/providers/conversation-agent-hub'],['CodexBridge','agent/providers/codex'],
    ['createParallelAgentWorkflowContext','agent/sessions/workflow-context'],['agentConfig','agent/context/agent-settings'],
    ['definitionReply','agent/tools/definition-scope'],['providerId','agent/providers/contracts'],
    ['CredentialVault','desktop/platform/credential-vault'],
  ])assert.equal(bindings.get(name),(await import('../../'+owner+'.mjs'))[name],name);
  const bridge=new (bindings.get('CodexBridge'))(),sent=[];
  bridge.process={stdin:{destroyed:false,write:value=>sent.push(JSON.parse(value))},kill:()=>{}};
  const response=bridge.rawRequest('account/read',{refreshToken:false});
  bridge.receive({id:sent[0].id,result:{account:{type:'synthetic'}}});
  assert.deepEqual(await response,{account:{type:'synthetic'}});bridge.close();
});

test('actual main supplies native capabilities to the composed worker without invoking a real installer or process',async()=>{
 const source=fs.readFileSync(new URL("../../desktop/main.mjs",import.meta.url),'utf8'),ast=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true);let initializer;
 function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='worker')initializer=node.initializer?.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert(initializer);
 const calls=[],host={execute:async(file,args,options)=>{calls.push({file,args,options});return {stdout:JSON.stringify(calls.length===1?{path:'/fixture/runtime'}:{url:'http://127.0.0.1:12345',health:{root:'/fixture/worker',runtime:'/fixture/runtime'},tokens:{admin:'synthetic',mcp:'synthetic'}})};},spawnProcess:()=>{throw Error('A real process must not be launched');}};
 const worker=vm.runInNewContext(initializer,{WorkerClient,computeRuntime:host,workerSource:'/fixture/bundled-worker'});assert(worker instanceof ComputeWorkerClient);assert.equal(worker.host,host);
 let attached=false;worker.attachTransport=async(_settings,health,check)=>{check();attached=true;return health;};
 try{await worker.open({distribution:'Fixture',workerRoot:'/fixture/worker',workerPort:12345},'C:\\fixture\\source');assert.equal(calls.length,2);assert.equal(calls[0].file,'wsl.exe');assert(calls[0].args.includes('/mnt/c/fixture/source/install.py'));assert(calls[1].args.includes('/fixture/runtime/bootstrap.py'));assert(calls.every(call=>call.options.windowsHide===true));assert.equal(attached,true);}finally{worker.close();}
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
      const probe=childProcess(()=>({}));queueMicrotask(()=>{probe.stdout.write('kimi '+CLI_VERSIONS.kimi);probe.emit('exit',0);});return probe;
    }
    return childProcess(message=>{assert.equal(message.method,'initialize');assert.equal(message.params.clientInfo.version,'synthetic-host-version');return {protocolVersion:1};});
  },assertRpc:method=>{calls.push(['rpc',method]);throw Error('host policy rejected');}};
  const hub=new AgentHub({codex,root:'/synthetic/profiles',catalog:{get:()=>null,list:()=>[]},vault:{get:()=>null},settings:()=>({kimiPath:'host-kimi'}),worker:()=>null,host});
  try{
    assert.equal((await hub.connect('kimi')).protocolVersion,1);assert.equal(hub.bridge('kimi').host,host);
    assert.deepEqual(calls[0],['profile','/synthetic/profiles','kimi',null,hub.instructions]);assert.equal(calls.filter(call=>call[0]==='spawn').length,2);
    await assert.rejects(hub.rpc('kimi','account/read'),/host policy rejected/);assert.deepEqual(calls.at(-1),['rpc','account/read']);
  }finally{hub.close();}
});
