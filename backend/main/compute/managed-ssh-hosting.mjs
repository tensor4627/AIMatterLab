import {isDeepStrictEqual as equal} from 'node:util';
import {absoluteWorkspace,observedIdentity} from '../../../desktop/platform/terminal-service/workspace-probe.mjs';

const kind='managed-ssh-hosting';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const scopeId=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!value.includes('\0');
const nullableId=value=>value===null||scopeId(value);
const accessKinds=new Set(['conversation','desktop-project','worker-project']);

export function hostedWorkspace(registration){
 if(!hash(registration?.resourceId)||!hash(registration.workspaceId)||
    !observedIdentity({...registration.hostIdentity,account:registration.account})||!absoluteWorkspace(registration.root))return null;
 const {resourceId,workspaceId,root,account,hostIdentity}=registration;
 return {resourceId,workspaceId,root,account,hostIdentity:structuredClone(hostIdentity)};
}

export function sameHostedTarget(record,resource){
 return record?.profileId===resource.profileId&&record.profileVersion===resource.profileVersion&&
  record.targetFingerprint===resource.targetFingerprint&&equal(record.workspace,hostedWorkspace(resource.workspaceRegistration));
}

export const hostedLeaseKey=({provider,threadId})=>JSON.stringify([provider,threadId]);

function validGrant(access){return accessKinds.has(access?.authority)&&nullableId(access.taskId);}
function validLease(row){
 return id(row?.id)&&scopeId(row.provider)&&scopeId(row.threadId)&&nullableId(row.projectId)&&
  (row.terminal===undefined||validGrant(row.terminal)&&id(row.terminal.connectionId)&&id(row.terminal.channelLeaseId))&&
  (row.service===undefined||validGrant(row.service)&&hash(row.service.sourceId))&&!!(row.terminal||row.service);
}
function validRecord(row){
 return row?.schemaVersion===1&&id(row.profileId)&&id(row.connectionId)&&Number.isSafeInteger(row.profileVersion)&&row.profileVersion>0&&
  hash(row.targetFingerprint)&&hostedWorkspace(row.workspace)&&Array.isArray(row.previousConnections)&&row.previousConnections.every(id)&&
  (row.legacySourceId===undefined||hash(row.legacySourceId))&&
  row.leases&&typeof row.leases==='object'&&!Array.isArray(row.leases)&&
  Object.entries(row.leases).every(([key,lease])=>validLease(lease)&&key===hostedLeaseKey(lease));
}

/** Only a verified publication and completed channel acquisitions write this index. */
export function createManagedSshHosting(catalog){
 const records=new Map((catalog?.list?.(kind)??[]).filter(validRecord).map(row=>[row.profileId,row]));
 function save(record){
  const {leases,...target}=record;
  catalog?.put?.(kind,record.profileId,{...target,leases});
 }
 function replace(resource,previous){
  const workspace=hostedWorkspace(resource.workspaceRegistration);
  if(!workspace)return null;
  const {profileId,profileVersion,targetFingerprint,connectionId}=resource;
  const prior=previous?.previousConnections??[];
  const previousConnections=previous&&previous.connectionId!==connectionId?[...prior,previous.connectionId].slice(-64):prior;
  const legacySourceId=previous?.legacySourceId??resource.legacySourceId;
  const record={schemaVersion:1,profileId,profileVersion,targetFingerprint,connectionId,workspace,previousConnections,
   ...legacySourceId?{legacySourceId}:{},leases:previous?.leases??{}};
  save(record);records.set(profileId,record);return record;
 }
 function forget(record){
  if(!record||records.get(record.profileId)!==record)return;
  catalog?.remove?.(kind,record.profileId);records.delete(record.profileId);
 }
 function setLease(record,owner,value){
  if(!record||records.get(record.profileId)!==record)return;
  const key=hostedLeaseKey(owner),leases={...record.leases};
  if(value&&validLease(value))leases[key]=value;else delete leases[key];
  save({...record,leases});record.leases=leases;
 }
 return {get:profileId=>records.get(profileId),list:()=>[...records.values()],replace,forget,setLease};
}
