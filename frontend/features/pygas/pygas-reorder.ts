import type {CanonicalGraph,CatalogEntry,CatalogResponse,GraphEdge,ReorderResult,SourceReceipt} from './pygas-composer-types';
import {catalogGraphContract,catalogProblem,entryFor,portsFor} from './pygas-composer-state';
const stable=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const equal=(left:unknown,right:unknown)=>stable(left)===stable(right);
const endpoint=(edge:GraphEdge)=>edge.source.node+'\0'+edge.source.port;
const declared=(entry:CatalogEntry|undefined)=>!!entry&&entry.semantics?.source===entry.source.name&&entry.semantics.sha256===entry.source.sha256;
const validSize=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0&&Number(value)<=512;
function numericShape(value:unknown,depth=0):string|null{if(depth>4)return null;if(typeof value==='number'&&Number.isFinite(value))return 'n';if(!Array.isArray(value)||!value.length||value.length>512)return null;const shapes=value.map(item=>numericShape(item,depth+1));return shapes.every(shape=>shape!==null&&shape===shapes[0])?'['+value.length+':'+shapes[0]+']':null;}
export function reorderCVBlocks(oldGraph:CanonicalGraph,proposedGraph:CanonicalGraph,collectorId:string,catalog:CatalogResponse,receipt:SourceReceipt):ReorderResult{
 const warnings:string[]=[],base={collectorId,renderBlocked:true,requiresRevalidation:false,reasons:[] as string[],warnings};
 const blocked=(reason:string):ReorderResult=>({...base,status:'blocked',graph:oldGraph,reasons:[reason]});
 if(catalogProblem(catalog,receipt))return blocked('Source receipt or catalog mismatch; no reorder was applied.');
 const contract=catalogGraphContract(catalog,oldGraph.mode);if(!contract)return blocked('The source- and mode-bound graph contract is unavailable.');
 if(oldGraph.mode==='opes')return blocked('OPES settings contain dimension-dependent lists without an approved reorder declaration.');
 if(oldGraph.parameter_format!=='structured-v1')return blocked('Normalize the existing graph to structured-v1 before reordering.');
 if(!Array.isArray(oldGraph.nodes)||oldGraph.nodes.length>128||!Array.isArray(oldGraph.edges)||oldGraph.edges.length>512||!Array.isArray(proposedGraph.nodes)||!Array.isArray(proposedGraph.edges))return blocked('Graph limits or shape are unsupported.');
 if(!equal({...oldGraph,edges:undefined},{...proposedGraph,edges:undefined}))return blocked('Class, atom selection, reduction, settings or another node semantic changed; this is not a pure reorder.');
 const nodes=new Map(oldGraph.nodes.map(node=>[node.id,node]));if(nodes.size!==oldGraph.nodes.length)return blocked('Duplicate node identities are ambiguous.');
 const collector=nodes.get(collectorId);if(collector?.kind!=='collect')return blocked('Choose the actual Collect CV node.');
 const into=(graph:CanonicalGraph)=>graph.edges.filter(edge=>edge.target.node===collectorId&&edge.target.port==='value');
 const beforeEdges=into(oldGraph),afterEdges=into(proposedGraph),other=(graph:CanonicalGraph)=>graph.edges.filter(edge=>edge.target.node!==collectorId||edge.target.port!=='value');
 if(!beforeEdges.length||beforeEdges.length!==afterEdges.length||!equal(other(oldGraph),other(proposedGraph)))return blocked('CV insertion/deletion or unrelated edge edits require a new dimension review.');
 if(new Set(beforeEdges.map(endpoint)).size!==beforeEdges.length||new Set(afterEdges.map(endpoint)).size!==afterEdges.length||!equal(beforeEdges.map(edge=>stable(edge)).sort(),afterEdges.map(edge=>stable(edge)).sort()))return blocked('Components were replaced/duplicated or their identities changed, even if the total dimension is equal.');
 
 const outputs=oldGraph.nodes.filter(node=>node.kind==='output');if(outputs.length!==1)return blocked('Exactly one actual Outputs node is required.');
 const output=outputs[0],outputCV=oldGraph.edges.filter(edge=>edge.target.node===output.id&&edge.target.port==='cv');if(outputCV.length!==1||outputCV[0].source.node!==collectorId||outputCV[0].source.port!=='cv')return blocked('Outputs.cv must come only from the selected Collect CV node.');
 const cache=new Map<string,{size?:number;rank?:number;basis:string;valid:boolean}>();
 function sizeOf(id:string,port:string,visiting=new Set<string>()):{size?:number;rank?:number;basis:string;valid:boolean}{
  const token=id+'\0'+port,cached=cache.get(token);if(cached)return cached;if(visiting.has(token)||visiting.size>128)return {valid:false,basis:'CV dependency cycle'};const next=new Set(visiting);next.add(token);const node=nodes.get(id);if(!node||port!=='value'||!portsFor(node,contract,catalog)?.outputs[port])return {valid:false,basis:'Missing or unsupported Tensor CV source '+id};
  if(node.kind==='cv'){
   const entry=entryFor(catalog,node);if(!entry||declared(entry)&&entry.semantics?.graph_support==='blocked')return {valid:false,basis:'Unsupported CV class '+id};
   if(node.output_size!==undefined&&node.output_size!==entry.output_size)return {valid:false,basis:'Untrusted node.output_size differs from the actual catalog for '+id};
   const result={valid:true,rank:declared(entry)&&typeof entry.semantics?.output_rank==='number'?entry.semantics.output_rank:undefined,size:validSize(entry.output_size)?entry.output_size:undefined,basis:id+' · '+entry.source.name+' · SHA256 '+entry.source.sha256+' · catalog.output_size'};cache.set(token,result);return result;
  }
  if(node.kind!=='reduce')return {valid:false,basis:'Only actual CV or Reduce.value can form a collected component.'};
  const incoming=oldGraph.edges.filter(edge=>edge.target.node===id&&edge.target.port==='value');if(incoming.length!==1)return {valid:false,basis:'Reduce needs exactly one actual source: '+id};const source=sizeOf(incoming[0].source.node,incoming[0].source.port,next);if(!source.valid)return source;
  const operation=node.params?.operation;if(!contract!.reductions.some(reduction=>reduction.id===operation))return {valid:false,basis:'Unknown or implicit reduction '+id};
  if(operation==='identity'&&source.size!==1)return {valid:false,basis:'identity preserves the vector; the registered planner scalar assumption cannot justify a dynamic/vector source: '+id};
  if(operation==='first'&&!validSize(source.size))return {valid:false,basis:'first needs a source-known nonempty size; dynamic CVs need explicit mean/sum: '+id};
  if(operation==='first')warnings.push(id+': explicitly selecting first changes vector meaning; numerical/reference validation is required.');
  const result={valid:true,size:1,rank:1,basis:id+' · explicit '+String(operation)+' · renderer SHA256 '+contract!.source.sha256};cache.set(token,result);return result;
 }
 const before:NonNullable<ReorderResult['before']>=[];let total=0;
 for(const edge of beforeEdges){const size=sizeOf(edge.source.node,edge.source.port);if(size.rank===0)return blocked('Source-confirmed 0D Tensor '+edge.source.node+' requires explicit reduce.identity reshape before Collect; output_size=1 is not rank1.');if(!size.valid||!validSize(size.size))return blocked(size.basis+'; dimension is not source-confirmed.');before.push({...edge.source,size:size.size,basis:size.basis});total+=size.size;}
 if(total>512)return blocked('The confirmed CV dimension exceeds the bounded editor.');
 const byKey=new Map(before.map((block,index)=>[beforeEdges[index].source.node+'\0'+beforeEdges[index].source.port,block]));const offsets=new Map<string,number>();let offset=0;for(const block of before){offsets.set(block.node+'\0'+block.port,offset);offset+=block.size;}
 const after=afterEdges.map(edge=>byKey.get(endpoint(edge))!),permutation=after.flatMap(block=>Array.from({length:block.size},(_,index)=>offsets.get(block.node+'\0'+block.port)!+index));
 const affected:NonNullable<ReorderResult['affectedParameters']>=[],biases=oldGraph.nodes.filter(node=>node.kind==='bias');
 if(oldGraph.mode==='metad'&&!biases.length)return blocked('MetaD has no source-confirmed Bias node.');
 const outputBias=oldGraph.edges.filter(edge=>edge.target.node===output.id&&edge.target.port==='bias');if(oldGraph.mode==='metad'&&(outputBias.length!==biases.length||biases.some(node=>!outputBias.some(edge=>edge.source.node===node.id&&edge.source.port==='bias'))))return blocked('Every Bias must feed Outputs.bias directly before dimension-safe reordering.');
 for(const node of biases){
  const entry=entryFor(catalog,node),semantics=entry?.semantics;if(!declared(entry)||semantics?.reorder_policy!=='permutation'||!semantics.ordered_cv_parameters)return blocked('Unknown bias/grid/OPES ordering contract: '+node.id+'. No lists were changed.');
  const cvEdges=oldGraph.edges.filter(edge=>edge.target.node===node.id&&edge.target.port==='cv');if(cvEdges.length!==1||cvEdges[0].source.node!==collectorId||cvEdges[0].source.port!=='cv')return blocked('Bias/collector mapping is not exact: '+node.id);
  if(Object.keys(node.params||{}).some(name=>!entry!.params.some(param=>param.name===name)))return blocked('Unknown constructor/per-CV parameter on '+node.id+'; review its source contract.');
  for(const [name,rule] of Object.entries(semantics.ordered_cv_parameters)){
   if(rule.axis!==0||!entry!.params.some(param=>param.name===name))return blocked('Unsupported ordered-parameter declaration '+node.id+'.'+name);
   const value=node.params?.[name];if(!Array.isArray(value)||value.length!==total||!numericShape(value))return blocked('Explicit structured dimension-matched data is required for '+node.id+'.'+name+'; legacy/default/ragged data cannot be guessed.');
   affected.push({nodeId:node.id,name,sourceSHA256:entry!.source.sha256,before:structuredClone(value),after:permutation.map(index=>structuredClone(value[index]))});
  }
 }
 if(equal(oldGraph.edges,proposedGraph.edges))return {...base,status:'unchanged',graph:oldGraph,renderBlocked:false};
 // A legacy descriptive cv_order must not contradict the actual ordered graph after a human reorder.
 // Only source-confirmed native torsions through an explicit identity reshape have this exact schema.
 let settings=proposedGraph.settings;
 const metadata=oldGraph.settings.scientific_metadata;
 if(metadata&&typeof metadata==='object'&&!Array.isArray(metadata)&&Object.hasOwn(metadata,'cv_order')){
  const description=metadata as Record<string,unknown>,groups:number[][]=[];
  for(const edge of beforeEdges){
   const reduction=nodes.get(edge.source.node),incoming=oldGraph.edges.filter(item=>item.target.node===reduction?.id&&item.target.port==='value');
   const source=incoming.length===1&&incoming[0].source.port==='value'?nodes.get(incoming[0].source.node):undefined,entry=source?.kind==='cv'?entryFor(catalog,source):undefined;
   const key=source?.class_name==='PeriodicTorsion'?'atom_idx':source?.class_name==='Torsion'?'idx':null,value=key?source?.params?.[key]:undefined;
   if(edge.source.port!=='value'||reduction?.kind!=='reduce'||reduction.params?.operation!=='identity'||!key||!entry||!declared(entry)||catalog.source.files[entry.source.name]!==entry.source.sha256||entry.output_size!==1||entry.semantics?.output_rank!==0||entry.semantics.collector_adapter!=='reduce.identity'||!entry.params.some(param=>param.name===key)||!Array.isArray(value)||value.length!==4||value.some(index=>!Number.isSafeInteger(index)||Number(index)<0))return blocked('Legacy scientific_metadata.cv_order cannot be synchronized: every collected component must be a source-confirmed native PeriodicTorsion/Torsion through explicit identity. Review the description and actual graph; no order was changed.');
   groups.push(value as number[]);
  }
  if(!equal(description.cv_order,groups))return blocked('Legacy scientific_metadata.cv_order conflicts with the actual old torsion atom groups. Review the description before reordering; it was not guessed, removed or overwritten.');
  const byEndpoint=new Map(beforeEdges.map((edge,index)=>[endpoint(edge),groups[index]]));
  settings={...settings,scientific_metadata:{...description,cv_order:afterEdges.map(edge=>structuredClone(byEndpoint.get(endpoint(edge))!))}};
  warnings.push('Source-confirmed legacy scientific_metadata.cv_order was synchronized to the explicit torsion/identity collector order; numerical and prepared evidence still require revalidation.');
 }
 const graph={...proposedGraph,settings,nodes:proposedGraph.nodes.map(node=>{const changes=affected.filter(param=>param.nodeId===node.id);return changes.length?{...node,params:{...node.params,...Object.fromEntries(changes.map(param=>[param.name,param.after]))}}:node;})};
 return {...base,status:'permuted',graph,renderBlocked:false,requiresRevalidation:true,permutation,before,after,affectedParameters:affected,invalidated:['numerical','prepared','artifact','history']};
}
