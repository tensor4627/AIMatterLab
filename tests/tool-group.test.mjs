import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Catalog} from '../desktop/catalog.mjs';
import {compileToolGroup} from '../contracts/tools/tool-group.mjs';
import {createToolGroupRecords} from '../backend/main/tools/groups.mjs';
import {validateToolPackage,validateToolPorts,toolParameterValues,portableResourcePath} from '../contracts/tools/tool-package.mjs';
import {toolDefinition,groupDefinition,packageVersion,port} from './helpers/tool-definitions.mjs';

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
