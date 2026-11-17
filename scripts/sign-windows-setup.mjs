import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {publisherThumbprint} from '../desktop/platform/update-release.mjs';

const script = fileURLToPath(new URL('./windows-release-signature.ps1',import.meta.url));
export function releaseSignature(mode, file) {
  return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,
    '-Mode',mode,'-Path',file,'-Thumbprint',publisherThumbprint], {windowsHide:true,encoding:'utf8'}).trim();
}

// NSIS builds its block map after this hook, so it describes the signed bytes.
export default function sign({path}) {
  if (/-win-x64-setup\.exe$/i.test(path)) releaseSignature('Installer',path);
}
