// Run the managed SSH panel with native Electron input and a fresh local profile.
// --browser selects headless Edge. --baseline=<checkout> reproduces the older receipt.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import react from '@vitejs/plugin-react';
import {chromium, _electron} from 'playwright';
import {createServer} from 'vite';
import {requireLaunchContext, resolveDesktopBinary} from './desktop-launch.mjs';

const argv = process.argv.slice(2);
const browserMode = argv.includes('--browser');
const oldCheckout = argv.find(value => value.startsWith('--baseline='))?.slice('--baseline='.length);
const root = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = oldCheckout ? path.resolve(oldCheckout) : root;
const sourceVersion = JSON.parse(await fs.readFile(path.join(sourceRoot, 'package.json'), 'utf8')).version;
const outputRoot = path.join(root, 'validation', 'local', 'ssh-publish-toolbar',
  (oldCheckout ? 'baseline-' : 'candidate-') + (browserMode ? 'edge' : 'electron'));
await fs.mkdir(outputRoot, {recursive:true});
const {createManagedComputeResources} = await import(pathToFileURL(path.join(sourceRoot,
  'backend/main/compute/managed-compute-resources.mjs')).href);

// The registry and connection proof are synthetic. Production manager.publish
// validates those inputs and returns its own receipt through the fixture bridge.
const profile = {id:'fixture-ssh', version:1, kind:'ssh', name:'隔离 SSH 布局验收连接',
  host:'fixture.invalid', username:'fixture', port:22, ssh_client:'ssh', mode:'interactive'};
const connectionId = 'fixture-connection';
let connection;
const sessions = [];
const calls = [];
const publications = [];
let authInput = '';
let readError = false;
let verifyConnection = true;
let exposeSnapshot = false;
const manager = createManagedComputeResources({profiles:{read:({id}) => id === profile.id ? profile : undefined},
  terminal:{connections:{state:async({connectionId:id}) => id === connectionId && verifyConnection ? connection : undefined}}});

function addSession() {
  const session = {sessionId:'fixture-shell-' + (sessions.length + 1), connectionId, name:'Fixture shell',
    kind:'ssh', mode:'interactive', owner:'human', ownerEpoch:1, alive:true, status:'running',
    resource:{kind:'ssh-connection', connectionId, profileId:profile.id, profileVersion:profile.version}};
  sessions.push(session);
  connection = {...connection, terminalSessionIds:sessions.map(value => value.sessionId), revision:connection.revision + 1};
  return session;
}

async function invoke(method, data) {
  calls.push({method, data});
  switch (method) {
    case 'compute.managed.snapshot': return {resources:exposeSnapshot ? manager.snapshot() : [], conversations:[], sources:[]};
    case 'compute.resourceWorkspace.preview': {
      const root='/fixture/AIMatterLab';
      return {...data,root,directories:[root+'/workfile',root+'/software'],status:'confirmed',source:'confirmed',account:'fixture',hostname:'fixture-host',resourceName:profile.name,checkedAt:Date.now()};
    }
    case 'compute.managed.publish':
      try {
        const receipt = await manager.publish(data);
        publications.push({receipt});
        return receipt;
      } catch (error) {
        publications.push({error:error.message});
        throw error;
      }
    case 'compute.sshConnection.list': return {connections:connection ? [connection] : []};
    case 'compute.sshConnection.open':
      assert.equal(connection, undefined, 'The fixture only accepts one login');
      connection = {schemaVersion:2, connectionId, loginRequestId:data.requestId, profileId:profile.id,
        profileVersion:profile.version, status:'authenticating', authentication:'pending', capabilities:{multiplex:true},
        terminalSessionIds:[], serviceIds:[], revision:1};
      return connection;
    case 'compute.sshConnection.authRead': return {connectionId, state:connection,
      output:data.cursor ? '' : 'Isolated SSH fixture\r\nEnter fixture code: ', cursor:1, dropped:false};
    case 'compute.sshConnection.authInput': authInput += data.data; return {accepted:true};
    case 'compute.sshConnection.completeLogin':
    case 'compute.sshConnection.loginStatus': {
      assert.deepEqual(data, {connectionId, requestId:connection.loginRequestId});
      if (connection.status === 'authenticated') return {connection, login:{status:'complete'}};
      if (authInput !== '42\r') return {connection, login:{status:'waiting_authentication'}};
      connection = {...connection, status:'authenticated', authentication:'verified'};
      const shell = addSession();
      return {connection, shell, login:{status:'complete'}};
    }
    case 'compute.sshConnection.openShell': return addSession();
    case 'compute.managed.serviceStatus':
    case 'compute.sshService.status': return {schemaVersion:2, connectionId, status:'disconnected', workflowReady:false};
    case 'sharedTerminal.list': return {sessions};
    case 'sharedTerminal.read': {
      if (readError) throw Error('terminal_session_exited');
      const session = sessions.find(value => value.sessionId === data.sessionId);
      assert.ok(session);
      return {...session, output:data.cursor ? '' : 'Isolated SSH shell\r\nfixture@local:~$ ', cursor:1, dropped:false};
    }
    case 'compute.sshConnection.authResize':
    case 'sharedTerminal.resize': return {accepted:true};
    default: throw Error('Unexpected fixture IPC ' + method);
  }
}

const frontend = name => JSON.stringify('/@fs/' + path.join(sourceRoot, 'frontend', name).replaceAll(path.sep, '/'));
const harness = path.join(outputRoot, 'harness.html');
const nativeMain = path.join(outputRoot, 'native-main.cjs');
const report = {mode:browserMode ? 'headless-edge' : 'hidden-electron', sourceVersion,
  scope:'Production SharedTerminalPanel, SshConnectionPanel, xterm and publish manager. Isolated window, synthetic login, connection proof and shell I/O.', checks:[]};
let server, application, browser, page;
const rendererErrors = [];

async function capture(name, area) {
  const file = path.join(outputRoot, name + '.png');
  if (!application) {
    await page.screenshot({path:file, clip:area, animations:'disabled'});
    return;
  }
  const bytes = await application.evaluate(async ({BrowserWindow}, clip) => {
    const {webContents} = BrowserWindow.getAllWindows()[0];
    const frame = () => webContents.capturePage(clip, {stayHidden:true, stayAwake:true});
    // The first hidden capture can still return the last compositor frame.
    await frame();
    await new Promise(resolve => setTimeout(resolve, 75));
    const image = await frame();
    return image.toPNG().toString('base64');
  }, area);
  assert.ok(bytes.length > 100, 'Native capture returned an image');
  await fs.writeFile(file, Buffer.from(bytes, 'base64'));
}

try {
  if (!browserMode) requireLaunchContext();
  await fs.writeFile(harness, `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><body>
    <div id="root" style="width:1577px;height:346px"></div><script type="module">
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import SharedTerminalPanel from ${frontend('features/terminal/SharedTerminalPanel.tsx')};
      import {ConfirmProvider} from ${frontend('ui/ConfirmDialog.tsx')};
      import {ToastProvider} from ${frontend('ui/Toast.tsx')};
      import ${frontend('app/style.css')};
      const listeners = new Set(), fixture = window.sshFixture = {errors:[], settings:[], resizes:[],
        emit(method) { for (const listen of listeners) listen({method,params:{}}); }};
      window.studio = {
        onEvent(callback) { listeners.add(callback); return () => listeners.delete(callback); },
        async invoke(method, data) {
          if (method === 'sharedTerminal.resize') fixture.resizes.push(data);
          return await window.invokeSshFixture(method, data);
        },
      };
      createRoot(document.getElementById('root')).render(React.createElement(ToastProvider,null,React.createElement(ConfirmProvider,null,React.createElement(SharedTerminalPanel, {
        visible:true, canShare:true, provider:'codex', resourceScope:'fixture',
        request:{nonce:'fixture-login', kind:'ssh', mode:'interactive', connectionMode:'managed',
          profileId:${JSON.stringify(profile.id)}, version:${profile.version}, profileName:${JSON.stringify(profile.name)}},
        onError:error => fixture.errors.push({code:error.code, action:error.action, message:error.message, presentation:error.presentation}),
        onConfigureSsh:target => fixture.settings.push(target),
      }))));
    </script></body></html>`);
  server = await createServer({root, configFile:false, plugins:[react()], logLevel:'error',
    cacheDir:path.join(outputRoot, 'vite'), optimizeDeps:{entries:[harness]}, server:{host:'127.0.0.1', port:0,
      hmr:false, fs:{allow:[root, sourceRoot, path.resolve(root,'../../node_modules')]}, watch:{ignored:['**/.studio/**','**/validation/**']}}});
  await server.listen();
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  if (browserMode) {
    browser = await chromium.launch({channel:process.env.STUDIO_BROWSER_CHANNEL || 'msedge', headless:true});
    page = await browser.newPage({viewport:{width:1600, height:480}});
  } else {
    await fs.writeFile(nativeMain, `const {app,BrowserWindow}=require('electron');
      app.setPath('userData',process.env.STUDIO_SSH_FIXTURE_PROFILE);
      app.whenReady().then(() => {
        const window = new BrowserWindow({width:1600,height:480,show:false,useContentSize:true,
          webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
        window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
        window.webContents.session.setPermissionRequestHandler((_w,_p,reply) => reply(false));
        window.loadURL('about:blank');
      });
      app.on('window-all-closed',() => app.quit());`);
    const userData = await fs.mkdtemp(path.join(outputRoot, 'profile-'));
    application = await _electron.launch({executablePath:await resolveDesktopBinary(), args:[nativeMain], timeout:20000,
      env:{...process.env, STUDIO_SSH_FIXTURE_PROFILE:userData}});
    page = await application.firstWindow();
    report.window = await application.evaluate(({BrowserWindow}) => {
      const window = BrowserWindow.getAllWindows()[0];
      const {sandbox, contextIsolation, nodeIntegration} = window.webContents.getLastWebPreferences();
      return {visible:window.isVisible(), sandbox, contextIsolation, nodeIntegration};
    });
    assert.deepEqual(report.window, {visible:false, sandbox:true, contextIsolation:true, nodeIntegration:false});
  }
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => rendererErrors.push(String(error)));
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.exposeBinding('invokeSshFixture', async (_source, method, data) => invoke(method, data));
  const url = origin + '/' + path.relative(root, harness).split(path.sep).join('/');
  await page.goto(url);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');

  const panel = page.getByTestId('ssh-connection-panel');
  const shell = panel.getByRole('region', {name:'SSH 终端', exact:true});
  const errors = () => page.evaluate(() => window.sshFixture.errors);
  async function measure(name, width, height=346, theme='dark') {
    await page.evaluate(({width,height,theme}) => {
      document.documentElement.dataset.theme = theme;
      Object.assign(document.getElementById('root').style, {width:width+'px', height:height+'px'});
    }, {width,height,theme});
    await page.waitForFunction(() => {
      const host = document.querySelector('.shared-terminal-host');
      const grid = host?.querySelector('.xterm-screen');
      const size = window.sshFixture.resizes.at(-1);
      return !!size && grid?.clientHeight > 0 && host.clientHeight - grid.clientHeight >= 10
        && host.clientHeight - grid.clientHeight < 37 && host.clientWidth >= grid.clientWidth
        && host.clientWidth - grid.clientWidth < 38;
    });
    const geometry = await panel.evaluate(panel => {
      const bounds = node => {
        const {x,y,width,height} = node.getBoundingClientRect();
        return {x,y,width,height};
      };
      const pane = bounds(panel);
      const terminal = bounds(panel.querySelector('.shared-terminal-host'));
      const grid = bounds(panel.querySelector('.xterm-screen'));
      const size = window.sshFixture.resizes.at(-1);
      const visibleHeight = value => Math.max(0, Math.min(pane.y + pane.height, value.y + value.height) - Math.max(pane.y, value.y));
      const visibleGridHeight = visibleHeight(grid);
      const rowHeight = grid.height / size.rows;
      return {panel:pane, terminal, grid, rowHeight, visibleTerminalHeight:visibleHeight(terminal), visibleGridHeight,
        visibleRows:Math.floor(visibleGridHeight / rowHeight),
        toolbars:[...panel.querySelectorAll('.shared-terminal-toolbar')].map(bounds),
        scrollWidth:panel.scrollWidth, scrollHeight:panel.scrollHeight, size};
    });
    assert.equal(geometry.panel.width, width);
    assert.equal(geometry.panel.height, height);
    assert.ok(geometry.terminal.height <= height && geometry.size.rows > 0, JSON.stringify(geometry));
    report.checks.push({name, theme, ...geometry});
    await capture(name, geometry.panel);
    return geometry;
  }

  async function assertOneLine(geometry, controls) {
    assert.equal(geometry.toolbars.length, 1, JSON.stringify(geometry));
    const [toolbar] = geometry.toolbars;
    assert.ok(toolbar.height <= 44 && geometry.terminal.height >= geometry.panel.height - 45, JSON.stringify(geometry));
    assert.equal(geometry.scrollWidth, geometry.panel.width, JSON.stringify(geometry));
    assert.equal(geometry.scrollHeight, geometry.panel.height, JSON.stringify(geometry));
    assert.equal(geometry.visibleRows, geometry.size.rows, JSON.stringify(geometry));
    for (const control of controls) {
      const box = await control.boundingBox();
      assert.ok(box && box.x >= toolbar.x && box.x + box.width <= toolbar.x + toolbar.width
        && box.y >= toolbar.y && box.y + box.height <= toolbar.y + toolbar.height, JSON.stringify({box, toolbar}));
    }
  }

  const auth = panel.getByRole('region', {name:'SSH 登录终端', exact:true});
  await auth.locator('.xterm').waitFor();
  await auth.click({position:{x:30,y:30}});
  await page.keyboard.type('42');
  await page.keyboard.press('Enter');
  await shell.locator('.xterm').waitFor();
  assert.equal(authInput, '42\r');
  assert.equal(await panel.getByTestId('ssh-connection-status').innerText(), '已连接');
  const publish = panel.getByTestId('ssh-publish-resource');
  const refresh = panel.getByTestId('ssh-login-refresh');
  const settings = panel.getByTestId('ssh-edit-connection');

  const unpublished = await measure('01-authenticated', 1577);
  if (oldCheckout) {
    await publish.click();
    await panel.getByTestId('ssh-error-code').getByText('ssh_connection_changed', {exact:true}).waitFor();
    await measure('02-false-connection-changed', 1577);
    assert.equal(manager.snapshot()[0].connectionId, connectionId);
    exposeSnapshot = true;
    await page.evaluate(() => window.sshFixture.emit('studio/managedActivity'));
    await publish.getByText('已由 AIMatterLab 管理', {exact:true}).waitFor();
    await measure('03-managed-with-false-error', 1577);
    assert.equal((await errors())[0].code, 'ssh_connection_changed');
  } else {
    const more = panel.getByTestId('ssh-more');
    const details = panel.getByTestId('ssh-diagnostic-toggle');
    await assertOneLine(unpublished, [publish, refresh, settings, more]);
    await assertOneLine(await measure('02-narrow-authenticated', 440, 300, 'light'), [publish, refresh, settings, more]);

    verifyConnection = false;
    await publish.click();
    await panel.getByTestId('ssh-diagnostics').waitFor();
    assert.deepEqual(manager.snapshot(), []);
    assert.deepEqual(publications, [{error:'managed_compute_authentication_required'}]);
    const [publishError] = await errors();
    assert.equal(publishError.code, 'managed_compute_authentication_required');
    assert.equal(publishError.action, 'compute.managed.publish');
    assert.equal(publishError.presentation, 'inline');
    await details.press('Enter');
    await panel.getByTestId('ssh-error-code').waitFor();
    assert.equal(await panel.getByTestId('ssh-error-code').innerText(), publishError.code);
    await details.press('Escape');
    verifyConnection = true;
    await refresh.click();
    await publish.click();
    const managed = panel.getByTestId('ssh-managed-status');
    await managed.waitFor();
    assert.equal(exposeSnapshot, false, 'The publish receipt updates the renderer before snapshot refresh');
    assert.deepEqual(publications[1].receipt, manager.snapshot()[0]);
    assert.equal(manager.snapshot()[0].connectionId, connectionId);
    assert.ok(!(await errors()).some(error => error.code === 'ssh_connection_changed'));
    assert.equal(await panel.getByTestId('ssh-diagnostics').isVisible(), false);
    await assertOneLine(await measure('03-managed', 1577), [managed, refresh, settings, more]);
    exposeSnapshot = true;
    await page.evaluate(() => window.sshFixture.emit('studio/managedActivity'));
    await assertOneLine(await measure('04-narrow-managed-light', 440, 300, 'light'), [managed, refresh, settings, more]);

    await settings.click();
    assert.deepEqual(await page.evaluate(() => window.sshFixture.settings), [{profileId:profile.id, profileVersion:1}]);
    await more.press('Enter');
    const newShell = panel.getByTestId('ssh-open-shell');
    for (const action of [newShell, panel.getByTestId('ssh-shell-close'), panel.getByTestId('ssh-connection-close')]) {
      await action.waitFor();
      const box = await action.boundingBox(), bounds = await panel.boundingBox();
      assert.ok(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width
        && box.y >= bounds.y && box.y + box.height <= bounds.y + bounds.height, JSON.stringify({box,bounds}));
    }
    await measure('05-narrow-more-open', 440, 300, 'light');
    await more.press('Escape');
    await newShell.waitFor({state:'hidden'});
    await more.press('Enter');
    await newShell.click();
    await page.waitForFunction(() => window.sshFixture.resizes.at(-1)?.sessionId === 'fixture-shell-2');

    readError = true;
    await details.waitFor();
    await details.press('Enter');
    const readDetail = panel.getByTestId('ssh-read-error-code');
    await readDetail.waitFor();
    assert.equal(await readDetail.innerText(), 'terminal_session_exited');
    await measure('06-narrow-read-diagnostic', 440, 300, 'light');
    readError = false;
    await details.waitFor({state:'hidden'});
    assert.deepEqual(await errors(), [publishError]);
  }

  assert.deepEqual(rendererErrors, []);
  assert.equal(calls.filter(call => call.method === 'compute.sshConnection.open').length, 1);
  assert.equal(calls.filter(call => call.method === 'compute.managed.publish').length, oldCheckout ? 1 : 2);
  report.publish = {calls:calls.filter(call => call.method === 'compute.managed.publish'), publications, resources:manager.snapshot(),
    openLoginCount:1, authInputDelivered:true, shellIds:sessions.map(value => value.sessionId), rendererDiagnostics:await errors()};
  report.status = oldCheckout ? 'reproduced' : 'passed';
} catch (error) {
  report.status = error.preflight ? 'blocked' : 'failed';
  report.error = String(error.stack || error);
  if (page && !page.isClosed()) await capture('failure', {x:0,y:0,width:1577,height:346}).catch(() => {});
  process.exitCode = 1;
} finally {
  await application?.close();
  await browser?.close();
  await server?.close();
  await manager.stop();
  await fs.writeFile(path.join(outputRoot, 'results.json'), JSON.stringify({...report,rendererErrors}, null, 2)+'\n');
}
console.log(JSON.stringify({outputRoot, ...report}, null, 2));
