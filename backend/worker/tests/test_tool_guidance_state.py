"""Persisted metadata regression only; no process or scientific validation claims."""
import copy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from studio_worker.server import dispatch, tools
from studio_worker.store import Store
from studio_worker.tools.archive_guard import assert_guidance_read
from studio_worker.tools.guidance_state import guidance_state


class ToolGuidanceState(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = Store(self.root); self.addCleanup(self.store.db.close)
        self.service = SimpleNamespace(store=self.store)

    def persist(self, status='active'):
        package = {'schema_version': 1, 'id': 'package-record', 'package_id': 'fixture', 'package_version': 'a' * 64, 'source_commit': 'b' * 40, 'snapshot_root': str(self.root / 'snapshot'), 'files': [], 'manifest': {'functions': [{'id': 'reference', 'engine': 'installation.check', 'description': 'NOT_GLOBAL_INSTRUCTIONS'}], 'guidance': {'delivery': 'SKILL.md', 'installation': ['install.md'], 'configuration': ['configure.md']}}}
        configuration = {'schema_version': 1, 'id': 'configuration', 'revision': 7, 'status': status, 'package_id': 'fixture', 'package_version': 'a' * 64, 'manifest_sha256': 'c' * 64, 'environment_sha256': 'd' * 64, 'target': {'target': 'local', 'project_id': 'project', 'environment_id': 'environment'}}
        self.store.put_many([
            ('tool-package-version', package), ('tool-configuration', configuration),
            ('tool-package-alias', {'schema_version': 1, 'id': package['id'], 'revision': 2, 'roots': [package['snapshot_root'], str(self.root / 'origin')]}),
            ('tool-activation', {'schema_version': 1, 'id': 'configuration', 'configuration_id': 'configuration', 'execution_skill_id': 'e' * 64}),
            ('tool-execution-skill', {'schema_version': 1, 'id': 'e' * 64, 'configuration_id': 'configuration', 'sha256': 'e' * 64, 'body': 'PRIVATE_EXECUTION_BODY', 'facts': {'secret': 'PRIVATE_FACTS'}}),
        ])

    def test_metadata_survives_reopen_without_files_body_or_state_mutation(self):
        self.persist()
        before = guidance_state(self.service, {})
        stored = {kind: copy.deepcopy(self.store.list(kind)) for kind in ('tool-configuration', 'tool-activation', 'tool-execution-skill', 'tool-package-version', 'tool-package-alias')}
        self.store.db.close(); self.store = Store(self.root); self.service.store = self.store; self.addCleanup(self.store.db.close)
        with patch.object(Path, 'stat', side_effect=AssertionError('No path stat')), patch.object(Path, 'open', side_effect=AssertionError('No file open')), patch.object(Path, 'read_text', side_effect=AssertionError('No guide text')), patch.object(Path, 'read_bytes', side_effect=AssertionError('No guide bytes')), patch.object(Path, 'resolve', side_effect=AssertionError('No filesystem resolution')):
            result = dispatch(self.service, 'POST', '/api/tool-guidance/state', {}, admin=True)
        self.assertEqual(result, before)
        self.assertEqual(len(result['archived_resources']), 6)
        self.assertTrue(result['configurations'][0]['has_activation'])
        self.assertEqual(result['configurations'][0]['execution_skill'], {'id': 'e' * 64, 'sha256': 'e' * 64})
        wire = json.dumps(result)
        for private in ('PRIVATE_EXECUTION_BODY', 'PRIVATE_FACTS', 'NOT_GLOBAL_INSTRUCTIONS', '"body"', '"facts"'): self.assertNotIn(private, wire)
        self.assertEqual({kind: self.store.list(kind) for kind in stored}, stored)

    def test_activation_keeps_archives_after_later_failed_state(self):
        self.persist()
        previous = guidance_state(self.service, {})
        record = self.store.get('tool-configuration', 'configuration'); record.update(status='failed', revision=8); self.store.put('tool-configuration', record)
        current = guidance_state(self.service, {})
        self.assertNotEqual(current['revision'], previous['revision'])
        self.assertEqual(current['configurations'][0]['status'], 'failed')
        self.assertEqual(current['archived_resources'], previous['archived_resources'])
        with self.assertRaises(PermissionError): assert_guidance_read(self.service, self.root / 'origin/install.md')

    def test_only_admin_empty_post_can_read_and_mcp_has_no_body_or_route(self):
        self.persist()
        for method, admin in [('GET', True), ('POST', False)]:
            with self.assertRaises(PermissionError): dispatch(self.service, method, '/api/tool-guidance/state', {}, admin=admin)
        with self.assertRaises(ValueError): dispatch(self.service, 'POST', '/api/tool-guidance/state', {'passed': True}, admin=True)
        self.assertFalse(any(item['name'] in ('tool_guidance_state', 'read_tool_guidance_state') for item in tools()))
        with self.assertRaises(PermissionError): dispatch(self.service, 'POST', '/api/tool-execution-skill/read', {'configuration_id': 'configuration'}, admin=False)

    def test_orphaned_activation_fails_closed_instead_of_reporting_legacy(self):
        self.store.put('tool-activation', {'schema_version': 1, 'id': 'orphan', 'configuration_id': 'orphan', 'execution_skill_id': 'e' * 64})
        with self.assertRaisesRegex(ValueError, 'retain archive restrictions'): guidance_state(self.service, {})


if __name__ == '__main__': unittest.main()
