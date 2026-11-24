# Consolidated suite generated from: test_pygas_catalog.py, test_pygas_dimensions.py, test_pygas_order.py, test_pygas_values.py, test_composition_input_resolution.py, test_composition_store.py, test_graph_contract.py
import sys, unittest
from pathlib import Path
if str(Path(__file__).resolve().parents[1]) not in sys.path: sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# --- section: test_pygas_catalog.py ---
import sys
from pathlib import Path as _s0_Path
sys.path.insert(0, str(_s0_Path(__file__).resolve().parents[1]))
import hashlib, importlib.util, json, tempfile, unittest
from pathlib import Path as _s0_Path
from studio_worker.tools.pygas_catalog import catalog as _s0_catalog
class CatalogTests(unittest.TestCase):

    def fixture(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = _s0_Path(temp.name)
        (root / 'tools').mkdir()
        (root / 'base').mkdir()
        (root / 'tools/cv_bias_gui_server.py').write_text("EXCLUDED_CV={'CV'}\nEXCLUDED_BIAS={'Bias'}\nEXCLUDED_SWITCH={'Base'}\nEXCLUDED_NEIGHBOR=set()\nFORWARD_ARG_MAP={'pos':'pos','cell':'cell','side_array':'side_array'}\nCV_OUTPUT_SIZES={'RealCV':1}\nraise RuntimeError('MUST NEVER IMPORT')", encoding='utf-8')
        for kind, name in [('colvar', 'RealCV'), ('bias', 'RealBias'), ('switch', 'RealSwitch'), ('neighbor', 'RealNeighbor')]:
            args = {'colvar': 'pos, cell', 'bias': 'cv, cv_traj', 'switch': 'pos', 'neighbor': 'pos, cell, side_array'}[kind]
            (root / f'base/{kind}.py').write_text(f'class {name}:\n    """Real source documentation."""\n    def __init__(self, atom_idx: list, n_atoms: int, weight: float=0.2, active=True, internal_dtype=None): pass\n    def forward(self,{args}): pass\n', encoding='utf-8')
        return root

    def test_parameters_are_actual_typed_schema_not_gui_example_values(self):
        root = self.fixture()
        result = _s0_catalog({'id': 'pygas', 'root': str(root), 'commit': 'actual-source-only'})
        self.assertEqual({k: len(v) for k, v in result['catalog'].items()}, {'cv': 1, 'bias': 1, 'switch': 1, 'neighbor': 1})
        entry = result['catalog']['cv'][0]
        self.assertEqual(entry['forward_args'], ['pos', 'cell'])
        self.assertEqual(entry['output_size'], 1)
        params = {p['name']: p for p in entry['params']}
        self.assertTrue(params['atom_idx']['required'])
        self.assertEqual(params['n_atoms']['type_hint'], 'int')
        self.assertEqual(params['weight']['default_value'], 0.2)
        self.assertEqual(params['active']['default_value'], True)
        self.assertTrue(params['internal_dtype']['default_is_literal'])
        self.assertEqual(result['validation'], 'not_run')
        self.assertEqual(entry['source']['sha256'], hashlib.sha256((root / 'base/colvar.py').read_bytes()).hexdigest())

    def test_unknown_forward_and_base_class_are_not_offered(self):
        root = self.fixture()
        p = root / 'base/colvar.py'
        p.write_text(p.read_text() + 'class CV:\n def __init__(self):pass\n def forward(self,pos):pass\nclass Hidden:\n def __init__(self):pass\n def forward(self,unknown):pass\n')
        self.assertEqual([v['name'] for v in _s0_catalog({'root': str(root)})['catalog']['cv']], ['RealCV'])

    def test_missing_or_changed_gui_contract_blocks_no_fake_schema(self):
        root = self.fixture()
        p = root / 'tools/cv_bias_gui_server.py'
        p.write_text(p.read_text().replace('CV_OUTPUT_SIZES', 'CHANGED_API'))
        with self.assertRaisesRegex(ValueError, 'unsupported'):
            _s0_catalog({'root': str(root)})

# --- section: test_pygas_dimensions.py ---
import sys
from pathlib import Path as _s1_Path
sys.path.insert(0, str(_s1_Path(__file__).resolve().parents[1]))
import unittest, copy
from pathlib import Path as _s1_Path
from studio_worker.tools.pygas_catalog import catalog as _s1_catalog
from studio_worker.tools.pygas_values import compiler_graph as _s1_compiler_graph, normalize_graph as _s1_normalize_graph
from studio_worker.tools.pygas_dimensions import validate_dimensions
_s1_ROOT = _s1_Path(__file__).resolve().parents[4] / 'pygas'
class DimensionGuard(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        if not (_s1_ROOT / 'tools/cv_bias_gui_server.py').is_file():
            raise unittest.SkipTest('Registered sibling pyGAS source unavailable; source-bound integration not_run')
        cls.receipt = _s1_catalog({'id': 'pygas', 'root': str(_s1_ROOT)})
        cls.cat = cls.receipt['catalog']

    def graph(self, **params):
        return {'parameter_format': 'structured-v1', 'nodes': [{'id': 'bias', 'kind': 'bias', 'class_name': 'FFWTPDMetaDGaussianBias', 'params': {'sigma': [0.1, 0.2], 'scale': [1, 1], 'weight': [0.01], 'temp': 300, 'pdl': [[-3.14, 3.14], [-3.14, 3.14]], 'bias_factor': 10, **params}}]}

    def check(self, g, size=2):
        return validate_dimensions(_s1_compiler_graph(g, self.cat), self.receipt, {'cv_size': size})

    def test_actual_internal_dtype_enum_cannot_be_bypassed_by_legacy_integer_dtype(self):
        for value in ('torch.long', 'torch.int64', 'long', 'int64'):
            graph = {'nodes': [{'id': 'cn', 'kind': 'cv', 'class_name': 'CoordNum', 'params': {'internal_dtype': value}}]}
            with self.assertRaisesRegex(ValueError, 'internal_dtype'):
                _s1_compiler_graph(graph, self.cat)
        for value in ('float64', 'float32', None):
            graph = {'parameter_format': 'structured-v1', 'nodes': [{'id': 'cn', 'kind': 'cv', 'class_name': 'CoordNum', 'params': {'internal_dtype': value}}]}
            self.assertEqual(_s1_compiler_graph(graph, self.cat)['nodes'][0]['params']['internal_dtype'], 'None' if value is None else 'torch.' + value)

    def test_source_known_zero_dimensional_scalar_needs_explicit_identity_before_collect(self):
        graph = {'parameter_format': 'structured-v1', 'nodes': [{'id': 'v', 'kind': 'cv', 'class_name': 'Volume', 'params': {'scale': 1}}, {'id': 'collect', 'kind': 'collect'}], 'edges': [{'source': {'node': 'v', 'port': 'value'}, 'target': {'node': 'collect', 'port': 'value'}}]}
        with self.assertRaisesRegex(ValueError, '0D scalar'):
            validate_dimensions(_s1_compiler_graph(graph, self.cat), self.receipt, {'cv_size': 1})
        graph['nodes'].append({'id': 'reshape', 'kind': 'reduce', 'params': {'operation': 'identity'}})
        graph['edges'] = [{'source': {'node': 'v', 'port': 'value'}, 'target': {'node': 'reshape', 'port': 'value'}}, {'source': {'node': 'reshape', 'port': 'value'}, 'target': {'node': 'collect', 'port': 'value'}}]
        self.assertEqual(validate_dimensions(_s1_compiler_graph(graph, self.cat), self.receipt, {'cv_size': 1})['status'], 'passed')

    def test_all_five_source_known_scalar_families_require_explicit_adapter(self):
        families = {'Volume': {'scale': 1}, 'PairwiseDistanceMean': {}, 'PeriodicTorsion': {'atom_idx': [0, 1, 2, 3]}, 'Torsion': {'idx': [0, 1, 2, 3]}, 'PairEntropy': {'sigma': 0.1, 'r_ic': 0.1, 'r_oc': 3, 'dx': 0.1}}
        for family, params in families.items():
            with self.subTest(family=family):
                entry = next((e for e in self.cat['cv'] if e['name'] == family))
                self.assertEqual(entry['semantics']['output_rank'], 0)
                graph = {'parameter_format': 'structured-v1', 'nodes': [{'id': 'cv', 'kind': 'cv', 'class_name': family, 'params': params}, {'id': 'collect', 'kind': 'collect'}], 'edges': [{'source': {'node': 'cv', 'port': 'value'}, 'target': {'node': 'collect', 'port': 'value'}}]}
                with self.assertRaisesRegex(ValueError, '0D scalar'):
                    validate_dimensions(_s1_compiler_graph(graph, self.cat), self.receipt, {'cv_size': 1}, {'n_atoms': 4})

    def test_full_ordered_widths_and_periods(self):
        self.assertEqual(self.check(self.graph())['status'], 'passed')
        for params in ({'sigma': [0.1]}, {'scale': [1]}, {'sigma': [0, 0.2]}, {'pdl': [[0, 0], [-3, 3]]}, {'pdl': [[-3, 3]]}, {'temp': 0}, {'bias_factor': 1}):
            with self.assertRaises(ValueError):
                self.check(self.graph(**params))

    def test_nonunit_mask_warns_without_rescaling_and_asymmetric_wrap_is_explicit(self):
        result = self.check(self.graph(scale=[2, 5], pdl=[[0, 6.28], [-3.14, 3.14]]))
        self.assertEqual({v['field'] for v in result['warnings']}, {'scale', 'pdl'})
        self.assertEqual(self.graph(scale=[2, 5])['nodes'][0]['params']['scale'], [2, 5])
        self.assertEqual(len(self.check(self.graph(scale=[0, 0]))['warnings']), 1)

    def test_index_bounds_come_from_actual_structure_and_source_hints(self):
        graph = {'parameter_format': 'structured-v1', 'nodes': [{'kind': 'cv', 'id': 'phi', 'class_name': 'PeriodicTorsion', 'params': {'atom_idx': [0, 1, 2, 4]}}]}
        compiled = _s1_compiler_graph(graph, self.cat)
        with self.assertRaisesRegex(ValueError, 'actual zero-based'):
            validate_dimensions(compiled, self.receipt, {'cv_size': 1}, {'n_atoms': 4})
        self.assertEqual(validate_dimensions(compiled, self.receipt, {'cv_size': 1}, {'n_atoms': 5})['status'], 'passed')

    def test_legacy_torsion_rejects_fractional_wrong_length_and_out_of_range_indexes(self):
        graph = {'parameter_format': 'structured-v1', 'nodes': [{'kind': 'cv', 'id': 'torsion', 'class_name': 'Torsion', 'params': {'idx': [0, 1, 2, 3]}}]}
        for idx in ([0, 1.9, 2, 3], [0, 1, 2], [-1, 1, 2, 3]):
            graph['nodes'][0]['params']['idx'] = idx
            with self.assertRaises(ValueError):
                _s1_compiler_graph(graph, self.cat)
        graph['nodes'][0]['params']['idx'] = [0, 1, 2, 4]
        with self.assertRaisesRegex(ValueError, 'actual zero-based'):
            validate_dimensions(_s1_compiler_graph(graph, self.cat), self.receipt, {'cv_size': 1}, {'n_atoms': 4})

    def test_identity_must_not_hide_vector_dimensions_or_tuple_outputs(self):
        g = {'parameter_format': 'structured-v1', 'nodes': [{'id': 'c', 'kind': 'cv', 'class_name': 'GeoCenter', 'params': {'idx': [0, 1]}}, {'id': 'r', 'kind': 'reduce', 'params': {'operation': 'identity'}}], 'edges': [{'source': {'node': 'c', 'port': 'value'}, 'target': {'node': 'r', 'port': 'value'}}]}
        with self.assertRaisesRegex(ValueError, 'identity preserves'):
            validate_dimensions(_s1_compiler_graph(g, self.cat), self.receipt, {'cv_size': 1}, {'n_atoms': 2})
        g['nodes'][1]['params']['operation'] = 'mean'
        self.assertEqual(validate_dimensions(_s1_compiler_graph(g, self.cat), self.receipt, {'cv_size': 1}, {'n_atoms': 2})['status'], 'passed')
        g['nodes'][0] = {'id': 'c', 'kind': 'cv', 'class_name': 'Volume', 'params': {'scale': 1}}
        g['nodes'][1]['params']['operation'] = 'identity'
        self.assertEqual(validate_dimensions(_s1_compiler_graph(g, self.cat), self.receipt, {'cv_size': 1})['status'], 'passed')
        g['nodes'][0] = {'id': 'c', 'kind': 'cv', 'class_name': 'ZoneSelect', 'params': {'lb': [0, 0, 0], 'ub': [1, 1, 1]}}
        g['nodes'][1]['params']['operation'] = 'mean'
        with self.assertRaisesRegex(ValueError, 'dynamic tuple'):
            validate_dimensions(_s1_compiler_graph(g, self.cat), self.receipt, {'cv_size': 1})
        g['nodes'][0] = {'id': 'c', 'kind': 'cv', 'class_name': 'GroupVector', 'params': {'idxA': [0], 'idxB': [1]}}
        with self.assertRaisesRegex(ValueError, 'dynamic tuple'):
            validate_dimensions(_s1_compiler_graph(g, self.cat), self.receipt, {'cv_size': 1}, {'n_atoms': 2})

    def test_known_cv_size_cannot_be_overridden_to_hide_components(self):
        g = {'parameter_format': 'structured-v1', 'nodes': [{'id': 'c', 'kind': 'cv', 'class_name': 'GeoCenter', 'output_size': 1, 'params': {'idx': [0, 1]}}]}
        with self.assertRaisesRegex(ValueError, 'Declared CV size'):
            validate_dimensions(_s1_compiler_graph(g, self.cat), self.receipt, {'cv_size': 1}, {'n_atoms': 2})

    def test_incomplete_legacy_data_can_normalize_but_never_render_ready(self):
        g = self.graph()
        del g['parameter_format']
        g['nodes'][0]['params'] = {'sigma': 'torch.tensor([0.1,0.2], dtype=torch.float64)'}
        n = _s1_normalize_graph(g, self.cat)
        self.assertEqual(n['nodes'][0]['params']['sigma'], [0.1, 0.2])
        with self.assertRaises(ValueError):
            _s1_compiler_graph(n, self.cat)

    def test_stale_semantics_cannot_activate_guards_and_volume_zero_is_rejected(self):
        receipt = copy.deepcopy(self.receipt)
        entry = next((e for e in receipt['catalog']['bias'] if e['name'] == 'FFWTPDMetaDGaussianBias'))
        entry['semantics']['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'Stale class semantics'):
            validate_dimensions(_s1_compiler_graph(self.graph(), self.cat), receipt, {'cv_size': 2})
        g = {'parameter_format': 'structured-v1', 'nodes': [{'id': 'vol', 'kind': 'cv', 'class_name': 'Volume', 'params': {'scale': 0}}]}
        with self.assertRaisesRegex(ValueError, 'nonzero'):
            validate_dimensions(_s1_compiler_graph(g, self.cat), self.receipt, {'cv_size': 1})

# --- section: test_pygas_order.py ---
import sys, unittest, copy
from pathlib import Path as _s2_Path
sys.path.insert(0, str(_s2_Path(__file__).resolve().parents[1]))
from studio_worker.tools.pygas_catalog import catalog as _s2_catalog
from studio_worker.tools.pygas_order import validate_order_change
from studio_worker.workspace.pygas_composition import draft_graph
from studio_worker.tools.pygas_settings import validate_settings
_s2_ROOT = _s2_Path(__file__).resolve().parents[4] / 'pygas'
class OrderedSourceContract(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        if not (_s2_ROOT / 'tools/cv_bias_gui_server.py').is_file():
            raise unittest.SkipTest('Actual pyGAS sibling unavailable; source-bound integration not_run')
        cls.receipt = _s2_catalog({'id': 'pygas', 'root': str(_s2_ROOT)})

    def graph(self):
        edge = lambda node, port, target, tp: {'source': {'node': node, 'port': port}, 'target': {'node': target, 'port': tp}}
        return {'version': 2, 'parameter_format': 'structured-v1', 'mode': 'metad', 'settings': {'atoms_path': 'model.xyz', 'pt_path': 'bias.pt'}, 'nodes': [{'id': 'v', 'kind': 'cv', 'class_name': 'Volume', 'params': {'scale': 1.0}}, {'id': 'g', 'kind': 'cv', 'class_name': 'GeoCenter', 'params': {'idx': [0, 1]}}, {'id': 't', 'kind': 'cv', 'class_name': 'PeriodicTorsion', 'params': {'atom_idx': [0, 1, 2, 3]}}, {'id': 'collect', 'kind': 'collect'}, {'id': 'bias', 'kind': 'bias', 'class_name': 'FFWTPDMetaDGaussianBias', 'params': {'sigma': [1, 2, 3, 4, 5], 'scale': [1, 0, 1, 1, 1], 'pdl': [[i, i + 10] for i in range(5)], 'weight': [0.01], 'temp': 300, 'bias_factor': 10}}, {'id': 'out', 'kind': 'output'}], 'edges': [edge('v', 'value', 'collect', 'value'), edge('g', 'value', 'collect', 'value'), edge('t', 'value', 'collect', 'value'), edge('collect', 'cv', 'bias', 'cv'), edge('collect', 'cv', 'out', 'cv'), edge('bias', 'bias', 'out', 'bias')]}

    def test_whole_block_permutation_requires_exact_ordered_bias_rows(self):
        old = self.graph()
        new = copy.deepcopy(old)
        new['edges'] = [new['edges'][2], new['edges'][0], new['edges'][1], *new['edges'][3:]]
        with self.assertRaisesRegex(ValueError, 'exact corresponding'):
            validate_order_change(old, new, self.receipt)
        permutation = [4, 0, 1, 2, 3]
        for key in ('sigma', 'scale', 'pdl'):
            new['nodes'][4]['params'][key] = [old['nodes'][4]['params'][key][i] for i in permutation]
        self.assertEqual(validate_order_change(old, new, self.receipt)['permutation'], permutation)
        new['nodes'][4]['params']['temp'] = 310
        with self.assertRaisesRegex(ValueError, 'exact corresponding'):
            validate_order_change(old, new, self.receipt)

    def test_opes_and_unreviewed_bias_cannot_be_permuted_implicitly(self):
        old = self.graph()
        old['mode'] = 'opes'
        new = copy.deepcopy(old)
        new['edges'][:2] = list(reversed(new['edges'][:2]))
        with self.assertRaisesRegex(ValueError, 'OPES dimension-order'):
            validate_order_change(old, new, self.receipt)

    def test_partial_typed_fields_persist_as_missing_without_zero_fill(self):
        graph = self.graph()
        graph['nodes'][4]['params']['pdl'] = [[-3.14, None], [None, None]]
        graph['nodes'][4]['params']['sigma'] = []
        result, missing = draft_graph(graph, self.receipt)
        self.assertEqual(result['nodes'][4]['params']['pdl'], graph['nodes'][4]['params']['pdl'])
        self.assertIn('bias.pdl', missing)
        self.assertIn('bias.sigma', missing)
        graph['nodes'][2]['params']['atom_idx'] = [0, None, 2, 3]
        self.assertIn('t.atom_idx', draft_graph(graph, self.receipt)[1])

    def test_global_types_and_studio_default_do_not_copy_gui_aoti_default(self):
        graph = self.graph()
        result, _ = draft_graph(graph, self.receipt)
        self.assertEqual(result['settings']['artifact_formats'], ['torchscript'])
        self.assertEqual(result['settings']['deployment_backend'], 'torchscript')
        for settings in ({'max_neighbors': 3.5}, {'cast_history_internal_dtype': 'false'}, {'dtype_expr': 'torch.int64'}, {'opes': {'made_up': 1}}, {'pt_path': 'chosen.pt2', 'artifact_formats': ['torchscript'], 'deployment_backend': 'torchscript'}):
            with self.assertRaises(ValueError):
                validate_settings(settings, self.receipt['settings_schema'])
        graph['settings']['pt_path'] = 'chosen.pt2'
        result, _ = draft_graph(graph, self.receipt)
        self.assertEqual(result['settings']['deployment_backend'], 'aoti')

# --- section: test_pygas_values.py ---
import sys
from pathlib import Path as _s3_Path
sys.path.insert(0, str(_s3_Path(__file__).resolve().parents[1]))
import unittest
from studio_worker.tools.pygas_values import value_expression, compiler_graph as _s3_compiler_graph, normalize_graph as _s3_normalize_graph
class Values(unittest.TestCase):

    def test_typed_and_legacy_tensor_data_preserve_dtype(self):
        p = {'name': 'atom_idx', 'type_hint': 'tensor'}
        self.assertEqual(value_expression([0, 1, 2, 3], p), 'torch.tensor([0, 1, 2, 3])')
        self.assertEqual(value_expression('torch.tensor([0,1,2,3], dtype=torch.long)', p), 'torch.tensor([0, 1, 2, 3], dtype=torch.long)')
        self.assertAlmostEqual(float(value_expression('2*torch.pi', {'name': 'scale', 'type_hint': 'float'})), 6.283185307179586)
        self.assertEqual(value_expression('float64', {'name': 'internal_dtype'}, legacy=False), 'torch.float64')

    def test_no_arbitrary_calls_or_hidden_file_reads(self):
        for text in ["__import__('os').system('id')", "open('/tmp/a').read()", '[x for x in range(3)]', "torch.tensor([1],device=open('a'))", "torch.tensor([1],dtype=getattr(torch,'float'))", "float('nan')"]:
            with self.assertRaises(ValueError):
                value_expression(text, {'name': 'sigma', 'type_hint': 'tensor'})

    def test_required_module_defaults_and_unknown_fields(self):
        cat = {'cv': [{'name': 'Example', 'params': [{'name': 'n_atoms', 'required': True}, {'name': 'switch_func', 'is_module_param': True, 'required': True}, {'name': 'a', 'required': True, 'type_hint': 'float'}, {'name': 'optional', 'required': False, 'default': 'None'}]}]}
        graph = {'nodes': [{'id': 'cv', 'kind': 'cv', 'class_name': 'Example', 'params': {'a': 2}}]}
        self.assertEqual(_s3_compiler_graph(graph, cat)['nodes'][0]['params'], {'a': '2'})
        for params in [{}, {'a': 2, 'other': 3}, {'a': 2, 'switch_func': 'evil()'}, {'a': 2, 'n_atoms': 10}]:
            with self.assertRaises(ValueError):
                _s3_compiler_graph({'nodes': [{**graph['nodes'][0], 'params': params}]}, cat)
        self.assertEqual(graph['nodes'][0]['params'], {'a': 2})

    def test_codegen_settings_are_fixed_expressions(self):
        for key, value in [('device_expr', "open('a')"), ('dtype_expr', "__import__('os')")]:
            with self.assertRaises(ValueError):
                _s3_compiler_graph({'nodes': [], 'settings': {key: value}}, {})

    def test_tensor_shape_and_numeric_data_are_checked(self):
        for value in [['text'], [None], [[1], [2, 3]], True]:
            with self.assertRaises(ValueError):
                value_expression(value, {'name': 'sigma', 'type_hint': 'tensor'}, legacy=False)

    def test_unknown_fields_and_quoted_codegen_names_are_rejected(self):
        cases = [{'nodes': [], 'extra': 'x'}, {'nodes': [], 'settings': {'extra': 'x'}}, {'nodes': [{'kind': 'output', 'params': {'x': 1}}]}, {'nodes': [{'kind': 'reduce', 'params': {'operation': 'mean', 'extra': 1}}]}, {'nodes': [], 'settings': {'pt_path': 'bias"; unexpected() #.pt'}}]
        for graph in cases:
            with self.assertRaises(ValueError):
                _s3_compiler_graph(graph, {})

    def test_normalization_preserves_tensor_dtype_and_rejects_invalid_index_shape(self):
        p = {'name': 'atom_idx', 'type_hint': 'expr', 'required': True, 'editor_hint': {'editor': 'integer_vector', 'shape': [4], 'serializer': 'literal'}}
        cat = {'cv': [{'name': 'PeriodicTorsion', 'params': [p]}]}
        g = {'nodes': [{'kind': 'cv', 'id': 'cv', 'class_name': 'PeriodicTorsion', 'params': {'atom_idx': '[0, 1, 2, 3]'}}]}
        n = _s3_normalize_graph(g, cat)
        self.assertEqual(n['nodes'][0]['params']['atom_idx'], [0, 1, 2, 3])
        self.assertEqual(n['parameter_format'], 'structured-v1')
        self.assertEqual(_s3_compiler_graph(n, cat)['nodes'][0]['params']['atom_idx'], '[0, 1, 2, 3]')
        for value in [[0, 1, 2], [-1, 1, 2, 3], [0, 1, 2.2, 3]]:
            with self.assertRaises(ValueError):
                value_expression(value, p, legacy=False)
        c = {'cv': [{'name': 'Other', 'params': [{'name': 'sigma', 'type_hint': 'tensor', 'required': True}]}]}
        g['nodes'][0].update(class_name='Other', params={'sigma': 'torch.tensor([0.1], dtype=torch.float64)'})
        n = _s3_normalize_graph(g, c)
        self.assertEqual(n['nodes'][0]['parameter_dtypes']['sigma'], 'torch.float64')
        self.assertIn('dtype=torch.float64', _s3_compiler_graph(n, c)['nodes'][0]['params']['sigma'])

    def test_dtype_options_cannot_be_bypassed_or_change_scalar_types(self):
        param = {'name': 'dtype', 'editor_hint': {'editor': 'enum', 'options': ['float32', 'float64']}}
        self.assertEqual(value_expression('torch.double', param), 'torch.float64')
        with self.assertRaises(ValueError):
            value_expression('torch.int64', param)
        c = {'cv': [{'name': 'Scalar', 'params': [{'name': 'a', 'type_hint': 'float', 'required': True}]}]}
        with self.assertRaises(ValueError):
            _s3_compiler_graph({'nodes': [{'kind': 'cv', 'class_name': 'Scalar', 'params': {'a': 2}, 'parameter_dtypes': {'a': 'torch.float64'}}]}, c)

    def test_floating_tensor_constructor_uses_reviewed_graph_precision(self):
        cat = {'bias': [{'name': 'B', 'params': [{'name': 'sigma', 'type_hint': 'tensor', 'required': True}]}]}
        graph = {'parameter_format': 'structured-v1', 'settings': {'dtype_expr': 'torch.double'}, 'nodes': [{'kind': 'bias', 'class_name': 'B', 'params': {'sigma': [0.12345678901234568]}}]}
        text = _s3_compiler_graph(graph, cat)['nodes'][0]['params']['sigma']
        self.assertIn('dtype=torch.double', text)
        self.assertIn('0.12345678901234568', text)
        graph['nodes'][0]['parameter_dtypes'] = {'sigma': 'torch.float32'}
        self.assertIn('dtype=torch.float32', _s3_compiler_graph(graph, cat)['nodes'][0]['params']['sigma'])

# --- section: test_composition_input_resolution.py ---
import sys, tempfile, unittest
from pathlib import Path as _s4_Path
sys.path.insert(0, str(_s4_Path(__file__).resolve().parents[1]))
from studio_worker.workspace.pygas_composition import resolve_input
class OwnedRelativeInputs(unittest.TestCase):

    def test_saved_relative_structure_wins_over_unrelated_same_basename(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _s4_Path(tmp).resolve()
            owned = root / 'cv-owned'
            other = root / 'import-other'
            owned.mkdir()
            other.mkdir()
            (owned / 'model.xyz').write_text('owned immutable structure')
            (other / 'model.xyz').write_text('different selected candidate')
            assets = [{'path': str(p), 'name': 'model.xyz'} for p in (owned / 'model.xyz', other / 'model.xyz')]
            project = {'policy': {'input_roots': []}}
            self.assertEqual(resolve_input('model.xyz', owned, assets, root, project), owned / 'model.xyz')
            self.assertEqual(resolve_input(str(other / 'model.xyz'), owned, assets, root, project), other / 'model.xyz')
            self.assertEqual((owned / 'model.xyz').read_text(), 'owned immutable structure')

    def test_missing_relative_file_still_requires_unique_authorized_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _s4_Path(tmp).resolve()
            owned = root / 'cv-owned'
            owned.mkdir()
            assets = []
            for name in ('a', 'b'):
                folder = root / name
                folder.mkdir()
                p = folder / 'model.xyz'
                p.write_text(name)
                assets.append({'path': str(p), 'name': 'model.xyz'})
            with self.assertRaisesRegex(ValueError, 'explicit authorized'):
                resolve_input('model.xyz', owned, assets, root, {'policy': {'input_roots': []}})
            self.assertEqual(resolve_input('model.xyz', owned, assets[:1], root, {'policy': {'input_roots': []}}), _s4_Path(assets[0]['path']))

    def test_relative_traversal_cannot_select_another_composition(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _s4_Path(tmp).resolve()
            owned = root / 'cv-owned'
            owned.mkdir()
            (root / 'model.xyz').write_text('other')
            with self.assertRaisesRegex(ValueError, 'traverse'):
                resolve_input('../model.xyz', owned, [], root, {'policy': {'input_roots': []}})

    def test_owned_directory_is_not_replaced_by_a_different_asset_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _s4_Path(tmp).resolve()
            owned = root / 'cv-owned'
            owned.mkdir()
            (owned / 'model.xyz').mkdir()
            other = root / 'model.xyz'
            other.write_text('other')
            with self.assertRaisesRegex(ValueError, 'ordinary'):
                resolve_input('model.xyz', owned, [{'path': str(other), 'name': 'model.xyz'}], root, {'policy': {'input_roots': []}})

    def test_leaf_broken_and_ancestor_links_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = _s4_Path(tmp).resolve()
            owned = root / 'cv-owned'
            owned.mkdir()
            folder = owned / 'actual'
            folder.mkdir()
            (folder / 'model.xyz').write_text('owned')
            try:
                (owned / 'leaf.xyz').symlink_to(folder / 'model.xyz')
                (owned / 'broken.xyz').symlink_to(folder / 'missing.xyz')
                (owned / 'linked').symlink_to(folder, target_is_directory=True)
            except OSError as error:
                self.skipTest('Host cannot create test-owned symbolic links: ' + str(error))
            for name in ('leaf.xyz', 'broken.xyz', 'linked/model.xyz'):
                with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Linked'):
                    resolve_input(name, owned, [], root, {'policy': {'input_roots': []}})

# --- section: test_composition_store.py ---
import sys
from pathlib import Path as _s5_Path
sys.path.insert(0, str(_s5_Path(__file__).resolve().parents[1] / 'studio_worker'))
import json, tempfile, threading, unittest
from pathlib import Path as _s5_Path
from composition_store import CompositionStore, JOURNAL
class PairStoreTests(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = _s5_Path(self.temp.name).resolve()
        self.store = CompositionStore(self.root, threading.RLock())
        self.target = self.root / 'cv-test'

    def identity(self, r):
        return {'journal_sha256': r['journal_sha256'], 'files': {name: item['sha256'] for name, item in r['files'].items()}}

    def first(self):
        return self.store.save(self.target, {'nodes': []}, '# graph source\n', {'journal_sha256': None, 'files': {}})

    def test_same_directory_cas_and_both_files_read_back(self):
        first = self.first()
        second = self.store.save(self.target, {'nodes': [{'id': 'cv'}]}, '# changed source\n', self.identity(first))
        self.assertEqual(second['status'], 'rendered')
        self.assertEqual(second['directory'], str(self.target))
        self.assertNotEqual(second['journal_sha256'], first['journal_sha256'])
        self.assertEqual(second['source'], '# changed source\n')
        with self.assertRaisesRegex(ValueError, 'hash conflict'):
            self.store.save(self.target, {'nodes': []}, '# stale', self.identity(first))
        self.assertEqual(self.store.read(self.target)['source'], '# changed source\n')

    def test_external_source_change_blocks_instead_of_certifying_old_graph(self):
        self.first()
        (self.target / 'build_bias.py').write_text('# edited outside pair', encoding='utf8')
        result = self.store.read(self.target)
        self.assertEqual(result['status'], 'blocked')
        self.assertNotIn('source', result)
        with self.assertRaisesRegex(ValueError, 'differs'):
            self.store.save(self.target, {'nodes': []}, '# render', self.identity(result))

    def test_incomplete_graph_is_saved_as_draft_and_does_not_expose_stale_source(self):
        first = self.first()
        result = self.store.save(self.target, {'nodes': [{'kind': 'cv', 'params': {}}]}, None, self.identity(first))
        self.assertEqual(result['status'], 'draft')
        self.assertNotIn('source', result)
        self.assertTrue((self.target / 'build_bias.py').exists())
        self.assertEqual(result['graph']['nodes'][0]['params'], {})

    def test_interrupted_second_file_write_leaves_pending_journal_and_blocks_consumers(self):
        first = self.first()
        replace = self.store._replace

        def fail(path, data):
            if path.name == 'build_bias.py':
                raise OSError('simulated disk failure')
            replace(path, data)
        self.store._replace = fail
        with self.assertRaises(OSError):
            self.store.save(self.target, {'nodes': [{'id': 'changed'}]}, '# new', self.identity(first))
        self.assertEqual(json.loads((self.target / JOURNAL).read_text(encoding='utf8'))['status'], 'pending')
        reopened = CompositionStore(self.root, threading.RLock())
        result = reopened.read(self.target)
        self.assertEqual(result['status'], 'blocked')
        self.assertNotIn('source', result)

    def test_legacy_pair_requires_exact_both_hashes_before_adoption(self):
        self.target.mkdir()
        (self.target / 'workflow.json').write_text('{"nodes":[]}', encoding='utf8')
        (self.target / 'build_bias.py').write_text('# old', encoding='utf8')
        old = self.store.read(self.target)
        self.assertEqual(old['status'], 'legacy')
        with self.assertRaisesRegex(ValueError, 'hash conflict'):
            self.store.save(self.target, {'nodes': []}, '# new', {'journal_sha256': None, 'files': {}})
        self.assertEqual(self.store.save(self.target, {'nodes': []}, '# new', self.identity(old))['status'], 'rendered')

    def test_explicit_repair_requires_the_current_entire_pair_and_journal_hash(self):
        old = self.first()
        (self.target / 'build_bias.py').write_text('# external edit', encoding='utf8')
        current = self.store.read(self.target)
        self.assertEqual(current['status'], 'blocked')
        with self.assertRaisesRegex(ValueError, 'hash conflict'):
            self.store.save(self.target, {'nodes': []}, '# repaired', self.identity(old), repair=True)
        repaired = self.store.save(self.target, {'nodes': []}, '# explicitly regenerated', self.identity(current), repair=True)
        self.assertEqual(repaired['status'], 'rendered')
        self.assertEqual(repaired['source'], '# explicitly regenerated')

    def test_escape_and_linked_targets_are_refused(self):
        with self.assertRaises(ValueError):
            self.store.read(self.root.parent / 'other')
        self.first()
        try:
            (self.target / 'workflow.json').unlink()
            (self.target / 'workflow.json').symlink_to(self.target / 'build_bias.py')
        except OSError as error:
            self.skipTest('Symlink privilege unavailable: ' + str(error))
        with self.assertRaisesRegex(ValueError, 'ordinary owned'):
            self.store.read(self.target)

# --- section: test_graph_contract.py ---
import hashlib, tempfile, types, unittest
from pathlib import Path as _s6_Path
from studio_worker.tools.source_projects import graph_authoring_contract, inspect_source
PUBLIC_FIXTURE = "raise RuntimeError('THIS MODULE MUST NEVER BE IMPORTED')\nRUNTIME_PORTS={'pos':'pos','edge_index':'side_array'}\ndef _mode(graph):\n    return graph.get('mode','cvonly')\ndef _node_ports(node,catalog,mode):\n    return ({'cell':'cell'},{'value':'value'})\ndef _edge_endpoint(edge,side):\n    raw=edge[side]\n    if not isinstance(raw,dict):raise ValueError('structured endpoint required')\n    return raw['node'],raw['port']\ndef validate_graph(graph,catalog):\n    if 'kind' not in graph['nodes'][0]:raise ValueError('kind required')\n    return {'cv_size':1}\ndef _reduce_expression(source,operation):\n    return source+'.reshape(-1)[:1]'\n"
class GraphContract(unittest.TestCase):

    def test_actual_rules_are_source_bound_and_never_execute_top_level_code(self):
        sha = hashlib.sha256(PUBLIC_FIXTURE.encode()).hexdigest()
        out = graph_authoring_contract(PUBLIC_FIXTURE, sha)
        self.assertEqual(out['status'], 'passed')
        self.assertEqual(out['source']['sha256'], sha)
        self.assertEqual(out['runtime_ports']['edge_index'], 'side_array')
        self.assertIn("raw['node'],raw['port']", out['entrypoints']['_edge_endpoint'])
        self.assertIn("'kind' not in", out['entrypoints']['validate_graph'])
        self.assertEqual(out['validation'], 'not_run')

    def test_changed_or_unavailable_api_has_no_compatibility_claim(self):
        for code in ('def other(): pass', 'def _mode(: pass', PUBLIC_FIXTURE.replace("RUNTIME_PORTS={'pos':'pos','edge_index':'side_array'}", "RUNTIME_PORTS=__import__('os').environ")):
            out = graph_authoring_contract(code, 'sha')
            self.assertEqual(out['status'], 'blocked')
            self.assertNotIn('entrypoints', out)

    def test_bounded_excerpt_refuses_oversized_code(self):
        code = PUBLIC_FIXTURE.replace("return graph.get('mode','cvonly')", 'return ' + repr('x' * 25000))
        self.assertEqual(graph_authoring_contract(code, 'sha')['status'], 'blocked')

    def test_registered_inspection_returns_same_hash_and_rules(self):
        with tempfile.TemporaryDirectory() as folder:
            root = _s6_Path(folder)
            (root / 'tools').mkdir()
            (root / 'tools/graph_workflow.py').write_text(PUBLIC_FIXTURE, encoding='utf-8')
            out = inspect_source({'id': 'pygas', 'root': str(root)})
            f = next((f for f in out['files'] if f['name'] == 'tools/graph_workflow.py'))
            self.assertEqual(out['graph_contract']['source']['sha256'], f['sha256'])
            self.assertTrue(out['capabilities']['graph_renderer'])

    def test_public_class_methods_are_optional_bounded_and_never_imported(self):
        code = "raise RuntimeError('never import')\nclass ScalarCV:\n def __init__(self):pass\n @staticmethod\n def minimum_image(pos,cell):\n  return (pos/cell).round()\n def forward(self,pos,cell):\n  return self.minimum_image(pos,cell).mean()\n"
        with tempfile.TemporaryDirectory() as folder:
            root = _s6_Path(folder)
            (root / 'base').mkdir()
            file = root / 'base/colvar.py'
            file.write_text(code, encoding='utf-8')
            source = {'id': 'pygas', 'root': str(root)}
            self.assertNotIn('symbol_excerpts', inspect_source(source))
            out = inspect_source(source, ['ScalarCV'])
            result = out['symbol_excerpts']
            self.assertEqual(result['status'], 'passed')
            item = result['symbols'][0]
            self.assertEqual(item['source']['sha256'], hashlib.sha256(file.read_bytes()).hexdigest())
            self.assertIn('.mean()', item['methods']['forward']['source'])
            self.assertIn('staticmethod', item['methods']['minimum_image']['decorators'])
            self.assertLessEqual(result['bytes'], 16384)
            self.assertEqual(result['validation'], 'not_run')
            self.assertEqual(inspect_source(source, ['Unknown'])['symbol_excerpts']['status'], 'blocked')
            file.write_text(code.replace('return self.minimum_image(pos,cell).mean()', 'return ' + repr('x' * 17000)), encoding='utf-8')
            blocked = inspect_source(source, ['ScalarCV'])['symbol_excerpts']
            self.assertEqual(blocked['status'], 'blocked')
            self.assertNotIn('symbols', blocked)

    def test_symbols_cannot_request_paths_duplicates_or_unbounded_classes(self):
        for symbols in ('ScalarCV', ['../private.py'], ['x'] * 5, ['ScalarCV', 'ScalarCV'], [{}]):
            with self.assertRaises(ValueError):
                inspect_source({'id': 'pygas', 'root': '/never/read'}, symbols)

    def test_graph_contract_exposes_actual_reduce_and_studio_required_io(self):
        out = graph_authoring_contract(PUBLIC_FIXTURE, hashlib.sha256(PUBLIC_FIXTURE.encode()).hexdigest())
        self.assertIn('.reshape(-1)[:1]', out['entrypoints']['_reduce_expression'])
        io = out['studio_io']
        self.assertEqual(io['required_settings'], ['atoms_path', 'pt_path'])
        self.assertEqual(io['workflow_path'], 'workflow.json')
        self.assertIn("('atoms_path','pt_path')", io['entrypoints']['portable_graph'])
        self.assertEqual(io['status'], 'passed')
        self.assertIn('no backend fallback', io['guidance'])

    def test_source_tool_forwards_optional_symbols_and_preserves_read_only_schema(self):
        from studio_worker.server import dispatch, tools
        schema = next((tool for tool in tools() if tool['name'] == 'inspect_source_project'))
        self.assertNotIn('symbols', schema['inputSchema']['required'])
        self.assertEqual(schema['inputSchema']['properties']['symbols']['maxItems'], 4)
        self.assertTrue(schema['annotations']['readOnlyHint'])
        with tempfile.TemporaryDirectory() as folder:
            root = _s6_Path(folder)
            (root / 'base').mkdir()
            (root / 'base/colvar.py').write_text('class Sample:\n def __init__(self):pass\n def forward(self):return 1\n', encoding='utf-8')
            source = {'id': 'pygas', 'root': str(root)}
            store = types.SimpleNamespace(get=lambda kind, key: source)
            service = types.SimpleNamespace(store=store)
            result = dispatch(service, 'POST', '/api/source-project/inspect', {'source_id': 'pygas', 'symbols': ['Sample']})
            self.assertEqual(result['symbol_excerpts']['symbols'][0]['name'], 'Sample')

if __name__ == '__main__':
    unittest.main()
