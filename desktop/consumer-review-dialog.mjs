export function consumerReviewDialog(value,language='zh-CN'){
 const en=language==='en',m=(zh,eng)=>en?eng:zh,target=value.kind==='consumer-target-native-scope-v1',s=value.scope;
 const lines=target?[
  m('流程：','Workflow: ')+value.taskId,m('参数版本：','Parameter revision: ')+s.parameterRevision,m('目标项目 / 环境：','Target project / environment: ')+s.config.projectId+' / '+s.environmentId,
  m('原始 authoring 环境不会变更。','The original authoring environment will not change.'),
  'Engine: '+s.engine,'GPU: '+s.config.gpu,m('时长上限：','Time limit: ')+s.config.maxSeconds+' s',m('工作目录：','Directory: ')+s.config.directoryName,
  'CPU '+s.config.resources.cpus+' / GPU '+s.config.resources.gpus+' / '+s.config.resources.memory_mb+' MiB',
  m('登记 Python 调用：','Configured Python invocation: ')+s.configuredPython,m('实际解释器：','Observed interpreter: ')+s.observedPython,
  'Scientific closure SHA256: '+s.scienceClosureSha,'Runtime configuration SHA256: '+s.configurationSha,'Observed runtime receipt SHA256: '+s.runtimeReceiptSha,'Target scope SHA256: '+s.scopeSha,
  ...value.files.map(f=>[f.role,f.name,f.path,f.size+' bytes','SHA256 '+f.sha256].join(' · ')),
  m('此确认只绑定目标身份；实际序列化产物 CUDA ABI、力/virial、引擎运行和人工执行门保持独立。','This confirms target identity only. Actual serialized CUDA ABI, force/virial, engine runtime and human execution gates remain independent.')
 ]:[
  m('流程：','Workflow: ')+value.taskId,m('保存版本：','Saved revision: ')+value.parameterRevision,m('原始项目 / authoring 环境：','Original project / authoring environment: ')+value.projectId+' / '+value.environmentId,
  'Parameters SHA256: '+value.parametersSha,
  'CUDA · fd_step '+value.validationPlan.fdStep+' · fd_atol '+value.validationPlan.fdAtol,
  'Full CV atom group: '+JSON.stringify(value.validationPlan.fullCvAtomSelection),
  'FD sample: '+JSON.stringify(value.validationPlan.coverage),
  'Source numerical defaults: '+JSON.stringify(value.validationPlan.sourceFiles),'Canonical graph SHA256: '+value.composition.graph_sha256,'Generated source SHA256: '+value.composition.source_sha256,
  'Canonical pair CAS: '+JSON.stringify(value.composition.expected),
  ...value.entries.map(f=>[f.role,f.name,f.path,f.size+' bytes','SHA256 '+f.sha256,f.binary?m('仅二进制元数据/实际构建来源；未加载 ABI','Binary metadata/actual producer only; ABI not loaded'):m('实际完整 UTF-8 已回读','Actual complete UTF-8 read back')].join(' · ')),
  ...value.privateBindings.map(b=>'Private '+b.id+' / spec '+b.spec_sha256+' / code '+b.code_sha256+' / parameters '+b.parameters_sha256),
  m('仅人工科学输入完整性。计算目标尚需单独选择、确认和实际验证；没有模型接收文件，不修改 AI 复核、共享或项目授权。','Human scientific input completeness only. Target selection, confirmation and actual validation remain separate. No model receives files. AI review, sharing and project authorization stay unchanged.')
 ];
 return {type:'question',title:target?m('确认消费端目标身份','Confirm consumer target identity'):m('确认本地科学输入完整性','Confirm local scientific input completeness'),message:m('仅确认以下确切保存版本；不自动运行','Confirm only this exact saved revision; no automatic execution'),detail:lines.join('\n'),buttons:en?['Cancel','Confirm this exact scope']:['取消','确认此精确范围'],defaultId:0,cancelId:0,noLink:true};
}
