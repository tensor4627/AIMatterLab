// Real local app-server + worker integration. Connection details and account identities never enter reports.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {CodexBridge} from '../desktop/codex.mjs';
import {WorkerClient} from '../desktop/worker.mjs';
import {agentConfig,STUDIO_INSTRUCTIONS} from '../desktop/agent-settings.mjs';
import {TaskRecords} from '../desktop/task-records.mjs';
import {Catalog} from '../desktop/catalog.mjs';
const root=process.cwd(),out=path.join(root,'.studio/validation'),worker=new WorkerClient(),bridge=new CodexBridge();
const bins=path.join(process.env.LOCALAPPDATA,'OpenAI','Codex','bin');
const executable=fs.readdirSync(bins).map(n=>path.join(bins,n,'codex.exe')).find(p=>fs.existsSync(p));
const prior=JSON.parse(fs.readFileSync(path.join(out,'science.json'),'utf8'));
const catalog=new Catalog(path.join(root,'.studio','v0.4-task-protocol'));
const events=[],taskEvents=[],tasks=new TaskRecords(catalog,e=>taskEvents.push(e));
const report={scope:'Real Codex app-server, current authenticated account and worker present_task only. No scientific jobs or remote submissions.',checks:{}};
bridge.on('event',e=>{events.push(e);tasks.event({...e,provider:'codex'});if(e.id!==undefined){bridge.respond(e.id,e.method.includes('elicitation')?{action:'decline'}:{decision:'decline'});}});
try{
 await worker.connect({distribution:'Ubuntu',workerRoot:prior.desktop_worker_root,workerPort:8770},path.join(root,'worker'));
 await bridge.start(executable,worker.connection,agentConfig({}));
 const account=await bridge.request('account/read',{refreshToken:true}),models=await bridge.request('model/list',{});
 const model=models.data.find(m=>m.isDefault)?.model||models.data[0]?.model;
 report.checks.account={status:account.account?'passed':'blocked',type:account.account?.type||null};
 report.checks.catalog={count:models.data.length,selected:model};if(!model||!account.account)throw Error('Authenticated model access unavailable');
 const task=tasks.create({provider:'codex',request:'Display a scientific parameter draft for review'});
 const started=await bridge.request('thread/start',{model,cwd:root,sandbox:'read-only',approvalPolicy:'on-request',developerInstructions:STUDIO_INSTRUCTIONS});
 tasks.attach(task.id,'codex',started.thread.id);
 await bridge.request('turn/start',{threadId:started.thread.id,model,input:[{type:'text',text:'Use gpusampling present_task exactly once with task_id='+task.id+', name="Readonly parameter integration", steps=["Check inputs","Review parameters"], parameters={"temperature":300,"units":"K"}, missing_fields=["structure","potential"]. Do not call other tools, validate, submit or execute anything. Then reply STUDIO_TASK_PAGE_OK.'}]});
 for(let i=0;i<360;i++){if(events.some(e=>e.method==='turn/completed'))break;await new Promise(r=>setTimeout(r,250));}
 const record=catalog.get('agent-task',task.id),text=events.filter(e=>e.method==='item/agentMessage/delta').map(e=>e.params.delta).join('');
 const tool=events.find(e=>e.method==='item/completed'&&e.params.item?.type==='mcpToolCall');
 report.checks.centralTask={id:task.id,parameters:record.parameters,planCount:record.plan.length,phase:record.phase,tool:tool?.params.item.tool,confirmed:text.includes('STUDIO_TASK_PAGE_OK')};
 if(record.parameters?.temperature!==300||record.plan.length!==2||!text.includes('STUDIO_TASK_PAGE_OK'))throw Error('Real central parameter handoff failed');
 report.status='passed';
}catch(error){report.status='blocked';report.reason='Real protocol integration did not complete; no private transport details retained';process.exitCode=1;}
finally{bridge.close();worker.close();fs.writeFileSync(path.join(out,'v0.4-codex-real.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
