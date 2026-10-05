export const tools=[
 {id:'md',name:'分子动力学引擎',description:'PyDyn 与 GPUMD / GPU-Sampling；传统 MD 和 pyGAS 增强采样。NEB 属于待接入能力。',engines:['pydyn.md','gpumd.md','pydyn.sampling','gpumd.sampling'],status:'partial',capabilities:['MD','增强采样','NEB（待接入）'],page:'runs'},
 {id:'training',name:'力场训练器',description:'HotPP、TorchNEP、GPUMD 原生 NEP；数据审计、训练、独立评估和部署。',engines:['hotpp.train','hotpp.eval','hotpp.export','nep.train','nep.eval','nep.analyze'],status:'partial',capabilities:['HotPP','NEP','TorchNEP（待接入）'],page:'training'},
 {id:'activelearning',name:'主动学习',description:'NEPMaker → NEP；ActiveMiao → HotPP。探索、选帧、DFT 复核、复训形成闭环。',engines:[],status:'planned',capabilities:['NEPMaker（待接入）','ActiveMiao（待接入）'],page:'activelearning'},
 {id:'pygas',name:'pyGAS 插件',description:'独立 pyGAS 与 PyDyn 内置 pyGAS 分别注册版本。定义 CV、偏置、轨迹分析和自由能重建。',engines:['pygas.build','bias.validate','pygas.reweight','pygas.opes-reweight'],status:'partial',capabilities:['CV / Bias','WTMetaD / OPES 重加权','目标环境验证'],page:'bias'},
 {id:'assets',name:'数据资产与请求',description:'结构、轨迹、训练数据、模型、Bias 和待 DFT 复核构型；向计算或分析模块提出请求。',engines:[],status:'partial',capabilities:['资产登记 / 哈希','来源追踪','跨模块请求草稿'],page:'assets'},
 {id:'viewer',name:'结构与轨迹 Viewer',description:'现有 Three.js 分帧预览；OVITO 开源集成、结构拼接和高级编辑待实现。',engines:[],status:'partial',capabilities:['结构 / 轨迹预览','OVITO（待接入）'],page:'assets'},
 {id:'queue',name:'队列与任务监视',description:'WSL 本机持久化队列和进程监视；SSH 文件与终端已接入，集群作业调度待接入。',engines:[],status:'partial',capabilities:['本机 GPU 队列','日志 / 取消 / 恢复','集群调度（待接入）'],page:'runs'}
];
const step=(id,title,tool,required=true,description='',planned=false)=>({id,title,tool,required,description,planned});
const assets=step('assets','结果资产与来源登记','assets');
const analysis=step('analysis','CV、轨迹和自由能分析','pygas',false,'按方法适用条件设置分析与重加权。');
const submit=step('submit','短试运行与正式提交','queue',true,'每次运行先准备草稿，再由用户审阅、验证与执行。');
const model=step('model','力场准备或导入','training',true,'可提供现成模型，或使用训练器制作。');
const structure=step('structure','初始结构导入与检查','viewer',true,'可直接提供结构；拼接和高级编辑尚待接入。');
const learning=step('learning','主动学习补充力场','activelearning',false,'NEPMaker / ActiveMiao；外部 DFT 托管尚待接入。',true);
export const tasks=[
 {id:'sampling',title:'增强采样模拟',summary:'模型与结构 → MD 引擎 → CV / Bias → 审阅试运行 → 采样 → 分析',tools:['md','training','activelearning','pygas','assets','viewer','queue'],steps:[model,learning,structure,step('md','MD 引擎与参数','md'),step('bias','CV 与增强采样参数','pygas'),submit,assets,analysis]},
 {id:'md',title:'分子动力学模拟',summary:'导入力场与结构，设置动力学参数，托管轨迹和热力学结果。',tools:['md','training','activelearning','assets','viewer','queue'],steps:[model,learning,structure,step('md','MD 引擎与参数','md'),submit,assets]},
 {id:'training',title:'力场训练与测试',summary:'数据集 → 标签与划分审计 → 训练 → 独立评估 → 模型导出',tools:['training','assets','queue','md'],steps:[step('dataset','数据集导入与标签审计','assets'),step('train','训练器与训练参数','training'),step('evaluate','独立测试集评估','training'),step('export','模型导出与消费端验证','training'),submit,assets]},
 {id:'learning',title:'主动学习力场',summary:'已有势 → MD 探索 → 选帧 → DFT 请求 → 标签回收 → 复训',tools:['activelearning','md','training','assets','viewer','queue'],steps:[model,structure,step('explore','MD 主动探索','md'),step('select','不确定性评估与选帧','activelearning',true,'选择 NEPMaker 或 ActiveMiao。',true),step('dft','DFT 复核请求与标签回收','assets',true,'外部 DFT 托管模块尚待接入。',true),step('retrain','回收标签后复训','training'),submit,assets]},
 {id:'analysis',title:'轨迹与自由能分析',summary:'已有 MD / 采样结果 → CV 分析或重加权 → 图表、FES 与数据资产',tools:['pygas','assets','viewer','queue'],steps:[step('input','输入轨迹、CV 与历史资产','assets'),step('method','分析方法与适用条件','pygas'),step('preview','结构和轨迹预览','viewer',false),submit,assets]},
 {id:'neb',title:'NEB 路径模拟',summary:'初末态结构 → 势模型 → PyDyn / GPUMD → 路径与能垒分析（待接入）',tools:['md','training','assets','viewer','queue'],steps:[model,step('endpoints','初末态结构与原子映射','viewer'),step('neb','NEB 引擎与路径参数','md',true,'两条引擎路线的 NEB 适配器均尚待接入。',true),submit,assets]},
 {id:'request',title:'数据处理与复算请求',summary:'选择来源资产和目标模块，记录处理需求与期望产物；DFT 托管待接入。',tools:['assets','pygas','training','md','queue'],steps:[step('input','来源资产与构型集合','assets'),step('target','目标模块和处理契约','assets'),step('process','计算或分析参数','pygas'),submit,assets]}
];
export function createPlan(taskId){
 const task=tasks.find(t=>t.id===taskId);if(!task)throw Error('Unknown task');
 return {taskId,name:task.title,notes:'',steps:task.steps.map(s=>({id:s.id,enabled:s.required,source:'agent',value:''}))};
}
export function validatePlan(value){
 const task=tasks.find(t=>t.id===value?.taskId);if(!task)throw Error('Unknown task');
 if(typeof value.name!=='string'||!value.name.trim()||value.name.length>200||typeof value.notes!=='string'||value.notes.length>10000)throw Error('Invalid plan text');
 if(!Array.isArray(value.steps)||value.steps.length!==task.steps.length)throw Error('Invalid steps');
 const steps=task.steps.map(s=>{
  const entries=value.steps.filter(v=>v.id===s.id);if(entries.length!==1)throw Error('Duplicate or missing step');
  const item=entries[0];
  if(typeof item.enabled!=='boolean'||s.required&&!item.enabled||!['agent','user'].includes(item.source)||typeof item.value!=='string'||item.value.length>10000)throw Error('Invalid step');
  return {id:s.id,enabled:item.enabled,source:item.source,value:item.value};
 });
 return {taskId:task.id,name:value.name,notes:value.notes,steps};
}
export function planPrompt(value){
 const plan=validatePlan(value),task=tasks.find(t=>t.id===plan.taskId);
 return '为以下任务准备可审阅的流程与各模块计算草稿。核心步骤不可省略，辅助步骤仅按启用状态安排。用户已提供的输入先审计，不要重新生成。缺少科学条件时先询问；尚未接入的工具明确标为 blocked，禁止声称完成。仅使用 gpusampling MCP 创建草稿，停止等待我在任务页审阅并点击执行。\n'+JSON.stringify({...plan,workflowId:value.id||null,tools:task.tools.map(id=>tools.find(t=>t.id===id)),steps:plan.steps.map(s=>({...task.steps.find(t=>t.id===s.id),...s}))},null,2);
}
