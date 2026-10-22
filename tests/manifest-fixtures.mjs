import {createHash} from 'node:crypto';
import {scientificSpec,inputControlParameters} from '../shared/deployment.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function fixture(){
 const root='/project/inputs',names=['model.xyz','nep.txt','wtmetad.pt','bias.definition.json','validation-history.txt','GAScfg.yaml','run.in'];
 const data=Object.fromEntries(names.map(name=>[name,'Synthetic unit-test bytes for '+name+'\n']));
 const doc={schema:'public-bias-definition/1',scope:'Single artifact source provenance, no runtime claim',artifact:{file:'wtmetad.pt',sha256:hash(data['wtmetad.pt'])},cv:{indices:[0,1],unit:'Angstrom',size:1},parameters:{sigma:0.1,height:0.001}};
 data['bias.definition.json']=JSON.stringify(doc,null,2)+'\n';
 const inputs=Object.fromEntries(names.map(name=>[name,root+'/'+name]));const snapshots=names.map(name=>({name,source:inputs[name],sha256:hash(data[name]),size:Buffer.byteLength(data[name])}));
 const parameters={engine:'gpumd.sampling',files:Object.values(inputs),bias:{file:inputs['wtmetad.pt'],artifact_format:'torchscript'},dynamics:{steps:12,time_step_fs:0.1},sampling:{mode:'wtmetad',walkers:1},bias_file:'wtmetad.pt',structure_file:'model.xyz',cv_size:1,cutoff:3,mode:'wtmetad',kernel_capacity:32,validation_history:'validation-history.txt'};
 const task={id:'task-fixture',projectId:'project-fixture',name:'Synthetic WT input review',workflowVersion:2,parameterRevision:2,parameters,review:{status:'ready',parameterRevision:2},manualEdits:{'dynamics.steps':1},manualInputs:{},artifacts:[{id:'prior-fixture',kind:'run',engine:'gpumd.sampling',preparedRevision:1}],deployment:{revision:1,config:{target:'local',projectId:'project-fixture',targetId:'environment-fixture',inputSource:'local',maxSeconds:60,directoryName:'unit-draft',resources:{cpus:1,gpus:0,memory_mb:1024},gpu:0}}};
 const current=scientificSpec(task).parameters,old=structuredClone(current);old.manifest_file='bias.definition.json';old.bias.manifest_file=inputs['bias.definition.json'];
 const prior={id:'prior-fixture',engine:'gpumd.sampling',project_id:'project-fixture',environment_id:'environment-fixture',status:'draft',identity:null,inputs:structuredClone(inputs),snapshots:structuredClone(snapshots),parameters:structuredClone(old),validation:{status:'failed',message:'Selected serialized bias does not match its manifest path and SHA256'}};
 const next={...structuredClone(prior),id:'new-fixture',parameters:structuredClone(current),validation:{status:'not_run'}};
 task.inputBinding={contractVersion:2,artifactId:prior.id,parameters:old,hashes:snapshots.map(({name,sha256})=>({name,sha256})).sort((a,b)=>a.name.localeCompare(b.name)),parameterRevision:1,semanticStatus:'not_run'};
 const text=data['bias.definition.json'];return {task,prior,next,parameters:current,readResult:{name:'bias.definition.json',size:Buffer.byteLength(text),sha256:hash(text),editable:true,text},readCalls:[],controlParameters:inputControlParameters};
}
export async function invoke(helper,f){return helper(f.task,f.prior,f.next,f.parameters,async(id,name)=>{f.readCalls.push({id,name});if(f.readError)throw Error('Synthetic immutable reader unavailable');return structuredClone(f.readResult);},f.controlParameters);}
export function definition(f,value){const text=typeof value==='string'?value:JSON.stringify(value);f.readResult={name:'bias.definition.json',size:Buffer.byteLength(text),sha256:hash(text),editable:true,text};for(const run of [f.prior,f.next]){const snapshot=run.snapshots.find(s=>s.name==='bias.definition.json');snapshot.size=f.readResult.size;snapshot.sha256=f.readResult.sha256;}f.task.inputBinding.hashes=f.prior.snapshots.map(({name,sha256})=>({name,sha256})).sort((a,b)=>a.name.localeCompare(b.name));return f;}
