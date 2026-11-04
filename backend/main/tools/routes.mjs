const empty=value=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length)throw Error('Empty typed request required');};

/** Register only through the desktop's sender-validated privileged handle. */
export function registerToolDefinitionRoutes({handle,packages,groups,choosePackageDirectory}){
 handle('tools.packages.choose',async value=>{empty(value);return {package_root:await choosePackageDirectory()};});
 for(const method of ['inspect','register','update','relocate','read','list'])handle('tools.packages.'+method,async value=>{
  const result=await packages[method](value);
  if(result?.snapshot_root&&result.delivery_skill)return {...result,delivery_attachment:{name:result.delivery_skill.name,path:path.join(result.snapshot_root,result.delivery_skill.path)}};
  return result;
 });
 for(const method of ['compile','save','read','list'])handle('tools.groups.'+method,value=>groups[method](value));
}
import path from 'node:path';
