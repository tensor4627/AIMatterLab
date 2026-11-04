import fs from 'node:fs';
import path from 'node:path';
import {providerId} from '../../agent/providers/contracts.mjs';
export class CredentialVault{
 constructor(root,encryption){this.root=root;this.encryption=encryption;fs.mkdirSync(root,{recursive:true});}
 file(id){providerId(id);return path.join(this.root,id+'.bin');}
 get(id){if(!fs.existsSync(this.file(id)))return null;if(!this.encryption.isEncryptionAvailable())throw Error('System credential encryption is unavailable');return JSON.parse(this.encryption.decryptString(fs.readFileSync(this.file(id))));}
 put(id,value){if(!this.encryption.isEncryptionAvailable())throw Error('System credential encryption is unavailable');const file=this.file(id),temp=file+'.tmp';fs.writeFileSync(temp,this.encryption.encryptString(JSON.stringify(value)),{mode:0o600});fs.renameSync(temp,file);}
 remove(id){if(fs.existsSync(this.file(id)))fs.unlinkSync(this.file(id));}
}
