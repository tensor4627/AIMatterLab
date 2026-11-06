import test from 'node:test';
import assert from 'node:assert/strict';
import {followedProjectId} from "../../frontend/app/project-follow.mjs";

test('an unchanged project follows conversation updates',()=>{
 assert.equal(followedProjectId('project', 'project', 'next'),'next');
 assert.equal(followedProjectId('', undefined, 'next'),'next');
 assert.equal(followedProjectId('', null, 'next'),'next');
});

test('a project the human selected explicitly is not overwritten by a conversation event',()=>{
 assert.equal(followedProjectId('manual', 'conversation-project', 'next'),'manual');
 assert.equal(followedProjectId('manual', undefined, 'next'),'manual');
});

test('events without a project binding preserve the current selection',()=>{
 assert.equal(followedProjectId('project', 'project', ''),'project');
 assert.equal(followedProjectId('project', 'project', undefined),'project');
});
