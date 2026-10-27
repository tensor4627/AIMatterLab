const FIELDS=['engines','gpus','max_seconds','max_concurrent','input_roots','environments','clusters'];
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
function compute(record,id){if(!object(record)||record.id!==id||typeof record.name!=='string'||!object(record.policy))throw Error('project_edit_record_invalid');if(record.authoring_only!==undefined&&record.authoring_only!==false)throw Error('project_edit_authoring_only');return record;}
export function editableProjectSpec(record){compute(record,record?.id);return {name:record.name,policy:Object.fromEntries(FIELDS.filter(key=>Object.hasOwn(record.policy,key)).map(key=>[key,structuredClone(record.policy[key])]))};}
export function projectPolicyChanges(before,after){return ['name',...FIELDS.map(key=>'policy.'+key)].flatMap(key=>{const get=value=>key==='name'?value?.name:value?.policy?.[key.split('.')[1]],from=get(before),to=get(after);return canonical(from)===canonical(to)||key==='policy.clusters'&&from===undefined&&Array.isArray(to)&&to.length===0?[]:[{key,before:structuredClone(from),after:structuredClone(to)}];});}
export function validateProjectSpec(spec,engines){
 if(!object(spec)||Object.keys(spec).some(key=>!['name','policy'].includes(key))||typeof spec.name!=='string'||!spec.name.trim()||!object(spec.policy)||Object.keys(spec.policy).some(key=>!FIELDS.includes(key)))throw Error('project_edit_invalid_fields');
 const p=spec.policy,strings=v=>Array.isArray(v)&&v.every(x=>typeof x==='string'&&x.trim());
 if(!strings(p.engines)||!p.engines.length||p.engines.some(id=>!engines.includes(id))||!Array.isArray(p.gpus)||!p.gpus.length||p.gpus.some(id=>!Number.isSafeInteger(id)||id<0)||!Number.isSafeInteger(p.max_seconds)||p.max_seconds<1||!Number.isSafeInteger(p.max_concurrent)||p.max_concurrent<1||!strings(p.input_roots)||!p.input_roots.length||p.input_roots.some(root=>!root.startsWith('/')||/[\r\n\0]/.test(root)||root.split('/').includes('..'))||!strings(p.environments)||p.clusters!==undefined&&!strings(p.clusters)||!p.environments.length&&!p.clusters?.length)throw Error('project_edit_invalid_fields');
}
/** Human renderer uses only the existing admin-backed GET/POST projects route. ID never comes from the editable spec. */
export function createProjectPolicyEditor({projectId,read,write,current,engines}){
 if(typeof projectId!=='string'||!projectId||typeof current!=='function')throw Error('project_edit_record_invalid');
 const id=projectId;let baseline=null,closed=false,busy=false;
 const guard=()=>{if(closed||current()!==true)throw Error('project_edit_unavailable');};
 async function load(){guard();const rows=await read();guard();if(!Array.isArray(rows))throw Error('project_edit_record_invalid');const matches=rows.filter(row=>row?.id===id);if(matches.length!==1)throw Error('project_edit_conflict');return compute(matches[0],id);}
 return {
  async open(){if(baseline)throw Error('project_edit_conflict');const record=await load();guard();baseline=structuredClone(record);return {id,spec:editableProjectSpec(baseline)};},
  cancel(){closed=true;},
  async save(spec){
   guard();if(!baseline)throw Error('project_edit_unavailable');if(busy)throw Error('project_edit_busy');validateProjectSpec(spec,engines);compute(baseline,id);
   const projected=structuredClone(spec);if(!Object.hasOwn(baseline.policy,'clusters')&&projected.policy.clusters?.length===0)delete projected.policy.clusters;
   if(!projectPolicyChanges(editableProjectSpec(baseline),projected).length)throw Error('project_edit_no_changes');
   busy=true;try{
    const actual=await load();guard();if(canonical(actual)!==canonical(baseline))throw Error('project_edit_conflict');
    const value={...structuredClone(baseline),name:projected.name,policy:{...structuredClone(baseline.policy),...projected.policy},id};
    guard();let result;try{result=await write(value);}catch{throw Error('project_edit_save_unconfirmed');}if(closed||current()!==true)throw Error('project_edit_save_unconfirmed');compute(result,id);if(canonical(result)!==canonical(value))throw Error('project_edit_save_mismatch');
    const saved=await load();guard();if(canonical(saved)!==canonical(value))throw Error('project_edit_save_mismatch');closed=true;return structuredClone(saved);
   }finally{busy=false;}
  }
 };
}

