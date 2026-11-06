import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAimlabAdapterConformance, summarizeConformance} from '../../backend/main/tools/aimlab-conformance.mjs';

const contracts = {
  engines: {
    'demo.run': {
      required_inputs: ['run.in', 'model.xyz'],
      required_parameters: ['mode']
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
        {id: 'mode'}
      ],
      operation: {command: ['{python}', '{entrypoint}', '{run-in}', '{mode}']},
      ...overrides
    }
  };
}

test('a production declaration that covers the adapter contract passes conformance', () => {
  const result = checkAimlabAdapterConformance({declaration: declaration(), engineContracts: contracts});
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.checks.map(item => item.status), ['passed', 'passed', 'passed']);
});

test('missing required inputs, parameters and wrapper-only operations fail conformance', () => {
  const value = declaration({
    inputs: [],
    parameters: [],
    entrypoint: 'aimlab-tools/tests/demo/run-test.py',
    operation: {command: ['{python}', '{entrypoint}']}
  });
  const result = checkAimlabAdapterConformance({declaration: value, engineContracts: contracts});
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.checks.map(item => item.status), ['failed', 'failed', 'failed']);
  assert.match(result.checks[2].detail, /test-wrapper/);
});

test('engines without a built-in adapter contract are pending rather than passing', () => {
  const value = declaration({id: 'torchnep.train', engine: 'torchnep.train'});
  const result = checkAimlabAdapterConformance({declaration: value, engineContracts: contracts});
  assert.equal(result.status, 'pending_adapter');
  assert.deepEqual(summarizeConformance([result, checkAimlabAdapterConformance({declaration: declaration(), engineContracts: contracts})]), {passed: 1, failed: 0, pending_adapter: 1});
});
