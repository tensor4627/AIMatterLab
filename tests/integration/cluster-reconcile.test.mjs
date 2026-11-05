import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {reconcile,validateManifest,loopbackRequest,main} from "../../scripts/cluster-reconcile.mjs";

const digest=s=>createHash('sha256').update(s).digest('hex');
function manifest(changes={}){return {schema_version:1,runs:[{run_id:'recorded-run',job_id:'123',names:['console.log'],previews:['console.log'],...changes}]};}
function fixture({states=['succeeded'],text='fixture ✓ trajectory\n',statusOverride,collectionOverride,previewOverride}={}){
 const calls=[];let clock=0,index=0;
 const file={name:'console.log',size:Buffer.byteLength(text),sha256:digest(text),artifact_id:'recorded-asset'};
 const receipt={run:'recorded-run',manifest:{id:'collection-identity',run_id:'recorded-run',transfer_status:'passed',files:[file]},files:[{id:file.artifact_id,run_id:'recorded-run',name:file.name,size:file.size,sha256:file.sha256,path:'private-path-never-returned',metadata:{source:{run_id:'recorded-run',remote_name:file.name,remote_sha256:file.sha256}}}]};
 const request=async(method,target,data)=>{
  calls.push({method,target,data});assert.equal(method,'POST');assert.equal(data.run_id,'recorded-run');
  if(target==='/api/cluster/status')return statusOverride?.(index++)??{id:'recorded-run',job_id:'123',status:states[Math.min(index++,states.length-1)],scientific_validation:{status:'not_run'}};
  if(target==='/api/cluster/collect')return collectionOverride?.(structuredClone(receipt))??structuredClone(receipt);
  if(target==='/api/cluster/result')return previewOverride?.({name:file.name,artifact_id:file.artifact_id,size:file.size,sha256:file.sha256,preview_available:true,text})??{name:file.name,artifact_id:file.artifact_id,size:file.size,sha256:file.sha256,preview_available:true,text};
  throw Error('Unexpected fixture route');
 };
 return {request,calls,now:()=>clock,sleep:async ms=>{clock+=ms;},receipt,file};
}

test('Recorded runs are observed through terminal collection and exact UTF8 preview proof without privileged operations',async()=>{
 const f=fixture({states:['queued','running','succeeded']});
 const result=await reconcile({...f,manifest:manifest(),timeoutMs:30,pollIntervalMs:5});
 assert.equal(result.status,'passed');assert.equal(result.runs[0].run_status,'succeeded');assert.equal(result.runs[0].collection.status,'passed');
 assert.equal(result.runs[0].scientific_validation.status,'not_run');assert.equal(result.runs[0].previews[0].status,'passed');
 assert(f.calls.every(c=>['/api/cluster/status','/api/cluster/collect','/api/cluster/result'].includes(c.target)));
 assert(f.calls.some(c=>c.target==='/api/cluster/collect'&&JSON.stringify(c.data.names)==='["console.log"]'));
 assert(!JSON.stringify(result).includes('private-path'));assert(!JSON.stringify(result).includes('trajectory'));
});

test('Observation timeout retains unknown state and never collects or resubmits',async()=>{
 const f=fixture({states:['unknown']});
 const result=await reconcile({...f,manifest:manifest(),timeoutMs:12,pollIntervalMs:5});
 assert.equal(result.status,'unknown');assert.equal(result.runs[0].run_status,'unknown');assert.equal(result.runs[0].collection.status,'not_run');
 assert.equal(result.runs[0].code,'observation_timeout');assert.equal(result.elapsed_ms,12);
 assert(f.calls.every(c=>c.target==='/api/cluster/status'));assert(f.calls.length<5);
});

test('A queued observation remains queued after its observation budget expires',async()=>{
 const f=fixture({states:['queued']});const result=await reconcile({...f,manifest:manifest(),timeoutMs:4,pollIntervalMs:3});
 assert.equal(result.status,'unknown');assert.equal(result.runs[0].run_status,'queued');assert.equal(result.runs[0].collection.status,'not_run');
});

test('Disconnect errors are redacted and preserve uncertainty rather than inventing run failure',async()=>{
 const secret='private-endpoint-and-token-must-not-appear';
 const report=await reconcile({manifest:manifest(),request:async()=>{throw Error(secret);},timeoutMs:20,pollIntervalMs:1});
 assert.equal(report.status,'unknown');assert.equal(report.runs[0].collection.status,'not_run');assert.equal(report.runs[0].code,'request_unavailable');
 assert(!JSON.stringify(report).includes(secret));
});

test('An unresponsive request is bounded and receives an aborted signal',async()=>{
 let signal;
 const report=await reconcile({manifest:manifest(),request:(_m,_t,_d,options)=>{signal=options.signal;return new Promise(()=>{});},timeoutMs:40,requestTimeoutMs:10,pollIntervalMs:1});
 assert.equal(report.status,'unknown');assert.equal(report.runs[0].code,'request_timeout');assert.equal(signal.aborted,true);
});

test('Run and configured scheduler identities cannot change during reconciliation',async()=>{
 for(const change of [{id:'different-run',job_id:'123',status:'succeeded'},{id:'recorded-run',job_id:'999',status:'succeeded'}]){
  const f=fixture({statusOverride:()=>change});const report=await reconcile({...f,manifest:manifest(),timeoutMs:20,pollIntervalMs:1});
  assert.equal(report.status,'failed');assert.equal(f.calls.length,1);
 }
 const f=fixture({statusOverride:index=>({id:'recorded-run',job_id:index===0?'123':'999',status:index===0?'queued':'running'})});
 const m=manifest();delete m.runs[0].job_id;
 const report=await reconcile({...f,manifest:m,timeoutMs:20,pollIntervalMs:1});
 assert.equal(report.status,'failed');assert.equal(report.runs[0].code,'job_identity_mismatch');
});

test('Collection source hash or manifest disagreement fails independently of backend passed status',async()=>{
 const variants=[r=>{r.files[0].sha256=digest('altered');return r;},r=>{r.files[0].metadata.source.remote_sha256=digest('altered');return r;},r=>{r.manifest.files[0].artifact_id='different-asset';return r;},r=>{r.manifest.run_id='other-run';return r;}];
 for(const change of variants){const f=fixture({collectionOverride:change});const report=await reconcile({...f,manifest:manifest(),timeoutMs:30,pollIntervalMs:1});assert.equal(report.status,'failed');assert.equal(report.runs[0].collection.status,'failed');assert(!f.calls.some(c=>c.target==='/api/cluster/result'));}
});

test('Text preview must match the collection artifact identity, exact byte size and SHA',async()=>{
 for(const change of [r=>({...r,text:r.text+'changed'}),r=>({...r,size:r.size+1}),r=>({...r,artifact_id:'other-artifact'}),r=>({...r,sha256:digest('other')})]){
  const f=fixture({previewOverride:change});const report=await reconcile({...f,manifest:manifest(),timeoutMs:30,pollIntervalMs:1});assert.equal(report.status,'failed');assert.equal(report.runs[0].previews[0].status,'failed');
 }
});

test('Unavailable binary or bounded previews are explicitly not_run with unknown verification status',async()=>{
 const f=fixture({previewOverride:r=>({...r,preview_available:false,binary:true,text:undefined})});
 const report=await reconcile({...f,manifest:manifest(),timeoutMs:30,pollIntervalMs:1});
 assert.equal(report.status,'unknown');assert.equal(report.runs[0].run_status,'succeeded');assert.equal(report.runs[0].collection.status,'passed');assert.equal(report.runs[0].previews[0].status,'not_run');
});

test('Failed and cancelled terminal runs may be recovered but never reported as successful runs',async()=>{
 for(const status of ['failed','cancelled']){
  const f=fixture({states:[status]});const report=await reconcile({...f,manifest:manifest(),timeoutMs:30,pollIntervalMs:1});
  assert.equal(report.status,'failed');assert.equal(report.runs[0].run_status,status);assert.equal(report.runs[0].collection.status,'passed');
 }
});

test('Manifest names, counts and fields are bounded and cannot select control files or change authorization',()=>{
 for(const invalid of [manifest({names:['../secret']}),manifest({previews:['/absolute']}),manifest({names:['.studio/run.json']}),manifest({names:['collection.json']}),manifest({names:['console.log','console.log']}),manifest({names:['console.log'],previews:['other.out']}),manifest({token:'not-allowed'}),{schema_version:1,runs:Array.from({length:33},(_,i)=>({run_id:'run-'+i}))},{schema_version:1,runs:[{run_id:'same'},{run_id:'same'}]}])assert.throws(()=>validateManifest(invalid));
 assert.equal(validateManifest(manifest({names:['nested/result.out'],previews:[]})).runs[0].names[0],'nested/result.out');
});

test('Loopback adapter rejects external/authenticated URLs and mutations before calling fetch',async()=>{
 let calls=0;
 for(const url of ['https://unrelated.example.test','http://localhost.example.test','http://user:password@localhost','http://localhost/?token=not-allowed','file:///tmp/worker'])assert.throws(()=>loopbackRequest({url,token:'fixture-token',fetchApi:async()=>{calls++;}}));
 const request=loopbackRequest({url:'http://localhost',token:'fixture-token',fetchApi:async()=>{calls++;return new Response('{}');}});
 await assert.rejects(request('POST','/api/cluster/submit',{}));await assert.rejects(request('GET','/api/cluster/status',{}));assert.equal(calls,0);
 const value=await request('POST','/api/cluster/status',{run_id:'recorded-run'});assert.deepEqual(value,{});assert.equal(calls,1);
});

test('Loopback requests use env-only authentication, reject redirects and bound response streams without leaking errors',async()=>{
 let options;
 const adapter=loopbackRequest({url:'http://localhost',token:'fixture-only-token',fetchApi:async(_url,value)=>{options=value;return new Response(JSON.stringify({ok:true}));}});
 assert.deepEqual(await adapter('POST','/api/cluster/status',{run_id:'recorded-run'}),{ok:true});
 assert.equal(options.headers.Authorization,'Bearer fixture-only-token');assert.equal(options.redirect,'error');assert(!options.body.includes('fixture-only-token'));
 const huge=loopbackRequest({url:'http://localhost',token:'fixture-only-token',fetchApi:async()=>new Response('x'.repeat(4*1024*1024+1))});
 await assert.rejects(huge('POST','/api/cluster/status',{}),error=>error.code==='worker_response_too_large');
 const unavailable=loopbackRequest({url:'http://localhost',token:'fixture-only-token',fetchApi:async()=>{throw Error('private raw endpoint');}});
 await assert.rejects(unavailable('POST','/api/cluster/status',{}),error=>error.code==='request_unavailable'&&!error.message.includes('private raw endpoint'));
});

test('CLI entry uses an explicit manifest and supplied env with a fake adapter, emitting no credentials or raw bodies',async()=>{
 fs.mkdirSync('.studio',{recursive:true});const tmp=fs.mkdtempSync(path.resolve('.studio','reconcile-test-'));
 assert(tmp.startsWith(path.resolve('.studio')+path.sep));
 try{
  const file=path.join(tmp,'manifest.json');fs.writeFileSync(file,JSON.stringify(manifest()));
  const f=fixture();const fetchApi=async(url,options)=>new Response(JSON.stringify(await f.request(options.method,new URL(url).pathname,JSON.parse(options.body))));
  const report=await main(['--manifest',file,'--timeout-ms','100','--poll-ms','1'],{env:{STUDIO_WORKER_URL:'http://localhost',STUDIO_WORKER_TOKEN:'private-test-token'},fetchApi});
  assert.equal(report.status,'passed');assert(!JSON.stringify(report).includes('private-test-token'));
  const command=path.resolve('scripts/cluster-reconcile.mjs');
  const child=spawnSync(process.execPath,[command,'--manifest',file],{encoding:'utf8',windowsHide:true,env:{...process.env,STUDIO_WORKER_URL:'',STUDIO_WORKER_TOKEN:'private-test-token'}});
  assert.equal(child.status,1);assert.deepEqual(JSON.parse(child.stdout),{status:'failed',code:'invalid_worker_configuration'});assert.equal(child.stderr,'');assert(!child.stdout.includes('private-test-token'));
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});


test('Explicit worker rejection remains a failure while transient HTTP state remains unknown',async()=>{
 for(const [status,expected,expectedCode] of [[400,'failed','worker_request_rejected'],[403,'failed','worker_request_rejected'],[401,'unknown','authentication_required'],[503,'unknown','worker_request_failed']]){
  const request=loopbackRequest({url:'http://localhost',token:'fixture-only-token',fetchApi:async()=>new Response('private response body',{status})});
  const report=await reconcile({manifest:manifest(),request,timeoutMs:30,pollIntervalMs:1});
  assert.equal(report.status,expected);assert.equal(report.runs[0].code,expectedCode);assert(!JSON.stringify(report).includes('private response body'));
 }
});
