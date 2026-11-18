// OpenSSH reads host-key, password and MFA prompts from its private console.
// Keep its binary stdin/stdout off ConPTY's screen-repainting path.
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const { pipe, token, file, args } = JSON.parse(process.env.STUDIO_NATIVE_SSH);
const env = { ...process.env };
delete env.STUDIO_NATIVE_SSH;
delete env.ELECTRON_RUN_AS_NODE;
delete env.STUDIO_SSH_NODE_EXE;
delete env.STUDIO_SSH_LAUNCHER;
const stream = net.createConnection({ path: pipe, allowHalfOpen: true });
let ssh;
stream.on('error', () => stream.destroy());
function stopSsh() {
  if (ssh && ssh.exitCode === null && !ssh.killed) ssh.kill();
}
stream.on('end', stopSsh);
stream.on('close', stopSsh);
stream.once('connect', () => stream.write(token + '\n'));
const input = createInterface({ input: stream, terminal: false });
input.on('line', (line) => {
  if (ssh) {
    try {
      if (line === 'null') {
        stopSsh();
        return;
      }
      if (line.length > 131072) throw Error();
      const data = JSON.parse(line);
      if (typeof data !== 'string') throw Error();
      if (!ssh.stdin.write(data)) {
        stream.pause();
        ssh.stdin.once('drain', () => stream.resume());
      }
    } catch {
      stream.destroy();
    }
    return;
  }
  if (line !== token) {
    stream.destroy();
    return;
  }
  ssh = spawn(file, args, { env, stdio: ['pipe', 'pipe', 'inherit'] });
  ssh.stdin.on('error', () => {});
  ssh.once('error', () => {
    process.exitCode = 1;
  });
  ssh.once('close', (code) => {
    process.exitCode = code ?? 1;
    stream.end('\n__AIM_LOCAL_EXIT_' + token + '__\n');
  });
  ssh.stdout.pipe(stream, { end: false });
});
