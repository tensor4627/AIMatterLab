import test from 'node:test';import assert from 'node:assert/strict';import {explicitScientificInputs,ensureTaskAuthoring} from '../desktop/task-authoring.mjs';
test('Natural human requests select exact scientific inputs while refusing URLs, UNC and negative requests',()=>{
 assert.deepEqual(explicitScientificInputs('使用 "D:\\demo files\\nep.txt" 和 /home/user/run.py，参考 /mnt/d/data/GAScfg.yaml'),['/mnt/d/demo files/nep.txt','/home/user/run.py','/mnt/d/data/GAScfg.yaml']);
 assert.deepEqual(explicitScientificInputs('不要读取 /home/user/private.json；使用 /home/user/model.xyz。 https://example.org/run.py \\\\host\\share\\x.py'),['/home/user/model.xyz']);
 assert.deepEqual(explicitScientificInputs('不要读取 /home/user/POSCAR；使用 /home/user/model.xyz'),['/home/user/model.xyz']);
 assert.deepEqual(explicitScientificInputs('do not import /home/user/private.py'),[]);
});
