import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {appOwnershipPath,appPathKind,formatAppInventory,parseAppInventory,runtimeMarkerPath} from '../desktop/platform/app-payload.mjs';
import {fileDigest} from '../desktop/platform/update-release.mjs';
import {verifyBundledGuidance} from './check-bundled-guidance.mjs';

// The uninstaller embeds this list. Workspace files are never removal inputs.
export function workspaceManifest(appDir) {
  const entries = [];
  const reserved = new Set(['.config', 'user-cache', 'sources', 'projects', 'agents.md', '.aimatterlab-workspace', 'debug.log']);
  function visit(relative) {
    for (const entry of fs.readdirSync(path.join(appDir, relative), {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      const name = path.join(relative, entry.name);
      if ((!relative && reserved.has(entry.name.toLowerCase())) || /[\r\n|]/.test(name) || entry.isSymbolicLink()) throw Error('Unexpected installer payload: '+name);
      if (!entry.isFile() && !entry.isDirectory()) throw Error('Unsupported payload entry: '+name);
      entries.push((entry.isDirectory() ? 'D|' : 'F|') + name.split(path.sep).join('\\'));
      if (entry.isDirectory()) visit(name);
    }
  }
  visit('');
  if (!entries.includes('F|AIMatterLab.exe') || !entries.includes('F|resources\\app.asar')) throw Error('Missing Windows workspace payload');
  return entries.join('\n') + '\n';
}

function inventoryEntries(manifest) {
  return manifest.trimEnd().split('\n').map(line=>[line[0],line.slice(2).replaceAll('\\','/')]);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value!=='object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
}

export function mutableInventory(manifest) {
  const directories = [], files = [];
  for (const [type,name] of inventoryEntries(manifest)) {
    if (appPathKind(name)) (type==='D' ? directories : files).push(name);
  }
  return parseAppInventory(formatAppInventory({directories,files}));
}

export async function runtimeAbiVersion({appDir,electronExe,profile,configurationFiles=[]}) {
  const hash = createHash('sha256');
  const add = (...fields) => hash.update(JSON.stringify(fields)+'\n');
  const digest = file => fileDigest(file,'sha256','hex');
  add('AIMatterLab Windows runtime v1',canonical(profile),await digest(electronExe));
  for (const [name,file] of configurationFiles) add('config',name,await digest(file));
  for (const [type,name] of inventoryEntries(workspaceManifest(appDir)).sort((a,b)=>a[1]<b[1]?-1:a[1]>b[1]?1:0)) {
    if (name==='AIMatterLab.exe' || name===appOwnershipPath || name===runtimeMarkerPath || appPathKind(name)) continue;
    add(type,name,type==='F' ? await digest(path.join(appDir,name)) : null);
  }
  return hash.digest('hex');
}

async function stageLayeredFiles({appOutDir,packager,arch}) {
  const {config,projectDir} = packager;
  const dist = path.resolve(projectDir,config.electronDist || 'node_modules/electron/dist');
  const electronExe = path.join(dist,'electron.exe');
  // Shells that enforce the embedded ASAR digest or disable Node mode use NSIS.
  if (!fs.existsSync(electronExe) || config.electronFuses?.enableEmbeddedAsarIntegrityValidation ||
      config.electronFuses?.runAsNode===false) return;
  const helperRoot = path.join(appOutDir,'resources','studio-updater');
  const helperFiles = ['contracts/update-publisher.pem','desktop/platform/app-payload.mjs','desktop/platform/update-release.mjs',
    'desktop/platform/app-update-transaction.mjs','desktop/platform/app-update-helper.mjs'];
  for (const name of helperFiles) {
    const target = path.join(helperRoot,name);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(path.join(projectDir,name),target);
  }
  const profile = {arch,appId:config.appId,productName:config.productName,electronFuses:config.electronFuses??null,
    electron:packager.info.framework.version,builder:JSON.parse(fs.readFileSync(path.join(projectDir,'node_modules/electron-builder/package.json'),'utf8')).version,
    nsis:config.nsis??{}};
  const configurationFiles = [config.nsis?.include, 'build/workspace-files.ps1',config.win?.icon,
    'desktop/entry.mjs','desktop/platform/layered-update.mjs'].filter(Boolean).map(name=>[name,path.resolve(projectDir,name)]);
  const version = await runtimeAbiVersion({appDir:appOutDir,electronExe,profile,configurationFiles});
  const inventory = mutableInventory(workspaceManifest(appOutDir));
  fs.writeFileSync(path.join(appOutDir,appOwnershipPath),formatAppInventory(inventory));
  fs.writeFileSync(path.join(appOutDir,runtimeMarkerPath),JSON.stringify({schemaVersion:1,runtimeAbiVersion:version,
    installerVersion:packager.appInfo.version})+'\n');
  console.log('AIMatterLab layered update runtime ABI '+version);
}

export default async function afterPack({electronPlatformName,appOutDir,packager,arch}) {
  if (electronPlatformName !== 'win32') return;
  // The local Electron distribution may have a log from a previous launch.
  fs.rmSync(path.join(appOutDir, 'debug.log'), {force:true});
  const guidance = await verifyBundledGuidance({appOutDir,projectDir:packager.projectDir});
  console.log('Verified packaged AIMatterLab guidance: '+JSON.stringify(guidance));
  await stageLayeredFiles({appOutDir,packager,arch});
  const directory = path.join(packager.projectDir, '.studio', 'installer');
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,packager.appInfo.version+'-win.files'),workspaceManifest(appOutDir));
}
