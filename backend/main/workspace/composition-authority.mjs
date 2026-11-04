import {isDeepStrictEqual} from 'node:util';
import {parameterValue,setParameter} from '../../../shared/task-fields.mjs';
const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const declared=(entry,catalog)=>entry&&hash(entry.source?.sha256)&&catalog.source?.files?.[entry.source?.name]===entry.source.sha256;
const humanRevision=(task,key)=>Math.max(0,...Object.entries(task.manualEdits||{}).filter(([field])=>field===key||field.startsWith(key+'.')||key.startsWith(field+'.')).map(([,revision])=>revision));
function assign(object,path,value){let target=object;for(const key of path.slice(0,-1))target=target[key];target[path.at(-1)]=structuredClone(value);}
export function sourceAuthority(task,result,origin='read'){
 const c=result.composition,g=result.graph,catalog=result.catalog;
 if(c?.status!=='rendered'||c.render_blocked||!hash(c.graph_sha256)||!hash(c.source_sha256)||g?.parameter_format!=='structured-v1'||!catalog?.catalog)return null;
 const old=task.authoring?.compositionAuthority;
 if(old&&old.graphSha===c.graph_sha256&&old.sourceSha===c.source_sha256&&isDeepStrictEqual(old.graph,g))return old;
 const fields=[],parameters=task.parameters||{},nodes=g.nodes||[];
 const add=(key,targets,value)=>{if(parameterValue(parameters,key)!==undefined)fields.push({key,targets,value:structuredClone(value)});};
 const biases=nodes.filter(n=>n.kind==='bias');
 if(biases.length===1){const bias=biases[0],index=nodes.indexOf(bias),entry=catalog.catalog.bias?.find(e=>e.name===bias.class_name);
  if(declared(entry,catalog)&&(!parameters.bias?.class_name||parameters.bias.class_name===bias.class_name))for(const param of entry.params||[])if(Object.hasOwn(bias.params||{},param.name))add('bias.'+param.name,[{path:['nodes',index,'params',param.name]}],bias.params[param.name]);
 }
 for(const [key,name]of [['cutoff','cutoff'],['technical.max_neighbors','max_neighbors'],['technical.max_cv_nums','max_cv_nums'],['technical.artifact_formats','artifact_formats']])if(Object.hasOwn(g.settings||{},name))add(key,[{path:['settings',name]}],g.settings[name]);
 // This legacy projection is deliberately closed: ordered native scalar torsions,
 // with explicit identity reshape and one collector. Other CVs retain their own graph.
 const collectors=nodes.filter(n=>n.kind==='collect');
 if(collectors.length===1){const incoming=(g.edges||[]).filter(e=>e.target.node===collectors[0].id&&e.target.port==='value'),groups=[],targets=[];let exact=!!incoming.length;
  for(const edge of incoming){const shape=nodes.find(n=>n.id===edge.source.node),links=(g.edges||[]).filter(e=>e.target.node===shape?.id&&e.target.port==='value'),cv=links.length===1?nodes.find(n=>n.id===links[0].source.node):null,entry=catalog.catalog.cv?.find(e=>e.name===cv?.class_name),atomKey=cv?.class_name==='Torsion'?'idx':'atom_idx';
   if(shape?.kind!=='reduce'||shape.params?.operation!=='identity'||cv?.kind!=='cv'||!['PeriodicTorsion','Torsion'].includes(cv.class_name)||!declared(entry,catalog)||!entry.params?.some(p=>p.name===atomKey)||!Array.isArray(cv.params?.[atomKey])||cv.params[atomKey].length!==4||cv.params[atomKey].some(v=>!Number.isSafeInteger(v)||v<0)){exact=false;break;}
   groups.push(cv.params[atomKey]);targets.push({path:['nodes',nodes.indexOf(cv),'params',atomKey]});
  }
  if(exact){if(parameters.engine==='pygas.build'&&Array.isArray(parameters.atom_selection)&&parameters.atom_selection.length===groups.length&&parameters.atom_selection.every(group=>Array.isArray(group)&&group.length===4))add('atom_selection',targets.map((t,index)=>({...t,index})),groups);for(let i=0;i<groups.length;i++)add('cv.atom'+i,[targets[i]],groups[i]);}
 }
 return {schema:1,origin,parameterRevision:task.parameterRevision||0,lastHumanRevision:origin==='human'?(task.parameterRevision||0):Math.max(old?.lastHumanRevision||0,task.authoring?.lastHumanCompositionRevision||0),graphSha:c.graph_sha256,sourceSha:c.source_sha256,graph:structuredClone(g),fields};
}
export function synchronizeGraphMirrors(task){
 const a=task.authoring?.compositionAuthority;if(!a)return task;
 for(const field of a.fields){if(humanRevision(task,field.key)>a.parameterRevision)continue;task.parameters=setParameter(task.parameters||{},field.key,field.value);if(task.manualEdits)delete task.manualEdits[field.key];}
 // Pair receipt is engineering identity. Retain unknown properties for strict checks.
 if(task.parameters?.composition&&typeof task.parameters.composition==='object'&&!Array.isArray(task.parameters.composition))task.parameters={...task.parameters,composition:{...task.parameters.composition,...task.composition}};
 return task;
}
export function reviewGraph(task){
 const a=task.authoring?.compositionAuthority;if(!a)return null;
 const graph=structuredClone(a.graph),writes=new Map();
 for(const field of a.fields){if(humanRevision(task,field.key)<=a.parameterRevision)continue;
  const value=parameterValue(task.parameters,field.key);
  for(const target of field.targets){const next=target.index===undefined?value:value?.[target.index],key=JSON.stringify(target.path);if(next===undefined)throw Error('Incomplete graph-owned human field: '+field.key);if(writes.has(key)&&!isDeepStrictEqual(writes.get(key),next))throw Error('Conflicting explicit graph-owned human fields; resolve them in the CV editor');writes.set(key,next);assign(graph,target.path,next);}
 }
 return graph;
}
export function protectGraphMirrors(task,parameters){
 const a=task.authoring?.compositionAuthority;if(!a)return parameters;
 for(const field of a.fields)if(humanRevision(task,field.key)<=a.parameterRevision)parameters=setParameter(parameters,field.key,field.value);
 if(task.parameters?.composition)parameters={...parameters,composition:structuredClone(task.parameters.composition)};
 return parameters;
}
/** Snapshot graph-owned facts without composing Agent instructions. */
export function graphAuthorityFacts(task){
 const a=task.authoring?.compositionAuthority;
 if(!a){const draft=task.authoring?.compositionIntent;return draft?{kind:'partial',intent:structuredClone(draft)}:null;}
 return {kind:'saved',authority:structuredClone({origin:a.origin,parameterRevision:a.parameterRevision,graph_sha256:a.graphSha,source_sha256:a.sourceSha,graph:a.graph,currentGraphOwnedMirrors:a.fields.map(f=>({key:f.key,value:parameterValue(task.parameters,f.key)}))})};
}
