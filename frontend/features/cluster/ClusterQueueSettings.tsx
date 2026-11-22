import LoadingFeedback from '../../ui/LoadingFeedback';
import {useEffect,useRef,useState} from 'react';
import QueueChoices from "../compute/QueueChoices";
import {api} from '../../api/worker';
import {type Project,type Environment,type ClusterQueueTarget,type ClusterQueuePolicy,type ClusterQueueProfile,type ClusterSchedulerObservation} from '../../../contracts/dto/compute';
import {t} from "../../ui/i18n";
import './cluster.css';

export function queuePolicy(profile:ClusterQueueProfile,project?:Project):ClusterQueuePolicy{
 const saved=structuredClone(project?.policy.cluster_queue_policies?.[profile.id||'']||{profile_version:profile.version||0,allowed_target_ids:[],new_submission_order:[],paid:{}});
 return {...saved,paid:{permitted:false,conditions_known:false,conditions:'',...saved.paid}};
}
export function queueTestPrompt(profileId:string,target:ClusterQueueTarget){
 const limits={cpus:1,gpus:Math.min(1,target.limits.gpus),memory_mb:Math.min(4096,target.limits.memory_mb),max_seconds:Math.min(60,target.limits.max_seconds)};
 return '为当前项目准备队列环境的有界测试草稿。cluster_id='+profileId+'，queue_target_id='+target.id+'，engine候选='+target.engines.join(',')+'，资源上限='+JSON.stringify(limits)+'。先确认与科学目标相符的输入，只准备流程和不可变草稿，等待人工复核与点击执行。不得自动提交、安装、改变队列或付费授权；登录节点探测不是计算节点 GPU 验证。';
}
export default function ClusterQueueSettings({profile,project,worker,busy,profileDirty,visible,canCancelOptIn=false,environmentText,probe,onTargets,onValidity,onRefresh,onError,onQueueTest}:{profile:ClusterQueueProfile;project?:Project;worker:boolean;busy:boolean;profileDirty:boolean;visible:boolean;canCancelOptIn?:boolean;environmentText:string;probe?:ClusterSchedulerObservation|null;onTargets:(targets:ClusterQueueTarget[]|undefined)=>void;onValidity:(valid:boolean)=>void;onRefresh:()=>void;onError:(error:unknown)=>void;onQueueTest?:(text:string)=>void|Promise<void>}){
 const [policy,setPolicy]=useState(()=>queuePolicy(profile,project)),[approving,setApproving]=useState(false),[notice,setNotice]=useState(''),[environments,setEnvironments]=useState<Environment[]>([]),[engines,setEngines]=useState<string[]>([]),[jsonDrafts,setJsonDrafts]=useState<Record<string,string>>({}),[invalid,setInvalid]=useState<Record<string,boolean>>({});
 const approvalPending=useRef(false);
 const mounted=useRef(false),sequence=useRef(0),scope=useRef('');scope.current=JSON.stringify([profile.id,profile.version,project?.id,profileDirty,busy,worker]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++;};},[]);
 useEffect(()=>{if(!visible||!worker)return;let current=true;void Promise.all([api<Environment[]>('GET','/api/environments'),api<string[]>('GET','/api/engines')]).then(([values,routes])=>{if(current){setEnvironments(values);setEngines(routes);}}).catch(error=>{if(current)onError(error);});return()=>{current=false;};},[visible,worker,profile.id,profile.version]);
 const targets=profile.queue_targets||[],disabled=busy||approving||!worker;
 const valid=!Object.values(invalid).some(Boolean)&&targets.every(target=>target.id.trim()&&target.queue.trim()&&target.engines.length&&Object.entries(target.limits).every(([key,value])=>Number.isInteger(value)&&value>=(key==='gpus'?0:1)));
 useEffect(()=>{onValidity(!!valid);},[valid]);
 function update(id:string,changes:Partial<ClusterQueueTarget>){onTargets(targets.map(target=>{if(target.id!==id)return target;const next={...target,...changes};if(next.account==='')delete next.account;return next;}));}
 function add(queue=''){
  if(disabled)return;
  try{const environment=JSON.parse(environmentText);if(!environment?.executables)throw Error(t('请先填写有效环境。'));
   let n=targets.length+1;while(targets.some(target=>target.id==='queue-'+n))n++;
   onTargets([...targets,{id:'queue-'+n,queue,usage_class:'unknown',enabled:true,engines:[],environment:structuredClone(environment),activation:profile.activation||'',limits:{cpus:profile.limits.cpus||1,gpus:profile.limits.gpus||0,memory_mb:profile.limits.memory_mb||1024,max_seconds:profile.limits.max_seconds||600}}]);setNotice('');
  }catch(error){setNotice(String(error));}
 }
 function toggle(id:string,checked:boolean){setPolicy(old=>({...old,allowed_target_ids:checked?[...old.allowed_target_ids,id]:old.allowed_target_ids.filter(x=>x!==id),new_submission_order:checked?[...old.new_submission_order,id]:old.new_submission_order.filter(x=>x!==id)}));}
 function move(id:string,offset:number){setPolicy(old=>{const order=[...old.new_submission_order],i=order.indexOf(id),j=i+offset;if(i<0||j<0||j>=order.length)return old;[order[i],order[j]]=[order[j],order[i]];return {...old,new_submission_order:order};});}
 function editEnvironment(id:string,text:string){setJsonDrafts(old=>({...old,[id]:text}));try{const environment=JSON.parse(text);if(!environment?.executables)throw Error();update(id,{environment});setInvalid(old=>({...old,[id]:false}));}catch{setInvalid(old=>({...old,[id]:true}));}}
 const paidSelected=targets.some(target=>policy.allowed_target_ids.includes(target.id)&&target.usage_class==='paid');
 const selectedValid=policy.allowed_target_ids.every(id=>targets.some(target=>target.id===id&&target.enabled&&target.usage_class!=='unknown'));
 const paidValid=!policy.paid.permitted||policy.paid.conditions_known&&!!policy.paid.conditions.trim()&&!!policy.paid.limits&&Object.entries(policy.paid.limits).every(([key,value])=>Number.isInteger(value)&&value>=(key==='gpus'?0:1));
 const paidReady=paidValid&&(!paidSelected||policy.paid.permitted);
 const canApprove=!!project&&!!profile.id&&!!profile.version&&!profileDirty&&!disabled&&valid&&selectedValid&&paidReady;
 async function approve(){
  if(!canApprove||approvalPending.current)return;approvalPending.current=true;const wanted=scope.current,ticket=++sequence.current,id=profile.id!,version=profile.version!;setApproving(true);setNotice('');
  const current=()=>mounted.current&&sequence.current===ticket&&scope.current===wanted;
  try{const [projects,saved]=await Promise.all([api<Project[]>('GET','/api/projects'),api<ClusterQueueProfile>('POST','/api/cluster/profile',{cluster_id:id})]);if(!current())return;
   const latest=projects.find(value=>value.id===project!.id);if(!latest||saved.version!==version)throw Error(t('连接版本或项目已变化，请重新读取。'));
   const approved={...structuredClone(policy),profile_version:version};
   const updated=await api<Project>('POST','/api/projects',{...latest,policy:{...latest.policy,clusters:[...new Set([...(latest.policy.clusters||[]),id])],cluster_queue_policies:{...latest.policy.cluster_queue_policies,[id]:approved}}});if(!current())return;
   const stable=(value:any):string=>JSON.stringify(value,(key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(name=>[name,item[name]])):item);
   if(stable(updated?.policy?.cluster_queue_policies?.[id])!==stable(approved))throw Error(t('队列策略未按批准内容保存，请重新读取。'));
   setPolicy(approved);setNotice(t('队列策略已批准'));onRefresh();
  }catch(error){if(current())onError(String(error).includes('project_edit_conflict')?new Error(t('项目记录已变化，请关闭后重新打开并检查最新授权。')):error);}finally{approvalPending.current=false;if(mounted.current&&sequence.current===ticket)setApproving(false);}
 }
 function reset(){sequence.current++;setApproving(false);setPolicy(queuePolicy(profile,project));setNotice('');}
 function boundedTest(target:ClusterQueueTarget){if(!onQueueTest)return;const saved=queuePolicy(profile,project);if(profileDirty||!profile.id||!saved||saved.profile_version!==profile.version||!saved.allowed_target_ids.includes(target.id)||!target.enabled||target.usage_class==='unknown'||target.usage_class==='paid'&&(!saved.paid.permitted||!saved.paid.conditions_known))return;const engines=target.engines.filter(engine=>project!.policy.engines.includes(engine));if(!engines.length)return;const paid=target.usage_class==='paid'?saved.paid.limits:undefined;const limits={...target.limits,max_seconds:Math.min(target.limits.max_seconds,project!.policy.max_seconds)};if(paid)for(const key of ['cpus','gpus','memory_mb','max_seconds'] as const)limits[key]=Math.min(limits[key],paid[key]);void Promise.resolve(onQueueTest(queueTestPrompt(profile.id,{...target,engines,limits}))).catch(onError);}
 return <section className="card cluster-queue-settings" data-testid="cluster-queue-settings">
  <div className="queue-settings-heading"><h3>{t('队列与环境')}</h3><button className="button" data-testid="queue-add" disabled={disabled} onClick={()=>add()}>{t('添加队列目标')}</button></div>
  {!disabled&&<QueueChoices queues={probe?.queues} value="" language={localStorage.getItem('studio.language')==='en'?'en':'zh-CN'} onChange={queue=>add(queue)}/>}
  {profile.queue_targets===undefined?<p>{t('沿用单队列 Skill')}</p>:canCancelOptIn&&<button className="text-button" disabled={disabled} onClick={()=>{onTargets(undefined);setJsonDrafts({});setInvalid({});reset();}}>{t('取消新队列配置')}</button>}
  {profile.queue_targets!==undefined&&!targets.length&&<p role="status">{t('尚无队列目标，新任务不可提交。')}</p>}
  {targets.map((target,index)=>{const accepted=queuePolicy(profile,project),testAllowed=!!onQueueTest&&target.engines.some(engine=>project?.policy.engines.includes(engine))&&!profileDirty&&!!accepted&&accepted.profile_version===profile.version&&accepted.allowed_target_ids.includes(target.id)&&target.enabled&&target.usage_class!=='unknown'&&(target.usage_class!=='paid'||accepted.paid.permitted&&accepted.paid.conditions_known);return <details key={index} className="queue-target-disclosure" open={targets.length===1}><summary>{target.queue||t('队列 / 分区')}<span>{target.id} · {t(target.usage_class==='owned'?'自有':target.usage_class==='paid'?'付费':'未知')}</span></summary><fieldset className="queue-target" aria-label={target.id} disabled={disabled}>
   <div className="form-row"><label>{t('目标标识')}<input aria-label={t('目标标识')+' '+index} value={target.id} readOnly/></label><label>{t('队列 / 分区')}<input aria-label={t('队列 / 分区')+' '+index} value={target.queue} onChange={event=>update(target.id,{queue:event.target.value})}/></label><label>{t('使用类型')}<select aria-label={t('使用类型')+' '+index} value={target.usage_class} onChange={event=>update(target.id,{usage_class:event.target.value as ClusterQueueTarget['usage_class']})}><option value="unknown">{t('未知')}</option><option value="owned">{t('自有')}</option><option value="paid">{t('付费')}</option></select></label><label className="check-label"><input type="checkbox" checked={target.enabled} onChange={event=>update(target.id,{enabled:event.target.checked})}/>{t('启用')}</label></div>
   <label>{t('环境')}<select aria-label={t('环境')+' '+index} value="" onChange={event=>{const environment=environments.find(value=>value.id===event.target.value);if(environment){update(target.id,{environment:{executables:structuredClone(environment.executables),repositories:structuredClone(environment.repositories||{}),variables:structuredClone(environment.variables||{})}});setJsonDrafts(old=>{const next={...old};delete next[target.id];return next;});setInvalid(old=>({...old,[target.id]:false}));}}}><option value="">{target.environment.executables.python||t('沿用连接环境')}</option>{environments.map(value=><option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
   <div className="form-row">{(['cpus','gpus','memory_mb','max_seconds'] as const).map(key=><label key={key}>{key}<input aria-label={key+' '+index} type="number" min={key==='gpus'?0:1} value={target.limits[key]} onChange={event=>update(target.id,{limits:{...target.limits,[key]:Number(event.target.value)}})}/></label>)}</div>
   <label>{t('引擎路由')}<select multiple size={3} aria-label={t('引擎路由')+' '+index} value={target.engines} onChange={event=>update(target.id,{engines:Array.from(event.target.selectedOptions,option=>option.value)})}>{[...new Set([...engines,...target.engines])].map(engine=><option key={engine} value={engine}>{engine}</option>)}</select></label>{!target.engines.length&&<small role="status">{t('请选择引擎路由')}</small>}<details><summary>{t('高级环境配置')}</summary><label>{t('Modules / 虚拟环境初始化 · Bash')}<textarea value={target.activation} onChange={event=>update(target.id,{activation:event.target.value})}/></label><label>{t('显式科学环境 · JSON')}<textarea aria-invalid={!!invalid[target.id]} value={jsonDrafts[target.id]??JSON.stringify(target.environment,null,2)} onChange={event=>editEnvironment(target.id,event.target.value)}/></label>{invalid[target.id]&&<p role="alert">{t('请先填写有效环境。')}</p>}<label>{t('调度器账户')}<input data-testid={'queue-account-'+index} value={target.account||''} onChange={event=>update(target.id,{account:event.target.value})}/></label></details>
   <div className="button-row"><button className="button" data-testid={'queue-test-'+index} disabled={!testAllowed||disabled} onClick={()=>boundedTest(target)}>{t('新建队列测试任务')}</button><button className="text-button" data-testid={'queue-remove-'+index} onClick={()=>{onTargets(targets.filter((_,i)=>i!==index));setJsonDrafts(old=>{const next={...old};delete next[target.id];return next;});setInvalid(old=>{const next={...old};delete next[target.id];return next;});}}>{t('移除草稿目标')}</button></div>
  </fieldset></details>;})}
  {profile.queue_targets!==undefined&&<section className="queue-project-policy">
   <h4>{t('当前项目允许的队列与提交顺序')}</h4>
   {project&&<strong>{project.name}</strong>}
   <p className="queue-policy-note">{t('修改已保存的队列范围后，需要重新批准项目策略。')}</p>
   {targets.map(target=><label className="check-label" key={target.id}><input type="checkbox" data-testid={'queue-allow-'+target.id} disabled={disabled||!target.enabled||target.usage_class==='unknown'} checked={policy.allowed_target_ids.includes(target.id)} onChange={event=>toggle(target.id,event.target.checked)}/>{target.id} · {target.queue}</label>)}
   <ol>{policy.new_submission_order.map((id,index)=><li key={id}><span>{id}</span><button disabled={disabled} aria-label={t('移除策略目标')+' '+id} onClick={()=>toggle(id,false)}>×</button><button aria-label={t('上移')+' '+id} disabled={disabled||index===0} onClick={()=>move(id,-1)}>↑</button><button aria-label={t('下移')+' '+id} disabled={disabled||index===policy.new_submission_order.length-1} onClick={()=>move(id,1)}>↓</button></li>)}</ol>
   <details><summary>{t('付费条件与资源上限')}</summary><label className="check-label"><input data-testid="queue-paid-permit" type="checkbox" checked={policy.paid.permitted} disabled={disabled} onChange={event=>setPolicy(old=>({...old,paid:{...old.paid,permitted:event.target.checked,limits:old.paid.limits||{cpus:1,gpus:0,memory_mb:1024,max_seconds:60}}}))}/>{t('允许使用付费队列')}</label><label className="check-label"><input data-testid="queue-paid-known" type="checkbox" checked={policy.paid.conditions_known} disabled={disabled} onChange={event=>setPolicy(old=>({...old,paid:{...old.paid,conditions_known:event.target.checked}}))}/>{t('已确认费用条件')}</label><textarea data-testid="queue-paid-conditions" aria-label={t('费用条件')} value={policy.paid.conditions} disabled={disabled} onChange={event=>setPolicy(old=>({...old,paid:{...old.paid,conditions:event.target.value}}))}/>{policy.paid.limits&&<div className="form-row">{(['cpus','gpus','memory_mb','max_seconds'] as const).map(key=><label key={key}>{key}<input type="number" min={key==='gpus'?0:1} value={policy.paid.limits![key]} disabled={disabled} onChange={event=>setPolicy(old=>({...old,paid:{...old.paid,limits:{...old.paid.limits!,[key]:Number(event.target.value)}}}))}/></label>)}</div>}</details>
   <div className="button-row"><button className="button" data-testid="queue-policy-approve" disabled={!canApprove} onClick={()=>void approve()}>{t('批准当前项目队列策略')}</button><button className="button" data-testid="queue-policy-cancel" onClick={reset}>{t('取消策略修改')}</button></div></section>}
  <LoadingFeedback busy={approving} label={t('正在保存队列策略…')}/>
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
