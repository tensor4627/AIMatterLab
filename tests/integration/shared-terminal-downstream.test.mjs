import test from 'node:test';import assert from 'node:assert/strict';
import {apply as applyDshPolicy,dshToolAllowed} from "../../agent/providers/dsh-policy.mjs";import {sharedTerminalTools} from "../../backend/main/compute/shared-terminal.mjs";import {McpProviderScopes} from "../../agent/tools/provider-scope.mjs";import {compositionToolGuard} from "../../backend/main/workspace/task-pygas.mjs";import {CodexBridge} from "../../agent/providers/codex.mjs";

test('DSH provider policy exposes only explicit shared-terminal tools in chat without enabling scientific writes',()=>{
 const candidates=[...sharedTerminalTools,{name:'present_task'},{name:'unknown_fixture_tool'}];
 const allowed=candidates.filter(t=>dshToolAllowed(t.name,false));
 assert.deepEqual(allowed.map(t=>t.name).sort(),sharedTerminalTools.map(t=>t.name).sort());
 assert(!allowed.some(t=>t.name==='present_task'||t.name==='unknown_fixture_tool'));
});
test('compatible provider lease URL authenticates its exact provider without exposing another provider',()=>{const scopes=new McpProviderScopes(),base={url:'http://127.0.0.1:31001',tokens:{mcp:'SYNTHETIC_BASE_ONLY'}};scopes.bind(base);scopes.bindContext('compatible',{threadId:'fixture-thread'});const connection=scopes.connection('compatible',base),auth=scopes.authenticate({pathname:new URL(connection.url).pathname+'/mcp',authorization:'Bearer '+connection.tokens.mcp,host:'127.0.0.1:31001'});assert(auth,'saved compatible provider URL must have an authenticatable lease');assert.equal(auth.provider,'compatible');assert(auth.checkCurrent());assert.equal(scopes.authenticate({pathname:'/providers/codex/mcp',authorization:'Bearer '+connection.tokens.mcp,host:'127.0.0.1:31001'}),null);});
test('composition guard and Codex strict isolation do not independently reject registered gpusampling terminal tool names',()=>{const guard=compositionToolGuard({},{get:()=>null}),bridge=new CodexBridge({strictIsolation:true});let closed=0;bridge.close=()=>{closed++;};for(const tool of sharedTerminalTools){assert.equal(guard.before(tool.name,{},'codex'),null);bridge.receive({method:'item/started',params:{item:{type:'mcpToolCall',server:'gpusampling',tool:tool.name}}});}assert.equal(closed,0);});

test('ordinary chat describes resource leases and independent jobs without creating a workflow',async()=>{const {TaskRecords}=await import("../../agent/sessions/task-records.mjs"),{STUDIO_INSTRUCTIONS,SHARED_TERMINAL_CHAT_INSTRUCTIONS}=await import("../../agent/context/agent-settings.mjs");const rows=new Map(),events=[],records=new TaskRecords({get:(kind,id)=>rows.get(kind+':'+id),put:(kind,id,value)=>rows.set(kind+':'+id,value)},e=>events.push(e));const original=[{type:'text',text:'Public connection assistance only'}],turn=records.prepareTurn('codex',{threadId:'fixture-chat',planningMode:false,input:original});assert.deepEqual(turn.input[0],original[0]);assert.equal(rows.size,0);assert.deepEqual(events,[]);const context=turn.input.at(-1).text;assert(context.includes('mode: chat'));assert.match(context,/explicit current handoff/);assert.match(context,/resource leases, queue inspection, environment setup and explicitly delegated independent jobs/);
 assert(!context.includes(SHARED_TERMINAL_CHAT_INSTRUCTIONS));assert(!STUDIO_INSTRUCTIONS.includes(SHARED_TERMINAL_CHAT_INSTRUCTIONS));
 const {terminalOnlyTurn}=await import('../../agent/sessions/terminal-turn.mjs');
 const delegated=terminalOnlyTurn({input:original}).input.at(-1).text;
 assert(delegated.includes(SHARED_TERMINAL_CHAT_INSTRUCTIONS));for(const tool of sharedTerminalTools)assert(delegated.includes(tool.name));
 assert.match(delegated,/Worker tools and hosted resource leases have their own grants/);assert.match(delegated,/authentication secrets/);});
const mcpModule='data:text/javascript,'+encodeURIComponent('export function createMcpToolDefinition(_ctx,def){return def;}');
const toolsModule='data:text/javascript,'+encodeURIComponent('export function validateJsonSchemaValue(){return [];}');
test('DSH policy registers terminal-only MCP inventory cleanly and rejects unapproved tools',async()=>{
 const registered=[],calls=[];let guard;
 const originalFetch=globalThis.fetch,previousToken=process.env.GSS_MCP_TOKEN;
 process.env.GSS_MCP_TOKEN='synthetic-token';
 globalThis.fetch=async(_url,options)=>{
  const body=JSON.parse(options.body);calls.push(body);
  if(body.method==='tools/list')return Response.json({result:{tools:sharedTerminalTools}});
  return Response.json({result:{content:[{type:'text',text:'PUBLIC FIXTURE OUTPUT'}]}});
 };
 try{
  await applyDshPolicy({tools:{register:def=>registered.push(def),guard:fn=>{guard=fn;},schemas:()=>registered},systemPrompt:{section(){}},on(){},effect(){},appReady:{onReady(){}},llm:{},agents:{}},{workerUrl:'http://127.0.0.1:8767/mcp',mcpModule,toolsModule,workflow:true,instructions:'Fixture',models:[]});
  assert.deepEqual(registered.map(t=>t.rawName).sort(),sharedTerminalTools.map(t=>t.name).sort());
  const readDef=registered.find(t=>t.rawName==='read_shared_terminal');
  assert.equal(guard({name:readDef.name}),undefined);
  assert.equal(guard({name:'mcp__gpusampling__unknown_fixture_tool'}),'Only the verified AIMatterLab tools are available');
  const reply=await readDef.call({session_id:'fixture-session'},{signal:new AbortController().signal});
  assert.equal(reply.content[0].text,'PUBLIC FIXTURE OUTPUT');
  assert.deepEqual(calls.map(c=>c.method),['tools/list','tools/call']);
 }finally{
  globalThis.fetch=originalFetch;
  if(previousToken===undefined)delete process.env.GSS_MCP_TOKEN;else process.env.GSS_MCP_TOKEN=previousToken;
 }
});
