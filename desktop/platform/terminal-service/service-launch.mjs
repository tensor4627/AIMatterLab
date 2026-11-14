/** Build only the saved connection's explicit POSIX service environment. */
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const prefix='__STUDIO_SERVICE_V1__:';
export function validateServiceEnvironment(value){
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['python','activation'].includes(k))||typeof value.python!=='string'||!value.python||value.python.length>4096||/[\x00-\x1f\x7f]/.test(value.python)||!(/^[A-Za-z0-9_.+-]+$/.test(value.python)||value.python.startsWith('/'))||typeof value.activation!=='string'||Buffer.byteLength(value.activation)>8192||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.activation)||value.activation.replaceAll('\r\n','').includes('\r'))throw Error('invalid_service_environment');
 return {python:value.python,activation:value.activation.replaceAll('\r\n','\n')};
}
export function serviceLaunch(command,nonce,environment){
 const selected=validateServiceEnvironment(environment);
 if(!selected)return command+'\r';
 if(!/^[a-f0-9]{64}$/.test(nonce)||typeof command!=='string'||!command.startsWith('python3 '))throw Error('invalid_service_environment');
 command=quote(selected.python)+command.slice('python3'.length);
 const key='STUDIO_SERVICE_ENV_'+nonce.slice(0,16),run=key+'_COMMAND',lines=[];
 // Keep each physical shell input line safely below canonical TTY limits;
 // neither Python nor a base64 utility is required to activate the environment.
 for(const [name,value]of [[key,selected.activation],[run,command]]){
  lines.push(name+"=''");
  const characters=[...value];for(let offset=0;offset<characters.length;offset+=240)lines.push(name+'="$'+name+'"'+quote(characters.slice(offset,offset+240).join('')));
 }
 const frame=(kind,value)=>quote('__STUDIO_')+quote('SERVICE_V1__:')+quote(nonce+':'+kind+':-:'+Buffer.from(JSON.stringify(value)).toString('base64'));
 const failed=(code,phase)=>"printf '\\033[2J\\033[3J\\033[H%s\\r\\n' "+frame('ERROR',{code,phase})+"; printf '%s\\r\\n' "+frame('EXITED',{reason:'failed'});
 lines.push('if eval "$'+key+'"; then unset '+key+'; if eval "$'+run+'"; then :; else '+failed('python_start_failed','waiting_python')+'; fi; else unset '+key+'; '+failed('environment_activation_failed','preparing_environment')+'; fi; unset '+run);
 if(lines.some(line=>Buffer.byteLength(line)>=2048))throw Error('invalid_service_environment');
 // Shell echo cannot contain a contiguous nonce-bearing private frame prefix.
 if(lines.some(line=>line.includes(prefix+nonce+':')))throw Error('invalid_service_environment');
 return lines.join('\r')+'\r';
}
