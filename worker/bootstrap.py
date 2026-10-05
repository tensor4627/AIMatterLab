"""Launch or reconnect to the detached local Linux service; stdout is private JSON."""
import argparse
import json
import os
import subprocess
import signal
import sys
import time
import urllib.request
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--root", default="~/.local/state/gpu-sampling-studio")
parser.add_argument("--port", type=int, default=8767)
args = parser.parse_args()
root = Path(args.root).expanduser().resolve()
root.mkdir(parents=True, exist_ok=True)
connection = root / "connection.json"


def health():
    if not connection.exists():
        return None
    tokens = json.loads(connection.read_text())
    request = urllib.request.Request(f"http://127.0.0.1:{args.port}/api/health",
                                     headers={"Authorization": "Bearer " + tokens["admin"]})
    try:
        report = json.loads(urllib.request.urlopen(request, timeout=1).read())
        if report["name"] != "gpu-sampling-studio" or report["root"] != str(root):
            raise RuntimeError("Port belongs to another service/root")
        return {"url": f"http://127.0.0.1:{args.port}", "tokens": tokens, "health": report}
    except (OSError, urllib.error.URLError):
        return None


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
