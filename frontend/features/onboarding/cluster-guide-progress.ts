import type {ResourceToolRoute} from '../../../contracts/dto/resource-tools';

export type ClusterGuideProgress={profileId:string;profileVersion:number;name:string;step:'ssh-login'|'ssh-service'|'resource-tools'|'ssh-terminal-practice'|'tour-goal';route?:ResourceToolRoute};
const key='studio.clusterGuide';
const validStep=(value:unknown)=>['ssh-login','ssh-service','resource-tools','ssh-terminal-practice','tour-goal'].includes(String(value));
function valid(value:any):value is ClusterGuideProgress{
 return !!value&&typeof value.profileId==='string'&&value.profileId.length>0&&Number.isSafeInteger(value.profileVersion)&&value.profileVersion>0&&typeof value.name==='string'&&validStep(value.step)&&(!value.route||['fresh','existing','custom'].includes(value.route));
}
function progress():Record<string,ClusterGuideProgress>{
 try{const rows=JSON.parse(localStorage.getItem(key)||'{}');return Object.fromEntries(Object.entries(rows).filter(([,value])=>valid(value))) as Record<string,ClusterGuideProgress>;}catch{return {};}
}
const scope=(value:Pick<ClusterGuideProgress,'profileId'|'profileVersion'>)=>JSON.stringify([value.profileId,value.profileVersion]);
export function readClusterGuide(value?:Pick<ClusterGuideProgress,'profileId'|'profileVersion'>):ClusterGuideProgress|null{
 const rows=progress();return value?rows[scope(value)]||null:Object.values(rows).at(-1)||null;
}
export function storeClusterGuide(value:ClusterGuideProgress){
 const rows=progress(),identity=scope(value);delete rows[identity];
 try{localStorage.setItem(key,JSON.stringify({...rows,[identity]:value}));}catch{/* The active guide remains available for this window. */}
}
