import {prepareIsolation,overrideArgs,constrainedRequest,verifyIsolation,assertInstructionSources} from './codex-isolation.mjs';
import {STUDIO_VERSION} from './studio-version.mjs';
import {createHash} from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
export const PROTOCOL_VERSION = '0.165.0-alpha.1.2';
const exec = promisify(execFile);
export function verifyProtocolVersion(version){
  if(version===PROTOCOL_VERSION)return;
  const error=new Error('Codex 版本不匹配：当前 '+version+'，Studio 已验证 '+PROTOCOL_VERSION+'。请更新 Studio 或在设置中选择匹配版本；会话和计算流程仍保留。');
  error.code='STUDIO_CODEX_PROTOCOL_MISMATCH';error.expectedVersion=PROTOCOL_VERSION;error.installedVersion=version;throw error;
}

export class CodexBridge extends EventEmitter {
  constructor({strictIsolation=false,isolationRoot,isolationDependencies={}}={}) { super();Object.assign(this,{strictIsolation,isolationRoot,isolationDependencies});this.lifecycle=0;this.isolationReady=false; this.pending = new Map(); this.requests = new Map(); this.next = 1; this.activeTurns=new Set();this.threadModels=new Map(); }
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
    const generation=this.lifecycle;this.isolationReady=false;
    const { stdout } = await exec(executable, ['--version'], { windowsHide: true, timeout: 15000 });
    const version = stdout.trim().split(' ').at(-1);
    verifyProtocolVersion(version);
    const isolation=this.strictIsolation?await prepareIsolation(executable,this.isolationRoot,config,worker,this.isolationDependencies):null;
    if(generation!==this.lifecycle)throw Error('Codex context launch was cancelled');
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
    const child = spawn(executable, args, { stdio: ['pipe','pipe','pipe'], windowsHide: true, env,...isolation?{cwd:isolation.cwd}:{} });
    this.process=child;
    child.on('error', err => {if(this.process===child)this.fail(err);});
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
      try { message = JSON.parse(line); } catch {
        this.fail(new Error('Malformed Codex JSONL')); return;
      }
      this.receive(message);
    });
    try {
      this.info = await this.rawRequest('initialize', {
        clientInfo: { name: 'gpu_sampling_studio', title: 'GPU Sampling Studio', version: STUDIO_VERSION }
      });
      this.send({ method: 'initialized', params: {} });
      if(isolation){this.isolationSummary=await verifyIsolation((...args)=>this.rawRequest(...args),isolation);if(generation!==this.lifecycle||this.process!==child)throw Error('Codex context launch was cancelled');this.isolationReady=true;this.info={...this.info,studioIsolation:this.isolationSummary};}
      return this.info;
    } catch (error) { this.close(); throw error; }
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
    if(this.strictIsolation&&message.method&&message.id!==undefined&&/^item\/(commandExecution|fileChange|permissions)/.test(message.method)){
      this.send({id:message.id,error:{code:-32601,message:'Native privileged actions are unavailable in Studio isolation'}});return;
    }
    if(this.strictIsolation&&message.method==='item/started'){
      const item=message.params?.item;
      if(['commandExecution','fileChange','webSearch','imageView','imageGeneration','collabAgentToolCall','subAgentActivity','dynamicToolCall'].includes(item?.type)||item?.type==='mcpToolCall'&&item.server!=='gpusampling'){
        this.close();this.emit('event',{method:'studio/codexDisconnected',params:{reason:'Unexpected unscoped tool activity; connection closed'}});return;
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
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.requests.clear(); this.activeTurns.clear();
  }
  close() { this.lifecycle++;this.threadModels.clear();this.isolationReady=false;this.isolationSummary=null;const active=!!this.process;this.fail(new Error('Codex bridge closed'));this.process?.kill();this.process=null;if(active)this.emit('event',{method:'studio/codexDisconnected',params:{reason:'closed'}}); }
}
