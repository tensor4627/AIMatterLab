const normalize = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');

function portMatches(declaredId, contractName) {
  const left = normalize(declaredId);
  const right = normalize(contractName);
  return !!left && !!right && (left === right || left.startsWith(right) || right.startsWith(left));
}

const TOKEN = /\{([^{}]+)\}/g;
function operationTokens(command) {
  const tokens = [];
  for (const entry of command) for (const match of entry.matchAll(TOKEN)) tokens.push(match[1]);
  return tokens;
}

/**
 * Compare one declared production operation with the built-in Studio engine contract.
 * This is a readiness check for replacing hardcoded adapters; it never executes anything.
 */
export function checkAimlabAdapterConformance({declaration, engineContracts}) {
  const fn = declaration.function;
  const engine = fn.engine ?? fn.id;
  const contract = engineContracts?.engines?.[engine];
  if (!contract) {
    return {
      tool_id: declaration.tool_id,
      engine,
      status: 'pending_adapter',
      checks: [{id: 'adapter_contract', status: 'not_run', detail: 'No built-in engine contract; a Studio adapter must be implemented separately'}]
    };
  }
  const declaredInputs = (fn.inputs || []).map(item => item.id);
  const declaredParameters = (fn.parameters || []).map(item => item.id);
  const requiredInputs = contract.required_inputs || [];
  const requiredParameters = contract.required_parameters || [];
  const command = fn.operation?.command || [];
  const tokens = operationTokens(command);
  const wrapperOnly = command.length === 2 && command[0] === '{python}' && command[1] === '{entrypoint}' && typeof fn.entrypoint === 'string' && fn.entrypoint.startsWith('aimlab-tools/tests/');
  const bindsDeclared = tokens.some(token => token.startsWith('executable:') || declaredInputs.includes(token) || declaredParameters.includes(token));
  const checks = [];
  const missingInputs = requiredInputs.filter(name => !declaredInputs.some(id => portMatches(id, name)));
  checks.push({
    id: 'required_inputs',
    status: missingInputs.length ? 'failed' : 'passed',
    detail: missingInputs.length ? 'Undeclared required inputs: ' + missingInputs.join(', ') : 'All contract required inputs are declared'
  });
  const missingParameters = requiredParameters.filter(name => !declaredParameters.some(id => portMatches(id, name)));
  checks.push({
    id: 'required_parameters',
    status: missingParameters.length ? 'failed' : 'passed',
    detail: missingParameters.length ? 'Undeclared required parameters: ' + missingParameters.join(', ') : 'All contract required parameters are declared'
  });
  const operationProblems = [];
  if (wrapperOnly) operationProblems.push('operation.command is a test-wrapper invocation only');
  if (declaredInputs.length + declaredParameters.length > 0 && !bindsDeclared) operationProblems.push('operation.command does not bind any declared input/parameter or executable token');
  checks.push({
    id: 'production_operation',
    status: operationProblems.length ? 'failed' : 'passed',
    detail: operationProblems.length ? operationProblems.join('; ') : 'Production operation binds declared values'
  });
  return {
    tool_id: declaration.tool_id,
    engine,
    status: checks.every(check => check.status === 'passed') ? 'passed' : 'failed',
    checks
  };
}

export function summarizeConformance(items) {
  const summary = {passed: 0, failed: 0, pending_adapter: 0};
  for (const item of items) summary[item.status] = (summary[item.status] || 0) + 1;
  return summary;
}
