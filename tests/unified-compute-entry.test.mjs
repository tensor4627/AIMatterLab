import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {memoryStorage} from './helpers/agent-hooks.mjs';
import {appWorkerHarness,completeComputeGuide} from './helpers/app-worker-hooks.mjs';
const savedLocal={id:'fixture-wsl',version:2,kind:'wsl',name:'Fixture local',distribution:'Fixture Linux',root:'/fixture/service',port:9080,intent:'existing'};
const findId=(h,id)=>h.find(n=>n.props?.['data-testid']===id);
const absent=(h,p)=>assert.throws(()=>h.find(p),/not found/);
const forbidden=c=>['worker.connect','compute.connection.connect','ssh.auth.plan','terminal.start','ssh.import'].includes(c.method)||c.method==='settings'||c.method==='worker.request'&&c.data.method==='POST';
for(const route of ['footer','settings'])test(route+' SSH entry opens the same canonical editor without connection, auth, probe, grant or save',async()=>{
 const h=appWorkerHarness();await h.flush();const before=h.calls.length;
 if(route==='footer'){findId(h,'unified-compute-entry').props.onClick();await h.flush();h.find(n=>n.type==='./ComputeConnectionChooser').props.onManageSsh();}
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
 if(route==='footer'){findId(h,'unified-compute-entry').props.onClick();await h.flush();h.find(n=>n.type==='./ComputeConnectionChooser').props.onLocal(savedLocal);}
 else {const p=h.openSettings();p.onChange({...p.settings,workerRoot:'/unsaved-root'});await h.flush();h.find(n=>n.type==='./SettingsPage').props.onOpenLocalCompute();}
 await h.flush();h.find(n=>n.type==='./ComputeConnectionGuide');assert(!h.calls.slice(before).some(forbidden));await completeComputeGuide(h,false);assert(!h.calls.slice(before).some(forbidden));const p=h.openSettings();assert.equal(p.settings.workerRoot,'~/saved');h.unmount();
});
test('project management remains reachable through Settings with rollback and existing modal',async()=>{
 const h=appWorkerHarness();await h.flush();const p=h.openSettings();p.onChange({...p.settings,workerRoot:'/unsaved'});await h.flush();h.find(n=>n.type==='./SettingsPage').props.onOpenProjects();await h.flush();h.find(n=>n.type==='Modal'&&n.props.title==='计算项目');findId(h,'new-project').props.onClick();await h.flush();h.find(n=>n.type==='Modal'&&n.props.title==='新建计算项目');h.find(n=>n.type==='./ProjectAuthorizationForm').props.onCancel();await h.flush();h.find(n=>n.type==='Modal'&&n.props.title==='计算项目').props.onClose();await h.flush();absent(h,n=>n.props?.['data-testid']==='project-management');assert(!h.calls.some(forbidden));h.unmount();
});
function component(name,category='connections'){const source=fs.readFileSync(new URL('../src/'+name+'.tsx',import.meta.url),'utf8'),module={exports:{}},jsx=(type,props)=>({type,props});
 new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(n=>n==='react'?{useState:v=>[v==='appearance'?category:v,()=>{}]}:n==='react/jsx-runtime'?{jsx,jsxs:jsx}:n==='./i18n'?{t:v=>v}:new Proxy({},{get:(_t,k)=>String(k)}),module,module.exports);return module.exports.default;
}
const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[];
test('Settings retains explicit local/manual SSH and independent permissions routes',()=>{
 let local=0,ssh=0,projects=0;const callbacks={onLocal:()=>local++,onSsh:()=>ssh++};
 const settings=all(component('SettingsPage')({settings:{},onOpenLocalCompute:callbacks.onLocal,onOpenSshCompute:callbacks.onSsh,onOpenProjects:()=>projects++}));
 for(const id of ['settings-connect-local','settings-connect-ssh'])settings.find(n=>n.props?.['data-testid']===id).props.onClick();
 assert(!settings.some(n=>n.props?.['data-testid']==='settings-project-management'));
 const permissions=all(component('SettingsPage','permissions')({settings:{},onOpenProjects:()=>projects++}));
 permissions.find(n=>n.props?.['data-testid']==='settings-project-management').props.onClick();
 assert(!permissions.some(n=>['settings-connect-local','settings-connect-ssh'].includes(n.props?.['data-testid'])));
 assert.deepEqual([local,ssh,projects],[1,1,1]);assert(!settings.some(n=>n.props?.['data-testid']==='ssh-host'));
});

test('explicit saved Local entry uses its profile without changing selected task ownership',async()=>{
 const storage=memoryStorage(),conversation={id:'codex:owned',provider:'codex',threadId:'owned',name:'Owned workflow',taskId:'owned-task'},task={id:'owned-task',name:'Owned task',provider:'codex',threadId:'owned',parameters:{},steps:[],artifacts:[]};storage.setItem('studio.conversation',conversation.id);
 const h=appWorkerHarness({storage,override:(method,data,standard)=>method==='conversation.list'?[conversation]:method==='conversation.select'?conversation:method==='task.list'?[task]:standard(method,data)});await h.flush();findId(h,'unified-compute-entry').props.onClick();await h.flush();h.find(n=>n.type==='./ComputeConnectionChooser').props.onLocal(savedLocal);await h.flush();const guide=h.find(n=>n.type==='./ComputeConnectionGuide');assert.deepEqual(guide.props.profile,{id:savedLocal.id,version:savedLocal.version});assert.equal(guide.props.taskId,undefined);assert.equal(h.find(n=>n.type==='./Agent').props.sessionSelection.conversation.taskId,'owned-task');await completeComputeGuide(h,false);assert(!h.calls.some(forbidden));assert(!h.calls.some(c=>c.method==='conversation.select'&&c.data.new));h.unmount();
});

test('Agent compute control opens manager while review-worker retains task-specific guide',async()=>{
 const storage=memoryStorage(),conversation={id:'codex:original',provider:'codex',threadId:'original',name:'Original',taskId:'original-task'},task={id:'original-task',name:'Original task',provider:'codex',threadId:'original',parameters:{},steps:[],artifacts:[]};storage.setItem('studio.conversation',conversation.id);
 const h=appWorkerHarness({storage,override:(method,data,standard)=>method==='conversation.list'?[conversation]:method==='conversation.select'?conversation:method==='task.list'?[task]:standard(method,data)});await h.flush();
 h.find(n=>n.type==='./Agent').props.onConnectCompute();await h.flush();h.find(n=>n.type==='./ComputeConnectionChooser');absent(h,n=>n.type==='./ComputeConnectionGuide');h.find(n=>n.type==='./ComputeConnectionChooser').props.onClose();await h.flush();
 void h.find(n=>n.type==='./Agent').props.onReviewWorker();await h.flush();assert.equal(h.find(n=>n.type==='./ComputeConnectionGuide').props.taskId,'original-task');await completeComputeGuide(h,false);assert(!h.calls.some(c=>c.method==='task.edit'||c.method==='task.authoring.bindWorker'));h.unmount();
});

test('explicit saved-profile connection suppresses workerConnected task restore and observes active worker only',async()=>{
 const storage=memoryStorage(),conversation={id:'codex:original',provider:'codex',threadId:'original',name:'Original',taskId:'original-task'},task={id:'original-task',name:'Original task',provider:'codex',threadId:'original',parameters:{},steps:[],artifacts:[]};storage.setItem('studio.conversation',conversation.id);
 const h=appWorkerHarness({storage,override:(method,data,standard)=>method==='conversation.list'?[conversation]:method==='conversation.select'?conversation:method==='task.list'?[task]:standard(method,data)});await h.flush();findId(h,'unified-compute-entry').props.onClick();await h.flush();const start=h.calls.length;
 const operation=h.find(n=>n.type==='./ComputeConnectionChooser').props.onLocal(savedLocal);await h.flush();h.emit({method:'studio/workerConnected',params:{}});await h.flush();assert(!h.calls.slice(start).some(c=>c.method==='worker.restore'));await completeComputeGuide(h,true);await operation;await h.flush();assert(h.calls.slice(start).some(c=>c.method==='worker.status'));assert(!h.calls.slice(start).some(c=>c.method==='worker.restore'));assert.equal(h.find(n=>n.type==='./Agent').props.sessionSelection.conversation.taskId,'original-task');h.find(n=>n.type==='./ComputeConnectionChooser');assert(!h.calls.slice(start).some(c=>['task.edit','task.authoring.bindWorker','conversation.select'].includes(c.method)));h.unmount();
});

test('late saved-profile guide completion cannot reopen manager after navigation owner sequence changes',async()=>{
 const h=appWorkerHarness();await h.flush();findId(h,'unified-compute-entry').props.onClick();await h.flush();const operation=h.find(n=>n.type==='./ComputeConnectionChooser').props.onLocal(savedLocal);await h.flush();const guide=h.find(n=>n.type==='./ComputeConnectionGuide');findId(h,'navigate-runs').props.onClick();await h.flush();const start=h.calls.length;guide.props.onClose(true);await operation;await h.flush();absent(h,n=>n.type==='./ComputeConnectionChooser');assert(!h.calls.slice(start).some(c=>['state','worker.restore','worker.status'].includes(c.method)));h.unmount();
});
