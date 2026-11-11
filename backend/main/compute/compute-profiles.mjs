/** Human-only desktop connection registry. Saving never connects, probes or grants execution. */
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {isIP} from 'node:net';

const KIND='compute-profile',REGISTRY_KIND='compute-profile-registry',REGISTRY_ID='main',UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=code=>{throw Error(code);};
const string=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const winAbsolute=v=>/^[A-Za-z]:[\\/]/.test(v)||/^\\\\[^\\]/.test(v);
const reference=v=>string(v,4096)&&(v.startsWith('/')||v.startsWith('~/')||winAbsolute(v))&&!/-----BEGIN|^(?:ssh-|ecdsa-)/i.test(v);
function exact(value,allowed,required=[]){if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))fail('compute_profile_invalid_request');}
function content(value){
 const common=['kind','name'],fields=value?.kind==='wsl'?['distribution','root','port','intent']:value?.kind==='ssh'?['host','username','port','ssh_client','identity_file','proxy_jump','via','mode','distribution']:[];
 exact(value,[...common,...fields],common);if(!['wsl','ssh'].includes(value.kind)||!string(value.name,120)||!value.name.trim())fail('compute_profile_invalid_request');
 const result={kind:value.kind,name:value.name.trim()};
 if(value.kind==='wsl'){
  if(!string(value.distribution,80)||! /^[\w .-]+$/.test(value.distribution)||!string(value.root,4096)||! /^(?:\/|~\/)/.test(value.root)||['/','~/'].includes(value.root)||value.root.split('/').includes('..')||!Number.isInteger(value.port)||value.port<1024||value.port>65535||value.intent!==undefined&&!['standard','existing'].includes(value.intent))fail('compute_profile_invalid_request');
  return {...result,distribution:value.distribution,root:value.root,port:value.port,intent:value.intent||'standard'};
 }
 if(!string(value.host,255)||!isIP(value.host)&&! /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(value.host)||!string(value.username,100)||! /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(value.username)||!Number.isInteger(value.port)||value.port<1||value.port>65535||!reference(value.ssh_client)||value.ssh_client.startsWith('~/')||!['interactive','key'].includes(value.mode)||value.distribution!==undefined&&(!string(value.distribution,80)||! /^[\w .-]+$/.test(value.distribution)))fail('compute_profile_invalid_request');
 const identity=value.identity_file??'',jumps=value.proxy_jump??[],via=value.via??[];
 if(typeof identity!=='string'||identity!==''&&!reference(identity))fail('compute_profile_invalid_request');
 for(const route of [jumps,via])if(!Array.isArray(route)||route.length>8||route.some(v=>!string(v,255)||! /^[A-Za-z0-9_][A-Za-z0-9_.@:\[\]-]*$/.test(v)))fail('compute_profile_invalid_request');
 return {...result,host:value.host,username:value.username,port:value.port,ssh_client:value.ssh_client,identity_file:identity,proxy_jump:[...jumps],via:[...via],mode:value.mode,...value.distribution!==undefined?{distribution:value.distribution}:{}};
}
function stored(value){
 exact(value,['id','version','kind','name','distribution','root','port','intent','host','username','ssh_client','identity_file','proxy_jump','via','mode'],['id','version']);
 const {id,version,...body}=value;if(!UUID.test(id||'')||!Number.isSafeInteger(version)||version<1)fail('compute_profile_unavailable');
 return {id,version,...content(body)};
}
export function createComputeProfiles({catalog,id=randomUUID,initialWsl}={}){
 if(!catalog||typeof catalog.get!=='function'||typeof catalog.put!=='function'||typeof catalog.list!=='function')fail('compute_profile_unavailable');
 let seedChecked=false;
 function read(request){exact(request,['id','version'],['id']);if(!UUID.test(request.id||'')||request.version!==undefined&&(!Number.isSafeInteger(request.version)||request.version<1))fail('compute_profile_invalid_request');const raw=catalog.get(KIND,request.id);if(!raw)fail('compute_profile_unavailable');const profile=stored(raw);if(profile.id!==request.id)fail('compute_profile_unavailable');if(request.version!==undefined&&profile.version!==request.version)fail('compute_profile_changed');return structuredClone(profile);}
 function saveValue(request){
  exact(request,['id','expectedVersion','kind','name','distribution','root','port','intent','host','username','ssh_client','identity_file','proxy_jump','via','mode'],['expectedVersion','kind','name']);
  const {id:requestedId,expectedVersion,...body}=request;if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)fail('compute_profile_invalid_request');const next=content(body);
  if(requestedId===undefined){if(expectedVersion!==0)fail('compute_profile_changed');const nextId=id();if(!UUID.test(nextId||'')||catalog.get(KIND,nextId))fail('compute_profile_unavailable');const value={id:nextId,version:1,...next};catalog.put(KIND,nextId,structuredClone(value));return structuredClone(value);}
  if(!UUID.test(requestedId||'')||expectedVersion<1)fail('compute_profile_invalid_request');const previous=read({id:requestedId});if(previous.version!==expectedVersion)fail('compute_profile_changed');if(previous.kind!==next.kind)fail('compute_profile_invalid_request');const {id:_,version,...oldBody}=previous;if(equal(oldBody,next))return previous;if(!Number.isSafeInteger(version+1))fail('compute_profile_unavailable');const value={id:requestedId,version:version+1,...next};catalog.put(KIND,requestedId,structuredClone(value));return structuredClone(value);
 }
 const save=request=>typeof catalog.transaction==='function'?catalog.transaction(()=>saveValue(request)):saveValue(request);
 function seedConsumed(){const marker=catalog.get(REGISTRY_KIND,REGISTRY_ID);if(marker===null||marker===undefined)return false;if(!object(marker)||marker.schema_version!==1||marker.initial_wsl_seed_consumed!==true)fail('compute_profile_unavailable');return true;}
 function removeValue(request){
  exact(request,['id','expectedVersion'],['id','expectedVersion']);
  if(!UUID.test(request.id||'')||!Number.isSafeInteger(request.expectedVersion)||request.expectedVersion<1)fail('compute_profile_invalid_request');
  const profile=read({id:request.id,version:request.expectedVersion});
  const consumed=seedConsumed();
  if(typeof catalog.remove!=='function')fail('compute_profile_unavailable');
  // Only the saved desktop reference is removed. The explicit worker binding,
  // sessions, credentials, registered environments and run records are separate.
  catalog.remove(KIND,profile.id);
  if(!consumed)catalog.put(REGISTRY_KIND,REGISTRY_ID,{schema_version:1,initial_wsl_seed_consumed:true});
  seedChecked=true;
  return {removed:true,id:profile.id,version:profile.version};
 }
 const remove=request=>{if(typeof catalog.transaction!=='function')fail('compute_profile_unavailable');return catalog.transaction(()=>removeValue(request));};
 function list(request={}){
  exact(request,['kind']);if(request.kind!==undefined&&!['wsl','ssh'].includes(request.kind))fail('compute_profile_invalid_request');let rows=catalog.list(KIND);
  if(!seedChecked){const consumed=seedConsumed();seedChecked=true;if(rows.length===0&&initialWsl&&!consumed){const {distribution,root,port,intent}=initialWsl;save({expectedVersion:0,kind:'wsl',name:'WSL',distribution,root,port,intent:intent||'standard'});rows=catalog.list(KIND);}}
  if(rows.length>1000)fail('compute_profile_unavailable');return rows.map(stored).filter(v=>request.kind===undefined||v.kind===request.kind).map(v=>structuredClone(v));
 }
 return {list,read,save,remove};
}
