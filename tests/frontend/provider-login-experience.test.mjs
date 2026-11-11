import test from 'node:test';
import assert from 'node:assert/strict';
import {experienceHarness,deferred} from '../helpers/settings-experience-hooks.mjs';
const account={provider:'compatible',credentialStored:true,baseUrl:'https://fixture.invalid/v1',model:'model-a',label:'Fixture',modelAccess:'not_run'};
function setup(override){let saved={...account};return experienceHarness({component:'ProviderLogin',invoke:async(method,data)=>{const result=override?.(method,data);if(result!==undefined)return result;if(method==='agent.account')return saved;if(method==='agent.login'){saved={...saved,...data,modelAccess:'not_run'};return saved;}if(method==='agent.testConnection')return {status:'passed',model:saved.model};if(method==='agent.logout')return {phase:'signed_out'};throw Error('Unexpected fixture action');}});}

test('API editor requires saving changes before verification and clears old success',async()=>{
 const h=setup();try{await h.flush();h.byId('test-api-connection').props.onClick();await h.flush();assert.match(h.text(),/测试调用成功 · model-a/);h.change(h.byId('compatible-model'),'model-b');assert(!h.text().includes('测试调用成功'));assert(h.byId('test-api-connection').props.disabled);h.byId('test-api-connection').props.onClick();await h.flush();assert.equal(h.calls.filter(c=>c.method==='agent.testConnection').length,1);assert.match(h.text(),/保存后验证当前配置/);h.button('保存 API 配置').props.onClick();await h.flush();assert.equal(h.byId('test-api-connection').props.disabled,false);h.byId('test-api-connection').props.onClick();await h.flush();assert.match(h.text(),/测试调用成功 · model-b/);assert.deepEqual(h.errors,[]);}finally{h.unmount();}
});
test('running validation locks edits, saving and duplicate validation even before rerender',async()=>{
 const gate=deferred(),h=setup(method=>method==='agent.testConnection'?gate.promise:undefined);try{await h.flush();const test=h.byId('test-api-connection').props.onClick,save=h.button('保存 API 配置').props.onClick;test();test();save();await h.flush();assert.equal(h.calls.filter(c=>c.method==='agent.testConnection').length,1);assert.equal(h.calls.filter(c=>c.method==='agent.login').length,0);assert(h.find(node=>node.type==='fieldset').props.disabled);assert(h.button('保存 API 配置').props.disabled);gate.resolve({status:'passed',model:'model-a'});await h.flush();assert.equal(h.find(node=>node.type==='fieldset').props.disabled,false);}finally{h.unmount();}
});
test('pending save excludes validation and duplicate saves, then allows a fresh check',async()=>{
 const gate=deferred(),h=setup(method=>method==='agent.login'?gate.promise:undefined);try{await h.flush();h.change(h.byId('compatible-model'),'model-b');const save=h.button('保存 API 配置').props.onClick;save();save();h.byId('test-api-connection').props.onClick();await h.flush();assert.equal(h.calls.filter(c=>c.method==='agent.login').length,1);assert.equal(h.calls.filter(c=>c.method==='agent.testConnection').length,0);gate.resolve({...account,model:'model-b'});await h.flush();assert.equal(h.byId('test-api-connection').props.disabled,false);}finally{h.unmount();}
});
test('late initial account response preserves a user edit and late validation is ignored after closing',async()=>{
 const initial=deferred(),h=setup(method=>method==='agent.account'?initial.promise:undefined);await h.flush();h.change(h.byId('compatible-base-url'),'https://new.invalid/v1');initial.resolve(account);await h.flush();assert.equal(h.byId('compatible-base-url').props.value,'https://new.invalid/v1');assert(h.byId('test-api-connection').props.disabled);h.unmount();
 const gate=deferred(),closed=setup(method=>method==='agent.testConnection'?gate.promise:undefined);await closed.flush();closed.byId('test-api-connection').props.onClick();closed.unmount();gate.resolve({status:'passed',model:'model-a'});await closed.flush();assert.equal(closed.calls.filter(c=>c.method==='agent.account').length,1);assert.deepEqual(closed.errors,[]);
});
test('failed API verification is visible and retry remains available',async()=>{
 const h=setup(method=>method==='agent.testConnection'?Promise.reject(Error('Synthetic API error')):undefined);try{await h.flush();h.byId('test-api-connection').props.onClick();await h.flush();assert.match(h.text(),/Synthetic API error/);assert.equal(h.byId('test-api-connection').props.disabled,false);assert(!h.text().includes('测试调用成功'));}finally{h.unmount();}
});
test('refresh recovers a failed initial account read without leaving save and verification locked',async()=>{
 let first=true;const h=setup(method=>{if(method==='agent.account'&&first){first=false;return Promise.reject(Error('Synthetic initial read failed'));}});try{await h.flush();assert(h.button('保存 API 配置').props.disabled);assert.match(h.text(),/账户状态读取失败/);h.button('刷新账户状态').props.onClick();await h.flush();assert.equal(h.byId('compatible-model').props.value,'model-a');assert.equal(h.button('保存 API 配置').props.disabled,false);assert.equal(h.byId('test-api-connection').props.disabled,false);assert.equal(h.errors.length,1);assert.doesNotMatch(h.text(),/账户状态读取失败/);}finally{h.unmount();}
});


for(const provider of ['kimi','qwen'])test(provider+' missing CLI opens an explicit local/download choice before login with zero installation',async()=>{
 const h=experienceHarness({component:'ProviderLogin',props:{provider},invoke:async(method,data)=>method==='agent.account'?{phase:'signed_out'}:method==='agent.cli.inspect'?{provider:data.provider,status:'missing',expectedVersion:'1.2.3',message:'Missing local runtime'}:Promise.reject(Error('Unexpected action '+method))});
 try{await h.flush();if(provider==='qwen')h.change(h.byId('qwen-api-key'),'fixture-key');h.button(provider==='kimi'?'开始 Kimi 登录':'保存凭据并连接').props.onClick();await h.flush();const dialog=h.find(node=>node.props?.readiness?.status==='missing');assert.equal(dialog.props.provider,provider);assert.equal(h.calls.filter(call=>call.method==='agent.cli.inspect').length,1);assert(!h.calls.some(call=>call.method==='agent.cli.install'||call.method==='agent.login'));dialog.props.onClose();await h.flush();assert.throws(()=>h.find(node=>node.props?.readiness));}finally{h.unmount();}
});

for(const provider of ['kimi','qwen'])test(provider+' reuses a compatible local CLI without a dialog or download',async()=>{
 const h=experienceHarness({component:'ProviderLogin',props:{provider},invoke:async(method,data)=>method==='agent.account'?{phase:'signed_out'}:method==='agent.cli.inspect'?{provider:data.provider,status:'ready',expectedVersion:'1.2.3',version:'1.2.3',source:'path',message:'Ready'}:method==='agent.login'?{phase:provider==='kimi'?'authorizing':'completed',credentialStored:true}:Promise.reject(Error('Unexpected action '+method))});
 try{await h.flush();if(provider==='qwen')h.change(h.byId('qwen-api-key'),'fixture-key');h.button(provider==='kimi'?'开始 Kimi 登录':'保存凭据并连接').props.onClick();await h.flush();assert.equal(h.calls.filter(call=>call.method==='agent.login').length,1);assert(!h.calls.some(call=>call.method==='agent.cli.install'));assert.throws(()=>h.find(node=>node.props?.readiness));assert.deepEqual(h.errors,[]);}finally{h.unmount();}
});

test('a delayed pre-save account refresh cannot overwrite the confirmed credential configuration',async()=>{
 const gate=deferred();let reads=0;const h=setup(method=>method==='agent.account'&&++reads>1?gate.promise:undefined);
 try{await h.flush();h.change(h.byId('compatible-model'),'model-b');const refresh=h.button('刷新账户状态').props.onClick;refresh();refresh();await h.flush();assert.equal(reads,2);h.button('保存 API 配置').props.onClick();await h.flush();assert(h.byId('test-api-connection'));gate.resolve({provider:'compatible',credentialStored:false,phase:'signed_out',model:'stale-model'});await h.flush();assert.equal(h.byId('compatible-model').props.value,'model-b');assert.equal(h.byId('test-api-connection').props.disabled,false);assert.deepEqual(h.errors,[]);}finally{h.unmount();}
});

test('a late missing-runtime inspection cannot open a dialog after the provider changes',async()=>{
 const gate=deferred(),h=experienceHarness({component:'ProviderLogin',props:{provider:'kimi'},invoke:async(method,data)=>method==='agent.account'?{phase:'signed_out'}:method==='agent.cli.inspect'?gate.promise:Promise.reject(Error('Unexpected action '+method))});
 try{await h.flush();h.button('开始 Kimi 登录').props.onClick();await h.flush();h.render({provider:'qwen'});await h.flush();gate.resolve({provider:'kimi',status:'missing',expectedVersion:'1.2.3',message:'Old provider missing'});await h.flush();assert.throws(()=>h.find(node=>node.props?.readiness));assert(!h.calls.some(call=>call.method==='agent.login'||call.method==='agent.cli.install'));assert.deepEqual(h.errors,[]);}finally{h.unmount();}
});
