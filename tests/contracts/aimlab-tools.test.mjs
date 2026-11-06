import test from 'node:test';
import assert from 'node:assert/strict';
import {aimlabToolPackageShape, validateAimlabTools} from '../../contracts/tools/aimlab-tools.mjs';

function manifest() {
  return {
    schema_version: 1,
    id: 'demo-tool',
    name: 'Demo tool',
    environment: {hardware: 'cpu', requirements: ['Python 3'], parallelism: {supported: ['serial']}},
    functions: [{
      id: 'demo.run',
      name: 'Demo run',
      description: 'Run the demo program',
      entrypoint: 'tool.py',
      inputs: [],
      outputs: [{
        id: 'result',
        type: 'file',
        format: 'json',
        description: 'JSON receipt',
        required: true,
        display: {priority: 100, advanced: false, reason: 'Main result'}
      }],
      parameters: [],
      operation: {command: ['{python}', '{entrypoint}'], failure_handling: 'Inspect the receipt and logs before retrying.'},
      tests: ['basic']
    }],
    tests: {
      cases: [{
        id: 'basic',
        function_id: 'demo.run',
        directory: 'aimlab-tools/tests/basic',
        instructions: 'aimlab-tools/tests/basic/README.md',
        entrypoint: 'aimlab-tools/tests/basic/run-test.py',
        resources: [],
        expected_outputs: [{path: 'receipt.json', format: 'json', description: 'JSON receipt written by the wrapper.'}],
        pass_criteria: ['Exit code 0', 'receipt.json parses']
      }]
    }
  };
}

test('a valid internal declaration maps to the shared package contract', () => {
  const shape = aimlabToolPackageShape(manifest(), {commit: 'a'.repeat(40)});
  assert.equal(shape.repository.path, 'demo-tool');
  assert.equal(shape.repository.commit, 'a'.repeat(40));
  assert.equal(shape.manual, 'manual.md');
  assert.equal(shape.guidance.delivery, 'SKILL.md');
  assert.equal(shape.tests.directory, 'demo-tool-tests');
  assert.equal(shape.tests.introduction, 'demo-tool-tests/README.md');
  assert.equal(shape.tests.cases[0].directory, 'demo-tool-tests/basic');
  assert.equal(shape.tests.cases[0].instructions, 'demo-tool-tests/basic/README.md');
  assert.equal(shape.functions[0].entrypoint, 'demo-tool/tool.py');
  assert.equal(shape.tests.cases[0].entrypoint, 'demo-tool-tests/basic/run-test.py');
});

test('test case directories must stay under aimlab-tools/tests', () => {
  const value = manifest();
  value.tests.cases[0].directory = 'tests/basic';
  value.tests.cases[0].instructions = 'tests/basic/README.md';
  assert.throws(() => validateAimlabTools(value), /must be under aimlab-tools\/tests\//);
});

test('optional parameters require an executable default, behavior and source', () => {
  const value = manifest();
  value.functions[0].parameters = [{
    id: 'label',
    type: 'string',
    description: 'Optional label',
    required: false,
    display: {priority: 10, advanced: true, reason: 'Rarely changed'}
  }];
  assert.throws(() => validateAimlabTools(value), /requires a default, default_behavior and default_source/);
});

test('declared instructions must be Markdown inside the case directory', () => {
  const value = manifest();
  value.tests.cases[0].instructions = 'aimlab-tools/tests/README.md';
  assert.throws(() => validateAimlabTools(value), /must be Markdown inside the case directory/);
});

test('unknown declaration fields are rejected', () => {
  const value = manifest();
  value.extra = true;
  assert.throws(() => validateAimlabTools(value), /unknown field extra/);
});

test('declaration paths must be portable repository-relative paths', () => {
  const value = manifest();
  value.functions[0].entrypoint = '..\\tool.py';
  assert.throws(() => validateAimlabTools(value), /portable repository-relative path required/);
});

test('operation tokens must reference declared ids or reserved executable tokens', () => {
  const value = manifest();
  value.functions[0].operation.command = ['{python}', '{entrypoint}', '{model-file}'];
  assert.throws(() => validateAimlabTools(value), /unknown operation token \{model-file\}/);
  value.functions[0].inputs = [{
    id: 'model-file',
    type: 'file',
    format: 'text',
    description: 'Model checkpoint consumed by the production command.',
    required: true,
    display: {priority: 90, advanced: false, reason: 'Production input'}
  }];
  value.functions[0].operation.command = ['{executable:hotpp}', 'eval', '-m', '{model-file}'];
  assert.doesNotThrow(() => validateAimlabTools(value));
  value.functions[0].operation.command = ['{executable:Not A Name}'];
  assert.throws(() => validateAimlabTools(value), /unknown operation token/);
});
