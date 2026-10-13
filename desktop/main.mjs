import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { localSkills } from './skills.mjs';
import {agentConfig,STUDIO_INSTRUCTIONS} from './agent-settings.mjs';
import {TaskRecords} from './task-records.mjs';
import {existingConnections,existingProfile} from './existing-ssh.mjs';
import { Catalog } from './catalog.mjs';
import { CodexBridge } from './codex.mjs';
import {validatePlan} from '../shared/workflows.mjs';
import {AgentHub,loginUrl} from './agent-hub.mjs';
import {CredentialVault,providerId} from './providers.mjs';
import { WorkerClient } from './worker.mjs';
import { assertRpc, linuxPath, sshAlias, quoteShell } from './security.mjs';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here,'..');
const workerSource = app.isPackaged ? path.join(process.resourcesPath,'app.asar.unpacked','worker') : path.join(root,'worker');
const improvementsVerifying=process.argv.includes('--studio-improvements-verify');
const providerVerifying=process.argv.includes('--studio-providers-verify');
const verifying=improvementsVerifying||providerVerifying||process.argv.includes('--studio-verify');
const verificationRoot=process.env.STUDIO_VERIFY_ROOT||root;
if(verifying)app.setPath('userData',path.join(verificationRoot,'.studio',improvementsVerifying?'verification-v0.4':providerVerifying?'verification-providers':app.isPackaged?'verification-packaged':'verification-desktop'));
let window, catalog, settings, agents,taskRecords;
let shuttingDown=false;
app.on("before-quit",()=>{shuttingDown=true;});
const codex = new CodexBridge(), worker = new WorkerClient(), terminals = new Map(), grants = new Map();
const defaults = { distribution:'Ubuntu', workerRoot:'~/.local/state/gpu-sampling-studio',
  workerPort:8767, codexPath:'codex', cwd: app.isPackaged ? app.getPath('documents') : root,
  skillRoots:[], theme:'dark', agentProvider:'codex',agentLayout:'right' };
function findCodex() {
  const directory = path.join(process.env.LOCALAPPDATA || '', 'OpenAI','Codex','bin');
  if (!fs.existsSync(directory)) return 'codex';
  const candidates = fs.readdirSync(directory).map(p => path.join(directory,p,'codex.exe'))
    .filter(p => fs.existsSync(p)).sort((a,b) => fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
  return candidates[0] || 'codex';
}
function findAgent(provider) {
  const entry=provider==='kimi'?'@moonshot-ai/kimi-code/dist/main.mjs':'@qwen-code/qwen-code/cli-entry.js';
  const candidates=[path.join(process.resourcesPath,'agent-runtimes','node_modules',entry),path.join(root,'node_modules',entry)];
  return candidates.find(p=>fs.existsSync(p))||provider;
}
function emit(channel,data) { if (window && !window.isDestroyed()) window.webContents.send(channel,data); }
codex.on('event', event => {
  const tagged={...event,provider:'codex'};taskRecords?.event(tagged);emit('studio:event',tagged);
  if(event.method==='thread/started' && event.params?.thread)
    catalog.put('thread',event.params.thread.id,event.params.thread);
});
codex.on('diagnostic', data => emit('studio:event',{ method:'studio/diagnostic',params:{text:data} }));
function trusted(event) {
  if(!window || event.sender.id!==window.webContents.id || event.senderFrame?.parent ||
      event.senderFrame?.url!==window.webContents.getURL()) throw new Error('Untrusted IPC sender');
}
function handle(name, fn) { ipcMain.handle('studio:'+name,async(event,data) => { if(shuttingDown||!window||window.isDestroyed()||window.webContents.isDestroyed()||event.sender.isDestroyed())return null;trusted(event); try{return await fn(data||{});}catch(error){if(shuttingDown)return null;throw error;} }); }
function openUrl(url) {
  const parsed = new URL(url);
  if(parsed.protocol !== 'https:' || !['chatgpt.com','auth.openai.com','login.openai.com'].includes(parsed.hostname))
    throw new Error('Unsupported login URL');
  return shell.openExternal(url);
}

async function initialize() {
catalog = new Catalog(path.join(app.getPath('userData'),'studio'));
settings = { ...defaults, codexPath:findCodex(),kimiPath:findAgent('kimi'),qwenPath:findAgent('qwen'), ...catalog.get('settings','main') };
for(const provider of ['kimi','qwen']){const stored=settings[provider+'Path'];if(typeof stored==='string'&&/[\\\\/]/.test(stored)&&!fs.existsSync(stored))settings[provider+'Path']=findAgent(provider);}
if(typeof settings.codexPath==='string'&&/[\\\\/]/.test(settings.codexPath)&&!fs.existsSync(settings.codexPath))settings.codexPath=findCodex();
if(verifying)settings={...settings,agentProvider:'codex',agentLayout:'right',kimiPath:findAgent('kimi'),qwenPath:findAgent('qwen'),language:'zh-CN',fontSize:13,editorFontSize:13,terminalFontSize:12,fontFamily:'system',workerRoot:JSON.parse(fs.readFileSync(path.join(verificationRoot,'.studio/validation/science.json'),'utf8')).desktop_worker_root,workerPort:8770};
agents=new AgentHub({codex,root:path.join(app.getPath('userData'),'agents'),catalog,vault:new CredentialVault(path.join(app.getPath('userData'),'credentials'),safeStorage),settings:()=>settings,worker:()=>worker.connection});
taskRecords=new TaskRecords(catalog,event=>emit('studio:event',event));
agents.on('event',event=>{taskRecords.event(event);emit('studio:event',event);});
handle('task.create',value=>taskRecords.create(value));
handle('task.list',()=>catalog.list('agent-task'));
handle('task.read',({id})=>catalog.get('agent-task',id));
handle('ssh.existing',()=>existingConnections(app.getPath('home')));
handle('ssh.import',({ref})=>existingProfile(app.getPath('home'),ref));
handle('cluster.download',async value=>{
 const first=await worker.request('POST','/api/cluster/browse',{...value,offset:0});
 if(typeof first.base64!=='string'||!first.sha256)throw Error('Select a regular file in an authorized read root');
 const response=await dialog.showSaveDialog(window,{defaultPath:path.basename(value.relative)});
 if(response.canceled)return null;
 const file=response.filePath,temp=file+'.partial-'+randomUUID(),fd=fs.openSync(temp,'w'),hash=createHash('sha256');let current=first,offset=0;
 try{for(;;){const data=Buffer.from(current.base64,'base64');if(!data.length&&offset<first.size)throw Error('Remote file changed');fs.writeSync(fd,data);hash.update(data);offset=current.offset;if(offset>=first.size)break;current=await worker.request('POST','/api/cluster/browse',{...value,offset});if(current.size!==first.size)throw Error('Remote file changed');}if(hash.digest('hex')!==first.sha256)throw Error('Remote file hash mismatch');}finally{fs.closeSync(fd);}
 fs.renameSync(temp,file);
 return {path:file,bytes:offset,sha256:first.sha256};
});
handle('agent.bindProject',({projectId,provider})=>{providerId(provider);if(typeof projectId!=='string'||!projectId||projectId.length>100)throw Error('Select a project');settings=catalog.put('settings','main',{...settings,projectAgents:{...settings.projectAgents,[projectId]:provider}});return {projectId,provider};});
handle('state',() => ({ settings, threads:catalog.list('thread'), ssh:catalog.list('ssh') }));
handle('settings',data => {
  const next={...settings,...data};
  if(!/^[\w .-]{1,80}$/.test(next.distribution) || !Number.isInteger(next.workerPort) ||
     next.workerPort<1024 || next.workerPort>65535 ||
     !/^~\/|^\//.test(next.workerRoot)) throw new Error('Invalid WSL settings');
  agentConfig(next.agent);
  if(!['right','center'].includes(next.agentLayout||'right'))throw Error('Unsupported workspace layout');
  providerId(next.agentProvider||'codex');
  for(const key of ['kimiPath','qwenPath'])if(next[key]!==undefined&&(typeof next[key]!=='string'||/[\r\n\0]/.test(next[key])))throw Error('Invalid CLI path');
  if(!['zh-CN','en'].includes(next.language||'zh-CN'))throw Error('Unsupported language');
  for(const [key,min,max] of [['fontSize',12,24],['minimumFontSize',11,18],['chatFontSize',12,28],['editorFontSize',10,28],['terminalFontSize',10,24]])
    if(next[key]!==undefined&&(!Number.isInteger(next[key])||next[key]<min||next[key]>max))throw Error('Invalid font size');
  if(next.fontFamily && !['system','sans','serif'].includes(next.fontFamily))throw Error('Unsupported font');
  if(!Array.isArray(next.skillRoots)) throw new Error('Skill roots must be an array');
  settings=catalog.put('settings','main',next); return settings;
});
handle('worker.connect',async()=>{agents.close();const result=await worker.connect(settings,workerSource);emit('studio:event',{method:'studio/workerConnected',params:{}});return result;});
handle('worker.request',async({method,target,data}) => {
  const result=await worker.request(method,target,data);
  if(method==='GET' && ['/api/projects','/api/environments'].includes(target))
    for(const item of result) catalog.put(target.split('/').at(-1),item.id,item);
  return result;
});
handle('codex.connect',async() => codex.start(settings.codexPath,worker.connection,agentConfig(settings.agent)));
handle('codex.configure',async({preferences={},threadId,model}) => {
  const config=agentConfig(preferences);
  settings=catalog.put('settings','main',{...settings,agent:preferences});
  codex.close();
  await codex.start(settings.codexPath,worker.connection,config);
  if(!threadId)return {configured:true};
  const result=await codex.request('thread/resume',{threadId,model,config,
    developerInstructions:STUDIO_INSTRUCTIONS,sandbox:'read-only',approvalPolicy:'on-request'});
  catalog.put('thread',result.thread.id,result.thread);return result;
});
handle('codex.rpc',async({method,params={}}) => {
  assertRpc(method);
  if(['thread/start','thread/resume'].includes(method)) params={...params,cwd:settings.cwd,
    approvalPolicy:'on-request',sandbox:'read-only',config:{...params.config,...agentConfig(settings.agent)},
    developerInstructions:STUDIO_INSTRUCTIONS};
  const result=await codex.request(method,params);
  if(['thread/start','thread/resume'].includes(method) && result.thread) catalog.put('thread',result.thread.id,result.thread);
  if(method==='account/login/start' && result.authUrl) await openUrl(result.authUrl);
  return result;
});
handle('workflow.list',()=>catalog.list('workflow-plan'));
handle('workflow.save',value=>{
 const plan=validatePlan(value),id=value.id;
 if(id!==undefined&&(typeof id!=='string'||!catalog.get('workflow-plan',id)))throw Error('Unknown workflow plan');
 const key=id||randomUUID();return catalog.put('workflow-plan',key,{...plan,id:key,status:'draft',updatedAt:Date.now()});
});
handle('agent.connect',async({provider})=>{providerId(provider);if(!worker.connection){try{await worker.connect(settings,workerSource);emit('studio:event',{method:'studio/workerConnected',params:{}});}catch{emit('studio:event',{method:'studio/toolsUnavailable',provider,params:{message:'WSL scientific tools unavailable; task remains a plan until connected'}});}}settings=catalog.put('settings','main',{...settings,agentProvider:provider});return agents.connect(provider);});
handle('agent.disconnect',({provider})=>{providerId(provider);agents.bridge(provider)?.close();return {};});
handle('agent.account',({provider})=>agents.account(provider));
handle('agent.rpc',async({provider,method,params={}})=>{
  const taskId=params.studioTaskId;delete params.studioTaskId;
  if(taskId&&method==='turn/start')taskRecords.attach(taskId,provider,params.threadId);
  if(provider!=='codex'&&method==='turn/start'){
    const registered=localSkills([path.join(process.env.USERPROFILE||'','.codex','skills'),path.join(root,'.agents','skills'),...settings.skillRoots]);
    const input=[];
    for(const item of params.input||[]){
      if(item.type==='text')input.push(item);
      else if(item.type==='skill'){
        if(!registered.some(s=>s.path===item.path&&s.name===item.name))throw Error('Select a registered skill');
        const stat=fs.statSync(item.path);if(stat.size>262144)throw Error('Skill exceeds text limit');
        input.push({type:'text',text:'[Selected skill: '+item.name+']\n'+fs.readFileSync(item.path,'utf8')});
      }else throw Error('Unsupported input content');
    }
    params={...params,input};
  }
  const result=await agents.rpc(provider,method,params);
  if(provider==='codex'&&method==='account/login/start'&&result.authUrl)await openUrl(result.authUrl);
  return result;
});
handle('agent.respond',({provider,id,result})=>agents.respond(provider,id,result));
handle('agent.configure',async({provider,preferences={},threadId,model})=>{
  providerId(provider);if(provider!=='codex')throw Error('Context budget changes are not supported by this ACP provider');
  agentConfig(preferences);settings=catalog.put('settings','main',{...settings,agent:preferences});return agents.configure(provider,preferences,threadId,model);
});
handle('agent.login',async({provider,...value})=>{
  const result=await agents.login(provider,value);
  if(provider==='codex'&&result.url)await openUrl(result.url);
  return result;
});
handle('agent.login.cancel',()=>{agents.cancelLogin();return {};});
handle('agent.login.open',async({provider})=>{
  const state=await agents.account(provider);if(!state.url)throw Error('Start provider login first');return shell.openExternal(loginUrl(provider,state.url));
});
handle('skills.catalog',()=>localSkills(settings.skillRoots));
handle('codex.respond',({id,result})=>codex.respond(id,result));
handle('file.open',async() => {
  const response=await dialog.showOpenDialog(window,{properties:['openFile']});
  if(response.canceled) return null;
  const file=response.filePaths[0], stat=fs.statSync(file);
  if(stat.size>2*1024*1024) throw new Error('Text editor limit is 2 MiB');
  const id=randomUUID(); grants.set(id,file);
  return { id,path:file,name:path.basename(file),content:fs.readFileSync(file,'utf8') };
});
handle('file.save',async({id,content,name}) => {
  if(typeof content!=='string' || content.length>2*1024*1024) throw new Error('Text source exceeds 2 MiB');
  let file=grants.get(id);
  if(!file) {
    const response=await dialog.showSaveDialog(window,{defaultPath:name||'workflow.py'});
    if(response.canceled) return null;
    file=response.filePath; id=randomUUID(); grants.set(id,file);
  }
  fs.writeFileSync(file,content,'utf8'); return { id,path:file,name:path.basename(file) };
});
handle('file.choose',async({directory=false}) => {
  const response=await dialog.showOpenDialog(window,{properties:[directory?'openDirectory':'openFile']});
  return response.canceled?null:response.filePaths[0];
});
handle('ssh.save',({alias,name}) => {
  alias=sshAlias(alias); return catalog.put('ssh',alias,{alias,name:name||alias});
});
handle('ssh.browse',async({alias,directory='.',file}) => {
  alias=sshAlias(alias);
  const script=file ?
    'import pathlib,json,sys;p=pathlib.Path(sys.argv[1]).expanduser();s=p.stat();assert s.st_size<=262144;print(json.dumps({"path":str(p),"content":p.read_text()}))' :
    'import pathlib,json,sys;p=pathlib.Path(sys.argv[1]).expanduser().resolve();print(json.dumps({"path":str(p),"entries":[{"name":x.name,"directory":x.is_dir(),"size":x.stat().st_size} for x in list(p.iterdir())[:1000]]}))';
  const command='python3 -c '+quoteShell(script)+' '+quoteShell(file||directory);
  const {stdout}=await exec('ssh.exe',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
    '-o','ConnectTimeout=10',alias,command],{windowsHide:true,timeout:20000,maxBuffer:1024*1024});
  return JSON.parse(stdout);
});
handle('terminal.start',async({kind,alias,clusterId}) => {
  if(terminals.size>=4) throw new Error('Close an existing terminal before opening another');
  const id=randomUUID();
  let child, protocol=false;
  if(kind==='cluster'){
    const p=await worker.request('POST','/api/cluster/profile',{cluster_id:clusterId});
    const args=['-tt','-p',String(p.port),'-o','StrictHostKeyChecking=yes'];
    if(p.identity_file)args.push('-i',p.identity_file);
    args.push(p.target);
    if(p.via?.length){const inner=p.via.reduceRight((cmd,hop)=>'ssh -tt -o StrictHostKeyChecking=yes '+quoteShell(hop)+(cmd?' '+quoteShell(cmd):''),'');args.push(inner);}
    const native=p.ssh_client.startsWith('/mnt/c/')?'C:/'+p.ssh_client.slice(7):p.ssh_client;
    child=/^[A-Za-z]:/.test(native)?spawn(native,args,{stdio:['pipe','pipe','pipe'],windowsHide:true}):spawn('wsl.exe',['-d',settings.distribution,'--',native,...args],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  }
  else if(kind==='ssh') child=spawn('ssh.exe',['-tt',sshAlias(alias)],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  else {
    protocol=true;
    child=spawn('wsl.exe',['-d',settings.distribution,'--','python3',linuxPath(path.join(workerSource,'terminal.py'))],
      {stdio:['pipe','pipe','pipe'],windowsHide:true});
  }
  terminals.set(id,{child,protocol});
  if(protocol) {
    createInterface({input:child.stdout}).on('line',line=>{
      try{const value=JSON.parse(line); emit('studio:terminal',{id,...value});}catch{}
    });
  } else child.stdout.on('data',buffer=>emit('studio:terminal',{id,data:buffer.toString()}));
  child.stderr.on('data',buffer=>emit('studio:terminal',{id,data:buffer.toString()}));
  child.on('error',error=>emit('studio:terminal',{id,data:error.message}));
  child.on('exit',code=>{terminals.delete(id);emit('studio:terminal',{id,closed:true,code});});
  return {id};
});
handle('terminal.input',({id,data,cols,rows})=>{
  const terminal=terminals.get(id); if(!terminal) throw new Error('Terminal is closed');
  if(terminal.protocol) terminal.child.stdin.write(JSON.stringify(data===undefined?
    {type:'resize',cols,rows}:{type:'input',data})+'\n');
  else if(data!==undefined) terminal.child.stdin.write(data);
});
handle('terminal.close',({id})=>{terminals.get(id)?.child.kill();terminals.delete(id);});
handle('window',({action})=>{
  if(action==='minimize') window.minimize();
  if(action==='maximize') window.isMaximized()?window.unmaximize():window.maximize();
  if(action==='close') window.close();
});
handle('export',async({run})=>{
  const bundle=await worker.request('POST','/api/run/export',{run_id:run.id});
  const response=await dialog.showSaveDialog(window,{defaultPath:'reproduction-'+run.id+'.zip'});
  if(response.canceled) return null;
  fs.writeFileSync(response.filePath,Buffer.from(bundle.base64,'base64'));
  return response.filePath;
});
window=new BrowserWindow({width:1540,height:980,minWidth:1100,minHeight:720,frame:false,
  backgroundColor:'#15151b',title:'GPU Sampling Studio',show:false,
  webPreferences:{backgroundThrottling:!verifying,offscreen:improvementsVerifying,preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
window.webContents.on('will-navigate',(event,url)=>{if(url!==window.webContents.getURL()) event.preventDefault();});
const development=process.env.STUDIO_DEV_URL;
if(development && !/^http:\/\/127\.0\.0\.1:5173\/?$/.test(development)) throw new Error('Invalid development origin');
if(development) await window.loadURL(development); else await window.loadFile(path.join(root,'dist','index.html'));
if(verifying){const errors=[];window.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});const {verifyDesktop}=await import(improvementsVerifying?'./improvements-verification.mjs':providerVerifying?'./provider-verification.mjs':'./verification.mjs');const ok=await verifyDesktop(window,verificationRoot,errors,{publish:event=>emit('studio:event',event),packaged:app.isPackaged,taskAttach:(...args)=>taskRecords.attach(...args),taskEvent:event=>taskRecords.event(event),agentPaths:{kimi:settings.kimiPath,qwen:settings.qwenPath}});shuttingDown=true;agents.close();worker.close();app.exit(ok?0:1);}else window.show();
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{agents.close();worker.close();for(const t of terminals.values())t.child.kill();});

}
app.whenReady().then(initialize).catch(error=>{console.error(error);app.exit(1);});
