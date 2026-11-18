import {useState} from 'react';
import type {ManagedResource} from '../../../contracts/dto/managed-compute';
import {invoke} from '../../api/studio';
import {t} from '../../ui/i18n';

export default function ManagedConnectionList({resources,project,onError}:{resources:ManagedResource[];project?:{id:string;name:string};onError:(e:unknown)=>void}) {
  const [pending,setPending]=useState('');
  if(!resources.length)return null;
  async function setAccess(resource:ManagedResource,allowed:boolean) {
    if(!project||pending)return;
    setPending(resource.resourceId);
    try{await invoke('compute.managed.projectAccess',{resourceId:resource.resourceId,projectId:project.id,allowed});}
    catch(e){onError(e);}finally{setPending('');}
  }
  async function setupService(resource:ManagedResource) {
    if(pending||!resource.connectionId||!resource.profileVersion)return;
    setPending(resource.resourceId);
    try{await invoke('compute.managed.configureService',{connectionId:resource.connectionId,profileId:resource.profileId,profileVersion:resource.profileVersion});}
    catch(e){onError(e);}finally{setPending('');}
  }
  return <section className="settings-managed-connections"><h3>{t('程序持有的计算资源')}</h3>
    {resources.map(resource=><div className="managed-connection-row" key={resource.resourceId}>
      <span className="managed-resource-chip" data-color={resource.color}>{resource.kind==='ssh'?resource.name:'local'}</span>
      <span className="muted" role="status">{t(resource.serviceReady?'作业服务可用':resource.serviceStatus==='preparing'?'正在准备作业服务…':resource.terminalReady?'终端可用':'作业服务待核对')}</span>
      {resource.kind==='ssh'&&resource.connectionId&&!resource.serviceReady&&resource.serviceStatus!=='preparing'&&<button type="button" className="button" disabled={!!pending} onClick={()=>void setupService(resource)}>{t('准备作业服务')}</button>}
      {resource.kind==='ssh'&&project&&<label className="check-label"><input type="checkbox" disabled={!!pending} checked={resource.authorizedProjects?.includes(project.id)||false} onChange={e=>void setAccess(resource,e.target.checked)}/>{t('允许项目使用终端')} · {project.name}</label>}
    </div>)}
  </section>;
}
