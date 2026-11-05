const primaryOrder=['engine','files','family','mode','structure_file','structure','model_file','potential_file','bias_file','cv_definition','cv','cvs','atom_selection','atom_i','atom_j','pbc_convention','cutoff','cv_size','ensemble','temperature','temperature_K','sigma','sigmas','height','hill_height','pace','deposition_stride','interval','bias_factor','center','force_constant','time_step_fs','steps','n_steps'];

export function partitionFields(fields){
 const primary=[],advanced=[];
 for(const field of fields){const leaf=field.key.split('.').at(-1),essential=primaryOrder.includes(leaf)||['file','files'].includes(field.type);const detail=field.advanced===true||field.advanced!==false&&!essential&&!field.required; (detail?advanced:primary).push(field);}
 const rank=f=>{const index=primaryOrder.indexOf(f.key.split('.').at(-1));return index<0?100:index;};
 primary.sort((a,b)=>rank(a)-rank(b));return {primary,advanced};
}
