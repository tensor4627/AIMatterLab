import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAimlabAdapterConformance, summarizeConformance} from '../../backend/main/tools/aimlab-conformance.mjs';

const contracts = {
  engines: {
    'demo.run': {
      required_inputs: ['run.in', 'model.xyz'],
      required_parameters: ['mode'],
      declaration_tokens: ['run.in', 'model.xyz', 'mode', 'validation_history'],
      aimlab_tool_id: 'demo-tool'
    }
  }
};

function declaration(overrides = {}) {
  return {
    tool_id: 'demo-tool',
    function: {
      id: 'demo.run',
      engine: 'demo.run',
      entrypoint: 'bin/run.py',
      inputs: [
        {id: 'run-in'},
        {id: 'model-xyz'}
      ],
      parameters: [
        {id: 'mode'},
        {id: 'validation_history', required: false, default: null}
      ],
      operation: {command: ['{python}', '{entrypoint}', '{run-in}', '{model-xyz}', '--mode', '{mode}', '--history', '{validation_history}']},
      ...overrides
    }
  };
}

test('a complete production declaration passes every conformance check', () => {
  const result = checkAimlabAdapterConformance({declaration: declaration(), engineContracts: contracts});
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.checks.map(item => item.status), ['passed', 'passed', 'passed', 'passed', 'passed']);
});

test('missing required ports, required tokens, tool identity and wrapper-only operations fail', () => {
  const value = declaration({
    entrypoint: 'aimlab-tools/tests/demo/run-test.py',
    inputs: [{id: 'run-in'}],
    parameters: [],
    operation: {command: ['{python}', '{entrypoint}']}
  });
  value.tool_id = 'other-tool';
  const result = checkAimlabAdapterConformance({declaration: value, engineContracts: contracts});
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.checks.map(item => item.status), ['failed', 'failed', 'failed', 'failed', 'failed']);
  assert.match(result.checks.find(item => item.id === 'production_operation').detail, /test-wrapper/);
  assert.match(result.checks.find(item => item.id === 'declaration_tokens').detail, /Undeclared|omits/);
  assert.match(result.checks.find(item => item.id === 'tool_identity').detail, /does not match/);
});

test('declared tokens must appear in the production command', () => {
  const value = declaration({operation: {command: ['{python}', '{entrypoint}', '{run-in}', '{model-xyz}', '--mode', '{mode}']}});
  const result = checkAimlabAdapterConformance({declaration: value, engineContracts: contracts});
  assert.equal(result.status, 'failed');
  const tokenCheck = result.checks.find(item => item.id === 'declaration_tokens');
  assert.equal(tokenCheck.status, 'failed');
  assert.match(tokenCheck.detail, /omits required token/);
});

test('engines without a built-in adapter contract are pending rather than passing', () => {
  const value = declaration({id: 'torchnep.train', engine: 'torchnep.train'});
  const result = checkAimlabAdapterConformance({declaration: value, engineContracts: contracts});
  assert.equal(result.status, 'pending_adapter');
  assert.deepEqual(summarizeConformance([result, checkAimlabAdapterConformance({declaration: declaration(), engineContracts: contracts})]), {passed: 1, failed: 0, pending_adapter: 1});
});
