import {discoverProfileModels} from '../../agent/providers/model-discovery.mjs';
import {apiModelKey,validateModelProfile} from '../../contracts/agent/model-profiles.mjs';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function request(value,keys){if(!object(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error('Invalid typed model settings request');return value;}
export function registerModelProfileRoutes({handle,agents,assertIdle,emit,fetchApi,checkConnection=testProfileConnection}){
 const store=agents.modelProfiles;
 const invalidate=provider=>{agents.disconnect(provider);const bridge=agents.bridge(provider);if(bridge){bridge.sessions?.clear();bridge.model=undefined;bridge.modelInfos=[];}};
 handle('models.profiles.list',value=>{request(value,['provider']);if(value.provider!==undefined&&!['qwen','compatible'].includes(value.provider))throw Error('Invalid API provider group');return store.list(value.provider);});
 handle('models.profiles.save',value=>{request(value,['profile','apiKey','expectedRevision']);assertIdle();const profile=validateModelProfile(value.profile),result=store.save({...value,profile});invalidate(profile.provider);agents.loginStatus[profile.provider]={phase:'configured',modelAccess:'not_run'};emit({method:'studio/accountUpdated',provider:profile.provider,params:{credentialsChanged:true}});return result;});
 handle('models.profiles.remove',value=>{request(value,['id','expectedRevision']);assertIdle();const profile=store.read(value.id),result=store.remove(value);invalidate(profile.provider);emit({method:'studio/accountUpdated',provider:profile.provider,params:{credentialsChanged:true}});return result;});
 handle('models.profiles.discover',async value=>{
  request(value,['profile','apiKey']);const profile=validateModelProfile({...value.profile,models:value.profile?.models?.some(v=>v.id?.trim())?value.profile.models.filter(v=>v.id?.trim()):[{id:'discovery-placeholder'}]});
  if(value.apiKey!==undefined&&(typeof value.apiKey!=='string'||value.apiKey.length>4096||/[\s\0]/.test(value.apiKey)))throw Error('Invalid API Key');
  let apiKey=value.apiKey||'';if(!apiKey&&store.catalog.get('model-provider',profile.id)){const old=store.read(profile.id);if(old.baseUrl!==profile.baseUrl||old.api!==profile.api||(old.authMode||'api-key')!==(profile.authMode||'api-key'))throw Error('更换地址或协议后，请重新输入密钥再获取模型');apiKey=store.credential(profile.id).apiKey;}
  if(!apiKey&&!['localhost','127.0.0.1','[::1]'].includes(new URL(profile.baseUrl).hostname))throw Error('请填写此服务商的 API Key 后获取模型');
  const identity=store.catalog.get('model-provider',profile.id)?store.identity(profile.id):null;
  const result=await discoverProfileModels(profile,{apiKey,fetchApi});if(identity&&store.identity(profile.id)!==identity)throw Error('服务商配置已变化，请重新获取模型');return result;
 });
 handle('models.profiles.test',async value=>{request(value,['id','model']);assertIdle();const profile=store.read(value.id);if(!profile.models.some(v=>v.id===value.model))throw Error('请选择已保存的模型');const identity=store.identity(value.id),result=await checkConnection({agents,profile,model:value.model});if(store.identity(value.id)!==identity)throw Error('服务商配置已变化；请重新验证');agents.loginStatus[profile.provider]={phase:'configured',modelAccess:'passed'};emit({method:'studio/accountUpdated',provider:profile.provider,params:{}});return result;});
}
export async function testProfileConnection({agents,profile,model}){
 const {randomUUID}=await import('node:crypto'),path=await import('node:path');
 const values=new Map(),catalog={put:(kind,id,value)=>values.set(kind+id,value),get:(kind,id)=>values.get(kind+id),list:()=>[]},credential=structuredClone(agents.modelProfiles.credential(profile.id));
 const profiles={list:()=>[credential],read:id=>id===profile.id?credential:null,identity:()=>JSON.stringify(credential),resolve:(_provider,key)=>({profile:credential,credential,model:credential.models.find(v=>apiModelKey(profile.id,v.id)===(key||apiModelKey(profile.id,model))),key:key||apiModelKey(profile.id,model)})};
 const bridge=agents.createApiBridge(profile.provider,{root:path.join(agents.root,'connection-checks',randomUUID()),catalog,profiles,worker:()=>null});let timer;
 try{bridge.model=apiModelKey(profile.id,model);await bridge.start();const thread=await bridge.request('thread/start',{model:bridge.model});const completion=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('连接测试超时；未提交计算')),60000);bridge.on('event',event=>{if(event.method==='turn/completed'){event.params.turn.status==='completed'&&event.params.turn.modelOutputReceived?resolve():reject(Error(event.params.turn.error?.message||'未收到完整模型回复'));}});});await Promise.all([completion,bridge.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'Connection test. Reply exactly OK. Do not call tools.'}]})]);return {status:'passed',model,scope:'One empty-context model reply; no research content or tools'};}finally{clearTimeout(timer);bridge.close();}
}
