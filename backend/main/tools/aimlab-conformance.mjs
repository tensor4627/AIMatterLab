const normalize = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const trimExtension = value => normalize(String(value).replace(/\.[A-Za-z0-9]{1,10}$/, ''));

function findPort(name, ports) {
  const target = normalize(name);
  if (!target) return {status: 'missing'};
  const exact = ports.filter(port => normalize(port.id) === target);
  if (exact.length === 1) return {status: 'found', port: exact[0]};
  if (exact.length > 1) return {status: 'ambiguous'};
  // A contract file name and a declaration id may differ only by a common extension
  // (GAScfg.yaml -> gas-cfg). Arbitrary prefix matching is rejected because it would let
  // a different concept such as model-file satisfy mode.
  const folded = ports.filter(port => trimExtension(port.id) === trimExtension(name));
  if (folded.length === 1) return {status: 'found', port: folded[0]};
  return {status: folded.length > 1 ? 'ambiguous' : 'missing'};
}

const TOKEN = /\{([^{}]+)\}/g;
function operationTokens(command) {
  const tokens = [];
  for (const entry of command) for (const match of entry.matchAll(TOKEN)) tokens.push(match[1]);
  return tokens;
}

function declaredPorts(fn) {
  return ['inputs', 'parameters'].flatMap(kind => (fn[kind] || [])
    .filter(item => item && item.id)
    .map(item => ({id: String(item.id), kind: kind === 'inputs' ? 'input' : 'parameter'})));
}

function requiredPortCheck({fn, names, kind, checkId}) {
  const source = kind === 'input' ? (fn.inputs || []) : (fn.parameters || []);
  const missing = [];
  const ambiguous = [];
  for (const name of names) {
    const found = findPort(name, source.filter(item => item && item.id));
    if (found.status === 'missing') missing.push(name);
    else if (found.status === 'ambiguous') ambiguous.push(name);
  }
  return {
    id: checkId,
    status: missing.length || ambiguous.length ? 'failed' : 'passed',
    detail: missing.length ? 'Undeclared ' + kind + ': ' + missing.join(', ')
      : ambiguous.length ? 'Ambiguous declared ' + kind + ': ' + ambiguous.join(', ')
        : 'All contract required ' + kind + 's are declared'
  };
}

/**
 * Compare one declared production operation with the neutral built-in AIMatterLab engine contract.
 * This is a readiness check for replacing hardcoded adapters; it never executes anything.
 * It checks required ports, required argv tokens and the declared tool identity. It does not
 * prove argv equality; the reproducible parity script compares actual bound argv.
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
      checks: [{id: 'adapter_contract', status: 'not_run', detail: 'No built-in engine contract; an AIMatterLab adapter must be implemented separately'}]
    };
  }
  const checks = [];
  checks.push(requiredPortCheck({fn, names: contract.required_inputs || [], kind: 'input', checkId: 'declared_required_inputs'}));
  checks.push(requiredPortCheck({fn, names: contract.required_parameters || [], kind: 'parameter', checkId: 'declared_required_parameters'}));
  const ports = declaredPorts(fn);
  const tokens = new Set(operationTokens(fn.operation?.command || []).map(normalize));  const missing = [];
  const omitted = [];
  for (const name of contract.declaration_tokens || []) {
    const found = findPort(name, ports);
    if (found.status !== 'found') {
      missing.push(name);
    } else if (!tokens.has(normalize(found.port.id))) {
      omitted.push('{' + found.port.id + '}');
    }
  }
  checks.push({
    id: 'declaration_tokens',
    status: missing.length || omitted.length ? 'failed' : 'passed',
    detail: missing.length ? 'Undeclared contract token ports: ' + missing.join(', ')
      : omitted.length ? 'operation.command omits required token(s): ' + omitted.join(', ')
        : 'Production operation binds every required contract token'
  });
  const expectedTool = contract.aimlab_tool_id;
  checks.push({
    id: 'tool_identity',
    status: expectedTool && declaration.tool_id !== expectedTool ? 'failed' : 'passed',
    detail: expectedTool && declaration.tool_id !== expectedTool
      ? 'Declaration tool id ' + declaration.tool_id + ' does not match engine contract tool id ' + expectedTool
      : expectedTool ? 'Declaration tool id matches the engine contract' : 'No tool identity is declared for this engine'
  });
  const command = fn.operation?.command || [];
  const sourceEntrypoint = fn.source_entrypoint ?? fn.entrypoint;
  const wrapperOnly = command.length === 2 && command[0] === '{python}' && command[1] === '{entrypoint}'
    && typeof sourceEntrypoint === 'string' && sourceEntrypoint.startsWith('aimlab-tools/tests/');
  const declaredPortsCount = (fn.inputs || []).length + (fn.parameters || []).length;
  const bindsDeclared = operationTokens(command).some(token => {
    const normalized = normalize(token);
    return token.startsWith('executable:') || token.startsWith('skill:')
      || ports.some(port => normalize(port.id) === normalized);
  });
  const operationProblems = [];
  if (wrapperOnly) operationProblems.push('operation.command is a test-wrapper invocation only');
  if (declaredPortsCount > 0 && !bindsDeclared) operationProblems.push('operation.command does not bind any declared input/parameter or executable token');
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
