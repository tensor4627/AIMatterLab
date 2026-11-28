/** Provider-scoped MCP composition over the compute transport; no implicit project grants. */
import http from 'node:http';
import {WorkerClient as ComputeWorkerClient} from '../../backend/main/compute/worker.mjs';
import {environmentApiFailure} from '../../backend/main/compute/environment-api-read.mjs';
import {McpProviderScopes,providerContext} from './provider-scope.mjs';
import {toolFailure,toolValueResult,validToolCall,validRpcRequest,validToolResponse} from './tool-failure.mjs';
export class WorkerClient extends ComputeWorkerClient{
 constructor(options={}){super({...options,providerScopes:new McpProviderScopes()});this.providerContexts=new Map();this.runToolScope=(_scope,run)=>run();}
setToolScope(run){this.runToolScope=run;}
setAuthoringGuard(guard){this.authoringGuard=guard;}
setResourceUseGuard(guard){this.resourceUseGuard=guard;}
setLocalTools(definitions,handler){this.localDefinitions=definitions;this.localHandler=handler;}
setProjectSkills(skills){this.projectSkills=skills;}
setScopedTools(definitions,handler){this.scopedDefinitions=definitions;this.scopedHandler=handler;}
bindProviderContext(provider,context,options={}){
  if(!['codex','kimi','qwen','deepseek','compatible'].includes(provider))throw Error('Unsupported provider');
  const normalized=providerContext(context);this.providerContexts.set(options.sessionId??provider,{provider,context:normalized});
  if(!this.connection)return {context:normalized,epoch:null,changed:true,rotated:false};
  this.providerScopes.bind(this.connection);return this.providerScopes.bindContext(provider,normalized,options);
 }
providerConnection(provider,sessionId){
  if(!this.connection||this.connecting||this.restoring)return undefined;
  this.providerScopes.bind(this.connection);
  const binding=this.providerContexts.get(sessionId??provider);
  if(binding?.provider===provider&&!this.providerScopes.get(provider,sessionId))this.providerScopes.bindContext(provider,binding.context,{sessionId});
  return this.providerScopes.connection(provider,this.connection,sessionId);
 }
revokeProvider(provider,sessionId){this.providerScopes.revoke(provider,sessionId);if(sessionId!==undefined)this.providerContexts.delete(sessionId);}
async discoverTools(id,{refresh=false}={}){
  const connection=this.connection,previous=this.toolCatalog?.connection===connection?this.toolCatalog:null;
  let catalog=previous;
  if(!catalog||refresh){
   try{
    const body={jsonrpc:'2.0',id,method:'tools/list',params:{}},response=this.relay?await this.forward('POST','/mcp',body,true,10000):await fetch(this.upstream+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+connection.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)}).then(async r=>({status:r.status,data:await r.json()}));
    const tools=response.data?.result?.tools;
    if(response.status!==200||response.data?.error||!Array.isArray(tools)||tools.some(t=>!t||typeof t.name!=='string'))throw Error('Tool catalog unavailable');
    catalog={connection,tools:structuredClone(tools),warnings:tools.length?[]:['tools_incomplete']};
   }catch{catalog={connection,tools:previous?.tools||[],warnings:['tools_unavailable']};}
   if(this.connection===connection)this.toolCatalog=catalog;
  }
  return {status:200,data:{jsonrpc:'2.0',id,result:{tools:structuredClone(catalog.tools),...(catalog.warnings.length?{_meta:{studioWarnings:catalog.warnings}}:{})}}};
 }
async prepareToolProxy(connection){
  const proxy=http.createServer(async(req,res)=>{
   // Early rejects must close the connection: the request body is still unread,
   // and a keep-alive client reusing this socket would otherwise get ECONNRESET.
   const reject=(status,value)=>{req.resume();res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Connection':'close'});res.end(value===undefined?'':JSON.stringify(value));};
   if(this.connection!==connection){reject(403);return;}
   const scope=this.providerScopes.authenticate({pathname:req.url,authorization:req.headers.authorization,origin:req.headers.origin,host:req.headers.host});
   if(!scope){reject(403);return;}
   if(!['GET','POST'].includes(req.method)){reject(405);return;}
   let authoringToken,body,dispatched=false;
   const fresh=()=>{if(scope.checkCurrent()!==true){const error=Error('Provider context lease expired');error.staleProviderScope=true;throw error;}};
   try{await this.runToolScope(scope,async()=>{
    const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>4*1024*1024)throw Error('Request too large');chunks.push(chunk);}
    fresh();
    body=bytes?JSON.parse(Buffer.concat(chunks).toString('utf8')):undefined;
    if(body?.method==='tools/call'&&!validRpcRequest(body)){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({jsonrpc:'2.0',id:typeof body.id==='string'||Number.isSafeInteger(body.id)?body.id:null,error:{code:-32600,message:'Tool calls require a JSON-RPC 2.0 request with a string or integer id'}}));return;}
    if(body?.method==='tools/call'&&!validToolCall(body))throw Error('Invalid tool request: provide a tool name and an arguments object');
    const projectSkill=scope.localReaders&&this.projectSkills?.owns(body?.params?.name);
    if(body?.method==='tools/call'&&!projectSkill&&scope.provider&&this.resourceUseGuard){
     let allowed=false;try{allowed=await this.resourceUseGuard(scope.provider,scope,body.params.name)===true;}catch{}
     if(!allowed){reject(403);return;}fresh();
    }
    authoringToken=body?.method==='tools/call'&&!projectSkill?await this.authoringGuard?.before(body.params?.name,body.params?.arguments||{},scope.provider,scope):null;
    fresh();
    let response;
    const independent=this.identity?.version===3&&typeof this.identity.connectionId==='string';
    // Discovery belongs to the desktop adapter. It remains available for
    // environment setup even when a remote tool catalog is incomplete.
    if(independent&&req.method==='GET'){res.writeHead(405,{'Content-Type':'application/json'});res.end();return;}
    if(independent&&body?.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
    const scopedTool=(this.scopedDefinitions||[]).some(t=>t.name===body?.params?.name);
    const localCall=async handler=>{
     fresh();
     const controller=new AbortController(),close=()=>controller.abort();
     res.once('close',close);
     try{
      if(res.destroyed)close();
      const value=await handler(body.params.name,body.params.arguments||{},scope,{signal:controller.signal});
      dispatched=true;
      return toolValueResult(value);
     }finally{res.off('close',close);}
    };
    const failure=e=>body.params.name==='inspect_environment_api'?toolValueResult(environmentApiFailure(e,{dispatched})):toolFailure(e,{dispatched,toolName:body.params.name});
    if(body?.method==='tools/call'&&projectSkill){response={status:200,data:{jsonrpc:'2.0',id:body.id,result:await localCall(this.projectSkills.call.bind(this.projectSkills))}};}else if(independent&&['initialize','ping','resources/list','resources/templates/list'].includes(body?.method)){
     const result=body.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{listChanged:false}},serverInfo:{name:'aimatterlab',version:'1.0.0'}}:body.method==='resources/list'?{resources:[]}:body.method==='resources/templates/list'?{resourceTemplates:[]}:{};
     response={status:200,data:{jsonrpc:'2.0',id:body.id,result}};
    }else if(independent&&body?.method==='tools/list'){
     response=await this.discoverTools(body.id,{refresh:scope.provider===null&&req.headers['x-studio-refresh-tools']==='1'});
    }else if(body?.method==='tools/call'&&scopedTool){
     if(!scope.localReaders){res.writeHead(403);res.end();return;}
     let result;try{result=await localCall(this.scopedHandler.bind(this));}catch(e){result=failure(e);}
     response={status:200,data:{jsonrpc:'2.0',id:body.id,result}};
    }else if(body?.method==='tools/call'&&(this.localDefinitions||[]).some(t=>t.name===body.params?.name)){
     let result;try{result=await localCall(this.localHandler.bind(this));}catch(e){result=failure(e);}
     response={status:200,data:{jsonrpc:'2.0',id:body.id,result}};
    }else if(this.relay){fresh();response=await this.forward(req.method,'/mcp',body,true,245000,()=>{dispatched=true;});dispatched=true;}
    else{fresh();const payload=body?JSON.stringify(body):undefined;dispatched=true;const upstream=await fetch(this.upstream+'/mcp',{method:req.method,headers:{Authorization:'Bearer '+this.connection.tokens.mcp,'Content-Type':'application/json'},body:payload,signal:AbortSignal.timeout(245000)});const text=await upstream.text();response={status:upstream.status,data:text?JSON.parse(text):null};}
    fresh();
    if(body?.method==='tools/call'&&(response.status!==200||!validToolResponse(response.data,body.id)))throw Error('Tool service returned an unconfirmed response; inspect the existing workflow before continuing');
    if(body?.method==='tools/call'&&!projectSkill)await this.authoringGuard?.after(authoringToken,response.data?.result);
    if(body?.method==='tools/list'&&response.data?.result?.tools){const independent=this.identity?.version===3&&typeof this.identity.connectionId==='string',local=(this.localDefinitions||[]).filter(tool=>independent||this.identity?.kind!=='ssh'||!['list_shared_terminals','read_shared_terminal','write_shared_terminal'].includes(tool.name));response.data.result.tools.push(...local,...(scope.localReaders?this.scopedDefinitions||[]:[]));if(this.authoringGuard?.filterTools)response.data.result.tools=await this.authoringGuard.filterTools(response.data.result.tools,scope.provider,scope);}
    if(body?.method==='tools/list'&&scope.localReaders&&response.data?.result?.tools)response.data.result.tools.push(...(this.projectSkills?.tools()||[]));
    fresh();
    res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(response.data===null?'':JSON.stringify(response.data));
   });}catch(e){this.authoringGuard?.cancel?.(authoringToken);if(e.staleProviderScope||scope.checkCurrent()!==true){reject(403);}else if(body?.method==='tools/call'&&body.id!==undefined){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:body.params?.name==='inspect_environment_api'?toolValueResult(environmentApiFailure(e,{dispatched})):toolFailure(e,{dispatched,toolName:body.params?.name})}));}else{reject(502,{error:e.message});}}
  });
  await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',resolve);});
  connection.url='http://127.0.0.1:'+proxy.address().port;
  return proxy;
 }
async exposeTools(health){
  const connection=this.connection,proxy=await this.prepareToolProxy(connection);
  if(this.connection!==connection){proxy.close();throw Error('Worker connection was superseded');}
  this.proxy=proxy;this.providerScopes.bind(connection);
  return {...health,transport:connection.transport};
 }
async probeTools(){
  if(!this.connection)return {status:'blocked',message:'请先连接 WSL 作业服务',count:0};
  const response=await fetch(this.connection.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+this.connection.tokens.mcp,'Content-Type':'application/json','x-studio-refresh-tools':'1'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('科学工具服务未通过连接检查');
  const result=await response.json(),names=(result.result?.tools||[]).map(t=>t.name);
  if(result.error)throw Error('工具清单尚未取得');
  const warnings=result.result?._meta?.studioWarnings||(!names.includes('present_task')?['tools_incomplete']:[]);
  if(warnings.length)return {status:'warning',count:names.length,transport:this.connection.transport,warnings,message:'服务已连接，工具清单尚未完整核对；可继续使用终端讨论和配置环境。',checkedAt:Date.now()};
  return {status:'ready',count:names.length,transport:this.connection.transport,checkedAt:Date.now()};
 }
}
