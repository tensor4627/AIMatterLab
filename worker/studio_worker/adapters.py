"""Compatibility alias; implementation is owned by studio_worker.tools.adapters."""
import sys
from .tools import adapters as _implementation
sys.modules[__name__] = _implementation
