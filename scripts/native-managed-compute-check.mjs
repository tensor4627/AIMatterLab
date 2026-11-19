// Opt-in native renderer acceptance with isolated profiles and synthetic outcomes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {_electron} from 'playwright';
import {requireLaunchContext,resolveDesktopBinary} from './desktop-launch.mjs';
import {frontendManagedComputeCases} from './frontend-managed-compute-cases.mjs';
import {frontendResourceConsoleCases} from './frontend-resource-console-cases.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const resourceConsole = process.argv.includes('--resource-console');
const out = path.join(root,'validation','local','managed-compute-20261119',resourceConsole?'native-resource-console':'native-renderer');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const files = new Map();
const checks = [];
const report = {mode:'native-electron',scope:'Actual App renderer and native Electron input with isolated profiles and fixture IPC, service and provider outcomes.',checks};
let server;
try {
  requireLaunchContext();
  await fs.mkdir(out,{recursive:true});
  const nativeMain = path.join(out,'managed-native-main.cjs');
  await fs.writeFile(nativeMain,
    "const {app,BrowserWindow}=require('electron');\n" +
    "app.setPath('userData',process.env.STUDIO_MANAGED_FIXTURE_PROFILE);\n" +
    "app.whenReady().then(()=>{const window=new BrowserWindow({show:false,width:Number(process.env.STUDIO_MANAGED_FIXTURE_WIDTH),height:Number(process.env.STUDIO_MANAGED_FIXTURE_HEIGHT),useContentSize:true," +
    "webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});\n" +
    "window.webContents.setWindowOpenHandler(()=>({action:'deny'}));\n" +
    "window.webContents.session.setPermissionRequestHandler((_window,_permission,reply)=>reply(false));\n" +
    "window.loadURL('about:blank');});app.on('window-all-closed',()=>app.quit());\n");
  const compiled = await build({
    root:fileURLToPath(new URL('./fixtures/managed-compute/',import.meta.url)),
    configFile:false, plugins:[react()], logLevel:'error', base:'./',
    build:{write:false,emptyOutDir:false,target:'esnext',minify:false,assetsInlineLimit:0,sourcemap:false,reportCompressedSize:false},
  });
  for (const {output} of Array.isArray(compiled) ? compiled : [compiled]) {
    for (const asset of output) files.set('/' + asset.fileName,asset.type === 'asset' ? asset.source : asset.code);
  }
  assert.ok(files.has('/index.html'),'fixture HTML is present in build output');
  server = createServer((request,response) => {
    const pathname = new URL(request.url,'http://127.0.0.1').pathname;
    const file = pathname === '/' ? '/index.html' : pathname;
    const data = files.get(file);
    if (request.method !== 'GET' || data === undefined) { response.writeHead(404).end(); return; }
    response.writeHead(200,{'Content-Type':mime[path.extname(file)] || 'application/octet-stream'});
    response.end(data);
  });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const executablePath = await resolveDesktopBinary();
  const cases = resourceConsole ? frontendResourceConsoleCases : frontendManagedComputeCases;
  await cases({out,async check(name,validate,{width=1440,height=940} = {}) {
    let application,page;
    try {
      const profile = await fs.mkdtemp(path.join(out,'managed-profile-'));
      application = await _electron.launch({executablePath,args:[nativeMain],timeout:20000,
        env:{...process.env,STUDIO_MANAGED_FIXTURE_PROFILE:profile,STUDIO_MANAGED_FIXTURE_WIDTH:String(width),STUDIO_MANAGED_FIXTURE_HEIGHT:String(height)}});
      page = await application.firstWindow();
      page.setDefaultTimeout(8000);
      const pageErrors = [];
      page.on('pageerror',error => pageErrors.push(String(error)));
      await page.route('**/*',request => request.request().url().startsWith(origin + '/') ? request.continue() : request.abort());
      await page.goto(origin + '/');
      await page.waitForFunction(() => typeof window.renderTest === 'function');
      const captureNative = async name => {
        if(resourceConsole)await page.evaluate(()=>new Promise(resolve=>{setTimeout(resolve,160);requestAnimationFrame(()=>requestAnimationFrame(resolve));}));
        const bytes = await application.evaluate(async ({BrowserWindow}) => {
          const contents = BrowserWindow.getAllWindows()[0].webContents;
          const options = {stayHidden:true,stayAwake:true};
          await contents.capturePage(undefined,options);
          contents.invalidate();
          await new Promise(resolve=>setTimeout(resolve,100));
          const image = await contents.capturePage(undefined,options);
          return image.toPNG().toString('base64');
        });
        assert.ok(bytes.length > 100,'native capture contained image data');
        await fs.writeFile(path.join(out,name+'.png'),Buffer.from(bytes,'base64'));
      };
      await validate(page,captureNative);
      assert.deepEqual(pageErrors,[]);
      const isolation = await application.evaluate(({BrowserWindow}) => {
        const window = BrowserWindow.getAllWindows()[0];
        const {sandbox,contextIsolation,nodeIntegration} = window.webContents.getLastWebPreferences();
        return {sandbox,contextIsolation,nodeIntegration,visible:window.isVisible()};
      });
      assert.deepEqual(isolation,{sandbox:true,contextIsolation:true,nodeIntegration:false,visible:false});
      assert.equal(await page.evaluate(() => typeof window.require),'undefined');
      checks.push({name,status:'passed',isolation});
    } catch (error) {
      checks.push({name,status:'failed',error:String(error.stack || error)});
      if (page && !page.isClosed()) await page.screenshot({path:path.join(out,name+'.png')}).catch(() => {});
    } finally {
      await application?.close();
    }
  }});
} catch (error) {
  report.status = error.preflight ? 'blocked' : 'failed';
  report.error = String(error.stack || error);
} finally {
  await fs.mkdir(out,{recursive:true});
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');
  if (server) await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify(report,null,2));
if (report.status || !checks.length || checks.some(result => result.status !== 'passed')) process.exitCode = 1;
