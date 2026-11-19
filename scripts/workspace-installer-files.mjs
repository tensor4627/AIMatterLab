import fs from 'node:fs';
import path from 'node:path';
import {verifyBundledGuidance} from './check-bundled-guidance.mjs';

// The uninstaller embeds this list. Workspace files are never removal inputs.
export function workspaceManifest(appDir) {
  const entries = [];
  const reserved = new Set(['.config', 'user-cache', 'sources', 'projects', 'agents.md', '.aimatterlab-workspace']);
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

export default async function afterPack({electronPlatformName,appOutDir,packager}) {
  if (electronPlatformName !== 'win32') return;
  const guidance = await verifyBundledGuidance({appOutDir,projectDir:packager.projectDir});
  console.log('Verified packaged AIMatterLab guidance: '+JSON.stringify(guidance));
  const directory = path.join(packager.projectDir, '.studio', 'installer');
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,packager.appInfo.version+'-win.files'),workspaceManifest(appOutDir));
}
