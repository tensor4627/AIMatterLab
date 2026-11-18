"""Serve PTYs on stdio of one authenticated Linux login. No listener or files."""
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
    exit_status = {}
    incoming = bytearray()

    def send(*message):
        sys.stdout.buffer.write(json.dumps(message, separators=(',', ':')).encode() + b'\n')
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
                if channel in channels:
                    exit_status[channel] = os.WEXITSTATUS(status) if os.WIFEXITED(status) else -os.WTERMSIG(status)

    def close(channel):
        reap()
        pid, fd, _ = channels.pop(channel)
        selector.unregister(fd)
        os.close(fd)  # Closing the PTY sends SIGHUP to its foreground group.
        if pid in children:
            try:
                os.kill(pid, signal.SIGHUP)
            except ProcessLookupError:
                pass

        return exit_status.pop(channel, None)

    def open_channel(channel, cols, rows, command):
        reap()
        if channel in channels or len(channels) >= 16 or len(children) >= 16:
            raise ValueError('channel limit')
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
        children[pid] = channel
        os.set_blocking(fd, False)
        channels[channel] = (pid, fd, bytearray())
        selector.register(fd, selectors.EVENT_READ, channel)
        send('opened', channel, pid)

    def dispatch(packet):
        op, channel, *args = json.loads(packet)
        if op == 'ping':
            send('pong', channel)
        elif op == 'open':
            open_channel(channel, *args)
        elif channel in channels:
            _, fd, pending = channels[channel]
            if op == 'write':
                pending.extend(base64.b64decode(args[0], validate=True))
                if len(pending) > 2 * 1024 * 1024:
                    raise ValueError('input limit')
                selector.modify(fd, selectors.EVENT_READ | selectors.EVENT_WRITE, channel)
            elif op == 'resize':
                resize(fd, *args)
            elif op == 'close':
                send('exit', channel, close(channel))

    if os.isatty(0):
        tty.setraw(0)
    selector.register(0, selectors.EVENT_READ)
    send('ready', nonce)
    try:
        while True:
            reap()
            for key, events in selector.select():
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
                _, fd, pending = channels[channel]
                try:
                    if events & selectors.EVENT_WRITE:
                        del pending[:os.write(fd, pending)]
                        if not pending:
                            selector.modify(fd, selectors.EVENT_READ, channel)
                    if events & selectors.EVENT_READ:
                        output = os.read(fd, 8192)
                        if output:
                            send('data', channel, base64.b64encode(output).decode('ascii'))
                        else:
                            send('exit', channel, close(channel))
                except BlockingIOError:
                    pass
                except OSError as exc:
                    if exc.errno != errno.EIO:
                        raise
                    send('exit', channel, close(channel))
    finally:
        for channel in list(channels):
            close(channel)
        selector.close()


serve(sys.argv[1])
