import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {createUserPermissions} from '../../backend/main/compute/user-permissions.mjs';
import {announceUpdateOnce,installerCompletedInAppUpdate,updateAnnouncement} from '../../desktop/platform/update-announcement.mjs';

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-permission-release-'));
 const profile=path.join(root,'profile');
 let catalog=new Catalog(profile);
 t.after(async()=>{catalog.db.close();await fs.rm(root,{recursive:true,force:true});});
 return {root,catalog,reopen(){catalog.db.close();catalog=new Catalog(profile);return catalog;}};
}

test('User base permissions and persisted additional approvals check path, operation and conversation separately',async t=>{
 const {root,catalog,reopen}=await fixture(t),desktopRoot=path.join(root,'app'),inside=path.join(desktopRoot,'data','x.xyz'),outside=path.join(root,'app-other','x.xyz');
 const current={provider:'codex',threadId:'a'},other={provider:'codex',threadId:'b'};
 let perms=createUserPermissions({catalog,desktopRoot});
 for(const action of ['read','write','execute']){
  assert.equal(perms.desktop(action,inside),true);
  assert.equal(perms.desktop(action,outside),false);
  assert.equal(perms.compute(action,'/data/workspace','/data/workspace/x'),true);
  assert.equal(perms.compute(action,'/data/workspace','/data/workspace-other/x'),action==='read');
 }
 perms.record(current,{id:'read',operation:'Copy this file',paths:[outside],desktopRead:{action:'import',file:outside}});
 perms.record(current,{id:'exec',operation:'outside_workspace',paths:['/elsewhere/tool']});
 perms=createUserPermissions({catalog:reopen(),desktopRoot});
 assert.equal(perms.allowsDesktopRead(current,'import',outside),true);
 assert.equal(perms.allowsDesktopRead(other,'import',outside),false);
 assert.equal(perms.allowsDesktopRead({...current,provider:'kimi'},'import',outside),false);
 assert.equal(perms.allowsDesktopRead(current,'list',outside),false);
 assert.equal(perms.revoke(other,'read'),false);
 assert.equal(perms.revoke(current,'exec'),false);
 assert.equal(perms.revoke(current,'read'),true);
 assert.equal(perms.allowsDesktopRead(current,'import',outside),false);
 assert.equal(perms.list(current).find(record=>record.id==='read').lifetime,'conversation');
 assert.equal(perms.list(current).find(record=>record.id==='exec').lifetime,'operation');
 assert.deepEqual(perms.list(other),[]);
});

test('The installed version notes remain available and a completed in-app update may show them once',async t=>{
 const {root,catalog,reopen}=await fixture(t),cache=path.join(root,'user-cache'),directory=path.join(cache,'updates'),workspace={cache};
 const notes=updateAnnouncement('0.2.13','# Changes\r\n## Unreleased\r\n- Pending\r\n## 0.2.13\r\n- New feature\r\n- Second change\r\n\r\n## 0.2.12\r\n- Previous');
 assert.deepEqual(notes,{version:'0.2.13',changes:['New feature','Second change']});
 assert.equal(await installerCompletedInAppUpdate(workspace,notes.version),false);
 await fs.mkdir(directory,{recursive:true});
 await fs.writeFile(path.join(directory,'announce-update-0.2.12.ready'),'');
 assert.equal(await installerCompletedInAppUpdate(workspace,notes.version),false);
 await fs.writeFile(path.join(directory,'announce-update-0.2.13.ready'),'');
 assert.equal(await installerCompletedInAppUpdate(workspace,notes.version),true);
 const shown=[];
 assert.equal(announceUpdateOnce(catalog,notes,value=>shown.push(value)),true);
 assert.equal(announceUpdateOnce(reopen(),notes,value=>shown.push(value)),false);
 assert.deepEqual(shown,[notes]);
});
