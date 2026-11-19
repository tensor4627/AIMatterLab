import fs from 'node:fs';
import path from 'node:path';
import {providerId} from '../../agent/providers/contracts.mjs';
function validateProviderKey(id){if(typeof id!=='string'||!/^model-provider-[a-z][a-z0-9-]{0,63}$/.test(id))providerId(id);}
export class CredentialVault{
 constructor(root,encryption,validate=validateProviderKey){this.root=root;this.encryption=encryption;this.validate=validate;fs.mkdirSync(root,{recursive:true});}
 file(id){this.validate(id);return path.join(this.root,id+'.bin');}
 has(id){return fs.existsSync(this.file(id));}
 get(id){if(!fs.existsSync(this.file(id)))return null;if(!this.encryption.isEncryptionAvailable())throw Error('System credential encryption is unavailable');return JSON.parse(this.encryption.decryptString(fs.readFileSync(this.file(id))));}
 put(id,value){if(!this.encryption.isEncryptionAvailable())throw Error('System credential encryption is unavailable');const file=this.file(id),temp=file+'.tmp';fs.writeFileSync(temp,this.encryption.encryptString(JSON.stringify(value)),{mode:0o600});fs.renameSync(temp,file);}
 remove(id){if(fs.existsSync(this.file(id)))fs.unlinkSync(this.file(id));}
}
