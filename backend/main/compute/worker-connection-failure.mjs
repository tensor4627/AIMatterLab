// Only bounded diagnostic categories reach the UI. Never forward command lines,
// stdout/stderr, connection tokens or arbitrary subprocess errors.
export function workerConnectionFailure(error){
 const text=String(error?.message||'')+' '+String(error?.stderr||'');
 let code='worker_start_failed',message='作业服务启动失败，请检查设置中的计算连接后重连。';
 if(error?.code==='ENOENT'){code='wsl_unavailable';message='未找到 WSL，请先安装或启用 WSL，再连接计算环境。';}
 else if(/WSL_E_DISTRO_NOT_FOUND|WSL_E_DEFAULT_DISTRO_NOT_FOUND|no distribution|发行版不存在/i.test(text)){code='distribution_not_found';message='未找到所选 WSL 发行版，请在设置的计算连接中更正名称。';}
 else if(error?.killed||['ETIMEDOUT','ABORT_ERR'].includes(error?.code)||/timed out|timeout/i.test(text)){code='worker_connection_timeout';message='连接作业服务超时，请检查 WSL 状态后重新连接。';}
 return {code,message};
}
