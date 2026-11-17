const labels={present_task:'更新计算流程',copy_project_inputs:'复制工作流输入',read_project_input:'读取输入文件',write_project_input:'保存输入文件',inspect_asset:'检查结构与数据',create_structure:'生成结构',suggest_parameters:'规划计算参数',inspect_pygas_catalog:'查阅 CV 与 Bias 库',render_pygas_workflow:'生成 CV 与 Bias',prepare_run:'准备计算草稿',prepare_cluster_run:'准备集群计算',probe_environment:'检查计算环境',diagnose_tools:'检查工具连接',read_runtime_guide:'读取运行环境',describe_engine:'查阅引擎参数',list_environments:'读取计算环境',list_projects:'读取项目',run_status:'查询任务状态',read_log:'读取运行日志',scientific_skill_catalog:'查阅功能指导',read_scientific_skill:'读取任务指导',search_materials_project:'搜索材料结构',import_materials_project:'导入材料结构'};

export function toolLabel(name=''){return {commandExecution:'执行命令',fileChange:'修改文件'}[name]||labels[name]||name.replaceAll('_',' ');}

export function toolActivity(item){
 const result=item.result,failed=!!item.error||item.status==='failed'||result?.isError===true;
 let artifact,failure;function walk(v,depth=0){if(depth>8||v==null)return;if(typeof v==='string'){try{walk(JSON.parse(v),depth+1);}catch{}return;}if(Array.isArray(v)){for(const x of v)walk(x,depth+1);return;}if(typeof v!=='object')return;if(v.id&&(v.kind==='task-parameters'||v.kind==='cluster-setup'||v.engine))artifact=v;if(['blocked','permission_required','unknown','failed'].includes(v.status)&&(v.automatic_retry===false&&typeof v.code==='string'||['blocked','permission_required'].includes(v.status)))failure=v;for(const key of ['content','structuredContent','result','text','data'])if(key in v)walk(v[key],depth+1);}
 walk(result);
 const state=failed?(failure?.status==='unknown'?'unknown':['blocked','permission_required'].includes(failure?.status)?'blocked':'failed'):item.status==='completed'||result?'completed':'running';
 const hints={context_required:'请读取当前会话的流程与项目，再继续补充。',input_changed:'输入已更新，请读取最新版本并保留手工修改。',access_required:'需要特定文件或资源时，在项目设置中调整其范围。',connection_unavailable:'请在设置的计算连接中检查服务，然后重新连接。',invalid_input:'Agent 需要根据工具参数说明补齐技术字段。'};
 const hint=state==='unknown'?'结果尚未确认，请先核对当前流程或任务状态，避免重复提交。':failed?(hints[failure?.code]||'展开详情查看原因；修正后再继续当前流程。'):undefined;
 return {state,artifact:failed?undefined:artifact,summary:state==='unknown'?'操作结果待核对':state==='blocked'?'需要补充条件':failed?'工具调用失败':artifact?.kind==='task-parameters'?'计算流程草稿已保存':artifact?.engine?'运行记录已更新':artifact?'已准备模块草稿':state==='completed'?'工具调用完成':'工具正在执行',hint,details:JSON.stringify(result??item.error??item.status,null,2)?.slice(0,16000)||''};
}
