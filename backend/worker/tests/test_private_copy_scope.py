import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from studio_worker.compute.cluster import private_copy_rows


class PrivateCopyRowsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.rows = [{
            'entry_id': 'entry', 'project_id': 'owned', 'workspace_id': 'workspace',
            'bindings': {'spec_sha256': 'a' * 64},
            'paths': [str(self.root / 'projects/owned/inputs/build_bias.py')],
        }]
        self.runs = [{'project_id': 'owned', 'directory': str(self.root / 'runs/owned-run')}]

    def selected(self, *paths):
        return private_copy_rows(self.rows, [Path(value) for value in paths], self.runs, self.root)

    def test_owned_input_root_and_exact_paths_block_remote_copy(self):
        for path in (
            self.root / 'projects/owned/inputs/build_bias.py',
            self.root / 'projects/owned/inputs/nested/any.xyz',
            self.root / 'runs/owned-run/simulation/output.xyz',
        ):
            with self.subTest(path=path):
                self.assertEqual([row['entry_id'] for row in self.selected(path)], ['entry'])

    def test_unrelated_public_inputs_no_longer_block_the_whole_project(self):
        for path in (
            self.root / 'policy-inputs/public.xyz',
            self.root / 'projects/other/inputs/other.py',
        ):
            with self.subTest(path=path):
                self.assertEqual(self.selected(path), [])

    def test_no_private_rows_means_no_selection(self):
        self.assertEqual(private_copy_rows([], [self.root / 'projects/owned/inputs/a'], self.runs, self.root), [])


if __name__ == '__main__':
    unittest.main()
