import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../..',import.meta.url));
function check(source){
 const filename=path.join(root,'tests/contracts/__typed_ipc_fixture__.ts');
 const options={strict:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler};
 const host=ts.createCompilerHost(options),original=host.getSourceFile.bind(host);
 host.getSourceFile=(file,...rest)=>path.resolve(file)===filename?ts.createSourceFile(file,source,ts.ScriptTarget.ES2022,true):original(file,...rest);
 const program=ts.createProgram([filename],options,host);
 return ts.getPreEmitDiagnostics(program).map(value=>({code:value.code,text:ts.flattenDiagnosticMessageText(value.messageText,' ')}));
}
const imports=`import type {TypedInvoke} from '../../contracts/dto/ipc';\nimport type {Run,ClusterRun} from '../../contracts/dto/runs';\ndeclare const call:TypedInvoke;\n`;

test('critical IPC requests and returned values are tied to the selected method',()=>{
 assert.deepEqual(check(imports+`
 const run:Run|ClusterRun=await call('task.execute',{taskId:'task',artifactId:'run',inputReceipt:'snapshot'});
 const input=await call('task.input.read',{taskId:'task',path:'inputs/run.py'});
 const hash:string=input.sha256;
 await call('task.edit',{id:'task',changes:{temperature:300}});
 await call('compute.resource.clear',{selectionId:'current-selection'});
 `),[]);
 const diagnostics=check(imports+`
 await call('task.execute',{taskId:'task'});
 await call('task.edti',{id:'task',changes:{}});
 await call('task.input.read',{taskId:'task',path:42});
 await call('task.execute',{taskId:'task',artifactId:'run',authorize:true});
 await call('compute.resource.clear',{profileId:'not-a-selection'});
 const run=await call('task.execute',{taskId:'task',artifactId:'run'});
 const fake:string=run.fabricatedProperty;
 `);
 assert.equal(diagnostics.length,6,JSON.stringify(diagnostics));
 assert(diagnostics.some(value=>value.text.includes('artifactId')));
 assert(diagnostics.some(value=>value.text.includes('fabricatedProperty')));
});

function api(file,calls){
 const module={exports:{}};
 const javascript=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(javascript,{module,exports:module.exports,require:name=>{
  assert.equal(name,'./studio');return {invoke:async(method,data)=>{calls.push({method,data});return {method,data};}};
 }});
 return module.exports;
}
test('typed authoring wrappers preserve exact owner, revision and input receipt on the existing bridge',async()=>{
 const calls=[],{taskApi}=api('frontend/api/task-client.ts',calls),{deploymentApi}=api('frontend/api/deployment-client.ts',calls);
 const execute={taskId:'original-task',artifactId:'existing-run',inputReceipt:'original-input-hash'};
 await taskApi.execute(execute);
 await taskApi.edit({id:'original-task',changes:{temperature:325}});
 await deploymentApi.prepare('original-task');
 await deploymentApi.save({taskId:'original-task',value:{target:'local'},expectedDraftRevision:4});
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
  {method:'task.execute',data:execute},
  {method:'task.edit',data:{id:'original-task',changes:{temperature:325}}},
  {method:'task.deployment.prepare',data:{taskId:'original-task'}},
  {method:'task.deployment.save',data:{taskId:'original-task',value:{target:'local'},expectedDraftRevision:4}},
 ]);
});
