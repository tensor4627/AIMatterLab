import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { openNativeSsh } from '../../desktop/platform/terminal-service/native-ssh.mjs';

test('a missing Windows OpenSSH executable fails before launching a PTY',async()=>{
  const file=fileURLToPath(new URL('./missing-fixture-ssh.exe',import.meta.url));
  await assert.rejects(openNativeSsh({pty:{spawn:()=>assert.fail('unexpected spawn')},plan:{file}}),/ssh_windows_client_unavailable/);
});

test(
  'native login attaches OpenSSH to the console and keeps MFA and node selection private until handoff',
  { skip: process.platform !== 'win32', timeout: 12000 },
  async (t) => {
    const auth = [],
      lost = [],
      sizes = [],
      received = [];
    const events = new EventEmitter();
    const output = (text) => events.emit('data', text);
    const wait = async (condition) => {
      for (let i = 0; i < 300; i++) {
        if (condition()) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.fail('fixture condition timed out');
    };
    const pty = {
      spawn(file, args, options) {
        assert.equal(file,process.execPath);
        assert.deepEqual(args,['-tt']);
        assert.deepEqual([options.cols,options.rows],[100,30]);
        assert.equal(options.env.TERM,'xterm');
        assert.equal(options.name,'xterm');
        assert.equal(options.useConptyDll,true);
        return {
          write: (s) => received.push(s),
          resize: (...size) => sizes.push(size),
          kill: () => events.emit('exit', {exitCode:0}),
          onData: (fn) => events.on('data', fn),
          onExit: (fn) => events.on('exit', fn)
        };
      }
    };
    const link = await openNativeSsh({
      pty,
      plan: { file: process.execPath, args: ['-tt'], cwd: process.cwd(), env: {} },
      onPrivate: (s) => auth.push(s),
      onLost: (code) => lost.push(code)
    });
    t.after(() => link.kill());
    output('Password: ');
    link.write('fixture-password\r');
    output('Verification code: ');
    link.write('fixture-response\r');
    assert.deepEqual(received.splice(0), ['fixture-password\r','fixture-response\r']);
    link.resize(108,36);
    assert.deepEqual(sizes,[[108,36]]);
    output('Choose the login node\r\n1) node-a\r\n2) node-b\r\nSelection > ');
    assert(auth.join('').includes('Selection > '));
    assert.equal(received.length,0,'the application does not type in the gateway menu');
    link.write('2\r');
    assert.deepEqual(received,['2\r']);
    output('\r\nuser@node-b:~$ ');
    assert(auth.join('').includes('user@node-b'));
    assert.equal(link.ready().ready,false);
    assert.equal(received.length,1,'shell-looking output alone does not send a command');
    const handoff=link.confirmHandoff();
    await wait(() => received.join('').includes('__AIM_SHELL_'));
    const nonce = received.join('').match(/'([a-f0-9]{48})__'/)[1];
    const proof = '__AIM_SHELL_' + nonce + '__';
    output(received.join('') + '\r\n');
    assert.equal(link.ready().ready, false);
    assert(!received.join('').includes('exec /bin/sh'));
    output('\r\n' + proof.slice(0,20)+'\x1b[K\r\n'+proof.slice(20)+'\r\n');
    assert.equal(await handoff,true);
    assert.equal(link.ready().ready,true);
    await link.check();
    assert(!received.join('').includes('/bin/sh -c'),'handoff proves the selected shell without starting a relay');
    assert.throws(() => link.write('late input'), /authentication_not_pending/);
    const missing=assert.rejects(link.openChannel('printf retry',{pty:false}),/ssh_remote_terminal_unavailable/);
    await wait(() => received.join('').includes('/bin/sh -c'));
    const currentRelayNonce=()=>received.filter(line=>line.includes('/bin/sh -c')).at(-1).match(/'([a-f0-9]{48})__'\r$/)[1];
    const failedRelay=currentRelayNonce();
    output('__AIM_RELAY_EXIT_'+failedRelay+'__\n');
    await missing;
    assert.equal(link.ready().ready,true,'a failed relay leaves the authenticated shell available');
    const first = link.openChannel('printf A',{pty:false}),
      second = link.openChannel();
    await wait(() => received.filter(line=>line.includes('/bin/sh -c')).length===2);
    output('["ready","other"]\n');
    await new Promise((r) => setTimeout(r, 15));
    assert(!received.join('').includes('["exec",'));
    const activeRelay=currentRelayNonce();
    assert.notEqual(activeRelay,failedRelay);
    let sequence=0;
    const frame=(...message)=>'__AIM_RELAY_'+activeRelay+'__:'+JSON.stringify([++sequence,...message])+':__AIM_END__\r\n';
    const ready=frame('ready',activeRelay);
    output('\x1b[?2004l\r'+ready.slice(0,35));
    output(ready.slice(35));
    await wait(() => received.join('').includes('["open",2,'));
    assert(received.some(line=>line==='["exec",1,"printf A"]\n'));
    output(frame('opened',1,111)+frame('opened',2,222));
    const [a, b] = await Promise.all([first, second]);
    assert.notEqual(a.pid,b.pid);
    const verified = link.check();
    await wait(() => received.join('').includes('["ping",'));
    const token = received.join('').match(/\["ping","([a-f0-9-]+)"\]/)[1];
    output(frame('pong',token));
    await verified;
    const texts = [[], []];
    a.onData((s) => texts[0].push(s));
    b.onData((s) => texts[1].push(s));
    const chunk=frame('data',2,'Qg==');
    output(chunk+chunk+frame('data',1,'QQ=='));
    await wait(() => texts.every((items) => items.length));
    assert.deepEqual(texts, [['A'], ['B']]);
    const afterAuth = auth.join('');
    assert(!afterAuth.includes('__AIM_RELAY_'));
    assert.deepEqual(sizes,[[108,36],[500,30],[500,30]]);
    const pings = () => received.filter(value => value.startsWith('["ping",')).map(value => JSON.parse(value)[1]);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const timeout = assert.rejects(link.check(), /ssh_control_timeout/);
    t.mock.timers.tick(5000);
    await timeout;
    t.mock.timers.reset();
    await wait(() => pings().length === 2);
    assert.deepEqual(lost, []);
    assert.equal(link.ready().ready, true);
    let rechecked = false;
    const retry = link.check().then(() => { rechecked = true; });
    await wait(() => pings().length === 3);
    output(frame('pong',pings()[1]));
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(rechecked, false);
    output(frame('pong',pings()[2]));
    await retry;
    const pending = link.check();
    events.emit('exit',{exitCode:255});
    await assert.rejects(pending, /master_unavailable/);
    assert.deepEqual(lost, ['ssh_master_unavailable']);
    assert.equal(link.transportClosed(),true);
    await assert.rejects(link.openChannel(), /ssh_authentication_unconfirmed/);
  }
);
