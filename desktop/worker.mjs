import { execFile,spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {createInterface} from 'node:readline';
import http from 'node:http';
import path from 'node:path';
import { linuxPath, assertWorkerRoute } from './security.mjs';
const exec = promisify(execFile);
export class WorkerClient {
 constructor(){this.pending=new Map();this.next=1;}
 async connect(settings,source){
  if(this.connecting)return this.connecting;
  this.connecting=this.open(settings,source).finally(()=>{this.connecting=null;});return this.connecting;
 }
 async open(settings, source) {
  this.close();
  const installed=await exec('wsl.exe',['-d',settings.distribution,'--','python3',linuxPath(path.join(source,'install.py')),'--source',linuxPath(source),'--root',settings.workerRoot],{windowsHide:true,timeout:20000,maxBuffer:1024*1024});
  const runtime=JSON.parse(installed.stdout.trim().split('\n').at(-1)).path;
  const { stdout } = await exec('wsl.exe', ['-d', settings.distribution, '--',
    'python3', runtime+'/bootstrap.py', '--root', settings.workerRoot,
    '--port', String(settings.workerPort)], { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 });
  this.connection = JSON.parse(stdout.trim().split('\n').at(-1));
  this.upstream=this.connection.url;
  try{
   if(settings.forceRelay)throw Error("WSL stdio relay explicitly selected");
   const response=await fetch(this.upstream+'/api/health',{headers:{Authorization:'Bearer '+this.connection.tokens.admin},signal:AbortSignal.timeout(1500)});
   if(!response.ok)throw Error('Health check rejected');
   const health=await response.json();if(health.root!==this.connection.health.root)throw Error('Worker identity mismatch');
   this.connection.transport='localhost';return {...health,transport:'localhost'};
  }catch{
   const relay=this.relay=spawn('wsl.exe',['-d',settings.distribution,'--','python3',runtime+'/relay.py','--root',settings.workerRoot,'--port',String(settings.workerPort)],{stdio:['pipe','pipe','pipe'],windowsHide:true});
   createInterface({input:this.relay.stdout}).on('line',line=>{
    try{const value=JSON.parse(line),item=this.pending.get(value.id);if(item){clearTimeout(item.timer);this.pending.delete(value.id);item.resolve(value);}}catch{}
   });
   relay.on('error',e=>{if(this.relay===relay)this.reject(e);});
   relay.on('exit',()=>{if(this.relay===relay){this.reject(Error('WSL relay disconnected; job status is unknown'));this.connection=null;}});
   this.relay.stderr.on('data',()=>{});
   const health=await this.forward('GET','/api/health');
   if(health.status!==200||health.data.root!==this.connection.health.root)throw Error('WSL relay identity mismatch');
   this.proxy=http.createServer(async(req,res)=>{
    if(req.url!=='/mcp'||req.headers.origin||req.headers.authorization!=='Bearer '+this.connection.tokens.mcp){res.writeHead(403);res.end();return;}
    if(!['GET','POST'].includes(req.method)){res.writeHead(405);res.end();return;}
    try{
     let buffer='',bytes=0;
     for await(const chunk of req){bytes+=chunk.length;if(bytes>4*1024*1024)throw Error('Request too large');buffer+=chunk.toString();}
     const response=await this.forward(req.method,'/mcp',buffer?JSON.parse(buffer):undefined,true);
     res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});
     res.end(response.data===null?'':JSON.stringify(response.data));
    }catch(e){res.writeHead(502);res.end(JSON.stringify({error:e.message}));}
   });
   await new Promise((resolve,reject)=>{this.proxy.once('error',reject);this.proxy.listen(0,'127.0.0.1',resolve);});
   this.connection.url='http://127.0.0.1:'+this.proxy.address().port;
   this.connection.transport='wsl-stdio';
   return {...health.data,transport:'wsl-stdio'};
  }
 }
 async probeTools(){
  if(!this.connection)return {status:'blocked',message:'请先连接 WSL 作业服务',count:0};
  const response=await fetch(this.connection.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+this.connection.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('科学工具服务未通过连接检查');
  const result=await response.json(),names=(result.result?.tools||[]).map(t=>t.name);
  if(result.error||!names.includes('present_task'))throw Error('科学工具缺少草稿保存接口，请重新连接');
  return {status:'ready',count:names.length,transport:this.connection.transport,checkedAt:Date.now()};
 }
 forward(method,target,data,mcp=false){
  return new Promise((resolve,reject)=>{
   const id=this.next++,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Worker request timed out'));},245000);
   this.pending.set(id,{resolve,reject,timer});
   try{this.relay.stdin.write(JSON.stringify({id,method,target,data,mcp})+'\n');}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
  });
 }
 async request(method, target, data) {
  assertWorkerRoute(method, target);
  if (!this.connection) throw new Error('Connect the WSL worker first');
  if(this.relay){
   const result=await this.forward(method,target,data);
   if(result.status!==200)throw Error(result.data?.error||'Worker request failed');
   return result.data;
  }
  const response = await fetch(this.connection.url + target, {
    method, headers: { Authorization: 'Bearer ' + this.connection.tokens.admin,'Content-Type':'application/json' },
    body: method === 'POST' ? JSON.stringify(data ?? {}) : undefined,signal: AbortSignal.timeout(240000)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Worker request failed');
  return result;
 }
 reject(error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
 close(){this.reject(Error('Worker bridge closed'));this.relay?.kill();this.relay=null;this.proxy?.close();this.proxy=null;this.connection=null;}
}
