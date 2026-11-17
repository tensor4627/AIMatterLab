import {codexRuntime} from '../../desktop/platform/codex-runtime.mjs';
import {createHash} from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createJsonlFramer } from './jsonl-frames.mjs';
import path from 'node:path';
import {agentEnvironment} from '../../desktop/platform/agent-environment.mjs';
import {isolationPreparationDiagnostic} from '../../desktop/platform/codex-isolation.mjs';
import {sanitizeTranscript,sanitizeProtocolTranscript,createTranscriptStream} from '../../contracts/agent/transcript-sanitizer.mjs';
export const PROTOCOL_VERSION = '0.165.0-alpha.1.2';
const unsupportedCatalogQueries=new Set(['list_mcp_resources','list_mcp_resource_templates']);
export function verifyProtocolVersion(version){
  const valid=typeof version==='string'&&version.length<=128&&/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version);
  if(valid)return {baselineVersion:PROTOCOL_VERSION,installedVersion:version,baselineMatch:version===PROTOCOL_VERSION,status:'pending_capability_verification',...version!==PROTOCOL_VERSION?{versionWarning:{code:'STUDIO_CODEX_VERSION_DIFFERENCE',severity:'warning'}}:{}};
  const error=new Error('Codex 版本信息无法识别。请检查所选 CLI 是否正常返回版本；协议生成参考版本 '+PROTOCOL_VERSION+' 不是连接版本限制。会话和计算流程仍保留。');
  error.code='STUDIO_CODEX_PROTOCOL_MISMATCH';error.stage='version';error.expectedVersion=PROTOCOL_VERSION;error.installedVersion=valid?version:'unrecognized';throw error;
}
function checkedInitialize(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||['userAgent','codexHome','platformFamily','platformOs'].some(key=>typeof value[key]!=='string'||!value[key]||value[key].length>8192)||!path.isAbsolute(value.codexHome))throw Error('Invalid initialize response');
  return value;
}
function validEnvelope(value){return !!value&&typeof value==='object'&&!Array.isArray(value)&&(value.method===undefined||typeof value.method==='string'&&value.method.length>0&&value.method.length<=256)&&(value.id===undefined||typeof value.id==='string'&&value.id.length<=256||typeof value.id==='number'&&Number.isFinite(value.id))&&!(Object.hasOwn(value,'result')&&Object.hasOwn(value,'error'));}
function versionFailure(cause){
  if(cause?.code==='ENOENT')return ['cli_not_found','未找到已配置的 CLI。请确认 CLI 安装或更新已完成，再明确重连'];
  if(['EACCES','EPERM'].includes(cause?.code))return ['cli_permission_denied','CLI 无法执行。请检查文件权限或安全策略，再明确重连'];
  if(cause?.code==='ETIMEDOUT'||cause?.killed===true&&cause?.signal==='SIGTERM')return ['cli_version_timeout','读取 CLI 版本超时。请检查 CLI 是否能正常启动，再明确重连'];
  if(Number.isInteger(cause?.code)&&cause.code!==0||typeof cause?.signal==='string')return ['cli_version_exit_failed','CLI 版本命令退出失败。请检查 CLI 是否能正常启动，再明确重连'];
  return ['cli_version_failed','无法读取 CLI 版本。请检查 CLI 安装与可执行文件配置，再明确重连'];
}
function compatibilityFailure(cause,stage,version){
  if(cause?.code==='STUDIO_CODEX_PROTOCOL_MISMATCH')return cause;
  const gates={version:'读取 CLI 版本',isolation_prepare:'检查必需隔离能力和模型能力上限',spawn:'启动 app-server 传输',initialize:'核对 initialize 协议响应',account:'在独立配置中复用登录',effective_isolation:'回读有效隔离配置、技能与 MCP',lifecycle:'核对当前连接生命周期'};
  const failures={'Installed Codex lacks required isolation controls':'required_isolation_controls_missing','Effective Codex isolation controls do not match':'effective_isolation_mismatch','Native skills remain enabled':'native_skills_enabled','Unscoped MCP capabilities are exposed':'unscoped_mcp_capabilities','Effective model capability snapshot differs':'model_ceiling_mismatch','Invalid initialize response':'invalid_initialize_response'};
  const preparation=isolationPreparationDiagnostic(cause);
  const [failure,hint]=stage==='version'?versionFailure(cause):preparation?[preparation.failure,preparation.hint]:[failures[cause?.message]||'gate_failed','请检查该 CLI 是否支持所需协议和隔离控制，再明确重连'];
  const error=new Error('Codex 兼容性检查失败（'+(gates[stage]||'建立 app-server 连接')+'，'+failure+'）：当前 '+(version||'unrecognized')+'；协议生成参考版本 '+PROTOCOL_VERSION+'（版本差异仅作提示）。'+hint+'；会话和计算流程仍保留，未自动重发消息。');
  error.failure=failure;
  if(preparation)error.preparationStep=preparation.step;
  error.code='STUDIO_CODEX_COMPATIBILITY_FAILED';error.stage=stage;error.installedVersion=version||'unrecognized';error.expectedVersion=PROTOCOL_VERSION;return error;
}

export class CodexBridge extends EventEmitter {
  constructor({strictIsolation=false,isolationRoot,isolationDependencies={},launchDependencies={},host=codexRuntime}={}) { super();Object.assign(this,{strictIsolation,isolationRoot,isolationDependencies,launchDependencies,host});this.lifecycle=0;this.isolationReady=false; this.pending = new Map(); this.requests = new Map(); this.next = 1; this.activeTurns=new Set();this.threadModels=new Map(); }
  async start(executable,worker,config={},options={}) {
    const key=createHash('sha256').update(JSON.stringify([executable,worker?.url,worker?.tokens?.mcp,config,...options.authenticationOnly?['authentication-only']:[]])).digest('hex');
    if(this.starting){await this.starting;return this.start(executable,worker,config,options);}
    if(this.process&&this.contextKey===key)return this.info;
    if(this.activeTurns.size)throw Error('Stop the current reply before reconnecting scientific tools');
    if(this.process)this.close();this.contextKey=key;
    this.starting=this.launch(executable,worker,config,options).finally(()=>{this.starting=null;});
    return this.starting;
  }
  async launch(executable, worker, config = {}, {authenticationOnly=false}={}) {
    this.transcriptSecrets=[worker?.tokens?.mcp];this.transcriptStreams??=new Map();
    const generation=this.lifecycle;let child,version,stage='version';this.isolationReady=false;this.info=null;this.compatibility=null;this.isolationSummary=null;this.isolation=null;
    try{
    if(this.host.resolveExecutable)executable=await this.host.resolveExecutable(executable);
    if(generation!==this.lifecycle){stage='lifecycle';throw Error('Codex context launch was cancelled');}
    const { stdout } = await (this.launchDependencies.execute||this.host.execute)(executable, ['--version'], { windowsHide: true, timeout: 15000, env:agentEnvironment('codex') });
    const candidate=verifyProtocolVersion(stdout.trim().split(' ').at(-1),{strictIsolation:this.strictIsolation});version=candidate.installedVersion;
    if(generation!==this.lifecycle){stage='lifecycle';throw Error('Codex context launch was cancelled');}
    if(candidate.versionWarning)this.emit('event',{method:'studio/codexVersionWarning',params:candidate});
    if(authenticationOnly&&(!this.strictIsolation||worker))throw Error('Authentication requires an isolated connection without scientific tools');
    stage='isolation_prepare';const isolation=this.strictIsolation?await this.host.prepareIsolation(executable,this.isolationRoot,config,worker,{...this.isolationDependencies,...authenticationOnly?{authenticationOnly:true}:{}}):null;
    if(authenticationOnly&&isolation?.authenticationOnly!==true)throw Error('Authentication isolation was not established');
    if(generation!==this.lifecycle){stage='lifecycle';throw Error('Codex context launch was cancelled');}
    this.isolation=isolation;
    // Validate AIMatterLab's owned overlay and effective capabilities below. External
    // desktop config can contain unrelated fields from a newer Codex release.
    const args = ['app-server','--listen','stdio://',...this.host.overrideArgs({...config,...isolation?.config})];
    const env = agentEnvironment('codex');
    if (worker) {
      if(!isolation)args.push('-c','mcp_servers.gpusampling.enabled=true');
      if(!isolation)args.push('-c', 'mcp_servers.gpusampling.url=' + JSON.stringify(worker.url + '/mcp'),
        '-c', 'mcp_servers.gpusampling.bearer_token_env_var="GSS_MCP_TOKEN"');
      for(const tool of ['write_shared_terminal','scientific_skill_catalog','read_scientific_skill','inspect_pygas_catalog','read_runtime_guide','read_custom_cv','import_materials_project','create_structure','render_pygas_workflow','propose_custom_cv','present_task','draft_cluster_setup','prepare_cluster_run','prepare_run','resume_run','write_project_input','create_workflow','validate_run','submit_run','cancel_run','reconcile_run','validate_cluster_run','submit_cluster_run','cancel_cluster_run'])
        args.push('-c','mcp_servers.gpusampling.tools.'+tool+'.approval_mode="approve"');
      env.GSS_MCP_TOKEN = worker.tokens.mcp;
    }
    stage='spawn';child = (this.launchDependencies.spawnProcess||this.host.spawnProcess)(executable, args, { stdio: ['pipe','pipe','pipe'], windowsHide: true, env,...isolation?{cwd:isolation.cwd}:{} });
    this.process=child;
    // A closed child stdin surfaces EPIPE asynchronously; without a listener the
    // main process would die on an unhandled 'error' event.
    if(typeof child.stdin?.on==='function')child.stdin.on('error', error => {if(this.process===child)this.emit('diagnostic','Codex stdin unavailable (' + String(error?.code || error) + '); reconnect explicitly.');});
    child.on('error', err => {if(this.process===child)this.close({reason:'transport_error',message:'Codex app-server transport failed; reconnect explicitly. The conversation is preserved.'});});
    child.on('exit', (code, signal) => {
      if(this.process!==child)return;
      this.fail(new Error('Codex disconnected (' + (signal || code) + ')'));
      this.process = null;
      this.emit('event', { method: 'studio/codexDisconnected', params: { code, signal } });
    });
    this.process.stderr.on('data', data => this.emit('diagnostic', this.strictIsolation?'Isolated Codex diagnostic received (contents withheld)':sanitizeTranscript(data.toString().slice(-4000),this.transcriptSecrets)));
    // readline buffers a whole line before any guard could run; the bounded framer
    // rejects an oversized frame without retaining more than its bound.
    const framer = createJsonlFramer({
      maxBytes: 1048576,
      onFrame: line => {
        if(this.process!==child)return;
        let message;
        try { message = JSON.parse(line);if(!validEnvelope(message))throw Error('Invalid Codex envelope'); } catch {
          this.close({reason:'malformed_protocol',message:'Malformed Codex JSONL; reconnect explicitly. The conversation is preserved.'});return;
        }
        this.receive(message);
      },
      onOversize: bytes => {if(this.process===child)this.close({reason:'oversized_frame',message:'Codex JSONL frame exceeded 1 MiB (' + bytes + ' bytes); reconnect explicitly. The conversation is preserved.'});}
    });
    this.framer = framer;
    this.process.stdout.on('data', chunk => {if(this.process===child)framer.feed(chunk);});
      stage='initialize';const info = await this.rawRequest('initialize', {
        clientInfo: { name: 'aimatterlab', title: 'AIMatterLab', version: this.host.version },
        ...this.host.initializeAuth?{capabilities:{experimentalApi:true}}:{}
      });
      if(generation!==this.lifecycle||this.process!==child){stage='lifecycle';throw Error('Codex context launch was cancelled');}
      if(isolation)checkedInitialize(info);
      this.send({ method: 'initialized', params: {} });
      if(this.host.initializeAuth&&!authenticationOnly){stage='account';await this.host.initializeAuth((...args)=>this.rawRequest(...args),secret=>this.rememberSecret(secret));if(generation!==this.lifecycle||this.process!==child)throw Error('Codex context launch was cancelled');}
      let summary;if(isolation){stage='effective_isolation';summary=await this.host.verifyIsolation((...args)=>this.rawRequest(...args),isolation);}
      if(generation!==this.lifecycle||this.process!==child){stage='lifecycle';throw Error('Codex context launch was cancelled');}
      if(isolation){this.recordIsolationSummary(summary);this.isolationReady=true;this.compatibility={...candidate,status:'capabilities_verified',scope:authenticationOnly?'Account operations and public model metadata only; conversations, model calls and scientific tools are unavailable.':'Startup isolation configuration, skills, MCP inventory and model capability ceiling only; no thread, model reply or scientific workflow verified.'};}
      else this.compatibility={...candidate,status:'version_observed',scope:'Version metadata only; isolation capabilities have not been verified.'};
      this.info={...info,studioCompatibility:this.compatibility,...isolation?{studioIsolation:summary}:{}};
      return this.info;
    } catch (error) { if(generation===this.lifecycle&&(!child||this.process===child))this.close();throw compatibilityFailure(error,stage,version); }
  }
  recordIsolationSummary(summary) {
    this.isolationSummary=summary;
    if(this.info)this.info={...this.info,studioIsolation:summary};
    this.emit('event',{method:'studio/toolsWarning',params:{warnings:summary?.warnings||[],message:'工具清单待核对，可继续讨论并由 Agent 使用已授权终端协助配置。'}});
  }
  rememberSecret(secret){if(typeof secret==='string'&&secret&&!this.transcriptSecrets.includes(secret))this.transcriptSecrets.push(secret);}
  send(value) {
    if (!this.process || this.process.stdin.destroyed) throw new Error('Connect Codex first');
    this.process.stdin.write(JSON.stringify(value) + '\n');
  }
  request(method,params={},timeout=120000,{assertCurrent=()=>{}}={}){
    assertCurrent();
    if(['account/login/start','account/logout'].includes(method))this.host.accountOperation?.(method);
    if(!this.strictIsolation)return this.rawRequest(method,params,timeout);
    return this.isolatedRequest(method,params,timeout,assertCurrent);
  }
  async isolatedRequest(method,params,timeout,assertCurrent=()=>{}){
    if(!this.isolationReady||!this.isolation)throw Error('Codex isolation has not been verified');
    const child=this.process,generation=this.lifecycle;if(method==='turn/start'&&this.isolation.catalog)params={...params,model:params.model??this.threadModels.get(params.threadId)??this.isolation.defaultModel};const scoped=this.host.constrainedRequest(method,params,this.isolation);
    if(['thread/start','thread/resume','turn/start','turn/steer'].includes(method)){
      const summary=await this.host.verifyIsolation((...args)=>this.rawRequest(...args),this.isolation,['turn/start','turn/steer'].includes(method)?{threadId:params.threadId}:{});
      if(this.process!==child||this.lifecycle!==generation||!this.isolationReady)throw Error('Codex isolated context changed before dispatch');this.recordIsolationSummary(summary);
    }
    assertCurrent();const result=await this.rawRequest(method,scoped,timeout);assertCurrent();
    if(['thread/start','thread/resume','turn/start','turn/steer'].includes(method)&& (this.process!==child||this.lifecycle!==generation))throw Error('Codex isolated context changed during dispatch');
    if(['thread/start','thread/resume'].includes(method)){try{
      this.host.assertInstructionSources(result,this.isolation);if(this.isolation.catalog&&result.model!==scoped.model)throw Error('Resumed model differs from the AIMatterLab capability ceiling');
      if(typeof result.thread?.id!=='string'||!result.thread.id)throw Error('Codex did not return a verified conversation identity');
      // Complete this thread's MCP initialization before main binds its first lease context.
      const summary=await this.host.verifyIsolation((...args)=>this.rawRequest(...args),this.isolation,{threadId:result.thread.id});
      if(this.process!==child||this.lifecycle!==generation||!this.isolationReady)throw Error('Codex isolated context changed while initializing conversation tools');
      assertCurrent();this.recordIsolationSummary(summary);this.threadModels.set(result.thread.id,scoped.model);
    }catch(error){if(this.process===child&&this.lifecycle===generation)this.close();throw error;}}
    return result;
  }
  rawRequest(method, params = {}, timeout = 120000) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' timed out')); }, timeout);
      this.pending.set(id, { resolve, reject, timer, method });
      try { this.send({ id, method, params }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  receive(message) {
    if(!validEnvelope(message)){this.close({reason:'malformed_protocol',message:'Invalid Codex RPC envelope; reconnect explicitly. The conversation is preserved.'});return;}
    if(message.method==='account/chatgptAuthTokens/refresh'&&message.id!==undefined&&this.host.refreshAuth){
      try{const result=this.host.refreshAuth(message.params,secret=>this.rememberSecret(secret));this.send({id:message.id,result});}catch{this.send({id:message.id,error:{code:-32000,message:'Native Codex login needs refresh; reconnect explicitly. No message was replayed.'}});}return;
    }
    if(this.strictIsolation&&message.method&&message.id!==undefined&&/^item\/(commandExecution|fileChange|permissions)/.test(message.method)){
      this.send({id:message.id,error:{code:-32601,message:'Native privileged actions are unavailable in AIMatterLab isolation'}});return;
    }
    if(this.strictIsolation&&message.method==='item/tool/call'&&message.id!==undefined){
      const tool=message.params?.tool;
      if(unsupportedCatalogQueries.has(tool)){
        this.send({id:message.id,result:{success:false,contentItems:[{type:'inputText',text:'Native MCP resource catalog queries are unsupported in AIMatterLab isolation; no resource was read. Use the registered AIMatterLab tools for authorized project access.'}]}});return;
      }
      const name=typeof tool==='string'&&/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(tool)?tool:undefined;
      this.close({reason:'isolation_violation',code:'STUDIO_CODEX_UNSCOPED_TOOL',activityType:'dynamicToolCall',...name?{tool:name}:{},message:'AIMatterLab isolation blocked '+(name||'dynamicToolCall')+'. The workflow and draft are preserved; reconnect explicitly and review results before sending another message.'});return;
    }
    if(this.strictIsolation&&message.method==='item/started'){
      const item=message.params?.item;
      if((['commandExecution','fileChange','webSearch','imageView','imageGeneration','collabAgentToolCall','subAgentActivity','dynamicToolCall'].includes(item?.type)&&!(item.type==='dynamicToolCall'&&unsupportedCatalogQueries.has(item.tool)))||item?.type==='mcpToolCall'&&item.server!=='gpusampling'){
        const tool=typeof item.tool==='string'&&/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(item.tool)?item.tool:undefined;
        this.close({reason:'isolation_violation',code:'STUDIO_CODEX_UNSCOPED_TOOL',activityType:item.type,...tool?{tool}:{},message:'AIMatterLab isolation blocked '+(tool||item.type)+'. The workflow and draft are preserved; reconnect explicitly and review results before sending another message.'});return;
      }
    }
    if(message.method==='turn/started')this.activeTurns.add(message.params?.threadId);
    if(message.method==='turn/completed')this.activeTurns.delete(message.params?.threadId);
    if (message.method) {
      if (message.id !== undefined) this.requests.set(String(message.id), message);
      if (message.method === 'serverRequest/resolved') this.requests.delete(String(message.params?.requestId));
      this.publishTranscriptEvent(message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(message.id);
    if (message.error) { const error=new Error(sanitizeTranscript(message.error.message || 'Codex request failed',this.transcriptSecrets));error.rpcResponse=true;error.rpcCode=message.error.code;pending.reject(error); }
    else pending.resolve(/^thread\/(?:start|resume|read|list)$/.test(pending.method)?sanitizeProtocolTranscript(message.result,this.transcriptSecrets):message.result);
  }
  publishTranscriptEvent(message,{final=false}={}){
    const p=message.params||{},thread=p.threadId;this.transcriptStreams??=new Map();
    if(!final&&typeof p.delta==='string'){
      const key=JSON.stringify([thread,p.turnId,p.itemId,message.method,p.contentIndex,p.summaryIndex]);let stream=this.transcriptStreams.get(key);if(!stream){stream=createTranscriptStream(()=>this.transcriptSecrets||[]);this.transcriptStreams.set(key,stream);}const delta=stream.push(p.delta);if(!delta)return;message={...message,params:{...p,delta}};
    }
    if(['item/completed','turn/completed'].includes(message.method))for(const [key,stream]of this.transcriptStreams){const [owner,turnId,itemId,method,contentIndex,summaryIndex]=JSON.parse(key);if(owner!==thread||message.method==='item/completed'&&itemId!==p.item?.id)continue;this.transcriptStreams.delete(key);const delta=stream.push('',{final:true});if(delta&&!(message.method==='item/completed'&&p.item?.type==='agentMessage'&&method==='item/agentMessage/delta'))this.publishTranscriptEvent({method,params:{threadId:owner,turnId,itemId,delta,...contentIndex!=null?{contentIndex}:{},...summaryIndex!=null?{summaryIndex}:{}}},{final:true});}
    this.emit('event',sanitizeProtocolTranscript(message,this.transcriptSecrets));
  }
  respond(id, result) {
    const key = String(id);
    if (!this.requests.has(key)) throw new Error('Approval/request has already resolved');
    const request = this.requests.get(key);
    this.send({ id: request.id, result }); this.requests.delete(key);
  }
  fail(error) {
    this.transcriptStreams?.clear();
    this.isolationReady=false;this.isolationSummary=null;this.info=null;this.compatibility=null;this.threadModels.clear();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.requests.clear(); this.activeTurns.clear();
  }
  close(detail={reason:'closed'}) { this.lifecycle++;this.threadModels.clear();this.isolationReady=false;this.isolationSummary=null;const child=this.process,active=!!child;this.process=null;this.framer?.reset();this.framer=null;this.fail(new Error(detail.message||'Codex bridge closed'));child?.kill();if(active)this.emit('event',{method:'studio/codexDisconnected',params:detail}); }
}
