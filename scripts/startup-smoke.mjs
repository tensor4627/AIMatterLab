// Launch the real Electron build with its normal profile. No worker or model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let playwright;
try{playwright=await import('playwright');}catch{playwright=await import(pathToFileURL(process.env.STUDIO_PLAYWRIGHT_MODULE||path.resolve(path.dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);}
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
const executable=process.env.STUDIO_STARTUP_EXECUTABLE;
const mode=executable?'packaged':'source';
const prefix=path.resolve(root,'.studio/validation',`v${version}-startup-${mode}`);
await fs.mkdir(path.dirname(prefix),{recursive:true});
const errors=[];let app;const result={version,mode,profile:process.env.STUDIO_PROFILE_DIR?'explicit':'normal-user-profile',status:'failed'};
try{
 app=await playwright._electron.launch({executablePath:executable||path.join(root,'node_modules/electron/dist/electron.exe'),args:executable?[]:[root],timeout:30000});
 const page=await app.firstWindow();page.on('pageerror',error=>errors.push(String(error)));
 await page.locator('.application').waitFor({timeout:20000});await page.waitForTimeout(1500);
 assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
 assert.equal(await page.locator('.version').innerText(),version);
 assert.equal(await page.getByTestId('view-error').count(),0);
 assert.equal(await page.locator('.sidebar').isVisible(),true);
 assert.equal(await page.evaluate(()=>typeof window.require==='undefined'&&typeof window.process==='undefined'),true);
 assert.equal(errors.length,0);
 const data=await page.evaluate(async()=>{const state=await window.studio.invoke('state');const tasks=await window.studio.invoke('task.list');return {sshProfiles:Array.isArray(state.ssh)?state.ssh.length:0,taskCount:tasks.length};});
 await page.screenshot({path:prefix+'.png'});Object.assign(result,{status:'passed',...data,uncaughtRendererErrors:errors.length});
}catch(error){Object.assign(result,{error:String(error),rendererErrors:errors});process.exitCode=1;}
finally{if(app)await app.close();await fs.writeFile(prefix+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
