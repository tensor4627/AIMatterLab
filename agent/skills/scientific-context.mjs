import {createHash} from 'node:crypto';
const ENGINE_ROUTES={'pydyn.md':'md.pydyn','gpumd.md':'md.gpumd','pydyn.sampling':'sampling.pydyn','gpumd.sampling':'sampling.gpumd','gpumd.neb':'neb.gpumd','pygas.build':'pygas.bias','bias.validate':'pygas.contract','nep.train':'training.nep','nep.eval':'training.nep','nep.analyze':'training.nep','hotpp.train':'training.hotpp','hotpp.eval':'training.hotpp','hotpp.export':'training.hotpp','pygas.reweight':'analysis.wtmetad','pygas.opes-reweight':'analysis.opes'};
export function selectScientificFunctions({text='',parameters={},hasWorkflow=false,planRoadmap=false,manualFunction}={}){
 const value=String(text),engine=parameters.engine;let id;
 const consumerIntent=/分子动力学|\bmd\b|metad|opes|增强采样/i.test(value);
 const dynamicsIntent=/\b(?:md|nve|nvt|npt|metad|opes)\b|wtmetad|分子动力学|增强采样|偏置模拟|积分|沉积/i.test(value);
 const excludesDynamics=/(?:不|无需|不要)(?:运行|进行|做|启动)?\s*(?:MD|分子动力学|积分)|\b(?:no|without|do not)\s+(?:run(?:ning)?\s+)?(?:MD|molecular dynamics)\b/i.test(value);
 const cvOnlyIntent=/(?:仅|只)(?:计算|生成|定义|评估)?\s*(?:CV|集体变量)|\bcv[\s_-]*only\b|\bonly\s+(?:(?:compute|calculate|evaluate)\s+)?(?:the\s+)?(?:cvs?|collective\s+variables?)\b/i.test(value);
 const primaryTraining=/(?:^|[。！!？?;\n])\s*(?:(?:请|帮我|现在|接下来|先|首先|然后|随后|please\s+|next\s+|now\s+|first\s+|then\s+)\s*)*(?:训练|导出|评估|train\b|export\b|freeze\b|eval\b)/i.test(value);
 if(manualFunction!==undefined&&typeof manualFunction!=='string')throw Error('Invalid selected scientific function');
 // Present intent takes priority over the previous run: analysis never loads the build/install stack.
 if(manualFunction)id=manualFunction;
 else if(/(?:基础|默认|初始化|设置|选择|创建).*工作区|工作区.*(?:灰|设置|配置|不可用)|(?:base|default|setup|initialize).*workspace/i.test(value))id='cluster.workspace-setup';
 else if(/(?:reweight|重加权)/i.test(value))id=/opes/i.test(value)?'analysis.opes':'analysis.wtmetad';
 else if(/(?:分析轨迹|轨迹分析|analy[sz]e.*traject|trajectory.*analy)/i.test(value))id='analysis.trajectory';
 else if(/(?:monitor|监测|监控).*?(?:cv|pygas)|(?:cv|pygas).*?(?:monitor|监测)/i.test(value))id='pygas.monitor';
 else if(/(?:自定义|custom|missing|不存在).*?cv|cv.*?(?:自定义|custom|不存在)/i.test(value))id='pygas.custom-cv';
 else if(/\bneb\b|最小能量路径/i.test(value))id=/gpumd|gpu.?sampling/i.test(value)?'neb.gpumd':/pydyn/i.test(value)||String(engine).startsWith('pydyn.')?'neb.pydyn':'neb.gpumd';
 else if((/(?:训练|train|导出|export|freeze)/i.test(value)||/(?:测试|eval|评估)/i.test(value)&&!/(?:分子动力学|\bmd\b|metad|opes|增强采样)/i.test(value))&&(!consumerIntent||primaryTraining)&&/hotpp|torchnep|nepmaker|activemiao|\bnep\b/i.test(value))id=/torchnep/i.test(value)?'training.torchnep':/nepmaker/i.test(value)?'learning.nepmaker':/activemiao/i.test(value)?'learning.activemiao':/hotpp/i.test(value)?'training.hotpp':'training.nep';
 else if(cvOnlyIntent&&(!dynamicsIntent||excludesDynamics))id='pygas.cv';
 else if(/metad|opes|umbrella|增强采样|偏置模拟/i.test(value))id=/pydyn/i.test(value)?'sampling.pydyn':/gpumd|gpu.?sampling/i.test(value)?'sampling.gpumd':String(engine).startsWith('pydyn.')?'sampling.pydyn':String(engine).startsWith('gpumd.')?'sampling.gpumd':'pygas.bias';
 else if(/分子动力学|\bmd\b/i.test(value)&&/gpumd|pydyn/i.test(value))id=/gpumd/i.test(value)?'md.gpumd':'md.pydyn';
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
 else if(/materials.?project|\bmp-[0-9]+/i.test(value))id='structure.materials-project';
 else if(/\base\b|生成.*结构|构建.*结构/i.test(value))id='structure.ase';
 const roadmap=hasWorkflow&&!manualFunction&&(planRoadmap||/流程图|输入输出规划|流程总览|计算路线图|workflow (?:roadmap|diagram)|artifact handoffs/i.test(value));
 return [...new Set([...(hasWorkflow?['workflow.orchestrate']:[]),...(roadmap?['workflow.roadmap']:[]),...id?[id]:[]])];
}
export class ScientificSkillContext{
 constructor(router){this.router=router;this.accepted=new Map();}
 forget(key){for(const cached of this.accepted.keys())if(cached.endsWith('\0'+key))this.accepted.delete(cached);}
 async prepare(key,provider,options){
  let functions=selectScientificFunctions(options);const policy=options.policy,fallback=policy&&policy.state!=='legacy_unconfigured'&&policy.facts?.package&&options.manualFunction===undefined&&!policy.hasReadGrant()&&functions.every(id=>id==='workflow.orchestrate'||id==='workflow.roadmap');
  // Non-legacy authority is supplied only for an actually bound configuration, including ordinary chats.
  // With no domain intent, its self-contained receipt replaces the optional generic workflow guide.
  if(fallback)functions=['@execution:'+policy.facts.package.id,...functions.filter(id=>id==='workflow.roadmap')];
  const managed=fallback||policy&&functions.some(id=>policy.appliesTo(this.router.routes?.get(id)||{id})),receipts=[];
  for(const id of functions){if(fallback&&id.startsWith('@execution:')){await policy.revalidate();receipts.push(policy.executionResult(id));await policy.revalidate();}else receipts.push(await this.router.read(provider,id,undefined,{scope:options.scope||{provider},policy}));}
  const blocked=receipts.filter(r=>r.status!=='passed');
  if(blocked.length)return {status:blocked.some(r=>r.status==='permission_required')?'permission_required':'blocked',...managed?{guidanceKind:'sealed'}:{},routes:functions,attach:false,attachments:[],text:'[Studio scientific guidance unavailable]\n'+blocked.map(r=>r.function_id+': '+(r.reason||r.status)).join('\n')+'\nUse real inspection tools; do not invent software parameters or bypass pyGAS.'};
  if(!functions.length)return {status:'not_run',routes:[],attach:false,attachments:[],text:''};
  const prior=this.accepted.get(provider+'\0'+key)||new Map(),changed=receipts.filter(r=>prior.get(r.function_id)!==r.digest),attach=changed.length>0;
  const digest=createHash('sha256').update(receipts.map(r=>r.function_id+':'+r.digest).join('\n')).digest('hex');
  const execution=receipts.some(r=>r.phase==='execution'),attachments=receipts.flatMap(r=>r.attachments);
  return {status:attach?'passed':'already_loaded',routes:functions,digest,attach,provider,...execution?{guidanceKind:'execution'}:{},loaded:changed.map(r=>({id:r.function_id,digest:r.digest})),attachments:execution?[...new Map(attachments.map(item=>[item.name+'\0'+item.sha256,item])).values()]:attachments,text:attach?'[Studio selected scientific guidance]\n'+(execution?[...new Map(changed.map(r=>[r.digest,r.text])).values()]:changed.map(r=>r.text)).join('\n'):''};
 }
 mergeRuntime(key,provider,result,guide,selection){
  if(!guide||!selection)return result;
  const fields=['environment_id','engine','configuration_sha256','observed_at','probe_attempted_at','state','probe_status','failure_type','reason','python','executables','modules','repositories','native_runtime','capabilities','cuda','source_build_relation','scientific_status','scope'];
  const compact={status:guide.status,environment_id:selection.environment_id,engine:selection.engine,...guide.reason?{reason:guide.reason}:{},...guide.receipt?{receipt:guide.receipt}: {}};
  if(guide.facts)compact.facts=Object.fromEntries(fields.filter(field=>Object.hasOwn(guide.facts,field)).map(field=>[field,guide.facts[field]]));
  const digest=createHash('sha256').update(JSON.stringify(compact)).digest('hex'),id='@runtime:'+selection.environment_id+':'+selection.engine;
  if(this.accepted.get(provider+'\0'+key)?.get(id)===digest)return result;
  return {...result,provider,status:['not_run','already_loaded'].includes(result.status)?'passed':result.status,attach:true,loaded:[...(result.loaded||[]),{id,digest}],attachments:[...(result.attachments||[]),{source:'runtime',skill:'selected-runtime',name:id,sha256:digest,scope:'Compact actual probe receipt; no installer body or file-watch list'}],text:(result.attach?result.text+'\n':'')+'[Studio runtime guide]\n'+JSON.stringify(compact)+'\nReuse only these observed selected-runtime facts with current functional guidance. For stale/not_run/blocked evidence, inspect or repair the selected engine within the current delegation and retain the actual findings; do not infer permission for unrelated reinstallation. Artifact/runtime/scientific validation and execution authorization remain separate.'};
 }
 accept(key,result){if(result.attach&&result.status==='passed'){const cacheKey=result.provider+'\0'+key,accepted=this.accepted.get(cacheKey)||new Map();for(const item of result.loaded)accepted.set(item.id,item.digest);this.accepted.set(cacheKey,accepted);}}
}
