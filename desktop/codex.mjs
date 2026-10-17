import {createHash} from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
export const PROTOCOL_VERSION = '0.162.0-alpha.17.2';
const exec = promisify(execFile);

export class CodexBridge extends EventEmitter {
  constructor() { super(); this.pending = new Map(); this.requests = new Map(); this.next = 1; this.activeTurns=new Set(); }
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
    const { stdout } = await exec(executable, ['--version'], { windowsHide: true, timeout: 15000 });
    const version = stdout.trim().split(' ').at(-1);
    if (version !== PROTOCOL_VERSION)
      throw new Error('Codex protocol version mismatch: expected ' + PROTOCOL_VERSION + ', installed ' + version + '. Regenerate and verify protocol before upgrading.');
    const args = ['app-server','--listen','stdio://'];
    for(const [key,value] of Object.entries(config))args.push('-c',key+'='+JSON.stringify(value));
    const env = { ...process.env };
    if (worker) {
      args.push('-c','mcp_servers.gpusampling.enabled=true');
      args.push('-c', 'mcp_servers.gpusampling.url=' + JSON.stringify(worker.url + '/mcp'),
        '-c', 'mcp_servers.gpusampling.bearer_token_env_var="GSS_MCP_TOKEN"');
      for(const tool of ['present_task','draft_cluster_setup','prepare_cluster_run','prepare_run','resume_run','write_project_input','generate_bias','create_workflow'])
        args.push('-c','mcp_servers.gpusampling.tools.'+tool+'.approval_mode="approve"');
      env.GSS_MCP_TOKEN = worker.tokens.mcp;
    }
    const child = spawn(executable, args, { stdio: ['pipe','pipe','pipe'], windowsHide: true, env });
    this.process=child;
    child.on('error', err => {if(this.process===child)this.fail(err);});
    child.on('exit', (code, signal) => {
      if(this.process!==child)return;
      this.fail(new Error('Codex disconnected (' + (signal || code) + ')'));
      this.process = null;
      this.emit('event', { method: 'studio/codexDisconnected', params: { code, signal } });
    });
    this.process.stderr.on('data', data => this.emit('diagnostic', data.toString().slice(-4000)));
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
      this.info = await this.request('initialize', {
        clientInfo: { name: 'gpu_sampling_studio', title: 'GPU Sampling Studio', version: '0.13.1' }
      });
      this.send({ method: 'initialized', params: {} });
      return this.info;
    } catch (error) { this.close(); throw error; }
  }
  send(value) {
    if (!this.process || this.process.stdin.destroyed) throw new Error('Connect Codex first');
    this.process.stdin.write(JSON.stringify(value) + '\n');
  }
  request(method, params = {}, timeout = 120000) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' timed out')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  receive(message) {
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
  close() { const active=!!this.process;this.fail(new Error('Codex bridge closed'));this.process?.kill();this.process=null;if(active)this.emit('event',{method:'studio/codexDisconnected',params:{reason:'closed'}}); }
}
