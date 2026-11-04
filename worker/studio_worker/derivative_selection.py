"""Compatibility alias for tool validation controls, including direct script imports."""
import sys
if __package__:
    from .tools import derivative_selection as _implementation
else:
    from tools import derivative_selection as _implementation
sys.modules[__name__] = _implementation
