import {loadFrontendI18n} from '../helpers/frontend-component-loader.mjs';
import __node_test, {describe as __describe} from 'node:test';
import assert from "node:assert/strict";
import fs from "node:fs";
import {appWorkerHarness} from "../helpers/app-worker-hooks.mjs";
import {agentHarness, memoryStorage} from "../helpers/agent-hooks.mjs";
import {sshGuideKey, enqueueSshGuide, takeQueuedSshGuide} from "../../frontend/app/ssh-guide-queue.mjs";
import ts from "typescript";

await __describe("shared-terminal-entry-layout", async () => {
const test = __node_test;
const ssh={id:'fixture-saved-ssh',version:3,kind:'ssh',name:'Fixture saved SSH',mode:'interactive'};
const shell=h=>h.find(n=>n.props?.className?.startsWith?.('shell workspace-shell'));
const agent=h=>h.find(n=>n.type==='./Agent');
for(const width of [1440,640])test('saved SSH reveals main terminal from fresh ordinary Agent-primary chat at width '+width,async()=>{
 const storage=memoryStorage(),h=appWorkerHarness({storage,width});await h.flush();await agent(h).props.onNewConversation();await h.flush();const selected=agent(h).props.sessionSelection;assert.equal(selected.new,true);assert.equal(agent(h).props.planningMode,false);assert.equal(shell(h).props['data-primary-panel'],'agent');assert(!shell(h).props.className.includes('chat-only'));assert.equal(agent(h).props.hidden,false);if(width===640)assert(shell(h).props.className.includes('single-panel'));
 const a=agentHarness({storage,props:agent(h).props});await a.flush();a.type('Keep this unsent terminal-navigation draft');const before=storage.getItem('studio.conversation');const callStart=h.calls.length;
 agent(h).props.onConnectCompute();await h.flush();h.find(n=>n.type==='./ComputeConnectionChooser').props.onSsh(ssh);await h.flush();
 assert.equal(shell(h).props['data-primary-panel'],'workspace','terminal parent must be the visible primary panel');h.find(n=>n.type==='main'&&n.props.className==='main-column');const bottom=h.find(n=>n.props?.['data-testid']==='bottom-panel');assert(!bottom.props.className.includes('is-collapsed'));assert(Number.parseFloat(bottom.props.style['--bottom-height'])>=300);const terminal=h.find(n=>n.type==='./SharedTerminalPanel');assert.equal(terminal.props.visible,true);assert.deepEqual({...terminal.props.request,nonce:undefined},{nonce:undefined,kind:'ssh',mode:'interactive',profileId:ssh.id,version:ssh.version,profileName:ssh.name,connectionMode:"managed"});assert(terminal.props.request.nonce);assert.equal(agent(h).props.sessionSelection,selected);assert.equal(storage.getItem('studio.conversation'),before);a.render(agent(h).props);await a.flush();assert.equal(a.textarea().props.value,'Keep this unsent terminal-navigation draft');assert(!h.calls.slice(callStart).some(c=>['conversation.select','worker.connect','sharedTerminal.open','agent.connect','task.edit'].includes(c.method)));assert(!h.calls.some(c=>c.method==='agent.rpc'&&c.data.method==='turn/start'));a.unmount();h.unmount();
});
});

await __describe("ssh-guide-queue", async () => {
const test = __node_test;
const state=request=>({request});
const saved=(clusterId,version)=>({kind:'saved-profile',clusterId,version,expected:{}});
const original=(runId,taskId)=>({kind:'original-run',runId,...taskId?{taskId}:{}});

test('a guide opens immediately when none is active and deduplicates the same request',()=>{
 const first=state(saved('cluster',4));
 let queued=enqueueSshGuide(null,null,first);
 assert.equal(queued.current,first);assert.equal(queued.queued,null);
 const duplicate=state(saved('cluster',4));
 queued=enqueueSshGuide(queued.current,queued.queued,duplicate);
 assert.equal(queued.current,first,'same saved-profile version must not replace the active guide');
 assert.equal(queued.queued,null);
});

test('a different request waits until the active guide closes',()=>{
 const active=state(saved('cluster',4)),next=state(original('run-1','task-1'));
 let queue=enqueueSshGuide(active,null,next);
 assert.equal(queue.current,active);assert.equal(queue.queued,next);
 const waiting=state(saved('cluster',5));
 queue=enqueueSshGuide(queue.current,queue.queued,waiting);
 assert.equal(queue.current,active);assert.equal(queue.queued,waiting,'only the latest pending request is kept');
 const shifted=takeQueuedSshGuide(null,queue.queued);
 assert.equal(shifted.current,waiting);assert.equal(shifted.queued,null);
 const empty=takeQueuedSshGuide(null,null);
 assert.equal(empty.current,null);assert.equal(empty.queued,null);
});

test('request keys distinguish clusters, versions, runs and tasks',()=>{
 assert.notEqual(sshGuideKey(saved('a',1)),sshGuideKey(saved('a',2)));
 assert.notEqual(sshGuideKey(saved('a',1)),sshGuideKey(saved('b',1)));
 assert.notEqual(sshGuideKey(original('run-1')),sshGuideKey(original('run-1','task-1')));
 assert.equal(sshGuideKey(original('run-1')),sshGuideKey(original('run-1')));
});
});

await __describe("ssh-independent-i18n", async () => {
const test = __node_test;
const module={exports:loadFrontendI18n({getItem:()=> 'en',setItem(){}})};
const sources=['terminal/SshConnectionPanel.tsx','compute/IndependentSshServiceSettings.tsx','compute/ssh-connection-types.ts','compute/SshServiceObservation.tsx'];
for(const file of sources)test('new independent SSH UI has fixed English strings: '+file,()=>{const ast=ts.createSourceFile(file,fs.readFileSync(new URL('../../frontend/features/'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),keys=new Set();function walk(node){if(ts.isStringLiteral(node)&&/[\u4e00-\u9fff]/.test(node.text))keys.add(node.text);ts.forEachChild(node,walk);}walk(ast);for(const key of keys)assert.doesNotMatch(module.exports.t(key),/[\u4e00-\u9fff]/,key);});
test('new Agent independent-channel notices remain English',()=>{for(const key of ['请先在终端完成 SSH 登录，成功后会自动进入终端。','请在“作业服务”中交给 Agent，授权当前对话使用服务；终端可分别交接。','请在“终端操作”中交给 Agent，或连接并交接作业服务。','当前对话的工具尚未就绪，请核对终端或作业服务状态。'])assert.doesNotMatch(module.exports.t(key),/[\u4e00-\u9fff]/);});
});

await __describe("ssh-service-observation", async () => {
const test = __node_test;
const compile=file=>ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const presentation={exports:{}};new Function('module','exports',compile('../../frontend/features/terminal/ssh-service-presentation.ts'))(presentation,presentation.exports);
const module={exports:{}},jsx=(type,props)=>({type,props});new Function('require','module','exports',compile('../../frontend/features/compute/SshServiceObservation.tsx'))(name=>name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='../../ui/i18n'?{t:value=>value}:presentation.exports,module,module.exports);
const render=state=>JSON.stringify(module.exports.default({state}));
test('unknown service status never promotes a retained ready phase into ready evidence',()=>{assert.doesNotMatch(render({status:'unknown',phase:'ready'}),/作业服务已就绪/);});
test('only acknowledged transfer counters during an active connect produce a progress view',()=>{const state={status:'connecting',phase:'transferring_worker',progress:{kind:'transfer',completedBytes:25,totalBytes:100}};assert.match(render(state),/progress/);assert.match(render(state),/仅表示已确认的文件传输/);assert.doesNotMatch(render({...state,status:'failed'}),/progress/);assert.doesNotMatch(render({...state,progress:{...state.progress,completedBytes:101}}),/progress/);});
test('independent service stop timeout never tells users shell input needs restoration',()=>{const result=render({status:'unknown',error:{code:'stop_timeout'}});assert.match(result,/服务停止尚未确认/);assert.doesNotMatch(result,/返回终端|恢复输入/);});
test('remote diagnostic text is not included in the bounded service observation',()=>{assert.doesNotMatch(render({status:'failed',error:{code:'untrusted private remote text'}}),/untrusted private remote text/);});
});
