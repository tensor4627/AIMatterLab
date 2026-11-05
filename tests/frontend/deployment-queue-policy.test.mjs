import test from 'node:test';
import assert from 'node:assert/strict';
import {clusterDeploymentChoice,validDeployment,scienceOnly,snapshotIdentity} from "../../contracts/compute/deployment.mjs";

import {validDeploymentDraft} from "../../contracts/compute/deployment-draft.mjs";
import {DeploymentOutbox} from "../../frontend/features/workflows/deployment-draft.mjs";

import {memoryStorage} from "../helpers/agent-hooks.mjs";
import {deploymentHarness,deploymentFixture} from "../helpers/deployment-diagnostic-hooks.mjs";

const resources={cpus:1,gpus:1,memory_mb:4096,queue:'legacy-queue',account:'legacy-account'};
const config={target:'cluster',projectId:'project',targetId:'cluster',inputSource:'local',directoryName:'short-fixture',maxSeconds:60,gpu:0,resources};
const cluster={id:'cluster',name:'Fixture cluster',version:4,queue:'legacy-queue',queue_targets:[{id:'owned',queue:'owned-queue',enabled:true,usage_class:'owned',engines:['pydyn.md']},{id:'paid',queue:'paid-queue',enabled:true,usage_class:'paid',engines:['pydyn.md']}]};
const policy={profile_version:4,allowed_target_ids:['owned','paid'],new_submission_order:['owned','paid'],paid:{permitted:true,conditions_known:true,conditions:'Fixture terms'}};

test('explicit policy selection omits legacy queue/account and empty target without mutating its input',()=>{
 const before=structuredClone(resources),choice=clusterDeploymentChoice(resources,cluster),next=validDeployment({...config,...choice});
 assert.deepEqual(resources,before);assert.equal(next.queueSelection,'policy');
 assert.deepEqual(next.resources,{cpus:1,gpus:1,memory_mb:4096});
 const exact=validDeployment({...config,...clusterDeploymentChoice(resources,cluster,'paid')});
 assert.equal(exact.resources.queue_target_id,'paid');assert(!('queue' in exact.resources));
 assert.deepEqual(clusterDeploymentChoice(exact.resources,{queue:'legacy'}),{queueSelection:undefined,resources:{cpus:1,gpus:1,memory_mb:4096,queue:'legacy'}});
});

test('manual legacy queue validation is retained and policy selection is strict and cluster-only',()=>{
 assert.equal(validDeployment(config).resources.queue,'legacy-queue');
 assert.throws(()=>validDeployment({...config,resources:{...resources,queue:''}}),/队列/);
 for(const queue of [null,0,{},'x\nq','$(whoami)'])assert.throws(()=>validDeployment({...config,queueSelection:'policy',resources:{...resources,queue}}),/队列/);
 for(const id of ['../target','x y','x'.repeat(65),null])assert.throws(()=>validDeployment({...config,queueSelection:'policy',resources:{...resources,queue_target_id:id}}),/目标/);
 assert.throws(()=>validDeployment({...config,queueSelection:'policy',target:'local'}),/集群/);
 assert.throws(()=>validDeployment({...config,queueSelection:'automatic'}),/选择方式/);
 assert.throws(()=>validDeployment({...config,resources:{...resources,queue_target_id:'owned'}}),/目标/);
});

test('policy target survives settings draft/outbox restart without preparing a run or granting access',()=>{
 const value={...config,...clusterDeploymentChoice(resources,cluster,'owned')},storage=memoryStorage(),task={id:'queue-task',deploymentDraft:{revision:2}};
 assert.deepEqual(validDeploymentDraft(value),value);
 const first=new DeploymentOutbox(task.id,storage);first.stage(value,task);
 const resumed=new DeploymentOutbox(task.id,storage);assert.deepEqual(resumed.current(task),value);assert.equal(resumed.pending.expectedRevision,2);
 assert.throws(()=>validDeploymentDraft({...value,resources:{...value.resources,queue_target_id:'../other'}}),/目标/);
 assert.throws(()=>validDeploymentDraft({...value,queueSelection:'automatic'}),/选择方式/);
 const stripped=scienceOnly({engine:'pydyn.md',queue_target_id:'owned',queueSelection:'policy',md:{temperature:300}});
 assert.deepEqual(stripped.parameters,{engine:'pydyn.md',md:{temperature:300}});
});

function harness({approved=policy,mode,initialTarget='owned'}={}){
 const initial=deploymentFixture('queue-ui');initial.task.deployment.config={...structuredClone(config),...(mode==='policy'?clusterDeploymentChoice(resources,cluster,initialTarget):{})};
 initial.run={...initial.run,kind:'cluster-run',cluster:{scheduler:'slurm'},queue_target_snapshot:cluster.queue_targets[0],queue_profile_version:4};initial.task.deployment.prepared.inputIdentity=snapshotIdentity(initial.task,initial.run);
 const project={id:'project',name:'Fixture project',policy:{engines:['pydyn.md'],environments:[],clusters:['cluster'],gpus:[0],max_seconds:3600,cluster_queue_policies:{cluster:structuredClone(approved)}}};
 const h=deploymentHarness({initial,properties:{projects:[project],onOpenConnections(){}},override:async(method,data,standard)=>{
  if(method==='task.deployment.context')return {taskId:initial.task.id,projects:[project],environments:[],clusters:[structuredClone(cluster)]};
  if(method==='worker.request'&&data.target==='/api/cluster/status')return structuredClone(initial.run);
  return standard(method,data);
 }});return h;
}

test('mounting an existing manual draft does not migrate it; explicit policy selection saves that same task draft',async()=>{
 const h=harness();await h.flush();assert.equal(h.props.task.deployment.config.resources.queue,'legacy-queue');assert(!h.calls.some(c=>c.method==='task.deployment.draft'));
 assert.equal(h.find(n=>n.props?.['data-testid']==='prepare-deployment').props.disabled,true);
 const select=h.find(n=>n.type==='select'&&n.props['aria-label']==='部署队列环境');select.props.onChange({target:{value:''}});await h.flush();
 const saved=h.servers.get(h.props.task.id).deploymentDraft.config;
 assert.equal(saved.queueSelection,'policy');assert.equal(saved.resources.queue,'');assert.equal(saved.resources.account,'');assert(!('queue_target_id' in saved.resources));
 assert(!h.calls.some(c=>c.method==='worker.request'&&c.data.method==='POST'&&c.data.target!=='/api/cluster/status'||/prepare|execute/.test(c.method)));
 h.unmount();
});

test('choosing an explicit queue target preserves exact id and changes no authorization',async()=>{
 const h=harness({mode:'policy'});await h.flush();
 h.find(n=>n.type==='select'&&n.props['aria-label']==='部署队列环境').props.onChange({target:{value:'paid'}});await h.flush();
 const saved=h.servers.get(h.props.task.id).deploymentDraft.config;assert.equal(saved.resources.queue_target_id,'paid');assert.equal(saved.queueSelection,'policy');
 assert(!h.calls.some(c=>c.method==='worker.request'&&c.data.target==='/api/projects'));h.unmount();
});

for(const [name,approved] of [['outdated',{...policy,profile_version:3}],['revoked',{...policy,allowed_target_ids:[],new_submission_order:[]}]])test(name+' queue scope blocks preparation before any worker prepare',async()=>{
 const h=harness({approved,mode:'policy'});await h.flush();assert.equal(h.find(n=>n.props?.['data-testid']==='prepare-deployment').props.disabled,true);
 assert(!h.calls.some(c=>c.method==='task.deployment.prepare'));h.unmount();
});

test('revoking one explicit target cannot prepare it merely because another target remains allowed',async()=>{
 const h=harness({approved:{...policy,allowed_target_ids:['owned'],new_submission_order:['owned']},mode:'policy',initialTarget:'paid'});await h.flush();
 assert.equal(h.find(n=>n.props?.['data-testid']==='prepare-deployment').props.disabled,true);
 assert(!h.calls.some(c=>c.method==='task.deployment.prepare'));h.unmount();
});

test('review displays the immutable resolved target rather than only a JSON field',async()=>{
 const h=harness({mode:'policy'});await h.flush();const line=h.find(n=>n.props?.['data-testid']==='deployment-resolved-queue');assert.match(h.text(line),/owned-queue.*owned.*v4/);h.unmount();
});
