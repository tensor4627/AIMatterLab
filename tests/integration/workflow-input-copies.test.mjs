import test from 'node:test';
import assert from 'node:assert/strict';
import {copyProjectInputs,copyProjectInputsTool} from '../../backend/main/workspace/copy-project-inputs.mjs';
import {createPrivateCvAccess} from '../../agent/tools/private-cv-access.mjs';
import {dshToolAllowed} from '../../agent/providers/dsh-policy.mjs';
import {assertRendererWorkerRoute,assertWorkerRoute} from '../../contracts/transport-policy.mjs';

const sha='a'.repeat(64),root='/worker/projects/p/inputs',directory=root+'/import-'+sha;
const args={project_id:'p',sources:['/scratch/input/model.xyz','/scratch/input/torsion.pt']};
function fixture(){
 const binding={distribution:'Fixture',root:'/worker',port:8767};
 const task={id:'task',provider:'deepseek',threadId:'thread',projectId:'p',authoring:{projectId:'p',inputRoot:root,workerBinding:binding,pendingInputs:args.sources},parameters:{files:[]}};
 const scope={provider:'deepseek',threadId:'thread',projectId:'p',taskId:'task',inputRoot:root,checkCurrent:()=>true};
 const result={project_id:'p',directory,files:args.sources.map(source=>({source,status:'passed',mode:'copy',name:source.split('/').at(-1),path:directory+'/'+source.split('/').at(-1),size:7,sha256:sha}))};
 const policy={blocked_project_ids:[],blocked_run_ids:[],blocked_paths:[],bindings:[]};
 const worker={identity:binding,connection:{},connectionEpoch:1,connectionTarget:{port:8767},request:async(_m,p)=>structuredClone(p.endsWith('/access')?policy:result)};
 const records={read:()=>structuredClone(task),deleted:()=>false,bound:()=>task,save:value=>Object.assign(task,value)};
 const privacy=createPrivateCvAccess({records,worker,activeTasks:new Map([['deepseek','task']])});
 const copy=()=>copyProjectInputs({worker,current:()=>task},args,scope);
 return {copy,worker,task,result,scope,privacy,policy};
}
test('DeepSeek stages external files, then may read and work on the confirmed copies only',async()=>{
 const f=fixture(),token=await f.privacy.before('copy_project_inputs',args,'deepseek',f.scope);
 await assert.rejects(f.privacy.before('read_project_input',{project_id:'p',name:args.sources[0]},'deepseek'));
 const value=await f.copy();await f.privacy.after(token,{content:[{type:'text',text:JSON.stringify(value)}]});
 assert.deepEqual(f.task.authoring.imports,value.files);assert.deepEqual(f.task.authoring.pendingInputs,[]);
 for(const file of value.files)await f.privacy.before('read_project_input',{project_id:'p',name:file.path},'deepseek');
 await assert.rejects(f.privacy.before('write_project_input',{project_id:'p',name:args.sources[0],content:'new'},'deepseek'));
 assert.equal(copyProjectInputsTool.annotations.readOnlyHint,false);
 assert.equal(dshToolAllowed('copy_project_inputs',true),true);
 assert.doesNotThrow(()=>assertWorkerRoute('POST','/api/studio-workspace/copy-inputs'));
 assert.throws(()=>assertRendererWorkerRoute('POST','/api/studio-workspace/copy-inputs'));
});
test('copy rejects a new resource, a changed destination, and files blocked for this provider',async()=>{
 const f=fixture(),request=f.worker.request;
 f.worker.request=async(...params)=>{const result=await request(...params);f.worker.connectionEpoch++;return result};
 await assert.rejects(f.copy(),/original compute resource/);assert.equal(f.task.authoring.imports,undefined);
 const g=fixture();g.result.files[0].path='/outside/model.xyz';await assert.rejects(g.copy(),/does not match/);
 g.policy.blocked_paths=[args.sources[0]];
 await assert.rejects(g.privacy.before('copy_project_inputs',args,'deepseek',g.scope),/private/);
 await assert.rejects(g.privacy.before('copy_project_inputs',{...args,project_id:'other'},'deepseek',g.scope),/current conversation project/);
});

test('a worker without the copy route explains the update and reports that copying never started',async()=>{
 const f=fixture();f.worker.request=async()=>{throw Error('Unknown route');};
 await assert.rejects(f.copy(),error=>error.operationNotStarted&&error.message.includes('更新作业服务'));
 assert.equal(f.task.authoring.imports,undefined);
 f.worker.request=async()=>{throw Error('Connection lost while waiting');};
 await assert.rejects(f.copy(),error=>!error.operationNotStarted&&error.message.includes('Connection lost'));
});
