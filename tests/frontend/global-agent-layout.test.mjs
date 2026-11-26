import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
import {appWorkerHarness} from "../helpers/app-worker-hooks.mjs";import {agentHarness,conversation,memoryStorage} from "../helpers/agent-hooks.mjs";
const shell=h=>h.find(n=>n.props?.className?.startsWith?.('shell workspace-shell'));
const agent=h=>h.find(n=>n.type==='./Agent');
const divider=h=>h.find(n=>n.type==='./PaneDivider'&&n.props.className==='agent-divider');
function fixture({section='runs',width=1540,selected=false}={}){
 const storage=memoryStorage(),bound={...conversation('codex','layout-thread'),name:'Existing layout flow',taskId:'layout-task'},task={id:'layout-task',provider:'codex',threadId:bound.threadId,name:bound.name,parameters:{temperature:310},steps:[],artifacts:[]};
 storage.setItem('studio.section',section);storage.setItem('studio.sidebarVisible','false');storage.setItem('studio.agentWidth','1100');if(selected)storage.setItem('studio.conversation',bound.id);
 const h=appWorkerHarness({storage,width,override:(m,d,standard)=>m==='state'?{settings:{distribution:'Fixture Ubuntu',workerRoot:'~/fixture',workerPort:8767,theme:'light',agentLayout:'center',skillRoots:[]}}:m==='conversation.list'?[bound]:m==='conversation.select'?bound:m==='task.list'?[task]:standard(m,d)});
 return{h,storage,bound,task};
}
for(const section of ['runs','skills','environments'])test('global '+section+' is content-first with independent bounded right Agent',async()=>{
 const{h,storage}=fixture({section});try{await h.flush();assert(!shell(h).props.className.includes('agent-center'));assert.equal(agent(h).props.width,340);assert.equal(shell(h).props.style['--agent-width'],'340px');assert.equal(divider(h).props.reverse,true);assert.equal(divider(h).props.max,600);assert.equal(storage.getItem('studio.agentWidth'),'1100');assert(!h.calls.some(c=>c.method==='settings'));}finally{h.unmount();}
});
for(const section of ['agent-task:layout-task','deployment:layout-task'])test('conversation route '+section+' retains saved chat priority and conversation width',async()=>{
 const{h,storage}=fixture({section});try{await h.flush();assert(shell(h).props.className.includes('agent-center'));assert.equal(agent(h).props.width,1100);assert.equal(divider(h).props.reverse,false);h.find(n=>n.props?.['data-testid']==='priority-chat');assert.equal(storage.getItem('studio.agentWidth'),'1100');}finally{h.unmount();}
});
test('global width clamp respects content dominance without overwriting saved preferences',async()=>{
 const{h,storage}=fixture({width:1000});storage.setItem('studio.overviewAgentWidth','900');
 // State is loaded when App is created; exercise the existing actual divider setter.
 try{await h.flush();divider(h).props.onChange(900);await h.flush();const max=Math.floor((1000-56)*.45);assert.equal(divider(h).props.max,max);assert.equal(agent(h).props.width,max);assert.equal(shell(h).props.style['--agent-width'],max+'px');assert.equal(storage.getItem('studio.overviewAgentWidth'),'900');assert.equal(storage.getItem('studio.agentWidth'),'1100');}finally{h.unmount();}
});
test('global and conversation drags persist independently while actual Agent draft/session/task survive route return',async()=>{
 const{h,storage,bound,task}=fixture({selected:true});await h.flush();const a=agentHarness({storage,props:agent(h).props,override:(m,d,standard)=>m==='conversation.remember'?bound:standard(m,d)});await a.flush();a.type('Preserve unsent layout draft');await a.flush();const selection=agent(h).props.sessionSelection;
 h.find(n=>n.props?.['data-testid']==='navigate-runs').props.onClick();await h.flush();a.render(agent(h).props);await a.flush();assert.equal(a.textarea().props.value,'Preserve unsent layout draft');assert.equal(agent(h).props.sessionSelection,selection);
 divider(h).props.onChange(520);await h.flush();assert.equal(storage.getItem('studio.overviewAgentWidth'),'520');assert.equal(storage.getItem('studio.agentWidth'),'1100');
 h.find(n=>n.props?.['data-testid']==='navigate-home').props.onClick();await h.flush();h.find(n=>n.type==='button'&&n.props?.children?.[0]?.props?.children===bound.name).props.onClick();await h.flush();a.render(agent(h).props);await a.flush();assert(shell(h).props.className.includes('agent-center'));assert.equal(divider(h).props.reverse,false);assert.equal(storage.getItem('studio.agentWidth'),'1100');assert.equal(a.textarea().props.value,'Preserve unsent layout draft');assert.equal(h.find(n=>n.type==='./AgentTaskPage').props.task.parameters.temperature,task.parameters.temperature);
 divider(h).props.onChange(450);await h.flush();assert.equal(storage.getItem('studio.agentWidth'),'450');assert.equal(storage.getItem('studio.overviewAgentWidth'),'520');h.find(n=>n.props?.['data-testid']==='priority-chat');h.find(n=>n.props?.['data-testid']==='priority-workflow');assert(!h.calls.some(c=>c.method==='task.edit'||c.method==='task.execute'||c.method==='agent.rpc'&&c.data.method==='turn/start'));a.unmount();h.unmount();
});
test('narrow global toolbar reveals Agent and reachable rail returns to same page with owner unchanged',async()=>{
 const{h,storage,bound,task}=fixture({width:640,selected:true});try{
  await h.flush();h.find(n=>n.props?.['data-testid']==='navigate-runs').props.onClick();await h.flush();
  const selection=agent(h).props.sessionSelection;assert.equal(selection.conversation.taskId,task.id);assert.equal(selection.conversation.threadId,bound.threadId);
  assert(shell(h).props.className.includes('single-panel'));assert.equal(agent(h).props.hidden,true);
  h.find(n=>n.type==='button'&&n.props?.['aria-label']==='切换 Agent 面板').props.onClick();await h.flush();assert.equal(agent(h).props.hidden,false);assert.equal(shell(h).props['data-primary-panel'],'agent');
  // The toolbar is now hidden with main-column. Use the always-visible rail.
  h.find(n=>n.props?.['data-testid']==='navigate-runs').props.onClick();await h.flush();
  assert.equal(agent(h).props.hidden,true);assert.equal(shell(h).props['data-primary-panel'],'workspace');assert.equal(storage.getItem('studio.section'),'runs');assert.equal(agent(h).props.sessionSelection,selection);assert.equal(storage.getItem('studio.conversation'),bound.id);
 }finally{h.unmount();}
});
test('global width changes retain editor text, terminal identity and unchanged Agent subtree key',async()=>{
 const{h}=fixture({section:'editor'});try{
  await h.flush();const editor=()=>h.find(n=>n.type==='CodeEditor'),terminal=()=>h.find(n=>n.type==='./SharedTerminalPanel');
  h.find(n=>n.type==='button'&&h.text(n)==='本地终端').props.onClick();editor().props.onChange('Owned unsaved editor text');await h.flush();
  const before={agentKey:agent(h).props.key,terminalKey:terminal().props.key,editorKey:editor().props.key},request=terminal().props.request;
  assert.equal(request.kind,'local');assert.equal(terminal().props.visible,true);divider(h).props.onChange(410);await h.flush();
  assert.equal(editor().props.value,'Owned unsaved editor text');assert.equal(terminal().props.request,request);assert.equal(terminal().props.visible,true);assert.deepEqual({agentKey:agent(h).props.key,terminalKey:terminal().props.key,editorKey:editor().props.key},before);assert(!shell(h).props.className.includes('agent-center'));assert(!h.calls.some(call=>call.method==='sharedTerminal.open'));
 }finally{h.unmount();}
});
function dividerFixture(props){
 const code=ts.transpileModule(fs.readFileSync(new URL('../../frontend/ui/PaneDivider.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const module={exports:{}},values=[],handlers=new Map(),preview=new Map();let cleanup;
 const react={useRef:current=>({current}),useLayoutEffect:fn=>{cleanup=fn();}};
 new Function('require','module','exports',code)(name=>name==='react'?react:name==='./i18n'?{t:x=>x}:{jsx:(type,props)=>({type,props})},module,module.exports);
 const node={dataset:{},setAttribute(){},setPointerCapture(){},hasPointerCapture:()=>false,closest:()=>({style:{setProperty:(k,v)=>preview.set(k,v),removeProperty:k=>preview.delete(k)}}),addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name)};
 const {props:events}=module.exports.default({...props,onChange:x=>values.push(x)});
 const pointer=(type,x,y=0,pointerId=1)=>({type,clientX:x,clientY:y,pointerId,currentTarget:node,isPrimary:true,button:0,preventDefault(){}});
 return {values,preview,handlers,events,down:(x,y)=>events.onPointerDown(pointer('pointerdown',x,y)),fire:(type,x,y,id)=>handlers.get(type)(pointer(type,x,y,id)),unmount:()=>cleanup()};
}

test('divider previews moves, ignores other pointers and commits the final clamped position once',()=>{
 const f=dividerFixture({label:'Resize',pane:'agent',value:340,min:260,max:600,reverse:true});
 for(const key of ['ArrowRight','End'])f.events.onKeyDown({key,preventDefault(){}});
 f.down(100);f.fire('pointermove',80);assert.equal(f.preview.get('--drag-agent'),'360px');
 f.fire('pointerup',200,0,2);assert.equal(f.handlers.size,4);
 f.fire('pointermove',1000);assert.equal(f.preview.get('--drag-agent'),'260px');assert.deepEqual(f.values,[308,600]);
 f.fire('pointerup',95);assert.deepEqual(f.values,[308,600,345]);assert.equal(f.handlers.size,0);assert.equal(f.preview.size,0);
});

test('horizontal divider keeps keyboard controls and cancels previews on interruption or unmount',()=>{
 const f=dividerFixture({label:'Height',pane:'bottom',orientation:'horizontal',value:190,min:90,max:380,reverse:true});
 for(const [key,shiftKey] of [['ArrowUp',false],['ArrowDown',true],['Home',false],['End',false],['ArrowRight',false]])f.events.onKeyDown({key,shiftKey,preventDefault(){}});
 for(const end of ['pointercancel','lostpointercapture','unmount']){
  f.down(100,200);f.fire('pointermove',999,150);assert.equal(f.preview.get('--drag-bottom'),'240px');
  if(end==='unmount')f.unmount();else f.fire(end,999,150);
  assert.equal(f.handlers.size,0);assert.equal(f.preview.size,0);
 }
 assert.deepEqual(f.values,[222,189,90,380]);
});
