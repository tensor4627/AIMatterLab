"""Tools ownership and portable distribution checks; no scientific engines."""
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))


class ToolsDomain(unittest.TestCase):
    def test_legacy_modules_share_the_actual_owner_and_monkeypatch_namespace(self):
        for name in ('adapters', 'engine_contracts', 'derivative_selection'):
            with self.subTest(module=name):
                legacy = importlib.import_module('studio_worker.' + name)
                owner = importlib.import_module('studio_worker.tools.' + name)
                self.assertIs(legacy, owner)
        from studio_worker.tools import adapters
        self.assertIs(importlib.import_module('studio_worker.adapters'), adapters)
        self.assertEqual(adapters.Adapter.__module__, 'studio_worker.tools.adapters')
        with patch('studio_worker.adapters.run_json', return_value={}) as probe, patch.object(adapters.Adapter, 'runtime_check', return_value={'status': 'not_run'}):
            adapters.Adapter('pydyn.md').probe({'executables': {'python': sys.executable}})
        self.assertEqual(probe.call_args.args[1], WORKER / 'studio_worker/scientific.py')

    def test_consumers_use_the_tool_owner_and_unique_package_resources(self):
        from studio_worker.tools.adapters import Adapter, SCIENTIFIC
        from studio_worker.tools.engine_contracts import CONTRACTS
        for name in ('service', 'server', 'cluster', 'runtime_service'):
            with self.subTest(consumer=name):
                consumer = importlib.import_module('studio_worker.' + name)
                self.assertIs(consumer.Adapter, Adapter)
        from studio_worker import authoring_workspace
        self.assertTrue(authoring_workspace.CONTRACTS is CONTRACTS)
        self.assertEqual(SCIENTIFIC, WORKER / 'studio_worker/scientific.py')
        self.assertEqual(CONTRACTS, json.loads((WORKER / 'studio_worker/engine_contracts.json').read_text(encoding='utf-8')))
        self.assertFalse((WORKER / 'studio_worker/tools/engine_contracts.json').exists())
        with tempfile.TemporaryDirectory() as tool_source:
            command = Adapter('nep.eval').prepare({'inputs': {name: name for name in ('nep.in', 'train.xyz', 'nep.txt')}, 'parameters': {}}, {'executables': {'nep': sys.executable}})
            self.assertEqual(command, [sys.executable])
            with self.assertRaisesRegex(ValueError, 'native prediction input'):
                Adapter('nep.eval').prepare({'inputs': {name: name for name in ('nep.in', 'evaluation.xyz', 'nep.txt')}, 'parameters': {}}, {'executables': {'nep': sys.executable}})

    def test_installed_standalone_worker_contains_new_owners_and_old_imports(self):
        with tempfile.TemporaryDirectory() as directory:
            env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
            result = subprocess.run([sys.executable, '-B', str(WORKER / 'install.py'), '--source', str(WORKER), '--root', directory], capture_output=True, text=True, env=env, timeout=20, check=True)
            runtime = Path(json.loads(result.stdout)['path'])
            code = """import importlib,json,pathlib,sys
sys.path.insert(0,sys.argv[1])
for name in ('adapters','engine_contracts','derivative_selection'):
 assert importlib.import_module('studio_worker.'+name) is importlib.import_module('studio_worker.tools.'+name)
from studio_worker.tools.adapters import Adapter,SCIENTIFIC
from studio_worker.engine_contracts import CONTRACTS
import studio_worker.server,studio_worker.runner
assert pathlib.Path(SCIENTIFIC).is_file()
assert pathlib.Path(SCIENTIFIC).parent==pathlib.Path(sys.argv[1])/'studio_worker'
assert Adapter('pygas.opes-reweight').prepare({'inputs':{'OPES_COLVAR':'fixture','fes.yaml':'fixture'},'parameters':{}},{'executables':{'pygas':sys.executable}})==[sys.executable,'opes-reweight','OPES_COLVAR','fes.yaml']
print(json.dumps(CONTRACTS))
"""
            loaded = subprocess.run([sys.executable, '-I', '-B', '-X', 'utf8', '-c', code, str(runtime)], capture_output=True, text=True, env=env, timeout=20, check=True)
            self.assertEqual(json.loads(loaded.stdout), json.loads((WORKER / 'studio_worker/engine_contracts.json').read_text(encoding='utf-8')))
            for name in ('adapters', 'engine_contracts', 'derivative_selection'):
                self.assertTrue((runtime / ('studio_worker/tools/' + name + '.py')).is_file())


if __name__ == '__main__':
    unittest.main()
