import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {WorkerClient} from "../agent/tools/worker-client.mjs";
const out=path.resolve('.studio/validation'),report={checks:{}},worker=new WorkerClient(),pause=ms=>new Promise(r=>setTimeout(r,ms));
const evidence=JSON.parse(fs.readFileSync(path.join(out,'science.json'),'utf8'));
async function api(method,target,data){return worker.request(method,target,data);}
async function submitAndWait(run){
 run=await api('POST','/api/run/validate',{run_id:run.id});
 if(run.validation.status!=='passed')throw Error(JSON.stringify(run.validation));
 await api('POST','/api/run/submit',{run_id:run.id});
 const until=Date.now()+185000;
 do{await pause(500);run=await api('POST','/api/run/status',{run_id:run.id});}while(['queued','running'].includes(run.status)&&Date.now()<until);
 return {status:run.status,run_id:run.id,exit:run.exit,log:(await api('POST','/api/run/log',{run_id:run.id})).text.slice(-3000)};
}
try{
 await worker.connect({distribution:'Ubuntu',workerRoot:evidence.desktop_worker_root,workerPort:8770},path.resolve('backend/worker'));
 const runs=await api('GET','/api/runs'),gp=runs.find(r=>r.engine==='gpumd.md'&&r.status==='succeeded'),ht=runs.find(r=>r.id===evidence.checks['hotpp-train'].run_id);
 const original=await api('POST','/api/run/file',{run_id:gp.id,name:'run.in'});
 const continuation=await api('POST','/api/workspace/write',{project_id:gp.project_id,name:'continue-gpumd.in',content:original.text.split('\n').filter(l=>!l.trim().startsWith('velocity')).join('\n')});
 const gpr=await api('POST','/api/run/resume',{run_id:gp.id,parameters:{checkpoint_files:['restart.xyz'],continuation_run_in:continuation.path,idempotency_key:crypto.randomUUID()}});
 report.checks.gpumd=await submitAndWait(gpr);
 const config=await api('POST','/api/run/file',{run_id:ht.id,name:'input.yaml'});
 const updatedConfig=await api('POST','/api/workspace/write',{project_id:ht.project_id,name:'continue-hotpp.yaml',content:config.text.replace(/maxEpoch: 1/,'maxEpoch: 3').replace(/maxStep: 3/,'maxStep: 6')});
 const hr=await api('POST','/api/run/resume',{run_id:ht.id,parameters:{checkpoint_files:['model/best.ckpt'],checkpoint:'model/best.ckpt',continuation_config:updatedConfig.path,idempotency_key:crypto.randomUUID()}});
 report.checks.hotpp=await submitAndWait(hr);
 const products=await api('POST','/api/run/collect',{run_id:hr.id});
 const checkpoints=products.artifacts.filter(f=>f.name.startsWith('model/')&&f.name.endsWith('.ckpt'));
 report.checks.hotpp.new_checkpoints=checkpoints.map(f=>({name:f.name,sha256:f.sha256}));
 if(!checkpoints.some(f=>/step=(?:[6-9]|[1-9]\d+)/.test(f.name)))throw Error('No evidence of additional optimization steps');
 const source=await api('POST','/api/workspace/write',{project_id:gp.project_id,name:'closure.py',content:"import time\ntime.sleep(14)\nprint('DESKTOP_CLOSED_JOB_SURVIVED',flush=True)\n"});
 const cr=await api('POST','/api/runs/prepare',{spec:{project_id:gp.project_id,environment_id:gp.environment_id,engine:'pydyn.md',name:'Desktop closure infrastructure smoke',gpu:0,max_seconds:30,idempotency_key:crypto.randomUUID(),inputs:{'run.py':source.path},parameters:{scope:'CPU lifecycle only; not scientific MD'}}});
 await api('POST','/api/run/validate',{run_id:cr.id});await api('POST','/api/run/submit',{run_id:cr.id});await pause(800);
 const desktop=spawn(path.resolve('release/win-unpacked/GPU Sampling Studio.exe'),['--studio-verify'],{windowsHide:true,stdio:'inherit',env:{...process.env,STUDIO_VERIFY_ROOT:process.cwd()}});
 const exit=await new Promise((resolve,reject)=>{desktop.on('exit',resolve);desktop.on('error',reject);});
 const afterClose=await api('POST','/api/run/status',{run_id:cr.id});
 let completed=afterClose;
 while(['queued','running'].includes(completed.status)){await pause(500);completed=await api('POST','/api/run/status',{run_id:cr.id});}
 report.checks.desktopClosure={status:exit===0&&afterClose.status==='running'&&completed.status==='succeeded'?'passed':'failed',after_close_status:afterClose.status,final_status:completed.status,run_id:cr.id};
 report.status=Object.values(report.checks).every(c=>['passed','succeeded'].includes(c.status))?'passed':'failed';
}catch(e){report.status='failed';report.error=e.stack;}
finally{worker.close();fs.writeFileSync(path.join(out,'restarts.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.status==='passed'?0:1;}
