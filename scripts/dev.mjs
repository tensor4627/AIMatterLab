import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {requireLaunchContext,launchDesktop,childExitCode,reportLaunchFailure,desktopRoot} from './desktop-launch.mjs';
export async function runDevelopment({preflight=requireLaunchContext,spawnVite=spawn,launch=launchDesktop,fetchReady=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),env=process.env,cwd=desktopRoot}={}) {
 preflight(); // A rejected context starts neither Vite nor Electron.
 const vite=spawnVite(process.execPath,['node_modules/vite/bin/vite.js'],{cwd,stdio:'inherit',env});
 let electron,viteFailure,viteExit,closing=false;
 vite.once('error',error=>{viteFailure=error;viteExit=1;electron?.kill();});
 vite.once('exit',(code,signal)=>{if(!closing){viteExit=childExitCode(code,signal)||1;viteFailure=new Error(`Vite exited (${code ?? signal})`);electron?.kill();}});
 try {
  let ready=false;
  for(let i=0;i<80;i++) {
   if(viteFailure) throw viteFailure;
   try {if((await fetchReady('http://127.0.0.1:5173')).ok) {ready=true;break;}} catch {}
   await wait(100);
  }
  if(!ready) throw new Error('Development server did not become ready.');
  electron=await launch({preflight:()=>{},env:{...env,STUDIO_DEV_URL:'http://127.0.0.1:5173'},cwd});
  const closeVite=()=>{closing=true;vite.kill();};
  electron.once('exit',closeVite);electron.once('error',closeVite);
  return {electron,vite,exitCode:(code,signal)=>viteExit ?? childExitCode(code,signal)};
 } catch(error) {vite.kill();throw error;}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
  const {electron,vite,exitCode}=await runDevelopment();
  electron.once('error',reportLaunchFailure);
  electron.once('exit',(code,signal)=>{process.exitCode=exitCode(code,signal);});
  for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{vite.kill();electron.kill(signal);});
 } catch(error) {reportLaunchFailure(error);}
}
