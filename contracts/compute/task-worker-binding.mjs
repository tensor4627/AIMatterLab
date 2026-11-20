export function taskWorkerSource(task){for(const source of ['deployment','deploymentDraft','workspace','authoring'])if(task?.[source]?.workerBinding)return {source,binding:task[source].workerBinding};return null;}
export function unboundWorkflow(task){return task?.workflowVersion===2&&!task.projectId&&!task.authoring&&!task.workspace&&!task.deployment&&!task.deploymentDraft&&!task.execution&&!(task.artifacts||[]).length;}
const text=(value,max=4096)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\r\n\0]/.test(value);
function sshIdentity(value){const host=value?.hostIdentity;if(value?.kind!=='ssh'||!text(value.profileId,200)||!Number.isSafeInteger(value.profileVersion)||value.profileVersion<1||!host||!text(host.hostname,255)||!Number.isSafeInteger(host.uid)||host.uid<0||!text(host.machineId,256)||!text(value.root)||!value.root.startsWith('/')||!text(value.runtime)||!value.runtime.startsWith('/')||!text(value.runtimeId,128))return null;return {kind:'ssh',version:2,profileId:value.profileId,profileVersion:value.profileVersion,hostIdentity:{hostname:host.hostname,uid:host.uid,machineId:host.machineId},root:value.root,runtime:value.runtime,runtimeId:value.runtimeId};}
export const isSshWorkerBinding=value=>value?.version===2&&!!sshIdentity(value);
export function stableSshWorkerBinding(value){const binding=sshIdentity(value);if(!binding)throw Error('SSH 作业服务来源尚未核验。');return binding;}
// Read-only receipt observation can survive a runtime update in the same saved SSH data directory.
export function sameSshWorkerData(left,right){
 return isSshWorkerBinding(left)&&isSshWorkerBinding(right)&&['profileId','profileVersion','root'].every(key=>left[key]===right[key])&&
  ['hostname','uid','machineId'].every(key=>left.hostIdentity[key]===right.hostIdentity[key]);
}

export function validTaskWorkerSource(source){const value=source?.binding;if(value?.kind==='ssh')return isSshWorkerBinding(value);return !!value&&(!value.kind||value.kind==='wsl')&&typeof value.distribution==='string'&&!!value.distribution&&typeof value.root==='string'&&value.root.startsWith('/')&&!/[\r\n\0]/.test(value.root)&&(source.source!=='authoring'||Number.isInteger(value.port)&&value.port>=1024&&value.port<=65535);}

export function actualAuthoringWorker(worker){const value=worker.identity?.kind==='ssh'?stableSshWorkerBinding(worker.identity):{...worker.identity,port:worker.connectionTarget?.port};if(!worker.connection||worker.connecting||worker.restoring||!validTaskWorkerSource({source:'authoring',binding:value})||worker.connection.health?.root!==value.root)throw Error('请先核对当前流程的实际作业服务连接。');if(value.kind==='ssh'&&(worker.connection.health?.ssh_service!==true||['hostname','uid','machineId'].some(key=>worker.connection.health.hostIdentity?.[key]!==value.hostIdentity[key])||worker.connection.health.runtime!==value.runtime))throw Error('SSH 作业服务身份尚未核验。');return value;}

export function sameWorkerBinding(binding,worker){if(binding?.kind==='ssh'||worker.identity?.kind==='ssh'){try{return !!worker.connection&&isSshWorkerBinding(binding)&&JSON.stringify(stableSshWorkerBinding(binding))===JSON.stringify(actualAuthoringWorker(worker));}catch{return false;}}return !!worker.connection&&binding?.distribution===worker.identity?.distribution&&binding?.root===worker.identity?.root&&(binding.port===undefined||binding.port===worker.connectionTarget?.port);}

export function assertTaskWorker(task,worker){const source=taskWorkerSource(task);if(source&&(!validTaskWorkerSource(source)||!sameWorkerBinding(source.binding,worker)))throw Error('当前作业服务与此流程来源不同，请恢复原服务；不能自动替换来源。');}

export function taskWorkerSettings(task,settings){const source=taskWorkerSource(task);if(!source)return null;if(!validTaskWorkerSource(source))throw Error('此流程保存的作业服务来源尚待核对。');if(source.binding.kind==='ssh')return stableSshWorkerBinding(source.binding);return {...settings,distribution:source.binding.distribution,workerRoot:source.binding.root,...source.source==='authoring'?{workerPort:source.binding.port}:{}};}

export function legacyAuthoringBindingEligible(task){return task?.workflowVersion===2&&!!task.authoring?.projectId&&!!task.authoring?.environmentId&&!!task.authoring?.inputRoot&&!taskWorkerSource(task)&&!task.deployment?.prepared&&!task.execution?.artifactId&&!['validating','submitting','unknown'].includes(task.execution?.phase)&&!['queued','running','unknown'].includes(task.execution?.status)&&!(task.artifacts||[]).some(value=>['run','cluster-run'].includes(value.kind));}
