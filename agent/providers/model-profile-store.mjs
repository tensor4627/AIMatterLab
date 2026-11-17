import {createHash,randomUUID} from 'node:crypto';
import {REASONING_LEVELS,apiModelKey,splitApiModelKey,validateModelProfile} from '../../contracts/agent/model-profiles.mjs';
const KIND='model-provider',secretId=id=>'model-provider-'+id;
export class ModelProfileStore{
 constructor({catalog,vault,settings=()=>({})}){Object.assign(this,{catalog,vault,settings});}
 migrate(){
  for(const provider of ['qwen','compatible']){
   const id='legacy-'+provider;if(this.catalog.get(KIND,id)||this.catalog.get('model-provider-migration',provider))continue;
   const saved=this.vault.get(provider);if(!saved?.baseUrl||!saved.model)continue;
   let local=false;try{local=['localhost','127.0.0.1','[::1]'].includes(new URL(saved.baseUrl).hostname);}catch{continue;}if(!saved.apiKey&&!local)continue;
   const effort=saved.reasoningEffort,level=REASONING_LEVELS.includes(effort)&&effort!=='off'?effort:'high',settings=this.settings();
   const sharePublicGuides=['pygas','pydyn','gpumd','hotpp','torchnep'].some(source=>(source==='pygas'?settings.pygasSkillProviders||[]:settings.scientificSkillProviders?.[source]||[]).includes(provider));
   const profile=validateModelProfile({id,provider,name:saved.label||(provider==='qwen'?'Qwen（已有 API）':'自定义 API（已有配置）'),baseUrl:saved.baseUrl,api:'openai-completions',preset:saved.plan||'custom',sharePublicGuides,models:[{id:saved.model,...saved.reasoningMode==='reasoning_effort'?{reasoningEfforts:{off:null,[level]:effort}}:{}}],defaultModel:saved.model});
   // Copy a credential only into the vault; the legacy record remains available.
   this.vault.put(secretId(id),{apiKey:saved.apiKey});this.catalog.put(KIND,id,{...profile,revision:1});this.catalog.put('model-provider-migration',provider,{version:1,profileId:id});
  }
 }
 list(provider){this.migrate();const preferred=provider?this.catalog.get('model-provider-default',provider)?.id:null;return this.catalog.list(KIND).filter(v=>!provider||v.provider===provider).sort((a,b)=>Number(b.id===preferred)-Number(a.id===preferred)).map(v=>({...v,requiresApiKey:!['localhost','127.0.0.1','[::1]'].includes(new URL(v.baseUrl).hostname),credentialStored:!!this.vault.get(secretId(v.id))?.apiKey}));}
 read(id){if(typeof id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(id))throw Error('Invalid provider identity');this.migrate();const value=this.catalog.get(KIND,id);if(!value)throw Error('服务商配置不存在或已移除');return value;}
 credential(id){const profile=this.read(id),key=this.vault.get(secretId(id));return {...profile,apiKey:key?.apiKey||''};}
 identity(id){return createHash('sha256').update(JSON.stringify(this.credential(id))).digest('hex');}
 save({profile:input,apiKey,expectedRevision}){
  if(apiKey!==undefined&&(typeof apiKey!=='string'||apiKey.length>4096||/[\s\0]/.test(apiKey)))throw Error('请输入有效的 API Key');
  this.migrate();const profile=validateModelProfile({...input,id:input.id||'provider-'+randomUUID().slice(0,8)}),old=this.catalog.get(KIND,profile.id);
  if(!old&&expectedRevision!==undefined)throw Error('服务商配置已移除，请刷新后重试');
  if(old&&expectedRevision!==old.revision)throw Error('服务商配置已变化，请刷新后重试');
  if(old&&old.provider!==profile.provider)throw Error('不能更改服务商所属分组');
  const same=old?.baseUrl===profile.baseUrl&&old?.api===profile.api&&(old?.authMode||'api-key')===(profile.authMode||'api-key');
  if(old&&!same&&profile.sharePublicGuides)throw Error('更换地址或协议后，请先取消公开指导共享并保存，再为新地址明确开启');
  if(!apiKey&&old&&!same&&(this.vault.get(secretId(profile.id))?.apiKey||!['localhost','127.0.0.1','[::1]'].includes(new URL(profile.baseUrl).hostname)))throw Error('更换服务地址或协议时请重新输入密钥，不会将原密钥发送到新地址');
  const key=apiKey||same&&this.vault.get(secretId(profile.id))?.apiKey||'';
  if(!key&&!['localhost','127.0.0.1','[::1]'].includes(new URL(profile.baseUrl).hostname))throw Error('请填写此服务商的 API Key');
  const previous=this.vault.get(secretId(profile.id));this.vault.put(secretId(profile.id),{apiKey:key});
  try{this.catalog.put(KIND,profile.id,{...profile,revision:(old?.revision||0)+1});}catch(error){if(previous)this.vault.put(secretId(profile.id),previous);else this.vault.remove(secretId(profile.id));throw error;}
  return this.list(profile.provider).find(v=>v.id===profile.id);
 }
 setDefault(id){const profile=this.read(id);this.catalog.put('model-provider-default',profile.provider,{id});return {id,provider:profile.provider};}
 remove({id,expectedRevision}){const old=this.read(id);if(old.revision!==expectedRevision)throw Error('服务商配置已变化，请刷新后重试');this.catalog.remove(KIND,id);this.vault.remove(secretId(id));return {removed:true};}
 resolve(provider,key){
  const parsed=splitApiModelKey(key),profiles=this.list(provider);let profile,model;
  if(parsed){profile=profiles.find(v=>v.id===parsed.profileId);model=profile?.models.find(v=>v.id===parsed.modelId);}
  else if(key){const matches=profiles.filter(v=>v.models.some(m=>m.id===key));if(matches.length!==1)throw Error('模型名称不明确或不存在，请重新选择模型');profile=matches[0];model=profile.models.find(v=>v.id===key);}
  else{profile=profiles[0];model=profile?.models.find(v=>v.id===profile.defaultModel);}
  if(!profile||!model)throw Error('请选择此服务商已配置的模型');return {profile,model,key:apiModelKey(profile.id,model.id),credential:this.credential(profile.id)};
 }
}
