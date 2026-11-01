"""Private single-thread PTY helper. JSONL pipes only; no transcript or shell."""
import base64
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time

START_LIMIT = 131072
LINE_LIMIT = 32768
INPUT_LIMIT = 4096
INPUT_QUEUE_LIMIT = 8192
OUTPUT_CHUNK = 12288


class _Stop(Exception):
    pass


def process_identity(pid):
    if type(pid) is not int or pid <= 0:
        return None
    try:
        with open('/proc/%d/stat' % pid, encoding='ascii') as stream:
            text = stream.read()
        return [pid, int(text[text.rfind(')') + 2:].split()[19])]
    except (OSError, ValueError, IndexError):
        return None


def emit(value):
    sys.stdout.write(json.dumps(value) + '\n')
    sys.stdout.flush()


def _signal_stop(_number, _frame):
    raise _Stop()


def _first_line(descriptor):
    # One raw reader preserves bytes pipelined after startup. Buffered readline
    # followed by os.read would lose already-buffered subsequent requests.
    pending = bytearray()
    while b'\n' not in pending:
        block = os.read(descriptor, 8192)
        if not block:
            raise _Stop()
        pending.extend(block)
        if b'\n' not in pending and len(pending) > START_LIMIT:
            raise _Stop()
    line, _, tail = pending.partition(b'\n')
    if len(line) > START_LIMIT:
        raise _Stop()
    return line, bytearray(tail)


def _request(line, master, queued):
    if len(line) > LINE_LIMIT:
        raise _Stop()
    item = json.loads(line)
    if not isinstance(item, dict):
        raise _Stop()
    if item.get('type') == 'input':
        if set(item) != {'type', 'data'} or not isinstance(item['data'], str):
            raise _Stop()
        data = item['data'].encode('utf8')
        if len(data) > INPUT_LIMIT or len(queued) + len(data) > INPUT_QUEUE_LIMIT:
            raise _Stop()
        queued.extend(data)
    elif item.get('type') == 'resize':
        rows, cols = item.get('rows'), item.get('cols')
        if (set(item) != {'type', 'rows', 'cols'} or type(rows) is not int or
                type(cols) is not int or not 2 <= rows <= 300 or not 10 <= cols <= 500):
            raise _Stop()
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    else:
        raise _Stop()


def _cleanup(pid, identity):
    # forkpty creates this process group. Never signal a reused PID/group.
    try:
        if identity and process_identity(pid) == identity and os.getpgid(pid) == pid:
            os.killpg(pid, signal.SIGHUP)
            until = time.monotonic() + 1
            while time.monotonic() < until and process_identity(pid) == identity:
                done, _ = os.waitpid(pid, os.WNOHANG)
                if done:
                    break
                time.sleep(.02)
            if process_identity(pid) == identity and os.getpgid(pid) == pid:
                os.killpg(pid, signal.SIGKILL)
        try:
            os.waitpid(pid, 0)
        except ChildProcessError:
            pass
    except (OSError, ChildProcessError):
        pass


def main():
    signal.signal(signal.SIGTERM, _signal_stop)
    signal.signal(signal.SIGHUP, _signal_stop)
    signal.signal(signal.SIGINT, _signal_stop)
    descriptor = sys.stdin.fileno()
    first, pending = _first_line(descriptor)
    request = json.loads(first)
    argv = request.get('argv') if isinstance(request, dict) else None
    if (not isinstance(request, dict) or set(request) != {'argv'} or
            not isinstance(argv, list) or not 1 <= len(argv) <= 100 or
            any(not isinstance(x, str) or len(x) > 8192 or '\0' in x for x in argv) or
            not argv[0].startswith('/')):
        raise _Stop()
    pid, master = pty.fork()
    if pid == 0:
        try:
            for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
                signal.signal(number, signal.SIG_DFL)
            os.execv(argv[0], argv)
        finally:
            os._exit(127)
    child_identity = process_identity(pid)
    queued = bytearray()
    try:
        if not child_identity:
            raise _Stop()
        os.set_blocking(master, False)
        emit({'type': 'started', 'identity': child_identity})
        while True:
            while b'\n' in pending:
                line, _, tail = pending.partition(b'\n')
                pending = bytearray(tail)
                _request(line, master, queued)
            if len(pending) > LINE_LIMIT:
                raise _Stop()
            ready, writable, _ = select.select([master, descriptor], [master] if queued else [], [], .2)
            if master in ready:
                try:
                    data = os.read(master, OUTPUT_CHUNK)
                except BlockingIOError:
                    data = None
                except OSError:
                    break
                if data == b'':
                    break
                if data:
                    emit({'type': 'output', 'base64': base64.b64encode(data).decode('ascii')})
            if master in writable:
                try:
                    count = os.write(master, queued)
                    del queued[:count]
                except BlockingIOError:
                    pass
            if descriptor in ready:
                data = os.read(descriptor, 8192)
                if not data:
                    break
                pending.extend(data)
            # A leader exit is terminal even if a descendant holds the slave.
            done, _ = os.waitpid(pid, os.WNOHANG)
            if done:
                while True:
                    try:
                        data = os.read(master, OUTPUT_CHUNK)
                    except (BlockingIOError, OSError):
                        break
                    if not data:
                        break
                    emit({'type': 'output', 'base64': base64.b64encode(data).decode('ascii')})
                break
    except (_Stop, OSError, ValueError, TypeError):
        pass
    finally:
        # A second terminate request must not interrupt owned-child cleanup.
        for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            signal.signal(number, signal.SIG_IGN)
        os.close(master)
        _cleanup(pid, child_identity)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Never copy prompt/input/argv/configuration into stderr or tracebacks.
        sys.exit(1)
