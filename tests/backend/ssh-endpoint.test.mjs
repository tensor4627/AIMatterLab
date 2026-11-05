import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sshEndpoint} from "../../backend/main/compute/ssh-endpoint.mjs";
import {existingProfile,existingConnections} from "../../backend/main/compute/existing-ssh.mjs";

test('SSH users are explicit, editable, and never inherit the Windows user',()=>{
 assert.deepEqual(sshEndpoint({target:'remote@example.test'}),{host:'example.test',username:'remote',target:'remote@example.test'});
 assert.equal(sshEndpoint({target:'old@example.test',host:'example.test',username:'edited'}).username,'edited');
 for(const value of [{host:'example.test'},{host:'example.test',username:''},{host:'-oBad',username:'remote'},{host:'example.test',username:'remote;bad'}])assert.throws(()=>sshEndpoint(value));
});
test('Existing imports split user@host without exposing connection details in the list',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-ssh-import-')),directory=path.join(root,'.codex'),file=path.join(directory,'.codex-global-state.json');
 try{
  fs.mkdirSync(directory);fs.writeFileSync(file,JSON.stringify({'codex-managed-remote-connections':[{hostId:'fixture-id',hostname:'remote@example.test',sshPort:22,identity:null}]}));
  const list=existingConnections(root);assert.deepEqual(list,[{ref:'fixture-id',label:'已有连接 1'}]);
  const imported=existingProfile(root,'fixture-id');assert.equal(imported.host,'example.test');assert.equal(imported.username,'remote');
 }finally{fs.unlinkSync(file);fs.rmdirSync(directory);fs.rmdirSync(root);}
});
