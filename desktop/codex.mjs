import {prepareIsolation,overrideArgs,constrainedRequest,verifyIsolation,assertInstructionSources} from './codex-isolation.mjs';
import {STUDIO_VERSION} from './studio-version.mjs';
import {createHash} from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import path from 'node:path';
export const PROTOCOL_VERSION = '0.165.0-alpha.1.2';
const exec = promisify(execFile);
export function verifyProtocolVersion(version,{strictIsolation=false}={}){
  const valid=typeof version==='string'&&version.length<=128&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version);
  if(valid&&(version===PROTOCOL_VERSION||strictIsolation))return {baselineVersion:PROTOCOL_VERSION,installedVersion:version,baselineMatch:version===PROTOCOL_VERSION,status:'pending_capability_verification'};
  const error=new Error('Codex 兼容性检查未通过：需要有效版本与严格隔离能力检查；协议生成基线 '+PROTOCOL_VERSION+'。会话和计算流程仍保留。');
  error.code='STUDIO_CODEX_PROTOCOL_MISMATCH';error.stage='version';error.expectedVersion=PROTOCOL_VERSION;error.installedVersion=valid?version:'unrecognized';throw error;
}
function checkedInitialize(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||['userAgent','codexHome','platformFamily','platformOs'].some(key=>typeof value[key]!=='string'||!value[key]||value[key].length>8192)||!path.isAbsolute(value.codexHome))throw Error('Invalid initialize response');
  return value;
}
function validEnvelope(value){return !!value&&typeof value==='object'&&!Array.isArray(value)&&(value.method===undefined||typeof value.method==='string'&&value.method.length>0&&value.method.length<=256)&&(value.id===undefined||typeof value.id==='string'&&value.id.length<=256||typeof value.id==='number'&&Number.isFinite(value.id))&&!(Object.hasOwn(value,'result')&&Object.hasOwn(value,'error'));}
function compatibilityFailure(cause,stage,version){
  if(cause?.code==='STUDIO_CODEX_PROTOCOL_MISMATCH')return cause;
  const gates={version:'读取 CLI 版本',isolation_prepare:'检查必需隔离能力和模型能力上限',spawn:'启动 app-server 传输',initialize:'核对 initialize 协议响应',effective_isolation:'回读有效隔离配置、技能与 MCP',lifecycle:'核对当前连接生命周期'};
  const failures={'Installed Codex lacks required isolation controls':'required_isolation_controls_missing','Effective Codex isolation controls do not match':'effective_isolation_mismatch','Native skills remain enabled':'native_skills_enabled','Unscoped MCP capabilities are exposed':'unscoped_mcp_capabilities','Effective model capability snapshot differs':'model_ceiling_mismatch','Invalid initialize response':'invalid_initialize_response'};
  const failure=failures[cause?.message]||'gate_failed';
  const error=new Error('Codex 兼容性检查失败（'+(gates[stage]||'建立 app-server 连接')+'，'+failure+'）：当前 '+(version||'unrecognized')+'；协议生成基线 '+PROTOCOL_VERSION+'。请检查该 CLI 是否支持所需协议和隔离控制，再明确重连；会话和计算流程仍保留，未自动重发消息。');
  error.failure=failure;
  error.code='STUDIO_CODEX_COMPATIBILITY_FAILED';error.stage=stage;error.installedVersion=version||'unrecognized';error.expectedVersion=PROTOCOL_VERSION;return error;
}

export class CodexBridge extends EventEmitter {
  constructor({strictIsolation=false,isolationRoot,isolationDependencies={},launchDependencies={}}={}) { super();Object.assign(this,{strictIsolation,isolationRoot,isolationDependencies,launchDependencies});this.lifecycle=0;this.isolationReady=false; this.pending = new Map(); this.requests = new Map(); this.next = 1; this.activeTurns=new Set();this.threadModels=new Map(); }
  async start(executable,worker,config={}) {
    const key=createHash('sha256').update(JSON.stringify([executable,worker?.url,worker?.tokens?.mcp,config])).digest('hex');
    if(this.starting){await this.starting;return this.start(executable,worker,config);}
    if(this.process&&this.contextKey===key)return this.info;
    if(this.activeTurns.size)throw Error('Stop the current reply before reconnecting scientific tools');
    if(this.process)this.close();this.contextKey=key;
    this.starting=this.launch(executable,worker,config).finally(()=>{this.starting=null;});
    return this.starting;
  }
  async launch(executable, worker, config = {}) {
    const generation=this.lifecycle;let child,version,stage='version';this.isolationReady=false;this.info=null;this.compatibility=null;this.isolationSummary=null;this.isolation=null;
    try{
    const { stdout } = await (this.launchDependencies.execute||exec)(executable, ['--version'], { windowsHide: true, timeout: 15000 });
    const candidate=verifyProtocolVersion(stdout.trim().split(' ').at(-1),{strictIsolation:this.strictIsolation});version=candidate.installedVersion;
    if(generation!==this.lifecycle){stage='lifecycle';throw Error('Codex context launch was cancelled');}
    stage='isolation_prepare';const isolation=this.strictIsolation?await prepareIsolation(executable,this.isolationRoot,config,worker,this.isolationDependencies):null;
    if(generation!==this.lifecycle){stage='lifecycle';throw Error('Codex context launch was cancelled');}
    this.isolation=isolation;
    const args = ['app-server',...this.strictIsolation?['--strict-config']:[],'--listen','stdio://',...overrideArgs({...config,...isolation?.config})];
    const env = { ...process.env };
    if (worker) {
      if(!isolation)args.push('-c','mcp_servers.gpusampling.enabled=true');
      if(!isolation)args.push('-c', 'mcp_servers.gpusampling.url=' + JSON.stringify(worker.url + '/mcp'),
        '-c', 'mcp_servers.gpusampling.bearer_token_env_var="GSS_MCP_TOKEN"');
      for(const tool of ['scientific_skill_catalog','read_scientific_skill','inspect_pygas_catalog','read_runtime_guide','read_custom_cv','import_materials_project','create_structure','render_pygas_workflow','propose_custom_cv','present_task','draft_cluster_setup','prepare_cluster_run','prepare_run','resume_run','write_project_input','create_workflow'])
        args.push('-c','mcp_servers.gpusampling.tools.'+tool+'.approval_mode="approve"');
      env.GSS_MCP_TOKEN = worker.tokens.mcp;
    }
    stage='spawn';child = (this.launchDependencies.spawnProcess||spawn)(executable, args, { stdio: ['pipe','pipe','pipe'], windowsHide: true, env,...isolation?{cwd:isolation.cwd}:{} });
    this.process=child;
    child.on('error', err => {if(this.process===child)this.close({reason:'transport_error',message:'Codex app-server transport failed; reconnect explicitly. The conversation is preserved.'});});
    child.on('exit', (code, signal) => {
      if(this.process!==child)return;
      this.fail(new Error('Codex disconnected (' + (signal || code) + ')'));
      this.process = null;
      this.emit('event', { method: 'studio/codexDisconnected', params: { code, signal } });
    });
    this.process.stderr.on('data', data => this.emit('diagnostic', this.strictIsolation?'Isolated Codex diagnostic received (contents withheld)':data.toString().slice(-4000)));
    this.reader = createInterface({ input: this.process.stdout });
    this.reader.on('line', line => {
      if(this.process!==child)return;
      let message;
      try { message = JSON.parse(line);if(!validEnvelope(message))throw Error('Invalid Codex envelope'); } catch {
        this.close({reason:'malformed_protocol',message:'Malformed Codex JSONL; reconnect explicitly. The conversation is preserved.'});return;
      }
      this.receive(message);
    });
      stage='initialize';const info = await this.rawRequest('initialize', {
        clientInfo: { name: 'gpu_sampling_studio', title: 'GPU Sampling Studio', version: STUDIO_VERSION }
      });
      if(generation!==this.lifecycle||this.process!==child){stage='lifecycle';throw Error('Codex context launch was cancelled');}
      if(isolation)checkedInitialize(info);
      this.send({ method: 'initialized', params: {} });
      let summary;if(isolation){stage='effective_isolation';summary=await verifyIsolation((...args)=>this.rawRequest(...args),isolation);}
      if(generation!==this.lifecycle||this.process!==child){stage='lifecycle';throw Error('Codex context launch was cancelled');}
      if(isolation){this.isolationSummary=summary;this.isolationReady=true;this.compatibility={...candidate,status:'capabilities_verified',scope:'Startup isolation configuration, skills, MCP inventory and model capability ceiling only; no thread, model reply or scientific workflow verified.'};}
      this.info={...info,...isolation?{studioIsolation:summary,studioCompatibility:this.compatibility}:{}};
      return this.info;
    } catch (error) { if(generation===this.lifecycle&&(!child||this.process===child))this.close();throw compatibilityFailure(error,stage,version); }
  }
  send(value) {
    if (!this.process || this.process.stdin.destroyed) throw new Error('Connect Codex first');
    this.process.stdin.write(JSON.stringify(value) + '\n');
  }
  request(method,params={},timeout=120000){
    if(!this.strictIsolation)return this.rawRequest(method,params,timeout);
    return this.isolatedRequest(method,params,timeout);
  }
  async isolatedRequest(method,params,timeout){
    if(!this.isolationReady||!this.isolation)throw Error('Codex isolation has not been verified');
    const child=this.process,generation=this.lifecycle;if(method==='turn/start'&&this.isolation.catalog)params={...params,model:params.model??this.threadModels.get(params.threadId)??this.isolation.defaultModel};const scoped=constrainedRequest(method,params,this.isolation);
    if(['thread/start','thread/resume','turn/start','turn/steer'].includes(method)){
      const summary=await verifyIsolation((...args)=>this.rawRequest(...args),this.isolation,['turn/start','turn/steer'].includes(method)?{threadId:params.threadId}:{});
      if(this.process!==child||this.lifecycle!==generation||!this.isolationReady)throw Error('Codex isolated context changed before dispatch');this.isolationSummary=summary;
    }
    const result=await this.rawRequest(method,scoped,timeout);
    if(['thread/start','thread/resume','turn/start','turn/steer'].includes(method)&& (this.process!==child||this.lifecycle!==generation))throw Error('Codex isolated context changed during dispatch');
    if(['thread/start','thread/resume'].includes(method)){try{
      assertInstructionSources(result,this.isolation);if(this.isolation.catalog&&result.model!==scoped.model)throw Error('Resumed model differs from the Studio capability ceiling');
      if(typeof result.thread?.id!=='string'||!result.thread.id)throw Error('Codex did not return a verified conversation identity');
      // Complete this thread's MCP initialization before main binds its first lease context.
      const summary=await verifyIsolation((...args)=>this.rawRequest(...args),this.isolation,{threadId:result.thread.id});
      if(this.process!==child||this.lifecycle!==generation||!this.isolationReady)throw Error('Codex isolated context changed while initializing conversation tools');
      this.isolationSummary=summary;this.threadModels.set(result.thread.id,scoped.model);
    }catch(error){if(this.process===child&&this.lifecycle===generation)this.close();throw error;}}
    return result;
  }
  rawRequest(method, params = {}, timeout = 120000) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' timed out')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  receive(message) {
    if(!validEnvelope(message)){this.close({reason:'malformed_protocol',message:'Invalid Codex RPC envelope; reconnect explicitly. The conversation is preserved.'});return;}
    if(this.strictIsolation&&message.method&&message.id!==undefined&&/^item\/(commandExecution|fileChange|permissions)/.test(message.method)){
      this.send({id:message.id,error:{code:-32601,message:'Native privileged actions are unavailable in Studio isolation'}});return;
    }
    if(this.strictIsolation&&message.method==='item/started'){
      const item=message.params?.item;
      if(['commandExecution','fileChange','webSearch','imageView','imageGeneration','collabAgentToolCall','subAgentActivity','dynamicToolCall'].includes(item?.type)||item?.type==='mcpToolCall'&&item.server!=='gpusampling'){
        const tool=typeof item.tool==='string'&&/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(item.tool)?item.tool:undefined;
        this.close({reason:'isolation_violation',code:'STUDIO_CODEX_UNSCOPED_TOOL',activityType:item.type,...tool?{tool}:{},message:'Studio isolation blocked '+(tool||item.type)+'. The workflow and draft are preserved; reconnect explicitly and review results before sending another message.'});return;
      }
    }
    if(message.method==='turn/started')this.activeTurns.add(message.params?.threadId);
    if(message.method==='turn/completed')this.activeTurns.delete(message.params?.threadId);
    if (message.method) {
      if (message.id !== undefined) this.requests.set(String(message.id), message);
      if (message.method === 'serverRequest/resolved') this.requests.delete(String(message.params?.requestId));
      this.emit('event', message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(message.id);
    if (message.error) { const error=new Error(message.error.message || 'Codex request failed');error.rpcResponse=true;error.rpcCode=message.error.code;pending.reject(error); }
    else pending.resolve(message.result);
  }
  respond(id, result) {
    const key = String(id);
    if (!this.requests.has(key)) throw new Error('Approval/request has already resolved');
    const request = this.requests.get(key);
    this.send({ id: request.id, result }); this.requests.delete(key);
  }
  fail(error) {
    this.isolationReady=false;this.isolationSummary=null;this.info=null;this.compatibility=null;this.threadModels.clear();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.requests.clear(); this.activeTurns.clear();
  }
  close(detail={reason:'closed'}) { this.lifecycle++;this.threadModels.clear();this.isolationReady=false;this.isolationSummary=null;const child=this.process,active=!!child;this.process=null;this.fail(new Error(detail.message||'Codex bridge closed'));child?.kill();if(active)this.emit('event',{method:'studio/codexDisconnected',params:detail}); }
}
