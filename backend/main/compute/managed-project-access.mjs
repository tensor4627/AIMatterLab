// Only trusted desktop settings change these SSH terminal permissions. Worker project policies still govern jobs.
const kind='managed-project-terminal-access';
const id=(projectId,profileId)=>JSON.stringify([projectId,profileId]);
export function managedProjectAccess({catalog}) {
  function includes(projectId,resource) {
    if(!projectId||!resource?.targetFingerprint)return false;
    return catalog.get(kind,id(projectId,resource.profileId))?.target===resource.targetFingerprint;
  }
  function set(projectId,resource,allowed) {
    if(typeof projectId!=='string'||!projectId.trim()||projectId.length>512||/[\x00-\x1f]/.test(projectId)||
      resource?.kind!=='ssh'||!resource.targetFingerprint||typeof allowed!=='boolean')throw Error('invalid_project_resource_access');
    const key=id(projectId,resource.profileId);
    if(allowed)catalog.put(kind,key,{projectId,profileId:resource.profileId,target:resource.targetFingerprint});
    else catalog.remove(kind,key);
    return {allowed};
  }
  function projects(resource) {
    if(!resource.targetFingerprint)return [];
    return catalog.list(kind).filter(entry=>entry.profileId===resource.profileId&&entry.target===resource.targetFingerprint).map(entry=>entry.projectId);
  }
  return {includes,set,projects};
}
