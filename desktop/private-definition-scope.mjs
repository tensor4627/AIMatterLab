const clone=value=>structuredClone(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const DEFINITION_ONLY_TOOLS=Object.freeze(['describe_engine','inspect_source_project','inspect_pygas_catalog','scientific_skill_catalog','read_scientific_skill','read_custom_cv','propose_custom_cv']);
const allowed=new Set(DEFINITION_ONLY_TOOLS);
// A separate human-handoff capability, never a scientific definition/file grant.
export const SHARED_TERMINAL_TOOL_NAMES=Object.freeze(['list_shared_terminals','read_shared_terminal','write_shared_terminal']);
const terminals=new Set(SHARED_TERMINAL_TOOL_NAMES);
export function sharedTerminalToolAllowed(name){return terminals.has(name);}
/** A definition checkbox is never a grant to files, environment observations or run results. */
export function definitionOnlyScope(task,policy){const projects=new Set([task?.authoring?.projectId,task?.projectId,task?.deployment?.config?.projectId].filter(Boolean));return !!task&&(!!task.customCv?.id||(policy?.bindings||[]).some(row=>row.workspace_id===task.id||projects.has(row.project_id)));}
export function definitionToolAllowed(name){return allowed.has(name);}
export function definitionReply(value,task){
 const item=value?.entry,expected=item?.expected,current=task?.customCv;
 if(value?.allowed!==true||value.status!=='passed'||!current||item?.id!==current.id||value.id!==current.id||item.workspace_id!==task.id||item.project_id!==(task.authoring?.projectId||task.projectId)||!expected)throw Error('The current shared definition identity is unavailable');
 const keys={spec_sha256:'specSha',code_sha256:'codeSha',parameters_sha256:'parametersSha',revision:'revision'};
 for(const [key,field]of Object.entries(keys))if(expected[key]!==current[field]||item[key]!==expected[key]||value.expected?.[key]!==expected[key])throw Error('The exact shared definition changed before return');
 if(!hash(expected.spec_sha256)||!hash(expected.parameters_sha256)||!(expected.code_sha256===null||hash(expected.code_sha256))||typeof expected.revision!=='string'||!/^[a-f0-9]{32}$/.test(expected.revision))throw Error('Invalid current definition receipt');
 if(!item.spec||typeof item.spec!=='object'||Array.isArray(item.spec)||!item.parameter_values||typeof item.parameter_values!=='object'||Array.isArray(item.parameter_values)||item.code!==undefined&&typeof item.code!=='string')throw Error('Invalid current definition data');
 const receipt=Object.fromEntries(Object.keys(keys).map(key=>[key,expected[key]]));
 return {status:'passed',allowed:true,id:current.id,expected:clone(receipt),entry:{id:item.id,workspace_id:task.id,project_id:item.project_id,spec:clone(item.spec),parameter_values:clone(item.parameter_values),...(item.code!==undefined?{code:item.code}:{}),...clone(receipt),expected:clone(receipt)}};
}
export function definitionToolResult(name,args,result,task){
 if(!['read_custom_cv','propose_custom_cv'].includes(name))throw Error('Definition-only replies cannot replace a complete workflow');
 if(!result||!Array.isArray(result.content)||result.content.length!==1||result.content[0]?.type!=='text'||Object.keys(result).some(key=>!['content','isError'].includes(key))||Object.keys(result.content[0]).some(key=>!['type','text'].includes(key)))throw Error('Definition-only tool replies cannot contain extra blocks or hidden data');
 if(result.isError===true){result.content[0].text='The selected definition operation was not available. No workflow files, environment observations or numerical results are returned.';return;}
 let value;try{value=JSON.parse(result.content[0].text);}catch{throw Error('Invalid definition-only tool reply');}
 if(name==='read_custom_cv')value=definitionReply(value,task);
 else if(name==='propose_custom_cv'){
  const keys=['kind','id','name','expected','status','sharing','code','scope'];value=Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
 }
 result.content[0].text=JSON.stringify(value);
}
