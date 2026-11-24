"""Real local PTY transport fixtures only: no SSH, account, keys or network."""
import base64
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import tempfile
import time
import unittest

WORKER = Path(__file__).resolve().parents[1]
RUNTIME = WORKER.parent / '.studio/v0189/button-audit/c/compute-connection-hil/phase2/pty/runtime'
if os.name == 'posix':
    sys.path.insert(0, str(WORKER))
    from studio_worker.compute.ssh_auth_pty import process_identity


class Fixture:
    def __init__(self, case, code=None, packets=(), raw_start=None, owner=False):
        self.case, self.pending, self.frames, self.output = case, bytearray(), [], bytearray()
        self.identity = None
        RUNTIME.mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(prefix='pty-fixture-', dir=RUNTIME)
        env = dict(os.environ, PYTHONPATH=str(WORKER), PYTHONDONTWRITEBYTECODE='1')
        argv = [sys.executable, '-u', '-c', code] if code is not None else None
        if owner:
            launch = "import json,subprocess,sys,time; p=subprocess.Popen([sys.executable,'-u','-m','studio_worker.compute.ssh_auth_pty'],stdin=subprocess.PIPE); p.stdin.write((json.dumps({'argv':"+repr(argv)+"})+'\\n').encode()); p.stdin.flush(); print(json.dumps({'type':'owner','helperPid':p.pid}),flush=True); time.sleep(30)"
            command = [sys.executable, '-u', '-c', launch]
        else:
            command = [sys.executable, '-u', '-m', 'studio_worker.compute.ssh_auth_pty']
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, cwd=self.directory.name, env=env)
        case.addCleanup(self.close)
        if not owner:
            first = raw_start if raw_start is not None else (json.dumps({'argv': argv})+'\n').encode()
            self.process.stdin.write(first + b''.join((json.dumps(x)+'\n').encode() for x in packets))
            self.process.stdin.flush()

    def send(self, value):
        self.raw((json.dumps(value, ensure_ascii=False)+'\n').encode())

    def raw(self, value):
        self.process.stdin.write(value)
        self.process.stdin.flush()

    def collect(self, timeout=.1):
        ready, _, _ = select.select([self.process.stdout], [], [], timeout)
        if not ready:
            return False
        block = os.read(self.process.stdout.fileno(), 16384)
        if not block:
            return False
        self.pending.extend(block)
        while b'\n' in self.pending:
            line, _, tail = self.pending.partition(b'\n')
            self.pending = bytearray(tail)
            frame = json.loads(line)
            self.frames.append(frame)
            if frame.get('type') == 'started':
                self.identity = frame['identity']
            if frame.get('type') == 'output':
                output = base64.b64decode(frame['base64'], validate=True)
                self.case.assertLessEqual(len(output), 12288)
                self.output.extend(output)
        return True

    def until(self, predicate, seconds=4):
        until = time.monotonic()+seconds
        while time.monotonic() < until:
            if predicate():
                return
            self.collect(.05)
        self.case.assertTrue(predicate(), 'Owned PTY fixture did not reach its expected state')

    def exited(self):
        # Drain while waiting: the real worker continuously consumes the private
        # stream, and a fixture must not deadlock a healthy helper on pipe fill.
        until = time.monotonic()+4
        while self.process.poll() is None and time.monotonic() < until:
            self.collect(.05)
        self.process.wait(timeout=.1)
        while self.collect(.02):
            pass
        self.case.assertEqual(self.process.stderr.read(), b'')
        if self.identity:
            self.until(lambda: process_identity(self.identity[0]) != self.identity)

    def close(self):
        try:
            if self.process.stdin and not self.process.stdin.closed:
                self.process.stdin.close()
            if self.process.poll() is None:
                self.process.terminate()
            self.process.wait(timeout=4)
        except (OSError, subprocess.TimeoutExpired):
            self.process.kill()
            self.process.wait()
        if self.identity and process_identity(self.identity[0]) == self.identity:
            try:
                os.killpg(self.identity[0], signal.SIGKILL)
            except OSError:
                pass
        for stream in (self.process.stdout, self.process.stderr):
            stream.close()
        self.directory.cleanup()


@unittest.skipUnless(os.name == 'posix', 'Linux PTY capability required')
class PrivatePTY(unittest.TestCase):
    def test_real_controlling_terminal_and_session(self):
        code = "import json,os; print('TTY='+json.dumps([os.isatty(n) for n in range(3)]+[os.tcgetpgrp(0)==os.getpgrp(),os.getsid(0)==os.getpid()]),flush=True)"
        f = Fixture(self, code)
        f.exited()
        self.assertIn(b'TTY=[true, true, true, true, true]', f.output)
        self.assertEqual(len([x for x in f.frames if x['type']=='started']), 1)

    def test_noecho_input_is_private_and_not_copied_to_protocol_metadata(self):
        code = "import termios; s=termios.tcgetattr(0); s[3]&=~(termios.ECHO|termios.ECHONL); termios.tcsetattr(0,termios.TCSANOW,s); print('READY',flush=True); x=input(); print('COUNT='+str(len(x)),flush=True)"
        f = Fixture(self, code)
        f.until(lambda:b'READY' in f.output)
        secret = 'SYNTHETIC_PRIVATE_INPUT_7291'
        f.send({'type':'input','data':secret+'\n'})
        f.exited()
        self.assertIn(('COUNT='+str(len(secret))).encode(), f.output)
        self.assertNotIn(secret.encode(), f.output)
        self.assertNotIn(secret, json.dumps(f.frames))

    def test_pipelined_startup_and_input_are_not_lost_to_buffered_read_ahead(self):
        f = Fixture(self, "x=input(); print('PIPELINED_OK='+str(len(x)),flush=True)", [{'type':'input','data':'hello\n'}])
        f.exited()
        self.assertIn(b'PIPELINED_OK=5', f.output)

    def test_resize_reaches_the_real_terminal(self):
        code = "import fcntl,struct,termios; print('READY',flush=True); input(); print('SIZE='+str(struct.unpack('HHHH',fcntl.ioctl(0,termios.TIOCGWINSZ,b'\\0'*8))[:2]),flush=True)"
        f = Fixture(self, code)
        f.until(lambda:b'READY' in f.output)
        f.send({'type':'resize','rows':79,'cols':131})
        f.send({'type':'input','data':'\n'})
        f.exited()
        self.assertIn(b'SIZE=(79, 131)', f.output)

    def test_split_utf8_packets_and_output_preserve_bytes_and_bounded_chunks(self):
        code = "import os,time; print('READY',flush=True); x=input(); print('UNICODE_OK='+str(x=='\u8ba4\u8bc1'),flush=True); os.write(1,b'\\xe4'); time.sleep(.1); os.write(1,b'\\xb8\\xad'); os.write(1,b'x'*50000)"
        f = Fixture(self, code)
        f.until(lambda:b'READY' in f.output)
        packet = (json.dumps({'type':'input','data':'认证\n'},ensure_ascii=False)+'\n').encode()
        split = packet.index('认'.encode())+1
        f.raw(packet[:split]);f.raw(packet[split:])
        f.exited()
        self.assertIn(b'UNICODE_OK=True', f.output)
        self.assertIn('中'.encode()+b'x'*50000, f.output)
        self.assertGreater(len([x for x in f.frames if x['type']=='output']), 3)

    def test_private_stdin_eof_terminates_owned_child_even_when_hup_is_ignored(self):
        f = Fixture(self, "import signal,time; signal.signal(signal.SIGHUP,signal.SIG_IGN); print('READY',flush=True); time.sleep(30)")
        f.until(lambda:b'READY' in f.output)
        f.process.stdin.close()
        f.exited()

    def test_helper_sigterm_runs_owned_child_cleanup(self):
        f = Fixture(self, "import signal,time; signal.signal(signal.SIGHUP,signal.SIG_IGN); print('READY',flush=True); time.sleep(30)")
        f.until(lambda:b'READY' in f.output)
        f.process.terminate()
        f.exited()

    def test_parent_death_closes_private_pipe_and_reaps_owned_child(self):
        f = Fixture(self, "import signal,time; signal.signal(signal.SIGHUP,signal.SIG_IGN); print('READY',flush=True); time.sleep(30)", owner=True)
        f.until(lambda:b'READY' in f.output and any(x['type']=='owner' for x in f.frames))
        helper = next(x['helperPid'] for x in f.frames if x['type']=='owner')
        helper_identity = process_identity(helper)
        f.process.terminate()
        f.process.wait(timeout=4)
        f.until(lambda:process_identity(f.identity[0]) != f.identity)
        # A reparented helper can be a short-lived init-owned zombie: it no longer
        # owns a live child or PTY. Count zombie as exited rather than signaling it.
        def helper_dead():
            identity = process_identity(helper)
            if identity != helper_identity:
                return True
            try:
                text = Path('/proc/%d/stat'%helper).read_text()
                return text[text.rfind(')')+2:].split()[0]=='Z'
            except OSError:
                return True
        f.until(helper_dead)
        while f.collect(.02):pass
        self.assertEqual(f.process.stderr.read(), b'')

    def test_invalid_private_stream_closes_without_echo_or_traceback(self):
        bad = [None, [], {'type':'unknown','data':'SYNTHETIC_SECRET'},
               {'type':'input','data':'x'*4097}, {'type':'input','data':'x','extra':True},
               {'type':'resize','rows':True,'cols':80}, {'type':'resize','rows':1,'cols':80}]
        for packet in bad:
            with self.subTest(kind=type(packet).__name__):
                f = Fixture(self, "print('READY',flush=True); input()")
                f.until(lambda:b'READY' in f.output)
                f.send(packet)
                f.exited()
                self.assertNotIn(b'SYNTHETIC_SECRET', f.output)

    def test_oversized_incomplete_line_is_bounded(self):
        f = Fixture(self, "print('READY',flush=True); input()")
        f.until(lambda:b'READY' in f.output)
        f.raw(b'x'*32769)
        f.exited()

    def test_invalid_startup_is_silent_and_creates_no_child(self):
        for payload in [None, {'argv':['relative']}, {'argv':[sys.executable],'private':'SYNTHETIC_SECRET'}]:
            with self.subTest(kind=type(payload).__name__):
                f = Fixture(self, raw_start=(json.dumps(payload)+'\n').encode())
                f.exited()
                self.assertFalse(f.frames)
        f = Fixture(self, raw_start=b'x'*131073)
        f.exited()
        self.assertFalse(f.frames)

    def test_process_identity_rejects_non_pid_shapes(self):
        for value in (None, False, -1, 0, '1', []):
            self.assertIsNone(process_identity(value))
        self.assertEqual(process_identity(os.getpid())[0], os.getpid())


if __name__ == '__main__':
    unittest.main()
