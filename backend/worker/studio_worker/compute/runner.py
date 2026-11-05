"""Detached supervisor: completion receipts survive worker and desktop closure."""
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from studio_worker.infrastructure.util import atomic_json, identity


def main():
    directory = Path(sys.argv[1])
    launch = json.loads((directory / "launch.json").read_text())
    child, stopped = None, False
    def stop(_signal, _frame):
        nonlocal stopped
        stopped = True
        if child and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    atomic_json(directory / "identity.json", identity(os.getpid()))
    started, code, reason = time.time(), -1, None
    try:
        if stopped:
            raise RuntimeError("Cancelled before child launch")
        with open(directory / "console.log", "ab", buffering=0) as output:
            child = subprocess.Popen(launch["command"], cwd=directory / "results",
                                     env=launch["environment"], stdout=output, stderr=output,
                                     stdin=subprocess.DEVNULL, start_new_session=True)
            atomic_json(directory / "child.json", identity(child.pid))
            if stopped:
                os.killpg(child.pid, signal.SIGTERM)
            deadline, stopping_at = time.monotonic() + launch["max_seconds"], None
            while child.poll() is None:
                if time.monotonic() > deadline and not stopped:
                    reason = "time_limit"
                    stop(signal.SIGTERM, None)
                if stopped:
                    if stopping_at is None:
                        stopping_at = time.monotonic()
                    if time.monotonic() - stopping_at > 5:
                        os.killpg(child.pid, signal.SIGKILL)
                time.sleep(0.1)
            code = child.returncode
    except BaseException as exc:
        reason = str(exc)
        if child and child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
    finally:
        atomic_json(directory / "exit.json", {"exit_code": code, "cancelled": stopped,
                    "reason": reason, "started_at": started, "ended_at": time.time()})


if __name__ == "__main__":
    main()
