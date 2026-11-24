# Consolidated suite generated from: test_authoring_workspace.py, test_private_copy_scope.py, test_private_lineage.py, test_workspace_io.py, test_workspace_layout.py
import sys, unittest
from pathlib import Path
if str(Path(__file__).resolve().parents[1]) not in sys.path: sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# --- section: test_authoring_workspace.py ---
import unittest, tempfile, sys
from pathlib import Path as _s0_Path
from studio_worker.service import Service as _s0_Service
from studio_worker.server import dispatch as _s0_dispatch
class AuthoringWorkspace(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.s = _s0_Service(_s0_Path(self.temp.name) / 'worker', schedule=False)
        self.s.register_environment({'id': 'cpu', 'name': 'authoring', 'executables': {'python': sys.executable}})

    def tearDown(self):
        self.s.close()
        self.s.store.db.close()
        self.temp.cleanup()

    def ensure(self, **kw):
        return _s0_dispatch(self.s, 'POST', '/api/authoring/context', {'workspace_id': 'task', 'name': 'CV', **kw}, admin=True)

    def test_empty_catalog_and_stale_project_are_repaired_without_execution_grants(self):
        c = self.ensure(project_id='stale')
        p = c['project']
        self.assertEqual(p['policy']['engines'], [])
        self.assertEqual(p['policy']['clusters'], [])
        self.assertEqual(c['environment_id'], 'cpu')
        self.assertEqual(self.ensure()['project']['id'], p['id'])
        self.assertEqual(len(self.s.store.list('project')), 1)
        with self.assertRaises(PermissionError):
            self.s.authorize({'project_id': p['id'], 'engine': 'pygas.build', 'environment_id': 'cpu', 'gpu': 0, 'max_seconds': 1})

    def test_mcp_cannot_create_workspace_or_adopt_or_change_policy(self):
        for route in ['/api/authoring/context', '/api/authoring/adopt']:
            with self.assertRaises(PermissionError):
                _s0_dispatch(self.s, 'POST', route, {'workspace_id': 't'}, admin=False)
        self.assertEqual(self.s.store.list('project'), [])

    def test_existing_project_policy_is_preserved(self):
        p = self.s.register_project({'id': 'real', 'name': 'real', 'policy': {'input_roots': [str(self.s.root)], 'environments': ['cpu'], 'engines': ['pydyn.md']}})
        self.assertEqual(self.ensure(project_id='real')['project'], p)

    def test_import_selected_structure_and_adopt_actual_inputs_without_broad_read_grant(self):
        file = _s0_Path(self.temp.name) / 'model.xyz'
        file.write_text('1\n\nH 0 0 0\n')
        c = self.ensure(structure_paths=[str(file)])
        copied = c['imports'][0]['path']
        self.assertEqual(_s0_Path(copied).name, 'model.xyz')
        self.assertTrue(_s0_Path(copied).is_file())
        self.assertEqual(self.ensure(project_id=c['project']['id'], structure_paths=[copied])['imports'][0]['path'], copied)
        self.assertNotIn(str(file.parent), c['project']['policy']['input_roots'])
        self.assertEqual(len(c['assets']), 1)
        p = self.s.register_project({'id': 'compute', 'name': 'compute', 'policy': {'input_roots': [str(self.s.root / 'compute')], 'environments': ['cpu'], 'engines': ['pydyn.md']}})
        out = _s0_dispatch(self.s, 'POST', '/api/authoring/adopt', {'source_project_id': c['project']['id'], 'target_project_id': p['id'], 'paths': [copied]}, admin=True)
        self.assertEqual(_s0_Path(out['paths'][copied]).read_bytes(), file.read_bytes())
        self.assertEqual(self.s.store.get('project', 'compute'), p)

    def test_private_file_and_symlink_import_rejected(self):
        with self.assertRaises(ValueError):
            self.ensure(structure_paths=['/tmp/secret.json'])
        file = _s0_Path(self.temp.name) / 'a.xyz'
        file.write_text('H')
        link = _s0_Path(self.temp.name) / 'b.xyz'
        link.symlink_to(file)
        with self.assertRaises(ValueError):
            self.ensure(structure_paths=[str(link)])

    def test_another_tasks_automatic_draft_is_not_reused(self):
        first = self.ensure()
        second = _s0_dispatch(self.s, 'POST', '/api/authoring/context', {'workspace_id': 'other', 'project_id': first['project']['id'], 'name': 'New workflow'}, admin=True)
        self.assertNotEqual(first['project']['id'], second['project']['id'])
        self.assertEqual(second['project']['authoring_task_id'], 'other')
        self.assertEqual(second['project']['policy']['engines'], [])

    def test_human_selected_scientific_file_is_copied_without_loading_or_broad_roots(self):
        file = _s0_Path(self.temp.name) / 'model.pt'
        file.write_bytes(b'never deserialize this input')
        c = self.ensure(selected_paths=[str(file)])
        target = _s0_Path(c['imports'][0]['path'])
        self.assertEqual(target.name, 'model.pt')
        self.assertEqual(target.read_bytes(), file.read_bytes())
        self.assertEqual(c['assets'][0]['kind'], 'input')
        self.assertNotIn(str(file.parent), c['project']['policy']['input_roots'])
        with self.assertRaises(ValueError):
            self.ensure(selected_paths=[str(_s0_Path(self.temp.name) / 'id_rsa')])

    def test_short_draft_name_does_not_embed_the_whole_multiline_request(self):
        c = self.ensure(name='x' * 100 + '\nprivate second line')
        self.assertLessEqual(len(c['project']['name']), 33)
        self.assertNotIn('second line', c['project']['name'])

# --- section: test_private_copy_scope.py ---
import sys
import tempfile
import unittest
from pathlib import Path as _s1_Path
sys.path.insert(0, str(_s1_Path(__file__).resolve().parents[1]))
from studio_worker.compute.cluster import private_copy_rows
class PrivateCopyRowsTest(unittest.TestCase):

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = _s1_Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.rows = [{'entry_id': 'entry', 'project_id': 'owned', 'workspace_id': 'workspace', 'bindings': {'spec_sha256': 'a' * 64}, 'paths': [str(self.root / 'projects/owned/inputs/build_bias.py')]}]
        self.runs = [{'project_id': 'owned', 'directory': str(self.root / 'runs/owned-run')}]

    def selected(self, *paths):
        return private_copy_rows(self.rows, [_s1_Path(value) for value in paths], self.runs, self.root)

    def test_owned_input_root_and_exact_paths_block_remote_copy(self):
        for path in (self.root / 'projects/owned/inputs/build_bias.py', self.root / 'projects/owned/inputs/nested/any.xyz', self.root / 'runs/owned-run/simulation/output.xyz'):
            with self.subTest(path=path):
                self.assertEqual([row['entry_id'] for row in self.selected(path)], ['entry'])

    def test_unrelated_public_inputs_no_longer_block_the_whole_project(self):
        for path in (self.root / 'policy-inputs/public.xyz', self.root / 'projects/other/inputs/other.py'):
            with self.subTest(path=path):
                self.assertEqual(self.selected(path), [])

    def test_no_private_rows_means_no_selection(self):
        self.assertEqual(private_copy_rows([], [self.root / 'projects/owned/inputs/a'], self.runs, self.root), [])

# --- section: test_private_lineage.py ---
import copy, sys, tempfile, unittest
from pathlib import Path as _s2_Path
sys.path.insert(0, str(_s2_Path(__file__).resolve().parents[1]))
from studio_worker.service import Service as _s2_Service
from studio_worker.workspace.custom_cv_service import CustomCvService
from studio_worker.workspace.private_lineage import propagate, versions_for
from test_custom_cv import SPEC
class ExactPrivateVersions(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.service = _s2_Service(_s2_Path(self.temp.name) / 'worker', schedule=False)
        self.addCleanup(self.close)
        self.cv = CustomCvService(self.service)
        self.directory = self.service.root / 'projects/owned/inputs/cv-conversation'
        self.directory.mkdir(parents=True)
        self.input = self.directory / 'workflow.json'
        self.input.write_text('{}')
        self.item = self.cv.library.propose(SPEC, {'atom_i': 0, 'atom_j': 1}, workspace_id='conversation', project_id='owned')
        self.item = self.cv.library.approve_formula(self.item['id'], self.item['expected'])
        self.item = self.cv.library.share(self.item['id'], self.item['expected'], 'codex', True)
        self.old = self.version(self.item)
        self.lineage(self.item)

    def close(self):
        self.service.close()
        self.service.store.db.close()

    def version(self, item):
        return {'entry_id': item['id'], **{key: item[key] for key in ('spec_sha256', 'code_sha256', 'parameters_sha256')}}

    def lineage(self, item):
        self.service.store.put('private-cv-lineage', {'id': 'canonical', 'entry_id': item['id'], 'project_id': 'owned', 'workspace_id': 'conversation', 'bindings': {key: item[key] for key in ('spec_sha256', 'code_sha256', 'parameters_sha256')}, 'paths': [str(self.input)]})

    def add_policy_run(self, name, versions):
        directory = self.service.root / 'runs' / name
        directory.mkdir(parents=True)
        path = directory / 'input.py'
        path.write_text('# software policy fixture, never executed')
        run = {'id': name, 'project_id': 'owned', 'idempotency_key': name, 'request_hash': name, 'status': 'draft', 'directory': str(directory), 'private_cv_entries': [self.item['id']]}
        if versions is not None:
            run['private_cv_versions'] = versions
        self.service.store.add_run(run)
        return path

    def test_current_same_project_copies_do_not_create_mutable_duplicate_lineage(self):
        for _ in range(3):
            self.assertEqual(propagate(self.service, [str(self.input)], 'owned'), [self.item['id']])
        self.assertEqual(len(self.service.store.list('private-cv-lineage')), 1)
        self.assertEqual(versions_for(self.service, [str(self.input)]), [self.old])

    def test_new_shared_revision_does_not_authorize_old_runs_or_depend_on_prepare_order(self):
        old_path = self.add_policy_run('old', [self.old])
        self.item = self.cv.library.propose(SPEC, {'atom_i': 1, 'atom_j': 0}, workspace_id='conversation', project_id='owned', identifier=self.item['id'], expected=self.item['expected'])
        self.lineage(self.item)
        self.assertIn('owned', self.cv.access('codex')['blocked_project_ids'])
        self.item = self.cv.library.share(self.item['id'], self.item['expected'], 'codex', True)
        new = self.version(self.item)
        self.add_policy_run('current', [new])
        self.add_policy_run('unknown', None)
        for _ in range(3):
            access = self.cv.access('codex')
            self.assertEqual(access['blocked_project_ids'], [])
            self.assertEqual(access['blocked_run_ids'], ['old', 'unknown'])
            self.assertIn(str(old_path.parent), access['blocked_paths'])
            propagate(self.service, [str(self.input)], 'owned')
        self.assertEqual(versions_for(self.service, [str(old_path)]), [self.old])
        self.assertEqual(versions_for(self.service, [str(self.input)]), [new])
        self.item = self.cv.library.share(self.item['id'], self.item['expected'], 'codex', False)
        self.assertEqual(self.cv.access('codex')['blocked_run_ids'], ['current', 'old', 'unknown'])

    def test_cross_project_old_run_copy_retains_old_version_before_any_bytes_are_copied(self):
        old_path = self.add_policy_run('old', [self.old])
        self.item = self.cv.library.propose(SPEC, {'atom_i': 1, 'atom_j': 0}, workspace_id='conversation', project_id='owned', identifier=self.item['id'], expected=self.item['expected'])
        self.lineage(self.item)
        self.item = self.cv.library.share(self.item['id'], self.item['expected'], 'codex', True)
        propagate(self.service, [str(old_path)], 'target')
        rows = [row for row in self.service.store.list('private-cv-lineage') if row['project_id'] == 'target']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['bindings']['parameters_sha256'], self.old['parameters_sha256'])
        self.assertIn('target', self.cv.access('codex')['blocked_project_ids'])
        self.assertFalse((self.service.root / 'projects/target').exists())

    def test_empty_legacy_run_versions_cannot_be_replaced_by_current_sharing_on_copy(self):
        path = self.add_policy_run('empty', [])
        self.assertEqual(versions_for(self.service, [str(path)]), [{'entry_id': self.item['id'], 'version_status': 'unknown'}])
        propagate(self.service, [str(path)], 'target')
        self.assertIn('empty', self.cv.access('codex')['blocked_run_ids'])
        self.assertIn('target', self.cv.access('codex')['blocked_project_ids'])

    def test_legacy_shadow_record_is_retained_without_granting_its_old_run(self):
        self.add_policy_run('old', [self.old])
        legacy = {**self.service.store.get('private-cv-lineage', 'canonical'), 'id': 'legacy-shadow', 'source_project_id': 'owned'}
        self.service.store.put('private-cv-lineage', legacy)
        self.item = self.cv.library.propose(SPEC, {'atom_i': 1, 'atom_j': 0}, workspace_id='conversation', project_id='owned', identifier=self.item['id'], expected=self.item['expected'])
        self.lineage(self.item)
        self.item = self.cv.library.share(self.item['id'], self.item['expected'], 'codex', True)
        access = self.cv.access('codex')
        self.assertEqual(access['blocked_project_ids'], [])
        self.assertEqual(access['blocked_run_ids'], ['old'])
        self.assertEqual(len(self.service.store.list('private-cv-lineage')), 2)

# --- section: test_workspace_io.py ---
import unittest, tempfile
from pathlib import Path as _s3_Path
from studio_worker.service import Service as _s3_Service
from studio_worker.server import dispatch as _s3_dispatch, tools
class WorkspaceIO(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = _s3_Path(self.temp.name)
        self.s = _s3_Service(self.root / 'worker', schedule=False)
        self.p = self.s.register_project({'id': 'p', 'name': 'p', 'policy': {'input_roots': [str(self.root / 'approved')], 'environments': [], 'engines': []}})
        (self.root / 'approved').mkdir()

    def tearDown(self):
        self.s.close()
        self.s.store.db.close()
        self.temp.cleanup()

    def call(self, route, **data):
        return _s3_dispatch(self.s, 'POST', '/api/workspace/' + route, {'project_id': 'p', **data})

    def test_nested_save_read_and_compare_before_overwrite(self):
        first = self.call('write', name='cv-hash/build_bias.py', content='temp=300')
        read = self.call('read', name='cv-hash/build_bias.py')
        self.assertEqual(read['text'], 'temp=300')
        self.assertEqual(first['sha256'], read['sha256'])
        with self.assertRaisesRegex(ValueError, 'expected_sha256'):
            self.call('write', name='cv-hash/build_bias.py', content='temp=310')
        second = self.call('write', name='cv-hash/build_bias.py', content='temp=310', expected_sha256=read['sha256'])
        self.assertNotEqual(first['sha256'], second['sha256'])
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.call('write', name='cv-hash/build_bias.py', content='temp=320', expected_sha256=read['sha256'])
        self.assertEqual(self.call('read', name='cv-hash/build_bias.py')['text'], 'temp=310')

    def test_explicit_desktop_editor_save_keeps_legacy_human_boundary(self):
        self.call('write', name='edited.py', content='a=1')
        _s3_dispatch(self.s, 'POST', '/api/workspace/write', {'project_id': 'p', 'name': 'edited.py', 'content': 'a=2'}, admin=True)
        self.assertEqual(self.call('read', name='edited.py')['text'], 'a=2')
        with self.assertRaises(ValueError):
            self.call('write', name='/'.join(['x'] * 13), content='bad')

    def test_existing_authorized_inputs_are_readable_without_importing_or_executing(self):
        p = self.root / 'approved' / 'run.py'
        p.write_text('raise RuntimeError("must never execute")')
        r = self.call('read', name=str(p))
        self.assertIn('must never execute', r['text'])
        self.assertFalse(r['binary'])
        p = self.root / 'approved' / 'model.pt'
        p.write_bytes(b'not a safe model')
        r = self.call('read', name=str(p))
        self.assertTrue(r['binary'])
        self.assertIsNone(r['text'])

    def test_bounded_reads_and_no_arbitrary_path_or_nested_write_escape(self):
        self.call('write', name='large.txt', content='a' * 300000)
        r = self.call('read', name='large.txt')
        self.assertEqual(len(r['text']), 256 * 1024)
        self.assertTrue(r['truncated'])
        for route in ['read', 'write']:
            for name in ['../secret.txt', '/etc/passwd']:
                with self.assertRaises(ValueError):
                    self.call(route, name=name, content='forbidden')

    def test_asset_kind_errors_point_to_text_reader_and_mcp_annotation(self):
        with self.assertRaisesRegex(ValueError, 'read_project_input'):
            self.s.inspect('p', 'none', 'x', 'script')
        t = next((t for t in tools() if t['name'] == 'read_project_input'))
        self.assertTrue(t['annotations']['readOnlyHint'])

    def test_utf8_chunks_do_not_replace_split_chinese_characters(self):
        text = 'a' * (256 * 1024 - 1) + '中文末尾'
        self.call('write', name='unicode.py', content=text)
        first = self.call('read', name='unicode.py')
        second = self.call('read', name='unicode.py', offset=first['offset'])
        self.assertEqual(first['text'] + second['text'], text)
        self.assertNotIn('�', first['text'] + second['text'])
        bad = self.root / 'approved' / 'binary.py'
        bad.write_bytes(b'bad\xffutf8')
        r = self.call('read', name=str(bad))
        self.assertTrue(r['binary'])
        self.assertIsNone(r['text'])

    def test_regression_inspector_keeps_existing_scientific_analysis_available(self):
        import sys
        self.s.register_environment({'id': 'e', 'name': 'test', 'executables': {'python': sys.executable}})
        p = self.s.store.get('project', 'p')
        p['policy']['environments'] = ['e']
        self.s.store.put('project', p)
        folder = self.root / 'approved' / 'predictions'
        folder.mkdir()
        (folder / 'energy_test.out').write_text('1 1\n2 2\n')
        (folder / 'force_test.out').write_text('0 0 0 0 0 0\n')
        report = self.s.inspect('p', 'e', str(folder), 'regression')
        self.assertEqual(report['metrics']['energy']['rmse'], 0)
        self.assertEqual(report['metrics']['virial']['status'], 'not_run')
        enum = next((t for t in tools() if t['name'] == 'inspect_asset'))['inputSchema']['properties']['kind']['enum']
        self.assertIn('regression', enum)
        self.assertNotIn('script', enum)
class SourcePreservation(unittest.TestCase):

    def test_engine_processes_never_generate_source_bytecode(self):
        from studio_worker.adapters import process_env
        self.assertEqual(process_env({})['PYTHONDONTWRITEBYTECODE'], '1')
        self.assertEqual(process_env({'variables': {'PYTHONDONTWRITEBYTECODE': '1'}})['PYTHONDONTWRITEBYTECODE'], '1')
        with self.assertRaises(ValueError):
            process_env({'variables': {'PYTHONDONTWRITEBYTECODE': '0'}})

# --- section: test_workspace_layout.py ---
import tempfile, unittest, sys
from pathlib import Path as _s4_Path
from studio_worker.service import Service as _s4_Service
from studio_worker.server import dispatch as _s4_dispatch
class WorkspaceLayout(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = _s4_Service(_s4_Path(self.tmp.name) / 'worker', schedule=False)
        self.s.register_environment({'id': 'python', 'name': 'fixture', 'executables': {'python': sys.executable}})

    def tearDown(self):
        self.s.close()
        self.s.store.db.close()
        self.tmp.cleanup()

    def call(self, action, data, admin=True):
        return _s4_dispatch(self.s, 'POST', '/api/studio-workspace/' + action, data, admin=admin)

    def create(self):
        return self.call('create', {'id': 'workspace-cu', 'name': 'Cu sampling', 'asset_mode': 'copy'})

    def test_named_layout_does_not_grant_execution_or_replace_another_project(self):
        w = self.create()
        p = self.s.store.get('project', w['id'])
        self.assertEqual(p['policy']['engines'], [])
        self.assertTrue((_s4_Path(w['root']) / 'gpumd/inputs').is_dir())
        self.assertTrue((_s4_Path(w['root']) / 'pygas/biases').is_dir())
        self.assertEqual(self.create()['id'], w['id'])
        self.assertEqual(len(self.s.store.list('project')), 1)
        with self.assertRaises(ValueError):
            self.call('create', {'id': w['id'], 'name': 'foreign', 'asset_mode': 'copy'})

    def test_mcp_cannot_choose_create_retain_or_import(self):
        for action in ['create', 'read', 'import', 'retain']:
            with self.assertRaises(PermissionError):
                self.call(action, {}, admin=False)
        self.assertEqual(self.s.store.list('project'), [])

    def test_copy_deduplicates_and_links_remain_links_with_exact_file_grants(self):
        w = self.create()
        source = _s4_Path(self.tmp.name) / 'atoms.xyz'
        source.write_text('1\n\nH 0 0 0\n')
        args = {'project_id': w['id'], 'source': str(source), 'role': 'structure', 'mode': 'copy'}
        copied = self.call('import', args)
        self.assertEqual(self.call('import', args)['path'], copied['path'])
        self.assertFalse(_s4_Path(copied['path']).is_symlink())
        self.assertNotIn(str(source.parent), self.s.store.get('project', w['id'])['policy']['input_roots'])
        linked = self.call('import', {**args, 'mode': 'link'})
        self.assertTrue(_s4_Path(linked['path']).is_symlink())
        policy = self.s.store.get('project', w['id'])['policy']
        self.assertIn(str(source), policy['input_roots'])
        self.assertNotIn(str(source.parent), policy['input_roots'])
        read = _s4_dispatch(self.s, 'POST', '/api/workspace/read', {'project_id': w['id'], 'name': linked['path']}, admin=False)
        self.assertEqual(read['sha256'], linked['sha256'])
        source.write_text('changed')
        with self.assertRaises(ValueError):
            self.call('import', {**args, 'source': linked['path']})
        self.assertEqual(_s4_Path(copied['path']).read_text(), '1\n\nH 0 0 0\n')

    def test_retain_only_previously_authorized_inputs_without_copying_or_engine_grants(self):
        w = self.create()
        owned = _s4_Path(self.tmp.name) / 'owned'
        owned.mkdir()
        file = owned / 'run.in'
        file.write_text('run 1')
        self.s.register_project({'id': 'previous', 'name': 'previous', 'policy': {'engines': [], 'input_roots': [str(owned)]}})
        self.call('retain', {'project_id': w['id'], 'previous_project_id': 'previous', 'sources': [str(file)]})
        p = self.s.store.get('project', w['id'])
        self.assertIn(str(file), p['policy']['input_roots'])
        self.assertNotIn(str(owned), p['policy']['input_roots'])
        self.assertEqual(p['policy']['engines'], [])
        outside = _s4_Path(self.tmp.name) / 'private'
        outside.write_text('unselected')
        with self.assertRaises(ValueError):
            self.call('retain', {'project_id': w['id'], 'previous_project_id': 'previous', 'sources': [str(outside)]})

    def test_reused_workspace_is_shared_only_after_explicit_desktop_binding(self):
        w = self.create()
        for task in ['one', 'two']:
            value = _s4_dispatch(self.s, 'POST', '/api/authoring/context', {'workspace_id': task, 'project_id': w['id'], 'name': task}, admin=True)
            self.assertEqual(value['project']['id'], w['id'])
        self.assertEqual(len(self.s.store.list('project')), 1)

    def test_symlink_directory_and_unregistered_target_are_refused(self):
        w = self.create()
        root = _s4_Path(w['root'])
        source = _s4_Path(self.tmp.name) / 'atoms.xyz'
        source.write_text('1')
        folder = root / 'assets/structures'
        folder.rmdir()
        folder.symlink_to(_s4_Path(self.tmp.name), target_is_directory=True)
        with self.assertRaises(ValueError):
            self.call('import', {'project_id': w['id'], 'source': str(source), 'mode': 'copy', 'role': 'structure'})
        self.assertEqual(source.read_text(), '1')

if __name__ == '__main__':
    unittest.main()
