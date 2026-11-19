import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {workspaceManifest} from '../../scripts/workspace-installer-files.mjs';
import {installedWorkspace,studioProfileRoot,workspaceSessionDirectory} from '../../desktop/platform/studio-profile.mjs';
import {discoverSources} from '../../backend/main/tools/source-projects.mjs';

const repo=fileURLToPath(new URL('../../',import.meta.url));
const script=path.join(repo,'build','workspace-files.ps1');
const pkg=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8'));
const create=(dir,name,body='fixture')=>{const file=path.join(dir,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);return file;};
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aimlab-installer-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const payload=path.join(dir,'payload'),workspace=path.join(dir,'中文 workspace'),manifest=path.join(dir,'program.files');
 create(payload,'AIMatterLab.exe');create(payload,'resources/app.asar');create(payload,'resources/sub/part.bin');
 fs.writeFileSync(manifest,workspaceManifest(payload));
 const run=mode=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Mode',mode,'-Workspace',workspace,'-Manifest',manifest],{encoding:'utf8',windowsHide:true,timeout:45000});
 return {payload,workspace,run};
}
test('Windows release uses an assisted setup and a direct workspace directory selection',()=>{
 assert.deepEqual(pkg.build.win.target,['nsis','zip']);assert.equal(pkg.build.nsis.oneClick,false);
 assert.equal(pkg.build.nsis.createDesktopShortcut,'always');assert.equal(pkg.build.nsis.deleteAppDataOnUninstall,false);
 const include=fs.readFileSync(path.join(repo,pkg.build.nsis.include),'utf8');
 assert.match(include,/MUI_PAGE_DIRECTORY/);assert.match(include,/customRemoveFiles/);assert.doesNotMatch(include,/RMDir\s+\/r/i);
 assert.match(include,/File \/oname=\$PLUGINSDIR\\workspace-guide\.md "\$\{PROJECT_DIR\}\\installation\\workspace-guide\.md"/);
 assert.match(include,/CopyFileW\(w "\$PLUGINSDIR\\workspace-guide.md", w "\$INSTDIR\\AGENTS.md", i 1\)/);
});
test('the embedded manifest cannot take ownership of a user directory or project prompt',t=>{
 const {payload}=fixture(t);
 for(const name of ['AGENTS.md','user-cache/data','sources/engine','projects/research','.config/catalog','.aimatterlab-workspace']){
  const file=create(payload,name);assert.throws(()=>workspaceManifest(payload),/Unexpected installer payload/);
  fs.rmSync(name.includes('/')?path.dirname(file):file,{recursive:true});
 }
});
test('install, update and uninstall preserve unknown files, profiles, cache, sources and prompts',{skip:process.platform!=='win32'},t=>{
 const {payload,workspace,run}=fixture(t);
 const paths=['.config/ssh.json','user-cache/skills/user/custom/SKILL.md','sources/pydyn/research','AGENTS.md','my-data.txt'];
 for(const name of paths)create(workspace,name,'user data');
 let result=run('Install');assert.equal(result.status,0,result.stderr);
 fs.cpSync(payload,workspace,{recursive:true});paths.push('resources/user-added.txt');create(workspace,paths.at(-1),'user data');
 assert.equal(run('Install').status,0);result=run('Remove');assert.equal(result.status,0,result.stderr);
 for(const name of paths)assert.equal(fs.readFileSync(path.join(workspace,name),'utf8'),'user data');
 assert.equal(fs.existsSync(path.join(workspace,'AIMatterLab.exe')),false);
 assert.equal(fs.existsSync(path.join(workspace,'resources','sub')),false);
});
test('unrelated conflicting packages and linked program folders cannot claim a workspace',{skip:process.platform!=='win32'},t=>{
 const {workspace,payload,run}=fixture(t);
 const conflict=create(workspace,'resources/app.asar','other product');assert.notEqual(run('Install').status,0);
 assert.equal(fs.readFileSync(conflict,'utf8'),'other product');fs.rmSync(path.dirname(conflict),{recursive:true});
 fs.symlinkSync(path.join(payload,'resources'),path.join(workspace,'resources'),'junction');
 assert.notEqual(run('Install').status,0);assert.notEqual(run('Remove').status,0);
 assert.equal(fs.readFileSync(path.join(payload,'resources/app.asar'),'utf8'),'fixture');
});
test('installer-selected workspace overrides a surrounding checkout and uses its own source directory',t=>{
 const {workspace}=fixture(t), options={isPackaged:true,execPath:path.join(workspace,'AIMatterLab.exe')};
 create(path.dirname(workspace),'package.json',JSON.stringify({name:'aimatterlab'}));create(path.dirname(workspace),'desktop/main.mjs');
 assert.equal(installedWorkspace(options),null);create(workspace,'.aimatterlab-workspace','AIMatterLab workspace v1');
 assert.equal(studioProfileRoot(options),path.join(workspace,'.config'));
 const layout=installedWorkspace(options);assert.equal(layout.cache,path.join(workspace,'user-cache'));
 const profile=studioProfileRoot(options),session=workspaceSessionDirectory(layout,profile);
 assert.equal(session,path.join(layout.cache,'chromium'));assert.ok(fs.statSync(session).isDirectory());
 create(profile,'Preferences','{}');assert.equal(workspaceSessionDirectory(layout,profile),session);
 const oldCache=path.join(workspace,'previous-cache');create(profile,'Local Storage/leveldb/legacy','saved draft');
 assert.equal(workspaceSessionDirectory({...layout,cache:oldCache},profile),profile);
 create(layout.sources,'pydyn/pyproject.toml');fs.mkdirSync(path.join(layout.sources,'pydyn','pydyn'));
 assert.deepEqual(discoverSources({workspaceSources:layout.sources,ids:['pydyn']}).map(s=>s.root),[path.join(layout.sources,'pydyn')]);
 assert.deepEqual(discoverSources({workspaceSources:layout.sources,ids:[]}),[]);
});
