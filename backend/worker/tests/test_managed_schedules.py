"""Portable clock, store and scheduler-wire fixtures. No SSH sessions are opened."""

import base64
import io
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from studio_worker.compute.managed_child import child_batch
from studio_worker.compute.managed_schedule_policy import fingerprint
from studio_worker.compute.managed_schedules import DELEGATION, MANUAL_OBSERVATION, ROUND, ManagedSchedules
from studio_worker.compute.service import Service
from studio_worker.transport.routes import dispatch


class ManagedScheduleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = self.root / 'run.py'
        self.path.write_text("print('managed fixture')", encoding='utf8')
        self.time = 1000
        self.calls, self.cancelled, self.submissions, self.terminal = [], set(), {}, set()
        self.lost, self.wrong_identity = False, False
        self.before_submit, self.before_poll = None, None
        self.open()
        self.profile = self.clusters.register({
            'name': 'fixture', 'scheduler': 'slurm', 'target': 'fixture@example.invalid', 'port': 22,
            'ssh_client': '/usr/bin/ssh', 'remote_root': '/tmp/isolated-managed-test', 'queue': 'fixture',
            'environment': {'executables': {'python': '/usr/bin/python3'}},
        })
        self.project = self.service.register_project({'name': 'fixture', 'policy': {
            'input_roots': [str(self.root)], 'clusters': [self.profile['id']], 'max_concurrent': 3,
        }})
        self.parent = self.start_parent(self.profile['id'])
        self.scope = {'provider': 'codex', 'threadId': 'thread-a', 'taskId': 'task-a',
                      'projectId': self.project['id'], 'runId': self.parent['id']}
        self.addCleanup(self.close)

    def open(self):
        self.service = Service(self.root / 'worker', schedule=False)
        self.clusters = self.service.clusters
        self.clusters.transport = lambda _profile: SimpleNamespace(run=self.wire)
        self.schedules = self.service.managed_schedules = ManagedSchedules(self.service, lambda: self.time)

    def close(self):
        self.service.close()
        self.service.store.db.close()

    def wire(self, script, data=None, timeout=40):
        args = shlex.split(script)
        self.assertFalse(self.service.store.lock._is_owned())
        self.calls.append((script, data, timeout))
        if args[0] in ('scancel', 'bkill'):
            self.cancelled.add(args[1])
            return ''
        encoded = re.search(r"base64.b64decode\('([^']+)'\)", args[-1]).group(1)
        p = json.loads(base64.b64decode(encoded))
        if data is not None:
            job = str(len(self.submissions) + 1)
            self.submissions[p['id']] = (job, p['nonce'])
            if self.before_submit:
                self.before_submit(p)
            if self.lost:
                raise ConnectionError('fixture lost reply')
            receipt = {'nonce': p['nonce'], 'job_id': job}
        elif 'scheduler_state' in script:
            if self.before_poll:
                self.before_poll(p)
            job = p['job_id']
            receipt = {'job_id': job, 'identity_verified': not self.wrong_identity}
            if not self.wrong_identity:
                receipt['scheduler_state'] = 'CANCELLED' if job in self.cancelled else 'RUNNING'
            if p['id'] in self.terminal:
                receipt['exit'] = {'nonce': p['nonce'], 'exit_code': 0}
        else:
            receipt = {'present': True, 'offset': 6, 'text': 'hello\n'}
        return '__STUDIO_JSON__' + json.dumps(receipt)

    def start_parent(self, cluster):
        parent = self.draft(cluster, 'parent-' + cluster)
        return self.clusters.submit(parent['id'])

    def draft(self, cluster, key):
        return self.clusters.prepare({
            'name': 'Parent fixture', 'project_id': self.project['id'], 'cluster_id': cluster,
            'engine': 'pydyn.md', 'inputs': {'run.py': str(self.path)}, 'parameters': {},
            'idempotency_key': key, 'max_seconds': 120,
        })

    def managed_submit_request(self, run):
        return {'run_id': run['id'], 'managed_monitor': {
            'schemaVersion': 1, 'sourceId': 'source-a', 'scope': {**self.scope, 'runId': run['id']},
        }}

    def submit_managed(self, data, admin=True):
        return dispatch(self.service, 'POST', '/api/cluster/submit', data, admin)

    def upsert(self, kind='poll', **fields):
        return self.schedules.upsert({'sourceId': 'source-a', 'scope': self.scope, 'kind': kind,
                                      'mutationId': 'create', **fields})

    def request(self, plan):
        return {'sourceId': 'source-a', 'scheduleId': plan['id']}

    def status(self, plan):
        return self.schedules.status(self.request(plan))

    def observe(self, plan, request_id):
        return dispatch(self.service, 'POST', '/api/managed-schedules/observe-once',
                        {**self.request(plan), 'requestId': request_id}, True)

    def pump(self, **fields):
        return self.schedules.pump({'sourceId': 'source-a', **fields})

    def script(self, key='analysis', **fields):
        defaults = {'key': key, 'name': 'Fixture analysis', 'intervalSeconds': 2, 'timeoutSeconds': 45,
                    'script': {'language': 'bash', 'text': 'printf "%s\\n" fixture-script\n'}}
        return self.upsert('script', **{**defaults, **fields})

    def test_default_budget_only_clock_due_dispatch_and_cache_reads(self):
        plan = self.upsert()
        self.assertEqual((plan['intervalSeconds'], plan['maxRuns'], plan['nextAt']), (1800, 48, 2800))
        self.assertEqual(self.upsert(), plan)
        self.calls.clear()
        self.clusters.tick()
        dispatch(self.service, 'POST', '/api/cluster/observation', {'run_id': self.parent['id']}, True)
        dispatch(self.service, 'POST', '/api/cluster/status', {'run_id': self.parent['id']}, False)
        self.status(plan)
        self.pump()
        self.assertFalse(self.calls)
        self.time = 2800
        def at_dispatch(_payload):
            claimed = self.status(plan)
            self.assertEqual(claimed['count'], 1)
            self.assertEqual(claimed['history'][0]['status'], 'started')
        self.before_poll = at_dispatch
        view = self.pump()
        self.assertFalse(view['deliveries'])
        self.assertEqual(view['schedules'][0]['lastResult']['run']['status'], 'running')
        self.assertEqual(len(self.calls), 1)
        self.pump()
        self.assertEqual(len(self.calls), 1)

    def test_managed_parent_monitor_is_reserved_with_submit_and_closes_on_terminal_evidence(self):
        draft = self.draft(self.profile['id'], 'managed-first')
        data = self.managed_submit_request(draft)
        health = dispatch(self.service, 'GET', '/api/health', {}, True)
        self.assertEqual(health['managed_submit_monitor_schema'], 1)
        def before_dispatch(p):
            self.assertEqual(p['id'], draft['id'])
            reserved = self.clusters.raw(draft['id'])
            observed = self.schedules.list({'sourceId': 'source-a'})
            self.assertEqual(len(observed), 1)
            self.assertEqual(reserved['status'], 'unknown')
            self.assertTrue(reserved['submit_attempted'])
            self.assertTrue(reserved['managed_schedule_parent'])
            self.assertEqual(reserved['managed_submit_monitor']['scheduleId'], observed[0]['id'])
            self.assertEqual(observed[0]['scope'], data['managed_monitor']['scope'])
        self.before_submit = before_dispatch
        queued = self.submit_managed(data)
        plan = self.schedules.list({'sourceId': 'source-a'})[0]
        self.assertEqual(queued['status'], 'queued')
        self.assertEqual(plan['kind'], 'poll')
        self.assertEqual((plan['intervalSeconds'], plan['maxRuns'], plan['count'], plan['nextAt']), (1800, 48, 0, 2800))
        self.assertEqual(self.submit_managed(data)['job_id'], queued['job_id'])
        self.assertEqual(len(self.submissions), 2)
        self.assertNotIn('managed_schedule_parent', self.clusters.raw(self.parent['id']))
        polled = []
        self.before_poll = lambda p: polled.append(p['id'])
        self.clusters.tick()
        self.clusters.poll(draft['id'])
        self.assertEqual(polled, [self.parent['id']])
        self.time = 2799
        self.pump()
        self.assertEqual(self.status(plan)['count'], 0)
        self.terminal.add(draft['id'])
        self.time = 2800
        self.assertFalse(self.pump()['deliveries'])
        final = self.status(plan)
        self.assertEqual((final['count'], final['status'], final['nextAt']), (1, 'completed', None))
        self.assertEqual(final['lastResult']['run']['status'], 'succeeded')
        self.time += 5000
        self.pump()
        self.assertEqual(polled, [self.parent['id'], draft['id']])

    def test_failed_managed_submit_preflight_creates_no_monitor_and_legacy_cannot_inject(self):
        draft = self.draft(self.profile['id'], 'enrollment-preflight')
        data = self.managed_submit_request(draft)
        with self.assertRaises(PermissionError):
            self.submit_managed(data, admin=False)
        foreign = {**data, 'managed_monitor': {**data['managed_monitor'], 'scope': {
            **data['managed_monitor']['scope'], 'projectId': 'foreign-project',
        }}}
        with self.assertRaises(PermissionError):
            self.submit_managed(foreign)
        with patch.object(self.clusters, 'archive', side_effect=ValueError('fixture archive unavailable')):
            with self.assertRaisesRegex(ValueError, 'archive unavailable'):
                self.submit_managed(data)
        self.assertEqual(len(self.submissions), 1)
        self.assertEqual(self.clusters.raw(draft['id'])['status'], 'ready')
        self.assertEqual(self.schedules.list({'sourceId': 'source-a'}), [])

    @unittest.skipUnless(os.name == 'posix', 'Exercise the worker MCP endpoint in its supported POSIX environment')
    def test_direct_mcp_rejects_managed_submit_metadata_before_dispatch(self):
        from studio_worker.transport.server import mcp_tool_call
        draft = self.draft(self.profile['id'], 'mcp-forgery')
        result = mcp_tool_call(self.service, {'name': 'submit_cluster_run', 'arguments': self.managed_submit_request(draft)})
        self.assertTrue(result['isError'])
        self.assertEqual(json.loads(result['content'][0]['text'])['operation_state'], 'not_started')
        self.assertEqual(self.clusters.raw(draft['id'])['status'], 'draft')
        self.assertEqual(self.schedules.list({'sourceId': 'source-a'}), [])

    def test_lost_managed_submit_retains_exact_finite_monitor_without_resubmission(self):
        draft = self.draft(self.profile['id'], 'managed-unknown')
        data = self.managed_submit_request(draft)
        self.lost = True
        self.assertEqual(self.submit_managed(data)['status'], 'unknown')
        original = self.schedules.list({'sourceId': 'source-a'})[0]
        self.close()
        self.open()
        self.assertEqual(self.submit_managed(data)['status'], 'unknown')
        self.assertEqual(len(self.submissions), 2)
        self.assertEqual(self.schedules.list({'sourceId': 'source-a'}), [original])
        self.time = original['expiresAt']
        self.pump(resume=True)
        expired = self.status(original)
        self.assertEqual((expired['status'], expired['count'], expired['nextAt']), ('expired', 0, None))

    def test_managed_submit_reuses_explicit_monitor_and_its_budget(self):
        draft = self.draft(self.profile['id'], 'managed-existing')
        self.scope = {**self.scope, 'runId': draft['id']}
        explicit = self.upsert(intervalSeconds=60, maxRuns=3)
        self.time = explicit['nextAt']
        self.pump()
        queued = self.submit_managed(self.managed_submit_request(draft))
        self.assertEqual(queued['status'], 'queued')
        self.assertEqual(queued['managed_submit_monitor']['scheduleId'], explicit['id'])
        plans = self.schedules.list({'sourceId': 'source-a'})
        self.assertEqual(len(plans), 1)
        self.assertEqual((plans[0]['count'], plans[0]['maxRuns']), (1, 3))

    def test_exhausted_monitor_allows_one_exact_manual_poll_without_reset_or_wake(self):
        plan = self.upsert(intervalSeconds=2, maxRuns=1, expiresAt=1010)
        method, route = 'POST', '/api/managed-schedules/observe-once'
        request = {**self.request(plan), 'requestId': 'human-click'}
        with self.assertRaises(PermissionError):
            dispatch(self.service, method, route, request, True)
        self.time = 1002
        self.pump()
        self.assertEqual(self.status(plan)['status'], 'exhausted')
        polled = []
        self.before_poll = lambda payload: polled.append(payload['id'])
        with self.assertRaises(PermissionError):
            dispatch(self.service, method, route, request, False)
        with self.assertRaises(PermissionError):
            dispatch(self.service, method, route, {**request, 'sourceId': 'other'}, True)
        self.terminal.add(self.parent['id'])
        observed = dispatch(self.service, method, route, request, True)
        self.assertEqual((observed['status'], observed['run']['status']), ('observed', 'succeeded'))
        self.assertEqual(observed['snapshot']['runs'][0], observed['run'])
        self.assertEqual(observed['snapshot']['schedules'][0]['count'], 1)
        self.assertEqual(polled, [self.parent['id']])
        self.time = 2000
        self.assertEqual(dispatch(self.service, method, route, request, True)['run'], observed['run'])
        self.assertEqual(polled, [self.parent['id']])
        self.assertFalse(self.pump()['deliveries'])
        self.assertEqual(self.status(plan)['status'], 'exhausted')
        self.assertEqual(len(self.status(plan)['history']), 1)

    def test_manual_observation_replays_its_own_run_after_a_later_check_and_worker_restart(self):
        plan = self.upsert(intervalSeconds=2, maxRuns=1)
        with patch('studio_worker.compute.cluster.time', SimpleNamespace(time=lambda: self.time)):
            self.time = 1002
            self.pump()
            self.calls.clear()
            self.time = 1003
            first = self.observe(plan, 'first-check')
            self.assertEqual((first['status'], first['run']['status'], first['run']['observedAt']),
                             ('observed', 'running', 1003))
            self.terminal.add(self.parent['id'])
            self.time = 1004
            latest = self.observe(plan, 'later-check')
            self.assertEqual((latest['status'], latest['run']['status'], latest['run']['observedAt']),
                             ('observed', 'succeeded', 1004))
        self.assertEqual([timeout for _, _, timeout in self.calls], [30, 30])
        stored = {row['requestId']: row for row in self.service.store.list(MANUAL_OBSERVATION)}
        self.assertEqual((stored['first-check']['run'], stored['first-check']['finishedAt']), (first['run'], 1003))
        self.assertNotIn('nonce', stored['first-check']['run'])

        self.close()
        self.open()
        self.time = 1005
        replay = self.observe(plan, 'first-check')
        self.assertEqual((replay['status'], replay['run']), (first['status'], first['run']))
        self.assertEqual((replay['snapshot']['observedAt'], replay['snapshot']['runs']), (1005, [latest['run']]))
        self.assertEqual(len(self.calls), 2)
        self.assertEqual((self.status(plan)['count'], self.status(plan)['delegationCount']), (1, 1))

    def test_legacy_completed_and_abandoned_manual_receipts_stay_unconfirmed(self):
        plan = self.upsert(intervalSeconds=2, maxRuns=1)
        self.time = 1002
        self.pump()
        self.calls.clear()
        for receipt_status in ('observed', 'started'):
            request_id = 'legacy-' + receipt_status
            self.service.store.put(MANUAL_OBSERVATION, {**self.request(plan), 'requestId': request_id,
                'id': fingerprint(['source-a', plan['id'], request_id]), 'runId': self.parent['id'],
                'startedAt': 1003, 'status': receipt_status})
            response = self.observe(plan, request_id)
            self.assertEqual((response['status'], response['run']['status'], response['run']['observedAt']),
                             ('unknown', 'unknown', None))
            self.assertEqual((response['run']['id'], response['run']['projectId']),
                             (self.parent['id'], self.project['id']))
            current = response['snapshot']['runs'][0]
            self.assertEqual(current['status'], 'running')
            self.assertIsNotNone(current['observedAt'])
        self.assertFalse(self.calls)

    def unverified_active_transport(self, _profile):
        def wire(script, data=None, timeout=40):
            receipt = json.loads(self.wire(script, data, timeout).removeprefix('__STUDIO_JSON__'))
            return '__STUDIO_JSON__' + json.dumps({**receipt, 'identity_verified': False})
        return SimpleNamespace(run=wire)

    def test_unconfirmed_manual_poll_preserves_its_result_and_reports_in_flight(self):
        plan = self.upsert(intervalSeconds=2, maxRuns=1)
        with patch('studio_worker.compute.cluster.time', SimpleNamespace(time=lambda: self.time)):
            self.time = 1002
            self.pump()
            self.calls.clear()
            self.time = 1003
            def during_request(_payload):
                for request_id in ('pending', 'another-click'):
                    self.assertEqual(self.observe(plan, request_id)['status'], 'in_progress')
                self.assertEqual([row['status'] for row in self.service.store.list(MANUAL_OBSERVATION)], ['started'])

            self.before_poll = during_request
            with patch.object(self.clusters, 'transport', self.unverified_active_transport):
                unconfirmed = self.observe(plan, 'pending')
            self.assertEqual((unconfirmed['status'], unconfirmed['run']['observedAt']), ('unknown', 1002))
            self.assertIsNone(unconfirmed['run']['schedulerState'])
            self.before_poll = None
            self.time = 1004
            later = self.observe(plan, 'another-click')
            self.assertEqual((later['status'], later['run']['observedAt']), ('observed', 1004))
            replay = self.observe(plan, 'pending')
        self.assertEqual((replay['status'], replay['run']), ('unknown', unconfirmed['run']))
        self.assertEqual(replay['snapshot']['runs'], [later['run']])
        self.assertEqual([timeout for _, _, timeout in self.calls], [30, 30])

    def test_saved_verified_active_run_without_a_new_poll_is_not_an_observation(self):
        plan = self.upsert(intervalSeconds=2, maxRuns=1)
        self.time = 1002
        self.pump()
        existing = self.clusters.run(self.parent['id'])
        self.assertTrue(existing['identity_verified'])
        with patch.object(self.clusters, 'poll', return_value=existing):
            result = self.observe(plan, 'unchanged')
        self.assertEqual(result['status'], 'unknown')

    def test_finite_status_round_with_stale_time_and_unverified_active_state_is_unconfirmed(self):
        plan = self.upsert('action', action={'type': 'status'}, intervalSeconds=2, maxRuns=2)
        with patch('studio_worker.compute.cluster.time', SimpleNamespace(time=lambda: self.time)):
            self.time = 1002
            self.pump()
            self.assertEqual(self.status(plan)['lastResult']['observedAt'], 1002)
            self.time = 1004
            with patch.object(self.clusters, 'transport', self.unverified_active_transport):
                self.pump()
        detail = self.status(plan)
        self.assertEqual((detail['count'], detail['delegationCount']), (2, 2))
        last = detail['lastResult']
        self.assertEqual((last['status'], last['observedAt']), ('unknown', None))
        self.assertEqual((last['run']['status'], last['run']['observedAt']), ('running', 1002))

    def test_last_counted_poll_uses_verified_terminal_state_before_exhausted(self):
        self.terminal.add(self.parent['id'])
        plan = self.upsert('action', action={'type': 'status'}, intervalSeconds=2, maxRuns=1)
        self.time = 1002
        self.pump()
        done = self.status(plan)
        self.assertEqual((done['count'], done['status'], done['nextAt']), (1, 'completed', None))
        self.assertEqual(done['lastResult']['run']['status'], 'succeeded')

    def test_verified_scheduler_completion_does_not_invent_a_run_exit_receipt(self):
        def done_wire(script, data=None, timeout=40):
            return '__STUDIO_JSON__' + json.dumps({'job_id': self.parent['job_id'], 'scheduler_state': 'COMPLETED',
                                                   'identity_verified': True})
        with patch.object(self.clusters, 'transport', lambda _profile: SimpleNamespace(run=done_wire)):
            plan = self.upsert(intervalSeconds=2, maxRuns=1)
            self.time = 1002
            self.pump()
        done = self.status(plan)
        observation = done['lastResult']['run']
        self.assertTrue(observation['schedulerTerminal'])
        self.assertEqual(observation['status'], 'unknown')
        self.assertEqual(done['status'], 'completed')
        self.assertIsNone(self.clusters.raw(self.parent['id'])['exit'])

    def test_restart_skips_missed_rounds_and_edit_preserves_count_and_expiry(self):
        plan = self.upsert(intervalSeconds=10, maxRuns=6, expiresAt=1100)
        self.time = plan['nextAt']
        self.pump()
        old = self.status(plan)
        updated = self.upsert(mutationId='edit', expectedRevision=old['revision'], intervalSeconds=7)
        self.assertEqual((updated['count'], updated['expiresAt']), (1, 1100))
        self.assertEqual(self.upsert(intervalSeconds=10, maxRuns=6, expiresAt=1100), updated)
        with self.assertRaises(ValueError):
            self.upsert(mutationId='edit', expectedRevision=old['revision'], intervalSeconds=5)
        self.close()
        self.open()
        self.time = 1040
        view = self.pump(resume=True)
        self.assertEqual(view['schedules'][0]['count'], 1)
        self.assertGreater(view['schedules'][0]['nextAt'], self.time)
        self.time = view['schedules'][0]['nextAt']
        self.pump()
        self.assertEqual(self.status(plan)['count'], 2)
        self.time = 1100
        self.pump()
        self.assertEqual(self.status(plan)['status'], 'expired')
        with self.assertRaises(ValueError):
            self.upsert(mutationId='extend', expectedRevision=updated['revision'], expiresAt=2000)

    def test_wake_outbox_is_source_bound_durable_and_deduplicated(self):
        self.scope = {**self.scope, 'runId': None}
        plan = self.upsert('wake_agent', intervalSeconds=10, maxRuns=2, wakeText='Review the latest approved analysis')
        self.time = 1010
        first = self.pump()['deliveries']
        self.assertEqual(len(first), 1)
        self.assertEqual(first[0]['text'], 'Review the latest approved analysis')
        self.assertEqual(first[0]['scope'], self.scope)
        self.assertEqual(self.pump()['deliveries'], first)
        self.close()
        self.open()
        self.assertEqual(self.pump(resume=True)['deliveries'], first)
        with self.assertRaises(PermissionError):
            self.schedules.ack({'sourceId': 'other-source', 'deliveryId': first[0]['id']})
        payload = {'sourceId': 'source-a', 'deliveryId': first[0]['id']}
        self.assertEqual(self.schedules.ack(payload), self.schedules.ack(payload))
        self.assertFalse(self.pump()['deliveries'])
        self.time = 1020
        self.assertEqual(len(self.pump()['deliveries']), 1)
        stopped = self.schedules.stop(self.request(plan))
        self.assertEqual(stopped['status'], 'stopped')
        self.assertFalse(self.pump()['deliveries'])

    def test_script_is_only_in_scheduler_archive_and_cancels_verified_child(self):
        plan = self.script()
        self.time = 1002
        self.calls.clear()
        view = self.pump()
        active = view['schedules'][0]['active']
        self.assertEqual(active['status'], 'queued')
        child_id = active['childId']
        script, archive, timeout = self.calls[0]
        self.assertNotIn('fixture-script', script)
        with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as tar:
            self.assertIn(b'fixture-script', tar.extractfile('simulation/scheduled.sh').read())
            batch = tar.extractfile('job.sh').read()
            self.assertIn(b'#SBATCH --partition=fixture', batch)
            self.assertIn(b'45s /bin/bash', batch)
            self.assertIn(self.parent['id'].encode(), batch)
            self.assertEqual(json.load(tar.extractfile('.studio/schedule.json'))['scope'], self.scope)
        self.assertLessEqual(timeout, 45)
        self.assertEqual(self.clusters.poll(child_id)['status'], 'queued')
        with self.assertRaises(PermissionError):
            self.clusters.cancel(child_id)
        stopped = self.schedules.stop(self.request(plan))
        self.assertEqual(stopped['status'], 'stopped')
        self.assertEqual(stopped['cancellation']['signalSent'], True)
        self.time += 5
        self.pump()
        final = self.status(plan)
        self.assertEqual(final['cancellation']['status'], 'confirmed')
        self.assertIsNone(final['active'])
        self.assertEqual(self.cancelled, {active['jobId']})
        self.assertEqual(self.clusters.raw(self.parent['id'])['status'], 'queued')
        self.assertEqual(self.status(plan)['count'], 1)

    @unittest.skipUnless(os.name == 'posix', 'Uses bounded local Bash processes for the scheduler fixture')
    def test_plan_stop_ends_child_process_while_parent_and_peer_keep_running(self):
        peer = self.draft(self.profile['id'], 'other-session-job')
        self.clusters.submit(peer['id'])
        processes = {}

        def start(job_id, command):
            process = subprocess.Popen(command, cwd=self.root, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            processes[job_id] = process
            def finish():
                if process.poll() is None:
                    process.terminate()
                process.wait(timeout=3)
            self.addCleanup(finish)
            return process

        parent = start(self.submissions[self.parent['id']][0], ['sleep', '20'])
        other = start(self.submissions[peer['id']][0], ['sleep', '20'])
        wire = self.wire
        def scheduler_command(script, data=None, timeout=40):
            result = wire(script, data, timeout)
            argv = shlex.split(script)
            if data is not None:
                receipt = json.loads(result.removeprefix('__STUDIO_JSON__'))
                with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
                    actual = archive.extractfile('simulation/scheduled.sh').read().decode()
                start(receipt['job_id'], ['/bin/bash', '-c', actual])
            elif argv[0] == 'scancel':
                processes[argv[1]].terminate()
            return result
        self.clusters.transport = lambda _profile: SimpleNamespace(run=scheduler_command)
        plan = self.script(script={'language': 'bash', 'text': 'exec sleep 20\n'})
        self.time = 1002
        active = self.pump()['schedules'][0]['active']
        child = processes[active['jobId']]
        self.assertIsNone(child.poll())
        self.schedules.stop(self.request(plan))
        self.assertLess(child.wait(timeout=3), 0)
        self.assertIsNone(parent.poll())
        self.assertIsNone(other.poll())
        self.time += 10
        self.pump()
        stopped = self.status(plan)
        self.assertEqual((stopped['count'], stopped['cancellation']['status']), (1, 'confirmed'))
        self.assertEqual(self.cancelled, {active['jobId']})
        self.assertEqual(len(processes), 3)

    def test_unverified_child_and_lost_submit_are_never_retried(self):
        plan = self.script()
        self.time = 1002
        self.lost = True
        self.pump()
        first = self.status(plan)
        self.assertEqual(first['status'], 'unknown')
        self.assertEqual(first['count'], 1)
        self.assertIsNotNone(first['active']['childId'])
        self.time = 1200
        self.pump()
        self.assertEqual(len(self.submissions), 2)
        self.wrong_identity = True
        stopped = self.schedules.stop(self.request(plan))
        self.assertEqual(stopped['cancellation']['status'], 'unconfirmed')
        self.assertEqual(stopped['cancellation']['signalSent'], False)
        self.assertFalse(self.cancelled)
        self.schedules.stop(self.request(plan))
        self.assertEqual(len(self.submissions), 2)

    def test_stop_wins_while_child_archive_is_prepared(self):
        plan = self.script()
        self.time = 1002
        original = self.clusters.archive
        entered, release = threading.Event(), threading.Event()
        errors = []
        def held_archive(row):
            entered.set()
            if not release.wait(10):
                raise RuntimeError('fixture barrier not released')
            return original(row)
        def run_pump():
            try:
                self.pump()
            except Exception as error:
                errors.append(error)
        with patch.object(self.clusters, 'archive', held_archive):
            thread = threading.Thread(target=run_pump)
            thread.start()
            try:
                self.assertTrue(entered.wait(10))
                self.assertEqual(self.schedules.stop(self.request(plan))['status'], 'stopped')
            finally:
                release.set()
                thread.join(10)
        self.assertFalse(thread.is_alive())
        self.assertFalse(errors)
        self.assertEqual(len(self.submissions), 1)
        final = self.status(plan)
        self.assertEqual((final['status'], final['count']), ('stopped', 1))
        self.assertIsNone(final['active'])

    def test_task_slot_and_lifetime_hard_cap_apply_to_sibling_plans(self):
        poll = self.upsert(intervalSeconds=3, maxRuns=336)
        different = self.upsert('action', action={'type': 'status'}, intervalSeconds=2, maxRuns=336)
        with self.assertRaises(ValueError):
            self.upsert(mutationId='clone', key='another-copy')
        with self.assertRaises(ValueError):
            self.upsert('wake_agent', maxRuns=337, wakeText='fixture')
        raw = self.service.store.get('managed-schedule', poll['id'])
        budget = self.schedules._budget(raw)
        self.service.store.put(DELEGATION, {**budget, 'count': 335})
        self.time = 1002
        self.pump()
        self.time = 1010
        self.pump()
        self.assertEqual((self.status(poll)['count'], self.status(different)['count']), (0, 1))
        self.assertEqual(self.status(poll)['status'], 'exhausted')
        self.assertEqual(self.status(different)['delegationCount'], 336)

    def test_child_deadline_owns_only_its_single_cancellation_attempt(self):
        plan = self.script()
        sibling = self.script(key='analysis-two', script={'language': 'python', 'text': 'print("second fixture")\n'})
        self.time = 1002
        self.pump()
        self.pump()
        running = next(row for row in (self.status(plan), self.status(sibling)) if row['active'])
        waiting = sibling if running['id'] == plan['id'] else plan
        self.assertEqual(self.status(waiting)['count'], 0)
        self.time = running['active']['deadlineAt']
        self.pump()
        self.assertEqual(self.cancelled, {running['active']['jobId']})
        self.time += 5
        self.pump()
        self.assertEqual(self.status(running)['lastResult']['status'], 'timed_out')
        self.assertEqual(self.clusters.raw(self.parent['id'])['status'], 'queued')
        self.assertEqual(sum(script.startswith('scancel ') for script, _, _ in self.calls), 1)

    def test_script_details_keep_revision_and_history_out_of_passive_summary(self):
        original = self.script()
        self.assertNotIn('text', original['script'])
        self.assertEqual(original['script']['version'], 1)
        self.time = 1002
        self.pump()
        edit = self.upsert('script', key='analysis', mutationId='change-program', expectedRevision=original['revision'],
                           script={'language': 'python', 'text': 'print("changed")\n'})
        self.assertEqual((edit['count'], edit['script']['version']), (1, 2))
        detail = self.status(edit)
        self.assertEqual(detail['script']['text'], 'print("changed")\n')
        self.assertEqual(detail['history'][0]['plan']['script']['sha256'], original['script']['sha256'])
        self.assertEqual(detail['history'][0]['plan']['script']['version'], 1)
        self.assertNotIn('text', self.schedules.snapshot({'sourceId': 'source-a'})['schedules'][0]['script'])

    def test_interrupted_claim_is_never_replayed(self):
        raw = self.service.store.get('managed-schedule', self.upsert()['id'])
        self.time = raw['nextAt']
        with self.service.store.lock:
            self.schedules._claim(raw, self.time)
        self.assertEqual(len(self.service.store.list(ROUND)), 1)
        self.close()
        self.open()
        self.calls.clear()
        self.pump()
        self.assertFalse(self.calls)
        self.assertEqual(self.status(raw)['status'], 'unknown')

    def test_worker_administration_and_current_project_scope_are_required(self):
        with self.assertRaises(PermissionError):
            dispatch(self.service, 'POST', '/api/managed-schedules/pump', {'sourceId': 'source-a'}, False)
        with self.assertRaises(PermissionError):
            self.upsert(scope={**self.scope, 'projectId': self.service.register_project({
                'name': 'other', 'policy': {'input_roots': [str(self.root)]},
            })['id']})
        plan = self.upsert(intervalSeconds=2)
        project = self.service.store.get('project', self.project['id'])
        project['policy']['clusters'] = []
        self.service.store.put('project', project)
        self.calls.clear()
        self.time = 1002
        self.pump()
        self.assertFalse(self.calls)
        self.assertEqual(self.status(plan)['lastResult']['status'], 'blocked')

    def test_bash_and_python_child_wrappers_run_locally_without_a_scheduler(self):
        bash = shutil.which('bash') if os.name == 'posix' else os.environ.get('STUDIO_TEST_GIT_BASH')
        if not bash or not Path(bash).is_file():
            self.skipTest('A verified POSIX-compatible Bash was unavailable')
        for scheduler, language in [('slurm', 'bash'), ('lsf', 'python')]:
            with self.subTest(scheduler=scheduler, language=language):
                fixture = self.root / scheduler
                simulation = fixture / 'simulation'
                simulation.mkdir(parents=True)
                source = 'printf "%s\\n" fixture-bash\n' if language == 'bash' else 'print("fixture-python")\n'
                import hashlib
                name = 'scheduled.sh' if language == 'bash' else 'scheduled.py'
                (simulation / name).write_text(source, encoding='utf8', newline='\n')
                run = {'job_name': 'gss-fixture', 'nonce': 'receipt-fixture', 'remote_directory': fixture.as_posix(),
                       'max_seconds': 2, 'resources': {'queue': 'fixture', 'cpus': 1, 'memory_mb': 512, 'gpus': 0, 'seconds': 2},
                       'cluster_snapshot': {'scheduler': scheduler, 'environment': {'executables': {'python': Path(sys.executable).as_posix()}}},
                       'snapshots': [{'name': name, 'sha256': hashlib.sha256(source.encode()).hexdigest()}],
                       'managed_child': {'language': language, 'parentDirectory': self.root.as_posix(),
                                         'scheduleId': 'fixture', 'occurrence': 1}}
                path = fixture / 'job.sh'
                script = child_batch(run)
                self.assertIn('#SBATCH --time=1' if scheduler == 'slurm' else '#BSUB -W 1', script)
                path.write_text(script, encoding='utf8', newline='\n')
                result = subprocess.run([bash, str(path)], cwd=fixture, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, (result.stdout, result.stderr))
                self.assertEqual(json.loads((fixture / 'exit.json').read_text()), {'nonce': 'receipt-fixture', 'exit_code': 0})
                self.assertEqual((fixture / 'console.log').read_text().strip(), 'fixture-' + language)


if __name__ == '__main__':
    unittest.main()
