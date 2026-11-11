"""Detached supervisor: completion receipts survive worker and desktop closure."""
import argparse
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from studio_worker.infrastructure.util import atomic_json, identity
from studio_worker.compute.launch_protocol import (child_launch_gate, claim_supervisor, uses_launch_protocol,
                                                   CancellationPoll, CancellationUnavailable)


def supervise(directory, expected_launch=None):
    directory = Path(directory)
    launch = json.loads((directory / "launch.json").read_text())
    gated = uses_launch_protocol(launch, expected_launch)
    if gated and not claim_supervisor(directory, launch):
        # A second supervisor cannot overwrite identity/exit evidence or start
        # another child, even if the first supervisor crashed before Popen.
        return
    child, stopped = None, False
    def stop(_signal, _frame):
        nonlocal stopped
        stopped = True
        if child and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    observed = identity(os.getpid())
    if gated and observed:
        observed = {**observed, "launch_claim": launch["claim"]}
    atomic_json(directory / "identity.json", observed)
    started, code, reason = time.time(), -1, None
    try:
        if stopped:
            raise RuntimeError("Cancelled before child launch")
        with open(directory / "console.log", "ab", buffering=0) as output:
            with child_launch_gate(directory, launch):
                if stopped:
                    raise InterruptedError("Cancelled before child launch")
                child = subprocess.Popen(launch["command"], cwd=directory / "results",
                                         env=launch["environment"], stdout=output, stderr=output,
                                         stdin=subprocess.DEVNULL, start_new_session=True)
                observed_child = identity(child.pid)
                if gated and observed_child:
                    observed_child = {**observed_child, "launch_claim": launch["claim"]}
                atomic_json(directory / "child.json", observed_child)
            if stopped:
                os.killpg(child.pid, signal.SIGTERM)
            deadline, stopping_at = time.monotonic() + launch["max_seconds"], None
            cancellation = CancellationPoll()
            while child.poll() is None:
                if gated and not stopped:
                    try:
                        if cancellation.read(directory, launch, time.monotonic()):
                            stop(signal.SIGTERM, None)
                    except CancellationUnavailable:
                        reason = "cancellation_state_unavailable"
                        stop(signal.SIGTERM, None)
                    if cancellation.diagnostic:
                        try: atomic_json(directory / "supervisor-diagnostic.json", cancellation.diagnostic)
                        except OSError: pass
                        cancellation.diagnostic = None
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
        if isinstance(exc, InterruptedError):
            stopped = True
        reason = str(exc)
        if child and child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
    finally:
        atomic_json(directory / "exit.json", {"exit_code": code, "cancelled": stopped,
                    "reason": reason, "started_at": started, "ended_at": time.time(),
                    **({"launch_claim": launch["claim"]} if gated else {})})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory")
    parser.add_argument("--store-root")
    parser.add_argument("--run-id")
    parser.add_argument("--launch-claim")
    arguments = parser.parse_args()
    supplied = (arguments.store_root, arguments.run_id, arguments.launch_claim)
    if any(value is not None for value in supplied) and not all(supplied):
        parser.error("A launch requires store-root, run-id and launch-claim together")
    expected = {"store_root": arguments.store_root, "run_id": arguments.run_id,
                "claim": arguments.launch_claim} if all(supplied) else None
    supervise(arguments.directory, expected)


if __name__ == "__main__":
    main()
