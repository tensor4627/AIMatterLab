export function sshEndpoint(value){
 const legacy=typeof value.target==='string'?value.target.trim():'',parts=legacy.split('@');
 if(legacy&&(!/^[A-Za-z0-9_.@:-]+$/.test(legacy)||legacy.startsWith('-')||parts.length>2))throw Error('Invalid legacy SSH target');
 const host=(value.host||parts.at(-1)||'').trim();
 const username=(value.username??(parts.length===2?parts[0]:''))?.trim();
 if(typeof username!=='string'||!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(username))throw Error('Set an explicit SSH username');
 if(!/^[A-Za-z0-9][A-Za-z0-9.:-]{0,255}$/.test(host)||host.includes('@'))throw Error('Set a valid SSH hostname');
 return {host,username,target:username+'@'+host};
}
