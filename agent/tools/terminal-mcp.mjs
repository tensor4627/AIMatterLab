import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {McpProviderScopes} from "./provider-scope.mjs";
import {toolFailure,toolValueResult,validRpcRequest,validToolCall,validToolResponse} from './tool-failure.mjs';
import {sharedTerminalToolAllowed} from "./definition-scope.mjs";

// Desktop-owned terminals do not depend on a registered WSL scientific worker.
// Project skills and public scientific guidance use the same authenticated conversation.
export class TerminalMcp {
 constructor({terminal,guard=()=>null,projectSkills,scientificSkills,desktopTools,workerTools,runScope=(_scope,run)=>run(),captureScope=scope=>scope}){
  Object.assign(this,{terminal,guard,projectSkills,scientificSkills,desktopTools,workerTools,runScope,captureScope});
  this.guides=(scientificSkills?.tools()||[]).filter(tool=>tool.annotations?.readOnlyHint===true);
  this.scopes=new McpProviderScopes();
 }
 async start(){
  if(this.base)return;
  this.server=http.createServer((req,res)=>void this.receive(req,res));
  this.server.requestTimeout=0;this.server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve);});
  this.base={url:'http://127.0.0.1:'+this.server.address().port,tokens:{mcp:randomBytes(32).toString('base64url')},transport:'desktop-terminal'};
  this.scopes.bind(this.base);
 }
 providerConnection(provider,sessionId){return this.base?this.scopes.connection(provider,this.base,sessionId):undefined;}
 bindProviderContext(provider,context,options){return this.scopes.bindContext(provider,context,options);}
 revokeProvider(provider,sessionId){this.scopes.revoke(provider,sessionId);}
 close(){this.scopes.revokeAll();this.base=null;this.server?.close();this.server?.closeIdleConnections();}
 async receive(req,res){
  // Rejections that happen before the request body is consumed must not leave a
  // reusable keep-alive socket behind: Node tears the connection down after the
  // response, and a client reusing it would see ECONNRESET instead of the error.
  const reply=(status,value,close=false)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...(close?{Connection:'close'}:{})});res.end(value===undefined?'':JSON.stringify(value));};
  const reject=(status,value)=>{req.resume();reply(status,value,true);};
  const authenticated=this.scopes.authenticate({pathname:req.url,authorization:req.headers.authorization,origin:req.headers.origin,host:req.headers.host});
  if(!authenticated?.localReaders){reject(403);return;}
  const scope=this.captureScope(authenticated);
  if(req.method!=='POST'){reject(405);return;}
  let body,token,dispatched=false;const guard=this.guard(),fresh=()=>{if(scope.checkCurrent()!==true)throw Error('Terminal provider context changed');};
  try{await this.runScope(scope,async()=>{
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){reject(415);return;}
   const chunks=[],limit=this.desktopTools?256*1024:32768;let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit){reply(413,undefined,true);return;}chunks.push(chunk);}
   try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{reply(400);return;}
   fresh();
   if(body?.jsonrpc==='2.0'&&body.method==='notifications/initialized'&&body.id===undefined){reply(202);return;}
   if(!validRpcRequest(body)){reply(400);return;}
   let result;
   if(body.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{listChanged:false}},serverInfo:{name:'studio-shared-terminal',version:'1.0.0'}};
   else if(body.method==='ping')result={};
   else if(body.method==='resources/list')result={resources:[]};
   else if(body.method==='resources/templates/list')result={resourceTemplates:[]};
   else if(body.method==='tools/list'){
    // Discovery is required before a new conversation has a thread identity.
    // Definitions confer no access: every call still checks the actual handoff.
    const worker=await this.workerTools?.list(scope),local=[...this.terminal.tools().filter(tool=>sharedTerminalToolAllowed(tool.name)),...(this.projectSkills?.tools()||[]),...this.guides,...(this.desktopTools?.tools()||[])];
    const tools=[...new Map([...(worker?.tools||[]),...local].map(tool=>[tool.name,tool])).values()];
    result={tools,...worker?._meta?{_meta:worker._meta}:{}};
   }else if(body.method==='tools/call'){
    if(!validToolCall(body))throw Error('Invalid tool call');
    const {name,arguments:args={}}=body.params;
    if(this.desktopTools?.owns(name)){
     if(!scope.sessionId||!scope.threadId)throw Error('Select an agent conversation before using managed compute');
     dispatched=true;result=toolValueResult(await this.desktopTools.call(name,args,scope));
    }else if(this.projectSkills?.owns(name)){
     dispatched=true;result=toolValueResult(this.projectSkills.call(name,args,scope));
    }else if(this.guides.some(tool=>tool.name===name)){
     if(!scope.threadId)throw Error('Select a conversation before reading skill guidance');
     dispatched=true;result=toolValueResult(await this.scientificSkills.call(name,args,scope));
    }else if(sharedTerminalToolAllowed(name)){
     token=await guard?.before?.(name,args,scope.provider,scope);fresh();
     dispatched=true;result=toolValueResult(await this.terminal.callTool(name,args,scope));fresh();
     await guard?.after?.(token,result);
    }else{
     if(!this.workerTools)throw Error('Unknown shared terminal tool');
     dispatched=true;result=await this.workerTools.call(name,args,scope);
    }
   }else{reply(200,{jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'Method not found'}});return;}
   fresh();reply(200,{jsonrpc:'2.0',id:body.id,result});
  });}catch(error){
   guard?.cancel?.(token);
   if(scope.checkCurrent()!==true||error.staleProviderScope){reject(403);return;}
   if(body?.method==='tools/call'&&validRpcRequest(body)){reply(200,{jsonrpc:'2.0',id:body.id,result:toolFailure(error,{dispatched})});return;}
   reply(400,{error:'Invalid terminal MCP request'},body===undefined);
  }
 }
}

/** Forward only MCP to the verified private desktop WorkerClient proxy. */
export function workerToolBridge({connection,fetchApi=fetch}){
 let id=0;
 async function request(scope,method,params,timeout){
  if(scope.checkCurrent()!==true)throw Error('Worker scope expired');
  const worker=await connection(scope);
  if(!worker||!scope.sessionId)return null;
  const url=new URL(worker.url);
  if(url.origin!==`http://127.0.0.1:${url.port}`||url.pathname!=='/providers/'+scope.provider||worker.url!==url.origin+url.pathname||typeof worker.tokens?.mcp!=='string'||!worker.tokens.mcp)throw Error('Invalid desktop worker MCP transport');
  if(scope.checkCurrent()!==true)throw Error('Worker scope expired');
  const requestId=++id,response=await fetchApi(worker.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+worker.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),signal:AbortSignal.timeout(timeout),redirect:'error'});
  if(scope.checkCurrent()!==true)throw Error('Worker scope expired');
  if(!response.ok)throw Error('The authorized worker did not confirm the tool request');
  const body=await response.json();
  if(body.jsonrpc!=='2.0'||body.id!==requestId||body.error)throw Error('The authorized worker did not confirm the tool request');
  if(method==='tools/call'&&!validToolResponse(body,requestId))throw Error('The authorized worker returned an invalid tool result');
  return body.result;
 }
 return {
  async list(scope){try{return await request(scope,'tools/list',{},10000);}catch{return {_meta:{studioWarnings:['tools_unavailable']}};}},
  async call(name,args,scope){const result=await request(scope,'tools/call',{name,arguments:args},245000);if(!result)throw Error('The current conversation has no authorized scientific worker connection');return result;}
 };
}
