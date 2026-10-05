import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {CodexBridge} from '../desktop/codex.mjs';import {WorkerClient} from '../desktop/worker.mjs';
import {agentConfig,STUDIO_INSTRUCTIONS} from '../desktop/agent-settings.mjs';
const out=path.resolve('.studio/validation'),worker=new WorkerClient(),codex=new CodexBridge(),report={checks:{},events:[]};
let finish,usage,prepared;
codex.on('event',event=>{
 if(event.method==='thread/tokenUsage/updated')usage=event.params.tokenUsage;
 if(event.method==='item/completed'&&event.params?.item?.type==='mcpToolCall'){
  const item=event.params.item;report.events.push({tool:item.tool,status:item.status,error:item.error,result:item.result});
  if(item.tool==='prepare_run'&&item.status==='completed')try{prepared=JSON.parse(item.result.content.find(c=>c.type==='text').text);}catch{}
 }
 if(event.method==='turn/completed')finish?.(event.params.turn);
 if(event.id!==undefined){report.events.push({request:event.method,params:event.params});codex.respond(event.id,{decision:'decline'});}
});
async function turn(threadId,model,effort,text){
 const result=new Promise(resolve=>finish=resolve);usage=null;
 await codex.request('turn/start',{threadId,model,effort,input:[{type:'text',text}]});
 const ended=await Promise.race([result,new Promise((_,reject)=>setTimeout(()=>reject(Error('Turn timeout')),120000))]);
 assert.equal(ended.status,'completed');return {ended,usage};
}
try{
 report.checks.worker=await worker.connect({distribution:'Ubuntu',workerRoot:JSON.parse(fs.readFileSync(path.join(out,'science.json'),'utf8')).desktop_worker_root,workerPort:8770},path.resolve('worker'));
 assert.equal(report.checks.worker.execution_policy,'desktop-review-v1');
 const base=path.join(process.env.LOCALAPPDATA,'OpenAI/Codex/bin'),bin=fs.readdirSync(base).map(x=>path.join(base,x,'codex.exe')).filter(fs.existsSync).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];
 const first={contextWindow:131072,compactLimit:98304};
 await codex.start(bin,worker.connection,agentConfig(first));
 const models=await codex.request('model/list',{}),model=models.data.find(m=>m.isDefault)||models.data[0],effort=model.supportedReasoningEfforts.find(e=>e.reasoningEffort==='low')?.reasoningEffort||model.defaultReasoningEffort;
 const started=await codex.request('thread/start',{model:model.model,cwd:path.resolve('.'),config:{...agentConfig(first),model_reasoning_effort:effort},sandbox:'read-only',approvalPolicy:'never',developerInstructions:STUDIO_INSTRUCTIONS});
 assert.equal(started.reasoningEffort,effort);
 const projects=await worker.request('GET','/api/projects'),project=projects.find(p=>p.name.includes('Synthetic'))||projects[0];
 const filename='review-gate-'+Date.now()+'.py',source="print('USER_REVIEW_GATE_OK',flush=True)\n";
 const spec={name:'Review gate infrastructure smoke',engine:'pydyn.md',project_id:project.id,environment_id:project.policy.environments[0],gpu:project.policy.gpus[0],max_seconds:30,idempotency_key:crypto.randomUUID(),parameters:{scope:'CPU job lifecycle only; not an MD scientific test'}};
 const text='Create only an infrastructure task draft for desktop review. First call gpusampling write_project_input with '+JSON.stringify({project_id:project.id,name:filename,content:source})+'. Then call prepare_run with spec '+JSON.stringify(spec)+' plus inputs mapping run.py to the actual returned path. Do not validate, submit, probe or run it. Stop after the draft and tell me to review its page. Do not use any other tools.';
 const one=await turn(started.thread.id,model.model,effort,text);
 assert(prepared?.id,'Model did not prepare a task draft');
 let run=await worker.request('POST','/api/run/status',{run_id:prepared.id});assert.equal(run.status,'draft');assert.equal(run.validation.status,'not_run');
 report.checks.draft={run_id:run.id,status:run.status,validation:run.validation.status,origin:run.origin};
 report.checks.first={effort,usage:one.usage};assert(one.usage?.modelContextWindow>98304&&one.usage.modelContextWindow<=131072);
 // Old sessions may still advertise submit_run; the worker must reject it.
 for(const tool of ['submit_run','validate_run']){
  const response=await fetch(worker.connection.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+worker.connection.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:tool,method:'tools/call',params:{name:tool,arguments:{run_id:run.id}}})});
  const value=await response.json();assert.equal(value.result.isError,true);assert.match(value.result.content[0].text,/Desktop review/);
 }
 report.checks.mcpGate='passed';
 const second={contextWindow:262144,compactLimit:196608};codex.close();await codex.start(bin,worker.connection,agentConfig(second));
 const resumed=await codex.request('thread/resume',{threadId:started.thread.id,config:agentConfig(second),model:model.model,sandbox:'read-only',developerInstructions:STUDIO_INSTRUCTIONS});
 const two=await turn(started.thread.id,model.model,effort,'Reply SETTINGS_RESTORED only. Do not call tools.');
 assert(two.usage?.modelContextWindow>one.usage.modelContextWindow&&two.usage.modelContextWindow<=262144);report.checks.restored={thread_id:resumed.thread.id,usage:two.usage};
 run=await worker.request('POST','/api/run/status',{run_id:prepared.id});assert.equal(run.status,'draft');report.status='passed';
}catch(e){report.status='failed';report.error=e.stack;}
finally{codex.close();worker.close();fs.writeFileSync(path.join(out,'settings-review.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));setTimeout(()=>process.exit(report.status==='passed'?0:1),500);}
