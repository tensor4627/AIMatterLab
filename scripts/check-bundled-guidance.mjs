import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {ScientificSkills} from '../agent/skills/scientific-skills.mjs';
import {checkProductName, checkSkillContracts} from './check-skill-contracts.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const prompt = 'agent/context/AGENTS.md';
const mapPath = 'agent/skills/scientific-skill-map.json';
const guidanceModules = [
  prompt, mapPath,
  'agent/context/agent-settings.mjs', 'agent/context/interaction-mode.mjs',
  'agent/context/private-task-context.mjs', 'agent/context/task-turn-context.mjs',
  'agent/providers/dsh-policy.mjs', 'agent/sessions/requests.mjs', 'agent/sessions/conversation-title-reviews.mjs',
  'agent/sessions/resource-routing.mjs', 'agent/sessions/terminal-turn.mjs',
  'agent/skills/skill-context.mjs', 'agent/skills/scientific-context.mjs',
  'agent/skills/scientific-skill-router.mjs', 'agent/skills/scientific-skills.mjs',
  'agent/skills/explicit-setup-stage.mjs', 'agent/skills/read-policy.mjs', 'agent/skills/public-rule-evidence.mjs',
  'agent/skills/policy-io.mjs', 'agent/skills/selected-managed-guidance.mjs', 'agent/skills/managed-tool-context.mjs',
  'agent/tools/tool-failure.mjs', 'contracts/agent/user-message.mjs', 'contracts/agent/conversation-title.mjs', 'backend/main/workspace/task-authoring.mjs',
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function builderAsar(projectDir) {
  const localRequire = createRequire(path.join(projectDir, 'package.json'));
  const builderRequire = createRequire(localRequire.resolve('electron-builder/package.json'));
  const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'));
  return appBuilderRequire('@electron/asar');
}

function inventory(directory) {
  const documents = new Map();
  function walk(prefix) {
    for (const entry of fs.readdirSync(path.join(directory, prefix), {withFileTypes: true})) {
      const name = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(path.join(directory, name));
        documents.set(name, {bytes: bytes.length, sha256: sha256(bytes), text: bytes.toString('utf8')});
      } else throw Error('Unsupported bundled guidance entry: ' + name);
    }
  }
  walk('');
  return documents;
}

async function isolatedCheck(check) {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'aimatterlab-guidance-'));
  try { return await check(directory); }
  finally {
    if (path.dirname(fs.realpathSync(directory)) !== parent) throw Error('Unexpected guidance check directory');
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

async function readBundledRoutes({Service, map, documents, bundledRoot, studioRoot, workerSource, temporary, packaged = false}) {
  // Mixed routes require a registered upstream skill and provider sharing, even
  // for a focused read of an AIMatterLab document. Use only public test entries.
  const bundled = new Set(map.skills.filter(skill => skill.source === 'studio').map(skill => skill.id));
  const routes = map.functions.filter(route => route.skills.some(id => bundled.has(id)));
  const externalIds = new Set(routes.flatMap(route => route.skills.filter(id => !bundled.has(id))));
  const sources = new Map();
  for (const skill of map.skills.filter(skill => externalIds.has(skill.id))) {
    const root = path.join(temporary, 'fixture-sources', skill.source);
    sources.set(skill.source, {id: skill.source, root});
    const folder = path.join(root, 'agents', 'skills', skill.folder);
    fs.mkdirSync(folder, {recursive: true});
    fs.writeFileSync(path.join(folder, 'SKILL.md'), '# Public test fixture for ' + skill.id + '\n');
  }
  const provider = 'deepseek', scope = {provider};
  const settings = {};
  const service = new Service({map, bundledRoot, studioRoot, workerSource, sources: () => [...sources.values()],
    settings: () => settings, setupAllowed: () => true});
  const read = (id, document_id) => service.call('read_scientific_skill', {function_id: id, ...(document_id && {document_id})}, scope);
  const mixed = routes.filter(route => route.skills.some(id => externalIds.has(id)));
  for (const route of mixed) {
    const denied = await read(route.id);
    assert(denied.status === 'permission_required' && !denied.attachments.length, 'Missing source consent check for ' + route.id);
  }
  settings.pygasSkillProviders = [provider];
  settings.scientificSkillProviders = Object.fromEntries([...sources.keys()].filter(id => id !== 'pygas').map(id => [id, [provider]]));
  const catalog = await service.call('scientific_skill_catalog', {}, scope);
  const observed = new Set();
  for (const route of routes) {
    assert(catalog.functions.some(item => item.id === route.id), 'Route absent from catalog: ' + route.id);
    const entry = await read(route.id);
    assert(entry.status === 'passed' && entry.function_id === route.id, 'Cannot read ' + route.id + ': ' + (entry.reason || entry.status));
    assert(entry.text.startsWith('[AIMatterLab scientific function: ' + route.id + ']'), 'Wrong guide header for ' + route.id);
    checkProductName(entry.text, route.id);
    const expectedEntries = route.skills.filter(id => bundled.has(id));
    const attachments = entry.attachments.filter(item => item.source === 'studio');
    assert.deepEqual(attachments.map(a => a.skill), expectedEntries, 'Wrong bundled entries for ' + route.id);
    for (const item of attachments) {
      const expected = documents.get(item.name);
      assert(expected && item.bytes === expected.bytes && item.sha256 === expected.sha256 && entry.text.includes(expected.text),
        'Different skill content for ' + route.id + ' / ' + item.name);
      observed.add(item.name);
    }
    for (const name of entry.document_ids) {
      if (!documents.has(name) || attachments.some(item => item.name === name)) continue;
      const result = await read(route.id, name), expected = documents.get(name);
      const attachment = result.attachments[0];
      assert(result.status === 'passed' && result.function_id === route.id && result.document_id === name &&
        result.attachments.length === 1 && attachment.source === 'studio' && attachment.name === name &&
        attachment.bytes === expected.bytes && attachment.sha256 === expected.sha256 && result.text === expected.text,
        'Cannot read exact reference ' + name + ' for ' + route.id + ': ' + (result.reason || result.status));
      const pins = name.endsWith('.json') ? JSON.parse(expected.text).source_receipt?.local_files || [] : [];
      for (const pin of pins.filter(row => ['studio', 'studio-worker'].includes(row.source_id))) {
        const observation = attachment.source_evidence?.files.find(row => row.path === pin.path && row.source_id === pin.source_id);
        // The application ships built frontend assets, not the original TSX.
        const wanted = packaged && pin.source_id === 'studio' && pin.path.startsWith('frontend/') ? 'blocked' : 'matched';
        assert.equal(observation?.status, wanted, 'Unexpected source evidence for ' + name + ' / ' + pin.path);
      }
      observed.add(name);
    }
  }
  assert.deepEqual([...observed].sort(), [...documents.keys()].sort(), 'Bundled files missing from scientific skill read receipts');
  const manifest = [...observed].sort().map(name => [name, documents.get(name).sha256]);
  return {routes: routes.length, mixedRoutes: mixed.length, documents: observed.size, skillInventorySha256: sha256(JSON.stringify(manifest))};
}

export async function verifyGuidanceSource(projectDir = projectRoot) {
  const bundledRoot = path.join(projectDir, 'agent/builtin-skills');
  const documents = inventory(bundledRoot);
  const map = JSON.parse(fs.readFileSync(path.join(projectDir, mapPath), 'utf8'));
  const contracts = checkSkillContracts({projectDir, map, documents});
  const receipts = await isolatedCheck(temporary => readBundledRoutes({Service: ScientificSkills, map, documents, bundledRoot,
    studioRoot: projectDir, workerSource: path.join(projectDir, 'backend/worker'), temporary}));
  return {...contracts, ...receipts};
}

/** Run the packaged reader against the delivered skill tree and worker files. */
export async function verifyBundledGuidance({projectDir = projectRoot, appOutDir, asar = builderAsar(projectDir)}) {
  const resources = path.join(appOutDir, 'resources');
  const archive = path.join(resources, 'app.asar');
  const readAsar = name => asar.extractFile(archive, path.normalize(name));
  const version = JSON.parse(readAsar('package.json')).version;
  assert.equal(version, JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'))).version, 'Different package version');
  const bundledRoot = path.join(resources, 'studio-skills');
  const documents = inventory(bundledRoot), source = inventory(path.join(projectDir, 'agent/builtin-skills'));
  assert.deepEqual([...documents.keys()].sort(), [...source.keys()].sort(), 'Different skill file inventory');
  for (const [name, item] of source) assert.equal(documents.get(name).sha256, item.sha256, 'Different packaged skill: ' + name);
  const map = JSON.parse(readAsar(mapPath));
  const contracts = checkSkillContracts({projectDir, map, documents});
  for (const [file, shipped] of [['agent/providers/dsh-policy.mjs', 'studio-dsh/dsh-policy.mjs'], ['scripts/localize-skill.mjs', 'studio-tools/localize-skill.mjs']]) {
    assert(fs.readFileSync(path.join(projectDir, file)).equals(fs.readFileSync(path.join(resources, shipped))), 'Different packaged file: ' + shipped);
  }
  return isolatedCheck(async temporary => {
    const studioRoot = path.join(temporary, 'app');
    // Node outside Electron cannot import ASAR modules. Load the exact extracted
    // reader and dependencies in isolation. Include the app's source evidence
    // where shipped. The TSX viewer sources exist only in a source checkout.
    for (const name of [...guidanceModules, 'contracts/tools/engine-contracts.json', 'backend/main/tools/materials-project.mjs']) {
      const bytes = readAsar(name);
      assert(bytes.equals(fs.readFileSync(path.join(projectDir, name))), 'Packaged guidance differs from source: ' + name);
      const target = path.join(studioRoot, name);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, bytes);
    }
    const {ScientificSkills: Service} = await import(pathToFileURL(path.join(studioRoot, 'agent/skills/scientific-skills.mjs')).href);
    const receipts = await readBundledRoutes({Service, map, documents, bundledRoot, studioRoot,
      workerSource: path.join(resources, 'app.asar.unpacked/worker'), temporary, packaged: true});
    return {version, promptSha256: sha256(readAsar(prompt)), guidanceFiles: guidanceModules.length, skillFiles: documents.size, ...contracts, ...receipts};
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 3) throw Error('Usage: node scripts/check-bundled-guidance.mjs --source | <unpacked-app-directory>');
    const result = process.argv[2] === '--source' ? await verifyGuidanceSource() : await verifyBundledGuidance({appOutDir: path.resolve(process.argv[2])});
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('AIMatterLab guidance check failed: ' + error.message);
    process.exitCode = 1;
  }
}
