import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { EventEmitter } from 'node:events';
import { openNativeSsh } from '../../desktop/platform/terminal-service/native-ssh.mjs';

test(
  'native login requires a remote shell proof, separates authentication, multiplexes channels and fences loss',
  { skip: process.platform !== 'win32', timeout: 12000 },
  async (t) => {
    const auth = [],
      lost = [],
      consoleInput = [],
      received = [];
    let peer, events, config, proof, nonce;
    const wait = async (condition) => {
      for (let i = 0; i < 300; i++) {
        if (condition()) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.fail('fixture condition timed out');
    };
    const pty = {
      spawn(file, args, options) {
        assert.match(file, /[\\/]System32[\\/]cmd\.exe$/i);
        assert.match(args, /start "" \/b \/wait/);
        assert.equal(options.env.STUDIO_SSH_NODE_EXE, process.execPath);
        assert.match(options.env.STUDIO_SSH_LAUNCHER, /native-ssh-stdio\.mjs$/);
        assert(!args.includes(process.execPath));
        config = JSON.parse(options.env.STUDIO_NATIVE_SSH);
        events = new EventEmitter();
        peer = createConnection(config.pipe);
        peer.once('connect', () => peer.write(config.token + '\n'));
        let lines = '';
        peer.on('data', (bytes) => {
          lines += bytes;
          let end;
          while ((end = lines.indexOf('\n')) >= 0) {
            const line = lines.slice(0, end);
            lines = lines.slice(end + 1);
            if (line === config.token) continue;
            const value = JSON.parse(line);
            if (value === null) peer.end('\n__AIM_LOCAL_EXIT_' + config.token + '__\n');
            else received.push(value);
          }
        });
        peer.on('close', () => events.emit('exit', { exitCode: 0 }));
        return {
          write: (s) => consoleInput.push(s),
          resize() {},
          kill: () => peer.destroy(),
          onData: (fn) => events.on('data', fn),
          onExit: (fn) => events.on('exit', fn)
        };
      }
    };
    const link = await openNativeSsh({
      pty,
      plan: { file: process.execPath, args: [], cwd: process.cwd(), env: {} },
      onPrivate: (s) => auth.push(s),
      onLost: (code) => lost.push(code)
    });
    t.after(() => link.kill());
    await wait(() => peer.readyState === 'open');
    events.emit('data', 'Verification code: ');
    link.write('fixture-response\r');
    assert.deepEqual(consoleInput, ['fixture-response\r']);
    assert(!received.join('').includes('fixture-response'));
    peer.write('user@fixture:~$ ');
    await wait(() => received.join('').includes('__AIM_SHELL_'));
    nonce = received.join('').match(/'([a-f0-9]{48})__'/)[1];
    proof = '__AIM_SHELL_' + nonce + '__';
    peer.write(received.join('') + '\r\n');
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(link.ready().ready, false);
    assert(!received.join('').includes('exec /bin/sh'));
    peer.write('\r\n' + proof + '\r\n');
    await wait(() => received.join('').includes('exec /bin/sh'));
    peer.write('["ready","other"]\n');
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(link.ready().ready, false);
    peer.write('\x1b[?2004l\r' + JSON.stringify(['ready', nonce]) + '\n');
    await wait(() => link.ready().ready);
    assert.throws(() => link.write('late input'), /authentication_not_pending/);
    const verified = link.check();
    await wait(() => received.join('').includes('["ping",'));
    const token = received.join('').match(/\["ping","([a-f0-9-]+)"\]/)[1];
    peer.write(JSON.stringify(['pong', token]) + '\n');
    await verified;
    const first = link.openChannel(),
      second = link.openChannel();
    await wait(() => received.join('').includes('["open",2,'));
    peer.write('["opened",1,111]\n["opened",2,222]\n');
    const [a, b] = await Promise.all([first, second]);
    assert.notEqual(a.pid, b.pid);
    const texts = [[], []];
    a.onData((s) => texts[0].push(s));
    b.onData((s) => texts[1].push(s));
    peer.write('["data",2,"Qg=="]\n["data",1,"QQ=="]\n');
    await wait(() => texts.every((items) => items.length));
    assert.deepEqual(texts, [['A'], ['B']]);
    const afterAuth = auth.join('');
    assert(!afterAuth.includes('["data"'));
    const pending = link.check();
    peer.destroy();
    await assert.rejects(pending, /master_unavailable/);
    assert.deepEqual(lost, ['ssh_master_unavailable']);
    await assert.rejects(link.openChannel(), /channel_unavailable/);
  }
);
