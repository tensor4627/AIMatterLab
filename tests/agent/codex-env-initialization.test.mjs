import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {createCodexSubscriptionRuntime} from '../../desktop/platform/codex-subscription-runtime.mjs';
import {CodexBridge} from '../../agent/providers/codex.mjs';
import {AgentHub} from '../../agent/providers/agent-hub.mjs';
import {ConversationAgentHub} from '../../agent/providers/conversation-agent-hub.mjs';

function fixture(t, contents, sourceDirectory = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aimlab-consent-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const sourceHome = path.join(root,'native');
  if (sourceDirectory) fs.mkdirSync(sourceHome);
  if (contents !== undefined) fs.writeFileSync(path.join(sourceHome,'.env'), contents);
  const studioRoot = path.join(root,'studio');
  const home = path.join(studioRoot,'subscription-home');
  const events = [];
  const host = createCodexSubscriptionRuntime({root:studioRoot,sourceHome,runtime:{},onEnvPrompt:event=>events.push(event)});
  return {host, consent:host.envImport, events, sourceHome, home, studioRoot, target:path.join(home,'.env')};
}

function choose(f,mode) {
  f.consent.decide({requestId:f.consent.current().requestId,mode});
}

test('proxy choice includes only real proxy assignments; no source or destination values reach the dialog',async t=>{
  const f = fixture(t,Buffer.from('\ufeff# comment\r\nexport HTTP_PROXY="http://127.0.0.1:18080" # local\r\nOTHER="line 1\nHTTPS_PROXY=inside-private-text\nline 3"\r\nNO_PROXY=\'.example.invalid,localhost\'\r\nignored_PROXY=private\r\nhttps_proxy=http://fixture.invalid\r\nKEY=private-marker\r\n'));
  for (const file of ['sessions','config.toml','auth.json','history.jsonl']) fs.writeFileSync(path.join(f.sourceHome,file),'from native');
  assert.deepEqual(fs.readdirSync(f.home),[]);
  const first = f.consent.request();
  assert.equal(f.consent.request(),first);
  assert.deepEqual(Object.keys(f.events[0]).sort(),['configIssue','hasModelDefaults','hasSystemProxy','requestId','sourceState']);
  assert.equal(f.events[0].sourceState,'available');
  assert(!fs.existsSync(f.target));
  choose(f,'proxy');
  await first;
  assert.deepEqual({...parseEnv(fs.readFileSync(f.target,'utf8'))},{HTTP_PROXY:'http://127.0.0.1:18080',NO_PROXY:'.example.invalid,localhost,127.0.0.1,::1,[::1]',https_proxy:'http://fixture.invalid'});
  assert.deepEqual(fs.readdirSync(f.home).sort(),['.env','.env-import-choice']);
  assert.equal(f.events[1],null);
  assert.doesNotMatch(JSON.stringify(f.events),/127\.0\.0\.1|private-marker/);
});
test('whole-file consent copies exact bytes once; later source changes leave the private copy alone',async t=>{
  const bytes = Buffer.from('\ufeff# fixture\r\nPRIVATE_KEY=synthetic\r\nHTTP_PROXY=http://fixture.invalid\r\n');
  const f=fixture(t,bytes), wait=f.consent.request();
  choose(f,'full'); await wait;
  assert.deepEqual(fs.readFileSync(f.target),bytes);
  fs.writeFileSync(path.join(f.sourceHome,'.env'),'new value');
  const next=createCodexSubscriptionRuntime({root:f.studioRoot,sourceHome:f.sourceHome,runtime:{},onEnvPrompt:()=>assert.fail()});
  await next.envImport.request();
  assert.deepEqual(fs.readFileSync(f.target),bytes);
});
test('a new user without a native Codex home, credentials, catalog or .env can reach the login flow',async t=>{
  const f=fixture(t,undefined,false), bridge=new CodexBridge({host:f.host}), launches=[];
  bridge.launch=async function(file,worker,config,options) {
    await this.host.envImport.request();
    launches.push({worker,options});
    this.process={kill(){}};
    this.isolation={authenticationOnly:true};
    return {};
  };
  bridge.prepareChatAccount=async check=>{
    check();
    const account=await f.host.initializeAuth(async()=>({account:null,requiresOpenaiAuth:true}),()=>assert.fail());
    return account;
  };
  bridge.request=async(method,params)=>{
    assert.equal(method,'account/login/start');
    assert.equal(params.type,'chatgpt');
    return {type:'chatgpt',loginId:'fixture-login',authUrl:'https://auth.openai.com/fixture'};
  };
  const hub=new AgentHub({codex:bridge,root:f.studioRoot,settings:()=>({codexPath:'fixture'}),
    catalog:{get:()=>null,list:()=>[]},vault:{get:()=>null},worker:()=>assert.fail('No compute scope at sign-in')});
  t.after(()=>hub.close());
  assert.equal((await hub.account('codex')).metadataUnavailable,true);
  assert.equal(f.events.length,0);
  const connect=hub.connect('codex',{checkLogin:true});
  assert.equal(f.consent.current().sourceState,'absent');
  choose(f,'none');
  assert.deepEqual(await connect,{loginRequired:true,provider:'codex'});
  assert.equal(launches.length,1);
  assert.equal(launches[0].worker,null);
  assert.equal(launches[0].options.authenticationOnly,true);
  const login=await hub.login('codex',{type:'chatgpt'});
  assert.equal(login.phase,'authorizing');
  assert.equal(login.modelAccess,'not_run');
  assert(!fs.existsSync(f.sourceHome));
  assert(!fs.existsSync(f.target));
});
test('none, no proxy keys and an existing target all preserve independent settings',async t=>{
  for (const [source,mode,existing] of [['KEY=synthetic','none',false],['KEY=synthetic','proxy',false],['KEY=synthetic','none',true]]) {
    const f=fixture(t,source);
    if(existing)fs.writeFileSync(f.target,'existing');
    const wait=f.consent.request();
    assert.equal(f.consent.current().sourceState,existing?'existing':'available');
    choose(f,mode); await wait;
    assert.equal(fs.existsSync(f.target),existing);
    if(existing)assert.equal(fs.readFileSync(f.target,'utf8'),'existing');
    assert(!f.consent.needsChoice());
  }
});
test('existing and legacy targets and a concurrent native edit are never overwritten',async t=>{
  const f=fixture(t,'HTTP_PROXY=http://synthetic.invalid'), wait=f.consent.request();
  fs.writeFileSync(f.target,'concurrent');
  choose(f,'full'); await wait;
  assert.equal(fs.readFileSync(f.target,'utf8'),'concurrent');
  const old=fixture(t,'this-should-stay-native');
  fs.writeFileSync(path.join(old.home,'.env-initialized'),'1\n');
  fs.writeFileSync(old.target,'existing-private-copy');
  const legacy=old.consent.request();
  assert.equal(old.consent.current().sourceState,'existing');
  choose(old,'none'); await legacy;
  assert.equal(fs.readFileSync(old.target,'utf8'),'existing-private-copy');
});
test('cancel, stale answers and path overrides cannot create a file or launch the CLI',async t=>{
  const f=fixture(t,'X=synthetic'), bridge=new CodexBridge({host:f.host,launchDependencies:{execute:()=>assert.fail('must not execute')}});
  const start=bridge.start('fixture',null), stale=f.consent.current().requestId;
  assert.throws(()=>f.consent.decide({requestId:stale,mode:'full',path:f.target}),/已失效/);
  assert.throws(()=>f.consent.decide({requestId:stale,mode:'arbitrary'}),/已失效/);
  choose(f,'cancel'); await assert.rejects(start,/已取消/);
  const next=bridge.start('fixture',null);
  assert.notEqual(f.consent.current().requestId,stale);
  assert.throws(()=>f.consent.decide({requestId:stale,mode:'full'}),/已失效/);
  bridge.close(); await assert.rejects(next,/已取消/);
  assert.deepEqual(fs.readdirSync(f.home),[]);
});
test('errors keep the decision open and do not leak the file; choosing independent still works',async t=>{
  const f=fixture(t,'PRIVATE=synthetic-key\nHTTP_PROXY=http://\u0024PRIVATE\n'), wait=f.consent.request();
  assert.throws(()=>choose(f,'proxy'),error=>error.message.includes('变量引用')&&!error.message.includes('synthetic-key'));
  assert.deepEqual(fs.readdirSync(f.home),[]);
  fs.unlinkSync(path.join(f.sourceHome,'.env'));
  assert.throws(()=>choose(f,'full'),/无法读取/);
  choose(f,'none'); await wait;
  assert.equal(f.consent.needsChoice(),false);
});
test('concurrent conversations share one decision and closing a single waiter preserves the other',async t=>{
  const f=fixture(t,'HTTP_PROXY=http://synthetic.invalid');
  const other=createCodexSubscriptionRuntime({root:f.studioRoot,sourceHome:f.sourceHome,runtime:{},sharedEnvImport:f.consent});
  const closing=new AbortController(),remaining=new AbortController();
  const first=f.consent.request(closing.signal), second=other.envImport.request(remaining.signal);
  const id=f.consent.current().requestId;
  closing.abort();await assert.rejects(first,/已取消/);
  assert.equal(f.consent.current().requestId,id);
  assert.equal(f.events.length,1);
  choose(f,'proxy');await second;
  const imported=parseEnv(fs.readFileSync(f.target,'utf8'));
  assert.match(imported.NO_PROXY,/127\.0\.0\.1/);
  assert.equal(f.events.length,2);
});
test('global model and effort require consent, preserve snapshot time and exclude other TOML fields',async t=>{
 const f=fixture(t,undefined), file=path.join(f.sourceHome,'config.toml');
 const config=['model="fixture-a"','model_reasoning_effort="high"','developer_instructions=\'\'\'private',
   'model = "inner"','\'\'\'','[features]','respect_system_proxy=true','[model_providers.private]','env_key="SYNTHETIC_KEY"'].join('\n');
 fs.writeFileSync(file,config);
 const first=f.consent.request(), prompt=f.consent.current();
 assert.equal(prompt.hasModelDefaults,true);assert.equal(prompt.hasSystemProxy,true);
 assert.equal(prompt.sourceState,'absent');assert.doesNotMatch(JSON.stringify(prompt),/fixture-a|private|SYNTHETIC_KEY/);
 fs.writeFileSync(file,'model="changed-after-dialog"');
 f.consent.decide({requestId:prompt.requestId,mode:'proxy',useModelDefaults:true});await first;
 assert.deepEqual(f.consent.settings(),{defaults:{id:prompt.requestId,model:'fixture-a',effort:'high'},systemProxy:true});
 assert(!fs.existsSync(f.target));assert(!fs.existsSync(path.join(f.home,'config.toml')));
 const stored=fs.readFileSync(path.join(f.home,'.env-import-choice'),'utf8');assert.doesNotMatch(stored,/inner|developer|api_key|SYNTHETIC/);
 const captures=[], runtime={spawnProcess:(exe,args)=>captures.push(args)};
 const host=createCodexSubscriptionRuntime({root:f.studioRoot,sourceHome:f.sourceHome,runtime});
 host.spawnProcess('codex',['app-server','--listen','stdio://'],{env:{}});
 assert.deepEqual(captures[0].slice(-2),['-c','features.respect_system_proxy=true']);
});
test('model defaults, proxy settings, and whole-file copying can each be declined independently',async t=>{
 for(const [mode,useModelDefaults] of [['full',false],['none',true],['none',false],['proxy',false]]){
  const f=fixture(t,'PRIVATE=fixture\nHTTP_PROXY=http://example.invalid');
  fs.writeFileSync(path.join(f.sourceHome,'config.toml'),'model="local-model"\n[features]\nrespect_system_proxy=false');
  const first=f.consent.request(), requestId=f.consent.current().requestId;
  f.consent.decide({requestId,mode,useModelDefaults});await first;
  const settings=f.consent.settings();
  assert.equal(settings.defaults?.model,useModelDefaults?'local-model':undefined);
  assert.equal(settings.systemProxy,mode==='proxy'?false:undefined);
  assert.equal(fs.existsSync(f.target),mode!=='none');
  if(fs.existsSync(f.target))assert.equal(fs.readFileSync(f.target,'utf8').includes('PRIVATE=fixture'),mode==='full');
 }
});
test('malformed TOML permits first-time login and ignores values hidden in project tables',async t=>{
 for(const [cfg,issue] of [['title = [',true],['[projects.private]\nmodel="not-global"\nmodel_reasoning_effort="high"',false]]){
  const f=fixture(t,undefined);
  fs.writeFileSync(path.join(f.sourceHome,'config.toml'),cfg);
  const first=f.consent.request();assert.equal(f.consent.current().configIssue,issue);
  assert.equal(f.consent.current().hasModelDefaults,false);
  choose(f,'none');await first;assert.deepEqual(f.consent.settings(),{});
 }
});
test('the native source is the explicit CODEX_HOME; the child still receives only its isolated home',async t=>{
  const f=fixture(t,'HTTP_PROXY=http://synthetic.invalid'), original=process.env.CODEX_HOME;
  process.env.CODEX_HOME=f.sourceHome;
  t.after(()=>{if(original===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=original;});
  const host=createCodexSubscriptionRuntime({root:f.studioRoot,runtime:{},onEnvPrompt:()=>{}});
  const wait=host.envImport.request();
  assert.equal(host.envImport.current().sourceState,'available');
  host.envImport.decide({requestId:host.envImport.current().requestId,mode:'proxy'});
  await wait;
  assert.match(fs.readFileSync(f.target,'utf8'),/synthetic\.invalid/);
});
test('an active subscription comes from its own transport and an explicit new login uses the account transport',async()=>{
 const chat={codex:{process:{},isolationReady:true,isolation:{}},account:async()=>({account:{type:'chatgpt'}})};
 const hub={foreground:{provider:'codex',hub:chat},scope:{getStore:()=>null},auth:{loginStatus:{},account:async()=>({account:null})}};
 assert.equal((await ConversationAgentHub.prototype.account.call(hub,'codex')).account.type,'chatgpt');
 chat.codex.host={usingNativeLogin:()=>true};
 for(const phase of ['cancelled','failed']){
  hub.auth.loginStatus.codex={phase};
  assert.equal((await ConversationAgentHub.prototype.account.call(hub,'codex')).account.type,'chatgpt');
 }
 hub.auth.loginStatus.codex={phase:'authorizing'};
 assert.equal((await ConversationAgentHub.prototype.account.call(hub,'codex')).account,null);
 hub.auth.loginStatus.codex={phase:'signed_out'};
 assert.equal((await ConversationAgentHub.prototype.account.call(hub,'codex')).account,null);
 chat.codex.host.usingNativeLogin=()=>false;
 hub.auth.loginStatus.codex={phase:'cancelled'};
 assert.equal((await ConversationAgentHub.prototype.account.call(hub,'codex')).account,null);
});
