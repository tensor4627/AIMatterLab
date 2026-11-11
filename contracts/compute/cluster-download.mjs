/** Validate the desktop download request. Authorization and root containment remain worker-owned. */
export function clusterDownloadRequest(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['project_id','cluster_id','relative','root_index','expected_sha256'].includes(key)))throw Error('Invalid typed cluster download request');
 for(const key of ['project_id','cluster_id'])if(typeof value[key]!=='string'||!value[key]||value[key].length>128||/[\0\r\n]/.test(value[key]))throw Error('Invalid cluster download identity');
 const relative=value.relative??'',root_index=value.root_index??0;
 if(typeof relative!=='string'||relative.length>1024||relative.includes('\0')||relative.startsWith('/'))throw Error('Relative path required');
 if(!Number.isSafeInteger(root_index)||root_index<0)throw Error('Select a registered read root');
 if(value.expected_sha256!==undefined&&(typeof value.expected_sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.expected_sha256)))throw Error('Invalid preview checksum');
 return {project_id:value.project_id,cluster_id:value.cluster_id,relative,root_index,...value.expected_sha256!==undefined?{expected_sha256:value.expected_sha256}:{}};
}
