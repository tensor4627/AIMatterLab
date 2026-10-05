const {contextBridge,ipcRenderer}=require('electron');
const methods=new Set(['state','settings','worker.connect','worker.request','codex.connect','codex.rpc',
  'codex.respond','codex.configure','workflow.list','workflow.save','agent.connect','agent.disconnect','agent.rpc','agent.respond','agent.configure','agent.account','agent.login','agent.login.cancel','agent.login.open','skills.catalog','file.open','file.save','file.choose','ssh.save','ssh.browse','terminal.start',
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
