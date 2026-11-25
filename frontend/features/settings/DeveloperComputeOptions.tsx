import type {AgentApprovalMode} from '../../../contracts/dto/settings';
import {useManagedResources} from '../compute/useManagedResources';
import {t} from '../../ui/i18n';

const modeDescriptions:Record<AgentApprovalMode,string>={
  manual:'需要审批的操作会请求你确认。',
  auto:'在现有项目和资源授权内，自动批准可核实范围的操作。其他操作仍会请求确认。',
  full:'Agent 可在选定的 SSH 工作区内读写和执行，无需逐次确认。工作区外或影响范围无法核实的操作仍需确认。',
};

export default function DeveloperComputeOptions({mode,workspaceId,invalid,disabled,onModeChange,onWorkspaceChange}:{
  mode:AgentApprovalMode;
  workspaceId?:string|null;
  invalid:boolean;
  disabled:boolean;
  onModeChange:(mode:AgentApprovalMode)=>void;
  onWorkspaceChange:(id:string|null)=>void;
}) {
  const {resources}=useManagedResources();
  const hosts=resources.filter(row=>row.kind==='ssh'&&row.workspace&&!row.verificationPending);
  return <div className="settings-field" data-testid="developer-compute-options">
    <label className="settings-field">{t('操作审批')}
      <select data-testid="agent-approval-mode" value={mode} disabled={disabled} aria-describedby="approval-mode-description" onChange={event=>onModeChange(event.target.value as AgentApprovalMode)}>
        <option value="manual">{t('手动审批')}</option>
        <option value="auto">{t('自动审批')}</option>
        <option value="full">{t('完全权限')}</option>
      </select>
    </label>
    <p className="settings-note" id="approval-mode-description">{t(modeDescriptions[mode])}</p>
    {mode==='full'&&<>
      <label className="settings-field">{t('完全权限的 SSH 工作区')}
        <select data-testid="developer-compute-workspace" value={workspaceId||''} disabled={disabled} aria-required="true" aria-invalid={invalid||undefined} aria-describedby={invalid?'approval-workspace-error':undefined} onChange={event=>onWorkspaceChange(event.target.value||null)}>
          <option value="">{t('选择工作区')}</option>
          {workspaceId&&!hosts.some(row=>row.workspace?.workspaceId===workspaceId)&&<option value={workspaceId}>{t('等待选定的 SSH 工作区重新连接')}</option>}
          {hosts.map(({name,workspace})=><option key={workspace!.workspaceId} value={workspace!.workspaceId}>
            {name} · {workspace!.account}@{workspace!.hostname} · {workspace!.root}
          </option>)}
        </select>
      </label>
      {invalid&&<p id="approval-workspace-error" role="alert">{t('请为完全权限选择一个已验证的 SSH 工作区。')}</p>}
      {!hosts.length&&!workspaceId&&<p className="settings-note">{t('请先在「计算资源」连接 SSH 并确认工作区。')}</p>}
    </>}
  </div>;
}
