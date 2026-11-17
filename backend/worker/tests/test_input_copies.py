import concurrent.futures
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from studio_worker.server import dispatch, tools
from studio_worker.service import Service
from studio_worker.workspace import input_copies


class WorkflowInputCopies(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        base = Path(self.temporary.name).resolve()
        self.service = Service(base / 'worker', schedule=False)
        self.addCleanup(self.service.store.db.close)
        self.addCleanup(self.service.close)
        self.source = base / 'old sampling'
        (self.source / 'torsions').mkdir(parents=True)
        self.files = {'model.xyz': b'1\nold input\nH 0 0 0\n', 'nep.txt': b'nep4 1 H\n',
                      'nep-new.txt': b'alternative\n', 'run.in': b'potential nep.txt\n',
                      'GAScfg.yaml': b'biases: [torsions/a.pt, torsions/b.pt]\n',
                      'torsions/a.pt': b'\x00\x81first', 'torsions/b.pt': b'\xff\x00second'}
        for name, content in self.files.items():
            (self.source / name).write_bytes(content)
        self.root = self.service.root / 'projects/p/inputs'
        self.root.mkdir(parents=True, exist_ok=True)
        self.project = self.service.register_project({'id':'p', 'name':'p', 'policy':{'input_roots':[str(self.root)], 'environments':[], 'engines':[]}})

    def copy(self, files=None, admin=True, **extra):
        paths = list(self.files) if files is None else files
        return dispatch(self.service, 'POST', '/api/studio-workspace/copy-inputs',
                        {'project_id':'p', 'sources':[str(self.source / name) for name in paths], **extra}, admin)

    def test_external_inputs_work_together_without_expanding_authorization(self):
        before = {name: (self.source/name).stat().st_mtime_ns for name in self.files}
        with self.assertRaises((PermissionError, ValueError)):
            dispatch(self.service, 'POST', '/api/workspace/read', {'project_id':'p', 'name':str(self.source/'model.xyz')})
        result = self.copy()
        for row in result['files']:
            content = self.files[row['name']]
            copy = Path(result['directory']) / row['name']
            self.assertEqual(Path(row['path']), copy)
            self.assertEqual(copy.read_bytes(), content)
            self.assertEqual(row['sha256'], hashlib.sha256(content).hexdigest())
            self.assertFalse(os.path.samefile(copy, row['source']))
            self.assertFalse(copy.stat().st_mode & 0o111)
            self.assertEqual(Path(row['source']).stat().st_mtime_ns, before[row['name']])
            read = dispatch(self.service, 'POST', '/api/workspace/read', {'project_id':'p','name':str(copy)})
            self.assertEqual(read['sha256'], row['sha256'])
            self.assertEqual(read['binary'], row['name'].endswith('.pt'))
        self.assertEqual(self.copy(list(reversed(self.files)))['directory'], result['directory'])
        self.assertEqual(self.service.store.get('project','p')['policy'], self.project['policy'])
        self.assertEqual(self.service.store.runs(), [])
        (Path(result['directory']) / 'run.in').write_text('edited working copy')
        with self.assertRaises(ValueError): self.copy()
        self.assertEqual((self.source / 'run.in').read_bytes(), self.files['run.in'])

    def test_failure_publishes_no_partial_set_or_changed_input(self):
        with self.assertRaises(FileNotFoundError): self.copy(['run.in', 'missing.pt'])
        original = input_copies._transfer
        def change(file, *args):
            result = original(file, *args)
            self.assertEqual(list(self.root.iterdir()), [], 'Unpublished inputs must stay out of the workflow')
            if file.name == 'model.xyz': (self.source / 'run.in').write_bytes(b'updated')
            return result
        with patch.object(input_copies, '_transfer', side_effect=change), self.assertRaisesRegex(ValueError,'changed'):
            self.copy(['run.in', 'model.xyz'])
        self.assertEqual(list(self.root.iterdir()), [])

    def test_same_set_can_be_requested_concurrently(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda _: self.copy(), range(2)))
        self.assertEqual(outcomes[0], outcomes[1])
        self.assertEqual(len(list(self.root.iterdir())), 1)

    def test_tilde_resolves_on_the_worker_and_records_the_original_source(self):
        with patch.dict(os.environ, HOME=str(self.source.parent)):
            response = dispatch(self.service,'POST','/api/studio-workspace/copy-inputs',
                                {'project_id':'p','sources':['~/old sampling/model.xyz']}, True)
        row = response['files'][0]
        self.assertEqual(row['source'], '~/old sampling/model.xyz')
        self.assertEqual(Path(row['path']).read_bytes(), self.files['model.xyz'])

    def test_named_workspace_keeps_independent_copies_even_with_a_manual_link_preference(self):
        named = dispatch(self.service, 'POST', '/api/studio-workspace/create',
                         {'id': 'workspace-inputs', 'name': 'Inputs', 'asset_mode': 'link'}, True)
        with patch.dict(os.environ, HOME=str(self.source.parent)):
            result = dispatch(self.service, 'POST', '/api/studio-workspace/copy-inputs',
                              {'project_id': named['id'], 'sources': ['~/old sampling/run.in']}, True)
            manual = dispatch(self.service, 'POST', '/api/studio-workspace/import',
                              {'project_id': named['id'], 'source': '~/old sampling/model.xyz', 'mode': 'copy'}, True)
        self.assertEqual(Path(result['directory']).parent, Path(named['root']))
        self.assertEqual(Path(result['files'][0]['path']).read_bytes(), self.files['run.in'])
        self.assertEqual(Path(manual['path']).read_bytes(), self.files['model.xyz'])
        for path in (result['files'][0]['path'], manual['path']): self.assertFalse(Path(path).is_symlink())
        policy = self.service.store.get('project', named['id'])['policy']
        self.assertEqual(policy['input_roots'], [named['root']]); self.assertEqual(policy['engines'], [])

    def test_source_links_resolve_to_data_and_other_scopes_stay_private(self):
        (self.source / 'alias.xyz').symlink_to(self.source / 'model.xyz')
        result = self.copy(['alias.xyz'])
        self.assertFalse(Path(result['files'][0]['path']).is_symlink())
        keys = self.source / '.ssh'
        keys.mkdir()
        (keys / 'private.txt').write_text('fixture')
        (self.source / 'not-a-model.txt').symlink_to(keys / 'private.txt')
        for file in ['.ssh/private.txt', 'not-a-model.txt', str(self.service.root/'service.json')]:
            with self.subTest(file=file), self.assertRaises(PermissionError): self.copy([file])
        fifo = self.source/'not-a-file'
        os.mkfifo(fifo)
        with self.assertRaises(ValueError): self.copy([fifo.name])
        with self.assertRaises(PermissionError): self.copy(admin=False)
        with self.assertRaises(ValueError): self.copy(['run.in'], destination='/outside')
        self.assertNotIn('copy_project_inputs', {tool['name'] for tool in tools()})

    def test_private_producer_outputs_cannot_be_imported_as_ordinary_external_data(self):
        private_run = {'directory':str(self.source), 'project_id':'private', 'private_cv_versions':[{'entry_id':'private-model'}]}
        with patch.object(self.service.store,'runs',return_value=[private_run]), self.assertRaises(PermissionError):
            self.copy(['run.in'])
        self.assertEqual(list(self.root.iterdir()), [])
