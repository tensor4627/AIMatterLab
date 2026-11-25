import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const sha256 = /^[a-f0-9]{64}$/;
const gitObject = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const refId = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const scalarTypes = new Set(['string', 'boolean', 'integer', 'number']);
const requireMatch = (condition, message) => { if (!condition) throw Error(message); };

function matchesScalar(value, type) {
 if (type === 'integer') return Number.isSafeInteger(value);
 if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
 return typeof value === type;
}

export function functionToolId(packageId, functionId) {
 const slug = functionId.replaceAll('.', '-');
 const candidate = packageId + '--' + slug;
 if (candidate.length <= 63) return candidate;
 const digest = createHash('sha256').update(packageId + '\0' + functionId).digest('hex').slice(0, 10);
 const prefix = packageId.slice(0, 24).replace(/-+$/, '');
 const tail = slug.slice(0, Math.max(0, 63 - prefix.length - 13)).replace(/^-+|-+$/g, '');
 return tail ? prefix + '--' + tail + '-' + digest : prefix + '--' + digest;
}

function fileAt(record, name) {
 const file = record.files.find(row => row.path === name && row.kind === 'file');
 requireMatch(file && sha256.test(file.sha256), 'Use a regular entrypoint or support file from the selected immutable package');
 return file;
}

/** Relate a resource draft to a function and reference case in an explicitly selected delivery. */
export function bindResourceToolDefinition(record, selection, draft) {
 requireMatch(selection && Object.keys(selection).length === 3 &&
  ['package_ref', 'function_id', 'test_case_id'].every(key => typeof selection[key] === 'string') &&
  refId.test(selection.function_id) && refId.test(selection.test_case_id),
 'Use the advertised selected package, function and reference test IDs');
 requireMatch(record?.immutable === true && record.manifest && sha256.test(record.package_version) &&
  sha256.test(record.manifest_sha256), 'Select an immutable registered delivery package in this turn');
 const {repository, functions, tests} = record.manifest;
 const feature = functions.find(row => row.id === selection.function_id);
 const referenceCase = tests.cases.find(row => row.id === selection.test_case_id);
 requireMatch(feature && referenceCase?.function_id === feature.id && feature.tests.includes(referenceCase.id),
  'Select a reference case belonging to this declared function');
 const scopedId = functionToolId(record.package_id, feature.id);
 if (functions.length > 1) {
  requireMatch(draft && draft.id === scopedId && draft.source,
   'Use the function-scoped tool ID (' + scopedId + ') derived from the selected package ID for a multi-function package');
 } else {
  requireMatch(draft && (draft.id === record.package_id || draft.id === scopedId) && draft.source,
   'Use the selected package ID or function-scoped tool ID for this resource setup');
 }
 const source = draft.source;
 const entrypoint = fileAt(record, feature.entrypoint);
 const repositoryPrefix = repository.path + '/';
 if (source.kind === 'git') {
  requireMatch(feature.entrypoint.startsWith(repositoryPrefix) &&
   source.executable === feature.entrypoint.slice(repositoryPrefix.length) && source.commit === record.source_commit,
   'Use the selected function entrypoint and exact Git commit');
 } else {
  requireMatch(source.kind === 'installed' && source.sha256 === entrypoint.sha256,
   'Use the selected Git checkout or an installed entrypoint with the registered file digest');
 }

 const bindings = new Map();
 for (const direction of ['inputs', 'outputs']) {
  const declared = feature[direction], supplied = draft[direction];
  const token = direction === 'inputs' ? 'input' : 'output';
  requireMatch(supplied && typeof supplied === 'object' && Object.keys(supplied).length === declared.length &&
   declared.every(port => port.type === 'file' && Object.hasOwn(supplied, port.id) && supplied[port.id]?.format === port.format),
   'Use the exact registered file port IDs and formats');
  for (const port of declared) {
   requireMatch(!bindings.has(port.id), 'Use unique input and output names in the selected function');
   bindings.set(port.id, '{' + token + ':' + port.id + '}');
  }
 }
 const parameterSpecs = {};
 for (const item of feature.parameters) {
  requireMatch(scalarTypes.has(item.type), 'Use the registered scalar parameter IDs and types for this function');
  const required = item.required !== false;
  if (required) {
   requireMatch(!Object.hasOwn(item, 'default'), 'Required function parameters cannot declare a default');
   parameterSpecs[item.id] = {type: item.type, required: true};
  } else {
   requireMatch(Object.hasOwn(item, 'default') && matchesScalar(item.default, item.type),
    'Optional scalar parameters require a typed default in the selected function');
   parameterSpecs[item.id] = {type: item.type, required: false, default: item.default};
  }
  requireMatch(!bindings.has(item.id), 'Use unique port and parameter names in the selected function');
  bindings.set(item.id, '{param:' + item.id + '}');
 }
 if (draft.parameter_specs !== undefined) {
  requireMatch(isDeepStrictEqual(draft.parameter_specs, parameterSpecs),
   'Use the exact registered parameter schema for this function');
 }
 const parameters = draft.parameters || {};
 requireMatch(typeof parameters === 'object' && !Array.isArray(parameters),
  'Use the registered scalar parameter IDs and types for this function');
 for (const [key, value] of Object.entries(parameters)) {
  requireMatch(Object.hasOwn(parameterSpecs, key), 'Use the registered scalar parameter IDs and types for this function');
  const spec = parameterSpecs[key];
  requireMatch(!spec.required, 'Required function parameters cannot be given defaults in setup parameters; supply test values in test.parameters');
  requireMatch(matchesScalar(value, spec.type) && isDeepStrictEqual(value, spec.default),
   'Optional parameter defaults must match the selected tool package declaration');
 }
 const testParameters = draft.test?.parameters || {};
 requireMatch(typeof testParameters === 'object' && !Array.isArray(testParameters),
  'Supply typed scalar test parameters for this function');
 for (const [key, value] of Object.entries(testParameters)) {
  requireMatch(Object.hasOwn(parameterSpecs, key), 'Unknown test parameter for this function: ' + key);
  requireMatch(matchesScalar(value, parameterSpecs[key].type), 'Test parameter type differs from the selected function: ' + key);
 }
 for (const [key, spec] of Object.entries(parameterSpecs)) {
  if (spec.required) {
   requireMatch(Object.hasOwn(testParameters, key), 'Supply required parameter in test.parameters: ' + key);
  }
 }
 const launch = draft.interpreter === 'python' ? ['{python}', '{entrypoint}'] :
  draft.interpreter === 'bash' ? ['{executable:bash}', '{entrypoint}'] : ['{entrypoint}'];
 const command = feature.operation.command;
 requireMatch(isDeepStrictEqual(command.slice(0, launch.length), launch),
  'This bridge supports direct, Python or Bash entrypoints with the registered launch form');
 const expected = command.slice(launch.length).map(word => word.replace(/\{([^{}]+)\}/g, (_token, key) => {
  requireMatch(bindings.has(key), 'This command needs a separately reviewed resource adapter');
  return bindings.get(key);
 }));
 requireMatch(isDeepStrictEqual(draft.argv, expected), 'The target arguments differ from the selected production command');
 const caseOutputs = referenceCase.expected_outputs;
 const outputEntries = Object.entries(draft.outputs);
 requireMatch(caseOutputs.length === outputEntries.length && outputEntries.every(([port, output]) => {
  const criteria = draft.test?.outputs?.[port];
  const explicitCheck = sha256.test(criteria?.sha256) || typeof criteria?.contains === 'string' && criteria.contains.trim().length > 0 ||
   Array.isArray(criteria?.json_keys) && criteria.json_keys.length > 0 || Number.isSafeInteger(criteria?.min_bytes) && criteria.min_bytes > 1;
  return explicitCheck && caseOutputs.some(item => item.path === output.filename && item.format === output.format);
 }), 'Use the reference case output filenames and formats with an explicit target output assertion for each');
 const supportRoot = source.kind === 'git' ? repository.path : path.posix.dirname(feature.entrypoint);
 const supportFiles = (draft.support_files || []).map(name => [name, fileAt(record, path.posix.join(supportRoot, name))]);
 const support = Object.fromEntries(supportFiles.map(([name, file]) => [name, file.sha256]));
 const gitObjects = {};
 if (source.kind === 'git' && gitObject.test(entrypoint.git_object || '')) {
  gitObjects.entrypoint_git_object = entrypoint.git_object;
  if (supportFiles.every(([, file]) => gitObject.test(file.git_object || ''))) {
   gitObjects.support_git_objects = Object.fromEntries(supportFiles.map(([name, file]) => [name, file.git_object]));
  }
 }
 return {
  package_id: record.package_id, package_version: record.package_version, manifest_sha256: record.manifest_sha256,
  source_commit: record.source_commit, function_id: feature.id, reference_test_case_id: referenceCase.id,
  entrypoint: entrypoint.sha256, support, ...gitObjects,
  ...Object.keys(parameterSpecs).length ? {parameter_specs: parameterSpecs} : {}
 };
}
