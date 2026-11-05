import test from 'node:test';
import assert from 'node:assert/strict';
import {initialBottomExpanded,conversationMatches,computeProjectForSelection,toolGroups,unifiedJobs,filterJobs,boundJobConversation} from "../../frontend/app/workspace-shell.mjs";

test('chat input workspace filters jobs by its explicit compute binding, preserving deliberate unrelated selections',()=>{
 const task={projectId:'draft',authoring:{projectId:'draft'},deployment:{config:{projectId:'compute-old'}},deploymentDraft:{config:{projectId:'compute-new'}}};
 assert.equal(computeProjectForSelection('draft',task),'compute-new');
 assert.equal(computeProjectForSelection('other',task),'other');
 assert.equal(computeProjectForSelection('',task),'');
 assert.equal(computeProjectForSelection('draft',{...task,deploymentDraft:undefined}),'compute-old');
 for(const value of [undefined,{}, {projectId:'draft'}, {...task,deployment:undefined,deploymentDraft:{config:{projectId:'draft'}}}])assert.equal(computeProjectForSelection('draft',value),'draft');
 const jobs=unifiedJobs([{id:'run',project_id:'compute-new',status:'draft'}],[]);
 assert.equal(filterJobs(jobs,{projectId:computeProjectForSelection('draft',task)}).length,1);
});
test('compact initial bottom is new-only and explicit or legacy preferences win',()=>{
 const from=values=>key=>values[key]??null;
 assert.equal(initialBottomExpanded(from({})),false);
 assert.equal(initialBottomExpanded(from({'studio.bottom':'190'})),true);
 assert.equal(initialBottomExpanded(from({'studio.bottom':'270','studio.bottomExpanded':'false'})),false);
 assert.equal(initialBottomExpanded(from({'studio.bottomExpanded':'true'})),true);
 for(const value of ['',0,-1,'NaN'])assert.equal(initialBottomExpanded(from({'studio.bottom':String(value)})),false);
});
test('tool groups expose each actual tool exactly once and retain real management routes',()=>{
 assert.deepEqual(toolGroups.flatMap(group=>group.tools).sort(),['activelearning','assets','md','pygas','queue','training','viewer']);
 assert.deepEqual(toolGroups.flatMap(group=>group.pages),['environments','ssh','skills','relations']);
});
test('conversation search includes actual name or project label, not private thread identifiers',()=>{
 const conversation={name:'Cu NEB Path',threadId:'secret'};
 assert.equal(conversationMatches(conversation,' neb '),true);
 assert.equal(conversationMatches(conversation,'Ni project','Ni Project'),true);
 assert.equal(conversationMatches(conversation,'secret'),false);
});
const local=[{id:'same',name:'Local queued',status:'queued',project_id:'p',engine:'pydyn.md',created_at:100},{id:'l2',name:'Local done',status:'succeeded',project_id:'q',engine:'gpumd.md',created_at:300}];
const cluster=[{id:'same',kind:'cluster-run',name:'Remote unknown',status:'unknown',project_id:'p',engine:'gpumd.neb',created_at:200,job_id:'1001'},{id:'r2',kind:'cluster-run',name:'Remote running',status:'running',project_id:'p',engine:'gpumd.sampling'}];
test('unified jobs preserve exact states, source identity collisions and original records',()=>{
 const before=structuredClone({local,cluster}),jobs=unifiedJobs(local,cluster);
 assert.deepEqual(jobs.map(job=>job.key),['local:l2','cluster:same','local:same','cluster:r2']);
 assert.equal(jobs.find(job=>job.key==='local:same').run,local[0]);
 assert.equal(jobs.find(job=>job.key==='cluster:same').run.status,'unknown');
 assert.deepEqual({local,cluster},before);
});
test('job filters compose raw status, source, project, creation time and actual queue ID',()=>{
 const jobs=unifiedJobs(local,cluster);
 assert.deepEqual(filterJobs(jobs,{status:'active',projectId:'p'}).map(job=>job.key),['cluster:same','local:same','cluster:r2']);
 assert.deepEqual(filterJobs(jobs,{location:'cluster',status:'unknown',since:150,query:'1001'}).map(job=>job.key),['cluster:same']);
 assert.equal(filterJobs(jobs,{since:201,location:'cluster'}).length,0); // Missing timestamps never masquerade as recent.
 assert.deepEqual(filterJobs(jobs,{status:'queued'}).map(job=>job.key),['local:same']);
});
test('run return requires exact kind/id plus owning task/provider/thread and rejects ambiguity',()=>{
 const jobs=unifiedJobs(local,cluster),conversation={id:'c',taskId:'t',provider:'codex',threadId:'thread'};
 const task={id:'t',provider:'codex',threadId:'thread',artifacts:[{id:'same',kind:'cluster-run'}]};
 assert.equal(boundJobConversation(jobs.find(job=>job.key==='cluster:same'),[task],[conversation]),conversation);
 assert.equal(boundJobConversation(jobs.find(job=>job.key==='local:same'),[task],[conversation]),null);
 for(const changed of [{...conversation,taskId:'other'},{...conversation,provider:'kimi'},{...conversation,threadId:'other'}])assert.equal(boundJobConversation(jobs[1],[task],[changed]),null);
 assert.equal(boundJobConversation(jobs[1],[task],[conversation,{...conversation,id:'duplicate'}]),null);
 assert.equal(boundJobConversation(jobs[1],[{...task,artifacts:[],deployment:{prepared:{artifactId:'same'}}}],[conversation]),null);
});
