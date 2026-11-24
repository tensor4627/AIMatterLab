# Consolidated suite generated from: test_run_environment_identity.py, test_runtime_metadata_view.py, test_runtime_projection.py, test_runtime_resources.py, test_worker_connection.py
import sys, unittest
from pathlib import Path
if str(Path(__file__).resolve().parents[1]) not in sys.path: sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# --- section: test_run_environment_identity.py ---
import sys, unittest, tempfile, json, copy, hashlib
from pathlib import Path as _s0_Path
from types import SimpleNamespace as _s0_SimpleNamespace
sys.path.insert(0, str(_s0_Path(__file__).resolve().parents[1]))
from studio_worker.infrastructure.store import Store
from studio_worker.server import dispatch, TOOL_ROUTES
from studio_worker.compute.runtime_guides import fingerprint
class Identity(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(_s0_Path(self.temp.name))
        self.environment = {'id': 'env', 'name': '中文 环境', 'executables': {'python': '/registered/python'}, 'variables': {'THREAD_SETTING': 1}}
        self.run = {'id': 'run', 'project_id': 'owned', 'environment_id': 'env', 'engine': 'pygas.build', 'environment_snapshot': copy.deepcopy(self.environment), 'status': 'draft', 'request_hash': 'test', 'idempotency_key': 'key'}
        self.store.add_run(self.run)
        self.service = _s0_SimpleNamespace(store=self.store)

    def tearDown(self):
        self.store.db.close()
        self.temp.cleanup()

    def identity(self, args=None, admin=True):
        return dispatch(self.service, 'POST', '/api/run/environment-identity', args or {'run_id': 'run'}, admin=admin)

    def test_actual_dispatch_is_readonly_admin_minimal_closed_shape(self):
        before = self.store.run('run')
        v = self.identity()
        self.assertEqual(v['configuration_sha256'], fingerprint(self.environment))
        self.assertEqual(set(v), {'kind', 'run_id', 'project_id', 'environment_id', 'engine', 'configuration_sha256', 'interpreter'})
        self.assertEqual(self.store.run('run'), before)
        self.assertFalse(any((path == '/api/run/environment-identity' for _, path, _ in TOOL_ROUTES.values())))

    def test_int_float_lexemes_use_actual_python_immutable_hash_not_current_registration(self):
        a = self.identity()['configuration_sha256']
        self.run['environment_snapshot']['variables']['THREAD_SETTING'] = 1.0
        self.store.update(self.run, environment_snapshot=self.run['environment_snapshot'])
        b = self.identity()['configuration_sha256']
        self.assertNotEqual(a, b)
        self.assertEqual(self.environment['variables']['THREAD_SETTING'], 1)
        self.assertEqual(b, fingerprint(self.store.run('run')['environment_snapshot']))

    def test_same_id_python_repository_loader_extra_fields_change_identity(self):
        before = self.identity()['configuration_sha256']
        for key, value in [('executables', {'python': '/unreviewed/python'}), ('repositories', {'pygas': '/unreviewed/repo'}), ('variables', {'LD_LIBRARY_PATH': '/unreviewed/loader'}), ('unknown', True)]:
            with self.subTest(key=key):
                changed = copy.deepcopy(self.run)
                changed['environment_snapshot'][key] = value
                self.store.update(changed, environment_snapshot=changed['environment_snapshot'])
                self.assertNotEqual(self.identity()['configuration_sha256'], before)

    def test_nonadmin_and_forged_unknownkeys_are_blocked(self):
        with self.assertRaises(PermissionError):
            self.identity(admin=False)
        for extra in ('snapshot', 'environment_id', 'configuration_sha256', 'path', 'project_id'):
            with self.subTest(extra=extra):
                with self.assertRaises(ValueError):
                    self.identity({'run_id': 'run', extra: 'forged'})

    def test_unknown_run_and_missing_snapshot_are_blocked(self):
        with self.assertRaises(ValueError):
            self.identity({'run_id': 'unknown'})
        for value in (None, {'id': 'env'}, {'id': 'other', 'executables': {'python': '/env/python'}}):
            self.run['environment_snapshot'] = value
            self.store.update(self.run, environment_snapshot=value)
            with self.assertRaises(ValueError):
                self.identity()

# --- section: test_runtime_metadata_view.py ---
'Runtime metadata projection only; synthetic receipts, no target imports/probe.'
import copy, hashlib, importlib.util, json, pathlib, sys, tempfile, unittest
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from studio_worker.transport import runtime_projection as projection
from studio_worker import server
from studio_worker.compute.runtime_guides import RuntimeGuides
def receipt(facts, status=None):
    return {'status': status or facts['state'], 'receipt': hashlib.sha256((json.dumps(facts, ensure_ascii=False, indent=2) + '\n').encode()).hexdigest(), 'skill_sha256': 'e' * 64, 'facts': facts}
def fixture():
    return receipt({'schema_version': 1, 'environment_id': 'selected', 'engine': 'pydyn.sampling', 'configuration_sha256': 'c' * 64, 'state': 'observed', 'observed_at': 1, 'python': {'executable': '/registered/python', 'version': '3.12\nactual version', 'registration_match': True}, 'executables': {'python': '/registered/python'}, 'repositories': {'pydyn': {'path': '/public/.codex/worktrees/synthetic/pydyn', 'commit': None, 'dirty': None, 'status': 'not_run'}}, 'modules': {'pydyn': {'file': '/public/.codex/worktrees/synthetic/pydyn/pydyn/__init__.py', 'version': '0.1', 'source_sha256': 'a' * 64, 'status': 'passed', 'registration_match': True}}, 'capabilities': {'pygas': {}, 'pydyn_sampling': {'available': True, 'origin': '/public/.codex/worktrees/synthetic/pydyn/pydyn/sampling/__init__.py', 'upstream': {'commit': 'b' * 40, 'version': 'public-v1'}}}, 'native_runtime': {'status': 'not_run', 'scope': 'No native ELF check for this route'}, 'cuda': {'available': True, 'version': '12.8', 'gpu': 'synthetic GPU'}, 'scientific_status': 'not_run'})
ARGS = {'environment_id': 'selected', 'engine': 'pydyn.sampling'}
class ProjectionTests(unittest.TestCase):

    def call(self, value, args=ARGS):
        with patch.object(server, 'dispatch', return_value=value):
            return server.mcp_tool_call(object(), {'name': 'read_runtime_guide', 'arguments': args})

    def test_actual_mcp_three_paths_hash_only_and_raw_receipt_unchanged(self):
        raw = fixture()
        before = copy.deepcopy(raw)
        r = self.call(raw)
        self.assertFalse(r['isError'])
        v = json.loads(r['content'][0]['text'])
        self.assertNotIn('.codex', json.dumps(v))
        self.assertEqual(raw, before)
        self.assertEqual(v['receipt'], raw['receipt'])
        self.assertEqual(v['environment_id'], 'selected')
        self.assertEqual(v['engine'], 'pydyn.sampling')
        self.assertEqual(v['facts']['repositories']['pydyn']['commit'], None)
        self.assertEqual(v['facts']['repositories']['pydyn']['status'], 'not_run')
        for item, key, original, role in [(v['facts']['repositories']['pydyn'], 'path', raw['facts']['repositories']['pydyn']['path'], 'registered_source:pydyn'), (v['facts']['modules']['pydyn'], 'file', raw['facts']['modules']['pydyn']['file'], 'imported_module:pydyn'), (v['facts']['capabilities']['pydyn_sampling'], 'origin', raw['facts']['capabilities']['pydyn_sampling']['origin'], 'sampling_module_origin')]:
            self.assertNotIn(key, item)
            self.assertEqual(item[key + '_identity'], {'role': role, 'available': True, 'redacted': True, 'path_sha256': hashlib.sha256(original.encode()).hexdigest()})
        self.assertTrue(v['projection']['source_path_fields_redacted'])
        self.assertNotIn('path_fields_redacted', v['projection'])
        self.assertIn('does not hash', v['projection']['receipt_scope'])
        self.assertEqual(v['facts']['python']['executable'], '/registered/python')

    def test_all_known_software_modules_redact_consistently(self):
        f = fixture()['facts']
        f['repositories'] = {n: {'path': '/public/.codex/worktrees/' + n} for n in projection.KNOWN_SOFTWARE}
        f['modules'] = {n: {'file': '/public/.codex/worktrees/' + n + '.py'} for n in projection.KNOWN_MODULES}
        v = projection.guide_for_agent(receipt(f), ARGS)
        self.assertNotIn('.codex', json.dumps(v))
        self.assertEqual(len(v['facts']['modules']), 6)
        self.assertEqual(len(v['facts']['repositories']), 5)

    def test_none_module_and_sampling_origin_are_unavailable_not_error(self):
        f = fixture()['facts']
        f['engine'] = 'pydyn.md'
        f['capabilities']['pydyn_sampling'].update(available=False, origin=None)
        f['modules']['cupy'] = {'file': None, 'version': None, 'status': 'blocked'}
        raw = receipt(f)
        v = projection.guide_for_agent(raw, {'environment_id': 'selected', 'engine': 'pydyn.md'})
        self.assertEqual(v['status'], 'observed')
        self.assertFalse(v['facts']['capabilities']['pydyn_sampling']['available'])
        self.assertIsNone(v['facts']['capabilities']['pydyn_sampling']['origin'])
        self.assertNotIn('path_sha256', v['facts']['capabilities']['pydyn_sampling']['origin_identity'])
        self.assertFalse(v['facts']['modules']['cupy']['file_identity']['available'])

    def test_real_ordinary_md_guide_with_unavailable_sampling_remains_observed(self):
        with tempfile.TemporaryDirectory(prefix='runtime-view-') as tmp:
            root = pathlib.Path(tmp)
            repo = root / 'public'
            (repo / 'pydyn').mkdir(parents=True)
            module = repo / 'pydyn/__init__.py'
            module.write_text('# synthetic source, never import')
            env = {'id': 'selected', 'executables': {'python': sys.executable}, 'repositories': {'pydyn': str(repo)}}
            probe = {'scope': {'engine': 'pydyn.md'}, 'executable': sys.executable, 'python': sys.version, 'modules': {'pydyn': {'file': str(module), 'status': 'passed'}}, 'repositories': {'pydyn': {'path': str(repo), 'commit': None, 'dirty': None, 'status': 'not_run'}}, 'pydyn_sampling': False, 'pydyn_sampling_origin': None}
            g = RuntimeGuides(root / 'guides')
            g.record(env, 'pydyn.md', probe)
            raw = g.read(env, 'pydyn.md')
            self.assertEqual(raw['status'], 'observed')
            before = copy.deepcopy(raw)
            view = projection.guide_for_agent(raw, {'environment_id': 'selected', 'engine': 'pydyn.md'})
            self.assertEqual(view['status'], 'observed')
            self.assertIsNone(view['facts']['capabilities']['pydyn_sampling']['origin'])
            self.assertEqual(raw, before)

    def test_real_md_upstream_descriptive_commit_markers_preserve_raw_value(self):
        with tempfile.TemporaryDirectory(prefix='runtime-upstream-view-') as tmp:
            root = pathlib.Path(tmp)
            repo = root / 'public'
            (repo / 'pydyn').mkdir(parents=True)
            module = repo / 'pydyn/__init__.py'
            module.write_text('# synthetic source, never import')
            env = {'id': 'selected', 'executables': {'python': sys.executable}, 'repositories': {'pydyn': str(repo)}}
            g = RuntimeGuides(root / 'guides')
            for marker in ('A' * 40, 'unknown'):
                with self.subTest(marker=marker):
                    probe = {'scope': {'engine': 'pydyn.md'}, 'executable': sys.executable, 'python': sys.version, 'modules': {'pydyn': {'file': str(module), 'status': 'passed'}}, 'repositories': {'pydyn': {'path': str(repo), 'commit': None, 'dirty': None, 'status': 'not_run'}}, 'pydyn_sampling': False, 'pydyn_sampling_origin': None, 'pygas_upstream': {'commit': marker}}
                    g.record(env, 'pydyn.md', probe)
                    raw = g.read(env, 'pydyn.md')
                    before = copy.deepcopy(raw)
                    v = projection.guide_for_agent(raw, {'environment_id': 'selected', 'engine': 'pydyn.md'})
                    self.assertEqual(v['status'], 'observed')
                    self.assertEqual(v['facts']['capabilities']['pydyn_sampling']['upstream']['commit'], marker)
                    self.assertEqual(v['facts']['repositories']['pydyn']['status'], 'not_run')
                    self.assertEqual(raw, before)

    def test_blocked_real_probe_receipt_and_missing_native_module_do_not_upgrade(self):
        with tempfile.TemporaryDirectory(prefix='runtime-blocked-view-') as tmp:
            env = {'id': 'selected', 'executables': {'python': sys.executable}}
            g = RuntimeGuides(pathlib.Path(tmp))
            g.record_failure(env, 'gpumd.md', RuntimeError('synthetic failure'))
            raw = g.read(env, 'gpumd.md')
            v = projection.guide_for_agent(raw, {'environment_id': 'selected', 'engine': 'gpumd.md'})
            self.assertEqual(v['status'], 'blocked')
            self.assertEqual(v['facts']['probe_status'], 'failed')
        f = fixture()['facts']
        f['state'] = 'blocked'
        f['modules']['ase'] = {'file': None, 'version': None, 'status': 'blocked'}
        f['native_runtime'] = {'status': 'blocked', 'executable': None, 'sha256': None, 'scope': 'Unavailable native executable'}
        v = projection.guide_for_agent(receipt(f), ARGS)
        self.assertEqual(v['status'], 'blocked')
        self.assertIsNone(v['facts']['native_runtime']['executable'])
        self.assertEqual(v['facts']['modules']['ase']['status'], 'blocked')

    def test_unknown_nested_fields_not_forwarded(self):
        f = fixture()['facts']
        f['unknown_body'] = {'body': 'SENTINEL'}
        f['python']['unknown_body'] = {'body': 'SENTINEL'}
        f['modules']['pydyn']['body'] = 'SENTINEL'
        f['modules']['unknown'] = {'file': 'SENTINEL', 'body': 'SENTINEL'}
        f['capabilities']['unknown'] = {'body': 'SENTINEL'}
        f['capabilities']['pydyn_sampling']['body'] = 'SENTINEL'
        f['capabilities']['pydyn_sampling']['upstream']['unknown'] = {'body': 'SENTINEL'}
        v = projection.guide_for_agent(receipt(f), ARGS)
        self.assertNotIn('SENTINEL', json.dumps(v))

    def test_known_nested_body_leaves_are_rejected(self):
        paths = [('python', 'version'), ('native_runtime', 'scope'), ('cuda', 'gpu'), ('cuda', 'version'), ('repositories', 'pydyn', 'commit'), ('modules', 'pydyn', 'version'), ('modules', 'pydyn', 'file'), ('capabilities', 'pydyn_sampling', 'upstream', 'version'), ('capabilities', 'pydyn_sampling', 'upstream', 'commit'), ('capabilities', 'pydyn_sampling', 'available')]
        for path in paths:
            for body in [{'body': 'SENTINEL'}, ['SENTINEL']]:
                with self.subTest(path=path, body=type(body).__name__):
                    f = fixture()['facts']
                    v = f
                    for key in path[:-1]:
                        v = v[key]
                    v[path[-1]] = body
                    r = self.call(receipt(f))
                    self.assertTrue(r['isError'])
                    self.assertNotIn('SENTINEL', r['content'][0]['text'])
        f = fixture()['facts']
        f['capabilities']['sampling'] = {'body': 'SENTINEL'}
        self.assertTrue(self.call(receipt(f))['isError'])

    def test_hash_commit_flag_and_length_types_are_checked(self):
        for change in [lambda f: f['repositories']['pydyn'].update(commit='notcommit'), lambda f: f['modules']['pydyn'].update(source_sha256='notsha'), lambda f: f['python'].update(registration_match=1), lambda f: f['python'].update(version='x' * 2049), lambda f: f['cuda'].update(available='yes'), lambda f: f.update(observed_at=float('inf'))]:
            f = fixture()['facts']
            change(f)
            with self.assertRaises(ValueError):
                projection.guide_for_agent(receipt(f), ARGS)

    def test_expected_environment_engine_and_raw_receipt_mutations_rejected(self):
        for change in [lambda v: v.update(environment_id='other'), lambda v: v['facts'].update(environment_id='other'), lambda v: v.update(engine='pydyn.md'), lambda v: v['facts'].update(engine='pydyn.md'), lambda v: v.update(receipt='0' * 64), lambda v: v.update(status='blocked')]:
            v = fixture()
            change(v)
            self.assertTrue(self.call(v)['isError'])

    def test_untouched_other_paths_stay_present_for_generic_guard(self):
        f = fixture()['facts']
        f['native_runtime']['scope'] = '/protected/.ssh/hidden'
        v = projection.guide_for_agent(receipt(f), ARGS)
        self.assertEqual(v['facts']['native_runtime']['scope'], '/protected/.ssh/hidden')
        self.assertEqual(v['facts']['python']['executable'], '/registered/python')

    def test_stale_and_not_run_no_facts_preserve_status_and_selected_identity(self):
        for status in ('stale', 'not_run', 'blocked'):
            v = projection.guide_for_agent({'status': status, 'environment_id': 'selected', 'engine': 'pydyn.sampling', 'reason': 'actual missing observation'}, ARGS)
            self.assertEqual(v['status'], status)
            self.assertNotIn('facts', v)

    def test_other_tool_result_is_unchanged(self):
        value = {'private_path': '/protected/.ssh/key'}
        self.assertIs(projection.result_for_agent('read_project_input', value), value)

# --- section: test_runtime_projection.py ---
import copy, json, unittest
from studio_worker.transport.runtime_projection import result_for_agent
class RuntimeProjection(unittest.TestCase):

    def test_full_private_receipt_is_unchanged_and_loader_facts_keep_their_actual_status(self):
        receipt = {'status': 'observed', 'environment_id': 'chosen', 'engine': 'pygas.build', 'receipt': 'f' * 64, 'skill_sha256': 'e' * 64, 'facts': {'python': {'executable': '/registered/python', 'version': '3.12', 'registration_match': True}, 'capabilities': {'sampling': False}, 'scientific_status': 'not_run', 'source_watch': [{'private_watch': 'MUST_NOT_ATTACH'}], 'file_observations': [{'raw': 'MUST_NOT_ATTACH'}]}}
        before = copy.deepcopy(receipt)
        value = result_for_agent('read_runtime_guide', receipt)
        self.assertEqual(receipt, before)
        self.assertNotIn('MUST_NOT_ATTACH', json.dumps(value))
        self.assertEqual(value['receipt'], receipt['receipt'])
        self.assertEqual(value['skill_sha256'], receipt['skill_sha256'])
        self.assertFalse(value['facts']['capabilities']['sampling'])
        self.assertEqual(value['facts']['scientific_status'], 'not_run')

    def test_missing_or_failed_receipt_never_becomes_observed_and_other_results_stay_exact(self):
        for status in ('not_run', 'blocked', 'stale'):
            value = result_for_agent('read_runtime_guide', {'status': status, 'reason': 'Real current cause'})
            self.assertEqual(value['status'], status)
            self.assertNotIn('facts', value)
        value = {'payload': [1, 2, 3]}
        self.assertIs(result_for_agent('read_log', value), value)

    def test_probe_reply_uses_actual_recorded_receipt_instead_of_repeating_import_and_install_inventories(self):
        value = result_for_agent('probe_environment', {'runtime_guide': {'status': 'blocked', 'reason': 'Actual selected import failed'}, 'private_loader_env': 'MUST_NOT_ATTACH', 'modules_dump': 'MUST_NOT_ATTACH'})
        self.assertEqual(value['runtime_guide']['status'], 'blocked')
        self.assertNotIn('MUST_NOT_ATTACH', json.dumps(value))

    def test_projection_keeps_actual_worker_receipt_identity_and_stale_result(self):
        import sys, tempfile, hashlib
        from pathlib import Path
        from studio_worker.compute.runtime_guides import RuntimeGuides
        base = Path(__file__).resolve().parents[3] / '.studio' / 'test-fixtures' / 'runtime-projection'
        base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='owned-receipt-', dir=base) as folder:
            env = {'id': 'owned-projection-fixture', 'executables': {'python': sys.executable}}
            probe = {'scope': {'engine': 'pygas.build'}, 'python': sys.version.split()[0], 'executable': sys.executable, 'modules': {}, 'repositories': {}}
            guides = RuntimeGuides(Path(folder))
            guides.record(env, 'pygas.build', probe)
            before = {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(folder).rglob('*') if p.is_file()}
            receipt = guides.read(env, 'pygas.build')
            value = result_for_agent('read_runtime_guide', receipt)
            self.assertEqual(value['status'], 'observed')
            self.assertEqual(value['receipt'], receipt['receipt'])
            self.assertEqual(value['skill_sha256'], receipt['skill_sha256'])
            self.assertEqual(value['facts']['python']['executable'], sys.executable)
            self.assertEqual(value['facts']['scientific_status'], 'not_run')
            self.assertNotIn('file_observations', value['facts'])
            after = {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(folder).rglob('*') if p.is_file()}
            self.assertEqual(before, after)
            changed = {**env, 'label': 'changed registration'}
            stale = result_for_agent('read_runtime_guide', guides.read(changed, 'pygas.build'))
            self.assertEqual(stale['status'], 'stale')
            self.assertNotIn('facts', stale)
class ClusterMetadataProjection(unittest.TestCase):

    def fixture(self):
        secret = 'PRIVATE_CLUSTER_SENTINEL'
        return {'id': 'owned-cluster', 'name': secret, 'scheduler': 'lsf', 'version': 3, 'host': secret, 'username': secret, 'port': secret, 'identity_file': secret, 'queue': secret, 'activation': secret, 'environment': {'executables': {'python': secret}}, 'queue_targets': [{'queue': secret, 'environment': secret}], 'probe': {'queue_status': 'passed', 'queues': [secret, secret, 'other-private-queue'], 'nodes': [secret], 'stdout': secret}, 'connection_check': {'status': 'passed', 'ssh_status': 'passed', 'scheduler_status': 'passed', 'compute_node_status': 'not_run', 'observed_at': 123.5, 'version': 3, 'hostname': secret, 'queue': secret, 'nodes': [secret], 'reason': secret, 'nested': {'secret': secret}}}

    def test_both_cluster_tools_return_only_allowlisted_metadata_and_preserve_original(self):
        cluster = self.fixture()
        before = copy.deepcopy(cluster)
        projected = result_for_agent('list_clusters', [cluster])[0]
        self.assertEqual(projected, {'id': 'owned-cluster', 'scheduler': 'lsf', 'version': 3, 'connection_check': {'status': 'passed', 'ssh_status': 'passed', 'scheduler_status': 'passed', 'compute_node_status': 'not_run', 'observed_at': 123.5, 'version': 3}, 'visible_queue_count': 2, 'declared_target_count': 1, 'scope': 'Cluster metadata and queue visibility only; no authorization or execution inferred.'})
        ready = {'environments': [], 'clusters': [cluster], 'scope': 'existing readiness'}
        self.assertEqual(result_for_agent('compute_readiness', ready), {'environments': [], 'clusters': [projected], 'scope': 'existing readiness'})
        self.assertNotIn('PRIVATE_CLUSTER_SENTINEL', json.dumps(projected))
        self.assertNotIn('other-private-queue', json.dumps(projected))
        self.assertEqual(cluster, before)

    def test_missing_stale_invalid_health_never_claims_passed_or_invents_queue_observation(self):
        for state in ('failed', 'stale', 'not_run', 'needs_human_auth'):
            result = result_for_agent('list_clusters', [{'id': 'fixture', 'connection_check': {'status': state, 'observed_at': float('nan'), 'reason': 'PRIVATE'}}])[0]
            self.assertEqual(result['connection_check'], {'status': state})
            self.assertNotIn('visible_queue_count', result)
        for probe in ({'queue_status': 'blocked', 'queues': []}, {'queues': []}):
            self.assertNotIn('visible_queue_count', result_for_agent('list_clusters', [{'id': 'fixture', 'probe': probe}])[0])
        self.assertEqual(result_for_agent('list_clusters', [{'id': 'fixture', 'probe': {'queue_status': 'passed', 'queues': []}}])[0]['visible_queue_count'], 0)
        result = result_for_agent('list_clusters', [{'id': 'fixture', 'version': True, 'scheduler': 'PRIVATE', 'connection_check': {'status': {'value': 'passed'}, 'observed_at': 'PRIVATE'}}])[0]
        self.assertEqual(result['connection_check'], {})
        self.assertNotIn('scheduler', result)
        self.assertNotIn('version', result)

    def test_environment_compact_and_unrelated_desktop_result_are_not_changed(self):
        env = {'id': 'local', 'name': 'Local', 'executables': {'python': '/approved/local/python'}, 'observation': {'cuda': {'available': False}, 'modules': {'ase': {'available': True}}}}
        result = result_for_agent('compute_readiness', {'environments': [env], 'clusters': [], 'scope': 'saved local registrations'})
        self.assertEqual(result['environments'], [{'id': 'local', 'name': 'Local', 'python': '/approved/local/python', 'cuda': {'available': False}, 'modules': {'ase': True}, 'scientific_status': 'not_run'}])
        value = {'private': 'desktop data'}
        self.assertIs(result_for_agent('unrelated_tool', value), value)

# --- section: test_runtime_resources.py ---
'Standalone distribution resources; no engine, daemon or user-state execution.'
import hashlib
from pathlib import Path as _s3_Path
import tempfile
import unittest
from runtime_resources import worker_files, runtime_identity, verify_tool_contract
class RuntimeResourcesTests(unittest.TestCase):

    def source(self, root):
        source = root / 'tests' / 'worker'
        (source / 'studio_worker').mkdir(parents=True)
        (source / 'bootstrap.py').write_text('# fixture\n', encoding='utf-8')
        (source / 'studio_worker' / 'engine_contracts.json').write_text('{"fixture":1}', encoding='utf-8')
        (source / 'studio_worker' / 'tool_package.schema.json').write_text('{"fixture":1}', encoding='utf-8')
        return source

    def test_inventory_uses_relative_exclusions_and_stable_utf8_posix_names(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.source(_s3_Path(directory))
            (source / 'studio_worker' / '\ue000.py').write_text('# a', encoding='utf-8')
            (source / 'studio_worker' / '𐀀.py').write_text('# b', encoding='utf-8')
            (source / 'tests').mkdir()
            (source / 'tests' / 'ignored.py').write_text('# ignored', encoding='utf-8')
            (source / 'studio_worker' / 'private.json').write_text('{}', encoding='utf-8')
            names = worker_files(source)
            self.assertEqual(names, ['bootstrap.py', 'studio_worker/engine_contracts.json', 'studio_worker/tool_package.schema.json', 'studio_worker/\ue000.py', 'studio_worker/𐀀.py'])
            digest = hashlib.sha256()
            for name in names:
                digest.update(name.encode('utf-8'))
                digest.update((source / name).read_bytes())
            self.assertEqual(runtime_identity(source, names), digest.hexdigest()[:20])

    def test_standalone_resource_needs_no_parent_canonical_but_checkout_must_match(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.source(_s3_Path(directory))
            verify_tool_contract(source)
            canonical = source.parent / 'contracts' / 'tools' / 'engine-contracts.json'
            canonical.parent.mkdir(parents=True)
            canonical.write_bytes((source / 'studio_worker' / 'engine_contracts.json').read_bytes())
            verify_tool_contract(source)
            canonical.write_text('{"fixture":2}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'stale'):
                verify_tool_contract(source)

    def test_local_contract_is_required_even_for_standalone_distribution(self):
        with tempfile.TemporaryDirectory() as directory:
            source = self.source(_s3_Path(directory))
            (source / 'studio_worker' / 'engine_contracts.json').unlink()
            with self.assertRaisesRegex(ValueError, 'unavailable'):
                verify_tool_contract(source)

# --- section: test_worker_connection.py ---
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path as _s4_Path
from types import SimpleNamespace as _s4_SimpleNamespace
sys.path.insert(0, str(_s4_Path(__file__).resolve().parents[1]))
from studio_worker.transport.server import load_tokens
class WorkerCredentialsTest(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = _s4_Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def write(self, value):
        path = self.root / 'connection.json'
        path.write_text(json.dumps(value))
        return path

    def test_missing_credentials_are_created_with_schema_and_are_stable(self):
        tokens = load_tokens(self.root)
        self.assertEqual(set(tokens), {'admin', 'mcp'})
        self.assertTrue(all((isinstance(value, str) and len(value) >= 16 for value in tokens.values())))
        stored = json.loads((self.root / 'connection.json').read_text())
        self.assertEqual(stored, {'schema_version': 1, **tokens})
        self.assertEqual(load_tokens(self.root), tokens)

    def test_legacy_credentials_are_validated_then_stamped_with_a_schema(self):
        legacy = {'admin': 'a' * 32, 'mcp': 'b' * 32}
        self.write(legacy)
        self.assertEqual(load_tokens(self.root), legacy)
        self.assertEqual(json.loads((self.root / 'connection.json').read_text()), {'schema_version': 1, **legacy})

    def test_malformed_credentials_fail_fast_without_being_rewritten(self):
        for value in (['not', 'an', 'object'], {'admin': 'a' * 32}, {'admin': 'short', 'mcp': 'b' * 32}):
            with self.subTest(value=value):
                path = self.write(value)
                before = path.read_text()
                with self.assertRaises(RuntimeError):
                    load_tokens(self.root)
                self.assertEqual(path.read_text(), before)

    def test_invalid_json_fails_fast(self):
        path = self.root / 'connection.json'
        path.write_text('{not json')
        with self.assertRaises(RuntimeError):
            load_tokens(self.root)
        self.assertEqual(path.read_text(), '{not json')

if __name__ == '__main__':
    unittest.main()
