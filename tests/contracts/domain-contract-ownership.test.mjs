import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {taskSchemas} from '../../contracts/workflows/plan-schema.mjs';
import {validatePlan} from '../../contracts/workflows/plan.mjs';
import {tasks,createPlan} from '../../frontend/features/workflows/workflow-catalog.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
test('persisted plan schema matches every frontend catalogue task and required step',()=>{
 assert.deepEqual(taskSchemas,tasks.map(({id,steps})=>({id,steps:steps.map(({id,required})=>({id,required}))})));
 for(const task of tasks){const plan=createPlan(task.id);assert.deepEqual(validatePlan(plan),plan);}
});

test('former shared contracts are pure boundaries and the legacy generic source root is absent',()=>{
 assert.equal(fs.existsSync(path.join(root,'shared')),false);
 const files=['contracts/agent/conversation-title.mjs','contracts/agent/provider-account.mjs','contracts/agent/user-message.mjs','contracts/compute/deployment.mjs','contracts/compute/deployment-draft.mjs','contracts/compute/deployment-authorization.mjs','contracts/compute/project-policy.mjs','contracts/compute/task-worker-binding.mjs','contracts/tools/engine-contracts.mjs','contracts/workflows/task-fields.mjs','contracts/workflows/known-run-reconcile.mjs','contracts/workflows/local-review-eligibility.mjs','contracts/workflows/plan.mjs','contracts/workflows/plan-schema.mjs'];
 for(const file of files){const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);for(const node of source.statements){if(!ts.isImportDeclaration(node)&&!ts.isExportDeclaration(node))continue;const spec=node.moduleSpecifier?.text;if(!spec)continue;assert(spec.startsWith('.'),file+': '+spec);const target=path.resolve(path.dirname(path.join(root,file)),spec);assert(target.startsWith(path.join(root,'contracts')+path.sep),file+': '+spec);}}
});
