import test from 'node:test';
import assert from 'node:assert/strict';
import {experienceHarness,deferred} from '../helpers/settings-experience-hooks.mjs';

const saved={schemaVersion:1,id:'fixture-api',provider:'compatible',name:'Fixture API',baseUrl:'https://fixture.invalid/v1',api:'openai-completions',preset:'custom',models:[{id:'model-a',reasoningEfforts:{off:null,high:'high'}}],defaultModel:'model-a',credentialStored:true,revision:1};
function setup(override,props={}){let current=structuredClone(saved);return experienceHarness({component:'ModelProviders',props,invoke:async(method,data)=>{const result=override?.(method,data);if(result!==undefined)return result;if(method==='models.profiles.list')return [current];if(method==='models.profiles.save'){current={...data.profile,defaultModel:data.profile.models.some(v=>v.id===data.profile.defaultModel)?data.profile.defaultModel:data.profile.models[0].id,revision:current.revision+1,credentialStored:true};return current;}if(method==='models.profiles.test')return {status:'passed',model:data.model};if(method==='models.profiles.discover')return {source:'endpoint',models:[{id:'model-a'},{id:'model-b',contextWindow:64000}]};if(method==='models.profiles.remove')return {removed:true};throw Error('Unexpected action '+method);}});}
const imageCheckbox=h=>h.find(node=>node.type==='input'&&node.props['aria-label']==='支持图片输入');
test('keyless local settings display the text-only default for a legacy model',async()=>{
 const h=setup(method=>method==='models.profiles.list'?[{...saved,baseUrl:'http://127.0.0.1:11434/v1',requiresApiKey:false,credentialStored:false}]:undefined);
 try{
  await h.flush();
  assert.match(h.text(),/本机服务无需密钥/);
  assert.equal(h.byId('provider-api-key').props.value,'');
  assert.equal(imageCheckbox(h).props.checked,false);
 }finally{h.unmount();}
});
test('model image capability is saved per model and reloads from the profile',async()=>{
 const h=setup();
 try{
  await h.flush();
  for(const checked of [true,false]){
   imageCheckbox(h).props.onChange({target:{checked}});
   await h.flush();
   h.byId('save-api-provider').props.onClick();
   await h.flush();
   const savedProfile=h.calls.filter(call=>call.method==='models.profiles.save').at(-1).data.profile;
   assert.deepEqual(savedProfile.models[0].input,checked?['text','image']:['text']);
   h.render({provider:'qwen'});
   await h.flush();
   h.render({provider:'compatible'});
   await h.flush();
   assert.equal(imageCheckbox(h).props.checked,checked);
  }
 }finally{h.unmount();}
});
test('API model editor requires save before validation and does not redisplay a stored key',async()=>{const h=setup();try{await h.flush();assert.equal(h.byId('provider-api-key').props.value,'');h.byId('test-api-provider').props.onClick();await h.flush();assert.match(h.text(),/测试调用成功.*model-a/);h.change(h.byId('api-model-id-0'),'model-b');assert(!h.text().includes('测试调用成功'));assert(h.byId('test-api-provider').props.disabled);h.byId('test-api-provider').props.onClick();await h.flush();assert.equal(h.calls.filter(v=>v.method==='models.profiles.test').length,1);h.byId('save-api-provider').props.onClick();await h.flush();h.byId('test-api-provider').props.onClick();await h.flush();assert.match(h.text(),/测试调用成功.*model-b/);assert.equal(h.calls.some(v=>/agent\.cli|agent\.login/.test(v.method)),false);}finally{h.unmount();}});
test('validation is single-flight and blocks simultaneous saves before rerender',async()=>{const gate=deferred(),h=setup(method=>method==='models.profiles.test'?gate.promise:undefined);try{await h.flush();const check=h.byId('test-api-provider').props.onClick,save=h.byId('save-api-provider').props.onClick;check();check();save();await h.flush();assert.equal(h.calls.filter(v=>v.method==='models.profiles.test').length,1);assert.equal(h.calls.filter(v=>v.method==='models.profiles.save').length,0);assert(h.byId('model-provider-editor').props.disabled);gate.resolve({model:'model-a'});await h.flush();assert.equal(h.byId('model-provider-editor').props.disabled,false);}finally{h.unmount();}});
test('model discovery merges selected additions without overwriting existing reasoning mappings',async()=>{const h=setup();try{await h.flush();h.byId('discover-api-models').props.onClick();await h.flush();h.find(v=>v.type==='input'&&v.props?.type==='checkbox'&&v.props.checked===false).props.onChange({target:{checked:true}});await h.flush();h.byId('adopt-api-models').props.onClick();await h.flush();h.byId('save-api-provider').props.onClick();await h.flush();const request=h.calls.find(v=>v.method==='models.profiles.save');assert.deepEqual(request.data.profile.models[0].reasoningEfforts,{off:null,high:'high'});assert.equal(request.data.profile.models[1].id,'model-b');assert.equal(request.data.profile.models[1].contextWindow,64000);}finally{h.unmount();}});
test('changing API endpoint clears address-scoped public guide sharing',async()=>{const h=setup(method=>method==='models.profiles.list'?[{...saved,sharePublicGuides:true}]:undefined);try{await h.flush();assert.equal(h.byId('provider-public-guides').props.checked,true);h.change(h.byId('provider-base-url'),'https://other.invalid/v1');assert.equal(h.byId('provider-public-guides').props.checked,false);}finally{h.unmount();}});
test('late discovery and validation cannot update another provider tab',async()=>{for(const action of ['discover','test']){const gate=deferred(),h=setup(method=>method==='models.profiles.'+action?gate.promise:method==='models.profiles.list'?[saved]:undefined);try{await h.flush();h.byId(action==='test'?'test-api-provider':'discover-api-models').props.onClick();await h.flush();h.render({provider:'qwen'});await h.flush();gate.resolve(action==='test'?{model:'obsolete'}:{models:[{id:'obsolete'}]});await h.flush();assert(!h.text().includes('obsolete'));assert.equal(h.byId('model-provider-editor').props.disabled,false);}finally{h.unmount();}}});
test('failed API verification remains visible and retry does not require a CLI',async()=>{const h=setup(method=>method==='models.profiles.test'?Promise.reject(Error('Synthetic API unavailable')):undefined,{provider:'qwen'});try{await h.flush();h.byId('test-api-provider').props.onClick();await h.flush();assert.match(h.text(),/Synthetic API unavailable/);assert.equal(h.byId('test-api-provider').props.disabled,false);assert.equal(h.calls.some(v=>v.method.startsWith('agent.cli')),false);}finally{h.unmount();}});
test('DeepSeek account mode resets endpoint, protocol, plaintext field and endpoint consent',async()=>{const h=setup(method=>method==='models.profiles.list'?[{...saved,sharePublicGuides:true}]:undefined);try{await h.flush();h.change(h.byId('provider-api-key'),'synthetic-unsaved-key');h.change(h.byId('provider-auth-mode'),'deepseek-account');assert.equal(h.byId('provider-base-url').props.value,'https://api.deepseek.com/anthropic');assert.equal(h.byId('provider-protocol').props.value,'anthropic-messages');assert.equal(h.byId('provider-api-key').props.value,'');assert.equal(h.byId('provider-public-guides').props.checked,false);assert.match(h.text(),/账户令牌与 API Key 不同/);}finally{h.unmount();}});
test('new Qwen provider defaults to Token Plan and text input',async()=>{const h=experienceHarness({component:'ModelProviders',props:{provider:'qwen'},invoke:async()=>[]});try{await h.flush();h.byId('add-api-provider').props.onClick();await h.flush();assert.equal(h.byId('provider-preset').props.value,'token-cn');assert.match(h.byId('provider-base-url').props.value,/token-plan/);assert.equal(imageCheckbox(h).props.checked,false);assert.equal(h.calls.some(v=>/cli|login/.test(v.method)),false);}finally{h.unmount();}});
