import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowExperienceEnvironment} from '../helpers/workflow-experience-components.mjs';
import {compileToolGroup} from '../../contracts/tools/tool-group.mjs';
import {toolDefinition,groupDefinition,packageVersion} from '../helpers/tool-definitions.mjs';
import {groupRecord,toolWorkflowsHarness} from '../helpers/tool-workflows-components.mjs';
import fixture from '../fixtures/workflow-roadmap.json' with {type:'json'};

const {layoutRoadmap,layoutFrozenGroup,legacyRoadmap}=workflowExperienceEnvironment().load('frontend/features/workflows/roadmap-layout.ts');
test('frozen group bindings use compiled ports and final product aliases',()=>{
 const group=compileToolGroup(groupDefinition(),()=>({version:packageVersion,manifest:toolDefinition()}));
 const drawing=layoutFrozenGroup(group),second=drawing.nodes.find(node=>node.key==='step:second');
 assert.deepEqual(drawing.edges.map(({from,to})=>[from,to]),[['input:r0','step:first'],['step:first','step:second'],['step:second','output:r2']]);
 assert(second.notes.includes(packageVersion));assert.equal(drawing.nodes.find(node=>node.kind==='output').label,'final');
 assert.deepEqual(drawing.findings,[]);
});
test('ordering-only frozen CPU reference edges remain ordering notes',()=>{
 const graph=layoutFrozenGroup(groupRecord().compiled);
 assert.equal(graph.nodes.filter(node=>node.kind==='step').length,2);
 assert.equal(graph.edges.length,1);assert.equal(graph.edges[0].from,'step:step-2');
 assert(graph.nodes.find(node=>node.key==='step:step-2').notes.some(note=>note.includes('step-1')));
});
test('explicit selection offers exactly the inspected frozen group and disconnect clears the preview',async()=>{
 const views=[],h=toolWorkflowsHarness({properties:{onFrozenGroup:value=>views.push(value)}});
 await h.flush();assert.equal(views.at(-1),null);
 h.change('工具组定义','cpu-sequence');await h.flush();
 assert.deepEqual(views.at(-1).record.compiled,groupRecord().compiled);assert.equal(views.at(-1).taskId,'task-A');
 h.update({worker:false});await h.flush();assert.equal(views.at(-1),null);h.unmount();
});
test('resource edges keep individual port coordinates and legacy projections stay partial',()=>{
 const graph=layoutRoadmap(fixture,{});
 assert.equal(graph.edges.length,10);
 const md=graph.nodes.find(node=>node.key==='step:md');
 assert(md.runtime.top&&md.runtime.bottom);
 assert.equal(new Set(graph.edges.filter(edge=>edge.to===md.key).map(edge=>edge.path)).size,3);
 assert(graph.nodes.find(node=>node.key==='output:report').notes.some(note=>note.includes('初始结构')));
 assert.equal(legacyRoadmap({}),null);
 const legacy=legacyRoadmap({engine:'gpumd.md',files:['folder/model.xyz']});
 assert.deepEqual(legacy.outputs,[]);assert.equal(legacy.resources[0].label,'folder/model.xyz');
 assert.deepEqual(layoutRoadmap(legacy,{},'legacy').nodes[0].caption.lines,['model.xyz']);
});

test('short labels stay separate from full names and each intermediate is named once at its producer',()=>{
 const graph=layoutRoadmap(fixture,{});
 assert.equal(graph.nodes.find(n=>n.key==='output:thermo').label,'温度与总能量的热力学时间序列');
 assert.deepEqual(graph.nodes.find(n=>n.key==='output:thermo').caption.lines,['热力学']);
 assert.deepEqual(graph.nodes.find(n=>n.key==='step:md').runtime.top.caption.lines,['NEP']);
 assert.equal(graph.nodes.find(n=>n.key==='step:md').runtime.top.id,'potential');
 assert.deepEqual(new Set(graph.handoffs.map(h=>h.resource)),new Set(['msd','rdf']));
 const branched=structuredClone(fixture);
 branched.steps.find(s=>s.id==='rdf').inputs.push({port:'extra',resource:'msd'});
 assert.equal(layoutRoadmap(branched,{}).handoffs.filter(h=>h.resource==='msd').length,1);
});

test('older paths, repeated names, long explicit aliases and a missing goal source remain distinguishable',()=>{
 const plan=legacyRoadmap({engine:'gpumd.md',files:['left/model.xyz','right/model.xyz']});
 const graph=layoutRoadmap(plan,{},'legacy'),files=graph.nodes.filter(n=>n.kind==='input');
 assert.deepEqual(files.map(n=>n.caption.lines.join(' ')),['model.xyz · 1','model.xyz · 2']);
 assert.deepEqual(files.map(n=>n.label),['left/model.xyz','right/model.xyz']);
 const partial={schema_version:1,resources:[{id:'orphan',label:'待补齐的结果',short_label:'WWWWWWWWWWWWWWWW',basis:'user'}],
  inputs:[],steps:[],outputs:['orphan']};
 const pending=layoutRoadmap(partial,{});
 assert.equal(pending.nodes.find(n=>n.kind==='output').caption.lines.join(''),'WWWWWWWWWWWWWWWW');
 assert.deepEqual(pending.edges.map(e=>[e.from,e.to]),[['missing:orphan','output:orphan']]);
});
