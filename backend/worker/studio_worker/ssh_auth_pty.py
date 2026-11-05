"""Compatibility entry; actual implementation: studio_worker.compute.ssh_auth_pty."""
import importlib
import sys
from pathlib import Path
if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if __name__ == "__main__":
    import runpy
    runpy.run_module("studio_worker.compute.ssh_auth_pty", run_name="__main__")
else:
    _implementation = importlib.import_module("studio_worker.compute.ssh_auth_pty")
    globals().update({k: v for k, v in vars(_implementation).items() if k not in {"__name__", "__package__", "__spec__", "__loader__"}})
    sys.modules[__name__] = _implementation
