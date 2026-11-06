const {contextBridge,ipcRenderer}=require('electron');
const methods=new Set(['diagnostics.saveWorkbenchImage','task.stage.artifacts','task.stage.adoptArtifact','task.consumerStage.inspect','task.consumerStage.propose','task.consumerStage.save','task.consumerTarget.inspect','task.consumerTarget.confirm','task.consumerTarget.status','task.stage.inspect','task.stage.save','task.localReview.inspect','task.localReview.read','task.localReview.confirm','task.localReview.status','customCv.read','customCv.saveSpec','customCv.approveFormula','customCv.approveCode','customCv.sharing','customCv.validate','customCv.status','customCv.attach','customCv.reuse','task.pygas.importAsset','sources.diagnose','materials.status','materials.key','materials.search','materials.import','sources.list','state','task.deployment.save','task.deployment.draft','task.deployment.context','task.deployment.open','task.deployment.createProject','task.deployment.prepare','task.create','task.list','task.read','task.input.read','task.pygas.read','task.pygas.initialize','task.pygas.save','task.pygas.normalize','task.edit','task.execute','task.linkRun','conversation.delete','conversation.list','conversation.select','conversation.remember','conversation.rename','conversation.groups','conversation.createGroup','conversation.organize','workspace.list','workspace.create','workspace.select','workspace.keepDraft','workspace.import','workspace.attach','cluster.download','ssh.existing','ssh.import','agent.bindProject','settings','compute.setup','worker.connect','worker.status','worker.restore','task.authoring.bindWorker','worker.request','codex.connect','codex.rpc',
  'codex.respond','codex.configure','workflow.list','workflow.save','agent.tools','agent.connect','agent.disconnect','agent.rpc','agent.recover','agent.respond','agent.configure','agent.account','agent.login','agent.login.cancel','agent.logout','agent.testConnection','agent.login.open','skills.catalog','scientific.skills','file.open','file.save','file.choose','ssh.save','ssh.browse','terminal.start',
  'sharedTerminal.list','sharedTerminal.open','sharedTerminal.read','sharedTerminal.input','sharedTerminal.resize','sharedTerminal.owner','sharedTerminal.close','terminal.input','terminal.close','window','export','compute.profiles.list','compute.profiles.read','compute.profiles.save','compute.profiles.inventory','compute.connection.plan','compute.connection.status','compute.connection.connect','compute.connection.cancel','ssh.auth.plan','ssh.auth.start','ssh.auth.read','ssh.auth.input','ssh.auth.resize','ssh.auth.finish','ssh.auth.closed','ssh.tunnel.plan','ssh.tunnel.start','ssh.tunnel.status','ssh.tunnel.close']);
for(const name of [
 'compute.resource.status','compute.resource.activate','compute.resource.clear',
 'tools.workflows.context','tools.workflows.list','tools.workflows.locateRun','tools.workflows.create','tools.workflows.retryCreate','tools.workflows.prepareStep','tools.workflows.executeStep','tools.workflows.status','tools.workflows.read',
 'tools.aimlab.choose','tools.aimlab.sources.inspect','tools.aimlab.sources.register','tools.aimlab.sources.update','tools.aimlab.sources.list','tools.aimlab.sources.read',
 'tools.packages.choose','tools.packages.inspect','tools.packages.register','tools.packages.update','tools.packages.relocate','tools.packages.read','tools.packages.list',
 'tools.groups.compile','tools.groups.save','tools.groups.read','tools.groups.list',
 'tools.configurations.context','tools.configurations.list','tools.configurations.createProject','tools.configurations.plan','tools.configurations.execute','tools.configurations.status','tools.configurations.activate','tools.configurations.read','tools.configurations.bind','tools.configurations.grant'
])methods.add(name);
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
