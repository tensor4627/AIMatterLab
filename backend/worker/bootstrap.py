"""Launch or reconnect to the detached local Linux service; stdout is private JSON."""
import argparse
import json
import os
import subprocess
import signal
import sys
import time
import http.client
import socket
import threading
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--root", default="~/.local/state/gpu-sampling-studio")
parser.add_argument("--port", type=int, default=8767)
args = parser.parse_args()
root = Path(args.root).expanduser().resolve()
root.mkdir(parents=True, exist_ok=True)
connection = root / "connection.json"


class BootstrapIdentityError(RuntimeError):
    """Fixed private failures; never include credentials or response bodies."""


def _process_record(process):
    try:
        if process.stat().st_uid != os.getuid():
            return None
        with (process / "cmdline").open("rb") as stream:
            command = stream.read(65537)
        with (process / "stat").open("rb") as stream:
            state = stream.read(8193)
        if len(command) > 65536 or len(state) > 8192:
            return None
        argv = command.decode().rstrip("\0").split("\0")
        start = state.decode().rsplit(")", 1)[1].split()[19]
        return argv, start
    except (OSError, UnicodeError, IndexError):
        return None


def owns_stream(expected_root, port, stream):
    """Prove the accepted peer socket belongs to this UID/root/port controller."""
    deadline = time.monotonic() + 1.0
    try:
        if stream.getpeername() != ("127.0.0.1", port):
            return False
        local = "0100007F:" + format(port, "04X")
        peer = "0100007F:" + format(stream.getsockname()[1], "04X")
        candidates = []
        for index, process in enumerate(Path("/proc").iterdir()):
            if index >= 4096 or time.monotonic() >= deadline:
                return False
            if not process.name.isdigit():
                continue
            record = _process_record(process)
            if record and record[0] == [record[0][0], "-m", "studio_worker.server",
                                       "--root", str(expected_root), "--port", str(port)]:
                candidates.append((process, record))
        if not candidates:
            return False
        for _attempt in range(6):
            if time.monotonic() >= deadline:
                return False
            with Path("/proc/net/tcp").open("rb") as source:
                content = source.read(1048577)
            if len(content) > 1048576:
                return False
            inodes = set()
            for row in content.decode("ascii").splitlines()[1:]:
                fields = row.split()
                if (len(fields) > 9 and fields[1] == local and fields[2] == peer and
                        fields[3] == "01" and fields[7] == str(os.getuid()) and fields[9] != "0"):
                    inodes.add("socket:[" + fields[9] + "]")
            for process, record in candidates:
                try:
                    for index, descriptor in enumerate((process / "fd").iterdir()):
                        if index >= 4096 or time.monotonic() >= deadline:
                            return False
                        if os.readlink(descriptor) in inodes and _process_record(process) == record:
                            return True
                except OSError:
                    continue
            time.sleep(.05)
    except (OSError, UnicodeError, ValueError):
        return False
    return False


def verified_connection(expected_root, port, timeout=1.5):
    if type(port) is not int or not 1 <= port <= 65535:
        raise BootstrapIdentityError("Worker controller ownership unavailable")
    controller = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    controller.auto_open = 0  # A closed verified socket must never reconnect to a replacement listener.
    try:
        controller.sock = socket.create_connection(("127.0.0.1", port), timeout=timeout)
        controller.sock.settimeout(timeout)
        if not owns_stream(expected_root, port, controller.sock):
            raise BootstrapIdentityError("Worker controller ownership unavailable")
        return controller
    except BaseException:
        controller.close()
        raise


def _close_owned_socket(stream):
    try:
        stream.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass


def health():
    if not connection.exists():
        return None
    controller = None
    timer = None
    try:
        # Ownership is proven before reading a descriptor or sending Authorization.
        controller = verified_connection(root, args.port)
        timer = threading.Timer(2, _close_owned_socket, args=(controller.sock,))
        timer.daemon = True
        timer.start()
        if not connection.is_file() or connection.is_symlink():
            raise BootstrapIdentityError("Worker descriptor unavailable")
        with connection.open("rb") as descriptor:
            content = descriptor.read(65537)
        if len(content) > 65536:
            raise BootstrapIdentityError("Worker descriptor unavailable")
        tokens = json.loads(content)
        if not isinstance(tokens, dict) or not all(
                isinstance(tokens.get(key), str) and tokens[key] for key in ("admin", "mcp")):
            raise BootstrapIdentityError("Worker descriptor unavailable")
        controller.request("GET", "/api/health", headers={"Authorization": "Bearer " + tokens["admin"]})
        response = controller.getresponse()
        if response.status != 200:
            raise BootstrapIdentityError("Worker health unavailable")
        content = response.read(1048577)
        if len(content) > 1048576:
            raise BootstrapIdentityError("Worker health unavailable")
        report = json.loads(content)
        if not isinstance(report, dict) or report.get("name") != "gpu-sampling-studio" or report.get("root") != str(root):
            raise BootstrapIdentityError("Port belongs to another service/root")
        return {"url": f"http://127.0.0.1:{args.port}", "tokens": tokens, "health": report}
    except ConnectionRefusedError:
        if controller is None:
            return None  # Only an absent initial listener permits ordinary startup.
        raise BootstrapIdentityError("Worker health unavailable") from None
    except BootstrapIdentityError:
        raise
    except (OSError, http.client.HTTPException, ValueError, TypeError, KeyError, RecursionError):
        raise BootstrapIdentityError("Worker health unavailable") from None
    finally:
        if timer is not None:
            timer.cancel()
            timer.join(timeout=.1)
        if controller is not None:
            controller.close()


value = health()
expected_runtime = str(Path(__file__).resolve().parent)
if value and value['health'].get('runtime') != expected_runtime:
    # Replace only the authenticated, same-root controller. Detached runners survive.
    candidates = []
    for process in Path('/proc').iterdir():
        if not process.name.isdigit():
            continue
        try:
            argv = (process / 'cmdline').read_bytes().decode().split('\0')
            if ('studio_worker.server' in argv and '--root' in argv and '--port' in argv
                    and argv[argv.index('--root')+1] == str(root)
                    and argv[argv.index('--port')+1] == str(args.port)
                    and process.stat().st_uid == os.getuid()):
                candidates.append(int(process.name))
        except (OSError, UnicodeError, IndexError):
            continue
    if len(candidates) != 1:
        raise RuntimeError('Cannot verify old worker controller identity; upgrade blocked')
    os.kill(candidates[0], signal.SIGTERM)
    for _ in range(50):
        time.sleep(.1)
        if not health():
            break
    else:
        raise RuntimeError('Old worker controller did not stop; upgrade blocked')
    value = None
if not value:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(Path(__file__).resolve().parent)
    env.setdefault("STUDIO_REQUIRE_TOOL_DECLARATIONS", "0")
    with open(root / "service.log", "ab") as log:
        subprocess.Popen([sys.executable, "-m", "studio_worker.server", "--root", str(root),
                          "--port", str(args.port)], env=env, stdin=subprocess.DEVNULL,
                         stdout=log, stderr=log, start_new_session=True)
    for _ in range(50):
        time.sleep(0.1)
        value = health()
        if value:
            break
if value and value["health"].get("execution_policy") != "desktop-review-v1":
    raise RuntimeError("Worker does not enforce desktop review; reconnect after upgrade")
if not value:
    raise RuntimeError("Worker startup failed; inspect " + str(root / "service.log"))
print(json.dumps(value))
