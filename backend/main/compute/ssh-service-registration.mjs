/** Persistent setup evidence, never a live channel or execution grant. */
import {createHash} from 'node:crypto';
const KIND='ssh-service-registration',SCHEMA=1;
const maintenanceCodes=new Set(['environment_activation_failed','python_start_failed','python_unsupported','sqlite_unavailable','transport_hash_mismatch','transport_cache_invalid','worker_hash_mismatch','worker_cache_invalid','namespace_unsafe','permission_denied','storage_unavailable','worker_start_failed','worker_identity_unavailable','worker_health_invalid','identity_unconfirmed','tools_unavailable','local_resources_unavailable','maintenance_required']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\r\n\0]/.test(value);
const absolute=value=>text(value,4096)&&value.startsWith('/')&&value!=='/'&&!value.split('/').includes('..');
const fail=code=>{throw Error(code);};
function profileValid(profile){if(profile?.kind!=='ssh'||!id(profile.id)||!Number.isSafeInteger(profile.version)||profile.version<1)fail('ssh_service_registration_invalid');}
function signature(profile){
 profileValid(profile);
 const target={host:profile.host,username:profile.username,port:profile.port,ssh_client:profile.ssh_client,distribution:profile.distribution||'',identity_file:profile.identity_file||'',proxy_jump:profile.proxy_jump||[],via:profile.via||[],mode:profile.mode,environment:{python:profile.serviceEnvironment?.python||'python3',activation:profile.serviceEnvironment?.activation||''}};
 return createHash('sha256').update(JSON.stringify(target)).digest('hex');
}
function checkedHealth(value){
 const health=value?.health||value,host=health?.hostIdentity||{hostname:health?.hostname,uid:health?.uid,machineId:health?.machineId},runtimeId=health?.runtimeId||health?.runtime_id;
 if(!object(health)||health.name!=='gpu-sampling-studio'||health.execution_policy!=='desktop-review-v1'||!absolute(health.root)||!absolute(health.runtime)||!/^[a-f0-9]{20}$/.test(runtimeId||'')||!Number.isInteger(health.port)||health.port<1024||health.port>65535||!object(host)||!text(host.hostname,255)||!Number.isSafeInteger(host.uid)||host.uid<0||!text(host.machineId,256))fail('ssh_service_registration_invalid');
 return {hostIdentity:{hostname:host.hostname,uid:host.uid,machineId:host.machineId},root:health.root,runtime:health.runtime,runtimeId,port:health.port};
}
function stored(value){
 if(!object(value)||value.schemaVersion!==SCHEMA||!id(value.profileId)||!Number.isSafeInteger(value.configuredAtProfileVersion)||value.configuredAtProfileVersion<1||!/^[a-f0-9]{64}$/.test(value.configurationSignature||'')||!Number.isSafeInteger(value.revision)||value.revision<1||!Number.isFinite(value.checkedAt)||value.checkedAt<=0)fail('ssh_service_registration_invalid');
 const health=checkedHealth({name:'gpu-sampling-studio',execution_policy:'desktop-review-v1',...value});
 const tools=value.tools?.status==='ready'&&Number.isSafeInteger(value.tools.count)&&value.tools.count>0?{status:'ready',count:value.tools.count}:value.tools?.status==='legacy_not_recorded'?{status:'legacy_not_recorded'}:null;
 if(!tools)fail('ssh_service_registration_invalid');
 if(value.maintenance!==undefined&&(!object(value.maintenance)||!maintenanceCodes.has(value.maintenance.code)))fail('ssh_service_registration_invalid');
 return {schemaVersion:SCHEMA,profileId:value.profileId,configuredAtProfileVersion:value.configuredAtProfileVersion,configurationSignature:value.configurationSignature,revision:value.revision,checkedAt:value.checkedAt,...health,tools,...value.maintenance?{maintenance:{code:value.maintenance.code}}:{}};
}
const publicRecord=value=>{const {configurationSignature,...record}=value;return structuredClone(record);};
export function createSshServiceRegistration({catalog,profiles,legacyBinding=()=>null,now=Date.now}){
 if(!catalog?.get||!catalog?.put||!profiles?.read||!profiles?.list)fail('ssh_service_registration_invalid');
 function selected(request){if(!object(request)||Object.keys(request).some(key=>!['profileId','profileVersion'].includes(key))||!id(request.profileId)||!Number.isSafeInteger(request.profileVersion)||request.profileVersion<1)fail('ssh_service_registration_invalid');const profile=profiles.read({id:request.profileId,version:request.profileVersion});profileValid(profile);return profile;}
 function migrate(profile){
  const legacy=legacyBinding();if(legacy?.kind!=='ssh'||legacy.version!==2||legacy.profileId!==profile.id||legacy.profileVersion!==profile.version||!Number.isFinite(legacy.checkedAt)||legacy.checkedAt<=0)return null;
  let health;try{health=checkedHealth(legacy.health||legacy);}catch{return null;}
  // A legacy descriptor without its actual port/health is not setup evidence.
  const value={schemaVersion:SCHEMA,profileId:profile.id,configuredAtProfileVersion:profile.version,configurationSignature:signature(profile),revision:1,checkedAt:legacy.checkedAt,...health,tools:{status:'legacy_not_recorded'}};
  catalog.put(KIND,profile.id,value);return value;
 }
 function read(request){
  const profile=selected(request);let raw=catalog.get(KIND,profile.id),registration;
  if(!raw)raw=migrate(profile);
  if(!raw)return {status:'unconfigured',profileId:profile.id,profileVersion:profile.version};
  try{registration=stored(raw);if(registration.profileId!==profile.id)throw Error();}catch{return {status:'maintenance_required',reason:'registration_invalid',profileId:profile.id,profileVersion:profile.version};}
  const changed=registration.configurationSignature!==signature(profile),maintenance=changed||!!registration.maintenance;
  return {status:maintenance?'maintenance_required':'configured',...maintenance?{reason:changed?'configuration_changed':registration.maintenance.code}:{},profileId:profile.id,profileVersion:profile.version,registration:publicRecord(registration)};
 }
 function remember(profile,health,tools){
  profileValid(profile);const current=profiles.read({id:profile.id,version:profile.version});if(signature(current)!==signature(profile))fail('ssh_service_registration_changed');
  const observed=checkedHealth(health);if(tools?.status!=='ready'||!Number.isSafeInteger(tools.count)||tools.count<1)fail('ssh_service_registration_invalid');
  let revision=1;const old=catalog.get(KIND,profile.id);if(old){try{revision=stored(old).revision+1;}catch{revision=1;}}
  const value=stored({schemaVersion:SCHEMA,profileId:profile.id,configuredAtProfileVersion:profile.version,configurationSignature:signature(profile),revision,checkedAt:now(),...observed,tools:{status:'ready',count:tools.count}});
  catalog.put(KIND,profile.id,value);return read({profileId:profile.id,profileVersion:profile.version});
 }
 function validateReuse(profile,health){
  profileValid(profile);const view=read({profileId:profile.id,profileVersion:profile.version});if(view.status!=='configured')fail(view.status==='unconfigured'?'ssh_service_registration_required':'ssh_service_maintenance_required');
  if(health!==undefined){const actual=checkedHealth(health),expected=view.registration;if(['root','runtime','runtimeId','port'].some(key=>actual[key]!==expected[key])||['hostname','uid','machineId'].some(key=>actual.hostIdentity[key]!==expected.hostIdentity[key]))fail('ssh_service_registration_identity_changed');}
  return view.registration;
 }
 function markMaintenance(profile,code){
  profileValid(profile);profiles.read({id:profile.id,version:profile.version});
  if(!maintenanceCodes.has(code))return read({profileId:profile.id,profileVersion:profile.version});
  const raw=catalog.get(KIND,profile.id);if(raw){let value;try{value=stored(raw);}catch{return read({profileId:profile.id,profileVersion:profile.version});}if(value.profileId!==profile.id)fail('ssh_service_registration_invalid');catalog.put(KIND,profile.id,{...value,revision:value.revision+1,maintenance:{code}});}
  return read({profileId:profile.id,profileVersion:profile.version});
 }
 function list(){return profiles.list({kind:'ssh'}).map(profile=>read({profileId:profile.id,profileVersion:profile.version}));}
 return {read,remember,list,validateReuse,markMaintenance};
}
