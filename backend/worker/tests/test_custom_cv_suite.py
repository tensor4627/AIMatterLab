# Consolidated suite generated from: test_custom_cv_provider_projection.py, test_custom_cv_scope.py, test_cell_derivative_contract.py, test_derivative_selection.py, test_opes_fd_contract.py
import sys, unittest
from pathlib import Path
if str(Path(__file__).resolve().parents[1]) not in sys.path: sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# --- section: test_custom_cv_provider_projection.py ---
'Provider projection is a definition-only grant, not the desktop admin record.'
import copy, json, sys, tempfile, threading, unittest
from pathlib import Path as _s0_Path
from unittest.mock import patch as _s0_patch
sys.path.insert(0, str(_s0_Path(__file__).resolve().parents[1]))
from studio_worker.workspace.custom_cv_service import CustomCvService as _s0_CustomCvService
from studio_worker.workspace.custom_cv_registry import Registry
from test_custom_cv import SPEC as _s0_SPEC
IDENTITY = ('spec_sha256', 'code_sha256', 'parameters_sha256', 'revision')
BODY = {'id', 'workspace_id', 'project_id', *IDENTITY, 'expected', 'spec', 'parameter_values', 'code'}
class CurrentDefinitionProjection(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.cv = _s0_CustomCvService.__new__(_s0_CustomCvService)
        self.cv.lock = threading.RLock()
        self.cv.library = Registry(_s0_Path(self.temp.name).resolve() / 'private')
        self.ctx = {'project': {'id': 'owned'}, 'workspace': 'conversation'}
        self.cv.context = lambda data: self.ctx
        self.item = self.cv.library.propose(_s0_SPEC, {'atom_i': 0, 'atom_j': 1}, workspace_id='conversation', project_id='owned')
        self.item = self.cv.library.approve_formula(self.item['id'], self.item['expected'])
        self.item = self.cv.library.approve_code(self.item['id'], self.item['expected'])
        self.item = self.cv.library.share(self.item['id'], self.item['expected'], 'codex', True)
        self.data = {'id': self.item['id'], 'provider': 'codex'}

    def test_serialized_body_is_exact_current_definition_allowlist_not_admin_record(self):
        seeded = copy.deepcopy(self.item)
        forbidden = ['numerical', 'results', 'result', 'report', 'reports', 'formula_approval', 'code_approval', 'git_commit', 'runtime', 'structure', 'library_review', 'library_history', 'history', 'approvals', 'reuse_of', 'updated_at', 'created_at', 'numerical_receipt_sha256', 'class_name', 'future_unknown_field']
        for key in forbidden:
            seeded[key] = {'unexpected_private_marker': 'private-' + key}
        seeded['expected']['unexpected_result'] = 'private-expected-extra'
        with _s0_patch.object(self.cv, 'owned', return_value=seeded):
            result = self.cv.provider_status(self.data, body=True)
        self.assertEqual(set(result), {'status', 'allowed', 'id', 'expected', 'entry'})
        self.assertEqual(set(result['entry']), BODY)
        self.assertEqual(result['entry']['spec'], self.item['spec'])
        self.assertEqual(result['entry']['parameter_values'], self.item['parameter_values'])
        self.assertEqual(result['entry']['code'], self.item['code'])
        exact = {key: self.item[key] for key in IDENTITY}
        self.assertEqual(result['expected'], exact)
        self.assertEqual(result['entry']['expected'], exact)
        raw = json.dumps(result, sort_keys=True)
        for key in forbidden:
            self.assertNotIn('private-' + key, raw)
            self.assertNotIn('private-expected-extra', raw)
        self.assertEqual(self.cv.library.read(self.item['id'])['numerical'], self.item['numerical'])

    def test_status_without_body_never_returns_a_definition_or_admin_fields(self):
        result = self.cv.provider_status(self.data)
        self.assertEqual(set(result), {'status', 'allowed', 'id', 'expected'})
        self.assertEqual(result['expected'], {key: self.item[key] for key in IDENTITY})

    def test_revocation_and_value_version_change_block_until_new_exact_consent(self):
        first = self.cv.provider_status(self.data, body=True)
        self.item = self.cv.library.share(self.item['id'], self.item['expected'], 'codex', False)
        self.assertEqual(self.cv.provider_status(self.data, body=True)['allowed'], False)
        self.assertNotIn('entry', self.cv.provider_status(self.data, body=True))
        self.item = self.cv.library.share(self.item['id'], self.item['expected'], 'codex', True)
        self.item = self.cv.library.propose(_s0_SPEC, {'atom_i': 1, 'atom_j': 0}, workspace_id='conversation', project_id='owned', identifier=self.item['id'], expected=self.item['expected'])
        denied = self.cv.provider_status(self.data, body=True)
        self.assertFalse(denied['allowed'])
        self.assertNotIn('entry', denied)
        self.item = self.cv.library.share(self.item['id'], self.item['expected'], 'codex', True)
        current = self.cv.provider_status(self.data, body=True)
        self.assertNotEqual(current['expected']['parameters_sha256'], first['expected']['parameters_sha256'])
        self.assertEqual(current['entry']['parameter_values'], {'atom_i': 1, 'atom_j': 0})
        self.assertNotIn('history', current['entry'])

    def test_grant_is_not_inherited_by_other_providers_or_foreign_owner(self):
        for provider in ('kimi', 'qwen', 'deepseek'):
            result = self.cv.provider_status({**self.data, 'provider': provider}, body=True)
            self.assertFalse(result['allowed'])
            self.assertNotIn('entry', result)
        with self.assertRaises(PermissionError):
            self.cv.provider_status({**self.data, 'provider': 'unknown'}, body=True)
        for ctx in ({'project': {'id': 'other'}, 'workspace': 'conversation'}, {'project': {'id': 'owned'}, 'workspace': 'other'}):
            self.ctx = ctx
            with self.assertRaises(PermissionError):
                self.cv.provider_status(self.data, body=True)

    def test_revocation_changes_revision_so_prior_proposal_CAS_cannot_write(self):
        prior = copy.deepcopy(self.item['expected'])
        revoked = self.cv.library.share(self.item['id'], prior, 'codex', False)
        self.assertNotEqual(revoked['revision'], prior['revision'])
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.cv.library.propose(_s0_SPEC, {'atom_i': 1, 'atom_j': 0}, workspace_id='conversation', project_id='owned', identifier=self.item['id'], expected=prior)
        current = self.cv.library.read(self.item['id'])
        self.assertEqual(current['parameter_values'], self.item['parameter_values'])
        self.assertFalse(current['sharing']['codex'])

    def test_unapproved_current_definition_has_no_invented_code_or_approval(self):
        item = self.cv.library.propose(_s0_SPEC, {'atom_i': 0, 'atom_j': 1}, workspace_id='conversation', project_id='owned')
        item = self.cv.library.share(item['id'], item['expected'], 'codex', True)
        body = self.cv.provider_status({'id': item['id'], 'provider': 'codex'}, body=True)['entry']
        self.assertEqual(set(body), BODY - {'code'})
        self.assertIsNone(body['code_sha256'])
        self.assertNotIn('formula_approval', body)

    def test_projection_does_not_mutate_internal_admin_evidence(self):
        seeded = copy.deepcopy(self.item)
        with _s0_patch.object(self.cv, 'owned', return_value=seeded):
            result = self.cv.provider_status(self.data, body=True)
        result['entry']['spec']['formula'] = 'changed response'
        result['entry']['parameter_values']['atom_i'] = 99
        result['entry']['expected']['revision'] = 'changed response'
        self.assertEqual(seeded, self.item)

# --- section: test_custom_cv_scope.py ---
import copy, hashlib, json, sys, tempfile, unittest, uuid
from pathlib import Path as _s1_Path
from unittest.mock import patch as _s1_patch
sys.path.insert(0, str(_s1_Path(__file__).resolve().parents[1]))
from studio_worker.service import Service
from studio_worker.workspace.custom_cv_service import CustomCvService as _s1_CustomCvService
from studio_worker.tools.custom_cv_catalog import checked_entry
from studio_worker.tools.custom_formula import stable, sha
from test_custom_cv import SPEC as _s1_SPEC
class ReferenceAndAttemptScope(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = _s1_Path(self.temp.name).resolve()
        self.service = Service(self.root / 'worker', schedule=False)
        self.addCleanup(self.close)
        self.environment = self.service.register_environment({'id': 'registered', 'name': 'Scope unit fixture', 'executables': {'python': sys.executable}})
        self.project = self.service.register_project({'id': 'owned', 'name': 'Scope unit fixture', 'policy': {'input_roots': [str(self.root / 'inputs')], 'environments': ['registered']}})
        self.cv = _s1_CustomCvService(self.service)
        self.directory = self.service.root / 'projects/owned/inputs/cv-conversation'
        self.directory.mkdir(parents=True)
        self.structure = self.directory / 'model.xyz'
        self.structure.write_bytes(b'unit geometry content - scientific.py mocked only in scope tests')
        self.item = self.cv.library.propose(_s1_SPEC, {'atom_i': 0, 'atom_j': 1}, workspace_id='conversation', project_id='owned')
        self.item = self.cv.library.approve_formula(self.item['id'], self.item['expected'])
        self.item = self.cv.library.approve_code(self.item['id'], self.item['expected'])
        self.ctx = {'project': self.project, 'environment': self.environment, 'source': {'id': 'pygas'}, 'root': self.directory.parent, 'directory': self.directory, 'workspace': 'conversation', 'structure': {'id': 'selected-' + hashlib.sha256(self.structure.read_bytes()).hexdigest(), 'path': str(self.structure), 'name': self.structure.name, 'sha256': hashlib.sha256(self.structure.read_bytes()).hexdigest()}, 'runtime': {'status': 'observed', 'receipt': 'f' * 64, 'facts': {'python': {'executable': sys.executable, 'registration_match': True}}}}
        self.data = {'id': self.item['id'], 'expected': self.item['expected'], 'workspace_id': 'conversation', 'project_id': 'owned', 'environment_id': 'registered'}

    def close(self):
        self.service.close()
        self.service.store.db.close()

    def reference(self, **changes):
        value = {'schema_version': 1, 'kind': 'independent_cv_reference', 'cv': [1.25], 'spec_sha256': self.item['spec_sha256'], 'parameters_sha256': self.item['parameters_sha256'], 'structure_sha256': self.ctx['structure']['sha256'], 'provenance': {'kind': 'declared_independent_method', 'method': 'Separately declared independent reference geometry method'}}
        value.update(changes)
        path = self.directory / 'oracle.cv-reference.json'
        path.write_bytes(stable(value))
        self.service.store.put('artifact', {'id': 'reference', 'project_id': 'owned', 'name': path.name, 'path': str(path), 'kind': 'reference', 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        return path

    def test_exact_external_values_parameters_and_honest_method_are_bound(self):
        self.reference()
        value = self.cv.independent(self.ctx, {'reference_asset_id': 'reference'}, self.item)
        self.assertEqual(value['cv'], [1.25])
        self.assertEqual(value['provenance']['kind'], 'declared_independent_method')
        self.assertEqual(value['provenance']['parameters_sha256'], self.item['parameters_sha256'])
        self.assertNotIn('human_supplied', value['provenance'])
        for change in ({'parameters_sha256': '0' * 64}, {'structure_sha256': '0' * 64}, {'spec_sha256': '0' * 64}, {'cv': [float('inf')]}, {'provenance': {'kind': 'human_supplied', 'method': 'unverified assertion'}}):
            with self.subTest(change=change):
                if change.get('cv') == [float('inf')]:
                    path = self.directory / 'oracle.cv-reference.json'
                    path.write_text(json.dumps({'schema_version': 1, 'kind': 'independent_cv_reference', 'cv': [float('inf')], 'spec_sha256': self.item['spec_sha256'], 'parameters_sha256': self.item['parameters_sha256'], 'structure_sha256': self.ctx['structure']['sha256'], 'provenance': {'kind': 'declared_independent_method', 'method': 'Separate reference'}}))
                    self.service.store.put('artifact', {'id': 'reference', 'project_id': 'owned', 'name': path.name, 'path': str(path), 'kind': 'reference', 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
                else:
                    self.reference(**change)
                with self.assertRaises(ValueError):
                    self.cv.independent(self.ctx, {'reference_asset_id': 'reference'}, self.item)

    def test_external_scope_keeps_values_and_parameter_hash_without_calling_it_human_supplied(self):
        self.reference()
        with _s1_patch('studio_worker.util.run_json', return_value={'n_atoms': 2, 'cell': [[5, 0, 0], [0, 5, 0], [0, 0, 5]], 'pbc': [True] * 3}):
            scope = self.cv.scope(self.ctx, {'reference_asset_id': 'reference'}, self.item)
        self.assertEqual(scope['reference_kind'], 'external-declared')
        self.assertEqual(scope['reference']['cv'], [1.25])
        self.assertEqual(scope['bindings']['parameters_sha256'], self.item['parameters_sha256'])
        self.assertEqual(scope['fd_atom_indices'], [1, 0])
        self.assertEqual(scope['sha256'], sha({k: v for k, v in scope.items() if k != 'sha256'}))

    def test_reference_file_change_and_forged_runtime_are_refused(self):
        path = self.reference()
        path.write_bytes(path.read_bytes() + b' ')
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.cv.independent(self.ctx, {'reference_asset_id': 'reference'}, self.item)
        self.ctx['runtime']['facts']['python']['executable'] = '/different/python'
        with _s1_patch('studio_worker.util.run_json', return_value={'n_atoms': 2}), self.assertRaisesRegex(ValueError, 'interpreter'):
            self.cv.scope(self.ctx, {}, self.item)

    def test_active_and_unknown_attempts_never_launch_a_new_uuid(self):
        for state in ('launching', 'running', 'unknown'):
            with self.subTest(state=state):
                self.service.store.put('custom-cv-attempt', {'id': 'already', 'entry_id': self.item['id'], 'workspace_id': 'conversation', 'status': state})
                with _s1_patch.object(self.cv, 'context', return_value=self.ctx), _s1_patch.object(self.cv, 'status', return_value={'status': state}), _s1_patch.object(self.cv, 'scope', side_effect=AssertionError('unknown attempt reached a new numerical scope')) as next_scope, self.assertRaisesRegex(ValueError, 'running or unknown'):
                    self.cv.validate({**self.data, 'human_action_id': str(uuid.uuid4())})
                next_scope.assert_not_called()

    def test_nested_success_cannot_override_a_blocked_overall_receipt(self):
        item = copy.deepcopy(self.item)
        item['numerical'] = {'status': 'blocked', 'reusable_primitive': {'status': 'passed'}, 'numerical_self_consistency': {'status': 'passed'}, 'independent_reference': {'status': 'passed'}}
        with self.assertRaisesRegex(ValueError, 'current passed'):
            checked_entry(item)
class CurrentStructureSelection(unittest.TestCase):
    setUp = ReferenceAndAttemptScope.setUp
    close = ReferenceAndAttemptScope.close

    def asset(self, path=None, kind='structure', project='owned', identifier='structure'):
        path = path or self.structure
        self.service.store.put('artifact', {'id': identifier, 'project_id': project, 'name': path.name, 'path': str(path), 'kind': kind, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        return str(path)

    def actual_context(self, files, **extra):
        with _s1_patch('studio_worker.workspace.pygas_composition.context', return_value=(self.project, self.environment, {'id': 'pygas'}, self.directory.parent)), _s1_patch.object(self.service, 'read_runtime_guide', return_value=self.ctx['runtime']):
            return self.cv.context({**self.data, 'files': files, **extra})

    def test_unique_selected_registered_structure_binds_without_hidden_alias_and_rehashes(self):
        selected = self.asset()
        first = self.actual_context([selected])
        self.assertEqual(first['structure']['path'], selected)
        self.assertEqual(first['structure']['sha256'], hashlib.sha256(self.structure.read_bytes()).hexdigest())
        self.structure.write_bytes(b'new selected structure bytes, no numerical or scientific assertion')
        second = self.actual_context([selected])
        self.assertNotEqual(first['structure']['sha256'], second['structure']['sha256'])
        self.assertNotEqual(first['structure']['id'], second['structure']['id'])

    def test_repeated_identical_path_and_duplicate_asset_metadata_are_one_structure(self):
        selected = self.asset()
        self.asset(identifier='duplicate')
        self.assertEqual(self.actual_context([selected, selected])['structure']['path'], selected)

    def test_multiple_distinct_selected_structures_including_equal_basenames_are_ambiguous(self):
        first = self.asset()
        other = self.directory / 'other' / self.structure.name
        other.parent.mkdir()
        other.write_bytes(b'other fixture')
        second = self.asset(other, identifier='second')
        with self.assertRaisesRegex(ValueError, 'Several selected structure'):
            self.actual_context([first, second])

    def test_unselected_unregistered_nonstructure_or_foreign_project_cannot_be_inferred(self):
        selected = self.asset()
        self.assertIsNone(self.actual_context([])['structure'])
        self.assertIsNone(self.actual_context([self.structure.name])['structure'])
        self.service.store.put('artifact', {'id': 'structure', 'project_id': 'foreign', 'name': self.structure.name, 'path': selected, 'kind': 'structure'})
        self.assertIsNone(self.actual_context([selected])['structure'])
        self.asset(kind='input')
        self.assertIsNone(self.actual_context([selected])['structure'])
        self.assertIsNone(self.actual_context([str(self.directory / 'absent.xyz')])['structure'])

    def test_explicit_structure_stays_authoritative_over_other_selected_assets(self):
        first = self.asset()
        other = self.directory / 'second.xyz'
        other.write_bytes(b'other fixture')
        second = self.asset(other, identifier='second')
        self.assertEqual(self.actual_context([first, second], structure_path=second)['structure']['path'], second)

    def test_fallback_rejects_malformed_or_unbounded_current_file_lists(self):
        self.asset()
        for invalid in (None, {}, str(self.structure), [1], [''], ['/owned/line\npath'], ['/owned/file'] * 257):
            with self.subTest(value=repr(invalid)[:80]), self.assertRaisesRegex(ValueError, 'bounded list'):
                self.actual_context(invalid)

# --- section: test_cell_derivative_contract.py ---
import sys, copy, unittest
from pathlib import Path as _s2_Path
sys.path.insert(0, str(_s2_Path(__file__).resolve().parents[1]))
from studio_worker.tools.cell_derivative_contract import supported_graph, derive, supported_private_graph, private_producer
class CellSourceContract(unittest.TestCase):

    def graph(self):
        nodes = [{'id': k, 'kind': k} for k in ('input', 'neighbor', 'switch', 'cv', 'reduce', 'collect', 'output', 'bias')]
        data = {n['id']: n for n in nodes}
        data['neighbor']['class_name'] = 'PCVectorLB'
        data['switch']['class_name'] = 'LessThanCubic'
        data['cv']['class_name'] = 'CoordNum'
        data['reduce']['params'] = {'operation': 'mean'}
        data['bias']['class_name'] = 'MetaDGaussianBias'
        paths = [('input', 'pos', 'neighbor', 'pos'), ('input', 'cell', 'neighbor', 'cell'), ('input', 'side_array', 'neighbor', 'side_array'), ('neighbor', 'pcvector', 'cv', 'pcvector'), ('neighbor', 'side_array', 'cv', 'side_array'), ('switch', 'switch', 'cv', 'switch_func'), ('cv', 'value', 'reduce', 'value'), ('reduce', 'value', 'collect', 'value'), ('collect', 'cv', 'output', 'cv'), ('collect', 'cv', 'bias', 'cv'), ('input', 'cv_traj', 'bias', 'cv_traj'), ('input', 'bias_traj', 'bias', 'bias_traj'), ('bias', 'bias', 'output', 'bias')]
        return {'mode': 'metad', 'nodes': nodes, 'edges': [{'source': {'node': a, 'port': b}, 'target': {'node': c, 'port': d}} for a, b, c, d in paths]}

    def test_only_complete_reviewed_single_neighbor_cn_mean_metad_paths(self):
        for neighbor in ('PCVectorLB', 'PCVectorTypesFilter'):
            for bias in ('MetaDGaussianBias', 'WTMetaDGaussianBias', 'FFWTPDMetaDGaussianBias'):
                g = self.graph()
                next((n for n in g['nodes'] if n['kind'] == 'neighbor'))['class_name'] = neighbor
                next((n for n in g['nodes'] if n['kind'] == 'bias'))['class_name'] = bias
                self.assertTrue(supported_graph(g))

    def test_extra_or_changed_nodes_edges_reductions_and_dimensions_fail_closed(self):
        for change in (lambda g: g['nodes'].append({'id': 'extra', 'kind': 'cv', 'class_name': 'Volume'}), lambda g: g['edges'].append({'source': {'node': 'input', 'port': 'pos'}, 'target': {'node': 'cv', 'port': 'pos'}}), lambda g: g['edges'].pop(), lambda g: g['edges'].append(copy.deepcopy(g['edges'][0])), lambda g: g['nodes'][3].update(class_name='PeriodicTorsion'), lambda g: g['nodes'][4].update(params={'operation': 'first'}), lambda g: g['nodes'][3].update(output_size=1), lambda g: g['nodes'][3].update(id='neighbor'), lambda g: g.update(mode='opes')):
            g = self.graph()
            change(g)
            self.assertFalse(supported_graph(g))

    def test_non_sampling_and_opes_never_search_producers_or_read_inputs(self):
        for run in ({'engine': 'gpumd.md', 'parameters': {}}, {'engine': 'gpumd.sampling', 'parameters': {'mode': 'opes'}}):
            self.assertIsNone(derive(None, run))

    def test_parameter_claim_is_overwritten_by_the_trusted_adapter_keyword(self):
        from unittest.mock import patch
        from subprocess import CompletedProcess
        from studio_worker.adapters import Adapter
        adapter = Adapter('bias.validate')
        spec = {'engine': 'bias.validate', 'gpu': 0, 'inputs': {'bias.pt': '/f/bias.pt', 'model.xyz': '/f/model.xyz'}, 'parameters': {'bias_file': 'bias.pt', 'structure_file': 'model.xyz', 'mode': 'static', 'cv_size': 1, 'cutoff': 3, '_studio_cell_contract': {'convention': 'forged'}}}
        calls = []

        def execute(*args, **kwargs):
            calls.append(args[3])
            return {'status': 'passed'}
        with patch.object(adapter, 'bias_command', return_value=['fixture']), patch('studio_worker.adapters.subprocess.run', return_value=CompletedProcess([], 0, '{}', '')), patch('studio_worker.adapters.run_json', side_effect=execute):
            adapter.validate(spec, {'executables': {'python': sys.executable}}, _s2_Path.cwd())
        self.assertEqual(len(calls), 1)
        self.assertIsNone(calls[0]['_studio_cell_contract'])
class PrivateCellGraphClosure(unittest.TestCase):

    def graph(self):
        nodes = [{'id': kind, 'kind': kind} for kind in ('input', 'neighbor', 'cv', 'collect', 'output', 'bias')]
        by = {node['kind']: node for node in nodes}
        by['neighbor']['class_name'] = 'PCVectorLB'
        by['cv'].update(id='custom_abc', class_name='StudioCustom_expected')
        by['bias']['class_name'] = 'WTMetaDGaussianBias'
        edges = [('input', 'pos', 'neighbor', 'pos'), ('input', 'cell', 'neighbor', 'cell'), ('input', 'side_array', 'neighbor', 'side_array'), ('input', 'pos', 'custom_abc', 'pos'), ('input', 'cell', 'custom_abc', 'cell'), ('input', 'side_array', 'custom_abc', 'side_array'), ('custom_abc', 'value', 'collect', 'value'), ('collect', 'cv', 'output', 'cv'), ('collect', 'cv', 'bias', 'cv'), ('input', 'cv_traj', 'bias', 'cv_traj'), ('input', 'bias_traj', 'bias', 'bias_traj'), ('bias', 'bias', 'output', 'bias')]
        return {'mode': 'metad', 'metadata': {'studio_custom_cvs': [{'id': 'abc', 'class_name': 'StudioCustom_expected', 'output_size': 1}]}, 'nodes': nodes, 'edges': [{'source': {'node': a, 'port': b}, 'target': {'node': c, 'port': d}} for a, b, c, d in edges]}

    def test_only_one_direct_fixed_size_private_primitive_with_compiler_required_neighbor(self):
        from studio_worker.tools.cell_derivative_contract import supported_private_graph
        for bias in ('WTMetaDGaussianBias', 'MetaDGaussianBias', 'FFWTPDMetaDGaussianBias', 'FlexibleWallBias'):
            graph = self.graph()
            next((node for node in graph['nodes'] if node['kind'] == 'bias'))['class_name'] = bias
            if bias == 'FlexibleWallBias':
                graph['edges'] = [edge for edge in graph['edges'] if edge['source']['port'] != 'bias_traj']
            self.assertTrue(supported_private_graph(graph))

    def test_unknown_topology_or_dimensions_fail_closed_without_approval_lookup(self):
        from studio_worker.tools.cell_derivative_contract import supported_private_graph, private_producer
        for change in (lambda graph: graph['nodes'].append({'id': 'reduce', 'kind': 'reduce'}), lambda graph: graph['edges'].pop(), lambda graph: graph['edges'].append(copy.deepcopy(graph['edges'][0])), lambda graph: graph['metadata']['studio_custom_cvs'][0].update(output_size=2), lambda graph: graph['nodes'][2].update(class_name='Unknown'), lambda graph: graph['metadata'].update(studio_custom_cvs=[]), lambda graph: graph.update(mode='opes'), lambda graph: graph['nodes'].pop(1)):
            graph = self.graph()
            change(graph)
            self.assertFalse(supported_private_graph(graph))
            self.assertIsNone(private_producer(None, graph, None))
class PrivateIdentityContract(unittest.TestCase):

    def graph(self):
        graph = PrivateCellGraphClosure().graph()
        edge = next((edge for edge in graph['edges'] if edge['source']['node'] == 'custom_abc' and edge['target']['node'] == 'collect'))
        graph['edges'].remove(edge)
        graph['nodes'].append({'id': 'identity', 'kind': 'reduce', 'params': {'operation': 'identity'}})
        graph['edges'].extend([{'source': {'node': 'custom_abc', 'port': 'value'}, 'target': {'node': 'identity', 'port': 'value'}}, {'source': {'node': 'identity', 'port': 'value'}, 'target': {'node': 'collect', 'port': 'value'}}])
        return graph

    def test_only_exact_explicit_scalar_identity_with_each_supported_bias(self):
        for bias in ('MetaDGaussianBias', 'WTMetaDGaussianBias', 'FFWTPDMetaDGaussianBias', 'FlexibleWallBias'):
            for neighbor in ('PCVectorLB', 'PCVectorTypesFilter'):
                graph = self.graph()
                next((n for n in graph['nodes'] if n['kind'] == 'bias'))['class_name'] = bias
                next((n for n in graph['nodes'] if n['kind'] == 'neighbor'))['class_name'] = neighbor
                if bias == 'FlexibleWallBias':
                    graph['edges'] = [e for e in graph['edges'] if e['source']['port'] != 'bias_traj']
                with self.subTest(bias=bias, neighbor=neighbor):
                    self.assertTrue(supported_private_graph(graph))

    def test_semantically_different_or_unproved_reductions_are_rejected(self):
        for params in ({}, {'operation': 'mean'}, {'operation': 'sum'}, {'operation': 'first'}, {'operation': 'IDENTITY'}, {'operation': 'unknown'}, {'operation': 'identity', 'extra': True}):
            graph = self.graph()
            graph['nodes'][-1]['params'] = params
            with self.subTest(params=params):
                self.assertFalse(supported_private_graph(graph))
                self.assertIsNone(private_producer(None, graph, None))

    def test_changed_width_bypass_duplicate_missing_or_extra_edges_failclosed(self):
        changes = [lambda g: g['metadata']['studio_custom_cvs'][0].update(output_size=2), lambda g: g['nodes'][-1].update(output_size=1), lambda g: g['nodes'][-1].update(id='custom_abc'), lambda g: g['nodes'].append({'id': 'second', 'kind': 'reduce', 'params': {'operation': 'identity'}}), lambda g: g['edges'].append(copy.deepcopy(g['edges'][-1])), lambda g: g['edges'].pop(), lambda g: g['edges'].append({'source': {'node': 'custom_abc', 'port': 'value'}, 'target': {'node': 'collect', 'port': 'value'}})]
        for index, change in enumerate(changes):
            graph = self.graph()
            change(graph)
            with self.subTest(index=index):
                self.assertFalse(supported_private_graph(graph))
                self.assertIsNone(private_producer(None, graph, None))
class PrivateTargetFallback(unittest.TestCase):

    def test_private_opes_and_unproved_topology_cannot_take_public_legacy_fallback(self):
        from unittest.mock import Mock, patch
        service = Mock()
        service.store.list.return_value = [{'project_id': 'owned'}]
        for mode in ('opes', 'wtmetad', 'static'):
            with self.subTest(mode=mode), patch('studio_worker.tools.cell_derivative_contract._derive', return_value=None), self.assertRaisesRegex(ValueError, 'unsupported|proof'):
                derive(service, {'engine': 'bias.validate', 'project_id': 'owned', 'parameters': {'mode': mode}})

    def test_existing_public_opes_remains_unchanged(self):
        from unittest.mock import Mock
        service = Mock()
        service.store.list.return_value = []
        self.assertIsNone(derive(service, {'engine': 'bias.validate', 'project_id': 'public', 'parameters': {'mode': 'opes'}}))

# --- section: test_derivative_selection.py ---
import sys, copy, unittest
from pathlib import Path as _s3_Path
sys.path.insert(0, str(_s3_Path(__file__).resolve().parents[1]))
from studio_worker.derivative_selection import selection, validate_controls as _s3_validate_controls
class NumericalSelection(unittest.TestCase):

    def test_large_cv_group_is_preserved_and_only_bounded_force_components_are_sampled(self):
        p = {'atom_selection': list(range(108))}
        before = copy.deepcopy(p)
        result = selection(p, 108)
        self.assertEqual(p, before)
        self.assertEqual(result['declared_cv_atoms'], list(range(108)))
        self.assertEqual(len(result['indices']), 8)
        self.assertEqual(result['indices'][0], 0)
        self.assertEqual(result['indices'][-1], 107)
        self.assertIn('not all-atom', result['source'])

    def test_explicit_numerical_subset_does_not_redefine_cv(self):
        p = {'atom_selection': list(range(108)), 'validation': {'atom_selection': [0, 15, 31, 46, 61, 76, 92, 107], 'fd_step': 1e-05, 'fd_atol': 0.0001}}
        before = copy.deepcopy(p)
        result = selection(p, 108)
        self.assertEqual(result['indices'], p['validation']['atom_selection'])
        self.assertEqual(p, before)
        self.assertEqual(result['structure_atoms'], 108)

    def test_small_legacy_group_and_default_have_explicit_coverage(self):
        self.assertEqual(selection({'atom_selection': [3, 1, 3]}, 4)['indices'], [3, 1])
        self.assertEqual(selection({}, 3)['indices'], [0, 1, 2])
        self.assertIn('CV group not inferred', selection({}, 3)['source'])

    def test_closed_technical_namespace_and_supported_routes(self):
        for value in (None, [], {'temperature': 300}, {'bias': {'sigma': 0.1}}, {'atom_selection': []}, {'atom_selection': [0, 0]}, {'atom_selection': [True]}, {'atom_selection': [1.0]}, {'atom_selection': [-1]}, {'atom_selection': list(range(33))}, {'fd_step': 0}, {'fd_step': 0.01}, {'fd_atol': float('nan')}, {'fd_atol': 0.1}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                _s3_validate_controls({'validation': value})
        for engine in ('gpumd.sampling', 'pydyn.sampling', 'bias.validate'):
            _s3_validate_controls({'validation': {'atom_selection': [0]}}, engine)
        with self.assertRaises(ValueError):
            _s3_validate_controls({'validation': {'atom_selection': [0]}}, 'gpumd.md')

    def test_actual_structure_bounds_and_legacy_conflicts_fail_closed(self):
        for p in ({'atom_selection': [108]}, {'atom_selection': [-1]}, {'atom_selection': [True]}, {'validation': {'atom_selection': [108]}}, {'fd_step': 0.0001, 'validation': {'fd_step': 1e-05}}):
            with self.subTest(p=p), self.assertRaises(ValueError):
                selection(p, 108)
        _s3_validate_controls({'fd_step': 1e-05, 'validation': {'fd_step': 1e-05}})
class DeclaredCvAliases(__import__('unittest').TestCase):

    def test_nested_full_group_remains_full_with_independent_fd_sample(self):
        from studio_worker.derivative_selection import selection, cv_atoms
        full = list(range(108))
        parameters = {'cv': {'atom_selection': full}, 'validation': {'atom_selection': [0, 15, 30, 45, 60, 75, 90, 107]}}
        result = selection(parameters, 108)
        self.assertEqual(result['declared_cv_atoms'], full)
        self.assertEqual(result['indices'], parameters['validation']['atom_selection'])
        self.assertEqual(cv_atoms({'atom_selection': full, 'cv': {'atoms_zero_based': full}}), full)

    def test_conflicting_aliases_never_choose_one_group(self):
        from studio_worker.derivative_selection import cv_atoms
        for value in ({'atom_selection': [0, 1], 'cv': {'atom_selection': [0, 2]}}, {'cv': {'atom_selection': [0, 1], 'atoms_zero_based': [1, 0]}}):
            with self.assertRaisesRegex(ValueError, 'Conflicting'):
                cv_atoms(value)
class DeclaredCvAliasTypes(__import__('unittest').TestCase):

    def test_python_numeric_equality_cannot_launder_boolean_or_float_aliases(self):
        from studio_worker.derivative_selection import cv_atoms
        for value in ({'atom_selection': [1], 'cv': {'atom_selection': [True]}}, {'atom_selection': [0], 'cv': {'atom_selection': [0.0]}}, {'cv': {'atom_selection': [1.0], 'atoms_zero_based': [1]}}, {'cv': {'atom_selection': []}}, {'cv': {'atom_selection': '0,1'}}):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'nonnegative integers'):
                cv_atoms(value)
class TrustedPrivateGroup(unittest.TestCase):

    def test_subset_requires_exact_formula_proof_and_matching_revision(self):
        from studio_worker.derivative_selection import validate_cell_group
        binding = {'spec_sha256': 'a' * 64, 'code_sha256': 'b' * 64, 'parameters_sha256': 'c' * 64}
        proof = {'kind': 'approved_private_formula_group', 'atom_selection': [0, 1, 3], 'referenced_atoms': [0, 1, 3], 'structure_atoms': 32, **binding}
        contract = {'declared_cv_atoms': [0, 1, 3], 'private_cv_bindings': [binding], 'private_cv_atom_contract': proof}
        self.assertEqual(validate_cell_group(contract, {'atom_selection': [0, 1, 3]}, 32), [0, 1, 3])
        for change in (lambda value: value['private_cv_atom_contract'].update(structure_atoms=3), lambda value: value['private_cv_atom_contract'].update(referenced_atoms=[999]), lambda value: value['private_cv_atom_contract'].update(code_sha256='0' * 64), lambda value: value.update(declared_cv_atoms=list(range(32))), lambda value: value.pop('private_cv_atom_contract')):
            modified = copy.deepcopy(contract)
            change(modified)
            with self.assertRaises(ValueError):
                validate_cell_group(modified, {'atom_selection': [0, 1, 3]}, 32)
        with self.assertRaises(ValueError):
            validate_cell_group(contract, {'atom_selection': list(range(32))}, 32)

    def test_native_proof_still_requires_all_atoms(self):
        from studio_worker.derivative_selection import validate_cell_group
        with self.assertRaisesRegex(ValueError, 'full actual'):
            validate_cell_group({'declared_cv_atoms': [0, 1]}, {'atom_selection': [0, 1]}, 32)
        self.assertEqual(validate_cell_group({'declared_cv_atoms': list(range(32))}, {'atom_selection': list(range(32))}, 32), list(range(32)))

# --- section: test_opes_fd_contract.py ---
import sys, unittest, copy
from pathlib import Path as _s4_Path
from unittest.mock import patch as _s4_patch
from subprocess import CompletedProcess
ROOT = _s4_Path.cwd()
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'backend/worker'))
import studio_worker
studio_worker.__path__.insert(0, str(_s4_Path(__file__).resolve().parents[1] / 'studio_worker'))
from studio_worker.adapters import Adapter
from studio_worker.derivative_selection import validate_controls as _s4_validate_controls
ROUTES = ('bias.validate', 'gpumd.sampling', 'pydyn.sampling')
ENV = {'executables': {'python': sys.executable, 'gpu-sampling': sys.executable}}
def spec(engine='bias.validate', mode='opes', **controls):
    return {'engine': engine, 'gpu': 0, 'inputs': {n: '/fixture/' + n for n in ['bias.pt', 'model.xyz', 'run.py', 'run.in', 'GAScfg.yaml']}, 'parameters': {'bias_file': 'bias.pt', 'structure_file': 'model.xyz', 'mode': mode, 'cv_size': 1, 'cutoff': 3, 'atom_selection': list(range(32)), 'cv': {'atom_selection': list(range(32))}, **controls}}
class OpesNumericalContract(unittest.TestCase):

    def test_prepare_and_validate_reject_every_explicit_namespace_before_any_runtime(self):
        for engine in ROUTES:
            for controls in ({'validation': {'atom_selection': list(range(32)), 'fd_step': 1e-05, 'fd_atol': 1e-08}}, {'validation': {}}, {'fd_step': 1e-05}, {'fd_atol': 1e-08}, {'validation': None}):
                with self.subTest(engine=engine, controls=controls):
                    a = Adapter(engine)
                    s = spec(engine, **controls)
                    with _s4_patch.object(a, 'runtime_check', side_effect=AssertionError('runtime forbidden')), _s4_patch('studio_worker.adapters.subprocess.run', side_effect=AssertionError('process forbidden')):
                        with self.assertRaisesRegex(ValueError, 'OPES stateful finite-difference validation is not implemented'):
                            a.prepare(s, ENV)
                        with self.assertRaisesRegex(ValueError, 'OPES stateful finite-difference validation is not implemented'):
                            a.validate(s, ENV, ROOT)

    def test_no_fd_opes_prepares_all_routes_and_preserves_cv_atoms(self):
        for engine in ROUTES:
            a = Adapter(engine)
            s = spec(engine)
            before = copy.deepcopy(s)
            with _s4_patch.object(a, 'bias_command', return_value=['serialized-abi-fixture']):
                self.assertTrue(a.prepare(s, ENV))
            self.assertEqual(s, before)
            _s4_validate_controls(s['parameters'], engine)

    def test_actual_adapter_report_marks_derivatives_not_run_for_all_routes(self):
        for engine in ROUTES:
            a = Adapter(engine)
            s = spec(engine)
            probe = {'scope': {'engine': engine}, 'executable': sys.executable, 'pydyn_sampling': True}
            with _s4_patch.object(a, 'runtime_check', return_value={'status': 'not_run'}), _s4_patch.object(a, 'input_contract'), _s4_patch.object(a, 'bias_command', return_value=['serialized-abi-fixture']), _s4_patch('studio_worker.adapters.subprocess.run', return_value=CompletedProcess([], 0, 'fixture ABI/state success', '')), _s4_patch('studio_worker.adapters.run_json', side_effect=AssertionError('FD must not run')) as fd, _s4_patch('studio_worker.science_checks.check_gascfg'):
                result = a.validate(s, ENV, ROOT, probe_report=probe)
            self.assertEqual(result['status'], 'passed')
            self.assertEqual(result['artifact_status'], 'passed')
            self.assertEqual(result['scientific_status'], 'not_run')
            self.assertEqual(result['derivatives']['status'], 'not_run')
            self.assertIn('not implemented', result['derivatives']['reason'])
            self.assertNotIn('sampled finite differences', result['scope'])
            self.assertIn('finite differences not_run', result['scope'])
            fd.assert_not_called()

    def test_metad_controls_still_reach_actual_derivative_path(self):
        p = {'validation': {'atom_selection': [0, 1], 'fd_step': 1e-05, 'fd_atol': 1e-08}, 'fd_step': 1e-05, 'fd_atol': 1e-08}
        for engine in ROUTES:
            _s4_validate_controls(spec(engine, 'metad', **p)['parameters'], engine)
        a = Adapter('bias.validate')
        s = spec(mode='metad', **p)
        with _s4_patch.object(a, 'bias_command', return_value=['serialized-abi-fixture']), _s4_patch('studio_worker.adapters.subprocess.run', return_value=CompletedProcess([], 0, 'fixture', '')), _s4_patch('studio_worker.adapters.run_json', return_value={'status': 'passed', 'fixture': True}) as fd:
            result = a.validate(s, ENV, ROOT)
        self.assertEqual(result['derivatives'], {'status': 'passed', 'fixture': True})
        self.assertEqual(fd.call_args.args[3]['validation'], p['validation'])
        self.assertEqual(fd.call_args.args[3]['atom_selection'], list(range(32)))
        self.assertIn('sampled finite differences', result['scope'])

if __name__ == '__main__':
    unittest.main()
