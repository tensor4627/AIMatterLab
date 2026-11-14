/** Bounded display/setup evidence; never project authorization or a filesystem grant. */
export function checkedSshLocations(value){
 const absolute=path=>typeof path==='string'&&path.length>0&&path.length<=4096&&path.startsWith('/')&&!/[\r\n\0]/.test(path)&&!path.split('/').includes('..');
 if(!value||value.schemaVersion!==1||value.scope!=='remote-observed'||!absolute(value.loginDirectory)||!Number.isFinite(value.observedAt)||value.observedAt<=0||!Array.isArray(value.workspaces)||value.workspaces.length>32||!Array.isArray(value.skills)||value.skills.length>32)throw Error('ssh_service_locations_invalid');
 const observation=row=>{const status=row.status??'observed',lastSeenAt=row.lastSeenAt??value.observedAt;if(!['observed','previously-observed'].includes(status)||!Number.isFinite(lastSeenAt)||lastSeenAt<=0)throw Error('ssh_service_locations_invalid');return {status,lastSeenAt};};
 const workspaces=value.workspaces.map(row=>{if(!row||!absolute(row.path)||row.source!=='worker-project'||typeof row.projectId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(row.projectId))throw Error('ssh_service_locations_invalid');return {path:row.path,source:row.source,projectId:row.projectId,...observation(row)};});
 const skills=value.skills.map(row=>{if(!row||!absolute(row.path)||row.source!=='worker-cluster-skill')throw Error('ssh_service_locations_invalid');return {path:row.path,source:row.source,...observation(row)};});
 return {schemaVersion:1,scope:'remote-observed',loginDirectory:value.loginDirectory,observedAt:value.observedAt,workspaces,skills};
}

export function mergeSshLocations(previous,current){
 if(!previous)return current;if(!current)return previous;
 const merge=(before,after)=>{const paths=new Set(after.map(row=>row.path));return [...after,...before.filter(row=>!paths.has(row.path)).map(row=>({...row,status:'previously-observed'}))].slice(0,32);};
 return checkedSshLocations({...current,workspaces:merge(previous.workspaces,current.workspaces),skills:merge(previous.skills,current.skills)});
}
