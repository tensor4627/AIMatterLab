import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
const PROVIDERS=new Set(['codex','kimi','qwen','deepseek','compatible']);
export const MCP_CONTEXT_KEYS=Object.freeze(['threadId','taskId','projectId','environmentId','inputRoot']);
export function providerContext(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!MCP_CONTEXT_KEYS.includes(k)))throw Error('Invalid trusted provider context');
 return Object.freeze(Object.fromEntries(MCP_CONTEXT_KEYS.map(key=>{const v=value[key]??null;if(v!==null&&(typeof v!=='string'||!v||v.length>(key==='inputRoot'?4096:512)||/[\x00-\x1f]/.test(v)))throw Error('Invalid trusted provider context '+key);return [key,v];})));
}
const sameToken=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class McpProviderScopes {
 constructor(){this.scopes=new Map();this.sessions=new Map();this.sessionTokens=new Map();this.identity=null;this.base=null;this.nextEpoch=0;}
 bind(connection){
  if(!connection||typeof connection.url!=='string'||typeof connection.tokens?.mcp!=='string'||!connection.tokens.mcp)throw Error('An active local worker connection is required');
  const url=new URL(connection.url);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw Error('Expected the loopback MCP proxy root');
  const identity=createHash('sha256').update(connection.url+'\0'+connection.tokens.mcp).digest('hex');
  if(identity!==this.identity){this.revokeAll();this.identity=identity;this.baseLease={};}
  this.base={connection,origin:url.origin,host:url.host};
 }
 get(provider,sessionId){
  const scope=sessionId===undefined?this.scopes.get(provider):this.sessions.get(sessionId);
  if(scope&&scope.provider!==provider)throw Error('Provider session belongs to a different provider');
  return scope;
 }
 lease(provider,context=providerContext(),sessionId){
  const scope={provider,sessionId,token:randomBytes(32).toString('base64url'),generation:this.identity,epoch:++this.nextEpoch,revision:0,context};
  if(sessionId===undefined)this.scopes.set(provider,scope);
  else{this.revoke(provider,sessionId);this.sessions.set(sessionId,scope);this.sessionTokens.set('Bearer '+scope.token,scope);}
  return scope;
 }
 bindContext(provider,value,options={}){
  if(!PROVIDERS.has(provider))throw Error('Unsupported provider');
  if(!options||Object.keys(options).some(k=>!['allowInitialFill','sessionId'].includes(k))||options.allowInitialFill!==undefined&&typeof options.allowInitialFill!=='boolean')throw Error('Invalid internal context binding options');
  const {sessionId}=options;
  if(sessionId!==undefined&&!validSessionId(sessionId))throw Error('Invalid internal provider session identity');
  const context=providerContext(value),old=this.get(provider,sessionId)||this.lease(provider,providerContext(),sessionId);
  const changed=MCP_CONTEXT_KEYS.some(k=>old.context[k]!==context[k]);
  const fill=options.allowInitialFill===true&&MCP_CONTEXT_KEYS.every(k=>old.context[k]===context[k]||old.context[k]===null&&context[k]!==null);
  let scope=old;
  if(changed){if(fill){old.context=context;old.revision++;}else scope=this.lease(provider,context,sessionId);}
  return Object.freeze({context:scope.context,epoch:scope.epoch,changed,rotated:changed&&!fill});
 }
 connection(provider,base,sessionId){
  if(!PROVIDERS.has(provider))throw Error('Unsupported provider');
  if(sessionId!==undefined&&!validSessionId(sessionId))throw Error('Invalid internal provider session identity');
  this.bind(base);const scope=this.get(provider,sessionId)||this.lease(provider,providerContext(),sessionId);
  // Each transport receives its own lease, never the admin token.
  return {url:this.base.origin+'/providers/'+provider,tokens:{mcp:scope.token},transport:base.transport,health:base.health,epoch:scope.epoch,context:scope.context};
 }
 authenticate({pathname,authorization,origin,host}){
  if(!this.base||origin!==undefined||host!==this.base.host||typeof pathname!=='string')return null;
  const generation=this.identity,baseLease=this.baseLease;
  if(pathname==='/mcp')return sameToken(authorization,'Bearer '+this.base.connection.tokens.mcp)?Object.freeze({provider:null,localReaders:false,generation,epoch:null,...providerContext(),checkCurrent:()=>this.identity===generation&&this.baseLease===baseLease&&!!this.base}):null;
  const match=/^\/providers\/(codex|kimi|qwen|deepseek|compatible)\/mcp$/.exec(pathname);
  if(!match)return null;
  const scope=this.sessionTokens.get(authorization)||this.scopes.get(match[1]);
  if(!scope||scope.provider!==match[1]||scope.generation!==this.identity||!sameToken(authorization,'Bearer '+scope.token))return null;
  const revision=scope.revision;
  return Object.freeze({provider:scope.provider,...scope.sessionId===undefined?{}:{sessionId:scope.sessionId},localReaders:true,generation,epoch:scope.epoch,...scope.context,checkCurrent:()=>this.identity===generation&&this.get(scope.provider,scope.sessionId)===scope&&scope.revision===revision});
 }
 revoke(provider,sessionId){
  if(!PROVIDERS.has(provider))throw Error('Unsupported provider');
  if(sessionId===undefined){this.scopes.delete(provider);return;}
  const lease=this.get(provider,sessionId);
  if(lease){this.sessionTokens.delete('Bearer '+lease.token);this.sessions.delete(sessionId);}
 }
 revokeAll(){this.scopes.clear();this.sessions.clear();this.sessionTokens.clear();this.identity=null;this.base=null;this.baseLease=null;}
}
const validSessionId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(value);
