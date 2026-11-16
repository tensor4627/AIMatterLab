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
 assert.deepEqual(legacy.outputs,[]);assert.equal(legacy.resources[0].label,'model.xyz');
});
