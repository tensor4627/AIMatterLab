// Read-only index observation. This never restores a workflow or connects a service.
export function selectedRecordScope(resource,selectionEpoch){
 if(resource?.kind!=='ssh-connection')return null;
 return {key:JSON.stringify([selectionEpoch,resource.selectionId,resource.connectionId,resource.profileId,resource.profileVersion]),connectionId:resource.connectionId,profileId:resource.profileId,profileVersion:resource.profileVersion};
}
export function matchesSelectedRecordService(status,scope){
 return status?.status==='connected'&&status.sourceKind==='ssh'&&typeof scope.connectionId==='string'&&status.connectionId===scope.connectionId&&/^[a-f0-9]{64}$/.test(status.sourceId||'')&&status.profileId===scope.profileId&&status.profileVersion===scope.profileVersion;
}
export async function readSelectedServiceRecords({scope,current,readStatus,read,onSource=()=>{}}){
 const before=await readStatus();if(!current())return null;
 if(!matchesSelectedRecordService(before,scope))return {phase:'unavailable',...before.status==='connected'?{sourceChanged:true}:{}};
 onSource(before.sourceId);
 const records=await Promise.allSettled(['/api/runs','/api/cluster-runs'].map(target=>read(target)));
 if(!current())return null;
 // A service may be replaced without changing the selected profile. Never label
 // responses from an intervening bridge as the original source's records.
 const after=await readStatus();if(!current())return null;
 if(!matchesSelectedRecordService(after,scope)||after.sourceId!==before.sourceId)return {phase:'unavailable',sourceChanged:true};
 return {phase:'ready',sourceId:before.sourceId,serviceVersion:after.serviceVersion||'unconfirmed',records};
}
