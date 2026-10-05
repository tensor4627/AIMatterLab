import fs from 'node:fs';
import path from 'node:path';
import {CodexBridge} from '../desktop/codex.mjs';
import {WorkerClient} from '../desktop/worker.mjs';
const out=path.resolve('.studio/validation');fs.mkdirSync(out,{recursive:true});
const forceRelay=process.argv.includes('--relay');
const codex=new CodexBridge(),worker=new WorkerClient();
const report={checks:{},events:[]};
let resolveTurn,completed=new Promise(r=>resolveTurn=r),threadId;
codex.on('event',e=>{
 if(e.method==='item/completed'&&e.params?.item?.type==='mcpToolCall')report.events.push(e.params.item);
 if(e.method==='turn/completed')resolveTurn(e.params.turn);
 if(e.id!==undefined)codex.respond(e.id,{decision:'decline'});
});
try{
 report.checks.worker=await worker.connect({distribution:'Ubuntu',workerRoot:JSON.parse(fs.readFileSync(path.join(out,'science.json'),'utf8')).desktop_worker_root,workerPort:8770,forceRelay},path.resolve('worker'));
 const bin=path.join(process.env.LOCALAPPDATA,'OpenAI/Codex/bin');
 const executable=fs.readdirSync(bin).map(x=>path.join(bin,x,'codex.exe')).filter(x=>fs.existsSync(x)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];
 report.checks.initialize=await codex.start(executable,worker.connection);
 const a=await codex.request('account/read',{refreshToken:false});
 report.checks.account={authenticated:!!a.account,type:a.account?.type,requiresOpenaiAuth:a.requiresOpenaiAuth};
 const models=await codex.request('model/list',{});
 report.checks.models=models.data.map(m=>({id:m.id,model:m.model}));
 const model=models.data.find(m=>m.isDefault)?.model||models.data[0]?.model;
 const skills=await codex.request('skills/list',{cwds:[path.resolve('.')],forceReload:true});
 report.checks.skills={count:skills.data?.flatMap(x=>x.skills).length,errors:skills.data?.flatMap(x=>x.errors)};
 const t=await codex.request('thread/start',{model,cwd:path.resolve('.'),approvalPolicy:'never',sandbox:'read-only',developerInstructions:'Use only gpusampling MCP tools for this integration smoke. Never run shell commands or edit files.'});threadId=t.thread.id;
 await codex.request('turn/start',{threadId,input:[{type:'text',text:'Call the gpusampling list_environments tool exactly once to verify the scientific tool connection. Then reply STUDIO_OK. Do not inspect files, run shell, submit jobs, or use any other tools.'}]});
 const turn=await Promise.race([completed,new Promise((_,rej)=>setTimeout(()=>rej(Error('Model turn timeout')),90000))]);
 report.checks.turn={status:turn.status,error:turn.error};
 await codex.request('thread/resume',{threadId});
 const restored=await codex.request('thread/read',{threadId,includeTurns:true});
 report.checks.resume={id:restored.thread.id,turns:restored.thread.turns.length};
 report.status=turn.status==='completed'&&report.events.some(e=>e.tool==='list_environments'&&e.status==='completed')?'passed':'failed';
}catch(e){report.status='failed';report.error=e.stack;}
finally{codex.close();worker.close();fs.writeFileSync(path.join(out,forceRelay?'codex-relay.json':'codex.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exit(report.status==='passed'?0:1);}
