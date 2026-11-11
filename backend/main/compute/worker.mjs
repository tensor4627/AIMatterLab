import {computeRuntime} from '../../../desktop/platform/compute-runtime.mjs';
import {createInterface} from 'node:readline';
import {workerConnectionFailure} from './worker-connection-failure.mjs';
import {readExistingWorker,EXISTING_WORKER_RELAY} from './existing-worker.mjs';
import {readWorkerStatus} from './worker-status.mjs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {defaultWorkerResourceSource} from './worker-resources.mjs';
import { linuxPath, assertWorkerRoute } from "../../../contracts/transport-policy.mjs";
export class WorkerClient {
 constructor({host=computeRuntime,resourceSource=defaultWorkerResourceSource,providerScopes,readExisting=settings=>readExistingWorker(settings,{execute:host.execute}),launchRelay=host.spawnProcess}={}){Object.defineProperty(this,'resourceSource',{value:resourceSource});this.pending=new Map();this.next=1;this.host=host;this.providerScopes=providerScopes||{revokeAll(){}};this.connectionEpoch=0;this.bindingIntent=0;this.readExisting=readExisting;this.launchExistingRelay=launchRelay;}
 async exposeTools(health){return {...health,transport:this.connection.transport};}
 async attachServiceTransport({health,identity,target,request,detach,source}){
  if(health?.name!=='gpu-sampling-studio'||health.execution_policy!=='desktop-review-v1'||identity?.kind!=='ssh'||typeof identity.root!=='string'||health.root!==identity.root||typeof request!=='function'||!identity.hostIdentity||!Number.isSafeInteger(identity.hostIdentity.uid)||!identity.hostIdentity.hostname||!identity.hostIdentity.machineId)throw Error('ssh_service_identity_unavailable');
  this.bindingIntent++;this.close();const epoch=this.connectionEpoch;
  const transport={request,detach};this.serviceTransport=transport;
  // These capabilities protect the local provider proxy only. Remote worker
  // admin/MCP credentials never cross the authenticated SSH machine channel.
  this.connection={url:'http://127.0.0.1',tokens:{mcp:randomBytes(32).toString('hex')},health:structuredClone(health),transport:'ssh-terminal'};
  this.identity=structuredClone(identity);this.connectionTarget=structuredClone(target);this.connectedSource=source;
  this.relay={kill:()=>{try{detach?.();}catch{}}};
  const check=()=>{if(this.serviceTransport!==transport||this.connectionEpoch!==epoch)throw Error('ssh_service_context_changed');};
   try{const observed=await this.forward('GET','/api/health',undefined,false,10000);check();const actual=observed.data,host=actual?.hostIdentity;if(observed.status!==200||actual?.name!==health.name||['root','runtime','execution_policy','port'].some(key=>actual?.[key]!==health[key])||(actual?.runtime_id||actual?.runtimeId)!==identity.runtimeId||['hostname','uid','machineId'].some(key=>host?.[key]!==identity.hostIdentity[key]))throw Error('ssh_service_identity_changed');const exposed=await this.exposeTools({...actual,transport:'ssh-terminal'});check();return exposed;}
  catch(error){if(this.serviceTransport===transport)this.close();throw error;}
 }
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
  const installed=await this.host.execute('wsl.exe',['-d',settings.distribution,'--','python3',linuxPath(path.join(source,'install.py')),'--source',linuxPath(source),'--root',settings.workerRoot],{windowsHide:true,timeout:20000,maxBuffer:1024*1024});
  check();
  const runtime=JSON.parse(installed.stdout.trim().split('\n').at(-1)).path;
  const { stdout } = await this.host.execute('wsl.exe', ['-d', settings.distribution, '--',
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
  // WSL bootstrap proves its Linux socket, not the Windows localhost listener.
  // Keep all requests on the relay that verifies each accepted peer before auth.
  return this.attachExistingTransport(settings,initialHealth,check);
 }
 async attachExistingTransport(settings,initialHealth,check){
  if(initialHealth?.name!=='gpu-sampling-studio'||typeof initialHealth.root!=='string'||!initialHealth.root.startsWith('/')||typeof initialHealth.runtime!=='string'||!initialHealth.runtime.startsWith('/')||initialHealth.execution_policy!=='desktop-review-v1')throw Error('WSL worker identity unavailable');
  check();const relay=this.relay=this.launchExistingRelay('wsl.exe',['-d',settings.distribution,'--','python3','-B','-c',EXISTING_WORKER_RELAY,settings.workerRoot,String(settings.workerPort)],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  createInterface({input:relay.stdout}).on('line',line=>{try{const value=JSON.parse(line),item=this.pending.get(value.id);if(item){clearTimeout(item.timer);this.pending.delete(value.id);item.resolve(value);}}catch{}});
  const disconnected=error=>{if(this.relay===relay)this.close(error);};
  relay.on('error',disconnected);
  relay.on('exit',()=>disconnected(Error('Verified WSL relay disconnected; job status is unknown')));
  relay.stdin.on?.('error',()=>disconnected(Error('Verified WSL relay input unavailable; job status is unknown')));
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
   }catch(error){if(attached&&this.connection===attached&&!this.connecting)this.close();const failure=workerConnectionFailure(error);return result('unknown',failure.code==='wsl_access_denied'?'wsl_access_denied':'existing_unavailable');}
  })().finally(()=>{if(this.restoring===pending)this.restoring=null;});this.restoring=pending;return pending;
 }
 matchesTarget(settings){return this.identity?.distribution===settings.distribution&&(this.identity.root===settings.workerRoot||this.connectionTarget?.requestedRoot===settings.workerRoot)&&this.connectionTarget?.port===settings.workerPort;}
 forward(method,target,data,mcp=false,timeout=245000){
  if(this.serviceTransport){const transport=this.serviceTransport,epoch=this.connectionEpoch;return Promise.resolve().then(()=>transport.request({method,path:target,data,mcp,timeoutMs:timeout})).then(value=>{if(this.serviceTransport!==transport||this.connectionEpoch!==epoch)throw Error('ssh_service_context_changed');if(!Number.isInteger(value?.status)||value.status<100||value.status>599)throw Error('ssh_service_invalid_response');return value;});}
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
 close(error=Error('Worker bridge closed')){this.connectionEpoch++;this.providerScopes.revokeAll();this.reject(error);this.serviceTransport=null;const relay=this.relay;this.relay=null;relay?.kill();this.proxy?.close();this.proxy=null;this.connection=null;this.identity=null;this.connectionTarget=null;this.connectedSource=null;}
}
