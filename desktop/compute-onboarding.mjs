/** Discover installed compute once per connection. Never grant project access. */
export function createComputeOnboarding({worker,publish=()=>{}}){
 let pending=null;
 return async function configure({force=false,register=true}={}){
  if(typeof force!=='boolean'||typeof register!=='boolean')throw Error('Invalid compute setup request');
  if(pending)return pending;
  const connection=worker.connection;
  if(!connection)throw Error('Connect the WSL worker first');
  const current=()=>{if(worker.connection!==connection)throw Error('Compute connection changed; check the selected worker again');};
  pending=(async()=>{
   publish({method:'studio/computeSetup',params:{status:'discovering'}});
   const discovery=await worker.request('POST','/api/environments/discover',{force});current();
   const candidates=discovery.entries.filter(value=>value.status==='discovered').map(value=>value.id);
   let adopted;
   if(register&&candidates.length){adopted=await worker.request('POST','/api/environments/adopt',{identity:discovery.identity,candidates});current();}
   const result={status:candidates.length?'observed':'blocked',discovery,registered:adopted?.environments||[]};
   publish({method:'studio/computeSetup',params:{status:result.status,count:result.registered.length,observedAt:discovery.observed_at}});
   return result;
  })().catch(error=>{publish({method:'studio/computeSetup',params:{status:'blocked',reason:'Local environment discovery did not complete; open Compute environments to retry.'}});throw error;}).finally(()=>{pending=null;});
  return pending;
 };
}
