import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {agentEnvironment} from '../../desktop/platform/agent-environment.mjs';
import {spawnCli,prepareProfile} from '../../desktop/platform/provider-runtime.mjs';
import {bootstrapSkills,prepareIsolation,ISOLATION_FEATURES} from '../../desktop/platform/codex-isolation.mjs';
import {CodexBridge,PROTOCOL_VERSION} from '../../agent/providers/codex.mjs';
import {AcpBridge} from '../../agent/providers/acp.mjs';
import {AgentHub} from '../../agent/providers/agent-hub.mjs';

const privateFields={MP_API_KEY:'synthetic-materials',AWS_SECRET_ACCESS_KEY:'synthetic-aws',
 ANTHROPIC_API_KEY:'synthetic-other-provider',OPENAI_API_KEY:'synthetic-ambient-key',
 KIMI_API_KEY:'synthetic-ambient-kimi',QWEN_API_KEY:'synthetic-ambient-qwen',
 GSS_MCP_TOKEN:'synthetic-stale-token',STUDIO_UNRELATED_SECRET:'synthetic-unrelated',
 NODE_OPTIONS:'--require=synthetic-must-never-load',NODE_PATH:'synthetic-node-path',
 LD_PRELOAD:'synthetic-preload',DYLD_INSERT_LIBRARIES:'synthetic-dyld',
 PYTHONPATH:'synthetic-pythonpath',NODE_TLS_REJECT_UNAUTHORIZED:'0',
 ELECTRON_RUN_AS_NODE:'synthetic-parent-electron'};
const transport={HTTP_PROXY:'http://proxy.invalid:1',HTTPS_PROXY:'http://proxy.invalid:2',
 ALL_PROXY:'socks5://proxy.invalid:3',NO_PROXY:'localhost,127.0.0.1',
 SSL_CERT_FILE:'/synthetic/ca.pem',SSL_CERT_DIR:'/synthetic/certs',
 NODE_EXTRA_CA_CERTS:'/synthetic/node-ca.pem',REQUESTS_CA_BUNDLE:'/synthetic/requests-ca.pem',
 CURL_CA_BUNDLE:'/synthetic/curl-ca.pem',NODE_USE_ENV_PROXY:'1',NODE_USE_SYSTEM_CA:'1'};
function noPrivate(env,exceptions=[]){for(const key of Object.keys(privateFields))if(!exceptions.includes(key))assert.equal(env[key],undefined,key+' must not reach the child');}
function poison(t){const old=Object.fromEntries(Object.keys(privateFields).map(key=>[key,process.env[key]]));Object.assign(process.env,privateFields);t.after(()=>{for(const [key,value]of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});}
function temporary(t){const root=process.env.STUDIO_AGENT_ENV_TEST_ROOT||os.tmpdir();fs.mkdirSync(root,{recursive:true});const directory=fs.mkdtempSync(path.join(root,'studio-agent-env-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}
function child(replies){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};child.stdin=new PassThrough();child.stdin.on('data',raw=>{const message=JSON.parse(raw);if(message.id!==undefined)queueMicrotask(()=>child.stdout.write(JSON.stringify({id:message.id,result:replies(message.method)})+'\n'));});return child;}

test('allowlist keeps OS, proxy, certificate, locale and profile settings without ambient secrets or loader flags',()=>{
 const shared={PATH:'/synthetic/bin',SystemRoot:'C:\\Windows',ComSpec:'C:\\Windows\\System32\\cmd.exe',
  ProgramData:'C:\\ProgramData',PATHEXT:'.EXE',HOME:'/synthetic/home',USERPROFILE:'C:\\synthetic',
  APPDATA:'C:\\synthetic\\Roaming',LOCALAPPDATA:'C:\\synthetic\\Local',TEMP:'/synthetic/tmp',TMP:'/synthetic/tmp',
  LANG:'en_US.UTF-8',LC_ALL:'zh_CN.UTF-8',LC_TIME:'zh_CN.UTF-8',LC_MESSAGES:'en_US.UTF-8',TZ:'Asia/Shanghai',...transport};
 const parent={...shared,...privateFields,CODEX_HOME:'/synthetic/codex-login',QWEN_HOME:'/synthetic/other-home'};
 const snapshot={...parent},env=agentEnvironment('codex',{parent,platform:'linux'});
 for(const [key,value]of Object.entries(shared))assert.equal(env[key],value,key);
 noPrivate(env);assert.equal(env.CODEX_HOME,parent.CODEX_HOME);assert.equal(env.QWEN_HOME,undefined);assert.deepEqual(parent,snapshot);
});

test('Windows OS/proxy names are case-insensitive and produce one unambiguous spelling',()=>{
 const env=agentEnvironment('codex',{platform:'win32',parent:{Path:'synthetic-path',systemroot:'C:\\Windows',https_proxy:'http://proxy.invalid',codex_home:'C:\\synthetic-codex',node_options:'poison',undefined:'unrelated'}});
 assert.equal(env.PATH,'synthetic-path');assert.equal(env.SystemRoot,'C:\\Windows');assert.equal(env.HTTPS_PROXY,'http://proxy.invalid');assert.equal(env.CODEX_HOME,'C:\\synthetic-codex');
 assert.equal(env.node_options,undefined);assert.equal(env.HOME,undefined);assert.equal(new Set(Object.keys(env).map(key=>key.toUpperCase())).size,Object.keys(env).length);
});

test('POSIX upper/lower proxy variants retain their separate configured values',()=>{
 const env=agentEnvironment(null,{platform:'linux',parent:{HTTP_PROXY:'http://upper.invalid',http_proxy:'http://lower.invalid'}});
 assert.deepEqual(env,{HTTP_PROXY:'http://upper.invalid',http_proxy:'http://lower.invalid'});
});

test('provider credentials and current MCP token must be supplied explicitly for the exact provider',()=>{
 const codex=agentEnvironment('codex',{parent:privateFields,overrides:{GSS_MCP_TOKEN:'current-scoped-token',OPENAI_API_KEY:'explicit-codex-key'}});
 noPrivate(codex,['GSS_MCP_TOKEN','OPENAI_API_KEY']);assert.equal(codex.GSS_MCP_TOKEN,'current-scoped-token');assert.equal(codex.OPENAI_API_KEY,'explicit-codex-key');
 const qwen=agentEnvironment('qwen',{parent:privateFields,overrides:{QWEN_HOME:'/synthetic/qwen',OPENAI_API_KEY:'explicit-qwen-key',STUDIO_QWEN_API_KEY:'explicit-qwen-key',OPENAI_BASE_URL:'https://qwen.invalid/v1',OPENAI_MODEL:'explicit-model'}});
 noPrivate(qwen,['OPENAI_API_KEY']);assert.equal(qwen.OPENAI_API_KEY,'explicit-qwen-key');assert.equal(qwen.STUDIO_QWEN_API_KEY,'explicit-qwen-key');assert.equal(qwen.QWEN_HOME,'/synthetic/qwen');
 const kimi=agentEnvironment('kimi',{parent:privateFields,overrides:{KIMI_CODE_HOME:'/synthetic/kimi',KIMI_API_KEY:'',KIMI_BASE_URL:''}});
 noPrivate(kimi,['KIMI_API_KEY']);assert.equal(kimi.KIMI_CODE_HOME,'/synthetic/kimi');assert.equal(kimi.KIMI_API_KEY,'');
});

test('explicit arbitrary/other-provider secrets and code-loader overrides cannot widen the policy',()=>{
 for(const [provider,overrides]of [['kimi',{OPENAI_API_KEY:'wrong-provider'}],['qwen',{GSS_MCP_TOKEN:'wrong-lane'}],['codex',{MP_API_KEY:'wrong-key'}],[null,{NODE_OPTIONS:'--require=poison'}],['qwen',{STUDIO_UNRELATED_SECRET:'wrong'}]])assert.throws(()=>agentEnvironment(provider,{parent:{},overrides}),/Unsupported CLI environment override/);
 assert.throws(()=>agentEnvironment('unknown',{parent:{}}),/Unsupported CLI environment provider/);
 assert.throws(()=>agentEnvironment('codex',{overrides:{GSS_MCP_TOKEN:{admin:'never'}}}),/Unsupported CLI environment override/);
});

test('actual provider child process excludes synthetic parent secrets and poison while receiving explicit credentials',async t=>{
 poison(t);const root=temporary(t),file=path.join(root,'controlled-cli.mjs'),profile=prepareProfile(root,'qwen',{model:'synthetic-model',apiKey:'explicit-qwen-key',baseUrl:'https://qwen.invalid/v1'});
 fs.writeFileSync(file,'process.stdout.write(JSON.stringify(process.env));');
 const spawned=spawnCli(file,[],{provider:'qwen',cwd:root,env:profile.env});let output='',error='';spawned.stdout.on('data',data=>output+=data);spawned.stderr.on('data',data=>error+=data);
 await new Promise((resolve,reject)=>{spawned.on('error',reject);spawned.on('close',code=>code===0?resolve():reject(Error('Controlled child failed: '+error)));});
 const env=JSON.parse(output);noPrivate(env,['OPENAI_API_KEY','QWEN_API_KEY','ELECTRON_RUN_AS_NODE']);assert.equal(env.OPENAI_API_KEY,'explicit-qwen-key');assert.equal(env.QWEN_API_KEY,'');assert.equal(env.STUDIO_QWEN_API_KEY,'explicit-qwen-key');assert.equal(env.QWEN_HOME,profile.home);assert.equal(env.ELECTRON_RUN_AS_NODE,'1');assert.equal(env.PATH,process.env.PATH);
 assert.equal(fs.readFileSync(path.join(profile.home,'settings.json'),'utf8').includes('explicit-qwen-key'),false);
});

test('ACP version and main launches carry the trusted provider identity and saved profile',async t=>{
 const root=temporary(t),profile=prepareProfile(root,'qwen',{model:'synthetic-model',apiKey:'explicit-qwen-key',baseUrl:'https://qwen.invalid/v1'}),calls=[];
 const host={version:'synthetic',spawnCli(exe,args,options){calls.push({args,options});if(args[0]==='--version'){const probe=new EventEmitter();probe.stdout=new PassThrough();probe.kill=()=>{};queueMicrotask(()=>{probe.stdout.write('qwen 0.24.7');probe.emit('exit',0);});return probe;}return child(()=>({protocolVersion:1}));}};
 const bridge=new AcpBridge('qwen',{host});t.after(()=>bridge.close());await bridge.start('synthetic-cli',profile);
 assert.equal(calls.length,2);for(const call of calls){assert.equal(call.options.provider,'qwen');assert.equal(call.options.env,profile.env);}
});

test('Kimi login uses the Kimi environment lane without altering existing login config',async t=>{
 const root=temporary(t),initial=prepareProfile(root,'kimi'),config=path.join(initial.home,'config.toml');fs.appendFileSync(config,'\n[providers.synthetic]\ntype = "kimi"\n');
 const calls=[],login=new EventEmitter();login.stdout=new PassThrough();login.stderr=new PassThrough();login.kill=()=>login.emit('exit',0);
 const codex=new EventEmitter();codex.close=()=>{};
 const hub=new AgentHub({codex,root,catalog:{get:()=>null,list:()=>[]},vault:{get:()=>null},settings:()=>({kimiPath:'synthetic-cli'}),worker:()=>null,host:{prepareProfile,spawnCli(exe,args,options){calls.push({args,options});return login;}}});
 t.after(()=>hub.close());await hub.login('kimi');assert.equal(calls[0].options.provider,'kimi');assert.equal(calls[0].options.env.KIMI_CODE_HOME,initial.home);assert.match(fs.readFileSync(config,'utf8'),/\[providers.synthetic\]/);
});

test('Codex capability and offline MCP probes plus bootstrap all use the same clean environment without a worker token',async t=>{
 poison(t);const root=temporary(t),calls=[];
 const isolation=await prepareIsolation('synthetic-cli',root,{},undefined,{
  prepareModels:directory=>({path:path.join(directory,'synthetic-models.json')}),
  execute:async(exe,args,options)=>{calls.push({phase:args[0],env:options.env});return {stdout:args[0]==='features'?[...ISOLATION_FEATURES,'skip_host_skill_discovery'].map(key=>key+' stable false').join('\n'):'[]'};},
  probe:(...args)=>bootstrapSkills(...args,{spawnProcess:(exe,argv,options)=>{calls.push({phase:'bootstrap',env:options.env});return child(method=>method==='skills/list'?{data:[]}:{}) ;}})
 });
 assert.equal(isolation.worker,null);assert.deepEqual(calls.map(call=>call.phase),['features','mcp','bootstrap']);for(const call of calls)noPrivate(call.env);
});

test('Codex version and final server launch retain login home but only the final server receives its current scoped token',async t=>{
 poison(t);const root=temporary(t),calls=[],oldHome=process.env.CODEX_HOME;process.env.CODEX_HOME=path.join(root,'synthetic-existing-login');t.after(()=>{if(oldHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=oldHome;});
 const host={version:'synthetic',overrideArgs:()=>[],
  execute:async(exe,args,options)=>{calls.push({phase:'version',env:options.env});return {stdout:'codex-cli '+PROTOCOL_VERSION};},
  prepareIsolation:async()=>({cwd:root,instructions:path.join(root,'synthetic-instructions.md'),config:{}}),verifyIsolation:async()=>({status:'verified'}),
  spawnProcess:(exe,args,options)=>{calls.push({phase:'server',env:options.env});return child(()=>({userAgent:'synthetic',codexHome:process.env.CODEX_HOME,platformFamily:'windows',platformOs:'windows'}));}
 };
 const bridge=new CodexBridge({host,strictIsolation:true,isolationRoot:root});t.after(()=>bridge.close());
 await bridge.start('synthetic-cli',{url:'http://127.0.0.1:12345/providers/codex',tokens:{mcp:'current-scoped-token',admin:'never-admin'}});
 assert.deepEqual(calls.map(call=>call.phase),['version','server']);noPrivate(calls[0].env);noPrivate(calls[1].env,['GSS_MCP_TOKEN']);assert.equal(calls[1].env.GSS_MCP_TOKEN,'current-scoped-token');for(const call of calls){assert.equal(call.env.CODEX_HOME,process.env.CODEX_HOME);assert.equal(Object.values(call.env).includes('never-admin'),false);}
});
