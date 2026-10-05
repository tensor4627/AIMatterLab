"""JSONL bridge to a real Linux PTY; no TCP listener."""
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios

pid, master = pty.fork()
if pid == 0:
    os.execlp("bash", "bash", "-l")
try:
    while True:
        ready, _, _ = select.select([master, sys.stdin], [], [], 0.2)
        if master in ready:
            try:
                data = os.read(master, 16384)
            except OSError:
                break
            if not data:
                break
            print(json.dumps({"data": data.decode("utf-8", "replace")}), flush=True)
        if sys.stdin in ready:
            line = sys.stdin.readline()
            if not line:
                break
            request = json.loads(line)
            if request["type"] == "input":
                os.write(master, request["data"].encode())
            elif request["type"] == "resize":
                rows = min(300, max(2, int(request["rows"])))
                cols = min(500, max(10, int(request["cols"])))
                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
finally:
    os.close(master)
    try:
        os.kill(pid, signal.SIGHUP)
    except ProcessLookupError:
        pass
