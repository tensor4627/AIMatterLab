import {SoftwareUpdate,useWorkspaceUpdate} from "./SoftwareUpdate";
import product from "../../../contracts/product.json";
import {MaterialsProjectSettings} from "../assets/MaterialsProject";
import {useEffect,useRef,useState} from 'react';
import {PanelsTopLeft,Palette,Languages,Brain,Server,BookOpen,Save,RefreshCw} from 'lucide-react';
import {invoke} from '../../api/studio';
import {type Settings} from '../../../contracts/dto/settings';
import {t,setLanguage} from "../../ui/i18n";
const categories=[['appearance','外观',Palette],['layout','工作区布局',PanelsTopLeft],['language','语言',Languages],['agent','Agent',Brain],['connections','计算连接',Server],['permissions','计算权限',Server],['science','科学资源与技能',BookOpen],['data','数据源',Server],['updates','软件更新',RefreshCw]] as const;
const num=(value:string)=>value===''?undefined:Number(value);
// Keep the raw edit text until blur so clearing does not reinsert a display default.
function FontNumberInput({value,min,max,onChange,testId}:{value:number;min:number;max:number;onChange:(value:number|undefined)=>void;testId?:string}){
 const [draft,setDraft]=useState<string|null>(null);
 return <input data-testid={testId} type="number" min={min} max={max} value={draft??value} onFocus={()=>setDraft(String(value))} onChange={event=>{setDraft(event.target.value);onChange(num(event.target.value));}} onBlur={()=>setDraft(null)}/>;
}
function fit(value:number|undefined,min:number,max:number){return typeof value==='number'&&Number.isFinite(value)?Math.min(max,Math.max(min,value)):undefined;}
export default function SettingsPage({updates,settings,onChange,onClose,onSaved,onSavingChange,onError,onOpenSkills,onOpenComputeResources,onOpenLocalCompute,onOpenSshCompute,onOpenProjects}:{updates?:ReturnType<typeof useWorkspaceUpdate>;onOpenComputeResources?:()=>void;onOpenLocalCompute?:()=>void;onOpenSshCompute?:()=>void;onOpenProjects?:()=>void;onOpenSkills?:()=>void;settings:Settings;onChange:(s:Settings)=>void;onClose:()=>void;onSaved?:(s:Settings)=>void;onSavingChange?:(saving:boolean)=>void;onError:(e:unknown)=>void}){
 const [category,setCategory]=useState('appearance'),[saving,setSaving]=useState(false),[saved,setSaved]=useState('');
 const savedSettings=useRef(settings);
 const dirty=JSON.stringify(settings)!==JSON.stringify(savedSettings.current);
 const mounted=useRef(false),saveSequence=useRef(0),savingRef=useRef(false),revision=useRef(0),settingsRef=useRef(settings);settingsRef.current=settings;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;saveSequence.current++;};},[]);
 function patch(changes:Partial<Settings>){revision.current++;if(changes.language)setLanguage(changes.language);onChange({...settings,...changes});setSaved('');}
 async function save(){
  if(savingRef.current)return;
  if(!Number.isInteger(settings.workerPort)||settings.workerPort<1024||settings.workerPort>65535){onError(new Error('workerPort must be an integer from 1024 to 65535'));return;}
  if(settings.terminalIdleMinutes!==undefined&&(!Number.isInteger(settings.terminalIdleMinutes)||settings.terminalIdleMinutes<1||settings.terminalIdleMinutes>1440)){onError(new Error(t('终端空闲时长须为 1 到 1440 分钟。')));return;}
  const next:Settings={...settings,fontSize:fit(settings.fontSize,12,24),editorFontSize:fit(settings.editorFontSize,10,28),terminalFontSize:fit(settings.terminalFontSize,10,24),minimumFontSize:fit(settings.minimumFontSize,11,18),chatFontSize:fit(settings.chatFontSize,12,28)};
  const sequence=++saveSequence.current,submittedRevision=revision.current,submittedSettings=settings;
  savingRef.current=true;onSavingChange?.(true);setSaving(true);try{const result=await invoke<Settings>('settings',next);if(!mounted.current||sequence!==saveSequence.current)return;savedSettings.current=result;onSaved?.(result);if(revision.current!==submittedRevision||settingsRef.current!==submittedSettings){setSaved(t('未保存修改'));return;}onChange(result);setSaved(t('设置已保存'));}catch(e){if(mounted.current&&sequence===saveSequence.current)onError(e);}finally{savingRef.current=false;if(mounted.current&&sequence===saveSequence.current){onSavingChange?.(false);setSaving(false);}}
 }
 return <div className="settings-layout"><nav className="settings-nav">{categories.map(([id,label,Icon])=><button key={id} className={category===id?'active':''} aria-current={category===id?'page':undefined} onClick={()=>setCategory(id)}><Icon size={17}/>{t(label)}</button>)}</nav><div className="settings-content">
  <div className="settings-heading"><h2>{t(categories.find(c=>c[0]===category)?.[1]||'设置')}</h2>{category!=='updates'&&<p>{t('按工作习惯配置你的工作台。')}</p>}</div>
  {category==='updates'&&updates&&<SoftwareUpdate {...updates}/>}
  {category==='appearance'&&<>
   <label>{t('作业徽记动效')}<select aria-label={t('作业徽记动效')} value={settings.resourceBadgeMotion||'wave'} onChange={e=>patch({resourceBadgeMotion:e.target.value as Settings['resourceBadgeMotion']})}><option value="wave">{t('从左到右的波浪')}</option><option value="breathe">{t('呼吸式明暗')}</option></select></label>
   <label>{t('主题')}<select value={settings.theme} onChange={e=>patch({theme:e.target.value})}><option value="dark">{t('深色石墨')}</option><option value="light">{t('浅色')}</option></select></label>
   <label>{t('界面字体')}<select value={settings.fontFamily||'system'} onChange={e=>patch({fontFamily:e.target.value})}><option value="system">{t('系统默认')}</option><option value="sans">Segoe UI / Microsoft YaHei</option><option value="serif">Georgia / SimSun</option></select></label>
   <label>{t('界面字号')}<FontNumberInput min={12} max={24} value={settings.fontSize??18} onChange={value=>patch({fontSize:value})}/><small>12–24 px</small></label>
   <div className="form-row"><label>{t('代码字号')}<FontNumberInput min={10} max={28} value={settings.editorFontSize??18} onChange={value=>patch({editorFontSize:value})}/></label><label>{t('终端字号')}<FontNumberInput min={10} max={24} value={settings.terminalFontSize??17} onChange={value=>patch({terminalFontSize:value})}/></label></div>
   <div className="form-row"><label>{t('最小文字字号')}<FontNumberInput testId="minimum-font" min={11} max={18} value={settings.minimumFontSize??17} onChange={value=>patch({minimumFontSize:value})}/><small>{t('界面、代码、终端与图表文字均遵守此下限')}</small></label><label>{t('Agent 对话字号')}<FontNumberInput min={12} max={28} value={settings.chatFontSize??settings.fontSize??18} onChange={value=>patch({chatFontSize:value})}/></label></div><div className="font-preview">{t('字体预览')} · {product.name}<br/>α · CV · Å · 300 K</div><p className="muted">{t('外观修改立即预览；取消将恢复上次保存的设置。')}</p>
  </>}
  {category==='layout'&&<><label>{t('Agent 与任务面板')}<select data-testid="agent-layout" value={settings.agentLayout||'right'} onChange={e=>patch({agentLayout:e.target.value as 'right'|'center'})}><option value="right">{t('任务在中间 · Agent 在右侧')}</option><option value="center">{t('Agent 在中间大窗 · 任务在右侧')}</option></select></label><div className={'layout-preview '+(settings.agentLayout==='center'?'center':'')}><span>{t('工具')}</span><span>{t(settings.agentLayout==='center'?'Agent 对话':'任务选项卡')}</span><span>{t(settings.agentLayout==='center'?'任务选项卡':'Agent 对话')}</span></div><p>{t('布局切换保留当前对话和任务选项卡，保存后下次启动继续使用。')}</p></>}
  {category==='language'&&<><label>{t('界面语言')}<select value={settings.language||'zh-CN'} onChange={e=>patch({language:e.target.value as Settings['language']})}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label><p className="muted">{t('界面语言立即切换。用户内容、科学文件与引擎日志保留原文。')}</p></>}
  {category==='agent'&&<><div className="notice">{t('普通聊天可在项目授权范围内提交你明确委托的独立作业。多步工作流可在参数面板审阅和执行。')}</div><p>{t('模型和 reasoning effort 在右侧对话面板选择。上下文预算与压缩阈值在那里应用，保留当前会话。')}</p><details className="settings-advanced"><summary>{t('服务商高级配置')}</summary><label>{t('Codex 可执行路径')}<input value={settings.codexPath} onChange={e=>patch({codexPath:e.target.value})}/></label><label>{t('Kimi 可执行路径')}<input value={settings.kimiPath??'kimi'} onChange={e=>patch({kimiPath:e.target.value})}/></label><label>{t('Qwen 可执行路径')}<input value={settings.qwenPath??'qwen'} onChange={e=>patch({qwenPath:e.target.value})}/></label><p className="muted">{t('Kimi 使用本地 CLI 和设备登录。当前 Qwen 使用「账号与 API」中的 API 配置。')}</p><div className="notice">{t('在「账号与 API」配置 DeepSeek 的开放平台密钥。AIMatterLab 已附带 DSH 运行环境。')}</div><label>{t('Agent 工作目录')}<input value={settings.cwd} onChange={e=>patch({cwd:e.target.value})}/></label></details></>}
  {category==='permissions'&&<><p className="muted">{t('管理计算项目可用的资源与运行限额。')}</p><button className="button" data-testid="settings-project-management" disabled={saving||!onOpenProjects} onClick={onOpenProjects}>{t('计算项目')}</button></>}
  {category==='connections'&&<><label>{t('会话终端空闲时长（分钟）')}<input data-testid="terminal-idle-minutes" type="number" min={1} max={1440} step={1} value={settings.terminalIdleMinutes??60} onChange={e=>patch({terminalIdleMinutes:e.target.valueAsNumber})}/></label><button className="button primary" data-testid="settings-connect-resources" disabled={saving||!onOpenComputeResources} onClick={onOpenComputeResources}>{t('管理计算资源')}</button><details className="settings-advanced"><summary>{t('默认本地服务与已有集群')}</summary><div className="button-row"><button className="button" data-testid="settings-connect-local" disabled={saving||!onOpenLocalCompute} onClick={onOpenLocalCompute}>{t('本地 WSL')}</button><button className="button" data-testid="settings-connect-ssh" disabled={saving||!onOpenSshCompute} onClick={onOpenSshCompute}>{t('SSH 手动配置')}</button></div><label className="check-label"><input type="checkbox" checked={settings.autoDiscoverCompute!==false} onChange={e=>patch({autoDiscoverCompute:e.target.checked})}/>{t('连接时自动发现并登记已有本地环境')}</label><p className="muted">{t('复用现有解释器与源码，记录 CUDA 观察结果；不安装软件、不更改项目授权或提交任务。')}</p><label>{t('WSL 发行版')}<input value={settings.distribution} onChange={e=>patch({distribution:e.target.value})}/></label><details className="settings-advanced"><summary>{t('作业服务高级配置')}</summary><label>{t('作业服务目录')}<input value={settings.workerRoot} onChange={e=>patch({workerRoot:e.target.value})}/></label><label>{t('作业服务端口')}<input type="number" min={1024} max={65535} value={settings.workerPort} onChange={e=>patch({workerPort:Number(e.target.value)})}/></label><p className="muted">{t('保存后重新连接 WSL 以应用设置。引擎路径在计算环境中登记。')}</p></details></details></>}
  {category==='data'&&<MaterialsProjectSettings onError={onError}/>}
  {category==='science'&&<>
   <label>{t('本地用户缓存目录')}<div className="input-with-button">
    <input data-testid="user-cache-directory" value={settings.userCacheDirectory??''} placeholder={t('使用默认目录')} onChange={e=>patch({userCacheDirectory:e.target.value})}/>
    <button className="button" disabled={saving} onClick={()=>void invoke<string|null>('file.choose',{directory:true}).then(dir=>{if(dir&&mounted.current)patch({userCacheDirectory:dir});}).catch(onError)}>{t('选择目录')}</button>
   </div></label>
   <p className="muted">{t('Agent 在这里读写本地技能。更换目录会复制已有技能，保留原件。')}</p>
   <button className="button" onClick={onOpenSkills} disabled={saving||!onOpenSkills}>{t('打开科学资源与技能')}</button>
  </>}
  <div className="settings-footer"><span role="status">{saved||t(dirty?'未保存修改':'')}</span><button className="button" disabled={saving} onClick={onClose}>{t('取消')}</button><button className="button primary" disabled={saving} onClick={()=>void save()}><Save size={15}/>{saving?t('保存中…'):t('保存设置')}</button></div>
 </div></div>;
}
