/** Observe existing runs and verify returned artifacts. Never prepare or submit.
 * Use the exported adapter interface for desktop IPC. CLI targets only an explicitly
 * supplied loopback worker, with its token supplied through the process environment.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROUTES=new Set(['/api/cluster/status','/api/cluster/collect','/api/cluster/result']);
const RUN_STATES=new Set(['draft','validating','ready','queued','running','succeeded','failed','cancelled','unknown']);
const TERMINAL=new Set(['succeeded','failed','cancelled']);
const CHECK_STATES=new Set(['passed','failed','blocked','not_run']);
const HEX=/^[0-9a-f]{64}$/;
const MAX_MANIFEST=256*1024,MAX_RESPONSE=4*1024*1024,MAX_PREVIEW=2*1024*1024;
class ReconcileError extends Error{constructor(code){super(code);this.code=code;}}
function fail(code){throw new ReconcileError(code);}
function plain(value){return !!value&&typeof value==='object'&&!Array.isArray(value);}
function keys(value,allowed,required=[]){
 if(!plain(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))fail('invalid_manifest');
}
function safeName(name){
 if(typeof name!=='string'||!name||name.length>240||/[\\:\x00-\x1f\x7f]/.test(name)||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'))fail('invalid_result_name');
 if(['.studio','collection.json'].includes(name.split('/')[0])||name.startsWith('.submission-')||name==='.submit-attempt')fail('internal_control_file');
 return name;
}
function names(value,max,label){
 if(!Array.isArray(value)||value.length>max||new Set(value).size!==value.length)fail(label);
 return value.map(safeName);
}
export function validateManifest(value){
 if(Buffer.byteLength(JSON.stringify(value)??'')>MAX_MANIFEST)fail('manifest_too_large');
 keys(value,['schema_version','runs'],['schema_version','runs']);
 if(value.schema_version!==1||!Array.isArray(value.runs)||!value.runs.length||value.runs.length>32)fail('invalid_manifest');
 const seen=new Set(),runs=[];
 for(const run of value.runs){
  keys(run,['run_id','job_id','names','previews'],['run_id']);
  if(typeof run.run_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(run.run_id)||seen.has(run.run_id))fail('invalid_run_identity');
  seen.add(run.run_id);
  if(run.job_id!==undefined&&(typeof run.job_id!=='string'||!/^\d{1,32}$/.test(run.job_id)))fail('invalid_job_identity');
  const item={run_id:run.run_id,previews:names(run.previews??[],32,'invalid_previews')};
  if(run.job_id!==undefined)item.job_id=run.job_id;
  if(run.names!==undefined){item.names=names(run.names,128,'invalid_result_names');if(!item.names.length)fail('invalid_result_names');if(item.previews.some(n=>!item.names.includes(n)))fail('preview_not_selected');}
  runs.push(item);
 }
 return {schema_version:1,runs};
}
function integer(value,min,max,code){if(!Number.isInteger(value)||value<min||value>max)fail(code);return value;}
function bounded(value){
 let source;try{source=JSON.stringify(value);}catch{fail('invalid_worker_response');}
 if(typeof source!=='string'||Buffer.byteLength(source)>MAX_RESPONSE)fail('worker_response_too_large');
 return value;
}
function hash(text){return createHash('sha256').update(text).digest('hex');}
function collection(value,run){
 if(!plain(value)||value.run!==run.run_id||!plain(value.manifest)||value.manifest.run_id!==run.run_id||value.manifest.transfer_status!=='passed'||!Array.isArray(value.manifest.files)||!value.manifest.files.length||value.manifest.files.length>128||!Array.isArray(value.files)||value.files.length!==value.manifest.files.length)fail('invalid_collection_receipt');
 if(typeof value.manifest.id!=='string'||!value.manifest.id||value.manifest.id.length>128)fail('invalid_collection_receipt');
 const files=[],seen=new Set();
 for(const file of value.manifest.files){
  if(!plain(file))fail('invalid_collection_receipt');safeName(file.name);
  if(seen.has(file.name)||typeof file.sha256!=='string'||!HEX.test(file.sha256)||!Number.isSafeInteger(file.size)||file.size<0||file.size>128*1024*1024||typeof file.artifact_id!=='string'||!file.artifact_id)fail('invalid_collection_receipt');
  seen.add(file.name);
  const assets=value.files.filter(a=>a?.name===file.name),asset=assets[0],source=asset?.metadata?.source;
  if(assets.length!==1||asset.run_id!==run.run_id||asset.id!==file.artifact_id||asset.sha256!==file.sha256||asset.size!==file.size||source?.run_id!==run.run_id||source?.remote_name!==file.name||source?.remote_sha256!==file.sha256)fail('collection_hash_mismatch');
  files.push({name:file.name,size:file.size,sha256:file.sha256,artifact_id:file.artifact_id});
 }
 if(run.names&&(files.length!==run.names.length||files.some(f=>!run.names.includes(f.name))))fail('collection_selection_mismatch');
 if(files.reduce((sum,f)=>sum+f.size,0)>128*1024*1024)fail('collection_too_large');
 return {status:'passed',id:value.manifest.id,files};
}
function preview(value,file){
 if(!plain(value)||value.name!==file.name||value.sha256!==file.sha256||value.size!==file.size||value.artifact_id!==file.artifact_id)fail('preview_receipt_mismatch');
 if(value.preview_available!==true)return {name:file.name,status:'not_run',code:value.binary?'binary_preview_unavailable':'text_preview_unavailable'};
 if(typeof value.text!=='string'||file.size>MAX_PREVIEW||Buffer.byteLength(value.text)!==file.size||hash(value.text)!==file.sha256)fail('preview_hash_mismatch');
 return {name:file.name,status:'passed',size:file.size,sha256:file.sha256};
}
function code(error){return error instanceof ReconcileError?error.code:'request_unavailable';}
function uncertain(reason){return ['request_unavailable','request_timeout','observation_timeout','authentication_required','worker_request_failed'].includes(reason);}

export async function reconcile({manifest,request,timeoutMs=60000,pollIntervalMs=3000,requestTimeoutMs=15000,now=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const selected=validateManifest(manifest);
 if(typeof request!=='function'||typeof now!=='function'||typeof sleep!=='function')fail('invalid_adapter');
 integer(timeoutMs,1,300000,'invalid_timeout');integer(pollIntervalMs,1,30000,'invalid_poll_interval');integer(requestTimeoutMs,1,120000,'invalid_request_timeout');
 const started=now(),deadline=started+timeoutMs;
 const entries=selected.runs.map(run=>({request:run,done:false,pinnedJob:run.job_id,result:{run_id:run.run_id,status:'unknown',run_status:'unknown',observation:{status:'not_run',attempts:0},collection:{status:'not_run'},previews:run.previews.map(name=>({name,status:'not_run'})),scientific_validation:{status:'not_run'}}}));
 async function call(target,data){
  if(!ROUTES.has(target))fail('forbidden_operation');
  const remaining=Math.min(requestTimeoutMs,Math.ceil(deadline-now()));if(remaining<=0)fail('observation_timeout');
  const controller=new AbortController();let timer;
  try{return bounded(await Promise.race([Promise.resolve().then(()=>request('POST',target,data,{signal:controller.signal})),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ReconcileError('request_timeout'));},remaining);})]));}
  finally{clearTimeout(timer);}
 }
 async function recover(entry){
  const {result,request:run}=entry;
  try{
   const receipt=await call('/api/cluster/collect',{run_id:run.run_id,...(run.names?{names:run.names}:{})});
   result.collection=collection(receipt,run);
  }catch(error){const reason=code(error);result.collection={status:uncertain(reason)?'not_run':'failed',code:reason};throw error;}
  for(const [index,name] of run.previews.entries()){
   try{
    const file=result.collection.files.find(f=>f.name===name);if(!file)fail('preview_not_collected');
    result.previews[index]=preview(await call('/api/cluster/result',{run_id:run.run_id,name}),file);
   }catch(error){const reason=code(error);result.previews[index]={name,status:uncertain(reason)?'unknown':'failed',code:reason};throw error;}
  }
  result.status=result.run_status==='succeeded'&&result.previews.every(p=>p.status==='passed')?'passed':result.run_status==='succeeded'?'unknown':'failed';
 }
 while(entries.some(e=>!e.done)&&now()<deadline){
  for(const entry of entries.filter(e=>!e.done)){
   const {result,request:run}=entry;
   if(now()>=deadline)break;
   try{
    result.observation.attempts++;
    const observed=await call('/api/cluster/status',{run_id:run.run_id});
    if(!plain(observed)||observed.id!==run.run_id||!RUN_STATES.has(observed.status))fail('run_identity_or_state_mismatch');
    result.run_status=observed.status;
    if(observed.job_id!==undefined&&observed.job_id!==null){
     if(typeof observed.job_id!=='string'||!/^\d{1,32}$/.test(observed.job_id)||(entry.pinnedJob&&entry.pinnedJob!==observed.job_id))fail('job_identity_mismatch');
     entry.pinnedJob=observed.job_id;result.job_id=observed.job_id;
    }
    if(entry.pinnedJob&&TERMINAL.has(observed.status)&&observed.job_id!==entry.pinnedJob)fail('job_identity_mismatch');
    result.scientific_validation={status:CHECK_STATES.has(observed.scientific_validation?.status)?observed.scientific_validation.status:'not_run'};
    if(TERMINAL.has(observed.status)){
     result.observation.status='passed';entry.done=true;
     await recover(entry);
    }else result.observation.status='unknown';
   }catch(error){
    const reason=code(error);result.status=uncertain(reason)?'unknown':'failed';result.code=reason;
    if(result.observation.status!=='passed')result.observation.status=result.status;
    entry.done=true;
   }
  }
  if(entries.some(e=>!e.done)&&now()<deadline)await sleep(Math.max(1,Math.min(pollIntervalMs,Math.ceil(deadline-now()))));
 }
 for(const entry of entries.filter(e=>!e.done)){
  entry.result.status='unknown';entry.result.code='observation_timeout';entry.result.observation.status='unknown';
 }
 const runs=entries.map(e=>e.result);
 return {schema_version:1,status:runs.some(r=>r.status==='failed')?'failed':runs.every(r=>r.status==='passed')?'passed':'unknown',scope:'Existing-run observation and hash-verified retrieval only; no submission or new scientific validation',runs,elapsed_ms:Math.max(0,Math.floor(now()-started))};
}

export function loopbackRequest({url,token,fetchApi=globalThis.fetch}={}){
 let base;try{base=new URL(url);}catch{fail('invalid_worker_configuration');}
 if(!['http:','https:'].includes(base.protocol)||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.username||base.password||base.pathname!=='/'||base.search||base.hash||typeof token!=='string'||!token||token.length>4096||/[\s\x00-\x1f\x7f]/.test(token)||typeof fetchApi!=='function')fail('invalid_worker_configuration');
 return async(method,target,data,{signal}={})=>{
  if(method!=='POST'||!ROUTES.has(target))fail('forbidden_operation');
  let response;try{response=await fetchApi(base.origin+target,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data),signal,redirect:'error'});}catch{fail('request_unavailable');}
  if(!response.ok)fail(response.status===401?'authentication_required':[408,429].includes(response.status)||response.status>=500?'worker_request_failed':'worker_request_rejected');
  let reader,bytes=0;const chunks=[];
  try{
   reader=response.body.getReader();
   for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>MAX_RESPONSE){await reader.cancel();fail('worker_response_too_large');}chunks.push(Buffer.from(next.value));}
   return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch(error){if(error instanceof ReconcileError)throw error;fail('invalid_worker_response');}
  finally{reader?.releaseLock();}
 };
}

export async function main(argv,{env=process.env,fetchApi=globalThis.fetch}={}){
 const args={};
 for(let i=0;i<argv.length;i++){
  const key=argv[i];if(!['--manifest','--timeout-ms','--poll-ms','--request-timeout-ms'].includes(key)||Object.hasOwn(args,key)||!argv[i+1]||argv[i+1].startsWith('--'))fail('invalid_arguments');
  args[key]=argv[++i];
 }
 if(!args['--manifest'])fail('manifest_required');
 let manifest;
 try{const file=path.resolve(args['--manifest']),info=fs.lstatSync(file);if(info.isSymbolicLink()||!info.isFile()||info.size>MAX_MANIFEST)fail('invalid_manifest_file');manifest=JSON.parse(fs.readFileSync(file,'utf8'));}
 catch(error){if(error instanceof ReconcileError)throw error;fail('invalid_manifest_file');}
 return reconcile({manifest,request:loopbackRequest({url:env.STUDIO_WORKER_URL,token:env.STUDIO_WORKER_TOKEN,fetchApi}),
  ...(args['--timeout-ms']?{timeoutMs:Number(args['--timeout-ms'])}:{}),...(args['--poll-ms']?{pollIntervalMs:Number(args['--poll-ms'])}:{}),...(args['--request-timeout-ms']?{requestTimeoutMs:Number(args['--request-timeout-ms'])}:{})});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const report=await main(process.argv.slice(2));process.stdout.write(JSON.stringify(report)+'\n');process.exitCode=report.status==='passed'?0:report.status==='unknown'?2:1;}
 catch(error){process.stdout.write(JSON.stringify({status:'failed',code:code(error)})+'\n');process.exitCode=1;}
}
