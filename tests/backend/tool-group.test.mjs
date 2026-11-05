import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {Catalog} from "../../backend/main/workspace/catalog.mjs";
import {compileToolGroup,toolGroupIdentityText} from "../../contracts/tools/tool-group.mjs";
import {createToolGroupRecords} from "../../backend/main/tools/groups.mjs";
import {validateToolPackage,validateToolPorts,toolParameterValues,portableResourcePath} from "../../contracts/tools/tool-package.mjs";
import {toolDefinition,groupDefinition,packageVersion,port} from "../helpers/tool-definitions.mjs";

function compile(group=groupDefinition(),manifest=toolDefinition(),version=packageVersion){return compileToolGroup(group,identity=>{assert.deepEqual(identity,{id:'data-tool',version:packageVersion});return {manifest,version};});}

test('portable declarations retain explicit defaults, display priority and function/test coverage',()=>{
 const source=toolDefinition(),before=structuredClone(source),manifest=validateToolPackage(source);
 assert.deepEqual(source,before);assert.equal(manifest.guidance.delivery,'SKILL.md');assert.deepEqual(manifest.environment.parallelism,{supported:['serial'],threads:1,processes:1,gpus:0});
 assert.equal(manifest.functions[0].parameters[0].display.priority,90);assert.equal(manifest.functions[0].operation.working_directory,'{workdir}');
 assert.deepEqual(toolParameterValues(manifest.functions[0].parameters),{count:1});assert.deepEqual(toolParameterValues(manifest.functions[0].parameters,{count:5}),{count:5});
 for(const values of [{count:'1'},{count:null},{unknown:1}])assert.throws(()=>toolParameterValues(manifest.functions[0].parameters,values));
 const optional=port('optional','json',false);assert.equal(validateToolPorts([optional])[0].default,null);delete optional.default_source;assert.throws(()=>validateToolPorts([optional]),/default_source/);
});

test('a group resolves exact versions and orders a connected input-to-product graph without running it',()=>{
 const definition=groupDefinition(),before=structuredClone(definition),result=compile(definition);
 assert.deepEqual(definition,before);assert.deepEqual(result.execution_order,['first','second']);assert.deepEqual(result.steps.map(step=>step.parameters),[{count:1},{count:2}]);
 assert.deepEqual(result.steps[1].depends_on,['first']);assert.deepEqual(result.steps[0].inputs.source,{kind:'input',input_id:'initial'});assert.deepEqual(result.steps[1].inputs.source,{kind:'output',step_id:'first',port_id:'result'});
 assert.equal(result.outputs[0].format,'json');assert.equal(result.outputs[0].required,true);assert.equal(result.status,'definition_checked');assert.equal(result.execution_status,'not_run');
 assert.throws(()=>compile(definition,toolDefinition(),'c'.repeat(64)),/exact package version/);
});

for(const [label,change,pattern]of [
 ['format',g=>{g.inputs[0].format='xyz';},/format/],
 ['type',g=>{g.inputs[0].type='directory';},/type/],
 ['missing input',g=>{g.steps[1].inputs={};},/unbound/],
 ['unknown input',g=>{g.steps[1].inputs.extra={input_id:'initial'};},/unknown function input/],
 ['literal file',g=>{g.steps[1].inputs.source={value:'/private/fixture.json'};},/managed initial input/],
 ['ambiguous input',g=>{g.steps[1].inputs.source={input_id:'initial',step_id:'second',port_id:'result'};},/invalid fields/],
 ['unknown output',g=>{g.outputs[0].port_id='missing';},/unknown final output/],
 ['unused initial',g=>{g.inputs.push(port('unused'));},/initial input/],
 ['disconnected step',g=>{g.steps.push({...structuredClone(g.steps[1]),id:'unused'});},/does not lead/],
 ['cycle',g=>{g.steps[1].inputs.source={step_id:'second',port_id:'result'};},/cyclic/],
 ['self dependency',g=>{g.steps[1].depends_on=['first'];},/self dependency/],
 ['unknown dependency',g=>{g.steps[1].depends_on=['missing'];},/unknown or self/],
 ['duplicate step',g=>{g.steps.push(structuredClone(g.steps[0]));},/duplicate step/],
 ['duplicate final',g=>{g.outputs.push(structuredClone(g.outputs[0]));},/duplicate identifier/],
 ['caller execution',g=>{g.status='passed';},/invalid fields/],
 ['invalid parameter',g=>{g.steps[0].parameters.count='two';},/wrong type/],
])test('workflow rejects '+label+' before exposing an executable plan',()=>{const g=groupDefinition();change(g);assert.throws(()=>compile(g),pattern);});

test('optional inputs and products cannot silently promise required downstream resources',()=>{
 const g=groupDefinition();g.inputs[0]=port('initial','json',false);assert.throws(()=>compile(g),/optional/);
 const manifest=toolDefinition();manifest.functions[0].outputs[0]=port('result','json',false);assert.throws(()=>compile(groupDefinition(),manifest),/optional/);
 const isolated=groupDefinition();isolated.steps=[isolated.steps[1]];isolated.outputs=[{id:'final',step_id:'first',port_id:'result',required:false}];const result=compile(isolated,manifest);assert.equal(result.outputs[0].required,false);
 manifest.functions[0].inputs[0]=port('source','json',false);const optional=groupDefinition();optional.inputs=[];optional.steps=[{...optional.steps[1],inputs:{}}];optional.outputs=[{id:'final',step_id:'first',port_id:'result',required:false}];assert.deepEqual(compile(optional,manifest).steps[0].inputs.source,{kind:'default',value:null,behavior:'No file is emitted when disabled'});
});

test('declarations reject absent test coverage, implicit defaults, controls, escaping paths and non-JSON values',()=>{
 for(const change of [m=>{m.functions[0].tests=['unknown'];},m=>{m.tests.cases[0].function_id='unknown';},m=>{delete m.functions[0].parameters[0].default;},m=>{m.functions[0].operation.command=['python\nother'];},m=>{m.tests.cases[0].instructions='outside.md';},m=>{m.functions[0].parameters[0].default=NaN;}]){const manifest=toolDefinition();change(manifest);assert.throws(()=>validateToolPackage(manifest));}
 for(const value of ['../escape','/absolute','C:/private','a\\b','a/.git/HEAD','a/./b','a//b','a\0b'])assert.throws(()=>portableResourcePath(value));
 const g=groupDefinition();g.inputs[0].display.reason=new Date();assert.throws(()=>compile(g),/finite JSON/);
});

test('group records persist only compiled declarations and enforce optimistic revisions without changing runs or authorization',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-group-records-'));let catalog=new Catalog(root);t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});
 catalog.put('run','existing',{id:'existing',status:'unknown'});catalog.put('project','protected',{id:'protected',policy:{engines:['existing']}});
 const packages={read:request=>{assert.deepEqual(request,{package_id:'data-tool',package_version:packageVersion});return {package_version:packageVersion,manifest:toolDefinition()};}};
 let records=createToolGroupRecords({catalog,packages,now:()=>10}),definition=groupDefinition();
 assert.equal(records.compile({definition}).execution_status,'not_run');assert.deepEqual(records.list(),[]);
 const saved=records.save({definition,expected_revision:0});assert.equal(saved.revision,1);assert.equal(saved.execution_status,'not_run');assert.equal(records.save({definition,expected_revision:1}).revision,1);
 definition.name='Revised';assert.throws(()=>records.save({definition,expected_revision:0}),/changed/);assert.equal(records.read({id:'data-flow'}).name,'Two stage data flow');
 assert.equal(records.save({definition,expected_revision:1}).revision,2);catalog.db.close();catalog=new Catalog(root);records=createToolGroupRecords({catalog,packages,now:()=>20});
 assert.equal(records.list()[0].revision,2);const read=records.read({id:'data-flow'});read.definition.name='caller edit';assert.equal(records.read({id:'data-flow'}).definition.name,'Revised');
 assert.deepEqual(catalog.get('run','existing'),{id:'existing',status:'unknown'});assert.deepEqual(catalog.get('project','protected').policy,{engines:['existing']});
 assert.throws(()=>records.save({definition,expected_revision:2,passed:true}),/Exact typed/);assert.throws(()=>records.read({id:'missing'}),/Unknown/);
});

const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
function recordsFixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-frozen-groups-'));let catalog=new Catalog(root),calls=0,time=10,enabled=true;
 t.after(()=>{catalog.db.close();const relative=path.relative(os.tmpdir(),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(root,{recursive:true,force:true});});
 const packages={read:({package_id,package_version})=>{calls++;if(!enabled)throw Error('Package metadata must not be reloaded during frozen reads');assert.equal(package_id,'data-tool');assert.equal(package_version,packageVersion);return {package_version:packageVersion,manifest:toolDefinition()};}};
 let records=createToolGroupRecords({catalog,packages,now:()=>time});return {root,get catalog(){return catalog;},get records(){return records;},get calls(){return calls;},set time(value){time=value;},disablePackageReads(){enabled=false;},reopen(){catalog.db.close();catalog=new Catalog(root);records=createToolGroupRecords({catalog,packages,now:()=>time});}};
}

test('frozen group identity binds exact UTF8 JSON text while compiler output remains only definition_checked',t=>{
 const h=recordsFixture(t),definition=groupDefinition();definition.name='Unicode 组 😀';const text=JSON.stringify(definition),expected=sha('studio.tool-group/1\0'+text);assert.equal(toolGroupIdentityText(text),'studio.tool-group/1\0'+text);assert.throws(()=>toolGroupIdentityText('raw \ud800'),/UTF-8/);
 const saved=h.records.save({definition,expected_revision:0});assert.equal(saved.version,expected);assert.equal(saved.has_frozen_version,true);assert.equal(saved.definition_text,text);assert.equal(saved.execution_status,'not_run');const recordId=sha(definition.id+'\0'+expected),frozen=h.catalog.get('tool-group-version',recordId);
 assert.deepEqual(frozen,{schema_version:1,id:recordId,group_id:definition.id,group_version:expected,definition_text:text,definition,compiled:compile(definition),created_at:10});assert.equal(h.records.list()[0].version,expected);assert.equal(h.records.list()[0].has_frozen_version,true);
});

test('edits preserve independent old versions through restart and frozen reads never reload package/source facts',t=>{
 const h=recordsFixture(t),definition=groupDefinition(),first=h.records.save({definition,expected_revision:0}),id=sha(first.id+'\0'+first.version),frozenBefore=h.catalog.get('tool-group-version',id);h.time=20;definition.name='Second frozen version';const second=h.records.save({definition,expected_revision:1});assert.equal(second.revision,2);assert.notEqual(first.version,second.version);assert.equal(second.created_at,10);assert.equal(h.catalog.list('tool-group-version').length,2);
 const historical=h.records.read({id:first.id,version:first.version});assert.equal(historical.definition.name,'Two stage data flow');assert.equal(historical.name,'Two stage data flow');assert.equal(historical.revision,2);assert.equal(historical.version,first.version);assert.equal(historical.created_at,10);historical.definition.name='caller mutation';historical.compiled.steps[0].parameters.count=999;assert.deepEqual(h.catalog.get('tool-group-version',id),frozenBefore);assert.equal(h.records.read({id:first.id}).name,'Second frozen version');
 h.disablePackageReads();const calls=h.calls;h.reopen();assert.equal(h.records.read({id:first.id,version:first.version}).definition_text,first.definition_text);assert.equal(h.records.read({id:first.id}).version,second.version);assert.equal(h.records.list()[0].revision,2);assert.equal(h.calls,calls);
});

test('legacy latest-only reads do not invent history; explicit same-compiled save creates a real frozen fact and advances revision',t=>{
 const h=recordsFixture(t),definition=groupDefinition(),compiled=compile(definition),legacy={schema_version:1,id:definition.id,name:compiled.name,revision:4,definition,compiled,created_at:1,updated_at:2,status:'definition_checked',execution_status:'not_run'};h.catalog.put('tool-group',definition.id,legacy);const before=h.catalog.get('tool-group',definition.id),version=sha(toolGroupIdentityText(JSON.stringify(definition)));
 const read=h.records.read({id:definition.id});assert.equal(read.version,null);assert.equal(read.has_frozen_version,false);assert.equal(read.definition_text,null);assert.equal(h.records.list()[0].has_frozen_version,false);assert.equal(h.catalog.list('tool-group-version').length,0);assert.deepEqual(h.catalog.get('tool-group',definition.id),before);assert.throws(()=>h.records.read({id:definition.id,version}),/Unknown frozen/);
 h.time=30;const frozen=h.records.save({definition,expected_revision:4});assert.equal(frozen.revision,5);assert.equal(frozen.version,version);assert.equal(frozen.has_frozen_version,true);assert.equal(frozen.created_at,1);assert.equal(h.catalog.list('tool-group-version').length,1);assert.equal(h.records.read({id:definition.id,version}).created_at,30);h.time=40;assert.equal(h.records.save({definition,expected_revision:5}).revision,5);assert.equal(h.records.read({id:definition.id}).updated_at,30);
});

test('exact definition changes freeze new versions even if compilation is identical; returning to an old version never overwrites it',t=>{
 const h=recordsFixture(t),definition=groupDefinition(),first=h.records.save({definition,expected_revision:0}),oldId=sha(first.id+'\0'+first.version),oldSnapshot=h.catalog.get('tool-group-version',oldId);definition.steps[1].parameters={count:1};assert.deepEqual(compile(definition),first.compiled);h.time=20;const second=h.records.save({definition,expected_revision:1});assert.equal(second.revision,2);assert.notEqual(second.version,first.version);
 const reversed=Object.fromEntries(Object.entries(definition).reverse());assert.deepEqual(compile(reversed),second.compiled);const third=h.records.save({definition:reversed,expected_revision:2});assert.equal(third.revision,3);assert.notEqual(third.version,second.version);const back=h.records.save({definition:groupDefinition(),expected_revision:3});assert.equal(back.revision,4);assert.equal(back.version,first.version);assert.equal(h.catalog.list('tool-group-version').length,3);assert.deepEqual(h.catalog.get('tool-group-version',oldId),oldSnapshot);
});

test('version and latest writes roll back atomically, stale revisions cannot allocate versions, and original project/run facts stay intact',t=>{
 const h=recordsFixture(t),definition=groupDefinition(),run={id:'real-run',status:'unknown',directory:'/owned/existing-run'},project={id:'protected',policy:{engines:['existing'],environments:['existing']}};h.catalog.put('run',run.id,run);h.catalog.put('project',project.id,project);const put=h.catalog.put.bind(h.catalog);h.catalog.put=(kind,...args)=>{if(kind==='tool-group')throw Error('Injected latest write failure');return put(kind,...args);};assert.throws(()=>h.records.save({definition,expected_revision:0}),/Injected/);assert.equal(h.catalog.list('tool-group-version').length,0);assert.equal(h.catalog.list('tool-group').length,0);h.catalog.put=put;
 const first=h.records.save({definition,expected_revision:0});definition.name='Winner';h.records.save({definition,expected_revision:1});definition.name='Stale contender';assert.throws(()=>h.records.save({definition,expected_revision:first.revision}),/changed/);assert.equal(h.catalog.list('tool-group-version').length,2);assert.equal(h.records.read({id:first.id}).name,'Winner');assert.deepEqual(h.catalog.get('run',run.id),run);assert.deepEqual(h.catalog.get('project',project.id),project);
});

test('missing versions, malformed requests and tampered text/hash/record identity fail closed without rewriting facts',t=>{
 const h=recordsFixture(t),saved=h.records.save({definition:groupDefinition(),expected_revision:0}),id=sha(saved.id+'\0'+saved.version),original=h.catalog.get('tool-group-version',id);
 for(const change of [record=>{record.definition_text+=' ';},record=>{record.definition.name='tampered';},record=>{record.group_version='c'.repeat(64);},record=>{record.group_id='other';},record=>{record.id='d'.repeat(64);},record=>{record.compiled.execution_status='passed';}]){const corrupt=structuredClone(original);change(corrupt);h.catalog.put('tool-group-version',id,corrupt);assert.throws(()=>h.records.read({id:saved.id,version:saved.version}),/Frozen tool group version identity changed/);assert.deepEqual(h.catalog.get('tool-group-version',id),corrupt);h.catalog.put('tool-group-version',id,original);}
 for(const version of [undefined,null,'bad','A'.repeat(64)])assert.throws(()=>h.records.read({id:saved.id,version}),/Invalid tool group version/);assert.throws(()=>h.records.read({id:saved.id,version:'c'.repeat(64)}),/Unknown frozen/);assert.throws(()=>h.records.read({id:saved.id,version:saved.version,passed:true}),/Exact typed/);
 h.catalog.remove('tool-group-version',id);assert.throws(()=>h.records.read({id:saved.id}),/Unknown frozen/);assert.throws(()=>h.records.list(),/Unknown frozen/);assert.throws(()=>h.records.save({definition:groupDefinition(),expected_revision:1}),/Unknown frozen/);assert.equal(h.catalog.list('tool-group-version').length,0);assert.equal(h.catalog.get('tool-group',saved.id).revision,1);
});

test('the actual frontend group client keeps legacy reads and forwards an exact optional version',async()=>{
 const source=fs.readFileSync(new URL("../../frontend/api/tools.ts",import.meta.url),'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,calls=[],module={exports:{}};new Function('require','module','exports',compiled)(name=>{assert.equal(name,'./studio');return {invoke:async(method,value)=>{calls.push({method,value});return {};}};},module,module.exports);
 await module.exports.toolGroups.read('data-flow');await module.exports.toolGroups.read('data-flow','a'.repeat(64));assert.deepEqual(calls,[{method:'tools.groups.read',value:{id:'data-flow'}},{method:'tools.groups.read',value:{id:'data-flow',version:'a'.repeat(64)}}]);
});
