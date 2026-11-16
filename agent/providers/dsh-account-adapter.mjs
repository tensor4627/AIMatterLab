// Host-owned credential binding; the pinned official DSH adapter owns the protocol.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export const name='studio-deepseek-account';
export const inject=['llm'];
export async function apply(ctx,config){
 const base=new URL(config.baseUrl);
 if(config.baseUrl!=='https://api.deepseek.com/anthropic'&&!(base.protocol==='http:'&&base.hostname==='127.0.0.1'&&!base.username&&!base.password&&!base.search&&!base.hash))throw Error('Invalid DeepSeek account destination');
 if(typeof config.module!=='string'||!path.isAbsolute(config.module))throw Error('A pinned DeepSeek adapter is required');
 const {registerDeepSeekProvider,resolveAdapterOptions,catalogModelInfo}=await import(pathToFileURL(config.module).href);
 const token=process.env.STUDIO_MODEL_API_KEY;if(!token)throw Error('DeepSeek account sign-in required');
 const options=resolveAdapterOptions({baseURL:config.baseUrl,models:config.models.map(model=>({id:model.id,...model.name?{name:model.name}:{},contextWindow:model.contextWindow||1048576,maxTokens:model.maxTokens||8192,inputModalities:model.input||['text']})),retryPolicy:{mode:'normal',maxRetries:0}});
 registerDeepSeekProvider(ctx,config.route,{providerName:config.displayName,options:()=>options,resolveAuth:async connection=>{if(connection.baseURL!==config.baseUrl)throw Error('DeepSeek account destination changed');return {headers:{'x-dsh-auth-token':token}};},discoverModels:async provider=>options.models.map(model=>catalogModelInfo(provider,model))});
}
