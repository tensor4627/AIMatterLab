"""Compatibility entry; actual implementation: studio_worker.tools.custom_formula."""
import importlib
import sys
from pathlib import Path
if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
_implementation = importlib.import_module("studio_worker.tools.custom_formula")
globals().update({k: v for k, v in vars(_implementation).items() if k not in {"__name__", "__package__", "__spec__", "__loader__"}})
sys.modules[__name__] = _implementation
