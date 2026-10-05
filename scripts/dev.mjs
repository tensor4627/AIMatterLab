import {spawn} from 'node:child_process';
import process from 'node:process';
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit'});
let electron;
for(let i=0;i<80;i++){
  try{if((await fetch('http://127.0.0.1:5173')).ok) break;}catch{}
  await new Promise(r=>setTimeout(r,100));
}
const {default:binary}=await import('electron');
electron=spawn(binary,['.'],{stdio:'inherit',env:{...process.env,STUDIO_DEV_URL:'http://127.0.0.1:5173'}});
function close(){vite.kill();electron?.kill();}
process.on('SIGINT',close);process.on('SIGTERM',close);
electron.on('exit',()=>{vite.kill();process.exit();});
