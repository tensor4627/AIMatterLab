import {portableResourcePath, validateToolPackage} from './tool-package.mjs';

/** Internal AimLab tool declaration (source-of-truth lives in the tool repository). */
export const AIMLAB_DIRECTORY = 'aimlab-tools';
export const AIMLAB_FILES = Object.freeze({
  manifest: 'aimlab-tools/manifest.json',
  skill: 'aimlab-tools/SKILL.md',
  manual: 'aimlab-tools/manual.md',
  tests: 'aimlab-tools/tests',
  introduction: 'aimlab-tools/tests/README.md'
});

const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const FUNCTION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const fail = (where, message) => { throw Error('aimlab_tools ' + where + ': ' + message); };
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const requireObject = (value, where) => { if (!isObject(value)) fail(where, 'object required'); return value; };
const requireArray = (value, where) => { if (!Array.isArray(value)) fail(where, 'array required'); return value; };
const requireText = (value, where) => { if (typeof value !== 'string' || !value.trim()) fail(where, 'non-empty string required'); return value; };

function exactFields(value, allowed, where) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(where, 'unknown field ' + key);
}
function canonicalPath(value, where) {
  try { return portableResourcePath(value); } catch (error) { fail(where, 'portable repository-relative path required'); }
}
function rejectAimlabWrapperOutsideTests(value, where) {
  if (value.startsWith(AIMLAB_DIRECTORY + '/') && !value.startsWith(AIMLAB_FILES.tests + '/')) {
    fail(where, 'aimlab-tools entrypoint must be under ' + AIMLAB_FILES.tests + '/');
  }
}

/**
 * Map a repository-relative declaration path into the equivalent package-relative path.
 * `aimlab-tools/tests/**` -> `<id>-tests/**`; other `aimlab-tools/**` -> package root; other repository paths -> `<id>/**`.
 */
export function mapAimlabToolPath(id, value) {
  canonicalPath(value, 'path');
  if (value.startsWith(AIMLAB_DIRECTORY + '/')) {
    const rest = value.slice(AIMLAB_DIRECTORY.length + 1);
    return rest.startsWith('tests/') ? id + '-tests/' + rest.slice('tests/'.length) : rest;
  }
  return id + '/' + value;
}

function packageShape(manifest, {commit = '0'.repeat(40)} = {}) {
  const id = manifest.id;
  const guidance = manifest.guidance || {};
  return {
    schema_version: 1,
    id,
    name: manifest.name,
    repository: {path: id, commit},
    manual: 'manual.md',
    guidance: {
      delivery: 'SKILL.md',
      installation: (guidance.installation || []).map(file => mapAimlabToolPath(id, file)),
      configuration: (guidance.configuration || []).map(file => mapAimlabToolPath(id, file))
    },
    environment: manifest.environment,
    functions: manifest.functions.map(item => ({...item, entrypoint: mapAimlabToolPath(id, item.entrypoint)})),
    tests: {
      directory: id + '-tests',
      introduction: mapAimlabToolPath(id, AIMLAB_FILES.introduction),
      cases: manifest.tests.cases.map(item => ({
        ...item,
        directory: mapAimlabToolPath(id, item.directory),
        instructions: mapAimlabToolPath(id, item.instructions),
        entrypoint: mapAimlabToolPath(id, item.entrypoint),
        resources: item.resources.map(file => mapAimlabToolPath(id, file))
      }))
    }
  };
}

/** Validate an internal AimLab declaration and reuse the shared `tool.json` v1 contract. */
export function validateAimlabTools(value) {
  const manifest = requireObject(value, 'manifest');
  exactFields(manifest, ['schema_version', 'id', 'name', 'environment', 'functions', 'tests', 'guidance'], 'manifest');
  if (manifest.schema_version !== 1) fail('manifest.schema_version', 'expected 1');
  const id = requireText(manifest.id, 'manifest.id');
  if (!ID_PATTERN.test(id) || id.length > 63) fail('manifest.id', 'invalid tool id');
  requireText(manifest.name, 'manifest.name');
  requireObject(manifest.environment, 'manifest.environment');

  if (manifest.guidance !== undefined) {
    const guidance = requireObject(manifest.guidance, 'manifest.guidance');
    exactFields(guidance, ['installation', 'configuration'], 'manifest.guidance');
    for (const key of ['installation', 'configuration']) {
      const files = guidance[key];
      if (files === undefined) continue;
      requireArray(files, 'manifest.guidance.' + key);
      for (const [index, file] of files.entries()) {
        const where = 'manifest.guidance.' + key + '[' + index + ']';
        canonicalPath(file, where);
        if (!file.startsWith(AIMLAB_DIRECTORY + '/') || file.startsWith(AIMLAB_FILES.tests + '/')) {
          fail(where, 'must be under aimlab-tools/ and outside aimlab-tools/tests/');
        }
      }
    }
  }

  requireArray(manifest.functions, 'manifest.functions');
  if (!manifest.functions.length) fail('manifest.functions', 'non-empty array required');
  const functionIds = new Set();
  for (const [index, item] of manifest.functions.entries()) {
    const where = 'manifest.functions[' + index + ']';
    requireObject(item, where);
    exactFields(item, ['id', 'name', 'description', 'engine', 'entrypoint', 'inputs', 'outputs', 'parameters', 'operation', 'tests'], where);
    const functionId = requireText(item.id, where + '.id');
    if (!FUNCTION_ID_PATTERN.test(functionId) || functionId.length > 96) fail(where + '.id', 'invalid function id');
    if (functionIds.has(functionId)) fail(where + '.id', 'duplicate function id');
    functionIds.add(functionId);
    requireText(item.name, where + '.name');
    requireText(item.description, where + '.description');
    const entrypoint = requireText(item.entrypoint, where + '.entrypoint');
    canonicalPath(entrypoint, where + '.entrypoint');
    rejectAimlabWrapperOutsideTests(entrypoint, where + '.entrypoint');
    requireObject(item.operation, where + '.operation');
    requireArray(item.tests, where + '.tests');
    if (!item.tests.length) fail(where + '.tests', 'non-empty array required');
  }

  const tests = requireObject(manifest.tests, 'manifest.tests');
  exactFields(tests, ['cases'], 'manifest.tests');
  requireArray(tests.cases, 'manifest.tests.cases');
  if (!tests.cases.length) fail('manifest.tests.cases', 'non-empty array required');
  for (const [index, item] of tests.cases.entries()) {
    const where = 'manifest.tests.cases[' + index + ']';
    requireObject(item, where);
    exactFields(item, ['id', 'function_id', 'directory', 'instructions', 'entrypoint', 'resources', 'expected_outputs', 'pass_criteria'], where);
    requireText(item.id, where + '.id');
    requireText(item.function_id, where + '.function_id');
    const directory = requireText(item.directory, where + '.directory');
    canonicalPath(directory, where + '.directory');
    if (!directory.startsWith(AIMLAB_FILES.tests + '/')) fail(where + '.directory', 'must be under ' + AIMLAB_FILES.tests + '/');
    const instructions = requireText(item.instructions, where + '.instructions');
    canonicalPath(instructions, where + '.instructions');
    if (!instructions.startsWith(directory + '/') || !instructions.endsWith('.md')) fail(where + '.instructions', 'must be Markdown inside the case directory');
    const entrypoint = requireText(item.entrypoint, where + '.entrypoint');
    canonicalPath(entrypoint, where + '.entrypoint');
    rejectAimlabWrapperOutsideTests(entrypoint, where + '.entrypoint');
    requireArray(item.resources, where + '.resources');
    for (const [resourceIndex, resource] of item.resources.entries()) {
      canonicalPath(resource, where + '.resources[' + resourceIndex + ']');
      if (resource === AIMLAB_DIRECTORY || resource === AIMLAB_FILES.tests) {
        fail(where + '.resources[' + resourceIndex + ']', 'declare files or subdirectories, not the whole aimlab-tools tree');
      }
    }
    requireArray(item.expected_outputs, where + '.expected_outputs');
    if (!item.expected_outputs.length) fail(where + '.expected_outputs', 'non-empty array required');
    requireArray(item.pass_criteria, where + '.pass_criteria');
    if (!item.pass_criteria.length) fail(where + '.pass_criteria', 'non-empty array required');
  }

  try { validateToolPackage(packageShape(manifest)); } catch (error) { fail('manifest', error.message); }
  return manifest;
}

/** Repository-relative files and directories declared by a valid internal declaration. */
export function aimlabToolRepoPaths(manifest) {
  const paths = [AIMLAB_FILES.manifest, AIMLAB_FILES.skill, AIMLAB_FILES.manual, AIMLAB_FILES.introduction];
  for (const item of manifest.functions) paths.push(item.entrypoint);
  for (const item of manifest.tests.cases) paths.push(item.directory, item.instructions, item.entrypoint, ...item.resources);
  const guidance = manifest.guidance || {};
  for (const key of ['installation', 'configuration']) for (const file of guidance[key] || []) paths.push(file);
  return [...new Set(paths)].sort();
}

/** Validated declaration converted into the shared package contract shape (no filesystem access). */
export function aimlabToolPackageShape(value, options = {}) {
  return packageShape(validateAimlabTools(value), options);
}
