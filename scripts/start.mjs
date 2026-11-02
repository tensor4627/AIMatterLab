import {pathToFileURL} from 'node:url';
import {launchDesktop,launchPreflight,childExitCode,reportLaunchFailure} from './desktop-launch.mjs';
export async function runStart({args=process.argv.slice(2),preflight=launchPreflight,launch=launchDesktop,write=value=>console.log(value)}={}) {
 if(args.includes('--preflight-only')) {
  if(args.length!==1) {
   write(JSON.stringify({status:'blocked',reason:'invalid_preflight_arguments'}));
   return {exitCode:2};
  }
  const result=preflight();
  write(JSON.stringify(result));
  return {exitCode:result.status==='allowed'?0:2};
 }
 return {child:await launch({args})};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
  const {child,exitCode}=await runStart();
  if(!child) process.exitCode=exitCode;
  else {
   child.once('error',reportLaunchFailure);
   child.once('exit',(code,signal)=>{process.exitCode=childExitCode(code,signal);});
   for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>child.kill(signal));
  }
 } catch(error) {reportLaunchFailure(error);}
}
