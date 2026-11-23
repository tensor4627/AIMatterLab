import type {CanonicalGraph,CatalogEntry,CatalogResponse,DerivedStructure,EditorMetadata,FrameworkNodeKind,GraphContract,GraphEdge,GraphNode,ParamDefinition,ParameterEditor,Ports,SourceReceipt} from './pygas-composer-types';
export const kinds=['cv','bias','switch','neighbor'] as const;
export const keyOf=(entry:{kind:string;name?:string;class_name?:string})=>entry.kind+':'+(entry.name||entry.class_name||'');
export function hasData(value:unknown,depth=0):boolean{return depth<=6&&(typeof value==='number'?Number.isFinite(value):typeof value==='boolean'?true:Array.isArray(value)?value.length>0&&value.length<=512&&value.every(item=>hasData(item,depth+1)):false);}
export function isData(value:unknown,depth=0):boolean{return depth<=6&&(value===null||typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean'||Array.isArray(value)&&value.length<=512&&value.every(item=>isData(item,depth+1)));}
export function catalogProblem(value:CatalogResponse,receipt:SourceReceipt):string|null{
 if(!value||value.schema_version!==1||value.status!=='passed'||!value.catalog||!receipt||!receipt.files||!value.source?.files||Object.entries(value.source.files).some(([name,sha])=>typeof name!=='string'||typeof sha!=='string'||!/^[0-9a-f]{64}$/.test(sha)))return 'catalog_invalid';
 for(const [name,sha] of Object.entries(value.source.files))if(receipt.files[name]!==sha)return 'source_mismatch';
 for(const kind of kinds){const items=value.catalog[kind];if(!Array.isArray(items)||items.length>256)return 'catalog_invalid';for(const entry of items)if(!entry||entry.kind!==kind||typeof entry.name!=='string'||!entry.source||receipt.files[entry.source.name]!==entry.source.sha256||typeof entry.documentation!=='string'||!Array.isArray(entry.forward_args)||entry.forward_args.some(arg=>typeof arg!=='string')||!Array.isArray(entry.params)||entry.params.length>128||entry.params.some(p=>!p||typeof p.name!=='string'||typeof p.required!=='boolean'||typeof p.default!=='string'))return 'catalog_invalid';}
 return null;
}
export function catalogGraphContract(catalog:CatalogResponse,mode:string|undefined):GraphContract|undefined{
 const data=catalog.ports,sourceName='tools/graph_workflow.py',sourceSHA=catalog.source.files[sourceName];
 if(!data||data.status!=='passed'||!sourceSHA||data.source_sha256!==sourceSHA||!data.classes||!data.templates||!data.templates[mode||'']||!Array.isArray(data.multiple_inputs)||!Array.isArray(data.compatible_pairs)||!Array.isArray(data.reductions))return;
 if(data.multiple_inputs.some(pair=>!Array.isArray(pair)||pair.length!==2||pair.some(value=>typeof value!=='string'))||data.multiple_inputs.length>32)return;
 const validPorts=(ports:Ports)=>ports&&[ports.inputs,ports.outputs].every(group=>group&&typeof group==='object'&&!Array.isArray(group)&&Object.keys(group).length<=32&&Object.entries(group).every(([key,type])=>key.length<=128&&typeof type==='string'&&type.length<=128));
 const entries=kinds.flatMap(kind=>catalog.catalog[kind]),ports:Record<string,Ports>={};
 for(const entry of entries){if(entry.semantics?.source===entry.source.name&&entry.semantics.sha256===entry.source.sha256&&entry.semantics.graph_support==='blocked')continue;const actual=data.classes[entry.kind+'.'+entry.name];if(!validPorts(actual))return;ports[keyOf(entry)]={inputs:{...actual.inputs},outputs:{...actual.outputs},configurationInputs:Object.entries(actual.inputs).filter(([,type])=>type==='switch').map(([name])=>name)};}
 const template=data.templates[mode||''];for(const kind of ['input','output','collect','reduce']){const actual=template[kind];if(!validPorts(actual))return;const multi=data.multiple_inputs.filter(([node,port])=>node===kind&&Object.hasOwn(actual.inputs,port)).map(([,port])=>port);ports[kind]={inputs:{...actual.inputs},outputs:{...actual.outputs},multipleInputs:multi};}
 if(data.reductions.length>16||data.reductions.some(id=>typeof id!=='string'||id.length>64)||data.compatible_pairs.length>32||data.compatible_pairs.some(pair=>!Array.isArray(pair)||pair.length!==2||pair.some(type=>typeof type!=='string')))return;
 return {source:{name:sourceName,line:1,sha256:sourceSHA},catalog_files:{...catalog.source.files},ports,reductions:data.reductions.map(id=>({id,description:'Source-declared reduction: '+id+' · SHA256 '+sourceSHA})),compatible_pairs:data.compatible_pairs};
}
export function entryFor(catalog:CatalogResponse,node:GraphNode){return kinds.includes(node.kind as any)?catalog.catalog[node.kind as keyof typeof catalog.catalog].find(entry=>entry.name===node.class_name):undefined;}
export function portsFor(node:GraphNode,contract?:GraphContract,catalog?:CatalogResponse):Ports|undefined{if(!contract||!catalog||Object.entries(contract.catalog_files).some(([name,sha])=>catalog.source.files[name]!==sha))return;return contract.ports[keyOf(node)]||contract.ports[node.kind];}
export function embeddedEditor(entry:CatalogEntry,param:ParamDefinition):ParameterEditor|undefined{const hint=param.editor_hint;if(!hint||hint.provenance?.sha256!==entry.source.sha256||hint.provenance.source!==entry.source.name)return;const base={source_sha256:hint.provenance.sha256,basis:hint.provenance.kind+' · '+hint.provenance.source,scientific:hint.basic,unit:hint.units};if(hint.editor==='number_matrix')return {...base,type:'array',itemType:'number',shape:hint.shape};if(hint.editor==='integer_vector'||hint.editor==='integer_matrix')return {...base,type:'array',itemType:'integer',shape:hint.shape};if(hint.editor==='number')return {...base,type:'number'};if(hint.editor==='enum')return {...base,type:'enum',options:hint.options?.map(value=>({label:value===null?'None / Auto (source contract)':value,value}))};if(hint.editor==='project_file')return {...base,type:'asset'};}
export function editorFor(entry:CatalogEntry,param:ParamDefinition,value:unknown,metadata?:EditorMetadata):ParameterEditor|undefined{
 const explicit=metadata?.[keyOf(entry)]?.[param.name]||embeddedEditor(entry,param);if(explicit){const valid=explicit.source_sha256===entry.source.sha256&&['number','integer','boolean','array','enum','asset'].includes(explicit.type)&&(!explicit.shape||explicit.shape.length<=4&&explicit.shape.every(size=>(size===null||Number.isInteger(size)&&size>0&&size<=512))&&explicit.shape.reduce<number>((a,b)=>a*(b??1),1)<=4096)&&(!explicit.options||explicit.options.length<=64&&explicit.options.every(option=>['string','number','boolean'].includes(typeof option.value)||option.value===null));return valid?explicit:undefined;}
 const base={source_sha256:entry.source.sha256,basis:'actual constructor type/default or normalized stored data'};
 if(param.type_hint==='int')return {...base,type:'integer'};
 if(param.type_hint==='float')return {...base,type:'number'};
 if(typeof value==='boolean'||param.default_is_literal&&typeof param.default_value==='boolean')return {...base,type:'boolean'};
 if(typeof value==='number')return {...base,type:'number'};
 if(Array.isArray(value)||param.type_hint==='tensor'||param.default_is_literal&&Array.isArray(param.default_value))return {...base,type:'array',itemType:'number'};
}
export function effectiveValue(node:GraphNode,param:ParamDefinition,derived?:DerivedStructure):unknown{if(['n_atoms','numbers','atomic_types'].includes(param.name))return derived?.values[param.name as keyof DerivedStructure['values']];return node.params?.[param.name];}
export function fitsEditor(value:unknown,editor:ParameterEditor|undefined):boolean{if(!editor)return hasData(value);if(editor.type==='enum')return !!editor.options?.some(option=>option.value===value);if(editor.type==='asset')return typeof value==='string'&&!!value;if(editor.type==='integer')return typeof value==='number'&&Number.isInteger(value);if(editor.type==='boolean')return typeof value==='boolean';if(editor.type==='number')return typeof value==='number'&&Number.isFinite(value);const walk=(item:unknown,level:number):boolean=>{if(editor.shape&&level<editor.shape.length)return Array.isArray(item)&&(editor.shape[level]===null||item.length===editor.shape[level])&&item.length>0&&item.every(child=>walk(child,level+1));if(Array.isArray(item))return item.length>0&&item.every(child=>walk(child,level+1));return editor.itemType==='integer'?typeof item==='number'&&Number.isInteger(item):editor.itemType==='boolean'?typeof item==='boolean':typeof item==='number'&&Number.isFinite(item);};return Array.isArray(value)&&walk(value,0);}
export function cvOutputRank(entry?:CatalogEntry){
 const semantics=entry?.semantics,rank=semantics?.output_rank;
 return entry&&semantics?.source===entry.source.name&&semantics.sha256===entry.source.sha256&&typeof rank==='number'&&Number.isInteger(rank)&&rank>=0?rank:undefined;
}
export function collectorScalarSources(node:GraphNode,graph:CanonicalGraph,catalog?:CatalogResponse){
 if(node.kind!=='collect'||!catalog)return [];return graph.edges.filter(edge=>edge.target.node===node.id&&edge.target.port==='value').flatMap(edge=>{const source=graph.nodes.find(item=>item.id===edge.source.node);const entry=source?.kind==='cv'?entryFor(catalog,source):undefined;return entry&&cvOutputRank(entry)===0?[{node:source!.id,className:entry.name,sha256:entry.source.sha256}]:[];});
}
export function nodeMissing(node:GraphNode,entry:CatalogEntry|undefined,graph:CanonicalGraph,derived?:DerivedStructure,contract?:GraphContract,catalog?:CatalogResponse,metadata?:EditorMetadata){
 const missing:string[]=collectorScalarSources(node,graph,catalog).length?['value']:[];if(entry&&entry.semantics?.source===entry.source.name&&entry.semantics.sha256===entry.source.sha256&&entry.semantics.graph_support==='blocked')missing.push('graph_support');if(node.kind==='reduce'&&(!contract?.reductions.some(item=>item.id===node.params?.operation)))missing.push('operation');if(kinds.includes(node.kind as any)&&!entry)missing.push('class_name');
 if(entry)for(const param of entry.params){const value=effectiveValue(node,param,derived);if(!param.required&&value===undefined)continue;const ports=portsFor(node,contract,catalog);if(param.is_module_param){if(!ports?.configurationInputs?.includes(param.name)||!graph.edges.some(edge=>edge.target.node===node.id&&edge.target.port===param.name))missing.push(param.name);}else if(!fitsEditor(value,editorFor(entry,param,value,metadata))||param.type_hint==='int'&&!Number.isInteger(value))missing.push(param.name);}
 const ports=portsFor(node,contract,catalog);if(ports)for(const [port,type] of Object.entries(ports.inputs))if(!graph.edges.some(edge=>{if(edge.target.node!==node.id||edge.target.port!==port)return false;const source=graph.nodes.find(item=>item.id===edge.source.node),sourceType=source&&portsFor(source,contract,catalog)?.outputs[edge.source.port];return !!sourceType&&(sourceType===type||contract?.compatible_pairs.some(([a,b])=>a===sourceType&&b===type));})&&!missing.includes(port))missing.push(port);
 return missing;
}
export function updateParam(graph:CanonicalGraph,nodeId:string,name:string,value:unknown,allowedStrings:string[]=[]):CanonicalGraph{if(!isData(value)&&!(typeof value==='string'&&allowedStrings.includes(value)))throw Error('Parameter must be finite structured data');return {...graph,nodes:graph.nodes.map(node=>node.id===nodeId?{...node,params:{...node.params,[name]:value}}:node)};}
export function connectInput(graph:CanonicalGraph,nodeId:string,port:string,source:{node:string;port:string}|null):CanonicalGraph{const edges=graph.edges.filter(edge=>edge.target.node!==nodeId||edge.target.port!==port);return {...graph,edges:source?[...edges,{source,target:{node:nodeId,port}}]:edges};}
export function appendInput(graph:CanonicalGraph,nodeId:string,port:string,source:{node:string;port:string}):CanonicalGraph{if(graph.edges.some(edge=>edge.target.node===nodeId&&edge.target.port===port&&edge.source.node===source.node&&edge.source.port===source.port))return graph;return {...graph,edges:[...graph.edges,{source,target:{node:nodeId,port}}]};}
export function removeInputEdge(graph:CanonicalGraph,edge:GraphEdge):CanonicalGraph{return {...graph,edges:graph.edges.filter(item=>item!==edge)};}
export function compatibleSources(graph:CanonicalGraph,node:GraphNode,port:string,contract:GraphContract,catalog:CatalogResponse){const type=portsFor(node,contract,catalog)?.inputs[port];return graph.nodes.flatMap(source=>source.id===node.id?[]:Object.entries(portsFor(source,contract,catalog)?.outputs||{}).filter(([,value])=>value===type||contract.compatible_pairs.some(([a,b])=>a===value&&b===type)).map(([sourcePort])=>({node:source.id,port:sourcePort})));}
export function moveCollectorEdge(graph:CanonicalGraph,edge:GraphEdge,delta:number):CanonicalGraph{
 const indices=graph.edges.map((item,index)=>item.target.node===edge.target.node&&item.target.port===edge.target.port?index:-1).filter(i=>i>=0);
 const position=indices.findIndex(i=>graph.edges[i]===edge),other=position+delta;
 if(!delta||position<0||other<0||other>=indices.length)return graph;
 const edges=[...graph.edges],ordered=indices.map(index=>edges[index]);
 ordered.splice(position,1);ordered.splice(other,0,edge);
 indices.forEach((index,position)=>{edges[index]=ordered[position];});
 return {...graph,edges};
}

/** Source-matched compiler choices only. These helpers never select scientific parameters or connect nodes. */
export const frameworkNodeKinds=['input','collect','output','reduce'] as const;
export function compilerGraphModes(catalog:CatalogResponse,receipt:SourceReceipt):string[]{
 if(catalogProblem(catalog,receipt)||!catalog.ports?.templates||typeof catalog.ports.templates!=='object'||Array.isArray(catalog.ports.templates))return [];
 const modes=Object.keys(catalog.ports.templates);if(modes.length>16||modes.some(mode=>!/^[a-z][a-z0-9_]{0,31}$/.test(mode)))return [];
 return modes.filter(mode=>!!catalogGraphContract(catalog,mode));
}
export function appendFrameworkNode(graph:CanonicalGraph,catalog:CatalogResponse,receipt:SourceReceipt,kind:FrameworkNodeKind,id:string):CanonicalGraph{
 const contract=compilerGraphModes(catalog,receipt).includes(graph.mode||'')?catalogGraphContract(catalog,graph.mode):undefined;
 if(!frameworkNodeKinds.includes(kind)||!contract?.ports[kind])throw Error('The selected mode has no source-matched framework node contract');
 if(!Array.isArray(graph.nodes)||graph.nodes.length>=128)throw Error('The current graph editor supports at most 128 nodes');
 if(!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(id)||graph.nodes.some(node=>node.id===id))throw Error('A framework node requires a unique declared graph ID');
 if(kind!=='reduce'&&graph.nodes.some(node=>node.kind===kind))throw Error('This editor currently supports one '+kind+' node; the existing node is retained');
 return {...graph,nodes:[...graph.nodes,{id,kind,params:{}}]};
}
export function changeCompilerGraphMode(graph:CanonicalGraph,catalog:CatalogResponse,receipt:SourceReceipt,mode:string):CanonicalGraph{
 if(!compilerGraphModes(catalog,receipt).includes(mode))throw Error('Choose a source-matched compiler graph mode');
 return graph.mode===mode?graph:{...graph,mode};
}

/** A literal, user-clicked managed basename is technical authoring data, never an artifact or format fallback. */
export function managedOutputNameProposal(graph:CanonicalGraph,catalog:CatalogResponse,receipt:SourceReceipt){
 const basename='pygas-model.pt',schema=catalog.settings_schema,field=Array.isArray(schema?.fields)?schema.fields.find(field=>!!field&&typeof field==='object'&&field.key==='pt_path'):undefined;
 const sourceFiles=schema?.source_files,sourceMatched=!!sourceFiles&&Object.keys(sourceFiles).length>0&&Object.entries(sourceFiles).every(([name,sha])=>/^[a-f0-9]{64}$/.test(sha)&&catalog.source.files[name]===sha);
 const actual=graph.settings.pt_path,missing=actual===undefined||actual===null||actual==='';
 let reason='';if(!compilerGraphModes(catalog,receipt).includes(graph.mode||'')||graph.version!==2||schema?.status!=='passed'||!sourceMatched||!field||field.location!=='settings'||field.type!=='owned_output_basename'||field.read_only!==true||field.required!==true||!field.origin||typeof field.origin.path!=='string'||typeof field.origin.sha256!=='string'||catalog.source.files[field.origin.path]!==field.origin.sha256)reason='The current managed-output source contract is unavailable';
 else if(!missing)reason='The existing output value is retained; this action never overwrites it';
 const metadata=graph.settings.scientific_metadata,defaults=metadata&&typeof metadata==='object'&&!Array.isArray(metadata)?(metadata as Record<string,unknown>).studio_technical_defaults:undefined;
 if(!reason&&(metadata!==undefined&&(!metadata||typeof metadata!=='object'||Array.isArray(metadata))||defaults!==undefined&&(!defaults||typeof defaults!=='object'||Array.isArray(defaults))))reason='Existing technical provenance needs explicit review before this value can be added';
 const formats=Array.isArray(graph.settings.artifact_formats)?graph.settings.artifact_formats:typeof graph.settings.artifact_formats==='string'?[graph.settings.artifact_formats]:[];
 const known=formats.length>0&&formats.length<=2&&new Set(formats).size===formats.length&&formats.every(format=>format==='torchscript'||format==='aoti');
 return {available:!reason,missing,reason,basename,source:field?.origin,formats:known?formats:[],futureOutputs:known?formats.map(format=>format==='torchscript'?'pygas-model.pt':'pygas-model.pt2'):[]};
}
export function adoptManagedOutputName(graph:CanonicalGraph,catalog:CatalogResponse,receipt:SourceReceipt):CanonicalGraph{
 const proposal=managedOutputNameProposal(graph,catalog,receipt);if(!proposal.available)throw Error(proposal.reason);
 const metadata=(graph.settings.scientific_metadata||{}) as Record<string,unknown>,defaults=(metadata.studio_technical_defaults||{}) as Record<string,unknown>;
 return {...graph,settings:{...graph.settings,pt_path:proposal.basename,scientific_metadata:{...metadata,studio_technical_defaults:{...defaults,pt_path:{value:proposal.basename,origin:'AIMatterLab technical default selected by an explicit human action',compiler_source:proposal.source!.path,compiler_sha256:proposal.source!.sha256}}}}};
}
