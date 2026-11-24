"""Service/store integration fixtures only; these do not execute scientific engines."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from studio_worker.compute.runtime_service import RuntimeServiceMixin
from studio_worker.compute.runtime_guides import fingerprint
from studio_worker.infrastructure.store import Store


class RuntimeHarness(RuntimeServiceMixin):
    def __init__(self, root):
        self.store=Store(root)
        self.root=self.store.root


class RuntimeServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.service=RuntimeHarness(self.root/'worker');self.addCleanup(self.service.store.db.close)
        self.python=self.root/'python';self.python.write_text('fixture interpreter identity; never executed')
        self.module=self.root/'module.py';self.module.write_text('fixture imported module identity')
        self.environment={'id':'selected','name':'explicit','executables':{'python':str(self.python)},'variables':{'LD_LIBRARY_PATH':'private-loader-value'},'credentials':'never-emit'}
        self.service.store.put('environment',self.environment)
        self.selection={'environment_id':'selected','engine':'pydyn.md'}
        self.report={'scope':{'engine':'pydyn.md'},'python':'fixture3','executable':str(self.python),'modules':{'ase':{'status':'passed','version':'fixture-version','file':str(self.module),'source_sha256':hashlib.sha256(self.module.read_bytes()).hexdigest()}},'repositories':{},'native_runtime':{'status':'not_run'}}
    def adapter(self, effect=None):
        mock=patch('studio_worker.compute.runtime_service.Adapter');factory=mock.start();self.addCleanup(mock.stop)
        if effect is None:factory.return_value.probe.return_value=copy.deepcopy(self.report)
        else:factory.return_value.probe.side_effect=effect
        return factory
    def test_actual_adapter_receives_only_registered_snapshot_and_no_caller_override(self):
        before=copy.deepcopy(self.service.store.get('environment','selected'));calls=[]
        def probe(environment):
            self.assertFalse(self.service.store.lock._is_owned())
            self.assertEqual(environment,before);calls.append(copy.deepcopy(environment));environment['variables']['LD_LIBRARY_PATH']='mutated-child-copy'
            return copy.deepcopy(self.report)
        factory=self.adapter(probe);result=self.service.probe({**self.selection,'environment':{'executables':{'python':'foreign'}},'probe':{'python':'fabricated'}})
        factory.assert_called_once_with('pydyn.md');self.assertEqual(result['python'],'fixture3');self.assertEqual(result['runtime_guide']['status'],'observed');self.assertEqual(self.service.store.get('environment','selected'),before)
        self.assertEqual(result['runtime_guide']['facts']['configuration_sha256'],fingerprint(before));self.assertEqual(len(calls),1);self.assertEqual(self.service.store.runs(),[])
    def test_read_reuses_only_selected_receipt_without_probe_or_installer(self):
        factory=self.adapter();self.assertEqual(self.service.read_runtime_guide(self.selection)['status'],'not_run');self.service.probe(self.selection);factory.reset_mock()
        result=self.service.read_runtime_guide(self.selection);factory.assert_not_called();self.assertEqual(result['status'],'observed');self.assertEqual(result['facts']['source_build_relation']['status'],'not_run')
        self.assertEqual(self.service.read_runtime_guide({**self.selection,'engine':'pygas.build'})['status'],'not_run');self.assertEqual(self.service.store.runs(),[])
    def test_registration_race_cannot_commit_a_current_receipt(self):
        def changed(environment):
            current=self.service.store.get('environment','selected');current['executables']['python']=str(self.root/'new-python');self.service.store.put('environment',current)
            return copy.deepcopy(self.report)
        self.adapter(changed)
        with self.assertRaisesRegex(ValueError,'registration changed'):self.service.probe(self.selection)
        self.assertFalse((self.service.root/'runtime-guides').exists());self.assertEqual(self.service.store.runs(),[])
    def test_racing_registration_preserves_existing_pointer_but_it_is_stale(self):
        factory=self.adapter();self.service.probe(self.selection);pointer=self.service.root/'runtime-guides/selected/pydyn.md/current.json';previous=pointer.read_bytes()
        def changed(environment):
            current=self.service.store.get('environment','selected');current['variables']['LD_LIBRARY_PATH']='changed';self.service.store.put('environment',current);return copy.deepcopy(self.report)
        factory.return_value.probe.side_effect=changed
        with self.assertRaisesRegex(ValueError,'registration changed'):self.service.probe(self.selection)
        self.assertEqual(pointer.read_bytes(),previous);self.assertEqual(self.service.read_runtime_guide(self.selection)['status'],'stale')
    def test_probe_failure_blocks_current_availability_without_fabricating_imports(self):
        factory=self.adapter();first=self.service.probe(self.selection)['runtime_guide'];old=self.service.root/'runtime-guides/selected/pydyn.md/versions'/first['receipt'];oldbytes=(old/'runtime.json').read_bytes()
        factory.return_value.probe.side_effect=ValueError('private-loader-value never-emit')
        with self.assertRaises(ValueError):self.service.probe(self.selection)
        current=self.service.read_runtime_guide(self.selection);self.assertEqual(current['status'],'blocked');self.assertEqual(current['facts']['probe_status'],'failed');self.assertNotIn('python',current['facts']);self.assertNotIn('modules',current['facts']);self.assertNotIn('never-emit',json.dumps(current));self.assertEqual((old/'runtime.json').read_bytes(),oldbytes);self.assertEqual(self.service.store.runs(),[])
    def test_mismatched_report_scope_does_not_publish_observed_state(self):
        self.report['scope']['engine']='hotpp.train';self.adapter()
        with self.assertRaisesRegex(ValueError,'scoped'):self.service.probe(self.selection)
        self.assertEqual(self.service.read_runtime_guide(self.selection)['status'],'blocked')
    def test_source_changed_between_probe_and_commit_is_blocked(self):
        def changed(environment):self.module.write_text('changed');return copy.deepcopy(self.report)
        self.adapter(changed)
        with self.assertRaisesRegex(ValueError,'changed during probe'):self.service.probe(self.selection)
        self.assertEqual(self.service.read_runtime_guide(self.selection)['status'],'blocked');self.assertEqual(self.service.store.runs(),[])
    def test_full_configuration_change_invalidates_only_this_environment(self):
        self.adapter();self.service.probe(self.selection);other={**self.environment,'id':'other'};self.service.store.put('environment',other)
        self.assertEqual(self.service.read_runtime_guide({'environment_id':'other','engine':'pydyn.md'})['status'],'not_run')
        current=self.service.store.get('environment','selected');current['name']='renamed';self.service.store.put('environment',current)
        self.assertEqual(self.service.read_runtime_guide(self.selection)['status'],'stale')
    def test_legacy_probe_default_stays_selected_pydyn_md(self):
        factory=self.adapter();result=self.service.probe({'environment_id':'selected'});factory.assert_called_once_with('pydyn.md');self.assertEqual(result['runtime_guide']['facts']['engine'],'pydyn.md')
    def test_invalid_selection_never_calls_adapter_or_touches_jobs(self):
        factory=self.adapter()
        for data in [None,{}, {'environment_id':'../foreign','engine':'pydyn.md'}, {'environment_id':'selected','engine':'foreign'}]:
            with self.assertRaises(ValueError):self.service.probe(data)
        factory.assert_not_called();self.assertEqual(self.service.store.runs(),[])


if __name__=='__main__':unittest.main()
