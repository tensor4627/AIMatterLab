// Only trusted desktop settings change these SSH terminal permissions. Worker project policies still govern jobs.
const kind='managed-project-terminal-access';
const id=(projectId,profileId)=>JSON.stringify([projectId,profileId]);
export function managedProjectAccess({catalog}) {
  const revisions=new Map();
  function includes(projectId,resource) {
    if(!projectId||!resource?.targetFingerprint)return false;
    const saved=catalog.get(kind,id(projectId,resource.profileId));
    return saved?.target===resource.targetFingerprint&&saved.allowed!==false;
  }
  function terminalDecision(scope,resource) {
    const saved=scope.projectId&&catalog.get(kind,id(scope.projectId,resource.profileId));
    if(saved&&saved.target===resource.targetFingerprint)return saved.allowed===false?'denied':true;
    // Publication and the human's resource choice can open an ordinary chat's
    // channel. The resource controller tracks which live channel already exists.
    return !scope.taskId;
  }
  function set(projectId,resource,allowed) {
    if(typeof projectId!=='string'||!projectId.trim()||projectId.length>512||/[\x00-\x1f]/.test(projectId)||
      resource?.kind!=='ssh'||!resource.targetFingerprint||typeof allowed!=='boolean')throw Error('invalid_project_resource_access');
    const key=id(projectId,resource.profileId);
    catalog.put(kind,key,{projectId,profileId:resource.profileId,target:resource.targetFingerprint,allowed});
    revisions.set(key,(revisions.get(key)??0)+1);
    return {allowed};
  }
  function terminalRevision(scope,resource) {
    return revisions.get(id(scope.projectId,resource.profileId))??0;
  }
  function projects(resource) {
    if(!resource.targetFingerprint)return [];
    return catalog.list(kind).filter(entry=>entry.profileId===resource.profileId&&entry.target===resource.targetFingerprint&&entry.allowed!==false).map(entry=>entry.projectId);
  }
  function decisions(resource) {
    if(!resource.targetFingerprint)return [];
    return catalog.list(kind).filter(entry=>entry.profileId===resource.profileId&&entry.target===resource.targetFingerprint)
      .map(entry=>({projectId:entry.projectId,allowed:entry.allowed!==false}));
  }
  return {includes,set,projects,terminalDecision,terminalRevision,decisions};
}
