import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {linuxPath} from "../contracts/transport-policy.mjs";
import {probeWslAccess} from '../desktop/platform/wsl-access.mjs';

const repository=fileURLToPath(new URL('..',import.meta.url));
export function workerTestPreflight({platform=process.platform,env=process.env,probe}={}){
 const result=probeWslAccess({platform,probe});
 if(result.status!=='allowed'||platform!=='win32')return result;
 const distribution=env.STUDIO_WSL_DISTRO||'Ubuntu';
 if(!result.distributions.includes(distribution))return {status:'blocked',reason:'wsl_distribution_missing',message:'所选 WSL 发行版不在当前 Windows 账户的列表中，请核对账户和 STUDIO_WSL_DISTRO。'};
 return result;
}

export function runWorkerTests({platform=process.platform,env=process.env,cwd=repository,args=process.argv.slice(2),preflight=workerTestPreflight,spawnTarget=spawn,write=value=>console.log(JSON.stringify(value))}={}){
 const pattern=args.length===1&&args[0].startsWith('--pattern=')?args[0].slice(10):null;
 if(args.length&&!(args.length===1&&['--preflight-only','--list'].includes(args[0]))&&!(pattern&&/^test_[A-Za-z0-9_*?-]+\.py$/.test(pattern))){
  write({status:'blocked',reason:'invalid_preflight_arguments',message:'Usage: node scripts/test-worker.mjs [--preflight-only | --list | --pattern=test_name.py]'});
  return {exitCode:2};
 }
 const tests=path.resolve(cwd,'backend/worker/tests');
 if(args[0]==='--list'){write({scope:'AIMatterLab worker tests only',files:fs.readdirSync(tests).filter(name=>/^test_.*\.py$/.test(name)).sort()});return {exitCode:0};}
 if(pattern){const match=new RegExp('^'+pattern.replaceAll('.','\\.').replaceAll('*','.*').replaceAll('?','.')+'$');if(!fs.readdirSync(tests).some(name=>match.test(name))){write({status:'blocked',reason:'no_tests_matched',message:'No local worker tests matched the pattern.'});return {exitCode:2};}}
 const result=preflight({platform,env});
 if(result.status!=='allowed'||args[0]==='--preflight-only'){
  write(result);return {exitCode:result.status==='allowed'?0:2};
 }
 const command=['-m','unittest','discover','-s',platform==='win32'?linuxPath(tests):tests,...pattern?['-p',pattern]:[],'-v'];
 const file=platform==='win32'?'wsl.exe':'python3';
 const argv=platform==='win32'?['-d',env.STUDIO_WSL_DISTRO||'Ubuntu','--','python3',...command]:command;
 return {child:spawnTarget(file,argv,{cwd,env,stdio:'inherit',windowsHide:true})};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const {child,exitCode}=runWorkerTests();
  if(!child)process.exitCode=exitCode;
  else{
   child.once('error',error=>{
    console.error(JSON.stringify({status:'blocked',reason:error.code==='ENOENT'?(process.platform==='win32'?'wsl_unavailable':'python_unavailable'):'worker_test_spawn_failed',message:'无法启动所选测试运行环境，请检查实际执行身份与运行时。'}));
    process.exitCode=2;
   });
   child.once('exit',(code,signal)=>{process.exitCode=Number.isInteger(code)?code:signal==='SIGINT'?130:signal==='SIGTERM'?143:1;});
  }
 }catch{
  console.error(JSON.stringify({status:'blocked',reason:'worker_test_launcher_failed',message:'测试入口检查失败，未切换运行环境或启动替代任务。'}));process.exitCode=2;
 }
}
