import {execFile} from 'node:child_process';
import {promisify,isDeepStrictEqual as equal} from 'node:util';
import {randomUUID} from 'node:crypto';
import {taskWorkerSource,taskWorkerSettings,validTaskWorkerSource} from '../shared/task-worker-binding.mjs';
import {readWorkerStatus} from './worker-status.mjs';
import {probeLegacyWorkerStart,inspectExistingDataRoot} from './existing-worker.mjs';
import {taskWorkerTarget,taskTransportScope,taskTransportReceipt,taskTransportNamespace} from './explicit-worker-binding.mjs';
const exec=promisify(execFile),object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const signature=s=>[s.distribution,s.workerRoot,s.workerPort,s.autoDiscoverCompute,s.sourceIds,s.sourceRoots];
const distro=value=>typeof value==='string'&&/^[\w .-]{1,80}$/.test(value);
const root=value=>typeof value==='string'&&value.length<=4096&&/^(?:~\/|\/)/.test(value)&&!/[\r\n\0]/.test(value)&&value!=='/'&&value!=='~/';
const port=value=>Number.isInteger(value)&&value>=1024&&value<=65535;
const binding=value=>value?.version===1&&distro(value.distribution)&&root(value.root)&&value.root.startsWith('/')&&port(value.port)&&Number.isFinite(value.checkedAt);
const messages={update_target_unverified:'原服务身份或端口尚未核对，不能更新；请先恢复原连接。',update_unconfirmed:'作业服务已连接，但更新后的实现版本仍未核对；请只读检查原服务，不会自动重试或重提作业。',wsl_unavailable:'未找到 WSL，请先在系统中启用 WSL；这里不会自动安装。',inventory_failed:'无法读取 WSL 发行版列表，请检查 WSL 状态后重试。',distribution_missing:'原连接的 WSL 发行版不在当前列表中；请先恢复原发行版，不会切换此流程的来源。',choose_distribution:'请选择一个已安装的 WSL 发行版。',source_changed:'流程或连接来源已变化；请重新打开引导核对，原作业不受影响。',binding_missing:'此流程缺少可核对的原作业服务来源；请先核对原连接，不能改用默认服务。',legacy_port_unknown:'历史流程未保存服务端口；原服务未能只读恢复，请先核对原端口，不会猜测并启动其它服务。',connection_failed:'连接未完成，请检查所选发行版、Python 和原作业服务，再明确重试。',operation_busy:'另一项连接操作尚在进行，请等待它结束后重试。',existing_root_unavailable:'所选目录不是可读取的已有作业服务数据库；未启动服务或更改登记。',discovery_failed:'作业服务已连接，但环境发现未完成；可稍后在计算环境页重试。'};
function typed(value,keys){if(!object(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error('Invalid typed compute connection request');}
function decode(value){if(typeof value==='string')return value.replace(/^\uFEFF/,'');let bytes=Buffer.from(value||[]);if(bytes[0]===0xfe&&bytes[1]===0xff){bytes=Buffer.from(bytes.subarray(2));if(bytes.length%2)throw Error('Invalid WSL inventory encoding');bytes.swap16();return bytes.toString('utf16le');}if(bytes[0]===0xff&&bytes[1]===0xfe)return bytes.subarray(2).toString('utf16le');const zeroes=bytes.filter(value=>value===0).length;return bytes.toString(zeroes>bytes.length/5?'utf16le':'utf8').replace(/^\uFEFF/,'');}
export function parseWslDistributions(value){const text=decode(value);if(text.length>32768)throw Error('WSL inventory exceeds bound');const names=[...new Set(text.split(/\r?\n/).map(line=>line.replace(/^\s*\*\s*/,'').trim()).filter(Boolean))];if(names.length>64||names.some(name=>!distro(name)))throw Error('Invalid WSL distribution inventory');return names;}
export async function installedWslDistributions({execute=exec}={}){const result=await execute('wsl.exe',['--list','--quiet'],{encoding:'buffer',windowsHide:true,timeout:6000,maxBuffer:65536});return parseWslDistributions(result.stdout);}

/** Human-owned plans only. No credentials, grants, engine execution or daemon teardown. */
export function createComputeConnection({worker,records,catalog,settings,selection,selectionEpoch,source,inventory=installedWslDistributions,readStatus=readWorkerStatus,probeStart=probeLegacyWorkerStart,inspectDataRoot=inspectExistingDataRoot,beforeSwitch=()=>{},saveSettings=()=>{},remember=async()=>{},onConnected=()=>{},bindFreshSources=async()=>{},now=Date.now,id=randomUUID}){
 const plans=new Map();let active=null,planning=0;
 const saved=()=>catalog.get('worker-binding','last-explicit');
 function owner(){return structuredClone(selection()||null);}
 function contextCurrent(p){try{const task=p.taskId?records.read(p.taskId):null;return active===p&&!p.cancelled&&equal(p.owner,owner())&&p.ownerEpoch===selectionEpoch()&&equal(p.settingsSignature,signature(settings()))&&equal(p.source,source())&&(!task||equal(p.taskScope,taskTransportScope(task))&&equal(p.taskReceipt,taskTransportReceipt(task,catalog))&&equal(p.taskRecord,catalog.get?.(taskTransportNamespace,p.taskId)??null))&&(!p.watchSaved||equal(p.saved,saved()));}catch{return false;}}
 function current(p){return contextCurrent(p)&&p.workerIntent===(worker.bindingIntent||0)&&p.workerEpoch===(worker.connectionEpoch||0);}
 function abortOwnStart(p){if(p.view.connection!=='connected'&&p.startOperation&&p.startOperation.epoch===worker.connectionEpoch&&p.startOperation.intent===worker.bindingIntent&&(p.startOperation.pending===worker.connecting&&worker.connecting||!worker.connecting&&matches(p.target)))worker.close();}
 function invalidate(p,reason='source_changed'){if(p.cancelled)return;p.cancelled=true;abortOwnStart(p);p.view={...p.view,status:reason==='cancelled'?'cancelled':'superseded',phase:'finished',discovery:p.view.discovery==='discovering'?'cancelled':p.view.discovery,error:reason==='cancelled'?undefined:{code:reason,message:messages[reason]},finished:true};}
 function view(p){if(!p.cancelled&&!current(p))invalidate(p);return structuredClone(p.view);}
 function guard(p){if(!current(p)){invalidate(p);throw Error('Compute connection plan superseded');}}
 function stage(p,phase,extra={}){guard(p);p.view={...p.view,phase,...extra};}
 function get(value){typed(value,['planId']);if(typeof value.planId!=='string'||!plans.has(value.planId))throw Error('Compute connection plan unavailable');return plans.get(value.planId);}
 const matches=target=>worker.matchesTarget?worker.matchesTarget(target):!!worker.connection&&worker.identity?.distribution===target.distribution&&(worker.identity?.root===target.workerRoot||worker.connectionTarget?.requestedRoot===target.workerRoot)&&worker.connectionTarget?.port===target.workerPort;
 function rememberTask(p){if(!p.legacySource)return;guard(p);const health=worker.connection?.health;if(!matches(p.target)||worker.identity?.root!==p.taskSource.binding.root||health?.root!==p.taskSource.binding.root||health.execution_policy!=='desktop-review-v1'||typeof health.runtime!=='string'||!health.runtime.startsWith('/')||(worker.upstream??worker.connection?.url)!=='http://127.0.0.1:'+p.target.workerPort)throw Error('Original transport identity unverified');const value={version:1,scope:structuredClone(p.taskScope),root:health.root,port:p.target.workerPort,runtime:health.runtime,executionPolicy:health.execution_policy,checkedAt:now()};catalog.put(taskTransportNamespace,p.taskId,value);p.taskReceipt=structuredClone(value);p.taskRecord=structuredClone(value);}
 async function plan(args={}){
  typed(args,['taskId','distribution','advanced','newSource','legacyPort','intent']);let confirmedPort;if(args.intent!==undefined&&!['standard','existing'].includes(args.intent))throw Error('Invalid connection intent');if(args.legacyPort!==undefined){typed(args.legacyPort,['planId','port']);const previous=active;if(!previous||args.legacyPort.planId!==previous.id||args.taskId!==previous.taskId||!args.taskId||previous.pending||!previous.legacyPort||!previous.view.needsLegacyPort||!current(previous)||!port(args.legacyPort.port)||args.distribution!==undefined||args.advanced!==undefined||args.newSource!==undefined)throw Error('Invalid original port confirmation');confirmedPort=args.legacyPort.port;}if(args.newSource!==undefined&&args.newSource!==true)throw Error('Invalid explicit new-source intent');if(args.taskId!==undefined&&(typeof args.taskId!=='string'||!args.taskId||args.taskId.length>200))throw Error('Invalid compute connection owner');
  if(args.distribution!==undefined&&!distro(args.distribution))throw Error('Invalid WSL distribution selection');
  if(args.advanced!==undefined){typed(args.advanced,['root','port']);if(!root(args.advanced.root)||!port(args.advanced.port))throw Error('Invalid advanced local service settings');}
  const ticket=++planning;if(active)invalidate(active,'cancelled');const selected=owner(),ownerEpoch=selectionEpoch(),config=structuredClone(settings()),runtime=structuredClone(source()),last=structuredClone(saved()),taskId=selected?.taskId||null;
  if(taskId&&args.intent==='existing')throw Error('A workflow retains its original connection policy');
  if(taskId&&args.newSource)throw Error('A workflow cannot replace its saved source');
  if(args.taskId!==undefined&&args.taskId!==taskId)throw Error('The selected workflow owns its compute connection');
  let task,taskSource,target,initialTaskReceipt=null,initialTaskRecord=null,scope='global',locked=false,legacyPort=false,derivedPort=false,error;
  if(taskId){task=records.read(taskId);if(task.provider!==selected.provider||task.threadId!==selected.threadId)throw Error('Workflow connection owner mismatch');taskSource=taskWorkerSource(task);initialTaskReceipt=structuredClone(taskTransportReceipt(task,catalog));initialTaskRecord=structuredClone(catalog.get?.(taskTransportNamespace,task.id)??null);scope='task';locked=true;if(!validTaskWorkerSource(taskSource)||taskSource.binding.port!==undefined&&!port(taskSource.binding.port))error='binding_missing';else{try{target=taskWorkerTarget(task,config,catalog);if(confirmedPort!==undefined)target.workerPort=confirmedPort;legacyPort=!port(target.workerPort);}catch{error='binding_missing';}}}
  if(legacyPort&&worker.connection&&worker.identity?.distribution===taskSource.binding.distribution&&worker.identity?.root===taskSource.binding.root&&port(worker.connectionTarget?.port)&&(worker.upstream??worker.connection.url)==='http://127.0.0.1:'+worker.connectionTarget.port){target.workerPort=worker.connectionTarget.port;legacyPort=false;derivedPort=true;}
  if(legacyPort&&!error)error='legacy_port_unknown';
  let names=[];if(!error||error==='legacy_port_unknown')try{names=await inventory();}catch(e){error=e?.code==='ENOENT'?'wsl_unavailable':'inventory_failed';}
  if(ticket!==planning||!equal(selected,owner())||ownerEpoch!==selectionEpoch()||!equal(signature(config),signature(settings()))||!equal(runtime,source()))return {planId:null,status:'superseded',phase:'finished',connection:'not_run',discovery:'not_run',error:{code:'source_changed',message:messages.source_changed},finished:true};
  if(!taskId&&!args.newSource&&binding(last)){scope='saved-global';locked=true;target={...config,distribution:last.distribution,workerRoot:last.root,workerPort:last.port};}
  if(locked&&(args.distribution!==undefined||args.advanced!==undefined))throw Error('Saved workflow/service target cannot be replaced by renderer settings');
  if(!target&&!taskId){const chosen=args.distribution??(names.length===1?names[0]:'');target={...config,distribution:chosen,...args.advanced?{workerRoot:args.advanced.root,workerPort:args.advanced.port}:{}};}
  if(error==='legacy_port_unknown'&&target?.distribution&&!names.includes(target.distribution))error='distribution_missing';
  if(!error&&target?.distribution&&!names.includes(target.distribution))error=locked?'distribution_missing':'choose_distribution';
  if(!error&&!target?.distribution)error='choose_distribution';
  const persistTarget=scope==='saved-global'?{...target,workerRoot:root(last.settingsSignature?.[1])?last.settingsSignature[1]:target.workerRoot}:target;
  const p={id:id(),owner:selected,ownerEpoch,settingsSignature:signature(config),source:runtime,taskId,taskSource:structuredClone(taskSource),taskScope:task?structuredClone(taskTransportScope(task)):null,taskReceipt:initialTaskReceipt,taskRecord:initialTaskRecord,legacySource:!!taskSource&&taskSource.binding.port===undefined,saved:last,watchSaved:!taskId,workerEpoch:worker.connectionEpoch||0,workerIntent:worker.bindingIntent||0,target,persistTarget,legacyPort,intent:args.intent||(scope==='saved-global'&&last.intent==='existing'?'existing':'standard'),cancelled:false};
  p.view={planId:p.id,status:error?'blocked':'review',phase:'review',scope,taskId,intent:p.intent,needsLegacyPort:legacyPort&&error==='legacy_port_unknown',portSource:legacyPort?'unknown':confirmedPort!==undefined?'human-confirmed':p.taskReceipt||derivedPort?'verified':'saved',canChooseSource:scope==='saved-global',ownerName:task?.name||null,locked,distributions:names,target:target?{distribution:target.distribution,root:target.workerRoot,port:target.workerPort??null}:null,connection:'not_run',discovery:'not_run',scientificValidation:'not_run',finished:!!error,error:error?{code:error,message:messages[error]}:undefined};
  active=p;plans.set(p.id,p);for(const [key,value]of plans)if(plans.size>8&&value!==active&&!value.pending)plans.delete(key);
  if(!error&&locked&&matches(p.target)){try{const observed=await readStatus(worker,()=>p.target);if(current(p)&&observed.status==='connected'){const verified=observed.serviceVersion==='current',automatic=verified&&(!p.legacySource||!!p.taskReceipt);p.view={...p.view,status:automatic?'connected':'review',phase:automatic?'connected':'review',connection:'connected',serviceVersion:observed.serviceVersion||'unconfirmed',canUpdate:p.intent!=='existing'&&!verified&&!p.legacyPort,mode:automatic?'already_connected':verified?'legacy_port_review':'version_review',resolvedRoot:worker.identity?.root,finished:automatic};}}catch{}}
  return view(p);
 }
 async function connect(args){
  typed(args,['planId','requestId','update']);if(args.update!==undefined&&args.update!==true)throw Error('Invalid explicit worker update intent');const p=get({planId:args.planId});if(typeof args.requestId!=='string'||!args.requestId||args.requestId.length>128)throw Error('Invalid compute connection request identity');
  if(p.requestId===args.requestId){if(p.update!==!!args.update)throw Error('Connection request identity has a different action');if(p.pending)await p.pending;return view(p);}
  if(p.pending)throw Error('Compute connection attempt already in progress');guard(p);if(p.view.status==='blocked')return view(p);
  if(args.update&&p.intent==='existing')throw Error('Existing data connections do not update the service');
  if(args.update&&!p.view.canUpdate)throw Error('The original service must be verified before an explicit update');
  p.requestId=args.requestId;p.update=!!args.update;p.view={...p.view,status:'connecting',phase:'checking_existing',connection:'checking',discovery:'not_run',error:undefined,finished:false};
  const run=async()=>{try{
   guard(p);if(worker.connecting||worker.restoring){stage(p,'finished',{status:'failed',error:{code:'operation_busy',message:messages.operation_busy},finished:true});return;}
   if(p.intent==='existing'){const proof=await inspectDataRoot(p.target,{schema:false});guard(p);if(proof.status!=='available'){stage(p,'finished',{status:'failed',connection:'unknown',error:{code:'existing_root_unavailable',message:messages.existing_root_unavailable},finished:true});return;}}
   let observed;if(matches(p.target))observed=await readStatus(worker,()=>p.target);guard(p);
   let mode='reused';
   const start=async()=>{const pending=worker.connect(p.target,p.source.path);p.workerEpoch=worker.connectionEpoch||0;p.workerIntent=worker.bindingIntent||0;p.startOperation={epoch:p.workerEpoch,intent:p.workerIntent,pending:worker.connecting};await pending;guard(p);};
   if(args.update){
    if(observed?.status!=='connected'||!matches(p.target)||p.legacyPort){stage(p,'finished',{status:'failed',connection:'unknown',error:{code:'update_target_unverified',message:messages.update_target_unverified},finished:true});return;}
    if(observed.serviceVersion!=='current'){beforeSwitch();guard(p);stage(p,'updating_service');mode='updated';await start();}
   }else if(observed?.status!=='connected'){
    beforeSwitch();guard(p);
    if(worker.connection){worker.close();p.workerEpoch=worker.connectionEpoch||0;}
    stage(p,'restoring');
    // Existing helper proves the expanded root before attaching. Tokens stay main-owned.
    let existing=await worker.readExisting(p.target);guard(p);let restoreTarget=p.target;
    if(existing?.status==='connected'&&p.target.workerRoot.startsWith('~/')&&root(existing.connection?.health?.root)&&existing.connection.health.root.startsWith('/')){restoreTarget={...p.target,workerRoot:existing.connection.health.root};p.target=restoreTarget;}
    observed=await worker.restore(restoreTarget,{current:()=>current(p)});
    if(!p.cancelled&&p.workerIntent===(worker.bindingIntent||0)&&!worker.connection)p.workerEpoch=worker.connectionEpoch||0;
    guard(p);
    if(observed.status!=='connected'){
     if(p.legacyPort){stage(p,'finished',{status:'failed',connection:'unknown',error:{code:'legacy_port_unknown',message:messages.legacy_port_unknown},finished:true});return;}
     if(p.legacySource){stage(p,'checking_original_root');const proof=await probeStart(p.target);guard(p);if(proof.status!=='available'){p.legacyPort=true;stage(p,'finished',{status:'failed',connection:'unknown',needsLegacyPort:true,portSource:'unknown',target:{...p.view.target,port:null},finished:true,error:{code:'legacy_port_conflict',message:'无法确认原目录和端口可安全启动；请核对原服务端口或已有控制进程，不会启动或结束其它服务。'}});return;}}
     if(p.intent==='existing'){const proof=await inspectDataRoot(p.target);guard(p);if(proof.status!=='available'){stage(p,'finished',{status:'failed',connection:'unknown',error:{code:'existing_root_unavailable',message:messages.existing_root_unavailable},finished:true});return;}}
     stage(p,'starting_service');mode='started';await start();
    }
   }
   stage(p,'verifying_service');const checked=await readStatus(worker,()=>p.target);guard(p);if(checked.status!=='connected'||!matches(p.target))throw Error('Worker identity not verified');
   rememberTask(p);
   if(p.intent!=='existing'&&p.view.scope==='global'&&mode==='started'){await bindFreshSources(()=>guard(p));guard(p);}
   if(!p.taskId){saveSettings(p.persistTarget);p.settingsSignature=signature(settings());const remembered=remember(p.persistTarget,{...checked,intent:p.intent,checkedAt:now()});p.saved=structuredClone(saved());if(remembered&&typeof remembered.then==='function')await remembered;guard(p);}
   stage(p,'connected',{status:'connected',connection:'connected',serviceVersion:checked.serviceVersion||'unconfirmed',canUpdate:p.intent!=='existing'&&checked.serviceVersion!=='current'&&!p.legacyPort,resolvedRoot:worker.identity?.root,mode,checkedAt:now()});onConnected();guard(p);
   if(args.update&&checked.serviceVersion!=='current'){stage(p,'finished',{status:'failed',finished:true,error:{code:'update_unconfirmed',message:messages.update_unconfirmed}});return;}
   if(args.update||p.taskId||p.intent==='existing'||settings().autoDiscoverCompute===false){stage(p,'finished',{finished:true,discovery:'not_run'});return;}
   stage(p,'discovering',{discovery:'discovering'});
   try{const result=await worker.request('POST','/api/environments/discover',{force:false});guard(p);if(!Array.isArray(result.entries)||typeof result.identity!=='string')throw Error('Invalid discovery receipt');const candidates=result.entries.filter(entry=>entry.status==='discovered').map(entry=>entry.id);let registered=[];if(candidates.length){const adopted=await worker.request('POST','/api/environments/adopt',{identity:result.identity,candidates});guard(p);if(!Array.isArray(adopted.environments))throw Error('Invalid environment registration receipt');registered=adopted.environments;}
    stage(p,'finished',{finished:true,discovery:candidates.length?'observed':'empty',environments:registered.length,observedAt:result.observed_at});
   }catch{if(current(p))stage(p,'finished',{finished:true,discovery:'failed',error:{code:'discovery_failed',message:messages.discovery_failed}});}
  }catch{if(p.startOperation&&contextCurrent(p)&&p.workerIntent===(worker.bindingIntent||0)&&!worker.connection&&!worker.connecting)p.workerEpoch=worker.connectionEpoch||0;if(current(p))stage(p,'finished',{status:'failed',connection:'unknown',finished:true,error:{code:'connection_failed',message:messages.connection_failed}});else invalidate(p);}finally{p.startOperation=null;}};
  p.pending=run();try{await p.pending;return view(p);}finally{p.pending=null;}
 }
 return {plan,connect,status:args=>view(get(args)),cancel:args=>{const p=get(args);if(active===p)planning++;const wasCurrent=current(p);invalidate(p,'cancelled');return {...view(p),connection:wasCurrent?p.view.connection:'unknown'};}};
}
