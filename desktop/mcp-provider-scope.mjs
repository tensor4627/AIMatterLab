import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
const PROVIDERS=new Set(['codex','kimi','qwen','deepseek','compatible']);
export const MCP_CONTEXT_KEYS=Object.freeze(['threadId','taskId','projectId','environmentId','inputRoot']);
export function providerContext(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!MCP_CONTEXT_KEYS.includes(k)))throw Error('Invalid trusted provider context');
 return Object.freeze(Object.fromEntries(MCP_CONTEXT_KEYS.map(key=>{const v=value[key]??null;if(v!==null&&(typeof v!=='string'||!v||v.length>(key==='inputRoot'?4096:512)||/[\x00-\x1f]/.test(v)))throw Error('Invalid trusted provider context '+key);return [key,v];})));
}
const sameToken=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class McpProviderScopes {
 constructor(){this.scopes=new Map();this.identity=null;this.base=null;this.nextEpoch=0;}
 bind(connection){
  if(!connection||typeof connection.url!=='string'||typeof connection.tokens?.mcp!=='string'||!connection.tokens.mcp)throw Error('An active local worker connection is required');
  const url=new URL(connection.url);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw Error('Expected the loopback MCP proxy root');
  const identity=createHash('sha256').update(connection.url+'\0'+connection.tokens.mcp).digest('hex');
  if(identity!==this.identity){this.revokeAll();this.identity=identity;this.baseLease={};}
  this.base={connection,origin:url.origin,host:url.host};
 }
 lease(provider,context=providerContext()){
  const scope={provider,token:randomBytes(32).toString('base64url'),generation:this.identity,epoch:++this.nextEpoch,revision:0,context};this.scopes.set(provider,scope);return scope;
 }
 bindContext(provider,value,options={}){
  if(!PROVIDERS.has(provider))throw Error('Unsupported provider');
  if(!options||Object.keys(options).some(k=>k!=='allowInitialFill')||options.allowInitialFill!==undefined&&typeof options.allowInitialFill!=='boolean')throw Error('Invalid internal context binding options');
  const context=providerContext(value),old=this.scopes.get(provider)||this.lease(provider);
  const changed=MCP_CONTEXT_KEYS.some(k=>old.context[k]!==context[k]);
  const fill=options.allowInitialFill===true&&MCP_CONTEXT_KEYS.every(k=>old.context[k]===context[k]||old.context[k]===null&&context[k]!==null);
  let scope=old;
  if(changed){if(fill){old.context=context;old.revision++;}else scope=this.lease(provider,context);}
  return Object.freeze({context:scope.context,epoch:scope.epoch,changed,rotated:changed&&!fill});
 }
 connection(provider,base){
  if(!PROVIDERS.has(provider))throw Error('Unsupported provider');
  this.bind(base);const scope=this.scopes.get(provider)||this.lease(provider);
  // Only the current provider/process lease is exposed, never the admin token.
  return {url:this.base.origin+'/providers/'+provider,tokens:{mcp:scope.token},transport:base.transport,health:base.health,epoch:scope.epoch,context:scope.context};
 }
 authenticate({pathname,authorization,origin,host}){
  if(!this.base||origin!==undefined||host!==this.base.host||typeof pathname!=='string')return null;
  const generation=this.identity,baseLease=this.baseLease;
  if(pathname==='/mcp')return sameToken(authorization,'Bearer '+this.base.connection.tokens.mcp)?Object.freeze({provider:null,localReaders:false,generation,epoch:null,...providerContext(),checkCurrent:()=>this.identity===generation&&this.baseLease===baseLease&&!!this.base}):null;
  const match=/^\/providers\/(codex|kimi|qwen|deepseek|compatible)\/mcp$/.exec(pathname);
  if(!match)return null;
  const scope=this.scopes.get(match[1]);
  if(!scope||scope.generation!==this.identity||!sameToken(authorization,'Bearer '+scope.token))return null;
  const revision=scope.revision;
  return Object.freeze({provider:scope.provider,localReaders:true,generation,epoch:scope.epoch,...scope.context,checkCurrent:()=>this.identity===generation&&this.scopes.get(scope.provider)===scope&&scope.revision===revision});
 }
 revoke(provider){if(!PROVIDERS.has(provider))throw Error('Unsupported provider');this.scopes.delete(provider);}
 revokeAll(){this.scopes.clear();this.identity=null;this.base=null;this.baseLease=null;}
}
