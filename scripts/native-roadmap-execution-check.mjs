// Called from the isolated real-MD acceptance script on WSL. Use the production
// renderer, preload, main and worker. Only the native dialog choice is scripted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {_electron as electron} from 'playwright';
import {Catalog} from '../backend/main/workspace/catalog.mjs';
import {TaskRecords} from '../backend/main/workspace/task-records.mjs';

const [output,port,distro]=process.argv.slice(2),repo=fileURLToPath(new URL('../',import.meta.url));
const relative=path.relative(path.join(repo,'.studio'),path.resolve(output));
assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&distro&&Number.isInteger(Number(port)));
const {snapshot}=JSON.parse(fs.readFileSync(path.join(output,'review.json'),'utf8'));
const profile=path.join(output,'desktop-profile');fs.mkdirSync(profile);
const catalog=new Catalog(path.join(profile,'studio')),records=new TaskRecords(catalog,()=>{});
const {project_id,environment_id,gpu,max_seconds}=snapshot.target,workerRoot=path.posix.resolve(path.posix.dirname(snapshot.initial.control.path),'../worker');
const binding={distribution:distro,port:Number(port),root:workerRoot};
const task=records.create({provider:'deepseek',planningMode:true,workflowVersion:2,request:snapshot.original_request});
const threadId='acceptance-'+task.id;
records.attach(task.id,'deepseek',threadId);
records.event({provider:'deepseek',method:'item/completed',params:{threadId,item:{tool:'present_task',result:{
 id:task.id,kind:'task-parameters',name:snapshot.name,steps:['MD','Analysis'],missing_fields:[],
 roadmap:snapshot.roadmap,parameters:{...snapshot.task_parameters,engine:'gpumd.md',files:Object.values(snapshot.initial).map(item=>item.path)}
}}}});
records.save({...records.read(task.id),workspaceChoice:'draft',deployment:{revision:1,workerBinding:binding,
 config:{target:'local',projectId:project_id,targetId:environment_id,gpu,maxSeconds:max_seconds}}});
catalog.put('settings','main',{distribution:distro,workerPort:Number(port),workerRoot,language:'zh-CN',agentProvider:'deepseek'});
catalog.db.close();
const wrapper=path.join(output,'desktop-wrapper.mjs'),approval=path.join(output,'dialog-approved.json');
fs.writeFileSync(wrapper,`import {app,dialog} from 'electron';
import fs from 'node:fs';
app.setPath('userData',${JSON.stringify(profile)});
app.on('browser-window-created',(_e,w)=>{w.show=()=>{};w.showInactive=()=>{};w.webContents.setBackgroundThrottling(false);});
dialog.showMessageBox=async(_window,options)=>{
 if(options.message!=='按照已核对的流程执行？'||!options.detail.includes('Per-frame atomic number density')||options.buttons[1]!=='冻结并执行')throw Error('Unexpected confirmation');
 const hash=options.detail.split('\\n').at(-1);if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Missing frozen snapshot identity');
 fs.writeFileSync(${JSON.stringify(approval)},JSON.stringify({hash,message:options.message}));return {response:1};
};
await import(${JSON.stringify(pathToFileURL(path.join(repo,'desktop/main.mjs')).href)});`);
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('STUDIO_')&&!['ELECTRON_RUN_AS_NODE','NODE_OPTIONS'].includes(key)));
const app=await electron.launch({args:[wrapper,'--disable-renderer-backgrounding'],env:{...env,STUDIO_PROFILE_DIR:profile}});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];
 page.on('pageerror',err=>errors.push(err.message));
 await page.locator('.workspace-shell').waitFor();
 await page.evaluate(({id,chat})=>{
  localStorage.setItem('studio.conversation',chat);localStorage.setItem('studio.section','agent-task:'+id);
  localStorage.setItem('studio.agent','false');
 },{id:task.id,chat:'deepseek:'+threadId});
 await page.reload();
 const panel=page.getByTestId('roadmap-execution');await panel.locator(':scope > summary').click();
 await panel.getByText('各步骤的计算环境',{exact:true}).click();
 await panel.getByLabel('Number density').selectOption('analysis-cpu');
 await panel.getByRole('button',{name:'核对执行快照'}).click();
 const preview=panel.getByLabel('执行快照');await preview.waitFor();
 const reviewed=await page.evaluate(taskId=>window.studio.invoke('task.roadmap.preview',{taskId,environments:{analysis:'analysis-cpu'}}),task.id);
 assert((await preview.innerText()).includes(snapshot.original_request));
 await preview.getByText(/Silicon MD · gpumd.md/).click();
 assert((await preview.getByLabel('run.in').innerText()).includes('dump_exyz 2'));
 await panel.getByRole('button',{name:'确认并执行整张图'}).click();
 const receipt=panel.getByLabel('执行回执');await receipt.getByText(/^通过 · [0-9a-f]{12}$/).waitFor({timeout:85000});
 for(const name of ['MD trajectory','Thermodynamic series','Per-frame atomic number density']){
  await receipt.getByText(name+' · 通过',{exact:true}).click();
 }
 const text=await receipt.innerText();assert(text.includes('实际读取'));assert(text.includes('512 atoms'));assert(text.includes('atoms per cubic Angstrom'));
 await receipt.getByText('查看已冻结快照',{exact:true}).click();
 await receipt.getByLabel('执行快照').getByText(reviewed.snapshot_sha256,{exact:false}).waitFor();
 assert((await receipt.getByLabel('执行快照').innerText()).includes(snapshot.original_request));
 await receipt.getByText('查看已冻结快照',{exact:true}).click();
 const rows=await page.evaluate(taskId=>window.studio.invoke('task.roadmap.list',{taskId}),task.id);
 assert.equal(rows.length,1);assert.equal(rows[0].status,'passed');assert.equal(rows[0].snapshot_sha256,JSON.parse(fs.readFileSync(approval,'utf8')).hash);
 assert.equal(reviewed.snapshot_sha256,rows[0].snapshot_sha256);fs.writeFileSync(path.join(output,'review.json'),JSON.stringify(reviewed,null,2));
 assert.deepEqual(errors,[]);await receipt.screenshot({path:path.join(output,'desktop-receipt.png')});
 fs.writeFileSync(path.join(output,'desktop-result.json'),JSON.stringify({task_id:task.id,execution_id:rows[0].id,snapshot_sha256:rows[0].snapshot_sha256,
  goals:rows[0].goals.map(g=>[g.resource,g.status]),scope:'Production renderer/preload/main and WSL worker; native confirmation choice supplied by the acceptance harness.'},null,2));
}finally{await app.close();}
