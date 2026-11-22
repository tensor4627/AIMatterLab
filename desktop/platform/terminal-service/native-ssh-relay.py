"""Serve PTYs and short commands on stdio of one authenticated Linux login."""
import base64
import errno
import fcntl
import json
import os
import pty
import selectors
import signal
import struct
import sys
import termios
import tty


def serve(nonce):
    selector = selectors.DefaultSelector()
    channels = {}
    children = {}
    incoming = bytearray()
    prefix = ('__AIM_RELAY_' + nonce + '__:').encode('ascii')
    sequence = 0

    def frame(*message):
        nonlocal sequence
        sequence += 1
        return prefix + json.dumps((sequence, *message), separators=(',', ':')).encode('ascii') + b':__AIM_END__\r\n'

    def send(*message):
        sys.stdout.buffer.write(frame(*message))
        sys.stdout.buffer.flush()

    def send_output(channel, output):
        # Keep receipts shorter than the Windows console's carrier width.
        chunk_size = 256
        sys.stdout.buffer.write(b''.join(
            frame('data', channel, base64.b64encode(output[start:start + chunk_size]).decode('ascii'))
            for start in range(0, len(output), chunk_size)
        ))
        sys.stdout.buffer.flush()

    def resize(fd, cols, rows):
        if not (10 <= cols <= 500 and 2 <= rows <= 300):
            raise ValueError('invalid dimensions')
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

    def reap():
        for pid, channel in list(children.items()):
            child, status = os.waitpid(pid, os.WNOHANG)
            if child:
                del children[pid]
                row = channels.get(channel)
                if row is not None:
                    row['code'] = os.WEXITSTATUS(status) if os.WIFEXITED(status) else -os.WTERMSIG(status)
                    finish(channel, row)

    def finish(channel, row):
        if row['output_done'] and row['code'] is not None:
            del channels[channel]
            os.close(row['fd'])
            send('exit', channel, row['code'])

    def end_output(row):
        if not row['output_done']:
            selector.unregister(row['fd'])
            row['output_done'] = True

    def stop(channel, report=True):
        row = channels.pop(channel, None)
        if row is None:
            return
        end_output(row)
        os.close(row['fd'])
        pid = row['pid']
        if pid in children:
            try:
                os.killpg(pid, signal.SIGHUP)
            except ProcessLookupError:
                # Cancellation can arrive before a newly forked child runs setsid.
                try:
                    os.kill(pid, signal.SIGHUP)
                except ProcessLookupError:
                    pass
        if report:
            send('exit', channel, row['code'])

    def start_pty(cols, rows, command):
        pid, fd = pty.fork()
        if pid == 0:
            try:
                resize(0, cols, rows)
                if command is None:
                    shell = os.environ.get('SHELL') or '/bin/sh'
                    os.execl(shell, '-' + os.path.basename(shell))
                os.execl('/bin/sh', 'sh', '-c', command)
            finally:
                os._exit(127)
        return pid, fd

    def start_command(command):
        read_fd, write_fd = os.pipe()
        try:
            pid = os.fork()
        except OSError:
            os.close(read_fd)
            os.close(write_fd)
            raise
        if pid == 0:
            try:
                os.close(read_fd)
                os.setsid()
                with open(os.devnull, 'rb') as no_input:
                    os.dup2(no_input.fileno(), 0)
                os.dup2(write_fd, 1)
                os.dup2(write_fd, 2)
                os.close(write_fd)
                os.execl('/bin/sh', 'sh', '-c', command)
            finally:
                os._exit(127)
        os.close(write_fd)
        return pid, read_fd

    def open_channel(op, channel, args):
        reap()
        if channel in channels or len(channels) >= 16 or len(children) >= 16:
            send('error', channel, 'ssh_channel_refused')
            return
        try:
            pid, fd = start_pty(*args) if op == 'open' else start_command(*args)
        except OSError:
            send('error', channel, 'ssh_channel_refused')
            return
        children[pid] = channel
        os.set_blocking(fd, False)
        channels[channel] = {'pid': pid, 'fd': fd, 'code': None, 'pty': op == 'open', 'pending': bytearray(), 'output_done': False}
        selector.register(fd, selectors.EVENT_READ, channel)
        send('opened', channel, pid)

    def dispatch(packet):
        op, channel, *args = json.loads(packet)
        if op == 'ping':
            send('pong', channel)
        elif op in ('open', 'exec'):
            open_channel(op, channel, args)
        elif channel in channels:
            if op == 'close':
                stop(channel)
                return
            row = channels[channel]
            fd, pending = row['fd'], row['pending']
            if row['output_done'] or not row['pty']:
                return
            if op == 'write':
                pending.extend(base64.b64decode(args[0], validate=True))
                if len(pending) > 2 * 1024 * 1024:
                    raise ValueError('input limit')
                selector.modify(fd, selectors.EVENT_READ | selectors.EVENT_WRITE, channel)
            elif op == 'resize':
                resize(fd, *args)

    settings = termios.tcgetattr(0) if os.isatty(0) else None
    try:
        if settings is not None:
            tty.setraw(0)
        selector.register(0, selectors.EVENT_READ)
        sys.stdout.buffer.write(b'\r\n')
        send('ready', nonce)
        while True:
            reap()
            # A PTY can report EOF before waitpid reports the child's exit. Keep
            # waiting for that receipt without sending a signal to the child.
            timeout = 0.05 if any(row['output_done'] for row in channels.values()) else None
            for key, events in selector.select(timeout):
                if key.fd == 0:
                    data = os.read(0, 32768)
                    if not data:
                        return
                    incoming.extend(data)
                    while b'\n' in incoming:
                        packet, _, rest = incoming.partition(b'\n')
                        incoming = bytearray(rest)
                        if len(packet) > 65536:
                            raise ValueError('frame limit')
                        dispatch(packet)
                    if len(incoming) > 65536:
                        raise ValueError('frame limit')
                    continue
                channel = key.data
                if channel not in channels:
                    continue
                row = channels[channel]
                fd, pending = row['fd'], row['pending']
                if fd != key.fd or row['output_done']:
                    continue
                try:
                    if events & selectors.EVENT_WRITE:
                        del pending[:os.write(fd, pending)]
                        if not pending:
                            selector.modify(fd, selectors.EVENT_READ, channel)
                    if events & selectors.EVENT_READ:
                        output = os.read(fd, 8192)
                        if output:
                            send_output(channel, output)
                        else:
                            end_output(row)
                            finish(channel, row)
                except BlockingIOError:
                    pass
                except OSError as exc:
                    if exc.errno != errno.EIO:
                        raise
                    end_output(row)
                    finish(channel, row)
    finally:
        for channel in list(channels):
            stop(channel, report=False)
        selector.close()
        if settings is not None:
            termios.tcsetattr(0, termios.TCSANOW, settings)


serve(sys.argv[1])
