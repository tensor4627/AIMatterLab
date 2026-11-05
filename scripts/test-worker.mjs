import {spawn} from 'node:child_process';
import path from 'node:path';
import {linuxPath} from "../contracts/transport-policy.mjs";
const args=['-m','unittest','discover','-s',process.platform==='win32'?linuxPath(path.resolve('backend/worker/tests')):path.resolve('backend/worker/tests'),'-v'];
const child=process.platform==='win32'?spawn('wsl.exe',['-d',process.env.STUDIO_WSL_DISTRO||'Ubuntu','--','python3',...args],{stdio:'inherit',windowsHide:true}):spawn('python3',args,{stdio:'inherit'});
child.on('error',e=>{console.error(e);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
