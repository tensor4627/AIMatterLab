const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const schedulerInspectionPath='/api/ssh-service/inspect-scheduler';
export const schedulerInspectionCapability='scheduler-inspection-v1';

export function schedulerObservation(value){
 if(!plain(value)||!['observed','blocked'].includes(value.status)||!Number.isFinite(value.observed_at)||value.observed_at<0||!Array.isArray(value.observations)||value.observations.length!==2||value.automatic_retry!==false)throw Error('Current scheduler observation was not confirmed');
 const statuses=new Set(['observed','not_found','timed_out','output_limit','invalid_output','command_failed']);
 const observations=value.observations.map((item,index)=>{
  const scheduler=index===0?'slurm':'lsf';
  if(!plain(item)||item.scheduler!==scheduler||!statuses.has(item.status)||!Array.isArray(item.queues)||item.queues.length>512||item.status!=='observed'&&item.queues.length)throw Error('Current scheduler observation was not confirmed');
  const queues=item.queues.map(queue=>{
   if(!plain(queue)||typeof queue.name!=='string'||!/^[A-Za-z0-9_.+\-]{1,120}$/.test(queue.name))throw Error('Current scheduler observation was not confirmed');
   if(scheduler==='slurm'){
    if(typeof queue.default!=='boolean'||!['up','down','inact','drain'].includes(queue.availability)||!Number.isSafeInteger(queue.node_count)||queue.node_count<0||queue.node_count>10000000||typeof queue.node_state!=='string'||!/^[A-Za-z0-9_+~#*%$@.!\-]{1,40}$/.test(queue.node_state)||typeof queue.gres!=='string'||!/^[A-Za-z0-9_:.,()+/\-]{0,160}$/.test(queue.gres))throw Error('Current scheduler observation was not confirmed');
    return {name:queue.name,default:queue.default,availability:queue.availability,node_count:queue.node_count,node_state:queue.node_state,gres:queue.gres};
   }
   if(!/^(?:open|closed):(?:active|inact)$/.test(queue.availability))throw Error('Current scheduler observation was not confirmed');
   return {name:queue.name,availability:queue.availability};
  });
  return {scheduler,status:item.status,queues};
 });
 if((observations.some(item=>item.status==='observed')?'observed':'blocked')!==value.status)throw Error('Current scheduler observation was not confirmed');
 return {status:value.status,observed_at:value.observed_at,observations,automatic_retry:false,scope:'Current login-host scheduler and visible queues only; not_found means absent on this bridge PATH, not proof that software is uninstalled. Compute-node GPU availability, execution authorization and scientific validation not_run'};
}
