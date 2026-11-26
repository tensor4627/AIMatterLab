import {createHash} from 'node:crypto';
import {createReleaseToolMatcher} from '../../contracts/tools/release-tool-sources.mjs';
import {readReleaseToolSources} from './release-tool-catalog.mjs';
const ENGINE_ROUTES={'trajectory.density':'analysis.number-density','pydyn.md':'md.pydyn','gpumd.md':'md.gpumd','pydyn.sampling':'sampling.pydyn','gpumd.sampling':'sampling.gpumd','gpumd.neb':'neb.gpumd','pygas.build':'pygas.bias','bias.validate':'pygas.contract','nep.train':'training.nep','nep.eval':'training.nep','nep.analyze':'training.nep','hotpp.train':'training.hotpp','hotpp.eval':'training.hotpp','hotpp.export':'training.hotpp','pygas.reweight':'analysis.wtmetad','pygas.opes-reweight':'analysis.opes'};
let fallbackReleaseToolMatcher;
function defaultReleaseToolMatcher(){
 if(!fallbackReleaseToolMatcher){
  try{fallbackReleaseToolMatcher=createReleaseToolMatcher(readReleaseToolSources());}
  catch{fallbackReleaseToolMatcher=createReleaseToolMatcher([]);}
 }
 return fallbackReleaseToolMatcher;
}
function requestsSoftwareCatalog(text,releaseTool){
 const inventory=/(?:支持|接入|有哪些|哪些|列出|查看).{0,12}(?:科学工具|工具包|工具目录)|(?:科学工具|工具包|软件)目录|(?:available|supported|list|catalog of) (?:scientific tools|software packages)/i;
 if(inventory.test(text))return true;
 if(!releaseTool)return false;
 // Match a lookup about the tool itself. A question about a simulation's inputs
 // or results still belongs to the workflow that produced them.
 const subject=releaseTool.text;
 const directLookup=/(?:查一下|查查|查找|查阅|查询|介绍|了解|看看|搜一下|检索)\s*@\s*(?:[。？！?！.]?$|(?:并|再|然后|顺便).{0,10}(?:安装|配置|搭建|验证|接入|登记))/.test(subject)
  || /(?:what is|look up|tell me about|find the (?:docs|manual) for)\s+@\s*[?!.]?$|@\s*(?:是什么|有什么用途|能做什么)/i.test(subject);
 const sourceOrSetup=/(?:安装|配置|搭建|接入|登记)(?:并|与|和)?(?:验证|测试)?\s*(?:一下|好)?\s*@/.test(subject)
  || /(?:where to find|how to install|install|set up)(?:\s+and\s+(?:verify|test))?\s+(?:the\s+)?@/i.test(subject)
  || /@\s*(?:的|怎么|如何)?\s*(?:安装(?:与验证|和验证|并验证)?|源码|官方文档|仓库|手册|工具包|文档入口|repository|source code|documentation|installation guide)/i.test(subject);
 const versionLookup=/(?:^\s*(?:请问\s*)?|(?:查(?:一下|查|找|看|阅|询)?|了解|看看|搜一下|检索)\s*(?:(?:最新|最近|当前|稳定)的?\s*)?)@\s*(?:的\s*)?(?:(?:最新|最近|当前|稳定)的?\s*)?版本(?:号)?\s*(?:是(?:什么|多少|哪个)|多少)?\s*[。？！?！.]?$/.test(subject)
  || /(?:^\s*|\b(?:what(?: is|'s)?|which|check|look up|find|query)\s+(?:the\s+)?)(?:(?:latest|current|stable)\s+)?(?:release|version)\s+(?:of|for)\s+@\s*[?!.]?$/i.test(subject)
  || /\b(?:check|look up|find)\s+@(?:'s)?\s+(?:(?:latest|current|stable)\s+)?(?:release|version)\s*[?!.]?$/i.test(subject);
 return directLookup||sourceOrSetup||versionLookup;
}
const localToolMention=/(?:本地|本机|自研|自己的|我的|用户提供).{0,14}(?:工具|脚本|程序)|\b(?:local|own|custom|user-provided|third-party)\s+(?:tool|script|program)\b/i;
function requestsToolOnboarding(text){
 const define=/(?:打包|接入|登记|注册|起草|编写|制作|生成)|\b(?:register|onboard|package|draft|define)\b/i;
 return define.test(text)&&(localToolMention.test(text)||/\btool\.json\b|(?:登记|注册|打包|起草|制作|生成)(?:一个|这个|现有|第三方|本地|新的)*工具包/.test(text));
}
export function selectScientificFunctions({text='',parameters={},hasWorkflow=false,planRoadmap=false,manualFunction,matchReleaseTool=defaultReleaseToolMatcher()}={}){
 const value=String(text),engine=parameters.engine;let id;
 const releaseTool=matchReleaseTool(value);
 const consumerIntent=/分子动力学|\bmd\b|metad|opes|增强采样/i.test(value);
 const dynamicsIntent=/\b(?:md|nve|nvt|npt|metad|opes)\b|wtmetad|分子动力学|增强采样|偏置模拟|积分|沉积/i.test(value);
 const excludesDynamics=/(?:不|无需|不要)(?:运行|进行|做|启动)?\s*(?:MD|分子动力学|积分)|\b(?:no|without|do not)\s+(?:run(?:ning)?\s+)?(?:MD|molecular dynamics)\b/i.test(value);
 const cvOnlyIntent=/(?:仅|只)(?:计算|生成|定义|评估)?\s*(?:CV|集体变量)|\bcv[\s_-]*only\b|\bonly\s+(?:(?:compute|calculate|evaluate)\s+)?(?:the\s+)?(?:cvs?|collective\s+variables?)\b/i.test(value);
 const primaryTraining=/(?:^|[。！!？?;\n])\s*(?:(?:请|帮我|现在|接下来|先|首先|然后|随后|please\s+|next\s+|now\s+|first\s+|then\s+)\s*)*(?:训练|导出|评估|train\b|export\b|freeze\b|eval\b)/i.test(value);
 const resourceMention=/集群|计算资源|服务器|\b(?:cluster|compute resource|HPC)\b/i.test(value);
 const namedInstallation=[...value.matchAll(/(?:(?:安装|配置|搭建|部署)(?:(?:并|与|和)?(?:验证|测试))?\s*(?:一下\s*)?|\b(?:install|configure|set up|deploy)(?:\s+and\s+(?:verify|test))?\s+(?:(?:the|an?)\s+)?)([a-z][\w+.-]*)/gi)]
  .some(([,name])=>!/^(?:ssh|slurm|lsf|pbs|sge|gpus?|cpus?|queues?|clusters?)(?:$|[_.+-])/i.test(name));
 const localTool=localToolMention.test(value);
 const setupIntent=/安装|配置|搭建|部署|接入|最小测试|\b(?:install|configure|set up|deploy|adopt|smoke test)\b/i.test(value);
 const targetToolSetup=resourceMention&&(namedInstallation||(releaseTool||localTool)&&setupIntent||localTool&&/采用/.test(value));
 const materialsSource=/materials[ -]?project|\bmp-[0-9]+\b/i.test(value);
 const requestsLookup=/(?<!已|已经|不|不要|无需|不用)(?:导入|搜索|查询|查找|检索|获取|下载)(?!的|过)|\b(?:import|search|find|fetch|retrieve|download|query|look up)\b/i.test(value);
 const requestsStructure=/(?<!已|已经|不|不要|无需|不用)(?:生成|构建|创建)(?!的|过)[^，。！？\n]{0,32}(?:结构|晶胞|超胞|晶体|分子(?!动力学)|表面)|\b(?:build|create|generate|make)\b[^.!?,;\n]{0,64}\b(?:structures?|cells?|crystals?|supercells?|surfaces?|slabs?|molecules?)\b/i.test(value);
 const serviceRepair=/(?:修复|配置|安装|准备)\s*(?:远端)?作业服务|作业服务.{0,12}(?:缺少|修复|Python 环境)|\b(?:repair|configure|install)\s+(?:the\s+)?job service\b/i.test(value);
 if(manualFunction!==undefined&&typeof manualFunction!=='string')throw Error('Invalid selected scientific function');
 // Present intent takes priority over the previous run: analysis never loads the build/install stack.
 if(manualFunction)id=manualFunction;
 else if(serviceRepair)id='cluster.connection-setup';
 else if(targetToolSetup)id='cluster.resource-tools';
 else if(requestsToolOnboarding(value))id='tool.onboarding';
 else if(/list_resource_tools|plan_resource_tool_setup|discover_resource_tool_scripts|(?:安装|配置|接入|复用|登记).{0,12}(?:集群工具|新工具|已有脚本|第三方软件|自定义工具|工具环境)|(?:工具|软件).{0,10}(?:接入|最小测试)|(?:set up|configure|install|adopt|onboard).{0,20}(?:cluster tool|resource tool|third.party software|existing scripts?)/i.test(value))id='cluster.resource-tools';
 else if(requestsSoftwareCatalog(value,releaseTool))id='software.catalog';
 else if(/(?:基础|默认|初始化|设置|选择|创建).*工作区|工作区.*(?:灰|设置|配置|不可用)|(?:base|default|setup|initialize).*workspace/i.test(value))id='cluster.workspace-setup';
 else if(/(?:reweight|重加权)/i.test(value))id=/opes/i.test(value)?'analysis.opes':'analysis.wtmetad';
 else if(/trajectory\.density|(?:轨迹|trajectory|frames?).*(?:原子数密度|number density)|(?:原子数密度|number density).*(?:轨迹|trajectory|frames?)/i.test(value))id='analysis.number-density';
 else if(/(?:分析轨迹|轨迹分析|analy[sz]e.*traject|trajectory.*analy)/i.test(value))id='analysis.trajectory';
 else if(/(?:monitor|监测|监控).*?(?:cv|pygas)|(?:cv|pygas).*?(?:monitor|监测)/i.test(value))id='pygas.monitor';
 else if(/(?:自定义|custom|missing|不存在).*?cv|cv.*?(?:自定义|custom|不存在)/i.test(value))id='pygas.custom-cv';
 else if(/\bneb\b|最小能量路径/i.test(value))id=/gpumd|gpu.?sampling/i.test(value)?'neb.gpumd':/pydyn/i.test(value)||String(engine).startsWith('pydyn.')?'neb.pydyn':'neb.gpumd';
 else if((/(?:训练|train|导出|export|freeze)/i.test(value)||/(?:测试|eval|评估)/i.test(value)&&!/(?:分子动力学|\bmd\b|metad|opes|增强采样)/i.test(value))&&(!consumerIntent||primaryTraining)&&/hotpp|torchnep|nepmaker|activemiao|\bnep\b/i.test(value))id=/torchnep/i.test(value)?'training.torchnep':/nepmaker/i.test(value)?'learning.nepmaker':/activemiao/i.test(value)?'learning.activemiao':/hotpp/i.test(value)?'training.hotpp':'training.nep';
 else if(cvOnlyIntent&&(!dynamicsIntent||excludesDynamics))id='pygas.cv';
 else if(/metad|opes|umbrella|增强采样|偏置模拟/i.test(value))id=/pydyn/i.test(value)?'sampling.pydyn':/gpumd|gpu.?sampling/i.test(value)?'sampling.gpumd':String(engine).startsWith('pydyn.')?'sampling.pydyn':String(engine).startsWith('gpumd.')?'sampling.gpumd':'pygas.bias';
 else if(materialsSource&&requestsLookup)id='structure.materials-project';
 else if(requestsStructure)id='structure.ase';
 else if(/分子动力学|\bmd\b/i.test(value)&&/gpumd|pydyn/i.test(value))id=/gpumd/i.test(value)?'md.gpumd':'md.pydyn';
 else if(releaseTool?.source?.integration_status==='source_only'&&releaseTool.source.guidance_functions?.[0]==='software.catalog')id='software.catalog';
 else if(ENGINE_ROUTES[engine])id=ENGINE_ROUTES[engine];
 else if(/\bneb\b|最小能量路径/i.test(value))id=/pydyn/i.test(value)?'neb.pydyn':'neb.gpumd';
 else if(/hotpp/i.test(value))id='training.hotpp';
 else if(/torchnep/i.test(value))id='training.torchnep';
 else if(/nepmaker/i.test(value))id='learning.nepmaker';
 else if(/activemiao/i.test(value))id='learning.activemiao';
 else if(/\bnep\b/i.test(value))id='training.nep';
 else if(/pygas|metad|opes|umbrella|增强采样|偏置|\bcvs?\b/i.test(value))id=/pydyn/i.test(value)?'sampling.pydyn':/gpumd|gpu.?sampling/i.test(value)?'sampling.gpumd':'pygas.bias';
 else if(/pydyn/i.test(value))id='md.pydyn';
 else if(/gpumd/i.test(value))id='md.gpumd';
 else if(materialsSource)id='structure.materials-project';
 else if(/\base\b|生成.*结构|构建.*结构/i.test(value))id='structure.ase';
 const roadmap=hasWorkflow&&!manualFunction&&(planRoadmap||/流程图|输入输出规划|流程总览|计算路线图|workflow (?:roadmap|diagram)|artifact handoffs/i.test(value));
 return [...new Set([...(hasWorkflow?['workflow.orchestrate']:[]),...(roadmap?['workflow.roadmap']:[]),...id?[id]:[]])];
}
export class ScientificSkillContext{
 constructor(router,releaseToolSources){
  this.router=router;this.accepted=new Map();
  this.matchReleaseTool=releaseToolSources===undefined?defaultReleaseToolMatcher():createReleaseToolMatcher(releaseToolSources);
 }
 forget(key){for(const cached of this.accepted.keys())if(cached.endsWith('\0'+key))this.accepted.delete(cached);}
 async prepare(key,provider,options){
  let functions=selectScientificFunctions({...options,matchReleaseTool:this.matchReleaseTool});const policy=options.policy,fallback=policy&&policy.state!=='legacy_unconfigured'&&policy.facts?.package&&options.manualFunction===undefined&&!policy.hasReadGrant()&&functions.every(id=>id==='workflow.orchestrate'||id==='workflow.roadmap');
  // Non-legacy authority is supplied only for an actually bound configuration, including ordinary chats.
  // With no domain intent, its self-contained receipt replaces the optional generic workflow guide.
  if(fallback)functions=['@execution:'+policy.facts.package.id,...functions.filter(id=>id==='workflow.roadmap')];
  const managed=fallback||policy&&functions.some(id=>policy.appliesTo(this.router.routes?.get(id)||{id})),receipts=[];
  for(const id of functions){if(fallback&&id.startsWith('@execution:')){await policy.revalidate();receipts.push(policy.executionResult(id));await policy.revalidate();}else receipts.push(await this.router.read(provider,id,undefined,{scope:options.scope||{provider},policy}));}
  const blocked=receipts.filter(r=>r.status!=='passed');
  if(blocked.length)return {status:blocked.some(r=>r.status==='permission_required')?'permission_required':'blocked',...managed?{guidanceKind:'sealed'}:{},routes:functions,attach:false,attachments:[],text:'[AIMatterLab scientific guidance unavailable]\n'+blocked.map(r=>r.function_id+': '+(r.reason||r.status)).join('\n')+'\nUse real inspection tools; do not invent software parameters or bypass pyGAS.'};
  if(!functions.length)return {status:'not_run',routes:[],attach:false,attachments:[],text:''};
  const prior=this.accepted.get(provider+'\0'+key)||new Map(),changed=receipts.filter(r=>prior.get(r.function_id)!==r.digest),attach=changed.length>0;
  const digest=createHash('sha256').update(receipts.map(r=>r.function_id+':'+r.digest).join('\n')).digest('hex');
  const execution=receipts.some(r=>r.phase==='execution'),attachments=receipts.flatMap(r=>r.attachments);
  return {status:attach?'passed':'already_loaded',routes:functions,digest,attach,provider,...execution?{guidanceKind:'execution'}:{},loaded:changed.map(r=>({id:r.function_id,digest:r.digest})),attachments:execution?[...new Map(attachments.map(item=>[item.name+'\0'+item.sha256,item])).values()]:attachments,text:attach?'[AIMatterLab selected scientific guidance]\n'+(execution?[...new Map(changed.map(r=>[r.digest,r.text])).values()]:changed.map(r=>r.text)).join('\n'):''};
 }
 mergeRuntime(key,provider,result,guide,selection){
  if(!guide||!selection)return result;
  const fields=['environment_id','engine','configuration_sha256','observed_at','probe_attempted_at','state','probe_status','failure_type','reason','python','executables','modules','repositories','native_runtime','capabilities','cuda','source_build_relation','scientific_status','scope'];
  const compact={status:guide.status,environment_id:selection.environment_id,engine:selection.engine,...guide.reason?{reason:guide.reason}:{},...guide.receipt?{receipt:guide.receipt}: {}};
  if(guide.facts)compact.facts=Object.fromEntries(fields.filter(field=>Object.hasOwn(guide.facts,field)).map(field=>[field,guide.facts[field]]));
  const digest=createHash('sha256').update(JSON.stringify(compact)).digest('hex'),id='@runtime:'+selection.environment_id+':'+selection.engine;
  if(this.accepted.get(provider+'\0'+key)?.get(id)===digest)return result;
  return {...result,provider,status:['not_run','already_loaded'].includes(result.status)?'passed':result.status,attach:true,loaded:[...(result.loaded||[]),{id,digest}],attachments:[...(result.attachments||[]),{source:'runtime',skill:'selected-runtime',name:id,sha256:digest,scope:'Compact actual probe receipt; no installer body or file-watch list'}],text:(result.attach?result.text+'\n':'')+'[AIMatterLab runtime guide]\n'+JSON.stringify(compact)+'\nReuse only these observed selected-runtime facts with current functional guidance. For stale/not_run/blocked evidence, inspect or repair the selected engine within the current delegation and retain the actual findings; do not infer permission for unrelated reinstallation. Artifact/runtime/scientific validation and execution authorization remain separate.'};
 }
 accept(key,result){if(result.attach&&result.status==='passed'){const cacheKey=result.provider+'\0'+key,accepted=this.accepted.get(cacheKey)||new Map();for(const item of result.loaded)accepted.set(item.id,item.digest);this.accepted.set(cacheKey,accepted);}}
}
