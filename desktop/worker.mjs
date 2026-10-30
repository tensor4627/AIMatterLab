import { execFile,spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {createInterface} from 'node:readline';
import http from 'node:http';
import {McpProviderScopes,providerContext} from './mcp-provider-scope.mjs';
import {toolFailure,toolValueResult,validToolCall,validRpcRequest,validToolResponse} from './tool-failure.mjs';
import {workerConnectionFailure} from './worker-connection-failure.mjs';
import {readExistingWorker,EXISTING_WORKER_RELAY} from './existing-worker.mjs';
import {readWorkerStatus} from './worker-status.mjs';
import path from 'node:path';
import { linuxPath, assertWorkerRoute } from './security.mjs';
const exec = promisify(execFile);
export class WorkerClient {
 constructor({readExisting=readExistingWorker,launchRelay=spawn}={}){this.pending=new Map();this.next=1;this.providerScopes=new McpProviderScopes();this.providerContexts=new Map();this.connectionEpoch=0;this.bindingIntent=0;this.readExisting=readExisting;this.launchExistingRelay=launchRelay;}
 async connect(settings,source){
  this.bindingIntent++;
  if(this.restoring)await this.restoring.catch(()=>{});
  const key=JSON.stringify([settings.distribution,settings.workerRoot,settings.workerPort,!!settings.forceRelay,source]);
  if(this.connecting){if(this.connectingKey===key)return this.connecting;await this.connecting.catch(()=>{});if(this.matchesTarget(settings)&&this.connectedSource===source){const status=await readWorkerStatus(this,()=>settings);if(status.status==='connected')return {...this.connection.health,transport:this.connection.transport};}return this.connect(settings,source);}
  this.connectionFailure=null;
  this.connectingKey=key;let pending;pending=this.open(settings,source).then(value=>{this.connectionFailure=null;return value;},error=>{this.close();this.connectionFailure=workerConnectionFailure(error);throw error;}).finally(()=>{if(this.connecting===pending){this.connecting=null;this.connectingKey=null;}});this.connecting=pending;return pending;
 }
 async open(settings, source) {
  this.close();
  const epoch=this.connectionEpoch,check=()=>{if(epoch!==this.connectionEpoch)throw Error('Worker connection was superseded');};
  const installed=await exec('wsl.exe',['-d',settings.distribution,'--','python3',linuxPath(path.join(source,'install.py')),'--source',linuxPath(source),'--root',settings.workerRoot],{windowsHide:true,timeout:20000,maxBuffer:1024*1024});
  check();
  const runtime=JSON.parse(installed.stdout.trim().split('\n').at(-1)).path;
  const { stdout } = await exec('wsl.exe', ['-d', settings.distribution, '--',
    'python3', runtime+'/bootstrap.py', '--root', settings.workerRoot,
    '--port', String(settings.workerPort)], { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 });
  check();this.connection = JSON.parse(stdout.trim().split('\n').at(-1));
  this.identity={distribution:settings.distribution,root:this.connection.health.root};
  this.upstream=this.connection.url;
  this.connectionTarget={distribution:settings.distribution,root:this.identity.root,requestedRoot:settings.workerRoot,port:settings.workerPort};
  this.connectedSource=source;
  return this.attachTransport(settings,this.connection.health,check);
 }
 async attachTransport(settings,initialHealth,check){
  const runtime=initialHealth.runtime;
  try{
   if(settings.forceRelay)throw Error("WSL stdio relay explicitly selected");
   const response=await fetch(this.upstream+'/api/health',{headers:{Authorization:'Bearer '+this.connection.tokens.admin},signal:AbortSignal.timeout(1500)});
   if(!response.ok)throw Error('Health check rejected');
   const health=await response.json();if(health.root!==this.connection.health.root)throw Error('Worker identity mismatch');
   check();this.connection.transport='localhost';const exposed=await this.exposeTools(health);check();return exposed;
  }catch{
   check();
   const relay=this.relay=spawn('wsl.exe',['-d',settings.distribution,'--','python3',runtime+'/relay.py','--root',settings.workerRoot,'--port',String(settings.workerPort)],{stdio:['pipe','pipe','pipe'],windowsHide:true});
   createInterface({input:this.relay.stdout}).on('line',line=>{
    try{const value=JSON.parse(line),item=this.pending.get(value.id);if(item){clearTimeout(item.timer);this.pending.delete(value.id);item.resolve(value);}}catch{}
   });
   relay.on('error',e=>{if(this.relay===relay)this.reject(e);});
   relay.on('exit',()=>{if(this.relay===relay){this.providerScopes.revokeAll();this.reject(Error('WSL relay disconnected; job status is unknown'));this.connection=null;}});
   this.relay.stderr.on('data',()=>{});
   const health=await this.forward('GET','/api/health',undefined,false,10000);
   if(health.status!==200||health.data.root!==this.connection.health.root)throw Error('WSL relay identity mismatch');
   check();const exposed=await this.exposeTools({...health.data,transport:'wsl-stdio'});check();return exposed;
  }
 }
 async attachExistingTransport(settings,initialHealth,check){
  check();const relay=this.relay=this.launchExistingRelay('wsl.exe',['-d',settings.distribution,'--','python3','-B','-c',EXISTING_WORKER_RELAY,settings.workerRoot,String(settings.workerPort)],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  createInterface({input:relay.stdout}).on('line',line=>{try{const value=JSON.parse(line),item=this.pending.get(value.id);if(item){clearTimeout(item.timer);this.pending.delete(value.id);item.resolve(value);}}catch{}});
  relay.on('error',error=>{if(this.relay===relay)this.reject(error);});
  relay.on('exit',()=>{if(this.relay===relay){this.providerScopes.revokeAll();this.reject(Error('Existing WSL relay disconnected; job status is unknown'));this.connection=null;}});
  relay.stderr.on('data',()=>{});
  const health=await this.forward('GET','/api/health',undefined,false,10000);check();
  if(health.status!==200||health.data?.name!=='gpu-sampling-studio'||['root','runtime','execution_policy'].some(key=>health.data[key]!==initialHealth[key]))throw Error('Existing WSL worker identity unavailable');
  this.connection.transport='wsl-stdio';const exposed=await this.exposeTools({...health.data,transport:'wsl-stdio'});check();return exposed;
 }
 async restore(settings,{current=()=>true}={}){
  const result=(status,reason)=>({status,reason}),intent=this.bindingIntent,epoch=this.connectionEpoch;
  const valid=()=>current()&&intent===this.bindingIntent;
  if(this.restoring){await this.restoring.catch(()=>{});if(!valid())return result('unknown','superseded');return this.restore(settings,{current});}
  if(this.connecting)return result('checking','binding_in_progress');
  const same=()=>this.identity?.distribution===settings.distribution&&(this.identity?.root===settings.workerRoot||this.connectionTarget?.requestedRoot===settings.workerRoot)&&(!this.connectionTarget||this.connectionTarget.port===settings.workerPort);
  if(this.connection){if(!same())return result('unknown','binding_mismatch');const status=await readWorkerStatus(this,()=>settings);return valid()&&this.connectionEpoch===epoch&&same()?result(status.status,'existing'):result('unknown','superseded');}
  let pending;pending=(async()=>{
   let attached;
   try{
    const observed=await this.readExisting(settings);
    if(!valid()||this.connectionEpoch!==epoch||this.connection||this.connecting)return result('unknown','superseded');
    if(observed.status!=='connected')return result(observed.status==='disconnected'?'disconnected':'unknown','existing_unavailable');
    attached=observed.connection;if(attached?.health?.name!=='gpu-sampling-studio'||attached.health.root!==settings.workerRoot||attached.health.execution_policy!=='desktop-review-v1'||typeof attached.health.runtime!=='string'||attached.url!=='http://127.0.0.1:'+settings.workerPort||!attached.tokens?.admin||!attached.tokens?.mcp)return result('unknown','identity_unavailable');
    this.connection=attached;this.identity={distribution:settings.distribution,root:attached.health.root};this.upstream=attached.url;this.connectionTarget={distribution:settings.distribution,root:attached.health.root,requestedRoot:settings.workerRoot,port:settings.workerPort};
    const check=()=>{if(!valid()||this.connection!==attached||this.connectionEpoch!==epoch)throw Error('Existing attachment superseded');};
    await this.attachExistingTransport(settings,attached.health,check);check();return result('connected','restored');
   }catch{if(attached&&this.connection===attached&&!this.connecting)this.close();return result('unknown','existing_unavailable');}
  })().finally(()=>{if(this.restoring===pending)this.restoring=null;});this.restoring=pending;return pending;
 }
 matchesTarget(settings){return this.identity?.distribution===settings.distribution&&(this.identity.root===settings.workerRoot||this.connectionTarget?.requestedRoot===settings.workerRoot)&&this.connectionTarget?.port===settings.workerPort;}
 setAuthoringGuard(guard){this.authoringGuard=guard;}
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
   const scope=this.providerScopes.authenticate({pathname:req.url,authorization:req.headers.authorization,origin:req.headers.origin,host:req.headers.host});
   if(!scope){res.writeHead(403);res.end();return;}
   if(!['GET','POST'].includes(req.method)){res.writeHead(405);res.end();return;}
   let authoringToken,body,dispatched=false;
   const fresh=()=>{if(scope.checkCurrent()!==true){const error=Error('Provider context lease expired');error.staleProviderScope=true;throw error;}};
   try{
    const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>4*1024*1024)throw Error('Request too large');chunks.push(chunk);}
    fresh();
    body=bytes?JSON.parse(Buffer.concat(chunks).toString('utf8')):undefined;
    if(body?.method==='tools/call'&&!validRpcRequest(body)){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({jsonrpc:'2.0',id:typeof body.id==='string'||Number.isSafeInteger(body.id)?body.id:null,error:{code:-32600,message:'Tool calls require a JSON-RPC 2.0 request with a string or integer id'}}));return;}
    if(body?.method==='tools/call'&&!validToolCall(body))throw Error('Invalid tool request: provide a tool name and an arguments object');
    authoringToken=body?.method==='tools/call'?await this.authoringGuard?.before(body.params?.name,body.params?.arguments||{},scope.provider,scope):null;
    fresh();
    let response;
    const scopedTool=(this.scopedDefinitions||[]).some(t=>t.name===body?.params?.name);
    if(body?.method==='tools/call'&&scopedTool){
     if(!scope.localReaders){res.writeHead(403);res.end();return;}
     let result;try{fresh();dispatched=true;const value=await this.scopedHandler(body.params.name,body.params.arguments||{},scope);result=toolValueResult(value);}catch(e){result=toolFailure(e,{dispatched});}
     response={status:200,data:{jsonrpc:'2.0',id:body.id,result}};
    }else if(body?.method==='tools/call'&&(this.localDefinitions||[]).some(t=>t.name===body.params?.name)){
     let result;try{fresh();dispatched=true;result=toolValueResult(await this.localHandler(body.params.name,body.params.arguments||{},scope));}catch(e){result=toolFailure(e,{dispatched});}
     response={status:200,data:{jsonrpc:'2.0',id:body.id,result}};
    }else if(this.relay){fresh();dispatched=true;response=await this.forward(req.method,'/mcp',body,true);}
    else{fresh();dispatched=true;const upstream=await fetch(this.upstream+'/mcp',{method:req.method,headers:{Authorization:'Bearer '+this.connection.tokens.mcp,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(245000)});const text=await upstream.text();response={status:upstream.status,data:text?JSON.parse(text):null};}
    fresh();
    if(body?.method==='tools/call'&&(response.status!==200||!validToolResponse(response.data,body.id)))throw Error('Tool service returned an unconfirmed response; inspect the existing workflow before continuing');
    if(body?.method==='tools/call')await this.authoringGuard?.after(authoringToken,response.data?.result);
    if(body?.method==='tools/list'&&response.data?.result?.tools){response.data.result.tools.push(...(this.localDefinitions||[]),...(scope.localReaders?this.scopedDefinitions||[]:[]));if(this.authoringGuard?.filterTools)response.data.result.tools=await this.authoringGuard.filterTools(response.data.result.tools,scope.provider,scope);}
    fresh();
    res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(response.data===null?'':JSON.stringify(response.data));
   }catch(e){this.authoringGuard?.cancel?.(authoringToken);if(e.staleProviderScope||scope.checkCurrent()!==true){res.writeHead(403);res.end();}else if(body?.method==='tools/call'&&body.id!==undefined){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:toolFailure(e,{dispatched})}));}else{res.writeHead(502);res.end(JSON.stringify({error:e.message}));}}
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
 forward(method,target,data,mcp=false,timeout=245000){
  return new Promise((resolve,reject)=>{
   const id=this.next++,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Worker request timed out'));},timeout);
   this.pending.set(id,{resolve,reject,timer});
   try{this.relay.stdin.write(JSON.stringify({id,method,target,data,mcp})+'\n');}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
  });
 }
 async request(method, target, data) {
  assertWorkerRoute(method, target);
  if (!this.connection) throw new Error('Connect the WSL worker first');
  if(this.relay){
   const result=await this.forward(method,target,data,false,method==='GET'?12000:245000);
   if(result.status!==200)throw Error(result.data?.error||'Worker request failed');
   return result.data;
  }
  const response = await fetch(this.upstream + target, {
    method, headers: { Authorization: 'Bearer ' + this.connection.tokens.admin,'Content-Type':'application/json' },
    body: method === 'POST' ? JSON.stringify(data ?? {}) : undefined,signal: AbortSignal.timeout(method==='GET'?12000:240000)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Worker request failed');
  return result;
 }
 reject(error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
 close(){this.connectionEpoch++;this.providerScopes.revokeAll();this.reject(Error('Worker bridge closed'));this.relay?.kill();this.relay=null;this.proxy?.close();this.proxy=null;this.connection=null;this.identity=null;this.connectionTarget=null;this.connectedSource=null;}
}
