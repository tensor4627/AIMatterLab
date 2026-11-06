"""Bounded validation code shipped to cluster jobs; no private control state."""
from .paths import PACKAGE_ROOT

VALIDATION_RESOURCES = ('__init__.py', 'adapters.py', 'composition_store.py', 'derivative_selection.py', 'derivatives.py', 'engine_contracts.json', 'engine_contracts.py', 'infrastructure/__init__.py', 'infrastructure/paths.py', 'infrastructure/util.py', 'neb_checks.py', 'science_checks.py', 'scientific.py', 'source_git_identity.py', 'structure_tools.py', 'tools/__init__.py', 'tools/adapters.py', 'tools/declarations.py', 'tools/derivative_selection.py', 'tools/derivatives.py', 'tools/engine_contracts.py', 'tools/neb_checks.py', 'tools/science_checks.py', 'tools/scientific.py', 'tools/source_git_identity.py', 'tools/structure_tools.py', 'util.py', 'workspace/__init__.py', 'workspace/composition_store.py')

def validation_resources():
    return ((name, (PACKAGE_ROOT / name).read_bytes()) for name in VALIDATION_RESOURCES)
