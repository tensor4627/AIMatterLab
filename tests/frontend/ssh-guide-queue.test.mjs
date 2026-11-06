import test from 'node:test';
import assert from 'node:assert/strict';
import {sshGuideKey,enqueueSshGuide,takeQueuedSshGuide} from "../../frontend/app/ssh-guide-queue.mjs";

const state=request=>({request});
const saved=(clusterId,version)=>({kind:'saved-profile',clusterId,version,expected:{}});
const original=(runId,taskId)=>({kind:'original-run',runId,...taskId?{taskId}:{}});

test('a guide opens immediately when none is active and deduplicates the same request',()=>{
 const first=state(saved('cluster',4));
 let queued=enqueueSshGuide(null,null,first);
 assert.equal(queued.current,first);assert.equal(queued.queued,null);
 const duplicate=state(saved('cluster',4));
 queued=enqueueSshGuide(queued.current,queued.queued,duplicate);
 assert.equal(queued.current,first,'same saved-profile version must not replace the active guide');
 assert.equal(queued.queued,null);
});

test('a different request waits until the active guide closes',()=>{
 const active=state(saved('cluster',4)),next=state(original('run-1','task-1'));
 let queue=enqueueSshGuide(active,null,next);
 assert.equal(queue.current,active);assert.equal(queue.queued,next);
 const waiting=state(saved('cluster',5));
 queue=enqueueSshGuide(queue.current,queue.queued,waiting);
 assert.equal(queue.current,active);assert.equal(queue.queued,waiting,'only the latest pending request is kept');
 const shifted=takeQueuedSshGuide(null,queue.queued);
 assert.equal(shifted.current,waiting);assert.equal(shifted.queued,null);
 const empty=takeQueuedSshGuide(null,null);
 assert.equal(empty.current,null);assert.equal(empty.queued,null);
});

test('request keys distinguish clusters, versions, runs and tasks',()=>{
 assert.notEqual(sshGuideKey(saved('a',1)),sshGuideKey(saved('a',2)));
 assert.notEqual(sshGuideKey(saved('a',1)),sshGuideKey(saved('b',1)));
 assert.notEqual(sshGuideKey(original('run-1')),sshGuideKey(original('run-1','task-1')));
 assert.equal(sshGuideKey(original('run-1')),sshGuideKey(original('run-1')));
});
