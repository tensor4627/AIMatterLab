/** Provider-scoped MCP composition over the compute transport; no implicit project grants. */
import http from 'node:http';
import {WorkerClient as ComputeWorkerClient} from '../../backend/main/compute/worker.mjs';
import {environmentApiFailure} from '../../backend/main/compute/environment-api-read.mjs';
import {McpProviderScopes,providerContext} from './provider-scope.mjs';
import {toolFailure,toolValueResult,validToolCall,validRpcRequest,validToolResponse} from './tool-failure.mjs';
export class WorkerClient extends ComputeWorkerClient{
 constructor(options={}){super({...options,providerScopes:new McpProviderScopes()});this.providerContexts=new Map();}
setAuthoringGuard(guard){this.authoringGuard=guard;}
setResourceUseGuard(guard){this.resourceUseGuard=guard;}
setLocalTools(definitions,handler){this.localDefinitions=definitions;this.localHandler=handler;}
setScopedTools(definitions,handler){this.scopedDefinitions=definitions;this.scopedHandler=handler;}
bindProviderContext(provider,context,options={}){
  if(!['codex','kimi','qwen','deepseek','compatible'].includes(provider))throw Error('Unsupported provider');
  const normalized=providerContext(context);this.providerContexts.set(provider,normalized);
  if(!this.connection)return {context:normalized,epoch:null,changed:true,rotated:false};
  this.providerScopes.bind(this.connection);return this.providerScopes.bindContext(provider,normalized,options);
 }
providerConnection(provider){
  if(!this.connection||this.connecting||this.restoring)return undefined;
  this.providerScopes.bind(this.connection);
  const context=this.providerContexts.get(provider);
  if(context&&!this.providerScopes.scopes.has(provider))this.providerScopes.bindContext(provider,context);
  return this.providerScopes.connection(provider,this.connection);
 }
revokeProvider(provider){this.providerScopes.revoke(provider);}
async exposeTools(health){
  this.proxy=http.createServer(async(req,res)=>{
   // Early rejects must close the connection: the request body is still unread,
   // and a keep-alive client reusing this socket would otherwise get ECONNRESET.
   const reject=(status,value)=>{req.resume();res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Connection':'close'});res.end(value===undefined?'':JSON.stringify(value));};
   const scope=this.providerScopes.authenticate({pathname:req.url,authorization:req.headers.authorization,origin:req.headers.origin,host:req.headers.host});
   if(!scope){reject(403);return;}
   if(!['GET','POST'].includes(req.method)){reject(405);return;}
   let authoringToken,body,dispatched=false;
   const fresh=()=>{if(scope.checkCurrent()!==true){const error=Error('Provider context lease expired');error.staleProviderScope=true;throw error;}};
   try{
    const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>4*1024*1024)throw Error('Request too large');chunks.push(chunk);}
    fresh();
    body=bytes?JSON.parse(Buffer.concat(chunks).toString('utf8')):undefined;
    if(body?.method==='tools/call'&&!validRpcRequest(body)){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({jsonrpc:'2.0',id:typeof body.id==='string'||Number.isSafeInteger(body.id)?body.id:null,error:{code:-32600,message:'Tool calls require a JSON-RPC 2.0 request with a string or integer id'}}));return;}
    if(body?.method==='tools/call'&&!validToolCall(body))throw Error('Invalid tool request: provide a tool name and an arguments object');
    if(body?.method==='tools/call'&&scope.provider&&this.resourceUseGuard){
     let allowed=false;try{allowed=await this.resourceUseGuard(scope.provider,scope,body.params.name)===true;}catch{}
     if(!allowed){reject(403);return;}fresh();
    }
    authoringToken=body?.method==='tools/call'?await this.authoringGuard?.before(body.params?.name,body.params?.arguments||{},scope.provider,scope):null;
    fresh();
    let response;
    const scopedTool=(this.scopedDefinitions||[]).some(t=>t.name===body?.params?.name);
    if(body?.method==='tools/call'&&scopedTool){
     if(!scope.localReaders){res.writeHead(403);res.end();return;}
     let result;try{fresh();dispatched=true;const value=await this.scopedHandler(body.params.name,body.params.arguments||{},scope);result=toolValueResult(value);}catch(e){result=body.params.name==='inspect_environment_api'?toolValueResult(environmentApiFailure(e,{dispatched})):toolFailure(e,{dispatched});}
     response={status:200,data:{jsonrpc:'2.0',id:body.id,result}};
    }else if(body?.method==='tools/call'&&(this.localDefinitions||[]).some(t=>t.name===body.params?.name)){
     let result;try{fresh();dispatched=true;result=toolValueResult(await this.localHandler(body.params.name,body.params.arguments||{},scope));}catch(e){result=toolFailure(e,{dispatched});}
     response={status:200,data:{jsonrpc:'2.0',id:body.id,result}};
    }else if(this.relay){fresh();dispatched=true;response=await this.forward(req.method,'/mcp',body,true);}
    else{fresh();dispatched=true;const upstream=await fetch(this.upstream+'/mcp',{method:req.method,headers:{Authorization:'Bearer '+this.connection.tokens.mcp,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(245000)});const text=await upstream.text();response={status:upstream.status,data:text?JSON.parse(text):null};}
    fresh();
    if(body?.method==='tools/call'&&(response.status!==200||!validToolResponse(response.data,body.id)))throw Error('Tool service returned an unconfirmed response; inspect the existing workflow before continuing');
    if(body?.method==='tools/call')await this.authoringGuard?.after(authoringToken,response.data?.result);
    if(body?.method==='tools/list'&&response.data?.result?.tools){const independent=this.identity?.version===3&&typeof this.identity.connectionId==='string',local=(this.localDefinitions||[]).filter(tool=>independent||this.identity?.kind!=='ssh'||!['list_shared_terminals','read_shared_terminal','write_shared_terminal'].includes(tool.name));response.data.result.tools.push(...local,...(scope.localReaders?this.scopedDefinitions||[]:[]));if(this.authoringGuard?.filterTools)response.data.result.tools=await this.authoringGuard.filterTools(response.data.result.tools,scope.provider,scope);}
    fresh();
    res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(response.data===null?'':JSON.stringify(response.data));
   }catch(e){this.authoringGuard?.cancel?.(authoringToken);if(e.staleProviderScope||scope.checkCurrent()!==true){reject(403);}else if(body?.method==='tools/call'&&body.id!==undefined){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:body.params?.name==='inspect_environment_api'?toolValueResult(environmentApiFailure(e,{dispatched})):toolFailure(e,{dispatched})}));}else{reject(502,{error:e.message});}}
  });
  await new Promise((resolve,reject)=>{this.proxy.once('error',reject);this.proxy.listen(0,'127.0.0.1',resolve);});
  this.connection.url='http://127.0.0.1:'+this.proxy.address().port;
  this.providerScopes.bind(this.connection);
  return {...health,transport:this.connection.transport};
 }
async probeTools(){
  if(!this.connection)return {status:'blocked',message:'请先连接 WSL 作业服务',count:0};
  const response=await fetch(this.connection.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+this.connection.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('科学工具服务未通过连接检查');
  const result=await response.json(),names=(result.result?.tools||[]).map(t=>t.name);
  if(result.error||!names.includes('present_task'))throw Error('科学工具缺少草稿保存接口，请重新连接');
  return {status:'ready',count:names.length,transport:this.connection.transport,checkedAt:Date.now()};
 }
}
