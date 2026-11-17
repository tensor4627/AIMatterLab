import {isDeepStrictEqual as equal} from 'node:util';
import {actualAuthoringWorker,stableSshWorkerBinding} from '../../../contracts/compute/task-worker-binding.mjs';

// Called only after a human updates the service on an already authenticated connection.
export async function updateDraftWorker(records,worker,{owner,previous,assertCurrent}){
 if(!owner?.taskId||previous?.kind!=='ssh'||worker.identity?.kind!=='ssh')return;
 const before=stableSshWorkerBinding(previous),after=actualAuthoringWorker(worker);
 if(before.runtimeId===after.runtimeId||before.profileId!==after.profileId||before.profileVersion!==after.profileVersion||
    before.root!==after.root||!equal(before.hostIdentity,after.hostIdentity)||previous.connectionId!==worker.identity.connectionId)return;
 const task=records.read(owner.taskId),draft=task.authoring;
 if(task.workflowVersion!==2||task.provider!==owner.provider||task.threadId!==owner.threadId||
    !draft?.authoringOnly||!equal(draft.workerBinding,before)||task.deployment?.workerBinding||task.deploymentDraft?.workerBinding||
    task.deployment?.prepared||task.execution?.artifactId||task.artifacts?.some(a=>['run','cluster-run'].includes(a.kind)))return;
 if(task.workspace&&(!equal(task.workspace.workerBinding,before)||task.workspace.id!==draft.projectId))return;
 if(draft.projectId!==owner.projectId||draft.inputRoot!==owner.inputRoot||draft.inputRoot!==before.root+'/projects/'+draft.projectId+'/inputs')return;
 const connection=worker.connection,epoch=worker.connectionEpoch;
 assertCurrent();
 const projects=await worker.request('GET','/api/projects');
 assertCurrent();
 const project=projects.find(p=>p.id===draft.projectId&&p.authoring_only===true);
 if(!project?.policy?.input_roots?.includes(draft.inputRoot)||(task.workspace?!project.studio_workspace:project.authoring_task_id!==task.id))return;
 if(worker.connection!==connection||worker.connectionEpoch!==epoch||!equal(records.read(task.id),task))return;
 // This changes only the verified implementation serving the very same on-disk draft.
 draft.workerBinding=after;
 if(task.workspace)task.workspace.workerBinding=after;
 records.save(task);
}
