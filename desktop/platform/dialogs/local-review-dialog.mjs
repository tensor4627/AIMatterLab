export function localReviewDialog(scope,language){
 const en=language==='en',label=(a,b)=>en?a:b;
 const detail=[label('Workflow: ','流程：')+scope.taskId,label('Project: ','项目：')+scope.projectId,label('Environment: ','环境：')+scope.environmentId,label('Input root: ','输入目录：')+scope.inputRoot,label('Saved revision: ','保存版本：')+scope.parameterRevision,label('Saved parameters SHA256: ','保存参数 SHA256：')+scope.parametersSha,
 label('Input completeness only; no artifact/scientific/target validation is granted.','仅确认本地实际输入完整性；不授予产物、科学或目标环境验证通过。'),
 label('Configured Python invocation: ','登记 Python 调用路径：')+scope.runtimeConfiguredInvocation,label('Observed interpreter: ','实际解释器：')+scope.runtimeInterpreter,label('Observed runtime receipt SHA256: ','实际运行时收据 SHA256：')+scope.runtimeReceiptSha,label('Registered runtime configuration SHA256: ','登记环境配置 SHA256：')+scope.runtimeConfigurationSha,
 ...scope.entries.map(item=>[item.role,item.name,item.path,item.size+' bytes','SHA256 '+item.sha256].join(' · ')),label('Current private bindings: ','当前私有绑定：')+JSON.stringify(scope.privateBindings),label('Canonical pair CAS: ','规范组合图/源码 CAS：')+JSON.stringify(scope.composition.expected),
 label('No model receives these files. Provider sharing and project authorization stay unchanged. Build, target validation and execution require separate explicit actions.','这些文件不会发送模型。服务商共享与项目授权保持原样。构建、目标验证和执行仍需独立的明确操作。')].join('\n');
 return {type:'question',title:label('Confirm this local human input review','确认本地人工输入复核'),message:label('Confirm only these actual saved inputs','仅确认这些实际保存输入'),detail,buttons:en?['Cancel','Confirm this saved revision']:['取消','确认此保存版本'],defaultId:0,cancelId:0,noLink:true};
}
