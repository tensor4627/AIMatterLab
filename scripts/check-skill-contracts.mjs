import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {selectScientificFunctions} from '../agent/skills/scientific-context.mjs';
import {SCIENTIFIC_TOOL_ACCESS} from '../agent/tools/private-cv-access.mjs';
import {createManagedComputeResources} from '../backend/main/compute/managed-compute-resources.mjs';
import {createManagedComputeTools} from '../agent/tools/managed-compute-tools.mjs';
import {baseWorkspaceTool} from '../backend/main/workspace/base-workspace.mjs';
import {copyProjectInputsTool} from '../backend/main/workspace/copy-project-inputs.mjs';
import {currentPairTool} from '../agent/tools/current-pair-tool.mjs';
import {MaterialsProject} from '../backend/main/tools/materials-project.mjs';
import {createResourceToolController} from '../backend/main/compute/resource-tools.mjs';
import {resourceSessionWorkspaceTool} from '../backend/main/workspace/resource-workspace.mjs';
import {ProjectSkills} from '../agent/skills/project-skills.mjs';
import {softwareDocDefinitions} from '../backend/main/tools/public-software-docs.mjs';

const documentedControls = [
  ['studio-compute-workflow/SKILL.md', 'frontend/features/terminal/SshConnectionPanel.tsx', ['登录完成，交由 AIMatterLab 管理']],
  ['studio-compute-workflow/references/base-workspace.md', 'frontend/features/compute/ComputeConnectionChooser.tsx', ['编辑连接', '高级：基础工作区']],
  ['studio-compute-workflow/references/job-service-connection.md', 'frontend/features/compute/ComputeConnectionChooser.tsx', ['高级：Python 环境']],
  ['studio-workflow-roadmap/SKILL.md', 'frontend/features/workflows/RoadmapExecutionPanel.tsx', ['按流程图执行', '核对执行快照', '确认并执行整张图']],
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function checkProductName(text, document) {
  // Keep persisted IDs, paths, environment variables and upstream proper names intact.
  const obsolete = /(?<!Visual )(?<![A-Za-z0-9])Studio(?![A-Za-z0-9])|(?:NO_STUDIO_ADAPTER|_STUDIO_ADAPTER)\b/;
  assert.doesNotMatch(text, obsolete, 'Obsolete product name in ' + document);
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
  const desktopNames = [...MaterialsProject.prototype.tools(), baseWorkspaceTool, copyProjectInputsTool, currentPairTool].map(tool => tool.name);
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
  for (const name of entries) {
    assert(documents.has(name), 'Missing bundled skill entry ' + name);
    assert.equal(/^name: (.+)$/m.exec(documents.get(name).text)?.[1].trim(), name.split('/')[0], 'Wrong skill identity in ' + name);
  }
  const releaseSources = JSON.parse(read('installation/tool-sources.json'));
  let sourceReceipts = 0;
  for (const [name, document] of documents) {
    checkProductName(document.text, name);
    if (!name.endsWith('.json')) continue;
    const reference = JSON.parse(document.text);
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
  checkProductName(read('agent/context/AGENTS.md'), 'agent/context/AGENTS.md');
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
  return {skills: entries.size, catalogRoutes: routes.size, engines: Object.keys(engines).length, productSourceReceipts: sourceReceipts};
}
