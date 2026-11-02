import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {memoryStorage} from './helpers/agent-hooks.mjs';
import {appWorkerHarness,completeComputeGuide} from './helpers/app-worker-hooks.mjs';
const findId=(h,id)=>h.find(n=>n.props?.['data-testid']===id);
const absent=(h,p)=>assert.throws(()=>h.find(p),/not found/);
const forbidden=c=>['worker.connect','compute.connection.connect','ssh.auth.plan','terminal.start','ssh.import'].includes(c.method)||c.method==='settings'||c.method==='worker.request'&&c.data.method==='POST';
for(const route of ['footer','settings'])test(route+' SSH entry opens the same canonical editor without connection, auth, probe, grant or save',async()=>{
 const h=appWorkerHarness();await h.flush();const before=h.calls.length;
 if(route==='footer'){findId(h,'unified-compute-entry').props.onClick();await h.flush();h.find(n=>n.type==='./ComputeConnectionChooser').props.onSsh();}
 else {const p=h.openSettings();p.onChange({...p.settings,theme:'light',workerRoot:'/unsaved-root'});await h.flush();h.find(n=>n.type==='./SettingsPage').props.onOpenSshCompute();}
 await h.flush();const cluster=h.find(n=>n.type==='./ClusterPage');assert.equal(typeof cluster.props.onAuthenticate,'function');
 assert.equal(cluster.props.settings.workerRoot,'~/saved');assert.equal(cluster.props.settings.theme,'dark');
 assert(!h.calls.slice(before).some(forbidden));assert(!h.calls.slice(before).some(c=>String(c.data?.target||'').includes('probe')));
 absent(h,n=>n.type==='./ComputeConnectionChooser');absent(h,n=>n.type==='./SettingsPage');findId(h,'navigate-home');h.find(n=>n.props?.['aria-label']==='设置');h.unmount();
});
test('chooser cancel has zero connection side effects and footer has one entry',async()=>{
 const h=appWorkerHarness();await h.flush();const before=h.calls.length;findId(h,'unified-compute-entry').props.onClick();await h.flush();h.find(n=>n.type==='./ComputeConnectionChooser').props.onClose();await h.flush();
 absent(h,n=>n.type==='./ComputeConnectionChooser');absent(h,n=>n.props?.['data-testid']==='workspace-project-menu');assert.equal(h.calls.length,before);h.unmount();
});
for(const route of ['footer','settings'])test(route+' Local entry uses the existing reviewed guide and Settings rollback',async()=>{
 const h=appWorkerHarness();await h.flush();const before=h.calls.length;
 if(route==='footer'){findId(h,'unified-compute-entry').props.onClick();await h.flush();h.find(n=>n.type==='./ComputeConnectionChooser').props.onLocal();}
 else {const p=h.openSettings();p.onChange({...p.settings,workerRoot:'/unsaved-root'});await h.flush();h.find(n=>n.type==='./SettingsPage').props.onOpenLocalCompute();}
 await h.flush();h.find(n=>n.type==='./ComputeConnectionGuide');assert(!h.calls.slice(before).some(forbidden));await completeComputeGuide(h,false);assert(!h.calls.slice(before).some(forbidden));const p=h.openSettings();assert.equal(p.settings.workerRoot,'~/saved');h.unmount();
});
test('project management remains reachable through Settings with rollback and existing modal',async()=>{
 const h=appWorkerHarness();await h.flush();const p=h.openSettings();p.onChange({...p.settings,workerRoot:'/unsaved'});await h.flush();h.find(n=>n.type==='./SettingsPage').props.onOpenProjects();await h.flush();findId(h,'new-project');assert(!h.calls.some(forbidden));h.unmount();
});
function component(name){const source=fs.readFileSync(new URL('../src/'+name+'.tsx',import.meta.url),'utf8'),module={exports:{}},jsx=(type,props)=>({type,props});
 new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(n=>n==='react'?{useState:v=>[v==='appearance'?'connections':v,()=>{}]}:n==='react/jsx-runtime'?{jsx,jsxs:jsx}:n==='./i18n'?{t:v=>v}:new Proxy({},{get:(_t,k)=>String(k)}),module,module.exports);return module.exports.default;
}
const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[];
test('actual chooser and Settings actions route via callbacks, with no second SSH form',()=>{
 let local=0,ssh=0,projects=0;const callbacks={onLocal:()=>local++,onSsh:()=>ssh++};const chooser=component('ComputeConnectionChooser')({...callbacks,onClose:()=>{}}),nodes=all(chooser);
 for(const id of ['compute-choice-local','compute-choice-ssh'])nodes.find(n=>n.props?.['data-testid']===id).props.onClick();
 const settings=all(component('SettingsPage')({settings:{},onOpenLocalCompute:callbacks.onLocal,onOpenSshCompute:callbacks.onSsh,onOpenProjects:()=>projects++}));
 for(const id of ['settings-connect-local','settings-connect-ssh','settings-project-management'])settings.find(n=>n.props?.['data-testid']===id).props.onClick();
 assert.deepEqual([local,ssh,projects],[2,2,1]);assert(!settings.some(n=>n.props?.['data-testid']==='ssh-host'));
});

test('unified Local entry retains the selected task original-source scope',async()=>{
 const storage=memoryStorage(),conversation={id:'codex:owned',provider:'codex',threadId:'owned',name:'Owned workflow',taskId:'owned-task'},task={id:'owned-task',name:'Owned task',provider:'codex',threadId:'owned',parameters:{},steps:[],artifacts:[]};storage.setItem('studio.conversation',conversation.id);
 const h=appWorkerHarness({storage,override:(method,data,standard)=>method==='conversation.list'?[conversation]:method==='conversation.select'?conversation:method==='task.list'?[task]:standard(method,data)});await h.flush();findId(h,'unified-compute-entry').props.onClick();await h.flush();h.find(n=>n.type==='./ComputeConnectionChooser').props.onLocal();await h.flush();assert.equal(h.find(n=>n.type==='./ComputeConnectionGuide').props.taskId,'owned-task');await completeComputeGuide(h,false);assert(!h.calls.some(forbidden));assert(!h.calls.some(c=>c.method==='conversation.select'&&c.data.new));h.unmount();
});
