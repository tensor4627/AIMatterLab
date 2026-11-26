import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {selectScientificFunctions} from '../agent/skills/scientific-context.mjs';
import {releaseToolNameKey, releaseToolNames} from '../contracts/tools/release-tool-sources.mjs';
import {SCIENTIFIC_TOOL_ACCESS} from '../agent/tools/private-cv-access.mjs';
import {createManagedComputeResources} from '../backend/main/compute/managed-compute-resources.mjs';
import {createManagedComputeTools} from '../agent/tools/managed-compute-tools.mjs';
import {baseWorkspaceTool} from '../backend/main/workspace/base-workspace.mjs';
import {copyProjectInputsTool} from '../backend/main/workspace/copy-project-inputs.mjs';
import {workflowInputSourceTools} from '../backend/main/workspace/workflow-input-sources.mjs';
import {currentPairTool} from '../agent/tools/current-pair-tool.mjs';
import {MaterialsProject} from '../backend/main/tools/materials-project.mjs';
import {createResourceToolController} from '../backend/main/compute/resource-tools.mjs';
import {resourceSessionWorkspaceTool} from '../backend/main/workspace/resource-workspace.mjs';
import {ProjectSkills} from '../agent/skills/project-skills.mjs';
import {softwareDocDefinitions} from '../backend/main/tools/public-software-docs.mjs';

const documentedControls = [
  ['studio-compute-workflow/SKILL.md', 'frontend/features/terminal/SshConnectionPanel.tsx', ['登录完成，交由 AIMatterLab 管理','交由 AIMatterLab 管理']],
  ['studio-compute-workflow/references/base-workspace.md', 'frontend/features/compute/ComputeConnectionChooser.tsx', ['编辑连接', '高级：基础工作区']],
  ['studio-compute-workflow/references/job-service-connection.md', 'frontend/features/compute/ComputeConnectionChooser.tsx', ['高级：Python 环境']],
  ['studio-workflow-roadmap/SKILL.md', 'frontend/features/workflows/RoadmapExecutionPanel.tsx', ['按流程图执行', '核对执行快照', '确认并执行整张图']],
  ['studio-main-agent/references/workbench.md', 'frontend/features/tools/ToolPackagesPanel.tsx', ['随版本收录的源码仓库','选择并检查工具包','登记此工具包']],
  ['studio-main-agent/references/workbench.md', 'frontend/features/tools/ResourceToolSetup.tsx', ['查看执行技能','补写执行技能']],
  ['studio-main-agent/references/workbench.md', 'frontend/features/compute/ComputeResourceConsole.tsx', ['配置此资源的科学工具','远端总工作区']],
  ['studio-tool-onboarding/SKILL.md', 'frontend/app/App.tsx', ['第三方工具包', '配置资源工具']],
  ['studio-tool-onboarding/SKILL.md', 'frontend/features/tools/ToolPackagesPanel.tsx', ['选择并检查工具包', '登记此工具包']],
  ['studio-tool-onboarding/SKILL.md', 'frontend/features/tools/SkillsWorkbench.tsx', ['高级：手动附加本地技能']],
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function checkProductName(text, document) {
  // Keep persisted IDs, paths, environment variables and upstream proper names intact.
  const obsolete = /(?<!Visual )(?<![A-Za-z0-9])Studio(?![A-Za-z0-9])|(?:NO_STUDIO_ADAPTER|_STUDIO_ADAPTER)\b/;
  assert.doesNotMatch(text, obsolete, 'Obsolete product name in ' + document);
}

export function checkReleaseSources(sources, routes) {
  assert(Array.isArray(sources) && sources.length, 'Missing release tool source catalog');
  assert(routes.has('software.catalog'), 'Missing runtime route for release source lookup');
  const ids = new Set(), names = new Map();
  for (const source of sources) {
    const {id, name, url, branch, guide, validated_commit, integration_status, guidance_functions, aliases} = source;
    assert(/^[a-z][a-z0-9-]*$/.test(id) && !ids.has(id), 'Invalid or duplicate release tool ID: ' + id);
    ids.add(id);
    assert(typeof name === 'string' && name.trim(), id + ': invalid display name');
    assert(aliases === undefined || Array.isArray(aliases) && aliases.every(value => typeof value === 'string' && value.trim()), id + ': invalid alias');
    for (const label of releaseToolNames(source)) {
      const key = releaseToolNameKey(label);
      assert(key && (!names.has(key) || names.get(key) === id), id + ': ambiguous release tool name ' + label);
      names.set(key, id);
    }
    const repository = new URL(url);
    assert.equal(repository.protocol, 'https:', id + ': repository must use HTTPS');
    assert(!repository.username && !repository.password && !repository.search && !repository.hash, id + ': repository must be a public location');
    assert(typeof branch === 'string' && branch.trim(), id + ': missing branch');
    assert(/^[a-f0-9]{40}$/.test(validated_commit), id + ': missing reviewed commit');
    assert(typeof guide === 'string' && guide.split('/').every(part => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..'), id + ': expected a repository-relative guide');
    assert(['native_adapter', 'source_only'].includes(integration_status), id + ': declare release integration status');
    assert(Array.isArray(guidance_functions) && guidance_functions.length && new Set(guidance_functions).size === guidance_functions.length &&
      guidance_functions.every(route => routes.has(route)), id + ': assign known runtime guidance functions');
    const describesAdapter = guidance_functions.some(route => routes.get(route).engines.length);
    assert.equal(describesAdapter, integration_status === 'native_adapter', id + ': release status and linked guidance disagree on built-in adapters');
  }
}

function checkSourceAnchors(projectDir, document, text) {
  const repositoryPath = /`((?:agent|backend|contracts|desktop|developer|docs|frontend|installation|scripts|tests)\/[a-zA-Z0-9_./-]+)`/g;
  for (const [, anchor] of text.matchAll(repositoryPath)) {
    assert(!anchor.split('/').includes('..') && fs.existsSync(path.join(projectDir, anchor)), document + ': stale source anchor ' + anchor);
  }
}

export function checkSkillContracts({projectDir, map, documents}) {
  const read = name => fs.readFileSync(path.join(projectDir, name), 'utf8');
  const engines = JSON.parse(read('contracts/tools/engine-contracts.json')).engines;
  const resources = createManagedComputeResources({terminal: {connections: {}}});
  const managedTools = createManagedComputeTools({resources}).tools();
  // Read the worker's declarative name → (method, path, schema) table, without
  // starting a Python worker on the Windows packager or the tag runner.
  const workerTable = /^TOOL_ROUTES = \{([\s\S]*?)^\}/m.exec(read('backend/worker/studio_worker/transport/mcp.py'));
  assert(workerTable, 'Worker MCP tool registry changed');
  const workerNames = [...workerTable[1].matchAll(/["']([a-z][a-z0-9_]*)["']\s*:\s*\(\s*["'](?:GET|POST)["']/g)].map(match => match[1]);
  const desktopNames = [...MaterialsProject.prototype.tools(), baseWorkspaceTool, copyProjectInputsTool, ...workflowInputSourceTools, currentPairTool].map(tool => tool.name);
  for (const match of read('desktop/main.mjs').matchAll(/const\s+(?:proposalTool|privateReader)\s*=\s*\{\s*name\s*:\s*["']([^"']+)["']/g)) desktopNames.push(match[1]);
  const knownTools = new Set([...workerNames, ...desktopNames].filter(name => Object.hasOwn(SCIENTIFIC_TOOL_ACCESS, name)));
  for (const tool of [...managedTools,...createResourceToolController({}).tools(),resourceSessionWorkspaceTool,...ProjectSkills.prototype.tools(),...softwareDocDefinitions]) knownTools.add(tool.name);
  const routes = new Map(map.functions.map(route => [route.id, route]));
  for (const route of routes.values()) {
    checkProductName([route.title, route.status, route.adaptation].join(' '), route.id);
    for (const engine of route.engines) assert(Object.hasOwn(engines, engine), route.id + ': unknown engine ' + engine);
    for (const tool of route.tools || []) assert(knownTools.has(tool), route.id + ': unknown tool ' + tool);
  }
  for (const engine of Object.keys(engines)) {
    const selected = selectScientificFunctions({parameters: {engine}});
    assert(selected.some(id => routes.get(id)?.engines.includes(engine)), 'Missing current engine route for ' + engine);
  }

  const entries = new Set(map.skills.filter(skill => skill.source === 'studio').map(skill => skill.folder + '/SKILL.md'));
  const entryByteBudget = 5 * 1024;
  let largestEntryBytes = 0;
  for (const name of entries) {
    assert(documents.has(name), 'Missing bundled skill entry ' + name);
    const entry = documents.get(name);
    assert.equal(/^name: (.+)$/m.exec(entry.text)?.[1].trim(), name.split('/')[0], 'Wrong skill identity in ' + name);
    assert(entry.bytes <= entryByteBudget, name + ': keep the entry within 5 KiB and move mode-specific detail to references');
    largestEntryBytes = Math.max(largestEntryBytes, entry.bytes);
  }
  const releaseSources = JSON.parse(read('installation/tool-sources.json'));
  checkReleaseSources(releaseSources, routes);
  const nebReference = 'studio-neb-workflow/references/neb.json';
  assert(documents.has(nebReference), 'Missing bundled NEB reference ' + nebReference);
  let sourceReceipts = 0;
  for (const [name, document] of documents) {
    checkProductName(document.text, name);
    if (name.endsWith('.md')) checkSourceAnchors(projectDir, name, document.text);
    if (!name.endsWith('.json')) continue;
    const reference = JSON.parse(document.text);
    if (name === nebReference) {
      const contract = engines['gpumd.neb'];
      assert.deepEqual(reference.required_inputs, contract.required_inputs, name + ': required_inputs differs from the gpumd.neb engine contract');
      assert.deepEqual(reference.parameter_groups?.neb, contract.parameter_groups.neb, name + ': parameter_groups.neb differs from the gpumd.neb engine contract');
    }
    const receipt = reference.source_receipt;
    if (receipt?.release_source) {
      const baseline = releaseSources.find(source => source.name === receipt.release_source.name);
      assert.equal(baseline?.validated_commit, receipt.release_source.commit, name + ': review the changed release source');
    }
    if (receipt?.rule_input_encoding === 'UTF-8 JSON.stringify(rules), in document key order') {
      assert.equal(sha256(JSON.stringify(reference.rules)), receipt.rule_input_sha256, name + ': rule digest differs');
    }
    for (const row of receipt?.local_files || []) {
      if (!['studio', 'studio-worker'].includes(row.source_id)) continue;
      const root = row.source_id === 'studio-worker' ? path.join(projectDir, 'backend/worker') : projectDir;
      const source = fs.readFileSync(path.join(root, row.path));
      assert.equal(sha256(source), row.sha256, name + ': review the changed source ' + row.path);
      assert.equal(source.length, row.bytes, name + ': stale source size for ' + row.path);
      const lines = source.toString('utf8').trimEnd().split('\n').length;
      assert(row.line_ranges?.length && row.line_ranges.every(([a,b]) => a >= 1 && a <= b && b <= lines),
        name + ': invalid evidence lines for ' + row.path);
      sourceReceipts++;
    }
  }
  const promptPath = 'agent/context/AGENTS.md';
  const startup = read(promptPath);
  const startupBytes = Buffer.byteLength(startup.replaceAll('\r\n', '\n'));
  checkProductName(startup, promptPath);
  assert(startupBytes <= 5 * 1024, promptPath + ': move detail to a focused reference to preserve the startup budget');
  checkSourceAnchors(projectDir, promptPath, startup);
  for (const [name, component, labels] of documentedControls) {
    const ui = read(component);
    for (const label of labels) {
      assert(documents.get(name)?.text.includes(label) && (ui.includes("'" + label + "'") || ui.includes(JSON.stringify(label))),
        name + ': review the documented control ' + label + ' in ' + component);
    }
  }
  const materials = routes.get('structure.materials-project');
  const guide = documents.get('studio-data-workflow/SKILL.md').text;
  for (const tool of MaterialsProject.prototype.tools()) {
    assert(materials.tools.includes(tool.name) && guide.includes(tool.name), 'Missing Materials Project operation ' + tool.name);
    for (const arg of tool.inputSchema.required) assert(guide.includes('`' + arg + '`'), 'Missing Materials Project argument ' + arg);
  }
  return {skills: entries.size, catalogRoutes: routes.size, engines: Object.keys(engines).length, productSourceReceipts: sourceReceipts,
    releaseSources: releaseSources.length, startupBytes, largestEntryBytes};
}
