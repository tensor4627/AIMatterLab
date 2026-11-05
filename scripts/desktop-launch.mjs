import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
export const desktopRoot=fileURLToPath(new URL("..",import.meta.url));
export function launchPreflight({platform=process.platform,probe=spawnSync}={}) {
  if(platform!=='win32') return {status:'allowed',reason:'not_windows'};
  try {
    // Command stdin contains only this module's fixed local probe, never caller text.
    // This does not change ExecutionPolicy; language/application restrictions still apply.
    const input=readFileSync(new URL('./windows-launch-preflight.ps1',import.meta.url),'utf8')+'\n\n';
    const result=probe('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','-'],{input,encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536});
    const value=JSON.parse(result.stdout?.trim()||'null');
    if(!result.error && result.status===0 && value?.status==='allowed' && value.restricted===false) return value;
    return {status:'blocked',reason:value?.reason==='restricted_token'?'restricted_token':'token_probe_failed'};
  } catch { return {status:'blocked',reason:'token_probe_failed'}; }
}
export function requireLaunchContext(options) {
  const result=launchPreflight(options);
  if(result.status!=='allowed') {
    const error=new Error('请用正常桌面上下文启动；代理请申请正常执行权限。 / Launch from a normal desktop context; agents must request normal execution permission.');
    error.preflight=result;throw error;
  }
  return result;
}
export function childExitCode(code,signal) { return Number.isInteger(code)?code:signal==='SIGINT'?130:signal==='SIGTERM'?143:1; }
export async function launchDesktop({preflight=requireLaunchContext,resolveBinary=async()=> (await import('electron')).default,spawnTarget=spawn,args=process.argv.slice(2),cwd=desktopRoot,env=process.env}={}) {
  preflight();
  return spawnTarget(await resolveBinary(),['.',...args],{cwd,env,stdio:'inherit'});
}
export function reportLaunchFailure(error) {
  console.error(JSON.stringify({status:'blocked',reason:error.preflight?.reason||'launch_failed',message:error.message}));process.exitCode=1;
}
