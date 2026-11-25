/** Existing human save route, with a read-only preparation fence for live SSH environment updates. */
import {isDeepStrictEqual as equal} from 'node:util';
import {previewComputeProfileUpdate} from './compute-profiles.mjs';

const fail=()=>{throw Error('compute_profile_environment_in_use');};
function withoutEnvironment(profile){const {version,serviceEnvironment,...body}=profile;return body;}
export async function saveComputeProfileWithEnvironment({profiles,terminal,resource,sshService,managedResources,assertIdle=()=>{}},request){
 assertIdle();
 if(request?.id===undefined||request?.kind!=='ssh')return profiles.save(request);
 const previous=profiles.read({id:request.id}),next=previewComputeProfileUpdate(previous,request);
 if(previous.kind!=='ssh'||next.version===previous.version||equal(previous.serviceEnvironment,next.serviceEnvironment))return profiles.save(request);
 const live=terminal.inUseProfileIds().includes(previous.id);
 if(!equal(withoutEnvironment(previous),withoutEnvironment(next))){if(live)fail();return profiles.save(request);}
 if(typeof terminal.prepareProfileEnvironmentUpdate!=='function'||typeof terminal.assertProfileEnvironmentUpdate!=='function'||typeof terminal.commitProfileEnvironmentUpdate!=='function'){if(live)fail();return profiles.save(request);}
 const guardService=()=>{
  assertIdle();
  const service=sshService?.peek();
  if(service?.profileId===previous.id&&service.status!=='disconnected'&&!(service.status==='failed'&&(service.schemaVersion===2?service.serviceActive===false:service.terminalAccess==='available')))fail();
  sshService?.assertProfileEnvironmentUpdate?.(previous,next);
  managedResources?.assertProfileEnvironmentUpdate?.(previous,next);
 };
 guardService();
 let terminalReceipt;
 try{terminalReceipt=await terminal.prepareProfileEnvironmentUpdate({previous,next});}
 catch(error){if(typeof error?.message==='string'&&error.message.startsWith('terminal_'))fail();throw error;}
 let committed=false;
 try{
  const resourceReceipt=resource.prepareProfileEnvironmentUpdate({previous,next,sessionIds:terminalReceipt.sessionIds,connectionIds:terminalReceipt.connectionIds});
  guardService();terminal.assertProfileEnvironmentUpdate(terminalReceipt);resource.assertProfileEnvironmentUpdate(resourceReceipt);
  if(!equal(profiles.read({id:previous.id}),previous))throw Error('compute_profile_changed');
  // The broker holds an exact connection/revision preparation lock across this
  // asynchronous commit. Saving the private recipe is not live adoption proof.
  // Lost acknowledgements stay unconfirmed; neither commit nor auth is replayed.
  const saved=profiles.save(request),adopted=await terminal.commitProfileEnvironmentUpdate(terminalReceipt,saved);
  assertIdle();resource.assertProfileEnvironmentUpdate(resourceReceipt);
  resource.commitProfileEnvironmentUpdate(resourceReceipt,saved,adopted);
  sshService?.profileEnvironmentUpdated?.(previous,saved);
  managedResources?.profileEnvironmentUpdated?.(previous,saved,adopted);committed=true;
  return saved;
 }finally{if(!committed)try{await terminal.abortProfileEnvironmentUpdate?.(terminalReceipt);}catch{}}
}
