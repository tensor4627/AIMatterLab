import Button from '../../ui/Button';
import Disclosure from '../../ui/Disclosure';
import Notice from '../../ui/Notice';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {FileText,FolderOpen,FolderSearch,PackagePlus,Plug,ScrollText} from 'lucide-react';
import type {TypedInvoke} from '../../../contracts/dto/ipc';
import type {ResourceToolDiscovery,ResourceToolLibrary,ResourceToolManifest,ResourceToolRoute,ResourceToolSetup,ResourceToolSource,ResourceToolSourcePick,ResourceToolTarget} from '../../../contracts/dto/resource-tools';
import {invoke} from '../../api/studio';
import {t} from '../../ui/i18n';
import {editJsonDraft,inspectJsonDraft,isJsonObject,jsonDraftIssue} from '../../ui/json-draft.mjs';
import ResourceToolInterfaceEditor,{interfaceJsonLabels} from './ResourceToolInterfaceEditor';
import './resource-tool-setup.css';

const request:TypedInvoke=invoke;
const routeLabels={fresh:'安装新工具',existing:'我已有提交脚本',custom:'接入其他软件'} as const;
const routeDetails={fresh:'在目标集群获取指定版本，核对来源并提交最小测试。',existing:'只读扫描指定目录，选择已经在用的代表脚本。',custom:'为自己的程序登记来源、运行接口、输入输出和测试。'} as const;
const routes=[['fresh',PackagePlus],['existing',ScrollText],['custom',Plug]] as const;
const statuses:Record<ResourceToolSetup['status'],string>={planned:'待确认测试',acquiring:'正在获取工具',desktop_fallback:'正在从本机获取工具',needs_file:'等待提供源文件',testing:'最小测试中',active:'工具已激活',failed:'配置失败',unknown:'结果待核对'};
const activeStatus=(value:ResourceToolSetup['status'])=>['acquiring','desktop_fallback','testing','unknown'].includes(value);
const targetKey=(target:ResourceToolTarget)=>JSON.stringify([target.project_id,target.cluster_id,target.environment_id,target.queue_target_id]);
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
function parseJson(value:string,label:string):unknown{
 const document=inspectJsonDraft(value);
 if(!document)throw Error(`${t(label)} · ${t('JSON 语法有误。')}`);
 const issue=jsonDraftIssue(document);
 if(issue)throw Error(`${t(label)} · ${t(issue==='duplicate'?'JSON 对象中有重复键。':'JSON 数值超出可保存的精度。')}`);
 return document.value;
}
function parseObject<T>(value:string,label:string):T{
 const result=parseJson(value,label);
 if(!isJsonObject(result))throw Error(`${t(label)} · ${t('请填写 JSON 对象。')}`);
 return result as T;
}
function latestReceipt(previous:ResourceToolSetup|undefined,row:ResourceToolSetup){
 if(!previous)return row;
 if(previous.revision>row.revision)return previous;
 if(previous.revision===row.revision&&previous.skill?.body&&row.skill?.sha256===previous.skill.sha256&&!row.skill.body){
  return {...row,skill:{...row.skill,body:previous.skill.body}};
 }
 return row;
}

type Form={id:string;name:string;version:string;sourceKind:ResourceToolSource['kind'];url:string;pin:string;filename:string;executable:string;interpreter:''|'bash'|'python';argv:string;io:string;test:string;priorRun:string};
function startForm(route:ResourceToolRoute,tool?:string):Form{
 const id=tool?.replace(/^private\./,'')||'';
 return {id,name:id,version:'',sourceKind:route==='fresh'?'git':'installed',url:'',pin:'',filename:'',executable:'',interpreter:'',argv:'[]',io:'{\n  "inputs": {},\n  "outputs": {}\n}',test:'{\n  "inputs": {},\n  "max_seconds": 120\n}',priorRun:''};
}
function assemble(form:Form):ResourceToolManifest{
 const executable=form.executable.trim(),url=form.url.trim(),pin=form.pin.trim();
 const source:ResourceToolSource=form.sourceKind==='installed'?{kind:'installed',executable,...pin?{sha256:pin}:{}}:
  form.sourceKind==='git'?{kind:'git',url,commit:pin,executable}:
  {kind:form.sourceKind,...url?{url}:{},sha256:pin,filename:form.filename.trim(),executable};
 const args=parseJson(form.argv,interfaceJsonLabels.argv);
 if(!Array.isArray(args)||!args.every(value=>typeof value==='string'))throw Error(`${t(interfaceJsonLabels.argv)} · ${t('运行参数必须是 JSON 字符串列表。')}`);
 const io=parseObject<Pick<ResourceToolManifest,'inputs'|'outputs'>>(form.io,interfaceJsonLabels.io);
 const conflicts=['id','name','version','source','interpreter','argv','test'].filter(key=>Object.hasOwn(io,key));
 if(conflicts.length)throw Error(`${t(interfaceJsonLabels.io)} · ${t('请在对应字段编辑这些配置。')} ${conflicts.join(', ')}`);
 const test=parseObject<ResourceToolManifest['test']>(form.test,interfaceJsonLabels.test);
 return {...url?{citations:[{url,version:form.version.trim()}]}:{},...io,id:form.id.trim(),name:form.name.trim(),version:form.version.trim(),source,...form.interpreter?{interpreter:form.interpreter}:{},argv:args,test};
}

type SelectedSource=ResourceToolSourcePick;
export type ResourceToolDiscussion={route:ResourceToolRoute;tool?:string;directory?:string;candidate?:{path:string;sha256:string};target?:ResourceToolTarget;description?:string;source?:Omit<SelectedSource,'local_source'>;setupIds:string[]};
type Props={resourceId:string;profileVersion:number;resourceName:string;initialRoute?:ResourceToolRoute;missingTool?:string;newPlanAfter?:string[];suspended?:boolean;onDiscuss?:(scope:ResourceToolDiscussion)=>void;onConfigureTarget?:(kind:'scheduler'|'project')=>void;onClose:()=>void;onRoute?:(route:ResourceToolRoute)=>void};
type SetupLifetime={busy:boolean;actionVersion:number;listRequest:symbol|null;refreshAfterAction:boolean;suspended:boolean};
export default function ResourceToolSetup(props:Props){
 // Drafts, file selections and receipts belong to one saved resource version.
 return <ResourceToolSetupPanel key={JSON.stringify([props.resourceId,props.profileVersion])} {...props}/>;
}
function ResourceToolSetupPanel({resourceId,profileVersion,resourceName,initialRoute,missingTool,newPlanAfter,suspended=false,onDiscuss,onConfigureTarget,onClose,onRoute}:Props){
 const [route,setRoute]=useState(initialRoute),[form,setForm]=useState(()=>startForm(initialRoute||'fresh',missingTool));
 const [library,setLibrary]=useState<ResourceToolLibrary|null>(null),[selected,setSelected]=useState(''),[target,setTarget]=useState('');
 const [directory,setDirectory]=useState(''),[discovery,setDiscovery]=useState<ResourceToolDiscovery|null>(null),[candidateId,setCandidateId]=useState(''),[remote,setRemote]=useState('');
 const [description,setDescription]=useState('');
 const [localSource,setLocalSource]=useState<SelectedSource|null>(null),[manual,setManual]=useState<SelectedSource|null>(null);
 const [action,setAction]=useState(''),[reading,setReading]=useState(false),[error,setError]=useState('');
 const pending=action||(reading?'正在读取资源工具…':'');
 const lifetime=useRef<SetupLifetime|null>(null),planIdentity=useRef<{stamp:string;id:string}|null>(null);
 const selectedOwner=useRef(''),reviewedPlan=useRef<string[]|undefined>(undefined);
 const setups=library?.setups||[],receipt=setups.find(row=>row.id===selected),candidate=discovery?.candidates.find(row=>row.id===candidateId);
 const targets=library?.targets||[],picked=target?targets.find(item=>targetKey(item)===target):targets.length===1?targets[0]:undefined;
 const base={resource_id:resourceId,profile_version:profileVersion};
 const selectSetup=useCallback((id:string)=>{selectedOwner.current=id;setSelected(id);},[]);
 const updateLibrary=useCallback(async(showProgress=false)=>{
  const owner=lifetime.current;
  if(!owner||owner.suspended)return;
  if(owner.busy){owner.refreshAfterAction=true;return;}
  const read=Symbol();owner.listRequest=read;
  const current=()=>lifetime.current===owner&&owner.listRequest===read;
  if(showProgress){setReading(true);setError('');}
  try{
   const result=await request('tools.resource.list',{resource_id:resourceId,profile_version:profileVersion});
   if(!current())return;
   if(result.setups.some(row=>row.resource_id!==resourceId))throw Error(t('配置回执与当前资源不一致。'));
   setLibrary(previous=>{
    const old=new Map(previous?.setups.map(row=>[row.id,row]));
    return {...result,setups:result.setups.map(row=>latestReceipt(old.get(row.id),row))};
   });
  }catch(error){if(current())setError(errorText(error));}
  finally{if(current()){owner.listRequest=null;setReading(false);}}
 },[resourceId,profileVersion]);
 const accept=useCallback((row:ResourceToolSetup)=>{
  if(row.resource_id!==resourceId)throw Error(t('配置回执与当前资源不一致。'));
  setLibrary(previous=>({...previous,targets:previous?.targets||[],setups:[latestReceipt(previous?.setups.find(old=>old.id===row.id),row),...(previous?.setups||[]).filter(old=>old.id!==row.id)]}));
 },[resourceId]);
 async function act(label:string,work:(current:()=>boolean)=>Promise<void>){
  const owner=lifetime.current;
  if(!owner||owner.busy||owner.suspended)return;
  if(owner.listRequest){
   // This snapshot may precede the action's receipt. Refresh once the action settles.
   owner.listRequest=null;owner.refreshAfterAction=true;setReading(false);
  }
  owner.busy=true;owner.actionVersion++;setAction(label);setError('');
  const current=()=>lifetime.current===owner;
  try{await work(current);}
  catch(error){if(current())setError(errorText(error));}
  finally{
   if(current()){
    owner.busy=false;setAction('');
    if(owner.refreshAfterAction){owner.refreshAfterAction=false;void updateLibrary();}
   }
  }
 }
 useLayoutEffect(()=>{
  lifetime.current={busy:false,actionVersion:0,listRequest:null,refreshAfterAction:false,suspended:false};
  return()=>{lifetime.current=null;};
 },[]);
 useLayoutEffect(()=>{
  const owner=lifetime.current!;
  owner.suspended=suspended;
  if(suspended){owner.listRequest=null;setReading(false);}
 },[suspended]);
 useEffect(()=>{
  if(suspended)return;
  const unsubscribe=window.studio?.onEvent(event=>{
   if(event.method==='studio/resourceToolSetupChanged'&&event.params?.resource_id===resourceId)void updateLibrary();
  });
  void updateLibrary(true);
  return unsubscribe;
 },[suspended,resourceId,updateLibrary]);
 useEffect(()=>{
  if(suspended||selectedOwner.current||!newPlanAfter||reviewedPlan.current===newPlanAfter)return;
  const recent=library?.setups.filter(row=>row.route===initialRoute&&!newPlanAfter.includes(row.id)&&row.status==='planned');
  if(recent?.length===1){reviewedPlan.current=newPlanAfter;selectSetup(recent[0].id);}
 },[suspended,library,newPlanAfter,initialRoute,selectSetup]);
 const receiptId=receipt?.id,receiptStatus=receipt?.status;
 useEffect(()=>{
  const owner=lifetime.current;
  if(!owner||suspended||!receiptId||!receiptStatus||!activeStatus(receiptStatus))return;
  let cancelled=false,timer:ReturnType<typeof setTimeout>;
  const current=()=>!cancelled&&lifetime.current===owner&&!owner.suspended&&selectedOwner.current===receiptId;
  const read=async()=>{
   if(!current())return;
   if(!owner.busy){
    const version=owner.actionVersion;
    try{
     const row=await request('tools.resource.status',{resource_id:resourceId,profile_version:profileVersion,setup_id:receiptId});
     if(current()&&owner.actionVersion===version)accept(row);
    }catch(error){if(current()&&owner.actionVersion===version){setError(errorText(error));return;}}
   }
   if(current())timer=setTimeout(read,2000);
  };
  timer=setTimeout(read,1500);return()=>{cancelled=true;clearTimeout(timer);};
 },[suspended,resourceId,profileVersion,receiptId,receiptStatus,accept]);
 function switchRoute(next:ResourceToolRoute){
  if(!receipt&&route===next)return;
  reviewedPlan.current=newPlanAfter;selectSetup('');setRoute(next);setForm(startForm(next,missingTool));setError('');setCandidateId('');setDiscovery(null);setDescription('');setLocalSource(null);setManual(null);onRoute?.(next);
 }
 function patch<K extends keyof Form>(key:K,value:Form[K]){setForm(previous=>({...previous,[key]:value}));}
 async function discover(current:()=>boolean){
  const observed=await request('tools.resource.discover',{...base,directory:directory.trim()});
  if(current()){setDiscovery(observed);setCandidateId('');}
 }
 function chooseCandidate(id:string){
  setCandidateId(id);
  const row=discovery?.candidates.find(item=>item.id===id);
  if(row)setForm(previous=>({...previous,id:previous.id||row.tool.toLowerCase().replace(/[^a-z0-9_-]/g,'-'),name:previous.name||row.tool,sourceKind:'installed',executable:row.path,interpreter:'bash',pin:row.sha256}));
 }
 async function chooseSource(kind:SelectedSource['kind'],current:()=>boolean){
  const selected=await request('tools.resource.chooseSource',{...base,kind});
  if(!selected||!current()||selected.kind!==kind)return;
  if(kind==='manual'){setManual(selected);return;}
  setLocalSource(selected);
  const sourceKind=/\.(?:zip|tar|tgz|tar\.gz|tar\.xz|tar\.bz2)$/i.test(selected.name)?'archive':'binary';
  setForm(previous=>({...previous,sourceKind,filename:selected.name,pin:selected.sha256,url:'',executable:sourceKind==='binary'?selected.name:''}));
 }
 function discuss(){
  if(!onDiscuss||!route)return;
  const source=localSource&&{kind:localSource.kind,name:localSource.name,size:localSource.size,sha256:localSource.sha256,text:localSource.text,truncated:localSource.truncated};
  const notes=[description.trim(),manual?`${t('本机手册')} · ${manual.name} · SHA-256 ${manual.sha256}${manual.text?`\n${manual.text}`:''}`:null].filter(Boolean).join('\n\n');
  onDiscuss({route,tool:missingTool||form.name.trim()||undefined,directory:directory.trim()||undefined,candidate:candidate?{path:candidate.path,sha256:candidate.sha256}:undefined,target:picked,description:notes||undefined,source:source||undefined,setupIds:setups.map(row=>row.id)});
 }
 async function plan(current:()=>boolean){
  if(!route||!picked)return;
  const manifest=assemble(form),source=manifest.source;
  const selectedSource=localSource?.local_source&&(source.kind==='binary'||source.kind==='archive')&&source.sha256===localSource.sha256&&source.filename===localSource.name?localSource.local_source:null;
  const args={...base,route,manifest,project_id:picked.project_id,environment_id:picked.environment_id,cluster_id:picked.cluster_id,...picked.queue_target_id?{queue_target_id:picked.queue_target_id}:{},...candidate?{candidate:{path:candidate.path,sha256:candidate.sha256}}:{},...form.priorRun.trim()?{prior_run_id:form.priorRun.trim()}:{},...selectedSource?{local_source:selectedSource}:{} };
  const stamp=JSON.stringify(args);
  if(planIdentity.current?.stamp!==stamp)planIdentity.current={stamp,id:crypto.randomUUID()};
  const row=await request('tools.resource.plan',{...args,request_id:planIdentity.current.id});
  if(current()){accept(row);selectSetup(row.id);}
 }
 function apply(action:'start'|'status'|'file'|'remote'|'skill'){
  if(!receipt)return;
  const ref={...base,setup_id:receipt.id},revision={...ref,revision:receipt.revision};
  void act('正在核对配置…',async current=>{
   const next=action==='start'?await request('tools.resource.start',{...revision,plan_sha256:receipt.plan_sha256}):
    action==='file'?await request('tools.resource.supplyFile',revision):action==='remote'?await request('tools.resource.supplyRemote',{...revision,path:remote.trim()}):
    action==='skill'?await request('tools.resource.saveSkill',ref):await request('tools.resource.status',ref);
   if(current()&&!next.cancelled)accept(next);
  });
 }
 const field=(key:keyof Form,label:string,required=false,placeholder?:string)=><label>{t(label)}<input value={form[key]} required={required} placeholder={placeholder} onChange={event=>patch(key,event.currentTarget.value)}/></label>;
 return <section className="resource-tool-setup" data-testid="resource-tool-setup" data-guide-target="resource-tool-setup">
  <p className="resource-tool-scope"><strong>{resourceName}</strong><code title={resourceId}>{resourceId}</code>{missingTool&&<span>{t('流程缺少工具')} · {missingTool}</span>}</p>
  <div className="resource-tool-routes" role="group" aria-label={t('工具接入方式')}>
   {routes.map(([key,Icon])=><Button type="button"  aria-pressed={route===key} disabled={!!pending} data-testid={'resource-tool-'+key} key={key} onClick={()=>switchRoute(key)}><Icon size={17}/><span><strong>{t(routeLabels[key])}</strong><small>{t(routeDetails[key])}</small></span></Button>)}
  </div>
  {setups.length>0&&<Disclosure open={!route&&!receipt} summary={<>{t('此资源的工具与配置记录')}</>}><ul className="resource-tool-list">{setups.map(row=><li key={row.id}>
   <button type="button" className="text-button" disabled={!!pending} onClick={()=>{selectSetup(row.id);setRoute(row.route);setError('');}}>{row.manifest.name} · {row.manifest.version}</button><span>{t(statuses[row.status])}</span></li>)}</ul></Disclosure>}
  {route&&!receipt&&<>
   {!targets.length&&library&&<Notice compact severity="warning"><p>{t('没有可用的测试目标。请先在该资源登记调度器、计算环境和项目授权。')}</p>{onConfigureTarget&&<div className="button-row">
    <Button  data-testid="resource-tool-configure-scheduler" type="button" disabled={!!pending} onClick={()=>onConfigureTarget('scheduler')}>{t('打开此资源的调度器设置')}</Button>
    <Button  data-testid="resource-tool-configure-project" type="button" disabled={!!pending} onClick={()=>onConfigureTarget('project')}>{t('设置项目授权')}</Button>
   </div>}</Notice>}
   {route==='existing'&&<section className="resource-tool-discovery" data-guide-target="resource-tool-discover" aria-label={t('查找已有脚本')}>
    <label>{t('远端脚本目录')}<input data-testid="resource-tool-scan-path" value={directory} onChange={event=>{setDirectory(event.currentTarget.value);setDiscovery(null);setCandidateId('');}} disabled={!!pending}/></label>
    <Button type="button"  data-testid="resource-tool-scan" disabled={!!pending||!directory.trim()} onClick={()=>void act('正在只读扫描…',discover)}><FolderSearch size={16}/>{t('扫描脚本')}</Button>
    {discovery&&<fieldset disabled={!!pending}><legend>{t('选择代表脚本')}</legend>
     {!discovery.candidates.length&&<p>{t('在此目录中没有找到可登记的脚本。')}</p>}
     {discovery.candidates.map(row=><label className="resource-tool-candidate" key={row.id}>
      <input type="radio" name="resource-tool-candidate" data-testid="resource-tool-candidate" checked={candidateId===row.id} onChange={()=>chooseCandidate(row.id)}/>
      <span><strong>{row.tool} · {row.scheduler} · {row.count}</strong><code>{row.path}</code>{row.environment.map(value=><code key={value}>{value}</code>)}{row.evidence.map(value=><small key={value}>{value}</small>)}</span>
     </label>)}
     {discovery.truncated&&<p>{t('只显示部分结果，可用更具体的目录继续扫描。')}</p>}
     {candidateId&&<button type="button" className="text-button" onClick={()=>{setCandidateId('');setForm(startForm('existing',missingTool));}}>{t('跳过这个脚本')}</button>}
    </fieldset>}
   </section>}
   {!!targets.length&&<label>{t('计算环境与测试队列')}<select value={picked?targetKey(picked):''} data-testid="resource-tool-target" onChange={event=>setTarget(event.currentTarget.value)} disabled={!!pending}>
    <option value="">{t('请选择')}</option>{targets.map(value=><option key={targetKey(value)} value={targetKey(value)}>{value.environment_id} · {value.scheduler} {value.queue} · {value.project_id}</option>)}
   </select></label>}
   {route==='custom'&&<div className="resource-tool-source-picker">
    <div className="button-row"><Button type="button"  data-testid="resource-tool-choose-program" disabled={!!pending} onClick={()=>void act('正在核对本机文件…',current=>chooseSource('program',current))}><FolderOpen size={16}/>{t('选择本机程序或脚本')}</Button>
     <Button type="button"  data-testid="resource-tool-choose-manual" disabled={!!pending} onClick={()=>void act('正在核对本机文件…',current=>chooseSource('manual',current))}><FileText size={16}/>{t('选择本机手册')}</Button></div>
    {[localSource,manual].map(file=>file&&<Disclosure key={file.kind} summary={<>{file.name} · {file.size.toLocaleString()} B</>}><p>SHA-256 · <code>{file.sha256}</code></p>{file.text&&<pre>{file.text}</pre>}</Disclosure>)}
   </div>}
   {onDiscuss&&<div className="resource-tool-discuss" data-guide-target="resource-tool-discuss">
    <label>{t('告诉助手手头有什么')}<textarea data-testid="resource-tool-description" rows={2} value={description} onChange={event=>setDescription(event.currentTarget.value)} placeholder={t(route==='fresh'?'工具名称、版本或公开来源':route==='existing'?'已用脚本的用途或已有测试结果':'程序、脚本或手册的位置，以及想得到的输出')}/></label>
    <Button variant="primary" type="button"  data-testid="resource-tool-discuss" disabled={!!pending} onClick={discuss}>{t('让 Agent 帮我配置')}</Button>
   </div>}
   <Disclosure className="resource-tool-manual" data-testid="resource-tool-manual" summary={<>{t('手动填写工具配置')}</>}>
   <form className="resource-tool-form" onSubmit={event=>{event.preventDefault();void act('正在准备配置预览…',plan);}}>
    <fieldset disabled={!!pending}><legend>{t('工具与版本')}</legend><div className="resource-tool-grid">
     {field('name','工具名称',true)}{field('id','工具 ID',true,'my-tool')}{field('version','工具版本',true,'1.0.0')}
    </div></fieldset>
    <fieldset disabled={!!pending}><legend>{t('程序来源与运行入口')}</legend><div className="resource-tool-grid">
     <label>{t('程序来源')}<select value={form.sourceKind} onChange={event=>patch('sourceKind',event.currentTarget.value as Form['sourceKind'])}>
      <option value="installed">{t('远端现有程序')}</option><option value="git">Git</option><option value="archive">{t('归档文件')}</option><option value="binary">{t('二进制文件')}</option>
     </select></label>
     {form.sourceKind!=='installed'&&field('url','公开来源 URL',form.sourceKind==='git','https://…')}
     {field('pin',form.sourceKind==='git'?'完整 Git 提交号':'SHA-256',form.sourceKind!=='installed')}
     {['archive','binary'].includes(form.sourceKind)&&field('filename','源文件名',true)}
     {field('executable',form.sourceKind==='installed'?'远端程序绝对路径':'程序包内执行入口',true)}
     <label>{t('解释器')}<select value={form.interpreter} onChange={event=>patch('interpreter',event.currentTarget.value as Form['interpreter'])}><option value="">{t('直接执行')}</option><option value="bash">Bash</option><option value="python">Python</option></select></label>
    </div></fieldset>
    <fieldset disabled={!!pending}><legend>{t('运行接口与最小测试')}</legend>
     <ResourceToolInterfaceEditor key={route} values={form} onRaw={patch} onEdit={(field,path,value)=>setForm(previous=>({...previous,[field]:editJsonDraft(previous[field],path,value)}))}/>
    </fieldset>
    {route==='existing'&&field('priorRun','原测试运行 ID（如有）')}
    <div className="button-row"><Button type="submit" data-testid="resource-tool-plan" disabled={!!pending||!picked}>{t('核对配置与最小测试')}</Button></div>
   </form></Disclosure>
  </>}
  {receipt&&<section className="resource-tool-receipt" data-testid="resource-tool-receipt" data-guide-target="resource-tool-receipt">
   <h3>{receipt.manifest.name} · {receipt.manifest.version}</h3><Notice compact  data-testid="resource-tool-status">{t(statuses[receipt.status])}</Notice>
   <dl><dt>{t('安装位置')}</dt><dd><code>{receipt.install_root}</code></dd><dt>{t('计算环境与测试队列')}</dt><dd>{receipt.target.environment_id} · {receipt.target.scheduler} {receipt.target.queue}</dd>
    <dt>{t('程序来源与运行入口')}</dt><dd>{receipt.manifest.source.kind} · <code>{'url' in receipt.manifest.source&&receipt.manifest.source.url?receipt.manifest.source.url+' · ':''}{receipt.manifest.source.executable}</code></dd></dl>
   {receipt.onboarding&&<Disclosure data-testid="resource-tool-onboarding" summary={<>{t('工具包来源')} · {receipt.onboarding.package_id} · {receipt.onboarding.function_id}</>}>
    <dl><dt>{t('包版本')}</dt><dd><code>{receipt.onboarding.package_version}</code></dd>
     <dt>{t('源码提交')}</dt><dd><code>{receipt.onboarding.source_commit}</code></dd>
     <dt>{t('声明摘要')}</dt><dd><code>{receipt.onboarding.manifest_sha256}</code></dd>
     <dt>{t('参考测试用例')}</dt><dd><code>{receipt.onboarding.reference_test_case_id}</code></dd></dl>
   </Disclosure>}
   {receipt.status==='planned'&&<>
    {receipt.manifest.build&&<Disclosure summary={<>{t('构建步骤')} · {receipt.manifest.build.max_seconds} s</>}><ol>{receipt.manifest.build.steps.map((step,index)=><li key={index}><code>{step.cwd&&`[${step.cwd}] `}{JSON.stringify([step.command,...step.args])}</code></li>)}</ol></Disclosure>}
    <p>{t('最小测试')} · {receipt.manifest.test.max_seconds} s{receipt.manifest.test.resources&&<> · {Object.entries(receipt.manifest.test.resources).map(([name,value])=>`${name} ${value}`).join(' · ')}</>}</p>
    <dl><dt>{t('测试输入')}</dt><dd>{Object.entries(receipt.manifest.test.inputs).map(([port,value])=><div key={port}>{port} · {'path' in value?<code>{value.path}</code>:t('随配置提供的内容')}</div>)}</dd>
     <dt>{t('预期产物')}</dt><dd>{Object.entries(receipt.manifest.outputs).map(([port,value])=><div key={port}>{port} · <code>{value.filename}</code> · {value.format}</div>)}</dd>
    </dl>
    <Disclosure summary={<>{t('查看命令、输入输出和测试定义')}</>}><pre>{JSON.stringify(receipt.manifest,null,2)}</pre></Disclosure>
   </>}
   {receipt.activity.length>0&&<ol>{receipt.activity.map((item,index)=><li key={`${index}:${item.stage}`}><span>{t(({passed:'通过',failed:'失败',pending:'等待',reused:'沿用'})[item.status])}</span> · {item.message}</li>)}</ol>}
   {receipt.message&&<p>{receipt.message}</p>}
   {receipt.build&&<div><strong>{t('构建步骤')}</strong> · {receipt.build.status} · {receipt.build.job_id||receipt.build.run_id}{receipt.build.directory&&<code> · {receipt.build.directory}</code>}</div>}
   {receipt.test&&<div className="resource-tool-test-receipt" data-testid="resource-tool-test-receipt"><strong>{t('最小测试')}</strong> · {receipt.test.status} · {receipt.test.job_id||receipt.test.run_id}{receipt.test.reused&&<> · {t('沿用已核对的原测试')}</>}{receipt.test.directory&&<code>{receipt.test.directory}</code>}{receipt.test.outputs&&<ul>{Object.entries(receipt.test.outputs).map(([id,output])=><li key={id}>{id} · {output.size} B · <code>{output.sha256}</code>{Object.entries(output.checks||{}).map(([name,state])=><small key={name}> · {name} {t(state==='passed'?'通过':'失败')}</small>)}</li>)}</ul>}</div>}
   {receipt.activation_id&&<p>{t('已激活功能')} · <code>private.{receipt.manifest.id}</code></p>}
   {receipt.skill&&<p data-testid="resource-tool-skill">{t('执行技能')} · {receipt.skill.name} · {t(receipt.skill.status==='saved'?'已保存并核对':'待写入用户技能库')}{receipt.skill.error&&<span> · {receipt.skill.error}</span>}</p>}
   {receipt.skill&&'body' in receipt.skill&&typeof receipt.skill.body==='string'&&<Disclosure data-testid="resource-tool-skill-content" summary={<>{t('查看执行技能')}</>}><pre>{receipt.skill.body}</pre><p>SHA-256 · <code>{receipt.skill.sha256}</code></p></Disclosure>}
   {receipt.status==='needs_file'&&<div className="resource-tool-file"><Button type="button"  data-testid="resource-tool-local-file" disabled={!!pending} onClick={()=>apply('file')}>{t('选择本机文件')}</Button>
    <label>{t('或输入集群上的源文件路径')}<input data-testid="resource-tool-remote-file" value={remote} onChange={event=>setRemote(event.currentTarget.value)} disabled={!!pending}/></label>
    <Button type="button"  disabled={!!pending||!remote.trim()} onClick={()=>apply('remote')}>{t('核对源文件')}</Button></div>}
   <div className="button-row">
    {receipt.status==='planned'&&<Button variant="primary" type="button"  data-testid="resource-tool-start" disabled={!!pending} onClick={()=>apply('start')}>{t(receipt.route==='fresh'?'确认安装并运行最小测试':'确认配置并核对最小测试')}</Button>}
    {receipt.status==='active'&&receipt.skill?.status!=='saved'&&<Button type="button"  data-testid="resource-tool-save-skill" disabled={!!pending} onClick={()=>apply('skill')}>{t('补写执行技能')}</Button>}
    {receipt.status==='active'&&missingTool&&onConfigureTarget&&<Button type="button"  disabled={!!pending} onClick={()=>onConfigureTarget('project')}>{t('核对原流程的项目授权')}</Button>}
    {receipt.status==='active'&&<Button type="button" disabled={!!pending} data-testid="resource-tool-return" onClick={onClose}>{t('返回原工作页')}</Button>}
    {receipt.skill?.status==='saved'&&(!('body' in receipt.skill)||!receipt.skill.body)&&<Button type="button"  disabled={!!pending} onClick={()=>apply('status')}>{t('查看执行技能')}</Button>}
    <Button type="button"  data-testid="resource-tool-refresh" disabled={!!pending} onClick={()=>apply('status')}>{t('核对原配置回执')}</Button>
   </div>
  </section>}
  {pending&&<Notice compact >{t(pending)}</Notice>}{error&&<Notice compact severity="error"  >{error}<button type="button" className="text-button" disabled={!!pending} onClick={()=>void updateLibrary(true)}>{t('刷新状态')}</button></Notice>}
 </section>;
}
