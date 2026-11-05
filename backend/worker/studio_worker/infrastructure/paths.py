"""Stable standalone package/resource roots; never infer a user data root."""
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
WORKER_ROOT = PACKAGE_ROOT.parent

def package_resource(name):
    return PACKAGE_ROOT / name
