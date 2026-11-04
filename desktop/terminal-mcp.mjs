import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {McpProviderScopes} from './mcp-provider-scope.mjs';
import {toolFailure,toolValueResult,validRpcRequest,validToolCall} from './tool-failure.mjs';
import {sharedTerminalToolAllowed} from './private-definition-scope.mjs';

// Desktop-owned terminals do not depend on a registered WSL scientific worker.
// This endpoint exposes only the three existing, explicitly handed-off tools.
export class TerminalMcp {
 constructor({terminal,guard=()=>null}){this.terminal=terminal;this.guard=guard;this.scopes=new McpProviderScopes();}
 async start(){
  if(this.base)return;
  this.server=http.createServer((req,res)=>void this.receive(req,res));
  this.server.requestTimeout=15000;this.server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve);});
  this.base={url:'http://127.0.0.1:'+this.server.address().port,tokens:{mcp:randomBytes(32).toString('base64url')},transport:'desktop-terminal'};
  this.scopes.bind(this.base);
 }
 providerConnection(provider){return this.base?this.scopes.connection(provider,this.base):undefined;}
 bindProviderContext(provider,context,options){return this.scopes.bindContext(provider,context,options);}
 revokeProvider(provider){this.scopes.revoke(provider);}
 close(){this.scopes.revokeAll();this.base=null;this.server?.close();this.server?.closeIdleConnections();}
 async receive(req,res){
  const reply=(status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(value===undefined?'':JSON.stringify(value));};
  const scope=this.scopes.authenticate({pathname:req.url,authorization:req.headers.authorization,origin:req.headers.origin,host:req.headers.host});
  if(!scope?.localReaders){req.resume();reply(403);return;}
  if(req.method!=='POST'){req.resume();reply(405);return;}
  let body,token,dispatched=false;const guard=this.guard(),fresh=()=>{if(scope.checkCurrent()!==true)throw Error('Terminal provider context changed');};
  try{
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){req.resume();reply(415);return;}
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>32768){reply(413);return;}chunks.push(chunk);}
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
    result={tools:this.terminal.tools().filter(tool=>sharedTerminalToolAllowed(tool.name))};
   }else if(body.method==='tools/call'){
    if(!validToolCall(body)||!sharedTerminalToolAllowed(body.params.name))throw Error('Unknown shared terminal tool');
    token=await guard?.before?.(body.params.name,body.params.arguments||{},scope.provider,scope);fresh();
    dispatched=true;result=toolValueResult(await this.terminal.callTool(body.params.name,body.params.arguments||{},scope));fresh();
    await guard?.after?.(token,result);
   }else{reply(200,{jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'Method not found'}});return;}
   fresh();reply(200,{jsonrpc:'2.0',id:body.id,result});
  }catch(error){
   guard?.cancel?.(token);
   if(scope.checkCurrent()!==true){reply(403);return;}
   if(body?.method==='tools/call'&&validRpcRequest(body)){reply(200,{jsonrpc:'2.0',id:body.id,result:toolFailure(error,{dispatched})});return;}
   reply(400,{error:'Invalid terminal MCP request'});
  }
 }
}
