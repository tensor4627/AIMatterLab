import test from 'node:test';
import assert from 'node:assert/strict';
import {agentHarness,deferred,memoryStorage} from '../helpers/agent-hooks.mjs';

const compatibility={baselineVersion:'0.165.0-alpha.1.2',installedVersion:'0.167.0-alpha.3.2',baselineMatch:false,versionWarning:{code:'STUDIO_CODEX_VERSION_DIFFERENCE',severity:'warning'},status:'capabilities_verified'};
const warning=h=>h.find(node=>node.props?.['data-testid']==='codex-version-warning');
const hasWarning=h=>{try{warning(h);return true;}catch{return false;}};
const dismiss=h=>h.find(node=>node.props?.['aria-label']==='关闭版本提示').props.onClick();
const connectResult=(method,data,standard)=>method==='agent.connect'?{tools:{status:'ready',count:1},studioCompatibility:compatibility}:standard(method,data);

test('first mismatch is a dismissible popup, never an inline banner or automatic send',async()=>{
 const h=agentHarness({override:connectResult});try{
  await h.flush();h.click('agent-connect');await h.flush();
  assert.equal(warning(h).props.role,'status');assert.equal(warning(h).props['data-severity'],'warning');assert.match(warning(h).props.className,/codex-version-notice/);
  assert.match(JSON.stringify(warning(h)),/0\.167\.0-alpha\.3\.2/);assert.match(JSON.stringify(warning(h)),/0\.165\.0-alpha\.1\.2/);
  assert.equal(h.calls.some(call=>call.method==='agent.rpc'&&call.data.method==='turn/start'),false);
  dismiss(h);await h.flush();assert.equal(hasWarning(h),false);
  h.type('PUBLIC FIXTURE explicit message');h.send();await h.flush();assert.equal(h.calls.filter(call=>call.method==='agent.rpc'&&call.data.method==='turn/start').length,1);assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});

for(const detail of ['required_isolation_controls_missing','Codex authentication was rejected'])test('a real connection error stays visible instead of opening a version or sign-in warning: '+detail,async()=>{
 const pending=deferred(),h=agentHarness({override:(method,data,standard)=>method==='agent.connect'?pending.promise:standard(method,data)});try{
  await h.flush();h.click('agent-connect');await h.flush();h.emit({provider:'codex',method:'studio/codexVersionWarning',params:compatibility});await h.flush();assert.equal(hasWarning(h),false);
  pending.reject(Error(detail));await h.flush();assert.equal(hasWarning(h),false);assert.equal(h.errors.length,1);assert(h.errors[0].includes(detail));
  assert.equal(h.calls.filter(call=>call.method==='agent.connect').length,1);
  h.emit({provider:'codex',method:'studio/codexVersionWarning',params:compatibility});await h.flush();assert.equal(hasWarning(h),false);
  assert.throws(()=>h.find(node=>node.props?.['data-testid']==='agent-login-required'));
  assert.equal(h.calls.some(call=>call.method==='agent.rpc'&&call.data.method==='turn/start'),false);
 }finally{h.unmount();}
});

test('the warning waits until the agent can load models and use the connection',async()=>{
 const models=deferred(),h=agentHarness({override:(method,data,standard)=>method==='agent.rpc'&&data.method==='model/list'?models.promise:connectResult(method,data,standard)});
 try{await h.flush();h.click('agent-connect');await h.flush();assert.equal(hasWarning(h),false);
  models.resolve({data:[{model:'public-fixture-model'}]});await h.flush();assert.equal(hasWarning(h),true);assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});

test('a rejected Codex account readback remains visible and does not show a version warning',async()=>{
 const h=agentHarness({override:(method,data,standard)=>{
  if(method==='agent.account')throw Error('Account readback failed');
  return connectResult(method,data,standard);
 }});
 try{await h.flush();h.click('agent-connect');await h.flush();assert.equal(hasWarning(h),false);assert.deepEqual(h.errors,['Error: Account readback failed']);
 }finally{h.unmount();}
});

test('dismissal survives reconnect, a later version difference and component restart in the same profile',async()=>{
 const storage=memoryStorage(),h=agentHarness({storage,override:connectResult});try{
  await h.flush();h.click('agent-connect');await h.flush();assert.equal(hasWarning(h),true);dismiss(h);await h.flush();
  h.emit({provider:'codex',method:'studio/codexDisconnected',params:{}});await h.flush();h.click('agent-connect');await h.flush();assert.equal(hasWarning(h),false);
  h.emit({provider:'codex',method:'studio/codexVersionWarning',params:{...compatibility,installedVersion:'0.168.0'}});await h.flush();assert.equal(hasWarning(h),false);
 }finally{h.unmount();}
 const reopened=agentHarness({storage,override:connectResult});try{await reopened.flush();reopened.click('agent-connect');await reopened.flush();assert.equal(hasWarning(reopened),false);assert.deepEqual(reopened.errors,[]);}finally{reopened.unmount();}
});

test('matching versions, unrelated providers and malformed metadata do not consume the first notice',async()=>{
 const h=agentHarness({override:(method,data,standard)=>method==='agent.connect'?{studioCompatibility:{...compatibility,baselineMatch:true}}:standard(method,data)});try{
  await h.flush();h.click('agent-connect');await h.flush();assert.equal(hasWarning(h),false);
  for(const event of [{provider:'kimi',params:compatibility},{provider:'codex',params:{...compatibility,installedVersion:'private-token\n0.167'}},{provider:'codex',params:{...compatibility,status:'pending_capability_verification'}},{provider:'codex',params:{...compatibility,threadId:'background'}}]){h.emit({...event,method:'studio/codexVersionWarning'});await h.flush();assert.equal(hasWarning(h),false);}
  h.emit({provider:'codex',method:'studio/codexVersionWarning',params:compatibility});await h.flush();assert.equal(hasWarning(h),true);
 }finally{h.unmount();}
});

test('hidden Agent defers first popup until visible instead of consuming an unseen notice',async()=>{
 const h=agentHarness({props:{hidden:true},override:connectResult});try{
  await h.flush();h.click('agent-connect');await h.flush();assert.equal(hasWarning(h),false);
  h.render({hidden:false});await h.flush();assert.equal(hasWarning(h),true);h.render({hidden:true});await h.flush();h.render({hidden:false});await h.flush();assert.equal(hasWarning(h),false);
 }finally{h.unmount();}
});

test('popup automatically closes after eight seconds and duplicate events cannot reopen it',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=agentHarness({override:connectResult});try{
  await h.flush();h.click('agent-connect');await h.flush();assert.equal(hasWarning(h),true);t.mock.timers.tick(8000);await h.flush();assert.equal(hasWarning(h),false);
  h.emit({provider:'codex',method:'studio/codexVersionWarning',params:compatibility});await h.flush();assert.equal(hasWarning(h),false);
 }finally{h.unmount();}
});

test('unavailable notice storage does not block connection or repeat warnings in the active renderer',async()=>{
 const storage=memoryStorage(),get=storage.getItem,set=storage.setItem;storage.getItem=key=>{if(key==='studio.codexVersionNotice.shown')throw Error('storage unavailable');return get(key);};storage.setItem=(key,value)=>{if(key==='studio.codexVersionNotice.shown')throw Error('storage unavailable');set(key,value);};
 const h=agentHarness({storage,override:connectResult});try{
  await h.flush();h.click('agent-connect');await h.flush();assert.equal(hasWarning(h),true);dismiss(h);await h.flush();h.emit({provider:'codex',method:'studio/codexVersionWarning',params:compatibility});await h.flush();assert.equal(hasWarning(h),false);assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});
