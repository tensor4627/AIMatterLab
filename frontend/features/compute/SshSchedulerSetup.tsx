import LoadingFeedback from '../../ui/LoadingFeedback';
import {useEffect,useRef,useState} from 'react';
import {invoke} from '../../api/studio';
import {api} from '../../api/worker';
import {t} from '../../ui/i18n';
import {Modal} from '../../ui/Dialogs';
import {scopedSuggestedInputRoot} from './project-setup-defaults.mjs';

type Draft={id?:string;version?:number;name:string;scheduler:''|'slurm'|'lsf';python:string;executables:{name:string;path:string}[];cpus:string;gpus:string;memory:string;root:string;readRoots:string;queue:string;activation:string};
const empty=():Draft=>({name:'',scheduler:'',python:'',executables:[],cpus:'1',gpus:'0',memory:'1024',root:'',readRoots:'',queue:'',activation:''});
const absolute=(value:string)=>value.startsWith('/')&&value!=='/'&&!/[\r\n\0]/.test(value)&&!value.split('/').includes('..');
/** Human-only scheduler registration on the verified current SSH service. */
export default function SshSchedulerSetup({connectionId,attemptId,currentResource,suggestedWorkfileRoot,onSaved}:{connectionId:string;attemptId:string;currentResource:boolean;suggestedWorkfileRoot?:string;onSaved?:(value:{id:string;name?:string})=>void}){
 const [open,setOpen]=useState(false);
 const [draft,setDraft]=useState<Draft>(empty),[profiles,setProfiles]=useState<any[]>([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[uncertain,setUncertain]=useState(false),[profileLoading,setProfileLoading]=useState(false);
 const alive=useRef(false),flight=useRef(false),sequence=useRef(0),profileSequence=useRef(0),selectedRecord=useRef<any>(null),source=useRef({connectionId,attemptId,currentResource});source.current={connectionId,attemptId,currentResource};
 const matches=()=>alive.current&&source.current.currentResource&&source.current.connectionId===connectionId&&source.current.attemptId===attemptId;
 async function refresh(){const ticket=++sequence.current;setLoaded(false);if(!matches())return;setMessage('');try{const values=await api<any[]>('GET','/api/clusters');if(!matches()||ticket!==sequence.current)return;if(!Array.isArray(values))throw Error();setProfiles(values.filter(value=>value.transport_kind==='ssh-service-local'));setLoaded(true);setUncertain(false);}catch{if(matches()&&ticket===sequence.current){setLoaded(false);setMessage(t('读取已有调度器配置失败，请刷新后重试。'));}}}
 useEffect(()=>{alive.current=true;selectedRecord.current=null;setProfiles([]);setDraft(empty());setLoaded(false);setUncertain(false);void refresh();return()=>{alive.current=false;sequence.current++;profileSequence.current++;};},[connectionId,attemptId,currentResource]);
 const patch=(value:Partial<Draft>)=>{if(!flight.current)setDraft(old=>({...old,...value}));};
 async function select(id:string){if(flight.current||!matches())return;const ticket=++profileSequence.current;selectedRecord.current=null;setMessage('');if(!id){setProfileLoading(false);setDraft(empty());return;}setDraft(old=>({...old,id,version:undefined}));setProfileLoading(true);try{const value=await api<any>('POST','/api/cluster/profile',{cluster_id:id});if(!matches()||ticket!==profileSequence.current)return;if(value?.id!==id||!Number.isSafeInteger(value.version)||value.version<1||value.transport_kind!=='ssh-service-local'||!value.environment?.executables||typeof value.remote_root!=='string'||!Array.isArray(value.read_roots))throw Error();selectedRecord.current=value;const executables=value.environment.executables;setDraft({id:value.id,version:value.version,name:value.name,scheduler:value.scheduler,python:executables.python||'',executables:Object.entries(executables).filter(([name])=>name!=='python').map(([name,path])=>({name,path:String(path)})),cpus:String(value.limits?.cpus||1),gpus:String(value.limits?.gpus??0),memory:String(value.limits?.memory_mb||1024),root:value.remote_root,readRoots:value.read_roots.join('\n'),queue:value.queue||'',activation:value.activation||''});setProfiles(old=>old.map(row=>row.id===id?{...row,name:value.name,version:value.version}:row));}catch{if(alive.current&&ticket===profileSequence.current)setMessage(t('读取已有调度器配置失败，请刷新后重试。'));}finally{if(alive.current&&ticket===profileSequence.current)setProfileLoading(false);}}

 async function save(){if(!matches()||!loaded||flight.current||profileLoading||uncertain||draft.id&&(!selectedRecord.current||selectedRecord.current.id!==draft.id||selectedRecord.current.version!==draft.version))return;const cpus=Number(draft.cpus),gpus=Number(draft.gpus),memory=Number(draft.memory),roots=draft.readRoots.split('\n').map(value=>value.trim()).filter(Boolean),executables:Record<string,string>={python:draft.python.trim()},names=new Set(['python']);
  if(!draft.name.trim()||!['slurm','lsf'].includes(draft.scheduler)||!absolute(executables.python)||!absolute(draft.root.trim())||roots.some(value=>!absolute(value))||!Number.isSafeInteger(cpus)||cpus<1||!Number.isSafeInteger(gpus)||gpus<0||!Number.isSafeInteger(memory)||memory<1||draft.executables.some(row=>(!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(row.name)||['constructor','prototype','__proto__'].includes(row.name))||names.has(row.name)||(names.add(row.name),!absolute(row.path.trim())))){setMessage(t('请填写名称、调度器、绝对路径及有效资源上限。'));return;}
  for(const row of draft.executables)executables[row.name]=row.path.trim();
  const source=selectedRecord.current,request={...draft.id?{id:draft.id,version:draft.version}:{},...source?.queue_targets?{queue_targets:source.queue_targets}:{},...source?.lsf_memory_scope?{lsf_memory_scope:source.lsf_memory_scope}:{},...source?.notes!==undefined?{notes:source.notes}:{},name:draft.name.trim(),scheduler:draft.scheduler as 'slurm'|'lsf',environment:{...source?.environment,executables},limits:{...source?.limits,cpus,gpus,memory_mb:memory},remote_root:draft.root.trim(),read_roots:roots,queue:draft.queue.trim(),activation:draft.activation};
  flight.current=true;setBusy(true);setMessage('');const ticket=sequence.current;
  let confirmed:{id:string;name?:string}|undefined;
  try{
   const saved=await invoke<any>('compute.sshService.scheduler',{connectionId,attemptId,configuration:request});
   if(!matches()||ticket!==sequence.current)return;
   if(typeof saved?.id!=='string'||!saved.id||!Number.isSafeInteger(saved.version)||saved.transport_kind!=='ssh-service-local')throw Error();
   selectedRecord.current={...source,...request,...saved};
   setProfiles(old=>[saved,...old.filter(value=>value.id!==saved.id)]);
   setDraft(old=>({...old,id:saved.id,version:saved.version}));
   setMessage(t('调度器配置已保存；项目授权未改变。'));
   confirmed={id:saved.id,name:saved.name};
  }catch{
   if(alive.current){setUncertain(true);setMessage(t('保存结果尚未确认，请刷新已有配置核对后再操作。'));}
  }finally{flight.current=false;if(alive.current)setBusy(false);}
  if(confirmed)onSaved?.(confirmed);
 }
 const workfile=scopedSuggestedInputRoot(suggestedWorkfileRoot);
 return <>
  <button className="button" data-testid="ssh-scheduler-open" onClick={()=>setOpen(true)}>{t('配置队列与环境')}</button>
  {open&&<Modal title={t('当前作业服务的调度器与科学环境')} onClose={()=>{if(!flight.current)setOpen(false);}} closeDisabled={busy}>
   <form data-testid="ssh-scheduler-setup" onSubmit={event=>{event.preventDefault();void save();}}>
    <h4>{t('当前作业服务的调度器与科学环境')}</h4>
    <p>{t('此操作仅保存调度器和环境配置，不提交作业。')}</p>
    {!currentResource&&<p role="status">{t('请先明确选择此基础连接并连接其作业服务，再配置队列；后台服务不会自动切换。')}</p>}
    <fieldset disabled={busy||profileLoading||!currentResource}>
     <label>{t('保存已有配置')}<select data-testid="ssh-scheduler-profile" value={draft.id||''} onChange={event=>select(event.target.value)}>
      <option value="">{t('新调度器配置')}</option>
      {profiles.map(value=><option key={value.id} value={value.id}>{value.name} · v{value.version}</option>)}
     </select></label>
     {draft.id&&selectedRecord.current?.id===draft.id&&<p>{t('调度器登记 ID')} <code data-testid="ssh-scheduler-registered-id">{draft.id}</code></p>}
     <label>{t('名称')}<input data-testid="ssh-scheduler-name" value={draft.name} onChange={event=>patch({name:event.target.value})}/></label>
     <label>{t('调度器')}<select data-testid="ssh-scheduler-kind" value={draft.scheduler} onChange={event=>patch({scheduler:event.target.value as Draft['scheduler']})}>
      <option value="">{t('请选择调度器')}</option><option value="slurm">Slurm</option><option value="lsf">LSF</option>
     </select></label>
     <label>{t('Python 可执行文件')}<input data-testid="ssh-scheduler-python" value={draft.python} onChange={event=>patch({python:event.target.value})}/></label>
     {draft.executables.map((row,index)=><div className="form-row" key={index}>
      <label>{t('可执行文件名称')}<input value={row.name} onChange={event=>patch({executables:draft.executables.map((value,i)=>i===index?{...value,name:event.target.value}:value)})}/></label>
      <label>{t('可执行文件绝对路径')}<input value={row.path} onChange={event=>patch({executables:draft.executables.map((value,i)=>i===index?{...value,path:event.target.value}:value)})}/></label>
      <button type="button" className="button" onClick={()=>patch({executables:draft.executables.filter((_,i)=>i!==index)})}>{t('删除可执行文件')}</button>
     </div>)}
     <button type="button" className="button" onClick={()=>patch({executables:[...draft.executables,{name:'',path:''}]})}>{t('添加可执行文件')}</button>
     <label>{t('远程运行根目录')}<input data-testid="ssh-scheduler-root" value={draft.root} onChange={event=>patch({root:event.target.value})}/></label>
     <label>{t('只读输入根目录 · 每行一个')}<textarea value={draft.readRoots} onChange={event=>patch({readRoots:event.target.value})}/></label>
     {workfile&&!draft.id&&<button type="button" className="button" data-testid="ssh-scheduler-use-workfile"
      onClick={()=>patch({root:workfile,readRoots:[...new Set([workfile,...draft.readRoots.split('\n').filter(value=>value.trim())])].join('\n')})}>{t('使用此资源的 workfile 目录')}</button>}
     <div className="form-row">{(['cpus','gpus','memory'] as const).map(key=><label key={key}>{key==='cpus'?'CPU':key==='gpus'?'GPU':t('内存')+' MiB'}<input type="number" min={key==='gpus'?0:1} value={draft[key]} onChange={event=>patch({[key]:event.target.value})}/></label>)}</div>
     <label>{t('队列 / 分区')}<input value={draft.queue} onChange={event=>patch({queue:event.target.value})}/></label>
     {!draft.queue&&!selectedRecord.current?.queue_targets&&<small className="muted">{t('要通过此调度器运行最小测试，请填写队列或分区。')}</small>}
     <label>{t('Modules / 虚拟环境初始化 · Bash')}<textarea value={draft.activation} onChange={event=>patch({activation:event.target.value})}/></label>
    </fieldset>
    <LoadingFeedback busy={busy||profileLoading} label={t(busy?'正在保存调度器配置…':'正在读取连接配置…')}/>
    {message&&<p role="status">{message}</p>}
    <div className="button-row">
     <button type="button" className="button" disabled={busy||!currentResource} onClick={()=>void refresh()}>{t('刷新')}</button>
     <button className="button primary" data-testid="ssh-scheduler-save" disabled={busy||profileLoading||!currentResource||!loaded||uncertain||!!draft.id&&!selectedRecord.current} type="submit">{t('保存调度器配置')}</button>
    </div>
   </form>
  </Modal>}
 </>;
}
