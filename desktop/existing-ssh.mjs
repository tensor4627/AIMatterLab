import fs from 'node:fs';
import path from 'node:path';
// Read only the existing connection source. No raw connection list is copied or packaged.
export function existingConnections(home){
 const file=path.join(home,'.codex','.codex-global-state.json');
 if(!fs.existsSync(file))return [];
 let items;try{items=JSON.parse(fs.readFileSync(file,'utf8'))['codex-managed-remote-connections']||[];}catch{return [];}
 return items.filter(c=>typeof c.hostname==='string').map((c,index)=>({ref:c.hostId||'existing-'+index,label:'已有连接 '+(index+1)}));
}
export function existingProfile(home,ref){
 const data=JSON.parse(fs.readFileSync(path.join(home,'.codex','.codex-global-state.json'),'utf8'));
 const c=(data['codex-managed-remote-connections']||[]).find((v,i)=>(v.hostId||'existing-'+i)===ref);
 if(!c)throw Error('Existing connection no longer available');
 return {name:'已有集群',scheduler:'lsf',target:c.hostname,port:c.sshPort||22,identity_file:c.identity||path.join(home,'.ssh','id_rsa'),
  ssh_client:'/mnt/c/Windows/System32/OpenSSH/ssh.exe',via:[],remote_root:'~/.gpu-sampling-studio/runs',
  environment:{executables:{python:'/usr/bin/python3'},repositories:{},variables:{}},activation:'',
  queue:'',limits:{cpus:64,gpus:8,memory_mb:262144}};
}
