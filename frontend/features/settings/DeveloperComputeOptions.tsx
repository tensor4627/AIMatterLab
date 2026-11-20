import {useManagedResources} from '../compute/useManagedResources';
import {t} from '../../ui/i18n';

export default function DeveloperComputeOptions({value,onChange}:{value?:string|null;onChange:(id:string|null)=>void}) {
  const {resources}=useManagedResources();
  const hosts=resources.filter(row=>row.kind==='ssh'&&row.workspace&&!row.verificationPending);
  return <details className="settings-advanced" data-testid="developer-compute-options">
    <summary>{t('开发人员选项')}</summary>
    <label>{t('高权限模式')}
      <select data-testid="developer-compute-workspace" value={value||''} onChange={event=>onChange(event.target.value||null)}>
        <option value="">{t('关闭')}</option>
        {value&&!hosts.some(row=>row.workspace?.workspaceId===value)&&<option value={value}>{t('等待原测试集群重新连接')}</option>}
        {hosts.map(row=><option key={row.workspace!.workspaceId} value={row.workspace!.workspaceId}>
          {row.name} · {row.workspace!.account}@{row.workspace!.hostname} · {row.workspace!.root}
        </option>)}
      </select>
    </label>
    <p>{t('选择已托管的集群并保存，Agent 即可在该工作区测试工具和终端命令。工作区外的写入或执行仍需确认。')}</p>
  </details>;
}
