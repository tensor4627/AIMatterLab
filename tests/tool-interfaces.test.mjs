import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import {registerToolDefinitionRoutes} from '../backend/main/tools/routes.mjs';
import {registerToolConfigurationRoutes} from '../backend/main/compute/tool-configurations.mjs';
import {registerToolWorkflowRoutes} from '../backend/main/workspace/tool-workflows.mjs';
import {assertRendererWorkerRoute,assertWorkerRoute} from '../desktop/security.mjs';
import {SCIENTIFIC_TOOL_ACCESS} from '../desktop/private-cv-access.mjs';

const packageMethods=['choose','inspect','register','update','relocate','read','list'],groupMethods=['compile','save','read','list'],configurationMethods=['context','list','createProject','plan','execute','status','activate','read','bind','grant'];
const workflowMethods=['context','list','locateRun','create','retryCreate','prepareStep','executeStep','status','read'];
const names=[...packageMethods.map(value=>'tools.packages.'+value),...groupMethods.map(value=>'tools.groups.'+value),...configurationMethods.map(value=>'tools.configurations.'+value),...workflowMethods.map(value=>'tools.workflows.'+value)];
function routes(){
 const source=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8'),ast=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),declarations=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&['handle','trusted'].includes(node.name?.text)).map(node=>node.getText(ast)),registrations=[];
 function visit(node){if(ts.isCallExpression(node)&&['registerToolDefinitionRoutes','registerToolConfigurationRoutes','registerToolWorkflowRoutes'].includes(node.expression.getText(ast)))registrations.push(node.getText(ast));ts.forEachChild(node,visit);}visit(ast);assert.equal(declarations.length,2);assert.equal(registrations.length,3);
 const handlers=new Map(),calls=[],reply={observed:'controlled-domain-result'},record={snapshot_root:path.resolve('.studio/managed-package'),delivery_skill:{name:'actual-delivery',path:'SKILL.md'}},object=methods=>Object.fromEntries(methods.map(name=>[name,(value,event)=>{calls.push({name,value,event});return name==='register'?record:reply;}]));
 const context={registerToolDefinitionRoutes,registerToolConfigurationRoutes,registerToolWorkflowRoutes,toolPackages:object(packageMethods.filter(method=>method!=='choose')),toolGroups:object(groupMethods),toolConfigurations:object(configurationMethods),toolWorkflows:object(workflowMethods),ipcMain:{handle:(name,fn)=>{assert(!handlers.has(name));handlers.set(name,fn);}},window:{isDestroyed:()=>false,webContents:{id:9,isDestroyed:()=>false,getURL:()=>'file:///studio/index.html'}},shuttingDown:false,dialog:{showOpenDialog:async()=>{calls.push({name:'dialog'});return {canceled:false,filePaths:['/explicit/tool-package']};}}};
 vm.runInNewContext(declarations.join('\n')+'\n'+registrations.join(';\n'),context);
 return {context,calls,handlers,reply,record,invoke:(name,value,changes={})=>{const event={sender:{id:9,isDestroyed:()=>false},senderFrame:{parent:null,url:'file:///studio/index.html'},...changes};return handlers.get('studio:'+name)(event,value);}};
}

test('actual main wires typed package, configuration and workflow actions through the trusted sender boundary',async()=>{
 const f=routes();assert.deepEqual([...f.handlers.keys()].sort(),names.map(name=>'studio:'+name).sort());
 for(const name of names){for(const changes of [{sender:{id:10,isDestroyed:()=>false}},{senderFrame:{parent:{},url:'file:///studio/index.html'}},{senderFrame:{parent:null,url:'https://foreign.invalid/'}}])await assert.rejects(f.invoke(name,{marker:'refused'},changes),/Untrusted IPC sender/);}
 assert.equal(f.calls.length,0);const value={configuration_id:'actual-id'};assert.equal(await f.invoke('tools.configurations.execute',value),f.reply);assert.equal(f.calls[0].value,value);assert.equal(f.calls[0].event.sender.id,9);
 f.context.shuttingDown=true;assert.equal(await f.invoke('tools.configurations.execute',value),null);assert.equal(f.calls.length,1);
});

test('actual tool package routes return main-computed delivery attachments and cancel directory selection without guessed paths',async()=>{
 const f=routes(),selected=await f.invoke('tools.packages.choose',{});assert.equal(selected.package_root,'/explicit/tool-package');const registered=await f.invoke('tools.packages.register',{package_root:selected.package_root});assert.deepEqual(registered.delivery_attachment,{name:'actual-delivery',path:path.join(f.record.snapshot_root,'SKILL.md')});
 f.context.dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});assert.equal((await f.invoke('tools.packages.choose',{})).package_root,null);await assert.rejects(f.invoke('tools.packages.choose',{arbitrary:true}),/Empty typed/);
 const count=f.calls.length;assert.equal(await f.invoke('tools.packages.register',{}, {sender:{id:9,isDestroyed:()=>true}}),null);assert.equal(f.calls.length,count);
});

test('actual preload exposes only declared tool actions and does not add execute/install wildcard methods',async()=>{
 let bridge;const calls=[];vm.runInNewContext(fs.readFileSync(new URL('../desktop/preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{bridge=value;}},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return args[1];},on(){},removeListener(){}}})});
 for(const name of names){const payload={marker:name};assert.equal(await bridge.invoke(name,payload),payload);assert.equal(calls.at(-1)[0],'studio:'+name);}
 for(const name of ['tools.packages.delete','tools.packages.execute','tools.groups.execute','tools.configurations.force','tools.configurations.install','tools.configurations.authorize'])await assert.rejects(bridge.invoke(name,{}),/Unsupported/);
 assert.equal(calls.length,names.length);
});

test('configuration HTTP endpoints remain internal and absent from generic renderer and model authorization surfaces',()=>{
 for(const target of ['/api/tool-package/register','/api/tool-configuration/project/create','/api/tool-configuration/plan','/api/tool-configuration/execute','/api/tool-configuration/status','/api/tool-configuration/activate','/api/tool-execution-skill/read','/api/tool-guidance/state']){
  assert.doesNotThrow(()=>assertWorkerRoute('POST',target));assert.throws(()=>assertRendererWorkerRoute('POST',target),/typed human/);assert.throws(()=>assertRendererWorkerRoute('POST',target+'?scope=admin'),/typed human/);
 }
 for(const name of names)assert.equal(Object.hasOwn(SCIENTIFIC_TOOL_ACCESS,name),false);assert.throws(()=>assertWorkerRoute('POST','/api/tool-configuration/force'),/Unsupported/);
 for(const route of ['/api/workflow/tool-group/create','/api/workflow/prepare-step','/api/workflow/execute-step','/api/workflow/status','/api/workflow/read']){assert.doesNotThrow(()=>assertWorkerRoute('POST',route));assert.throws(()=>assertRendererWorkerRoute('POST',route),/typed human/);assert.throws(()=>assertRendererWorkerRoute('POST',route+'?force=true'),/typed human/);}
});
