"""Compatibility alias; implementation is owned by studio_worker.tools.engine_contracts."""
import sys
from .tools import engine_contracts as _implementation
sys.modules[__name__] = _implementation
