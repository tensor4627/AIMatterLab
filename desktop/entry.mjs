import {app,dialog} from 'electron';
import {prepareLayeredStartup} from './platform/layered-update.mjs';
import {installedWorkspace} from './platform/studio-profile.mjs';

const verificationFlags = ['--studio-verify','--studio-install-verify','--studio-improvements-verify','--studio-providers-verify'];
const managed = process.platform==='win32' && process.arch==='x64' && !process.env.STUDIO_PROFILE_DIR &&
  !verificationFlags.some(flag=>process.argv.includes(flag));
let startup = 'normal';
try {
  const workspace = managed ? installedWorkspace({isPackaged:app.isPackaged,execPath:process.execPath}) : null;
  if (workspace) startup = await prepareLayeredStartup({workspace,currentVersion:app.getVersion()});
  if (startup==='exit') app.exit(0);
  else await import('./main.mjs');
} catch (error) {
  console.error(error);
  if (startup!=='trial') dialog.showErrorBox('AIMatterLab',String(error.message || error));
  app.exit(1);
}
