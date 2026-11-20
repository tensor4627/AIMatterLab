import {useEffect,useRef,useState} from 'react';
import {FileText,FolderOpen,FolderSearch,PackagePlus,Plug,ScrollText} from 'lucide-react';
import type {TypedInvoke} from '../../../contracts/dto/ipc';
import type {ResourceToolDiscovery,ResourceToolLibrary,ResourceToolManifest,ResourceToolRoute,ResourceToolSetup,ResourceToolSource,ResourceToolSourcePick,ResourceToolTarget} from '../../../contracts/dto/resource-tools';
import {invoke} from '../../api/studio';
import {t} from '../../ui/i18n';
import './resource-tool-setup.css';

const request:TypedInvoke=invoke;
const routeLabels={fresh:'安装新工具',existing:'我已有提交脚本',custom:'接入其他软件'} as const;
const routeDetails={fresh:'在目标集群获取指定版本，核对来源并提交最小测试。',existing:'只读扫描指定目录，选择已经在用的代表脚本。',custom:'为自己的程序登记来源、运行接口、输入输出和测试。'} as const;
const routes=[['fresh',PackagePlus],['existing',ScrollText],['custom',Plug]] as const;
const statuses:Record<ResourceToolSetup['status'],string>={planned:'待确认测试',acquiring:'正在获取工具',desktop_fallback:'正在从本机获取工具',needs_file:'等待提供源文件',testing:'最小测试中',active:'工具已激活',failed:'配置失败',unknown:'结果待核对'};
const activeStatus=(value:ResourceToolSetup['status'])=>['acquiring','desktop_fallback','testing','unknown'].includes(value);
const targetKey=(target:ResourceToolTarget)=>JSON.stringify([target.project_id,target.cluster_id,target.environment_id,target.queue_target_id]);
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);

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
 const args=JSON.parse(form.argv),spec=JSON.parse(form.io),test=JSON.parse(form.test);
 if(!Array.isArray(args)||!args.every(value=>typeof value==='string'))throw Error(t('运行参数必须是 JSON 字符串列表。'));
 const {inputs,outputs,parameters,dependencies,support_files,build,git_bootstrap}=spec;
 return {id:form.id.trim(),name:form.name.trim(),version:form.version.trim(),source,...url?{citations:[{url,version:form.version.trim()}]}:{},...form.interpreter?{interpreter:form.interpreter}:{},argv:args,inputs,outputs,parameters,dependencies,support_files,build,git_bootstrap,test};
}

type SelectedSource=ResourceToolSourcePick;
export type ResourceToolDiscussion={route:ResourceToolRoute;tool?:string;directory?:string;candidate?:{path:string;sha256:string};target?:ResourceToolTarget;description?:string;source?:Omit<SelectedSource,'local_source'>;setupIds:string[]};
type Props={resourceId:string;profileVersion:number;resourceName:string;initialRoute?:ResourceToolRoute;missingTool?:string;newPlanAfter?:string[];suspended?:boolean;onDiscuss?:(scope:ResourceToolDiscussion)=>void;onConfigureTarget?:(kind:'scheduler'|'project')=>void;onClose:()=>void;onRoute?:(route:ResourceToolRoute)=>void};
export default function ResourceToolSetup({resourceId,profileVersion,resourceName,initialRoute,missingTool,newPlanAfter,suspended=false,onDiscuss,onConfigureTarget,onClose,onRoute}:Props){
 const [route,setRoute]=useState(initialRoute),[form,setForm]=useState(()=>startForm(initialRoute||'fresh',missingTool));
 const [library,setLibrary]=useState<ResourceToolLibrary|null>(null),[selected,setSelected]=useState(''),[target,setTarget]=useState('');
 const [directory,setDirectory]=useState(''),[discovery,setDiscovery]=useState<ResourceToolDiscovery|null>(null),[candidateId,setCandidateId]=useState(''),[remote,setRemote]=useState('');
 const [description,setDescription]=useState('');
 const [localSource,setLocalSource]=useState<SelectedSource|null>(null),[manual,setManual]=useState<SelectedSource|null>(null);
 const [pending,setPending]=useState(''),[error,setError]=useState('');
 const alive=useRef(false),flight=useRef(false),planIdentity=useRef<{stamp:string;id:string}|null>(null);
 const selectedOwner=useRef(selected);selectedOwner.current=selected;
 const setups=library?.setups||[],receipt=setups.find(row=>row.id===selected),candidate=discovery?.candidates.find(row=>row.id===candidateId);
 const targets=library?.targets||[],picked=targets.find(item=>targetKey(item)===target)||(targets.length===1?targets[0]:undefined);
 const base={resource_id:resourceId,profile_version:profileVersion};
 async function updateLibrary(){
  const result=await request('tools.resource.list',base);
  if(!alive.current)return;
  setLibrary(previous=>({...result,setups:result.setups.map(row=>previous?.setups.find(old=>old.id===row.id&&(old.revision>row.revision||old.revision===row.revision&&old.skill?.body))||row)}));
  if(!selectedOwner.current&&newPlanAfter){
   const recent=result.setups.filter(row=>row.route===initialRoute&&!newPlanAfter.includes(row.id)&&row.status==='planned');
   if(recent.length===1)setSelected(recent[0].id);
  }
 }
 function accept(row:ResourceToolSetup){
  if(!alive.current)return;
  if(row.resource_id!==resourceId)throw Error(t('配置回执与当前资源不一致。'));
  setSelected(row.id);setLibrary(previous=>({...previous,targets:previous?.targets||[],setups:[row,...(previous?.setups||[]).filter(old=>old.id!==row.id)]}));
 }
 async function act(label:string,work:()=>Promise<void>){
  if(flight.current)return;
  flight.current=true;setPending(label);setError('');
  try{await work();}catch(error){if(alive.current)setError(errorText(error));}
  finally{flight.current=false;if(alive.current)setPending('');}
 }
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!suspended)void act('正在读取资源工具…',updateLibrary);},[suspended]);
 useEffect(()=>window.studio?.onEvent(event=>{
  if(event.method==='studio/resourceToolSetupChanged'&&event.params?.resource_id===resourceId&&!flight.current)void updateLibrary().catch(error=>{if(alive.current)setError(errorText(error));});
 }),[resourceId,selected]);
 useEffect(()=>{
  if(!receipt||!activeStatus(receipt.status))return;
  let cancelled=false,timer:ReturnType<typeof setTimeout>;
  const read=async()=>{
   if(!flight.current){
    try{const row=await request('tools.resource.status',{...base,setup_id:receipt.id});if(cancelled||selectedOwner.current!==receipt.id)return;accept(row);if(!activeStatus(row.status))return;}
    catch(error){if(!cancelled)setError(errorText(error));return;}
   }
   if(!cancelled)timer=setTimeout(read,2000);
  };
  timer=setTimeout(read,1500);return()=>{cancelled=true;clearTimeout(timer);};
 },[receipt?.id,receipt?.status]);
 function switchRoute(next:ResourceToolRoute){
  if(!receipt&&route===next)return;
  selectedOwner.current='';setRoute(next);setForm(startForm(next,missingTool));setSelected('');setError('');setCandidateId('');setDiscovery(null);setDescription('');setLocalSource(null);setManual(null);onRoute?.(next);
 }
 function patch<K extends keyof Form>(key:K,value:Form[K]){setForm(previous=>({...previous,[key]:value}));}
 async function discover(){
  const observed=await request('tools.resource.discover',{...base,directory:directory.trim()});
  if(alive.current){setDiscovery(observed);setCandidateId('');}
 }
 function chooseCandidate(id:string){
  setCandidateId(id);
  const row=discovery?.candidates.find(item=>item.id===id);
  if(row)setForm(previous=>({...previous,id:previous.id||row.tool.toLowerCase().replace(/[^a-z0-9_-]/g,'-'),name:previous.name||row.tool,sourceKind:'installed',executable:row.path,interpreter:'bash',pin:row.sha256}));
 }
 async function chooseSource(kind:SelectedSource['kind']){
  const selected=await request('tools.resource.chooseSource',{...base,kind});
  if(!selected||!alive.current||selected.kind!==kind)return;
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
 async function plan(){
  if(!route||!picked)return;
  const manifest=assemble(form),source=manifest.source;
  const selectedSource=localSource?.local_source&&(source.kind==='binary'||source.kind==='archive')&&source.sha256===localSource.sha256&&source.filename===localSource.name?localSource.local_source:null;
  const args={...base,route,manifest,project_id:picked.project_id,environment_id:picked.environment_id,cluster_id:picked.cluster_id,...picked.queue_target_id?{queue_target_id:picked.queue_target_id}:{},...candidate?{candidate:{path:candidate.path,sha256:candidate.sha256}}:{},...form.priorRun.trim()?{prior_run_id:form.priorRun.trim()}:{},...selectedSource?{local_source:selectedSource}:{} };
  const stamp=JSON.stringify(args);
  if(planIdentity.current?.stamp!==stamp)planIdentity.current={stamp,id:crypto.randomUUID()};
  accept(await request('tools.resource.plan',{...args,request_id:planIdentity.current.id}));
 }
 function apply(action:'start'|'status'|'file'|'remote'|'skill'){
  if(!receipt)return;
  const ref={...base,setup_id:receipt.id},revision={...ref,revision:receipt.revision};
  void act('正在核对配置…',async()=>{
   const next=action==='start'?await request('tools.resource.start',{...revision,plan_sha256:receipt.plan_sha256}):
    action==='file'?await request('tools.resource.supplyFile',revision):action==='remote'?await request('tools.resource.supplyRemote',{...revision,path:remote.trim()}):
    action==='skill'?await request('tools.resource.saveSkill',ref):await request('tools.resource.status',ref);
   if(!next.cancelled)accept(next);
  });
 }
 const field=(key:keyof Form,label:string,required=false,placeholder?:string)=><label>{t(label)}<input value={form[key]} required={required} placeholder={placeholder} onChange={event=>patch(key,event.currentTarget.value)}/></label>;
 return <section className="resource-tool-setup" data-testid="resource-tool-setup" data-guide-target="resource-tool-setup">
  <p className="resource-tool-scope"><strong>{resourceName}</strong><code title={resourceId}>{resourceId}</code>{missingTool&&<span>{t('流程缺少工具')} · {missingTool}</span>}</p>
  <div className="resource-tool-routes" role="group" aria-label={t('工具接入方式')}>
   {routes.map(([key,Icon])=><button type="button" className="button" aria-pressed={route===key} disabled={!!pending} data-testid={'resource-tool-'+key} key={key} onClick={()=>switchRoute(key)}><Icon size={17}/><span><strong>{t(routeLabels[key])}</strong><small>{t(routeDetails[key])}</small></span></button>)}
  </div>
  {setups.length>0&&<details open={!route&&!receipt}><summary>{t('此资源的工具与配置记录')}</summary><ul className="resource-tool-list">{setups.map(row=><li key={row.id}>
   <button type="button" className="text-button" disabled={!!pending} onClick={()=>{selectedOwner.current=row.id;setSelected(row.id);setRoute(row.route);setError('');}}>{row.manifest.name} · {row.manifest.version}</button><span>{t(statuses[row.status])}</span></li>)}</ul></details>}
  {route&&!receipt&&<>
   {!targets.length&&library&&<section className="notice" role="status"><p>{t('没有可用的测试目标。请先在该资源登记调度器、计算环境和项目授权。')}</p>{onConfigureTarget&&<div className="button-row">
    <button className="button" data-testid="resource-tool-configure-scheduler" type="button" disabled={!!pending} onClick={()=>onConfigureTarget('scheduler')}>{t('打开此资源的调度器设置')}</button>
    <button className="button" data-testid="resource-tool-configure-project" type="button" disabled={!!pending} onClick={()=>onConfigureTarget('project')}>{t('设置项目授权')}</button>
   </div>}</section>}
   {route==='existing'&&<section className="resource-tool-discovery" data-guide-target="resource-tool-discover" aria-label={t('查找已有脚本')}>
    <label>{t('远端脚本目录')}<input data-testid="resource-tool-scan-path" value={directory} onChange={event=>{setDirectory(event.currentTarget.value);setDiscovery(null);setCandidateId('');}} disabled={!!pending}/></label>
    <button type="button" className="button" data-testid="resource-tool-scan" disabled={!!pending||!directory.trim()} onClick={()=>void act('正在只读扫描…',discover)}><FolderSearch size={16}/>{t('扫描脚本')}</button>
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
    <div className="button-row"><button type="button" className="button" data-testid="resource-tool-choose-program" disabled={!!pending} onClick={()=>void act('正在核对本机文件…',()=>chooseSource('program'))}><FolderOpen size={16}/>{t('选择本机程序或脚本')}</button>
     <button type="button" className="button" data-testid="resource-tool-choose-manual" disabled={!!pending} onClick={()=>void act('正在核对本机文件…',()=>chooseSource('manual'))}><FileText size={16}/>{t('选择本机手册')}</button></div>
    {[localSource,manual].map(file=>file&&<details key={file.kind}><summary>{file.name} · {file.size.toLocaleString()} B</summary><p>SHA-256 · <code>{file.sha256}</code></p>{file.text&&<pre>{file.text}</pre>}</details>)}
   </div>}
   {onDiscuss&&<div className="resource-tool-discuss" data-guide-target="resource-tool-discuss">
    <label>{t('告诉助手手头有什么')}<textarea data-testid="resource-tool-description" rows={2} value={description} onChange={event=>setDescription(event.currentTarget.value)} placeholder={t(route==='fresh'?'工具名称、版本或公开来源':route==='existing'?'已用脚本的用途或已有测试结果':'程序、脚本或手册的位置，以及想得到的输出')}/></label>
    <button type="button" className="button primary" data-testid="resource-tool-discuss" disabled={!!pending} onClick={discuss}>{t('让 Agent 帮我配置')}</button>
   </div>}
   <details className="resource-tool-manual" data-testid="resource-tool-manual"><summary>{t('手动填写高级配置')}</summary>
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
    <fieldset disabled={!!pending}><legend>{t('运行接口与最小测试')}</legend><div className="resource-tool-code-grid">
     <label>{t('命令参数（JSON）')}<textarea data-testid="resource-tool-argv" spellCheck={false} rows={2} value={form.argv} onChange={event=>patch('argv',event.currentTarget.value)}/><small>{t('可引用 {input:名称}、{output:名称} 和 {param:名称}。')}</small></label>
     <label>{t('输入输出（JSON）')}<textarea data-testid="resource-tool-io" spellCheck={false} rows={4} value={form.io} onChange={event=>patch('io',event.currentTarget.value)}/><small>{t('每个端口填写 filename 和 format。可选 parameters 和 dependencies。')}</small></label>
     <small className="muted">{t('缺少 Git 时，可在输入输出 JSON 中添加 git_bootstrap。填写 kind 为 archive，并提供 filename、executable 和 sha256。url 可省略，确认后再选本机归档或填写集群路径。')}</small>
     <label>{t('测试输入与资源（JSON）')}<textarea data-testid="resource-tool-test" spellCheck={false} rows={4} value={form.test} onChange={event=>patch('test',event.currentTarget.value)}/><small>{t('测试输入可给 path 或 text。max_seconds 设置时间上限。')}</small></label>
    </div></fieldset>
    {route==='existing'&&field('priorRun','原测试运行 ID（如有）')}
    <div className="button-row"><button type="submit" className="button primary" data-testid="resource-tool-plan" disabled={!!pending||!picked}>{t('核对配置与最小测试')}</button></div>
   </form></details>
  </>}
  {receipt&&<section className="resource-tool-receipt" data-testid="resource-tool-receipt" data-guide-target="resource-tool-receipt">
   <h3>{receipt.manifest.name} · {receipt.manifest.version}</h3><p role="status" data-testid="resource-tool-status">{t(statuses[receipt.status])}</p>
   <dl><dt>{t('安装位置')}</dt><dd><code>{receipt.install_root}</code></dd><dt>{t('计算环境与测试队列')}</dt><dd>{receipt.target.environment_id} · {receipt.target.scheduler} {receipt.target.queue}</dd>
    <dt>{t('程序来源与运行入口')}</dt><dd>{receipt.manifest.source.kind} · <code>{'url' in receipt.manifest.source&&receipt.manifest.source.url?receipt.manifest.source.url+' · ':''}{receipt.manifest.source.executable}</code></dd></dl>
   {receipt.status==='planned'&&<>
    {receipt.manifest.build&&<details><summary>{t('构建步骤')} · {receipt.manifest.build.max_seconds} s</summary><ol>{receipt.manifest.build.steps.map((step,index)=><li key={index}><code>{step.cwd&&`[${step.cwd}] `}{JSON.stringify([step.command,...step.args])}</code></li>)}</ol></details>}
    <p>{t('最小测试')} · {receipt.manifest.test.max_seconds} s{receipt.manifest.test.resources&&<> · {Object.entries(receipt.manifest.test.resources).map(([name,value])=>`${name} ${value}`).join(' · ')}</>}</p>
    <dl><dt>{t('测试输入')}</dt><dd>{Object.entries(receipt.manifest.test.inputs).map(([port,value])=><div key={port}>{port} · {'path' in value?<code>{value.path}</code>:t('随配置提供的内容')}</div>)}</dd>
     <dt>{t('预期产物')}</dt><dd>{Object.entries(receipt.manifest.outputs).map(([port,value])=><div key={port}>{port} · <code>{value.filename}</code> · {value.format}</div>)}</dd>
    </dl>
    <details><summary>{t('查看命令、输入输出和测试定义')}</summary><pre>{JSON.stringify(receipt.manifest,null,2)}</pre></details>
   </>}
   {receipt.activity.length>0&&<ol>{receipt.activity.map((item,index)=><li key={`${index}:${item.stage}`}><span>{t(({passed:'通过',failed:'失败',pending:'等待',reused:'沿用'})[item.status])}</span> · {item.message}</li>)}</ol>}
   {receipt.message&&<p>{receipt.message}</p>}
   {receipt.build&&<div><strong>{t('构建步骤')}</strong> · {receipt.build.status} · {receipt.build.job_id||receipt.build.run_id}{receipt.build.directory&&<code> · {receipt.build.directory}</code>}</div>}
   {receipt.test&&<div className="resource-tool-test-receipt" data-testid="resource-tool-test-receipt"><strong>{t('最小测试')}</strong> · {receipt.test.status} · {receipt.test.job_id||receipt.test.run_id}{receipt.test.reused&&<> · {t('沿用已核对的原测试')}</>}{receipt.test.directory&&<code>{receipt.test.directory}</code>}{receipt.test.outputs&&<ul>{Object.entries(receipt.test.outputs).map(([id,output])=><li key={id}>{id} · {output.size} B · <code>{output.sha256}</code>{Object.entries(output.checks||{}).map(([name,state])=><small key={name}> · {name} {t(state==='passed'?'通过':'失败')}</small>)}</li>)}</ul>}</div>}
   {receipt.activation_id&&<p>{t('已激活功能')} · <code>private.{receipt.manifest.id}</code></p>}
   {receipt.skill&&<p data-testid="resource-tool-skill">{t('执行技能')} · {receipt.skill.name} · {t(receipt.skill.status==='saved'?'已保存并核对':'待写入用户技能库')}{receipt.skill.error&&<span> · {receipt.skill.error}</span>}</p>}
   {receipt.skill&&'body' in receipt.skill&&typeof receipt.skill.body==='string'&&<details data-testid="resource-tool-skill-content"><summary>{t('查看执行技能')}</summary><pre>{receipt.skill.body}</pre><p>SHA-256 · <code>{receipt.skill.sha256}</code></p></details>}
   {receipt.status==='needs_file'&&<div className="resource-tool-file"><button type="button" className="button" data-testid="resource-tool-local-file" disabled={!!pending} onClick={()=>apply('file')}>{t('选择本机文件')}</button>
    <label>{t('或输入集群上的源文件路径')}<input data-testid="resource-tool-remote-file" value={remote} onChange={event=>setRemote(event.currentTarget.value)} disabled={!!pending}/></label>
    <button type="button" className="button" disabled={!!pending||!remote.trim()} onClick={()=>apply('remote')}>{t('核对源文件')}</button></div>}
   <div className="button-row">
    {receipt.status==='planned'&&<button type="button" className="button primary" data-testid="resource-tool-start" disabled={!!pending} onClick={()=>apply('start')}>{t(receipt.route==='fresh'?'确认安装并运行最小测试':'确认配置并核对最小测试')}</button>}
    {receipt.status==='active'&&receipt.skill?.status!=='saved'&&<button type="button" className="button" data-testid="resource-tool-save-skill" disabled={!!pending} onClick={()=>apply('skill')}>{t('补写执行技能')}</button>}
    {receipt.status==='active'&&missingTool&&onConfigureTarget&&<button type="button" className="button" disabled={!!pending} onClick={()=>onConfigureTarget('project')}>{t('核对原流程的项目授权')}</button>}
    {receipt.status==='active'&&<button type="button" className="button primary" disabled={!!pending} data-testid="resource-tool-return" onClick={onClose}>{t('返回原工作页')}</button>}
    {receipt.skill?.status==='saved'&&(!('body' in receipt.skill)||!receipt.skill.body)&&<button type="button" className="button" disabled={!!pending} onClick={()=>apply('status')}>{t('查看执行技能')}</button>}
    <button type="button" className="button" data-testid="resource-tool-refresh" disabled={!!pending} onClick={()=>apply('status')}>{t('核对原配置回执')}</button>
   </div>
  </section>}
  {pending&&<p role="status">{t(pending)}</p>}{error&&<p className="notice" role="alert">{error}<button type="button" className="text-button" disabled={!!pending} onClick={()=>void act('正在读取资源工具…',updateLibrary)}>{t('刷新状态')}</button></p>}
 </section>;
}
