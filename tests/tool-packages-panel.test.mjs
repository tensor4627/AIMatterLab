import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createReadPolicy} from '../agent/skills/read-policy.mjs';
import {selectedSkillContext} from '../agent/skills/skill-context.mjs';
import {deferred} from './helpers/agent-hooks.mjs';
import {toolPackagesHarness,packageRecord,configurationRecord} from './helpers/tool-packages-components.mjs';

const calls=(h,method)=>h.calls.filter(call=>call.method===method);
const node=(h,id)=>h.find(node=>node.props?.['data-testid']===id);
const selected=async(h,id='worker-reference')=>{await h.flush();h.change('已登记工具包',id);await h.flush();};
async function planned(h){await selected(h);h.click('tool-configuration-start');await h.flush();h.change('工具配置环境','environment-A');h.change('工具配置项目','project-A');h.click('tool-configuration-plan');await h.flush();}
async function active(h){await selected(h);h.change('已登记配置','configuration-01');await h.flush();h.click('查看执行技能与指导范围');await h.flush();}

test('production SkillsWorkbench composes the tool package panel and panel startup is metadata-only',async()=>{
 const source=fs.readFileSync(new URL('../src/SkillsWorkbench.tsx',import.meta.url),'utf8');assert.match(source,/import ToolPackagesPanel from '\.\.\/frontend\/features\/tools\/ToolPackagesPanel'/);assert.match(source,/<ToolPackagesPanel provider=\{provider\} onSelect=\{onSelect\}/);
 const h=toolPackagesHarness();await h.flush();assert.deepEqual(h.calls.map(call=>call.method).sort(),['tools.configurations.context','tools.configurations.list','tools.packages.list']);assert.equal(h.attachments.length,0);assert.equal(h.timers.size,0);assert.match(h.text(h.tree()),/真实环境的安装与测试通过后/);h.unmount();
});

test('native choose cancellation has no inspection or registration side effect',async()=>{
 const h=toolPackagesHarness({override:(method,data,standard)=>method==='tools.packages.choose'?{package_root:null}:standard(method,data)});await h.flush();h.click('tool-package-choose');await h.flush();assert.equal(calls(h,'tools.packages.inspect').length,0);assert.equal(calls(h,'tools.packages.register').length,0);h.unmount();
});

test('inspection exposes definition and test coverage, while registration is a separate explicit action',async()=>{
 const h=toolPackagesHarness({records:[]});await h.flush();h.click('tool-package-choose');await h.flush();assert.match(h.text(node(h,'tool-package-candidate')),/定义检查通过；安装与功能测试未运行/);assert.match(h.text(node(h,'tool-package-candidate')),/Real child PID and supervisor receipt/);assert.equal(calls(h,'tools.packages.register').length,0);assert.equal(calls(h,'worker.request').length,0);
 h.click('登记此工具包');await h.flush();assert.equal(calls(h,'tools.packages.register').length,1);assert.deepEqual(calls(h,'tools.packages.register')[0].data,{package_root:h.data.candidate.package_root});assert.match(h.text(node(h,'tool-package-record')),/definition_checked/);assert.match(h.text(node(h,'tool-package-record')),/安装: not_run/);assert.equal(calls(h,'tools.configurations.plan').length,0);h.unmount();
});

test('update and relocate submit the reviewed current revision and exact author root',async()=>{
 const h=toolPackagesHarness();await selected(h);h.data.candidate={...structuredClone(h.data.candidate),package_version:'2'.repeat(64),source_commit:'d'.repeat(40),versions:['1'.repeat(64),'2'.repeat(64)]};h.click('tool-package-choose');await h.flush();h.click('更新为此版本');await h.flush();assert.deepEqual(calls(h,'tools.packages.update')[0].data,{package_id:'worker-reference',expected_revision:2,package_root:h.data.candidate.package_root});
 h.data.candidate={...structuredClone(h.data.records.get('worker-reference')),package_root:'/fixture/moved/worker-reference-package'};h.click('tool-package-choose');await h.flush();h.click('仅更新包位置');await h.flush();assert.deepEqual(calls(h,'tools.packages.relocate')[0].data,{package_id:'worker-reference',expected_revision:3,package_root:'/fixture/moved/worker-reference-package'});assert.equal(calls(h,'tools.configurations.execute').length,0);h.unmount();
});

test('an older package read cannot overwrite another selected package or its configuration controls',async()=>{
 const pending=deferred(),a=packageRecord(),b=packageRecord('another-tool');const h=toolPackagesHarness({records:[a,b],override:(method,data,standard)=>method==='tools.packages.read'&&data.package_id===a.package_id?pending.promise:standard(method,data)});await h.flush();h.change('已登记工具包',a.package_id);await h.flush();h.change('已登记工具包',b.package_id);await h.flush();pending.resolve(a);await h.flush();assert.match(h.text(node(h,'tool-package-record')),/another-tool reference/);assert(!h.text(node(h,'tool-package-record')).includes('worker-reference reference'));assert.equal(calls(h,'tools.configurations.plan').length,0);h.unmount();
});

test('selection change or unmount invalidates native chooser results before follow-up inspection',async()=>{
 for(const mode of ['selection','unmount']){const pending=deferred(),h=toolPackagesHarness({override:(method,data,standard)=>method==='tools.packages.choose'?pending.promise:standard(method,data)});await h.flush();h.click('tool-package-choose');await h.flush();if(mode==='selection')h.change('已登记工具包','worker-reference');else h.unmount();pending.resolve({package_root:'/fixture/old/worker-reference-package'});await h.flush();assert.equal(calls(h,'tools.packages.inspect').length,0);if(mode==='selection')h.unmount();}
});

test('non-reference engines remain registrable but have no configuration-start control or environment reads',async()=>{
 const record=packageRecord();record.manifest.functions[0].engine='pydyn.md';const h=toolPackagesHarness({records:[record]});await selected(h);assert.match(h.text(node(h,'tool-package-unsupported')),/配置尚不支持/);assert.throws(()=>node(h,'tool-configuration-start'),/not found/);assert.equal(calls(h,'worker.request').length,0);assert.equal(calls(h,'tools.configurations.plan').length,0);h.unmount();
});

test('configuration explicitly reads existing targets and filters authoring or unauthorized projects without changing policy',async()=>{
 const h=toolPackagesHarness();h.data.projects.push({...structuredClone(h.data.projects[0]),id:'authoring',authoring_only:true},{...structuredClone(h.data.projects[0]),id:'wrong-engine',policy:{...h.data.projects[0].policy,engines:['pydyn.md']}});const before=structuredClone(h.data.projects);await selected(h);assert.equal(calls(h,'worker.request').length,0);h.click('tool-configuration-start');await h.flush();assert.deepEqual(calls(h,'worker.request').map(call=>call.data),[{method:'GET',target:'/api/projects',data:undefined},{method:'GET',target:'/api/environments',data:undefined}]);assert.equal(node(h,'tool-configuration-plan').props.disabled,true);h.change('工具配置环境','environment-A');const choices=h.find(node=>node.props?.['aria-label']==='工具配置项目');assert.match(h.text(choices),/Existing authorized CPU project/);assert(!h.text(choices).includes('wrong-engine'));assert.equal(h.all().filter(node=>node.type==='option'&&node.props.value==='authoring').length,0);assert.deepEqual(h.data.projects,before);assert.equal(calls(h,'tools.configurations.execute').length,0);h.unmount();
});

test('createProject only sends explicit environment/name/request identity, and plan never executes implicitly',async()=>{
 const h=toolPackagesHarness();await selected(h);h.click('tool-configuration-start');await h.flush();h.change('工具配置环境','environment-A');h.change('CPU 检查项目名称','New isolated CPU project');h.click('创建检查项目');await h.flush();const value=calls(h,'tools.configurations.createProject')[0].data;assert.equal(value.environment_id,'environment-A');assert.equal(value.name,'New isolated CPU project');assert.match(value.request_id,/^[a-f0-9-]{36}$/);assert.deepEqual(Object.keys(value).sort(),['environment_id','name','request_id']);h.click('tool-configuration-plan');await h.flush();assert.equal(calls(h,'tools.configurations.plan')[0].data.project_id,'created-project');assert.match(h.text(node(h,'tool-configuration-result')),/\/fixture\/installed/);assert.equal(calls(h,'tools.configurations.execute').length,0);assert.equal(calls(h,'tools.configurations.activate').length,0);h.unmount();
});

test('execute uses the exact reviewed plan, polls actual status and waits for a separate activation action',async()=>{
 const h=toolPackagesHarness();await planned(h);h.click('tool-configuration-execute');h.find(node=>node.props?.['data-testid']==='tool-configuration-execute').props.onClick();await h.flush();assert.equal(calls(h,'tools.configurations.execute').length,1);assert.deepEqual(calls(h,'tools.configurations.execute')[0].data,{configuration_id:'configuration-01',expected_revision:1,plan_sha256:'d'.repeat(64)});assert.equal(h.timers.size,1);assert.equal(calls(h,'tools.configurations.activate').length,0);
 h.data.configuration={...h.data.configuration,status:'tested',revision:3,tests:h.data.configuration.tests.map(test=>({...test,status:'passed'}))};h.tick();await h.flush();assert.match(h.text(node(h,'tool-configuration-result')),/真实配置状态: tested/);assert.equal(h.timers.size,0);assert.equal(calls(h,'tools.configurations.activate').length,0);h.click('tool-configuration-activate');await h.flush();assert.deepEqual(calls(h,'tools.configurations.activate')[0].data,{configuration_id:'configuration-01',expected_revision:3,plan_sha256:'d'.repeat(64)});assert.match(h.text(node(h,'tool-execution-skill')),/Real environment execution instructions/);assert.equal(calls(h,'tools.configurations.bind').length,0);h.unmount();
});

test('cancelled native execution stays planned and unknown attempts never poll or resubmit automatically',async()=>{
 const cancelled=toolPackagesHarness({override:(method,data,standard,state)=>method==='tools.configurations.execute'?{...state.configuration,cancelled:true}:standard(method,data)});await planned(cancelled);cancelled.click('tool-configuration-execute');await cancelled.flush();assert.match(cancelled.text(node(cancelled,'tool-package-notice')),/已取消/);assert.equal(cancelled.timers.size,0);assert.equal(calls(cancelled,'tools.configurations.activate').length,0);cancelled.unmount();
 const record=packageRecord(),configuration={...configurationRecord(record,'unknown'),reason:'Original supervisor receipt unavailable',tests:[{...configurationRecord(record).tests[0],status:'unknown',run_id:'keep-original-run'}]};const h=toolPackagesHarness({configuration});await selected(h);h.change('已登记配置','configuration-01');await h.flush();assert.match(h.text(node(h,'tool-configuration-result')),/keep-original-run/);assert.match(h.text(node(h,'tool-configuration-result')),/状态未知/);assert.equal(node(h,'tool-configuration-execute').props.disabled,true);assert.equal(h.timers.size,0);h.tick();await h.flush();assert.equal(calls(h,'tools.configurations.execute').length,0);h.unmount();
});

test('poll errors pause only observation, preserving original run and requiring a manual status retry',async()=>{
 let fail=false;const h=toolPackagesHarness({override:(method,data,standard)=>method==='tools.configurations.status'&&fail?Promise.reject(Error('service observation unavailable')):standard(method,data)});await planned(h);h.click('tool-configuration-execute');await h.flush();fail=true;h.tick();await h.flush();assert.match(h.text(node(h,'tool-package-error')),/service observation unavailable/);assert.equal(h.timers.size,0);assert.match(h.text(node(h,'tool-configuration-result')),/original-run-01/);fail=false;h.click('重读真实状态');await h.flush();assert.equal(h.timers.size,1);assert.equal(calls(h,'tools.configurations.execute').length,1);h.unmount();assert.equal(h.timers.size,0);
});

test('binding requires an existing conversation and explicit current-provider selection before virtual attachment',async()=>{
 const record=packageRecord();const h=toolPackagesHarness({configuration:configurationRecord(record,'active')});await active(h);assert.equal(node(h,'tool-execution-bind').props.disabled,true);h.change('执行技能服务商','kimi');assert.equal(node(h,'tool-execution-bind').props.disabled,true);h.change('执行技能服务商','codex');h.click('tool-execution-bind');await h.flush();assert.deepEqual(calls(h,'tools.configurations.bind')[0].data,{configuration_id:'configuration-01',providers:['codex']});assert.equal(h.attachments.length,1);assert.equal(h.attachments[0].name,'execution-01');assert.equal(h.attachments[0].path,'studio-execution:execution-01');assert.equal(calls(h,'tools.configurations.grant').length,0);h.unmount();
 const empty=toolPackagesHarness({configuration:configurationRecord(record,'active'),context:{hasConversation:false,owner_key:null}});await active(empty);empty.change('执行技能服务商','codex');assert.equal(node(empty,'tool-execution-bind').props.disabled,true);assert.equal(calls(empty,'tools.configurations.bind').length,0);empty.unmount();
});

test('first binding offers all supported providers without treating an empty authority list as consent',async()=>{
 const record=packageRecord(),h=toolPackagesHarness({configuration:configurationRecord(record,'active'),context:{providers:[]}});await active(h);const select=h.find(node=>node.props?.['aria-label']==='执行技能服务商');assert.equal(select.props.value,'');assert.equal(h.all().filter(node=>node.type==='option'&&['codex','kimi','qwen','deepseek','compatible'].includes(node.props.value)).length,5);assert.equal(node(h,'tool-execution-bind').props.disabled,true);assert.equal(calls(h,'tools.configurations.bind').length,0);h.change('执行技能服务商','codex');h.click('tool-execution-bind');await h.flush();assert.equal(calls(h,'tools.configurations.bind').length,1);assert.equal(h.attachments.length,1);h.unmount();
});

test('bound virtual attachment exactly matches the real read-policy catalog entry and is accepted by selectedSkillContext',async()=>{
 let skill;const record=packageRecord(),h=toolPackagesHarness({configuration:configurationRecord(record,'active'),override:async(method,data,standard)=>{const value=await standard(method,data);if(method==='tools.configurations.read'){skill=value;skill.execution_skill.id='worker-reference/execution:revision 1';skill.execution_skill.sha256=createHash('sha256').update(skill.execution_skill.body).digest('hex');}return value;}});await active(h);h.change('执行技能服务商','codex');h.click('tool-execution-bind');await h.flush();
 const policy=createReadPolicy({schemaVersion:1,revision:'authority-1',state:'active',package:{id:record.package_id,version:record.package_version,manifestSha256:record.manifest_sha256,sourceCommit:record.source_commit},workerBinding:{distribution:'Fixture',root:'/fixture',port:1},target:{kind:'local',projectId:skill.target.project_id,environmentId:skill.target.environment_id,fingerprint:skill.environment_sha256},activation:{id:skill.execution_skill.id,revision:String(skill.revision),configurationId:skill.configuration_id},archivedResources:[],executionSkill:{id:skill.execution_skill.id,text:skill.execution_skill.body,sha256:skill.execution_skill.sha256,resources:[]}}),entry=policy.catalogEntry();assert.equal(h.attachments.length,1);assert.equal(h.attachments[0].name,entry.name);assert.equal(h.attachments[0].path,entry.path);const context=await selectedSkillContext({selection:h.attachments[0],registered:[entry],policy});assert.match(context.text,/Real environment execution instructions/);h.unmount();
});

test('an existing configuration with empty current-provider consent cannot open archived guidance',async()=>{
 const record=packageRecord(),h=toolPackagesHarness({configuration:configurationRecord(record,'active'),context:{configuration_id:'configuration-01',providers:[]}});await active(h);h.change('执行技能服务商','codex');h.resource('delivery');assert.equal(node(h,'tool-guidance-grant').props.disabled,true);assert.equal(calls(h,'tools.configurations.grant').length,0);h.unmount();
});

test('actual per-test failure reasons are shown verbatim and a missing reason stays explicitly unknown',async()=>{
 const record=packageRecord(),configuration=configurationRecord(record,'failed');configuration.tests=[{...configuration.tests[0],status:'failed',run_id:'original-failed-run',reason:'Actual supervisor exit 2'}];const h=toolPackagesHarness({configuration});await selected(h);h.change('已登记配置','configuration-01');await h.flush();assert.match(h.text(node(h,'tool-configuration-result')),/Actual supervisor exit 2/);assert(!h.text(node(h,'tool-configuration-result')).includes('服务未返回具体原因'));h.unmount();
 delete configuration.tests[0].reason;const missing=toolPackagesHarness({configuration});await selected(missing);missing.change('已登记配置','configuration-01');await missing.flush();assert.match(missing.text(node(missing,'tool-configuration-result')),/服务未返回具体原因/);missing.unmount();
});

test('an owner change before the click is rechecked before any binding or grant is dispatched',async()=>{
 const record=packageRecord(),h=toolPackagesHarness({configuration:configurationRecord(record,'active'),context:{configuration_id:'configuration-01',providers:['codex']}});await active(h);h.change('执行技能服务商','codex');h.resource('delivery');h.data.context.owner_key='new-owner-before-click';h.click('tool-execution-bind');await h.flush();assert.equal(calls(h,'tools.configurations.bind').length,0);assert.equal(h.attachments.length,0);assert.match(h.text(node(h,'tool-package-error')),/对话、服务商或计算目标已变化/);assert.equal(node(h,'tool-guidance-grant').props.disabled,true);h.unmount();
});

test('a nonactive activation response stays a real failure and never announces a generated skill',async()=>{
 const record=packageRecord(),h=toolPackagesHarness({configuration:configurationRecord(record,'tested'),override:async(method,data,standard)=>{const value=await standard(method,data);return method==='tools.configurations.activate'?{...value,status:'stale',execution_skill:undefined,reason:'Interpreter fingerprint changed'}:value;}});await selected(h);h.change('已登记配置','configuration-01');await h.flush();h.click('tool-configuration-activate');await h.flush();assert.match(h.text(node(h,'tool-package-error')),/Interpreter fingerprint changed/);assert.match(h.text(node(h,'tool-configuration-result')),/stale/);assert.equal(node(h,'tool-execution-bind').props.disabled,true);assert.equal(h.attachments.length,0);assert.throws(()=>node(h,'tool-package-notice'),/not found/);h.unmount();
});

test('explicit retries of the same project or plan preserve request idempotency after a lost reply',async()=>{
 let fail=true;const h=toolPackagesHarness({override:(method,data,standard)=>method==='tools.configurations.createProject'&&fail?Promise.reject(Error('reply lost')):standard(method,data)});await selected(h);h.click('tool-configuration-start');await h.flush();h.change('工具配置环境','environment-A');h.click('创建检查项目');await h.flush();fail=false;h.click('创建检查项目');await h.flush();assert.equal(calls(h,'tools.configurations.createProject').length,2);assert.equal(calls(h,'tools.configurations.createProject')[0].data.request_id,calls(h,'tools.configurations.createProject')[1].data.request_id);h.click('tool-configuration-plan');await h.flush();h.click('tool-configuration-plan');await h.flush();assert.equal(calls(h,'tools.configurations.plan').length,2);assert.equal(calls(h,'tools.configurations.plan')[0].data.request_id,calls(h,'tools.configurations.plan')[1].data.request_id);assert.equal(calls(h,'tools.configurations.execute').length,0);h.unmount();
});

test('changed owner during binding cannot attach execution guidance to a new conversation',async()=>{
 const pending=deferred(),record=packageRecord();const h=toolPackagesHarness({configuration:configurationRecord(record,'active'),override:(method,data,standard)=>method==='tools.configurations.bind'?pending.promise:standard(method,data)});await active(h);h.change('执行技能服务商','codex');h.click('tool-execution-bind');await h.flush();h.data.context.owner_key='scope-B';pending.resolve({status:'bound',configuration_id:'configuration-01'});await h.flush();assert.equal(h.attachments.length,0);assert.match(h.text(node(h,'tool-package-error')),/对话、服务商或计算目标已变化/);h.unmount();
});

test('repair/update grants only exact selected resources and uses the main-provided delivery attachment',async()=>{
 const record=packageRecord();const h=toolPackagesHarness({configuration:configurationRecord(record,'active'),context:{configuration_id:'configuration-01',providers:['codex']}});await active(h);assert.equal(calls(h,'tools.configurations.grant').length,0);h.change('执行技能服务商','codex');assert.equal(node(h,'tool-guidance-grant').props.disabled,true);h.resource('delivery');h.change('前置指导读取用途','update');h.click('tool-guidance-grant');await h.flush();assert.deepEqual(calls(h,'tools.configurations.grant')[0].data,{configuration_id:'configuration-01',purpose:'update',resource_ids:[record.package_id+':'+record.package_version+':delivery:SKILL.md']});assert.equal(h.attachments[0].path,record.delivery_attachment.path);assert.equal(h.attachments[0].name,record.delivery_attachment.name);assert(!h.attachments[0].path.startsWith(record.package_root));h.unmount();
 const installation=toolPackagesHarness({configuration:configurationRecord(record,'active'),context:{configuration_id:'configuration-01',providers:['codex']}});await active(installation);installation.change('执行技能服务商','codex');installation.resource('installation');installation.click('tool-guidance-grant');await installation.flush();assert.equal(installation.attachments.length,0);assert.match(installation.text(node(installation,'tool-package-notice')),/未附加未授权的交付技能/);installation.unmount();
});

test('changed provider or owner and unmount suppress late grants, attachments and follow-up context reads',async()=>{
 for(const mode of ['provider','owner','unmount']){const pending=deferred(),record=packageRecord(),h=toolPackagesHarness({configuration:configurationRecord(record,'active'),context:{configuration_id:'configuration-01',providers:['codex']},override:(method,data,standard)=>method==='tools.configurations.grant'?pending.promise:standard(method,data)});await active(h);h.change('执行技能服务商','codex');h.resource('delivery');h.click('tool-guidance-grant');await h.flush();if(mode==='provider')h.update({provider:'kimi'});else if(mode==='owner')h.data.context.owner_key='scope-B';else h.unmount();await h.flush();const before=calls(h,'tools.configurations.context').length;pending.resolve({status:'granted',expires_at:Date.now()+600000});await h.flush();assert.equal(h.attachments.length,0);if(mode!=='owner')assert.equal(calls(h,'tools.configurations.context').length,before);if(mode!=='unmount')h.unmount();}
});

test('late old-target plans and mismatched package replies cannot release execution controls',async()=>{
 const pending=deferred(),record=packageRecord(),other=packageRecord('other-reference');const h=toolPackagesHarness({records:[record,other],override:(method,data,standard)=>method==='tools.configurations.plan'?pending.promise:standard(method,data)});await selected(h);h.click('tool-configuration-start');await h.flush();h.change('工具配置环境','environment-A');h.change('工具配置项目','project-A');h.click('tool-configuration-plan');await h.flush();h.change('已登记工具包','other-reference');await h.flush();pending.resolve(configurationRecord(record));await h.flush();assert.throws(()=>node(h,'tool-configuration-result'),/not found/);assert.equal(calls(h,'tools.configurations.execute').length,0);h.unmount();
 const mismatch=toolPackagesHarness({override:(method,data,standard)=>method==='tools.configurations.plan'?configurationRecord(other):standard(method,data)});await planned(mismatch);assert.match(mismatch.text(node(mismatch,'tool-package-error')),/配置响应与所选工具或配置不符/);assert.throws(()=>node(mismatch,'tool-configuration-result'),/not found/);mismatch.unmount();
});
