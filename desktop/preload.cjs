const {contextBridge,ipcRenderer}=require('electron');
const methods=new Set(['task.stage.artifacts','task.stage.adoptArtifact','task.consumerStage.inspect','task.consumerStage.propose','task.consumerStage.save','task.consumerTarget.inspect','task.consumerTarget.confirm','task.consumerTarget.status','task.stage.inspect','task.stage.save','task.localReview.inspect','task.localReview.read','task.localReview.confirm','task.localReview.status','customCv.read','customCv.saveSpec','customCv.approveFormula','customCv.approveCode','customCv.sharing','customCv.validate','customCv.status','customCv.attach','customCv.reuse','task.pygas.importAsset','sources.diagnose','materials.status','materials.key','materials.search','materials.import','sources.list','state','task.deployment.save','task.deployment.draft','task.deployment.context','task.deployment.open','task.deployment.createProject','task.deployment.prepare','task.create','task.list','task.read','task.input.read','task.pygas.read','task.pygas.initialize','task.pygas.save','task.pygas.normalize','task.edit','task.execute','task.linkRun','conversation.delete','conversation.list','conversation.select','conversation.remember','conversation.rename','conversation.groups','conversation.createGroup','conversation.organize','workspace.list','workspace.create','workspace.select','workspace.keepDraft','workspace.import','workspace.attach','cluster.download','ssh.existing','ssh.import','agent.bindProject','settings','compute.setup','worker.connect','worker.status','worker.request','codex.connect','codex.rpc',
  'codex.respond','codex.configure','workflow.list','workflow.save','agent.tools','agent.connect','agent.disconnect','agent.rpc','agent.recover','agent.respond','agent.configure','agent.account','agent.login','agent.login.cancel','agent.logout','agent.testConnection','agent.login.open','skills.catalog','scientific.skills','file.open','file.save','file.choose','ssh.save','ssh.browse','terminal.start',
  'terminal.input','terminal.close','window','export']);
contextBridge.exposeInMainWorld('studio',{
  invoke:(method,data)=>{
    if(!methods.has(method)) return Promise.reject(new Error('Unsupported method'));
    return ipcRenderer.invoke('studio:'+method,data);
  },
  onEvent:(callback)=>{
    const listener=(_event,data)=>callback(data);
    ipcRenderer.on('studio:event',listener);
    return ()=>ipcRenderer.removeListener('studio:event',listener);
  },
  onTerminal:(callback)=>{
    const listener=(_event,data)=>callback(data);
    ipcRenderer.on('studio:terminal',listener);
    return ()=>ipcRenderer.removeListener('studio:terminal',listener);
  }
});
