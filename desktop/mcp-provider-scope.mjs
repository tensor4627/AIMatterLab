import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
const PROVIDERS=new Set(['codex','kimi','qwen','deepseek']);
const sameToken=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class McpProviderScopes {
 constructor(){this.scopes=new Map();this.identity=null;this.base=null;}
 bind(connection){
  if(!connection||typeof connection.url!=='string'||typeof connection.tokens?.mcp!=='string'||!connection.tokens.mcp)throw Error('An active local worker connection is required');
  const url=new URL(connection.url);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw Error('Expected the loopback MCP proxy root');
  const identity=createHash('sha256').update(connection.url+'\0'+connection.tokens.mcp).digest('hex');
  if(identity!==this.identity){this.revokeAll();this.identity=identity;}
  this.base={connection,origin:url.origin,host:url.host};
 }
 connection(provider,base){
  if(!PROVIDERS.has(provider))throw Error('Unsupported provider');
  this.bind(base);
  let scope=this.scopes.get(provider);
  if(!scope){scope={provider,token:randomBytes(32).toString('base64url'),generation:this.identity};this.scopes.set(provider,scope);}
  // Only a scoped MCP credential is passed to an agent; never the admin token.
  return {url:this.base.origin+'/providers/'+provider,tokens:{mcp:scope.token},transport:base.transport,health:base.health};
 }
 authenticate({pathname,authorization,origin,host}){
  if(!this.base||origin!==undefined||host!==this.base.host||typeof pathname!=='string')return null;
  if(pathname==='/mcp')return sameToken(authorization,'Bearer '+this.base.connection.tokens.mcp)?{provider:null,localReaders:false,generation:this.identity}:null;
  const match=/^\/providers\/(codex|kimi|qwen|deepseek)\/mcp$/.exec(pathname);
  if(!match)return null;
  const scope=this.scopes.get(match[1]);
  if(!scope||scope.generation!==this.identity||!sameToken(authorization,'Bearer '+scope.token))return null;
  return {provider:scope.provider,localReaders:true,generation:this.identity};
 }
 revoke(provider){if(!PROVIDERS.has(provider))throw Error('Unsupported provider');this.scopes.delete(provider);}
 revokeAll(){this.scopes.clear();this.identity=null;this.base=null;}
}
