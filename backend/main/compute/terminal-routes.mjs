/** Domain transport operations register only through the host's sender-validated IPC port. */
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {sshEndpoint} from './ssh-endpoint.mjs';
import {sshAlias,quoteShell,linuxPath} from '../../../contracts/transport-policy.mjs';
import {computeRuntime} from '../../../desktop/platform/compute-runtime.mjs';
export function registerLegacyTerminalRoutes({handle,worker,terminals,getSettings,workerSource,emit,host=computeRuntime}){
 const spawn=host.spawnProcess;
handle('terminal.start',async({kind,alias,clusterId}) => {
  if(terminals.size>=4) throw new Error('Close an existing terminal before opening another');
  const id=randomUUID();
  let child, protocol=false;
  if(kind==='cluster'){
    const p=await worker.request('POST','/api/cluster/profile',{cluster_id:clusterId});
    if(p.auth_mode==='interactive')throw Error('请在集群连接页打开私有认证；普通 SSH 终端不能代替受控认证会话。');
    const endpoint=sshEndpoint(p);
    const args=['-tt','-l',endpoint.username,'-p',String(p.port),'-o','StrictHostKeyChecking=yes'];
    if(p.identity_file)args.push('-i',p.identity_file);
    if(p.proxy_jump?.length)args.push('-J',p.proxy_jump.join(','));
    args.push(endpoint.host);
    if(p.via?.length){const inner=p.via.reduceRight((cmd,hop)=>'ssh -tt -o StrictHostKeyChecking=yes '+quoteShell(hop)+(cmd?' '+quoteShell(cmd):''),'');args.push(inner);}
    const native=p.ssh_client.startsWith('/mnt/c/')?'C:/'+p.ssh_client.slice(7):p.ssh_client;
    child=/^[A-Za-z]:/.test(native)?spawn(native,args,{stdio:['pipe','pipe','pipe'],windowsHide:true}):spawn('wsl.exe',['-d',getSettings().distribution,'--',native,...args],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  }
  else if(kind==='ssh') child=spawn('ssh.exe',['-tt',sshAlias(alias)],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  else {
    protocol=true;
    child=spawn('wsl.exe',['-d',getSettings().distribution,'--','python3',linuxPath(path.join(workerSource,'terminal.py'))],
      {stdio:['pipe','pipe','pipe'],windowsHide:true});
  }
  terminals.set(id,{child,protocol});
  if(protocol) {
    createInterface({input:child.stdout}).on('line',line=>{
      try{const value=JSON.parse(line); emit('studio:terminal',{id,...value});}catch{}
    });
  } else child.stdout.on('data',buffer=>emit('studio:terminal',{id,data:buffer.toString()}));
  child.stderr.on('data',buffer=>emit('studio:terminal',{id,data:buffer.toString()}));
  child.on('error',error=>emit('studio:terminal',{id,data:error.message}));
  child.on('exit',code=>{terminals.delete(id);emit('studio:terminal',{id,closed:true,code});});
  return {id};
});
handle('terminal.input',({id,data,cols,rows})=>{
  const terminal=terminals.get(id); if(!terminal) throw new Error('Terminal is closed');
  if(terminal.protocol) terminal.child.stdin.write(JSON.stringify(data===undefined?
    {type:'resize',cols,rows}:{type:'input',data})+'\n');
  else if(data!==undefined) terminal.child.stdin.write(data);
});
handle('terminal.close',({id})=>{terminals.get(id)?.child.kill();terminals.delete(id);});
}
