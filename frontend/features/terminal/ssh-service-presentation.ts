import type {SshServicePhase,SshServiceState} from '../../../contracts/dto/compute';

export const servicePhaseMessages:Record<SshServicePhase,string>={
 preparing_local:'核对本地作业服务文件',preparing_environment:'激活已保存的作业服务环境',waiting_python:'等待远端 Python 响应',
 checking_cache:'检查远端服务缓存和权限',transferring_transport:'传输连接组件',
 transferring_worker:'传输作业服务文件',preparing_runtime:'准备并校验作业服务文件',
 starting_worker:'启动远端作业服务',checking_health:'核对服务身份与健康状态',
 checking_tools:'核对工作流工具',ready:'作业服务已就绪',request:'核对服务请求状态',
 stopping:'正在停止作业服务通道',returning_terminal:'等待交互终端恢复确认'
};
const errorMessages:Record<string,string>={
 registration_required:'请在连接计算资源中完成此连接的首次作业服务设置。',
 maintenance_required:'已保存的作业服务需要检查或维护，请在连接计算资源中处理。不会自动重装或更新。',
 ssh_service_registration_required:'请在连接计算资源中完成此连接的首次作业服务设置。',
 ssh_service_maintenance_required:'已保存的作业服务需要检查或维护，请在连接计算资源中处理。',
 environment_activation_failed:'已保存的环境激活命令未能完成。请在原终端检查 Conda、venv 或 module 配置。',
 python_start_failed:'未能启动所选 Python。请核对已保存的解释器路径和环境激活设置。',
 python_response_timeout:'等待远端 Python 响应超时。请返回终端核对登录状态和 Python 响应；不能据此判断 Python 未安装。',
 startup_timeout:'等待远端启动响应超时。尚不能区分登录未完成、Python 未响应或通道中断，请先返回终端核对。',
 connection_unconfirmed:'未收到完整的通道确认。请重新核对状态，不会自动重连。',
 exec_unavailable:'SSH 网关拒绝远程命令，尚未运行 Python。请在连接设置使用“用户名/资产 IP/资产账号”的直达格式，或使用允许服务命令的集群入口，再人工登录。现有终端仍可使用。',
 channel_refused:'SSH 服务通道被拒绝，尚未运行 Python。请核对网关资产直达配置及多通道支持。现有终端仍可使用，不会自动重新登录。',
 channel_timeout:'SSH 服务通道未就绪，尚未运行 Python。请核对网关路由和服务通道支持。现有终端仍可使用，不会自动重新登录。',
 terminal_busy:'终端尚未回到可确认的 shell 提示符，未发送服务命令。请等待当前命令结束，再明确交接。',
 identity_unconfirmed:'远端服务身份或版本未通过核对，已停止接入。',
 tools_unavailable:'远端服务已响应，但工作流工具尚未通过检查，不能创建或执行流程。',
 local_resources_unavailable:'本地作业服务文件不可用或校验未通过，未继续接入。',
 context_changed:'接入所属会话或计算资源已变化，未向其他接入发送操作。',
 stop_timeout:'返回终端的确认超时，暂时不能恢复输入。请重新核对状态，或明确结束此 SSH 会话。',
 python_unsupported:'远端 Python 版本不满足作业服务要求。请返回终端核对 Python；计算环境不会自动更改。',
 sqlite_unavailable:'远端 Python 缺少可用的 SQLite 支持。请返回终端核对 Python 环境。',
 tty_unavailable:'远端未提供作业服务所需的交互终端。请核对 SSH 的终端配置。',
 invalid_hello:'未收到有效的远端连接确认，尚不能确认作业服务身份。',
 protocol_failed:'作业服务通信校验未通过，通道状态需要重新核对。',
 transport_hash_mismatch:'连接组件内容校验不一致，已停止接入。',
 transport_cache_invalid:'远端连接组件缓存校验未通过，已停止接入。',
 worker_hash_mismatch:'作业服务文件内容校验不一致，已停止接入。',
 worker_cache_invalid:'远端作业服务缓存校验未通过，已停止接入。',
 namespace_unsafe:'远端服务目录的归属、权限或链接不符合要求。请返回终端核对。',
 permission_denied:'远端拒绝访问作业服务目录。请返回终端核对目录权限。',
 storage_unavailable:'远端无法写入作业服务文件。请核对可用空间、配额和文件系统状态。',
 worker_start_timeout:'远端作业服务启动确认超时，启动结果尚未确认。',
 worker_start_failed:'远端作业服务未能启动。请核对远端 Python 和服务状态。',
 worker_identity_unavailable:'无法确认远端作业服务身份，已停止接入。',
 worker_health_invalid:'远端健康检查与预期服务不一致，已停止接入。',
 service_request_unconfirmed:'未收到完整的服务请求结果。请核对已有状态，不会自动重发请求。',
 internal_error:'作业服务准备未完成，未取得更具体的安全诊断。请重新核对状态。',
 terminal_service_unknown:'未收到完整的通道确认。请重新核对状态，不会自动重连。',
 terminal_service_failed:'作业服务通道校验未通过。请重新核对状态。',
 terminal_service_unavailable:'当前作业服务通道不可用。请重新核对终端状态。',
 terminal_service_changed:'作业服务接入记录已变化，未向其他接入发送操作。',
 terminal_owner_changed:'终端操作权已变化，请重新核对当前会话。',
 terminal_context_changed:'接入所属会话或计算资源已变化，请在原连接核对状态。',
 terminal_saved_connection_changed:'保存的 SSH 连接已变化，请先返回终端并重新选择连接。',
 terminal_session_exited:'SSH 进程已退出，请核对现有输出和退出状态。',
 ssh_service_context_changed:'接入所属会话或计算资源已变化，请在原连接核对状态。',
 ssh_service_selection_changed:'选中的 SSH 连接已变化，未继续接入。',
 ssh_service_identity_unavailable:'无法确认远端作业服务身份，已停止接入。',
 ssh_service_runtime_changed:'远端作业服务版本与本次接入文件不一致，已停止接入。',
 ssh_service_tools_unavailable:'远端服务已响应，但工作流工具尚未通过检查，不能创建或执行流程。',
 ssh_service_resources_invalid:'本地作业服务文件校验未通过，未继续传输。',
 ssh_service_resources_changed:'本地作业服务文件在校验时发生变化，未继续传输。',
 ssh_service_resources_incomplete:'本地作业服务文件不完整，未继续传输。'
};
export function servicePhaseMessage(phase:unknown){return typeof phase==='string'&&Object.hasOwn(servicePhaseMessages,phase)?servicePhaseMessages[phase as SshServicePhase]:'正在核对作业服务接入状态';}
export function serviceErrorMessage(code:unknown){return typeof code==='string'&&Object.hasOwn(errorMessages,code)?errorMessages[code]:'未收到完整的接入结果。请重新核对状态，不会自动重连或重发请求。';}
export function serviceIdentityUnconfirmed(code:unknown){return typeof code==='string'&&['worker_health_invalid','worker_identity_unavailable','identity_unconfirmed','ssh_service_identity_unavailable','ssh_service_runtime_changed'].includes(code);}
/** Electron may wrap a rejected error. Only a known code selects a fixed message. */
export function serviceRejectedMessage(error:unknown){const code=String(error).slice(0,4096).match(/\b(?:ssh_service|terminal)_[a-z_]+\b/)?.[0];return serviceErrorMessage(code);}
export function serviceTransfer(state:SshServiceState|null){
 const value=state?.progress;
 if(!state||!['transferring_transport','transferring_worker'].includes(state.phase||'')||value?.kind!=='transfer'||!Number.isSafeInteger(value.completedBytes)||!Number.isSafeInteger(value.totalBytes)||value.totalBytes<=0||value.completedBytes<0||value.completedBytes>value.totalBytes)return null;
 return {completed:value.completedBytes,total:value.totalBytes,percent:Math.floor(value.completedBytes/value.totalBytes*100)};
}
export function serviceDuration(start:unknown,now:number){return typeof start==='number'&&Number.isFinite(start)&&start>0&&start<=now?Math.floor((now-start)/1000):null;}
export function serviceVersion(value:unknown){return Array.isArray(value)&&value.length===3&&value.every(part=>Number.isSafeInteger(part)&&part>=0&&part<=10000)?value.join('.'):null;}
